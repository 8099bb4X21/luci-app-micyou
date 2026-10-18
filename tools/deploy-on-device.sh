#!/bin/sh
# MicYou 无线麦克风 · 设备端安装（先把仓库/bundle 拷到设备上，然后运行本脚本）
#
#   cd /tmp/micyou && sh tools/deploy-on-device.sh
#
# 与 tools/deploy.sh（PC 端经 SSH 推送）等价，只是所有操作都在设备本地完成：
#   1) 装发送端包  2) 装 LuCI 界面包  3) 锚点替换打进 infoscreen  4) 迁移配置 + 重启服务
set -eu

HERE=$(cd "$(dirname "$0")/.." && pwd)
[ -d "$HERE/micyou-sender/root" ] || { echo "找不到 $HERE/micyou-sender/root"; exit 1; }
[ -d "$HERE/luci-app-micyou/root" ] || { echo "找不到 $HERE/luci-app-micyou/root"; exit 1; }

echo "== 1/4 发送端包 =="
if [ -f /etc/config/micyou ]; then cp /etc/config/micyou /tmp/micyou.config.keep; fi
( cd "$HERE/micyou-sender/root" && tar -czf - . ) | tar -xzf - -C /
chmod +x /usr/bin/micyou-ctl /usr/bin/micyou_sender.py /usr/bin/micyou-schedule.py \
	/usr/bin/micyou-scan-servers.py /etc/init.d/micyou-sender /etc/init.d/micyou-schedule
if [ -f /tmp/micyou.config.keep ]; then mv /tmp/micyou.config.keep /etc/config/micyou; fi

echo "== 2/4 LuCI 界面包 =="
( cd "$HERE/luci-app-micyou/root" && tar -czf - . ) | tar -xzf - -C /

echo "== 3/4 infoscreen 锚点替换（不动上游其它内容）=="
if [ -d /usr/share/e5-infoscreen ]; then
	python3 "$HERE/infoscreen/apply-infoscreen-changes.py" /usr/share/e5-infoscreen \
		--snippets "$HERE/infoscreen/snippets"
else
	echo "  跳过：没找到 /usr/share/e5-infoscreen（设备未装信息屏）"
fi

echo "== 4/4 去 CR + 迁移配置 + 重启服务 =="
for f in /etc/init.d/micyou-sender /etc/init.d/micyou-schedule /usr/bin/micyou-ctl \
         /usr/bin/micyou_sender.py /usr/bin/micyou-schedule.py /usr/bin/micyou-scan-servers.py; do
	[ -f "$f" ] && sed -i "s/\r$//" "$f"
done
for d in /usr/share/micyou /usr/share/rpcd/ucode /usr/share/e5-infoscreen /www/luci-static/resources/view/micyou; do
	[ -d "$d" ] && find "$d" -type f \( -name "*.uc" -o -name "*.js" -o -name "*.json" -o -name "*.css" \) \
		-exec sed -i "s/\r$//" {} + 2>/dev/null
done

[ -f /etc/config/micyou ] || printf "config micyou %s\n\nconfig keys %s\n" "main" "keys" > /etc/config/micyou
if ! uci -q get micyou.keys >/dev/null 2>&1; then uci -q set micyou.keys=keys; fi
uci -q delete micyou.main.connect_key
uci -q delete micyou.main.disconnect_key
uci -q delete micyou.keys.altright_long
uci -q commit micyou
if pgrep -f micyou_sender.py >/dev/null 2>&1; then
	/etc/init.d/micyou-sender restart >/dev/null 2>&1 || true
fi
/etc/init.d/micyou-schedule enable >/dev/null 2>&1 || true
/etc/init.d/micyou-schedule restart >/dev/null 2>&1 || true
/etc/init.d/rpcd restart >/dev/null 2>&1 || /etc/init.d/rpcd reload >/dev/null 2>&1 || true
/etc/init.d/e5-infoscreen restart >/dev/null 2>&1 || true

echo
echo "完成。核对："
echo "  sh test/live-check.sh 127.0.0.1        # 如果要本机自检，需要本地 ssh；否则用 micyou-ctl status"
echo "  micyou-ctl status"
echo "  网页 http://<设备IP>/ → 服务 → 无线麦克风"
echo "  屏幕 设置 → 无线麦克风"