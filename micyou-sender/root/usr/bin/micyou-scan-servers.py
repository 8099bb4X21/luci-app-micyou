#!/usr/bin/env python3
"""扫描同一网段里在 TCP 8554 上应答 MicYou 握手的设备（即 MicYou 服务端）。

判定方式与发送端一致：连上端口后发 12 字节 "MicYouCheck1"，
收到 12 字节 "MicYouCheck2" 才算（避免把恰好占用 8554 的其它服务混进来）。

输出 JSON（stdout）：
  { "servers": [ { "ip": "192.168.1.100", "port": 8554 } ], "local_ip": "...",
    "subnet": "192.168.1.0/24", "scanned": 254, "elapsed": 1.8 }

用法：micyou-scan-servers.py [port]      （默认 8554）
"""
import json
import re
import socket
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

HANDSHAKE_CLIENT = b"MicYouCheck1"
HANDSHAKE_SERVER = b"MicYouCheck2"
CONNECT_TIMEOUT = 0.7
READ_TIMEOUT = 1.0
WORKERS = 64


def local_address():
    """返回 (本机 IPv4, 前缀长度)。优先用 UDP connect 技巧，失败再解析 ip 命令。"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # UDP connect 不发包，只做路由查找，离线也可用
        sock.connect(("192.0.2.1", 9))
        address = sock.getsockname()[0]
    except OSError:
        address = None
    finally:
        sock.close()
    if address:
        prefix = 24
        try:
            output = subprocess.run(["ip", "-4", "addr", "show"], capture_output=True,
                                    text=True, timeout=5).stdout
            match = re.search(r"inet %s/(\d+)" % re.escape(address), output)
            if match:
                prefix = int(match.group(1))
        except (OSError, subprocess.SubprocessError):
            pass
        return address, prefix
    return None, None


def probe(ip, port):
    """连上并发握手；返回 ip 或 None。"""
    try:
        with socket.create_connection((ip, port), timeout=CONNECT_TIMEOUT) as sock:
            sock.settimeout(READ_TIMEOUT)
            sock.sendall(HANDSHAKE_CLIENT)
            reply = sock.recv(len(HANDSHAKE_SERVER))
            if reply == HANDSHAKE_SERVER:
                return ip
    except OSError:
        return None
    return None


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8554
    address, prefix = local_address()
    if not address:
        print(json.dumps({"servers": [], "error": "no local IPv4 address"}))
        return 1

    network = ".".join(address.split(".")[:3]) + ".0/%d" % prefix
    hosts = []
    base = address.split(".")
    for last in range(1, 255):
        candidate = ".".join(base[:3] + [str(last)])
        if candidate != address:
            hosts.append(candidate)

    started = time.time()
    found = []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for result in pool.map(lambda host: probe(host, port), hosts):
            if result:
                found.append({"ip": result, "port": port})
    found.sort(key=lambda item: tuple(int(part) for part in item["ip"].split(".")))

    print(json.dumps({
        "servers": found,
        "local_ip": address,
        "subnet": network,
        "scanned": len(hosts),
        "elapsed": round(time.time() - started, 1),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())