# Creator v2.2.0

**NPC Creator** and **Gear Creator** are optional full-width tools in the TSPS cache editor. Both use the same editor suite with separate workspaces. The suite uses the original GhostScape editor's visual assembly layout: pictured parts on the left, the creature in the centre, and sliders on the right. There is no setup wizard.

All projects and exported content stay outside the OSRS cache. The original GhostScape editors are unchanged. Definitions and Assets remain available as the cache editor's existing tools.

## Preview references

In a male or female worn view, enable **Body reference** and choose **Dummy** or **Character · neutral skin** beside it. The character uses native player body kits with neutral skin and quiet clothing; covered body slots stay hidden. Skin-painted gear previews with that skin tone, while Paint mode retains its magenta marker.

Under **View → Background**, choose **Studio**, **Lumbridge courtyard**, **Al Kharid desert** or **Varrock castle rooftop**. Locations use bounded native cache scenery, loaded on demand and cached as a background layer. They follow camera orbit and zoom without becoming selectable or affecting Fit, animation meshes or exports. The ground grid remains available in Studio. Reference and background preferences survive reloads.

## Open it

Run `./start-local.sh` from this checkout. It enables Creator, uses this worktree's assigned ports, and opens the cache editor. If Creator is already running, it opens that instance without starting another server. Use `./start-local.sh --no-open` to leave browser opening to you.

To start manually with the cache editor enabled:

```sh
CACHE_EDITOR_ENABLED=1 yarn start
```

Open the client with `?cache=1`, then choose **NPC Creator** or **Gear Creator** beside **Definitions** and **Assets**. This worktree is `http://localhost:3101/?cache=1`.

WorldAdmin's **Tools** sidebar also has **NPC Creator** and **Gear Creator** when the plugin is enabled on this local world. They open `?cache=1&tool=npc-editor` and `?cache=1&tool=gear-editor` directly. The older `tool=content-builders` and `tool-view=npc|gear` links still work.

Each visited workspace remains mounted while you switch tools, retaining its unsaved project, selection and undo history. Browser drafts are also separate for NPCs and gear, including across reloads. Older browser drafts remain readable. Direct tool URLs `/embedded?view=npc|gear` and standalone `/?view=npc|gear` use the same suite. Standalone workspace buttons save the current browser draft before switching; they do not require discarding it. **Open** lists saved projects for the current creator. Import a project in its matching creator.

Creator, our AdminPanel and Monster Examine plugins, and newly exported creations declare the display category `@ Ghost Plugins @`. The leading `@` sorts before TSPS's normal folder categories. `♱` sorts after letters in the panel's current sorter. The category is metadata, so files stay in their original directories. Other Ghost plugins should declare `category: '@ Ghost Plugins @'` in their module and ZIP manifest too.

If the local Creator process exits while the world is running, the plugin restarts it with a delay capped at 30 seconds. A tab that cannot connect retries automatically and offers **Retry now**. A normal world shutdown cancels recovery. Restarting the world still closes its tool service until startup finishes.

1. Search a creature. Click its picture to see its parts.
2. Drag **Whole creature** or **Body only** into the centre, or click **Add**. That starts an editable project immediately.
3. Search another creature and drag its pictured head, arm, leg or other part onto the model. **Place** lets you click the target instead, with a translucent preview. Escape cancels placement. **Add** attaches to the selected part. Side limbs start with **Mirror to the other side** enabled.
4. Drag the attached part to move it. Turn on **Gizmo** for Move, Rotate and Scale handles, or use the sliders. Moving or scaling a parent moves its attached children. The parts list shows the hierarchy.
5. Use **Paint**, **Sculpt**, **Animate** and **Game data** as needed. **Save** keeps the editable project. **Export to game** saves and checks it, then offers a plugin ZIP download.

Right drag turns the camera, Shift drag pans, and the wheel zooms. Front, Side, Back, Top and Fit are above the viewport. Ctrl+Z undoes edits; Ctrl+Y redoes them; Ctrl+S saves.

**View** independently shows or hides the selection rectangle and floor grid. Gizmo visibility and mode are also remembered. **Snap** helps align pieces. **Isolate** hides other parts temporarily. On narrow screens, **Tools** and **Properties** open drawers beside the model.

