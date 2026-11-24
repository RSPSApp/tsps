# Monster examine plugin

`MonsterExamine` opens a game-rendered window when the TSPS client examines a visible,
attackable NPC. It uses server-defined widgets, the existing NPC and item model loaders,
and the shared custom-interface search/scroll runtime. No gameplay DOM overlay is installed.

## Bestiary companion

The `Bestiary` server plugin appears under `@ Ghost Plugins @`. Open it with the top-left
**Back to Bestiary** button on any monster examine page, or use the named Bestiary entry in
the native Commands window, `Ctrl+/`. `::bestiary` and `::bestiary goblin` are also available.
The native window fills the available modal space in Fixed and Resizable mode.
Its responsive grid scrolls continuously, with native inline name/ID search and
Find/Examine controls. Titles use `Name (Level-XYZ)` with the native green level
text. A single bold b12_full summary beneath the preview shows `XY Variants` for
groups or `NPC ID XY` for individual definitions. HP is omitted from cards.
Back from Examine restores the query, expanded groups and scrolling position.

Expanded variant families share a brown background and gold outline, including
when the heading scrolls offscreen. Other names or combat levels remain outside
the frame. Native decoration slots are pooled alongside the lazy model cards;
collapsed groups have no shared frame. Cards are 160 pixels high, with no empty
second summary line.

Thumbnails are type-6 `npcFullBody` widgets bound only for visible cards with their
cache idle sequence. The existing `NpcModelLoader` and `Model2DRenderer` rasterize
the actual posed body.
The catalogue reads the loaded `NpcDefinition`/cache data, capped at 65,536 definitions, and
keeps IDs separate. It is cached on first open for the plugin lifetime. A positive combat level
and native combat action are necessary, but do not establish that a cache entry is playable.
An ID must also have at least one of these sources:

- A configured spawn in `NpcSpawnDefinition.all()`, including a valid descendant of a cache
  transform chain. Transform traversal rejects sentinels, out-of-cache IDs and cycles.
- A source-owned playable encounter declaration through `bestiary:encounters`.

An exact drop-table mapping is useful diagnostic data, but cannot establish availability:
the cache/export may describe event-only or unimplemented content. Names, matching levels,
combat-method bindings and loot mappings alone never promote an entry.

The ordinary King Black Dragon is ID 239 (`king_dragon`), with a canonical spawn and exact
loot mapping. ID 6502 (`clancup_king_dragon`) and ID 12440
(`deadman_breach_king_black_dragon`) have neither, and are excluded. Binding the same combat
method to all three does not make those event copies ordinary world monsters. Temporary
Admin spawns and arbitrary live NPCs cannot promote an unsupported cache entry into the
catalogue. Default HP/stats also provide no eligibility evidence.

`bestiary:encounters` is a read-only custom event with `{ npcIds: Set<number> }`. An enabled
content source adds only IDs its gameplay actually spawns or transforms into for combat.
The source must use its existing fight tables or precise combat constants. Scene actors,
spawn/death presentation forms, invulnerable room scenery and broad lists of combat-method
aliases do not qualify. Handlers must not spawn NPCs, inspect or modify player saves, roll
rewards, or execute spawn/death/quest callbacks. No Bestiary dependency is required.

Providers cover Fight Caves, Inferno, Pest Control, Barbarian Assault, Gauntlet, Colosseum,
Nightmare Zone, Knight Waves, Champions' Challenge, TzHaar-Ket-Rak, Chambers of Xeric,
Theatre of Blood, Tombs of Amascut, Barrows, Soul Wars, Temple Trekking, Count Draynor, Elvarg and dormant
creatures' actual awake forms. Quest sources declare their combat opponents with
`combatNpcIds` in `registerQuest` metadata. An array or a read-only function returning IDs
is accepted. Each declaration attaches to that source's API, so disabling it removes its
provider. This retains genuine no-drop quest fights such as the Lost City tree spirit,
Grand Tree black demon, Dream Mentor bosses and Below Ice Mountain guardian without
admitting all the quest's cutscene actors.

Future scripted encounters without a static spawn need the same source-owned declaration,
whether or not they have a loot table. The filter is an evidence policy, not a cache-name
blacklist. Find can still correctly report no known public location for a conditional/private
encounter.

Use **Find** on an examine page or right-click a creature card for **Find**. **Clear pins**
is available on both windows. Find reads `api.core.NpcSpawnDefinition.all()`, the canonical
merged static spawn set, including deferred spawns, and the spawn homes of public registered
NPCs in `api.core.World.getNpcs()`. It does not instantiate NPCs, run spawn/attack/death hooks,
change world definitions or walk/teleport the player. Static transform parents count only
for the player's resolved form. Live owner-only, owned, private-area and non-main-world
entities are excluded. Static locations describe known spawn homes, not guaranteed current
living creatures. Spawn hooks are not replayed to infer conditional/encounter availability.

