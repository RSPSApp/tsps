# Blender 2.79 add-on: File > Import / Export > OSRS model (.dat)
#
# Reads OSRS model files straight from the cache format (old, v1, v2 and v3 encodings, as the client's
# rs/model/ModelData.ts decodes them) and writes the v2 encoding back.
#
# In Blender:
# - one mesh object, scaled so one game tile (128 units) is 1 Blender unit, standing upright
#   (OSRS x, y, z -> Blender x, z, -y; OSRS y points down);
# - OSRS vertex group labels -> vertex groups "label_<n>" (weight 1.0, one per vertex);
# - skeletal (animaya) weights, if any -> vertex groups "bone_<n>" (weight = scale / 255);
# - face colours -> materials "osrs_<hsl>" (colour from the game's palette);
# - flat-shaded faces (render type 1) -> smooth off;
# - per-face priority, face label, alpha, texture id and raw render type -> integer face layers
#   osrs_priority, osrs_face_label, osrs_alpha, osrs_texture_id (texture id + 1, 0 = none),
#   osrs_render_type. Faces added later (joined geometry) read as 0 in all of them: priority 0,
#   face label 0, no texture.
#
# Export uses the active mesh object (modifiers applied, world transform applied, triangulated).
# Colour comes from an "osrs_<hsl>" material name, else the nearest palette colour of the material's
# diffuse colour. Faces without layer values (new geometry) get priority / label / alpha 0 and no
# texture. Vertices with no label_ group get label 0. Textured faces are written with their own
# vertices as the texture mapping.
#
# Install: File > User Preferences > Add-ons > Install Add-on from File..., pick this file, tick it.
# Headless: blender -b --python io_osrs_dat.py -- import <model.dat> [export <out.dat>]

bl_info = {
    "name": "OSRS model (.dat)",
    "author": "tsps",
    "version": (1, 0, 0),
    "blender": (2, 79, 0),
    "location": "File > Import / Export > OSRS model (.dat)",
    "description": "Import and export OSRS cache model files with vertex group labels",
    "category": "Import-Export",
}

import os
import re
import struct
import sys

import bmesh
import bpy
from bpy.props import StringProperty
from bpy_extras.io_utils import ExportHelper, ImportHelper
from mathutils import Matrix, Vector

SCALE = 128.0
LABEL_PREFIX = "label_"
BONE_PREFIX = "bone_"
MATERIAL_PREFIX = "osrs_"
FACE_LAYERS = ("osrs_priority", "osrs_face_label", "osrs_alpha", "osrs_texture_id", "osrs_render_type")
# osrs_texture_id holds texture id + 1, so 0 (Blender's value for faces added later, e.g. joined
# geometry) means no texture. Imports before 2026-11-04 wrote "osrs_texture" (id, -1 = none),
# read on export with 0 also taken as none, since joined faces got 0 there too.
LEGACY_TEXTURE_LAYER = "osrs_texture"
# Vertex layer: -1, or the vertex this one copies (copies let OSRS double-sided faces exist in Blender).
ALIAS_LAYER = "osrs_alias"


# ---------------------------------------------------------------------------------------------
# Palette (ColorUtil.buildPalette with brightness 0.8, as the client's HSL_RGB_MAP)

def _hsl_channel(t, p, q):
    if 6.0 * t < 1.0:
        return p + (q - p) * 6.0 * t
    if 2.0 * t < 1.0:
        return q
    if 3.0 * t < 2.0:
        return p + (q - p) * (0.6666666666666666 - t) * 6.0
    return p


def _build_palette(brightness=0.8):
    palette = [0] * 65536
    index = 0
    for hs in range(512):
        hue = (hs >> 3) / 64.0 + 0.0078125
        saturation = (hs & 7) / 8.0 + 0.0625
        for light in range(128):
            lightness = light / 128.0
            r = g = b = lightness
            if saturation != 0.0:
                if lightness < 0.5:
                    q = lightness * (1.0 + saturation)
                else:
                    q = lightness + saturation - lightness * saturation
                p = 2.0 * lightness - q
                tr = hue + 0.3333333333333333
                if tr > 1.0:
                    tr -= 1.0
                tb = hue - 0.3333333333333333
                if tb < 0.0:
                    tb += 1.0
                r = _hsl_channel(tr, p, q)
                g = _hsl_channel(hue, p, q)
                b = _hsl_channel(tb, p, q)
            channels = []
            for c in (int(r * 256.0), int(g * 256.0), int(b * 256.0)):
                channels.append(int(((c / 256.0) ** brightness) * 256.0))
            rgb = (channels[0] << 16) | (channels[1] << 8) | channels[2]
            palette[index] = rgb if rgb != 0 else 1
            index += 1
    return palette


