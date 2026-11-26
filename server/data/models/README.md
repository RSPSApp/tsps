# Models

Raw OSRS model files (`.dat`), one folder per item: `drop.dat` (inventory / ground model),
`equip.dat` (male wear model) and, where it differs, `equip-female.dat`.

## Extracting models from the cache

The Model Extractor finds an item, NPC, object, animation or graphic in the local cache and saves
its files here:

```bash
cd server
yarn build    # once, and after pulling server changes
yarn models   # opens http://localhost:4790/
```

The same extractor is in the cache editor (`?cache=1`, with the server started with
`CACHE_EDITOR_ENABLED=1`): an item, NPC, loc, animation or graphic has an **Extract** tab that lists
the same files and writes the same folder, an NPC has an **Animations** tab, and an animation's
**Preview** plays it on NPCs built on its skeleton. What you edit comes back in through the editor's
asset library (see *Adding animations and graphics to the game*).

In the stand-alone page, pick a tab and search by id (`4151`) or name (`abyssal whip`; every word must appear, in the
name or the cache's own name). Animations and graphics have no display name, so they go by their
cache names, with underscores read as spaces: `human ready` finds `human_ready` (808), `ice
barrage` finds `ice_barrage_impact` (369). Picking a result lists the files it would write,
with each model's id, format and size, the recolours, and notes such as the wear slot. Extract
saves them into `server/data/models/<folder>/` with a README, and asks before replacing the
files in a folder that already exists.

The **Preview** tab shows any of those models in 3D before you extract it: drag to rotate,
scroll to zoom, double-click to reset. It uses the game client's own model decoder, so every
format opens, and hides the faces the game hides. **Show in-game colours** applies the
recolours; off, it shows the colours stored in the file. Under the model, **In-game colours** lists each
recolour as hex: the file's colour, the colour the game puts in its place, and how many of this
model's faces have it. Textured faces show their base colour,
and worn models and body parts show unposed. The decoder is built from `client/` when the tool
starts, so the preview needs the client's packages (`yarn install` in client/).

| Kind | Files |
| --- | --- |
| Item | `drop.dat`, `equip.dat` (male), `equip-female.dat`, `equip1.dat`/`equip2.dat` for extra worn parts, `chathead.dat` (+ `chathead-female.dat` when it differs) |
| NPC | `body.dat` and `chathead.dat`, or `body/<model>.dat` and `chathead/<model>.dat` when there are several parts |
| Object | `model.dat`, or `model-<model>.dat` when there are several |
| Animation | `seq.dat`, `frames/<group>-<file>.dat`, `framemap-<id>.dat` and `info.json`, for io_osrs_anim |
| Graphic | `spotanim.dat`, `model.dat`, its animation in `anim/` (as above) and `info.json`, for io_osrs_gfx |

An animation's or graphic's files are laid out the way the Blender add-ons read and write them,
`info.json` included: the add-ons name the imported action and objects from it. The notes give its frames and length,
its frame map (0 is the player skeleton) and what it puts in each hand. Skeletal animations
(tagged in the results) keep their keyframes in another archive that io_osrs_anim can't read, so
they are listed but can't be extracted.

### Animations in the preview

The cache links an NPC only to its movement animations (stand, walk, turn, run, crawl). Attack,
block, death and spawn animations aren't in the cache; the server picks them (`NpcDefinition`).
No animation names the NPCs that play it, but each one is made for one skeleton (its frame map),
and it only moves a model built for that skeleton. The extractor links them that way:

- An NPC's **Animations** tab lists what it plays (from the cache, and the server's combat ones,
  tagged *server*), then the other animations made for its skeleton, its own creature's first.
  An animation the server plays on it that is made for another skeleton is tagged *other
  skeleton* (it won't move this model properly). **Play** shows it in the Preview tab, which
  also has an **Animation** list; **Open** opens it in the Animations tab.
- An animation's **Preview** plays it on a body: the default player when it's made for the player
  skeleton (frame map 0), the NPCs that play it, or else NPCs built on its skeleton. Pick another
  body above the model.
- A graphic's preview plays its own animation.

Bodies are lit and posed by the game client's own code, so they move as in game; skeletal
animations play too, though they can't be extracted. The first time the extractor starts it reads
every animation's skeleton, about 20 seconds (a skeletal animation's is inside its keyframes); it
saves them in your temp folder, so later starts are instant. An NPC's list or an animation's
preview opened before then waits for it.

The files are the cache's model bytes, unchanged: recolours and retextures are applied in game,
so they are listed in the README instead. Noted items and bank placeholders are left out of name
searches unless **Include noted items and placeholders** is ticked; an id search always finds them.
It is separate from the game server, the local panel and the cache editor, and only listens on
this machine. `MODEL_EXTRACTOR_PORT` changes its port and `MODEL_EXTRACTOR_OPEN=0` stops it
opening the browser.

