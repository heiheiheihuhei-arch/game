"""建筑动作视频的提示词（蓝红两方共用）：每种状态一段闲置循环、箭塔每种状态一段射箭、一段倒塌。
用法：python3 tools/art/video_jobs_b.py blue|red [任务名...]  —— 生成到 art/raw/video_b/（红方加 red_ 前缀）
"""
import concurrent.futures as cf
import subprocess
import os
import sys

# 源图目录和输出目录：重做时用留足上方空白的源图（烟往上飘不出画面），输出到新目录
PICS = os.environ.get("PICS_DIR", "art/raw/bpicks")
OUT = os.environ.get("VIDEO_OUT", "art/raw/video_b")

TAIL = ("烟和火往上飘的时候始终留在画面里，不能飘出画面上边和左右两边；背景从头到尾都是纯白色，没有地面、没有阴影、没有任何其他东西；镜头完全固定不动，不推拉不平移不旋转；建筑的位置、大小、角度从头到尾完全不变，"
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
    JOBS[f"towerA{s}_attack"] = (f"towerA{s}", 3, "游戏建筑动画。箭塔本身从头到尾完全静止，塔身、柱子、屋顶、底座一点都不晃动、不变形、不移动，只有平台上的小弓兵在动"
                                 + ("，火和烟照常燃烧飘动" if s else "，不要出现任何烟、火、爆炸和特效")
                                 + "；平台上的小弓兵始终侧身朝右，从箭袋取出一支箭，搭箭拉满弓瞄准右前下方，松手把箭射出去，然后放下弓回到一开始的姿势。只射一箭。")
# 没有弓兵的箭塔（用户觉得射箭时塔会跟着动，干脆去掉弓兵，塔不做射箭动作）
for st, t in IDLE.items():
    JOBS[f"tower{st}_idle"] = (f"tower{st}", 3, "游戏建筑动画。" + t.format(x="") + "塔身完全静止不动，箭塔的高度和形状从头到尾不变，不会长高、不会多出楼层。"
                               + ("" if st else "建筑完好，从头到尾没有任何烟、没有火。"))
JOBS["tower_die"] = ("tower_heavy", 4, "游戏建筑动画。这座燃烧的箭塔被摧毁倒塌：木柱断裂，平台和茅草屋顶向下塌落，木头散落一地，扬起一阵灰尘，"
                     "最后只剩下石头底座和一堆烧焦的碎木头，冒着几缕青烟，之后保持不动。箭塔从头到尾不会变高变大、不会多出楼层，第一帧开始就直接往下塌。")
JOBS["towerA_die"] = ("towerA_heavy", 4, "游戏建筑动画。这座燃烧的箭塔被摧毁倒塌：木柱断裂，平台和茅草屋顶向下塌落，木头散落一地，扬起一阵灰尘，"
                      "最后只剩下石头底座和一堆烧焦的碎木头，冒着几缕青烟，之后保持不动。小弓兵跟着塌落消失。箭塔从头到尾不会变高变大，只会往下塌。")
JOBS["barracks_die"] = ("barracks_heavy", 4, "游戏建筑动画。这顶燃烧的军营帐篷被摧毁倒塌：帐篷骨架断裂，帐篷布塌下来烧成灰烬，军旗倒地，扬起一阵灰尘，"
                        "最后只剩下几根焦黑的木杆、烧破的帐篷布和散落的木箱碎片，冒着几缕细细的青烟，之后保持不动。地面始终是纯白色背景，不要画草地和土地，烟只飘到画面中间的高度就散开。")
JOBS["base_die"] = ("base_heavy", 4, "游戏建筑动画。这座燃烧的城池被摧毁倒塌：城楼坍塌，城墙一段段崩裂倒下，砖土滚落，扬起大片灰尘，"
                    "最后只剩下低矮的残破城墙地基和一堆碎砖瓦砾，冒着几缕青烟，之后保持不动。")

# 第三版损坏：着火点随伤势增多，烟从每个火点细细升起、很快散开（不是头顶一大团）。源图 art/raw/bpicks_fire
FIRE = ("游戏建筑动画。建筑本身从头到尾完全静止，不晃动、不变形、不长高、不移动；只有火和烟在动。"
        "建筑上每个着火点的火苗都在原地持续跳动、忽大忽小，每个火苗上方各自升起一缕细细的烟，往上飘一小段就淡开散掉，"
        "烟不会变大、不会汇成一大团、不会飘到画面上方；不要出现新的着火点。动作可以无缝循环。")
for b in ("tower", "barracks", "base"):
    for st in ("_hurt", "_heavy"):
        JOBS[f"{b}{st}_fire"] = (f"{b}{st}", 3, FIRE)
JOBS["tower_die_fire"] = ("tower_heavy", 4, "游戏建筑动画。这座多处着火的箭塔倒塌：木柱断裂，平台和茅草屋顶向下塌落，木头散落一地，扬起一小阵灰尘；"
                          "塌完后火苗慢慢变小熄灭，只剩几缕细细的青烟往上飘一小段就散了，最后只剩石头底座和一堆烧焦的碎木头，保持不动。"
                          "箭塔不会变高变大，第一帧开始就直接往下塌。")
JOBS["barracks_die_fire"] = ("barracks_heavy", 4, "游戏建筑动画。这顶多处着火的军营帐篷倒塌：骨架断裂，帐篷布塌下来，军旗倒地，扬起一小阵灰尘；"
                             "塌完后火苗慢慢熄灭，只剩几缕细细的青烟往上飘一小段就散了，最后只剩几根焦黑的木杆、烧破的帐篷布和散落的木箱，保持不动。地面始终是纯白色背景。")
JOBS["base_die_fire"] = ("base_heavy", 4, "游戏建筑动画。这座多处着火的城池倒塌：城楼坍塌，城墙崩裂倒下，砖土滚落，扬起一阵灰尘；"
                         "塌完后火苗慢慢熄灭，只剩几缕细细的青烟往上飘一小段就散了，最后只剩残破的城墙地基和一堆碎砖瓦，保持不动。")


def run(side, name):
    pic, dur, act = JOBS[name]
    pre = "" if side == "blue" else "red_"
    r = subprocess.run([sys.executable, "-I", "tools/art/gen_video.py", f"{PICS}/{pre}{pic}.png", f"{OUT}/{pre}{name}",
                        act + TAIL, "--model", "doubao-seedance-1-0-pro-fast-251015", "--dur", str(dur)], capture_output=True, text=True)
    return f"{pre}{name}: " + ((r.stdout.strip().splitlines() or [""])[-1][:100] if r.returncode == 0 else r.stderr.strip()[-300:])


if __name__ == "__main__":
    side, names = sys.argv[1], sys.argv[2:] or list(JOBS)
    with cf.ThreadPoolExecutor(5) as ex:
        for line in ex.map(lambda n: run(side, n), names):
            print(line, flush=True)
