# World configuration

World settings live in `server/data/definitions/world.json`. A deployment can override them in
`server/data/definitions/world.local.json`; ordinary top-level values in the local file
replace the shipped values, while `plugins` entries merge by key.

## Experience multiplier

`experienceMultiplier` sets the global experience rate for all skills. `1` is the normal rate;
`2` awards twice as much experience, and `5` awards five times as much. It must be a positive
number.

```json
{
  "experienceMultiplier": 5
}
```

## Boss drop rates

`pluginConfig` `"NpcDrops:bossRareMultiplier"` makes bosses' unique drops that many times likelier.
`1` (or leaving it out) is the OSRS rate; at `2` a 1/512 unique is 1/256, at `3` 1/171, at `5`
1/102. Eligible items are rarer than 1/10 and either listed in a unique section or in the cache's
boss collection log (including rings, pets, jars and visages). Rarity alone does not qualify:
ordinary supplies, equipment, clue scrolls and shared drop tables keep their rates.
The Collection Log plugin does not need to be enabled. Ordinary loot keeps its rate:
on the weighted main roll the boosted rows are rolled separately instead of taking chance from
the rest of the table, so a very high multiplier can drop a rare alongside the main roll. Bosses
are the NPCs the game cache marks as bosses, plus the few `npc-drop-overrides.json` lists
because the cache omits their marker. Raid chests (Chambers of Xeric, Theatre of Blood, Tombs of
Amascut) and other reward chests are not affected.

```json
{
  "pluginConfig": { "NpcDrops:bossRareMultiplier": 2 }
}
```

## Welcome screen message

`pluginConfig` `"WelcomeScreen:messageOfTheWeek"` is the text on the scroll at the bottom of
the welcome screen. It defaults to `Welcome to Old School RuneScape!`. The text can use the game's
`<col=rrggbb>` and `<br>` tags. League worlds show their own league message instead.

```json
{
  "pluginConfig": { "WelcomeScreen:messageOfTheWeek": "Double XP this weekend!<br>Have fun." }
}
```

## Display names

`pluginConfig` `"DisplayName:cooldownDays"` is how many days a player waits between
[display name](display-names.md) changes (default `28`; `0` lets them change at any time).
`"DisplayName:holdDays"` is how long a name given up stays held for its old owner (default `35`).

```json
{
  "pluginConfig": { "DisplayName:cooldownDays": 7, "DisplayName:holdDays": 14 }
}
```

## Spawn point

`spawn` sets the world tile where players start when they connect. The same location is used
as the default respawn point. Set `x` and `y` to the tile coordinates and `z` to the plane
(`0` is the ground level).

Lumbridge example:

```json
{
  "spawn": { "x": 3222, "y": 3218, "z": 0 }
}
```

Edgeville example:

```json
{
  "spawn": { "x": 3089, "y": 3502, "z": 0 }
}
```

## Plugin switches

The `plugins` object enables or disables individual server plugins. Set a switch to `true` to
enable that plugin for the world, or `false` to disable it. A plugin not listed uses its own
default.

```json
{
  "plugins": {
    "GrandExchange": true,
    "DuelStaking": true
  }
}
```

### Available switches

| Plugin key | Effect |
| --- | --- |
| `TutorialIsland` | Enables the Tutorial Island onboarding, including its guided steps, starter items, and route to Lumbridge. The tutorial's skip offer is separately controlled by `pluginConfig`: set `"TutorialIsland:allowSkip": false` to disable skipping. |
| `VoiceChat` | Enables proximity voice-chat signalling between nearby players on the same plane and in the same private area. Voice audio also requires client voice-chat support and browser media permissions. |
| `DuelStaking` | Adds the staking interface and item stakes to duels. The Duel Arena itself is a separate plugin; this switch only enables staking. |
| `FreezeTimer` | Sends the remaining freeze duration and spell information used by the client's freeze-timer overlay. |
| `FriendsList` | Enables friends-list and friends-chat handling, including private messages, chat filters, and friends-chat channels. |
| `GrandExchange` | Enables Grand Exchange offers, offer collection, and the item-price resource used by the exchange. |
| `IgnoreList` | No active feature is currently attached to this plugin. The client protocol does not yet send ignore-list add/remove actions, so enabling this switch alone does not make those controls work. |
| `VengeanceTimer` | Keeps the client's 30-second Vengeance cooldown overlay in sync with the player's active cooldown. |

These switches control whether a plugin is loaded; they are distinct from `pluginConfig`, which
sets plugin-specific options such as `TutorialIsland:allowSkip`.
