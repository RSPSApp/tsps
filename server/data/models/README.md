# Models

Raw OSRS model files (`.dat`) and the custom animations and graphics made from them, one folder
each.

## Blender

`io_osrs_dat.py` is a Blender 2.79 add-on that imports these files and exports them back.

Install: File > User Preferences > Add-ons > Install Add-on from File..., pick `io_osrs_dat.py`,
tick **Import-Export: OSRS model (.dat)**, then Save User Settings. It adds
File > Import > OSRS model (.dat) and File > Export > OSRS model (.dat).

Import:
- reads every model encoding the client does (old, v1, v2, v3);
- one game tile (128 units) is 1 Blender unit, standing upright;
- each OSRS vertex group label becomes a vertex group `label_<n>` (one per vertex, weight 1.0);
  skeletal weights, where a model has them, become `bone_<n>` groups;
- each colour becomes a material `osrs_<hsl>` (`osrs_<hsl>_a<alpha>` when translucent) in game
  colours; flat-shaded faces have smooth shading off;
- face priority, face label, alpha, texture id and render type are kept as integer face data
  (`osrs_priority`, `osrs_face_label`, `osrs_alpha`, `osrs_texture_id` = texture id + 1, `osrs_render_type`).
  Faces added later (for example joined geometry) read 0 in all of them: priority 0, no texture.
  OSRS double-sided faces get their own vertex copies (`osrs_alias`), merged back on export.

Export writes the active mesh object as a v2 model (the encoding current cache models use), with
modifiers and the object transform applied and faces triangulated:
- colour from the face material's diffuse colour, as the nearest colour in the game's palette (it
  has no pure primaries: pure red becomes HSL 959, #f61e0e). An `osrs_<hsl>` name keeps that exact
  HSL only while the colour is unchanged, because several HSL values look the same on screen;
- transparency from the material's Transparency setting and Alpha (alpha 1.0 is opaque);
- vertex label from the vertex's heaviest `label_` group (0 if none);
- new faces get priority, face label and alpha 0 and no texture: set `osrs_priority` if they
  draw in the wrong order in game;
- textured faces are written with their own vertices as the texture mapping.

Changing colours: an imported model has one material per colour, shared by every face of that
colour (and by other imported models with the same colour). Change the material's Diffuse colour
to recolour all of those faces. To recolour only some faces, select them in Edit Mode and assign
them a new or different material in the Material panel.

Tested on 120 rev 241 cache models (v2 and v3) and old-format models: an import followed by an
export gives the same model to the game client's decoder (vertices, faces, colours, priorities,
alphas, labels, shading, textures, skeletal weights). Files are not byte-identical, because face
indices are stored uncompressed: a 1528-byte model can become 1653 bytes.

## Animations

`io_osrs_anim.py` (Blender 2.79 add-on **Import-Export: OSRS animation (seq.dat)**) imports an
OSRS frame animation onto models and exports it back. Install it like the model add-on.

An extracted animation is a folder: `seq.dat` (the sequence definition: frame list and lengths,
hand items, priorities), `framemap-<id>.dat` (the frame map: an ordered list of slots, each a
transform type and the vertex labels it moves) and `frames/<group>-<file>.dat` (per frame, the
values for each slot it uses). `info.json` is only for reading. Skeletal animations (some newer
content) aren't supported yet.

How the game animates: every frame walks the frame map's slots in order. An **origin** slot sets
the pivot to the middle of its labels' vertices, **move** moves its labels' vertices, **rotate**
turns them about the pivot (256 steps per turn), **scale** scales them about the pivot (128 =
unchanged), and **alpha** makes the faces of its face labels more transparent (8/255 per step).
That is why animations only work on models whose vertices carry the right labels (`label_<n>`
groups): a player animation moves every model built for players, including weapons.

Import: select the model(s) to animate, then File > Import > OSRS animation and pick `seq.dat`.
Several selected models are animated as one, as the game merges a player's body and equipment.
- An Empty `<name> anim` holds the animation. Each slot the frames use gets a control Empty under
  it, `<name> s<slot> <type> [<labels>]`, drawn at its pivot. Rotate, move or scale a control to
  rotate, move or scale its labels; alpha (and other) slots use the control's custom properties
  `x`, `y`, `z` (Tool Shelf > OSRS shows them). Rotations are Euler YXZ, which is the game's order.
- One Blender frame is one client tick (20 ms; the scene is set to 50 fps). Each keyframe of the
  anim Empty's `osrs_frame` property starts a game frame. Move those keys in the Dope Sheet to
  retime the animation. Tool Shelf > OSRS > Add frame / Remove frame adds or removes the game
  frame at the current Blender frame, and Last frame length sets the last frame's length.
- Keys are Constant, because the game shows one pose per frame. Key controls as usual (I); a
  control's value at each game frame's start is what gets exported.
- The preview hides the models and shows `<model> (pose)` copies in the pose at the current
  frame, updated as you edit. Tool Shelf > OSRS > Preview turns it off, showing the models
  themselves again (to edit or export them). Refresh re-reads the models after editing them.
- Add control for slot... adds a control for a slot no frame uses yet.

Export: File > Export > OSRS animation (or Tool Shelf > OSRS > Export animation...), pick where
`seq.dat` goes. It writes `seq.dat`, the frame map and the frames next to it. Unchanged frames
keep their file ids. A changed or new frame that would clash gets the next free file id in the
same group. Everything else in `seq.dat` is kept as it was.

## Graphics

`io_osrs_gfx.py` (**Import-Export: OSRS graphic (spotanim.dat)**) imports and exports graphics
(spot animations: spell effects, special attack trails, projectiles). It needs the model and
animation add-ons installed and enabled too.

An extracted graphic is a folder: `spotanim.dat` (the definition: which model and animation, its
size, turn and lighting), `model.dat` and `anim/` (its animation, as above).

Import: File > Import > OSRS graphic, pick `spotanim.dat`. This brings in the model and its
animation (edit them as above). The definition's size and turn are the anim Empty's
`width_scale`, `height_scale` (128 = as modelled) and `orientation` (degrees), shown in Tool Shelf
> OSRS and in the preview. Recolours, ambient and contrast are kept, but not shown.

Export: File > Export > OSRS graphic, pick where `spotanim.dat` goes. It writes `spotanim.dat`,
`model.dat` (v2) and `anim/`. The model and animation ids inside `spotanim.dat` stay as they
were; a custom graphic gets new ids when it is added to the game.

Tested on the Zamorak godsword special (`zamorak-godsword-special/`): importing and exporting
gives byte-identical `seq.dat`, frames, frame maps and `spotanim.dat`, and the same model. Edits,
added frames and removed frames export as expected, and the preview's rotations match the game's.
