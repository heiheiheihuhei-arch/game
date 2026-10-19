"""素材后期处理（基于 ffmpeg）：去白底、清角落印章、按轮廓自动裁边、缩放；地面做成无缝平铺。

物件：python3 tools/art/prep.py prop 输入.png 输出.png --width 400 [--corner 0.09]
地面：python3 tools/art/prep.py ground 输入.png 输出.jpg --size 512 [--crop 0.68]
"""
import argparse
import re
import subprocess
import tempfile

PAPER = (238, 227, 201)  # 游戏里的宣纸底色


def run(args, capture=False):
    r = subprocess.run(["ffmpeg", "-loglevel", "info" if capture else "error", "-y"] + args,
                       check=True, capture_output=capture, text=True)
    return r.stderr if capture else ""


def bg_color(path):
    """取左上角一小块的平均色作为底色"""
    out = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-vf", "crop=16:16:4:4,scale=1:1",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], check=True, capture_output=True).stdout
    return out[0], out[1], out[2]


def image_size(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", path], check=True, capture_output=True, text=True).stdout.strip()
    w, h = out.split(",")
    return int(w), int(h)


def key_filter(br, bg, bb, k=3.5, threshold=0.18):
    """越接近底色越透明，并把底色从半透明像素里扣掉，贴到宣纸上不会有白边。
    AI 生成图的纸底越靠边越暗，门槛太低会把整片纸纹当成物件，所以差异 18% 以内都算底色"""
    A = (f"clip(((((({br}-r(X,Y))+({bg}-g(X,Y))+({bb}-b(X,Y)))*{k}/255)-{threshold})/{1 - threshold}),0,1)")
    ch = lambda c, v: f"if(gt({A},0),clip(({c}(X,Y)-(1-{A})*{v})/max({A},0.02),0,255),0)"
    return f"format=rgba,geq=r='{ch('r', br)}':g='{ch('g', bg)}':b='{ch('b', bb)}':a='255*{A}'"


def clear_corners(frac):
    """AI 生成图常在角落盖小印章；物件都在中间，直接把四个角清成透明"""
    c = f"(lt(X,W*{frac})+gt(X,W*(1-{frac})))*(lt(Y,H*{frac})+gt(Y,H*(1-{frac})))"
    return f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt({c},0),0,alpha(X,Y))'"


def edge_fade(px):
    """四周渐隐：物件画到了原图边缘时（比如树根、地影），避免留下笔直的切边"""
    return f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(min(min(X,W-1-X),min(Y,H-1-Y))/{px},0,1)'"


def prop(src, dst, width=None, height=None, corner=0.09):
    br, bg, bb = bg_color(src)
    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
        run(["-i", src, "-vf", f"{key_filter(br, bg, bb)},{clear_corners(corner)},{edge_fade(120)}", tmp.name])
        # 用透明通道找物件的外接框
        log = run(["-i", tmp.name, "-vf", "alphaextract,bbox=min_val=40", "-f", "null", "-"], capture=True)
        m = re.findall(r"x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)", log)
        x1, x2, y1, y2 = map(int, m[-1])
        iw, ih = image_size(tmp.name)
        pad = 8
        x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
        x2, y2 = min(iw, x2 + pad + 1), min(ih, y2 + pad + 1)
        w, h = x2 - x1, y2 - y1
        scale = f"scale={width}:-1" if width else f"scale=-1:{height}"
        run(["-i", tmp.name, "-vf", f"crop={w}:{h}:{x1}:{y1},{scale}", dst])
    print("prop", dst, f"bbox {w}x{h} at ({x1},{y1})")


def ground(src, dst, size=512, crop=0.68, lighten=0.5):
    """取中间一块（避开 AI 在四角画的石头花草），用错位叠加做成四方连续，再和纸色混合调淡"""
    pr, pg, pb = PAPER
    m = "clip(min(min(X,W-1-X),min(Y,H-1-Y))/(W*0.25),0,1)"
    seam = lambda c: f"{m}*{c}(X,Y)+(1-{m})*{c}(mod(X+W/2,W),mod(Y+H/2,H))"
    mix = lambda c, p: f"({c}(X,Y)*{1 - lighten}+{p}*{lighten})"
    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
        run(["-i", src, "-vf", f"crop=iw*{crop}:ih*{crop},scale={size * 2}:{size * 2},"
             f"geq=r='{seam('r')}':g='{seam('g')}':b='{seam('b')}'", tmp.name])
        run(["-i", tmp.name, "-vf", f"geq=r='{mix('r', pr)}':g='{mix('g', pg)}':b='{mix('b', pb)}',scale={size}:{size}",
             "-q:v", "3", dst])
    print("ground", dst)


def glow_filter(threshold=0.08):
    """黑底发光特效转透明：亮度越高越不透明，再把颜色除以透明度还原，贴到浅色纸面上仍是鲜亮的发光色"""
    A = f"clip((max(r(X,Y),max(g(X,Y),b(X,Y)))/255-{threshold})/{1 - threshold},0,1)"
    ch = lambda c: f"if(gt({A},0),clip({c}(X,Y)/max({A},0.02),0,255),0)"
    return f"format=rgba,geq=r='{ch('r')}':g='{ch('g')}':b='{ch('b')}':a='255*{A}'"


def glow(src, dst, width=None, height=None, corner=0.06):
    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
        run(["-i", src, "-vf", f"{glow_filter()},{clear_corners(corner)},{edge_fade(100)}", tmp.name])
        log = run(["-i", tmp.name, "-vf", "alphaextract,bbox=min_val=24", "-f", "null", "-"], capture=True)
        x1, x2, y1, y2 = map(int, re.findall(r"x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)", log)[-1])
        iw, ih = image_size(tmp.name)
        x1, y1, x2, y2 = max(0, x1 - 8), max(0, y1 - 8), min(iw, x2 + 9), min(ih, y2 + 9)
        scale = f"scale={width}:-1" if width else f"scale=-1:{height}"
        run(["-i", tmp.name, "-vf", f"crop={x2 - x1}:{y2 - y1}:{x1}:{y1},{scale}", dst])
    print("glow", dst, f"bbox {x2 - x1}x{y2 - y1} at ({x1},{y1})")


def patch(src, dst, size=768, crop=0.9, lighten=0.5):
    """一块叠在平铺地面上的局部地貌（比如演武场被踩实的地面）：调淡后从中心向四周透明淡出"""
    pr, pg, pb = PAPER
    mix = lambda c, p: f"({c}(X,Y)*{1 - lighten}+{p}*{lighten})"
    fade = "255*clip(1.9-2.2*hypot(X-W/2,Y-H/2)/(W/2),0,1)"
    run(["-i", src, "-vf", f"crop=iw*{crop}:ih*{crop}:0:0,scale={size}:{size},format=rgba,"
         f"geq=r='{mix('r', pr)}':g='{mix('g', pg)}':b='{mix('b', pb)}':a='{fade}'", dst])
    print("patch", dst)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("kind", choices=["prop", "ground", "patch", "glow"])
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--width", type=int)
    ap.add_argument("--height", type=int)
    ap.add_argument("--corner", type=float, default=0.09)
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--crop", type=float, default=0.68)
    a = ap.parse_args()
    if a.kind == "prop":
        prop(a.src, a.dst, a.width, a.height, a.corner)
    elif a.kind == "glow":
        glow(a.src, a.dst, a.width, a.height)
    elif a.kind == "ground":
        ground(a.src, a.dst, a.size, a.crop)
    else:
        patch(a.src, a.dst, a.size, a.crop)