Each source scan is capped at 100,000 rows. A maximum of 4,096 unique coordinate/plane
candidates is retained, then sorted by same-plane proximity and limited to 256 pins. A
limited result is labelled in chat. NPC IDs remain distinct; Find variants combines known spawns only for the selected
name-and-level group.
Finding another group, opening a creature outside the selection, clearing, disabling the client
plugin, logging out, hopping or losing the connection removes the old selection. Selections
also expire after ten minutes. Unknown spawns clear previous pins and say no locations are
known; coordinates are never invented. Page/query and selection data are session-only.

The existing client **Monster Examine** plugin handles the companion's `bestiary` channel.
A `client-state` handshake prevents Find from claiming pins when that client plugin is
disabled. Visible locations draw as outlined diamonds. Off-map locations on the current
plane draw as filled directional triangles at the minimap edge, capped at one nearest
direction per sector. Other planes do not get misleading same-floor minimap pins. All
known points can draw on the native world map when its current map area can project them.
Arrows show coordinate bearings, not a travel route or a way between disconnected map areas.
The map does not gain unsupported areas or a route planner. Public coordinates are not
plotted onto instance minimaps. Re-select Find after returning to the public world if needed.

`createMinimapGeometry` supplies the generic `MinimapGeometry.projectMarker` helper in the
active native widget renderer. It uses the rendered mask, camera rotation, zoom and UI
scale instead of a fixed tile cutoff. Both the WebGL and WebGPU scene paths use this shared
`WidgetsOverlay` renderer. Hidden or stale minimaps draw no markers. World-map pins use the
existing `drawWorldMap` hook. No changes to `CustomInterfaceRuntime`, `cardLayout`,
`PluginManager` or `PluginTypes` are required.

Browsed examine pages use an unregistered base `api.core.NPC` solely as a native formula
subject; they do not create an implemented encounter or add anything to `World`. These
pages show definition stats, not a boss instance's live scaled/phase state. Drop description
uses the nearest retained known spawn home. Without a known location, positive location-
restricted drop rows cannot be selected; live NPC examine remains the authoritative
location-specific view. No death/RNG/reward-state selectors are called.

Disable/remove the companion by changing the `Bestiary` plugin switch through the normal
owner workflow or removing `Bestiary.plugin.js` and `bestiary/`. Monster Examine continues
to work; its navigation buttons give a disabled message if the companion is absent. The
companion can still browse cards if Monster Examine is disabled; opening details explains
that the examine plugin is required. Keep `monsterexamine/Access.MonsterExamine.js`,
`monsterexamine/Layout.MonsterExamine.js` and the shared widget helper with a standalone companion installation. Its client marker code
is `client/game/plugins/monsterexamine/BestiaryPins.ts`.

Packaged browser-host/WebRTC interface bundles must include `"Bestiary"` in the `plugins`
array in `server/scripts/browser-host-interface-definitions.ts`.
It registers group 30023. The ordinary
server content endpoint already serves the registered interface. No new runtime helper
hooks are needed. Removing the companion from a package also removes that export entry.

Focused validation uses the existing dependency installation:

```
cd server
node --test tests/bestiary.test.cjs tests/monster-examine.test.cjs tests/examine-chat-types.test.cjs
cd ../client
node scripts/run-tests.mjs bestiary monster-examine widget-model-oversize minimap-click-timing
npm run typecheck
```

Server tests require compiled output. In the shared implementation checkout the build was
redirected to a task temporary directory, leaving running services and existing outputs
alone. The examine-disclaimer regression failed through `ClientConnection.dispatch` before
the change and passed afterward. The tests cover actual widget-action dispatch for
browse/open/back/search/Find, native formula choices, data immutability, marker lifecycle,
mask/zoom/rotation and nonempty pixels from posed cache bodies. They do not replace a live
visual review. No services were restarted and no real player was used for this validation.

The window contains the NPC name, examine text, animated body, combat level, current/max HP,
current/max combat levels, base attack speed, default attack style, effective base max hit,
labelled source max hits, attack/defence bonuses, player-specific base accuracy, Slayer level,
immunities, freeze resistance, attributes and elemental weakness where available. The model
and colored combat-level/HP summary stay above a scrollable column of grouped stats.

