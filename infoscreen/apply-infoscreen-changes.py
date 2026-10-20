#!/usr/bin/env python3
"""按“锚点替换”把 MicYou 的改动打进 infoscreen 的 4 个文件。

为什么不用“整文件覆盖”：infoscreen 会随固件更新，覆盖会把上游的新内容一起抹掉。
这里只在**上游原有锚点**处插入我们的代码片段（片段 = 我们文件里锚点之间的原始区间，
原样插入、不额外加换行），因此结果与我们的文件逐字节一致；已经打过（有标记）就跳过；
锚点找不到会明确报错（说明上游结构变了，需要人工核对），绝不盲目修改。

用法：
    python3 apply-infoscreen-changes.py [infoscreen 目录] [--snippets 片段目录] [--check]
    # 默认目录 /usr/share/e5-infoscreen；片段目录 = 本脚本旁边的 snippets/
"""
import argparse
import pathlib
import sys

TAB = '\t'
# 片段 = 从上游文件里、锚点处插入的原文（见 make-snippets.py 的抽取范围）
RULES = [
    # 文件, 模式(before/after/replace), 上游锚点, 片段文件或替换文本, 幂等标记
    ('api.uc', 'before', "// a plugin's state files live under its own name",
     'api_helpers.uc', 'MICYOU_CTL = '),
    ('api.uc', 'before', TAB + TAB + "if (post && path == '/key')",
     'api_route.uc', "path == '/micyou'"),
    ('api.uc', 'after',
     '//   POST /api/key            {"key": ..., "code": ..., "keyCode": ...}  (key log)',
     'api_header.uc', 'GET  /api/micyou'),
    ('settings.uc', 'before', '// (the devices category is its own view: /api/devices)',
     'settings_block.uc', "id: 'micyou', label:"),
    ('settings.uc', 'replace', 'return [ network, {',
     'return [ micyou, network, {', 'return [ micyou, network, {'),
    ('www/app.js', 'before',
     "// the keypad's back key reports KEY_BACK and BackSpace (kernel 0004) in one",
     'app_engine.js', 'function micyouKeyDown('),
    ('www/app.js', 'after',
     TAB + "if (keyLock(kind == 'power' && !e.repeat, e.key == '*')) return;",
     'app_hook_keydown.js', 'if (micyouKeyDown(e)) return;'),
    ('www/app.js', 'after',
     TAB + TAB + "if (keyLock(m.kind == 'power' && !m.repeat, m.key == '*')) return;",
     'app_hook_msg.js', 'if (micyouKeyDown(m)) return;'),
    ('www/app.js', 'before',
     TAB + "case 'exit': if (fromIme) closeInputMethod(); else closeApp(); break;",
     'app_msg_keyup.js', "case 'keyup':"),
    ('www/app.js', 'after',
     TAB + TAB + "if (kind && kind.startsWith('page')) showPage(+kind.slice(4) - 1);\n"
     + TAB + "}\n}, true);",
     'app_keyup.js', "document.addEventListener('keyup',"),
    ('www/sdk/e5.js', 'after',
     TAB + TAB + "if (taken) e.preventDefault();\n" + TAB + "}, true);",
     'sdk_keyup.js', "e5: 'keyup'"),
    # 锁屏拦截器放行“打开电源菜单”的键（该键由 app.js 的 micyou 动作打开菜单）
    ('www/mobile.js', 'before',
     '        ' + "if (['power','volup','voldown'].includes(kind)) return;",
     'mobile_lock_allow.js', 'micyouPowerKey'),
    # 导出 open()，供 micyou 的 power_menu 动作调用（否则只能在外部模拟长按）
    ('www/power-menu.js', 'replace',
     '    return {boot, attach, isOpen, close};',
     '    // open 也导出：按键功能页的“打开电源菜单”动作（app.js 的 micyou 引擎）要调它\n'
     + '    return {boot, attach, isOpen, close, open};',
     'isOpen, close, open}'),
    # 黑屏时 power-menu.js 会吞掉除音量外的所有键，快捷键要放行给 app.js 的 micyou 动作
    ('www/power-menu.js', 'after',
     '    function key(event) {',
     'power_menu_hook.js', 'micyouPowerKey?.(event)'),
    # 升级规则：设备上已有“单行放行”版本时，换成“黑屏直接 open()”的版本
    ('www/power-menu.js', 'replace',
     '        if (window.micyouPowerKey?.(event)) return;   // 电源菜单快捷键：交给 app.js 的 micyou 动作',
     '        // 电源菜单快捷键：黑屏时新版 app.js 会吞掉除电源键外的所有键，这里直接开菜单；\n'
     + '        // 其余状态交给 app.js 的 micyou 动作处理（保留“单击/长按”配置）\n'
     + '        if (window.micyouPowerKey?.(event)) {\n'
     + '            if (!blank) return;\n'
     + '            event.preventDefault(); event.stopImmediatePropagation();\n'
     + "            if (event.type === 'keydown' && !event.repeat) open();\n"
     + '            return;\n'
     + '        }',
     'if (!blank) return;'),
    # ---- 升级规则：设备上已有“旧版引擎片段”时（上面那条会因标记跳过），把新增内容补进去。
    #      全新安装时上面那条已插入新版引擎，标记存在 → 这两条自动跳过。
    #      用途：加入 power_menu 动作时不要求重装/重刷。
    ('www/app.js', 'replace',
     '// 动作：connect / disconnect / toggle / connect_if_down（若未连接则自动连接）。\n'
     + 'const MICYOU_REAL = { connect: 1, disconnect: 1, toggle: 1, connect_if_down: 1 };',
     '// 动作：connect / disconnect / toggle / connect_if_down（若未连接则自动连接）；\n'
     + '//       power_menu（本机弹出电源菜单，不经过发送端）。\n'
     + 'const MICYOU_REAL = { connect: 1, disconnect: 1, toggle: 1, connect_if_down: 1, power_menu: 1 };',
     'power_menu: 1'),
    ('www/app.js', 'replace',
     'function micyouAct(bind, action) {\n'
     + TAB + 'if (!micyouWanted(action)) return;\n'
     + TAB + "if (bind.vib) post('vibrate', { ms: 60 });      // 黑屏下也能感知\n"
     + TAB + "if (`${action}`.startsWith('fn:')) {            // 原有功能：把某个页面/音量/返回等挪到本键",
     '// 锁屏拦截器（mobile.js）用：这个键绑了“打开电源菜单”就放行，锁屏下也能弹菜单。\n'
     + '// 只放行这一个本机动作；麦克风连接键仍按锁屏策略被拦住。\n'
     + 'window.micyouPowerKey = function (e) {\n'
     + TAB + 'const hit = micyouMatch(e);\n'
     + TAB + "return !!hit && (hit.bind.single == 'power_menu' || hit.bind.long == 'power_menu');\n"
     + '};\n\n'
     + 'function micyouAct(bind, action) {\n'
     + TAB + 'if (!micyouWanted(action)) return;\n'
     + TAB + "if (bind.vib) post('vibrate', { ms: 60 });      // 黑屏下也能感知\n"
     + TAB + "if (action == 'power_menu') {                   // 本机动作：弹出电源菜单\n"
     + TAB + TAB + 'if (window.T551MPower?.open) window.T551MPower.open();\n'
     + TAB + TAB + "else toast(lang == 'en' ? 'Power menu unavailable' : '无法打开电源菜单');\n"
     + TAB + TAB + 'return;\n'
     + TAB + '}\n'
     + TAB + "if (`${action}`.startsWith('fn:')) {            // 原有功能：把某个页面/音量/返回等挪到本键",
     'window.micyouPowerKey'),
    # 升级规则：屏幕端 /api/micyou 也要过滤 custom:false（旧版 api_helpers 已打时补上）
    ('api.uc', 'replace',
     'function micyou_keys() {\n'
     + TAB + 'let f = loadfile(MICYOU_KEYS, { raw_mode: true });\n'
     + TAB + 'return f ? f() : [];\n'
     + '}',
     'function micyou_keys() {\n'
     + TAB + 'let f = loadfile(MICYOU_KEYS, { raw_mode: true });\n'
     + TAB + 'let keys = f ? f() : [];\n'
     + TAB + '// custom:false = 只作档案保留（电话键/电源键/其他机型专属键）：不显示、不参与匹配\n'
     + TAB + 'return filter(keys, k => k.custom !== false);\n'
     + '}',
     'k.custom !== false'),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', nargs='?', default='/usr/share/e5-infoscreen')
    parser.add_argument('--snippets', default=str(pathlib.Path(__file__).resolve().parent / 'snippets'))
    parser.add_argument('--check', action='store_true', help='只检查、不写文件')
    args = parser.parse_args()

    base = pathlib.Path(args.directory)
    snippets = pathlib.Path(args.snippets)
    if not base.is_dir():
        print('目录不存在: %s' % base)
        return 2

    applied = skipped = failed = 0
    for rel, mode, anchor, payload, marker in RULES:
        path = base / rel
        if not path.is_file():
            print('[FAIL] %s: 文件不存在' % rel)
            failed += 1
            continue
        text = path.read_text(encoding='utf-8')
        if marker in text:
            print('[SKIP] %s: 已含标记 %r（已打过）' % (rel, marker))
            skipped += 1
            continue
        if anchor not in text:
            print('[FAIL] %s: 找不到锚点 %r —— 上游结构可能变了，请人工核对'
                  % (rel, anchor.splitlines()[0][:60]))
            failed += 1
            continue
        if mode == 'replace':
            new_text = text.replace(anchor, payload, 1)
        else:
            snippet = snippets / payload
            if not snippet.is_file():
                print('[FAIL] %s: 缺少片段文件 %s' % (rel, snippet))
                failed += 1
                continue
            body = snippet.read_text(encoding='utf-8')
            position = text.index(anchor)
            if mode == 'before':
                new_text = text[:position] + body + text[position:]
            else:
                end = position + len(anchor)
                if '\n' not in anchor and end < len(text) and text[end] == '\n':
                    end += 1                      # 单行锚点：插到下一行开头
                new_text = text[:end] + body + text[end:]
        if args.check:
            print('[OK-CHECK] %s: 可插入（%s）' % (rel, mode))
        else:
            path.write_text(new_text, encoding='utf-8', newline='\n')
            print('[OK] %s: 已应用（%s）' % (rel, mode))
        applied += 1

    print('\n完成：应用 %d，跳过（已打过）%d，失败 %d' % (applied, skipped, failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())