#!/usr/bin/env python3
"""从我们改好的 infoscreen 文件里，按“锚点区间”抽取锚点替换用的片段。

片段 = 我们的文件里、两条上游锚点之间（或锚点边界处）的**原始字节区间**。
apply-infoscreen-changes.py 会把片段**原样**插到上游文件的锚点位置（不额外加换行），
因此结果与我们的文件逐字节一致。

用法： python3 make-snippets.py [我们的 infoscreen 目录] [输出片段目录]
"""
import pathlib
import sys

# (片段名, 文件, 起点(含), 终点(不含；None = 到文件末))
#   start=None 表示“从 anchor_start 之后开始”
SPECS = [
    # api.uc：两个助手 + 路由 + 头部注释
    ('api_helpers.uc', 'api.uc', 'BEFORE',
     '/* ---------- the wireless microphone (micyou-sender package) ---------- */',
     "// a plugin's state files live under its own name"),
    ('api_route.uc', 'api.uc', 'BEFORE', "\t\tif (path == '/micyou') {",
     "\t\tif (post && path == '/key')"),
    ('api_header.uc', 'api.uc', 'AFTER',
     '//   POST /api/key            {"key": ..., "code": ..., "keyCode": ...}  (key log)',
     '//   GET  /api/bluetooth'),
    # settings.uc：分类块 + 列表行替换
    ('settings_block.uc', 'settings.uc', 'BEFORE',
     '/* ---------- micyou: the wireless microphone (discover + connect) ---------- */',
     '// (the devices category is its own view: /api/devices)'),
    # app.js：引擎 + 三个挂接点 + 抬起监听
    ('app_engine.js', 'www/app.js', 'BEFORE',
     '// 无线麦克风（micyou）：按键 -> 功能，每个键可配“单击 / 长按”。',
     "// the keypad's back key reports KEY_BACK and BackSpace (kernel 0004) in one"),
    ('app_hook_keydown.js', 'www/app.js', 'AFTER',
     "\tif (keyLock(kind == 'power' && !e.repeat, e.key == '*')) return;", '\tif (blank) {'),
    ('app_hook_msg.js', 'www/app.js', 'AFTER',
     "\t\tif (keyLock(m.kind == 'power' && !m.repeat, m.key == '*')) return;", '\t\tif (blank) {'),
    ('app_msg_keyup.js', 'www/app.js', 'BEFORE',
     "\tcase 'keyup':", "\tcase 'exit': if (fromIme) closeInputMethod(); else closeApp(); break;"),
    ('app_keyup.js', 'www/app.js', 'AFTER',
     "\t\tif (kind && kind.startsWith('page')) showPage(+kind.slice(4) - 1);\n\t}\n}, true);",
     '// touch off, or the keys locked: every touch, tap and swipe is dropped here,'),
    # sdk/e5.js：抬起转发
    ('sdk_keyup.js', 'www/sdk/e5.js', 'AFTER',
     "\t\tif (taken) e.preventDefault();\n\t}, true);", "\twindow.addEventListener('message', (e) => {"),
    # mobile.js：锁屏按键拦截器放行“打开电源菜单”的键
    ('mobile_lock_allow.js', 'www/mobile.js', 'BEFORE',
     '        // 电源菜单快捷键：锁屏下也要能弹出（见 app.js 的 micyou 动作 power_menu）',
     "        if (['power','volup','voldown'].includes(kind)) return;"),
    # power-menu.js：黑屏时它默认吞掉除音量外的所有键，快捷键要放行给 app.js 处理
    ('power_menu_hook.js', 'www/power-menu.js', 'AFTER',
     '    function key(event) {', '        if (!root) return;'),
]


def main() -> int:
    root = pathlib.Path(__file__).resolve().parent.parent
    base = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 \
        else root / 'E5infoscreen/root/usr/share/e5-infoscreen'
    out = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else root / 'infoscreen/snippets'
    out.mkdir(parents=True, exist_ok=True)
    for name, rel, mode, start, end in SPECS:
        text = (base / rel).read_text(encoding='utf-8')
        if mode == 'BEFORE':
            i = text.find(start)
            assert i >= 0, f'{name}: 找不到起点 {start[:40]!r}'
            j = text.find(end, i)
            assert j > i, f'{name}: 找不到终点 {end[:40]!r}'
        elif mode == 'AFTER':
            # 单行锚点：插到“锚点所在行的下一行开头”（跳过锚点自己的换行）；
            # 多行锚点（如以 }, true); 结尾的监听器）：直接从锚点末尾取，保留原有空行
            i = text.find(start)
            assert i >= 0, f'{name}: 找不到起点'
            i += len(start)
            if '\n' not in start and i < len(text) and text[i] == '\n':
                i += 1
            j = text.find(end, i)
            assert j > i, f'{name}: 找不到终点'
            if '\n' in start and text[j - 1] == '\n':
                j -= 1                            # 多行锚点：末尾换行交给上游原有的空行
        elif mode == 'AFTER_LINE':
            i = text.find(start)
            assert i >= 0, f'{name}: 找不到起点'
            i = text.find('\n', i) + 1
            j = text.find(end, i)
            assert j > i, f'{name}: 找不到终点'
        else:
            raise AssertionError(mode)
        (out / name).write_text(text[i:j], encoding='utf-8', newline='\n')
        print(f'  {name}: {j - i} 字符')
    return 0


if __name__ == '__main__':
    sys.exit(main())