On the thumbnail branch, drops use compact native item cards with a 48 by 48 icon, name,
quantity, base rate with its percentage on one line, and useful conditions. Up to five columns fit across the expanded
window. Narrower windows reduce the column count. Cards are 132 pixels tall with 8-pixel
gutters, so a typical expanded window shows roughly four rows. Table headings remain full-width bands. Duplicate amounts, item families and shared tables
use the same tiles as individual rewards, with a thumbnail and a framed plus/minus button.
Expanding one reveals its own reward cards underneath. The list
branch retains the same information in columns.
Guaranteed, main, shared, tertiary and conditional rewards have their own sections, sorted
by base rate and then name within each section. Search matches item names, conditions and groups.
Section headings have a native accent bar, bold title, explanatory subtitle and bottom divider.
They have no item icon, disclosure button or rate. Folders have an outline, a framed plus/minus
button and an item/amount count. Descendants are indented; nested folders have hierarchy guides
and leaf cards have native borders and an internal divider. Hovering an
actionable row highlights its background.
Green marks guaranteed drops, amber marks conditional or unrecorded rates, and blue/purple mark
uncommon/rare base rates. Conditional sources remain labelled even when a base rate is known.

Duplicate amounts of an item start in a closed folder. When they are mutually exclusive
outcomes of the same main roll and source, the folder shows their combined chance of receiving
any amount. Guard's seven coin amounts total 62/128, or 48.44%, per main roll. Its quantity cell
also shows the actual quantity range and probability-weighted average **per successful drop**,
for example `1-30 (8.05 avg)`.
Uniform integer ranges use their midpoint. Conditional/assumed quantity distributions and
independent reward rolls have no combined average. Large averages use compact units in the
cell; hovering the folder shows the full range, value and calculation basis. Group quantity
cells omit the redundant `Qty:` prefix so Guard's complete summary fits at the minimum card
width in the native cache font. Longer summaries use the existing text overflow behavior.

Each shared-table access owns a mandatory folder, even for a single reward. Nested tables
remain descendants. Rare drop table runes therefore never join ordinary rune folders or affect
their chance/average. Five or more distinct items in an identified family such as Runes, Seeds
or Arrows can form a family folder within one source. Families have no overall rate. Clue
variants group at two or more distinct items; looting bags and ensouled heads stay individual.
Source section headings never become catch-all item families. A table that already contains
only one family does not get a redundant family folder.

Left-click the disclosure button or any group cell to expand/collapse it. Right-click an
item or duplicate-amount tile for **Examine**, using the same cache text and configured
price lines as inventory/equipment Examine. **Drop info** appears only where extra reward
rules exist and writes their full recorded text to game chat. Table/family thumbnails are
representative items; they do not offer Examine as if the entire group were one item. Hover an item or
folder to read the full recorded condition in the native tooltip. Long names and source text
scroll left within their cells. The drops use the full column height, without a details panel.
These actions stay on the client.
Search reveals matching items inside closed groups; clearing it restores their prior state.
Expansion survives a gameframe remount, and a new examine starts closed again.

The window requests the native expanded main-modal mount using cache script 917 with
`[-1, -3]`, as Omnishop does. Resizable mode fills the available game area with an 18-pixel
outer allowance, capped at 920 by 900 pixels; Fixed keeps the cache's 512 by 334 mount.
The stats and drop lists follow the available height. Cache fonts, frame, close button and
scrollbars keep the interface in the game's visual style. The inset NPC preview has a larger
214 by 150 model area and fits the complete projected body, including its current idle frame.

## Install, enable and remove

This source checkout already installs plugins from `server/plugins` at server startup.
Build the client and server after applying this branch, using their existing `npm run build`
commands. The client rebuild also exports the interface for browser-host/WebRTC clients.
Start through the checkout's normal `yarn start` workflow with its existing ports.

In the client's plugin sidebar, search for **Monster Examine** and use its on/off switch.
It is enabled by default and the existing RuneLite configuration saves the preference for
that client profile. Turning it off immediately restores native text examines on the next
examine, without restarting the game or changing the world. Turning it back on restores
the monster window. A window already open can be closed normally.

The removable feature files are:

- `server/plugins/interface/MonsterExamine.entry.js`
- `server/plugins/interface/monsterexamine/Layout.MonsterExamine.js`
- `server/plugins/interface/monsterexamine/Drops.MonsterExamine.js`
- `server/plugins/interface/monsterexamine/Facts.MonsterExamine.js`

The client sidebar entry is `client/game/plugins/monsterexamine/MonsterExaminePlugin.ts`,
registered in `client/runelite/client/plugins/index.ts`. Remove that registration and file
for complete client source removal. Its toggle uses the existing plugin manager and menu
hook; it adds no separate settings storage or per-tick work.

They use the existing shared `server/plugins/interface/widgetGroup.js`; no dependencies or
save migration are needed. Keep these paths together when copying the plugin to another
checkout with this branch's generic runtime support.

The server plugin is also enabled by default. For a world-wide disable, merge
`"plugins": { "MonsterExamine": false }` into the world's
existing `server/data/definitions/world.local.json` settings to disable it, then restart the
server through the normal owner workflow. Set the value to `true` to enable it again. Do not
replace other settings. If the deployment still uses the deprecated `disabledPlugins` list,
that list takes precedence; add/remove `MonsterExamine` there instead.

