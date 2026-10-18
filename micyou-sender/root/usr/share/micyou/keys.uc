// MicYou 无线麦克风：实体键 -> 浏览器键事件的**唯一权威键表**（含"原有功能"说明）。
//
// 数据来源（全部来自源码，2026-10-18 逐条核对）：
//   * Kano-E5/tools/key-watch.py                       设备侧 evdev 键名与键码
//   * E5infoscreen/root/usr/share/e5-infoscreen/xkb/symbols/e5
//                                                      E5 实体键在 WPE 会话里的映射
//   * E5infoscreen/root/usr/share/e5-infoscreen/www/app.js  keyKind()
//                                                      网页实际收到的 key / keyCode
//   * E5 实机 /proc/bus/input/devices                   gpio-keys / sprd-keypad 能力位
//
// 字段：
//   id         稳定标识（UCI 里存 <id>_single / <id>_long / <id>_ms / <id>_vib）
//   zh / en    显示名
//   code       evdev 键码（核对、文档用）
//   keys       KeyboardEvent.key 匹配集合
//   keyCodes   KeyboardEvent.keyCode 匹配集合
//   codes      KeyboardEvent.code 匹配集合（区分左右修饰键时用，如右 Alt）
//   orig_zh/en **原有功能**（不改配置时这个键本来干什么，界面照此显示）
//
// 顺序即界面顺序：数字键/星/井/侧键/音量键 在前（用户常改的），其余在后。
// 以后加键盘按键：在本表加一条即可——界面选择项、按键匹配全部由本表驱动。
//
// 注意：数字键与 # 的 keyCode 存在历史歧义（'#' 上报 51，与主键盘 '3' 相同），
// 因此这些条目只用 key 名匹配，keyCodes 留空。
return [
	{ id: 'digit1', zh: '数字键 1', en: 'Digit 1', code: 2,
	  keys: ['1'], keyCodes: [], codes: [],
	  orig_zh: '打开「概览」页', orig_en: 'Open the 概览 page',
	  orig_short_zh: '概览', orig_short_en: 'Overview' },
	{ id: 'digit2', zh: '数字键 2', en: 'Digit 2', code: 3,
	  keys: ['2'], keyCodes: [], codes: [],
	  orig_zh: '打开「信号」页', orig_en: 'Open the 信号 page',
	  orig_short_zh: '信号', orig_short_en: 'Signal' },
	{ id: 'digit3', zh: '数字键 3', en: 'Digit 3', code: 4,
	  keys: ['3'], keyCodes: [], codes: [],
	  orig_zh: '打开「流量」页', orig_en: 'Open the 流量 page',
	  orig_short_zh: '流量', orig_short_en: 'Traffic' },
	{ id: 'digit4', zh: '数字键 4', en: 'Digit 4', code: 5,
	  keys: ['4'], keyCodes: [], codes: [],
	  orig_zh: '打开「短信」页', orig_en: 'Open the 短信 page',
	  orig_short_zh: '短信', orig_short_en: 'Messages' },
	{ id: 'digit5', zh: '数字键 5', en: 'Digit 5', code: 6,
	  keys: ['5'], keyCodes: [], codes: [],
	  orig_zh: '打开「热点」页', orig_en: 'Open the 热点 page',
	  orig_short_zh: '热点', orig_short_en: 'Hotspot' },
	{ id: 'digit6', zh: '数字键 6', en: 'Digit 6', code: 7,
	  keys: ['6'], keyCodes: [], codes: [],
	  orig_zh: '打开「设备」页', orig_en: 'Open the 设备 page',
	  orig_short_zh: '设备', orig_short_en: 'Device' },
	{ id: 'digit7', zh: '数字键 7', en: 'Digit 7', code: 8,
	  keys: ['7'], keyCodes: [], codes: [],
	  orig_zh: '打开「高级信息」页', orig_en: 'Open the 高级信息 page',
	  orig_short_zh: '高级信息', orig_short_en: 'Details' },
	{ id: 'digit8', zh: '数字键 8', en: 'Digit 8', code: 9,
	  keys: ['8'], keyCodes: [], codes: [],
	  orig_zh: '打开「高级设置」页', orig_en: 'Open the 高级设置 page',
	  orig_short_zh: '高级设置', orig_short_en: 'Settings' },
	{ id: 'digit9', zh: '数字键 9', en: 'Digit 9', code: 10,
	  keys: ['9'], keyCodes: [], codes: [],
	  orig_zh: '打开「应用」页', orig_en: 'Open the 应用 page',
	  orig_short_zh: '应用', orig_short_en: 'Apps' },
	{ id: 'digit0', zh: '数字键 0', en: 'Digit 0', code: 11,
	  keys: ['0'], keyCodes: [], codes: [],
	  orig_zh: '无', orig_en: 'None',
	  orig_short_zh: '无', orig_short_en: 'None' },
	{ id: 'star', zh: '* 键', en: '*', code: 55,
	  keys: ['*'], keyCodes: [], codes: [],
	  orig_zh: '与电源键组合（2 秒内）锁定/解锁按键', orig_en: 'With Power within 2 s: lock/unlock the keys',
	  orig_short_zh: '锁按键（*+电源）', orig_short_en: 'Lock keys (*+Power)' },
	{ id: 'pound', zh: '# 键', en: '#', code: 523,
	  keys: ['#'], keyCodes: [], codes: [],
	  orig_zh: '无（仅供插件/拨号等使用）', orig_en: 'None (plugins/dialers only)',
	  orig_short_zh: '无', orig_short_en: 'None' },
	{ id: 'side', zh: '侧键（F1/热点）', en: 'Side key (F1)', code: 59,
	  keys: ['F1'], keyCodes: [112], codes: [],
	  orig_zh: '打开“热点”页', orig_en: 'Open the Hotspot page',
	  orig_short_zh: '打开热点页', orig_short_en: 'Hotspot page' },
	{ id: 'volup', zh: '音量 +', en: 'Volume up', code: 115,
	  keys: ['AudioVolumeUp'], keyCodes: [175], codes: [],
	  orig_zh: '音量调大（黑屏也可用）', orig_en: 'Volume up (works with the screen dark)',
	  orig_short_zh: '音量 +', orig_short_en: 'Volume up' },
	{ id: 'voldown', zh: '音量 −', en: 'Volume down', code: 114,
	  keys: ['AudioVolumeDown'], keyCodes: [174], codes: [],
	  orig_zh: '音量调小（黑屏也可用）', orig_en: 'Volume down (works with the screen dark)',
	  orig_short_zh: '音量 −', orig_short_en: 'Volume down' },
	{ id: 'menu', zh: '菜单键', en: 'Menu', code: 139,
	  keys: ['ContextMenu', 'Menu'], keyCodes: [93], codes: [],
	  orig_zh: '打开应用列表', orig_en: 'Open the app list',
	  orig_short_zh: '打开应用列表', orig_short_en: 'App list' },
	{ id: 'phone', zh: '电话键', en: 'Call', code: 169,
	  keys: ['F13', 'Phone', 'PickupPhone', 'Call'], keyCodes: [124], codes: [],
	  orig_zh: '无（电话键由电话应用自己处理）', orig_en: 'None (handled inside the phone app)',
	  orig_short_zh: '无（电话应用内）', orig_short_en: 'None (inside the phone app)' },
	{ id: 'ok', zh: '确认键', en: 'Confirm', code: 353,
	  keys: ['Enter', 'Select', 'Accept'], keyCodes: [13], codes: [],
	  orig_zh: '确认（按下当前聚焦的控件）', orig_en: 'Confirm (press the focused control)',
	  orig_short_zh: '确认', orig_short_en: 'Confirm' },
	{ id: 'back', zh: '返回键', en: 'Back', code: 158,
	  keys: ['BrowserBack', 'GoBack', 'Backspace', 'Escape'], keyCodes: [8, 27, 166], codes: [],
	  orig_zh: '返回 / 关闭', orig_en: 'Back / close',
	  orig_short_zh: '返回 / 关闭', orig_short_en: 'Back / close' },
	{ id: 'up', zh: '方向键 上', en: 'Up', code: 103,
	  keys: ['ArrowUp'], keyCodes: [38], codes: [],
	  orig_zh: '焦点上移（到头滚动页面）', orig_en: 'Move focus up (scroll past the end)',
	  orig_short_zh: '焦点上移', orig_short_en: 'Focus up' },
	{ id: 'down', zh: '方向键 下', en: 'Down', code: 108,
	  keys: ['ArrowDown'], keyCodes: [40], codes: [],
	  orig_zh: '焦点下移（到头滚动页面）', orig_en: 'Move focus down (scroll past the end)',
	  orig_short_zh: '焦点下移', orig_short_en: 'Focus down' },
	{ id: 'left', zh: '方向键 左', en: 'Left', code: 105,
	  keys: ['ArrowLeft'], keyCodes: [37], codes: [],
	  orig_zh: '上一页', orig_en: 'Previous page',
	  orig_short_zh: '上一页', orig_short_en: 'Prev page' },
	{ id: 'right', zh: '方向键 右', en: 'Right', code: 106,
	  keys: ['ArrowRight'], keyCodes: [39], codes: [],
	  orig_zh: '下一页', orig_en: 'Next page',
	  orig_short_zh: '下一页', orig_short_en: 'Next page' },
	{ id: 'power', zh: '电源键', en: 'Power', code: 116,
	  keys: ['Power', 'PowerOff', 'Standby', 'Sleep'], keyCodes: [409], codes: [],
	  orig_zh: '息屏/亮屏（长按 1.2 秒开电源菜单）', orig_en: 'Blank/wake (hold 1.2 s: power menu)',
	  orig_short_zh: '息屏 / 亮屏', orig_short_en: 'Blank / wake' },
	{ id: 'next', zh: '下一个键（其他机型）', en: 'Next (other models)', code: 407,
	  keys: ['Next', 'BrowserForward', 'GoForward'], keyCodes: [], codes: [],
	  orig_zh: '无（E5 机身无此键）', orig_en: 'None (not on the E5)',
	  orig_short_zh: '无（其他机型）', orig_short_en: 'None (other models)' },
	{ id: 'pickup', zh: '接听键（其他机型）', en: 'Pick up (other models)', code: 445,
	  keys: ['PickupPhone'], keyCodes: [], codes: [],
	  orig_zh: '无（E5 机身无此键）', orig_en: 'None (not on the E5)',
	  orig_short_zh: '无（其他机型）', orig_short_en: 'None (other models)' },
	{ id: 'hangup', zh: '挂断键（其他机型）', en: 'Hang up (other models)', code: 446,
	  keys: ['HangupPhone'], keyCodes: [], codes: [],
	  orig_zh: '无（E5 机身无此键）', orig_en: 'None (not on the E5)',
	  orig_short_zh: '无（其他机型）', orig_short_en: 'None (other models)' }
];