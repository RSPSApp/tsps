# Bot combat training

`::bot combat_training` spawns a new melee trainer at the invoking player's position.
The existing bot activity command can also assign `combat_training` to a controlled bot.
Commands retain their existing developer permissions.

Bot population lives in `data/definitions/bot-sites.json`: one `sites` array for skilling and
PvP alike. A site is a place (`x`, `y`, optional `z`/`radius`), an `enabled` flag (temporary,
until /host controls sites) and its `bots`. Skilling sites ship **disabled** (no skilling or
combat-training crowd on a fresh world); set `"enabled": true` on one to spawn it. Each
enabled skilling site spawns its bots around its anchor at startup, a few per game tick
(`SpawnPacing.PlayerBots.js`: 8 per 600 ms, round-robin over the sites, so 1000 bots take ~75 s). Without `switchMinutes` each
bot is dedicated to one mode's activity: it never switches, and a failed activity waits out its
cooldown and resumes. With `"switchMinutes": [15, 25]` each bot rolls its own timer in that range
and then changes to another mode of its tier at the site, weighted by the site's counts for that
tier so the mix stays near the configured one (a Varrock novice never becomes a woodcutter when
Varrock only has expert woodcutters). Switches wait for a safe point: never mid-fight or under a
bank-trip/fight-back overlay, and a switch with no free capacity slot retries 30 s later.

**Per deployment:** a world chooses its own sites in `data/definitions/world.local.json` (gitignored; or `world.json`) with `pluginConfig` `"PlayerBots:sites"`, a map of site id to an object of site properties (`plugins/bots/brain/Sites.PlayerBots.js`). For a site `bot-sites.json` has, the properties replace its own, each top-level property whole, so `bots` sets every count at the site; sites and properties the map doesn't name keep theirs. Any other id is a new site and needs `x` and `y`. A world updates from main by fast-forward without touching `bot-sites.json`. For example, skilling and combat-training bots on, the PvP pens off, Lumbridge cut down to woodcutters, and a Draynor fishing site:

```json
"pluginConfig": {
  "PlayerBots:sites": {
    "varrock": { "enabled": true }, "falador": { "enabled": true }, "seers": { "enabled": true },
    "east_ardougne": { "enabled": true },
    "edge_low": { "enabled": false }, "edge_mid": { "enabled": false }, "edge_mains": { "enabled": false },
    "varrock_ditch": { "enabled": false }, "green_drags_gate": { "enabled": false },
    "revs_entrance": { "enabled": false },
    "lumbridge": { "enabled": true, "bots": { "woodcutting": 20 } },
    "draynor": { "enabled": true, "x": 3093, "y": 3244, "bots": { "fishing": 20 } }
  }
}
```

A value that isn't an object, or a new site without integer `x` and `y`, is warned about at startup and ignored.

Trainers find their NPCs through the NPC cluster index (below), so they fan out across every
nearby group of their tier's monsters. The skilling
activities cap how many bots run each one at once (`capacity`), the rest train combat. Change the counts in `bot-sites.json`;
leave sites disabled for a bot-free world. `maxFailedTargets` (default 6) sets how many targets or frozen routes in a row
without landing damage fail a training site; that cluster is then skipped by the bot for 10 min.

The activity uses the lowest permanent level of Attack, Strength and Defence to choose a
melee training tier. Between kills it selects the combat style for the lowest of those three
skills. A temporary boost does not promote a bot; drained stats cannot unlock equipment.
Each trainer is assigned melee, ranged or magic from the activity's `styles` config
(deterministically per username). Ranged trainers level Ranged with tiered bows and arrows,
and magic trainers level Magic with tiered staffs, autocast low-level strike/bolt/blast
spells and carry the matching runes; their site and gear tiers follow the trained skill.

| Lowest trained level | Stage | Opponent combat levels (`npcLevels`) | Found near the Lumbridge spawn |
| --- | --- | --- | --- |
| 1–9 | `beginner` | 1–5 | rats, men, goblins, cows, chickens, spiders; swamp rats and frogs |
| 10–19 | `novice` | 2–13 | goblins, cows, swamp frogs, big and giant frogs, giant rats |
| 20–39 | `intermediate` | 9–27 | big/giant frogs, Al Kharid warriors, scorpions, unicorns, barbarians, guards |
| 40–59 | `advanced` | 20–45 | guards, desert wolves, skeletons, black knights, hill/moss giants |
| 60+ | `expert` | 45–100 | little nearby: East Ardougne has paladins, heroes and wolves; Seers' has ice giants and wolves |

