#!/bin/sh
# MicYou 一键实机自检：语法 / 接口 / 行为 / 服务（在 PC 上跑，经 ssh 到设备）。
#
#   ./test/live-check.sh [HOST]        # 默认 192.168.1.172
#
# 退出码 0 = 全绿；非 0 = 有红项（红项会打印期望与实际）。任何改动后先跑这个。
set -u

HOST=${1:-192.168.1.172}
S="ssh root@$HOST"
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  [OK]   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }
# run <名字> <ssh 命令> <期望包含的标记>
run() {
	out=$($S "$2" 2>&1)
	if echo "$out" | grep -q "$3"; then ok "$1"; else no "$1（期望含 $3，实得：$(echo "$out" | head -2 | tr '\n' ' ')）"; fi
}

echo "== 1. 脚本语法（设备上）=="
run "sh 脚本" 'sh -n /usr/bin/micyou-ctl && sh -n /etc/init.d/micyou-sender && sh -n /etc/init.d/micyou-schedule && echo SHELL_OK' SHELL_OK
run "python 脚本" 'python3 -c "import ast;[ast.parse(open(p).read()) for p in (\"/usr/bin/micyou_sender.py\",\"/usr/bin/micyou-schedule.py\",\"/usr/bin/micyou-scan-servers.py\")];print(\"PY_OK\")"' PY_OK
run "ucode 脚本" 'for f in /usr/share/micyou/keys.uc /usr/share/micyou/funcs.uc /usr/share/rpcd/ucode/micyou.uc /usr/share/e5-infoscreen/settings.uc; do ucode -e "loadfile(\"$f\",{raw_mode:true});1" || exit 1; done; echo UC_OK' UC_OK

echo "== 2. 部署文件的关键标记 =="
run "api.uc 路由" 'grep -q "path == ./micyou" /usr/share/e5-infoscreen/api.uc && grep -q "micyou_funcs" /usr/share/e5-infoscreen/api.uc && echo A' A
run "app.js 引擎" 'grep -q "function micyouKeyDown" /usr/share/e5-infoscreen/www/app.js && grep -q "if (micyouKeyDown(e)) return;" /usr/share/e5-infoscreen/www/app.js && grep -q "if (micyouKeyDown(m)) return;" /usr/share/e5-infoscreen/www/app.js && grep -q "case .keyup.:" /usr/share/e5-infoscreen/www/app.js && grep -q "document.addEventListener(.keyup." /usr/share/e5-infoscreen/www/app.js && grep -q micyouRawKey /usr/share/e5-infoscreen/www/app.js && grep -q micyouOriginal /usr/share/e5-infoscreen/www/app.js && echo A' A
run "sdk keyup 转发" 'grep -q "e5: .keyup." /usr/share/e5-infoscreen/www/sdk/e5.js && echo A' A
run "LuCI 视图" 'grep -q keysOf /www/luci-static/resources/view/micyou/settings.js && grep -q callReset /www/luci-static/resources/view/micyou/settings.js && grep -q callSave /www/luci-static/resources/view/micyou/settings.js && grep -q "sched_connect" /www/luci-static/resources/view/micyou/settings.js && grep -q "统一长按阈值" /www/luci-static/resources/view/micyou/settings.js && echo A' A
run "LuCI CSS" 'grep -q micyou-buttons /www/luci-static/resources/micyou.css && grep -q micyou-notice /www/luci-static/resources/micyou.css && echo A' A
run "键表 27 条" 'ucode -e "print(length(loadfile(\"/usr/share/micyou/keys.uc\",{raw_mode:true})()))"' 27
run "原功能表 19 条" 'ucode -e "print(length(loadfile(\"/usr/share/micyou/funcs.uc\",{raw_mode:true})()))"' 19

echo "== 3. ubus 接口 =="
run "方法齐全" 'for m in status keys config save reset gain set_gain scan connect disconnect set_autostart; do ubus -v list micyou | grep -q "\"$m\"" || { echo "missing $m"; exit 1; }; done; echo METHODS_OK' METHODS_OK
run "status 形状" 'ubus call micyou status | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert isinstance(d[\"connected\"],bool) and \"server\" in d and \"bindings\" in d
assert len(d[\"bindings\"])==27
assert set(d[\"bindings\"][\"digit1\"])=={\"single\",\"long\",\"mode\",\"chord\",\"autoconnect\",\"ms\",\"vib\"}
print(\"STATUS_OK\")"' STATUS_OK
run "keys 形状" 'ubus call micyou keys | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert len(d[\"keys\"])==27 and len(d[\"funcs\"])==19
assert d[\"funcs\"][0][\"id\"]==\"page1\" and d[\"keys\"][0][\"id\"]==\"digit1\"
assert all(\"orig_short_zh\" in k for k in d[\"keys\"])
print(\"KEYS_OK\")"' KEYS_OK
run "config 形状" 'ubus call micyou config | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert \"main\" in d and \"keys\" in d
print(\"CONFIG_OK\")"' CONFIG_OK
run "增益读取" 'micyou-ctl gain | grep -qE "^[0-7]$" && echo A' A

echo "== 4. 屏幕接口 =="
run "/api/micyou" 'wget -qO- http://127.0.0.1:8088/api/micyou | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert len(d[\"keys\"])==27 and len(d[\"funcs\"])==19 and len(d[\"bindings\"])==27
print(\"A\")"' A
run "/api/settings 列表含 micyou" 'wget -qO- http://127.0.0.1:8088/api/settings | python3 -c "
import json,sys
d=json.load(sys.stdin)
ids=[c[\"id\"] for c in d[\"categories\"]]
assert ids[0]==\"micyou\", ids[:3]
print(\"A\")"' A
run "/api/settings/micyou 只留三项" 'wget -qO- http://127.0.0.1:8088/api/settings/micyou | python3 -c "
import json,sys
d=json.load(sys.stdin)
ids=[i[\"id\"] for i in d[\"items\"]]
assert \"scan\" in ids and \"connect\" in ids and \"disconnect\" in ids, ids
assert \"connect_key\" not in ids and \"autostart\" not in ids, ids
print(\"A\")"' A

echo "== 5. 行为 =="
run "发送端状态可读" 'micyou-ctl status >/dev/null 2>&1; code=$?; [ $code -eq 0 ] || [ $code -eq 1 ] && echo A' A
run "远程按键发送（需已连接）" 'micyou-ctl send-key "162" down >/dev/null 2>&1; sleep 0.3; micyou-ctl send-key "162" up >/dev/null 2>&1; sleep 1; logread | grep -q "远程按键" && echo A' A
run "队列防重放代码在" 'grep -q "跳过旧内容" /usr/bin/micyou_sender.py && echo A' A
run "定时服务在跑" 'pgrep -f micyou-schedule.py >/dev/null && echo A' A
run "定时服务已启用" 'ls /etc/rc.d/S*micyou-schedule >/dev/null 2>&1 && echo A' A

echo
echo "== 结果：通过 $PASS 项，失败 $FAIL 项 =="
[ "$FAIL" -eq 0 ] || exit 1
exit 0