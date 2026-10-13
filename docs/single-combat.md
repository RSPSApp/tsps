# Single combat

Outside multi-combat areas, `CombatFactory.canAttackPermission` turns an attack away for two
different reasons, and each has its own response and message.

| Situation | Response | Message | What happens |
|---|---|---|---|
| Something else is fighting you | `ALREADY_UNDER_ATTACK` | `I'm already under attack.` | The attack waits and goes ahead once you are free (also covers your own last hit still landing after a kill). Sent once per attack. |
| An NPC is fighting someone else | `TARGET_IN_COMBAT` | `Someone else is fighting that.` | The attack stops. |
| A player is fighting someone else | `TARGET_IN_COMBAT` | `Someone else is already fighting <name>.` | The attack stops. |

An NPC whose target is taken keeps following and waits, as before.

## Sources

rsprox captures ([rsprox.net database](https://rsprox.net/database)), "Attack" on NPCs and
players:

- `I'm already under attack.` follows the click on the same tick in 650+ attempts. Live OSRS sends
  it as a spam-filter message; tsps has no filterable message type yet, so it is a game message.
- `Someone else is fighting that.` is a game message on the click's tick or the next (about 110
  attempts), with no attack after it.
- `Someone else is already fighting <name>.` follows "Attack" on a player, on the click's tick.