_PALETTE = None


def palette():
    global _PALETTE
    if _PALETTE is None:
        _PALETTE = _build_palette()
    return _PALETTE


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1.0 / 2.4)) - 0.055


def hsl_to_linear_rgb(hsl):
    rgb = palette()[hsl & 0xffff]
    return tuple(srgb_to_linear(((rgb >> shift) & 0xff) / 255.0) for shift in (16, 8, 0))


def nearest_hsl(linear_rgb):
    target = [int(round(linear_to_srgb(max(0.0, min(1.0, c))) * 255)) for c in linear_rgb]
    best, best_distance = 0, None
    for hsl, rgb in enumerate(palette()):
        dr = ((rgb >> 16) & 0xff) - target[0]
        dg = ((rgb >> 8) & 0xff) - target[1]
        db = (rgb & 0xff) - target[2]
        distance = dr * dr + dg * dg + db * db
        if best_distance is None or distance < best_distance:
            best, best_distance = hsl, distance
            if distance == 0:
                break
    return best


# ---------------------------------------------------------------------------------------------
# Decoding (ports of ModelData.decodeOld / decodeV1 / decodeV2 / decodeV3)

class Reader(object):
    def __init__(self, data, offset=0):
        self.data = data
        self.offset = offset

    def u8(self):
        value = self.data[self.offset]
        self.offset += 1
        return value

    def s8(self):
        value = self.u8()
        return value - 256 if value > 127 else value

    def u16(self):
        value = (self.data[self.offset] << 8) | self.data[self.offset + 1]
        self.offset += 2
        return value

    def smart2(self):
        if self.data[self.offset] < 128:
            return self.u8() - 64
        return self.u16() - 49152


class Model(object):
    def __init__(self):
        self.version = 0
        self.vertices = []
        self.faces = []
        self.colors = []
        self.render_types = None
        self.priorities = None
        self.priority = 0
        self.alphas = None
        self.face_skins = None
        self.vertex_skins = None
        self.textures = None
        self.texture_coords = None
        self.texture_triangles = []
        self.maya = None


def _read_vertices(model, count, flags, xs, ys, zs, skins, has_skins, has_maya):
    x = y = z = 0
    model.vertex_skins = [0] * count if has_skins else None
    for i in range(count):
        flag = flags.u8()
        if flag & 1:
            x += xs.smart2()
        if flag & 2:
            y += ys.smart2()
        if flag & 4:
            z += zs.smart2()
        model.vertices.append((x, y, z))
        if has_skins:
            model.vertex_skins[i] = skins.u8()
    if has_maya:
        model.maya = []
        for i in range(count):
            n = skins.u8()
            model.maya.append([(skins.u8(), skins.u8()) for _ in range(n)])


def _read_faces(model, count, types, indices):
    a = b = c = last = 0
    for _ in range(count):
        kind = types.u8()
        if kind == 1:
            a = indices.smart2() + last
            b = indices.smart2() + a
            c = indices.smart2() + b
            last = c
        elif kind == 2:
            b = c
            c = indices.smart2() + last
            last = c
        elif kind == 3:
            a = c
            c = indices.smart2() + last
            last = c
        elif kind == 4:
            a, b = b, a
            c = indices.smart2() + last
            last = c
        model.faces.append((a, b, c))


def _apply_old_render_info(model, infos):
    """Old / v2 render info byte: bit 0 flat, bit 1 textured (colour holds the texture id)."""
    model.render_types = [0] * len(model.faces)
    model.textures = [-1] * len(model.faces)
    model.texture_coords = [-1] * len(model.faces)
    for i, info in enumerate(infos):
        model.render_types[i] = info & 1
        if info & 2:
            model.texture_coords[i] = info >> 2
            model.textures[i] = model.colors[i]
            model.colors[i] = 127