Disabling the plugin immediately restores the ordinary NPC examine text on the next server
start. Removing its plugin entry file and helper directory has the same server effect. For
complete source removal, also remove the `MonsterExamine` entry from
`server/scripts/browser-host-interface-definitions.ts` before the next client build. The
remaining generic facilities are inert without a listener. Existing official/native clients
that send only an NPC type keep their ordinary text examine.

## Data and limits

`npc-drops:describe` asks `NpcDrops` for a detached snapshot of the same loaded sources the
roller uses: generated tables, saved custom tables, overrides, runtime corrections, selected
player table and location filtering. Shared tables, guaranteed rewards, tertiary rewards,
bundled rewards and ordered reward outcomes are displayed without running the death hooks,
reward-state provider/commits or random rolls. NPC IDs use the player's resolved transform,
matching the death event. A missing source is labelled unavailable, never "drops nothing".

Rates are base references per roll, not an assertion of exact per-kill odds. The footer shows
multiple main rolls. Hover explanations describe recorded quest/clue requirements, quantity conditions,
extra rolls, shared-table selection and ordered/progression rewards. A conditional 1/1 tertiary
reward says "When eligible" and retains its actual requirement. The redundant warning about
the source's 1/1 is omitted from the card, tooltip and Drop info. Missing numerical
rates say "Not supplied", with an explanation on hover; ordered rewards say "Progress-based".

`NpcDrops` describes combat-level subtable probabilities using its existing seed selector's
integer intervals, without rolling. The display includes only reachable seed subtables and
multiplies access, category and item probabilities. A level-21 Guard therefore lists its eight
reachable seeds with numerical rates, including 5.134% for potato seeds, rather than all 44
seed rows with no rate. These remain base references before equipment or drop boosts.
Wealth-ring substitutions, quantity distributions, boosts, quests, encounter ownership,
additional plugin rewards and phase rules can change a kill's actual loot. The plugin does
not parse or execute other plugins' JavaScript to infer them.

Player accuracy shows separate Melee, Ranged and Magic base hit chances through the native
`AccuracyFormulasDpsCalc.specialRolls(..., true)` and inclusive `hitChance` formula. Each
read-only player projection uses current worn bonuses, boosted levels, prayers, the target's
scaled defence and native target-sensitive equipment modifiers. The selected melee attack
bonus is used against the matching defence. When a ranged or magic stance is selected,
melee uses the largest worn melee bonus, with ties ordered stab, slash, crush. Only the
selected combat type receives its native stance accuracy bonus. Other types receive no
Accurate/Controlled bonus. Magic retains the selected spell's native formula inputs.

These are base chances, not a promise that the player can attack with all three types with
the equipped weapon. Armed specials are suppressed in the calculation projections without
changing the player's toggle or weapon. Hit-time plugin hooks, random procs, bespoke combat
methods and encounter overrides are not evaluated. No special-condition controls are offered.
The panel no longer repeats the gear disclaimer or snapshot/boss-phase paragraphs. Live
examine still reads that NPC's current stats once when the page opens.

Requests require an authenticated, registered player and a currently registered, visible NPC
in that player's local NPC list, current sync area, view distance and ownership visibility.
The visible type must still match. Invalid/stale IDs are ignored. Protected interfaces,
dialogues, movement/animation holds and input prompts retain text examine. Requests are
limited to one panel every 500 ms per player, with the existing plugin-message rate limit.
Display traversal is limited to 4,000 visits, six shared-table levels and 600 rows. Row data
uses at most four 38 KB text packets. Truncated lists are labelled. There is no per-tick
server work, drop-state mutation or new public player-data endpoint.

## Generic integration

- `NetworkBuilder.ts` accepts the existing authenticated plugin-message envelope on
  `entity-examine`, validates its live NPC context, emits `world:npc-examine`, and sends
  normal typed text when no plugin handles it. Native type-only examines use the same
  fallback. The sidebar's `MonsterExaminePlugin` sends that context only while started;
  `MenuAction.ts` keeps native examine as its default path. The existing transformed-type
  resolver on `OsrsClient` is public so the plugin uses the same IDs as native examines.
- `AccuracyFormulasDpsCalc.ts` adds an optional preview flag. Normal combat keeps its existing
  default behavior; preview avoids hit-time events rather than triggering equipment procs.
  This class was already exposed through `api.core`; no new core exports were required.
- `widgetsOverlayFactory.ts` adds a declarative `npcFullBody` option to NPC model widgets,
  using the existing model and sequence loaders. `Model2DRenderer.ts` adds opt-in projected
  bounds fitting and centering. The body loader applies the sequence once. Default chathead
  rendering is unchanged.
