"""用无界面 Chrome 跑游戏、执行一段测试 JS、把它返回的截图存下来。内置浏览器窗口在后台时会暂停游戏，测不了，用这个代替。
只用 Python 标准库（自带一个最小的 WebSocket 客户端）。
用法：python3 tools/dev/cdp.py 网址 测试脚本.js 输出目录
测试脚本是一段 async 函数体，可以 await；返回 {文件名: dataURL, ...} 会存成图片，返回别的会打印出来。
"""
import base64
import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
def _free_port():
    # 每次换一个空闲端口：连着跑两次时，上一个 Chrome 还没完全退出，占着固定端口会让第二次连不上
    with socket.socket() as so:
        so.bind(("127.0.0.1", 0)); return so.getsockname()[1]
PORT = _free_port()


class WS:
    """最小 WebSocket 客户端：只发文本帧、收文本帧，够 Chrome 调试协议用"""

    def __init__(self, url):
        host, path = url[len("ws://"):].split("/", 1)
        h, p = host.split(":")
        self.s = socket.create_connection((h, int(p)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET /{path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(4096)
        self.rest = buf.split(b"\r\n\r\n", 1)[1]

    def _read(self, n):
        while len(self.rest) < n:
            chunk = self.s.recv(1 << 20)
            if not chunk:
                raise ConnectionError("连接断了")
            self.rest += chunk
        out, self.rest = self.rest[:n], self.rest[n:]
        return out

    def send(self, text):
        data = text.encode()
        mask = os.urandom(4)
        n = len(data)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + n.to_bytes(2, "big")
                                if n < 65536 else bytes([0x80 | 127]) + n.to_bytes(8, "big"))
        self.s.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        msg = b""
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7F
            if n == 126:
                n = int.from_bytes(self._read(2), "big")
            elif n == 127:
                n = int.from_bytes(self._read(8), "big")
            payload = self._read(n)
            if b0 & 0x0F in (0x1, 0x0):
                msg += payload
                if b0 & 0x80:
                    return msg.decode()


def main():
    url, script, out = sys.argv[1], pathlib.Path(sys.argv[2]).read_text(), pathlib.Path(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    prof = tempfile.mkdtemp()
    proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}", f"--user-data-dir={prof}",
                             "--window-size=1560,720", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                             "--no-first-run", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(150):
            try:
                tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read())
                page = next(t for t in tabs if t["type"] == "page")
                break
            except Exception:
                time.sleep(0.2)
        else:
            sys.exit("Chrome 没有启动起来（等了 30 秒）")
        ws = WS(page["webSocketDebuggerUrl"])
        seq = [0]

        def call(method, **params):
            seq[0] += 1
            ws.send(json.dumps({"id": seq[0], "method": method, "params": params}))
            while True:
                m = json.loads(ws.recv())
                if m.get("id") == seq[0]:
                    if "error" in m:
                        raise RuntimeError(m["error"])
                    return m["result"]

        call("Page.navigate", url=url)
        res = call("Runtime.evaluate", expression=f"(async () => {{ {script} }})()", awaitPromise=True,
                   returnByValue=True, timeout=600000)
        if "exceptionDetails" in res:
            print("脚本出错：", json.dumps(res["exceptionDetails"], ensure_ascii=False)[:2000])
            return
        val = res["result"].get("value")
        if isinstance(val, dict) and all(isinstance(v, str) and v.startswith("data:") for v in val.values()):
            for name, data in val.items():
                (out / name).write_bytes(base64.b64decode(data.split(",", 1)[1]))
            print(f"存了 {len(val)} 张 → {out}")
        else:
            print(json.dumps(val, ensure_ascii=False)[:4000])
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