Lumbridge and Varrock have almost nothing in the expert band nearby, so their sites give
combat training per-tier counts with no advanced or expert trainers; East Ardougne takes them.

Stages give an NPC combat-level band - no names, coordinates or areas. Opponents are any
attackable NPC in the band; `excludeNames` (`Duck`, `Duckling`) drops ones that cannot be
fought where they stand. The NPC cluster index (`plugins/bots/brain/NpcClusterIndex.PlayerBots.js`)
groups the live world's spawns by combat level into 32x32-tile cells (spawn tiles, so
wandering does not move a cluster), skipping the surface Wilderness, instances and, on a F2P
world, members land. A trainer picks the cluster with the lowest `trainers per NPC +
distance / spreadDistance` (`spreadDistance`, default 150 tiles), so near, roomy clusters fill
first and bots spill outward in proportion to cluster size; its targets must be within 24
tiles of the cluster centre. Clusters the route planner cannot reach (Shantay Pass, Draynor jail, islands) are skipped;
a walk that freezes makes only that trainer skip the cluster for 10 minutes. The same index groups by NPC name for
fishing spots, which are NPCs too.

These are configurable simulated-player preferences, not changes to monster mechanics or
an optimal XP guide. Chicken training is consistent with the OSRS Wiki's beginner melee
training guidance; subsequent starter-monster choices follow the requested progression:
https://oldschool.runescape.wiki/w/Pay-to-play_melee_training
https://oldschool.runescape.wiki/w/Free-to-play_melee_training

Each visit lasts 5–12 minutes, including travel. On expiration or a tier promotion, the
bot finishes its current fight before starting another visit, at another cluster than the
last. Guards are the final implemented
tier; this activity does not yet cover advanced PvM.

## Runtime behavior

- Uses the existing segmented movement requests to travel from its spawn to a training
  site, and the normal combat engine to follow and attack NPCs. It does not teleport or
  award XP directly. A route blocked by a closed door or gate makes the brain open the
  door that actually makes the target reachable (checked by re-pathing with the door's
  clipping temporarily removed), then retry the route before falling back to the existing
  stall/repick handling. Doors are not filtered by direction: a walk to a fenced site parks
  the bot on the fence tile nearest the target, usually already past the gate. Checked
  against the real map: every site is reachable from the Lumbridge spawn and from inside
  the castle, opening the cow-field and chicken-coop gates on the way.
- Looks up nearby NPCs using World's existing spatial update buckets, not a full world
  scan. Matches attackable NPCs in the stage's combat-level band near the chosen cluster, on the same plane and in the
  same private area. Checks normal combat permission and excludes dead/unregistered NPCs.
- Avoids taking another player's target. A shared expiring NPC claim prevents two trainers
  choosing the same idle target during one tick.
- Uses the existing simulated-bot provisioning model: each trainer picks a stable random
  loadout from configurable tier pools (`gearTiers`, `rangedTiers`, `magicTiers` in
  `bot-activities.json`) of low-level monster drops - bronze/iron/steel weapons, bows and
  arrows, staffs and runes, bronze/iron/leather/wizard armour, capes, gloves, boots,
  amulets - plus a stock of trout between fights. Attack and Defence (or the trained
  ranged/magic skill) unlock gear tiers independently, and individual slots can roll empty,
  so trainers spawn with partial outfits. Cache-derived equipment requirements are still
  checked. Food consumption uses the existing bot support action. This does not implement
  purchasing, loot collection, or an economy-funded equipment progression.
- Abandons targets with no movement/damage progress for 45 seconds; a site with no progress
  for two minutes fails and enters the existing activity cooldown. Death clears the current
  target/site; after the server respawns the bot it provisions and travels again without
  resetting earned skill levels.
- Replacing a brain now calls its action cleanup from top frame to bottom, so training
  cannot leave combat following or a target reservation behind.

The definitions live in `data/definitions/bot-activities.json`; `trainCombat` is a shared
brain action with per-player state, and its gear tables live in
`data/definitions/bot-combat-gear.json` (the activity references them by `gearRef`). It can
participate in future general-purpose activity selection without adding another bot runner.

## Validation

Extended `tests/bot-brain.test.cjs` covers starter targets, independent equipment upgrades,
balanced styles, promotion after a fight, session expiration, higher tiers, walking from
home, contested/dead/forbidden NPCs, shared claims, stalled targets, death, brain replacement,
real-core activity compilation and canonical NPC spawns at every configured site.

