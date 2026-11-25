# AdminPanel integration notes

AdminPanel uses group 30022; Monster Examine uses 30021. This implementation owns the generic
custom interface runtime changes below. The parent owns the running
client3101/game43701/admin49601/Creator3891 stack.
This extension adds source-owned teleport descriptors and instant testing controls.
It does not restart services, stage changes, commit, or act on a live player.

## Teleport catalogue coverage

The catalogue contains **1,082 destinations across 129 source paths** for a player
with no docked boats. Duplicate landings from different sources stay in their own
folders. Each source folder starts collapsed. Search reveals matching destinations
and their ancestors, and clearing it restores the browsing expansion state.

| Source branch | Destinations |
| --- | ---: |
| Spellbooks | 52 |
| Minigame teleports | 24 |
| Jewellery | 87 |
| Items | 133 |
| Skillcapes and combined max capes | 438 |
| Spirit trees | 13 |
| Fairy rings | 54 |
| Wilderness obelisks | 6 |
| Runecrafting ruins | 13 |
| NPC teleports | 7 |
| Diary rewards | 16 |
| Server destinations | 238 |
| World spawn | 1 |

843 destinations are outside Server destinations and World spawn. Source additions
include all four home spells; all seven separately named Lunar group spells;
Camulet, Chronicle, both teleport crystals, Rings of elements and shadows,
Drakan's medallion and quest additions, basalts, Xeric's talisman, both memoir
books, royal seed pod, ectophial, skull sceptres, mythical cape, calcified moth,
Giantsoul amulet, Pendant of Ates, jewellery aliases, master scroll book, canonical
spell-backed tablets and alternate landings, cape aliases, magic whistle,
quest-route sphere, all static spirit trees, obelisks, and rune essence wizards.
Randomized areas are labelled as origins, centres or captured alternatives.

Read-only provider request: `{ player, list: [] }`. Append
`{ path: ["Items", "Camulet"], key, name, tile: [x, y, z] }`, or a `Location`
under `location`. Each source retains its canonical constants and tables.
Descriptors must not travel, read unlocks through travel handlers, roll RNG,
consume inventory, create instances, write players or open dialogue. Registration
only attaches named handlers and new core access uses `api.core`.

An optional `resolve(target)` rechecks a dynamic landing at click time and returns
an array or Location. A missing, throwing or invalid result rejects the click.
Docked boats use their current canonical dock landing and require greater focus;
lost or moving boats are unavailable. Ring-of-life and defence/max-cape respawn
entries recheck the existing respawn event. No resolver travels or clears busy.

Coordination events stay with their source plugins:

- `drakan-medallion:catalogue`, `{ destinations: [] }`, returns the medallion's
  canonical quest additions without checking player unlocks.
- `teleport-scroll:destinations`, `{ list: [] }`, returns scroll/name/key/tile
  descriptors for the master scroll book, including Revenant and Guthixian scrolls.
- `skillcapes:travel-destinations`, `{ player, list: [] }`, describes Sailing
  cape travel, including safe docked-boat resolvers.
- `LunarSpells.getTeleportDestinations(true)` opts into group spells. Existing
  callers without the argument keep their original spell list and behavior.

Real remaining gaps are unsupported travel content, not copied fallback buttons.
Grand seed pod has no current travel handler. Enchanted lyre has quest performance
and tuning but no post-quest teleport network. Crystal teleport seed is recharge
material, rather than a charged teleport. POH interiors, group-house interiors,
private instances and moving-player destinations have no safe catalogue resolver.
The core Teleport to House fallback is an outside portal, so it is omitted.
Ordinary doors, ladders, ship passages and cutscenes are outside this teleport
source catalogue. Fairy rings require their source plugin enabled.

## Current panel integration

