// MicYou 无线麦克风：LuCI 后端（rpcd object "micyou"）。
//
//   status          { connected, server, port, device, autostart, bindings }
//                   bindings: { <键id>: { single, long, ms, vib } }
//   keys            { keys: [ ... ] }   权威键表（/usr/share/micyou/keys.uc，含原有功能）
//   connect         { ok, message, ...status }
//   disconnect      { ok, message, ...status }
//   set_autostart   { on } -> { ok, message, ...status }
//   scan            { servers: [...], ... }   扫描同网段 MicYou 服务器
//
// 所有动作都走 /usr/bin/micyou-ctl，与屏幕界面、UCI 配置完全同一套逻辑。
'use strict';

import { popen } from 'fs';

const CTL = '/usr/bin/micyou-ctl';
const KEYS = '/usr/share/micyou/keys.uc';
const FUNCS = '/usr/share/micyou/funcs.uc';

function run(cmd) {
	let p = popen(`${cmd} 2>&1`);
	let out = p ? p.read('all') : '';
	let rc = p ? p.close() : -1;
	return { rc, out: trim(out ?? '') };
}

function uci_get(option) {
	let r = run(`uci -q get micyou.${option}`);
	return r.rc == 0 ? r.out : '';
}

function key_list() {
	let f = loadfile(KEYS, { raw_mode: true });
	return f ? f() : [];
}

// “原有功能”总表（任何按键都可选用，见 funcs.uc）
function func_list() {
	let f = loadfile(FUNCS, { raw_mode: true });
	return f ? f() : [];
}

// 每键的功能；未配置时给默认值（original / original / none / 震动开 / 500ms）
// main.ms 是“统一长按阈值”，设了就覆盖每键的 <id>_ms
function bindings() {
	let out = {};
	let master_vib = uci_get('main.vibrate') != '0';
	let global_ms = +(uci_get('main.ms') || 0);
	for (let k in key_list()) {
		let id = k.id;
		out[id] = {
			single: uci_get(`keys.${id}_single`) || 'original',
			long: uci_get(`keys.${id}_long`) || 'original',
			mode: uci_get(`keys.${id}_mode`) || 'none',
			chord: uci_get(`keys.${id}_chord`),
			autoconnect: uci_get(`keys.${id}_autoconnect`) == '1',
			ms: global_ms || +(uci_get(`keys.${id}_ms`) || 500),
			vib: master_vib && uci_get(`keys.${id}_vib`) != '0'
		};
	}
	return out;
}

// 读整份配置（[main] + [keys]），避免前端直接调 ubus uci（ACL 更简单）
function uci_show() {
	let out = { main: {}, keys: {} };
	let r = run('uci -q show micyou');
	if (r.rc != 0)
		return out;
	for (let line in split(r.out ?? '', '\n')) {
		let m = match(line, /^micyou\.([a-z0-9_]+)\.([a-z0-9_]+)='(.*)'$/);
		if (!m) continue;
		if (m[1] == 'main' || m[1] == 'keys')
			out[m[1]][m[2]] = m[3];
	}
	return out;
}

// 单引号包裹并转义，安全拼进 shell
function uci_quote(value) {
	return `'${replace(`${value}`, /'/g, "'\\''")}'`;
}

function status() {
	let r = run(`${CTL} status`);
	let auto = run(`${CTL} autostart status`);
	return {
		connected: r.rc == 0,
		server: uci_get('main.server'),
		port: +(uci_get('main.port') || 8554),
		device: uci_get('main.device') || 'hw:0,0',
		autostart: auto.rc == 0,
		bindings: bindings()
	};
}

