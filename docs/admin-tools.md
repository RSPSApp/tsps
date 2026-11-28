# Admin tools

Type `::admin` to open the native panel. Admin, Owner and Developer accounts can
open it. Every action and delayed input rechecks `::admin` permission, the panel
session and the selected player's live session and world profile. Player changes
also respect the relevant command's world-configured permissions and refuse
targets ranked above the actor.

## In-game panel

The selected player stays named above the editing tabs. Spawn names your own
character instead, because floor spawns always use the admin's location. In Players, click an online human player
to select them, then Edit player to enter the editor. Find player accepts a full
online name, including players beyond the first 200 listed. Use self returns to
your own player. Bots and other world profiles are excluded.

| Tab | Controls |
| --- | --- |
| Players | Select a target, Edit player, Go to, Bring here |
| Teleports | Teleport to map location; search grouped source folders; click a destination to teleport immediately; enter coordinates |
| Player editor | Skills, Quests, Staff, Inventory, Equipment, Bank, Character |
| Cheats | Resources/combat, temporary modes, self-only bank |
| Spawn | NPCs and Items searches with native previews, Spawn 1 under me, Spawn X, Clear my NPCs |
| Bots | Built-in spawn behaviors, routines, activity launchers, self-bot toggle and active bot management |

Teleport to map location opens the world map above the panel. Use the map's dungeon
and submap navigation, pan or zoom, then click a tile to teleport the selected
player. The click uses the submap's original world coordinates and plane. Dragging
does not teleport. Closing the map cancels the selection. Target and tab changes
also cancel it, and the click rechecks permissions and the target's live session.

The Character section contains all four spellbooks and the Preserve, Rigour and
Augury unlocks. These actions affect and save the selected player.

The Bots tab uses the same routine catalogue and deployment limits as the standalone
browser. `::bots` opens the tab. Use `::bots browser` to open the standalone browser
and access saved setups and deployment plans. Bare `::bots` also opens that browser
when AdminPanel is disabled.

Under Spawn bots, select a routine or activity and click Configure. Set the quantity
with the minus/plus controls or click the number to enter it. Some routines allow
you to change the spawn location or copy your base skill levels. Click Spawn to
deploy. The result appears above the Spawn and Back controls.

Under Active bots, select a bot and click Manage bot to see its behavior, stats,
equipment, rename, inspection and manual-control actions. Each action checks its
original command permission and the bot's live registration. Use `::botback` to
return to your character after manual control. My character has a separate
Start/Stop control for your own bot controller.

