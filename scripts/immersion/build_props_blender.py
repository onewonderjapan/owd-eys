"""S1 build for the EYS immersion prop pack (Blender 4.x, headless).

Creates seven editable props in one .blend, renders check images, exports one GLB
holding only the prop collection, reopens the .blend to verify editability, and
writes asset-report.json last.

Usage:
  blender -b --python-exit-code 1 --python build_props_blender.py -- --out <dir> --run-id <id>

Coordinate contract: modelled Z-up here; the glTF exporter writes Y-up.
Every exported root keeps translation (0,0,0) and scale 1; sizes live in child meshes.
"""
import argparse
import hashlib
import json
import math
import os
import random
import struct
import sys
from datetime import datetime, timezone

import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PARSER = argparse.ArgumentParser()
PARSER.add_argument('--out', required=True)
PARSER.add_argument('--run-id', required=True)
OPTS = PARSER.parse_args(ARGS)
OUT = OPTS.out
os.makedirs(OUT, exist_ok=True)
RUN_ID = OPTS.run_id

CHECKS = []
def check(name, passed, detail=''):
    CHECKS.append({'name': name, 'passed': bool(passed), 'detail': detail})
    print(('[PASS] ' if passed else '[FAIL] ') + name + (' :: ' + detail if detail else ''), flush=True)

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene

def new_collection(name):
    col = bpy.data.collections.new(name)
    SCENE.collection.children.link(col)
    return col

PROPS_COL = new_collection('ImmersionProps')
DISPLAY_COL = new_collection('DisplayOnly')

def link(obj, col=PROPS_COL):
    col.objects.link(obj)
    return obj

# ---------------------------------------------------------------- materials
def principled(name, color, roughness, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return mat

MAT_WOOD_DARK = principled('mat_wood_dark', (0.075, 0.043, 0.024), 0.62)
MAT_WOOD_MED = principled('mat_wood_medium', (0.32, 0.19, 0.10), 0.68)
MAT_WOOD_RED = principled('mat_wood_red', (0.30, 0.055, 0.05), 0.5)
MAT_BELL_GOLD = principled('mat_bell_gold', (0.86, 0.62, 0.18), 0.24, metallic=1.0)
MAT_STONE = principled('mat_stone_gray', (0.16, 0.17, 0.19), 0.92)
MAT_IRON = principled('mat_iron_dark', (0.10, 0.10, 0.12), 0.45, metallic=0.85)

# ---------------------------------------------------------------- mesh helpers
def make_object(name, verts, faces, mat, col=PROPS_COL, smooth=False):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    link(obj, col)
    if mat:
        obj.data.materials.append(mat)
    if smooth:
        for p in mesh.polygons:
            p.use_smooth = True
    return obj

def bevel(obj, width=0.005, segments=2):
    mod = obj.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(50)
    return obj

def lathe(name, profile, segments=32, mat=None, smooth=True):
    """Revolve a (radius, z) profile around Z (bottom -> top). r==0 ends become poles."""
    verts, faces = [], []
    n = len(profile)
    for (r, z) in profile:
        for s in range(segments):
            a = 2 * math.pi * s / segments
            verts.append((r * math.cos(a), r * math.sin(a), z))
    for i in range(n - 1):
        r_next = profile[i + 1][0]
        if r_next == 0.0:
            apex = len(verts)
            verts.append((0.0, 0.0, profile[i + 1][1]))
            for s in range(segments):
                s2 = (s + 1) % segments
                faces.append((apex, i * segments + s, i * segments + s2))
            break
        for s in range(segments):
            s2 = (s + 1) % segments
            faces.append((i * segments + s, i * segments + s2, (i + 1) * segments + s2, (i + 1) * segments + s))
    return make_object(name, verts, faces, mat, smooth=smooth)

def box(name, size, center, mat, col=PROPS_COL, bevel_width=0.006):
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    cx, cy, cz = center
    verts = []
    for dx in (-sx, sx):
        for dy in (-sy, sy):
            for dz in (-sz, sz):
                verts.append((cx + dx, cy + dy, cz + dz))
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    obj = make_object(name, verts, faces, mat, col=col)
    if bevel_width > 0:
        bevel(obj, bevel_width)
    return obj

def cylinder(name, r, depth, center, mat, col=PROPS_COL, verts=20, rot=(0, 0, 0), bevel_width=0.003):
    cx, cy, cz = center
    h = depth / 2
    verts_list, faces = [], []
    for s in range(verts):
        a = 2 * math.pi * s / verts
        verts_list.append((cx + r * math.cos(a), cy + r * math.sin(a), cz - h))
    for s in range(verts):
        a = 2 * math.pi * s / verts
        verts_list.append((cx + r * math.cos(a), cy + r * math.sin(a), cz + h))
    for s in range(verts):
        s2 = (s + 1) % verts
        faces.append((s, s2, verts + s2, verts + s))
    faces.append(tuple(range(verts - 1, -1, -1)))
    faces.append(tuple(range(verts, 2 * verts)))
    obj = make_object(name, verts_list, faces, mat, col=col)
    obj.rotation_euler = rot
    if bevel_width > 0:
        bevel(obj, bevel_width)
    return obj

def rock(name, size, center, seed, mat, col=PROPS_COL, subdivisions=1):
    rng = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=0.5, location=(0, 0, 0))
    tmp = bpy.context.active_object
    verts = [tuple(v.co) for v in tmp.data.vertices]
    faces = [tuple(p.vertices) for p in tmp.data.polygons]
    bpy.data.objects.remove(tmp, do_unlink=True)
    sx, sy, sz = size
    displaced = []
    for (x, y, z) in verts:
        d = 1.0 + rng.uniform(-0.28, 0.22)
        displaced.append((center[0] + x * sx * d, center[1] + y * sy * d, center[2] + z * sz * d))
    obj = make_object(name, displaced, faces, mat, col=col, smooth=True)
    return obj

