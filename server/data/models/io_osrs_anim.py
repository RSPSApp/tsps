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
#   the parts are, as far as the game's order of transforms allows (GameRig). A bone needed in two
#   places has a locked "<bone> copy" in the other, following it. The model gets an Armature
#   modifier and a vertex group per bone;
# - each game frame becomes a pose, keyed on the bones. Animate in Pose Mode as usual. Bones only
#   allow what the game can do (channels it can't animate are locked). Parts that only stretch
#   have their own "<part> scale" bone;
# - fades (graphics often fade parts in and out) are the rig's "Fade" properties, in
#   Tool Shelf > OSRS; the faces they act on show their transparency in Material/Textured view;
# - what the player holds during the animation is the rig's "Weapon slot" and "Shield slot"
#   properties (osrs_right_hand / osrs_left_hand), in Tool Shelf > OSRS: an item id to hold that
#   item, 0 for an empty hand, or -1 to keep what is worn. They apply to the whole animation;
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
    "version": (3, 1, 0),
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
        wrote_hands = set()
        for op, payload in self.ops:
            if op == 1:
                payload = self._frames_payload()
                wrote_frames = True
            elif op in (6, 7):
                # The hands: rewritten from left_hand / right_hand, dropped when set to None.
                value = self.left_hand if op == 6 else self.right_hand
                if value is None or op in wrote_hands:
                    continue
                payload = struct.pack(">H", value)
                wrote_hands.add(op)
            out.append(op)
            out.extend(payload)
        if not wrote_frames and self.frame_ids:
            out.append(1)
            out.extend(self._frames_payload())
        for op, value in ((6, self.left_hand), (7, self.right_hand)):
            if value is not None and op not in wrote_hands:
                out.append(op)
                out.extend(struct.pack(">H", value))
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


# What the player holds during the animation (seq opcodes 6 and 7). The game stores an item id + 512,
# 0 for an empty hand, or nothing to keep what is worn. In Blender it is a plain item id, 0 for an
# empty hand, or -1 to keep what is worn.
HAND_ITEM_OFFSET = 512
KEEP_WORN = -1
HIGHEST_HAND_ITEM = 0xffff - HAND_ITEM_OFFSET


def hand_to_item(raw):
    """The seq's hand value (None, 0, or item id + 512) as the Blender property's item id."""
    if raw is None:
        return KEEP_WORN
    return raw - HAND_ITEM_OFFSET if raw >= HAND_ITEM_OFFSET else 0


def item_to_hand(item, original=None):
    """The Blender property's item id as the seq's hand value; the original value when they mean the same."""
    item = int(item)
    if item < KEEP_WORN or item > HIGHEST_HAND_ITEM:
        raise ValueError("a held item must be -1 (keep what is worn), 0 (empty) or an item id up to %d, not %d"
                         % (HIGHEST_HAND_ITEM, item))
    if hand_to_item(original) == item:
        return original
    if item == KEEP_WORN:
        return None
    return 0 if item == 0 else item + HAND_ITEM_OFFSET


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
    """A rig made by an older version of this add-on (rig version 2), as read back for export: bones
    with nesting label sets, each posed relative to the ancestors the game applies before it.
    Rigs are made with GameRig now."""

    def __init__(self):
        self.fm = None
        self.bones = []
        self.loose = []

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


