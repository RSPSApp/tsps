# World configuration

World settings live in `server/data/definitions/world.json`. A deployment can override them in
`server/data/definitions/world.local.json`; ordinary top-level values in the local file
replace the shipped values, while `plugins` entries merge by key.

## Plugin settings

Worlds start in members mode. Set `"FreeToPlay": true` in `plugins` to run a free-to-play
world. Its spawn must be inside a zone tagged `f2p`. The old `membersWorld` setting is ignored.

A `plugins` entry accepts a boolean or an object. A setting alone keeps the plugin's default
enabled state. The `enabled` field, when present, must be a boolean.

```json
{
  "plugins": {
    "BountyHunter": { "levelDifference": 10 },
    "Characters": { "maxPerAccount": 6 },
    "Prayer": { "enabled": true, "sequentialBurying": true },
    "PlayerBots": { "ai": { "enabled": false } },
    "Wilderness": { "pvpWorldLevelDifference": 10 }
  }
}
```

Use the plugin's exported name with its exact casing. When a plugin loads, the server warns about
scoped options that have no matching declaration. Within each file, scoped settings override
the equivalent `pluginConfig` keys. Then the local file overrides the shipped file. This merges the
individual switches and settings, with nested values replaced in full. For example, a local
`"Prayer": false` disables the plugin and keeps its shipped settings. Plugins can read
their options by short name, such as `api.getPluginConfig("sequentialBurying", false)`.

On PvP worlds, `plugins.Wilderness.pvpWorldLevelDifference` sets the server's attack limit
on unlevelled ground. The client overlay still displays the standard 15-level range there.

The existing `pluginConfig` form still works. The Characters, LeagueMode, Quests and
RandomEvents entries map to the existing `characters`, `league`, `quests` and `random-events`
namespaces. Shared league readers keep using `league:*`. Core settings such as
`commands:permissions` stay in `pluginConfig`.
Settings literally named `enabled`, such as `Gravestones:enabled`, also stay there so they
remain distinct from the plugin switch. A legacy `disabledPlugins` list still takes priority
over the switches. The world config page saves its editable layer in the equivalent flat
format for compatibility.

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

- **Open it:** open `http://localhost:<port>/?token=<token>`, with the token from
  `server/data/definitions/world-admin.token` (or your `WORLD_ADMIN_TOKEN`); the server log
  shows the URL and where the token is, never the token itself. The port
  is `WORLD_ADMIN_PORT` (default `49600`; a worktree made with `scripts/wt` gets `49600` plus its
  slot). The listener is bound to `127.0.0.1`, so it is not reachable from other machines.
- **On a VPS:** tunnel the port and open that URL locally:
  `ssh -L 49600:127.0.0.1:49600 <host>`.
- **Saving:** the page previews the change to `world.local.json`, then runs the in-game update
  countdown for online players, writes the file and restarts the server. In dev (nodemon) the
  server restarts by itself. Under a supervisor (systemd, pm2, docker) set `TSPS_SUPERVISED=1`
  and the server exits with code `75` so the supervisor restarts it. Otherwise the page offers
  save-only; restart the server by hand for it to take effect.
- **The link:** the token is kept in `server/data/definitions/world-admin.token` and stays valid
  across restarts. Delete that file to get a new one.
- **Remote access:** set `WORLD_ADMIN_TOKEN` to choose your own token instead; only then does
  `WORLD_ADMIN_BIND` open the listener to other machines, and only when the token is at least 24
  characters of `A-Z a-z 0-9 _ -`. Otherwise the server logs why and stays on `127.0.0.1`.
- **Spawn map:** the spawn point picker shows OSRS Wiki map tiles, which your browser fetches
  only while the map is open. Nothing else on the page makes an external request.

## Experience multiplier

`experienceMultiplier` sets the global experience rate for all skills. `1` is the normal rate;
`2` awards twice as much experience, and `5` awards five times as much. It must be a positive
number. It applies to every gain, reward XP included (lamps, tomes, the Book of Knowledge, quest
and minigame rewards), as a league's own rate does on live; the message still shows the base
amount. Only a league relic's bonus XP (Equilibrium, Barbarian Gathering) is added without it.

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

Enable the `CrossFloor` plugin to sync nearby players, NPCs, ground items and temporary
objects on your floor and lower floors. It also activates lower-floor NPC spawns and permits
Telekinetic Grab on lower floors.

Set the plugin's `combat` option to allow ranged and magic attacks between floors. Attacks
can go in both floor directions. Visibility is limited to your floor and lower floors,
including for projectiles. Melee remains on the same floor. Restart after changing the
plugin switch or combat option.

```json
{
  "plugins": {
    "CrossFloor": { "enabled": true, "combat": false }
  }
}
```

Older worlds can still use `pluginConfig` keys `CrossFloor:visibility` and `CrossFloor:combat`.
An explicit plugin switch takes precedence over legacy visibility in the same file.
`world.local.json` can override either form. The older `CROSS_FLOOR_VISIBILITY`,
`CROSS_FLOOR_COMBAT` and `CROSS_FLOOR_VISIBILITY_AND_COMBAT` environment flags remain
fallbacks. Both features default off with no configuration or environment flags.

## Hardcore World

`pluginConfig` `"HardcoreWorld:enabled": true` makes the server a Hardcore World: every login is
the account's Hardcore character, a save of its own, with one life. A death that counts is
announced to the world, and the character then resets or transfers out. The world list and the
client are told it is a Hardcore world. See [hardcore-worlds.md](hardcore-worlds.md).

```json
{
  "pluginConfig": { "HardcoreWorld:enabled": true }
}
```

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
| `name` | string | `"Old School RuneScape"` | **World name.** Shown on the world list. Plain text, 1 to 64 characters. |
| `spawn` | json | *Required: set in world.json* | **Spawn point.** Where new and stranded players appear, as { "x": 3222, "y": 3218, "z": 0 }. |

#### Core (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `commands:permissions` | json | `{}` | **Command permissions.** Lowest rank that may run each command, e.g. { "items": "NONE", "teleports": "OWNER" }. Ranks: NONE, MODERATOR, ADMINISTRATOR, OWNER, DEVELOPER. |

#### Plugin area `accounts` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `characters:maxPerAccount` | number (integer, >= 1, <= 6) | `6` | **Characters per account.** How many characters one account may hold, 1 to 6. At 1 the picker is skipped. Worlds hosted in a browser without account saving always use 1. |

#### Plugin area `areas` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `TutorialIsland:allowSkip` | boolean | `true` | **Allow skipping Tutorial Island.** The Gielinor Guide offers new players to skip the island, which misses some starter items and steps. Turn off to make everyone complete it. |
| `Wilderness:pvpWorldLevelDifference` | number (integer, >= 0) | `15` | **Unlevelled PvP combat level difference.** Maximum combat level difference on unlevelled PvP ground on PvP worlds. Levelled Wilderness tiles keep their usual range. |

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
| `DisplayName:sessionMinutes` | number (>= 1) | `10` | **Name changer session (minutes).** How long a Name Changer session lasts after Look up names, before it has to be started again. |

#### Plugin area `interface` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `GrandExchange:maxTradeDelay` | number (integer, >= 5000, <= 2147483647) | `3600000` | **Longest offer wait (ms).** Upper limit, in milliseconds, on how long an offer takes to complete. Applies to newly placed offers. |
| `SkillLevelUp:interruptActions` | boolean | `true` | **Level-ups interrupt actions.** Follows each player's pop-up preference. Turn off to keep skilling and fighting through level-ups: the blocking pop-ups are skipped, chat messages, sounds and graphics stay. |
| `WelcomeScreen:messageOfTheWeek` | string | *Welcome to <world name>!* | **Message of the week.** Text on the scroll at the bottom of the welcome screen. Takes <col=rrggbb> and <br> tags. League worlds show their own message instead. |

#### Plugin area `minigames` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `BountyHunter:levelDifference` | number (integer, >= 0) | `5` | **Rogue combat level difference.** Maximum combat level difference for attacks on players who are not your assigned target. |
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
| `league:type` | enum: `0` (Not a league world), `1` (Leagues I - Twisted), `2` (Leagues II - Trailblazer), `3` (Leagues III - Shattered Relics), `4` (Leagues IV - Trailblazer Reloaded), `5` (Leagues V - Raging Echoes), `6` (Leagues VI - Demonic Pacts) | `0` | **League.** Runs this world as a league: every login is the account's league character, kept apart from its main save. Not a league world is a normal world. The list follows data/leagues.json. Restart to change. |

#### Plugin area `npcs` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `NpcDrops:bossRareMultiplier` | number (>= 1) | `1` | **Boss unique drop multiplier.** Makes bosses' unique drops this many times likelier. 1 is the normal rate; values of 1 or less change nothing. |
| `Pets:skillingPetMultiplier` | number (>= 1) | `1` | **Skilling pet multiplier.** Makes every skilling pet roll this many times likelier. 1 is the normal rate; values of 1 or less change nothing. |
| `random-events:enabled` | boolean | `true` | **Random events.** Turn off to stop random events from appearing. |

#### Plugin area `quests` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `quests:equipment-requirements` | boolean | `true` | **Quest equipment and spellbook requirements.** Require quest completion for equipment and spellbook access (including the Arceuus spells that need A Kingdom Divided and the Lunar spells that need Dream Mentor), and boss kills for ancient rings. Turn off to remove these restrictions. Player bots bypass equipment requirements. |

#### Plugin area `skills` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `Prayer:sequentialBurying` | boolean | `false` | **Bury all bones with one click.** By default Bury buries one bone per click, as in OSRS. On, one click continues through the eligible unnoted bones in the inventory. |
| `ShootingStars:announce` | boolean | `false` | **Announce landings.** Tells everyone online where a star landed. Useful on small worlds; OSRS has no such message. |
| `ShootingStars:intervalMinutes` | number (> 0) | *90* | **Minutes between shooting stars.** Time between stars; a random 15 minutes either way is added on top. |

#### Plugin area `world` (`pluginConfig`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `CrossFloor:combat` | boolean | *Off unless enabled by a legacy environment flag* | **Cross-floor combat.** Allows ranged and magic attacks between floors while CrossFloor is enabled. |
| `Gravestones:enabled` | boolean | `true` | **Gravestones.** Player deaths in PvM leave a gravestone. Turn off for the older behaviour where lost items drop where the player died. |

### Plugin switches

This table lists bundled plugins that have a description. The world config page also lists locally uploaded plugins. The switch key is what goes in `plugins` (matched ignoring case and spaces).

