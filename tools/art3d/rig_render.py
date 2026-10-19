"""Blender 脚本：给 Seed3D 生成的 A 字站姿人物自动装骨骼、挂长枪、做程序动作，侧面渲染成序列帧。
用法：Blender -b -P tools/art3d/rig_render.py -- 模型.glb 输出目录 [动作名,动作名...] [只渲第几帧]
输出约定同 tools/art/slice_sheet.py：画布高 256、人物头顶到脚底 160 像素、脚底贴底边、人物在水平正中、朝右。
"""
import math
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Quaternion, Vector

args = sys.argv[sys.argv.index('--') + 1:]
GLB, OUT = args[0], args[1]
ACTIONS = args[2].split(',') if len(args) > 2 else ['walk', 'attack', 'ready']
ONLY = [int(x) for x in args[3].split(',')] if len(args) > 3 else None

CANVAS_W, CANVAS_H, PERSON = 384, 256, 160
FRAMES = {'walk': 16, 'attack': 12, 'ready': 1}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
mesh = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
# glTF 导入时模型挂在一个带"Y 朝上转 Z 朝上"旋转的空物体下：先把这层变换烘进顶点，再挂到骨架上，否则人会躺倒
mw = mesh.matrix_world.copy()
mesh.parent = None
mesh.matrix_world = mw
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mw = mesh.matrix_world.copy()
# 模型归一化成身高 2（脚底 z=-1，头顶 z=+1），正面朝 -Y


def P(fx, fz):
    """按身高比例给出骨骼点：fx 左右（人物左手为 +x），fz 离地高度占身高比例"""
    return Vector((fx, 0.0, -1 + 2 * fz))


# ---------- 骨骼（按测量到的比例摆） ----------
J = {
    'hips': P(0, 0.50), 'chest': P(0, 0.66), 'neck': P(0, 0.80), 'head': P(0, 0.88), 'top': P(0, 1.0),
}
for s, sx in (('L', 1), ('R', -1)):
    J[f'shoulder_{s}'] = P(0.20 * sx, 0.745)
    J[f'elbow_{s}'] = P(0.35 * sx, 0.59)
    J[f'wrist_{s}'] = P(0.48 * sx, 0.45)
    J[f'hand_{s}'] = P(0.52 * sx, 0.40)
    J[f'hip_{s}'] = P(0.10 * sx, 0.48)
    J[f'knee_{s}'] = P(0.15 * sx, 0.27)
    J[f'ankle_{s}'] = P(0.17 * sx, 0.06)
    J[f'toe_{s}'] = P(0.17 * sx, 0.0) + Vector((0, -0.18, 0))

BONES = [  # 名字, 头, 尾, 父骨
    ('root', P(0, 0.40), J['hips'], None),
    ('spine', J['hips'], J['chest'], 'root'),
    ('chest', J['chest'], J['neck'], 'spine'),
    ('head', J['neck'], J['top'], 'chest'),
]
for s in ('L', 'R'):
    BONES += [
        (f'upper_arm_{s}', J[f'shoulder_{s}'], J[f'elbow_{s}'], 'chest'),
        (f'forearm_{s}', J[f'elbow_{s}'], J[f'wrist_{s}'], f'upper_arm_{s}'),
        (f'hand_{s}', J[f'wrist_{s}'], J[f'hand_{s}'], f'forearm_{s}'),
        (f'thigh_{s}', J[f'hip_{s}'], J[f'knee_{s}'], 'root'),
        (f'shin_{s}', J[f'knee_{s}'], J[f'ankle_{s}'], f'thigh_{s}'),
        (f'foot_{s}', J[f'ankle_{s}'], J[f'toe_{s}'], f'shin_{s}'),
    ]