def empty(name, location=(0, 0, 0), col=PROPS_COL):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_size = 0.03
    obj.location = location
    link(obj, col)
    return obj

def copy_tree_to(obj, parent, col):
    c = obj.copy()
    c.hide_render = False  # copies are display-only; source may be render-hidden
    link(c, col)
    c.parent = parent
    for child in obj.children:
        copy_tree_to(child, c, col)
    return c

def add_display_copy(root, location, col=DISPLAY_COL):
    top = root.copy()
    top.hide_render = False
    link(top, col)
    for child in root.children:
        copy_tree_to(child, top, col)
    top.location = location
    return top

# ---------------------------------------------------------------- 1. prop_bell
def build_bell():
    root = empty('prop_bell')
    base = box('bell_stand_base', (0.24, 0.24, 0.05), (0, 0, 0.025), MAT_WOOD_DARK)
    base.parent = root
    column = cylinder('bell_stand_column', 0.032, 0.70, (0, 0, 0.40), MAT_WOOD_DARK)
    column.parent = root
    arm = box('bell_stand_arm', (0.17, 0.045, 0.04), (0.085, 0, 0.775), MAT_WOOD_DARK)
    arm.parent = root

    swing = empty('bell_swing_pivot', (0.145, 0, 0.775))
    swing.parent = root
    ring = cylinder('bell_hanging_ring', 0.013, 0.008, (0, 0, 0.0), MAT_BELL_GOLD, verts=14,
                    rot=(math.pi / 2, 0, 0), bevel_width=0.0)
    ring.parent = swing
    profile = [(0.104, 0.0), (0.104, 0.012), (0.094, 0.025), (0.083, 0.05),
               (0.073, 0.08), (0.065, 0.11), (0.059, 0.14), (0.056, 0.16),
               (0.042, 0.175), (0.018, 0.187), (0.012, 0.196)]
    bell = lathe('bell_body', profile, segments=32, mat=MAT_BELL_GOLD, smooth=True)
    bell.parent = swing
    bell.location = (0, 0, -0.196)

    clapper = empty('bell_clapper_pivot', (0.145, 0, 0.775))
    clapper.parent = root
    ball = rock('bell_clapper_ball', (0.04, 0.04, 0.045), (0, 0, -0.105), 7, MAT_BELL_GOLD)
    ball.parent = clapper
    return root

