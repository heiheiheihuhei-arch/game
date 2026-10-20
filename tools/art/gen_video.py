"""调用火山方舟 Seedance：角色图当第一帧 → 一段动作视频（异步任务：先建任务，再轮询取结果）。
游戏用法：让角色在纯白背景上原地做动作、镜头不动，之后用 ffmpeg 抽帧、切帧脚本抠背景。
用法：python3 tools/art/gen_video.py 角色图.png 输出目录 "提示词" [--model 模型] [--dur 秒] [--ratio 1:1] [--res 480p]
API Key 从 ~/.config/wenzi-gecao/ark.env 读取。按量计费，只对生成成功的视频收费。
"""
import argparse
import base64
import json
import pathlib
import subprocess
import sys
import tempfile
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
        return {"error": {"status": e.code, "body": e.read().decode(errors="replace")[:1200]}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("out")
    ap.add_argument("prompt")
    ap.add_argument("--model", default="doubao-seedance-2-0-260128")
    ap.add_argument("--dur", type=int, default=4)
    ap.add_argument("--ratio", default="1:1")
    ap.add_argument("--res", default="480p")
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    # 透明底的图先铺白底：视频模型要不透明的第一帧，白底也方便之后抠图
    with tempfile.TemporaryDirectory() as tmp:
        flat = pathlib.Path(tmp) / "first.png"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", args.image, "-filter_complex",
                        "color=white:s=16x16[bg];[bg][0]scale2ref[bg][fg];[bg][fg]overlay=shortest=1", "-frames:v", "1", str(flat)], check=True)
        uri = f"data:image/png;base64,{base64.b64encode(flat.read_bytes()).decode()}"
    text = f"{args.prompt} --resolution {args.res} --ratio {args.ratio} --duration {args.dur} --camerafixed true --watermark false"
    body = {"model": args.model, "content": [{"type": "text", "text": text},
                                              {"type": "image_url", "image_url": {"url": uri}, "role": "first_frame"}]}
    res = call("POST", BASE, body)
    if "error" in res or "id" not in res:
        sys.exit(f"建任务失败：{json.dumps(res, ensure_ascii=False)[:1200]}")
    tid = res["id"]
    print("任务", tid, flush=True)
    t0 = time.time()
    while True:
        time.sleep(8)
        st = call("GET", f"{BASE}/{tid}")
        status = st.get("status")
        print(f"  {int(time.time() - t0)}s {status}", flush=True)
        if status in ("succeeded", "failed", "cancelled", "expired") or "error" in st:
            break
    (out / "task.json").write_text(json.dumps({"prompt": text, "model": args.model, "result": st}, ensure_ascii=False, indent=2))
    if status != "succeeded":
        sys.exit(f"任务没成功：{json.dumps(st, ensure_ascii=False)[:1200]}")
    url = (st.get("content") or {}).get("video_url")
    if not url:
        sys.exit(f"结果里没有视频地址：{json.dumps(st, ensure_ascii=False)[:800]}")
    urllib.request.urlretrieve(url, out / "video.mp4")
    print("下载", out / "video.mp4", "用量", json.dumps(st.get("usage"), ensure_ascii=False))


main()