Each job changes both side panels. Build keeps the pictured part library. Paint, Sculpt, Animate and Game data replace it with their own tools. The model stays in the centre.

## The five jobs

- **Build:** drag parts or use Move, Rotate and Size handles. The inspector updates while you drag. Width, Height and Depth follow the part's scene orientation, including parent rotations. Coloured X/Y/Z badges match the local Size handles; hover or focus a size control to highlight its direction. Angled axes show ↗ and resize along that angle. Keep proportions links all size axes. Reset position, rotation or size separately; use precise nudges, Centre left / right and Fit selection. Duplicate retains attachments and materials. Gear copies retain editable child parts instead of flattening them. F frames the selection; shortcuts ignore text entry.
- **Copy pieces:** select a piece, press Ctrl+C, switch item, view or project, then Ctrl+V. This copies its size, rotation, position, pivot, materials, rig data and children. Connections copied with both endpoints keep their links. A transformed parent contributes an invisible placement frame, so copying one child keeps its world placement and editable local transforms. Paste creates fresh part identities and one Undo step. Text fields keep normal clipboard behaviour.
- **Generate from male worn:** in Build, generate draft Female worn and/or Inventory views from the active item's visible male parts. The template's native models provide fitting references. Matching joint groups use a complete vertex assignment so sleeve corners cannot collapse onto one target or stop short of the native wrist seam. Preview, cancel, or apply in one undo step. Apply replaces only the requested destination views and keeps the male source. Generated pieces keep colours, textures, skin markers and native player joints; placement, mirrored instances and connections are baked into independently editable pieces. Missing worn templates use player-body references. Complex shape changes and inventory angles may need manual adjustment. This is a draft generator, not a guarantee of a perfect fit or a live link between views.
- **Paint:** choose the selected part, its attached branch, several chosen parts, the visible view or the entire creation. Gear's entire-item option includes all worn and head views. Pick a preset palette or search a pictured creature/item palette, review Before/After and individual colour swaps, then Apply colours. Main, accent and detail filters and Keep original shading preserve colour variation. Face, Brush, Fill, Piece, Replace colour and Pick colour tools support mirrored strokes, connected-piece protection and back-face protection. Native textures stay protected by default. Source materials can be restored without changing shape. Gear's Skin button beside the colour selector paints the exact native wearer-skin marker. Magenta in the editor identifies exposed skin; the game substitutes the wearer's actual tone. Bulk palettes protect existing skin, while explicit brush strokes can paint clothing over it. Recent/saved swatches are session-only; palette JSON keeps them between sessions.
- **Sculpt:** use Delete faces to erase faces directly with a brush, or select a region for precise edits. Bright/dark boundaries keep hover and selection visible on different materials. Connect parts lets you choose or drag between two surfaces, prepares openings, and previews fitting and new faces before Apply. Cancel leaves the original untouched; undo restores both cuts and connections. Pink intersections need review. Pull, Push, Smooth and Flatten, mirror controls, selection growth, seam snapping and Restore shape remain available. Connections join surfaces; they do not perform a boolean union.
  In **Add face**, **Extend edge** creates a triangle or four-corner panel from a highlighted edge, including edges already shared by two faces. Surface extensions retain coincident anchor positions and native joints while keeping the existing surface intact. Drag the lettered cyan corners, use their arrow gizmo, or enter X/Y/Z positions. Orange corners remain joined to the original edge. Corners snap to visible corners, edges and surfaces, including body references and previewed set gear. Reference meshes stay read-only and never become item geometry. Hold Shift or Ctrl to move freely. Same-part corner snaps share the existing vertex, and edge snaps split the donor edge with its materials intact. **New shape** starts a movable panel on a surface and offers Flip facing side. **Fill opening** previews a complete cap; **Pick three corners** remains available for exact patches. **Move corners** gives existing vertices the same drag/gizmo controls and moves coincident seam vertices together. Face previews change nothing until Apply; every addition or corner drag has one undo step. Native texture projections and nearest-donor rig mappings remain intact. Snapping between separate parts aligns their positions; use Connect placed pieces for a join that follows both animated parts.
