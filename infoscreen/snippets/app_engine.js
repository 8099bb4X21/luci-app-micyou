// 无线麦克风（micyou）：按键 -> 功能，每个键可配“单击 / 长按”。
// 绑定与键表来自 /api/micyou（键表是 /usr/share/micyou/keys.uc，由 micyou-sender 提供）；
// 两条按键通路都要过：宿主页面的 keydown/keyup，和插件/输入法 frame 转发来的
// {e5:'key'} / {e5:'keyup'}。规则：
//   * 只消费“确实配了动作”的键（未配置 = 完全保持原有功能）；
//   * 配了长按的键：按下先吞掉；长按阈值到 → 长按动作；提前抬起 → 单击动作；
//   * 调用点在“黑屏只唤醒”之前：黑屏/锁屏下也直接生效，且不点亮屏幕。
// 动作：connect / disconnect / toggle / connect_if_down（若未连接则自动连接）；
//       power_menu（本机弹出电源菜单，不经过发送端）。
const MICYOU_REAL = { connect: 1, disconnect: 1, toggle: 1, connect_if_down: 1, power_menu: 1 };

// 一个动作算不算“接管”：麦克风动作，或“原有功能”（fn:<id>，见 funcs.uc）
function micyouWanted(action) {
	return !!action && (MICYOU_REAL[action] || `${action}`.startsWith('fn:'));
}

let micyouBind = { connected: false, bindings: {}, keys: [] };
async function loadMicyou() {
	try {
		const r = await fetch('/api/micyou', { cache: 'no-store' });
		const d = await r.json();
		if (d && Array.isArray(d.keys) && d.bindings) micyouBind = d;
	} catch (e) { /* micyou-sender 未安装：保持空绑定 */ }
}
loadMicyou();
// 5 秒刷新一次绑定：在 LuCI 里改完（模式/动作/震动）很快就在屏幕上生效
setInterval(() => { if (!blank) loadMicyou(); }, 5000);

function micyouHit(key, e) {
	if ((key.keys || []).includes(e.key)) return true;
	if ((key.keyCodes || []).includes(e.keyCode)) return true;
	return !!(key.codes && key.codes.length && key.codes.includes(e.code));
}

// 命中且需要接管的键（否则不消费，原功能照常）：
//   * 自定义电脑按键（mode=pckey 且有 chord）：按下发 down、抬起发 up；
//   * 否则看 single/long 里有没有真实动作。
function micyouMatch(e) {
	for (const key of micyouBind.keys) {
		const bind = micyouBind.bindings[key.id];
		if (!bind) continue;
		const pckey = bind.mode == 'pckey' && !!bind.chord;
		if (!pckey && !micyouWanted(bind.single) && !micyouWanted(bind.long)) continue;
		if (micyouHit(key, e)) return { id: key.id, bind, pckey };
	}
	return null;
}

// 锁屏拦截器（mobile.js）用：这个键绑了“打开电源菜单”就放行，锁屏下也能弹菜单。
// 只放行这一个本机动作；麦克风连接键仍按锁屏策略被拦住。
window.micyouPowerKey = function (e) {
	const hit = micyouMatch(e);
	return !!hit && (hit.bind.single == 'power_menu' || hit.bind.long == 'power_menu');
};

function micyouAct(bind, action) {
	if (!micyouWanted(action)) return;
	if (bind.vib) post('vibrate', { ms: 60 });      // 黑屏下也能感知
	if (action == 'power_menu') {                   // 本机动作：弹出电源菜单
		if (window.T551MPower?.open) window.T551MPower.open();
		else toast(lang == 'en' ? 'Power menu unavailable' : '无法打开电源菜单');
		return;
	}
	if (`${action}`.startsWith('fn:')) {            // 原有功能：把某个页面/音量/返回等挪到本键
		micyouOriginal(`${action}`.slice(3));
		return;
	}
	const en = lang == 'en';
	let real = action;
	if (action == 'connect_if_down') {
		if (micyouBind.connected) { toast(en ? 'Already connected' : '已连接'); return; }
		real = 'connect';
	}
	fetch('/api/micyou', {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: real })
	}).then((r) => r.json()).then((d) => {
		if (d && typeof d.connected == 'boolean') micyouBind.connected = d.connected;
		const ok = d && d.ok;
		toast(ok
			? (real == 'connect' ? (en ? 'Connected' : '已连接服务器') : (en ? 'Disconnected' : '已断开服务器'))
			: (en ? 'Failed' : '操作失败'));
	}).catch(() => { toast(en ? 'Failed' : '操作失败'); });
}

