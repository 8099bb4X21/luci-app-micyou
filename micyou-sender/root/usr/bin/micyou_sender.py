#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MicYou 局域网发送端（P0 最小可用版）。

用途：把采集到的 PCM 音频按 MicYou 协议推送给 PC 端 MicYou 服务端。
协议依据（均从 MicYou 源码核对）：
  - tcp.rs  ：帧头 = 4B 大端 magic(0x4D696359) + 4B 大端 int32 负载长度（不含帧头），上限 1MiB
  - udp.rs  ：数据报 = 4B 大端 magic(0x4D696355) + 4B 大端 int32 负载长度（不含帧头），负载上限 64KiB
  - session.rs：channel 1..2、rate 8000..192000、buffer 非空且 ≤64KiB、PCM 须按帧对齐
  - 握手：客户端先发 "MicYouCheck1"(12B)，服务端回 "MicYouCheck2"(12B)
  - 首帧必须含 Connect{sessionId, platform}；UDP 包的 sessionId 必须与其一致
  - 音频包 timestamp 为墙钟毫秒（服务端用它做 RFC3550 抖动估计）

依赖：仅 Python 3 标准库。本文件为 UTF-8 无 BOM、LF。
"""

import argparse
import array
import logging
import math
import os
import random
import signal
import socket
import struct
import subprocess
import sys
import threading
import time

PACKET_MAGIC = 0x4D696359          # "MicY"
UDP_PACKET_MAGIC = 0x4D696355      # "MicU"
HANDSHAKE_CLIENT = b"MicYouCheck1"
HANDSHAKE_SERVER = b"MicYouCheck2"
AUDIO_FORMAT_S16LE = 2
CODEC_PCM = 0
FRAME_HEADER_LEN = 8
UDP_HEADER_LEN = 8
MAX_CONTROL_PAYLOAD = 1024 * 1024
MAX_UDP_PAYLOAD = 64 * 1024

logger = logging.getLogger("micyou-sender")


def _pb_varint(value):
    """protobuf varint；负数按 proto 规则转 64 位补码（10 字节）。"""
    if value < 0:
        value &= 0xFFFFFFFFFFFFFFFF
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _pb_tag(field_no, wire_type):
    return _pb_varint((field_no << 3) | wire_type)


def _pb_int(field_no, value):
    return _pb_tag(field_no, 0) + _pb_varint(value)


def _pb_bytes(field_no, data):
    return _pb_tag(field_no, 2) + _pb_varint(len(data)) + data


def _read_varint(buf, pos):
    result = 0
    shift = 0
    while True:
        byte = buf[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7


def pb_decode(buf):
    """极简 protobuf 解码：返回 {字段号: (wire_type, 值)}，只覆盖本脚本所需层级。"""
    fields = {}
    pos = 0
    while pos < len(buf):
        key, pos = _read_varint(buf, pos)
        field_no = key >> 3
        wire = key & 7
        if wire == 0:
            value, pos = _read_varint(buf, pos)
        elif wire == 1:
            value, pos = buf[pos:pos + 8], pos + 8
        elif wire == 2:
            length, pos = _read_varint(buf, pos)
            value, pos = buf[pos:pos + length], pos + length
        elif wire == 5:
            value, pos = buf[pos:pos + 4], pos + 4
        else:
            raise ValueError("不支持的 wire type %d" % wire)
        fields[field_no] = (wire, value)
    return fields


def _wrap_tcp(payload):
    return struct.pack(">ii", PACKET_MAGIC, len(payload)) + payload


def _wrap_udp(payload):
    return struct.pack(">ii", UDP_PACKET_MAGIC, len(payload)) + payload


def build_connect_frame(session_id, platform):
    """首帧：MessageWrapper.connect(字段2) = ConnectMessage{sessionId=1, platform=2}"""
    connect = _pb_int(1, session_id) + _pb_bytes(2, platform.encode("utf-8"))
    return _wrap_tcp(_pb_bytes(2, connect))


def build_pong_frame(timestamp):
    """MessageWrapper.pong(字段6) = PongMessage{timestamp=1}"""
    return _wrap_tcp(_pb_bytes(6, _pb_int(1, timestamp)))


def build_audio_datagram(sequence_number, timestamp_ms, session_id, pcm, sample_rate, channels):
    """MessageWrapper.audioPacket(字段1) = AudioPacketMessageOrdered。

    不携带 FEC（fecBuffer 空）；fecSequenceNumber 填 -1 与 Android 客户端一致。
    """
    audio = (
        _pb_bytes(1, pcm)
        + _pb_int(2, sample_rate)
        + _pb_int(3, channels)
        + _pb_int(4, AUDIO_FORMAT_S16LE)   # codec=0(PCM) 为默认值，省略
    )
    ordered = (
        _pb_int(1, sequence_number)
        + _pb_bytes(2, audio)
        + _pb_int(3, timestamp_ms)
        + _pb_int(5, -1)
        + _pb_int(6, session_id)
    )
    return _wrap_udp(_pb_bytes(1, ordered))


def build_plugin_message_frame(source, topic, payload, target=""):
    """MessageWrapper.pluginMessage = 7；PluginMessage 字段：
    source=1, target=2, topic=3, payload=4（与 fork 的 PC 端 remote-key 对齐）。
    远程按键：source="remote-key"，topic="key-chord"，
    payload = [n, vk1..vkn, action]，action 0=按下、1=松开（vk 为 Windows VK 码）。"""
    plugin = b""
    if source:
        plugin += _pb_bytes(1, source.encode("utf-8"))
    if target:
        plugin += _pb_bytes(2, target.encode("utf-8"))
    if topic:
        plugin += _pb_bytes(3, topic.encode("utf-8"))
    plugin += _pb_bytes(4, bytes(payload))
    return _wrap_tcp(_pb_bytes(7, plugin))


class ControlLink(threading.Thread):
    """TCP 控制链路：握手 → Connect → 持续应答 Ping、记录 Stats。"""

    def __init__(self, host, port, session_id, platform, stop_event, source_ip, stats_holder,
                 marker_path=None):
        super().__init__(daemon=True, name="control-link")
        self.host = host
        self.port = port
        self.session_id = session_id
        self.platform = platform
        self.stop_event = stop_event
        self.source_ip = source_ip
        self.stats_holder = stats_holder
        self.marker_path = marker_path
        self.connected = threading.Event()
        self.error = None
        self._sock = None
        self._send_lock = threading.Lock()

    def run(self):
        try:
            self._run()
        except Exception as exc:
            self.error = exc
            logger.error("控制链路异常退出: %s", exc)
        finally:
            self._remove_marker()

    def _write_marker(self):
        """握手完成即落一个"已连接"标记，供 micyou-ctl send-key 判断能否发按键。"""
        if not self.marker_path:
            return
        try:
            os.makedirs(os.path.dirname(self.marker_path), exist_ok=True)
            with open(self.marker_path, "w") as fh:
                fh.write("%d\n" % os.getpid())
        except OSError as exc:
            logger.debug("写连接标记失败: %s", exc)

    def _remove_marker(self):
        if not self.marker_path:
            return
        try:
            os.unlink(self.marker_path)
        except OSError:
            pass

    def send_plugin_message(self, source, topic, payload):
        """从别的线程往同一 TCP 连接发一帧（加锁，与接收循环并发安全）。"""
        if not self.connected.is_set() or self._sock is None:
            return False
        frame = build_plugin_message_frame(source, topic, payload)
        try:
            with self._send_lock:
                self._sock.sendall(frame)
            return True
        except OSError as exc:
            logger.warning("发送 pluginMessage 失败: %s", exc)
            return False

    def _run(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock = sock
        sock.settimeout(5.0)
        if self.source_ip:
            sock.bind((self.source_ip, 0))
        sock.connect((self.host, self.port))
        logger.debug("TCP 已连接 %s:%d", self.host, self.port)
        sock.sendall(HANDSHAKE_CLIENT)
        response = self._recv_exact(sock, len(HANDSHAKE_SERVER))
        if response != HANDSHAKE_SERVER:
            raise RuntimeError("握手应答不符: %r" % response)
        logger.info("握手成功（收到 MicYouCheck2）")
        sock.sendall(build_connect_frame(self.session_id, self.platform))
        logger.info("已发送 Connect（session_id=%d, platform=%s）", self.session_id, self.platform)
        self.connected.set()
        self._write_marker()
        sock.settimeout(10.0)
        while not self.stop_event.is_set():
            header = self._recv_exact(sock, FRAME_HEADER_LEN)
            magic, length = struct.unpack(">ii", header)
            if magic != PACKET_MAGIC:
                raise RuntimeError("TCP 帧 magic 错误: 0x%08X" % (magic & 0xFFFFFFFF))
            if length < 0 or length > MAX_CONTROL_PAYLOAD:
                raise RuntimeError("TCP 帧长度非法: %d" % length)
            fields = pb_decode(self._recv_exact(sock, length))
            if 5 in fields:
                timestamp = fields[5][1]
                if isinstance(timestamp, bytes):
                    timestamp = pb_decode(timestamp).get(1, (0, 0))[1]
                sock.sendall(build_pong_frame(timestamp))
            if 8 in fields:
                self._record_stats(fields[8][1])

    def _record_stats(self, raw):
        fields = pb_decode(raw)
        rtt = fields.get(1, (0, 0))[1]
        jitter = struct.unpack("<f", fields[2][1])[0] if 2 in fields else 0.0
        loss = struct.unpack("<f", fields[3][1])[0] if 3 in fields else 0.0
        latency = fields.get(4, (0, 0))[1]
        self.stats_holder["rtt_ms"] = rtt
        self.stats_holder["jitter_ms"] = jitter
        self.stats_holder["packet_loss"] = loss
        self.stats_holder["latency_ms"] = latency
        logger.debug("Stats: rtt=%dms jitter=%.2fms loss=%.4f%% latency=%dms",
                     rtt, jitter, loss * 100.0, latency)

    def close(self):
        self._remove_marker()
        if self._sock is not None:
            try:
                self._sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    @staticmethod
    def _recv_exact(sock, count):
        data = bytearray()
        while len(data) < count:
            piece = sock.recv(count - len(data))
            if not piece:
                raise ConnectionError("对端关闭连接")
            data.extend(piece)
        return bytes(data)


class KeyQueuePoller(threading.Thread):
    """轮询按键队列文件，把新行作为“远程按键”（fork 端 WinUHID 注入）发给 PC。

    行格式：`<vk1> [<vk2> ...] <down|up>`（VK 码十进制，1~6 个；也接受 0/1）。
    与 fork 的 PC 端对齐：pluginMessage source="remote-key"、
    topic="key-chord"、payload=[n, vk1..vkn, action]（0=按下、1=松开）。
    队列由 `micyou-ctl send-key` 追加；文件过大时自动清空重来。
    """

    REMOTE_KEY_SOURCE = "remote-key"
    REMOTE_KEY_TOPIC = "key-chord"
    MAX_QUEUE_BYTES = 256 * 1024

    def __init__(self, path, link, stop_event, interval=0.04):
        super().__init__(daemon=True, name="key-queue")
        self.path = path
        self.link = link
        self.stop_event = stop_event
        self.interval = interval
        self.sent = 0

    def run(self):
        # 启动时**跳过队列里已有的旧内容**：否则每次发送端重启（procd respawn）
        # 都会把历史按键重放一遍（曾导致 PC 端“不停按 Enter”）。
        try:
            offset = os.path.getsize(self.path) if os.path.exists(self.path) else 0
        except OSError:
            offset = 0
        if offset:
            logger.info("按键队列启动：跳过旧内容 %d 字节（防重启重放）", offset)
        # 补发一次“松开”：重启前按下的键在 PC 端可能还处于按下状态，否则会一直连发
        self._release_all()
        logger.info("按键队列就绪：%s（远程按键注入）", self.path)
        while not self.stop_event.is_set():
            try:
                offset = self._poll(offset)
            except OSError as exc:
                logger.debug("按键队列读取失败: %s", exc)
            self.stop_event.wait(self.interval)

    #: 启动清键用：常见修饰键 + Enter/Space（松开未按下的键是空操作，安全）
    RELEASE_CHORDS = ([164, 165, 162, 163, 91, 92], [13, 32])

    def _release_all(self):
        for chord in self.RELEASE_CHORDS:
            payload = bytes([len(chord)] + list(chord) + [1])   # action=1 = 松开
            self.link.send_plugin_message(self.REMOTE_KEY_SOURCE, self.REMOTE_KEY_TOPIC, payload)

    def _poll(self, offset):
        if not os.path.exists(self.path):
            return offset
        size = os.path.getsize(self.path)
        if size < offset:                       # 被截断/重建
            offset = 0
        if size > offset:
            with open(self.path, "rb") as handle:
                handle.seek(offset)
                data = handle.read()
                offset = handle.tell()
            for line in data.decode("utf-8", "replace").splitlines():
                self._dispatch_line(line.strip())
        if size > self.MAX_QUEUE_BYTES:
            with open(self.path, "wb"):
                pass
            offset = 0
        return offset

    # 注意：不能叫 _handle —— threading.Thread 在 Python 3.13 内部有同名的
    # _handle 属性（_ThreadHandle），会被实例属性覆盖导致 "object is not callable"。
    def _dispatch_line(self, line):
        if not line or line.startswith("#"):
            return
        parts = line.split()
        if len(parts) < 2:
            return
        token = parts[-1].lower()
        if token in ("down", "press", "0"):
            action = 0
        elif token in ("up", "release", "1"):
            action = 1
        else:
            return
        try:
            vks = [int(piece) for piece in parts[:-1]]
        except ValueError:
            return
        vks = [vk for vk in vks if 0 <= vk <= 255][:6]
        if not vks:
            return
        payload = bytes([len(vks)] + vks + [action])
        ok = self.link.send_plugin_message(self.REMOTE_KEY_SOURCE, self.REMOTE_KEY_TOPIC, payload)
        self.sent += 1
        logger.info("远程按键 %s %s：%s", vks, "按下" if action == 0 else "松开",
                    "已发送" if ok else "未发送（链路未就绪）")


class ToneSource:
    """正弦波测试源：无采集设备时验证链路（K3/K4）。"""

    def __init__(self, chunk_bytes, channels, sample_rate, frequency, amplitude):
        self.frames_per_chunk = chunk_bytes // (2 * channels)
        self.channels = channels
        self.step = 2.0 * math.pi * frequency / sample_rate
        self.peak = int(32767 * amplitude)
        self.phase = 0.0

    def read_chunk(self):
        samples = array.array("h")
        for _ in range(self.frames_per_chunk):
            value = int(self.peak * math.sin(self.phase))
            self.phase += self.step
            if self.phase >= 2.0 * math.pi:
                self.phase -= 2.0 * math.pi
            for _ in range(self.channels):
                samples.append(value)
        return samples.tobytes()

    def close(self):
        return None


class PipeSource:
    """子进程/文件字节流源（arecord 输出或原始 PCM 文件）。"""

    def __init__(self, chunk_bytes, popen=None, fileobj=None):
        self.chunk_bytes = chunk_bytes
        self.popen = popen
        self.fileobj = fileobj

    def read_chunk(self):
        stream = self.popen.stdout if self.popen is not None else self.fileobj
        data = bytearray()
        while len(data) < self.chunk_bytes:
            piece = stream.read(self.chunk_bytes - len(data))
            if not piece:
                break
            data.extend(piece)
        return bytes(data)

    def close(self):
        if self.popen is not None:
            self.popen.terminate()
            try:
                self.popen.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.popen.kill()


def format_stats(holder):
    if not holder:
        return "尚无（等待服务端上报）"
    return "rtt=%sms jitter=%.2fms loss=%.2f%% latency=%sms" % (
        holder.get("rtt_ms", 0),
        holder.get("jitter_ms", 0.0),
        holder.get("packet_loss", 0.0) * 100.0,
        holder.get("latency_ms", 0),
    )


def parse_args():
    parser = argparse.ArgumentParser(description="MicYou 局域网发送端（P0）")
    parser.add_argument("--host", required=True, help="PC 端 MicYou 服务端地址")
    parser.add_argument("--port", type=int, default=8554, help="TCP 控制端口（UDP 用 port+1）")
    parser.add_argument("--session-id", type=int, default=0, help="会话 ID，0 = 随机生成")
    parser.add_argument("--platform", default="android", help="上报平台（android/ios/其他=Mobile）")
    parser.add_argument("--rate", type=int, default=48000, help="采样率 Hz（8000..192000）")
    parser.add_argument("--channels", type=int, default=1, choices=(1, 2), help="声道数")
    parser.add_argument("--chunk-bytes", type=int, default=1320, help="每包 PCM 字节数（须帧对齐）")
    parser.add_argument("--burst", type=int, default=4, help="每轮连续发送的包数（节流精度用）")
    parser.add_argument("--source", choices=("tone", "arecord", "file"), default="tone")
    parser.add_argument("--device", default="hw:0,0", help="arecord 采集设备")
    parser.add_argument("--file", default="-", help="file 源 PCM 路径，- 表示 stdin")
    parser.add_argument("--tone-freq", type=float, default=440.0, help="正弦波频率 Hz")
    parser.add_argument("--amplitude", type=float, default=0.2, help="正弦波幅度 0..1")
    parser.add_argument("--duration", type=float, default=0.0, help="持续秒数，0 = 无限")
    parser.add_argument("--source-ip", default="", help="可选：绑定本机源 IP（保证 TCP/UDP 同源）")
    parser.add_argument("--key-queue", default="/tmp/run/micyou/keys.q",
                        help="远程按键队列文件（micyou-ctl send-key 追加）")
    parser.add_argument("--marker", default="/tmp/run/micyou/connected",
                        help="链路就绪标记文件（供 send-key 判断能否发按键）")
    parser.add_argument("--debug", action="store_true", help="输出 debug 日志")
    return parser.parse_args()


def create_source(args):
    if args.source == "tone":
        return ToneSource(args.chunk_bytes, args.channels, args.rate,
                          args.tone_freq, args.amplitude)
    if args.source == "arecord":
        command = [
            "arecord", "-D", args.device, "-f", "S16_LE",
            "-r", str(args.rate), "-c", str(args.channels), "-t", "raw", "-q",
        ]
        popen = subprocess.Popen(command, stdout=subprocess.PIPE)
        return PipeSource(args.chunk_bytes, popen=popen)
    fileobj = sys.stdin.buffer if args.file == "-" else open(args.file, "rb")
    return PipeSource(args.chunk_bytes, fileobj=fileobj)


def main():
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )
    if not 8000 <= args.rate <= 192000:
        raise SystemExit("采样率必须在 8000..192000 之间")
    frame_size = 2 * args.channels
    if args.chunk_bytes <= 0 or args.chunk_bytes % frame_size != 0:
        raise SystemExit("chunk-bytes 必须是帧长(%d 字节)的整数倍" % frame_size)
    if args.burst <= 0:
        raise SystemExit("burst 必须为正整数")

    session_id = args.session_id or random.randint(1, 2 ** 63 - 1)
    stop_event = threading.Event()
    stats_holder = {}

    # procd stop / micyou-ctl disconnect 默认发 SIGTERM 直接终止进程，跳过 finally，
    # 会留下“已连接”标记（/tmp/run/micyou/connected）→ 之后 send-key 误以为还连着、
    # 跳过“若未连接自动连接”。这里显式转成优雅退出，让 finally 清掉标记。
    signal.signal(signal.SIGTERM, lambda *_args: stop_event.set())

    link = ControlLink(args.host, args.port, session_id, args.platform,
                       stop_event, args.source_ip, stats_holder, marker_path=args.marker)
    link.start()
    deadline = time.monotonic() + 6.0
    while time.monotonic() < deadline:
        if link.connected.wait(timeout=0.1):
            break
        if link.error is not None:
            raise SystemExit("控制链路建立失败: %s" % link.error)
    if not link.connected.is_set():
        raise SystemExit("控制链路建立超时（6 秒）")

    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    if args.source_ip:
        udp.bind((args.source_ip, 0))
    udp.connect((args.host, args.port + 1))
    source = create_source(args)

    # 远程按键：轮询队列文件，把按键事件经 TCP 控制链路发给 PC
    key_queue = KeyQueuePoller(args.key_queue, link, stop_event)
    key_queue.start()

    frame_duration = args.chunk_bytes / float(frame_size * args.rate)
    logger.info("开始发送：%d Hz / %d 声道 / 每包 %d 字节（%.2f ms）/ 每轮 %d 包",
                args.rate, args.channels, args.chunk_bytes,
                frame_duration * 1000.0, args.burst)

    sequence = 0
    sent_bytes = 0
    start_time = time.monotonic()
    last_progress = start_time
    next_send_time = start_time
    try:
        while not stop_event.is_set():
            burst_chunks = []
            truncated = False
            for _ in range(args.burst):
                chunk = source.read_chunk()
                if len(chunk) < args.chunk_bytes:
                    truncated = True
                    break
                burst_chunks.append(chunk)
            if not burst_chunks:
                logger.info("音频源结束")
                break
            for chunk in burst_chunks:
                datagram = build_audio_datagram(sequence, int(time.time() * 1000),
                                                session_id, chunk, args.rate, args.channels)
                udp.send(datagram)
                sequence += 1
                sent_bytes += len(chunk)
            if truncated:
                logger.info("音频源结束（尾包不完整，已丢弃）")
                break
            if link.error is not None or not link.is_alive():
                logger.error("控制链路已断开，停止发送: %s", link.error)
                break
            if args.duration and time.monotonic() - start_time >= args.duration:
                break
            next_send_time += frame_duration * len(burst_chunks)
            sleep_time = next_send_time - time.monotonic()
            if sleep_time > 0:
                time.sleep(sleep_time)
            else:
                next_send_time = time.monotonic()
            now = time.monotonic()
            if now - last_progress >= 5.0:
                logger.info("进度：%d 包 / %.1f KB；链路 %s",
                            sequence, sent_bytes / 1024.0, format_stats(stats_holder))
                last_progress = now
    except KeyboardInterrupt:
        logger.info("收到中断，停止发送")
    finally:
        stop_event.set()
        link.close()
        source.close()
        udp.close()
        # 优雅退出时清掉“已连接”标记，避免下次误判（SIGKILL 时仍需 ctl 侧的陈旧校验兜底）
        try:
            os.unlink(args.marker)
        except OSError:
            pass

    elapsed = time.monotonic() - start_time
    logger.info("共发送 %d 包 / %.1f KB / 历时 %.1f 秒；最终链路状态：%s",
                sequence, sent_bytes / 1024.0, elapsed, format_stats(stats_holder))
    return 0


if __name__ == "__main__":
    sys.exit(main())