- **Animate:** choose an action, select a part, then choose a pictured movement source. Try previews it; Use keeps it. An attachment can follow the body, play its own source plus poses, or use poses only. Swing, Flap, Bob and Recoil supply editable starting poses. Scrub and step through frames, add poses at the cursor, change duration, copy a movement or copy poses alone. Source compatibility warnings explain missing joints/mappings. Gear previews use a moving player wearing the item; creature-only poses stay out of gear export.
- **Game data:** edit gameplay here and movement in Animate. Drops show item pictures, quantities and actual guaranteed/weighted chances. Search an item, set its quantity and chance, then Try 10 kills to inspect sample outcomes. Nothing is granted. Borrowed tables show a read-only source reference with conditions. Creature combat presets, named weakness/effect/sound choices, grouped bonuses, an equipment-slot map, active skill requirements and registered special-attack donors avoid unexplained IDs. Copy or reset compares a selected gameplay group with a native template while keeping geometry and movement.

Click **Definitions** or **Assets** to return to the native editor. Returning to either creator preserves its project. A native NPC/item selection can also supply a source to the library without replacing the assembly.

## Modular special attacks

Choose a weapon in **Special attack → Browse game special attacks** to copy its recipe. **Additional effects** contains accuracy and damage modifiers, the complete native roll options, reusable plugin mechanics and status/utility effects. **Find a feature** filters the add list. Nested accuracy branches and area settings expand in place. Movement and the visual queue remain separate from gameplay values.

Ancient godsword's Blood sacrifice block exposes follow-up damage, delay, escape distance, healing and VFX. The same feature can be added to another weapon. **Customize feature VFX** adds its cue to the visual queue, where speed, duration, recipient and hue remain editable. Damage modifiers apply their integer rounding in order. Native split-hit branches retain their rounding and all-miss distributions.

Other blocks include resource transfer, capped and cross-stat drains, burn consumption, bleed, temporary protection/vulnerability, knockback, skill boosts, missing-resource bonuses, energy scaling, chained targets, custom stacks/charges and follow-up attacks. Their numeric values and conditions are editable. Powered-staff charge payment is optional and requires an existing charged-staff provider; its fallback maximum is explicit. Custom stack and charge blocks are independent of the source item's passive item plugin. They are temporary combat state and reset when the effect is disabled or unloaded. Existing native content limitations, such as the purging staff's unavailable strongest-spell/rune-refund integration, are not supplied by copying a reference.

Old native selections become recipes in the editor and on export while retaining the author's added effects, overridden values and visual customizations. Migration does not write an open or saved project by itself. Saving retains the new recipe. Legacy exported plugins keep their compatibility path.

The data contracts are `ruleFeatures`, `extraFeatures` and `nativeFeatures`. Portable schema copies are checked against the editor schemas by `native-effect-templates.test.ts`. New native mechanics publish controls through `metadata.editorMechanics`; native roll fields belong in `shared/attack-rules.mjs`, and non-trait recipes in `shared/attack-recipes.mjs`. Export embeds both runtime modules, with no source-tree imports.

## Optional tool metadata

`cache-editor-tools` declares two `{ id, label, url }` entries. The generic host accepts optional `aliases: [{ id, view? }]` metadata, matching an older `tool` and optional `tool-view` query to a declared entry. The destination URL supplies the workspace. The host contains no Creator IDs or workspace rules. Plugin removal contributes no tabs or WorldAdmin links. No WorldAdmin source changes are required.

## Visual parts and animation

Cards show actual extracted cache geometry. Classic transform groups and modern weighted bone hierarchies provide the part breakdowns. Body, head, arm, leg, wing and tail names are inferred from geometry. Some unusual rigs have imperfect names or boundaries; inspect the picture before adding. Additional joint fragments and disconnected accessories are under **More pieces**. Exact numeric searches bypass filtering and deduplication. **Hide humans** uses walk sequences found on native Man/Woman definitions.

In Build, choose **Attached to** and enable **Follow parent animation** to affix a piece to its parent at its current position. Moving it updates the native joint binding, including mirrored sides and full weighted bone blends. New additions enable this automatically. Turn it off to keep source or manual joints. Attachments can also keep their donor's own movement. Combined animation follows an animated attachment point on the body while preserving the donor's internal joints. Fine rig controls are under **Advanced**. Different species' rigs can still need adjustment. Preview the result before exporting.

