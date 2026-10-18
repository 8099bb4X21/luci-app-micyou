#!/bin/sh
# MicYou 无线麦克风 · 一键部署（在 PC 上跑，经 SSH 推到设备）
#
#   ./tools/deploy.sh [设备IP]        # 默认 192.168.1.172
#
# 做四件事：
#   1) 装发送端包（micyou-sender）：发送端、micyou-ctl、键表/功能表、rpcd 后端、定时服务
#   2) 装 LuCI 界面包（luci-app-micyou）
#   3) 用“锚点替换”把改动打进 infoscreen 的 4 个文件（不覆盖整文件，参见 infoscreen/README）
#   4) 去 CR、迁移旧配置、启用/重启服务
#
# 前提：设备已装 infoscreen（e5-infoscreen）与 python3（`apk add python3-light`）；
#       旧的 /etc/config/micyou 不会被覆盖。
set -eu

HOST=${1:-192.168.1.172}
HERE=$(cd "$(dirname "$0")/.." && pwd)
SSH="ssh root@$HOST"

echo "== 0/5 连通性 =="
$SSH 'echo ok' >/dev/null

echo "== 1/5 发送端包 =="
( cd "$HERE/micyou-sender/root" && tar -czf - . ) | $SSH '
	if [ -f /etc/config/micyou ]; then cp /etc/config/micyou /tmp/micyou.config.keep; fi
	tar -xzf - -C / &&
	chmod +x /usr/bin/micyou-ctl /usr/bin/micyou_sender.py /usr/bin/micyou-schedule.py \
		/usr/bin/micyou-scan-servers.py /etc/init.d/micyou-sender /etc/init.d/micyou-schedule &&
	if [ -f /tmp/micyou.config.keep ]; then mv /tmp/micyou.config.keep /etc/config/micyou; fi &&
	echo "  ok"'

echo "== 2/5 LuCI 界面包 =="
( cd "$HERE/luci-app-micyou/root" && tar -czf - . ) | $SSH 'tar -xzf - -C / && echo "  ok"'

echo "== 3/5 infoscreen 锚点替换（不动上游其它内容）=="
( cd "$HERE/infoscreen" && tar -czf - apply-infoscreen-changes.py snippets ) | $SSH '
	rm -rf /tmp/micyou-patch; mkdir -p /tmp/micyou-patch; tar -xzf - -C /tmp/micyou-patch &&
	python3 /tmp/micyou-patch/apply-infoscreen-changes.py /usr/share/e5-infoscreen \
		--snippets /tmp/micyou-patch/snippets'

echo "== 4/5 去 CR（防 Windows 检出带 \r 破坏脚本）=="
$SSH '
	for f in /etc/init.d/micyou-sender /etc/init.d/micyou-schedule /usr/bin/micyou-ctl \
	         /usr/bin/micyou_sender.py /usr/bin/micyou-schedule.py /usr/bin/micyou-scan-servers.py; do
		[ -f "$f" ] && sed -i "s/\r$//" "$f"
	done
	for d in /usr/share/micyou /usr/share/rpcd/ucode /usr/share/e5-infoscreen /www/luci-static/resources/view/micyou; do
		[ -d "$d" ] && find "$d" -type f \( -name "*.uc" -o -name "*.js" -o -name "*.json" -o -name "*.css" \) \
			-exec sed -i "s/\r$//" {} + 2>/dev/null
	done
	echo "  ok"'

echo "== 5/5 迁移配置 + 服务 =="
$SSH '
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
	echo "  ok"'

echo
echo "完成。核对："
echo "  ./test/live-check.sh $HOST            # 一键自检（23 项）"
echo "  ssh root@$HOST micyou-ctl status"
echo "  网页 http://$HOST/ → 服务 → 无线麦克风"
echo "  屏幕 设置 → 无线麦克风"