## Blender

`io_osrs_dat.py` is a Blender 2.79 add-on that imports these files and exports them back.

Install: File > User Preferences > Add-ons > Install Add-on from File..., pick `io_osrs_dat.py`,
tick **Import-Export: OSRS model (.dat)**, then Save User Settings. It adds
File > Import > OSRS model (.dat) and File > Export > OSRS model (.dat).

Blender keeps its own copy of an installed add-on. When `io_osrs_dat.py`, `io_osrs_anim.py` or
`io_osrs_gfx.py` changes here, install it again and restart Blender. The graphic add-on refuses to
work with a model add-on older than 1.2.0 or an animation add-on older than 3.1.0, and says which
to reinstall. (Before 1.1.0 the model add-on exported a graphic's posed model and its current
frame's fades: a collapsed, invisible graphic.)

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
- each textured face's texture mapping triangle (the three points the texture is stretched
  between, often shared by a whole surface) is kept: face data `osrs_texture_map`, and the
  triangles in the mesh's `osrs_texture_triangles` property.

Export writes the active mesh object as a v2 model, with modifiers (except an animation's
Armature) and the object transform applied and faces triangulated. When v2 can't hold the model
it writes v3, the cache's newer encoding: more than 64 texture mapping triangles, or render types
other than flat and smooth. What it writes for each face and vertex:
- colour from the face material's diffuse colour, as the nearest colour in the game's palette (it
  has no pure primaries: pure red becomes HSL 959, #f61e0e). An `osrs_<hsl>` name keeps that exact
  HSL only while the colour is unchanged, because several HSL values look the same on screen;
- transparency from the material's Transparency setting and Alpha (alpha 1.0 is opaque);
- vertex label from the vertex's heaviest `label_` group (0 if none);
- new faces get priority, face label and alpha 0 and no texture: set `osrs_priority` if they
  draw in the wrong order in game;
- a textured face keeps its imported texture mapping while the mapping's three vertices haven't
  moved; otherwise, and for new textured faces, the face's own vertices are its mapping;
- the imported render type is kept while it still agrees with the face's Smooth setting.

Changing colours: an imported model has one material per colour, shared by every face of that
colour (and by other imported models with the same colour). Change the material's Diffuse colour
to recolour all of those faces. To recolour only some faces, select them in Edit Mode and assign
them a new or different material in the Material panel.

Tested on 120 rev 241 cache models (v2 and v3) and the old-format `dragonic-katana` files: an
import followed by an export gives the same model to the game client's decoder (vertices, faces,
colours, priorities, alphas, labels, shading, textures, skeletal weights). Files are not
byte-identical, because face indices are stored uncompressed: the tassets model goes from 1528
to 1653 bytes.

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
  weapon hand). Other skeletons, and the player skeleton's older slots, get bones named
  `Part <n>`. The model gets an Armature modifier and a vertex group per bone.
- Blender shows every frame as the game plays it, whatever the skeleton. Some skeletons scale a
  part after turning a bigger one, or move parts that overlap without nesting. Those bones sit
  where the game's order needs them, and a bone that has to be in two places gets a locked
  `<bone> copy` there. Pose the bone itself; its copies follow it. A copy under different
  bones than its own (rare: some NPCs) is keyed as imported and doesn't follow edits, and the
  export report then shows how far the game's pose is from Blender's.
- Each bone that turns or scales has its head on the game's pivot for it, including the offset
  the frames give that pivot (a wheel turning on its axle).
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
  specials, for example, empty both hands (0). The
  game stores an item id plus 512; the add-on adds and removes the 512 itself. A rig imported
  before these existed has an **Add held items** button that reads them from its `seq.dat`.
- The model add-on exports the model unposed (the Armature modifier is left out), so the model and
  the animation can be edited in the same file.

Export: File > Export > OSRS animation (or Tool Shelf > OSRS > Export animation...), pick where
`seq.dat` goes. It writes `seq.dat`, the frame map and the frames next to it:
- Frames you didn't change are written exactly as they were. In a changed frame, the bones you
  didn't change (and that sit inside no changed bone) keep their exact numbers too.
- Changed and new frames are converted back to the game's numbers. Rotations are in steps of 1.4
  degrees, so a pose can move by a fraction of a unit (a few units on a big NPC). The report (and
  Tool Shelf > OSRS) says how far the game's pose is from Blender's, in game units (128 per tile).
- A changed frame keeps its file id when it can, and gets the next free id in the same group
  otherwise. The held items are written from Weapon slot and Shield slot (left out for -1).
  Everything else in `seq.dat` is kept as it was.

