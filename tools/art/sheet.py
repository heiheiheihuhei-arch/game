"""把一组图片拼成缩略图总览（ffmpeg），用于挑图。
用法：python3 tools/art/sheet.py 输出.jpg 每行张数 图1 图2 ...
"""
import subprocess
import sys

out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
cell = 320
parts, labels = [], []
for i, f in enumerate(files):
    parts.append(f"[{i}]scale={cell}:{cell}:force_original_aspect_ratio=decrease,"
                 f"pad={cell}:{cell}:(ow-iw)/2:(oh-ih)/2:color=0xdddddd[v{i}]")
# 不足一行的用灰块补齐
while len(files) % cols:
    files = files + [None]
rows = []
for r in range(len(files) // cols):
    tags = "".join(f"[v{r * cols + c}]" if files[r * cols + c] else f"[pad{r}_{c}]" for c in range(cols))
    for c in range(cols):
        if not files[r * cols + c]:
            parts.append(f"color=c=0xdddddd:s={cell}x{cell}:d=1[pad{r}_{c}]")
    parts.append(f"{tags}hstack=inputs={cols}[r{r}]")
    rows.append(f"[r{r}]")
parts.append(f"{''.join(rows)}vstack=inputs={len(rows)}" if len(rows) > 1 else f"{rows[0]}null")
cmd = ["ffmpeg", "-loglevel", "error", "-y"]
for f in files:
    if f:
        cmd += ["-i", f]
cmd += ["-filter_complex", ";".join(parts), "-frames:v", "1", out]
subprocess.run(cmd, check=True)
print("ok", out)
