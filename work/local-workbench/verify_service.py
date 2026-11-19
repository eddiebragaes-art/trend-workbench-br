"""Verify the locally served application from a relocated extraction directory."""
import http.client
import json
import queue
import re
import socket
import subprocess
import threading
import time


def read_local(port, path):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
    try:
        conn.request("GET", path)
        response = conn.getresponse()
        body = response.read()
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status} on {path}: {body[:180]!r}")
        return body
    finally:
        conn.close()


def check_server(resources, host_node, check_feed):
    process = subprocess.Popen(
        [host_node, str(resources / "server.mjs"), "--port", "0", "--announce-ready"],
        cwd=resources.parent, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    ready = queue.Queue()
    threading.Thread(target=lambda: ready.put(process.stdout.readline()), daemon=True).start()
    try:
        result = re.fullmatch(r"TREND_WORKBENCH_READY (\d+)\s*", ready.get(timeout=20))
        assert result, "Service did not emit the launcher handshake"
        port = int(result[1])
        lease = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        lease.request("GET", "/session")
        session = lease.getresponse()
        try:
            assert session.status == 200 and session.readline() == b"event: connected\n"
            health = json.loads(read_local(port, "/health"))
            assert health["pid"] == process.pid and health["activeWindows"] == 1
            assert "Estação de Tendências" in read_local(port, "/").decode()
            script = read_local(port, "/app.js")
            assert b"https://x.com/bi_9527zx" in script and b"https://t.me/jujishou9527" in script
            assert read_local(port, "/style.css")
            report = json.loads(read_local(port, "/forecast-validation.json"))
            assert report == {"available": False, "matchesInstalledBuild": False}
            if check_feed:
                for symbol in ("XRPUSDT", "BTCUSDT"):
                    data = json.loads(read_local(port, f"/api/candles?market=crypto&symbol={symbol}&interval=1h&limit=800"))
                    candles = data["candles"]
                    assert data["instrument"]["symbol"] == symbol and data["interval"] == "1h"
                    assert data["instrument"]["currency"] == "USDT" and data["source"]
                    assert len(candles) >= 100, f"Insufficient hourly history for {symbol}"
                    times = [bar["time"] for bar in candles]
                    assert times == sorted(set(times)) and all(t % 3600 == 0 for t in times)
                    assert -60 <= time.time() - times[-1] <= 7200, f"Stale hourly history for {symbol}"
                    assert all(0 < c["low"] <= min(c["open"], c["close"]) <= max(c["open"], c["close"]) <= c["high"] for c in candles)
                    print(f"Received {len(candles)} recent {symbol} hourly candles")
        finally:
            session.close()
            lease.close()
        assert process.wait(timeout=15) == 0, "Service failed to exit after the final window closed"
        with socket.socket() as probe:
            assert probe.connect_ex(("127.0.0.1", port)) != 0, "Port remained in use"
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=15)
