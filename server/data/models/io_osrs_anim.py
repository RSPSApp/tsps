# Blender 2.79 add-on: File > Import / Export > OSRS animation (seq.dat)
#
# Reads an OSRS frame animation extracted from the cache as a folder:
#   seq.dat               the sequence definition (config archive 12): frame list and lengths
#   framemap-<id>.dat     the frame map (index 1): slots, each a transform type and the labels it moves
#   frames/<g>-<f>.dat    the frames (index 0, group g, file f): per slot, the values for that frame
# and writes the same layout back. Skeletal animations (newer content) are not supported.
#
# How the game animates: a model's vertices carry labels (the OSRS model add-on imports them as
# vertex groups "label_<n>", and faces as the face layer osrs_face_label). Each frame walks the
# frame map's slots in order, and every slot the frame uses moves the vertices of its labels:
#   origin  - sets the pivot to the middle of its labels' vertices (plus an offset)
#   move    - moves them
#   rotate  - turns them about the pivot (z roll, then x pitch, then y yaw; 256 steps per turn)
#   scale   - scales them about the pivot (128 = unchanged)
#   alpha   - makes the faces of its face labels more transparent, 8/255 per step
#
# In Blender:
# - select the model(s) to animate (imported with the OSRS model add-on; several parts are animated
#   as one model, as the game merges them), then File > Import > OSRS animation and pick seq.dat;
# - an Empty "<name> anim" holds the animation. Each slot the frames use gets a control Empty under
#   it, named "s<slot> <type> <labels>": rotate one (Euler YXZ) to rotate its labels, move one to
#   move them, scale one to scale them. Alpha and other slots use the control's custom properties
#   "x", "y", "z". Keyframe them as usual (keys are CONSTANT, as the game shows frames);
# - one Blender frame is one client tick (20 ms, 50 fps). Each keyframe of the anim Empty's
#   "osrs_frame" property starts a game frame; move those keys in the Dope Sheet to retime, and use
#   the OSRS panel's Add / Remove frame. "last_frame_length" is the last frame's length;
# - the preview: the models are hidden and "<model> (pose)" copies show the pose at the current
#   frame, updated as you edit. Controls sit at their pivots. Tool Shelf > OSRS > Preview turns it
#   off (shows the original models again, e.g. to edit or export them).
#
# Export (File > Export > OSRS animation) writes seq.dat with its frames and frame map next to it.
# Frames keep their file ids; changed or new frames that clash get new file ids in the same group.
# Every other part of seq.dat (hand items, priorities, sounds, masks) is kept as it was.
#
# Install: File > User Preferences > Add-ons > Install Add-on from File..., pick this file, tick it.

bl_info = {
    "name": "OSRS animation (seq.dat)",
    "author": "tsps",
    "version": (1, 0, 0),
    "blender": (2, 79, 0),
    "location": "File > Import / Export > OSRS animation; 3D View > Tool Shelf > OSRS",
    "description": "Import, preview, edit and export OSRS frame animations",
    "category": "Import-Export",
}

import json
import math
import os
import re
import struct

# ---------------------------------------------------------------------------------------------
# Codec (no Blender needed)

ORIGIN, TRANSLATE, ROTATE, SCALE, ALPHA, TYPE_6, LIGHT, TYPE_10 = 0, 1, 2, 3, 5, 6, 7, 10
TYPE_NAMES = {ORIGIN: "origin", TRANSLATE: "move", ROTATE: "rotate", SCALE: "scale", ALPHA: "alpha",
              LIGHT: "light", TYPE_10: "type10"}


def neutral(kind):
    return 128 if kind in (SCALE, TYPE_10) else 0


class FrameMap(object):
    """A frame map (index 1): an ordered list of slots, each a transform type and the labels it moves."""

    def __init__(self, data):
        self.data = bytes(data)
        d = self.data
        count = d[0]
        o = 1
        self.raw_types = list(d[o:o + count])
        o += count
        self.types = [ROTATE if t == TYPE_6 else t for t in self.raw_types]
        lengths = list(d[o:o + count])
        o += count
        self.labels = []
        for n in lengths:
            self.labels.append(list(d[o:o + n]))
            o += n
        self.tail = d[o:]  # skeletal base, if any (kept as is)

    @property
    def count(self):
        return len(self.types)


def _read_smart2(d, o):
    if d[o] < 128:
        return d[o] - 64, o + 1
    return ((d[o] << 8) | d[o + 1]) - 49152, o + 2


def _write_smart2(out, v):
    if -64 <= v < 64:
        out.append(v + 64)
    elif -16384 <= v < 16384:
        v += 49152
        out.append((v >> 8) & 0xff)
        out.append(v & 0xff)
    else:
        raise ValueError("frame value %d is out of range (-16384..16383)" % v)


def steps_for(fm, present):
    """The transforms the client applies, in order, as (slot, type, x, y, z), for the slots in
    `present` (slot -> (x, y, z)). An origin slot left out is applied with 0, 0, 0 before the first
    move / rotate / scale after it (as Dat2SeqFrame and Model.transformInterpolated do)."""
    result = []
    reset, last_reset = -1, -1
    for i in range(fm.count):
        kind = fm.types[i]
        if kind == ORIGIN:
            reset = i
        if i not in present:
            continue
        if kind == ORIGIN:
            last_reset = i
        if kind in (TRANSLATE, ROTATE, SCALE) and reset > last_reset:
            result.append((reset, ORIGIN, 0, 0, 0))
            last_reset = reset
        x, y, z = present[i]
        result.append((i, kind, x, y, z))
    return result


