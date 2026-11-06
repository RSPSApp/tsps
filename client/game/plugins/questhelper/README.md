# Quest Helper

A port of [Quest Helper](https://github.com/Zoinkwiz/quest-helper) (Zoinkwiz, BSD-2) at
`06da90f`. The quest logic, step conditions and puzzle solvers are the upstream Java. The local
bridge (`tools/quest-helper-bridge`, see its README for building and running it) runs them against
snapshots this plugin sends. The plugin is off by default; turn it on in the Configuration panel once
the bridge is running. This
plugin draws what the upstream plugin draws.

## Sidebar

- **Quest list** (QuestHelperPanel):
  - Search.
  - **Filters**, **Difficulty** and **Ordering** dropdowns: A–Z, Z–A, Optimal, Ironman optimal, Release date, and quest points ascending or descending, in the upstream sections.
  - **Show completed quests**.
  - The skill filter buttons, which hide quests needing or rewarding a skill. Quests they require are checked too.
  - Each quest is coloured by its state.
  - The local **Recommended next** list stays above the list.
- **Selected quest** (QuestOverviewPanel):
  - Name and a close button.
  - The current step, with its requirements, recommended items, teleports and dialogue choices.
  - The direction to the target.
  - A collapsed **Quest overview**: requirements (sub-quests' too with *Show full quest requirements*), recommended, items required and recommended, combat requirements, notes, rewards (unless *Hide quest rewards*), and the wiki link.
  - Every PanelDetails section (QuestStepPanel):
    - The current section is orange and the current step highlighted.
    - Hidden and faded steps follow upstream.
    - Lockable sections have the "Mark section as complete" box.
- **Requirement colours** are the pass, fail, partial (in the bank) and boost colours from config.
- **Assistance level** (cog, and on the first quest opened): minimum, medium or full presets, as AssistLevelPanel writes them.

## In game

- **Highlights**:
  - NPCs: outline, convex hull or tile.
  - Objects: outline or clickbox.
  - Ground items: tile.
  - All in *Color of target overlay* and *Outline thickness*.
  - The quest icon over targets.
- **Inventory and bank items** the step needs: square, outline or filled outline.
  - Inventory: `highlightInInventory` items, plus teleports when 100+ tiles away.
  - Bank: the step's required items.
- **Dialogue**: the right option is numbered `[n]` and recoloured, staying so after hover. DialogChoiceChange and WidgetTextChange text replacement work too.
- **On-screen overlay**: the step's upstream PanelComponent as a movable overlay (Alt-drag).
- **Arrows**: the native world and minimap hint arrow. The world map gets the step's point, snapped to the edge.
- **Engine drawings**: world lines, widget hints and puzzle solutions follow *Display navigation paths*, *Display widget hints* and *Show Puzzle Solutions*.
- **Quest tab menu**: right-clicking a quest gives **Start/Stop Quest Helper**, one per Shield of Arrav gang and Recipe for Disaster subquest.
- **Auto start helper** and **Auto open sidebar**: a quest started in game becomes the guide.
- **Use 'Shortest Path' plugin** (off by default, as upstream):
  - Upstream's `DetailedQuestStep` posts `PluginMessage("shortestpath", "path" | "clear")` as steps start and end, and when the option is toggled.
  - The bridge collects what upstream's steps post and returns it with each evaluation, and the client hands it to the Shortest Path plugin.
  - A route is replayed when Shortest Path starts after the step posted it, so enabling the plugin later still draws the route.
  - The client clears the route itself when the quest is switched, Quest Helper stops or the player logs out, because the engine isn't asked again then.
- **Bank tab** (`QuestBankTab`):
  - A "quest-helper" button by the bank's tabs lays the quest's items out in sections: recommended, each part of the quest, then "Non-quest items".
  - Missing items are placeholders with "Details".
  - The amount needed and a tick or cross are shown, and withdrawing uses the item's real bank slot.
  - The sections come from upstream's own `QuestHelperBankTagService`, run in the bridge while the bank is open.
  - It uses RuneLite's patched bank scripts and Bank Tags' `BankSearch`, as upstream does.
- **Grand Exchange** (`QuestGrandExchangeInterface`):
  - At the Grand Exchange, "View missing items" by the item search lists the quest's missing tradeable items.
  - Away from it, a step that names items to buy shows them at once (with *Show Puzzle Solutions*).

## Snapshots

Every evaluation sends the engine a snapshot of the game (QuestHelperSnapshot). The large,
rarely changing parts (the scene's objects and terrain, the loaded widget tree and the cache
definitions) are sent in full once with a digest; the server keeps them per browser session and
echoes what it holds (`cached`) in every result, after which the client names an unchanged section
by digest (`reuse`) instead of resending it (QuestHelperReuse). The bridge still gets a full
snapshot. A session that doesn't hold what the client names answers with an error, and the client
sends everything in full again. Map squares a low-end client hasn't built are reported as unloaded
tiles rather than failing the snapshot, and nothing is collected while no quest is selected.

## Settings

Group `questhelper`, with the upstream keys and sections. *Spicy stew*, *Show Puzzle Solutions*, the hint switches, *Use 'Shortest Path' plugin* and the colours are sent to the engine with each evaluation.

Older keys are moved once:
- `highlightWidgets` to `showWidgetHints`.
- `showOverlays` to `solvePuzzles`.
- `showDirections` to `showMiniMapArrow`.
- `highlightColor` to `targetOverlayColor`.
- `highlightTiles=false` to the `NONE` styles.

## Not ported, and why

| Upstream | Reason |
|---|---|
| *Highlight missing items* and its three *Include …* options | These are ground highlights for every unfinished quest's items. They need every quest's helper evaluated at once, but the bridge runs one helper per session. |
| Potion storage in the bank tab | The offline server has no potion storage. |
| *Fan appears on quest completion*; player-made quests | Both spawn RuneliteObject models, which the browser client can't inject. |
| Achievement diaries, skill and generic helpers | The offline server has 184 quests and no diary tasks or diary varbits. The bridge's catalog is those quests. |
| Region filtering | Leagues-only, and there are no league worlds offline. |
| *Outline feathering* | The client's model outline pass has width and colour, no feathering. The setting is stored but has no effect. |
| *Have the minimap arrow flash* | The arrow is the native hint arrow, which doesn't flash. The setting is stored but has no effect. |
| Ground item outline and clickbox | The client has no ground-item model outline, so both draw as the tile. |
| Manual step skip boxes | No quest helper at `06da90f` sets a skip requirement. |
| Development section, debug overlay, dev commands | Development only. |
