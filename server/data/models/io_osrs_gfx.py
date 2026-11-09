# Blender 2.79 add-on: File > Import / Export > OSRS graphic (spotanim.dat)
#
# A graphic (spot animation: spell effects, special attack trails, projectiles) is a small
# definition (config archive 13) that names one model and one animation, plus a size, a turn and
# lighting. An extracted graphic is a folder:
#   spotanim.dat   the definition
#   model.dat      its model (any OSRS model encoding)
#   anim/          its animation (seq.dat, framemap-<id>.dat, frames/), if it has one
#
# Import (pick spotanim.dat) brings in the model with the OSRS model add-on and the animation with
# the OSRS animation add-on, on that model: edit both as those add-ons describe. The definition's
# size is the anim Empty's "width_scale" (x and z) and "height_scale" (y), 128 = as modelled, and
# its turn is "orientation" (degrees); the preview shows them. Ambient / contrast and recolours are
# kept as they are, but not shown.
#
# Export (pick where spotanim.dat goes) writes spotanim.dat (with the size and turn from the anim
# Empty), model.dat (from the model, v2 encoding) and anim/ next to it. The model and animation ids
# inside spotanim.dat are unchanged: new ids are given when the graphic is added to the game.
#
# Needs the "OSRS model (.dat)" (io_osrs_dat.py) and "OSRS animation (seq.dat)" (io_osrs_anim.py)
# add-ons installed too.

bl_info = {
    "name": "OSRS graphic (spotanim.dat)",
    "author": "tsps",
    "version": (1, 0, 0),
    "blender": (2, 79, 0),
    "location": "File > Import / Export > OSRS graphic",
    "description": "Import and export OSRS graphics (spot animations): model, animation and definition",
    "category": "Import-Export",
}

import json
import os
import struct

DEFAULTS = {"width_scale": 128, "height_scale": 128, "orientation": 0}
SCALE_OPS = {4: "width_scale", 5: "height_scale", 6: "orientation"}


class SpotAnim(object):
    """A spot animation definition (config archive 13, rev 241). Every opcode is kept byte for byte;
    the size (4, 5) and turn (6) can be changed."""

    def __init__(self, data):
        d = bytes(data)
        self.ops = []
        self.model = self.seq = -1
        self.values = dict(DEFAULTS)
        o = 0
        while o < len(d):
            op = d[o]
            o += 1
            if op == 0:
                break
            start = o
            if op == 1:
                self.model = struct.unpack(">H", d[o:o + 2])[0]
                o += 2
            elif op == 3:
                self.model = struct.unpack(">I", d[o:o + 4])[0]
                o += 4
            elif op == 2:
                self.seq = struct.unpack(">H", d[o:o + 2])[0]
                o += 2
            elif op in (4, 5, 6, 42):
                if op in SCALE_OPS:
                    self.values[SCALE_OPS[op]] = struct.unpack(">H", d[o:o + 2])[0]
                o += 2
            elif op in (7, 8):
                o += 1
            elif op == 9:
                while d[o] != 0:
                    o += 1
                o += 1
            elif op == 10:
                pass
            elif op in (40, 41):
                o += 1 + d[o] * 4
            else:
                raise ValueError("unknown spot animation opcode %d" % op)
            self.ops.append((op, d[start:o]))

    def encode(self):
        out = bytearray()
        written = set()
        for op, payload in self.ops:
            if op in SCALE_OPS:
                written.add(op)
                payload = struct.pack(">H", int(self.values[SCALE_OPS[op]]) & 0xffff)
            out.append(op)
            out.extend(payload)
        for op in sorted(SCALE_OPS):
            key = SCALE_OPS[op]
            if op not in written and int(self.values[key]) != DEFAULTS[key]:
                out.append(op)
                out.extend(struct.pack(">H", int(self.values[key]) & 0xffff))
        out.append(0)
        return bytes(out)


try:
    import bpy
except ImportError:
    bpy = None

