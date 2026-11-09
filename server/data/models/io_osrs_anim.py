# Blender 2.79 add-on: File > Import / Export > OSRS animation (seq.dat)
#
# Imports an OSRS frame animation as an ordinary Blender armature animation, and exports it back.
#
# An extracted animation is a folder:
#   seq.dat               the sequence definition (config archive 12): frame list and lengths
#   framemap-<id>.dat     the frame map (index 1): slots, each a transform type and the labels it moves
#   frames/<g>-<f>.dat    the frames (index 0, group g, file f): per slot, the values for that frame
# Skeletal animations (some newer content) are not supported.
#
# How the game stores it: a model's vertices carry labels (the OSRS model add-on imports them as
# vertex groups "label_<n>"). The frame map is a list of instructions ("slots"): set a pivot, then
# move / rotate / scale these labels, or fade these faces. Each frame gives the numbers.
#
# How it looks in Blender:
# - select the model(s) (imported with the OSRS model add-on; a player's body and equipment are one
#   model in game, so select all their parts), then File > Import > OSRS animation, pick seq.dat;
# - an armature "<name> rig" is made from the frame map: one bone per part the slots move (Body,
#   Torso, Head, Right upper arm, Right forearm, Right hand, Weapon, ... for players), nested like
#   the parts are. The model gets an Armature modifier and a vertex group per bone;
# - each game frame becomes a pose, keyed on the bones. Animate in Pose Mode as usual. Bones only
#   allow what the game can do (channels it can't animate are locked). Parts that only stretch
#   have their own "<part> scale" bone;
# - fades (graphics often fade parts in and out) are the rig's "Fade" properties, in
#   Tool Shelf > OSRS; the faces they act on show their transparency in Material/Textured view;
# - one Blender frame is one client tick (20 ms; the scene is set to 50 fps). Each keyframe of the
#   rig's "osrs_frame" property starts a game frame: move those keys in the Dope Sheet to retime,
#   and use Tool Shelf > OSRS > Add frame / Remove frame. Between game frames, Blender's
#   interpolation is only for viewing: the game gets the pose at the start of each game frame.
#
# Export (File > Export > OSRS animation, or Tool Shelf > OSRS) writes seq.dat with its frames and
# frame map next to it. Unchanged frames are written exactly as they were; changed ones are
# converted back to the game's instructions (rotations in steps of 1.4 degrees, positions in
# 1/128 of a tile), and the report says how far the game's pose is from Blender's.
#
# Install: File > User Preferences > Add-ons > Install Add-on from File..., pick this file, tick it.

