

	// 抬起事件：发给宿主做长按判定（新消息类型 'keyup'，旧宿主会忽略；
	// 不经过 keyFn，插件按键行为不变）
	document.addEventListener('keyup', (e) => {
		send({ e5: 'keyup', key: e.key, code: e.code, keyCode: e.keyCode });
	}, true);