def decode(data):
    data = bytearray(data)
    if data[-1] == 0xFD and data[-2] == 0xFF:
        return _decode_v3(data)
    if data[-1] == 0xFE and data[-2] == 0xFF:
        return _decode_v2(data)
    if data[-1] == 0xFF and data[-2] == 0xFF:
        return _decode_v1(data)
    return _decode_old(data)


def _decode_v2(data):
    m = Model()
    m.version = 2
    f = Reader(data, len(data) - 23)
    vc, fc, tc = f.u16(), f.u16(), f.u8()
    has_info, priority, has_alpha, has_face_skins, has_skins, has_maya = (f.u8() for _ in range(6))
    x_len, y_len, z_len, index_len, skins_len = (f.u16() for _ in range(5))
    o = vc
    o_types = o; o += fc
    o_prio = o
    if priority == 255: o += fc
    o_fskins = o
    if has_face_skins == 1: o += fc
    o_info = o
    if has_info == 1: o += fc
    o_skins = o; o += skins_len
    o_alpha = o
    if has_alpha == 1: o += fc
    o_index = o; o += index_len
    o_color = o; o += fc * 2
    o_tex = o; o += tc * 6
    o_x = o; o += x_len
    o_y = o; o += y_len
    o_z = o
    _read_vertices(m, vc, Reader(data, 0), Reader(data, o_x), Reader(data, o_y), Reader(data, o_z),
                   Reader(data, o_skins), has_skins == 1, has_maya == 1)
    colors, info, prio, alpha, fskin = (Reader(data, o_color), Reader(data, o_info), Reader(data, o_prio),
                                        Reader(data, o_alpha), Reader(data, o_fskins))
    infos = []
    m.priorities = [] if priority == 255 else None
    m.priority = 0 if priority == 255 else priority
    m.alphas = [] if has_alpha == 1 else None
    m.face_skins = [] if has_face_skins == 1 else None
    for _ in range(fc):
        m.colors.append(colors.u16())
        if has_info == 1: infos.append(info.u8())
        if priority == 255: m.priorities.append(prio.s8())
        if has_alpha == 1: m.alphas.append(alpha.s8())
        if has_face_skins == 1: m.face_skins.append(fskin.u8())
    _read_faces(m, fc, Reader(data, o_types), Reader(data, o_index))
    t = Reader(data, o_tex)
    m.texture_triangles = [(t.u16(), t.u16(), t.u16()) for _ in range(tc)]
    if has_info == 1:
        _apply_old_render_info(m, infos)
    return m


def _decode_old(data):
    m = Model()
    f = Reader(data, len(data) - 18)
    vc, fc, tc = f.u16(), f.u16(), f.u8()
    has_info, priority, has_alpha, has_face_skins, has_skins = (f.u8() for _ in range(5))
    x_len, y_len, z_len, index_len = (f.u16() for _ in range(4))
    o = vc
    o_types = o; o += fc
    o_prio = o
    if priority == 255: o += fc
    o_fskins = o
    if has_face_skins == 1: o += fc
    o_info = o
    if has_info == 1: o += fc
    o_skins = o
    if has_skins == 1: o += vc
    o_alpha = o
    if has_alpha == 1: o += fc
    o_index = o; o += index_len
    o_color = o; o += fc * 2
    o_tex = o; o += tc * 6
    o_x = o; o += x_len
    o_y = o; o += y_len
    o_z = o
    _read_vertices(m, vc, Reader(data, 0), Reader(data, o_x), Reader(data, o_y), Reader(data, o_z),
                   Reader(data, o_skins), has_skins == 1, False)
    colors, info, prio, alpha, fskin = (Reader(data, o_color), Reader(data, o_info), Reader(data, o_prio),
                                        Reader(data, o_alpha), Reader(data, o_fskins))
    infos = []
    m.priorities = [] if priority == 255 else None
    m.priority = 0 if priority == 255 else priority
    m.alphas = [] if has_alpha == 1 else None
    m.face_skins = [] if has_face_skins == 1 else None
    for _ in range(fc):
        m.colors.append(colors.u16())
        if has_info == 1: infos.append(info.u8())
        if priority == 255: m.priorities.append(prio.s8())
        if has_alpha == 1: m.alphas.append(alpha.s8())
        if has_face_skins == 1: m.face_skins.append(fskin.u8())
    _read_faces(m, fc, Reader(data, o_types), Reader(data, o_index))
    t = Reader(data, o_tex)
    m.texture_triangles = [(t.u16(), t.u16(), t.u16()) for _ in range(tc)]
    if has_info == 1:
        _apply_old_render_info(m, infos)
    return m