class Frame(object):
    """One frame (index 0 file): for each frame map slot, its flag (bits 1/2/4: x/y/z stored) and values.
    A frame file may list fewer slots than its frame map has (`count`); the rest are unused."""

    def __init__(self, framemap_id, flags, values, count=None):
        self.framemap_id = framemap_id
        self.flags = flags      # per frame map slot
        self.values = values    # per frame map slot: [x, y, z] (neutral where not stored)
        self.count = len(flags) if count is None else count

    @staticmethod
    def decode(data, framemaps):
        d = bytes(data)
        fm_id = (d[0] << 8) | d[1]
        fm = framemaps[fm_id]
        count = d[2]
        flags = list(d[3:3 + count])
        o = 3 + count
        values = []
        for i in range(count):
            n = neutral(fm.types[i])
            v = [n, n, n]
            for axis in range(3):
                if flags[i] & (1 << axis):
                    v[axis], o = _read_smart2(d, o)
            values.append(v)
        if count and o != len(d):
            raise ValueError("frame has %d bytes, read %d" % (len(d), o))
        for i in range(count, fm.count):
            n = neutral(fm.types[i])
            flags.append(0)
            values.append([n, n, n])
        return Frame(fm_id, flags, values, count)

    def encode(self):
        used = [i for i, flag in enumerate(self.flags) if flag]
        count = max([self.count] + [i + 1 for i in used])
        if count > 255:
            raise ValueError("a frame can list at most 255 slots")
        out = bytearray([(self.framemap_id >> 8) & 0xff, self.framemap_id & 0xff, count])
        out.extend(self.flags[:count] + [0] * (count - len(self.flags)))
        for i, flag in enumerate(self.flags[:count]):
            for axis in range(3):
                if flag & (1 << axis):
                    _write_smart2(out, int(self.values[i][axis]))
        return bytes(out)

    def present(self):
        return dict((i, tuple(self.values[i])) for i, flag in enumerate(self.flags) if flag)

    def steps(self, fm):
        return steps_for(fm, self.present())


class Seq(object):
    """A sequence definition (config archive 12, rev 226+ opcodes). Only the frame list (opcode 1) is
    edited; every other opcode is kept byte for byte."""

    def __init__(self, data):
        self.data = bytes(data)
        d = self.data
        o = 0
        self.ops = []  # (opcode, raw payload) in order
        self.frame_lengths, self.frame_ids = [], []
        self.left_hand = self.right_hand = None
        self.skeletal = -1

        def u16(p):
            return (d[p] << 8) | d[p + 1]
        while o < len(d):
            op = d[o]
            o += 1
            if op == 0:
                break
            start = o
            if op == 1:
                n = u16(o)
                o += 2
                self.frame_lengths = [u16(o + 2 * k) for k in range(n)]
                o += 2 * n
                low = [u16(o + 2 * k) for k in range(n)]
                o += 2 * n
                high = [u16(o + 2 * k) for k in range(n)]
                o += 2 * n
                self.frame_ids = [(h << 16) | l for l, h in zip(low, high)]
            elif op in (2, 6, 7):
                if op == 6:
                    self.left_hand = u16(o)
                if op == 7:
                    self.right_hand = u16(o)
                o += 2
            elif op in (3, 17):
                o += 1 + d[o]
            elif op in (4, 19):
                pass
            elif op in (5, 8, 9, 10, 11, 16):
                o += 1
            elif op == 12:
                o += 1 + d[o] * 4
            elif op == 13:
                self.skeletal = struct.unpack(">i", d[o:o + 4])[0]
                o += 4
            elif op == 14:
                o += 2 + u16(o) * 8
            elif op == 15:
                o += 4
            elif op == 18:
                while d[o] != 0:
                    o += 1
                o += 1
            else:
                raise ValueError("unknown sequence opcode %d" % op)
            self.ops.append((op, d[start:o]))

    def encode(self):
        out = bytearray()
        wrote_frames = False
        for op, payload in self.ops:
            if op == 1:
                payload = self._frames_payload()
                wrote_frames = True
            out.append(op)
            out.extend(payload)
        if not wrote_frames and self.frame_ids:
            out.append(1)
            out.extend(self._frames_payload())
        out.append(0)
        return bytes(out)

    def _frames_payload(self):
        n = len(self.frame_ids)
        out = bytearray(struct.pack(">H", n))
        for v in self.frame_lengths:
            out.extend(struct.pack(">H", v))
        for v in self.frame_ids:
            out.extend(struct.pack(">H", v & 0xffff))
        for v in self.frame_ids:
            out.extend(struct.pack(">H", v >> 16))
        return bytes(out)


def _frame_file(folder, frame_id):
    return os.path.join(folder, "frames", "%d-%d.dat" % (frame_id >> 16, frame_id & 0xffff))


class Animation(object):
    """An extracted animation folder: seq.dat, framemap-<id>.dat, frames/<group>-<file>.dat."""

    def __init__(self, folder):
        self.folder = folder
        with open(os.path.join(folder, "seq.dat"), "rb") as f:
            self.seq = Seq(f.read())
        if self.seq.skeletal != -1:
            raise ValueError("this is a skeletal animation (%d); only frame animations are supported"
                             % self.seq.skeletal)
        self.framemaps = {}
        for name in os.listdir(folder):
            m = re.match(r"^framemap-(\d+)\.dat$", name)
            if m:
                with open(os.path.join(folder, name), "rb") as f:
                    self.framemaps[int(m.group(1))] = FrameMap(f.read())
        self.frames = []
        for frame_id in self.seq.frame_ids:
            with open(_frame_file(folder, frame_id), "rb") as f:
                self.frames.append(Frame.decode(f.read(), self.framemaps))
        ids = set(frame.framemap_id for frame in self.frames)
        if len(ids) != 1:
            raise ValueError("frames use %d frame maps; one is supported" % len(ids))
        self.framemap_id = ids.pop()

    def save(self, folder):
        write_animation(folder, self.seq, self.framemap_id, self.framemaps[self.framemap_id],
                        dict(zip(self.seq.frame_ids, self.frames)))