# ---------------------------------------------------------------- 2. prop_round_table
def build_table():
    root = empty('prop_round_table')
    top = lathe('table_top', [(1.02, 0.63), (1.09, 0.645), (1.10, 0.67), (1.10, 0.70), (1.05, 0.72), (0.0, 0.72)],
                segments=48, mat=MAT_WOOD_DARK, smooth=True)
    top.parent = root
    inlay = lathe('table_inlay_ring', [(0.96, 0.7215), (0.90, 0.7215)], segments=48, mat=MAT_WOOD_RED)
    inlay.parent = root
    medallion = lathe('table_inlay_medallion', [(0.30, 0.7215), (0.22, 0.7215)], segments=32, mat=MAT_WOOD_RED)
    medallion.parent = root
    pedestal = lathe('table_pedestal', [(0.10, 0.11), (0.13, 0.35), (0.16, 0.56), (0.20, 0.63)],
                     segments=24, mat=MAT_WOOD_DARK, smooth=True)
    pedestal.parent = root
    foot = lathe('table_foot', [(0.42, 0.0), (0.42, 0.07), (0.34, 0.11), (0.10, 0.11)],
                 segments=32, mat=MAT_WOOD_DARK, smooth=True)
    foot.parent = root
    return root

# ---------------------------------------------------------------- 3. prop_chair
def build_chair():
    # Backrest sits at Blender +Y so that after glTF export the sitter faces runtime +Z.
    root = empty('prop_chair')
    seat = box('chair_seat', (0.36, 0.34, 0.045), (0, 0, 0.2775), MAT_WOOD_MED)
    seat.parent = root
    for i, (x, y) in enumerate([(-0.15, -0.14), (0.15, -0.14), (-0.15, 0.14), (0.15, 0.14)]):
        leg = cylinder(f'chair_leg_{i}', 0.018, 0.255, (x, y, 0.1275), MAT_WOOD_MED)
        leg.parent = root
    for i, x in enumerate((-0.15, 0.15)):
        stile = cylinder(f'chair_back_stile_{i}', 0.016, 0.34, (x, 0.145, 0.47), MAT_WOOD_MED)
        stile.parent = root
    rail = box('chair_back_rail', (0.34, 0.03, 0.07), (0, 0.145, 0.60), MAT_WOOD_MED, bevel_width=0.01)
    rail.parent = root
    slat = box('chair_back_slat', (0.30, 0.022, 0.05), (0, 0.145, 0.46), MAT_WOOD_RED, bevel_width=0.008)
    slat.parent = root
    return root

# ---------------------------------------------------------------- 4. prop_dock
def build_dock():
    root = empty('prop_dock')
    rng = random.Random(42)
    n = 11
    width = 5.9
    plank_w = width / n
    for i in range(n):
        y = -width / 2 + plank_w * (i + 0.5)
        jitter = rng.uniform(-0.004, 0.004)
        plank = box(f'dock_plank_{i}', (6.0, plank_w - 0.045, 0.07), (jitter, y + jitter, 0.085), MAT_WOOD_MED,
                    bevel_width=0.008)
        plank.parent = root
    for i, x in enumerate((-2.6, 0.0, 2.6)):
        beam = box(f'dock_beam_{i}', (0.16, 5.8, 0.05), (x, 0, 0.025), MAT_WOOD_DARK, bevel_width=0.004)
        beam.parent = root
    return root

# ---------------------------------------------------------------- 5. prop_sink_stone
def build_stone():
    root = empty('prop_sink_stone')
    # Keep the lowest displaced vertex at or above z=0: half-height 0.12 * 1.28 jitter.
    body = rock('sink_stone_body', (0.34, 0.30, 0.24), (0, 0, 0.157), 1234, MAT_STONE)
    body.parent = root
    anchor = empty('chain_anchor', (0, 0, 0.282))
    anchor.parent = root
    return root