The six visible tabs are Players, Teleports, Player editor, Cheats, Spawn and Bots.
Players selects a shared target; Edit player enters the combined editor. Its
sections are Skills, Quests, Staff, Inventory, Equipment, Bank and Character.
Character owns the four spellbooks and permanent prayer unlocks. Bots uses the
private `admin:bots` event registered by `runtime/DeploymentService.PlayerBots.js`
for catalogue and deployment, preserving the existing
`bots` command permissions and shared bounded deployment functions. `::bots`
requests `admin:open` with the Bots tab. `::bots browser` always opens the
standalone browser, which also handles existing search and roster arguments.
The admin tab uses `RoutineCatalog.PlayerBots` and the same managed-bot count
as the deployment limit. Saved setups and deployment plans are available in the
standalone browser. `RegisterBotCommands` contributes built-in launchers through
`bots:collect-launchers`, sharing the existing spawn/recruit handlers and the
bounded deployment flow. `admin:bot-controls` describes active bots and invokes the
existing self-controller, behavior, stats, gear, rename, inspection and manual-control
handlers with structured arguments. Permissions are rechecked for each original
command. Active bots is a separate browser and lists up to 200 registered runtime bots.
`BotView.AdminPanel.js` owns the native Spawn bots / Active bots / My character
sections, a scrollable setup form, management buttons and fixed Spawn/Back footer.
No setup or management actions are mixed into the launcher list. Bot details use
the full preview width; selecting details explicitly hides the empty-panel prompt.
The runtime registers deployment, controls and the compatibility command independently
of `interface/Bots.PlayerBots.js`. The optional standalone interface consumes the
same runtime service and only handles `bots:open-standalone`. Removing its import
and registration in PlayerBots leaves admin controls operational. No admin action
runs a chat command or calls a standalone UI handler.
No privileged data is sent over a public endpoint. All target
mutations still use authenticated game actions and existing `api.core` APIs.

Teleports uses the full list width and height above Enter coordinates. A leaf click
resolves its current landing and teleports immediately. Folder clicks remain local.
The old side panel and second teleport button are removed.
Teleport to map location opens native group 595 above the panel. A one-shot
selection in the admin session routes `player:world-input` map coordinates through
the existing player-tool teleport action for the selected target. Closing the map,
changing target/tab or ending the panel session cancels it. Native dungeon and
submap navigation stays available. Client drag movement cancels click detection. Self teleports call the
existing generic `TeleportHandler.onTeleporting(player, false)` option.

The slot item picker uses native result icons and a larger cache-model preview,
with the canonical item description beside it and named quantity actions.
Its private tab index remains hidden for wire compatibility. Spawn has NPCs and
Items sub-tabs with authenticated cache-name search, native previews and the
actions Spawn 1 under me and Spawn X. NPC results show level/HP when available.
Clear my NPCs appears only in the NPC sub-tab. Spawns use the actor, independently
of the selected editor target. Batches plan unique reachable tiles within ten
tiles using ordinary collision, including while noclip is enabled. See [Spawn
integration](SPAWN.md) for placement bounds and lifecycle.
Item search includes every matching item. Native searches return 40 rows per
request using `offset`, with the full match count in `total`; later pages retain
the same session, sequence and query. The client requests nearby pages while
scrolling, keeps three pages of metadata, and reuses the visible thumbnail slots.
Changing the query invalidates pending pages. Responses without page metadata
remain compatible with older hosts. NPC search retains its existing catalogue
limit.
The existing `admin:testing-tools` event owns spawn permissions, the 1-20 batch
limit, the 100 active NPC cap, no persistence, no default respawn and owner cleanup.

Cheats groups existing testing/resource and temporary mode actions in collapsed
folders. Search reveals matching descendants and clearing it restores browsing
expansion. Character uses the four spellbooks and prayer unlocks. Resource bounds,
rank/command overrides, temporary mode logout and self-only bank remain in the
existing source modules. `admin:testing-modes`, `admin:testing-tools`,
`prayer:unlock`, `disease:cure` and `quests:admin` remain the integration events.

`Containers.PlayerTools.js` reads authoritative Inventory, Equipment and real Bank
tabs. The editor calls it through `applyPlayerTool`'s `container` action and persists
the live player through the configured backend. Exact-slot removal compares item
ID, amount and metadata. Additions use `getAddableAmount`/`add`; equipment checks
`EquipmentRequirements`, `PluginManager.emitCanEquip/emitCanUnequip`, wear slot,
stack limits and two-handed conflicts. It refreshes bonuses, appearance and the
weapon interface. Occupied conflicting equipment is never silently replaced.
`Containers.AdminPanel.js` builds isolated native item slots in group 30022.
Equipment follows active-cache group 387, sprites 170/172/173 and enum 904's
empty-slot icons. Inventory follows scripts 6007/6010's four-column, seven-row
spacing. Bank uses eight columns, real tabs and a bounded 1,410-slot capacity;
each editable inventory/bank slot has a native outline. Bank shows at least 64
slots, then hides trailing slots beyond its occupied extent plus one spare row. None of these widgets
bind the viewer's own inventory, equipment or bank interface IDs.