arm_data = bpy.data.armatures.new('rig')
rig = bpy.data.objects.new('rig', arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, h, t, parent in BONES:
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = h, t
    if parent:
        b.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')


# ---------- 蒙皮权重：按区域 + 离骨段最近，自己算（AI 模型不封闭，Blender 自带的热量权重常常失败） ----------
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


segs = {name: (h, t) for name, h, t, _ in BONES}
groups = {name: mesh.vertex_groups.new(name=name) for name, *_ in BONES}
weights = {name: [] for name in groups}
for v in mesh.data.vertices:
    p = mw @ v.co
    fz = (p.z + 1) / 2
    ax = abs(p.x)
    side = 'L' if p.x > 0 else 'R'
    if ax > 0.27 and fz > 0.36:
        cands = [f'upper_arm_{side}', f'forearm_{side}', f'hand_{side}']
    elif ax > 0.19 and fz > 0.62:
        # 肩膀一带：胸和上臂之间过渡
        cands = ['chest', f'upper_arm_{side}']
    elif fz < 0.47:
        # 腿；正中间的裙甲两条腿各分一半
        cands = [f'thigh_{side}', f'shin_{side}', f'foot_{side}'] + (['root'] if fz > 0.3 else [])
        if ax < 0.03:
            cands += [f'thigh_{"R" if side == "L" else "L"}']
    else:
        cands = ['root', 'spine', 'chest', 'head']
    ds = sorted((seg_dist(p, *segs[c]), c) for c in cands)
    (d0, c0), (d1, c1) = ds[0], ds[1] if len(ds) > 1 else (9, ds[0][1])
    # 离最近两根骨头的距离差不多时平滑过渡，差很多时只跟最近的那根
    k = max(0.0, min(1.0, 0.5 + (d1 - d0) / 0.12))
    weights[c0].append((v.index, k))
    if k < 1:
        weights[c1].append((v.index, 1 - k))
for name, lst in weights.items():
    for idx, w in lst:
        groups[name].add([idx], w, 'ADD')
mod = mesh.modifiers.new('rig', 'ARMATURE')
mod.object = rig
mesh.parent = rig

# ---------- 长枪：木杆 + 铁枪头，全长约身高 1.6 倍 ----------
SPEAR_LEN, GRIP = 3.2, 0.4
bpy.ops.mesh.primitive_cylinder_add(radius=0.018, depth=SPEAR_LEN * 0.9, location=(0, 0, SPEAR_LEN * 0.45))
shaft = bpy.context.object
bpy.ops.mesh.primitive_cone_add(radius1=0.045, radius2=0, depth=SPEAR_LEN * 0.1, location=(0, 0, SPEAR_LEN * 0.95))
tip = bpy.context.object
for o, col in ((shaft, (0.32, 0.2, 0.1, 1)), (tip, (0.75, 0.75, 0.78, 1))):
    m = bpy.data.materials.new(o.name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = col
    m.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.8 if o is tip else 0.0
    o.data.materials.append(m)
bpy.ops.object.select_all(action='DESELECT')
shaft.select_set(True)
tip.select_set(True)
bpy.context.view_layer.objects.active = shaft
bpy.ops.object.join()
spear = bpy.context.object
# 合并后原点在枪杆中段：先把位置烘进顶点，让原点回到枪尾，下面才能按比例找握点
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# 枪的局部坐标：沿 +Z 从枪尾（0）到枪尖（SPEAR_LEN）；握点放到原点
spear.data.transform(Matrix.Translation((0, 0, -SPEAR_LEN * GRIP)))

# ---------- 程序动作 ----------
FWD = Vector((0, -1, 0))   # 人物正面
SIDE = Vector((1, 0, 0))   # 绕这个轴转 = 前后摆（腿、手臂）
pb = rig.pose.bones
for b in pb:
    b.rotation_mode = 'QUATERNION'


def swing(name, deg, axis=SIDE):
    """绕世界轴转骨骼（正数往前摆）；骨骼都在 A 字站姿下测的，把世界轴换到骨骼自己的坐标里"""
    b = pb[name]
    local = (b.bone.matrix_local.to_3x3().inverted() @ axis).normalized()
    b.rotation_quaternion = Quaternion(local, math.radians(-deg))


def reset():
    for b in pb:
        b.rotation_quaternion = Quaternion()
        b.location = Vector()


def pose_walk(t):
    s, c = math.sin(2 * math.pi * t), math.cos(2 * math.pi * t)
    for side, sg in (('L', 1), ('R', -1)):
        th = 24 * s * sg
        swing(f'thigh_{side}', th)
        # 腿从后往前摆的时候膝盖弯起来，落地前伸直
        lift = max(0.0, math.sin(2 * math.pi * t + (math.pi if sg < 0 else 0) - 0.6))
        swing(f'shin_{side}', -(6 + 42 * lift))
        swing(f'foot_{side}', 6 + 20 * lift - th * 0.3)
    # 左手随步伐前后摆；右手握枪，摆得小
    swing('upper_arm_L', -20 * s, Vector((1, 0, 0)))
    swing('forearm_L', 12 + 8 * max(0, -s))
    swing('upper_arm_R', 6 * s)
    swing('forearm_R', 35)
    swing('spine', 4)
    pb['root'].location = Vector((0, 0, 0.025 * abs(c) - 0.01))
    # 枪竖着扛在右手，随步子轻轻晃
    return {'spear_pitch': 4 * s, 'spear_mode': 'up'}


def lerp(a, b, k):
    return a + (b - a) * k


def ease(k):
    return k * k * (3 - 2 * k)


# 攻击关键姿势：[前腿, 后腿, 前膝, 后膝, 身体前倾, 右上臂, 右前臂, 枪往前推, 身体下沉]
KEYS = [
    (0.00, (18, -14, -10, -12, 4, 30, 60, 0.00, 0.00)),   # 端枪
    (0.30, (14, -18, -12, -16, -6, 5, 95, -0.25, 0.02)),  # 后收蓄力
    (0.55, (38, -30, -22, -8, 16, 70, 10, 0.45, 0.10)),   # 弓步刺出
    (0.70, (36, -28, -20, -8, 14, 66, 14, 0.42, 0.09)),   # 刺到底停一下
    (1.00, (18, -14, -10, -12, 4, 30, 60, 0.00, 0.00)),   # 收回端枪
]


def pose_attack(t):
    for i in range(len(KEYS) - 1):
        if KEYS[i][0] <= t <= KEYS[i + 1][0]:
            k = ease((t - KEYS[i][0]) / (KEYS[i + 1][0] - KEYS[i][0]))
            v = [lerp(a, b, k) for a, b in zip(KEYS[i][1], KEYS[i + 1][1])]
            break
    front, back, kf, kb, lean, ua, fa, push, sink = v
    swing('thigh_L', front)
    swing('shin_L', kf)
    swing('thigh_R', back)
    swing('shin_R', kb)
    swing('foot_L', -front * 0.5)
    swing('foot_R', -back * 0.4)
    swing('spine', lean)
    swing('upper_arm_R', ua)
    swing('forearm_R', fa)
    swing('upper_arm_L', ua * 0.8)
    swing('forearm_L', fa * 0.8)
    pb['root'].location = Vector((0, 0, -sink))
    return {'spear_mode': 'level', 'push': push}


POSES = {'walk': pose_walk, 'attack': pose_attack, 'ready': lambda t: pose_attack(0)}


def place_spear(info):
    bpy.context.view_layer.update()
    hand = rig.matrix_world @ pb['hand_R'].head
    if info['spear_mode'] == 'up':
        rot = Matrix.Rotation(math.radians(info['spear_pitch']), 4, 'X')
    else:
        # 平端，枪尖朝前（-Y）：绕 X 转 +90° 把枪身的 +Z 转到 -Y
        rot = Matrix.Rotation(math.radians(90), 4, 'X')
    spear.matrix_world = Matrix.Translation(hand + FWD * info.get('push', 0) * 0.3) @ rot


# ---------- 相机、灯光 ----------
sc = bpy.context.scene
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else engines[0]
sc.render.resolution_x, sc.render.resolution_y = CANVAS_W, CANVAS_H
sc.render.film_transparent = True
sc.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('w')
world.color = (0.55, 0.52, 0.48)
sc.world = world
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(45), math.radians(-25), math.radians(-60))
sc.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.type = 'ORTHO'
cam.data.ortho_scale = CANVAS_W * 2 / PERSON
sc.collection.objects.link(cam)
sc.camera = cam
# 从人物右侧（-X）稍微俯视：屏幕右方 = 人物正面，朝右走
ELEV = math.radians(14)
view = Vector((math.cos(ELEV), 0, -math.sin(ELEV)))     # 相机看过去的方向
cam.location = -view * 10
cam.rotation_euler = view.to_track_quat('-Z', 'Y').to_euler()
bpy.context.view_layer.update()
# 用相机平移把"脚底中心"放到画布底边往上 4 像素、水平正中
for _ in range(3):
    u, v, _ = world_to_camera_view(sc, cam, Vector((0, 0, -1)))
    cam.data.shift_x += (u - 0.5) * 1
    cam.data.shift_y += (v - 4 / CANVAS_H) * CANVAS_H / CANVAS_W
    bpy.context.view_layer.update()

# ---------- 渲染 ----------
import os
os.makedirs(OUT, exist_ok=True)
for act in ACTIONS:
    n = FRAMES[act]
    for i in range(n):
        if ONLY is not None and i not in ONLY:
            continue
        reset()
        info = POSES[act](i / n)
        place_spear(info)
        sc.render.filepath = f'{OUT}/{act}_{i:02d}.png'
        bpy.ops.render.render(write_still=True)
print('done')