def _texture_type_counts(data, tc):
    types = [Reader(data, i).s8() for i in range(tc)]
    simple = sum(1 for t in types if t == 0)
    complex_ = sum(1 for t in types if 1 <= t <= 3)
    cube = sum(1 for t in types if t == 2)
    return types, simple, complex_, cube


def _read_v13_faces(m, data, fc, o, has_render, priority, has_alpha, has_face_skins, has_textures, tc):
    colors, render, prio, alpha, fskin, tex, coord = (Reader(data, o[k]) for k in
                                                      ("color", "render", "prio", "alpha", "fskins", "tex", "coord"))
    m.render_types = [] if has_render else None
    m.priorities = [] if priority == 255 else None
    m.priority = 0 if priority == 255 else priority
    m.alphas = [] if has_alpha == 1 else None
    m.face_skins = [] if has_face_skins == 1 else None
    m.textures = [] if has_textures == 1 else None
    m.texture_coords = [] if has_textures == 1 and tc > 0 else None
    for _ in range(fc):
        m.colors.append(colors.u16())
        if has_render: m.render_types.append(render.s8())
        if priority == 255: m.priorities.append(prio.s8())
        if has_alpha == 1: m.alphas.append(alpha.s8())
        if has_face_skins == 1: m.face_skins.append(fskin.u8())
        if has_textures == 1: m.textures.append(tex.u16() - 1)
        if m.texture_coords is not None:
            m.texture_coords.append(coord.u8() - 1 if m.textures[-1] != -1 else -1)


def _decode_v3(data):
    m = Model()
    m.version = 3
    f = Reader(data, len(data) - 26)
    vc, fc, tc = f.u16(), f.u16(), f.u8()
    has_render, priority, has_alpha, has_face_skins, has_textures, has_skins, has_maya = (f.u8() for _ in range(7))
    x_len, y_len, z_len, index_len, coord_len, skins_len = (f.u16() for _ in range(6))
    types, simple, complex_, cube = _texture_type_counts(data, tc)
    o = {}
    p = tc + vc
    o["render"] = p
    if has_render == 1: p += fc
    o["types"] = p; p += fc
    o["prio"] = p
    if priority == 255: p += fc
    o["fskins"] = p
    if has_face_skins == 1: p += fc
    o["skins"] = p; p += skins_len
    o["alpha"] = p
    if has_alpha == 1: p += fc
    o["index"] = p; p += index_len
    o["tex"] = p
    if has_textures == 1: p += fc * 2
    o["coord"] = p; p += coord_len
    o["color"] = p; p += fc * 2
    o["x"] = p; p += x_len
    o["y"] = p; p += y_len
    o["z"] = p; p += z_len
    o["simple"] = p
    _read_vertices(m, vc, Reader(data, tc), Reader(data, o["x"]), Reader(data, o["y"]), Reader(data, o["z"]),
                   Reader(data, o["skins"]), has_skins == 1, has_maya == 1)
    _read_v13_faces(m, data, fc, o, has_render == 1, priority, has_alpha, has_face_skins, has_textures, tc)
    _read_faces(m, fc, Reader(data, o["types"]), Reader(data, o["index"]))
    t = Reader(data, o["simple"])
    m.texture_triangles = [(t.u16(), t.u16(), t.u16()) if kind == 0 else None for kind in types]
    return m


