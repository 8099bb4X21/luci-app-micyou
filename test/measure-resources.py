"""采样设备资源占用（在 E5 上跑，纯标准库）：
关键进程 CPU%（10 秒窗口）与内存、系统忙碌比例、电池电流/电压。"""
import glob
import os
import time

INTERVAL = 10.0


def proc_cpu():
    out = {}
    for path in glob.glob('/proc/[0-9]*/stat'):
        try:
            raw = open(path).read()
        except OSError:
            continue
        pid = path.split('/')[2]
        rest = raw[raw.rfind(')') + 2:].split()
        try:
            comm = raw[raw.find('(') + 1:raw.rfind(')')]
            utime, stime = int(rest[11]), int(rest[12])
            rss_pages = int(rest[21])   # /proc/pid/stat 的 rss 是第 24 个字段
        except (IndexError, ValueError):
            continue
        out[pid] = (comm, utime + stime, rss_pages)
    return out


def sys_cpu():
    vals = [int(x) for x in open('/proc/stat').readline().split()[1:]]
    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
    return sum(vals), idle


def battery():
    for name in sorted(os.listdir('/sys/class/power_supply')):
        base = '/sys/class/power_supply/' + name
        try:
            current = int(open(base + '/current_now').read()) / 1000.0
        except (OSError, ValueError):
            continue
        try:
            voltage = int(open(base + '/voltage_now').read()) / 1e6
        except (OSError, ValueError):
            voltage = 0.0
        yield name, current, voltage


def main():
    t0 = proc_cpu()
    s0 = sys_cpu()
    time.sleep(INTERVAL)
    t1 = proc_cpu()
    s1 = sys_cpu()
    total = s1[0] - s0[0]
    idle = s1[1] - s0[1]
    print("系统：%.0f 秒窗口忙碌比例约 %.1f%%（%d 个 jiffies，其中 idle %d）"
          % (INTERVAL, 100.0 * (total - idle) / max(total, 1), total, idle))
    rows = []
    for pid, (comm, cpu, rss) in t1.items():
        if pid not in t0:
            continue
        delta = cpu - t0[pid][1]
        if delta <= 0:
            continue
        rows.append((delta / INTERVAL, comm, pid, rss * 4096 / 1e6))
    rows.sort(reverse=True)
    print("进程 CPU%% / 内存（前 12）：")
    for pct, comm, pid, mb in rows[:12]:
        print("  %5.1f%%  %-30s pid=%-6s %5.1f MB" % (pct, comm[:30], pid, mb))
    print("电源：")
    for name, current, voltage in battery():
        print("  %-12s 电流 %6.0f mA  电压 %.2f V" % (name, current, voltage))


if __name__ == '__main__':
    main()