Idle, Walk, Attack, Block and Death previews are available above the model. **Animate** lets you search native movements by name. To make a goblin arm swing its axe on a cow:

1. Add the cow, then place a pictured goblin arm on it.
2. Select the arm and open **Animate**.
3. Choose **Attack**, then **Use this part's source movements**. The arm plays its donor's movement while following the attachment.
4. Use Play, the frame controls and scrub bar in Animate. Adjust timing or add poses as needed. Source + poses preserves internal shoulder, elbow and axe movement where the donor rig supports it.

Movement mode applies to all actions for that part. The chosen source sequence and custom poses belong to the selected action. Both mirrored instances share the same source mesh and movement. Mirror painting can find separate symmetric triangles, but linked twins always share painted colours.

Export bakes combined creature motion into new sampled sequences. The game plays them through generic custom-animation support, without running Creator. Native classic and weighted animation decoders supply borrowed motion. Gear retains the player's rig and native equipment animations; independent part clips and pose authoring are currently creature-only.

Worn-gear previews use the complete player rig in Build and Animate, for standalone items and equipped sets. Body reference controls visibility without removing the joint-pivot geometry. Choose Character for an opaque reference or Dummy for 40% opacity. Movement selection uses the item's configured sequence, the equipped weapon's sequence, then native player defaults. Native equipment movements remain available even when their cache names lack a human prefix.

Native textures now survive import, extraction, mirroring, sculpting and export. A fire cape keeps its lava pattern and native texture movement. Browsers with WebGL preview the actual texture pixels; Canvas2D provides a flat-colour fallback if WebGL is unavailable.

## Gear and game data

Choose **Gear Creator** to start an item. A template supplies independent inventory, male/female worn and available chathead models. Select the view above the viewport. **Copy to view** copies the selected part with its children or the whole view. The optional male/female body reference uses native identity kits, refreshes when the equipment slot changes, and is excluded from exports.

NPC game data includes combat stats, accuracy/defence bonuses, attack style and speed, HP, aggression, immunities, elemental weakness, effects and drops. Drops can be empty, a borrowed TSPS table, or guaranteed plus weighted authored entries.

Elemental weakness offers None, Air/wind, Water, Earth and Fire. Animations, projectiles, launch effects, sounds, drop items, borrowed drop tables and special-attack donors have searchable selectors. Sounds include **Listen**. Unknown names retain an explicit ID label. Fallback choices preserve TSPS semantics; for example, the default death sound is not a mute switch.

Gear parts offer Whole pieces and Colour areas. Whole pieces retain connected multi-colour details such as striped plumes; Colour areas select individual material regions without welding animation vertices.

The dedicated Special Attacks and Set Effects workspaces have native attack references, readable set-effect descriptions, and separate controls for activation, actions and visual sequences. Choose Create an attack, start from a named reference, then set native hit count, timing, accuracy, damage, energy, animation and supported recovery/enemy effects. Passive effects can require named equipment pieces, including this custom item. Damage previews show estimates without granting items or attacking players. Original specials require the generic combat-effects host patch below. Loaded blowpipes, powered-spell charging, degradation and encounter exceptions remain native systems. Staggered attacks use one activation roll. Recovery and damage-based drains follow cumulative health actually lost, without losing earlier recovery when later splats are cancelled.

Select a weapon with a special attack to copy its editable mechanics and visual sequence. Set effects also offer starting examples such as Life steal and Freeze. Damage and accuracy multipliers, energy cost and activation chance use exact numeric values. Actions are directly available below the main controls. Detailed hit rules and targeting expand in their own section. All changes use the normal undo, save and export workflow.

Every special has an **Activation type**: Melee attack, Ranged attack, or Cast on self. Activation controls reach and targeting independently of **Damage calculation**, so a melee weapon can have a ranged special. Self casts activate immediately on the player without an enemy attack roll. **Skip primary hit** removes only the initial hit; it does not change targeting. Imported utility specials select Cast on self automatically.