The rig only works while the bones are as imported: pose them, but don't move them in Edit Mode.
Rigs imported with an add-on older than 3.0 still export, but re-import an animation to get the
current rig.

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
`model.dat` (v2, or v3 as above) and `anim/`, whichever frame the timeline is on. The model and
animation ids inside `spotanim.dat` stay as they were; a custom graphic gets new ids when it is
added to the game.

A graphic whose animation moves none of its model's parts (one that only fades, or a model
without labels) imports as a rig without bones; its fades still play and export.

Tested on the Zamorak godsword special, extracted from the cache:
- The rigs reproduce every game frame to within 0.0001 game units.
- Importing and exporting gives byte-identical `seq.dat`, frames, frame maps and `spotanim.dat`,
  and the same model.
- Converting every frame back from the bones gives exactly the original numbers.
- Edits, added frames and removed frames export as expected.

Tested on 100 random cache animations on 59 skeletons (players, NPCs and graphics):
- Blender shows every frame within 0.015 game units of the game.
- Exporting unchanged gives the same frames, byte for byte. Converting every frame back from
  the bones gives exactly the original numbers.
- Turning one bone in one frame changes only that bone's numbers (and those of bones inside it)
  in that frame.

Tested on 130 random cache graphics (128 animated, on 106 frame maps; recoloured, resized and
turned ones among them; skeletal ones can't be imported):
- Importing and exporting gives byte-identical `spotanim.dat`, `seq.dat` and frames, and a model
  the game shows the same (positions, faces, labels, colours, alphas, shading, priorities,
  textures and their mapping).
- Exporting with the timeline on another frame gives the same files, and importing an export and
  exporting it again gives the same files.
- Converting every frame back from the bones gives the game's positions exactly for 129; for one
  (graphic 4174) a rotation applied after an uneven scale can't be a Blender bone pose, so Blender
  shows it within 0.92 game units and converting it back is within 1.3. Exporting it unchanged,
  or with other bones edited, keeps its exact numbers.

## Adding animations and graphics to the game

Custom animations and graphics are **cache editor assets**, stored the way the editor stores
uploaded models: outside the cache, under `server/data/assets/`, with a row each in the `assets`
list of `server/data/definitions/custom-definitions.json`. The folders here stay your Blender
working copies; the game never reads them.

To add one, start the server with `CACHE_EDITOR_ENABLED=1`, open the client with `?cache=1`, and in
**Assets** pick *Animations (yours)* or *Graphics (yours)*:

- **Import from asset library** lists the add-ons' exports under `server/data/models`: an
  animation is any folder with `seq.dat` (and `frames/`), a graphic any folder with `spotanim.dat`.
  **Import local folder** takes the same folder from anywhere on your computer.
- An animation's files are checked as the client will decode them (every frame, against the
  cache's own skeleton) and stored in `server/data/assets/animation/<hash>/`.
- A graphic's `spotanim.dat` is stored in `server/data/assets/graphic/<hash>/`, its `model.dat`
  as a **model asset** (1,000,000 and up, shipped with the editor's other custom models), and its
  `anim/` folder as an **animation asset**. The graphic's row points at both.
- New ids start at 50000 (animations and graphics are numbered separately, up to 65534). Names are
  lower_case and not a name the cache already uses; server plugins look ids up by name:
  `CacheDefinitions.getSeqId("zgs_special_keep_weapon")`, `CacheDefinitions.getCustomSpotanimId("zgs_special_trail")`.

To **edit** one: **Export** writes the asset back into `server/data/models/<folder>/` (a graphic
with its `model.dat` and `anim/`). Edit it in Blender, export over the same folder, then choose
*Replace … keeping its id and name* and import it again. Replacing a graphic replaces its own
animation in place too, so every id and name a plugin uses stays the same.

Restart the server after adding or replacing assets. At startup `plugins/world/CustomAnimations`
checks every stored folder again, gives each animation's frames a frame group of their own
(30000, 30001, ... in id order), points each graphic at its model and animation, and sends them all
to players when they log in, in one packet unless they are too many for one. A broken asset turns
custom animations off with a message saying what is wrong; the server keeps running.

Only the frame list (seq opcode 1) is moved to the animation's own frame group. Chat-head frames
(opcode 12, which 87 cache animations have) still point at the cache's frames, so an edit to
those frames in Blender doesn't show in game.

Animations use the cache's skeletons (frame maps). The add-ons never change them, and the editor
refuses a `framemap-<id>.dat` that differs from the cache's. A model of your own can have a
skeleton of its own: a frame map whose id the cache doesn't have, from 30000 to 65535, written as
`framemap-<id>.dat` next to the frames that use it. The editor sends it with the animation.

Use them like any other id: `new Animation(50000)`, `new Graphic(50001)`, or in game
`::anim 50000` and `::gfx 50001`.
