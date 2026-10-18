# luci-app-micyou

把 **E5（Rongyue E5，OpenWrt / [e5-linux](https://github.com/Enceka/e5-linux)）的内置麦克风**
经局域网推送到 **PC 上的 MicYou 服务端**，让 PC 把 E5 当麦克风用；
同时提供 **LuCI 网页界面** 与 **信息屏（e5-infoscreen）界面**，并支持：

* 用**实体键连接/断开**服务器（黑屏/锁屏下也直接生效、不点亮屏幕）；
* 每个键可配 **单击 / 长按** 动作（连接 / 断开 / 切换 / 若未连接则自动连接 /
  把任意“原有功能”挪到其它键上）；
* 把某个键变成 **PC 上的按键**（远程按键注入，按住不松 = PC 端一直按着，适合对讲键）；
* **搜索同网段的 MicYou 服务器**、**定时连接/断开**、采集增益（0–21dB）等。

---

## 适配的固件与环境

| 位置 | 要求 |
|---|---|
| **设备** | Rongyue E5（Unisoc UMS9621），跑 **OpenWrt（e5-linux 的 `openwrt/` 构建）**，包管理为 **apk** |
| 设备必需 | `python3-light`（发送端 / 扫描 / 定时都用 Python3）、**信息屏 e5-infoscreen**（提供屏幕页面与实体键宿主）、`uhttpd-mod-ucode`、LuCI |
| 实体键 | E5 键盘区（菜单 / 电话 / 确认 / 返回 / `#` / 数字 / 方向）+ GPIO（电源 / 音量 / **侧键**）；要加键只改 `micyou-sender/root/usr/share/micyou/keys.uc` |
| **PC** | MicYou 服务端：`micyou-cli serve --bind <PC 局域网IP>`（**不要用 0.0.0.0**，某些机器首次监听会超 10 秒启动超时）；虚拟声卡 **VB-CABLE**（服务端输出设备选 `CABLE Input`，应用里麦克风选 `CABLE Output`） |
| PC（远程按键） | 需要 **[MicYou 的 fork 版本](https://github.com/8099bb4X21/MicYou)**（内含 WinUHID 虚拟键盘）才能把按键真正注入 PC；**上游版本会忽略**这类消息 |

> 已实测：E5（OpenWrt 25.12.5 / aarch64）+ PC（Windows）。链路：TCP 8554 控制 / UDP 8555 音频，
> 丢包 0.00%、网络延迟 4~9ms、抖动 <2ms。

---

## 安装

### 方式 A：在 PC 上一条命令（推荐）

前提：PC 能 `ssh root@<设备IP>`；设备已装 infoscreen 与 python3。

```sh
./tools/deploy.sh 192.168.1.172        # 默认就是 192.168.1.172
./test/live-check.sh 192.168.1.172     # 自检 23 项；全绿即安装成功
```

`deploy.sh` 做四件事：装发送端包 → 装 LuCI 界面包 → **用“锚点替换”把改动打进 infoscreen 的 4 个文件**
（不覆盖整文件，见 `infoscreen/README.md`）→ 去 CR、迁移旧配置、启用/重启服务。
**已有的 `/etc/config/micyou` 不会被覆盖。**

### 方式 B：打包拷到设备、在设备终端里装

```sh
# PC 端打包
tar -czf micyou-bundle.tar.gz micyou-sender luci-app-micyou infoscreen tools test
scp micyou-bundle.tar.gz root@192.168.1.172:/tmp/

# 设备端（SSH 或串口终端里）
cd /tmp && tar -xzf micyou-bundle.tar.gz
cd /tmp && sh tools/deploy-on-device.sh
```

### 方式 C：作为 OpenWrt 包进固件

* `micyou-sender/` 与 `luci-app-micyou/` 都是**标准 OpenWrt 包**（各自的 `Makefile` + `root/`），
  放进构建树的 `package/` 后 `make menuconfig` 选中即可（产出 apk）。
* infoscreen 的 4 个文件改动**不能**做成独立包（会与 `e5-infoscreen` 包文件冲突）——
  正确做法是构建时用锚点补丁打进该包（`infoscreen/apply-infoscreen-changes.py`）。

---

## 使用

| 操作 | 方法 |
|---|---|
| 连接 / 断开 | 按已配置功能的实体键；LuCI「服务 → 无线麦克风」的「连接/断开服务器」；屏幕「设置 → 无线麦克风」；或命令行 `micyou-ctl connect\|disconnect\|toggle` |
| 搜索服务器 | 屏幕「设置 → 无线麦克风 → 搜索服务器」（扫描同网段里**应答 MicYou 握手**的设备并列出，选中即写入地址；253 个地址约 3 秒） |
| 配置按键 | LuCI「服务 → 无线麦克风 → 按键功能」：每键两行（单击/长按 + 无/自定义电脑按键），选了后者展开第三行组合键（左/右 Ctrl、Alt、Win、Enter、空格），右侧可勾「若未连接自动连接」；「高级自定义」里设震动总开关、统一长按阈值（默认 500ms） |
| 定时连接 / 断开 | LuCI「连接设置」里的两个时间框（HH:MM，留空不启用；每天各执行一次） |
| 采集增益 | LuCI 同行「采集设备 · 采集增益」：0–21dB（8 档 × 3dB，只能选有效档），连接/开机自动应用 |
| 备份 / 恢复 | 页面下方：保存并应用 / 放弃修改并刷新 / 恢复默认值 / 导出配置 / 导入配置 |
| 查看状态 | `micyou-ctl status`（退出码 0=已连接）/ `ubus call micyou status` |

**默认值**：服务器 `192.168.1.100`、端口 `8554`、增益 4 档(12dB)、**所有按键都不接管（保持原有功能）**。

---

## 目录结构

```
micyou-sender/     设备服务包：发送端 + micyou-ctl + 键表/原功能表 + rpcd 后端 + 定时服务 + UCI 默认值
luci-app-micyou/    LuCI 界面包：menu / acl / 自定义视图 / CSS
infoscreen/         信息屏适配：锚点替换器 + 代码片段（打进 e5-infoscreen 的 4 个文件）
  apply-infoscreen-changes.py   按上游锚点插入我们的代码；已打过会跳过；锚点找不到会明确报错
  make-snippets.py              从改好的文件里重新抽取片段（维护用）
  snippets/                     要插入的代码片段
tools/deploy.sh           PC 端一键部署（经 SSH）
tools/deploy-on-device.sh 设备端安装（拷到设备后跑）
test/live-check.sh        一键自检（23 项，红/绿）
test/measure-resources.py 资源占用采样（CPU%/内存/电池电流）
```

---

## 已知限制

* **PC 端 remote-key 注入需要 MicYou 的 fork 版本 + WinUHID**；上游版本只会忽略按键消息。
* infoscreen 的改动用**锚点替换**：上游若大改那 4 个文件的结构，锚点可能失效——
  安装器会明确报 FAIL（而不是改坏文件），此时需要更新 `infoscreen/snippets/` 与锚点。
* 手动用 `micyou-ctl send-key` 发按键时**务必配对 down/up**（只发 down 会让 PC 端卡键）；
  卡住时执行 `micyou-ctl release-all` 一键松开。
* CLI 模式的 MicYou 服务端只能在其终端 Ctrl+C 停止（`micyou-cli stop` 会拒绝）。

## 许可

与上游一致：GPL-3.0（含 MicYou Plugin Exception）。信息屏（e5-infoscreen）版权归其作者。