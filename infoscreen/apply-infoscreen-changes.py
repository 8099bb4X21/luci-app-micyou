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