def _decode_v1(data):
    m = Model()
    m.version = 1
    f = Reader(data, len(data) - 23)
    vc, fc, tc = f.u16(), f.u16(), f.u8()
    flags = f.u8()
    if flags & 8:
        m.version = data[f.offset - 7]
    priority, has_alpha, has_face_skins, has_textures, has_skins = (f.u8() for _ in range(5))
    x_len, y_len, z_len, index_len, coord_len = (f.u16() for _ in range(5))
    types, simple, complex_, cube = _texture_type_counts(data, tc)
    has_render = flags & 1 == 1
    o = {}
    p = tc + vc
    o["render"] = p
    if has_render: p += fc
    o["types"] = p; p += fc
    o["prio"] = p
    if priority == 255: p += fc
    o["fskins"] = p
    if has_face_skins == 1: p += fc
    o["skins"] = p
    if has_skins == 1: p += vc
    o["alpha"] = p
    if has_alpha == 1: p += fc
    o["index"] = p; p += index_len
    o["tex"] = p
    if has_textures == 1: p += fc * 2
    o["coord"] = p; p += coord_len
    o["color"] = p; p += fc * 2
    o["x"] = p; p += x_len
    o["y"] = p; p += y_len
    o["z"] = p; p += z_len
    o["simple"] = p
    _read_vertices(m, vc, Reader(data, tc), Reader(data, o["x"]), Reader(data, o["y"]), Reader(data, o["z"]),
                   Reader(data, o["skins"]), has_skins == 1, False)
    _read_v13_faces(m, data, fc, o, has_render, priority, has_alpha, has_face_skins, has_textures, tc)
    _read_faces(m, fc, Reader(data, o["types"]), Reader(data, o["index"]))
    t = Reader(data, o["simple"])
    m.texture_triangles = [(t.u16(), t.u16(), t.u16()) if kind == 0 else None for kind in types]
    if m.version >= 13:
        m.vertices = [(x >> 2, y >> 2, z >> 2) for x, y, z in m.vertices]
    return m


# ---------------------------------------------------------------------------------------------
# Encoding (v2, the inverse of decode_v2)

def _smart2(out, value):
    if -64 <= value < 64:
        out.append(value + 64)
    elif -16384 <= value < 16384:
        out.extend(struct.pack(">H", value + 49152))
    else:
        raise ValueError("delta %d is outside the model format's range (-16384..16383)" % value)


def encode_v2(m):
    vc, fc, tc = len(m.vertices), len(m.faces), len(m.texture_triangles)
    if vc > 65535 or fc > 65535:
        raise ValueError("too many vertices or faces (%d, %d; max 65535)" % (vc, fc))
    if tc > 255:
        raise ValueError("%d texture triangles (max 255)" % tc)
    flags, xs, ys, zs = bytearray(), bytearray(), bytearray(), bytearray()
    last = (0, 0, 0)
    for vertex in m.vertices:
        delta = [vertex[i] - last[i] for i in range(3)]
        flag = 0
        for bit, d, out in ((1, delta[0], xs), (2, delta[1], ys), (4, delta[2], zs)):
            if d != 0:
                flag |= bit
                _smart2(out, d)
        flags.append(flag)
        last = vertex
    skins = bytearray()
    has_skins = m.vertex_skins is not None
    if has_skins:
        skins.extend(s & 0xff for s in m.vertex_skins)
    has_maya = m.maya is not None
    if has_maya:
        for weights in m.maya:
            skins.append(len(weights))
            for bone, scale in weights:
                skins.extend((bone & 0xff, scale & 0xff))
    types, indices = bytearray(), bytearray()
    last_index = 0
    for a, b, c in m.faces:
        types.append(1)
        _smart2(indices, a - last_index)
        _smart2(indices, b - a)
        _smart2(indices, c - b)
        last_index = c
    infos = None
    colors = list(m.colors)
    if m.render_types is not None or m.textures is not None:
        infos = bytearray()
        for i in range(fc):
            info = (m.render_types[i] & 1) if m.render_types is not None else 0
            texture = m.textures[i] if m.textures is not None else -1
            if texture >= 0:
                info |= 2 | ((m.texture_coords[i] & 0x3f) << 2)
                colors[i] = texture
            infos.append(info)
        if not any(infos):
            infos = None
    priorities = m.priorities
    priority = m.priority
    if priorities is not None and len(set(priorities)) <= 1:
        priority = priorities[0] if priorities else 0
        priorities = None
    if priorities is None and not 0 <= priority < 255:
        raise ValueError("model priority %d (0-254)" % priority)
    alphas = m.alphas if m.alphas is not None and any(m.alphas) else None
    face_skins = m.face_skins if m.face_skins is not None and any(m.face_skins) else None
    out = bytearray()
    out += flags
    out += types
    if priorities is not None:
        out.extend(p & 0xff for p in priorities)
    if face_skins is not None:
        out.extend(s & 0xff for s in face_skins)
    if infos is not None:
        out += infos
    out += skins
    if alphas is not None:
        out.extend(a & 0xff for a in alphas)
    out += indices
    for color in colors:
        out.extend(struct.pack(">H", color & 0xffff))
    for p, mm, n in m.texture_triangles:
        out.extend(struct.pack(">HHH", p, mm, n))
    out += xs
    out += ys
    out += zs
    out.extend(struct.pack(">HHBBBBBBBHHHHH", vc, fc, tc, 1 if infos is not None else 0,
                           255 if priorities is not None else priority, 1 if alphas is not None else 0,
                           1 if face_skins is not None else 0, 1 if has_skins else 0, 1 if has_maya else 0,
                           len(xs), len(ys), len(zs), len(indices), len(skins)))
    out.extend((0xFF, 0xFE))
    return bytes(out)


