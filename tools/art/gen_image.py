"""调用火山方舟 Seedream 批量生成图片。

用法：
    python3 tools/art/gen_image.py tools/art/batches/001-test.json            # 生成
    python3 tools/art/gen_image.py tools/art/batches/001-test.json --dry-run  # 只打印请求，不花钱

API Key 从 ~/.config/wenzi-gecao/ark.env 读取（ARK_API_KEY=...），不放在工程里。
结果存到 art/raw/<批次名>/，每张图旁边存一份同名 .json，记录提示词和参数，方便以后按同样参数补图。
"""
import argparse
import base64
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
# 默认用 5.0 Flash（便宜）；要更好的效果在批次 JSON 里写 "model": "doubao-seedream-5-0-pro-260628"
DEFAULT_MODEL = "doubao-seedream-5-0-flash-260915"
KEY_FILE = pathlib.Path.home() / ".config" / "wenzi-gecao" / "ark.env"
ROOT = pathlib.Path(__file__).resolve().parents[2]


def load_key() -> str:
    if not KEY_FILE.exists():
        sys.exit(f"找不到 {KEY_FILE}，请先按说明创建，内容为一行 ARK_API_KEY=你的key")
    for line in KEY_FILE.read_text().splitlines():
        if line.startswith("ARK_API_KEY="):
            key = line.split("=", 1)[1].strip()
            if key and key != "你的key":
                return key
    sys.exit(f"{KEY_FILE} 里没有有效的 ARK_API_KEY")


def image_ref(path: str) -> str:
    """参考图：网址直接用，本地文件转成 data URI"""
    if path.startswith("http"):
        return path
    p = (ROOT / path) if not pathlib.Path(path).is_absolute() else pathlib.Path(path)
    mime = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"


def request(key: str, body: dict) -> dict:
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"error": {"status": e.code, "body": e.read().decode(errors="replace")}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("batch")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", help="只生成指定 id，逗号分隔")
    args = ap.parse_args()

    batch_path = pathlib.Path(args.batch)
    batch = json.loads(batch_path.read_text())
    out_dir = ROOT / "art" / "raw" / batch_path.stem
    out_dir.mkdir(parents=True, exist_ok=True)
    only = set(args.only.split(",")) if args.only else None
    key = None if args.dry_run else load_key()
    for job in batch["jobs"]:
        if only and job["id"] not in only:
            continue
        style = job.get("style", batch.get("style", ""))
        prompt = f"{job['prompt']}。{style}" if style else job["prompt"]
        for n in range(job.get("count", 1)):
            body = {
                "model": batch.get("model", DEFAULT_MODEL),
                "prompt": prompt,
                "size": job.get("size", "2K"),
                "response_format": "b64_json",
                # 默认会加 AI 生成水印，游戏素材要关掉
                "watermark": False,
            }
            # 组图开关只有 4.x 认，5.0 Flash 传了会报参数错误
            if "seedream-4" in body["model"]:
                body["sequential_image_generation"] = "disabled"
            if job.get("refs"):
                body["image"] = [image_ref(r) for r in job["refs"]]
            name = f"{job['id']}_{n + 1}"
            if args.dry_run:
                shown = {k: (v if k != "image" else f"[{len(v)} 张参考图]") for k, v in body.items()}
                print(name, json.dumps(shown, ensure_ascii=False))
                continue
            t0 = time.time()
            res = request(key, body)
            if "error" in res:
                print(f"✗ {name} 失败：{json.dumps(res['error'], ensure_ascii=False)[:500]}")
                continue
            data = res["data"][0]
            png = out_dir / f"{name}.png"
            png.write_bytes(base64.b64decode(data["b64_json"]))
            meta = {"id": job["id"], "prompt": prompt, "request": {k: v for k, v in body.items() if k != "image"},
                    "refs": job.get("refs", []), "size": data.get("size"), "usage": res.get("usage")}
            (out_dir / f"{name}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
            print(f"✓ {name} {data.get('size', '')} {time.time() - t0:.1f}s → {png.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
