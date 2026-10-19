"""开发用：接收预览页面 POST 过来的画布截图，存成文件。只监听本机。
用法：python3 tools/dev/capture_server.py 输出目录
页面里：fetch('http://127.0.0.1:8790/名字.jpg', {method: 'POST', body: blob})
批量：fetch('http://127.0.0.1:8790/batch', {method: 'POST', body: JSON.stringify({'名字.jpg': dataURL, ...})})
"""
import base64
import http.server
import json
import pathlib
import sys

OUT = pathlib.Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)


class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        name = pathlib.Path(self.path).name or "capture.jpg"
        data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if name == "batch":
            # 一次上传多帧：{"文件名": "data:image/jpeg;base64,...", ...}；页面在后台时逐帧上传会被浏览器限速
            for fname, url in json.loads(data).items():
                (OUT / pathlib.Path(fname).name).write_bytes(base64.b64decode(url.split(",", 1)[1]))
        else:
            (OUT / name).write_bytes(data)
        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", 8790), Handler).serve_forever()
