/* ---------- the wireless microphone (micyou-sender package) ---------- */

const MICYOU_CTL = '/usr/bin/micyou-ctl';
const MICYOU_KEYS = '/usr/share/micyou/keys.uc';

function micyou_keys() {
	let f = loadfile(MICYOU_KEYS, { raw_mode: true });
	let keys = f ? f() : [];
	// custom:false = 只作档案保留（电话键/电源键/其他机型专属键）：不显示、不参与匹配
	return filter(keys, k => k.custom !== false);
}

// “原有功能”总表（任何按键都可选用，fn:<id>）
const MICYOU_FUNCS = '/usr/share/micyou/funcs.uc';
function micyou_funcs() {
	let f = loadfile(MICYOU_FUNCS, { raw_mode: true });
	return f ? f() : [];
}

// 每个键的功能：single/long ∈ none|original|connect|disconnect|toggle|connect_if_down；
// mode ∈ none|pckey（自定义电脑按键）；chord = VK 码（如 "165 32"）见 keys.uc 注释。
// 默认 single=original / long=original / mode=none / ms=500 / vib=1（见 /etc/config/micyou）
function micyou_bindings() {
	let c = cursor();
	let master_vib = c.get('micyou', 'main', 'vibrate') != '0';   // “所有按键震动”总开关
	let global_ms = +(c.get('micyou', 'main', 'ms') ?? 0);        // “统一长按阈值”
	let out = {};
	for (let k in micyou_keys()) {
		out[k.id] = {
			single: c.get('micyou', 'keys', `${k.id}_single`) ?? 'original',
			long: c.get('micyou', 'keys', `${k.id}_long`) ?? 'original',
			mode: c.get('micyou', 'keys', `${k.id}_mode`) ?? 'none',
			chord: c.get('micyou', 'keys', `${k.id}_chord`) ?? '',
			autoconnect: c.get('micyou', 'keys', `${k.id}_autoconnect`) == '1',
			ms: global_ms || +(c.get('micyou', 'keys', `${k.id}_ms`) ?? 500),
			vib: master_vib && c.get('micyou', 'keys', `${k.id}_vib`) != '0'
		};
	}
	return out;
}

// what the page needs to draw the keys and to act on them; micyou-ctl owns
// the sender (see its usage for the exit-code convention)
function micyou_status() {
	let c = cursor();
	return {
		connected: system(`${MICYOU_CTL} status >/dev/null 2>&1`) == 0,
		server: c.get('micyou', 'main', 'server') ?? '',
		port: +(c.get('micyou', 'main', 'port') ?? 8554),
		device: c.get('micyou', 'main', 'device') ?? 'hw:0,0',
		keys: micyou_keys(),
		funcs: micyou_funcs(),
		bindings: micyou_bindings()
	};
}