# ---------------------------------------------------------------- 6. prop_chain_link
def build_link():
    # Built so that AFTER glTF export (Blender Z-up -> glTF Y-up) the link keeps the
    # runtime contract: ring plane XY, hole axis Z, long axis local Y.
    # glTF Y  <- Blender Z (long axis), glTF Z <- Blender -Y (hole axis).
    a_long, b_short, r_minor = 0.052, 0.044, 0.011
    seg_m, seg_n = 20, 8
    verts, faces = [], []
    for i in range(seg_m):
        u = 2 * math.pi * i / seg_m
        cu, su = math.cos(u), math.sin(u)
        cx, cz = b_short * cu, a_long * su
        nx, nz = cu, su
        for j in range(seg_n):
            v = 2 * math.pi * j / seg_n
            cv, sv = math.cos(v), math.sin(v)
            rr = r_minor * cv
            verts.append((cx + rr * nx, r_minor * sv, cz + rr * nz))
    for i in range(seg_m):
        i2 = (i + 1) % seg_m
        for j in range(seg_n):
            j2 = (j + 1) % seg_n
            faces.append((i * seg_n + j, i * seg_n + j2, i2 * seg_n + j2, i2 * seg_n + j))
    obj = make_object('prop_chain_link', verts, faces, MAT_IRON, smooth=True)
    return obj

# ---------------------------------------------------------------- 7. prop_firepit
def build_firepit():
    root = empty('prop_firepit')
    for i in range(10):
        a = 2 * math.pi * i / 10
        s = 0.13 + (i % 3) * 0.02
        stone = rock(f'firepit_stone_{i}', (s * 2, s * 1.6, s * 1.5),
                     (0.85 * math.cos(a), 0.85 * math.sin(a), s * 0.75 * 1.30), 500 + i, MAT_STONE)
        stone.parent = root
        stone.rotation_euler = (0, 0, a)
    for i in range(6):
        a = math.pi * i / 3.2 + 0.4
        # Keep the rotated corner above z=0: worst corner ~ -0.12 for these dimensions.
        log = cylinder(f'firepit_log_{i}', 0.045, 0.80, (0, 0, 0), MAT_WOOD_MED, verts=12,
                       rot=(math.pi / 2 - 0.18, 0, a), bevel_width=0.006)
        log.parent = root
        log.location = (0.06 * math.cos(a), 0.06 * math.sin(a), 0.135 + (i % 2) * 0.05)
    return root

ROOTS = {
    'prop_bell': build_bell(),
    'prop_round_table': build_table(),
    'prop_chair': build_chair(),
    'prop_dock': build_dock(),
    'prop_sink_stone': build_stone(),
    'prop_chain_link': build_link(),
    'prop_firepit': build_firepit(),
}

# ---------------------------------------------------------------- render setup
SCENE.render.engine = 'CYCLES'
SCENE.cycles.samples = 40
SCENE.cycles.use_denoising = False
SCENE.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('immersion_world')
SCENE.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.05, 0.06, 0.08, 1.0)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.5

sun_data = bpy.data.lights.new('key_sun', 'SUN')
sun_data.energy = 1.8
sun = bpy.data.objects.new('key_sun', sun_data)
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
link(sun, DISPLAY_COL)
area_data = bpy.data.lights.new('fill_area', 'AREA')
area_data.energy = 350
area_data.size = 6
area = bpy.data.objects.new('fill_area', area_data)
area.location = (-4, -5, 5)
area.rotation_euler = (math.radians(45), 0, math.radians(-40))
link(area, DISPLAY_COL)

# The real props sit at the origin and must not photobomb the display copies.
for obj in PROPS_COL.objects:
    obj.hide_render = True

def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def render_to(name, cam_loc, cam_target, res=(640, 480), lens=50):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam = bpy.data.objects.new(name, cam_data)
    cam.location = cam_loc
    look_at(cam, cam_target)
    link(cam, DISPLAY_COL)
    SCENE.camera = cam
    SCENE.render.resolution_x, SCENE.render.resolution_y = res
    SCENE.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)
    print('[RENDER] ' + name, flush=True)

