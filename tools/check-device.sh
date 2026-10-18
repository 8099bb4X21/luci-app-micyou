#!/bin/sh
# 对比“设备上的文件”与“本地仓库文件”是否一致（回答“设备是不是最新版”）。
#
#   ./tools/check-device.sh <设备IP>
#
# 对每一对（本地文件 <-> 设备路径）算 md5 并比对；有差异的会列出。
set -u

HOST=${1:-}
if [ -z "$HOST" ]; then
	echo "用法: $0 <设备IP>" >&2
	exit 2
fi
HERE=$(cd "$(dirname "$0")/.." && pwd)

# 本地文件|设备路径
PAIRS='
micyou-sender/root/usr/bin/micyou_sender.py|/usr/bin/micyou_sender.py
micyou-sender/root/usr/bin/micyou-ctl|/usr/bin/micyou-ctl
micyou-sender/root/usr/bin/micyou-scan-servers.py|/usr/bin/micyou-scan-servers.py
micyou-sender/root/usr/bin/micyou-schedule.py|/usr/bin/micyou-schedule.py
micyou-sender/root/etc/init.d/micyou-sender|/etc/init.d/micyou-sender
micyou-sender/root/etc/init.d/micyou-schedule|/etc/init.d/micyou-schedule
micyou-sender/root/usr/share/micyou/keys.uc|/usr/share/micyou/keys.uc
micyou-sender/root/usr/share/micyou/funcs.uc|/usr/share/micyou/funcs.uc
micyou-sender/root/usr/share/rpcd/ucode/micyou.uc|/usr/share/rpcd/ucode/micyou.uc
luci-app-micyou/root/www/luci-static/resources/view/micyou/settings.js|/www/luci-static/resources/view/micyou/settings.js
luci-app-micyou/root/www/luci-static/resources/micyou.css|/www/luci-static/resources/micyou.css
luci-app-micyou/root/usr/share/luci/menu.d/luci-app-micyou.json|/usr/share/luci/menu.d/luci-app-micyou.json
luci-app-micyou/root/usr/share/rpcd/acl.d/luci-app-micyou.json|/usr/share/rpcd/acl.d/luci-app-micyou.json
'

same=0
diff_count=0
missing=0
echo "$PAIRS" | while IFS='|' read -r local remote; do
	[ -z "$local" ] && continue
	lmd5=$(md5sum "$HERE/$local" 2>/dev/null | cut -d' ' -f1)
	rmd5=$(ssh -n root@"$HOST" "md5sum '$remote' 2>/dev/null | cut -d' ' -f1" 2>/dev/null)
	if [ -z "$rmd5" ]; then
		echo "  [缺失] $remote（设备上没有）"
	elif [ "$lmd5" = "$rmd5" ]; then
		echo "  [一致] $remote"
	else
		echo "  [不同] $remote  （本地 $lmd5 / 设备 $rmd5）"
	fi
done

echo
echo "infoscreen 的 4 个文件请用 test/live-check.sh 的标记断言核对（它们会被上游更新，不做逐字节比较）。"
echo "有 [不同]/[缺失] 就跑一次 tools/deploy.sh，再复跑本脚本应全部 [一致]。"