# Dragon Slayer II barriers

`server/plugins/areas/MythsGuildBarrier.plugin.js` handles the barriers that open after
Dragon Slayer II:

| Loc | Cache name | Where |
|---|---|---|
| `ds2_guild_bridge_entrance` | Magical Barrier | Myths' Guild bridge, row of three at y=2861 |
| `ds2_guild_dungeon_entrance` | Magical Barrier | Myths' Guild basement, column of two at x=1968 |
| `ds2_lithkren_vault_barrier` | Barrier | Lithkren Vault: adamant (west) and rune (east) dragon wings |

## Live behaviour (rsprox captures)

- 224/01437, 230/00350 (Myths' Guild) and 231/00722 ticks 433 and 499 (Lithkren Vault): the
  player stops beside the barrier and faces it for a tick. On the next tick
  `You pass through the barrier.` (spam) arrives and the player is two tiles on, straight
  through the barrier tile, in one move.
- Every barrier is a 1x1 loc, so each tile is crossed straight through whichever row or column
  it is in.

## Requirements

- Wiki (Myths' Guild): entry needs Dragon Slayer II.
- Wiki (Lithkren Vault): "These barriers can only be entered once Dragon Slayer II has been
  completed."

## Not recorded

- The refusal for a player without the quest. Neither the captures nor the Wiki give a line,
  so `You need to complete Dragon Slayer II to pass through the barrier.` is ours.
- Other locs are also called "Barrier" (Zalcano, Soul Wars, ToB, GOTR). Every handler
  returns `false` for ids it doesn't own.
