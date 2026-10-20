"""第二套兵种（统一画风的初级小兵）各动作视频的提示词，蓝红两方共用。
用法：python3 tools/art/video_jobs2.py blue|red [任务名...]  —— 生成到 art/raw/video2/（红方加 red_ 前缀）
"""
import concurrent.futures as cf
import subprocess
import sys

TAIL = "背景从头到尾都是纯白色，没有地面、没有阴影、没有任何其他东西；镜头完全固定不动，不推拉不平移；角色始终完整地在画面中间，画面里只有这一个角色，不要出现任何特效和文字。"
KEEP = "人和马从头到尾始终保持侧身朝右，不转身、不转圈、不掉头、不改变方向。"
WHO = {"gong": "Q版卡通游戏角色动画。这个三国弓兵小兵侧身朝右，", "qiang": "Q版卡通游戏角色动画。这个三国枪兵小兵侧身朝右、双手握着长枪，",
       "qi": "Q版卡通游戏角色动画。这个骑着白马的三国骑兵，人和马都侧身朝右，"}
# 任务名: (兵种, 用哪张角色图, 时长, 动作描述)
JOBS = {
    "gong_run": ("gong", "gong1", 5, "在原地奔跑，身体不往前移动：两条腿大步交替前后摆动，膝盖抬起，没拿兵器的手跟着前后摆，身体微微前倾、随步伐上下起伏。这是一个可以无缝循环的跑步动作，结尾姿势和开头一样。"),
    "gong_attack": ("gong", "gong1", 4, "拉弓射箭：从背后箭袋取出一支箭，搭在弦上，拉满弦瞄准右方，松手把箭射向右方，然后放下弓恢复站姿。只射一箭。"),
    "gong_idle": ("gong", "gong1", 4, "原地站立待命：轻微的呼吸起伏，身体微微上下动，偶尔眨一下眼，手里的兵器拿稳不动。动作很小很平稳，可以无缝循环。"),
    "gong_die": ("gong", "gong1", 4, "被击中受了致命伤：身体往后一仰，手里的兵器掉落，然后向后仰面倒在地上，倒地后一直躺着不动。倒下后整个身体仍然完整地留在画面里，不能超出画面边缘。"),
    "gong_win": ("gong", "gong1", 4, "胜利欢呼：高高举起手里的兵器，开心地原地蹦跳一下，表情得意，然后保持举着兵器的姿势。"),
    "qiang_run": ("qiang", "qiang1", 5, "在原地奔跑，身体不往前移动：两条腿大步交替前后摆动，膝盖抬起，身体微微前倾、随步伐上下起伏。这是一个可以无缝循环的跑步动作，结尾姿势和开头一样。"),
    "qiang_attack": ("qiang", "qiang1", 4, "扎稳马步，双手紧握长枪，枪尖斜指右上方约 20 度，先往后收枪蓄力，再双手用力把长枪沿着斜向上的方向猛地往右上方刺出，刺到最远后收回，恢复握枪站姿。只刺一次。"),
    "qiang_idle": ("qiang", "qiang1", 4, "原地站立待命：轻微的呼吸起伏，身体微微上下动，偶尔眨一下眼，手里的兵器拿稳不动。动作很小很平稳，可以无缝循环。"),
    "qiang_die": ("qiang", "qiang1", 4, "被击中受了致命伤：身体往后一仰，手里的兵器掉落，然后向后仰面倒在地上，倒地后一直躺着不动。倒下后整个身体仍然完整地留在画面里，不能超出画面边缘。"),
    "qiang_win": ("qiang", "qiang1", 4, "胜利欢呼：高高举起手里的兵器，开心地原地蹦跳一下，表情得意，然后保持举着兵器的姿势。"),
    "qi_run2": ("qi", "qi1", 5, KEEP + "马在原地奔跑、身体位置不动，就像在跑步机上跑：四条腿按奔跑的节奏交替前后摆动，马头和鬃毛随步伐起伏，骑手随着马上下颠动，手里稳稳握着长戟。"),
    "qi_attack3": ("qi", "qi1_level", 4, "骑手双手平端着长戟、戟头朝右。" + KEEP + "马站着不动。骑手先把长戟高高举过头顶，然后从正上方往右前下方用力劈下，劈到马前下方后，把长戟抬回来平端在身前、戟头朝右，回到和视频开头完全一样的姿势后保持不动。整个劈砍只做一次，动作干脆有力。"),
    "qi_idle2": ("qi", "qi1_level", 4, "骑手双手平端着长戟。" + KEEP + "马原地站立，轻轻点头、尾巴轻轻摆动，骑手轻微呼吸起伏，长戟平端着拿稳不动。动作很小很平稳，结尾和开头的姿势一样，可以无缝循环。"),
    "qi_die": ("qi", "qi1", 4, "马和骑手被击中，马前腿一软向一侧倒下，骑手跟着摔落，一起倒在地上不动。倒下后人和马整个身体都完整地留在画面里，不能超出画面边缘。"),
    "qi_win": ("qi", "qi1", 4, "胜利：马抬起前腿高兴地嘶鸣，骑手高高举起长戟欢呼，然后马落下站稳。"),
}


def run(side, name):
    unit, pic, dur, act = JOBS[name]
    pre = "" if side == "blue" else "red_"
    r = subprocess.run([sys.executable, "-I", "tools/art/gen_video.py", f"art/raw/picks2/{pre}{pic}.png", f"art/raw/video2/{pre}{name}",
                        WHO[unit] + act + TAIL, "--model", "doubao-seedance-1-0-pro-fast-251015", "--dur", str(dur)], capture_output=True, text=True)
    return f"{pre}{name}: " + ((r.stdout.strip().splitlines() or [""])[-1][:110] if r.returncode == 0 else r.stderr.strip()[-300:])


if __name__ == "__main__":
    side, names = sys.argv[1], sys.argv[2:] or list(JOBS)
    with cf.ThreadPoolExecutor(5) as ex:
        for line in ex.map(lambda n: run(side, n), names):
            print(line, flush=True)
