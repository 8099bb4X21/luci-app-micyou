#!/usr/bin/env python3
"""MicYou 定时连接 / 定时断开。

按 UCI 里的 main.sched_connect / main.sched_disconnect（HH:MM，空 = 不启用）自动执行
`micyou-ctl connect|disconnect`。实现是“算出下一个事件时刻后直接睡到那时”，
不是轮询——空闲时每天最多几次唤醒，CPU 占用可忽略；配置改了下一轮自动生效。
"""
import subprocess
import time

CTL = "/usr/bin/micyou-ctl"


def uci_get(option):
    try:
        result = subprocess.run(
            ["uci", "-q", "get", "micyou.main.%s" % option],
            capture_output=True, text=True, timeout=5)
        return result.stdout.strip() if result.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def parse_hhmm(text):
    try:
        hour, minute = text.split(":")
        hour, minute = int(hour), int(minute)
        if 0 <= hour < 24 and 0 <= minute < 60:
            return hour, minute
    except (ValueError, AttributeError):
        pass
    return None


def next_run(target):
    """目标时刻的下一次发生（今天已过则算明天）。"""
    now = time.localtime()
    hour, minute = target
    candidate = time.mktime((now.tm_year, now.tm_mon, now.tm_mday, hour, minute, 0, 0, 0, -1))
    if candidate <= time.time():
        candidate += 86400
    return candidate


def main():
    print("micyou-schedule: started (sched_connect / sched_disconnect)", flush=True)
    fired = {}
    while True:
        events = []
        for action, option in (("connect", "sched_connect"), ("disconnect", "sched_disconnect")):
            label = uci_get(option)
            target = parse_hhmm(label)
            if target:
                events.append((next_run(target), action, label))
        if not events:
            time.sleep(30)                      # 未启用定时：半分钟看一次配置
            continue
        events.sort()
        when, action, label = events[0]
        time.sleep(max(1, when - time.time()))
        key = "%s@%s" % (action, time.strftime("%Y-%m-%d"))
        if fired.get(key) != label:             # 同一天同一动作只做一次
            fired[key] = label
            try:
                subprocess.run([CTL, action], capture_output=True, text=True, timeout=60)
                print("micyou-schedule: %s at %s" % (action, time.strftime("%H:%M:%S")), flush=True)
            except (OSError, subprocess.SubprocessError) as exc:
                print("micyou-schedule: %s failed: %s" % (action, exc), flush=True)


if __name__ == "__main__":
    main()