**Preview damage preset** is display-only. True max hit uses level 99 and external melee/ranged/magic bonuses of 70/26/27% for two-handed weapons or 78/36/32% with an off-hand. Average max hit uses level 80 and half those external bonuses. Both add the edited weapon's own bonuses and the strongest compatible ammunition, using an aggressive or accurate stance. The chosen ammunition appears in the damage summary. These controls never change item stats, undo history, saves or exported gameplay.

Previews assume successful accuracy and effect procs. Native hitsplat sprites show each maximum-damage hit in the four native slots, with the configured hit offsets and delayed follow-ups. Poison, venom, burn and bleed show their first naturally timed damage tick, with native damage colors. Red status blocks count down to expiration; indefinite afflictions remain labeled until cured or restored. Player-only effects are labeled when demonstrated on an NPC. Existing stacks, charges and afflictions are not assumed; conditional-state assumptions appear in the damage summary tooltip. Poison and venom retain native immunity checks in exported gameplay. Teleblock applies only to players.

Each workspace has a player-versus-enemy stage and up to 24 visual clips per rule. A human dummy, rock crab, goblin, hill giant and green dragon lead the opponent picker. **Visuals & sound** separates Effects, Movements, Projectiles and Sounds. Set effects show Effects and Movements. Effects have animated thumbnails, recipient badges and timing bars, sorted by actual playback time. Overlaps are labelled. Select a clip to edit Placement, Timing and Colour; height controls expand under Placement. **Add next effect** chooses another VFX after the selected clip, preserving its trigger, including delayed gameplay effects. **Duplicate after clip** chains a copy instead. Preview supports pause, restart, looping, scrubbing, camera orbit and male/female bodies. Test enemies, camera state and preview impact timing are not exported. Set visuals share their rule's actual activation roll and run once at its qualifying event. Character sequences keep native timing; VFX duration zero uses the native length, and extended clips hold their final frame unless Repeat is enabled.

**Playback speed (%)** accepts 10–400%. With **Play once at chosen speed**, 50% plays twice as slowly and remains visible twice as long. **Set duration in seconds** offers a choice to hold the final frame or repeat after playback ends. The timing summary states when playback is cut short or extended. Delay plus visible time is limited to 120 seconds. **Hue shift (degrees)** accepts -180 to 180, recolours textured and untextured VFX, and preserves neutral whites and greys. Its slider auditions changes before committing one undo step on release. Hue, speed and timing persist through save and export. Colour changes require `actor-visual-colour/1`; slower natural playback and extended timing require `actor-visual-timing/2`. Exports check the receiving host's capabilities before registration, while older visual exports remain compatible.

Both asset browsers use a windowed thumbnail grid with bounded pages, model requests and preview assets. Visible VFX tiles animate without hover; **Animate tiles** can pause them and defaults off when reduced motion is requested. Search by effect, weapon name or native ID, then click a tile to inspect it at player scale. When adding or replacing an effect, choose its recipient, playback speed and hue in the library before confirming. These draft settings leave the project unchanged until **Add effect to sequence** or **Replace effect** is clicked. Player movements come from native human/emote sequences and canonical player equipment animations; monster, projectile and chathead sequences cannot be selected by name or ID. Opponent movement choices use the selected creature's own observed animations. Click a thumbnail or use Previous/Next to audition. Close or Escape cancels the audition. Native VFX previews use a human dummy at 40% opacity. Player scale keeps the dummy readable; Fit full effect includes distant trails. Drag to rotate, scroll to zoom, or double-click to fit. The main stage also offers a human dummy as a target.

Drag the separators to resize Behaviour and Visuals & sound. Arrow keys resize a focused separator, and Home or a double-click restores its default width. Panels scroll independently without horizontal overflow. Narrow windows stack the panels and retain page scrolling. Native references open in a larger searchable dialog with complete descriptions.

Set effects support dealing damage, successful hits, attack launch, taking damage, being hit, actual kills, timed intervals, HP/Prayer threshold crossings and equipping the required items. Choose a combat style where relevant, an activation percentage, cooldown in native ticks, and optional HP, Prayer, enemy HP and combat-state conditions. Cooldowns start on successful activation and continue while unequipped. Thresholds rearm above their cutoff; use an interval plus a condition to repeat while a resource remains low. Recovery can use actual damage, rolled damage, maximum level, missing points or fixed points. Triggers without hit damage use damage-independent actions. Timed target effects use the wearer’s current combat target; self effects can run outside combat. Kill effects use native death attribution, not a zero-HP test, so phase changes do not qualify. Timers and thresholds use existing player-process hooks, and kill rules use existing NPC/player death hooks. Disabling a package clears its transient activation state and owned visual queues.

