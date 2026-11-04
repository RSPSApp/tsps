# Idle Mode

Idle Mode is this fork's idle game, built as an **account flag** on the normal game, the same way
Ironman is. An idle account keeps gathering by itself, in the 3D world, and keeps gathering while
it is logged out.

- **Plugin:** `server/plugins/modes/IdleMode.plugin.js`, with one unit per feature in `server/plugins/modes/idle/`.
- **Data:** `server/plugins/modes/data/idle-mode.json`.
- **Tests:** `server/tests/idle-mode.test.cjs` (no cache needed).

None of this is OSRS behaviour: it is all ours.

## Turning it on

**In game**, any player:

```
::idle        say whether Idle Mode is on
::idle on     turn it on
::idle off    turn it off
```

It's saved as the attribute `idle-mode:enabled` (off by default).

**An idle world** makes every new account idle. Set it in `world.json` or, for one deployment,
`world.local.json` ([World configuration](world-configuration.md)):

```json
{
  "pluginConfig": { "IdleMode:newAccounts": true }
}
```

## Endless gathering

For an idle account, Woodcutting, Mining and Fishing (`"skills"` in the data) never stop
(`server/plugins/modes/idle/Gathering.IdleMode.js`):

| Setting (`"gathering"`) | What it does | Event it answers |
| --- | --- | --- |
| `bankResources` | What is gathered goes straight to the bank. The bank's room counts as room, so a full inventory does not stop the gathering. What an open container (a log basket, a coal bag) took stays there. A full bank gathers into the inventory as usual. | `storage:gather`, `storage:room` |
| `endlessResources` | Trees and rocks do not deplete. | `woodcutting:deplete-tree`, `mining:deplete-rock` |
| `fishingSpotsStay` | A fishing spot's random stop is skipped. Spots with their own movement (the minnow platform) still move. | `fishing:spot-stays` (emitted by `Fishing.plugin.js`) |
| `randomEvents` | `false` keeps random events away from idle accounts. | `random-events:eligibility` |

## Offline progress

`server/plugins/modes/idle/Offline.IdleMode.js`. While an idle account gathers, the plugin
measures the rate it really gets from each `storage:gather`: the items, and the skill's XP
between the first gather of the session and the latest. Nothing is estimated from formulas, so
tools, levels, boosts and relics all count as they did in play.

- **A session** starts on the first gather. Another skill, or more than `maxGapSeconds` between
  two gathers, starts a new one.
- **Logging out** mid-session (the last gather no more than `maxGapSeconds` before) with at
  least `minSampleSeconds` measured saves the session as `idle-mode:away`:
  `{ skill, durationMs, xp, items, loggedOutAt }`.
- **Logging back in** pays the time away at that rate: the XP to the skill (the world's XP rate
  was already in the measured XP, so it isn't applied twice) and the items to the bank. Time over
  `capHours` isn't paid, and `efficiency` scales the whole reward (`1` = the rate played). What
  the bank has no room for is lost. The player is told:

```
While you were away for 1h 0m, you kept woodcutting:
15,000 Woodcutting XP, 600 x Logs to your bank.
```

| Setting (`"offline"`) | Default |
| --- | --- |
| `enabled` | `true` |
| `minSampleSeconds` | `60` |
| `maxGapSeconds` | `60` |
| `capHours` | `12` |
| `efficiency` | `1` |

## Roadmap

1. Endless gathering - done.
2. Offline progress - done.
3. Auto-activity: pick an activity and the character walks there and works by itself (built on
   the player bots in `server/plugins/bots/`).
4. Idle progression: points for time played and a shop of upgrades (speed, offline cap, bank).
5. Idle combat: fighting monsters by itself, with the existing drop tables.
