'use strict';
'require view';
'require rpc';
'require ui';

// MicYou 无线麦克风 —— 连接设置 / 按键功能 / 高级自定义（自定义排版）
//
// 配置读写都走 micyou 后端（不直接调 ubus uci，避免 ACL “Access denied”）。
// 注意：rpc.declare 的 expect 用 {}（取整个对象）——expect:{keys:[]} 会把响应
// 解包成数组，而数组的 .keys 是 Array.prototype.keys 方法，曾因此报
// “keys.forEach is not a function”。
var callStatus = rpc.declare({ object: 'micyou', method: 'status', expect: {} });
var callKeys = rpc.declare({ object: 'micyou', method: 'keys', expect: {} });
var callConfig = rpc.declare({ object: 'micyou', method: 'config', expect: {} });
var callSave = rpc.declare({ object: 'micyou', method: 'save', params: [ 'main', 'keys' ], expect: {} });
var callReset = rpc.declare({ object: 'micyou', method: 'reset', expect: {} });
var callConnect = rpc.declare({ object: 'micyou', method: 'connect', expect: {} });
var callDisconnect = rpc.declare({ object: 'micyou', method: 'disconnect', expect: {} });
var callAutostart = rpc.declare({ object: 'micyou', method: 'set_autostart', params: [ 'on' ], expect: {} });
var callGain = rpc.declare({ object: 'micyou', method: 'gain', expect: {} });
var callSetGain = rpc.declare({ object: 'micyou', method: 'set_gain', params: [ 'step' ], expect: {} });

// 单击/长按可选功能：麦克风动作 + 信息屏的全部“原有功能”（fn:<id>，来自 funcs.uc）
var MIC_ACTIONS = [
	[ 'connect', '连接服务器' ],
	[ 'disconnect', '断开服务器' ],
	[ 'toggle', '切换连接断开' ],
	[ 'connect_if_down', '若未连接则自动连接' ]
];

// 自定义电脑按键的可选键（Windows VK 码，与 fork 的协议一致）
var VK_CHOICES = [
	[ '', '无' ], [ '162', '左Ctrl' ], [ '163', '右Ctrl' ], [ '164', '左Alt' ], [ '165', '右Alt' ],
	[ '91', '左Win' ], [ '92', '右Win' ], [ '13', '回车键' ], [ '32', '空格' ], [ '8', '退格键' ]
];

function keysOf(result) {
	if (Array.isArray(result)) return result;
	if (result && Array.isArray(result.keys)) return result.keys;
	return [];
}
function funcsOf(result) {
	if (result && Array.isArray(result.funcs)) return result.funcs;
	return [];
}
function cfgOf(result) {
	return (result && typeof result == 'object' && !Array.isArray(result)) ? result : {};
}

var STATUS = {}, BIND = {}, EDITS = {}, GAIN = {}, FUNCS = [];

function makeRow(labelText, controls) {
	var row = E('div', { 'class': 'micyou-row' });
	if (labelText != null)
		row.appendChild(E('div', { 'class': 'micyou-row-label' }, labelText));
	var box = E('div', { 'class': 'micyou-row-controls' });
	for (var i = 0; i < controls.length; i++)
		box.appendChild(controls[i]);
	row.appendChild(box);
	return row;
}

// options: [ [value, label], ['group', 标题], ... ]（支持分组标题）
function makeSelect(options, value, onchange) {
	var sel = E('select', { 'class': 'cbi-input-select' });
	var group = null;
	options.forEach(function(opt) {
		if (opt[0] === 'group') {
			group = E('optgroup', { 'label': opt[1] });
			sel.appendChild(group);
			return;
		}
		var node = E('option', { 'value': opt[0] }, opt[1]);
		if (String(opt[0]) == String(value)) node.selected = true;
		(group || sel).appendChild(node);
	});
	sel.addEventListener('change', function() { onchange(sel.value); });
	return sel;
}

