# Checking behaviour in-game

Start the server with the agent MCP enabled (see [perf.md](perf.md)). These tools let an agent
run the in-game checklist a PR asks for, without a client.

| Step | Tool |
| --- | --- |
| Get players | `login` (any number of accounts), `logout` |
| Set the scene | `command { player, text }` runs a `::command` as a developer for that call: `tele x y z`, `item id amount`, `master`, `cwar`, `toa` ... |
| Ask a rule | `can_attack { attacker, target: { player } or { npc } }`, `can_teleport { player, x?, y?, z? }` run the real checks and return the verdict and message, with no fight or teleport |
| Act | `walk_to`, `interact`, `npc_option`, `object_option`, `inventory_option` (Wear/Wield to equip), `use_item`, `player_option` (Attack/Trade/Follow), `cast_spell { spell, target? }` |
| Skip time | `advance_time { player, minutes }` moves timed content forward (farming, seedlings, bird houses) |
| Check the result | every action returns `area`, new `messages` and `client` (varbits, varps, interface opens/closes/hides sent since the last call); `observe { varbits, varps }` reads current values |

For example, Castle Wars friendly fire is: two `login`s, `command cwar` (or walk both into
the game), then `can_attack` between teammates (expect `CANT_ATTACK_IN_AREA` and the
message) and across teams (expect `CAN_ATTACK`).

A plugin with timed state opts in to `advance_time` by listening for the
`agent:advance-time` custom event (`{ player, ms, handledBy }`), moving its own deadlines
`ms` earlier and pushing its name onto `handledBy`.

What these can't check: how things look on screen, animation timing and feel, and anything
that depends on the real client's own scripts running.
