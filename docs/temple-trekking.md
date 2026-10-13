# Temple Trekking

**`TempleTrekking`** (`server/plugins/minigames/TempleTrekking.plugin.js`, units in `templetrekking/`, data in `server/plugins/minigames/data/temple-trekking.json`) covers [Temple Trekking](https://oldschool.runescape.wiki/w/Temple_Trekking) and its reverse, the Burgh de Rott Ramble: escort a follower between Burgh de Rott and Paterdomus by one of three routes, deal with what comes up on the way, and claim a reward token.

| Unit | What it does |
| --- | --- |
| `Common` | The data, tick timing, the fade, varbits, dialogue helpers, saved attributes |
| `Trek` | One trek: the hub, the route map, the walk, rolling events, rooms as instances, Continue-trek / Evade-event / Escape, arrival and the token, logging out |
| `Followers` | The twelve trekkers: visibility from the quests, Talk-to, Escort, Supply, the shared backpack, eating from it in a fight |
| `Combat` | Ghasts, giant snails, swamp snakes, vampyre juvinates, nail beasts and shades |
| `Bridge`, `River`, `Boat`, `Samaritan` | The puzzle events, the boat on route 3 and Abidor Crank |
| `Rewards` | The token's reward interface and the tomes |
| `Commands` | `::trek [temple\|ramble] [easy\|medium\|hard]`, `::trekevent <event\|off>` |

## Sources

- **rsprox captures** (https://rsprox.net/database, recordings 83, 102, 1149, 1637, 1846, 1875): several complete treks both ways on all three routes, with ghasts, snails, snakes, juvinates, nail beasts, shades, the bridge (lumberjack version), the river, the boat, Abidor Crank, Evade-event, Escape and the rewards interface. They are all Leagues V worlds (rev 226-237), so rates and rewards there may differ from the main game; the ids all match the rev 241 cache.
- **The Wiki:** Temple Trekking (rules, routes, points, the reward formula and ranges, event descriptions), the follower transcripts, Abidor Crank, Reward token, Nail beast (drops), Tome of Experience.
- **The cache:** every id, under its gameval name (`templetrek_*`, `ramble_*`, `trek_rewards`, `templetrek_map`), and the follower stats (cache npc levels).

## Who can trek

The trekkers are cache multinpcs: `templetrek_multi_*` (2934-2939) show their follower while `templetrek_npcs_visible` (1954) is 1, `ramble_multi_*` (2940-2945) while `ramble_npcs_visible` (3412) is 1. They are set at login and when a quest completes: In Aid of the Myreque for Temple Trekking, Darkness of Hallowvale for the Ramble.

Escort (op 3, or the last Talk-to option) with a pet out gets the captured "Hmmm, it seems that you have a follower..." and nothing more (the Pets plugin answers `pets:current`).

## The walk

| Tick | What happens (captured) |
| --- | --- |
| Escort agreed | `templetrek_button_control` 1, fade out |
| +1 | `minimap_state` 2 |
| +2 | Into a one-chunk instance of 2048,5040 (the "hub", player at 2052,5042), the follower spawned beside, `follower_npc` = (npc id << 16) \| index, side tabs 0-6, 11, 12 closed |
| +3 | Fade in, "Okay, which route should we take?" |
| Continue | `templetrek_map` (329) as the main modal with `templetrek_trip_anim_initial_start` (or `ramble_trip_anim_initial_start`) on `templetrek_player_counters` |
| Select | The route's message, `busy` 1, trip 1's sequence; the map is re-opened with the next trip's sequence every 3-4 ticks |
| A trip ends with an event | `templetrek_event_flash` = the map position, jingle 195; 3 ticks later `templetrek_last_event`, into the room (tabs reopened); a tick later the follower, `minimap_state` 3, `busy` 0, the map closed, fade in |
| Continue-trek | Jingle 197, fade out, sound 1815; +1 `minimap_state` 2, `busy` 1; +2 back to the hub; +3 the flash cleared and the map shown at the stop (`*_start_<n>`); the next trip 3 ticks on |
| Evade-event | As Continue-trek with "You manage to evade the enemies." and jingle 196 |
| Trip 11 | Jingle 194; +2 "You reach your destination.", out at 3432,3484 (Paterdomus) or 3483,3242 (Burgh) with the follower; +1 the thanks line, then "<follower> gives you a reward token! " as an item box |

Messages: "You choose the slow route through Mort Myre Swamp.", "You choose the moderate route through Mort Myre following the river.", "You choose the fast route via the Hollows and Canifis."

### The map

Each route is eleven trips: `templetrek_trip_anim_route_<r>_trip_<n>` (shared parts are `route_all` / `route_1_and_2`), and `templetrek_trip_*_start_<n>` stands the player at a stop when they come back from an event. The Ramble has its own `ramble_*` set. The flash's 25 positions (map components 34-58, script 7048 shows the "!" where `templetrek_event_flash` matches): route 1's stops are 1-10, route 2's 1-3, 11-16 and 10, route 3's 1 and 17-25; the Ramble counts its stops from the other end (stop n is position of stop 11 - n). Every captured flash fits this (tests/temple-trekking.test.cjs).

### Events

`templetrek_last_event` per event: shades 1, boat 2, vampyres 3, ghasts 4, snails 5, snakes 6, river 9, Abidor 10, bridge 11, nail beasts 12. Each stop rolls the route's chance (route 1 30%, route 2 25%, route 3 35%; 75% right after an evade), up to the route's most (9, 4, 5 - the Wiki's counts), then picks by weight. Shades only come up at Mort'ton (stop 1 going to Paterdomus, stop 10 going to Burgh) and the boat only at route 3's crossing (stops 3 / 8), as captured. The chances and weights are tuned to the Wiki's "mostly 3 events" - Mod Ash confirmed the events are weighted but not how.

### Rooms

Live copies a template room into an instance, unturned (the captures' `build_area`):

| Room | Source | Entry |
| --- | --- | --- |
| Route 1 and 2 (Evade paths) | 32 x 32 at y 5024, x 1984, 2016, 2176, 2208, 2240, 2272, 2304, 2336, 2368, 2400 | 16 east, 6 north of the corner |
| Route 3 (no Evade paths) | 24 x 24 at y 5000, x 2000, 2192, 2256, 2320, 2384 | By the Escape path |
| Shades (Mort'ton) | 2120-2167, 4992-5039, planes 0-1 | 2144,5004 to Paterdomus; 2135,5030 to Burgh |
| Bridge | 2080-2103, 5032-5047 | 2083,5041 |
| River | 2080-2103, 5000-5031 | 2090,5005 |
| Boat | 2056-2071, 5024-5047, planes 0-2 | 2062,5036,2 |

Each event uses the rooms the captures show it in (ghasts 1984 / 2208 / hollows 2320, snails 2240 / 2320, snakes 2368 / 2384, juvinates 2304, nail beasts 2272 / 2304 / 2320, Abidor 1984), and any of the route's rooms otherwise: room 1984's way in is two tiles wide, too narrow for a 3x3 swamp snake. Rooms 2016, 2176, 2336, 2400, 2000, 2192 and 2256 weren't captured: they share a captured room's layout, and their entry tiles are inferred. The rooms at 2048,4992 (spiny bush, bog grass) and 2440,4996 (dead trees and a fire) are the bog event, removed in September 2024, and the campsite, which the Wiki says can't be met; neither is used. Only the shades' room is walked the other way round on the Ramble: Escape (13833) is put on its north path and, once the shades are dead, Continue-trek (13832) on its south one (captured `loc_add_change`).

Continue-trek before the event is done: "You have not succeeded at this event yet. You need to complete the event before you can leave along the success path." Evade on route 2 needs half the enemies dead: "You need to have defeated 2 enemies before you can evade the event. You have killed 0 enemies." Escape: "You escape from the encounter, leaving your companion to fend for themselves.", jingle 196, and the player lands on the Wiki's escape pin nearest the stop (14 → 3417,3402 is captured; the rest are matched by hand).

## Combat events

3 / 4 / 5 monsters for an easy / medium / hard follower, of the route's tier (`templetrek_*_1/2/3`, `ttrek2_nail_beast_1/2/3`), in the room's spawn box, their footprints apart (big monsters spawned on top of each other block each other's every step). They wait 3-7 ticks (shades 1-2), then go for the player or the follower at random; one held up for 3 ticks (they walk straight at their target, and the follower is in the way) steps round towards it for up to 4 more, then goes for the other. The follower stands where it arrived and fights back. Each kill is the route's 325 / 625 / 1125 points (`templetrek_npc_point_value` goes up on the kill, as captured).

- **Ghasts** are hidden (`templetrek_ghast_invis_*`): every 8 ticks next to the player one either "An attacking ghast just misses you." or turns a food into rotten food with "You feel something attacking your backpack, and smell a terrible stench." (both captured); next to the follower it hits it. A filled druid pouch used on one makes it `templetrek_ghast_vis_*`, attackable, and it turns on the player.
- **Juvinates** take no damage unless the player wields a silver weapon (the Wiki's list), fires silver bolts, or wears Efaritay's aid.
- **Swamp snakes** leave a body (`templetrek_snake_dead`, "Skin" with a knife for 2-5 swamp snake hides), or just bones if the follower hurt them (Wiki).
- **Nail beasts** drop big bones, 2-3 nail beast nails, a long bone at 1/400 and a curved bone at 1/5012.5 (Wiki); the Wiki dump has no table for them.
- **Shades** drop their remains from the dump's tables.

If the follower dies the trek fails and the player is put out at the stop's escape pin.

The follower eats from the backpack when it falls to half hitpoints: "Your companion has eaten some food. She has 14 food units left." (captured), the biggest heal first.

Every trek NPC's attack / block / death sequences are set by name in `data/definitions/npc-combat-defs.json` (`refs`): guessed from `npc-animations.json`'s unordered lists, the zombie attacked with its death sequence.

## Puzzles

**Bridge** (captured on the Ramble): "Blimey! Looks like we're going to have to go back to Paterdomus. We can't get over that bridge!" / "Oh, I'm sure we can find a way!". A zombie with a bronze axe; 65% of the time the dead trees are gone (`loc_del`) and undead lumberjacks climb out (`ttrek2_zombie_diff_<d>_ver_<v>_<stage>`, stages 1-4 as they emerge, the difficulty from route and follower), two at a time, a new one 15-22 ticks after one dies. Live raises them in the river at 2091-2092, 5034-5044 and they wade ashore; the river is blocked ground here, so they rise on the west bank beside those spots. Each leaves bones and a plank. Otherwise the three dead trees stay, re-placed as the room's own locs so Woodcutting can chop them (it only chops trees in the world's object registry, which a room's template locs aren't in): one log each, enough for the bridge. Inspect shows the stage ("The bridge is built out of logs which have been worn down over time...", "...looks a little better now...", "...looks a lot better now...") and asks "Attempt to fix the bridge?". A plank or log, with an axe wielded or a hammer carried: "You place a beam / log down over the shaky wooden support struts." "You carefully use your axe / hammer to tap the plank / log into place.", sequence 3741, sound 1800, the next stage 4 ticks later (`templetrek_bridge_fixed_*` or `ramble_bridge_beam_fix_*`), and "You've successfully repaired the bridge." after the third. Cross: "You walk across the fixed bridge." Points: 500 for the trees version, none for the lumberjacks' (Wiki). A lumberjack outfit piece the player doesn't own drops at most once a bridge (Wiki: no duplicates, one per encounter), here at 1/3 a kill.

**River** (captured both ways): "Well that's torn it... Looks like we can't get over this bog..." / "Oh, I'm sure we can find a way through!". The backpack (`templetrek_swing_rucksack`) holds a knife. Cut-vine: sequence 3747, sound 2503, "You slice a vine from the tree.", the vine 2 ticks later and the tree's next stage. Three short vines: sequence 3740, sound 1807, then "You twist the vines together to make a long vine." Long vine on the branch: sequence 3739, sound 1806, "You throw the vine up and wrap it around the branch." Swing-from: sequence 751, the exact move 2093,5013 → 2093,5017 (cycles 30-55), sound 2494, then "That's amazing! I'll have to do the same." and "Whahay! That was great! But we really should be heading off now." 500 points on the way out (captured).

**Boat** (route 3, captured): the follower's lines every 6 ticks ("Wh...what are those bubbles?" to "Blimey! Look at that beast!..."), four tentacles rising at 13-31 ticks and the head at 36 (each `*_spawning` for 4-6 ticks first, sounds 1811 / 1814). "You slay a tentacle... the swamp creature seems to weaken." The head heals in full while a tentacle lives (Wiki). Its death takes the boat on 2 ticks later, for 4000 points.

**Abidor Crank** (captured): his four lines, then the player's Hitpoints +15, Defence boosted, rotten food turned to stew, graphic 626 on both; "Ohhh, hello again..." after. No points, so the way on is open.

## Rewards

The follower's token: blue / yellow / red for route 1 / 2 / 3 (`templetrek_*_token_var` 10936 / 10934 / 10935 to Paterdomus, `ramble_*_token_var` 10944 / 10942 / 10943 to Burgh), its points (at least 325) saved per token. Look-at opens `trek_rewards` (274) with `templetrek_reward_token_slot` = the token's slot, `templetrek_reward_selected` 9 and `if_setevents` OP1 on `trek_rewards:icons` 0-8 (without it the client sends no clicks on the rewards); a click on `trek_rewards:icons` sets `templetrek_reward_selected` to the slot and the cache scripts show the ranges. Claim takes the token, closes the interface and gives `low + floor((high - low) * (points - 325) / 7675)` of the choice (the Wiki's formula and ranges), noted where the Wiki says so: "You gain Bow string x 100." (captured). The tome is a random skill's in the token's colour; Read: "After reading the magical tome, you gain some experience in Woodcutting. The book magically disappears." (captured), with the Wiki's XP (1,100-1,650 / 2,035-3,025 / 4,015-5,005), unaffected by the XP rate.

A hard follower's trek completes the Morytania hard diary task.

## Not captured: built from the Wiki or guessed

- Talk-to, Supply and food on a trekker (the lines are the Wiki's transcripts). The follower inventory interface (518 / 517) isn't built: food used on a trekker goes into the shared backpack (up to 15) with "Spaces left: N", Supply shows the same count.
- Followers' combat beyond what the captures show, and their deaths: "Your companion has been killed. You have failed to escort them to safety." is ours.
- The herb and ore reward messages ("You gain Grimy tarromin x 10 and Grimy toadflax x 5."), the bridge's "You'll need some logs or a plank to fix the bridge.", the river's "You find a knife in the backpack.", "You need a knife to cut a vine from the tree.", "You need three short vines to make a long vine.", the snake's "You need a knife to skin the snake.".
- Abidor's Defence boost (3 + level / 10, at most 12), the event chances and weights, the outfit drop rate, Return-to-Burgh / Return-to-Paterdomus at the hub (ends the trek at its start).
- Juvinates being cured, the held/angry juvinates, the campsite and the bog.
