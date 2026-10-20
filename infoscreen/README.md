# infoscreen 适配（锚点替换）

MicYou 的屏幕页面、实体键处理与 `/api/micyou` 接口必须活在 **信息屏（e5-infoscreen）宿主里**
（插件做不到：插件在自己的 iframe 内，拿不到全局实体键，也加不了宿主设置分类）。
但我们**不能整文件覆盖**上游文件——信息屏会随固件更新，覆盖会把上游的新内容一起抹掉。

因此这里用**锚点替换**：只在**上游原有锚点**处插入我们的代码片段，已经打过就跳过，
锚点找不到就明确报错（说明上游结构变了、需要人工核对），绝不盲目修改。

## 打的 6 个文件（14 处插入；另有 4 条仅用于旧版升级的替换）

| 文件 | 插入什么 |
|---|---|
| `api.uc` | 头部接口注释 2 行；`micyou_keys/funcs/bindings/status` 助手；`/api/micyou` 路由 |
| `settings.uc` | 「无线麦克风」设置分类（搜索/连接/断开）；分类列表插入 `micyou` |
| `www/app.js` | 按键引擎（单击/长按/远程按键/原有功能分发器）；宿主 keydown/keyup 两处挂接；插件消息路径的 key/keyup 两处 |
| `www/sdk/e5.js` | 转发 `keyup`（新消息类型 `{e5:'keyup'}`，旧宿主忽略、不影响插件） |
| `www/mobile.js` | 锁屏按键拦截器放行“打开电源菜单”的键 |
| `www/power-menu.js` | 导出 `open()`；按键处理开头放行快捷键，黑屏分支直接 `open()` |

`help：实体键“黑屏也能用且不点亮屏幕”的关键是把挂接放在“黑屏只唤醒”之前`

## 用法

```sh
python3 apply-infoscreen-changes.py [infoscreen 目录] [--snippets 片段目录] [--check]
# 默认目录 /usr/share/e5-infoscreen；片段目录默认本脚本旁 snippets/
```

输出：`[OK] 已应用` / `[SKIP] 已打过` / `[FAIL] 锚点找不到`；有任何 FAIL 时退出码非 0。

## 维护（上游更新后）

1. 用新版上游文件在测试目录里跑一次 `apply-infoscreen-changes.py`；
2. 若有 `[FAIL]`，按提示核对锚点，必要时更新本脚本里的锚点；
3. 片段（`snippets/`）由 `make-snippets.py` 从**改好的完整文件**里按锚点区间重新抽取，
   抽取规则在同一脚本的 `SPECS` 里；改完记得用“原始文件 + 锚点替换”与我们改好的文件做
   `diff` 逐字节校验（见根目录 README 的测试说明）。