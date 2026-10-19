'use strict';
'require view';
'require rpc';
'require ui';

// MicYou 无线麦克风 —— 三个标签页（连接设置 / 按键功能 / 高级自定义）
// 顶部吸顶工具条：保存并应用 / 放弃修改并刷新 / 恢复默认值 / 导出配置 / 导入配置
//               + 右侧连接状态与一键连接/断开；提示条紧随其下（滚动时始终可见）。
//
// 配置读写都走 micyou 后端（不直接调 ubus uci，避免 ACL “Access denied”）。
// 注意：rpc.declare 的 expect 用 {}（取整个对象）——expect:{keys:[]} 会把响应
// 解包成数组，而数组的 .keys 是 Array.prototype.keys 方法，曾因此报 “keys.forEach is not a function”。
var callStatus = rpc.declare({ object: 'micyou', method: 'status', expect: {} });
var callKeys = rpc.declare({ object: 'micyou', method: 'keys', expect: {} });
var callConfig = rpc.declare({ object: 'micyou', method: 'config', expect: {} });
var callSave = rpc.declare({ object: 'micyou', method: 'save', params: [ 'main', 'keys' ], expect: {} });
var callReset = rpc.declare({ object: 'micyou', method: 'reset', expect: {} });
var callConnect = rpc.declare({ object: 'micyou', method: 'connect', expect: {} });
var callDisconnect = rpc.declare({ object: 'micyou', method: 'disconnect', expect: {} });
var callAutostart = rpc.declare({ object: 'micyou', method: 'set_autostart', params: [ 'on' ], expect: {} });
var callGain = rpc.declare({ object: 'micyou', method: 'gain', expect: {} });

// 单击/长按可选功能：麦克风动作 + 信息屏全部“原有功能”（fn:<id>，见 funcs.uc）
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
var KEY_ROWS = [], KEY_MS = [];

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

