/* ---------- micyou: the wireless microphone (discover + connect) ---------- */
// 屏幕这一页只做三件事：搜索服务器 / 连接服务器 / 断开服务器。
// 每个键的功能（单击/长按/长按阈值/震动）在网页 LuCI「服务 → 无线麦克风」里配置。

const MICYOU_CTL = '/usr/bin/micyou-ctl';

const micyou = {
	id: 'micyou', label: L('无线麦克风', 'Wireless mic'),
	items: function() {
		let c = ctx.uci();
		// micyou-ctl: 0 = connected (see the script's usage).
		// 必须重定向：uhttpd 的 ucode 处理器里子进程 stdout 就是 HTTP socket，
		// 命令输出会污染响应（这和本文件顶部 bluetoothctl 检测的写法一致）。
		let connected = ctx.run(`${MICYOU_CTL} status >/dev/null 2>&1`) == 0;
		let server = c.get('micyou', 'main', 'server') ?? '';
		let port = c.get('micyou', 'main', 'port') ?? '8554';
		let found = ctx.state_get('micyou-servers', 3600);
		let items = [
			{ id: 'state', type: 'info', label: L('连接状态', 'Connection'),
			  value: connected ? L('已连接', 'Connected') : L('未连接', 'Disconnected') },
			{ id: 'scan', type: 'action', label: L('搜索服务器', 'Find servers'), reload: true,
			  note: L('扫描同网段里在控制端口上应答 MicYou 握手的设备（约 1~3 秒）',
			          'Scan the local subnet for devices answering the MicYou handshake') }
		];
		if (found && length(found.servers ?? [])) {
			let options = [], listed = false;
			for (let s in found.servers) {
				if (s.ip == server) listed = true;
				push(options, { value: s.ip, label: `${s.ip}:${s.port}` });
			}
			// 当前地址不在搜索结果里也列出来，避免下拉里选不中现值
			if (server == '')
				unshift(options, { value: '', label: L('（未选择）', '(none)') });
			else if (!listed)
				push(options, { value: server, label: `${server}:${port}` });
			push(items, { id: 'found', type: 'choice', label: L('搜索到的服务器', 'Servers found'),
			  value: server, options, reload: true,
			  note: L(sprintf('共 %d 台；选择后写入服务器地址', length(found.servers)),
			          sprintf('Found %d; choosing one sets the server address', length(found.servers))) });
		} else if (found) {
			push(items, { id: 'found_none', type: 'info', label: L('搜索到的服务器', 'Servers found'),
			  value: L('未发现（确认 PC 端 MicYou 服务端已启动）',
			          'None found (is the PC server running?)') });
		}
		push(items, { id: 'connect', type: 'action', label: L('连接服务器', 'Connect to the server'), reload: true,
		  note: server == '' ? L('尚未设置服务器地址：先“搜索服务器”并选择',
		                         'No server yet: use Find servers and pick one')
		                     : `${server}:${port}` });
		push(items, { id: 'disconnect', type: 'action', label: L('断开服务器', 'Disconnect from the server'),
		  confirm: true, reload: true });
		return items;
	},
	set: function(id, value) {
		if (id == 'scan') {
			let r = ctx.sh_json(`${MICYOU_CTL} scan 2>/dev/null`);
			if (!r || r.error) return 'Scan failed';
			ctx.state_put('micyou-servers', r);
			return null;
		}
		if (id == 'found') {
			if (!match(`${value}`, /^\d{1,3}(\.\d{1,3}){3}$/)) return 'Invalid address';
			let c = ctx.uci();
			c.set('micyou', 'main', 'server', `${value}`);
			c.commit('micyou');
			return null;
		}
		if (id == 'connect' || id == 'disconnect') {
			// English on purpose: the screen's error table maps platform strings
			if (ctx.run(`${MICYOU_CTL} ${id} >/dev/null 2>&1`) != 0)
				return id == 'connect' ? 'Connect failed' : 'Disconnect failed';
			return null;
		}
		return 'no such setting';
	}
};

