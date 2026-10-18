// “原有功能”总表：信息屏自身能做的动作，任何按键都可以选用（fn:<id>）。
//
// 页面名取自 index.html 的 .page data-title 与 app.js 的 I18N：
//   0 overview 概览 / 1 signal 信号 / 2 traffic 流量 / 3 sms 短信 / 4 hotspot 热点
//   5 device 设备 / 6 adv_info 高级信息 / 7 settings 高级 / 8 apps 应用
// 按键数字 1..9 原本对应这 9 个页面（app.js keyKind → showPage(n-1)）。
//
// 用于界面里“原功能”下拉：把某个键设成“电脑热键”后，它原有的功能可以挪到别的键上。
return [
	{ id: 'page1', zh: '概览页', en: 'Overview page' },
	{ id: 'page2', zh: '信号页', en: 'Signal page' },
	{ id: 'page3', zh: '流量页', en: 'Traffic page' },
	{ id: 'page4', zh: '短信页', en: 'Messages page' },
	{ id: 'page5', zh: '热点页', en: 'Hotspot page' },
	{ id: 'page6', zh: '设备页', en: 'Device page' },
	{ id: 'page7', zh: '高级信息页', en: 'Details page' },
	{ id: 'page8', zh: '高级设置页', en: 'Settings page' },
	{ id: 'page9', zh: '应用页', en: 'Apps page' },
	{ id: 'volup', zh: '音量 +', en: 'Volume up' },
	{ id: 'voldown', zh: '音量 −', en: 'Volume down' },
	{ id: 'power', zh: '息屏（按任意键亮屏）', en: 'Blank (any key wakes)' },
	{ id: 'menu', zh: '打开应用列表', en: 'Open the app list' },
	{ id: 'ok', zh: '确认（按下聚焦控件）', en: 'Confirm (focused control)' },
	{ id: 'back', zh: '返回 / 关闭', en: 'Back / close' },
	{ id: 'up', zh: '焦点上移', en: 'Focus up' },
	{ id: 'down', zh: '焦点下移', en: 'Focus down' },
	{ id: 'left', zh: '上一页', en: 'Previous page' },
	{ id: 'right', zh: '下一页', en: 'Next page' }
];