// options: [ [value, label], ['group', 标题], ... ]
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
		KEY_ROWS = [];
		KEY_MS = [];

		var actionOptions = [ [ 'group', '麦克风' ] ].concat(MIC_ACTIONS).concat([
			[ 'group', '原有功能' ],
			[ 'original', '原功能' ]
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

		// ================= 顶部吸顶工具条 =================
		var notice = E('div', { 'class': 'micyou-notice' });
		function say(text, kind) {
			notice.textContent = text;
			notice.className = 'micyou-notice ' + (kind == 'error' ? 'is-error'
				: kind == 'blue' ? 'is-blue' : kind == 'neutral' ? 'is-neutral' : 'is-ok');
		}

		var statePill = E('span', { 'class': 'micyou-pill off' }, '未连接');
		var autostartBtn = null;
		function paintState() {
			statePill.textContent = STATUS.connected ? '已连接' : '未连接';
			statePill.className = 'micyou-pill ' + (STATUS.connected ? 'on' : 'off');
			if (autostartBtn) {
				autostartBtn.textContent = STATUS.autostart ? '已开启开机自动启动' : '已关闭开机自动启动';
				autostartBtn.className = 'cbi-button ' + (STATUS.autostart ? 'micyou-auto-on' : 'micyou-auto-off');
			}
		}

		function connectNow() {
			return callConnect().then(function(r) {
				STATUS = r;
				paintState();
				say(r.ok ? '正在连接…（约 2~3 秒后确认结果）'
					: ('连接命令失败：' + (r.message || '未知错误')), r.ok ? 'ok' : 'error');
				window.setTimeout(function() {
					callStatus().then(function(s) {
						STATUS = s;
						paintState();
						say(s.connected ? '已连接服务器。'
							: '连接未成功：请检查 PC 端 MicYou 服务端是否在运行、服务器地址/端口是否正确、以及两边网络是否互通。',
							s.connected ? 'ok' : 'error');
					}).catch(function() {});
				}, 4000);
			});
		}

		function disconnectNow() {
			return callDisconnect().then(function(r) {
				STATUS = r;
				paintState();
				say(r.ok ? '正在断开…' : ('断开失败：' + (r.message || '未知错误')), r.ok ? 'ok' : 'error');
				window.setTimeout(function() {
					callStatus().then(function(s) {
						STATUS = s;
						paintState();
						say(s.connected ? '断开可能未生效：请再点一次“断开”。' : '已断开服务器。',
							s.connected ? 'error' : 'ok');
					}).catch(function() {});
				}, 3000);
			});
		}

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
			if ('__ms_on' in EDITS || '__ms' in EDITS) {
				var on = ('__ms_on' in EDITS) ? (EDITS['__ms_on'] == '1')
					: (main.ms != null && main.ms !== '');
				mainValues.ms = on ? String(('__ms' in EDITS) ? EDITS['__ms'] : (main.ms || '500')) : '';
			}
			return { main: mainValues, keys: keyValues };
		}

		function doSave() {
			var values = collect();
			if (values.main.port && !/^\d+$/.test(values.main.port)) {
				say('控制端口必须是数字。', 'error');
				return;
			}
			return callSave(values.main, values.keys).then(function(r) {
				if (!r || !r.ok) throw new Error((r && r.message) || '保存失败');
				EDITS = {};
				say('已保存并应用。改过服务器地址/端口/设备后，如正在连接请点一次“断开”再“连接”。', 'ok');
			}).catch(function(err) {
				say('保存失败：' + (err && err.message ? err.message : err), 'error');
			});
		}

		function doReset() {
			if (!confirm('恢复默认值：连接设置回出厂默认（服务器 192.168.1.100 / 端口 8554 / 增益 4 档），所有按键不接管，清掉震动/阈值/定时。继续？'))
				return;
			return callReset().then(function(r) {
				if (!r || !r.ok) throw new Error((r && r.message) || '重置失败');
				say('已恢复默认值，正在刷新…', 'ok');
				setTimeout(function() { location.reload(); }, 800);
			}).catch(function(err) { say('重置失败：' + (err && err.message ? err.message : err), 'error'); });
		}

		function doExport() {
			var exportMain = {}, exportKeys = {};
			Object.keys(main).forEach(function(k) { if (k.charAt(0) != '.') exportMain[k] = main[k]; });
			Object.keys(keysCfg).forEach(function(k) { if (k.charAt(0) != '.') exportKeys[k] = keysCfg[k]; });
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
		}

		var fileInput = E('input', { 'type': 'file', 'accept': 'application/json,.json', 'style': 'display:none' });
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
				callSave(parsed.main || {}, parsed.keys || {}).then(function(r) {
					if (!r || !r.ok) throw new Error((r && r.message) || '导入失败');
					say('已导入并应用，正在刷新…', 'ok');
					setTimeout(function() { location.reload(); }, 800);
				}).catch(function(err) { say('导入失败：' + (err && err.message ? err.message : err), 'error'); });
			};
			reader.readAsText(file);
			fileInput.value = '';
		});

		autostartBtn = E('button', {
			'class': 'cbi-button ' + (STATUS.autostart ? 'micyou-auto-on' : 'micyou-auto-off'),
			'click': function() {
				return callAutostart(!STATUS.autostart).then(function(r) {
					STATUS = r;
					paintState();
				});
			}
		}, STATUS.autostart ? '已开启开机自动启动' : '已关闭开机自动启动');

		var bar = E('div', { 'class': 'micyou-topbar' }, [
			E('div', { 'class': 'micyou-topbar-row' }, [
				E('button', { 'class': 'cbi-button cbi-button-apply', 'click': doSave }, '保存并应用'),
				E('button', { 'class': 'cbi-button', 'click': function() { location.reload(); } }, '放弃修改并刷新'),
				E('button', { 'class': 'cbi-button micyou-danger', 'click': doReset }, '恢复默认值'),
				E('button', { 'class': 'cbi-button', 'click': doExport }, '导出配置'),
				E('button', { 'class': 'cbi-button', 'click': function() { fileInput.click(); } }, '导入配置'),
				fileInput,
				E('span', { 'class': 'micyou-spacer' }),
				statePill,
				E('button', { 'class': 'cbi-button cbi-button-apply', 'click': connectNow }, '连接'),
				E('button', { 'class': 'cbi-button cbi-button-remove', 'click': disconnectNow }, '断开')
			]),
			notice
		]);
		root.appendChild(bar);
		paintState();
		// 隐藏主题自带的底部「保存并应用 / 保存 / 复位」页脚：本页是自定义控件，
		// 那组按钮没有意义，而且与顶部工具条重复（元素可能在 render 之后才插入，补两次）。
		function hideThemeActions() {
			document.querySelectorAll('.cbi-page-actions').forEach(function(el) { el.style.display = 'none'; });
		}
		setTimeout(hideThemeActions, 0);
		setTimeout(hideThemeActions, 300);

		// ================= 标签页 =================
		var panels = {}, tabBtns = {};
		function switchTab(name) {
			[ 'conn', 'keys', 'adv' ].forEach(function(key) {
				if (panels[key]) panels[key].className = 'micyou-panel' + (key == name ? ' active' : '');
				if (tabBtns[key]) tabBtns[key].className = (key == name ? 'active' : '');
			});
			if (name == 'conn') setTimeout(alignGainRow, 30);
		}
		var tabs = E('div', { 'class': 'micyou-tabs' },
			[ [ 'conn', '连接设置' ], [ 'keys', '按键功能' ], [ 'adv', '高级自定义' ] ].map(function(def) {
				var btn = E('button', { 'type': 'button' }, def[1]);
				btn.addEventListener('click', function() { switchTab(def[0]); });
				tabBtns[def[0]] = btn;
				return btn;
			}));

		// ================= 连接设置 =================
		var connCard = E('div', { 'class': 'micyou-card' }, [ E('h3', {}, '连接设置') ]);
		var hostInput = makeInput(main.server || '', '192.168.1.100', function(v) { setEdit('__server', v); }, 14);
		var portInput = makeInput(main.port || '8554', '8554', function(v) { setEdit('__port', v); }, 5);
		var rowHost = makeRow('服务器地址 : 控制端口', [ hostInput, E('span', {}, ':'), portInput ]);
		connCard.appendChild(rowHost);

		var devInput = makeInput(main.device || 'hw:0,0', 'hw:0,0', function(v) { setEdit('__device', v); }, 12);
		var gainOpts = [ [ '', '不设置' ] ];
		for (var step = 0; step <= (GAIN.max || 7); step++)
			gainOpts.push([ String(step), step + ' 档 · ' + (step * 3) + ' dB' ]);
		var gainValue = (main.gain != null && main.gain !== '') ? String(main.gain)
			: (GAIN.step != null ? String(GAIN.step) : '');
		var gainSelect = makeSelect(gainOpts, gainValue, function(v) { setEdit('__gain', v); });
		var rowDev = makeRow('采集设备 · 采集增益', [ devInput, gainSelect ]);
		connCard.appendChild(rowDev);
		// 让“采集设备 / 采集增益”两个控件的总宽 = 上一行控件总宽，并两者平分
		function alignGainRow() {
			if (!rowHost || !rowDev) return;
			var a = rowHost.querySelector('.micyou-row-controls');
			var b = rowDev.querySelector('.micyou-row-controls');
			if (!a || !b) return;
			var total = a.getBoundingClientRect().width;
			if (!total) return;
			b.style.width = Math.round(total) + 'px';
			b.querySelectorAll('input, select').forEach(function(el) {
				el.style.flex = '1 1 0';
				el.style.width = 'auto';
				el.style.minWidth = '0';
			});
		}
		setTimeout(alignGainRow, 50);
		window.addEventListener('resize', alignGainRow);

		var schedConnect = E('input', { 'type': 'time', 'class': 'cbi-input-text', 'style': 'width:8em' });
		schedConnect.value = main.sched_connect || '';
		schedConnect.addEventListener('change', function() { setEdit('__sched_connect', schedConnect.value); });
		var schedDisconnect = E('input', { 'type': 'time', 'class': 'cbi-input-text', 'style': 'width:8em' });
		schedDisconnect.value = main.sched_disconnect || '';
		schedDisconnect.addEventListener('change', function() { setEdit('__sched_disconnect', schedDisconnect.value); });
		connCard.appendChild(makeRow('定时连接 · 定时断开', [
			schedConnect, E('span', { 'class': 'micyou-tag' }, '连接'),
			schedDisconnect, E('span', { 'class': 'micyou-tag' }, '断开'),
			E('span', { 'class': 'micyou-tag' }, '（每天到点各执行一次；留空 = 不启用）')
		]));
		connCard.appendChild(makeRow('开机自动启动', [ autostartBtn ]));
		connCard.appendChild(E('div', { 'class': 'micyou-hint' },
			'提示：连接/断开也可直接点右上角工具条里的按钮；改过地址/端口/设备后需“断开”再“连接”才生效。'));
		var connPanel = E('div', { 'class': 'micyou-panel' }, [ connCard ]);
		panels.conn = connPanel;
		root.appendChild(tabs);
		root.appendChild(connPanel);

		// ================= 按键功能 =================
		var keysCard = E('div', { 'class': 'micyou-card' }, [
			E('h3', {}, '按键功能'),
			E('div', { 'class': 'micyou-hint' }, [
				'每个键一行：选“单击/长按”做什么（可把任意“原有功能”挪到本键）；' +
				'点“＋ 电脑按键”可把它变成 PC 上的按键（PC 端需运行 ',
				E('a', { 'href': 'https://github.com/8099bb4X21/MicYou', 'target': '_blank', 'rel': 'noopener' },
					'MicYou的fork版本'),
				' 并装好 WinUHID；按住不松 = PC 上一直按着，适合对讲键）。只配置过的键才会被接管，其余保持原样。'
			])
		]);
		var filterInput = E('input', { 'class': 'cbi-input-text', 'type': 'text',
			'placeholder': '搜索按键（名称 / 原功能）', 'style': 'width:16em' });
		var onlyCfg = makeCheck(false, '只看已配置', function() { applyFilter(); });
		keysCard.appendChild(makeRow('筛选', [ filterInput, onlyCfg ]));

		function isConfigured(id) {
			return (cur(id, 'mode', 'none') == 'pckey' && (cur(id, 'chord', '') || '') !== '')
				|| cur(id, 'single', 'original') != 'original'
				|| cur(id, 'long', 'original') != 'original';
		}
		function applyFilter() {
			var q = String(filterInput.value || '').trim().toLowerCase();
			var only = onlyCfg.querySelector('input').checked;
			KEY_ROWS.forEach(function(row) {
				var hit = (!q || row.text.toLowerCase().indexOf(q) >= 0);
				var show = hit && (!only || row.isCfg());
				row.el.style.display = show ? '' : 'none';
			});
		}
		filterInput.addEventListener('input', applyFilter);

		keys.forEach(function(key) {
			var row = E('div', { 'class': 'micyou-krow' });
			var origShort = key.orig_short_zh || '';
			var nameEl = E('div', { 'class': 'micyou-kname' }, [ key.zh ]);
			if (origShort && origShort !== key.zh)
				nameEl.appendChild(E('small', { 'title': origShort }, origShort));
			var singleSel = makeSelect(actionOptions, cur(key.id, 'single', 'original'), function(v) {
				setEdit(key.id + '_single', v);
			});
			var longSel = makeSelect(actionOptions, cur(key.id, 'long', 'original'), function(v) {
				setEdit(key.id + '_long', v);
			});
			var toggle = E('button', { 'class': 'cbi-button micyou-toggle' }, '');
			var extra = E('div', { 'class': 'micyou-kextra' });
			var chord = (cur(key.id, 'chord', '') || '').split(/\s+/).filter(function(x) { return x; });
			var chordSels = [];
			function collectChord() {
				var vks = chordSels.map(function(s) { return s.value; }).filter(function(v) { return v; });
				setEdit(key.id + '_chord', vks.join(' '));
			}
			[ 0, 1, 2 ].forEach(function(index) {
				var sel = makeSelect(VK_CHOICES, chord[index] || '', function() { collectChord(); });
				chordSels.push(sel);
			});
			var autoBox = makeCheck(cur(key.id, 'autoconnect', '0') == '1', '若未连接自动连接', function(v) {
				setEdit(key.id + '_autoconnect', v ? '1' : '0');
			});
			extra.appendChild(E('span', { 'class': 'micyou-tag' }, '组合键'));
			chordSels.forEach(function(sel, i) {
				extra.appendChild(sel);
				if (i < 2) extra.appendChild(E('span', { 'class': 'micyou-tag' }, '+'));
			});
			extra.appendChild(autoBox);

			function paintPckey() {
				var on = cur(key.id, 'mode', 'none') == 'pckey';
				toggle.textContent = on ? '电脑按键 ✓' : '＋ 电脑按键';
				toggle.className = 'cbi-button micyou-toggle' + (on ? ' on' : '');
				extra.style.display = on ? '' : 'none';
				singleSel.disabled = longSel.disabled = on;
				singleSel.style.opacity = longSel.style.opacity = on ? '0.45' : '';
			}
			toggle.addEventListener('click', function() {
				var on = cur(key.id, 'mode', 'none') != 'pckey';
				setEdit(key.id + '_mode', on ? 'pckey' : 'none');
				paintPckey();
			});

			row.appendChild(nameEl);
			row.appendChild(E('span', { 'class': 'micyou-tag' }, '单击'));
			row.appendChild(singleSel);
			row.appendChild(E('span', { 'class': 'micyou-tag' }, '长按'));
			row.appendChild(longSel);
			row.appendChild(toggle);
			row.appendChild(extra);
			paintPckey();
			keysCard.appendChild(row);
			KEY_ROWS.push({
				el: row,
				text: key.zh + ' ' + (key.orig_short_zh || '') + ' ' + key.id,
				isCfg: function() { return isConfigured(key.id); }
			});
		});
		var keysPanel = E('div', { 'class': 'micyou-panel' }, [ keysCard ]);
		panels.keys = keysPanel;
		root.appendChild(keysPanel);

		// ================= 高级自定义 =================
		var advCard = E('div', { 'class': 'micyou-card' }, [
			E('h3', {}, '高级自定义'),
			E('div', { 'class': 'micyou-hint' },
				'一行一个按键：是否震动、长按判定阈值（毫秒，默认 500）。' +
				'“所有按键震动”是总开关；“统一长按阈值”勾上后，下方各键的阈值变灰、以它为准。')
		]);
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
			KEY_MS.forEach(function(input) {
				input.disabled = on;
				input.style.opacity = on ? '0.45' : '';
			});
		}
		advCard.appendChild(makeRow('', [
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
			KEY_MS.push(msInput);
			advCard.appendChild(E('div', { 'class': 'micyou-krow' }, [
				E('div', { 'class': 'micyou-kname' }, key.zh),
				vibSel,
				E('span', { 'class': 'micyou-tag' }, '长按阈值(ms)'),
				msInput
			]));
		});
		applyMsState();
		var advPanel = E('div', { 'class': 'micyou-panel' }, [ advCard ]);
		panels.adv = advPanel;
		root.appendChild(advPanel);

		switchTab('conn');
		return root;
	}
});