Empty slots open the pictured picker for that exact slot. Occupied slots prompt
for an exact quantity; zero removes the stack. Right-click offers addition and
bounded removal actions. Native IF_BUTTOND drags move/swap slots, and bank-tab
drops move or merge stacks with matching metadata. Bank grants unnote items
and use the selected tab for a new stack.
The item description remains beside the preview in inventory/equipment views.
The top-right Add item button is visible only for Inventory and Bank. The
shared operation checks capacity at mutation time. It merges matching stacks
or allocates a free slot for a new item. For non-stackable inventory items and
new stacks, the native slot picker still honors the selected empty slot.

Occupied slots publish ordered Set quantity, Add quantity, Remove quantity and
Remove stack operations. The side preview exposes Set/Add/Remove/Cancel; bank
prompts expose Cancel above the grid. Both routes cancel stale native input before
other actions. `increase` preserves item metadata and obeys quantity/stack bounds.
The old Undo UI and its registration are removed. Shared backend undo remains
available to existing adapters with its unchanged full-scope safeguards.

`onPlayerProcess` does an immediate WeakMap lookup and only compares live container
entries for an active admin viewing a container. It sends changed native slots after
changes and clears them on target disconnect. Delayed inputs become invalid after
these refreshes. There is no timer, persistent subscription or saved panel state.
`interface:closed`, `interface:opened` and logout remove session/close-marker state.

## Generic client declarations

All additions are optional and backward compatible:

- `CustomInterfaceRow.npc` names a cache NPC for the list icon and selected preview.
  The declared preview widget's `npcFullBody: true` uses the existing fitted body
  renderer; ordinary item icons and declarations retain their original widget type.
- `list.select.actionComponents: [{ field, components }]` shows controls only when
  the selected row supplies a nonempty action label.
- `list.select.autoHideIcon: true` manages preview visibility from the selected
  row. Older declarations retain server-controlled visibility and model settings.
- `list.select.clearOnQuery: true` clears details when a new local filter is typed.
  Older declarations keep their original selection behavior.
- `tabs.geometry: [{ component, base, overrides }]` restores the base raw geometry
  then applies overrides keyed by active tab. Admin uses this only to extend the
  full-width teleport list into the space left by its removed footer.

The native stale-panel bug came from initial empty-slot pooling caching `[]` as
its action list. Real mouse input resolved that row to Ok without an op ID.
The renderer now saves the original declared action before clearing empty/header
slots, and preserves calculated tree/local actions when pooling clickable rows.
No Admin-specific branch was added to the runtime. Card-group, Examine and minimap
helpers were not edited.

## Generic server lifecycle

`CustomInterfaceRegistry` accepts
`lifecycle: { persistOnWorldInteraction: true, blocksGameplay: false }`. `Player.closeInterruptibleInterfaces`
passes a generic world-interaction flag to `PacketSender.closeInterruptibleInterfaces`.
The sender preserves only the declared main panel and aborts native input/chatbox
prompts. `Player.busy()` ignores only the opt-in interface gate; death, status,
teleport, placement and forced-movement gates remain. Equip, item, drop, combat
and teleport interruption routes use the same generic world-interaction flag.
Explicit IF_CLOSE calls the sender without that flag, so it still closes.
Opening a bank replaces the mounted panel normally. No interface is preserved by
default and no feature-specific core hook or PluginManager/PluginTypes edit is used.

## Validation and limits

The real primary-action resolver plus `processWidgetClickInput` reproduced a blank
selected title before the pooling fix and passes afterward. Real Player/PacketSender
objects reproduced walking closing group 30022 before the lifecycle change and now
verify preservation, explicit close and bank replacement. The regression now sends
decoded move/IF_CLOSE packets through real `ClientConnection` dispatch, verifies
the walk request and checks that a pending input is cancelled. Tests also exercise real
containers, stale prompts, live refresh, safe undo, capacity, temporary NPC ownership,
quest direct actions, all books, modes, rank and persistence failures.

