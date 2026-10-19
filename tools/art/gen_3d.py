"""调用火山方舟 Seed3D：一张图 → 3D 模型（异步任务：先建任务，再轮询取结果）。
用法：python3 tools/art/gen_3d.py 参考图.png 输出目录 [模型名]
API Key 从 ~/.config/wenzi-gecao/ark.env 读取。
"""
import base64
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

BASE = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"
KEY_FILE = pathlib.Path.home() / ".config" / "wenzi-gecao" / "ark.env"


def key() -> str:
    for line in KEY_FILE.read_text().splitlines():
        if line.startswith("ARK_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("找不到 ARK_API_KEY")


def call(method: str, url: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {key()}"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": {"status": e.code, "body": e.read().decode(errors="replace")[:800]}}


def main():
    src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    model = sys.argv[3] if len(sys.argv) > 3 else "doubao-seed3d-2-0-260328"
    out.mkdir(parents=True, exist_ok=True)
    uri = f"data:image/png;base64,{base64.b64encode(src.read_bytes()).decode()}"
    res = call("POST", BASE, {"model": model, "content": [{"type": "image_url", "image_url": {"url": uri}}]})
    if "error" in res or "id" not in res:
        sys.exit(f"建任务失败：{json.dumps(res, ensure_ascii=False)[:800]}")
    tid = res["id"]
    print("任务", tid)
    t0 = time.time()
    while True:
        time.sleep(10)
        st = call("GET", f"{BASE}/{tid}")
        status = st.get("status")
        print(f"  {int(time.time() - t0)}s {status}")
        if status in ("succeeded", "failed", "cancelled", "expired") or "error" in st:
            break
    (out / "task.json").write_text(json.dumps(st, ensure_ascii=False, indent=2))
    if status != "succeeded":
        sys.exit(f"任务没成功：{json.dumps(st, ensure_ascii=False)[:800]}")
    # 结果里的文件地址：不同模型字段名可能不同，凡是 http 开头的都下载下来
    urls = []

    def walk(v):
        if isinstance(v, str) and v.startswith("http"):
            urls.append(v)
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)
    walk(st.get("content", st))
    for i, u in enumerate(urls):
        name = u.split("?")[0].rsplit("/", 1)[-1] or f"file_{i}"
        urllib.request.urlretrieve(u, out / name)
        print("下载", out / name)


main()