// 执行“原有功能”（funcs.uc 的 fn:<id>）：与信息屏自己按对应键时的行为一致。
// 这样把某键改成电脑热键后，它原有的功能可以挪到别的键上。
function micyouOriginal(fn) {
	switch (fn) {
	case 'page1': case 'page2': case 'page3': case 'page4': case 'page5':
	case 'page6': case 'page7': case 'page8': case 'page9':
		showPage(+fn.slice(4) - 1);          // 页面索引 = 序号 - 1（见 app.js 的 P）
		break;
	case 'volup': volumeKey(1); break;
	case 'voldown': volumeKey(-1); break;
	case 'power': setBlank(true); break;
	case 'menu': showPage(P.apps); break;
	case 'ok':
		if (document.activeElement && document.activeElement.tagName == 'BUTTON')
			pressKey(document.activeElement);
		break;
	case 'back':
		if (page == P.sms && smsOpen != null) closeSms();
		else if (document.activeElement && document.activeElement.tagName == 'BUTTON')
			document.activeElement.blur();
		else
			showPage(P.overview);
		break;
	case 'up': moveFocus(-1); break;
	case 'down': moveFocus(1); break;
	case 'left': showPage(page - 1); break;
	case 'right': showPage(page + 1); break;
	}
}

// 自定义电脑按键：把按下/抬起经后端交给发送端（PC 端 fork 用 WinUHID 注入）。
// 按住不松 = PC 上那个键一直按着（适合对讲键）；勾了“若未连接自动连接”会先连上再发。
function micyouRawKey(bind, phase) {
	if (bind.vib && phase == 'down') post('vibrate', { ms: 60 });
	const en = lang == 'en';
	fetch('/api/micyou', {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'key', chord: bind.chord, phase, autoconnect: !!bind.autoconnect })
	}).then((r) => r.json()).then((d) => {
		if (d && typeof d.connected == 'boolean') micyouBind.connected = d.connected;
		if (phase == 'down' && (!d || !d.ok)) toast(en ? 'Send failed' : '发送按键失败');
	}).catch(() => { if (phase == 'down') toast(en ? 'Send failed' : '发送按键失败'); });
}

let micyouHold = null;    // { id, timer, fired }：普通动作的长按状态机
let micyouHeld = null;    // { id, bind }：自定义电脑按键已发 down、等抬起发 up
function micyouKeyDown(e) {
	const hit = micyouMatch(e);
	if (!hit) return false;
	if (e.repeat) return true;                       // 重复事件：吞掉（按下/长按只算一次）
	if (hit.pckey) {
		micyouRawKey(hit.bind, 'down');
		micyouHeld = { id: hit.id, bind: hit.bind };
		return true;
	}
	if (micyouHold) { clearTimeout(micyouHold.timer); micyouHold = null; }
	if (MICYOU_REAL[hit.bind.long]) {
		micyouHold = { id: hit.id, fired: false };
		micyouHold.timer = setTimeout(() => {
			if (!micyouHold) return;
			micyouHold.fired = true;
			micyouAct(hit.bind, hit.bind.long);
		}, Math.min(Math.max(+hit.bind.ms || 500, 150), 10000));
		return true;
	}
	micyouAct(hit.bind, hit.bind.single);
	return true;
}

function micyouKeyUp(e) {
	// 自定义电脑按键：抬起必发 up（用按下时的 chord，避免期间改配置导致 PC 端“卡键”）
	if (micyouHeld) {
		const key = micyouBind.keys.find((x) => x.id == micyouHeld.id);
		if (key && micyouHit(key, e)) {
			micyouRawKey(micyouHeld.bind, 'up');
			micyouHeld = null;
			return true;
		}
	}
	if (!micyouHold) return false;
	const hit = micyouMatch(e);
	if (!hit || hit.id != micyouHold.id) return false;
	clearTimeout(micyouHold.timer);
	const hold = micyouHold;
	micyouHold = null;
	if (!hold.fired) micyouAct(hit.bind, hit.bind.single);   // 没到阈值 = 单击
	return true;
}