- `CustomInterfaceRuntime.ts` supports declarative `list.textColumns` filled from trusted
  server-formatted row fields. It also refreshes row widths and scroll bounds after a resize.
  Its opt-in tree rows, local selection and styled compact headers make native
  dropdown groups reusable by other server-defined interfaces. Variable row offsets keep
  scrolling and pooled slot clicks aligned. Optional `rowChrome` adds native folder outlines,
  disclosure controls, dividers and bounded ancestry indentation; header columns can display a
  separate subtitle. `widgetClickInput.ts` routes primary clicks through the same custom-interface
  handler as menu clicks before scripts or gameplay transmission. This fixes local controls that
  previously worked only through the right-click menu. Grouping, provenance, averages and rates
  stay in the plugin. No new server core API or gameplay renderer changes were needed in this update.
  `WidgetNode.ts` and `WidgetLayout.ts` support opt-in `maxWidth`/`maxHeight`, so an expanding
  custom modal can keep a readable width without changing cache widget sizes.
- `NpcDrops.plugin.js` adds the read-only source event. The feature's projection and formatting
  stay in `MonsterExamine`. `SeedCategories.NpcDrops.js` also exposes read-only category
  probabilities over its existing selector intervals. The drop roller itself is unchanged.
  The browser-host exporter includes the declarative interface.

The GhostScape reference supplied the feature intent only. No RuneScript analyser, old
protocol, renderer or gameplay formulas were copied. This is a custom QoL panel, not a claim
that live OSRS opens this window on an ordinary examine. Combat and loot data remain TSPS's
existing cache/Wiki-backed runtime sources. No generated game data was edited.

## Verification

Validated locally without starting a game server or touching the running main services:

- Server TypeScript build and client production build; client TypeScript check.
- Native/contextual examine dispatch, disabled-listener fallback, ordinary NPC text,
  current HP, transformed/stale/private/distant/unauthenticated IDs, protected interactions,
  throttling and absence of RNG or combat resource changes.
- Actual drop-loader custom/override snapshots, detached results, missing tables and no RNG.
- Drop projection for shared chains, guaranteed/tertiary/ordered rewards, conditional quantities,
  missing/cyclic sources, bounds and text-packet sizes.
- Actual client packet decoding and server-defined layout through the real `WidgetManager`
  and custom widget runtime: background paint order below icons/text, quantity/rate/percentage
  cells, grouped drop projection, 200 rows, multipart data, scrolling and search.
- Actual cache gameframe widgets and scripts 917/909 expand the modal beyond 512 by 334 in
  Resizable modern mode. Layout checks at 1280 by 900, 800 by 600 and 512 by 334 cover bounds,
  row-pool coverage, resize scroll widths and non-overlapping quantity/rate columns.
- Actual cached Man, Black Demon, Green Dragon and Vorkath body rasters at three idle frames
  each fit the preview with head/feet inside and a clear border around visible pixels.
- Client plugin manager enable/disable/re-enable, persisted preferences, native fallback
  without the client plugin, stale NPC handling and deprioritized menu actions.
- Existing drop reload, overrides, seed-category and ordered-reward suites, plus examine
  dispatch and display regressions: 63 tests passed in the drop-controls update. Selector probabilities match enumeration
  of every possible integer roll at levels 21, 49 and 100. The real Guard loader snapshot
  yields eight reachable seeds with numeric rates without RNG or death hooks.
- Existing Brimstone ring, Maggot King combat and plugin/world configuration suites:
  121 tests passed. Default combat proc callbacks remain enabled.
- Fifteen focused client suites passed for the drop-controls update, covering first-open/runtime,
  native widget action dispatch, the plugin manager and hooks. Monster Examine checks
  collapsed defaults, safe totals, styled headers, compact row offsets, nested search,
  actual disclosure hit-testing and primary mouse-down handling with no gameplay packet,
  nested table indentation/controls, hover explanations, remounts and fresh-open reset. The larger model
  bounds were raster-tested with real cached bodies and idle frames; a tall creature renders
  over 20% larger while retaining space around the silhouette. Loaded Lava dragon shared
  chains and Hellhound clue/bag/head rows also have regression coverage.
  The prior redesign also passed model translucency/extents, viewport and character-summary checks.
  The production build retains existing generated RuneLite lint and bundle-size warnings.

Run the server checks after building:

```sh
cd server
node --test tests/examine-chat-types.test.cjs tests/monster-examine.test.cjs tests/npc-drops-reload.test.cjs tests/npc-drop-overrides.test.cjs tests/npc-drops-seed-categories.test.cjs tests/dt2-ordered-rewards.test.cjs
```

Run the client checks:

```sh
cd client
npm run typecheck
node scripts/run-tests.mjs monster-examine custom-interface widget-action widget-click widget-primary widget-drag widget-menu-use widget-model-oversize widget-pinned-subop widget-script-inventory runelite-plugin-manager plugin-hook-dispatch
```