Visual queues require `api.core.ActorVisuals.VERSION === 1` and the matching web client. The host sends cancellable presentation messages only to viewers who can see the actor. Both renderers use the same speed and lifetime calculation. Imported feature cues keep their actual hit conditions and timing and can be customized independently. Legacy exports retain their native-template compatibility path. New recipes use their own identity and explicit effects.

Ammunition rules can use the actual equipped weapon's payment and recovery or deliberately disable ammunition for a self-contained ranged special on any weapon. Explicit projectiles have selectable VFX, launch delay, arrival time per tile, heights, angle and progress, and can replace normal ammunition projectiles. Their stage preview travels between actors. Sound blocks expose sound ID, delay, repeats, recipient and area radius. Reusable native callbacks still require their source gameplay plugin's published mechanic schema; installation validates that dependency before registering anything.

The paged reference library reads bundled special registrations, shared helper declarations and the native equipment-effect enum. It does not execute gameplay modules to build the catalog. Set descriptions include native effects beyond the supplied action starters. The VFX catalog includes native spot animations with models and supports weapon-name aliases.

Gear data includes equipment slot, existing weapon style, handedness, 14 bonuses, all 24 skill requirements including Sailing, value/alchemy, flags and inventory camera fields. Special-attack references populate editable recipes. Accuracy, damage stages, hit patterns, defence formulas, guarantees, caps, area targeting, utility activation and additional mechanics are visible effect blocks. Features can be added to any attack, changed or removed. Recipes have their own combat identity and do not inherit the donor method or native-ID hooks. The normal weapon still supplies ammunition checks and payment. Start with a template of the intended item family; changing its slot does not replace all its native behaviour or body-cover rules.

## Install the portable authoring plugin

Build the importable authoring package from this source:

```sh
node tools/content-builders/package.mjs
```

Import the ZIP in the TSPS admin panel's Plugins tab, restart the world with `CACHE_EDITOR_ENABLED=1`, and open **NPC Creator** or **Gear Creator**. The package contains the UI, cache adapter, project store and content exporter inside one plugin entry, as required by the existing TSPS importer. It unpacks only its own runtime files beneath the installed plugin's `data/runtime/`. Projects are kept in its `data/projects/` directory. It resolves the receiving checkout's existing dependencies and native cache loaders; it does not patch source files or download dependencies during installation.

The receiving TSPS checkout needs the optional cache-editor tool host, sampled creature animation support, custom combat/presentation APIs, and custom gear visual support from this feature set. Stock clients without these integrations cannot run every Creator function. The source entry uses `.entry.js` so it is not auto-loaded alongside an installed Hub package. The build emits the normal `ContentBuilders.plugin.js` inside the ZIP.

The generated archive is `release/content-builders-2.2.0.zip`. Release archives and compatibility patches are build products and are not checked into the TSPS source PR.

## Projects and finished content

- Source-tree development saves to `tools/content-builders/.local/projects/`. Packaged installs save beside the plugin in `data/projects/`. Both locations are outside the cache. Preserve them when uninstalling or moving installations.
- **Open** reopens a saved project. The file menu imports or downloads editable JSON. Import creates a separate project with fresh export IDs. Earlier builder project files still open.
- A bounded undo history and a separate IndexedDB draft per workspace retain in-progress edits. Saving is atomic and rejects conflicting saves from another tab. Project backups are the portable editing format.
- Save conflicts open a dialog identifying the saving tab when available. **Go to the tab that changed it** requests that tab's focus. **Discard this tab's unsaved changes** loads the reviewed save; **Replace saved changes with this tab's version** overwrites that reviewed save. Another intervening save reopens the dialog. Keep editing or download either version without resolving the conflict. Browser focus restrictions may require manually selecting the identified tab.
- **Export to game** validates geometry, native model decoding, materials, transport size and plugin size. The game ZIP contains new definitions, models, authored creature sequences and behaviour. Downloading does not install it.
- Import the finished content ZIP through the admin panel, restart, and log in again. Use the existing owner tools to place the NPC or give the item at the displayed game ID. No new game UI or duplicate map editor is introduced.
- Export IDs avoid saved projects, known custom definitions and installed builder packages. Runtime registration rejects collisions too. **Game data → Export identity** can assign fresh IDs if necessary.