bl_info = {
    "name": "OSRS animation (seq.dat)",
    "author": "tsps",
    "version": (2, 0, 0),
    "blender": (2, 79, 0),
    "location": "File > Import / Export > OSRS animation; 3D View > Tool Shelf > OSRS",
    "description": "Import OSRS frame animations as armature animations, edit them and export them back",
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
# Rigs: which frame map slots become bones, and their names

def _trail_rig():
    names = {60: "Trail scale", 61: "Trail", 62: "Trail", 63: "Fade all", 58: "Fade 20"}
    for k in range(19):
        names[3 * k + 1] = "Section %d" % (k + 1)
        names[3 * k + 2] = "Fade %d" % (k + 1)
    return names


# Frame map 0 is every player animation's skeleton. It holds an older skeleton too (slots below
# 123); only the newer one, which current animations use, is made into bones. Right is the side
# that holds the weapon (OSRS -x).
RIGS = {
    0: {
        209: "Body", 210: "Body", 215: "Body scale",
        206: "Torso", 207: "Torso scale",
        202: "Head", 203: "Head scale",
        166: "Right upper arm", 163: "Right forearm", 160: "Right hand",
        156: "Weapon", 158: "Weapon", 157: "Weapon scale",
        154: "Weapon part 1", 152: "Weapon part 2", 150: "Weapon part 3", 148: "Weapon part 4",
        146: "Weapon part 5", 144: "Weapon part 6", 142: "Weapon part 7",
        140: "Left upper arm", 137: "Left forearm", 134: "Left hand",
        129: "Left hand item", 131: "Left hand item", 130: "Left hand item scale",
        127: "Left hand item 2", 125: "Left hand item 3",
        184: "Right thigh", 181: "Right shin", 178: "Right foot",
        175: "Left thigh", 172: "Left shin", 169: "Left foot",
        195: "Cape", 196: "Cape scale", 192: "Cape 2", 189: "Cape 3", 186: "Cape 4",
    },
    1581: _trail_rig(),  # the Zamorak godsword special's sword trail
}


def slot_name(fm_id, slot, kind):
    name = RIGS.get(fm_id, {}).get(slot)
    if name:
        return name
    if kind == ALPHA:
        return "Fade %d" % slot
    return "Part %d%s" % (slot, " scale" if kind == SCALE else "")


class Bone(object):
    def __init__(self, labels):
        self.labels = labels          # frozenset of model labels it moves
        self.slots = []               # its frame map slots, in order: move / rotate, or one scale
        self.parent = None            # index into Skeleton.bones
        self.index = -1
        self.name = ""

    def is_scale(self, fm):
        return any(fm.types[s] == SCALE for s in self.slots)


class Skeleton(object):
    """Bones made from a frame map's move / rotate / scale slots, for the labels a model has.

    A bone is a set of labels (the model's) and the slots that move exactly that set: a move and a
    rotate together, or one scale (alone, so that a stretch never shears a rotated bone). Sets must
    nest (disjoint, or one inside the other: hand inside arm), and a bone's slots must not be split
    by another overlapping bone's slots. Then every vertex's slots are one chain of bones, and each
    frame is exactly a pose, whatever order the game applies the parts in. Bones with the same set
    chain up with the one the game applies last as the parent.

    Slots the frames use always count; a known rig (RIGS) adds its other slots, so parts the
    animation doesn't move can be posed too. Used slots that don't fit are `loose`: kept as they
    are on export, but not shown."""

    def __init__(self, fm, fm_id, present, used):
        self.fm = fm
        self.bones = []
        self.loose = []
        rig = RIGS.get(fm_id, {})
        movers = [s for s in range(fm.count) if fm.types[s] in (TRANSLATE, ROTATE, SCALE)]
        order = [s for s in movers if s in used] + [s for s in movers if s not in used and s in rig]
        for s in order:
            labels = frozenset(fm.labels[s]) & present
            if not labels:
                if s in used:
                    self.loose.append(s)
                continue
            if not self._add(s, labels) and s in used:
                self.loose.append(s)
        for b in self.bones:
            b.slots.sort()
        self._link()
        taken = set()
        for b in sorted(self.bones, key=lambda b: b.slots[0]):
            name = slot_name(fm_id, b.slots[0], fm.types[b.slots[0]])
            if name in taken and fm.types[b.slots[0]] == TRANSLATE:
                name += " move"
            base, n = name, 2
            while name in taken:
                name = "%s %d" % (base, n)
                n += 1
            taken.add(name)
            b.name = name

    def _add(self, slot, labels):
        kind = self.fm.types[slot]
        if kind != SCALE:
            for b in self.bones:
                if b.labels == labels and not b.is_scale(self.fm) and \
                        kind not in [self.fm.types[s] for s in b.slots]:
                    b.slots.append(slot)
                    if self._consistent():
                        return True
                    b.slots.remove(slot)
        b = Bone(labels)
        b.slots.append(slot)
        self.bones.append(b)
        if self._consistent():
            return True
        self.bones.pop()
        return False

    def _consistent(self):
        bones = self.bones
        for i, a in enumerate(bones):
            lo, hi = min(a.slots), max(a.slots)
            for b in bones[i + 1:]:
                common = a.labels & b.labels
                if not common:
                    continue
                if common != a.labels and common != b.labels:
                    return False  # overlapping but not nested
                blo, bhi = min(b.slots), max(b.slots)
                if any(lo < s < hi for s in b.slots) or any(blo < s < bhi for s in a.slots):
                    return False  # one bone's slots inside the other's
        return True

    def _link(self):
        # Parents first: bigger sets, and for equal sets the one applied last.
        self.bones.sort(key=lambda b: (-len(b.labels), -min(b.slots)))
        for i, b in enumerate(self.bones):
            b.index = i
        for i, b in enumerate(self.bones):
            best = None
            for j in range(i):
                c = self.bones[j]
                if b.labels <= c.labels and (best is None or len(c.labels) <= len(self.bones[best].labels)):
                    best = j
            b.parent = best

    def ancestors(self, i):
        """Bone i's ancestors, root first (without i)."""
        out = []
        p = self.bones[i].parent
        while p is not None:
            out.append(p)
            p = self.bones[p].parent
        return out[::-1]

    def deepest(self, label):
        best = None
        for b in self.bones:
            if label in b.labels:
                best = b.index  # later bones in the list are deeper
        return best

    def origin_for(self, slot):
        """The origin slot whose labels give this slot's pivot (the last origin slot before it)."""
        for s in range(slot - 1, -1, -1):
            if self.fm.types[s] == ORIGIN:
                return s
        return None


# ---------------------------------------------------------------------------------------------
# Blender

try:
    import bpy
except ImportError:  # the codec above is usable (and tested) without Blender
    bpy = None

if bpy is not None:
    from bpy.props import StringProperty
    from bpy_extras.io_utils import ExportHelper, ImportHelper
    from mathutils import Euler, Matrix, Vector

    UNITS = 128.0                     # OSRS units per Blender unit (one tile)
    ANGLE = 256.0 / (2.0 * math.pi)   # OSRS rotation steps per radian
    LABEL_PREFIX = "label_"
    ROOT_KEY = "osrs_anim"
    FRAME_KEY = "osrs_frame"
    FADE_PREFIX = "fade_s"
    MODIFIER = "OSRS animation"
    FADE_MATERIAL_KEY = "osrs_material"   # on fade material copies: the model material they copy

    def to_blender(x, y, z):
        return Vector((x / UNITS, z / UNITS, -y / UNITS))

    def from_blender(v):
        return (v.x * UNITS, -v.z * UNITS, v.y * UNITS)

    def op_matrix(kind, x, y, z, pivot):
        """One game transform as a 4x4 matrix in Blender (armature) space."""
        if kind == TRANSLATE:
            return Matrix.Translation(to_blender(x, y, z))
        if kind == ROTATE:
            # OSRS (z roll, x pitch, y yaw) is Blender Euler YXZ with X = x, Y = -z, Z = -y.
            linear = Euler((x / ANGLE, -z / ANGLE, -y / ANGLE), 'YXZ').to_matrix().to_4x4()
        elif kind == SCALE:
            linear = Matrix.Identity(4)
            linear[0][0], linear[1][1], linear[2][2] = x / 128.0, z / 128.0, y / 128.0
        else:
            return Matrix.Identity(4)
        return Matrix.Translation(pivot) * linear * Matrix.Translation(-pivot)

    def compose(matrices):
        """Matrices in the order they are applied -> one matrix."""
        out = Matrix.Identity(4)
        for m in matrices:
            out = m * out
        return out

    class Sim(object):
        """Runs frames as the game does, on the rest model (Blender coordinates)."""

        def __init__(self, fm, rest, vlabels):
            self.fm = fm
            self.rest = rest            # list of Vector
            self.vlabels = vlabels      # label -> vertex indices

        def verts(self, slot):
            out = []
            for label in self.fm.labels[slot]:
                out.extend(self.vlabels.get(label, ()))
            return out

        def mean(self, pos, slot):
            vs = self.verts(slot)
            if not vs:
                return Vector((0.0, 0.0, 0.0))
            total = Vector((0.0, 0.0, 0.0))
            for v in vs:
                total += pos[v]
            return total / len(vs)

        def run(self, present):
            """(final positions, {slot: matrix}) for a frame's slots (slot -> (x, y, z))."""
            pos = [v.copy() for v in self.rest]
            mats = {}
            pivot = Vector((0.0, 0.0, 0.0))
            for slot, kind, x, y, z in steps_for(self.fm, present):
                if kind == ORIGIN:
                    pivot = self.mean(pos, slot) + to_blender(x, y, z)
                    continue
                if kind not in (TRANSLATE, ROTATE, SCALE):
                    continue
                m = op_matrix(kind, x, y, z, pivot)
                for v in self.verts(slot):
                    pos[v] = m * pos[v]
                mats[slot] = m
            return pos, mats

    # -- the model -------------------------------------------------------------------------

    class Model(object):
        """The target meshes as one model, in the rig's (armature) space."""

        def __init__(self, objects, space=None):
            self.objects = objects
            inverse = space.inverted() if space is not None else Matrix.Identity(4)
            self.rest, self.vlabels, self.flabels, self.where = [], {}, {}, []
            for part, obj in enumerate(objects):
                mesh = obj.data
                to_space = inverse * obj.matrix_world
                groups = {}
                for g in obj.vertex_groups:
                    if g.name.startswith(LABEL_PREFIX) and g.name[len(LABEL_PREFIX):].isdigit():
                        groups[g.index] = int(g.name[len(LABEL_PREFIX):])
                for v in mesh.vertices:
                    index = len(self.rest)
                    self.rest.append(to_space * v.co)
                    self.where.append((part, v.index))
                    for g in v.groups:
                        label = groups.get(g.group)
                        if label is not None and g.weight > 0:
                            self.vlabels.setdefault(label, []).append(index)
                            break
                layer = mesh.polygon_layers_int.get("osrs_face_label")
                if layer is not None:
                    for i, item in enumerate(layer.data):
                        self.flabels.setdefault(item.value, []).append((part, i))

        def label_of(self, index):
            return self._label_by_index().get(index)

        def _label_by_index(self):
            if not hasattr(self, "_by_index"):
                self._by_index = {}
                for label, vs in self.vlabels.items():
                    for v in vs:
                        self._by_index[v] = label
            return self._by_index

    # -- the rig ---------------------------------------------------------------------------

    def anim_data(arm):
        return json.loads(arm[ROOT_KEY])

    def find_root(context, obj=None):
        obj = obj or context.active_object
        if obj is not None:
            if ROOT_KEY in obj.keys():
                return obj
            if obj.type == 'MESH':
                for mod in obj.modifiers:
                    if mod.type == 'ARMATURE' and mod.object is not None and ROOT_KEY in mod.object.keys():
                        return mod.object
        roots = [o for o in context.scene.objects if ROOT_KEY in o.keys()]
        return roots[0] if len(roots) == 1 else None

    def targets(arm):
        names = json.loads(arm.get("osrs_targets", "[]"))
        return [bpy.data.objects[n] for n in names if n in bpy.data.objects]

    def frame_starts(arm):
        ad = arm.animation_data
        if ad is None or ad.action is None:
            return []
        fc = ad.action.fcurves.find('["%s"]' % FRAME_KEY)
        if fc is None:
            return []
        return sorted(set(int(round(kp.co.x)) for kp in fc.keyframe_points))

    def _axis_direction(d):
        """The signed world axis nearest to d (scale bones stay axis-aligned, so a stretch along the
        game's axes is a plain scale on the bone)."""
        axis = max(range(3), key=lambda i: abs(d[i]))
        out = Vector((0.0, 0.0, 0.0))
        out[axis] = 1.0 if d[axis] >= 0 else -1.0
        return out

    def _build_rig(context, name, sk, model, fm):
        heads, tails = [], []
        for b in sk.bones:
            # The pivot the bone turns / scales about (its slots' origin), at rest.
            main = next((s for s in b.slots if fm.types[s] != TRANSLATE), b.slots[0])
            origin = sk.origin_for(main)
            centre = Vector((0.0, 0.0, 0.0))
            vs = [v for label in b.labels for v in model.vlabels.get(label, ())]
            for v in vs:
                centre += model.rest[v]
            centre /= max(1, len(vs))
            head = None
            if origin is not None and fm.types[main] != TRANSLATE:
                ovs = [v for label in fm.labels[origin] for v in model.vlabels.get(label, ())]
                if ovs:
                    head = sum((model.rest[v] for v in ovs), Vector((0.0, 0.0, 0.0))) / len(ovs)
            heads.append(head if head is not None else centre)
            tails.append(centre)
        arm_data = bpy.data.armatures.new(name)
        arm_data.draw_type = 'STICK'
        arm = bpy.data.objects.new(name, arm_data)
        arm.show_x_ray = True
        context.scene.objects.link(arm)
        for o in context.scene.objects:
            o.select = False
        arm.select = True
        context.scene.objects.active = arm
        bpy.ops.object.mode_set(mode='EDIT')
        edit = []
        for b in sk.bones:
            eb = arm_data.edit_bones.new(b.name)
            head = heads[b.index]
            children = [c.index for c in sk.bones if c.parent == b.index]
            target = None
            if children:
                target = sum((heads[c] for c in children), Vector((0.0, 0.0, 0.0))) / len(children)
            if target is None or (target - head).length < 0.03:
                target = tails[b.index]
            d = target - head
            if d.length < 0.03:
                d = Vector((0.0, 0.0, 0.12))
            if b.is_scale(fm):
                d = _axis_direction(d) * 0.06
            else:
                d = d.normalized() * max(0.04, min(d.length, 0.6))
            eb.head = head
            eb.tail = head + d
            eb.roll = 0.0
            eb.use_connect = False
            edit.append(eb)
        for b in sk.bones:
            if b.parent is not None:
                edit[b.index].parent = edit[b.parent]
        bpy.ops.object.mode_set(mode='OBJECT')
        for b in sk.bones:
            pb = arm.pose.bones[b.name]
            pb.rotation_mode = 'XYZ'
            kinds = set(fm.types[s] for s in b.slots)
            pb.lock_location = (TRANSLATE not in kinds,) * 3
            pb.lock_rotation = (ROTATE not in kinds,) * 3
            pb.lock_scale = (SCALE not in kinds,) * 3
        return arm

    def _bind(model, sk, arm):
        """Vertex groups named after the bones (each vertex to its deepest bone) and a modifier."""
        names = set(b.name for b in sk.bones)
        for part, obj in enumerate(model.objects):
            for mod in [m for m in obj.modifiers if m.type == 'ARMATURE']:
                obj.modifiers.remove(mod)
            for g in [g for g in obj.vertex_groups if g.name in names]:
                obj.vertex_groups.remove(g)
        groups = {}
        for label, vs in model.vlabels.items():
            bone = sk.deepest(label)
            if bone is None:
                continue
            for v in vs:
                part, index = model.where[v]
                key = (part, sk.bones[bone].name)
                groups.setdefault(key, []).append(index)
        for (part, name), indices in groups.items():
            obj = model.objects[part]
            group = obj.vertex_groups.get(name) or obj.vertex_groups.new(name)
            group.add(indices, 1.0, 'REPLACE')
        for obj in model.objects:
            mod = obj.modifiers.new(MODIFIER, 'ARMATURE')
            mod.object = arm
            mod.use_vertex_groups = True
            mod.use_bone_envelopes = False

    def _fade_materials(model, arm, fades, fm):
        """Faces a fade acts on get copies of their material whose alpha follows the fades."""
        by_label = {}
        for slot, prop in fades:
            for label in fm.labels[slot]:
                by_label.setdefault(label, []).append(prop)
        copies = {}
        for label, faces in model.flabels.items():
            props = by_label.get(label)
            if not props:
                continue
            for part, face in faces:
                obj = model.objects[part]
                mesh = obj.data
                poly = mesh.polygons[face]
                base = mesh.materials[poly.material_index] if poly.material_index < len(mesh.materials) else None
                if base is None or FADE_MATERIAL_KEY in base.keys():
                    continue
                key = (base.name, tuple(sorted(props)))
                mat = copies.get(key)
                if mat is None:
                    mat = _fade_material(base, props, arm)
                    copies[key] = mat
                names = [m.name if m is not None else None for m in mesh.materials]
                if mat.name not in names:
                    mesh.materials.append(mat)
                    names.append(mat.name)
                poly.material_index = names.index(mat.name)
        return len(copies)

    def _fade_material(base, props, arm):
        mat = base.copy()
        mat.name = (base.name + "~fade")[:60]
        mat[FADE_MATERIAL_KEY] = base.name
        alpha = int(round((1.0 - base.alpha) * 255)) if base.use_transparency else 0
        mat.use_transparency = True
        mat.transparency_method = 'Z_TRANSPARENCY'
        # alpha = 1 - (base + 8 * sum of fades) / 255: a sum driver through a straight line
        # (no Python expression, so it works without auto-run scripts).
        fc = mat.driver_add("alpha")
        drv = fc.driver
        drv.type = 'SUM'
        for prop in props:
            var = drv.variables.new()
            var.type = 'SINGLE_PROP'
            var.targets[0].id_type = 'OBJECT'
            var.targets[0].id = arm
            var.targets[0].data_path = '["%s"]' % prop
        for mod in list(fc.modifiers):
            fc.modifiers.remove(mod)
        gen = fc.modifiers.new('GENERATOR')
        gen.mode = 'POLYNOMIAL'
        gen.poly_order = 1
        gen.coefficients = (1.0 - alpha / 255.0, -8.0 / 255.0)
        # The colour follows the model's material, so recolouring that still shows here.
        for i in range(3):
            fc = mat.driver_add("diffuse_color", i)
            drv = fc.driver
            drv.type = 'SUM'
            var = drv.variables.new()
            var.type = 'SINGLE_PROP'
            var.targets[0].id_type = 'MATERIAL'
            var.targets[0].id = base
            var.targets[0].data_path = "diffuse_color[%d]" % i
        return mat

    def _rest(arm, sk):
        return [arm.data.bones[b.name].matrix_local.copy() for b in sk.bones]

    def _skeleton_of(arm):
        data = anim_data(arm)
        fm = FrameMap(bytes.fromhex(data["framemap_hex"]))
        sk = Skeleton.__new__(Skeleton)
        sk.fm = fm
        sk.loose = data["loose"]
        sk.bones = []
        for i, item in enumerate(data["bones"]):
            b = Bone(frozenset(item["labels"]))
            b.slots, b.parent, b.index, b.name = item["slots"], item["parent"], i, item["name"]
            sk.bones.append(b)
        return data, fm, sk

    def _bone_matrices(sk, mats):
        """Each bone's own transform (its slots, in order)."""
        return [compose([mats[s] for s in b.slots if s in mats]) for b in sk.bones]

    def _totals(sk, own):
        """Each bone's total transform: its ancestors' and its own, in the order the game applies them."""
        out = []
        for b in sk.bones:
            chain = sorted(sk.ancestors(b.index) + [b.index], key=lambda i: min(sk.bones[i].slots))
            out.append(compose([own[i] for i in chain]))
        return out

    def _before(sk, own, i):
        """The bone's ancestors the game applies before it, as one matrix."""
        first = min(sk.bones[i].slots)
        before = [a for a in sk.ancestors(i) if min(sk.bones[a].slots) < first]
        return compose([own[a] for a in sorted(before, key=lambda a: min(sk.bones[a].slots))])

    def _conjugate(m, by):
        """by^-1 * m * by, or m when `by` can't be inverted (a part scaled to nothing)."""
        if by == Matrix.Identity(4):
            return m.copy()
        try:
            return by.inverted() * m * by
        except ValueError:
            return m.copy()

    def _basis(sk, own, rest, i):
        """A bone's pose (matrix_basis) from the game's transforms. Its total is
        after * own * before (ancestors the game applies after / before it), and its parent's total
        is after * before, so its local transform is before^-1 * own * before."""
        local = _conjugate(own[i], _before(sk, own, i))
        return rest[i].inverted() * local * rest[i]

    def _pose_vector(pb):
        return [round(v, 5) for v in list(pb.location) + list(pb.rotation_euler) + list(pb.scale)]

    def _deformed(model, sk, totals):
        out = []
        by_index = model._label_by_index()
        for index, p in enumerate(model.rest):
            label = by_index.get(index)
            bone = sk.deepest(label) if label is not None else None
            out.append(totals[bone] * p if bone is not None else p.copy())
        return out

    def _max_error(a, b):
        return max([(p - q).length for p, q in zip(a, b)] + [0.0]) * UNITS

    # -- import ----------------------------------------------------------------------------

    def import_animation(context, folder, objects, name=None):
        anim = Animation(folder)
        meshes = [o for o in objects if o.type == 'MESH']
        if not meshes:
            raise RuntimeError("select the model(s) to animate first")
        info_path = os.path.join(folder, "info.json")
        if name is None and os.path.exists(info_path):
            with open(info_path) as f:
                name = json.load(f).get("name")
        name = name or os.path.basename(os.path.normpath(folder))
        if context.active_object is not None and context.active_object.mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        fm_id = anim.framemap_id
        fm = anim.framemaps[fm_id]
        model = Model(meshes)
        used = set(i for fr in anim.frames for i, flag in enumerate(fr.flags) if flag)
        sk = Skeleton(fm, fm_id, set(model.vlabels), used)
        if not sk.bones:
            raise RuntimeError("the animation moves none of the selected model's labels")
        arm = _build_rig(context, name + " rig", sk, model, fm)
        _bind(model, sk, arm)
        rig = RIGS.get(fm_id, {})
        fades = [(s, FADE_PREFIX + str(s)) for s in range(fm.count)
                 if fm.types[s] == ALPHA and (s in used or s in rig)
                 and any(l in model.flabels for l in fm.labels[s])]
        for slot, prop in fades:
            arm[prop] = 0
        n_fade_materials = _fade_materials(model, arm, fades, fm)
        rest = _rest(arm, sk)
        sim = Sim(fm, model.rest, model.vlabels)

        # Every frame's pose first, then keys: a channel is keyed where the bone can use it, or
        # where a frame needs it anyway (a pivot the game moves with another part).
        poses, prev_euler, worst = [], {}, 0.0
        for frame in anim.frames:
            pos, mats = sim.run(frame.present())
            own = _bone_matrices(sk, mats)
            totals = _totals(sk, own)
            worst = max(worst, _max_error(pos, _deformed(model, sk, totals)))
            pose = {}
            for b in sk.bones:
                loc, rot, scale = _basis(sk, own, rest, b.index).decompose()
                euler = rot.to_euler('XYZ', prev_euler[b.name]) if b.name in prev_euler else rot.to_euler('XYZ')
                prev_euler[b.name] = euler
                pose[b.name] = (loc, euler, scale)
            poses.append(pose)
        needed = {}
        for b in sk.bones:
            pb = arm.pose.bones[b.name]
            needed[b.name] = [
                ("location", not pb.lock_location[0] or any(p[b.name][0].length > 1e-5 for p in poses)),
                ("rotation_euler", not pb.lock_rotation[0] or any(Vector(p[b.name][1]).length > 1e-6 for p in poses)),
                ("scale", not pb.lock_scale[0] or any((p[b.name][2] - Vector((1, 1, 1))).length > 1e-6 for p in poses)),
            ]
        imported = []
        t = 0
        for k, (frame, length) in enumerate(zip(anim.frames, anim.seq.frame_lengths)):
            present = frame.present()
            pose = {}
            for b in sk.bones:
                pb = arm.pose.bones[b.name]
                pb.location, pb.rotation_euler, pb.scale = poses[k][b.name]
                for path, key in needed[b.name]:
                    if key:
                        pb.keyframe_insert(path, frame=t, group=b.name)
                pose[b.name] = _pose_vector(pb)
            values = {}
            for slot, prop in fades:
                arm[prop] = int(present.get(slot, (0, 0, 0))[0])
                arm.keyframe_insert('["%s"]' % prop, frame=t)
                values[prop] = arm[prop]
            arm[FRAME_KEY] = k
            arm.keyframe_insert('["%s"]' % FRAME_KEY, frame=t)
            imported.append({"pose": pose, "fades": values})
            t += length
        _set_interpolation(arm, [prop for _, prop in fades])

        arm[ROOT_KEY] = json.dumps({
            "seq_hex": anim.seq.data.hex(),
            "framemap_id": fm_id,
            "framemap_hex": fm.data.hex(),
            "frames": [{"id": fid, "flags": fr.flags, "count": fr.count,
                        "values": dict((str(i), list(v)) for i, v in fr.present().items()),
                        "bytes": fr.encode().hex()}
                       for fid, fr in zip(anim.seq.frame_ids, anim.frames)],
            "bones": [{"name": b.name, "slots": b.slots, "labels": sorted(b.labels), "parent": b.parent}
                      for b in sk.bones],
            "fades": [[slot, prop, slot_name(fm_id, slot, ALPHA)] for slot, prop in fades],
            "loose": sk.loose,
            "imported": imported,
        })
        arm["osrs_targets"] = json.dumps([o.name for o in meshes])
        arm["last_frame_length"] = anim.seq.frame_lengths[-1] if anim.seq.frame_lengths else 1
        arm["osrs_accuracy"] = "Imported: Blender's pose is within %.2f game units of the game's" % worst

        scene = context.scene
        scene.render.fps = 50
        scene.render.fps_base = 1.0
        scene.frame_start = 0
        scene.frame_end = max(0, t - 1)
        scene.frame_set(0)
        return arm, anim, {"bones": len(sk.bones), "fades": len(fades), "loose": len(sk.loose),
                           "error": worst, "fade_materials": n_fade_materials}

    def _set_interpolation(arm, fade_props):
        ad = arm.animation_data
        if ad is None or ad.action is None:
            return
        constant = set('["%s"]' % p for p in fade_props + [FRAME_KEY])
        for fc in ad.action.fcurves:
            mode = 'CONSTANT' if fc.data_path in constant else 'LINEAR'
            for kp in fc.keyframe_points:
                kp.interpolation = mode

    # -- export ----------------------------------------------------------------------------

    def _decompose_bone(sim, fm, sk, b, target, pos, state, reference):
        """The game values for bone b's slots that make its own transform `target`, starting from
        the positions and origin state the game has when it reaches the bone's first slot."""
        lin = target.to_3x3()
        values = {}
        kinds = dict((s, fm.types[s]) for s in b.slots)
        if SCALE in kinds.values():
            s = b.slots[0]
            values[s] = [int(round(lin[0][0] * 128)), int(round(lin[2][2] * 128)), int(round(lin[1][1] * 128))]
            return values
        rot_slot = next((s for s in b.slots if kinds[s] == ROTATE), None)
        move_slot = next((s for s in b.slots if kinds[s] == TRANSLATE), None)
        if rot_slot is not None:
            e = lin.to_euler('YXZ')
            options = [e, Euler((math.pi - e.x, e.y + math.pi, e.z + math.pi), 'YXZ')]
            ref = reference.get(rot_slot, (0, 0, 0))

            def distance(c):
                v = (c.x * ANGLE, -c.z * ANGLE, -c.y * ANGLE)
                return sum(abs(((a - r + 128) % 256) - 128) for a, r in zip(v, ref))
            e = min(options, key=distance)
            values[rot_slot] = [int(round(e.x * ANGLE)), int(round(-e.z * ANGLE)), int(round(-e.y * ANGLE))]
        if move_slot is None:
            return values

        def run(t):
            vals = dict(values)
            vals[move_slot] = list(t)
            local = dict((v, pos[v].copy()) for s in b.slots for o in [sk.origin_for(s)] if o is not None
                         for v in sim.verts(o))
            reset_state = dict(state)
            mats = []
            for s in b.slots:
                kind = kinds[s]
                p = reset_state["pivot"]
                o = sk.origin_for(s)
                if o is not None and o > reset_state["last"]:
                    vs = sim.verts(o)
                    p = (sum((local[v] for v in vs), Vector((0.0, 0.0, 0.0))) / len(vs)) if vs else Vector((0.0, 0.0, 0.0))
                    reset_state = {"pivot": p, "last": o}
                m = op_matrix(kind, vals[s][0], vals[s][1], vals[s][2], p)
                moved = set(sim.verts(s))
                for v in local:
                    if v in moved:
                        local[v] = m * local[v]
                mats.append(m)
            return compose(mats).translation

        base = run((0.0, 0.0, 0.0))
        cols = [run(axis) - base for axis in ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))]
        k = Matrix((cols[0], cols[1], cols[2])).transposed()
        try:
            t = k.inverted() * (target.translation - base)
            values[move_slot] = [int(round(c)) for c in t]
        except ValueError:
            values[move_slot] = [0, 0, 0]
        return values

    def _derive_frame(arm, data, fm, sk, sim, rest, old):
        """A frame from the rig's current pose: (Frame, game positions, Blender positions)."""
        pbs = arm.pose.bones
        totals = [pbs[b.name].matrix * rest[b.index].inverted() for b in sk.bones]
        own = [None] * len(sk.bones)
        for b in sk.bones:  # parents come first in the list
            local = rest[b.index] * pbs[b.name].matrix_basis * rest[b.index].inverted()
            before = _before(sk, own, b.index)
            if before == Matrix.Identity(4):
                own[b.index] = local
            else:
                try:
                    own[b.index] = before * local * before.inverted()
                except ValueError:  # an ancestor scaled to nothing: nothing of this bone shows
                    own[b.index] = local
        bone_of = {}
        for b in sk.bones:
            for s in b.slots:
                bone_of[s] = b
        old_values = old["values"] if old else {}
        fades = dict((slot, prop) for slot, prop, _ in data["fades"])
        pos = [v.copy() for v in sim.rest]
        state = {"pivot": Vector((0.0, 0.0, 0.0)), "last": -1}
        reset = -1
        present = {}
        derived = {}
        for slot in range(fm.count):
            kind = fm.types[slot]
            if kind == ORIGIN:
                reset = slot
                if str(slot) in old_values:  # an origin with an offset: kept as it was
                    x, y, z = old_values[str(slot)]
                    state = {"pivot": sim.mean(pos, slot) + to_blender(x, y, z), "last": slot}
                    present[slot] = (x, y, z)
                continue
            if slot in bone_of:
                b = bone_of[slot]
                if slot == b.slots[0]:
                    reference = dict((s, old_values[str(s)]) for s in b.slots if str(s) in old_values)
                    derived.update(_decompose_bone(sim, fm, sk, b, own[b.index], pos, state, reference))
                vals = derived[slot]
                if kind == ROTATE and str(slot) in old_values:
                    vals = [o if (v - o) % 256 == 0 else wrap_angle(v) for v, o in zip(vals, old_values[str(slot)])]
                elif kind == ROTATE:
                    vals = [wrap_angle(v) for v in vals]
            elif slot in fades:
                vals = [int(round(arm.get(fades[slot], 0))), 0, 0]
                if str(slot) in old_values:
                    vals[1:] = old_values[str(slot)][1:]
            elif str(slot) in old_values:  # loose and unsupported slots: kept as they were
                vals = old_values[str(slot)]
            else:
                continue
            n = neutral(kind)
            if all(v == n for v in vals) and str(slot) not in old_values:
                continue
            present[slot] = tuple(vals)
            if kind in (TRANSLATE, ROTATE, SCALE):
                if reset > state["last"]:
                    state = {"pivot": sim.mean(pos, reset), "last": reset}
                m = op_matrix(kind, vals[0], vals[1], vals[2], state["pivot"])
                for v in sim.verts(slot):
                    pos[v] = m * pos[v]
        flags = [0] * fm.count
        values = [[neutral(kind)] * 3 for kind in fm.types]
        for slot, vals in present.items():
            flag = old["flags"][slot] if old and slot < len(old["flags"]) else 0
            for axis in range(3):
                if vals[axis] != neutral(fm.types[slot]):
                    flag |= 1 << axis
            flags[slot] = flag
            values[slot] = list(vals)
        count = old.get("count", fm.count) if old else max([f.get("count", fm.count) for f in data["frames"][:1]] + [0])
        return Frame(data["framemap_id"], flags, values, count or fm.count), totals

    def build_animation(context, arm):
        """(Seq, framemap id, FrameMap, {frame id: Frame or bytes}, worst error in game units)."""
        data, fm, sk = _skeleton_of(arm)
        scene = context.scene
        model = Model(targets(arm), arm.matrix_world)
        sim = Sim(fm, model.rest, model.vlabels)
        rest = _rest(arm, sk)
        seq = Seq(bytes.fromhex(data["seq_hex"]))
        original = data["frames"]
        starts = frame_starts(arm)
        if not starts:
            raise RuntimeError("the animation has no frames (keys on %s)" % FRAME_KEY)
        group = (original[0]["id"] >> 16) if original else 0
        next_file = max([f["id"] & 0xffff for f in original] + [-1]) + 1
        by_content, used, frame_ids, frames = {}, set(), [], {}
        worst = 0.0
        current = scene.frame_current
        fades = [prop for _, prop, _ in data["fades"]]
        try:
            for k, t in enumerate(starts):
                scene.frame_set(t)
                old = original[k] if k < len(original) else None
                imported = data["imported"][k] if k < len(data["imported"]) else None
                same = imported is not None and all(
                    _close(_pose_vector(arm.pose.bones[b.name]), imported["pose"].get(b.name)) for b in sk.bones) \
                    and all(int(round(arm.get(p, 0))) == imported["fades"].get(p, 0) for p in fades)
                if same and old is not None:
                    encoded = bytes.fromhex(old["bytes"])
                else:
                    frame, totals = _derive_frame(arm, data, fm, sk, sim, rest, old)
                    encoded = frame.encode()
                    game, _ = sim.run(frame.present())
                    worst = max(worst, _max_error(game, _deformed(model, sk, totals)))
                frame_id = by_content.get(encoded)
                if frame_id is None:
                    wanted = old["id"] if old else None
                    if wanted is not None and wanted not in used:
                        frame_id = wanted
                    else:
                        frame_id = (group << 16) | next_file
                        next_file += 1
                    used.add(frame_id)
                    by_content[encoded] = frame_id
                frame_ids.append(frame_id)
                frames[frame_id] = encoded
        finally:
            scene.frame_set(current)
        lengths = [b - a for a, b in zip(starts, starts[1:])] + [int(arm.get("last_frame_length", 1))]
        seq.frame_ids = frame_ids
        seq.frame_lengths = [max(0, min(65535, n)) for n in lengths]
        return seq, data["framemap_id"], fm, frames, worst

    def _close(a, b, eps=1e-3):
        return b is not None and len(a) == len(b) and all(abs(x - y) <= eps for x, y in zip(a, b))

    def export_animation(context, arm, folder):
        seq, fm_id, fm, frames, worst = build_animation(context, arm)
        name = arm.name[:-4] if arm.name.endswith(" rig") else arm.name
        write_animation(folder, seq, fm_id, fm, frames, info={
            "name": name, "frames": len(seq.frame_ids), "frameLengths": seq.frame_lengths, "framemaps": [fm_id]})
        arm["osrs_accuracy"] = "Last export: the game's pose is within %.2f game units of Blender's" % worst
        return seq, frames, worst

    # -- operators -------------------------------------------------------------------------

    class ImportOsrsAnim(bpy.types.Operator, ImportHelper):
        """Import an OSRS animation folder (pick its seq.dat) onto the selected model(s) as an armature"""
        bl_idname = "import_anim.osrs_seq"
        bl_label = "Import OSRS animation"
        bl_options = {'REGISTER', 'UNDO'}
        filename_ext = ".dat"
        filter_glob = StringProperty(default="seq.dat", options={'HIDDEN'})

        def execute(self, context):
            try:
                arm, anim, info = import_animation(context, os.path.dirname(self.filepath), list(context.selected_objects))
            except Exception as error:
                self.report({'ERROR'}, "OSRS animation import failed: %s" % error)
                return {'CANCELLED'}
            self.report({'INFO'}, "%s: %d frames, %d ticks, %d bones, %d fades" % (
                arm.name, len(anim.frames), sum(anim.seq.frame_lengths), info["bones"], info["fades"]))
            return {'FINISHED'}

    class ExportOsrsAnim(bpy.types.Operator, ExportHelper):
        """Export the OSRS animation as seq.dat, its frames and frame map"""
        bl_idname = "export_anim.osrs_seq"
        bl_label = "Export OSRS animation"
        filename_ext = ".dat"
        filter_glob = StringProperty(default="seq.dat", options={'HIDDEN'})

        def invoke(self, context, event):
            self.filepath = "seq.dat"
            context.window_manager.fileselect_add(self)
            return {'RUNNING_MODAL'}

        def execute(self, context):
            arm = find_root(context)
            if arm is None:
                self.report({'ERROR'}, "select the animation's rig to export")
                return {'CANCELLED'}
            try:
                seq, frames, worst = export_animation(context, arm, os.path.dirname(self.filepath))
            except Exception as error:
                self.report({'ERROR'}, "OSRS animation export failed: %s" % error)
                return {'CANCELLED'}
            self.report({'INFO'}, "Wrote %d frames (%d files), %d ticks; the game's pose is within %.1f units of Blender's" % (
                len(seq.frame_ids), len(frames), sum(seq.frame_lengths), worst))
            return {'FINISHED'}

    def _key_all(arm, t):
        data = anim_data(arm)
        for item in data["bones"]:
            pb = arm.pose.bones.get(item["name"])
            if pb is None:
                continue
            for path, locked in (("location", pb.lock_location[0]), ("rotation_euler", pb.lock_rotation[0]),
                                 ("scale", pb.lock_scale[0])):
                if not locked:
                    pb.keyframe_insert(path, frame=t, group=item["name"])
        for _, prop, _ in data["fades"]:
            arm.keyframe_insert('["%s"]' % prop, frame=t)

    class OsrsAnimAddFrame(bpy.types.Operator):
        """Start a game frame at the current Blender frame, keying the pose as it is now"""
        bl_idname = "osrs_anim.add_frame"
        bl_label = "Add OSRS frame"
        bl_options = {'REGISTER', 'UNDO'}

        def execute(self, context):
            arm = find_root(context)
            if arm is None:
                return {'CANCELLED'}
            t = context.scene.frame_current
            _key_all(arm, t)
            arm[FRAME_KEY] = len(frame_starts(arm))
            arm.keyframe_insert('["%s"]' % FRAME_KEY, frame=t)
            data = anim_data(arm)
            _set_interpolation(arm, [prop for _, prop, _ in data["fades"]])
            return {'FINISHED'}

    class OsrsAnimRemoveFrame(bpy.types.Operator):
        """Remove the game frame that starts at the current Blender frame (and its keys)"""
        bl_idname = "osrs_anim.remove_frame"
        bl_label = "Remove OSRS frame"
        bl_options = {'REGISTER', 'UNDO'}

        def execute(self, context):
            arm = find_root(context)
            t = context.scene.frame_current
            if arm is None or t not in frame_starts(arm):
                self.report({'WARNING'}, "no game frame starts at frame %d" % t)
                return {'CANCELLED'}
            ad = arm.animation_data
            for fc in ad.action.fcurves:
                for kp in [kp for kp in fc.keyframe_points if int(round(kp.co.x)) == t]:
                    fc.keyframe_points.remove(kp)
            arm.update_tag()
            return {'FINISHED'}

    class OsrsAnimPanel(bpy.types.Panel):
        bl_label = "OSRS animation"
        bl_space_type = 'VIEW_3D'
        bl_region_type = 'TOOLS'
        bl_category = "OSRS"

        def draw(self, context):
            layout = self.layout
            arm = find_root(context)
            if arm is None:
                layout.label("Select an animation's rig")
                layout.operator(ImportOsrsAnim.bl_idname, text="Import animation...")
                return
            starts = frame_starts(arm)
            t = context.scene.frame_current
            current = len([s for s in starts if s <= t])
            layout.label(arm.name)
            ticks = (starts[-1] - starts[0] + int(arm.get("last_frame_length", 1))) if starts else 0
            layout.label("Game frame %d of %d (%d ticks)" % (current, len(starts), ticks))
            layout.prop(arm, '["last_frame_length"]', text="Last frame length")
            row = layout.row(align=True)
            row.operator(OsrsAnimAddFrame.bl_idname, text="Add frame")
            row.operator(OsrsAnimRemoveFrame.bl_idname, text="Remove frame")
            data = anim_data(arm)
            if data["fades"]:
                box = layout.box()
                box.label("Fades (8/255 more transparent per step)")
                for _, prop, label in data["fades"]:
                    box.prop(arm, '["%s"]' % prop, text=label)
            layout.operator(ExportOsrsAnim.bl_idname, text="Export animation...")
            if arm.get("osrs_accuracy"):
                layout.label(arm["osrs_accuracy"])

    def menu_import(self, context):
        self.layout.operator(ImportOsrsAnim.bl_idname, text="OSRS animation (seq.dat)")

    def menu_export(self, context):
        self.layout.operator(ExportOsrsAnim.bl_idname, text="OSRS animation (seq.dat)")

    CLASSES = (ImportOsrsAnim, ExportOsrsAnim, OsrsAnimAddFrame, OsrsAnimRemoveFrame, OsrsAnimPanel)

    def register():
        for cls in CLASSES:
            bpy.utils.register_class(cls)
        bpy.types.INFO_MT_file_import.append(menu_import)
        bpy.types.INFO_MT_file_export.append(menu_export)

    def unregister():
        bpy.types.INFO_MT_file_import.remove(menu_import)
        bpy.types.INFO_MT_file_export.remove(menu_export)
        for cls in reversed(CLASSES):
            bpy.utils.unregister_class(cls)


if __name__ == "__main__" and bpy is not None:
    register()