class GameRig(object):
    """Bones for a frame map's move / rotate / scale slots, for any frame map (rig version 3).

    A bone is one slot, or a move and a rotate of the same parts with nothing else acting on those
    parts between them. Every part (model label) is a chain of bones from the root, outermost first:
    bigger bones outside smaller ones (body, arm, hand), as long as Blender can show the game's
    order of transforms exactly that way; otherwise the one the game applies later goes outside
    (see `_order`). Parts whose chains share their outer bones share those bones; where they
    differ, the chains branch. A bone that ends up on several branches (a slot whose parts overlap
    others' without nesting, or one that has to stay inside a later one) is made once, and its other
    places are copies that follow it.

    A bone's pose is what its slots do, seen from inside the bones outside it that the game applies
    before it (for older rigs: Skeleton). Blender shows every frame as the game plays it.

    `present` maps the model's labels to their vertex counts (to pick which place is the bone and
    which are copies). Slots the frames use always count; a known rig (RIGS) adds its other slots,
    so parts the animation doesn't move can be posed too."""

    VERSION = 3

    def __init__(self, fm, fm_id, present, used):
        self.fm = fm
        self.loose = []
        rig = RIGS.get(fm_id, {})
        labels_of = dict((s, frozenset(fm.labels[s]) & set(present)) for s in range(fm.count))
        slots = [s for s in range(fm.count) if fm.types[s] in (TRANSLATE, ROTATE, SCALE)
                 and (s in used or s in rig) and labels_of[s]]
        self.bones = []
        for s in slots:
            labels, kind = labels_of[s], fm.types[s]
            same = [b for b in self.bones if b.labels == labels and not b.is_scale(fm)]
            if kind != SCALE and same:
                b = same[-1]
                last = max(b.slots)
                between = any(last < x < s and labels_of[x] & labels for x in slots)
                if kind not in [fm.types[x] for x in b.slots] and not between:
                    b.slots.append(s)
                    continue
            b = Bone(labels)
            b.slots.append(s)
            self.bones.append(b)
        taken = set()
        for i, b in enumerate(self.bones):
            b.index = i
            name = slot_name(fm_id, b.slots[0], fm.types[b.slots[0]])
            if name in taken and fm.types[b.slots[0]] == TRANSLATE:
                name += " move"
            base, n = name, 2
            while name in taken:
                name = "%s %d" % (base, n)
                n += 1
            taken.add(name)
            b.name = name
        # Each label's bones, outermost first (see `_order`).
        self.chains = {}
        for label in present:
            chain = [b.index for b in self.bones if label in b.labels]
            if chain:
                self.chains[label] = self._order(chain)
        # Places: a tree of (bone, parent place).
        places, index, weight, bind = [], {}, [], {}
        for label in sorted(self.chains):
            parent = None
            for bone in self.chains[label]:
                key = (parent, bone)
                if key not in index:
                    index[key] = len(places)
                    places.append({"bone": bone, "parent": parent})
                    weight.append(0)
                parent = index[key]
                weight[parent] += present[label]
            bind[label] = parent
        # The place with the most vertices is the bone; its others are copies.
        main = {}
        for i, place in enumerate(places):
            m = main.get(place["bone"])
            if m is None or weight[i] > weight[m]:
                main[place["bone"]] = i
        # Bones in the order of their places' depth, so a bone's parent comes before it.
        def depth(i):
            d = 0
            while places[i]["parent"] is not None:
                i = places[i]["parent"]
                d += 1
            return d
        old_bones = self.bones
        self.bones = sorted(old_bones, key=lambda b: (depth(main[b.index]), b.slots[0]))
        renumber = dict((b.index, i) for i, b in enumerate(self.bones))
        for i, b in enumerate(self.bones):
            b.index = i
        for place in places:
            place["bone"] = renumber[place["bone"]]
        self.chains = dict((label, [renumber[x] for x in chain]) for label, chain in self.chains.items())
        self.main = dict((renumber[b], i) for b, i in main.items())
        self.places, self.bind = places, bind
        copies = {}
        for i, place in enumerate(places):
            b = self.bones[place["bone"]]
            place["before"] = self._before(i)
            if self.main[b.index] == i:
                place["name"] = b.name
            else:
                copies[b.index] = copies.get(b.index, 0) + 1
                n = copies[b.index]
                place["name"] = "%s copy%s" % (b.name, "" if n == 1 else " %d" % n)
        for i, place in enumerate(places):
            # A copy whose ancestors applied before it are its bone's moves with its bone's
            # channels; any other copy is posed as the game is, but doesn't follow edits.
            place["follows"] = place["before"] == places[self.main[place["bone"]]]["before"]
        for b in self.bones:
            parent = places[self.main[b.index]]["parent"]
            b.parent = places[parent]["bone"] if parent is not None else None

    @staticmethod
    def _kinds(b, fm):
        return set(fm.types[s] for s in b.slots)

    def _must_outside(self, y, x):
        """Whether bone y has to go outside bone x: the game applies y later, and Blender couldn't
        show x outside y exactly. A bone applied earlier may go outside a later one only if it
        moves, or if it turns and the later one doesn't scale: a scale never may (a later turn of
        a stretched part would shear, and a scale to nothing can't be undone)."""
        fm = self.fm
        early, late = self.bones[x], self.bones[y]
        if late.slots[0] < early.slots[0]:
            return False
        ek, lk = self._kinds(early, fm), self._kinds(late, fm)
        return not (ek == set([TRANSLATE]) or (SCALE not in ek and SCALE not in lk))

    def _order(self, chain):
        """A label's bones, outermost first: bigger bones outside smaller ones (body, arm, hand),
        and with equal parts the one applied later, but always as `_must_outside` requires."""
        remaining, out = list(chain), []
        while remaining:
            free = [x for x in remaining if not any(self._must_outside(y, x) for y in remaining if y != x)]
            pick = max(free, key=lambda x: (len(self.bones[x].labels), self.bones[x].slots[0]))
            out.append(pick)
            remaining.remove(pick)
        return out

    def _before(self, place):
        """The bones outside a place that the game applies before it (in that order)."""
        first = self.bones[self.places[place]["bone"]].slots[0]
        out = []
        p = self.places[place]["parent"]
        while p is not None:
            bone = self.places[p]["bone"]
            if self.bones[bone].slots[0] < first:
                out.append(bone)
            p = self.places[p]["parent"]
        return sorted(out, key=lambda b: self.bones[b].slots[0])

    def ancestors(self, i):
        """Bone i's ancestors (its own place's), root first (without i)."""
        out = []
        p = self.bones[i].parent
        while p is not None:
            out.append(p)
            p = self.bones[p].parent
        return out[::-1]

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
    RIGHT_HAND_KEY = "osrs_right_hand"    # the weapon slot
    LEFT_HAND_KEY = "osrs_left_hand"      # the shield slot
    HAND_DESCRIPTION = "Item id held for the whole animation; 0 empties the hand, -1 keeps what is worn"
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

    def set_hand_properties(arm, seq):
        """The rig's held-item properties from the sequence (as imported)."""
        arm[RIGHT_HAND_KEY] = hand_to_item(seq.right_hand)
        arm[LEFT_HAND_KEY] = hand_to_item(seq.left_hand)
        ui = arm.get("_RNA_UI")
        ui = ui.to_dict() if ui is not None else {}
        for key in (RIGHT_HAND_KEY, LEFT_HAND_KEY):
            ui[key] = {"min": KEEP_WORN, "max": HIGHEST_HAND_ITEM, "soft_min": KEEP_WORN,
                       "soft_max": HIGHEST_HAND_ITEM, "description": HAND_DESCRIPTION}
        arm["_RNA_UI"] = ui

    def apply_hand_properties(arm, seq):
        """The sequence's hands from the rig's properties; a rig without them keeps the original hands."""
        if RIGHT_HAND_KEY in arm.keys():
            seq.right_hand = item_to_hand(arm[RIGHT_HAND_KEY], seq.right_hand)
        if LEFT_HAND_KEY in arm.keys():
            seq.left_hand = item_to_hand(arm[LEFT_HAND_KEY], seq.left_hand)

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

    def _bind(model, sk, arm, group_of=None):
        """Vertex groups named after the bones (each vertex to its deepest bone, or the bone
        `group_of` (label -> name) gives) and a modifier."""
        given = group_of is not None   # GameRig rigs pass a map, empty when there are no bones
        group_of = group_of or {}
        names = set(b.name for b in sk.bones) | set(group_of.values())
        for part, obj in enumerate(model.objects):
            for mod in [m for m in obj.modifiers if m.type == 'ARMATURE']:
                obj.modifiers.remove(mod)
            for g in [g for g in obj.vertex_groups if g.name in names]:
                obj.vertex_groups.remove(g)
        groups = {}
        for label, vs in model.vlabels.items():
            bone = sk.deepest(label) if not given else None
            name = group_of.get(label) or (sk.bones[bone].name if bone is not None else None)
            if name is None:
                continue
            for v in vs:
                part, index = model.where[v]
                key = (part, name)
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
        sk = Skeleton()
        sk.fm = fm
        sk.loose = data["loose"]
        sk.bones = []
        for i, item in enumerate(data["bones"]):
            b = Bone(frozenset(item["labels"]))
            b.slots, b.parent, b.index, b.name = item["slots"], item["parent"], i, item["name"]
            b.before = item.get("before")  # rig version 3: the outer bones the game applies first
            sk.bones.append(b)
        return data, fm, sk

    def _bone_matrices(sk, mats):
        """Each bone's own transform (its slots, in order)."""
        return [compose([mats[s] for s in b.slots if s in mats]) for b in sk.bones]

    def _before(sk, own, i):
        """The bone's ancestors the game applies before it, as one matrix."""
        first = min(sk.bones[i].slots)
        before = [a for a in sk.ancestors(i) if min(sk.bones[a].slots) < first]
        return compose([own[a] for a in sorted(before, key=lambda a: min(sk.bones[a].slots))])

    def _pose_vector(pb):
        return [round(v, 5) for v in list(pb.location) + list(pb.rotation_euler) + list(pb.scale)]

    def _deformed(model, sk, totals, extra=None):
        """The model posed by the bones' totals; `extra` (label -> matrix) overrides a label's."""
        out = []
        by_index = model._label_by_index()
        for index, p in enumerate(model.rest):
            label = by_index.get(index)
            if extra and label in extra:
                out.append(extra[label] * p)
                continue
            bone = sk.deepest(label) if label is not None else None
            out.append(totals[bone] * p if bone is not None else p.copy())
        return out

    def _build_game_rig(context, name, rig, model, fm, frames=()):
        """The armature for a GameRig: one bone per place, copies following their bone. A bone
        that turns or scales has its head on its pivot: the middle of its origin slot's parts,
        plus the offset the frames give that origin most often (a wheel turning on its axle)."""
        offsets = {}
        for frame in frames:
            present = frame.present()
            for s in range(fm.count):
                if fm.types[s] == ORIGIN:
                    key = tuple(present.get(s, (0, 0, 0)))
                    offsets.setdefault(s, {})[key] = offsets.setdefault(s, {}).get(key, 0) + 1
        heads, tails = [], []
        for b in rig.bones:
            main = next((s for s in b.slots if fm.types[s] != TRANSLATE), b.slots[0])
            origin = rig.origin_for(main)
            vs = [v for label in b.labels for v in model.vlabels.get(label, ())]
            centre = sum((model.rest[v] for v in vs), Vector((0.0, 0.0, 0.0))) / max(1, len(vs))
            head = None
            if origin is not None and fm.types[main] != TRANSLATE:
                ovs = [v for label in fm.labels[origin] for v in model.vlabels.get(label, ())]
                if ovs:
                    head = sum((model.rest[v] for v in ovs), Vector((0.0, 0.0, 0.0))) / len(ovs)
                    counts = offsets.get(origin)
                    if counts:
                        head = head + to_blender(*max(counts.items(), key=lambda c: c[1])[0])
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
        # A bone points at the bones inside it (its main place's children), else at its parts.
        ends = []
        for b in rig.bones:
            main = rig.main[b.index]
            inner = [rig.places[i]["bone"] for i, place in enumerate(rig.places) if place["parent"] == main]
            head = heads[b.index]
            target = None
            if inner:
                target = sum((heads[c] for c in inner), Vector((0.0, 0.0, 0.0))) / len(inner)
            if target is None or (target - head).length < 0.03:
                target = tails[b.index]
            d = target - head
            if d.length < 0.03:
                d = Vector((0.0, 0.0, 0.12))
            if b.is_scale(fm):
                d = _axis_direction(d) * 0.06
            else:
                d = d.normalized() * max(0.04, min(d.length, 0.6))
            ends.append(head + d)
        edit = []
        for place in rig.places:
            eb = arm_data.edit_bones.new(place["name"])
            eb.head = heads[place["bone"]]
            eb.tail = ends[place["bone"]]
            eb.roll = 0.0
            eb.use_connect = False
            edit.append(eb)
        for i, place in enumerate(rig.places):
            if place["parent"] is not None:
                edit[i].parent = edit[place["parent"]]
        bpy.ops.object.mode_set(mode='OBJECT')
        # Blender 2.79 gives a bone pointing (almost) opposite its parent a rest matrix that isn't
        # quite a rotation, and then poses it off. Such bones are tilted a little (a scale bone
        # turned to another axis) until every rest matrix is a rotation.
        for attempt in range(6):
            bad = set(rig.places[i]["bone"] for i, place in enumerate(rig.places)
                      if not _orthonormal(arm_data.bones[place["name"]].matrix_local))
            if not bad:
                break
            for b in bad:
                head, d = heads[b], ends[b] - heads[b]
                if rig.bones[b].is_scale(fm):
                    axes = [Vector(a) for a in ((1, 0, 0), (0, 0, 1), (0, 1, 0), (-1, 0, 0), (0, 0, -1), (0, -1, 0))]
                    current = next(k for k, a in enumerate(axes) if (a - d.normalized()).length < 1e-6)
                    d = axes[(current + 1) % len(axes)] * d.length
                else:
                    side = d.cross(Vector((1.0, 0.0, 0.0)))
                    if side.length < 1e-3:
                        side = d.cross(Vector((0.0, 0.0, 1.0)))
                    d = (d.normalized() + side.normalized() * 0.1).normalized() * d.length
                ends[b] = head + d
            bpy.ops.object.mode_set(mode='EDIT')
            for i, place in enumerate(rig.places):
                if place["bone"] in bad:
                    eb = arm_data.edit_bones[place["name"]]
                    eb.tail = ends[place["bone"]]
                    eb.roll = 0.0
            bpy.ops.object.mode_set(mode='OBJECT')
        for i, place in enumerate(rig.places):
            b = rig.bones[place["bone"]]
            pb = arm.pose.bones[place["name"]]
            pb.rotation_mode = 'XYZ'
            if rig.main[b.index] != i:
                # A copy: edit its bone instead. It takes the bone's channels where it sits the
                # same way; otherwise it is keyed on import (as the game plays it).
                pb.lock_location = pb.lock_rotation = pb.lock_scale = (True, True, True)
                if place["follows"]:
                    # Drivers copy the channels exactly (constraints lose a scale to nothing).
                    for path in ("location", "rotation_euler", "scale"):
                        for axis in range(3):
                            fc = pb.driver_add(path, axis)
                            drv = fc.driver
                            drv.type = 'SUM'
                            var = drv.variables.new()
                            var.type = 'SINGLE_PROP'
                            var.targets[0].id_type = 'OBJECT'
                            var.targets[0].id = arm
                            var.targets[0].data_path = 'pose.bones["%s"].%s[%d]' % (b.name, path, axis)
                continue
            kinds = set(fm.types[s] for s in b.slots)
            pb.lock_location = (TRANSLATE not in kinds,) * 3
            pb.lock_rotation = (ROTATE not in kinds,) * 3
            pb.lock_scale = (SCALE not in kinds,) * 3
        return arm

    def _orthonormal(m, eps=1e-5):
        r = m.to_3x3()
        return all(abs((r.col[i]).dot(r.col[j]) - (1.0 if i == j else 0.0)) < eps for i in range(3) for j in range(3))

    def _place_local(rig, place, own):
        """A place's transform: its bone's, seen from inside the bones outside it that the game
        applies before it (moves and turns only, so this can always be undone)."""
        before = compose([own[b] for b in place["before"]])
        m = own[place["bone"]]
        if before == Matrix.Identity(4):
            return m.copy()
        return before.inverted() * m * before

    def _game_pose(b, fm, local, rest, prev):
        """A bone's (location, rotation, scale) for its transform `local` (armature space).
        A scale bone stays axis-aligned, so its pose is a plain scale (even to nothing)."""
        basis = rest.inverted() * local * rest
        if b.is_scale(fm):
            return (basis.translation.copy(), Euler((0.0, 0.0, 0.0), 'XYZ'),
                    Vector((basis[0][0], basis[1][1], basis[2][2])))
        loc, rot, scale = basis.decompose()
        euler = rot.to_euler('XYZ', prev) if prev is not None else rot.to_euler('XYZ')
        return (loc, euler, Vector((1.0, 1.0, 1.0)))

    def _shown(arm, data, model):
        """The model's vertices as Blender shows them now (rig version 3)."""
        mats = {}
        for name in set(data["bind"].values()):
            pb = arm.pose.bones.get(name)
            if pb is not None:
                mats[name] = pb.matrix * arm.data.bones[name].matrix_local.inverted()
        by_index = model._label_by_index()
        out = []
        for index, p in enumerate(model.rest):
            m = mats.get(data["bind"].get(str(by_index.get(index))))
            out.append(m * p if m is not None else p.copy())
        return out

    def _max_error(a, b):
        return max([(p - q).length for p, q in zip(a, b)] + [0.0]) * UNITS

    # -- import ----------------------------------------------------------------------------

    def import_animation(context, folder, objects, name=None, allow_empty=False):
        """allow_empty (graphics): an animation that moves none of the model's labels (it may only
        fade, or the model has no labels) still imports, as a rig without bones that keeps its
        frames and fades."""
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
        rig = GameRig(fm, fm_id, dict((label, len(vs)) for label, vs in model.vlabels.items()), used)
        if not rig.bones and not allow_empty:
            raise RuntimeError("the animation moves none of the selected model's labels")
        arm = _build_game_rig(context, name + " rig", rig, model, fm, anim.frames)
        bind = dict((label, rig.places[place]["name"]) for label, place in rig.bind.items())
        _bind(model, rig, arm, bind)
        fades = [(s, FADE_PREFIX + str(s)) for s in range(fm.count)
                 if fm.types[s] == ALPHA and (s in used or s in RIGS.get(fm_id, {}))
                 and any(l in model.flabels for l in fm.labels[s])]
        for slot, prop in fades:
            arm[prop] = 0
        n_fade_materials = _fade_materials(model, arm, fades, fm)
        rest = _rest(arm, rig)
        sim = Sim(fm, model.rest, model.vlabels)

        # Every frame's pose first, then keys: a channel is keyed where the bone can use it, or
        # where a frame needs it anyway (a pivot the game moves with another part).
        fixed = [i for i, place in enumerate(rig.places) if rig.main[place["bone"]] != i and not place["follows"]]
        poses, prev, games = [], {}, []
        for frame in anim.frames:
            pos, mats = sim.run(frame.present())
            games.append(pos)
            own = _bone_matrices(rig, mats)
            pose = {}
            for b in rig.bones:
                local = _place_local(rig, rig.places[rig.main[b.index]], own)
                pose[b.name] = _game_pose(b, fm, local, rest[b.index], prev.get(b.name))
                prev[b.name] = pose[b.name][1]
            for i in fixed:
                place = rig.places[i]
                b = rig.bones[place["bone"]]
                local = _place_local(rig, place, own)
                pose[place["name"]] = _game_pose(b, fm, local, rest[b.index], prev.get(place["name"]))
                prev[place["name"]] = pose[place["name"]][1]
            poses.append(pose)
        needed = {}
        for b in rig.bones:
            pb = arm.pose.bones[b.name]
            needed[b.name] = [
                ("location", not pb.lock_location[0] or any(p[b.name][0].length > 1e-5 for p in poses)),
                ("rotation_euler", not pb.lock_rotation[0] or any(Vector(p[b.name][1]).length > 1e-6 for p in poses)),
                ("scale", not pb.lock_scale[0] or any((p[b.name][2] - Vector((1, 1, 1))).length > 1e-6 for p in poses)),
            ]
        imported = []
        starts = []
        t = 0
        for k, (frame, length) in enumerate(zip(anim.frames, anim.seq.frame_lengths)):
            present = frame.present()
            pose = {}
            for b in rig.bones:
                pb = arm.pose.bones[b.name]
                pb.location, pb.rotation_euler, pb.scale = poses[k][b.name]
                for path, key in needed[b.name]:
                    if key:
                        pb.keyframe_insert(path, frame=t, group=b.name)
                pose[b.name] = _pose_vector(pb)
            for i in fixed:
                name_i = rig.places[i]["name"]
                pb = arm.pose.bones[name_i]
                pb.location, pb.rotation_euler, pb.scale = poses[k][name_i]
                for path in ("location", "rotation_euler", "scale"):
                    pb.keyframe_insert(path, frame=t, group=name_i)
            values = {}
            for slot, prop in fades:
                arm[prop] = int(present.get(slot, (0, 0, 0))[0])
                arm.keyframe_insert('["%s"]' % prop, frame=t)
                values[prop] = arm[prop]
            arm[FRAME_KEY] = k
            arm.keyframe_insert('["%s"]' % FRAME_KEY, frame=t)
            imported.append({"pose": pose, "fades": values})
            starts.append(t)
            t += length
        _set_interpolation(arm, [prop for _, prop in fades])

        data = {
            "version": GameRig.VERSION,
            "seq_hex": anim.seq.data.hex(),
            "framemap_id": fm_id,
            "framemap_hex": fm.data.hex(),
            "frames": [{"id": fid, "flags": fr.flags, "count": fr.count,
                        "values": dict((str(i), list(v)) for i, v in fr.present().items()),
                        "bytes": fr.encode().hex()}
                       for fid, fr in zip(anim.seq.frame_ids, anim.frames)],
            "bones": [{"name": b.name, "slots": b.slots, "labels": sorted(b.labels), "parent": b.parent,
                       "before": rig.places[rig.main[b.index]]["before"]}
                      for b in rig.bones],
            "copies": [place["name"] for i, place in enumerate(rig.places) if rig.main[place["bone"]] != i],
            "bind": dict((str(label), name) for label, name in bind.items()),
            "fades": [[slot, prop, slot_name(fm_id, slot, ALPHA)] for slot, prop in fades],
            "loose": [],
            "imported": imported,
        }
        arm[ROOT_KEY] = json.dumps(data)
        arm["osrs_targets"] = json.dumps([o.name for o in meshes])
        arm["last_frame_length"] = anim.seq.frame_lengths[-1] if anim.seq.frame_lengths else 1
        set_hand_properties(arm, anim.seq)

        scene = context.scene
        scene.render.fps = 50
        scene.render.fps_base = 1.0
        scene.frame_start = 0
        scene.frame_end = max(0, t - 1)
        # How far what Blender shows is from the game, frame by frame.
        worst = 0.0
        for k, start in enumerate(starts):
            scene.frame_set(start)
            worst = max(worst, _max_error(games[k], _shown(arm, data, model)))
        arm["osrs_accuracy"] = "Imported: Blender's pose is within %.2f game units of the game's" % worst
        scene.frame_set(0)
        return arm, anim, {"bones": len(rig.bones), "copies": len(data["copies"]), "fades": len(fades),
                           "loose": 0, "error": worst, "fade_materials": n_fade_materials}

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

    def _rotation_matrix(v):
        return Euler((v[0] / ANGLE, -v[2] / ANGLE, -v[1] / ANGLE), 'YXZ').to_matrix()

    def _matrix_distance(a, b):
        return sum(abs(a[i][j] - b[i][j]) for i in range(3) for j in range(3))

    def _rotation_values(lin, reference):
        """The game's rotation (x, y, z steps) nearest to the 3x3 rotation `lin`. The frame's own
        values (or no rotation) win whenever they give the same rotation, so an untouched part keeps
        its exact values. Near x = +-90 degrees (gimbal lock) the Euler angles Blender gives are
        unreliable, so the steps around each candidate are searched too."""
        e = lin.to_euler('YXZ')
        candidates = []
        for c in (e, Euler((math.pi - e.x, e.y + math.pi, e.z + math.pi), 'YXZ')):
            candidates.append([wrap_angle(int(round(c.x * ANGLE))), wrap_angle(int(round(-c.z * ANGLE))),
                               wrap_angle(int(round(-c.y * ANGLE)))])
        ref = list(reference) if reference is not None else [0, 0, 0]

        def cost(v):
            return _matrix_distance(_rotation_matrix(v), lin)

        def distance(v):  # the two equivalent Euler forms: the one nearer the frame's values
            return sum(abs(((a - r + 128) % 256) - 128) for a, r in zip(v, ref))
        best = min(candidates, key=lambda v: (round(cost(v), 4), distance(v)))
        best_cost = cost(best)
        if abs(math.cos(e.x)) < 0.2 or best_cost > 0.05:
            for base in list(candidates):
                for dx in (-1, 0, 1):
                    for dy in range(-3, 4):
                        for dz in range(-3, 4):
                            v = [base[0] + dx, base[1] + dy, base[2] + dz]
                            c = cost(v)
                            if c < best_cost:
                                best, best_cost = v, c
        if cost(ref) <= best_cost + 1e-4:
            return ref
        return [wrap_angle(v) for v in best]

    def _decompose_bone(sim, fm, sk, b, target, pos, state, reference):
        """The game values for bone b's slots that make its own transform `target`, starting from
        the positions and origin state the game has when it reaches the bone's first slot."""
        lin = target.to_3x3()
        values = {}
        kinds = dict((s, fm.types[s]) for s in b.slots)
        if SCALE in kinds.values():
            s = b.slots[0]
            exact = [lin[0][0] * 128, lin[2][2] * 128, lin[1][1] * 128]
            ref = reference.get(s, (128, 128, 128))
            if all(abs(v - r) <= 0.51 for v, r in zip(exact, ref)):
                values[s] = list(ref)
            else:
                values[s] = [int(round(v)) for v in exact]
            return values
        rot_slot = next((s for s in b.slots if kinds[s] == ROTATE), None)
        move_slot = next((s for s in b.slots if kinds[s] == TRANSLATE), None)
        if rot_slot is not None:
            values[rot_slot] = _rotation_values(lin.normalized(), reference.get(rot_slot))
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
            ref = reference.get(move_slot, (0, 0, 0))
            if all(abs(c - r) <= 0.51 for c, r in zip(t, ref)):
                values[move_slot] = list(ref)
            else:
                values[move_slot] = [int(round(c)) for c in t]
        except ValueError:
            values[move_slot] = [0, 0, 0]
        return values

    def _derive_frame(arm, data, fm, sk, sim, rest, old, imported=None):
        """A frame from the rig's current pose: (Frame, each bone's total transform in Blender).
        A bone posed as imported, under ancestors posed as imported, keeps the frame's own values
        (its pose is relative to the ancestors the game applies before it)."""
        pbs = arm.pose.bones
        totals = [pbs[b.name].matrix * rest[b.index].inverted() for b in sk.bones]
        own = [None] * len(sk.bones)
        unchanged = set()
        if all(getattr(b, "before", None) is not None for b in sk.bones):
            # Rig version 3: each bone lists the outer bones the game applies before it.
            same = {}

            def is_same(i):
                if i not in same:
                    b = sk.bones[i]
                    same[i] = old is not None and imported is not None and \
                        _close(_pose_vector(pbs[b.name]), imported["pose"].get(b.name)) and \
                        all(is_same(x) for x in b.before)
                return same[i]

            def own_of(i):
                if own[i] is None:
                    b = sk.bones[i]
                    local = rest[i] * pbs[b.name].matrix_basis * rest[i].inverted()
                    before = compose([own_of(x) for x in b.before])
                    own[i] = local if before == Matrix.Identity(4) else before * local * before.inverted()
                return own[i]
            for b in sk.bones:
                own_of(b.index)
                if is_same(b.index):
                    unchanged.add(b.index)
        else:
            if old is not None and imported is not None:
                for b in sk.bones:  # parents come first in the list
                    if (b.parent is None or b.parent in unchanged) and \
                            _close(_pose_vector(pbs[b.name]), imported["pose"].get(b.name)):
                        unchanged.add(b.index)
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
                    if b.index in unchanged:
                        derived.update((s, list(old_values[str(s)]) if str(s) in old_values else None) for s in b.slots)
                    else:
                        reference = dict((s, old_values[str(s)]) for s in b.slots if str(s) in old_values)
                        derived.update(_decompose_bone(sim, fm, sk, b, own[b.index], pos, state, reference))
                vals = derived[slot]
                if vals is None:  # unchanged and not in the frame
                    continue
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
        game_order = data.get("version", 2) >= GameRig.VERSION
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
                    frame, totals = _derive_frame(arm, data, fm, sk, sim, rest, old, imported)
                    encoded = frame.encode()
                    game, _ = sim.run(frame.present())
                    shown = _shown(arm, data, model) if game_order else _deformed(model, sk, totals)
                    worst = max(worst, _max_error(game, shown))
                # A frame keeps its own file while it is free (or already holds these bytes), so
                # an unedited sequence is written back as it was; otherwise an equal frame's file,
                # or a new one.
                wanted = old["id"] if old else None
                if wanted is not None and (wanted not in used or frames.get(wanted) == encoded):
                    frame_id = wanted
                else:
                    frame_id = by_content.get(encoded)
                    if frame_id is None:
                        frame_id = (group << 16) | next_file
                        next_file += 1
                used.add(frame_id)
                by_content.setdefault(encoded, frame_id)
                frame_ids.append(frame_id)
                frames[frame_id] = encoded
        finally:
            scene.frame_set(current)
        lengths = [b - a for a, b in zip(starts, starts[1:])] + [int(arm.get("last_frame_length", 1))]
        seq.frame_ids = frame_ids
        seq.frame_lengths = [max(0, min(65535, n)) for n in lengths]
        apply_hand_properties(arm, seq)
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

    class OsrsAnimAddHands(bpy.types.Operator):
        """Add the held-item properties to a rig imported before they existed, from its imported seq.dat"""
        bl_idname = "osrs_anim.add_hands"
        bl_label = "Add held items"
        bl_options = {'REGISTER', 'UNDO'}

        def execute(self, context):
            arm = find_root(context)
            if arm is None:
                return {'CANCELLED'}
            set_hand_properties(arm, Seq(bytes.fromhex(anim_data(arm)["seq_hex"])))
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
            box = layout.box()
            box.label("Held items (item id, 0 empty, -1 worn)")
            if RIGHT_HAND_KEY in arm.keys():
                box.prop(arm, '["%s"]' % RIGHT_HAND_KEY, text="Weapon slot")
                box.prop(arm, '["%s"]' % LEFT_HAND_KEY, text="Shield slot")
            else:
                box.operator(OsrsAnimAddHands.bl_idname, text="Add held items")
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

    CLASSES = (ImportOsrsAnim, ExportOsrsAnim, OsrsAnimAddFrame, OsrsAnimRemoveFrame, OsrsAnimAddHands, OsrsAnimPanel)

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
