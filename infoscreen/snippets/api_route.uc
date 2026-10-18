		if (path == '/micyou') {
			// the wireless microphone: the screen's own keys and its page
			if (!post)
				return reply_json(200, micyou_status());
			let b = read_body(env);
			let action = b.action;
			if (action == 'key') {
				// 远程按键（PC 端 fork 用 WinUHID 注入）：chord = "165 32"，phase = down|up
				let chord = `${b.chord ?? ''}`;
				let phase = b.phase == 'up' ? 'up' : 'down';
				if (!match(chord, /^[0-9]{1,3}( [0-9]{1,3}){0,5}$/))
					return reply_json(400, { ok: false, error: 'Invalid chord' });
				let auto = b.autoconnect ? ' auto' : '';
				let rc = system(`${MICYOU_CTL} send-key '${chord}' ${phase}${auto} >/dev/null 2>&1`);
				return reply_json(rc == 0 ? 200 : 400,
					{ ok: rc == 0, error: rc == 0 ? null : 'Send failed', ...micyou_status() });
			}
			if (index([ 'connect', 'disconnect', 'toggle' ], action) < 0)
				return reply_json(400, { ok: false, error: 'Invalid action' });
			let rc = system(`${MICYOU_CTL} ${action} >/dev/null 2>&1`);
			return reply_json(rc == 0 ? 200 : 400,
				{ ok: rc == 0, error: rc == 0 ? null : 'Operation failed', ...micyou_status() });
		}
