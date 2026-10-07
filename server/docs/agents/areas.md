# Area-scoped content

Content that only applies where a player stands (the Wilderness, a minigame, a boss room) is
an `Area`, not a set of global hooks.

## Why

A global `onPlayerProcess` / `onCanAttack` / `onCanTeleport` / `onNpcAggressionTolerance`
runs for every player on every call and has to ask "am I in my area?" itself - O(players)
per tick per hook, even when the area is empty. `AreaManager` already resolves each actor's
area once, when they move, so an Area costs nothing for anyone outside it and gets reliable
`postEnter` / `postLeave` edges for free.

| | Global hook | Area |
| --- | --- | --- |
| `canAttack` per tick | O(players x hooks) | O(players) |
| Aggression tolerance per tick | O(players x npcs x hooks) | O(players x npcs) |
| Per-tick processing | O(players) | O(players in the area) |
| One more area plugin | +O(players) per tick per hot hook | +0 for players outside it |

## How

```js
function createArena(api) {
  class Arena extends api.core.Area {
    process(mobile) { /* per tick, actors in the area only */ }
    postLeave(mobile, logout) { /* reset UI, drop carried items */ }
    canAttack(attacker, target) { return null; }      // true / false / null = no opinion
    canTeleport(player, wildernessLevelLimit) { return null; }
    npcAggressionTolerance(player, npc) { return null; }
  }
  return new Arena(ARENA_BOUNDARIES);
}

register(api) {
  api.registerArea(createArena(api));
}
```

- Register with `api.registerArea`, not `AreaManager.areas.push`: it attributes the area's
  time to your plugin in `::pluginperf` and isolates a throw from the player's tick.
- Core asks the attacker's area, then the target's, before the global hooks; `null` falls
  through. Keep a global hook only for rules that genuinely span areas.
- An actor holds one area and the first registered match wins. A broad area (one that can
  cover the whole map) registers in `onServerStartup` so specific areas take priority.
- Entering another area directly (`area.enter(player)`, as instances do) leaves the previous
  one first, so `postLeave` always fires. Judge the exit by having left, not by the tile: an
  instance can claim a player before moving them.
- Rules still read the actor's live state (tile, combat level); membership only decides who
  is asked, and can trail a teleport by a tick.

See `plugins/areas/Wilderness.plugin.js` for the worked example.

## Content spread across the map

An Area fits a compact zone with rules. Content scattered over the map (farming patches, bird
houses, hunting grounds) doesn't fit one: an actor holds one area at a time, and most of the
cost is usually not about location anyway. Instead:

- Sync per map square with `api.onPlayerMapSquareChange`, which fires once per 64x64 square
  crossed (walking or teleporting), not per tile.
- Drive timed work from one `core.Task` that visits only what is active (players with queued
  work, traps, glove holders), or spreads a per-player sweep over several ticks.
- Walk a player's own state, not every definition in the game.