# ---------------------------------------------------------------------------------------------
# Blender

def osrs_to_blender(x, y, z):
    return Vector((x / SCALE, z / SCALE, -y / SCALE))


def blender_to_osrs(v):
    return (int(round(v.x * SCALE)), int(round(-v.z * SCALE)), int(round(v.y * SCALE)))


def _material(hsl, alpha):
    name = MATERIAL_PREFIX + str(hsl) + ("_a%d" % alpha if alpha else "")
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.diffuse_color = hsl_to_linear_rgb(hsl)
        mat.diffuse_intensity = 1.0
        mat.specular_intensity = 0.0
        if alpha:
            mat.use_transparency = True
            mat.alpha = 1.0 - alpha / 255.0
    return mat


def import_dat(context, path):
    with open(path, "rb") as handle:
        m = decode(handle.read())
    name = os.path.splitext(os.path.basename(path))[0]
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    context.scene.objects.link(obj)
    bm = bmesh.new()
    alias = bm.verts.layers.int.new(ALIAS_LAYER)
    verts = [bm.verts.new(osrs_to_blender(*v)) for v in m.vertices]
    for vertex in verts:
        vertex[alias] = -1
    copies = []  # (Blender index, model index) of vertex copies
    layers = dict((key, bm.faces.layers.int.new(key)) for key in FACE_LAYERS)
    materials, skipped = {}, 0
    for i, (a, b, c) in enumerate(m.faces):
        try:
            face = bm.faces.new((verts[a], verts[b], verts[c]))
        except ValueError:
            # Blender refuses a second face on the same vertices (OSRS double-sided faces) and
            # degenerate faces: give this face its own copies, merged back on export.
            corners = []
            for index in (a, b, c):
                copy = bm.verts.new(verts[index].co)
                copy[alias] = index
                copies.append((len(verts) + len(copies), index))
                corners.append(copy)
            try:
                face = bm.faces.new(corners)
            except ValueError:
                skipped += 1
                continue
        alpha = (m.alphas[i] & 0xff) if m.alphas is not None else 0
        key = (m.colors[i], alpha)
        if key not in materials:
            materials[key] = len(materials)
            mesh.materials.append(_material(m.colors[i], alpha))
        face.material_index = materials[key]
        render_type = m.render_types[i] if m.render_types is not None else 0
        face.smooth = (render_type & 1) == 0
        face[layers["osrs_priority"]] = m.priorities[i] if m.priorities is not None else m.priority
        face[layers["osrs_face_label"]] = m.face_skins[i] if m.face_skins is not None else 0
        face[layers["osrs_alpha"]] = alpha
        face[layers["osrs_texture_id"]] = (m.textures[i] if m.textures is not None else -1) + 1
        face[layers["osrs_render_type"]] = render_type
    bm.to_mesh(mesh)
    bm.free()
    # Blender vertex index -> model vertex index, for the originals and their copies.
    sources = [(index, index) for index in range(len(m.vertices))] + copies
    if m.vertex_skins is not None:
        by_label = {}
        for blender_index, index in sources:
            by_label.setdefault(m.vertex_skins[index], []).append(blender_index)
        for label in sorted(by_label):
            obj.vertex_groups.new(LABEL_PREFIX + str(label)).add(by_label[label], 1.0, 'REPLACE')
    if m.maya is not None:
        groups = {}
        for blender_index, index in sources:
            for bone, scale in m.maya[index]:
                if bone not in groups:
                    groups[bone] = obj.vertex_groups.new(BONE_PREFIX + str(bone))
                groups[bone].add([blender_index], scale / 255.0, 'REPLACE')
    obj["osrs_format"] = "v%d" % m.version if m.version else "old"
    for selected in context.selected_objects:
        selected.select = False
    obj.select = True
    context.scene.objects.active = obj
    return obj, m, skipped


