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
OSRS frame animation as an ordinary armature animation, and exports it back. Install it like the
model add-on (if an older version is installed, install this file over it and restart Blender).

An extracted animation is a folder: `seq.dat` (the sequence definition: frame list and lengths,
hand items, priorities), `framemap-<id>.dat` (the frame map, the game's skeleton) and
`frames/<group>-<file>.dat` (one pose each). `info.json` is only for reading. Skeletal animations
(some newer content) aren't supported yet.

Import: select the model(s) to animate, then File > Import > OSRS animation and pick `seq.dat`.
Select every part (a player's body and equipment are one model in game).
- An armature `<name> rig` appears, with a bone per moving part, named and nested like the parts.
  For players: Body > Torso > Head, Right upper arm > Right forearm > Right hand > Weapon, Left
  upper arm > ... > Left hand, Right thigh > Right shin > Right foot, and so on (right is the
  weapon hand). Other skeletons get bones named `Part <n>`. The model gets an Armature modifier
  and a vertex group per bone.
- Every game frame is a keyed pose. Animate in Pose Mode as usual: select a bone, rotate it, press
  I. Children follow their parents. Bones only allow what the game can do with them: most can only
  rotate, so their move and scale channels are locked. A part that stretches has its own small
  `<part> scale` bone, and the Body can also move.
- One Blender frame is one client tick (20 ms; the scene is set to 50 fps). Each keyframe of the
  rig's `osrs_frame` property starts a game frame (the rig's top row in the Dope Sheet). Drag
  those keys to retime. Tool Shelf > OSRS has Add frame and Remove frame (at the current frame) and
  the last frame's length.
- Between game frames Blender blends the poses (as the client smooths them in game). Only the
  pose at the start of each game frame is exported.
- Fades (graphics fade parts in and out) are sliders in Tool Shelf > OSRS, keyed like anything
  else: each step makes those faces 8/255 more transparent, so 32 hides them. The faces they act on
  use copies of their material (`<material>~fade`), so the fade shows in Material or Textured view.
  Recolour the original material; the copies follow it and export as it.
- What the player holds during the animation is in Tool Shelf > OSRS > Held items: **Weapon slot**
  and **Shield slot** (the rig's `osrs_right_hand` and `osrs_left_hand` properties). An item id
  shows that item, 0 empties the hand, -1 keeps what is worn. They apply to the whole animation
  (the game has one value per hand for each animation, not one per frame). Jagex's godsword
  specials empty both hands (0); `zamorak-godsword-special` here keeps what is worn (-1). The
  game stores an item id plus 512; the add-on adds and removes the 512 itself. A rig imported
  before these existed has an **Add held items** button that reads them from its `seq.dat`.
- The model add-on exports the model unposed (the Armature modifier is left out), so the model and
  the animation can be edited in the same file.

Export: File > Export > OSRS animation (or Tool Shelf > OSRS > Export animation...), pick where
`seq.dat` goes. It writes `seq.dat`, the frame map and the frames next to it:
- Frames you didn't change are written exactly as they were.
- Changed and new frames are converted back to the game's numbers. Rotations are in steps of 1.4
  degrees, so a pose can move by a fraction of a unit. The report (and Tool Shelf > OSRS) says how
  far the game's pose is from Blender's, in game units (128 per tile).
- A changed frame keeps its file id when it can, and gets the next free id in the same group
  otherwise. The held items are written from Weapon slot and Shield slot (left out for -1).
  Everything else in `seq.dat` is kept as it was.

The rig only works while the bones are as imported: pose them, but don't move them in Edit Mode.

## Graphics

`io_osrs_gfx.py` (**Import-Export: OSRS graphic (spotanim.dat)**) imports and exports graphics
(spot animations: spell effects, special attack trails, projectiles). It needs the model and
animation add-ons installed and enabled too.

An extracted graphic is a folder: `spotanim.dat` (the definition: which model and animation, its
size, turn and lighting), `model.dat` and `anim/` (its animation, as above).

Import: File > Import > OSRS graphic, pick `spotanim.dat`. This brings in the model and its
animation as a rig (edit them as above). The definition's size (`width_scale`, `height_scale`, 128
= as modelled) and turn (`orientation`, degrees) are in Tool Shelf > OSRS > OSRS graphic. They
are exported, but not shown in Blender, nor are recolours and lighting.

Export: File > Export > OSRS graphic, pick where `spotanim.dat` goes. It writes `spotanim.dat`,
`model.dat` (v2) and `anim/`. The model and animation ids inside `spotanim.dat` stay as they
were; a custom graphic gets new ids when it is added to the game.

Tested on the Zamorak godsword special (`zamorak-godsword-special/`):
- The rigs reproduce every game frame to within 0.0001 game units.
- Importing and exporting gives byte-identical `seq.dat`, frames, frame maps and `spotanim.dat`,
  and the same model.
- Converting every frame back from the bones gives exactly the original numbers.
- Edits, added frames and removed frames export as expected.

## Adding animations and graphics to the game

`server/data/definitions/custom-animations.json` lists the custom animations and graphics the game
loads, each pointing at a folder here, as the add-ons export them:

```json
{
  "animations": [
    { "id": 50000, "name": "zgs_special_keep_weapon", "path": "zamorak-godsword-special/player-anim" },
    { "id": 50001, "name": "zgs_special_trail_spotanim", "path": "zamorak-godsword-special/graphic/anim" }
  ],
  "graphics": [
    { "id": 50000, "name": "zgs_special_trail", "path": "zamorak-godsword-special/graphic",
      "model": 1900000, "animation": "zgs_special_trail_spotanim" }
  ]
}
```

- `id`: the animation or graphic id the game uses. Ids must be free in the cache (start at 50000)
  and at most 65534. Animations and graphics are numbered separately.
- `name`: lower_case, not a name the cache already uses. Server plugins can look ids up by name:
  `CacheDefinitions.getSeqId("zgs_special_keep_weapon")`, `CacheDefinitions.getCustomSpotanimId("zgs_special_trail")`.
- `path`: the folder under `server/data/models`. An animation folder holds `seq.dat` and
  `frames/`; a graphic folder holds `spotanim.dat` and `model.dat`.
- A graphic's `model` is the id its `model.dat` gets: a custom model id, 1,000,000 or more, not
  used by a custom item (they use 1,5xx,xxx; graphics use 1,900,000 and up). Its `animation` is a
  custom animation's name or id, or any cache animation's id or name. List the graphic's own
  animation (its `anim/` folder) under `animations`.

At startup the server checks every folder, gives each animation's frames a frame group of their
own (30000, 30001, ... in list order), points each graphic at its model and animation, and sends
them all to players when they log in. A broken folder stops the server with a message saying what
is wrong.

Animations use the cache's skeletons (frame maps). The add-ons never change them, and the server
refuses a `framemap-<id>.dat` that differs from the cache's.

Use them like any other id: `new Animation(50000)`, `new Graphic(50000)`, or in game
`::anim 50000` and `::gfx 50000`. After changing the list or a folder, restart the server.