if bpy is not None:
    from bpy.props import StringProperty
    from bpy_extras.io_utils import ExportHelper, ImportHelper

    SPOTANIM_KEY = "osrs_spotanim"

    def _addons():
        try:
            import io_osrs_dat
            import io_osrs_anim
        except ImportError:
            raise RuntimeError("install and enable the OSRS model and OSRS animation add-ons too")
        return io_osrs_dat, io_osrs_anim

    def import_graphic(context, path):
        model_addon, anim_addon = _addons()
        folder = os.path.dirname(path)
        with open(path, "rb") as f:
            spot = SpotAnim(f.read())
        name = os.path.basename(os.path.normpath(folder))
        info_path = os.path.join(folder, "info.json")
        if os.path.exists(info_path):
            with open(info_path) as f:
                spot_id = json.load(f).get("spotanim")
            if spot_id is not None:
                name = "gfx %d" % spot_id
        obj, model, skipped = model_addon.import_dat(context, os.path.join(folder, "model.dat"))
        obj.name = name + " model"
        root = None
        anim_folder = os.path.join(folder, "anim")
        if os.path.exists(os.path.join(anim_folder, "seq.dat")):
            root, anim = anim_addon.import_animation(context, anim_folder, [obj], name=name)
        else:
            # No animation: an Empty still carries the definition (and an empty frame list).
            root = bpy.data.objects.new(name + " anim", None)
            context.scene.objects.link(root)
            root["osrs_targets"] = json.dumps([obj.name])
        root[SPOTANIM_KEY] = _read_hex(path)
        for key, value in spot.values.items():
            root[key] = value
        if root.get("osrs_preview"):
            anim_addon.update_preview(context.scene, root, force=True)
        for o in context.selected_objects:
            o.select = False
        root.select = True
        context.scene.objects.active = root
        return root, obj, spot

    def _read_hex(path):
        with open(path, "rb") as f:
            return f.read().hex()

    def find_graphic_root(context):
        _, anim_addon = _addons()
        root = anim_addon.find_root(context)
        if root is not None and SPOTANIM_KEY in root.keys():
            return root
        roots = [o for o in context.scene.objects if SPOTANIM_KEY in o.keys()]
        return roots[0] if len(roots) == 1 else None

    def export_graphic(context, path, root):
        model_addon, anim_addon = _addons()
        folder = os.path.dirname(path)
        spot = SpotAnim(bytes.fromhex(root[SPOTANIM_KEY]))
        for key in DEFAULTS:
            spot.values[key] = int(root.get(key, DEFAULTS[key]))
        models = anim_addon.targets(root)
        if len(models) != 1:
            raise RuntimeError("a graphic has one model; this one has %d" % len(models))
        with open(path, "wb") as f:
            f.write(spot.encode())
        model, size = model_addon.export_dat(context, os.path.join(folder, "model.dat"), obj=models[0])
        frames = 0
        if "osrs_anim" in root.keys():
            seq, written = anim_addon.export_animation(root, os.path.join(folder, "anim"))
            frames = len(seq.frame_ids)
        return model, frames

    class ImportOsrsGfx(bpy.types.Operator, ImportHelper):
        """Import an OSRS graphic folder (pick its spotanim.dat): model, animation and definition"""
        bl_idname = "import_scene.osrs_spotanim"
        bl_label = "Import OSRS graphic"
        bl_options = {'REGISTER', 'UNDO'}
        filename_ext = ".dat"
        filter_glob = StringProperty(default="spotanim.dat", options={'HIDDEN'})

        def execute(self, context):
            try:
                root, obj, spot = import_graphic(context, self.filepath)
            except Exception as error:
                self.report({'ERROR'}, "OSRS graphic import failed: %s" % error)
                return {'CANCELLED'}
            self.report({'INFO'}, "%s: model %d, animation %d" % (root.name, spot.model, spot.seq))
            return {'FINISHED'}

    class ExportOsrsGfx(bpy.types.Operator, ExportHelper):
        """Export the OSRS graphic: spotanim.dat, model.dat and anim/"""
        bl_idname = "export_scene.osrs_spotanim"
        bl_label = "Export OSRS graphic"
        filename_ext = ".dat"
        filter_glob = StringProperty(default="spotanim.dat", options={'HIDDEN'})

        def invoke(self, context, event):
            self.filepath = "spotanim.dat"
            context.window_manager.fileselect_add(self)
            return {'RUNNING_MODAL'}

        def execute(self, context):
            try:
                root = find_graphic_root(context)
                if root is None:
                    raise RuntimeError("select the graphic's anim Empty")
                model, frames = export_graphic(context, self.filepath, root)
            except Exception as error:
                self.report({'ERROR'}, "OSRS graphic export failed: %s" % error)
                return {'CANCELLED'}
            self.report({'INFO'}, "Wrote the definition, a %d-vertex model and %d frames" % (
                len(model.vertices), frames))
            return {'FINISHED'}

    class OsrsGfxPanel(bpy.types.Panel):
        bl_label = "OSRS graphic"
        bl_space_type = 'VIEW_3D'
        bl_region_type = 'TOOLS'
        bl_category = "OSRS"

        @classmethod
        def poll(cls, context):
            try:
                return find_graphic_root(context) is not None
            except RuntimeError:
                return False

        def draw(self, context):
            root = find_graphic_root(context)
            layout = self.layout
            layout.prop(root, '["width_scale"]', text="Width (128 = 1x)")
            layout.prop(root, '["height_scale"]', text="Height (128 = 1x)")
            layout.prop(root, '["orientation"]', text="Turn (degrees)")
            layout.operator(ExportOsrsGfx.bl_idname, text="Export graphic...")

    def menu_import(self, context):
        self.layout.operator(ImportOsrsGfx.bl_idname, text="OSRS graphic (spotanim.dat)")

    def menu_export(self, context):
        self.layout.operator(ExportOsrsGfx.bl_idname, text="OSRS graphic (spotanim.dat)")

    CLASSES = (ImportOsrsGfx, ExportOsrsGfx, OsrsGfxPanel)

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