The live appearance, idle animation and interaction feel remain unverified in game.
The user subsequently requested startup of this existing checkout. Its grid branch now runs
at `http://localhost:3000/`; the client page returns HTTP 200 and the live server definition
confirms group tiles and item actions. No browser automation or logged-in play session was
used for this update. Refresh the client, re-examine a monster, and check the native menu.
Ordinary and disabled-plugin examine fallback remain covered by regression checks.
For the drop-controls update, examine a Guard: left-click the framed Coins disclosure, check
its average and combined chance, then search/clear a seed and resize while a group is open.
Examine a Hellhound to check the Clues folder and individual bag/head rows. Examine a Lava
dragon to check that Rare drop table rewards and nested Gem/Mega rare tables remain within
their source folders. The final look, text wrapping and animation feel still need this live check.

## Hover explanations and scrolling overflow

The list version on `feat/monster-examine-plugin` removes the bottom details region. The
reward list uses that height. Long names and condition lines scroll from right to left,
with a reading pause at each end; fitting text stays still. Recycled rows and resized text
restart at the beginning. Native scissoring keeps the moving text out of adjacent cells.
Hovering a reward or folder uses the existing RuneLite TooltipManager/TooltipOverlay for
its full explanation, wrapped to a readable width. Hovering the drop count shows the
source/roll caveats. Leaving/closing the interface or opening a context menu clears it.
Machine-form quest notes are omitted when presenting the human-readable source condition.

The generic changes are opt-in `WidgetNode.overflowScroll`, native text rendering support,
`list.tooltipField` and `status.tooltipComponent` in the custom runtime, a pointer provider
in OsrsClient, and optional tooltip width/wrapping in the existing tooltip system. Feature
projection, conditions and layout stay in the plugin. There is no gameplay DOM overlay.

The hover update passed the server build, client typecheck and production build, all five
focused client suites for Monster Examine, text, tooltips and custom-interface behavior,
and the 63 focused server regression tests listed above. Live UI remains unverified.

## Local presentation branches

Both branches are local to this checkout and share the hover/overflow update. Nothing has
been pushed or published.

- `feat/monster-examine-plugin` at `910cd13f6` keeps the list presentation.
- `feat/monster-examine-thumbnail-grid` adds the compact thumbnail experiment and is the
  branch left checked out. It has the same plugin toggle, data, source fencing, averages,
  search and expansion behavior.

To compare, switch to the desired branch in this existing checkout, rebuild both `server`
and `client` with `npm run build`, then use the owner's normal start workflow. Do this when
it is safe to rebuild/restart the owner's services. The implementation task did not restart
or connect to those services. No independent local test URL is available.

The grid adds the generic opt-in `list.cards` declaration and `cardLayout.ts`. It packs
sibling leaves into responsive cards, keeps table/folder boundaries, computes scroll bounds
on data/resize changes and pools only the visible rows. It does not add a per-tick layout
pass. `parts` supplies component-relative native geometry, optional text templates, fonts
and alignment. `stretch` subtracts `width` from the card's width. Pooled slots
restore their original positioning modes when reused. Thirty slots cover the capped
viewport without overlapping component ranges. Feature layout and all reward rules remain
in the plugin; no additional server core change is needed for the grid.

Grid regression checks cover five/four/one-column native layouts, all visible cards through
the viewport bottom, partially scrolled rows, source boundaries, nested disclosures, search,
remounts, hover hits and slot reuse. The final server build, client typecheck and production
build passed. Eleven focused client suites and all 63 focused server tests passed. The
production build retains existing lint and bundle warnings. The live appearance still needs
an in-game check.

## Exact implementation paths

The following paths changed across the local Monster Examine implementation and follow-up
presentation commits. Generated game data and unrelated local edits are excluded.

- `client/game/OsrsClient.ts`
- `client/game/plugins/monsterexamine/MonsterExaminePlugin.ts`
- `client/game/widgets/WidgetActionRouter.ts`
- `client/game/widgets/input/widgetClickInput.ts`
- `client/runelite/client/plugins/index.ts`
- `client/runelite/client/ui/overlay/tooltip/TooltipManager.ts`
- `client/runelite/client/ui/overlay/tooltip/TooltipOverlay.ts`
- `client/tests/monster-examine.test.ts`
- `client/tests/mouse-tooltips-plugin.test.ts`
- `client/tests/text-wrapped-styles.test.ts`
- `client/tests/widget-model-oversize.test.ts`
- `client/ui/menu/MenuAction.ts`
- `client/ui/model/Model2DRenderer.ts`
- `client/widgets/WidgetNode.ts`
- `client/widgets/components/textOverflow.ts`
- `client/widgets/custom/CustomInterfaceRuntime.ts`
- `client/widgets/custom/cardLayout.ts`
- `client/widgets/gl/widgetsGl/render/drawNode/widgetTypesC.part.txt`
- `client/widgets/gl/widgetsGl/render/drawNodeBody.txt`
- `client/widgets/gl/widgetsGl/renderWidgetTree.ts`
- `client/widgets/gl/widgetsOverlayFactory.ts`
- `client/widgets/layout/WidgetLayout.ts`
- `server/docs/agents/interfaces.md`
- `server/docs/monster-examine.md`
- `server/plugins/interface/MonsterExamine.entry.js`
- `server/plugins/interface/monsterexamine/Drops.MonsterExamine.js`
- `server/plugins/interface/monsterexamine/Facts.MonsterExamine.js`
- `server/plugins/interface/monsterexamine/Layout.MonsterExamine.js`
- `server/plugins/npcs/NpcDrops.plugin.js`
- `server/plugins/npcs/SeedCategories.NpcDrops.js`
- `server/scripts/browser-host-interface-definitions.ts`
- `server/src/main/typescript/elvarg/game/content/combat/formula/AccuracyFormulasDpsCalc.ts`
- `server/src/main/typescript/elvarg/net/NetworkBuilder.ts`
- `server/tests/examine-chat-types.test.cjs`
- `server/tests/monster-examine.test.cjs`
- `server/tests/npc-drops-reload.test.cjs`
- `server/tests/npc-drops-seed-categories.test.cjs`

