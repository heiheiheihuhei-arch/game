"""建筑动作视频的提示词（蓝红两方共用）：每种状态一段闲置循环、箭塔每种状态一段射箭、一段倒塌。
用法：python3 tools/art/video_jobs_b.py blue|red [任务名...]  —— 生成到 art/raw/video_b/（红方加 red_ 前缀）
"""
import concurrent.futures as cf
import subprocess
import sys

TAIL = ("背景从头到尾都是纯白色，没有地面、没有阴影、没有任何其他东西；镜头完全固定不动，不推拉不平移不旋转；建筑的位置、大小、角度从头到尾完全不变，"
        "建筑始终完整地在画面里；画面里不要出现任何文字。")
IDLE = {
    "": "建筑完好无损，静静地矗立着，只有旗帜在风里轻轻飘动{x}。动作很小很平稳，结尾和开头一样，可以无缝循环。",
    "_hurt": "建筑受了伤，保持现在的破损样子不变，一缕灰烟从破口处缓缓往上飘散，旗帜在风里轻轻飘动{x}。可以无缝循环。",
    "_heavy": "建筑受了重伤，保持现在的残破样子不变：几处小火苗在燃烧跳动，浓浓的黑烟不断往上翻滚飘散，破旗在风里抖动{x}。可以无缝循环。",
}
JOBS = {}
for b, extra in (("towerA", "，平台上的小弓兵轻轻呼吸、警戒地望着右方"), ("barracks", "，帐篷门帘被风轻轻吹动"), ("base", "")):
    for s, t in IDLE.items():
        JOBS[f"{b}{s}_idle"] = (f"{b}{s}", 3, "游戏建筑动画。" + t.format(x=extra))
for s in IDLE:
    JOBS[f"towerA{s}_attack"] = (f"towerA{s}", 3, "游戏建筑动画。箭塔本身保持现在的样子不动" + ("，火和烟照常燃烧飘动" if s else "") +
                                 "；平台上的小弓兵始终侧身朝右，从箭袋取出一支箭，搭箭拉满弓瞄准右前下方，松手把箭射出去，然后放下弓回到一开始的姿势。只射一箭。")
JOBS["towerA_die"] = ("towerA_heavy", 4, "游戏建筑动画。这座燃烧的箭塔被摧毁倒塌：木柱断裂，平台和茅草屋顶向下塌落，木头散落一地，扬起一阵灰尘，"
                      "最后只剩下石头底座和一堆烧焦的碎木头，冒着几缕青烟，之后保持不动。小弓兵跟着塌落消失。")
JOBS["barracks_die"] = ("barracks_heavy", 4, "游戏建筑动画。这顶燃烧的军营帐篷被摧毁倒塌：帐篷骨架断裂，帐篷布塌下来烧成灰烬，军旗倒地，扬起一阵灰尘，"
                        "最后只剩下一片烧焦的地面、几根焦黑的木杆和散落的木箱碎片，冒着几缕青烟，之后保持不动。")
JOBS["base_die"] = ("base_heavy", 4, "游戏建筑动画。这座燃烧的城池被摧毁倒塌：城楼坍塌，城墙一段段崩裂倒下，砖土滚落，扬起大片灰尘，"
                    "最后只剩下低矮的残破城墙地基和一堆碎砖瓦砾，冒着几缕青烟，之后保持不动。")


def run(side, name):
    pic, dur, act = JOBS[name]
    pre = "" if side == "blue" else "red_"
    r = subprocess.run([sys.executable, "-I", "tools/art/gen_video.py", f"art/raw/bpicks/{pre}{pic}.png", f"art/raw/video_b/{pre}{name}",
                        act + TAIL, "--model", "doubao-seedance-1-0-pro-fast-251015", "--dur", str(dur)], capture_output=True, text=True)
    return f"{pre}{name}: " + ((r.stdout.strip().splitlines() or [""])[-1][:100] if r.returncode == 0 else r.stderr.strip()[-300:])


if __name__ == "__main__":
    side, names = sys.argv[1], sys.argv[2:] or list(JOBS)
    with cf.ThreadPoolExecutor(5) as ex:
        for line in ex.map(lambda n: run(side, n), names):
            print(line, flush=True)
