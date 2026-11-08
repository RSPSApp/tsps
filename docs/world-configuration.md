# World configuration

World settings live in `server/data/definitions/world.json`. A deployment can override them in
`server/data/definitions/world.local.json`; ordinary top-level values in the local file
replace the shipped values, while `plugins` entries merge by key.

## World config page

**Early version (v0.1).** This is a basic framework that does the basics: list the settings, edit
them, save through the update countdown, and restart. Expect rough edges, glitches and missing
pieces. It is meant to be built on by others, for example:

- more plugins describing their options and a one-line `description`;
- more control types;
- applying changes live, without a restart.

To make a plugin's options appear on the page, declare them in a `config` object on the plugin
module, keyed by the full `pluginConfig` key, and add a `description` (see
`server/plugins/skills/Prayer.plugin.js` for an example). The completeness test fails when a
plugin reads a `pluginConfig` key it does not declare.

Most of the settings below can be changed from a page the server serves itself, so you do not
have to find them in these docs: every world value, plugin switch and plugin option is listed by
area with its default and a short explanation, and saving writes `world.local.json` (never
`world.json`).

- **Open it:** the server prints a link at startup (`http://localhost:<port>/?token=...`). The port
  is `WORLD_ADMIN_PORT` (default `49600`; a worktree made with `scripts/wt` gets `49600` plus its
  slot). The listener is bound to `127.0.0.1`, so it is not reachable from other machines.
- **On a VPS:** tunnel the port and open the link locally:
  `ssh -L 49600:127.0.0.1:49600 <host>`.
- **Saving:** the page previews the change to `world.local.json`, then runs the in-game update
  countdown for online players, writes the file and restarts the server. In dev (nodemon) the
  server restarts by itself. Under a supervisor (systemd, pm2, docker) set `TSPS_SUPERVISED=1`
  and the server exits with code `75` so the supervisor restarts it. Otherwise the page offers
  save-only; restart the server by hand for it to take effect.
- **The link:** the token is kept in `server/data/definitions/world-admin.token` and stays valid
  across restarts. Delete that file to get a new one.
- **Remote access:** set `WORLD_ADMIN_TOKEN` to choose your own token instead; only then does
  `WORLD_ADMIN_BIND` open the listener to other machines.
- **Spawn map:** the spawn point picker shows OSRS Wiki map tiles, which your browser fetches
  only while the map is open. Nothing else on the page makes an external request.

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

## Skilling pet rates

`pluginConfig` `"Pets:skillingPetMultiplier"` makes every skilling pet roll that many times likelier.
`1` (or leaving it out) is the OSRS rate: 1 in (base - level x 25) per action, fifteen times as
likely at 200M XP. At `10` a 1/5,000 roll is 1/500; a roll never gets better than 1/1. It covers
every skill's pet (Rift Guardian and the chinchompa colours included), not boss or minigame pets.

```json
{
  "pluginConfig": { "Pets:skillingPetMultiplier": 10 }
}
```

## Cross-floor visibility and combat

Set `pluginConfig` `"CrossFloor:visibility"` to sync nearby players, NPCs, ground items and
temporary objects on your floor and lower floors. Floors above you remain hidden. This also
activates lower-floor NPC spawns and permits Telekinetic Grab on a lower floor. It defaults to
`false`.

Set `"CrossFloor:combat"` to allow ranged and magic attacks between floors; melee stays on the
same floor. Combat is a child of visibility, so it only works when `"CrossFloor:visibility"` is
`true`. Attacks can go in both floor directions, but a lower-floor player does not see a higher-floor
attacker or their projectiles. Combat also defaults to `false`.

The host exposes these under **Settings → Technical**, with combat nested below visibility.
Restart the world after changing them.

```json
{
  "pluginConfig": {
    "CrossFloor:visibility": true,
    "CrossFloor:combat": false
  }
}
```

Explicit boolean values override the older `CROSS_FLOOR_VISIBILITY`, `CROSS_FLOOR_COMBAT` and
`CROSS_FLOOR_VISIBILITY_AND_COMBAT` environment flags. Those flags remain fallbacks for existing
setups, but combat now always requires visibility, including when using the old flags.

## Welcome screen message

`pluginConfig` `"WelcomeScreen:messageOfTheWeek"` is the text on the scroll at the bottom of
the welcome screen. It defaults to `Welcome to <name>!`, using the world name below. The text can use the game's
`<col=rrggbb>` and `<br>` tags. League worlds show their own league message instead.