Finished content uses the existing custom-model/definition transport and TSPS events. It coexists with other packages and does not edit native IDs, generated JSON or the cache editor's canonical overlay document. It depends on `ItemDefinitionLoader`, `CacheEditorCatalog` and `NpcDrops`. When MonsterExamine is installed, authored drops answer its read-only description event.

## Disable or remove

Disable `ContentBuilders` in world-local plugin settings and restart to remove both authoring entries and the tool process. Native Definitions and Assets remain usable. Keep the project directory or download its JSON before deleting the installation. The extracted `data/runtime/` files can be removed with the authoring plugin while its process is stopped.

Finished content plugins are independent of the authoring tool. Disable/remove a finished plugin and restart to remove that content's runtime registration. Existing item instances and spawn records keep their IDs; removing a package does not rewrite player or world saves.

The optional `release/combat-effects-support.patch` adds owner-safe special removal and early hit context for authored gear effects. Apply it once to a compatible TSPS host before enabling exported effect plugins. It contains generic combat/plugin capabilities; Creator remains removable.

## Gear visuals

Open a gear project and choose **Visuals**. The workspace works with weapons, tools,
armor, capes and every other item slot. Choose the model view and target part before
adding a layer. Layers have names, enable switches, ordering, duplication and copying
to another part or model view. Changes use the regular save, draft recovery, undo and
export controls. The preview has its own play, pause, restart, scrub time and solo controls.

- **Textures:** choose a native texture, create a procedural flame, water, noise, rune,
  stripe, checker, gradient or star pattern, or import PNG/JPEG/WebP image frames.
  Native textures have a searchable thumbnail library. Image frames have previews,
  ordering and removal controls, 16/32/64 pixel import resolutions and a frame-rate
  control. Select individual faces or the entire part. Edit UV scrolling, offset,
  scale, angle, rotation speed, wrapping, projection, gradient colours, tint, hue,
  saturation, brightness, contrast and opacity. Later surface layers replace earlier
  surfaces on overlapping faces.
- **Particles:** choose point, box, sphere or ring emission and spark, diamond, star
  or cloud geometry. Position the emitter numerically or click its target part.
  Edit size, birth rate, lifetime, capacity, velocity, random spread, gravity, drag,
  turbulence, orbit, colour gradient, size/fade ramps, phase and deterministic seed.
  Emitters repeat every eight seconds. They attach to the nearest original joint or
  weighted bone and follow model tracks that move their anchor. Particles remain
  attached to the item while it moves.
- **Model motion:** select the entire part or click triangles to choose moving vertices.
  Place a pivot and edit timed movement, rotation and scale keys with linear, smooth
  or step interpolation. Add, remove and scrub keys, retime the clip, and choose repeat,
  ping-pong or one-shot playback. Wave tracks expose direction, amplitude, wavelength
  and frequency. Tracks combine in layer order, before the player's movement or combat pose.
  One-shot tracks start separately for each worn appearance; pose substitutions and
  first-person copies share that appearance clock.

Each model view keeps its own geometry selections and placements. Copying a layer to
another part clears its old face/vertex selection; adjust the copied placement to fit.
Selections that no longer match edited geometry produce a recoverable preview message
and block export until repaired. Mirrored parts mirror their attached visuals too.
Sibling gear in a set also displays its visual layers in the fitting preview. Native
Idle, Walk and other player-movement previews retain the visual layers, with matching
texture time, particle colours and fades. Scrubbing and pausing also work in that preview.
Fitting clips include a complete model-motion cycle, up to 60 seconds. Long clips or
large assemblies use fewer samples to stay within the preview geometry budget.

The same sampler powers the preview and client. Export compiles original skin labels,
bone weights, texture mappings and bounded particle geometry into native custom models,
then carries the visual settings in the custom-item dataset. Item-owned data selects the behaviour for every equipment slot. Hosts need item-visuals version 1 support. The portable
Creator bundle embeds the sampler; finished plugins do not need Creator running.