Teleports has no details panel or second action button. Folder clicks only
expand/collapse. Search reveals matching descendants; clearing it restores prior
expansion. Dynamic landings are resolved again at the destination click. Sources,
private-instance restrictions, coordinate bounds and persistence checks remain.
Self teleports from this panel preserve it. Coordinates can still be blocked tiles.
See the [integration notes](https://github.com/RSPSApp/tsps/blob/main/server/plugins/tools/adminpanel/INTEGRATION.md) for the teleport sources.

The slot item picker and both Spawn searches take keyboard focus immediately when
opened. Clicking elsewhere releases focus; ordinary result refreshes do not take it
back. They search after a 180 ms typing pause over the authenticated game
socket. Names need two letters; exact IDs are accepted for experienced users.
Item results load in pages as you scroll. Session, sequence and query checks reject late replies.
Changing a query clears old details and actions. Item names lead the result;
labelled IDs and noted/stack information are in the selected preview. Item results
include loaded custom items and exclude bank placeholders. The selected item uses
its cache model, and the result rows use native item icons.

Player editor keeps Skills, Quests and Staff together. Skills uses the native
three-column order and cache skill icons with readable names and current/base
levels. Click a skill for a target-named level prompt; selected details show XP and
adjustments by 1 or 5. Max/reset presets retain typed confirmation. Restore leaves
base levels and XP unchanged. Quests Complete and Reset apply directly without a
typed confirmation. Unlock all quests and Reset all quests both require typed
confirmation for the selected player. Unlock all follows `::quest all`, including
supported miniquests and bulk reward routing. Reset all returns registered quests
to stage 0 and adjusts quest points. Reset keeps rewards and separate miniquest
progress, and may keep quest-specific progress. Completing a reset quest can
grant rewards again. Staff changes retain typed confirmation. Owners can change
lower ranks below Owner, and Developers can also grant Owner. Neither can change
their own rank, a peer/higher rank, or grant their own/higher rank.

Inventory, Equipment and Bank read the selected player's live containers. Inventory
uses the native four-column, seven-row layout. Equipment uses the cache's worn-slot
positions, frames and empty-slot icons. Bank uses an eight-column grid with real
tab controls. These isolated Admin widgets never replace the viewer's own items.
While a container is open, each game processing tick compares it and sends changed
slots. A disconnected target's slots are cleared. Bank excludes its derived search
container. Inventory and bank slots have visible outlines, including empty slots.
Bank keeps at least eight rows available and hides unused rows beyond its occupied
extent plus one spare row.

Click an empty slot to open the pictured item picker for that slot. Click an
occupied slot to set its exact quantity; enter 0 to remove it. Right-click offers
Set quantity, Add quantity, Remove quantity and Remove stack. Adding a quantity
increases the selected stack. Setting a quantity replaces its amount. The selected
item's controls include Cancel, and bank prompts show a Cancel button above the
grid. Native right-click menus retain their Cancel entry. Drag items to move or swap
slots. Drag a bank item onto another tab to move it there, merging matching stacks
when possible. The player editor has no
separate Spawn items section. Every edit rechecks the slot's ID, quantity and metadata.
Nothing drops on the floor. Inventory/bank additions report the actual amount
that fits. Equipment additions obey wear requirements, equip hooks, stack limits
and two-handed conflicts, and require an occupied conflicting slot to be removed
first. Equipment edits refresh appearance, bonuses and weapon interface.

The top-right Add item button opens the picker for Inventory or Bank. Additions
merge into a matching stack, even when the container is full. A new item uses
the first free inventory slot or a free slot in the selected bank tab. The bank
converts notes to their unnoted items and can merge with an existing stack in
another tab. Equipment uses its individual worn slots. A persistence failure may
follow a live change. Check the result before repeating a grant.

Cheats groups start collapsed. Searching reveals matching controls and their parent
groups; clearing the search restores their previous expansion. It retains
bounded resource amounts, restore/cure/combat controls and temporary
modes. Noclip uses direct ground routes and collision-free interaction routes,
while retaining the target's native reach rules. Existing Owner-level mode/command checks remain.
The bank action is self-only and replaces this panel. Spawn has NPCs and Items
sub-tabs. Spawn 1 under me uses your exact tile if it has enough clear space.
Spawn X places 1-20 separate creatures or individual floor items on different
reachable tiles within ten tiles of you. It uses ordinary collision even with noclip,
checks creature footprints and instance bounds, and refuses the whole batch when
there is not enough safe space. Floor items use native ownership and expiry.
Changing sub-tabs cancels a pending amount prompt and invalidates old search replies.
NPC spawning retains Owner/Developer command permissions; item spawning requires
Admin or above and item-command access. At most 100 panel-owned NPCs may be active per admin.
They are never persisted,
use the existing no-default-respawn lifecycle, and are removed by their owner's
cleanup/logout. Ordinary spawns and other admins' NPCs are not removed.

The panel declares `lifecycle.persistOnWorldInteraction` and
`lifecycle.blocksGameplay: false`. Walking, equip/item/drop actions, combat and
teleports preserve it while aborting native prompts. Explicit close,
logout and replacement interfaces still end the session. Other interfaces keep
their existing lifecycle. The implementation adds optional generic renderer
capabilities; all admin behavior and state remain in plugins through `api.core`.
Tab changes hide the old view until the server's new layout is ready, so opening
Player editor does not briefly display the previous list in the editor's geometry.

## Open this worktree

On `feat/content-builders`, the assigned ports are:

| Tool | Address or port |
| --- | --- |
| Game client | `http://localhost:3101` |
| Game connection | 43701 |
| Agent MCP | 49801 |
| Gateway | 43901 |

Check `scripts/wt ls` if the worktree's slot changes. Keep the assigned `.env`
ports; do not substitute the main checkout's defaults.

## Existing in-game tools

`::commands` or Ctrl+/ searches the actual command registry and only shows commands
the player may run. `::teleports` or Ctrl+; opens named teleport destinations.
World configuration can override command permissions; these are the default ranks:

| Capability | Existing command | Default rank |
| --- | --- | --- |
| Search and spawn named items | `::items` / `::item` | Administrator |
| Give another player an item | `::give <id> [amount] <player>` | Administrator |
| Teleport to coordinates | `::tele <x> <y> [plane]` | Administrator |
| Go to / summon a player | `::teleto <player>` / `::teletome <player>` | Administrator |
| Set a named skill | `::setlevel <skill> <level> [player]` | Owner |
| Max / reset skills | `::master` / `::reset` | Owner |
| Edit inventory, equipment or bank | `::copybank` | Owner |
| Set special attack energy / unlock prayers | `::spec` / `::unlockprayers` | Owner |
| Search and spawn NPCs | `::npcs` | Owner |
| Quest progress, completion, reset | `::quest <name> [complete|reset|stage]` | Administrator |
| Bank, infinite health/run, noclip | `::bank`, `::infhp`, `::infrun`, `::noclip` | Owner |
| Moderation | `::kick`, `::ban`, `::unban`, `::mute`, `::unmute` | Owner |

Container grants also require `::item` for your character or `::give` for another
player. Other container edits use `::copybank` permission. Staff rank changes
have their own Owner minimum and can only modify lower ranks.

## Enable, disable and remove

Install AdminPanel from the Hub and restart the world to register `::admin`. The
repository's `server/plugins/tools/AdminPanel.entry.js` is the source entry for
the optional package.

To disable the in-game panel, merge this into the existing
`server/data/definitions/world.local.json` and apply at a planned restart:

```json
{ "plugins": { "AdminPanel": false } }
```

Remove AdminPanel through the Hub to unregister the panel at the next restart.

## Validation

The focused tests are:

```sh
cd server
yarn build
node --test tests/admin-panel.test.cjs tests/bot-in-game-interface.test.cjs tests/admin-commands.test.cjs tests/quest-command.test.cjs
cd ../client
./node_modules/.bin/tsx --test tests/admin-panel-interface.test.ts tests/custom-interface-first-open.test.ts tests/custom-interface-runtime.test.ts
```