function makeInput(value, placeholder, onchange, size) {
	var input = E('input', { 'class': 'cbi-input-text', 'type': 'text',
		'style': 'width:' + (size || 10) + 'em' });
	input.value = value == null ? '' : value;
	if (placeholder) input.placeholder = placeholder;
	input.addEventListener('change', function() { onchange(input.value.trim()); });
	return input;
}

function makeCheck(checked, label, onchange) {
	var box = E('label', { 'class': 'micyou-check' });
	var input = E('input', { 'type': 'checkbox' });
	input.checked = !!checked;
	input.addEventListener('change', function() { onchange(input.checked); });
	box.appendChild(input);
	if (label) box.appendChild(E('span', {}, label));
	return box;
}

return view.extend({
	load: function() {
		return Promise.all([ callKeys(), callStatus(), callGain(), callConfig() ]);
	},

	render: function(data) {
		var keysResult = data[0] || {};
		var keys = keysOf(keysResult);
		FUNCS = funcsOf(keysResult);
		STATUS = (data[1] && typeof data[1] == 'object' && !Array.isArray(data[1])) ? data[1] : {};
		GAIN = (data[2] && typeof data[2] == 'object') ? data[2] : {};
		var cfg = cfgOf(data[3]);
		var main = cfg.main || {};
		var keysCfg = cfg.keys || {};
		BIND = STATUS.bindings || {};
		EDITS = {};

		// 功能下拉的完整选项（分组：麦克风 / 原有功能）
		var actionOptions = [ [ 'group', '麦克风' ] ].concat(MIC_ACTIONS).concat([
			[ 'group', '原有功能' ],
			[ 'original', '保持不变（不接管本键）' ]
		]).concat(FUNCS.map(function(f) { return [ 'fn:' + f.id, f.zh ]; }));

		function cur(id, field, fallback) {
			var name = id + '_' + field;
			if (name in EDITS) return EDITS[name];
			var v = keysCfg[name];
			return (v == null || v === '') ? fallback : v;
		}
		function setEdit(name, value) { EDITS[name] = value; }

		var root = E('div', { 'class': 'cbi-map micyou-page' }, [
			E('link', { 'rel': 'stylesheet', 'type': 'text/css', 'href': L.resource('micyou.css') }),
			E('h2', {}, 'MicYou 无线麦克风'),
			E('div', { 'class': 'cbi-map-descr' },
				'把 E5 的内置麦克风经局域网推送给 PC 的 MicYou 服务端（PC 端把声音送进虚拟声卡）。' +
				'按键功能与详细配置在本页。')
		]);

		// 提示条（放在按钮下方）
		var notice = E('div', { 'class': 'micyou-notice' });
		function say(text, kind) {
			notice.textContent = text;
			notice.className = 'micyou-notice ' + (kind == 'error' ? 'is-error'
				: kind == 'blue' ? 'is-blue'
				: kind == 'neutral' ? 'is-neutral' : 'is-ok');
		}

		/* ================= 连接设置 ================= */
		var mainCard = E('div', { 'class': 'cbi-section micyou-card' }, [
			E('h3', {}, '连接设置')
		]);

		var hostInput = makeInput(main.server || '', '192.168.1.100', function(v) { setEdit('__server', v); }, 14);
		var portInput = makeInput(main.port || '8554', '8554', function(v) { setEdit('__port', v); }, 5);
		mainCard.appendChild(makeRow('服务器地址 : 控制端口', [ hostInput, E('span', {}, ':'), portInput ]));

		var devInput = makeInput(main.device || 'hw:0,0', 'hw:0,0', function(v) { setEdit('__device', v); }, 12);
		var gainOpts = [ [ '', '不设置' ] ];
		for (var step = 0; step <= (GAIN.max || 7); step++)
			gainOpts.push([ String(step), step + ' 档 · ' + (step * 3) + ' dB' ]);
		var gainValue = (main.gain != null && main.gain !== '') ? String(main.gain)
			: (GAIN.step != null ? String(GAIN.step) : '');
		var gainSelect = makeSelect(gainOpts, gainValue, function(v) { setEdit('__gain', v); });
		mainCard.appendChild(makeRow('采集设备 · 采集增益', [ devInput, gainSelect ]));

		// 定时连接 / 定时断开（每天到点执行一次；留空 = 不启用）
		var schedConnect = E('input', { 'type': 'time', 'class': 'cbi-input-text' });
		schedConnect.value = main.sched_connect || '';
		schedConnect.addEventListener('change', function() { setEdit('__sched_connect', schedConnect.value); });
		var schedDisconnect = E('input', { 'type': 'time', 'class': 'cbi-input-text' });
		schedDisconnect.value = main.sched_disconnect || '';
		schedDisconnect.addEventListener('change', function() { setEdit('__sched_disconnect', schedDisconnect.value); });
		mainCard.appendChild(makeRow('定时连接 · 定时断开', [
			schedConnect, E('span', { 'class': 'micyou-tag' }, '连接'),
			schedDisconnect, E('span', { 'class': 'micyou-tag' }, '断开'),
			E('span', { 'class': 'micyou-tag' }, '（每天到点各执行一次；留空 = 不启用）')
		]));

		var stateText = E('span', { 'class': 'micyou-state' }, STATUS.connected ? '已连接' : '未连接');
		stateText.style.color = STATUS.connected ? '#2e7d32' : '#c62828';
		mainCard.appendChild(makeRow('当前状态', [ stateText ]));

		function paintState() {
			stateText.textContent = STATUS.connected ? '已连接' : '未连接';
			stateText.style.color = STATUS.connected ? '#2e7d32' : '#c62828';
		}
		var autostartBtn = E('button', {
				'class': 'cbi-button ' + (STATUS.autostart ? 'micyou-auto-on' : 'micyou-auto-off'),
				'click': function() {
					return callAutostart(!STATUS.autostart).then(function(r) {
						STATUS = r;
						// 按钮本身变色 + 换文字（不额外弹提示）
						autostartBtn.textContent = r.autostart ? '已开启开机自动启动' : '已关闭开机自动启动';
						autostartBtn.className = 'cbi-button ' + (r.autostart ? 'micyou-auto-on' : 'micyou-auto-off');
					});
				}
			}, STATUS.autostart ? '已开启开机自动启动' : '已关闭开机自动启动');
		mainCard.appendChild(makeRow('立即操作', [
			E('button', { 'class': 'cbi-button cbi-button-apply', 'click': function() {
				return callConnect().then(function(r) {
					STATUS = r;
					paintState();
					say(r.ok ? '正在连接…（约 2~3 秒后确认结果）' : ('连接命令失败：' + (r.message || '未知错误')), r.ok ? 'ok' : 'error');
					// 连接是异步的：链路由发送端随后建立。等一会儿确认，没成功就明确报失败
					window.setTimeout(function() {
						callStatus().then(function(s) {
							STATUS = s;
							paintState();
							if (s.connected)
								say('已连接服务器。', 'ok');
							else
								say('连接未成功：请检查 PC 端 MicYou 服务端是否在运行、服务器地址/端口是否正确、' +
									'以及两边网络是否互通（屏幕“设置→无线麦克风”里也能看状态）。', 'error');
						}).catch(function() {});
					}, 4000);
				});
			} }, '连接服务器'),
			E('button', { 'class': 'cbi-button cbi-button-remove', 'click': function() {
				return callDisconnect().then(function(r) {
					STATUS = r;
					paintState();
					say(r.ok ? '正在断开…' : ('断开失败：' + (r.message || '未知错误')), r.ok ? 'ok' : 'error');
					window.setTimeout(function() {
						callStatus().then(function(s) {
							STATUS = s;
							paintState();
							say(s.connected ? '断开可能未生效：请再点一次“断开服务器”。' : '已断开服务器。',
								s.connected ? 'error' : 'ok');
						}).catch(function() {});
					}, 3000);
				});
			} }, '断开服务器'),
			autostartBtn
		]));
		root.appendChild(mainCard);

		/* ================= 按键功能（每键两行，选了自定义电脑按键出第三行） ================= */
		var keysCard = E('div', { 'class': 'cbi-section micyou-card' }, [
			E('h3', {}, '按键功能'),
			E('div', { 'class': 'cbi-section-descr' }, [
				'每个键两行：第一行选“单击/长按”做什么（可把任意“原有功能”挪到本键）；' +
				'第二行可选“自定义电脑按键”（把该键变成 PC 上的按键，PC 端需运行 ',
				E('a', { 'href': 'https://github.com/8099bb4X21/MicYou', 'target': '_blank', 'rel': 'noopener' },
					'MicYou的fork版本'),
				' 并装好 WinUHID 虚拟键盘）。只配置过的键才会被接管，其余保持原有功能。'
			])
		]);

		keys.forEach(function(key) {
			var b = BIND[key.id] || {};
			var block = E('div', { 'class': 'micyou-key' });
			var title = key.zh + '（' + (key.orig_short_zh || key.orig_zh) + '）';

			var singleSel = makeSelect(actionOptions, cur(key.id, 'single', 'original'), function(v) {
				setEdit(key.id + '_single', v);
			});
			var longSel = makeSelect(actionOptions, cur(key.id, 'long', 'original'), function(v) {
				setEdit(key.id + '_long', v);
			});
			var row1 = makeRow(title, [
				E('span', { 'class': 'micyou-tag' }, '单击'), singleSel,
				E('span', { 'class': 'micyou-tag' }, '长按'), longSel
			]);
			block.appendChild(row1);

			var mode = cur(key.id, 'mode', 'none');
			var autoBox = makeCheck(cur(key.id, 'autoconnect', '0') == '1', '若未连接自动连接', function(v) {
				setEdit(key.id + '_autoconnect', v ? '1' : '0');
			});
			autoBox.style.visibility = (mode == 'pckey') ? 'visible' : 'hidden';
			var modeSel = makeSelect([ [ 'none', '无' ], [ 'pckey', '自定义电脑按键' ] ], mode, function(v) {
				setEdit(key.id + '_mode', v);
				var pckey = (v == 'pckey');
				singleSel.disabled = longSel.disabled = pckey;
				row1.style.opacity = pckey ? '0.45' : '';
				autoBox.style.visibility = pckey ? 'visible' : 'hidden';
				row3.style.display = pckey ? '' : 'none';
			});
			block.appendChild(makeRow('', [ modeSel, autoBox ]));

			var chord = (cur(key.id, 'chord', '') || '').split(/\s+/).filter(function(x) { return x; });
			var chordSels = [];
			var row3 = makeRow('组合键', []);
			var chordBox = row3.querySelector('.micyou-row-controls');
			function collectChord() {
				var vks = chordSels.map(function(s) { return s.value; }).filter(function(v) { return v; });
				setEdit(key.id + '_chord', vks.join(' '));
			}
			for (var slot = 0; slot < 3; slot++) {
				(function(index) {
					var sel = makeSelect(VK_CHOICES, chord[index] || '', function() { collectChord(); });
					chordSels.push(sel);
					chordBox.appendChild(sel);
					if (index < 2) chordBox.appendChild(E('span', { 'class': 'micyou-tag' }, '+'));
				})(slot);
			}
			if (mode != 'pckey') row3.style.display = 'none';
			singleSel.disabled = longSel.disabled = (mode == 'pckey');
			if (mode == 'pckey') row1.style.opacity = '0.45';
			block.appendChild(row3);

			keysCard.appendChild(block);
		});
		root.appendChild(keysCard);

		/* ================= 高级自定义（可折叠，默认折叠） ================= */
		var advBody = E('div', { 'class': 'micyou-details-body' }, [
			E('div', { 'class': 'cbi-section-descr' },
				'一行一个按键：是否震动、长按判定阈值（毫秒，默认 500）。' +
				'“所有按键震动”是总开关，关掉后所有键都不震；单键的“不震动”优先。' +
				'“统一长按阈值”勾上后，下方各键的阈值会变灰、以这里的值为准。')
		]);
		var advCard = E('details', { 'class': 'cbi-section micyou-card micyou-details' }, [
			E('summary', {}, '高级自定义（点击展开）'),
			advBody
		]);
		var keyMsInputs = [];
		var msOn = (main.ms != null && main.ms !== '');
		var msGlobalInput = makeInput(msOn ? main.ms : '500', '500', function(v) {
			setEdit('__ms', v.replace(/[^0-9]/g, ''));
		}, 5);
		var msGlobalBox = makeCheck(msOn, '统一长按阈值(ms)', function(v) {
			setEdit('__ms_on', v ? '1' : '0');
			applyMsState();
		});
		function applyMsState() {
			var on = msGlobalBox.querySelector('input').checked;
			msGlobalInput.disabled = !on;
			msGlobalInput.style.opacity = on ? '' : '0.45';
			keyMsInputs.forEach(function(input) {
				input.disabled = on;                       // 统一设置后，各键阈值变灰不可改
				input.style.opacity = on ? '0.45' : '';
			});
		}
		advBody.appendChild(makeRow('', [
			makeCheck(main.vibrate !== '0', '所有按键震动', function(v) {
				setEdit('__vibrate', v ? '1' : '0');
			}),
			msGlobalBox,
			msGlobalInput
		]));
		keys.forEach(function(key) {
			var vibSel = makeSelect([ [ '1', '震动' ], [ '0', '不震动' ] ],
				cur(key.id, 'vib', '1') == '0' ? '0' : '1',
				function(v) { setEdit(key.id + '_vib', v); });
			var msInput = makeInput(cur(key.id, 'ms', '500'), '500',
				function(v) { setEdit(key.id + '_ms', v.replace(/[^0-9]/g, '')); }, 5);
			keyMsInputs.push(msInput);
			advBody.appendChild(makeRow(key.zh, [
				vibSel, E('span', { 'class': 'micyou-tag' }, '长按阈值(ms)'), msInput
			]));
		});
		applyMsState();
		root.appendChild(advCard);

		/* ================= 按钮（左侧）+ 下方提示条 ================= */
		var fileInput = E('input', { 'type': 'file', 'accept': 'application/json,.json', 'style': 'display:none' });

		function collect() {
			var mainValues = {}, keyValues = {};
			Object.keys(EDITS).forEach(function(name) {
				if (name == '__server') mainValues.server = EDITS[name];
				else if (name == '__port') mainValues.port = EDITS[name];
				else if (name == '__device') mainValues.device = EDITS[name];
				else if (name == '__gain') mainValues.gain = EDITS[name];
				else if (name == '__vibrate') mainValues.vibrate = EDITS[name];
				else if (name == '__sched_connect') mainValues.sched_connect = EDITS[name];
				else if (name == '__sched_disconnect') mainValues.sched_disconnect = EDITS[name];
				else if (name == '__ms' || name == '__ms_on') { /* 下面统一处理 */ }
				else keyValues[name] = EDITS[name];
			});
			// 统一长按阈值：勾了就写 main.ms，没勾就清空（各键用自己的 <id>_ms）
			if ('__ms_on' in EDITS || '__ms' in EDITS) {
				var msOnNow = ('__ms_on' in EDITS) ? (EDITS['__ms_on'] == '1') : (main.ms != null && main.ms !== '');
				mainValues.ms = msOnNow ? String(('__ms' in EDITS) ? EDITS['__ms'] : (main.ms || '500')) : '';
			}
			return { main: mainValues, keys: keyValues };
		}

		var buttons = E('div', { 'class': 'micyou-buttons' }, [
			E('button', { 'class': 'cbi-button cbi-button-apply', 'click': function() {
				var values = collect();
				if (values.main.port && !/^\d+$/.test(values.main.port)) {
					say('控制端口必须是数字。', 'error');
					return;
				}
				var chain = callSave(values.main, values.keys).then(function(r) {
					if (!r || !r.ok) throw new Error((r && r.message) || '保存失败');
				});
				if ('__gain' in EDITS && EDITS['__gain'] !== '')
					chain = chain.then(function() { return callSetGain(+EDITS['__gain']); });
				return chain.then(function() {
					EDITS = {};
					say('已保存并应用。改过服务器地址/端口/设备后，如正在连接请点一次“断开”再“连接”。', 'ok');
				}).catch(function(err) {
					say('保存失败：' + (err && err.message ? err.message : err), 'error');
				});
			} }, '保存并应用'),
			E('button', { 'class': 'cbi-button', 'click': function() {
				location.reload();
			} }, '放弃修改并刷新'),
			E('button', { 'class': 'cbi-button cbi-button-reset', 'click': function() {
				if (!confirm('恢复默认值：清空所有按键功能与增益/震动设置（保留服务器地址）。继续？'))
					return;
				return callReset().then(function(r) {
					if (!r || !r.ok) throw new Error((r && r.message) || '重置失败');
					say('已恢复默认值，正在刷新…', 'ok');
					setTimeout(function() { location.reload(); }, 800);
				}).catch(function(err) { say('重置失败：' + (err && err.message ? err.message : err), 'error'); });
			} }, '恢复默认值'),
			E('button', { 'class': 'cbi-button', 'click': function() {
				// 导出：UCI 现值 + 当前未保存的编辑一起导出
				var exportMain = {}, exportKeys = {};
				Object.keys(main).forEach(function(k) { if (k != '.type' && k != '.name' && k != '.anonymous' && k != '.index') exportMain[k] = main[k]; });
				Object.keys(keysCfg).forEach(function(k) { if (!k.startsWith('.')) exportKeys[k] = keysCfg[k]; });
				var pending = collect();
				Object.keys(pending.main).forEach(function(k) { exportMain[k] = pending.main[k]; });
				Object.keys(pending.keys).forEach(function(k) { exportKeys[k] = pending.keys[k]; });
				var payload = { app: 'micyou', version: 1, main: exportMain, keys: exportKeys };
				var url = URL.createObjectURL(new Blob([ JSON.stringify(payload, null, 2) ], { type: 'application/json' }));
				var link = document.createElement('a');
				link.href = url;
				link.download = 'micyou-config.json';
				link.click();
				setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
				say('已导出 micyou-config.json。', 'ok');
			} }, '导出配置'),
			E('button', { 'class': 'cbi-button', 'click': function() { fileInput.click(); } }, '导入配置'),
			fileInput
		]);
		fileInput.addEventListener('change', function() {
			var file = fileInput.files && fileInput.files[0];
			if (!file) return;
			var reader = new FileReader();
			reader.onload = function() {
				var parsed;
				try { parsed = JSON.parse(String(reader.result || '')); }
				catch (e) { say('导入失败：不是有效的 JSON 配置。', 'error'); return; }
				if (!parsed || typeof parsed != 'object' || (!parsed.main && !parsed.keys)) {
					say('导入失败：配置格式不对（缺少 main/keys）。', 'error');
					return;
				}
				return callSave(parsed.main || {}, parsed.keys || {}).then(function(r) {
					if (!r || !r.ok) throw new Error((r && r.message) || '导入失败');
					say('已导入并应用，正在刷新…', 'ok');
					setTimeout(function() { location.reload(); }, 800);
				}).catch(function(err) { say('导入失败：' + (err && err.message ? err.message : err), 'error'); });
			};
			reader.readAsText(file);
			fileInput.value = '';
		});
		root.appendChild(buttons);
		root.appendChild(notice);

		return root;
	}
});