```json
{
  "pluginConfig": { "WelcomeScreen:messageOfTheWeek": "Double XP this weekend!<br>Have fun." }
}
```

## World name

`"name"` is the world's display name (default `Old School RuneScape`): the login screen, World
list, welcome messages and bank title use it. It is plain text of 1 to 64 characters, without
`<` or `>`.

```json
{ "name": "My World" }
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

### Settings reference

Generated from the plugins' own declarations and the shipped `world.json`; do not edit by hand.
After changing a plugin's `description` or `config`, run `yarn --cwd server world-config-docs`
(a test fails while this block is stale).

<!-- world-config:generated:start -->
### Options

#### World settings (top-level keys)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `description` | string | `""` | **Description.** Short blurb shown with the world, at most 120 characters. |
| `experienceMultiplier` | number (> 0) | `1` | **Experience rate.** Global experience rate for all skills. 1 is the normal rate; 5 gives five times the experience. |
| `gameframe` | enum: `modern-resizable` (modern-resizable), `modern-fixed` (modern-fixed), `317-resizable` (317-resizable), `317-fixed` (317-fixed) | *Client default* | **Game frame.** Interface layout the web client uses for this world. |
| `membersWorld` | boolean | `true` | **Members world.** When off, members-only content is not loaded and the spawn must sit inside a zone tagged "f2p". |
| `name` | string | `"Old School RuneScape"` | **World name.** Shown on the world list. Plain text, 1 to 64 characters. |
| `spawn` | json | *Required: set in world.json* | **Spawn point.** Where new and stranded players appear, as { "x": 3222, "y": 3218, "z": 0 }. |

#### Core (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `CrossFloor:combat` | boolean | *Off unless CROSS_FLOOR_COMBAT is set* | **Cross-floor combat.** Ranged and magic attacks work between floors. Needs cross-floor visibility. |
| `CrossFloor:visibility` | boolean | *Off unless CROSS_FLOOR_VISIBILITY is set* | **Cross-floor visibility.** Players see others on other floors of the same area. |
| `commands:permissions` | json | `{}` | **Command permissions.** Lowest rank that may run each command, e.g. { "items": "NONE", "teleports": "OWNER" }. Ranks: NONE, MODERATOR, ADMINISTRATOR, OWNER, DEVELOPER. |

#### Plugin area `accounts` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `characters:maxPerAccount` | number (integer, >= 1, <= 6) | `6` | **Characters per account.** How many characters one account may hold, 1 to 6. At 1 the picker is skipped. Worlds hosted in a browser without account saving always use 1. |

#### Plugin area `areas` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `TutorialIsland:allowSkip` | boolean | `true` | **Allow skipping Tutorial Island.** The Gielinor Guide offers new players to skip the island, which misses some starter items and steps. Turn off to make everyone complete it. |

#### Plugin area `bosses` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `WildernessBosses:requireDiary` | boolean | `true` | **Wilderness boss lairs need the diary.** As on the Wiki, each lair needs the medium Wilderness Diary or a Slayer task for that boss. Turn off to let anyone in. |

#### Plugin area `bots` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `PlayerBots:activeRegionBotsByRegion` | json | *Shipped value in bot-sites.json* | **Wilderness bots per map square.** Target number of bots in individual 64x64 map squares, keyed plane:regionX:regionY with whole-number counts. Replaces pvp.activeRegionBotsByRegion in bot-sites.json. |
| `PlayerBots:ai` | json | *AI bots off (3 bots when enabled)* | **AI bots.** Settings for bots that chat through an AI model, merged over the shipped defaults, e.g. { "enabled": true, "count": 3, "places": ["lumbridge"] }. Also takes names, disclose, providers and gifts; API keys come from the server environment, never here. |
| `PlayerBots:sites` | json | *No overrides: the shipped bot-sites.json applies* | **Bot site overrides.** Maps a bot site id to the properties to change for it, e.g. { "some_site": { "enabled": false } }. Sites not named keep their shipped properties; a world.local.json value replaces the world.json one as a whole. |

#### Plugin area `commands` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `DisplayName:cooldownDays` | number (>= 0) | `28` | **Display name change cooldown (days).** Days a player waits between display name changes. 0 lets them change at any time. |
| `DisplayName:holdDays` | number (>= 0) | `35` | **Old display name hold (days).** Days a name a player gave up stays held for its old owner. |

#### Plugin area `interface` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `GrandExchange:maxTradeDelay` | number (integer, >= 5000, <= 2147483647) | `3600000` | **Longest offer wait (ms).** Upper limit, in milliseconds, on how long an offer takes to complete. Applies to newly placed offers. |
| `SkillLevelUp:interruptActions` | boolean | `true` | **Level-ups interrupt actions.** Follows each player's pop-up preference. Turn off to keep skilling and fighting through level-ups: the blocking pop-ups are skipped, chat messages, sounds and graphics stay. |
| `WelcomeScreen:messageOfTheWeek` | string | *Welcome to <world name>!* | **Message of the week.** Text on the scroll at the bottom of the welcome screen. Takes <col=rrggbb> and <br> tags. League worlds show their own message instead. |

#### Plugin area `minigames` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `CastleWars:seedBots` | boolean | `false` | **Seed Castle Wars with bots.** Development aid: fills the lobby with bots. Leave off so production lobbies are players only. |
| `DuelArena:pvpArenaWorld` | boolean | `false` | **PvP Arena world.** Makes this a PvP Arena world: Challenge in the Emir's Arena always starts an unranked duel, with no Legacy Duel choice. |
| `LastManStanding:highStakes` | boolean | `false` | **High Stakes mode.** Opens the High Stakes mode, which costs 500,000 from the coffer to start. Closed when off. |
| `LastManStanding:minPlayers` | number (integer, >= 1) | *The mode's own minimum (24 for the competitive modes)* | **Players needed to start.** Lowest number of players a game needs. Cannot go above the mode's own minimum. |
| `LastManStanding:seedBots` | boolean | `true` | **Seed Last Man Standing with bots.** Fills lobbies with bots that fight on the PvP brain. Turn off for players only. |
| `SoulWars:minPlayers` | number (integer, >= 2) | *20, as on the Wiki* | **Players needed to start.** Lowest number of players a game needs. Never under 2, since both teams need a player. |
| `SoulWars:seedBots` | boolean | `false` | **Seed Soul Wars with bots.** Development aid: fills the lobby with bots. Leave off so production lobbies are players only. |

#### Plugin area `modes` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `league:end` | date | *Not set* | **League end date.** When the league ends, as YYYY-MM-DD. The welcome message then shows how many days remain. |
| `league:start` | date | *Not set* | **League start date.** When the league began, as YYYY-MM-DD. Sets the client's league clock. |
| `league:type` | enum: `0` (Not a league world), `1` (Leagues I - Twisted), `2` (Leagues II - Trailblazer), `3` (Leagues III - Shattered Relics), `4` (Leagues IV - Trailblazer Reloaded), `5` (Leagues V - Raging Echoes), `6` (Leagues VI - Demonic Pacts) | `0` | **League.** Runs this world as a league: every login is the account's league character, kept apart from its main save. Not a league world is a normal world. The list follows data/leagues.json. Also read by LeagueAreaUnlocks. Restart to change. |

#### Plugin area `npcs` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `NpcDrops:bossRareMultiplier` | number (>= 1) | `1` | **Boss unique drop multiplier.** Makes bosses' unique drops this many times likelier. 1 is the normal rate; values of 1 or less change nothing. |
| `Pets:skillingPetMultiplier` | number (>= 1) | `1` | **Skilling pet multiplier.** Makes every skilling pet roll this many times likelier. 1 is the normal rate; values of 1 or less change nothing. |
| `random-events:enabled` | boolean | `true` | **Random events.** Turn off to stop random events from appearing. |

#### Plugin area `quests` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `quests:equipment-requirements` | boolean | `true` | **Quest equipment requirements.** Items tied to a quest cannot be worn until it is finished. Turn off to remove the restriction. Player bots are never held to it. |

#### Plugin area `skills` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `Prayer:sequentialBurying` | boolean | `false` | **Bury all bones with one click.** By default Bury buries one bone per click, as in OSRS. On, one click continues through the eligible unnoted bones in the inventory. |
| `ShootingStars:announce` | boolean | `false` | **Announce landings.** Tells everyone online where a star landed. Useful on small worlds; OSRS has no such message. |
| `ShootingStars:intervalMinutes` | number (> 0) | *90* | **Minutes between shooting stars.** Time between stars; a random 15 minutes either way is added on top. |

#### Plugin area `world` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `Gravestones:enabled` | boolean | `true` | **Gravestones.** Player deaths in PvM leave a gravestone. Turn off for the older behaviour where lost items drop where the player died. |

### Plugin switches

Only plugins that have a description are listed here; the world config page's Plugins tab lists all of them. The switch key is what goes in `plugins` (matched ignoring case and spaces).

| Switch key | Plugin | Area | On by default | Effect |
| --- | --- | --- | --- | --- |
| `Characters` | Characters | accounts | no | Lets one account hold several characters and choose between them at login. Off unless the world turns it on. |
| `TutorialIsland` | TutorialIsland | areas | yes | The Tutorial Island onboarding for new players: guided steps, starter items and the route to Lumbridge. |
| `CustomCharacterSummary` | CustomCharacterSummary | interface | no | Our own Character Summary tab for the side journal. Off unless the world turns it on; needs SideJournalDefaults. |
| `DuelStaking` | DuelStaking | interface | yes | Adds the staking interface and item stakes to duels. The Duel Arena itself is a separate plugin. |
| `FreezeTimer` | Freeze Timer | interface | yes | Sends the remaining freeze time and spell for the client's freeze-timer overlay. |
| `FriendsList` | FriendsList | interface | yes | Friends list and friends chat: private messages, chat filters and friends-chat channels. |
| `GrandExchange` | GrandExchange | interface | yes | The Grand Exchange: offers, offer collection and the item-price resource it uses. |
| `IgnoreList` | IgnoreList | interface | yes | Reserved for the ignore list. Nothing is attached yet because the client does not send add or remove actions. |
| `SideJournalDefaults` | SideJournalDefaults | interface | yes | The side journal's tabs and the custom Character Summary, with buttons that follow each player's commands. |
| `VengeanceTimer` | Vengeance Timer | interface | yes | Keeps the client's 30-second Vengeance cooldown overlay in sync with the player's cooldown. |
| `VoiceChat` | VoiceChat | interface | no | Proximity voice chat: signalling between nearby players on the same plane and private area. Voice also needs client support and browser microphone permission. |
| `WorldAdmin` | WorldAdmin | tools | yes | Local web page for editing world.json settings and plugin switches. |
<!-- world-config:generated:end -->

These switches control whether a plugin is loaded; they are distinct from `pluginConfig`, which
sets plugin-specific options such as `TutorialIsland:allowSkip`.

Character Summary checks the registered `teleports`, `presets`, `commands`, and `lockxp`
commands for its Teleports, Presets, Commands, and Combat XP controls. Their usual providers
are `TeleportInterface`, `PvpMode`, `Commands`, and `PlayerCommands`. Disabling a provider
through the host's plugin switches hides its button when the world loads that configuration.
The summary also refreshes command access while open and rejects clicks on unavailable controls.
Its layout and behavior live under `plugins/interface/sidejournaldefaults/`; it does not
require the optional PvP statistics plugin to display.

## PvP Arena worlds

Ranked 1v1 Duels (the Grouping tab's PvP Arena button, `duelarena/Matchmaking.DuelArena.js`) run on
every world. Players sign up to the Official 1v1 Duels group, are invited in pairs by closest rank,
meet in a staging area upstairs in the Emir's Arena hospital, and fight with the week's build. Rank
starts at 2,500 and moves by Elo (K 50: 25 between equal ranks).

`"pluginConfig": { "DuelArena:pvpArenaWorld": true }` in `world.local.json` (default off) makes a world
a PvP Arena world: Challenge there always starts an unranked duel, with no choice of a Legacy Duel.

Unranked duels are on every world. In the Emir's Arena, player option 1 is Challenge and 4 is
Load-outs. On a normal world, Challenge first asks whether the duel is an Unranked Duel or a Legacy
Duel. On a PvP Arena world, Challenge goes straight to an unranked duel. The fight uses the player's
main character: their items, stats and spellbook are set aside for the fight and come back when
they leave the arena (`duelarena/Stash.DuelArena.js`). A save taken mid-fight (a periodic save,
a crash) writes their own character standing in the Emir's Arena, never the arena's gear, so a
world sharing saves with this one is safe with `DuelArena` turned off.