copies = {
    'prop_bell': add_display_copy(ROOTS['prop_bell'], (-2.2, 0, 0)),
    'prop_chair': add_display_copy(ROOTS['prop_chair'], (-1.4, 0, 0)),
    'prop_round_table': add_display_copy(ROOTS['prop_round_table'], (0.0, 0, 0)),
    'prop_firepit': add_display_copy(ROOTS['prop_firepit'], (2.2, 0, 0)),
    'prop_sink_stone': add_display_copy(ROOTS['prop_sink_stone'], (3.5, 0, 0)),
    'prop_dock': add_display_copy(ROOTS['prop_dock'], (0.0, -6.5, 0)),
}
chain_display = ROOTS['prop_chain_link'].copy()
chain_display.hide_render = False
link(chain_display, DISPLAY_COL)
chain_display.location = (3.5, 0, 0.5)

render_to('props_furniture.png', (-2.6, -2.6, 1.6), (-0.4, 0, 0.35))

# Rearrange for the stage pieces, then restore the detail-shot positions.
copies['prop_dock'].location = (0.0, 0, 0)
copies['prop_firepit'].location = (4.6, 0, 0)
copies['prop_bell'].location = (-5.6, 0, 0)
copies['prop_chair'].location = (-4.8, 0, 0)
copies['prop_round_table'].location = (-3.4, 0, 0)
copies['prop_sink_stone'].location = (3.2, -1.4, 0)
chain_display.location = (3.2, -1.4, 0.5)
render_to('props_stages.png', (-1.4, -6.2, 4.6), (1.4, 0, 0.1), res=(720, 480))

copies['prop_bell'].location = (0, 0, 0)
render_to('bell_pivot_detail.png', (-0.42, -0.50, 0.95), (0.13, 0, 0.62), res=(512, 384), lens=60)
copies['prop_bell'].location = (-5.6, 0, 0)
copies['prop_chair'].location = (0, 0, 0)
render_to('chair_seat_detail.png', (0.55, -0.65, 0.60), (0, -0.02, 0.30), res=(512, 384), lens=55)
copies['prop_chair'].location = (-4.8, 0, 0)
copies['prop_sink_stone'].location = (0, 0, 0)
chain_display.location = (0, 0, 0.42)
render_to('chain_stone_detail.png', (-0.55, -0.55, 0.50), (0.05, 0, 0.18), res=(512, 384), lens=60)

for obj in PROPS_COL.objects:
    obj.hide_render = False

# ---------------------------------------------------------------- save .blend
blend_path = os.path.join(OUT, 'immersion-props.blend')
bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True)
check('blend_saved', os.path.exists(blend_path), blend_path)

# ---------------------------------------------------------------- export GLB
glb_path = os.path.join(OUT, 'immersion-props.glb')
bpy.ops.object.select_all(action='DESELECT')
for obj in PROPS_COL.objects:
    obj.select_set(True)
    for child in obj.children_recursive:
        child.select_set(True)
bpy.context.view_layer.objects.active = ROOTS['prop_bell']
bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True)
check('glb_exported', os.path.exists(glb_path) and os.path.getsize(glb_path) > 1000,
      f'{os.path.getsize(glb_path)} bytes')

# ---------------------------------------------------------------- reopen + audit
bpy.ops.wm.open_mainfile(filepath=blend_path)
ROOTS = {name: bpy.data.objects.get(name) for name in
         ['prop_bell', 'prop_round_table', 'prop_chair', 'prop_dock',
          'prop_sink_stone', 'prop_chain_link', 'prop_firepit']}
reopen_ok = True
for name, obj in ROOTS.items():
    if obj is None:
        reopen_ok = False
        continue
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.select_set(True)
check('blend_reopened_roots_editable', reopen_ok, '7 roots present, visible and selectable after reopen')

node_names, root_transforms = [], {}
with open(glb_path, 'rb') as f:
    f.read(12)
    chunk_len, chunk_type = struct.unpack('<II', f.read(8))
    gltf = json.loads(f.read(chunk_len))