Run from `server/`:

```sh
node --test tests/bot-brain.test.cjs tests/pvp-retreat.test.cjs tests/pvp-f2p-eat.test.cjs tests/player-bot-cap.test.cjs
```

The tests verify movement requests and normal combat handoff. Full travel through gates,
combat animations, food use over extended play, and XP progression have not been verified
in a running world. The existing navigation's ability to reach each site must be checked
in-game. Start a fresh trainer with `::bot combat_training`, observe arrival/kills/XP, then
assign
trainers with all three melee stats at 10, 20 and 40 to check the subsequent sites. Confirm
another player fighting a training NPC is never displaced.

## Gathering and stuck-bot handling

- Gatherers find trees/rocks through the object index: live objects within 64 tiles, else the
  nearest indexed one up to ~512 tiles away. Only objects offering the action's option count
  ("Chop down", "Mine"): 149 of 216 objects named "Tree" are unchoppable scenery. Each bot claims
  its tree/rock (10 s, refreshed while targeted); after a minute with everything in range claimed
  the bot picks one spot past 64 tiles, so a lasting crowd moves on instead of queueing.
- A bot commits to its far spot: it does not re-pick halfway (no turning back), and on arrival
  it waits for respawns. Far spots must have a planned route (the planner's cached verdict), so
  an island is never chosen. A walk that gets no closer for 60 s while more than 20 tiles away
  makes that bot alone skip the spot for 10 min. Nothing is blacklisted for everyone on the
  strength of a failed walk: resources never run out, and a slow walker says nothing about
  the spot.
- Before clicking, the bot checks it can really reach the object (wall-aware). Otherwise it walks
  at it with brain movement, which opens gates. Three attempts from the same tile with nothing
  produced make that bot alone use another object for a while (2 min if it was right next to it,
  10 min if it never got near). Nothing is blacklisted for every bot, and depletion is never a
  failure: a depleted rock is a different object, waited out until it respawns.
- A trainer that reaches its cluster waits there for a target. A frozen walk skips only the NPC
  it was walking at; one that stops within the cluster radius trains from there; only a walk that
  never gets near marks the cluster unreachable for everyone.
- `::botinfo <bot>` (developer) prints a bot's activity frames, training cluster / gathering
  target, pending walk, door attempt and when its brain last ticked.


## Full inventory (skilling)

Gathering templates end with a `choose` step: each time the inventory fills, a weighted option
is rolled and its actions run in order, then the activity repeats (back to gathering).

Raw resources are never banked: bot banks are never used, so anything in them is lost to the
economy. Only end products (bars, cooked fish) are banked, and only those items (`bank` with
`itemIds`). Every option weighs 1:

| Option | Woodcutting (`chop_trees`) | Mining (`mine_rocks`) | Fishing (`catch_fish`) |
| --- | --- | --- | --- |
| drop the resources and keep going | yes | yes | yes |
| sell to the nearest general store | yes | yes | yes |
| burn the logs | yes | - | - |
| process, then bank the end product | - | smelt, bank bars | cook, bank fish, drop burnt |
| process, then sell / drop | - | smelt | cook |

Any step can name a fallback with `orElse`, run when it fails. Banking falls back to selling,
and selling to dropping, so a bot with no reachable bank or store still empties its bag and goes
back to its activity:

```json
{ "type": "bank", "itemIds": ["$bar"],
  "orElse": { "type": "sellItems", "itemIds": ["$bar"], "orElse": { "type": "dropItems", "itemIds": ["$bar"] } } }
```

- `choose` (`actions/Choose.PlayerBots.js`): `{ "type": "choose", "options": [{ "weight": 2, "actions": [...] }] }`,
  usable at any step of any activity.
- `sellItems` (`actions/SellItems.PlayerBots.js`) walks to the nearest general store keeper (stores matched by
  name in `shops.json`, keepers located through the NPC cluster index) and sells the listed items
  through the normal shop code; anything unsellable stays in the inventory.
- `dropItems` / `sellItems` take `itemIds` from the activity's fields: `resources` (what it gathers)
  and, for mining, `smelted` (the bar plus leftover ores). `bar` names the smelting recipe
  (copper + tin -> `Bronze bar`); unpaired ores are what the follow-up bank/sell/drop handles.
  - Combat supplies are training-only: when combat training stops (switching to skilling, failing,
  a brain reset) the trout and runes it provisioned are taken back, so a skiller starts with a
  free inventory. The next fight re-provisions them; equipped arrows stay.
- A walk to a bank that leaves the bot standing for 20 s makes that bot alone use the next-nearest
  bank for 10 min; with none left the bank step fails and its `orElse` (sell, then drop) runs.

## No free resources

Bots are given tools (axe, pickaxe, tinderbox, training weapons/armour) but never resources:
smelting and firemaking are only follow-ons of mining and woodcutting (above), using what the
bot just gathered. Site bots start with an empty bank, so there are no standalone smelting or
firemaking activities, and a test fails if any activity withdraws from the bank. A test fails if any activity uses `ensureItem` for something other than a tool. Combat
consumables (food, runes, arrows) are still provisioned for training, taken back when training
stops and not dropped on NPC deaths, so they never reach banks, shops or the ground.
- Far-from-player bots think on a due-time schedule (every LOD stride since they last ran), not
  `(cycle + shard) % stride === 0`, which aliased with the task budget's round-robin and left some
  bots without a brain tick for minutes.


## Long-distance routes

The in-game route finder only sees a 128x128 window, so straight-line staged walking could not
find detours: miners for Varrock's mine walked into the fenced Lumbridge cow field, the
Champions' mine needed a loop back out of the far-west cow field. Long walks now follow a
planned route (`behaviours/navigation/LongRoutePlanner.PlayerBots.js`, wired in by `LongRoutes.PlayerBots.js`):

- A* over tile collision flags, 4-directional, using the route finder's own blocking rules. A
  step through a wall is allowed only at a closed door/gate (resolved per player, so the Al
  Kharid toll gate counts); the brain opens it on arrival. The search box starts at the two ends
  plus 64 tiles and doubles when no way through is found; a goal on water settles for the
  nearest reachable tile only after the widest search. 120k tiles max per plan.
- Waypoints every 12 tiles plus both sides of each door crossing. The far side of a gate must be
  stood on: proximity across a fence never counts as passing it.
- Used for walks over 32 tiles, or any walk a straight dispatch already failed to path.
- Routes are cached by destination area (16x16, 10 min); a bot joins a cached route at the
  furthest nearby waypoint it can actually walk to. Failed plans are cached for 5 min. Planning
  is capped at 60 ms per game tick; a bot choosing a far spot or combat site waits for the
  planner's verdict rather than walking blind (straight-line into the sea).
- Cost (warm): 1-3 ms for Lumbridge -> Al Kharid / Varrock; ~25 ms to prove an island
  unreachable (cached).

## Other floors (stairs and ladders)

A walk whose target is on another plane (Lumbridge castle's top-floor bank) goes by the stairs
(`brain/Climbing.PlayerBots.js`), using the cache-backed links from `plugins/objects/ClimbLinks.js`; no
coordinate lists. Stairs are searched near the bot and near the target; one counts only if the
bot can get to it (door-aware) and its landing leads on: to the target, or to further stairs that
do. That passes over Lumbridge castle's tower ladders, whose top rooms do not reach the bank.
The walk heads for the stairs (`request.climbVia`), the bot clicks the climb option once in reach,
and carries on from the new floor. Banks look for booths on every floor, 15 tiles further per
floor.

## Bots standing around

- Every action that ends drops its pending walk (`BotBrain.stopAction`), and a walk that finds no
  path 3 dispatches in a row with no door to open is dropped: the next action re-decides
  instead of waiting forever (bank walks onto a booth tile, rock approaches).
- Trainers settled at a cluster with nothing attackable (caged jail NPCs, all claimed) move on
  after 45 s.
- LOD: bots far from real players run every 4 cycles (was 12), medium every 2, with a 60 ms per
  tick budget. A CPU profile with 615 players had the server 87% idle and bots under 10%.

## Fishing and cooking

Tiered like the other skills, one activity per tier (template `catch_fish`):

| Activity | Level | Tool | Spots | Fish |
| --- | --- | --- | --- | --- |
| `net_fishing` | 1 | small fishing net | Small Net/Net spots | shrimps, anchovies |
| `fly_fishing` | 20 | fly fishing rod + feathers | Lure spots | trout, salmon |
| `lobster_fishing` | 40 | lobster pot | Cage spots | lobster |
| `harpoon_fishing` | 60 | harpoon | Harpoon spots | tuna, swordfish |

Spots are NPCs, so they come from the NPC cluster index, keyed by the tool each spot option takes
(`Fishing.spotTools`, from the cache option list), and a fisher picks a cluster as a combat trainer
does: fewest fishers per spot plus distance, skipping clusters the route planner cannot reach
(Karamja) or it never gets closer to (the Fishing Guild below 68). Fishing goes through the fishing
plugin's own NPC option handler (`api.emitNpcInteraction`). Feathers are lent like a combat bot's
runes and taken back when the step ends, so they never reach a bank.

On a full inventory: bank, drop, sell, or cook then bank/sell/drop. `cook` uses a range within 24
tiles (object catalog `range`), else a fire within 8; with neither it drops a fish for room, chops
one log (axe as a tool), lights one fire and cooks on it, through the cooking plugin's item-on-object
handler (`api.emitItemOnObject`). Food the bot's Cooking level cannot cook is left raw.

## PvP (wilderness) bots

Configured in the same file, under `"pvp"`: `botPool` (how many `WildyBot` names exist),
`activeRegionBotsPerRegion` / `activeRegionInset` (regional spread around players). Sites with a
`pvp` block define hotspots: `bots` sets their population and `pvp.combat` their level band.
`pvp.loadouts` lists the loadout groups from `pvp-bot-loadouts.json` the site's bots wear. Without
it, `pvp.style` picks every group tagged with that style (f2p groups only for the `f2p` style).

Regional bots fill attackable regions around players: `activeRegionBotsPerRegion` in each one
(16 by default), whether it is levelled Wilderness or a town on a PvP world.
Hotspot bots count towards that region's target. Persistent Wilderness clusters are smaller:
12 low-level, 10 mid-level and 14 main bots at Edgeville, 40 at Varrock Ditch, and 4 each at
Green Dragons and the Revenant Caves entrance. Safe tiles and buildings still cannot spawn bots.

Regional bots give the low-level pure and rusher loadouts higher weights, so roughly a third
of their members-world population is one Defence with no protection prayers.
Novice and standard bots eat at 35% and 40% HP and use single food; veterans and elites can
combo eat and react to imminent lethal damage, with elites reacting more reliably. Restores
are consumed at 8%/15%/24%/30% Prayer by tier, through real doses and potion cooldowns;
one-Prayer builds do not waste them. Free-to-play food timing keeps its existing rules.

Regional bots and hotspot bots both draw from the gear catalogue, including its random equipment
pools and profile-gated valuable weapons. Hotspots keep their combat bands, and Varrock Ditch
uses only free-to-play loadouts. A bot keeps its selected archetype when it regears.
Equipment pools select only gear the archetype's stats can wear, so a rejected random armour
choice cannot leave a slot empty when a wearable alternative exists.

Bounty Hunter fills a capped roster of 60 bots, one per tick, while a real player is in the
fort or arena. Twelve bots occupy each combat band: 32–80, 81–100, 101–110, 111–120 and
121–126, using eligible members-world archetypes from the existing catalogue. Departures
refill the least-populated band. Profiles progress from novice and standard to veteran, with
half the two highest bands using elite behaviour. All use the same `pvp` brain as Wilderness
bots, including real food, prayers, gear switches and special attacks.

Crater spawns cache tiles beside each sigil with an exact route to the fort, avoiding the
claws' enclosed pockets. Death marks the kit for recovery even when coins or a protected item
remain. Bots can choose to fight with their last meals, but zero food always commits them to
walking through an arena gate and logging out; escaping never gives free supplies.

The shared `player-bots:pvp-loadout` event lets the Bounty Hunter loadout unit upgrade eligible
crater kits before they are equipped and their special weapons/ammo are indexed. The mappings
in `bountyhunter/data/bot-gear.json` add BH dark bows, abyssal daggers, Vesta's longswords,
Statius's warhammers and Ancient Warriors armour, respecting the preset's equipment requirements.
Other areas retain their ordinary kits.

Bot gear is lootable under the usual skull/protection rules, including gear loaded through a
player preset while PvpMode is enabled. Eligible kills put the loot on the ground or in a Loot
key according to the killer's settings. Human preset items keep their usual restrictions.

A wilderness bot's brain runs `pvp` with no rotation, so it only ever returns to `pvp`. The pvp
loop reports progress while the bot fights or moves; before that, the brain's 3-minute stall check
ended it and the bot was handed a random activity (WildyBots skilling in Lumbridge).

### Optional PvP bot behavior update

This is an optional server customization, not a bug fix or implementation of missing content.
Adopting it replaces the existing PvP chatter and applies a Smite-only overhead prayer policy
at the three existing Edgeville sites: `edge_low`, `edge_mid` and `edge_mains`.

Random chatter occurs every 15–30 seconds during active player-versus-bot or bot-versus-bot
fights. Greetings, protection-prayer complaints, high-HP eating reactions, kills and deaths
have independent 50% reaction chances. Eating reactions use HP before healing and include
exactly 75% of maximum HP. Prayer complaints only respond to Protect from Melee, Missiles
or Magic; switching away from protection cancels a queued opening complaint. Death lines
appear during the death animation.

A scheduled task checks tracked fights each game tick and removes idle, dead and departed
participants. The Edgeville sites set `pvp.smiteOnly: true`: bots at every difficulty use
Smite when their Prayer level and points allow it, and do not select protection overheads
during combat or post-kill replenishing. Novices still omit offensive combat prayers.
The `pvp.smiteOnlyRegions` list also applies the policy by location to roaming and recruited
PvP bots visiting Edgeville, regardless of their spawn assignment. Existing protection
prayers clear on the next brain turn, including while idle. Other sites retain their usual
prayer choices outside these regions. This is a server policy choice, not an OSRS parity
requirement.

Messages from different bots sharing a fight are staggered by at least one second and
appear on the next eligible game tick; unrelated fights remain independent. Random chatter
cooldowns start when a line is displayed. Queued lines are discarded when they no longer
apply. Strength-level questions only roll against melee opponents and Range-level questions
against ranged opponents, using the opponent's current style when the line is displayed.

The expanded line pools cover fight starts, mid-fight chatter, prayers, high-HP eating,
kills and deaths. The exported `getRandomLine(category, data)` selector accepts `chatter`,
`start`, `prayer`, `safing`, `kill`, `death` or `rng`. For `rng`, `isSplash: true`
selects "Nice splash" and `isZero: true` selects "0-0-0-0 nice RNG"; splash takes priority.
Unmatched data uses the random RNG pool.

## Test tiers

With every site enabled, startup spawns 1000 bots: 200 each at Lumbridge, Varrock, Falador,
Seers' Village and East Ardougne market. A skilling site's `bots` maps each mode to a count:

```json
{ "id": "lumbridge", "enabled": false, "x": 3222, "y": 3218,
  "bots": { "combat_training": 80, "woodcutting": 50, "mining": 40, "fishing": 30 } }
```

A number is split evenly over the tiers (the lowest tiers take any remainder), giving runtime
sites `<site>_<mode>_<tier>`, e.g. 30 woodcutters are 8/8/7/7 from novices to experts. An
object sets per-tier counts instead, and tiers it leaves out get none. Varrock's yew-only
woodcutters are `"woodcutting": { "experts": 50 }`. Leave a mode out for none of it; an unknown
mode or tier fails startup.

The tiers themselves live in `bot-activities.json`: each has a `skills` band, which every
non-combat skill rolls inside at spawn (agility is always 99), and a `combat` level band, which
the combat stats are rolled to land in (hitpoints at least 10):

```json
"novices": { "skills": [1, 19], "combat": [3, 30] }
``` 
Sites never list content: per mode, a tier does the highest-level activity its band's lowest
level can do (a 60 woodcutter chops yews, not normal trees). Spawn radius defaults in
`ActivityRegistry.PlayerBots.js`. Gear — combat kit and the best usable axe/pickaxe —
follows from the levels. Trees, rocks, banks, stores and NPC clusters are found from wherever
the bot is, so the same activities work in every town. Activity capacities are global
(shared by all towns).

A PvP site has a plain `bots` count and a `pvp` block instead; it becomes a wilderness hotspot.
Its `style` is a loadout tag (`pure`, `mid`, `main`, `deep`, `f2p`) and every loadout in
`pvp-bot-loadouts.json` carrying that tag is its gear. Optional: `combat` band, `profiles`,
`weights` (seek/bait/fight/escape), `roam`, `lingerMs`, `maxFights`, and an `area` when the
square of `radius` around x/y doesn't fit.

| Tier | Skills / combat level | Activities |
| --- | --- | --- |
| `novices` | 1-19 / 3-30 | combat training, normal trees, copper/tin, net fishing |
| `intermediates` | 20-39 / 30-60 | combat training, oaks, iron, fly fishing |
| `advanced` | 40-59 / 60-90 | combat training, willows, coal, lobsters |
| `experts` | 60-99 / 90-126 | combat training, yews, mithril, harpoon |

Level 40-90 NPCs near Lumbridge are almost all past the Shantay Pass or the River Salve, which
the route planner cannot reach, so the expert band starts at 30.