Final native-container validation passed 243 server tests and 41 client checks.
The server suite includes Admin, command permissions, WorldAdmin, quest actions,
bank operations, equipment and noclip. Client checks drive real primary click,
drag/release and packet serialization paths, plus Fixed/Resizable geometry.
Server compilation, client typecheck and scoped `git diff --check` passed.
Relevant test selections, after compiling the server:

```sh
# cwd: server
# Run with PLAYER_SAVE_IMPORT_LEGACY_JSON=0 and disposable
# PLAYER_SAVE_DATABASE_PATH / LEGACY_PLAYER_SAVE_DIRECTORY paths.
node --test tests/admin-panel.test.cjs tests/admin-commands.test.cjs tests/world-admin.test.cjs tests/quest-command.test.cjs tests/bank.test.cjs tests/two-handed-equip-space.test.cjs tests/equipment-sounds.test.cjs tests/noclip-movement.test.cjs

# cwd: client
./node_modules/.bin/tsc --noEmit -p tsconfig.json --incremental false
./node_modules/.bin/tsx --test tests/admin-panel-interface.test.ts tests/custom-interface-runtime.test.ts tests/custom-interface-first-open.test.ts tests/widget-script-inventory.test.ts tests/widget-drag-passthrough.test.ts tests/widget-drag-cycles.test.ts tests/widget-primary-op-context.test.ts tests/widget-key-shortcuts.test.ts
```

The temporary preload redirected checkout `server/dist` and source-alias imports
to the temporary build and reused `server/node_modules` through NODE_PATH. It and
all task build/log/database artifacts are disposable and removed at handoff.
No generated JSON, smoke scripts or dependencies were changed. No existing service
was stopped/restarted and no real player was acted on.
No staging, commit, push or PR. Task builds/profiles/logs are removed before handoff.

An earlier broad run initialized the default SQLite backend during plugin loading,
and two existing startup suites attempted the default admin listener at
127.0.0.1:49600. Both listener attempts failed with EADDRINUSE. Shared persistence
files were preserved. Final validation redirects SQLite and legacy-save paths to
the task temporary directory and excludes those unrelated startup suites.

Native container live appearance and real-player walking remain unverified after integration.
No screenshot or mock preview is claimed as a live check. NPCs without a direct cache
body model are omitted. The parent can integrate bestiary helpers independently.
Reload/build integration belongs to the parent; this task leaves the existing stack
running at localhost:3101 with its existing code.

## Exact implementation files

```text
client/widgets/custom/CustomInterfaceRuntime.ts
client/tests/admin-panel-interface.test.ts
docs/admin-tools.md
server/plugins/tools/AdminPanel.entry.js
server/plugins/tools/PlayerTools.js
server/plugins/tools/Containers.PlayerTools.js
server/plugins/tools/adminpanel/Controller.AdminPanel.js
server/plugins/tools/adminpanel/Containers.AdminPanel.js
server/plugins/tools/adminpanel/Layout.AdminPanel.js
server/plugins/tools/adminpanel/Npcs.AdminPanel.js
server/plugins/tools/adminpanel/Testing.AdminPanel.js
server/plugins/tools/adminpanel/INTEGRATION.md
server/src/main/typescript/elvarg/game/content/combat/CombatFactory.ts
server/src/main/typescript/elvarg/game/entity/impl/player/Player.ts
server/src/main/typescript/elvarg/game/interfaces/CustomInterfaceRegistry.ts
server/src/main/typescript/elvarg/game/model/teleportation/TeleportHandler.ts
server/src/main/typescript/elvarg/game/model/movement/path/PathFinder.ts
server/src/main/typescript/elvarg/net/packet/PacketSender.ts
server/src/main/typescript/elvarg/net/packet/impl/DropItemPacketListener.ts
server/src/main/typescript/elvarg/net/packet/impl/EquipPacketListener.ts
server/src/main/typescript/elvarg/net/packet/impl/ItemActionPacketListener.ts
server/tests/admin-panel.test.cjs
server/tests/noclip-movement.test.cjs
```

## Native input repair