## Compact tiles and item actions

The grid no longer has a separate "Rewards / hover for conditions" heading. The list starts
immediately below the count. Every reward/group tile reserves the same 132-pixel height,
including its single optional condition line. The unused line below the combined rate is
removed. Ordinary section/type labels and guaranteed-roll boilerplate are not repeated.
Group tiles show their count; the plus/minus button and native menu describe expansion.

Rates are one line, for example `[1/2] 50%` or `[31/64] 48.44%`, without the `Base:` prefix
or `~`. Short source ratios are recovered for display and retain the underlying base
probability. Percentages contain at most four decimal digits in total, such as `23.33%`
or `0.001%`; smaller positive rates display `<0.001%`. Missing/progression/eligibility
labels remain honest. Family/table tiles do not acquire combined rates or averages.

Generic client support adds opt-in `cards.groups`, group-specific part geometry and local
row actions. The widget router and primary-click path retain the selected op number, so
Examine and Drop info cannot become Expand/Collapse. Host callbacks reuse inventory item
Examine and game-chat messages. No new protocol, server endpoint or feature-specific core
logic is needed. Extra-rule text remains bounded server-authored row data.

Additional changed paths in this update are `client/game/widgets/WidgetActionRouter.ts`
and `client/game/widgets/input/widgetClickInput.ts`; the existing layout, projection,
runtime, card layout, OsrsClient, interface docs and focused tests also changed.

This tile/actions update passed the server build, client typecheck and production build,
12 focused client suites and 64 focused server tests. Tests exercise actual native menu
entries and the widget router, preserve primary expansion, verify item/conditional action
availability, blank rule lines, compact numeric rates and same-size group/leaf tiles. Existing
lint warnings remain; the changed card layout adds none. Running services remain available.

## Shared group backgrounds in the content builders checkout

The compact-card follow-up adds opt-in `cards.groupBackdrops`. Expanded folders start their
own card row. A four-pixel inset and a pooled native fill/frame associate the parent with
all visible descendants. Nested folders have their own frame and alternating depth colors.
Collapsed folders keep flowing beside sibling cards. No drop source or random roll changes.
The larger forty-row pool covers the shorter cards through the capped viewport bottom.
The decoration pools have no actions or click/scroll blocking flags and paint below cards.

`cardLayout.ts` returns `backdrops` alongside its existing placements and content height.
`cardGroupBackdrops.ts` builds spans from the complete filtered tree, then pools only
intersecting frames. This keeps an outer frame present after its parent card has scrolled
offscreen. Layout runs on data, expansion, search or resize changes. Pool synchronization
caches unchanged inputs and performs no layout or widget invalidation on an unchanged tick.
The existing tree filter still owns search and expansion/remount state.

### Shared runtime integration

The generic custom-interface runtime retains the full subtree spans returned by
`layoutCards` and synchronizes `CardGroupBackdropPool` before its unchanged-row
shortcut. This keeps a frame visible when the parent card scrolls out of the row
pool. Reset discards the old pool state before a new open or remount. The feature
is opt-in through `list.cards.groupBackdrops`; no feature or item IDs belong in
the runtime.

The integrated native-widget regression covers expansion, collapse, matching
search results, and an offscreen parent. The helper suite covers nesting,
responsive widths, malformed ancestry and decoration reuse. Admin socket search,
static skill tabs and native interface remount tests also pass with this hookup.
Live appearance still requires testing in the game client.

## Continuous Bestiary browsing

