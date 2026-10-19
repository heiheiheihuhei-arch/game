"""本地试玩：伺服 build/web-mobile，关掉浏览器缓存（每次重新构建后刷新就是最新版）
用法：python3 tools/serve_web.py [端口，默认 8792]"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1] / "build" / "web-mobile"


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8792
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(NoCache, directory=str(ROOT))).serve_forever()