for node in gltf.get('nodes', []):
    node_names.append(node.get('name', ''))
for scene_root in gltf['scenes'][0]['nodes']:
    node = gltf['nodes'][scene_root]
    root_transforms[node.get('name', '')] = {
        'translation': node.get('translation', [0, 0, 0]),
        'scale': node.get('scale', [1, 1, 1]),
    }
extensions_used = gltf.get('extensionsUsed', [])

expected_roots = list(ROOTS.keys())
missing = [n for n in expected_roots if n not in root_transforms]
check('glb_seven_roots', not missing, f'missing={missing}')
bad_tf = {n: t for n, t in root_transforms.items()
          if any(abs(v) > 1e-6 for v in t['translation']) or any(abs(v - 1) > 1e-6 for v in t['scale'])}
check('glb_root_transforms_zeroed', not bad_tf, json.dumps(bad_tf))
pivots_ok = all(p in node_names for p in ('bell_swing_pivot', 'bell_clapper_pivot', 'chain_anchor'))
check('glb_pivots_present', pivots_ok, f'pivots found among {len(node_names)} nodes')
check('glb_no_compression_extensions', not extensions_used, f'extensionsUsed={extensions_used}')
check('glb_materials_shared_few', 1 <= len(gltf.get('materials', [])) <= 8,
      f"materials={len(gltf.get('materials', []))} meshes={len(gltf.get('meshes', []))}")

def root_bbox(root_obj):
    pts = []

    def walk(o, parent_rel):
        # Chain transforms relative to the root; matrix_world would double-count ancestors.
        m = parent_rel @ o.matrix_parent_inverse @ o.matrix_basis
        if o.type == 'MESH':
            for corner in o.bound_box:
                pts.append(m @ Vector(corner))
        for c in o.children:
            walk(c, m)

    walk(root_obj, root_obj.matrix_world.inverted())
    if not pts:
        return None
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return {'min': [round(v, 4) for v in lo], 'max': [round(v, 4) for v in hi], 'size': [round(v, 4) for v in (hi - lo)]}

bounds = {name: root_bbox(obj) for name, obj in ROOTS.items() if obj}
for name, bb in bounds.items():
    print(f"[BOUNDS] {name}: size={bb['size']} zmin={bb['min'][2]}", flush=True)
check('bounds_computed', all(bounds.values()), json.dumps(bounds))
check('blend_not_exported_into_glb', 'DisplayOnly' not in str(root_transforms), 'display copies excluded')

# ---------------------------------------------------------------- report (LAST)
renders = [f for f in sorted(os.listdir(OUT)) if f.endswith('.png')]
files = []
for fname in ['immersion-props.blend', 'immersion-props.glb'] + renders:
    p = os.path.join(OUT, fname)
    if os.path.exists(p):
        files.append({'name': fname, 'sha256': sha256_file(p), 'bytes': os.path.getsize(p),
                      'role': 'blend_source' if fname.endswith('.blend')
                              else ('glb_pack' if fname.endswith('.glb') else 'render_check')})

report = {
    'run_id': RUN_ID,
    'generated_at': datetime.now(timezone.utc).isoformat(),
    'blender_version': bpy.app.version_string,
    'script_sha256': sha256_file(os.path.abspath(__file__)),
    'files': files,
    'roots': {name: {'pivots': [c.name for c in obj.children
                                if c.name.endswith('_pivot') or c.name.endswith('_anchor')]}
              for name, obj in ROOTS.items() if obj},
    'glb': {
        'node_count': len(node_names),
        'mesh_count': len(gltf.get('meshes', [])),
        'material_count': len(gltf.get('materials', [])),
        'root_nodes': root_transforms,
        'extensions_used': extensions_used,
    },
    'bounds': bounds,
    'renders': renders,
    'checks': CHECKS,
}
report_path = os.path.join(OUT, 'asset-report.json')
with open(report_path, 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print('[DONE] asset-report.json written', flush=True)
sys.exit(1 if any(not c['passed'] for c in CHECKS) else 0)