def _srgb_bytes(linear_rgb):
    return tuple(int(round(linear_to_srgb(max(0.0, min(1.0, c))) * 255)) for c in linear_rgb)


def material_colour(mat):
    """(hsl, alpha) to export for a material. Its diffuse colour and transparency decide; an
    "osrs_<hsl>[_a<alpha>]" name only keeps the exact HSL / alpha while they still match, since
    several HSL values share one on-screen colour."""
    if mat is None:
        return 127, 0
    alpha = int(round((1.0 - mat.alpha) * 255)) if mat.use_transparency else 0
    match = re.match(r"^%s(\d+)(?:_a(\d+))?$" % MATERIAL_PREFIX, mat.name.split(".")[0])
    if match:
        named_hsl, named_alpha = int(match.group(1)) & 0xffff, int(match.group(2) or 0)
        same_colour = all(abs(a - b) <= 1 for a, b in
                          zip(_srgb_bytes(mat.diffuse_color), _srgb_bytes(hsl_to_linear_rgb(named_hsl))))
        hsl = named_hsl if same_colour else nearest_hsl(mat.diffuse_color)
        return hsl, named_alpha if abs(alpha - named_alpha) <= 1 else alpha
    return nearest_hsl(mat.diffuse_color), alpha


def _group_values(obj, mesh, prefix, by_weight):
    """Per vertex: its (number, weight) groups with this prefix, heaviest first when by_weight, else in
    the order they were assigned (the model's own order for imported skeletal weights)."""
    names = dict((g.index, g.name[len(prefix):]) for g in obj.vertex_groups if g.name.startswith(prefix)
                 and g.name[len(prefix):].isdigit())
    result = []
    for vertex in mesh.vertices:
        values = [(int(names[g.group]), g.weight) for g in vertex.groups if g.group in names]
        result.append(sorted(values, key=lambda item: -item[1]) if by_weight else values)
    return result, bool(names)


def export_dat(context, path, obj=None):
    obj = obj or context.active_object
    if obj is None or obj.type != 'MESH':
        raise RuntimeError("select a mesh object to export")
    mesh = obj.to_mesh(context.scene, True, 'PREVIEW')
    try:
        mesh.transform(obj.matrix_world)
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.to_mesh(mesh)
        bm.free()
        m = Model()
        positions = [blender_to_osrs(v.co) for v in mesh.vertices]
        labels, has_labels = _group_values(obj, mesh, LABEL_PREFIX, True)
        bones, has_bones = _group_values(obj, mesh, BONE_PREFIX, False)
        # Merge import copies back into the vertex they copy while they still match it.
        aliases = mesh.vertex_layers_int.get(ALIAS_LAYER)
        target = list(range(len(positions)))
        if aliases is not None:
            for index, item in enumerate(aliases.data):
                source = item.value
                if (0 <= source < len(positions) and source != index and aliases.data[source].value == -1
                        and positions[source] == positions[index] and labels[source] == labels[index]
                        and bones[source] == bones[index]):
                    target[index] = source
        remap = {}
        for index in range(len(positions)):
            if target[index] == index:
                remap[index] = len(m.vertices)
                m.vertices.append(positions[index])
        if has_labels:
            m.vertex_skins = [labels[i][0][0] if labels[i] else 0 for i in range(len(positions)) if target[i] == i]
        if has_bones:
            m.maya = [[(bone, max(0, min(255, int(round(w * 255))))) for bone, w in bones[i]]
                      for i in range(len(positions)) if target[i] == i]
        layer = dict((key, mesh.polygon_layers_int.get(key)) for key in FACE_LAYERS)
        legacy_texture = mesh.polygon_layers_int.get(LEGACY_TEXTURE_LAYER)
        hsl_by_material = dict((index, material_colour(mat)) for index, mat in enumerate(mesh.materials))
        m.priorities, m.face_skins, m.alphas, m.render_types, m.textures, m.texture_coords = [], [], [], [], [], []
        triangles = {}
        for i, poly in enumerate(mesh.polygons):
            m.faces.append(tuple(remap[target[v]] for v in poly.vertices))
            hsl, material_alpha = hsl_by_material.get(poly.material_index, (127, 0))
            m.colors.append(hsl)
            value = lambda key, default: layer[key].data[i].value if layer[key] is not None else default
            m.priorities.append(value("osrs_priority", 0))
            m.face_skins.append(value("osrs_face_label", 0))
            m.alphas.append(material_alpha)
            m.render_types.append(0 if poly.use_smooth else 1)
            if layer["osrs_texture_id"] is not None:
                texture = value("osrs_texture_id", 0) - 1
            elif legacy_texture is not None:
                texture = legacy_texture.data[i].value
                texture = texture if texture > 0 else -1
            else:
                texture = -1
            m.textures.append(texture)
            if texture >= 0:
                key = m.faces[-1]
                if key not in triangles:
                    triangles[key] = len(triangles)
                    m.texture_triangles.append(key)
                m.texture_coords.append(triangles[key])
            else:
                m.texture_coords.append(-1)
        if not any(t >= 0 for t in m.textures):
            m.textures = m.texture_coords = None
        data = encode_v2(m)
    finally:
        bpy.data.meshes.remove(mesh)
    with open(path, "wb") as handle:
        handle.write(data)
    return m, len(data)