def write_animation(folder, seq, framemap_id, framemap, frames_by_id, info=None):
    if not os.path.isdir(os.path.join(folder, "frames")):
        os.makedirs(os.path.join(folder, "frames"))
    with open(os.path.join(folder, "seq.dat"), "wb") as f:
        f.write(seq.encode())
    with open(os.path.join(folder, "framemap-%d.dat" % framemap_id), "wb") as f:
        f.write(framemap.data)
    for frame_id, frame in frames_by_id.items():
        with open(_frame_file(folder, frame_id), "wb") as f:
            f.write(frame.encode() if isinstance(frame, Frame) else frame)
    if info is not None:
        with open(os.path.join(folder, "info.json"), "w") as f:
            json.dump(info, f, indent=2, sort_keys=True)
            f.write("\n")


def wrap_angle(v):
    return ((int(v) + 128) % 256) - 128


# ---------------------------------------------------------------------------------------------
# Blender

try:
    import bpy
except ImportError:  # the codec above is usable (and tested) without Blender
    bpy = None

if bpy is not None:
    from bpy.app.handlers import persistent
    from bpy.props import BoolProperty, IntProperty, StringProperty
    from bpy_extras.io_utils import ExportHelper, ImportHelper
    from mathutils import Matrix, Vector

    SCALE_UNITS = 128.0
    ANGLE = 256.0 / (2.0 * math.pi)   # OSRS rotation steps per radian
    LABEL_PREFIX = "label_"
    ROOT_KEY = "osrs_anim"
    FRAME_KEY = "osrs_frame"
    SLOT_KEY = "osrs_slot"
    PREVIEW_OF = "osrs_preview_of"
    POSE_SUFFIX = " (pose)"
    DRAW = {ORIGIN: ('PLAIN_AXES', 0.06), TRANSLATE: ('ARROWS', 0.1), ROTATE: ('SPHERE', 0.05),
            SCALE: ('CUBE', 0.04), ALPHA: ('CIRCLE', 0.08)}

    def to_blender(x, y, z):
        return Vector((x / SCALE_UNITS, z / SCALE_UNITS, -y / SCALE_UNITS))

    # -- roots and controls ----------------------------------------------------------------

    def anim_data(root):
        return json.loads(root[ROOT_KEY])

    _framemap_cache = {}

    def root_framemap(root):
        hexdata = anim_data(root)["framemap_hex"]
        fm = _framemap_cache.get(hexdata)
        if fm is None:
            fm = FrameMap(bytes.fromhex(hexdata))
            _framemap_cache.clear()
            _framemap_cache[hexdata] = fm
        return fm

    def find_root(context, obj=None):
        obj = obj or context.active_object
        while obj is not None:
            if ROOT_KEY in obj.keys():
                return obj
            if PREVIEW_OF in obj.keys():
                obj = None
                break
            obj = obj.parent
        roots = [o for o in context.scene.objects if ROOT_KEY in o.keys()]
        if obj is None and len(roots) == 1:
            return roots[0]
        return None

    def controls(root):
        return sorted((c for c in root.children if SLOT_KEY in c.keys()), key=lambda c: c[SLOT_KEY])

    def targets(root):
        names = json.loads(root.get("osrs_targets", "[]"))
        return [bpy.data.objects[n] for n in names if n in bpy.data.objects]

    def control_name(prefix, slot, kind, labels):
        shown = " ".join(str(l) for l in labels[:6]) + (" .." if len(labels) > 6 else "")
        return "%s s%03d %s [%s]" % (prefix, slot, TYPE_NAMES.get(kind, "type%d" % kind), shown)

    def set_control(ctrl, kind, x, y, z):
        """Puts OSRS values on a control's channels."""
        if kind in (ORIGIN, TRANSLATE):
            ctrl.location = to_blender(x, y, z)
        elif kind == ROTATE:
            # OSRS (z roll, x pitch, y yaw) is Blender Euler YXZ with X = x, Y = -z, Z = -y.
            ctrl.rotation_euler = (wrap_angle(x) / ANGLE, -wrap_angle(z) / ANGLE, -wrap_angle(y) / ANGLE)
        elif kind == SCALE:
            ctrl.scale = (x / SCALE_UNITS, z / SCALE_UNITS, y / SCALE_UNITS)
        else:
            ctrl["x"], ctrl["y"], ctrl["z"] = int(x), int(y), int(z)

    def channels(kind):
        if kind in (ORIGIN, TRANSLATE):
            return ["location"]
        if kind == ROTATE:
            return ["rotation_euler"]
        if kind == SCALE:
            return ["scale"]
        return ['["x"]', '["y"]', '["z"]']

    def _channel(ctrl, path, index, frame):
        """A channel's value at `frame` from its F-curve, else its current value."""
        ad = ctrl.animation_data
        if frame is not None and ad is not None and ad.action is not None:
            fc = ad.action.fcurves.find(path, index if path.startswith(("loc", "rot", "sca")) else 0)
            if fc is not None:
                return fc.evaluate(frame)
        if path.startswith('["'):
            return float(ctrl.get(path[2:-2], 0))
        return getattr(ctrl, path)[index]

    def control_values(ctrl, kind, frame=None):
        """The control's OSRS values (floats), at `frame` from its keys, else as it is now."""
        if kind in (ORIGIN, TRANSLATE):
            lx, ly, lz = (_channel(ctrl, "location", i, frame) for i in range(3))
            return (lx * SCALE_UNITS, -lz * SCALE_UNITS, ly * SCALE_UNITS)
        if kind == ROTATE:
            ex, ey, ez = (_channel(ctrl, "rotation_euler", i, frame) for i in range(3))
            return (ex * ANGLE, -ez * ANGLE, -ey * ANGLE)
        if kind == SCALE:
            sx, sy, sz = (_channel(ctrl, "scale", i, frame) for i in range(3))
            return (sx * SCALE_UNITS, sz * SCALE_UNITS, sy * SCALE_UNITS)
        return tuple(_channel(ctrl, p, 0, frame) for p in ('["x"]', '["y"]', '["z"]'))

    def key_control(ctrl, kind, frame):
        for path in channels(kind):
            ctrl.keyframe_insert(data_path=path, frame=frame)

    def make_constant(obj):
        ad = obj.animation_data
        if ad is None or ad.action is None:
            return
        for fc in ad.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'CONSTANT'

    def new_control(context, root, fm, slot, prefix):
        kind = fm.types[slot]
        ctrl = bpy.data.objects.new(control_name(prefix, slot, kind, fm.labels[slot]), None)
        draw, size = DRAW.get(kind, ('SINGLE_ARROW', 0.06))
        ctrl.empty_draw_type = draw
        ctrl.empty_draw_size = size
        ctrl.show_x_ray = True
        ctrl.rotation_mode = 'YXZ'
        ctrl[SLOT_KEY] = slot
        ctrl["osrs_type"] = kind
        ctrl["osrs_labels"] = " ".join(str(l) for l in fm.labels[slot])
        context.scene.objects.link(ctrl)
        ctrl.parent = root
        n = neutral(kind)
        set_control(ctrl, kind, n, n, n)
        return ctrl

    def frame_starts(root):
        ad = root.animation_data
        if ad is None or ad.action is None:
            return []
        fc = ad.action.fcurves.find('["%s"]' % FRAME_KEY)
        if fc is None:
            return []
        return sorted(set(int(round(kp.co.x)) for kp in fc.keyframe_points))

    # -- import ----------------------------------------------------------------------------

    def import_animation(context, folder, objects, name=None):
        anim = Animation(folder)
        meshes = [o for o in objects if o.type == 'MESH']
        if not meshes:
            raise RuntimeError("select the model(s) to animate first")
        fm = anim.framemaps[anim.framemap_id]
        info_path = os.path.join(folder, "info.json")
        if name is None and os.path.exists(info_path):
            with open(info_path) as f:
                name = json.load(f).get("name")
        name = name or os.path.basename(os.path.normpath(folder))
        root = bpy.data.objects.new(name + " anim", None)
        root.empty_draw_type = 'ARROWS'
        root.empty_draw_size = 0.25
        context.scene.objects.link(root)
        root[ROOT_KEY] = json.dumps({
            "seq_hex": anim.seq.data.hex(),
            "framemap_id": anim.framemap_id,
            "framemap_hex": fm.data.hex(),
            "frames": [{"id": fid, "flags": fr.flags, "count": fr.count,
                        "values": dict((str(i), list(v)) for i, v in fr.present().items())}
                       for fid, fr in zip(anim.seq.frame_ids, anim.frames)],
        })
        root["osrs_targets"] = json.dumps([o.name for o in meshes])
        root["last_frame_length"] = anim.seq.frame_lengths[-1] if anim.seq.frame_lengths else 1
        root["osrs_preview"] = 1
        root[FRAME_KEY] = 0

        used = sorted(set(i for fr in anim.frames for i, flag in enumerate(fr.flags) if flag))
        prefix = name[:12].rstrip("_ ")
        ctrls = [new_control(context, root, fm, slot, prefix) for slot in used]
        t = 0
        for k, (frame, length) in enumerate(zip(anim.frames, anim.seq.frame_lengths)):
            root[FRAME_KEY] = k
            root.keyframe_insert(data_path='["%s"]' % FRAME_KEY, frame=t)
            for ctrl in ctrls:
                slot = ctrl[SLOT_KEY]
                set_control(ctrl, fm.types[slot], *frame.values[slot])
                key_control(ctrl, fm.types[slot], t)
            t += length
        for obj in [root] + ctrls:
            make_constant(obj)
        scene = context.scene
        scene.render.fps = 50
        scene.render.fps_base = 1.0
        scene.frame_start = 0
        scene.frame_end = max(0, t - 1)
        scene.frame_set(0)
        start_preview(context.scene, root)
        return root, anim

    # -- preview ---------------------------------------------------------------------------

    _label_cache = {}
    _signatures = {}

    def _labels_of(obj):
        """label -> vertex indices, face label -> face indices, for an object's mesh."""
        mesh = obj.data
        key = (obj.name, len(mesh.vertices), len(mesh.polygons), len(obj.vertex_groups))
        cached = _label_cache.get(obj.name)
        if cached and cached[0] == key:
            return cached[1], cached[2]
        groups = {}
        for g in obj.vertex_groups:
            if g.name.startswith(LABEL_PREFIX) and g.name[len(LABEL_PREFIX):].isdigit():
                groups[g.index] = int(g.name[len(LABEL_PREFIX):])
        verts = {}
        for v in mesh.vertices:
            for g in v.groups:
                label = groups.get(g.group)
                if label is not None and g.weight > 0:
                    verts.setdefault(label, []).append(v.index)
        faces = {}
        layer = mesh.polygon_layers_int.get("osrs_face_label")
        if layer is not None:
            for i, item in enumerate(layer.data):
                faces.setdefault(item.value, []).append(i)
        _label_cache[obj.name] = (key, verts, faces)
        return verts, faces

    def _pose_object(scene, obj):
        name = obj.name + POSE_SUFFIX
        pose = bpy.data.objects.get(name)
        if pose is not None and pose.get(PREVIEW_OF) == obj.name and len(pose.data.vertices) == len(obj.data.vertices) \
                and len(pose.data.polygons) == len(obj.data.polygons):
            if pose.name not in scene.objects:
                scene.objects.link(pose)
            return pose
        if pose is not None:
            old = pose.data
            bpy.data.objects.remove(pose, do_unlink=True)
            if old.users == 0:
                bpy.data.meshes.remove(old)
        mesh = obj.data.copy()
        mesh.name = name
        pose = bpy.data.objects.new(name, mesh)
        pose[PREVIEW_OF] = obj.name
        pose.hide_select = True
        pose.show_transparent = True
        scene.objects.link(pose)
        return pose

    def _alpha_material(base, alpha):
        name = "%s~a%d" % (base.name if base else "none", alpha)
        mat = bpy.data.materials.get(name)
        if mat is None:
            mat = base.copy() if base else bpy.data.materials.new(name)
            mat.name = name
            mat.use_transparency = True
            mat.transparency_method = 'Z_TRANSPARENCY'
            mat.alpha = 1.0 - alpha / 255.0
            mat["osrs_preview_material"] = 1
        return mat

    def start_preview(scene, root):
        root["osrs_preview"] = 1
        _signatures.pop(root.name, None)
        update_preview(scene, root, force=True)

    def stop_preview(scene, root):
        root["osrs_preview"] = 0
        _signatures.pop(root.name, None)
        for obj in targets(root):
            obj.hide = False
            obj.hide_render = False
            pose = bpy.data.objects.get(obj.name + POSE_SUFFIX)
            if pose is not None and pose.get(PREVIEW_OF) == obj.name:
                mesh = pose.data
                bpy.data.objects.remove(pose, do_unlink=True)
                if mesh.users == 0:
                    bpy.data.meshes.remove(mesh)

    def _signature(scene, root, ctrls):
        sig = [scene.frame_current, root.get("width_scale", 128), root.get("height_scale", 128),
               root.get("orientation", 0)]
        for c in ctrls:
            sig.append((c.name, tuple(c.location), tuple(c.rotation_euler), tuple(c.scale),
                        c.get("x"), c.get("y"), c.get("z")))
        for obj in targets(root):
            sig.append((obj.name, len(obj.data.vertices), tuple(obj.matrix_world.col[3])))
        return tuple(sig)

    def update_preview(scene, root, force=False):
        if not root.get("osrs_preview"):
            return
        fm = root_framemap(root)
        ctrls = controls(root)
        sig = _signature(scene, root, ctrls)
        if not force and _signatures.get(root.name) == sig:
            return
        _signatures[root.name] = sig
        objs = targets(root)
        # Every target as one model: OSRS coordinates of all their vertices, labels across all.
        xs, ys, zs = [], [], []
        vlabels, flabels, parts = {}, {}, []
        for obj in objs:
            mesh = obj.data
            n = len(mesh.vertices)
            co = [0.0] * (n * 3)
            mesh.vertices.foreach_get("co", co)
            mw = obj.matrix_world
            identity = mw == Matrix.Identity(4)
            base = len(xs)
            for i in range(n):
                v = Vector((co[3 * i], co[3 * i + 1], co[3 * i + 2]))
                if not identity:
                    v = mw * v
                xs.append(v.x * SCALE_UNITS)
                ys.append(-v.z * SCALE_UNITS)
                zs.append(v.y * SCALE_UNITS)
            verts, faces = _labels_of(obj)
            for label, indices in verts.items():
                vlabels.setdefault(label, []).extend(base + i for i in indices)
            for label, indices in faces.items():
                flabels.setdefault(label, []).extend((len(parts), i) for i in indices)
            parts.append((obj, base, n))

        present = {}
        for c in ctrls:
            present[c[SLOT_KEY]] = control_values(c, fm.types[c[SLOT_KEY]])
        face_alpha = {}  # (part, face) -> alpha change in 0-255 units, clamped as applied
        base_alpha = {}
        ox = oy = oz = 0.0
        pivots = {}
        for slot, kind, x, y, z in steps_for(fm, present):
            vs = []
            if kind != ALPHA:
                for label in fm.labels[slot]:
                    vs.extend(vlabels.get(label, ()))
            if kind == ORIGIN:
                if vs:
                    n = float(len(vs))
                    mx = sum(xs[v] for v in vs) / n
                    my = sum(ys[v] for v in vs) / n
                    mz = sum(zs[v] for v in vs) / n
                else:
                    mx = my = mz = 0.0
                pivots[slot] = (mx, my, mz)
                ox, oy, oz = x + mx, y + my, z + mz
            elif kind == TRANSLATE:
                if vs:
                    n = float(len(vs))
                    pivots[slot] = (sum(xs[v] for v in vs) / n, sum(ys[v] for v in vs) / n,
                                    sum(zs[v] for v in vs) / n)
                for v in vs:
                    xs[v] += x
                    ys[v] += y
                    zs[v] += z
            elif kind == ROTATE:
                pivots[slot] = (ox, oy, oz)
                if x == 0 and y == 0 and z == 0:
                    continue
                r = 2.0 * math.pi / 256.0
                sx, cx = math.sin(x * r), math.cos(x * r)
                sy, cy = math.sin(y * r), math.cos(y * r)
                sz, cz = math.sin(z * r), math.cos(z * r)
                for v in vs:
                    px, py, pz = xs[v] - ox, ys[v] - oy, zs[v] - oz
                    t = sz * py + cz * px
                    py = cz * py - sz * px
                    px = t
                    t = cx * py - sx * pz
                    pz = sx * py + cx * pz
                    py = t
                    t = sy * pz + cy * px
                    pz = cy * pz - sy * px
                    px = t
                    xs[v], ys[v], zs[v] = px + ox, py + oy, pz + oz
            elif kind == SCALE:
                pivots[slot] = (ox, oy, oz)
                fx, fy, fz = x / 128.0, y / 128.0, z / 128.0
                for v in vs:
                    xs[v] = (xs[v] - ox) * fx + ox
                    ys[v] = (ys[v] - oy) * fy + oy
                    zs[v] = (zs[v] - oz) * fz + oz
            elif kind == ALPHA:
                change = int(round(x)) * 8
                for label in fm.labels[slot]:
                    for key in flabels.get(label, ()):
                        if key not in face_alpha:
                            obj = parts[key[0]][0]
                            mat_index = obj.data.polygons[key[1]].material_index
                            mat = obj.data.materials[mat_index] if mat_index < len(obj.data.materials) else None
                            a = int(round((1.0 - mat.alpha) * 255)) if mat is not None and mat.use_transparency else 0
                            base_alpha[key] = (mat, a)
                            face_alpha[key] = a
                        face_alpha[key] = max(0, min(255, face_alpha[key] + change))

        # Controls sit where they act: rotate / scale at the pivot, move / origin on their part.
        for c in ctrls:
            slot = c[SLOT_KEY]
            p = pivots.get(slot)
            if p is None and fm.types[slot] == ALPHA:
                p = _face_centre(parts, flabels, fm.labels[slot], xs, ys, zs)
            if p is not None:
                target = to_blender(*p)
                if (Vector(c.delta_location) - target).length > 1e-6:
                    c.delta_location = target

        w = root.get("width_scale", 128) / 128.0
        h = root.get("height_scale", 128) / 128.0
        for obj, base, n in parts:
            pose = _pose_object(scene, obj)
            if not obj.hide or not obj.hide_render:
                obj.hide = obj.hide_render = True
            flat = [0.0] * (n * 3)
            for i in range(n):
                flat[3 * i] = xs[base + i] / SCALE_UNITS
                flat[3 * i + 1] = zs[base + i] / SCALE_UNITS
                flat[3 * i + 2] = -ys[base + i] / SCALE_UNITS
            pose.data.vertices.foreach_set("co", flat)
            pose.matrix_world = Matrix.Identity(4)
            pose.scale = (w, w, h)
            pose.rotation_euler = (0.0, 0.0, -math.radians(root.get("orientation", 0)))
            _apply_alpha(obj, pose, [(key[1], a) for key, a in face_alpha.items() if parts[key[0]][0] == obj],
                         base_alpha, parts.index((obj, base, n)))
            pose.data.update()

    def _face_centre(parts, flabels, labels, xs, ys, zs):
        total, count = [0.0, 0.0, 0.0], 0
        for label in labels:
            for part, face in flabels.get(label, ()):
                obj, base, n = parts[part]
                for v in obj.data.polygons[face].vertices:
                    total[0] += xs[base + v]
                    total[1] += ys[base + v]
                    total[2] += zs[base + v]
                    count += 1
        return tuple(t / count for t in total) if count else None

    def _apply_alpha(obj, pose, changes, base_alpha, part):
        mesh = pose.data
        n = len(mesh.polygons)
        indices = [0] * n
        obj.data.polygons.foreach_get("material_index", indices)
        # The pose mesh starts with the model's materials; alpha variants are added after them.
        while len(mesh.materials) > len(obj.data.materials):
            mesh.materials.pop(len(mesh.materials) - 1, update_data=True)
        for i, mat in enumerate(obj.data.materials):
            if mesh.materials[i] != mat:
                mesh.materials[i] = mat
        slots = {}
        for face, alpha in changes:
            mat, base = base_alpha[(part, face)]
            if alpha == base:
                continue
            key = (mat.name if mat else None, alpha)
            if key not in slots:
                mesh.materials.append(_alpha_material(mat, alpha))
                slots[key] = len(mesh.materials) - 1
            indices[face] = slots[key]
        mesh.polygons.foreach_set("material_index", indices)

    @persistent
    def _on_update(scene):
        for root in [o for o in scene.objects if ROOT_KEY in o.keys() and o.get("osrs_preview")]:
            try:
                update_preview(scene, root)
            except Exception as error:  # never break Blender's update loop
                print("OSRS animation preview:", error)

    # -- export ----------------------------------------------------------------------------

    def build_animation(root):
        """(Seq, framemap id, FrameMap, {frame id: Frame}, frame ids in order) from the root's keys."""
        data = anim_data(root)
        fm = root_framemap(root)
        fm_id = data["framemap_id"]
        seq = Seq(bytes.fromhex(data["seq_hex"]))
        original = data["frames"]
        starts = frame_starts(root)
        if not starts:
            raise RuntimeError("the animation has no frames (keys on %s)" % FRAME_KEY)
        ctrls = controls(root)
        by_slot = dict((c[SLOT_KEY], c) for c in ctrls)
        group = (original[0]["id"] >> 16) if original else 0
        next_file = max([f["id"] & 0xffff for f in original] + [-1]) + 1
        by_content, used, frame_ids, frames = {}, {}, [], {}
        for k, t in enumerate(starts):
            old = original[k] if k < len(original) else None
            flags = [0] * fm.count
            values = [[neutral(kind)] * 3 for kind in fm.types]
            for slot, ctrl in by_slot.items():
                kind = fm.types[slot]
                raw = [int(round(v)) for v in control_values(ctrl, kind, t)]
                old_values = old["values"].get(str(slot)) if old else None
                if kind == ROTATE:
                    for axis in range(3):
                        if old_values is not None and (raw[axis] - old_values[axis]) % 256 == 0:
                            raw[axis] = old_values[axis]
                        else:
                            raw[axis] = wrap_angle(raw[axis])
                flag = old["flags"][slot] if old and slot < len(old["flags"]) else 0
                for axis in range(3):
                    if raw[axis] != neutral(kind):
                        flag |= 1 << axis
                flags[slot] = flag
                values[slot] = raw
            count = old.get("count", fm.count) if old else (original[0].get("count", fm.count) if original else fm.count)
            frame = Frame(fm_id, flags, values, count)
            encoded = frame.encode()
            frame_id = by_content.get(encoded)
            if frame_id is None:
                wanted = old["id"] if old else None
                if wanted is not None and wanted not in used:
                    frame_id = wanted
                else:
                    frame_id = (group << 16) | next_file
                    next_file += 1
                used[frame_id] = frame
                by_content[encoded] = frame_id
            frame_ids.append(frame_id)
            frames[frame_id] = frame
        lengths = [b - a for a, b in zip(starts, starts[1:])] + [int(root.get("last_frame_length", 1))]
        seq.frame_ids = frame_ids
        seq.frame_lengths = [max(0, min(65535, n)) for n in lengths]
        return seq, fm_id, fm, frames

    def export_animation(root, folder):
        seq, fm_id, fm, frames = build_animation(root)
        write_animation(folder, seq, fm_id, fm, frames, info={
            "name": root.name[:-5] if root.name.endswith(" anim") else root.name,
            "frames": len(seq.frame_ids), "frameLengths": seq.frame_lengths, "framemaps": [fm_id]})
        return seq, frames

    # -- operators -------------------------------------------------------------------------

    class ImportOsrsAnim(bpy.types.Operator, ImportHelper):
        """Import an OSRS animation folder (pick its seq.dat) onto the selected model(s)"""
        bl_idname = "import_anim.osrs_seq"
        bl_label = "Import OSRS animation"
        bl_options = {'REGISTER', 'UNDO'}
        filename_ext = ".dat"
        filter_glob = StringProperty(default="seq.dat", options={'HIDDEN'})

        def execute(self, context):
            try:
                root, anim = import_animation(context, os.path.dirname(self.filepath), list(context.selected_objects))
            except Exception as error:
                self.report({'ERROR'}, "OSRS animation import failed: %s" % error)
                return {'CANCELLED'}
            self.report({'INFO'}, "%s: %d frames, %d ticks, %d controls" % (
                root.name, len(anim.frames), sum(anim.seq.frame_lengths), len(controls(root))))
            return {'FINISHED'}

    class ExportOsrsAnim(bpy.types.Operator, ExportHelper):
        """Export the active OSRS animation as seq.dat, its frames and frame map"""
        bl_idname = "export_anim.osrs_seq"
        bl_label = "Export OSRS animation"
        filename_ext = ".dat"
        filter_glob = StringProperty(default="seq.dat", options={'HIDDEN'})

        def invoke(self, context, event):
            self.filepath = "seq.dat"
            context.window_manager.fileselect_add(self)
            return {'RUNNING_MODAL'}

        def execute(self, context):
            root = find_root(context)
            if root is None:
                self.report({'ERROR'}, "select the animation (its Empty or a control) to export")
                return {'CANCELLED'}
            try:
                seq, frames = export_animation(root, os.path.dirname(self.filepath))
            except Exception as error:
                self.report({'ERROR'}, "OSRS animation export failed: %s" % error)
                return {'CANCELLED'}
            self.report({'INFO'}, "Wrote %d frames (%d files), %d ticks" % (
                len(seq.frame_ids), len(frames), sum(seq.frame_lengths)))
            return {'FINISHED'}

    class OsrsAnimPreview(bpy.types.Operator):
        """Show the pose on copies of the models (on), or the models themselves (off)"""
        bl_idname = "osrs_anim.preview"
        bl_label = "Toggle OSRS preview"
        bl_options = {'REGISTER', 'UNDO'}

        def execute(self, context):
            root = find_root(context)
            if root is None:
                return {'CANCELLED'}
            if root.get("osrs_preview"):
                stop_preview(context.scene, root)
            else:
                start_preview(context.scene, root)
            return {'FINISHED'}

    class OsrsAnimRefresh(bpy.types.Operator):
        """Re-read the models (after editing them) and redraw the pose"""
        bl_idname = "osrs_anim.refresh"
        bl_label = "Refresh OSRS preview"

        def execute(self, context):
            root = find_root(context)
            if root is None:
                return {'CANCELLED'}
            _label_cache.clear()
            stop_preview(context.scene, root)
            start_preview(context.scene, root)
            return {'FINISHED'}

    class OsrsAnimAddFrame(bpy.types.Operator):
        """Start a new game frame at the current Blender frame, keying every control as it is now"""
        bl_idname = "osrs_anim.add_frame"
        bl_label = "Add OSRS frame"
        bl_options = {'REGISTER', 'UNDO'}

        def execute(self, context):
            root = find_root(context)
            if root is None:
                return {'CANCELLED'}
            t = context.scene.frame_current
            root[FRAME_KEY] = len(frame_starts(root))
            root.keyframe_insert(data_path='["%s"]' % FRAME_KEY, frame=t)
            fm = root_framemap(root)
            for ctrl in controls(root):
                key_control(ctrl, fm.types[ctrl[SLOT_KEY]], t)
                make_constant(ctrl)
            make_constant(root)
            return {'FINISHED'}

    class OsrsAnimRemoveFrame(bpy.types.Operator):
        """Remove the game frame starting at the current Blender frame"""
        bl_idname = "osrs_anim.remove_frame"
        bl_label = "Remove OSRS frame"
        bl_options = {'REGISTER', 'UNDO'}

        def execute(self, context):
            root = find_root(context)
            t = context.scene.frame_current
            if root is None or t not in frame_starts(root):
                self.report({'WARNING'}, "no game frame starts at frame %d" % t)
                return {'CANCELLED'}
            root.keyframe_delete(data_path='["%s"]' % FRAME_KEY, frame=t)
            fm = root_framemap(root)
            for ctrl in controls(root):
                for path in channels(fm.types[ctrl[SLOT_KEY]]):
                    try:
                        ctrl.keyframe_delete(data_path=path, frame=t)
                    except RuntimeError:
                        pass
            return {'FINISHED'}

    class OsrsAnimAddControl(bpy.types.Operator):
        """Add a control for a frame map slot no frame uses yet"""
        bl_idname = "osrs_anim.add_control"
        bl_label = "Add OSRS control"
        bl_options = {'REGISTER', 'UNDO'}
        slot = IntProperty(name="Slot", min=0, default=0)

        def invoke(self, context, event):
            return context.window_manager.invoke_props_dialog(self)

        def execute(self, context):
            root = find_root(context)
            if root is None:
                return {'CANCELLED'}
            fm = root_framemap(root)
            if self.slot >= fm.count or any(c[SLOT_KEY] == self.slot for c in controls(root)):
                self.report({'ERROR'}, "slot %d is out of range or already has a control" % self.slot)
                return {'CANCELLED'}
            ctrl = new_control(context, root, fm, self.slot, (root.name[:-5] if root.name.endswith(" anim") else root.name)[:12].rstrip("_ "))
            for t in frame_starts(root):
                key_control(ctrl, fm.types[self.slot], t)
            make_constant(ctrl)
            return {'FINISHED'}

    class OsrsAnimPanel(bpy.types.Panel):
        bl_label = "OSRS animation"
        bl_space_type = 'VIEW_3D'
        bl_region_type = 'TOOLS'
        bl_category = "OSRS"

        def draw(self, context):
            layout = self.layout
            root = find_root(context)
            if root is None:
                layout.label("Select an animation (its Empty or a control)")
                layout.operator(ImportOsrsAnim.bl_idname, text="Import animation...")
                return
            starts = frame_starts(root)
            t = context.scene.frame_current
            current = len([s for s in starts if s <= t]) - 1
            layout.label(root.name)
            layout.label("Game frame %d of %d (%d ticks)" % (current, len(starts),
                         (starts[-1] - starts[0] + int(root.get("last_frame_length", 1))) if starts else 0))
            layout.prop(root, '["last_frame_length"]', text="Last frame length")
            row = layout.row(align=True)
            row.operator(OsrsAnimAddFrame.bl_idname, text="Add frame")
            row.operator(OsrsAnimRemoveFrame.bl_idname, text="Remove frame")
            row = layout.row(align=True)
            row.operator(OsrsAnimPreview.bl_idname, text="Preview: on" if root.get("osrs_preview") else "Preview: off")
            row.operator(OsrsAnimRefresh.bl_idname, text="Refresh")
            layout.operator(OsrsAnimAddControl.bl_idname, text="Add control for slot...")
            layout.operator(ExportOsrsAnim.bl_idname, text="Export animation...")
            ctrl = context.active_object
            if ctrl is not None and SLOT_KEY in ctrl.keys() and ctrl.parent == root:
                kind = ctrl.get("osrs_type", 0)
                box = layout.box()
                box.label("Slot %d: %s" % (ctrl[SLOT_KEY], TYPE_NAMES.get(kind, "type %d" % kind)))
                box.label("Labels: %s" % ctrl.get("osrs_labels", ""))
                values = [int(round(v)) for v in control_values(ctrl, kind)]
                box.label("Game values: %d, %d, %d" % tuple(values))
                if kind not in (ORIGIN, TRANSLATE, ROTATE, SCALE):
                    for axis in ("x", "y", "z"):
                        box.prop(ctrl, '["%s"]' % axis)
                    if kind == ALPHA:
                        box.label("x: transparency change, 8/255 per step")

    def menu_import(self, context):
        self.layout.operator(ImportOsrsAnim.bl_idname, text="OSRS animation (seq.dat)")

    def menu_export(self, context):
        self.layout.operator(ExportOsrsAnim.bl_idname, text="OSRS animation (seq.dat)")

    CLASSES = (ImportOsrsAnim, ExportOsrsAnim, OsrsAnimPreview, OsrsAnimRefresh, OsrsAnimAddFrame,
               OsrsAnimRemoveFrame, OsrsAnimAddControl, OsrsAnimPanel)

    def register():
        for cls in CLASSES:
            bpy.utils.register_class(cls)
        bpy.types.INFO_MT_file_import.append(menu_import)
        bpy.types.INFO_MT_file_export.append(menu_export)
        for handlers in (bpy.app.handlers.frame_change_post, bpy.app.handlers.scene_update_post):
            if _on_update not in handlers:
                handlers.append(_on_update)

    def unregister():
        for handlers in (bpy.app.handlers.frame_change_post, bpy.app.handlers.scene_update_post):
            if _on_update in handlers:
                handlers.remove(_on_update)
        bpy.types.INFO_MT_file_import.remove(menu_import)
        bpy.types.INFO_MT_file_export.remove(menu_export)
        for cls in reversed(CLASSES):
            bpy.utils.unregister_class(cls)


if __name__ == "__main__" and bpy is not None:
    register()