Limits are eight surfaces, eight emitters, sixteen motion tracks, 24 imported frames per
surface and 256 live particles per item/model, including mirrored emitters. Model motion
clips can last up to 30 seconds and contain 64 keys. Dynamic geometry runs at 20 samples
per second. The host reserves 32 custom material slots across enabled packages, without
changing native atlas indices. Geometry caches and material uploads are bounded. Export
also checks packet and plugin sizes; reduce imported resolution or frame count if needed.
Inventory icons remain snapshots. Check equipped appearance in game after importing the
plugin and restarting the world.

## Current limits

Combined creature animations bake vertex movement. Native animated transparency and colour tracks are not baked. Each clip is limited to eight seconds, 240 samples and three million vertex samples. Export also checks compressed packet and package sizes. Gear continues to use the native player rig. Older partial-part projects without source-vertex mapping still open, but independent donor movement may require re-adding that part from its source.

Native source textures must exist in the receiving OSRS cache. Gear visual layers can also create procedural textures or import image frames. Native v3 type-0 texture mappings are preserved, with a maximum of 255 mapping entries per model. Unsupported complex projection formats produce an error rather than flattening silently. Preview caps texture frames at 32; export retains the native texture ID. Previously flattened projects cannot automatically recover discarded textures. Paint keeps textures by default. Choosing Replace textures deliberately replaces affected textures with a colour. Restore source materials can recover safely matched original faces, including their texture mappings.

Inventory camera settings export, but this viewport is an orbit preview rather than an exact inventory sprite renderer. Use the existing cache-editor preview and the game for final icon checks. Body coverage in the fitting reference is approximate. Incompatible rigs and finished worn gear need visual checks in game.

Native model limits, the compressed game packet budget and TSPS's 1 MiB plugin-entry limit bound each creation. Export reports an error for oversized content. User-created projects are reopened through Open/import, rather than reverse-engineered from installed plugin definitions.

## Validation

```sh
node client/node_modules/tsx/dist/cli.mjs --test tools/content-builders/tests/*.test.ts
node client/node_modules/typescript/bin/tsc --noEmit -p client/tsconfig.json
```

The suites cover native model decoding, textured edits and export, classic and weighted parts, hierarchy/inverse transforms, mirrored joints, backwards-compatible projects, atomic saves, IDs, real TSPS registries, template preservation, drop/runtime coexistence, HTTP guards and accepted content ZIPs. The cow/goblin-arm test compares exported animation vertices through TSPS's actual NPC model loader. A separate case exports wholly custom poses. The portable-authoring test starts an installed bundle from a temporary directory, creates a project and exports a validated game plugin without using source-tree tool assets.

The Chrome test builds a spider/goblin through actual drag-and-drop, checks inspector values during gizmo movement, applies palette previews, paints source faces, selects and sculpts faces, creates pictured drops and samples ten kills. It previews creature and worn-gear animation, saves/reloads, fits gear and exports a real accepted ZIP. It also checks that rear-face highlights remain occluded in textured and fallback rendering. It also exercises both entries in the generic React host, keyboard activation, separate unsaved drafts, legacy and direct links, native section switching, disabled-plugin removal and offline recovery. Screenshots come from an isolated test host, not the live combined app. Temporary servers, processes and profiles are closed and removed. Chrome tests skip if no executable is available; `BUILDER_CHROME` overrides its path.

Item library and picker thumbnails use the cache's native inventory angles and fit both canvas dimensions. Part cards retain that angle when showing extracted pieces. The set-item dialog keeps search results in normal flow with their own scroll area, rather than a popup clipped by the dialog.

Generated parts edit around their own geometry centres. Earlier generated parts with the old floor pivot are repaired during project validation without shifting their current placement. Parts with mirrored branches or custom pose keys retain their authored pivots. Newly generated inventory geometry that cannot use the template's native orientation gets an upright inventory camera and calculated zoom; applying the draft saves these icon settings together with the geometry. In the gear Build inspector, **Item name** changes the exported item and its set card; **Part name** names only the selected mesh piece.