class ImportOsrsDat(bpy.types.Operator, ImportHelper):
    """Import an OSRS cache model (.dat)"""
    bl_idname = "import_scene.osrs_dat"
    bl_label = "Import OSRS model"
    bl_options = {'REGISTER', 'UNDO'}
    filename_ext = ".dat"
    filter_glob = StringProperty(default="*.dat", options={'HIDDEN'})

    def execute(self, context):
        try:
            obj, m, skipped = import_dat(context, self.filepath)
        except Exception as error:
            self.report({'ERROR'}, "OSRS import failed: %s" % error)
            return {'CANCELLED'}
        note = ", %d degenerate faces skipped" % skipped if skipped else ""
        self.report({'INFO'}, "%s: %d vertices, %d faces, %d groups%s" % (
            obj.name, len(m.vertices), len(m.faces), len(obj.vertex_groups), note))
        return {'FINISHED'}


class ExportOsrsDat(bpy.types.Operator, ExportHelper):
    """Export the active mesh as an OSRS cache model (.dat, v2)"""
    bl_idname = "export_scene.osrs_dat"
    bl_label = "Export OSRS model"
    filename_ext = ".dat"
    filter_glob = StringProperty(default="*.dat", options={'HIDDEN'})

    def execute(self, context):
        try:
            m, size = export_dat(context, self.filepath)
        except Exception as error:
            self.report({'ERROR'}, "OSRS export failed: %s" % error)
            return {'CANCELLED'}
        self.report({'INFO'}, "Wrote %d vertices, %d faces (%d bytes)" % (len(m.vertices), len(m.faces), size))
        return {'FINISHED'}


def menu_import(self, context):
    self.layout.operator(ImportOsrsDat.bl_idname, text="OSRS model (.dat)")


def menu_export(self, context):
    self.layout.operator(ExportOsrsDat.bl_idname, text="OSRS model (.dat)")


def register():
    bpy.utils.register_class(ImportOsrsDat)
    bpy.utils.register_class(ExportOsrsDat)
    bpy.types.INFO_MT_file_import.append(menu_import)
    bpy.types.INFO_MT_file_export.append(menu_export)


def unregister():
    bpy.types.INFO_MT_file_import.remove(menu_import)
    bpy.types.INFO_MT_file_export.remove(menu_export)
    bpy.utils.unregister_class(ExportOsrsDat)
    bpy.utils.unregister_class(ImportOsrsDat)


if __name__ == "__main__":
    register()
    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--") + 1:]
        while args:
            command, target = args[0], args[1]
            args = args[2:]
            if command == "import":
                obj, m, skipped = import_dat(bpy.context, target)
                print("OSRS-IMPORT", obj.name, "v", len(m.vertices), "f", len(m.faces), "groups",
                      len(obj.vertex_groups), "skipped", skipped)
            elif command == "export":
                m, size = export_dat(bpy.context, target)
                print("OSRS-EXPORT", target, "v", len(m.vertices), "f", len(m.faces), "bytes", size)