Bestiary fills the main modal height and uses a responsive grid with explicit Find
and Examine buttons on each creature. Scrolling recycles 40 native card slots. Only
the visible rows and one extra row bind NPC previews. The interaction preview loader
keeps at most 128 NPC meshes, and each card reuses one render texture. Catalogue
metadata arrives once in text packets under 40 KB; meshes load when their cards enter
the pool. Search accepts names or an exact NPC ID. Returning from Examine restores
the query and scroll position. Right-click Find/Examine use the same server actions.

The generic widget opt-ins are `examineAsOperation` for server-owned itemless Examine
operations, `recycleModel` for pooled render textures, `list.rowActions` for extra
per-card controls, `list.overscan` for bounded preview binding, and `preserveState`
for public browsing state across another custom interface. Ordinary item Examine
continues to use local item details. No catalogue endpoint exposes player state.


### Name groups, stable hover and map focus

Creatures share a collapsed pictured entry only when their exact name and combat
level match. Group cards have See variants and Find variants buttons. See variants
expands individual definitions with their own Find and Examine actions. Exact numeric
search goes directly to that definition. Group IDs are allocated beyond the native
row IDs and checked for collisions. Expansion, search and scroll survive a trip to
Examine and Back.

Compound card parts share a generic `hoverOwnerUid` background, so moving between
the model, caption, stats and action buttons keeps the card highlighted. Hover changes
invalidate the old and new widgets and their shared background, including static
previews. Buttons retain individual feedback. `suppressHoverText` disables redundant
native hover labels inside these panels while preserving contextual operations.

Find opens the native world map and queues focus until the map is mounted and its
area data is ready. Cache source-to-display coordinates choose the correct surface
or dungeon map and pan to the selected known spawn. Outlined markers alternate
gold and cyan every 650 ms on the map and minimap. The selected world-map pin is
larger. Minimap markers and bearing arrows remain available after
closing it. King Black Dragon uses its canonical home at 2269,4697 on its cache
submap. Unknown spawn locations are reported rather than guessed.

Live checks verified group expansion, variant Examine and Back, stable card colours
across the thumbnail, title and action buttons, and King Black Dragon Find. Find
opened Wilderness Dungeons, panned to the lair and displayed an outlined gold marker.
The native regression uses the real cache to verify dungeon and surface map focus.


### Variant location navigation

Find variants resolves group members on the server and combines their canonical
public spawns. Different combat levels remain separate. Identical tile/floor pairs
are deduplicated, ordered by distance, and limited to 256 pins per selection.
Find opens the native world map with a plugin-owned overlay, group 30024 mounted
on cache world-map root 595:0. Previous and Next cycle through known tiles and
wrap at either end. The selected tile can switch map areas, including dungeon
submaps. Clear pins removes the selection and overlay. Pins expire after ten
minutes; stale navigation cannot restore them. Only visible model slots are bound
while browsing, preserving the existing lazy preview pool.

The generic custom-list options `groupActions` and `rowActions.groupLabel` let
collapsed groups declare their own server operations and button captions.
Expansion stays local; Find variants transmits the server-owned group row ID.

### Parameterized shared drop sources

Revenant pages include `{{Revenants/Drops|combat=...|hitpoints=...}}` instead of
inline drop rows. The prior dumper skipped that include, so all twelve cached
Revenant definitions lacked imported tables. The repair lives in the producer at
`../osrsreboxed-db/scripts/drops/included_tables.py`, with loader integration in
`update.py` and regressions in `test/test_drops_dump.py`. It discovers `/Drops`
includes, caches official raw template source, substitutes parameters, evaluates
bounded arithmetic and conditional branches, and separates declared table versions.
Missing, cyclic or unresolved drop sources abort generation instead of silently
publishing incomplete rows. No NPC-specific downstream override is used.

The official source is
https://oldschool.runescape.wiki/w/Template:Revenants/Drops?action=raw .
Its fetched source is retained in the producer's
`data/drops/included-templates-wiki-page-text.json` for offline repeatability.
The producer checkout is based on `9c8c2b4` on branch `fix/shared-drop-includes`.
The unmodified producer reproduced the imported NPC export SHA-256
`4a7dd8c6289535363eb7a9cdf1a833e34a03b8755f4124a0437e701c8cb19993`.
Regeneration uses `SOURCE_DATE_EPOCH=1794182400`, preserving the existing metadata
date. Two runs must match byte-for-byte before import. Every prior NPC mapping and
table remains identical; twelve NPCs and twenty-four variant tables are added.
The repaired NPC export SHA-256 is
`6f1ae4622413b5d16adccffa404b06f572dc0721d9207aa65d7a8a5e3c9d70aa`.
The shared subtables export is unchanged.

Examine describes the effective server table. Native selection currently defaults
to the first, Off-task table for this family. On-task tables remain separate in the
export; skull and Slayer-task switching are not added by this repair. Source notes
about conditional rates and even ether quantities remain visible. This fixes missing
reward recognition without claiming complete Revenant kill-roll mechanics.