| Switch key | Plugin | Area | On by default | Effect |
| --- | --- | --- | --- | --- |
| `Characters` | Characters | accounts | no | Lets one account hold several characters and choose between them at login. Off unless the world turns it on. |
| `AchievementDiaries` | AchievementDiaries | achievements | yes | Achievement diaries: task lists, progress, tier reward claims and lamps, plus the ::diary command to inspect, complete or reset tiers. (members only) |
| `AdventurePaths` | AdventurePaths | achievements | yes | Adventure Paths with Adventurer Jon: the Combat and Gatherer paths, task claims, starter kits, the Combat voucher and the Lamp of the Gatherer. |
| `CollectionLog` | CollectionLog | achievements | yes | Collection log: records items obtained from drops and other sources, with the log and overview interfaces, new-item popups and a ::clog command. |
| `CombatAchievements` | CombatAchievements | achievements | yes | Combat Achievements: 655 tasks in six tiers with points, Ghommal's tier rewards, the five interfaces and boss kill counts. |
| `AgentMcp` | AgentMcp | agent | yes | Runs an MCP server that lets a tool such as Claude Code drive an online player for testing. Active only when AGENT_MCP=1 is set. |
| `AgilityPyramid` | AgilityPyramid | areas | yes | Moves the Agility Pyramid's sliding blocks on floors 1 and 3, which push players down a floor for 8 damage. The course itself is a separate plugin. (members only) |
| `AncientPyramidMummies` | Ancient Pyramid Mummies | areas | yes | Ancient Pyramid mummy transformations: fire spells and lit fire arrows set them alight, water spells douse them. (members only) |
| `BrimhavenDungeon` | BrimhavenDungeon | areas | yes | Brimhaven Dungeon access: Saniboch's entry fee, the dungeon entrance and the vines that need an axe to go deeper. (members only) |
| `Burthorpe` | Burthorpe | areas | yes | Animates the soldiers drilling, sparring and eating in Burthorpe's square, as captured. (members only) |
| `CatacombsOfKourend` | CatacombsOfKourend | areas | yes | Catacombs of Kourend access: King Rada's statue, the vine ladder back up, the corner vines and the surface holes they open, and bones restoring Prayer points while buried or crushed there. (members only) |
| `ChampionsGuild` | ChampionsGuild | areas | yes | Lets players into the Champions' Guild in Varrock only with 32 Quest Points, with the Guildmaster's refusal and greeting. |
| `ColossalWyrmAgility` | ColossalWyrmAgility | areas | yes | Colossal Wyrm Agility Course rewards: termites spawning on the course and scooped up, and Worm Tongue's Wares. (members only) |
| `CooksGuild` | CooksGuild | areas | yes | Guards the Cooks' Guild door in Varrock: 32 Cooking and a chef's hat, Cooking cape or Varrock armour, with the head chef's refusals. |
| `CraftingGuild` | CraftingGuild | areas | yes | Guards the Crafting Guild door (40 Crafting and a brown apron or cape) and limits its bank chest to the hard Falador diary or 99 Crafting. |
| `DeathsOffice` | DeathsOffice | areas | yes | Death's Office: the Death's Domain entrances, a private office per visit, Death's item retrieval for collapsed graves and Death's Coffer. |
| `DesertHeat` | DesertHeat | areas | yes | Kharidian Desert heat: a timer that hurts players outside the towns unless a waterskin, Desert amulet 4, circlet of water or choc-ice helps. (members only) |
| `DesertQuarry` | DesertQuarry | areas | yes | Desert Quarry's grinder and Drew: ground sandstone becomes buckets of sand that Drew sells for 50 coins each. (members only) |
| `DorgeshKaanLamps` | DorgeshKaanLamps | areas | yes | Dorgesh-Kaan's broken lamps: ten per player, fixed with a light orb for Firemaking and Crafting XP (52 of each needed). (members only) |
| `DorgeshuunGuides` | DorgeshuunGuides | areas | yes | Kazgar, Mistag and Dartog's guided travel through the Dorgeshuun tunnels. (members only) |
| `EdgevilleDungeon` | EdgevilleDungeon | areas | yes | Edgeville Dungeon's brass key door and its achievement diary tasks. |
| `FeroxEnclave` | FeroxEnclave | areas | yes | Ferox Enclave: its barriers and safe ground, the Pools of Refreshment and the Clan Wars free-for-all arena behind the white portal. |
| `ForthosDungeon` | ForthosDungeon | areas | yes | Forthos Dungeon's grubby gate: 57 Thieving unlocks it and hands the player across. (members only) |
| `FossilIslandUnderwater` | FossilIslandUnderwater | areas | yes | Fossil Island rowboats and the sea floor dive, with an oxygen bar that drowns players lacking a fishbowl helmet and diving apparatus. (members only) |
| `FossilStorage` | FossilStorage | areas | yes | Fossil Island Museum Camp's fossil storage crates and the cleaning bench that cleans unidentified fossils. (members only) |
| `GrandTree` | GrandTree | areas | yes | Opens and shuts the Grand Tree's front doors and walks the player through, as captured. (members only) |
| `KalphiteCave` | KalphiteCave | areas | yes | Makes the Kalphite Cave multi-combat and lets only players on a kalphite Slayer task attack its kalphites, with Buggie warning the rest off. (members only) |
| `Karamja` | Karamja | areas | yes | Karamja volcano access: the rocks, cave entrance and climbing rope between the surface and the TzHaar city. |
| `Keldagrim` | Keldagrim | areas | yes | Keldagrim access: the cave exit to Rellekka, the cave-to-city passage, the house stairs and the ferrymen across the river. (members only) |
| `McGruborsWood` | McGruborsWood | areas | yes | Keeps McGrubor's Wood's main gate locked, so the wood is entered by the loose railing or a fairy ring. |
| `MiningGuild` | MiningGuild | areas | yes | Mining Guild entry needs 60 Mining; its members' area gives an invisible +7 Mining level, halves rock respawn times and rolls unidentified minerals. |
| `Misthalin` | Misthalin | areas | yes | Misthalin area interactions: the Edgeville dungeon ladder and trapdoor, Varrock's manhole to the sewers and the Wizards' Tower basement. |
| `MorUiRek` | MorUiRek | areas | yes | Mor Ul Rek (the TzHaar city): its cave exit back to the Karamja volcano and its hot vent doors. (members only) |
| `MotherlodeMine` | MotherlodeMine | areas | yes | Motherlode Mine: mining pay-dirt, washing it in Prospector Percy's machine and collecting ore from the sack, with its HUD. (members only) |
| `MythsGuild` | MythsGuild | areas | yes | The Myths' Guild's statue down to its basement, and the guild dog's Pet. (members only) |
| `MythsGuildBarrier` | MythsGuildBarrier | areas | yes | The Myths' Guild magical barriers (bridge and basement) and the Lithkren Vault barriers: open after Dragon Slayer II. (members only) |
| `PortPhasmatysBarrier` | PortPhasmatysBarrier | areas | yes | Port Phasmatys energy barriers and Ghost guards: a 2 ecto-token toll before Ghosts Ahoy, free passage after. (members only) |
| `RangingGuild` | RangingGuild | areas | yes | Lets players through the Ranging Guild door only with 40 Ranged, the doorman turning others away. (members only) |
| `Rellekka` | Rellekka | areas | yes | Rellekka's tunnel entrance to Keldagrim's entrance cave. (members only) |
| `ResourceArea` | ResourceArea | areas | yes | Wilderness Resource Area gate: Mandrith's 6,000 coin entry fee, the gate swinging open and free exit from inside. (members only) |
| `RevenantCaves` | RevenantCaves | areas | yes | Revenant Caves entrances (100,000 coin fee), exits and teleport scroll, with the Wilderness rules applying inside. (members only) |
| `ShantayPass` | ShantayPass | areas | yes | Shantay Pass: the gate into the desert, Shantay and his pass, and his jail. |
| `SlayerTower` | SlayerTower | areas | yes | Slayer Tower's double-door entrance with its gargoyle statues, and the basement ladder with its dark overlay (lifted by a light source). (members only) |
| `StrongholdOfSecurity` | StrongholdOfSecurity | areas | yes | Stronghold of Security: its doors and security questions, ladders, portals, reward rooms and the skull sceptre. |
| `SulphurMine` | SulphurMine | areas | yes | Lovakengj sulphur mine's poison gas clouds, which hurt nearby players, less so with a breathing filter. (members only) |
| `TaverleyDungeon` | TaverleyDungeon | areas | yes | Taverley Dungeon's key doors, Velrak's dusty key and the suits of armour that come alive at the Cauldron of Thunder prison door. (members only) |
| `Trollheim` | Trollheim | areas | yes | Holds Trollheim's thrower trolls in place while they throw rocks at players passing below their ledge. (members only) |
| `TutorialIsland` | TutorialIsland | areas | yes | The Tutorial Island onboarding for new players: guided steps, starter items and the route to Lumbridge. |
| `WarriorsGuild` | WarriorsGuild | areas | yes | Warriors' Guild in Burthorpe: Ghommal's door, the token-earning rooms, token payouts and cyclopes dropping defenders. (members only) |
| `WerewolfAgility` | WerewolfAgility | areas | yes | Werewolf Agility surroundings: the Ring of Charos trapdoor and guard, the stick-throwing Agility Boss and the trainers' dialogue. (members only) |
| `WerewolfSkullball` | WerewolfSkullball | areas | yes | Werewolf Skullball minigame: kick a skullball through ten goals for Agility XP, with the Skullball Boss and a timed scoreboard. (members only) |
| `WhiteWolfMountain` | WhiteWolfMountain | areas | yes | The rock slide at the Ice Queen's Lair on White Wolf Mountain: Investigate, and Mine with a pickaxe and 50 Mining to clear it and walk through. (members only) |
| `Wilderness` | Wilderness | areas | yes | The Wilderness: PvP attack rules, the overlay, teleport limits and web slashing. |
| `WildernessGodWarsBoulder` | WildernessGodWarsBoulder | areas | yes | Lets players with 60 Strength move the boulder blocking the Wilderness God Wars Dungeon corridor, gaining 5.5 Strength XP going in. (members only) |
| `WildernessObelisks` | WildernessObelisks | areas | yes | The six Wilderness obelisks and the house obelisk: activating one teleports everyone on its pad (the house one, its user) to a random or chosen obelisk, with Set Destination after the hard diary. (members only) |
| `Wyrmscraig` | Wyrmscraig | areas | yes | The cave under Ardeaglais on Wyrmscraig, with its Fallen From Grace cliff state; its shortcuts and the Mad Angel are separate plugins. (members only) |
| `WyvernCave` | WyvernCave | areas | yes | Stops anyone without a Fossil Island wyvern Slayer task from attacking the wyverns in the northern Wyvern Cave, with Weve warning them off. (members only) |
| `AbyssalSire` | AbyssalSire | bosses | yes | The Abyssal Sire in the Abyssal Nexus: its chambers, lungs, tentacles and miasma fight, the kill, the Font of Consumption and the Overseer. (members only) |
| `AlchemicalHydra` | AlchemicalHydra | bosses | yes | The Alchemical Hydra in Karuulm Slayer Dungeon: its private chamber, four-phase fight with vents, poison, lightning and fire, and the kill. (members only) |
| `Amoxliatl` | Amoxliatl | bosses | yes | Amoxliatl beneath the Ruins of Tapoyauik: her door after The Heart of Darkness, a private chamber, the fight with unstable ice, and the kill. (members only) |
| `Araxxor` | Araxxor | bosses | yes | Araxxor in the Morytania spider lair: a solo instance with eggs, acid specials, the 25% enrage, a harvestable corpse and Combat Achievements. (members only) |
| `Brutus` | Brutus | bosses | yes | Brutus beyond the quest fight: Slayer experience, item messages, the Cow31337Killer message and Demonic Brutus's second phase. |
| `Cerberus` | Cerberus | bosses | yes | Cerberus in her lair: the winches, arenas and exits, the triple attack with souls and lava, and the kill. (members only) |
| `ChaosElemental` | ChaosElemental | bosses | yes | The Chaos Elemental's special attacks: discord, disarm and teleport. (members only) |
| `ChaosFanatic` | ChaosFanatic | bosses | yes | The Chaos Fanatic's attack mix of explosions, a disarming projectile and standard magic. (members only) |
| `CorporealBeast` | CorporealBeast | bosses | yes | The Corporeal Beast's lair under the Wilderness, the Beast, its dark energy core and the spirit shields made from its drops. |
| `CountDraynor` | CountDraynor | bosses | yes | Count Draynor's coffin fight: the coffin raises him, with regeneration, garlic weakness and his hit modifiers. |
| `CrazyArchaeologist` | CrazyArchaeologist | bosses | yes | The Crazy archaeologist's ranged and exploding-book attacks, with his shouted quotes and death lines. (members only) |
| `DagannothKings` | DagannothKings | bosses | yes | The Dagannoth Kings of Waterbirth Island Dungeon: the public and Slayer-task lairs, Prime's magic, Supreme's ranged, Rex's melee and the spinolyps. (members only) |
| `DerangedArchaeologist` | DerangedArchaeologist | bosses | yes | The Deranged archaeologist on Fossil Island: melee up close, ranged books at distance, and the 'Learn to Read!' exploding-book special. (members only) |
| `DoomOfMokhaiotl` | DoomOfMokhaiotl | bosses | yes | The Doom of Mokhaiotl: the ruins' entrance, the lobby and the delves. |
| `DukeSucellus` | Duke Sucellus | bosses | yes | Duke Sucellus: his site, the preparation, the kill records and the fight. (members only) |
| `Elvarg` | Elvarg | bosses | yes | Elvarg for Dragon Slayer: her lair, melee and dragonfire breath checked against antifire protection, and her kill state. |
| `GemstoneCrab` | GemstoneCrab | bosses | yes | The Gemstone Crab world boss in the Tlati Rainforest: a ten-minute timer that burrows between three mines and leaves a shell to mine for gems. (members only) |
| `GiantLairs` | GiantLairs | bosses | yes | Obor and Bryophyta: their key-locked lairs, fights, chests and giant bones. |
| `GiantMole` | GiantMole | bosses | yes | The Giant Mole in the Falador Mole Hole: melee only, burrowing to fixed resurface spots between 5% and 50% hitpoints. (members only) |
| `GodWars` | GodWars | bosses | yes | God Wars Dungeon: the dungeon and its essence, camp crossings, the generals' shared or private chambers, and the generals' and bodyguards' fights. (members only) |
| `GrotesqueGuardians` | GrotesqueGuardians | bosses | yes | Dusk and Dawn on the Slayer Tower roof: the key, bell and exit, the four-phase fight and the kill. (members only) |
| `Hueycoatl` | Hueycoatl | bosses | yes | The Hueycoatl in the Darkfrost, Varlamore: a public or private fight with five body segments, Rain Fire, pillars, the half-health shield and a final phase. (members only) |
| `KalphiteQueen` | KalphiteQueen | bosses | yes | The Kalphite Queen fight, run entirely from its encounter unit. (members only) |
| `KingBlackDragon` | KingBlackDragon | bosses | yes | The King Black Dragon: the Lava Maze ladder and lair lever, and the fight with dragonfire checked against antifire protection. (members only) |
| `Kraken` | Kraken | bosses | yes | The Kraken and cave krakens in Kraken Cove: disturb the whirlpool to surface them, four tentacles beside the boss, and Magic-only damage. (members only) |
| `Leviathan` | Leviathan | bosses | yes | The Leviathan: its site, the fight and the rewards. (members only) |
| `MadAngel` | MadAngel | bosses | yes | The Mad Angel in Ardeaglais on Wyrmscraig: the cathedral doors and pew, a private cathedral, the fight and the kill. (members only) |
| `MaggotKing` | MaggotKing | bosses | yes | The solo Maggot King lair, entered through Vampyrium's darkwood trees after The Blood Moon Rises. (members only) |
| `Mimic` | Mimic | bosses | yes | The Mimic, the elite clue casket boss: the Strange casket dialogue and the fight. (members only) |
| `MoonsOfPeril` | MoonsOfPeril | bosses | yes | The Moons of Peril: the Blood, Blue and Eclipse Moons under Cam Torum, Neypotzli's camps and fishing, the Lunar Chest and Eyatlalli's offerings. (members only) |
| `Nex` | Nex | bosses | yes | Nex and the Ancient Prison: public and private fights, five phases, loot and reclaim chests, the Ancient Forge, Torva repair and Combat Achievements. (members only) |
| `Nightmare` | Nightmare | bosses | yes | The Nightmare and Phosani's Nightmare in the Sisterhood Sanctuary: dreams, phases, totems, sleepwalkers, loot and Shura's and Senga's item keeping. (members only) |
| `PhantomMuspah` | PhantomMuspah | bosses | yes | The Phantom Muspah past Secrets of the North: a private lair, its five forms and spikes, lightning clouds, shockwave, corruption and loot. (members only) |
| `RoyalTitans` | RoyalTitans | bosses | yes | Branda and Eldric in the Asgarnian Ice Dungeon: a 1-2 player instance with stomps, elemental rows, Elemental Blast and per-player corpse claims. (members only) |
| `Sarachnis` | Sarachnis | bosses | yes | Sarachnis in Forthos Dungeon: the multi-combat lair, boss HUD, webs, rented private instances, and the fight with spawns at 66% and 33%. (members only) |
| `Scurrius` | Scurrius | bosses | yes | Scurrius in the Varrock Sewers: the public and private lair, the fight, food piles, kill count, loot and Historian Aldo's lamps. (members only) |
| `ShellbaneGryphon` | ShellbaneGryphon | bosses | yes | The Shellbane gryphon: its private cave under the Great Conch, its attacks, knockback, spit and whirlwind specials, and the kill. (members only) |
| `SkeletalWyvern` | SkeletalWyvern | bosses | yes | Skeletal wyverns: bite and tail swipe, the iceball and the icy breath with its freeze. (members only) |
| `Skotizo` | Skotizo | bosses | yes | Skotizo in the Catacombs of Kourend: dark totems, the altar that opens the lair, awakened altars, spawns, the kill and Combat Achievements. (members only) |
| `Whisperer` | The Whisperer | bosses | yes | The Whisperer: its site and the fight. (members only) |
| `ThermonuclearSmokeDevil` | ThermonuclearSmokeDevil | bosses | yes | The Thermonuclear smoke devil boss room by Castle Wars: crevice entrance, 93 Slayer requirement, facemask rule and its single ranged-magic attack. (members only) |
| `TormentedDemons` | TormentedDemons | bosses | yes | Tormented Demons in the Ancient Guthixian Temple: three styles, shield and defenceless phases, fire bombs, 1-3 demon rooms, kill count and Combat Achievements. (members only) |
| `Vardorvis` | Vardorvis | bosses | yes | Vardorvis at the Stranglewood ritual site: a private instance, tendril barrier, slashes, axes, head gaze, spikes, strangle and the kill. (members only) |
| `Vorkath` | Vorkath | bosses | yes | Vorkath after Dragon Slayer II: wake her on Ungael, fight her fireballs and acid, rapid-fire and freeze specials, with Torfinn returning items on death. (members only) |
| `WildernessBosses` | WildernessBosses | bosses | yes | The Wilderness bosses: Callisto, Vet'ion, Venenatis, their Artio, Calvar'ion and Spindel variants, shared entry fee, Escape Caves and Scorpia. (members only) |
| `Yama` | Yama | bosses | yes | Yama at the bottom of the Chasm of Fire: the Voice of Yama, a solo instance, the three-phase fight with the Judge of Yama, and the loot. (members only) |
| `Zalcano` | Zalcano | bosses | yes | Zalcano under Prifddinas: the platforms and barrier, the shared fight, mining, refining, imbuing and throwing tephra, and contribution rewards. (members only) |
| `Zulrah` | Zulrah | bosses | yes | Zulrah: the sacrificial boat from Zul-Andra, the fight at its shrine and what it leaves behind. (members only) |
| `PlayerBots` | PlayerBots | bots | yes | Populates the world with player bots: PvP-loadout fighters and optional AI chat bots, with admin commands to manage them. |
| `StressTestBots` | StressTestBots | bots | yes | Spawns many equipped bots that walk, chat and emote to load-test player updates. Only runs with the --stressTest server flag. |
| `AnimationStalls` | AnimationStalls | combat | yes | Holds a place for fully stalling animations, where movement and hits freeze, that the cache cannot express. It has no entries yet. |
| `ArceuusQuestLock` | ArceuusQuestLock | combat | yes | Blocks the Arceuus combat and utility spells until A Kingdom Divided is done, except Ghostly Grasp, Inferior Demonbane, teleports and reanimation. |
| `Burns` | Burns | combat | yes | Player-inflicted burns on monsters: a 4-tick damage hitsplat that stacks up to five times, with boss immunities. (members only) |
| `ChargeFade` | ChargeFade | combat | yes | Tells the player 'Your magical charge fades away' when the Charge spell expires after 700 ticks. (members only) |
| `ElementalSpells` | Elemental Spells | combat | yes | Elemental combat spells: strike to wave casting, elemental weaknesses and the fragment effects. |
| `EnchantedBolts` | EnchantedBolts | combat | yes | Enchanted crossbow bolt effects: gem proc chances, graphics, sounds, poison, drains and leech, plus a ::boltproc testing command. (members only) |
| `EquipmentEffects` | EquipmentEffects | combat | yes | Worn-gear combat effects: Dharok's, obsidian, Inquisitor's, Justiciar, the Salve amulet, dragon hunter and demonbane gear, the confliction gauntlets, the smoke staves' standard-spellbook bonus, and similar sets. |
| `Freezes` | Freezes | combat | yes | Freeze aftermath: red messages for ice spells, expiry warnings, and releasing a player-applied freeze when the two stray over 10 tiles apart. |
| `Frostweaver` | Frostweaver | combat | yes | Blue Moon set effect: binding and ice casts sometimes add an instant spear attack. (members only) |
| `HomeTeleports` | HomeTeleports | combat | yes | The free home teleport of the standard, Ancient, Lunar and Arceuus spellbooks, with the long cast and one shared 30-minute cooldown. |
| `KillStreaks` | KillStreaks | combat | yes | PvP kill streaks with rewards and glow effects, plus commands to view them. |
| `LunarCures` | LunarCures | combat | yes | The Lunar spells Cure Me, Cure Other and Cure Group, which remove poison and weaken venom. (members only) |
| `MonsterInspect` | Monster Inspect | combat | yes | The Lunar Monster Inspect spell, which opens a monster's stats panel for 30.5 Magic XP. |
| `MultiHitWeapons` | MultiHitWeapons | combat | yes | Twin-hit weapons such as sulphur blades, tecpatls and Torag's hammers: independent accuracy rolls and two hitsplats on the same tick. |
| `PlayerHitSounds` | PlayerHitSounds | combat | yes | Plays the hurt sound to players struck in combat, in the voice their Hit sounds setting chooses. |
| `PvpStatistics` | PvpStatistics | combat | yes | Tracks PvP kills, deaths, kill streaks and Elo rating, separating player and bot opponents. |
| `PvpTutorial` | PvpTutorial | combat | yes | No PvP tutorial is active, so spells count the player's own runes in instances and on boats. |
| `Retribution` | Retribution | combat | yes | The Retribution prayer: when its user dies, nearby enemies take damage up to a quarter of their Prayer level, with its graphic and sound. |
| `SkullPrevention` | SkullPrevention | combat | yes | The PK Skull Prevention setting, which refuses attacks that would skull the player. |
| `SpecialAttacks` | SpecialAttacks | combat | yes | Weapon special attacks, one handler per weapon from the dragon dagger to the Osmumten's fang, each with its own combat method and drain. |
| `SpellTeleports` | SpellTeleports | combat | yes | Teleport tablets and spell teleports, including house tablets and redirected scrolls, from the teleport-tablets data file. |
| `StandardBindings` | Standard Bindings | combat | yes | Standard-spellbook Bind, Snare and Entangle rules, including Swampbark armour. |
| `StandardCurses` | Standard Curses | combat | yes | Standard-spellbook Confuse, Weaken and Curse, Vulnerability, Enfeeble and Stun stat drains. |
| `TeleBlock` | TeleBlock | combat | yes | Tele Block follow-up: warns 30 seconds before it expires and keeps it on in the Ferox Enclave. |
| `AdminCommands` | AdminCommands | commands | yes | Staff commands: teleporting, items and spawns, levels, kicks, mutes and bans, reloading data, and logging and debug tools. |
| `ClickTeleport` | ClickTeleport | commands | yes | Lets staff teleport to a clicked tile with Ctrl+Shift click; for everyone else the click is a plain Ctrl-click walk. |
| `DisplayName` | DisplayName | commands | yes | The ::displayname command, setting the name other players see within the 12-character, 28-day and 35-day reservation rules. |
| `ExactMoveCommand` | ExactMoveCommand | commands | yes | Developer ::exactmove command that makes a spawned NPC glide across tiles, to test exact moves. |
| `HeadbarColourCommands` | HeadbarColourCommands | commands | yes | Developer commands ::headbar and ::ifcolour, to try NPC headbars and recolour interface components. |
| `MaxGear` | MaxGear | commands | yes | Developer ::maxgear command that banks worn gear and equips best-in-slot melee, ranged or magic sets for boss testing. |
| `PlayerCommands` | PlayerCommands | commands | yes | Everyday player commands: ::home, ::players, ::claim, ::yell, ::title, ::skull, ::changepassword, ::lockxp and ::timeplayed. |
| `PluginPerfCommand` | PluginPerfCommand | commands | yes | A command that reports and logs how much time each plugin takes per tick. |
| `SaveHistory` | SaveHistory | commands | yes | Owner commands ::snapshots and ::rollback, which list a player's saved copies and restore an earlier one. |
| `SeasonalRares` | SeasonalRares | events | yes | Hands out discontinued seasonal rares during the world's own event windows, with ::rares to list what a player can claim. |
| `AcceptAid` | AcceptAid | interface | yes | The Accept Aid setting that controls whether Lunar spells, cures and shared boosts can affect the player, refused for Ironmen. |
| `ActivityAdviser` | ActivityAdviser | interface | yes | The Activity Adviser: the minimap button opens its quest suggestions, built from the cache quest table. |
| `AlchemyWarningThreshold` | AlchemyWarningThreshold | interface | yes | Settings option for the item value above which casting Alchemy asks first. |
| `AntiDragDelay` | AntiDragDelay | interface | yes | Settings option for the Anti Drag delay, asked as a number of milliseconds. |
| `BankPin` | BankPin | interface | yes | The Bank PIN: the Banker settings, the keypad, the bank lock, and the guard on other PIN-protected actions. |
| `BankSpace` | BankSpace | interface | yes | Bank capacity: 900 slots for members, bonuses from a PIN, and extra slots bought from a Banker with coins. |
| `BossHud` | BossHud | interface | yes | The boss health bar overlay, driven by custom events from boss plugins for health, colours, fade and hide, and the normal health overlay for any other NPC a player attacks. |
| `BossKillCount` | BossKillCount | interface | yes | Sends boss kill-count lines as filterable spam when the player's All Settings row asks for it. |
| `BuffBarStart` | Buff Bar Start | interface | yes | Starts the buff bar's freeze, Staff of the dead, poison and Abyssal Sire stun timers. |
| `BuffTimers` | Buff Timers | interface | yes | Sends the effect countdowns the buff bar reads (potions, spells, ammo, group woodcutting) and the client's antifire, Tele Block and stamina infobox timers. |
| `CameraShake` | CameraShake | interface | yes | Camera shake effects, sent only when the player's combat and atmospheric camera shake settings allow them. |
| `Clans` | Clans | interface | yes | Clans: the Clan Hub, the player's own clan, // clan chat and the Your Clan tab. |
| `CloseButtons` | CloseButtons | interface | yes | Makes cache Close buttons that have no client script, such as the book and minigame panels, close their interface. |
| `Commands` | Commands | interface | yes | A searchable in-game list of the commands available to the player, opened with ::commands. |
| `CustomCharacterSummary` | CustomCharacterSummary | interface | no | Our own Character Summary tab for the side journal. Off unless the world turns it on; needs SideJournalDefaults. |
| `CustomShops` | CustomShops | interface | yes | A ::shops interface for browsing this server's custom shops, loaded from custom-shops.json. |
| `DestroyItem` | DestroyItem | interface | yes | The destroy-item confirmation and its 1/Y and 2/N keys, with the destroy sound and each item's own warning; other options (Uncharge, Dismantle) can ask on it too. |
| `DuelStaking` | DuelStaking | interface | yes | Adds the staking interface and item stakes to duels. The Duel Arena itself is a separate plugin. |
| `Emotes` | Emotes | interface | yes | Emotes tab: plays the emote animations, locks emotes until earned, and restores unlocked emotes at login. |
| `EquipmentStats` | EquipmentStats | interface | yes | Equipment stats screen opened from the worn-items tab, with the inventory beside it, so gear can be compared and swapped. |
| `FreezeTimer` | Freeze Timer | interface | yes | Sends the remaining freeze time and spell for the client's freeze-timer overlay. |
| `FriendsList` | FriendsList | interface | yes | Friends list and friends chat: private messages, chat filters and friends-chat channels. |
| `GrandExchange` | GrandExchange | interface | yes | The Grand Exchange: offers, offer collection and the item-price resource it uses. |
| `Grouping` | Grouping | interface | yes | Player groups of up to five with their own chat-channel, and the Grouping tab's activity chat-channels: ::group to form, invite, accept, promote, kick, leave or disband, kept across logins. |
| `IgnoreList` | IgnoreList | interface | yes | Reserved for the ignore list. Nothing is attached yet because the client does not send add or remove actions. |
| `ItemsKeptOnDeath` | ItemsKeptOnDeath | interface | yes | Items Kept on Death screen showing what you would keep or lose, with skull, Protect Item, PvP and Wilderness level toggles. |
| `LoginTips` | LoginTips | interface | yes | Sends a 'Did you know?' tip after the login greeting, following the All Settings row that turns them off. |
| `MaxHitThreshold` | MaxHitThreshold | interface | yes | Settings option for the lowest damage that shows a max hit hitsplat. |
| `MaxHitsInterface` | MaxHitsInterface | interface | yes | Adds the ::maxhits command, an interface of live melee, ranged and per-spell max hits for the player's current gear and levels. |
| `MinigameTeleports` | MinigameTeleports | interface | yes | Minigame Teleport spell: opens the minigame list, checks requirements, plays the home teleport cast and applies the 20-minute cooldown. |
| `Notifications` | Notifications | interface | yes | Shows the pop-up banner at the top of the screen for collection log and Combat Achievements, queuing them one at a time. |
| `Omnishop` | Omnishop | interface | yes | Opens Jagex's shared reward shop interface from the cache's shop data, tracks currency balances and handles buying and selling for other plugins' shops. |
| `PoisonTimer` | Poison Timer | interface | yes | Sends the poison and venom state to the client so the poison timer shows the seconds until the next damage hit. |
| `PriceChecker` | PriceChecker | interface | yes | Price checker opened from the worn-items tab: deposit items to see each value and the total, and get them back on close. |
| `ReportAbuse` | ReportAbuse | interface | yes | Report option on players and the chatbox Report button open the report form; submitted reports are written to a JSON-lines file. |
| `RunAutoEnable` | RunAutoEnable | interface | yes | Settings option to turn run back on by itself once energy recovers to a chosen threshold after running out. |
| `ScreenHighlight` | ScreenHighlight | interface | yes | Step-by-step highlight walkthrough overlay with text and Continue button that other content, such as the league tutorial, can trigger. |
| `SetSkillLevel` | SetSkillLevel | interface | yes | On PvP worlds with presets, clicking a Skills tab stat prompts you to set that skill's level, with checks against gear, combat and the Wilderness. |
| `Settings` | Settings | interface | yes | All Settings browser, keybindings panel and game client layout dropdown, saving the chosen settings and XP drop options per player. |
| `SideChannels` | SideChannels | interface | yes | Tab bar of the social tab, switching between chat channel, Your Clan and grouping, and remembering the chosen tab between logins. |
| `SideJournalDefaults` | SideJournalDefaults | interface | yes | The side journal's tabs and the custom Character Summary, with buttons that follow each player's commands. |
| `SkillGuide` | SkillGuide | interface | yes | Opens the skill guide (new or old style, as All Settings chooses) when you pick View guide on a Skills tab stat, and opens a quest's journal from the Quest XP tab. |
| `SkillLevelUp` | SkillLevelUp | interface | yes | Level-up feedback: chat message, unlock messages, graphic, sound and the level-up pop-up, which pauses skilling until you press Continue. |
| `StaffCrowns` | StaffCrowns | interface | yes | Shows the right chat icon before a player's name: a moderator or admin crown from their rights, else the Ironman icon. |
| `TabFilters` | TabFilters | interface | yes | Prayer and spellbook filter menus that hide prayers or spells, saved per player, with unusable spells hidden for new accounts. |
| `TeleportInterface` | TeleportInterface | interface | yes | Adds the ::teleports command, a searchable teleport list with tabs, favourites, recent teleports and a Wilderness warning. |
| `Teleports` | Teleports | interface | yes | Handles the home, training, PvP and boss teleport buttons and their dialogue menus, including boss instance destinations. |
| `Trading` | Trading | interface | yes | Closes a player-to-player trade when its offer, confirmation or inventory interface is closed. |
| `ValueWarnings` | ValueWarnings | interface | yes | All Settings value warnings (drop, Alchemy) and loot drop notifications, and their thresholds. |
| `VengeanceTimer` | Vengeance Timer | interface | yes | Keeps the client's 30-second Vengeance cooldown overlay in sync with the player's cooldown. |
| `VoiceChat` | VoiceChat | interface | no | Proximity voice chat: signalling between nearby players on the same plane and private area. Voice also needs client support and browser microphone permission. |
| `WasdCamera` | WasdCamera | interface | yes | Lets web client players turn on WASD camera in All Settings > Controls: W, A, S and D turn the camera like the arrow keys, and Enter opens chat. Off for each player until they turn it on; turn the plugin off to remove the option. |
| `WelcomeScreen` | WelcomeScreen | interface | yes | Welcome screen at login with the message of the week and a Play button, with the text set by the world's plugin config. |
| `WorldMapPlayers` | World Map Players | interface | yes | Gives admins a live dot on the world map for every online player, with bots marked differently, refreshed every few ticks. |
| `WorldMapPosition` | WorldMapPosition | interface | yes | Keeps the world map's player marker up to date while the map is open, on land or aboard a boat. |
| `XpReward` | XpReward | interface | yes | The 'Choose the stat you wish to be advanced' interface used by experience lamps, with level and unlock checks before granting the XP. |
| `AbyssalTentacle` | AbyssalTentacle | items | yes | Abyssal tentacle: 25% chance to poison on hit, 10,000 charges, one used per attack, plus Check, Dissolve and whip-plus-tentacle combining. (members only) |
| `AccursedSceptre` | AccursedSceptre | items | yes | Accursed sceptre and Thammaron's sceptre: powered-staff casting on revenant ether charges, Wilderness NPC bonus, Check, Swap and Uncharge. (members only) |
| `AmuletOfBloodFury` | AmuletOfBloodFury | items | yes | Amulet of blood fury: made from a Blood shard and amulet of fury, 30,000 charges, heals from damage dealt, with Check and Revert. (members only) |
| `AmuletOfChemistry` | AmuletOfChemistry | items | yes | Amulet of chemistry: 5% chance of an extra potion dose when mixing in Herblore, five charges per amulet, with Options and Break. (members only) |
| `AncientRingCrafting` | AncientRingCrafting | items | yes | Desert Treasure II ancient rings: break Fremennik rings with a chisel, combine icons with vestiges and craft the finished rings at a furnace. (members only) |
| `AncientRings` | AncientRings | items | yes | Stops the Ultor, Bellator, Magus and Venator rings being worn until the player has killed the matching Desert Treasure II boss. (members only) |
| `AncientSceptre` | AncientSceptre | items | yes | Ancient sceptre passive: boosts the Ancient magic smoke, shadow, blood and ice spell effects by 10%. (members only) |
| `Arclight` | Arclight | items | yes | Arclight: made at an altar from the Darklight, charged with ancient shards, and infused per sword for extra damage against demons. (members only) |
| `AscensionCrossbows` | AscensionCrossbows | items | yes | Ascension crossbows: fires ascension bolts and alternates the left and right firing animations on every shot. (members only) |
| `AshSanctifier` | AshSanctifier | items | yes | Ash sanctifier: Tyss gives it after the hard Kourend & Kebos diary; charged with death runes, it scatters the ashes demons drop for Prayer XP. (members only) |
| `AvasAccumulator` | AvasAccumulator | items | yes | Ava's attractor, accumulator and assembler: recover 60% to 80% of fired ammunition, blocked by metal body armour. |
| `AvernicDefender` | AvernicDefender | items | yes | Avernic defender: combine the hilt with a dragon defender, dismantle it back, and inspect the hilt, with confirmations and preset-item protection. (members only) |
| `AvernicTreads` | AvernicTreads | items | yes | Avernic treads: add primordial, pegasian and eternal boots for demon tears, gaining Magic and Runecraft XP, and dismantle them back. (members only) |
| `BarrowsEquipment` | BarrowsEquipment | items | yes | Barrows armour and weapons: durability that degrades over time, repairs, and the Dharok, Guthan, Verac, Torag and Karil set-effect combat modifiers. (members only) |
| `BladeOfSaeldor` | BladeOfSaeldor | items | yes | Blade of Saeldor: uses one charge per swing and handles the inactive form, built on the shared crystal-weapon charge code. (members only) |
| `BlightedSpellSacks` | BlightedSpellSacks | items | yes | Blighted spell sacks (ice, entangle, teleblock, surge, vengeance): each supplies a spell's entire rune cost where blighted items are allowed. (members only) |
| `BoltPouch` | BoltPouch | items | yes | Adds the bolt pouch: four slots of up to 10,000 bolts, stored with Use, the Open interface's Remove and Unwield, and Hirko's sale. (members only) |
| `Bonds` | Bonds | items | yes | Old school bonds: tradeable and untradeable forms, bond pouch interface, redeeming for membership days, converting and gifting bonds. |
| `Bonecrusher` | Bonecrusher | items | yes | Bonecrusher: while charged and active in the inventory, crushes the bones a kill drops for Prayer XP, in full with the elite Morytania diary. (members only) |
| `BottomlessMilkBucket` | BottomlessMilkBucket | items | yes | Bottomless milk bucket: holds up to 10,000 uses of one kind of milk, with Check, Fill and Empty; quests and dairy cows use it a use at a time. (members only) |
| `BountyHunterWeapons` | BountyHunterWeapons | items | yes | Restricts imbued Bounty Hunter weapons, like the dark bow (BH) and abyssal daggers (BH), to permitted PvP minigames and combat rings. (members only) |
| `BowOfFaerdhinen` | BowOfFaerdhinen | items | yes | Bow of Faerdhinen: uses one charge per shot, hit or miss, and has its inactive form, built on the shared crystal-weapon charge code. (members only) |
| `BraceletOfClay` | BraceletOfClay | items | yes | Bracelet of clay: softens mined clay and gives two soft clay per success at the soft clay rocks, crumbling after 28 uses. (members only) |
| `BrimstoneRing` | BrimstoneRing | items | yes | Brimstone ring: combine the Hydra's eye, fang and heart, with a confirmation and a Proceed or Cancel prompt. (members only) |
| `BrokenItems` | BrokenItems | items | yes | Untradeable items that break on a PvP death, and Perdu, who repairs, locks and unlocks them. |
| `Camulet` | Camulet | items | yes | Camulet: teleports to Enakhra's Temple or the quarry entrance using charges, recharged with ugthanki dung. (members only) |
| `CapeOfSkulls` | CapeOfSkulls | items | yes | Cape of skulls: warns before you wear it, then skulls the player for 20 minutes, again on re-equip or login. (members only) |
| `Chinchompas` | Chinchompas | items | yes | Chinchompa weapons: fuse-based accuracy by distance, area explosion hitting nearby targets in multicombat, and one chinchompa used per throw. (members only) |
| `Chronicle` | Chronicle | items | yes | Chronicle: teleports to the Champions' Guild for one charge, charged with teleport cards up to 1,000, with Check charges. |
| `ChuggingBarrel` | ChuggingBarrel | items | yes | Chugging barrel: assemble and dismantle it, store five potions at 100 doses each, and drink one dose of every potion in one click. (members only) |
| `CircletOfWater` | CircletOfWater | items | yes | Circlet of water: charged with water runes up to 500,000 charges, uncharge, and stands in for drinks against desert heat. (members only) |
| `CrystalArmour` | CrystalArmour | items | yes | Crystal armour in every colour: boosts crystal bow and Faerdhinen accuracy and damage (melee and powered staves too with the crystal blessing), loses charges when hit, takes shards and reverts to seeds. (members only) |
| `CrystalHalberd` | CrystalHalberd | items | yes | Crystal halberd: starts with 2,500 charges, loses one per hit, takes crystal shards up to 20,000 and goes inactive at zero. (members only) |
| `CrystalRecolour` | CrystalRecolour | items | yes | Crystal equipment recolours: the Elven Clan crystals recolour crystal armour and the corrupted blade of Saeldor and bow of Faerdhinen, keeping their charges. (members only) |
| `CrystalSinging` | CrystalSinging | items | yes | Crystal singing at the Prifddinas singing bowl: turns crystal seeds and shards into crystal armour, tools, weapons and teleport crystals for Smithing and Crafting XP. (members only) |
| `DevilsElement` | DevilsElement | items | yes | The Devil's element's Demonic Pacts effect: a 30% weakness to every element on every target. (members only) |
| `DiaryRewards` | DiaryRewards | items | yes | Achievement diary reward items: their daily teleports, Falador shield prayer restore, Explorer's ring energy and the other diary rewards. (members only) |
| `DizanasQuiver` | DizanasQuiver | items | yes | Dizana's quiver: an extra ammunition slot with Fill, charges, Open, Empty and Uncharge, plus its death rules and the Shrine of Ralos blessing. (members only) |
| `DragonboneNecklace` | DragonboneNecklace | items | yes | Dragonbone necklace: while worn, burying or crushing bones restores Prayer points. (members only) |
| `DragonfireShield` | DragonfireShield | items | yes | Dragonfire shield, ward and ancient wyvern shield: charges, Inspect, Check, Empty, absorbing dragonfire, the blast special and bonus defence. (members only) |
| `DrakansMedallion` | DrakansMedallion | items | yes | Drakan's medallion: teleports to Ver Sinhaza, Darkmeyer, Slepe and Castle Drakan from the inventory or worn option, capped at Wilderness level 20. (members only) |
| `DwarfCannon` | DwarfCannon | items | yes | Dwarf multicannon: setup, cannonballs, turning and firing, decay and repair, Nulodion's replacements, restricted areas and the ornament kit. (members only) |
| `EclipseAtlatl` | EclipseAtlatl | items | yes | Eclipse atlatl: a short-range thrown weapon using atlatl darts, with its own attack speed and combat method and the Eclipse Moon set bonus. (members only) |
| `ElementalTomes` | Elemental Tomes | items | yes | Tomes of fire and water: charged with burnt or soaked pages, boosting spell damage and saving runes, with page-storing and bank options. (members only) |
| `ElementalStaves` | ElementalStaves | items | yes | Elemental staves, battlestaves, the Kodai wand, the twinflame staff, the Shadowflame quadrant and the Devil's element supply their element's runes to spells automatically. |
| `Emblems` | Emblems | items | yes | Mysterious emblems: they downgrade a tier when you die to a player and are dropped on the ground instead of kept. |
| `EmptyContainers` | EmptyContainers | items | yes | Empty option on filled buckets, pots, jugs, bowls and plant cure: leaves the empty container and sends the captured message and sound. |
| `EternalTeleportCrystal` | EternalTeleportCrystal | items | yes | Eternal teleport crystal: unlimited Lletya and Prifddinas teleports, with Toggle swapping the left-click destination. (members only) |
| `EyeOfAyak` | EyeOfAyak | items | yes | Eye of Ayak: powered staff charged with demon tears or runes, with Check, Uncharge and Dismantle, casting every 3 ticks. (members only) |
| `Food` | Food | items | yes | Eating: heals, boosts, drains and cures from data/food.json, with eat delays, multi-bite foods, combo foods and the food-eaten counter. |
| `GiantEggSac` | GiantEggSac | items | yes | Giant egg sac: cut open in a bank for 100 red spiders' eggs, Remove-eggs, Check-eggs and bank Empty. (members only) |
| `GiantsoulAmulet` | GiantsoulAmulet | items | yes | Charges the giantsoul amulet with big bones and law runes and teleports to Bryophyta's, Obor's or the Royal Titans' lairs, one charge each. (members only) |
| `GoadingPotion` | GoadingPotion | items | yes | Drinking a goading potion starts a six-minute timer during which nearby monsters within four tiles turn on the player, with the worn-off warnings. (members only) |
| `GoblinBook` | GoblinBook | items | yes | Lets players read the Goblin book, which opens its pages in the book viewer. (members only) |
| `GoblinMail` | GoblinMail | items | yes | Stops goblin mail being worn unless the player is in the Land of the Goblins goblin form, and unequips it if they stop being one. |
| `GracefulOutfit` | GracefulOutfit | items | yes | Gives each graceful piece its run-energy restoration bonus, plus the full-set bonus, and counts an Agility or max cape as the graceful cape. (members only) |
| `Greegrees` | Greegrees | items | yes | Wielding a monkey greegree on Ape Atoll turns the player into a monkey, calms the island's monsters and removes the greegree on leaving. (members only) |
| `HarmonisedNightmareStaff` | HarmonisedNightmareStaff | items | yes | The Harmonised nightmare staff autocasts standard-spellbook combat spells in 4 ticks. (members only) |
| `HolidayToys` | HolidayToys | items | yes | Plays the animations and chat lines of permanent holiday toys such as Santa's list, the Zombie head and other event reward items. |
| `IbansStaff` | IbansStaff | items | yes | Charges Iban's staff (120, or 2,500 for the upgraded staff), spends charges on Iban Blast, and lets the Dark Mage recharge it for coins. (members only) |
| `ImbuedHeart` | ImbuedHeart | items | yes | Adds the imbued and saturated hearts' Invigorate Magic boost with its seven-minute (five for saturated) shared cooldown, and the saturated upgrade. (members only) |
| `ItemDefinitionLoader` | ItemDefinitionLoader | items | yes | Loads custom item definitions and models from the custom-items and custom-models content files and sends the custom items to players at login. |
| `ItemStyles` | ItemStyles | items | yes | Opens the native style chooser for holiday cosmetics whose Change, Colour, Carve or Paint option alters their look, and applies the chosen style. |
| `Jewellery` | Jewellery | items | yes | Runs charged and eternal jewellery such as dueling rings, games necklaces and glories: Rub and worn-option teleports, charge counts and Check messages. (members only) |
| `Keris` | Keris | items | yes | Gives the keris family extra damage against Kalphites and Scabarites, with a rare triple-damage hit, and Amascut's partisan its own boost. (members only) |
| `KourendTravelItems` | KourendTravelItems | items | yes | Adds Kharedst's memoirs, the Book of the Dead and Xeric's talisman teleports to Kourend, with charges and Wilderness limits. (members only) |
| `LightSources` | LightSources | items | yes | Lets a tinderbox light unlit torches, candles and lanterns at the right Firemaking level, and lets lit torches and mining helmets be put out again. (members only) |
| `Lightbearer` | Lightbearer | items | yes | Makes a worn Lightbearer ring restore special attack energy every 25 ticks instead of every 50. (members only) |
| `LithicSceptre` | LithicSceptre | items | yes | The Lithic sceptre: its built-in spell, rune charges, Shatter stacks for Explosive Shatter. (members only) |
| `LootKeys` | LootKeys | items | yes | Adds Wilderness loot keys dropped by player kills, which hold the victim's loot until opened at the loot chest, with the settings and unlock interface. |
| `LootingBag` | LootingBag | items | yes | Adds the looting bag: items go in only in the Wilderness, come out at a bank, and are lost on death, with Deposit, Check and settings. (members only) |
| `MithrilSeeds` | MithrilSeeds | items | yes | Lets players plant mithril seeds to grow random flowers that can be picked, and removes the flower after a short time. (members only) |
| `MythicalCape` | MythicalCape | items | yes | Lets the mythical cape teleport the player to the Myths' Guild from the inventory or worn, with no charges. (members only) |
| `NeitiznotFaceguard` | NeitiznotFaceguard | items | yes | Handles the Basilisk jaw: Olaf the Bard's story, then attaching it to a Helm of Neitiznot to make the faceguard, and dismantling it again. (members only) |
| `NeverKeptOnDeath` | NeverKeptOnDeath | items | yes | Destroys the items that are never kept on death (the clue box, League trophies, the Chronicle, items with no ground state) on an unsafe death, instead of keeping, dropping or graving them. (members only) |
| `Obligator` | Obligator | items | yes | Adds the Obligator chain mace's multi-roll Thrust with reach behind the target and single-target Smash, plus charging with shards and runes. (members only) |
| `OilLights` | OilLights | items | yes | Handles oil lamps and lanterns: assembling them, distilling lamp oil at the Rimmington still, lighting with a tinderbox and extinguishing them. (members only) |
| `OpenableItems` | OpenableItems | items | yes | Gives the Open option on item packs, caskets, oysters, gem bags, sacks and similar items that hand over fixed or random contents. |
| `OrnamentKits` | OrnamentKits | items | yes | Lets ornament kits and colour recolours be applied to their base items and reverted, with refunds where the Wiki says the kit is returned. |
| `OrnateMaulHandle` | OrnateMaulHandle | items | yes | Lets the ornate maul handle be attached to a granite maul, with a warning, for the cheaper Quick Smash special, and removed again. (members only) |
| `PegasianBoots` | PegasianBoots | items | yes | Lets players infuse a Cerberus crystal onto boots to make Pegasian, Primordial or Eternal boots, at 60 Magic and Runecraft for 200 experience each. (members only) |
| `PendantOfAtes` | PendantOfAtes | items | yes | Charges the Pendant of Ates with frozen tears and teleports to the Ates statues the player has activated, one charge each. (members only) |
| `PharaohsSceptre` | PharaohsSceptre | items | yes | Adds the Pharaoh's sceptre: teleports to the great pyramids, charges, Desert Diary capacity and recharging at the guardian mummy. (members only) |
| `PhoenixNecklace` | PhoenixNecklace | items | yes | Makes a worn Phoenix necklace heal 30% of Hitpoints and break when a hit leaves the wearer at 20% or less, except where food is banned. (members only) |
| `Potions` | Potions | items | yes | Handles drinking potions: dose items, stat boosts and drains, antidotes, restores, stamina, anti-fire and other effects, and their timers. |
| `QuestRewardDeathCoins` | QuestRewardDeathCoins | items | yes | Turns the barrelchest anchor and barrows gloves into coins for the killer on a PvP death. (members only) |
| `QuestRewardLamps` | QuestRewardLamps | items | yes | The antique lamps from Shield of Arrav, Ernest the Chicken, Romeo & Juliet, Black Knights' Fortress and Demon Slayer: rub for their experience. |
| `RatBoneWeapons` | RatBoneWeapons | items | yes | Adds the rat bone mace, shortbow and staff made from Scurrius' spine: making them, the staff's charges and spell, and the rats-only bonus. (members only) |
| `ReadingBooks` | ReadingBooks | items | yes | Lets players read the Construction guide, the Glassblowing book and the Archaeologist's diary in the book viewer. (members only) |
| `RevenantWeapons` | RevenantWeapons | items | yes | Adds Viggora's chainmace, the Ursine chainmace and Craw's bow: revenant ether charging, Wilderness damage bonus, uncharging and dismantling. (members only) |
| `RingOfElements` | RingOfElements | items | yes | Charges the ring of the elements with runes and teleports beside the four elemental altars, one charge each, with a bank uncharge option. (members only) |
| `RingOfEndurance` | RingOfEndurance | items | yes | Charges the ring of endurance with stamina potions, doubles a worn ring's stamina doses and cuts run-energy drain at 500 or more charges. (members only) |
| `RingOfLife` | RingOfLife | items | yes | Teleports the wearer to their respawn point and breaks the ring when a hit leaves 10% Hitpoints or less, with the Defence cape doing the same. (members only) |
| `RingOfRecoil` | RingOfRecoil | items | yes | Adds the ring of recoil's Check and Break options and exempts the Wiki's list of immune monsters from the reflected damage. (members only) |
| `RingOfShadows` | RingOfShadows | items | yes | Charges the ring of shadows with runes and teleports to the Desert Treasure II vaults, unlocking each with its boss tablet, one charge per teleport. (members only) |
| `RingOfSuffering` | RingOfSuffering | items | yes | Handles the ring of suffering's recoil effect by reusing the shared recoil handling. (members only) |
| `RingOfVisibility` | RingOfVisibility | items | yes | Lets a worn ring of visibility or ring of shadows reveal the shadow realm's hidden NPCs and objects by setting the shadow realm varbit. (members only) |
| `RingOfWealth` | RingOfWealth | items | yes | Handles the ring of wealth: charge counts, imbuing for 50,000 coins, teleport destinations, drop-collection settings and the ring's crumbling. (members only) |
| `RockCake` | RockCake | items | yes | Adds the Dwarven rock cake, which is never used up: Eat costs 1 Hitpoint and Guzzle costs 10% of current Hitpoints plus 1. (members only) |
| `RunePouch` | RunePouch | items | yes | Adds the rune pouch and divine rune pouch: storing up to 16,000 of three or four rune types, the interface, bank deposits, loadouts and the Rune-picking setting. (members only) |
| `Salamanders` | Salamanders | items | yes | Adds the salamander weapons, whose Scorch, Flare and Blaze styles burn one tar per attack and give Blaze a magic maximum hit by creature. (members only) |
| `SanguinestiStaff` | SanguinestiStaff | items | yes | Adds the Sanguinesti staff: its built-in spell with its projectile and graphics, blood rune charging, uncharging and the chance to heal the caster. (members only) |
| `ScytheOfVitur` | ScytheOfVitur | items | yes | Adds the Scythe of Vitur's multi-hit sweeps on large targets, charging at the Theatre of Blood vyre well, and reverting to uncharged. (members only) |
| `SeekingArrows` | SeekingArrows | items | yes | Makes successful bow hits with seeking dragon arrows deal at least three damage. (members only) |
| `SerpentineHelm` | SerpentineHelm | items | yes | Charges the serpentine helm with Zulrah's scales for poison and venom immunity and a chance to envenom targets, spending scales in combat. (members only) |
| `ShadowflameQuadrant` | ShadowflameQuadrant | items | yes | The Shadowflame quadrant's second elemental spell, its spells counting as the target's weakness, and its 8-tile reach without melee. (members only) |
| `SkillCapes` | SkillCapes | items | yes | Handles skillcapes and the max cape: buying from the skill masters, trimming, Boost, teleports, worn options and their perks. (members only) |
| `SlayerHelmet` | SlayerHelmet | items | yes | Adds the black mask and Slayer helmet: Slayer-task accuracy and damage boosts, assembling and disassembling, and imbuing with a scroll. (members only) |
| `SlayersStaff` | SlayersStaff | items | yes | Adds Magic Dart for 55 Slayer with staves such as the Slayer's staff, plus the Slayer's staff (e)'s charges and Slayer's enchantment. (members only) |
| `SoulreaperAxe` | SoulreaperAxe | items | yes | Soulreaper axe components: Inspect each, and assemble the four with 2,000 blood runes into the axe. (members only) |
| `Spade` | Spade | items | yes | Plays the digging animation and sound for the Dig option on spades, leaves the click open for treasure trails and quest digs, and says nothing was found when none of them claims it. |
| `SpellRuneSaving` | SpellRuneSaving | items | yes | Gives the Staff of the dead family a 1 in 7 chance, and the Kodai wand a 15% chance, to save a spell's runes. (members only) |
| `SpiritShields` | SpiritShields | items | yes | Lets a holy elixir turn a spirit shield into a blessed spirit shield at 85 Prayer. (members only) |
| `SteelKeyRing` | SteelKeyRing | items | yes | Stores reusable keys and opens the native Check-keys interface. |
| `StorageItems` | StorageItems | items | yes | Adds the coal bag, gem bag, gem pouch, fish barrel, log basket, Forestry kit, plank sack, tackle box and meat and fur pouches, filled by gathering skills. (members only) |
| `SurgePotion` | SurgePotion | items | yes | Surge potions restore 25% special attack energy a dose, with a five-minute wait between doses that a house pool, the free-for-all portal or a death ends. (members only) |
| `TonalzticsOfRalos` | TonalzticsOfRalos | items | yes | Adds Tonalztics of Ralos, a thrown weapon charged with Sunfire splinters, one charge per throw, with Check, Charge and Uncharge. (members only) |
| `ToxicBlowpipe` | ToxicBlowpipe | items | yes | Adds the toxic blowpipe: loading Zulrah's scales and darts, dart-based ranged strength, checking, unloading, uncharging, dismantling and picking ammunition up into it. (members only) |
| `ToxicStaffOfTheDead` | ToxicStaffOfTheDead | items | yes | Charges the Toxic staff of the dead with Zulrah's scales, drains scales in combat and gives its hits a chance to envenom the target. (members only) |
| `TransformationRings` | TransformationRings | items | yes | Lets the Easter, Crate, Snowman and Ring of 3rd Age style rings morph the wearer into NPC forms, with an Unmorph option and choice menus. |
| `Trident` | Trident | items | yes | Adds the tridents of the seas and the swamp, with charging, uncharging, powered-staff casting and the swamp trident's chance to venom. (members only) |
| `TumekensShadow` | TumekensShadow | items | yes | Adds Tumeken's shadow as a built-in-spell powered staff that triples magic bonuses, quadruples them in the Tombs of Amascut, and cannot be used on players. (members only) |
| `TwistedBow` | TwistedBow | items | yes | Gives the twisted bow its accuracy and damage scaling from the target's Magic level, with a higher cap inside Chambers of Xeric. (members only) |
| `VenatorBow` | VenatorBow | items | yes | Adds the venator bow and its echo version: charging with ancient essence and shots that ricochet to extra targets in multicombat. (members only) |
| `VoidEquipment` | VoidEquipment | items | yes | Applies the Void Knight set bonuses for melee, ranged and magic, normal or elite, and redraws the combat tab when the set changes. (members only) |
| `VolcanicForge` | VolcanicForge | items | yes | Lets players combine the three Odium or Malediction ward shards at the Volcanic Forge in the Wilderness. (members only) |
| `WarpedSceptre` | WarpedSceptre | items | yes | Adds the warped sceptre as a chargeable powered weapon fed with chaos and earth runes, including its cast animation and Magic level check. (members only) |
| `Waterskins` | Waterskins | items | yes | Lets players fill waterskins from a Kharidian cactus or by pouring in a bucket, bowl, jug or vial of water, for desert heat. (members only) |
| `WeaponPoison` | WeaponPoison | items | yes | Lets weapon poison coat melee weapons, darts and arrows, and a cleaning cloth strip the poison off again. (members only) |
| `WebweaverBow` | WebweaverBow | items | yes | Adds the webweaver bow: activation and charging with revenant ether, Uncharge and Dismantle, and its damage bonus including an imbued Slayer helmet on task. (members only) |
| `WildernessChests` | WildernessChests | items | yes | Adds the Wilderness diary chests: the Muddy chest in the Lava Maze (muddy key) and the Rogues' chest in Rogues' Castle, with their loot. |
| `WineOfZamorak` | WineOfZamorak | items | yes | Wine of Zamorak spawns: Zamorak's punishment, the guarding monks, the hand-take rules and the Wilderness Diary's noted wine. |
| `WornWeights` | WornWeights | items | yes | Makes boots of lightness, penance gloves and spotted and spottier capes weigh their lighter worn weight in the equipment panel and for run-energy drain. |
| `ZoryasTome` | ZoryasTome | items | yes | Adds Zorya's tome from the Fractured Archive: a powered tome charged with astral and nature runes, plus its Zorya's flow special attack. (members only) |
| `ArcheryCompetition` | ArcheryCompetition | minigames | yes | Runs the Ranging Guild's Archery Competition: the Competition Judge charges 200 coins for 10 bronze arrows scored on the targets. (members only) |
| `BarbarianAssault` | BarbarianAssault | minigames | yes | Runs Barbarian Assault: Commander Connad, the Outpost ladder, role assignment and the nine waves plus the final Queen wave in private arenas. (members only) |
| `Barrows` | Barrows | minigames | yes | Adds the Barrows minigame: the six brothers' crypts and puzzle door, the prayer drain, the reward chest and the Barrows minimap. (members only) |
| `BlastFurnace` | BlastFurnace | minigames | yes | Adds the Blast Furnace: smelting ore on the conveyor and collecting bars from the dispenser. (members only) |
| `BountyHunter` | BountyHunter | minigames | yes | Adds Bounty Hunter in Daimon's Crater, with the shared crater state split into units for each part of the minigame. (members only) |
| `BrimhavenAgilityArena` | BrimhavenAgilityArena | minigames | yes | Adds the Brimhaven Agility Arena: pay Cap'n Izzy, cross the obstacles and tag the marked pillar for arena tickets and vouchers. (members only) |
| `Camdozaal` | Camdozaal | minigames | yes | Adds Camdozaal fishing, barronite crushing, shard storage and Exchange charms, and the timed vault. |
| `CastleWars` | CastleWars | minigames | yes | Adds the Castle Wars team minigame, with its shared match state and one unit for each part of the game. |
| `ChambersOfXeric` | ChambersOfXeric | minigames | yes | Adds the Chambers of Xeric raid: the Mount Quidamortem party board, random or Challenge Mode chamber layouts and the rooms. (members only) |
| `ChampionsChallenge` | ChampionsChallenge | minigames | yes | Adds the Champions' Challenge: Larxus and the champions' scrolls, the ten champions in the Guild basement, Leon d'Cour and the Chest of Champions. (members only) |
| `ClanWars` | ClanWars | minigames | yes | Adds bounded Clan Wars: legacy chat-channel, melee-only Last Team Standing, kill-target and timed battles played through the challenge and exit portals. |
| `Colosseum` | Colosseum | minigames | yes | Adds the Fortis Colosseum: the lobby, waves with Minimus's modifiers, Sol Heredit and the rewards chest. (members only) |
| `CreatureCreation` | CreatureCreation | minigames | yes | Adds the solo Creature Creation activity in the Tower of Life dungeon, started from the symbol of life. (members only) |
| `DuelArena` | DuelArena | minigames | yes | Adds the Emir's Arena duel challenges and load-outs, including the rules and staking interfaces for unranked and legacy duels. |
| `FishingTrawler` | FishingTrawler | minigames | yes | Adds Fishing Trawler: the boat from Port Khazard, leaks, net and Kraken at sea, the wreck and the catch in the dock's net. (members only) |
| `Forestry` | Forestry | minigames | yes | Adds Forestry's free-to-play woodcutting events, such as the Struggling Sapling and Rising Roots, which pay Anima-infused bark. |
| `ForestryMembers` | Forestry (members) | minigames | yes | Adds Forestry's members-only events on members worlds: Pheasant Control, the frightened fox, the Enchantment Ritual, the Flowering Bush and entlings. (members only) |
| `FracturedArchive` | FracturedArchive | minigames | yes | Adds the Fractured Archive raid: the lobby, parties and Ascension rocks, then its rooms from the Archive Guardian to Xarth, Ocellus and the vault. (members only) |
| `GamesRoom` | GamesRoom | minigames | yes | Adds the Burthorpe Games Room board games, such as Draughts, Runelink and Runesquares, with tables, challenges, spectating and ranks. (members only) |
| `Gauntlet` | Gauntlet | minigames | yes | Adds the Gauntlet and Corrupted Gauntlet: the lobby under Prifddinas, the maze built for each run and the Crystalline Hunllef. (members only) |
| `GiantsFoundry` | GiantsFoundry | minigames | yes | Adds Giants' Foundry: Kovac's sword-smithing minigame in the cave under the Giants' Plateau. (members only) |
| `GnomeBall` | GnomeBall | minigames | yes | Adds Gnome Ball at the Tree Gnome Stronghold pitch: sessions, ball mechanics, the referee's hand-outs and the pitch gate. (members only) |
| `GnomeRestaurant` | GnomeRestaurant | minigames | yes | Adds the Gnome Restaurant delivery minigame: Gianne jnr.'s orders, the Aluft Aloft box, the time limit, tips and credits. (members only) |
| `GolemCrafting` | GolemCrafting | minigames | yes | Shape and power sunstone golems at Wyrmscraig's plinths. (members only) |
| `GuardiansOfTheRift` | GuardiansOfTheRift | minigames | yes | Adds Guardians of the Rift, the Runecraft minigame in the Temple of the Eye, with one world-wide game at a time. (members only) |
| `HallowedSepulchre` | HallowedSepulchre | minigames | yes | Adds the Hallowed Sepulchre: the lobby under Darkmeyer and five timed floors of Agility obstacles, traps, coffins and obelisks. (members only) |
| `ImpetuousImpulses` | ImpetuousImpulses | minigames | yes | Adds Puro-Puro: the Zanaris crop circle entry, the exit portal, Elnock's equipment and jar exchanges, his equipment storage, the magical wheat and roaming spawns. (members only) |
| `Inferno` | Inferno | minigames | yes | Adds the Inferno: entry through the cave, the wave run, Zuk and the supports, saved progress, and a developer ::infernowave command. (members only) |
| `LastManStanding` | LastManStanding | minigames | yes | Adds Last Man Standing in Casual, Competitive and High Stakes modes, with ranks, load-outs, stashed belongings and Lisa's supply chest. |
| `MageArena` | MageArena | minigames | yes | Adds the Mage Arena: battle mages, levers and pools, the god statues' capes, the 100-cast charging for each god spell, Kolodion and the Mage Arena II miniquest. (members only) |
| `MageTrainingArena` | MageTrainingArena | minigames | yes | Adds the Mage Training Arena: the entrance hall, Pizazz Points and the Telekinetic, Enchanting, Alchemists' and Creature Graveyard rooms. (members only) |
| `MasteringMixology` | MasteringMixology | minigames | yes | Adds Mastering Mixology, the Herblore minigame in the Alchemical Society's lab under Aldarin. (members only) |
| `NightmareZone` | Nightmare Zone | minigames | yes | Adds the Nightmare Zone: Dominic's dream menus and coffer, the dream arena and bosses, absorption and overload potions, and power-ups. (members only) |
| `PartyRoom` | PartyRoom | minigames | yes | Adds the Falador Party Room: the party chest, its offer interface and the balloon drops. |
| `PestControl` | PestControl | minigames | yes | Adds Pest Control: novice, intermediate and veteran boats, portals, void knight defence, commendation points and the Squire's shop. (members only) |
| `PyramidPlunder` | PyramidPlunder | minigames | yes | Adds Pyramid Plunder in Sophanem: eight timed rooms of urns and chests, the Pharaoh's sceptre and Simon Templeton buying artefacts. (members only) |
| `RoguesDen` | RoguesDen | minigames | yes | Adds Rogues' Den in Burthorpe: its traps and agility obstacles, the wall and lobby safes and the equipment crate rewards. (members only) |
| `ShadesOfMortton` | Shades of Mort'ton | minigames | yes | Adds the Shades of Mort'ton minigame: shades and their remains, the catacombs, tomb doors and chests, and funeral pyres. (members only) |
| `SorceresssGarden` | SorceresssGarden | minigames | yes | Adds Sorceress's Garden in Al Kharid: the four seasonal mazes with elementals and sq'irk trees, and brewing and handing in sq'irkjuice. (members only) |
| `SoulWars` | Soul Wars | minigames | yes | Adds Soul Wars: the lobby and queue, the instanced arena, team avatars, graveyards, souls and fragments, and the obelisk. (members only) |
| `StealingArtefacts` | StealingArtefacts | minigames | yes | Adds Stealing Artefacts at Port Piscarilius: Captain Khaled's tasks, the six houses' drawers, patrolling guards and the hand-in. (members only) |
| `TaiBwoWannaiCleanup` | TaiBwoWannaiCleanup | minigames | yes | Adds Tai Bwo Wannai Cleanup: hacking the jungle, mending the fence, trading sticks and their shop, machetes, parcels and the Hardwood Grove. (members only) |
| `TearsOfGuthix` | TearsOfGuthix | minigames | yes | Adds the weekly Tears of Guthix minigame: Juna's entry check, the timed cave with its bowl and the tear streams. (members only) |
| `TempleTrekking` | TempleTrekking | minigames | yes | Adds Temple Trekking and the Burgh de Rott Ramble: escorting a follower between Burgh de Rott and Paterdomus, with events on the way and a reward token. (members only) |
| `Tempoross` | Tempoross | minigames | yes | Adds Tempoross, the Spirit Anglers' fishing boss: the Ruins of Unkah ferries, a cove instance per trip, the fight and the reward pool. (members only) |
| `TheMess` | TheMess | minigames | yes | Adds The Mess in Hosidius: cooking meat pies, stews and pineapple pizzas for the Shayzien soldiers and serving them at the buffet tables. (members only) |
| `TheatreOfBlood` | TheatreOfBlood | minigames | yes | Adds the Theatre of Blood raid: parties at Ver Sinhaza, the rooms in a private copy of the theatre and the retrieval chest. (members only) |
| `TombsOfAmascut` | TombsOfAmascut | minigames | yes | Adds the Tombs of Amascut raid: the Jaltevas lobby and party board, the Nexus, four paths with their puzzles and bosses, the Wardens and rewards. (members only) |
| `TroubleBrewing` | TroubleBrewing | minigames | yes | Adds Trouble Brewing on Mos Le'Harmless: the lobby, team rounds of brewing in the arena, scoring and the pieces-of-eight rewards. (members only) |
| `TzHaarKetRak` | TzHaarKetRak | minigames | yes | Adds TzHaar-Ket-Rak's Challenges: fights against one to six JalTok-Jads, their rewards and a scoreboard. (members only) |
| `TzhaarFightCaves` | TzhaarFightCaves | minigames | yes | Adds the TzHaar Fight Cave: 63 waves ending with TzTok-Jad, healers, wave resume on logout and the cave's entry and exit. (members only) |
| `TzhaarFightPits` | TzhaarFightPits | minigames | yes | Adds the TzHaar Fight Pits: a waiting room, player-versus-player rounds against a champion, spawning monsters, gas and an XP toggle. (members only) |
| `ValeTotems` | ValeTotems | minigames | yes | Adds the Vale Totems Fletching minigame in the Auburn Valley: building and decorating totems, ent offerings, loot and research points. (members only) |
| `VolcanicMine` | VolcanicMine | minigames | yes | Adds the Volcanic Mine on Fossil Island: Petrified Pete, vents, gas, lava, the boulder, hazards and the reward on exit. (members only) |
| `Wintertodt` | Wintertodt | minigames | yes | Adds Wintertodt: the world-wide round behind the Doors of Dinh, the camp outside and its reward cart. (members only) |
| `FreeToPlay` | FreeToPlay | modes | no | Switches this world to free-to-play. The spawn must be inside a free-to-play area. |
| `Ironman` | Ironman | modes | yes | Adds Ironman, Ultimate and Hardcore Ironman accounts, chosen at the Ironman tutor, downgraded with Adam, or set by the ::ironman command. |
| `LeagueMode` | LeagueMode | modes | yes | Leagues characters, progression, tasks, relics, region unlocks, combat masteries, Demonic Pacts and rewards. (members only) |
| `PvpMode` | PvpMode | modes | yes | Adds the ::presets and ::kits commands, opens presets after a PvP death, and lets accounts that may use presets have their prayers without the unlock quests. |
| `AggressionToggle` | AggressionToggle | npcs | yes | Adds the ::aggro command, an administrator cheat that keeps monsters aggressive after the ten-minute tolerance, usable by all if commands allow. |
| `Apothecary` | Apothecary | npcs | yes | Gives the Varrock Apothecary's strength-potion service: 5 coins, a limpwurt root and red spiders' eggs per potion, feeding the Varrock diary. |
| `Asyff` | Asyff | npcs | yes | Adds Asyff's Custom Fur Clothing in Varrock: two dashing kebbit furs and 800 coins at 66 Hunter make a spottier cape. (members only) |
| `Baraek` | Baraek | npcs | yes | Makes Baraek in Varrock sell fur for 20 coins, or 18 as the fallback, taking the coins and giving the fur from his dialogue. |
| `BarbarianTraining` | BarbarianTraining | npcs | yes | Adds Barbarian Training's rod fishing, barehanded fishing and Herblore steps with Otto Godblessed, unlocking leaping fish catches, barehanded harpoon fishing and the barbarian mixes. (members only) |
| `Bartenders` | Bartenders | npcs | yes | Makes the Blue Moon Inn, Dancing Donkey, Sheared Ram and Dragon Inn bartenders take coins and hand over a beer or Greenman's ale. |
| `Caique` | Caique | npcs | yes | Lets players pet the sitting caiques of Kastori and the Tlati Rainforest, which peck back for 1 damage with the captured animations. (members only) |
| `CamdozaalGolems` | CamdozaalGolems | npcs | yes | Lets players Awaken golem rubble in the Ruins of Camdozaal, turning it into a Chaos Golem to fight with its drop table. (members only) |
| `CanifisCitizens` | CanifisCitizens | npcs | yes | Turns Canifis citizens into werewolves when a player attacks them without a Wolfbane, keeping their remaining health. (members only) |
| `DemonicGorillas` | DemonicGorillas | npcs | yes | Adds the Crash Site Cavern's demonic and tortured gorillas: style changes after misses, protection prayers, boulders and anti-safespot rules. (members only) |
| `DormantNpcs` | DormantNpcs | npcs | yes | Makes disguised crabs and wyrms lie dormant as scenery, rising and sinking when a player steps near or attacks them. (members only) |
| `DrJekyll` | DrJekyll | npcs | yes | Adds Dr Jekyll, the random-event NPC, with Talk-to and Dismiss options. (members only) |
| `Dragons` | Dragons | npcs | yes | Gives standard, brutal and metallic dragons their melee and dragonfire attacks, with long range for brutal and metallic ones. |
| `ElderChaosDruid` | ElderChaosDruid | npcs | yes | Adds the Wilderness Elder Chaos druid, a magic attacker casting Wind Wave and Tele Block with captured animations and projectiles. (members only) |
| `EliteVoidKnight` | EliteVoidKnight | npcs | yes | Lets the Elite Void Knight upgrade a Void knight top or robe to the elite version for 200 Commendation points, after the Hard Western diary. (members only) |
| `Entrana` | Entrana | npcs | yes | Enforces Entrana's item restrictions on ferry and balloon travel: the monks search for armour, weapons, jars and supplies, with the Wiki's exceptions. (members only) |
| `ForgottenFourRewards` | ForgottenFourRewards | npcs | yes | Saves each player's Forgotten Four reward state, using combat-achievement kill counts, for the ordered boss drop tables. (members only) |
| `GeDecanters` | GeDecanters | npcs | yes | Adds the Grand Exchange decanting service, which swaps potion doses between vials in a player's inventory for a fee. (members only) |
| `Gertrude` | Gertrude | npcs | yes | Lets players buy another kitten from Gertrude after her quest for 100 coins and pick its colour, if wearing an activated Ring of Charos. (members only) |
| `Hans` | Hans | npcs | yes | Lets Hans in Lumbridge tell players how long they have played, completing the Lumbridge diary task for it. |
| `HoopSnake` | HoopSnake | npcs | yes | Fossil Island's Hoop Snakes: stun one with a blunt attack, pick it up, then roll or release it. (members only) |
| `Killerwatt` | Killerwatt | npcs | yes | Makes Killerwatts hit hard unless the player wears insulated boots, rerolling their hits to max 6 with the boots on and 15 without. (members only) |
| `LostProperty` | LostProperty | npcs | yes | Adds the Lost Property shop of Perdu and Chris, which sells back quest and diary rewards only to players who have unlocked them. |
| `LumbridgeGuide` | LumbridgeGuide | npcs | yes | Picks the Lumbridge Guide's dialogue depending on whether the player has lost their Amulet of the Eye. |
| `MakeOverMage` | MakeOverMage | npcs | yes | Makeover Mage and the ::makeover command: change body kits and colours, pick pronouns, and unlock Halloween skins; new accounts see it at creation. |
| `Makeover` | Makeover | npcs | yes | Opens the clothes, hair and shoe makeover interface that providers use, with live previews and restore-on-cancel. |
| `MartinThwait` | MartinThwait | npcs | yes | Martin Thwait's Lost and Found needs 50 Thieving and 50 Agility, or 99 Thieving, on Talk-to and Trade. |
| `Mogre` | Mogre | npcs | yes | Lets players throw fishing explosives at Ominous Fishing Spots at Mudskipper Point to lure out a Mogre that attacks them. (members only) |
| `NoteExchange` | NoteExchange | npcs | yes | Banknote exchange merchants such as Phials: use a banknote on them to swap it for the real items for a fee per note. |
| `NpcDialogues` | NpcDialogues | npcs | yes | Plays Talk-to dialogue transcripts for NPCs from the generated dialogue data, with hooks so quests can alter lines, choices and conditions. |
| `NpcDrops` | NpcDrops | npcs | yes | Rolls NPC drop tables from the Wiki-derived drop data, with subtables, tertiary drops and hand-edited overrides. |
| `NpcRivalries` | NpcRivalries | npcs | yes | Makes opposing NPC factions, such as Shayzien soldiers against lizardmen and the God Wars armies, hunt and fight each other. (members only) |
| `NpcSpawns` | NpcSpawns | npcs | yes | Registers the NPC spawn list and the map editor's custom spawn patch as definition sources. |
| `Osten` | Osten | npcs | yes | Lets Osten recolour graceful pieces to the Kourend house colours for 15 marks of grace each, after each house's quest, and revert them for free. (members only) |
| `Patchy` | Patchy | npcs | yes | Patchy's sewing interface on Mos Le'Harmless: Sew and Talk-to open it, and Confirm sews the picked costume piece for 500 coins. (members only) |
| `Pets` | Pets | npcs | yes | Pet followers: summoning, dismissing, item-backed ownership, storage, Probita reclaim, Metamorphosis variants and pet-specific behaviour. |
| `RandomEvents` | RandomEvents | npcs | yes | Random events: Genie, Drill Demon, Mime, Maze, Pillory and others, plus the Lamp and Book of Knowledge; owner-only ::randevt tests them. |
| `Revenants` | Revenants | npcs | yes | Revenant combat, the shared revenant drop table, bracelet of ethereum, amulet of avarice and Revenant maledictus. (members only) |
| `RisingSunInn` | RisingSunInn | npcs | yes | Lets players talk to Emily across the Rising Sun Inn bar. |
| `RogueTrader` | RogueTrader | npcs | yes | Ali Morrisane's Rogue Trader errands after The Feud (runes, blackjacks, clothes) that unlock his stock and cheaper magic carpets. (members only) |
| `RuniteGolem` | RuniteGolem | npcs | yes | Runite Golems in the Resource Area: a killed golem leaves a runite rock mineable for a minute, then respawns after five minutes. (members only) |
| `Sawmill` | Sawmill | npcs | yes | Sawmill operators: Buy-plank turns logs and coins into planks, with the amount menu and the Wiki's refusal messages. (members only) |
| `Shopkeepers` | Shopkeepers | npcs | yes | Opens shops from NPC Trade options using the shop data, with default and custom NPC-to-shop bindings. |
| `SilkMerchant` | SilkMerchant | npcs | yes | Silk merchant in Ardougne: haggling dialogue buys every un-noted silk in the inventory at the agreed price. (members only) |
| `SirRenitee` | SirRenitee | npcs | yes | Sir Renitee, Falador's herald: reports a player's family crest and repaints it for a fee. (members only) |
| `SirVyvin` | SirVyvin | npcs | yes | Sir Vyvin and White Knight ranks: counts kills towards the rank score and opens each rank's White Knight Armoury. (members only) |
| `StrangePlant` | StrangePlant | npcs | yes | Handles the Strange plant random event, with Pick and Dismiss options. (members only) |
| `StrayDogs` | StrayDogs | npcs | yes | Talk-to and petting for stray dogs and Varlamore's Molossus, Xolo and Chiribaya, with Wiki transcripts and captured animations. |
| `SulphurNagua` | SulphurNagua | npcs | yes | Sulphur Nagua melee: each attack lands as two hitsplats on the same tick that share one damage roll. (members only) |
| `Tanning` | Tanning | npcs | yes | Opens the tanning interface from Ellis, Tanner, Sbott and Eodan, with per-tanner price overrides. |
| `TindelMarchant` | TindelMarchant | npcs | yes | Tindel Marchant in Port Khazard identifies rusted swords and scimitars for a fee, giving a random sword or scimitar and Ardougne Diary credit. (members only) |
| `TrainingSkeleton` | TrainingSkeleton | npcs | yes | Respawns the Edgeville training skeleton at its post as soon as it dies, rather than after the normal delay. |
| `Tutors` | Tutors | npcs | yes | Lumbridge combat and skill tutors: hands out training weapons, runes, tools and other starter gear, with a shared 30-minute claim for ranged and magic. |
| `Tyss` | Tyss | npcs | yes | Tyss at the Dark Altar toggles the Arceuus spellbook from his Spellbook option and two dialogue choices. (members only) |
| `UndeadDruids` | UndeadDruids | npcs | yes | Undead Druids use melee at melee range and magic from range, matching the Wiki and RSProx 2966. (members only) |
| `Wyrms` | Wyrms | npcs | yes | Wyrm and wyrmling combat: melee when the target is adjacent, magic from range, with separate max hits per style. (members only) |
| `Wyson` | Wyson | npcs | yes | Wyson the gardener sells woad leaves through his dialogue: 15 coins for one leaf, 20 coins for two. |
| `Zahur` | Zahur | npcs | yes | Zahur in Nardah makes unfinished potions from clean herbs and vials of water or blood for 200 coins each, after the hard Desert Diary or with a Herblore cape. (members only) |
| `ZombiePirates` | ZombiePirates | npcs | yes | Picks the Medium Wilderness Diary drop table for Chaos Temple zombie pirates once the player has completed that diary. (members only) |
| `AlKharidGate` | AlKharidGate | objects | yes | Al Kharid toll gate: Border Guard dialogue and a 10 coin toll before Prince Ali Rescue, free passage after it. |
| `Altars` | Altars | objects | yes | Altar actions: pray to restore Prayer points, switch spellbooks at Ancient, Lunar and Dark altars, and the Chaos, Nature, Guthix and Occult altars. |
| `BananaTree` | BananaTree | objects | yes | Wild banana trees on Musa Point and Ape Atoll: Pick takes a banana and empties the tree stage by stage, regrowing after five minutes. |
| `BankBooths` | BankBooths | objects | yes | Opens the bank from bank booths, bank chests and Banker NPCs, and handles the bank tab and settings buttons. |
| `BankDepositBooth` | BankDepositBooth | objects | yes | Opens the bank deposit box from the Deposit option and handles its deposit buttons and items used on it. |
| `BerryBushes` | BerryBushes | objects | yes | Wild redberry and cadava bushes near Varrock: Pick-from takes a berry, and bushes regrow one berry at a time. |
| `Chests` | Chests | objects | yes | Generic household chests: Open and Shut swap between the closed and open locs, and searching an open one finds nothing. |
| `DairyCow` | DairyCow | objects | yes | Dairy cows: Milk fills an empty bucket, and Steal-cowbell is a 15 Thieving action unlocked once Cold War is started. |
| `Doors` | Doors | objects | yes | Opens and closes doors, gates and double doors, swapping between closed and open locs, with route handling and reapplied state on region load. |
| `KeyChests` | KeyChests | objects | yes | Key-opened chests: Taverley crystal chest, Mount Karuulm brimstone chest, Larran's Wilderness chests, Prifddinas' Elven chest, Forthos' Grubby Chest and the Zombie Pirate's Locker, plus crystal key crafting. (members only) |
| `Ladders` | Ladders | objects | yes | Climbing for ladders, staircases, trapdoors, ropes and similar scenery, moving the player a level up or down with the climb animation. |
| `LeafyPalmTree` | LeafyPalmTree | objects | yes | Lets players shake Kharazi Jungle's Leafy Palm Trees for a palm leaf on the ground, with a 35-second cooldown per tree. (members only) |
| `Levers` | Levers | objects | yes | The Wilderness teleport levers (Edgeville, East Ardougne, the Deserted Keep and Mage Arena bank), with the Wilderness warning and a shared lever teleport event. |
| `Pickable` | Pickable | objects | yes | Picking wheat, potatoes, onions, cabbages, sweetcorn, flax and nettles from the fields, with respawn timers and nettle stings. |
| `RejuvenationPool` | RejuvenationPool | objects | yes | The player-owned house restoration, revitalisation, rejuvenation, fancy and ornate pools, which restore stats when drunk from. |
| `RottenTomatoCrate` | RottenTomatoCrate | objects | yes | Opens Pelters' Veg Stall, the rotten tomato shop, from the crates by the pillories in Varrock, Seers' Village, Yanille and Hosidius. (members only) |
| `ScenerySearch` | ScenerySearch | objects | yes | Searching haystacks and hay bales, which can hide a needle or prick you, and plain crates and boxes, which hold nothing. |
| `Signposts` | Signposts | objects | yes | Reading the guide signposts near Lumbridge, Draynor and Falador, opening the compass interface and moving the camera as the client expects. |
| `SwampBubbles` | SwampBubbles | objects | yes | Lets players Suck on swamp bubbles to fill their ogre bellows with swamp gas, as in Big Chompy Bird Hunting. (members only) |
| `WildernessDitch` | WildernessDitch | objects | yes | Crossing the Wilderness Ditch with the jump animation and sound, landing three tiles on, in and out of the Wilderness. |
| `Windmill` | Windmill | objects | yes | Windmill milling: fill the hopper with grain, operate the controls and empty the flour bin into a pot, as in Cook's Assistant. |
| `Autosave` | Autosave | persistence | yes | Saves every online player every few minutes, spreading the saves over ticks so a mass login does not stall the server. |
| `IndexedDbPlayerPersistence` | IndexedDbPlayerPersistence | persistence | yes | Stores player saves and hashed passwords in the browser's IndexedDB when the server runs inside a browser host. Does nothing elsewhere. |
| `JsonPlayerPersistence` | JsonPlayerPersistence | persistence | yes | Saves each character as a JSON file under data/saves/characters. Skipped when the server runs inside a browser host. |
| `SaveEvents` | SaveEvents | persistence | yes | Requests an immediate player save after important events: quest completions, reward-shop purchases, valuable discards and valuable drops. |
| `SqlitePlayerPersistence` | SqlitePlayerPersistence | persistence | yes | Saves players to a SQLite database (data/saves/players.sqlite) and can import older JSON character saves. |
| `QuestHelper` | OfflineQuestHelper | quests | yes | Runs the offline Quest Helper, answering the client's quest-helper plugin messages from the player's varps and the cache. |
| `QuestCape` | QuestCape | quests | yes | Sells the Quest point cape and hood for 99,000 coins from the Wise Old Man once the player has finished every quest that counts. (members only) |
| `QuestCommand` | QuestCommand | quests | yes | Adds the admin ::quest command to show, set, complete or reset a player's quest stage, for testing quest-gated content. |
| `Quests` | Quests | quests | yes | Registers every implemented quest from the quests folder, members and free-to-play, plus their shared widgets and ground items. |
| `Agility` | Agility | skills | yes | The Agility skill: rooftop and other obstacle courses, lap counting, marks of grace and Grace's lap-counter toggle. (members only) |
| `AgilityDispenser` | AgilityDispenser | skills | yes | The Wilderness Agility Course dispenser: lap tickets, the 150,000 coin fee and reward streak, and tag, pay and redeem for loot or XP. (members only) |
| `BarbarianPyres` | BarbarianPyres | skills | yes | Barbarian funeral pyres by Otto's Grotto: carve a pyre ship, load bones, light it, with the elite clue and ferocious barbarian spirit. (members only) |
| `BoltEnchanting` | BoltEnchanting | skills | yes | The Enchant Crossbow Bolt spell, which enchants gem bolts ten at a time from the spellbook. (members only) |
| `BoneAltars` | BoneAltars | skills | yes | Offering bones on altars, including the Chaos Temple altar's boosted Prayer XP and house altars, repeating while bones last. (members only) |
| `Construction` | Construction | skills | yes | Construction: player-owned houses, rooms, furniture and the house's facilities. (members only) |
| `Cooking` | Cooking | skills | yes | Cooking on fires, ranges and ovens, plus doughs, pies, pizzas, wine, sacred eels, leaping fish, gnome cooking and dairy churns. |
| `Crafting` | Crafting | skills | yes | Crafting: leather, gems, jewellery, glassblowing, pottery, spinning, weaving, battlestaves, snelms, limestone bricks and light orbs. |
| `CraftingSpells` | CraftingSpells | skills | yes | Spells that make crafting materials: Lunar Spin Flax, Tan Leather and Superglass Make, and Charge Orb on the obelisks. (members only) |
| `Ectofuntus` | Ectofuntus | skills | yes | The Ectofuntus in Port Phasmatys: slime, bonemeal, worship, ghost disciple tokens, the ectophial teleport and bonecrusher. (members only) |
| `EnchantJewellery` | EnchantJewellery | skills | yes | The Lvl-1 to Lvl-7 Enchant spells, which enchant rings, necklaces, bracelets and amulets from the inventory. |
| `Farming` | Farming | skills | yes | Farming: patches, crop growth, tools and storage, Tithe Farm, the Farming Guild and Hespori. (members only) |
| `Firemaking` | Firemaking | skills | yes | Firemaking: lighting logs in the inventory or on the ground, and Forester campfire tending. |
| `Fishing` | Fishing | skills | yes | Fishing at all spot types: nets, cages, harpoons, rods and karambwan vessels, with tool animations, rolls and catches. |
| `Fletching` | Fletching | skills | yes | Fletching: every Wiki recipe for bows, arrows, bolts and more, with menus and animations, plus an arrow shaft event for other content. (members only) |
| `Herblore` | Herblore | skills | yes | Herblore: cleaning grimy herbs, mixing potions, grinding secondaries with a pestle and mortar, and Guthix balance. (members only) |
| `Hunter` | Hunter | skills | yes | Hunter: traps, birdhouses, crabs, drift nets, implings, rumours, tracking, aerial fishing and herbiboar. (members only) |
| `Mining` | Mining | skills | yes | Mining: rocks and ores with pickaxes, respawn timers and depleted rocks, plus events other content uses for pickaxe and ore checks. |
| `Prayer` | Prayer | skills | yes | Burying bones and scattering demonic ashes for Prayer XP, with events other plugins use to bury, offer or restore prayer. |
| `PrayerUnlocks` | PrayerUnlocks | skills | yes | Gates prayers that need more than a level: Chivalry and Piety via King's Ransom, and Rigour, Augury and Preserve via scrolls; Deadeye and Mystic Vigour scrolls upgrade Eagle Eye and Mystic Might. (members only) |
| `RalosRise` | RalosRise | skills | yes | Prayer training at Ralos' Rise: blessing bones and wine at the altar, breaking blessed bones into shards and the libation bowl. (members only) |
| `Reanimation` | Reanimation | skills | yes | Gives Prayer XP to the caster who kills a creature reanimated by an Arceuus ensouled-head spell. (members only) |
| `Runecrafting` | Runecrafting | skills | yes | Runecrafting: entering altars with talismans or tiaras, crafting runes, binding tiaras, the Blood Altar and Dark Altar and exit portals. |
| `Sailing` | Sailing | skills | yes | Sailing boats, travel, shipyards, crews, port tasks, sea charting and combat. (members only) |
| `ShootingStars` | ShootingStars | skills | yes | Crashed stars land around the world on a timer; players mine them layer by layer for stardust and trade it with Dusuri, with an optional landing announcement. |
| `Slayer` | Slayer | skills | yes | Slayer: tasks, masters, points and rewards, superiors, finishers, and the slaughter and expeditious bracelets, built on the cache's Slayer tables. (members only) |
| `Smithing` | Smithing | skills | yes | Smelting at furnaces and smithing at anvils, plus cannonballs, godswords, dragon and visage shields, barbarian spears, Varrock armour and Superheat Item. |
| `Thieving` | Thieving | skills | yes | Thieving: pickpocketing NPCs, opening coin pouches, stealing from stalls, blackjacking, the ham trapdoor, the Ardougne castle doors, Dorgesh-Kaan's rich chests and the Isle of Souls Dungeon chest. (members only) |
| `Woodcutting` | Woodcutting | skills | yes | Woodcutting: chopping trees with the Forestry despawn timer, stump respawns, the logs-chopped tracker, and bird's nest and ring drops. |
| `Authoring.CacheEditor` | CacheEditorAuthoring | tools | yes | Opens a loopback-only writable service for the cache editor that saves overlay rows and uploads, and only when explicitly enabled for local development. |
| `Catalog.CacheEditor` | CacheEditorCatalog | tools | yes | Serves read-only cache data to the cache editor page and applies its saved overlay rows at startup so authored changes are live on the next boot. |
| `WorldAdmin` | WorldAdmin | tools | yes | Local web page for editing world.json settings and plugin switches. |
| `BeginnerTreasureTrails` | BeginnerTreasureTrails | treasuretrails | yes | Beginner clue scroll trails: the clue runtime, rewards, collection log count and the minor and major scroll case capacity. |
| `CasketRewardScreen` | CasketRewardScreen | treasuretrails | yes | Shows the reward screen when opening elite and master clue caskets, then delivers the items to the inventory or ground when it closes, even across logout. |
| `ClueCapacity` | ClueCapacity | treasuretrails | yes | Limits how many clue scrolls, caskets and vessels a player may hold across all six tiers, including case and Mimic bonuses, and opens nests, bottles and geodes. |
| `RewardCaskets` | RewardCaskets | treasuretrails | yes | Rolls the reward items for a treasure trail casket by tier when the trails plugin asks, applying the player's unique-roll multiplier. (members only) |
| `TreasureTrails` | TreasureTrails | treasuretrails | yes | Clue scroll treasure trails: clue steps, caskets, STASH units, puzzle boxes, skill and light clues, Falo, hot-cold devices and Watson. (members only) |
| `ArceuusLibrary` | ArceuusLibrary | world | yes | Arceuus Library: customers Sam, Professor Gracklebone and Villia request books, shelves are searched for the rotating layout, and the book is handed in. (members only) |
| `AttackDummies` | AttackDummies | world | yes | Lets players Attack training dummies: plays the hit and defend animations and gives Attack XP up to level 7, with a message on ranged attacks. |
| `BalloonTransport` | BalloonTransport | world | yes | Balloon transport after Enlightened Journey: Auguste's balloon map, trips between Entrana, Taverley, Varrock, Castle Wars and others, and shared log storage. (members only) |
| `BarnabyFerry` | BarnabyFerry | world | yes | Captain Barnaby's ferry from the Ardougne, Brimhaven and Rimmington docks, with his dialogue and a fade between ports. (members only) |
| `BirthdayAnniversary` | BirthdayAnniversaryEvents | world | yes | The 25th Anniversary '25 Years, 25 Mementos' event and the 13th birthday event, running in their calendar windows or forced with ::forceevent. |
| `Canoes` | Canoes | world | yes | Canoe travel: shape a canoe at a canoe station and paddle it to the other stations, from Lumbridge up to the Wilderness. |
| `CharterShips` | CharterShips | world | yes | Charter ship crew: pay a fare to sail between ports on the map, or trade with them, with Ring of Charos discounts and Sailing ports. (members only) |
| `ChristmasDinner` | ChristmasDinner | world | yes | The Christmas 2025 Dinner event: scene, NPC dialogue, serving platters, escort and completion cutscene and rewards, running only in its calendar window. |
| `CrossFloor` | CrossFloor | world | no | See nearby players, NPCs, ground items and temporary objects on lower floors. |
| `Darkness` | Darkness | world | yes | Makes Lumbridge Swamp Caves dark: without a lit light source you are warned, then bitten by insects every tick, and cannot attack. |
| `DateMinutes` | DateMinutes | world | yes | Sends the client the current minute since 1970 on login and each new minute, so home and minigame teleport cooldown timers can display. |
| `DefinitionArchives` | DefinitionArchives | world | yes | Installs bundled item, NPC and object definition changes at runtime and sends them to every client on login and when they change. |
| `DesertTreasureScoreboards` | DesertTreasureScoreboards | world | yes | Unlocks the Desert Treasure II post-quest scoreboards for players who completed the quest, setting the shared scoreboard varbit on login and completion. (members only) |
| `EagleTransport` | EagleTransport | world | yes | Eagle transport after Eagles' Peak: flights between the Eagles' Peak eyrie and the desert, jungle and polar eyries, and the routes in on foot. (members only) |
| `EasterEvents` | EasterEvents | world | yes | The 2026 Easter event 'The brave chocolate egg': hunt Archibald around Varrock using the scribbled notes and egg box, within its calendar window. |
| `EditModeApi` | EditModeApi | world | yes | Serves the local map editor read-only world data (zones, object and NPC spawns) over the content API, in development builds only. |
| `EventScheduler` | EventScheduler | world | yes | Opens and closes seasonal event windows from the events calendar, handles event reward claims, and adds the owner-only ::forceevent command. |
| `FairyRings` | FairyRings | world | yes | Fairy rings: the three-dial interface for all 64 codes, travel log with favourites, last-destination, quest-gated rings and the Zanaris exit rings. (members only) |
| `Ferries` | Ferries | world | yes | NPC ferries without another home: Entrana monks, Void Knight squires, Veos, Rellekka boats, Captain Bentley, Jeb, Achilka's riverboat, Andras's Slepe boat and others. (members only) |
| `FishingCrane` | FishingCrane | world | yes | Repair broken fishing cranes in Port Piscarilius with a hammer, planks and nails (30 Crafting and Construction); one success also repairs for helpers nearby. (members only) |
| `FreeMovement` | Free movement | world | yes | Continuous free movement: moves players by client input at walk and run speed with server-checked timing, and sends fine positions to observers. |
| `GameUpdate` | GameUpdate | world | yes | Adds the owner-only ::gameUpdate command to schedule a server shutdown, pushing a live countdown to every player until it restarts. |
| `GnomeGliders` | GnomeGliders | world | yes | Gnome glider pilots: the glider map, flights between destinations with the fade and last-destination option, needing The Grand Tree. (members only) |
| `Gravestones` | Gravestones | world | yes | A PvM death leaves a gravestone only you can see for 15 minutes, then items go to Death's Office. Can be turned off for the older drop behaviour. |
| `HalloweenEvents` | HalloweenEvents | world | yes | The 2025 Halloween Spook-a-thon Decoration Contest, with its dialogue and spooky chair items, running only in its calendar window. |
| `HolidayRewards` | HolidayRewards | world | yes | Diango's Holiday-items interface to reclaim lost holiday items, tracking which rare holiday items and alternate styles a player has unlocked. |
| `IntelligenceGathering` | IntelligenceGathering | world | yes | Intelligence Gathering: the information board, Captain Ginea's hand-in and the timed gang meetings with a boss and gangsters. (members only) |
| `KeldagrimMinecarts` | KeldagrimMinecarts | world | yes | Keldagrim minecarts: conductors sell tickets, with rides between Keldagrim, Ice Mountain, White Wolf Mountain and the Grand Exchange. (members only) |
| `LadyOfTheWaves` | LadyOfTheWaves | world | yes | Captain Shanks on the Lady of the Waves sells a ship ticket after Shilo Village and sails you to Port Khazard or Port Sarim. (members only) |
| `LakeMolchBoaty` | LakeMolchBoaty | world | yes | Lake Molch's Boaty: Board rows between Molch, Battlefront, Shayzien and Molch Island. (members only) |
| `LocTeleports` | LocTeleports | world | yes | Handles ladders, stairs, caves and holes with no other handler from captured data, plus opening and closing trapdoors, with level, item and quest gates. |
| `LovakengjMinecarts` | LovakengjMinecarts | world | yes | Lovakengj minecart network: twelve stations across Great Kourend and the Kebos Lowlands, 20 coins a ride until The Forsaken Tower makes them free. (members only) |
| `MagicCarpets` | MagicCarpets | world | yes | Rug Merchants fly riders by magic carpet between Shantay Pass, Pollnivneach and other desert stations, with fares, discounts and captured flight paths. (members only) |
| `MagicMushtrees` | MagicMushtrees | world | yes | Fossil Island's Magic Mushtrees: the four-tree travel menu, with each tree unlocked per player once used. (members only) |
| `ManagingMiscellania` | ManagingMiscellania | world | yes | Managing Miscellania: pay the kingdom's coffers and Advisor Ghrim collects daily coal, logs, herbs, flax, fish, hardwood and seeds, scaled by approval. (members only) |
| `MultiCombatApi` | MultiCombatApi | world | yes | Serves the bounds of multi-combat zones to the client over the content API, without exposing the full development world data. |
| `Museum` | Museum | world | yes | Varrock Museum Kudos: the Dig Site cleaning activity, display cases, Historian Minas's quest timeline reports and Curator Haig Halen's salvaging relics. (members only) |
| `Music` | Music | world | yes | The music tab: track unlocking, jukebox selection, now-playing, the music cape from Olaf the Bard and air guitar unlock. |
| `PlayerOnlineTimer` | PlayerOnlineTimer | world | yes | Tracks each player's current session and lifetime online seconds, for other plugins to read through events. |
| `ProceduralRegionStream` | ProceduralRegionStream | world | yes | Developer ::procregion command that generates and streams a procedural town of buildings and streets into a map region for the staff member. |
| `Quetzals` | Quetzals | world | yes | Quetzal Transport System: Renu's flights, landing sites, quetzal whistles and recharges from Pitri, and Primio's Varrock to Fortis trips. (members only) |
| `SandPits` | SandPits | world | yes | Using an empty bucket on a sandpit fills all empty buckets, one every two ticks. (members only) |
| `ShiloCart` | ShiloCart | world | yes | Shilo Village carts: board with Hajedy or Vigroy, or Pay-fare, between Brimhaven and Shilo Village, free after the elite Karamja Diary. (members only) |
| `SpiritTrees` | SpiritTrees | world | yes | Spirit tree network: the location menu, travel, talk-to and last-destination, with trees you cannot use greyed out. (members only) |
| `TableItems` | TableItems | world | yes | Using a tradeable item on a table places it there, visible to others after 60 seconds and despawning after 10 minutes. |
| `WaterSources` | WaterSources | world | yes | Using an empty jug, vial, bucket, bowl, cup, fishbowl or waterskin on a fountain, sink, well, pump or tap fills them one per tick. |
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