Both tab backgrounds and their rendered captions are registered with the server.
They change the same authoritative tab, so a caption click cannot leave the server
on Players while the client displays Items, Player editor or Cheats. Compact folder
labels use the same compact height as their background, and empty preview icons are
hidden. A list fill covers the viewport. Skills use the available height and hide
the unused details area.

Custom search accepts keys when MESLAYERMODE is unset (-1) or idle (0); an actual
positive chatbox prompt keeps keyboard ownership. This fixes typing into chat after
clicking the Admin item/NPC filter while preserving native amount/name prompts.
Regression coverage includes native primary clicks, search key routing, server tab
caption dispatch, and compact folder geometry after expansion.


## Player editor and native layout audit

The top navigation is Players, Teleports, Player editor, Cheats and Spawn. Player
editor contains Skills, Quests, Staff and the three containers. Spawn items is removed.
The existing private item-search tab index is retained for wire compatibility; its
standalone tab is hidden and its active style belongs to Player editor. Selected
items show their canonical examine description beside a fitted native model.

The brown/gold frame follows Monster Examine. Named rows, folder frames and selected
row backgrounds fill the left list. The independently scrolling right pane keeps its
actions anchored at the bottom. Teleports use the full width and skills use their
native icon grid. Geometry and primary pointer regressions cover Fixed and Resizable
sizes, expanded folders, caption clicks, row selection, search ownership and stale
prompts. Server tests run against isolated persistence.

Earlier live checks with a disposable audit account verified item and NPC
typing, item descriptions and fitted models, target selection and the skills grid,
spellbook switching, direct teleports, walking with Admin open, and bank replacement.
The bank opened natively and removed the Admin interface.

## Native container and noclip repairs

The current container regressions verify exact-slot item picking, metadata-preserving
swaps, bank-tab transfers/merges, guarded undo, stale drags, revoked permissions and
target changes. Full-bank coverage verifies that hidden duplicate list rows cannot
overflow private metadata packets. Only native slot updates carry container contents.

Two native protocol details needed explicit handling. IF_BUTTOND encodes an empty
destination's item ID as unsigned 65535; the Admin handler normalizes it to -1.
Quantity prompts opt into `acceptsZero` so the native input dispatcher delivers a
zero-removal request. Client packet serialization and real server dispatch tests
cover these paths. Add item sits above the container viewport to avoid stealing
slot clicks in Fixed mode.

Ground walking already used direct noclip routes. Interaction routes still used
collision-aware pathfinding and detoured around walls. `PathFinder` now selects a
collision-free routefinder for flagged entities across interaction route/reach
checks. Target dimensions and reach rules remain native. A real ground-item route
regression verifies one straight checkpoint for noclip and a detour without it.

The incorrect Add menu label came from `sendInterfaceActions` writing legacy packet
125, which the browser transport did not deliver. Slots retained their declared
empty-slot label while the server executed occupied-slot op 1 as Set quantity.
The generic modern widget-actions packet fixes label delivery; plugin handlers
now match the published op order. A real PacketSender regression rejects fallback
to legacy `write`, complementing native client menu/packet tests.

`sendRows` sends its layout commit after all text, visibility and selection updates.
It includes `visibility:[{component,hidden}]` for managed view roots and controls.
Item and Spawn searches declare `search.focusOnTabs:[2,5]` for automatic keyboard
ownership. `layout.focusSearch:true` also focuses a fresh picker or Spawn sub-tab
without a main-tab change. Same-view refreshes preserve click-away. Switching
search contexts rotates the session token, so an old reply cannot populate another
context even when the query and sequence happen to match.

`tabs.serverDriven:true` masks declared `pendingComponents` after a tab click.
Intermediate `set_hidden` packets update the pending snapshot rather than expose
part of the view. The final layout commit applies rows, geometry and visibility
together. This removes the transient old list when entering Player editor.
Each commit bypasses text deduplication because it also acknowledges a tab
request. Repeated clicks on the already selected tab cannot leave content masked.

`WIDGET_SET_ACTIONS` uses modern packet 171 with a variable-short payload. The
server encoder and client decoder replace all native operation labels, preserving
empty indices. Updates received before an interface loads are held like its other
widget properties. Client regressions cross the real encoder, decoder, handler
and native menu generation.