return {
	micyou: {
		status: {
			call: function() {
				return status();
			}
		},
		keys: {
			call: function() {
				return { keys: key_list(), funcs: func_list() };
			}
		},
		connect: {
			call: function() {
				let r = run(`${CTL} connect`);
				return { ok: r.rc == 0, message: r.out, ...status() };
			}
		},
		disconnect: {
			call: function() {
				let r = run(`${CTL} disconnect`);
				return { ok: r.rc == 0, message: r.out, ...status() };
			}
		},
		set_autostart: {
			args: { on: false },
			call: function(req) {
				let r = run(`${CTL} autostart ${req.args?.on ? 'on' : 'off'}`);
				return { ok: r.rc == 0, message: r.out, ...status() };
			}
		},
		scan: {
			args: { port: 0 },
			call: function(req) {
				let port = +(req.args?.port ?? 0) || +(uci_get('main.port') || 8554);
				let r = run(`${CTL} scan ${port}`);
				let result = json(r.out ?? 'null');
				return result ?? { servers: [], error: r.out || 'scan failed' };
			}
		},
		gain: {
			call: function() {
				let r = run(`${CTL} gain`);
				let step = (r.rc == 0 && r.out != '') ? +r.out : null;
				return { step, db: step == null ? null : step * 3, max: 7 };
			}
		},
		set_gain: {
			args: { step: 0 },
			call: function(req) {
				let step = +(req.args?.step ?? 0);
				if (step < 0 || step > 7)
					return { ok: false, message: 'gain must be 0..7' };
				// 写入 UCI 以便连接/重启时自动应用，同时立刻生效
				let r = run(`uci -q set micyou.main.gain='${step}' && uci -q commit micyou && ${CTL} gain ${step}`);
				return { ok: r.rc == 0, message: r.out, step, db: step * 3, max: 7 };
			}
		},
		config: {
			call: function() {
				return uci_show();
			}
		},
		save: {
			args: { main: {}, keys: {} },
			call: function(req) {
				let cmds = [];
				let main = req.args?.main ?? {};
				for (let name in main)
					if (match(name, /^[a-z0-9_]+$/))
						push(cmds, `uci -q set micyou.main.${name}=${uci_quote(main[name])}`);
				let keys = req.args?.keys ?? {};
				for (let name in keys)
					if (match(name, /^[a-z0-9_]+$/))
						push(cmds, `uci -q set micyou.keys.${name}=${uci_quote(keys[name])}`);
				if (!length(cmds))
					return { ok: true, message: 'nothing to save' };
				push(cmds, 'uci -q commit micyou');
				let r = run(join(' && ', cmds));
				// 增益改动立即生效（页面保存与“导入配置”都走这里）
				let gain = main.gain;
				if (r.rc == 0 && gain != null && `${gain}` != '')
					run(`${CTL} gain ${gain} >/dev/null 2>&1 || true`);
				return { ok: r.rc == 0, message: r.out };
			}
		},
		reset: {
			call: function() {
				// 恢复默认值：连接设置回出厂默认，按键全部“不接管”，清掉增益/震动/定时/阈值。
				// 注意：`uci -q delete` 对**不存在**的选项返回非 0，所以每个 delete 都要 `|| true`，
				// 否则 `&&` 链会在这里断掉、后面的 set 不执行（踩过一次）。
				let cmds = [
					'uci -q delete micyou.keys || true',
					'uci -q set micyou.keys=keys',
					'uci -q delete micyou.main.gain || true',
					'uci -q delete micyou.main.vibrate || true',
					'uci -q delete micyou.main.ms || true',
					'uci -q delete micyou.main.sched_connect || true',
					'uci -q delete micyou.main.sched_disconnect || true',
					"uci -q set micyou.main.server='192.168.1.100'",
					"uci -q set micyou.main.port='8554'",
					"uci -q set micyou.main.device='hw:0,0'",
					"uci -q set micyou.main.gain='4'",
					'uci -q commit micyou'
				];
				let r = run(join(' && ', cmds));
				run(`${CTL} gain 4 >/dev/null 2>&1 || true`);
				return { ok: r.rc == 0, message: r.out, ...uci_show() };
			}
		}
	}
};