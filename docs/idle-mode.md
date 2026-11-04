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
| `levelUpPopups` | `false`: an idle or idle-combat skill's level-up pop-up does not hold the work until Continue (the message, graphic and sounds stay). | `level-up:interrupts` (emitted by `SkillLevelUp.plugin.js`) |

## Offline progress

`server/plugins/modes/idle/Offline.IdleMode.js`. While an idle account works, the plugin
measures the rate it really gets from its own results: each idle gather (`storage:gather`) and
each idle kill (Combat) records the items and the activity's skills' XP. Nothing is estimated
from formulas, so tools, levels, boosts and relics all count as they did in play.

- **A session** starts on the first result. Another activity (another gathering skill, or
  combat), or more than `maxGapSeconds` between two results, starts a new one.
- **Logging out** mid-session (the last result no more than `maxGapSeconds` before) with at
  least `minSampleSeconds` measured saves the session as `idle-mode:away`:
  `{ activity, durationMs, xp: { skill: xp }, items, loggedOutAt }`; `activity` is the gathering
  skill (`"WOODCUTTING"`) or `"COMBAT"`.
- **Logging back in** pays the time away at that rate: the XP to the skills (the world's XP rate
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

## Auto-resume

`server/plugins/modes/idle/Auto.IdleMode.js`. The character goes back to work by itself:

- **The target** is the last object or NPC option an idle player clicked (seen through
  `onBeforeObjectInteraction` / `onBeforeNpcInteraction`) that led to an idle skill's gather
  within `rememberClickSeconds`: its name, the option, and where the player stood (the anchor).
  It's saved as `idle-mode:auto-target` `{ skill, kind, name, option, anchor }`, so it survives
  logging out. Gathering the same kind of thing nearby keeps the anchor; anything else replaces it.
- **Every `tickInterval` ticks**, for each idle player with a target: when nothing has been
  gathered for `restartAfterSeconds` (and nothing was tried for `retrySeconds`), the character
  walks to the nearest object or NPC with that name and option within `searchTiles` of the anchor
  and uses the option, as the player's click would. Nothing in reach (a rock respawning) waits.
- **It leaves the player be** while they are busy (an interface open, a teleport), moving, in
  combat, on another floor, or more than `leashTiles` from the anchor. Walking off to do something
  else pauses it; coming back resumes it.

```
::idle auto        what it will resume
::idle auto off    stop resuming (saved as idle-mode:auto)
::idle auto on     resume again
```

| Setting (`"auto"`) | Default |
| --- | --- |
| `enabled` | `true` |
| `tickInterval` | `2` |
| `restartAfterSeconds` | `12` |
| `retrySeconds` | `6` |
| `rememberClickSeconds` | `30` |
| `searchTiles` | `16` |
| `leashTiles` | `24` |

## Idle combat

`server/plugins/modes/idle/Combat.IdleMode.js`. Fighting works the same way as gathering:

- **The target**: an idle player who attacks a monster (`onNpcAttackOption`) and kills it within
  `rememberAttackSeconds` makes that monster's name the target, with where they stood. Saved as
  `idle-mode:combat-target` `{ name, anchor }`. One activity at a time: a kill replaces the
  gathering target and a gather replaces this one.
- **Every `tickInterval` ticks**, with auto-resume on (`::idle auto`):
  - below `eatBelowPercent` hitpoints it eats the first item with an "Eat" option, as a click
    would. Below `stopBelowPercent` with no food it waits, and says so once;
  - attacked while not attacking, it fights back;
  - otherwise, free and within `leashTiles` of the place, it attacks the nearest monster of that
    name within `searchTiles` that it may attack (`CombatFactory.canAttackPermission`) and no
    other player is fighting.
- **Loot**: a kill of the target (or of a monster just chosen) banks its drops
  (`npc-drops:generated`); what the bank can't take stays on the ground. A monster that came at a
  gathering player changes nothing.
- **Offline**: each such kill is recorded with the combat skills' XP (`"skills"`) and its loot.
  Offline fights eat no food: the measured rate is paid as it is.
- **Points**: with `pointsFromXp`, combat XP earns idle points too.

| Setting (`"combat"`) | Default |
| --- | --- |
| `enabled` | `true` |
| `skills` | Attack, Strength, Defence, Ranged, Magic, Hitpoints |
| `bankLoot` | `true` |
| `pointsFromXp` | `true` |
| `tickInterval` | `2` |
| `retrySeconds` | `3` |
| `rememberAttackSeconds` | `120` |
| `searchTiles` | `12` |
| `leashTiles` | `20` |
| `eatBelowPercent` | `50` |
| `stopBelowPercent` | `25` |

## Points and upgrades

`server/plugins/modes/idle/Progression.IdleMode.js`. An idle account earns an **idle point** per
`xpPerPoint` (250) XP in the idle skills, online and offline (the offline XP lands through the
same `onExperienceGained` hook). Saved as `idle-mode:points`, with the XP toward the next point in
`idle-mode:point-progress`.

```
::idle points            your points
::idle shop              the upgrades, their levels and the next level's price
::idle buy <upgrade>     buy the next level
```

Bought levels are saved as `idle-mode:upgrades` `{ upgrade: level }`.

| Upgrade | Each level | Costs | Hook |
| --- | --- | --- | --- |
| `quick-hands` (Quick Hands) | A 10% chance a chop, mine or catch roll comes a tick sooner (never under one tick). | 100, 250, 500, 1000, 2000 | `skills:action-interval` (kinds `chop`, `mine`), `fishing:interval` |
| `long-dreams` (Long Dreams) | 3 more hours of offline progress. | 150, 400, 900, 2000 | the offline cap |
| `bountiful-harvest` (Bountiful Harvest) | A 4% chance of an extra resource to the bank, without XP. Offline, the same expected share is added to the items. | 200, 500, 1000, 2000, 4000 | `storage:gather`, the offline items |

The prices and effects are in `"progression"` in the data. Quick Hands' speed shows in the rate
the offline progress measures, so it counts offline as well.

## Roadmap

1. Endless gathering - done.
2. Offline progress - done.
3. Auto-resume - done. Next: picking an activity from a list and travelling there (built on the
   player bots' long routes in `server/plugins/bots/`).
4. Idle points and upgrades - done (chat commands; an interface of its own comes later).
5. Idle combat - done.
6. Next ideas: travelling to a chosen activity, an Idle interface (points, upgrades, the time
   away), more skills (cooking, smithing, fletching: production loops), and idle bosses.
