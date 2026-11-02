# Chambers of Xeric

The Chambers of Xeric raid, Normal and Challenge Mode, on Small, Large and Full layouts. The rules are the OSRS Wiki's; what the game shows is checked against six rsprox recordings. They ran on Grid Master worlds, so they decide ids, animations, messages and timing, and the Wiki decides numbers. Each unit's header says which values come from where, and what's left unverified is listed at the end.

The plugin is `server/plugins/minigames/ChambersOfXeric.plugin.js`, which loads one unit per area from `server/plugins/minigames/cox/`.

## Status

| Phase | What | State |
| --- | --- | --- |
| 1 | Mount Quidamortem, parties, scaling, map layouts, entry, points overlay, party tab, floors, deaths, leaving | Checked against captures, driven through |
| 2 | Resource rooms, storage units, skilling, raid Herblore, food and potion points | Wiki and cache only: no recording uses them |
| 3 | Monster scaling, exit crystals; puzzle rooms: Ice Demon, Thieving, Tightrope, Crabs | Checked against captures; puzzles not played through |
| 4 | Tekton, Muttadiles, Vanguards, Vasa Nistirio | Checked against captures, fights shortened |
| 5 | Vespula, Guardians, Shamans, Mystics, scavengers and shortcuts | Checked against captures, fights shortened |
| 6 | The Great Olm | Checked against captures, fight shortened |
| 7 | Completion, counts and personal bests, Challenge Mode target time, the ancient chest, Captain Rimor's capes, Combat Achievements | Checked against captures, driven through |

The rooms' set-up is covered by `server/tests/chambers-of-xeric.test.cjs`. A whole raid has been driven through the agent MCP (see [Checking it](#checking-it)), with monsters' hitpoints lowered by the test helper and the puzzles finished by `::coxclear`, so no fight has been played at full length.

## Layout

| File | What it owns |
| --- | --- |
| `Shared.ChambersOfXeric.js` | Ids, tiles, vars, the chat-channel bridge and helpers. |
| `Layout.ChambersOfXeric.js` | The 26 layout patterns, the combat rotations, room generation, laying floors out, Challenge Mode's floors. |
| `Map.ChambersOfXeric.js` | The raid's instance: rooms copied and turned, wall chunks between them, the Olm's chamber, tiles inside rooms. |
| `Parties.ChambersOfXeric.js` | Parties: one per chat-channel, the advertised list, leaders. |
| `RaidState.ChambersOfXeric.js` | A raid: entering, starting, stages, points, deaths, leaving; the `Room` base class rooms extend. |
| `Lobby.*` | The recruiting board, the party page, the entrance. |
| `Raid.*` | The party tab, steps, passages, holes and ropes, deaths, damage points, the raid's rules. |
| `Storage.*` | Private and shared storage, building and upgrading the units, the mountain's unit. |
| `Resources.*` | Resource rooms: fishing and the cave snake, bats, herb patches, weeds, gourds and geysers, saplings, tools, the energy well. |
| `Herblore.*` | Cleaning the raid's herbs, mixing its potions. |
| `Supplies.*` | Points for food and potions to their makers; answers `potions:area`. |
| `Monsters.ChambersOfXeric.js` | The monsters' base stats and the Wiki DPS calculator's scaling. |
| `IceDemon.*`, `Thieving.*`, `Tightrope.*`, `Crabs.*` | The puzzle rooms. |
| `Tekton.*`, `Muttadiles.*`, `Vanguards.*`, `Vasa.*`, `Vespula.*`, `Guardians.*`, `Shamans.*`, `Mystics.*` | The combat rooms. |
| `Scavengers.*` | Scavenger rooms and the large room's shortcut. |
| `Olm.*` | The Great Olm's chamber. |
| `Rewards.*` | Completion, the ancient chest, Captain Rimor's capes. |
| `CombatAchievements.*` | The tasks the raid's end decides; rooms finish their own through its `complete`. |
| `Commands.*` | Developer commands. |

## Mount Quidamortem

| What | Where (cache) | Notes |
| --- | --- | --- |
| Recruiting boards (29776, Read) | (1240, 3549), (1246, 3562) | Open the board. |
| Chambers of Xeric (29777, Enter) | (1232, 3573) | The way in. |
| Captain Rimor (7595) | (1234, 3568) | Already spawned. Talk-to is his transcript; Claim-cape comes in phase 7. |
| Bank chest, private storage unit (30107) | (1254, 3572), (1256, 3572) | The unit holds what was left in private storage; it must be emptied before entering again. |

**Parties belong to chat-channels** (OSRS):
- You need to be in a chat-channel and be at least a Recruit in it to make a party; the channel's owner's party is the channel's.
- The party page lists the channel's members standing on the mountain.
- Leaving the channel leaves the party (and the raid). A leader who leaves hands the party to the best-ranked raider who can kick from the channel, or else the party is disbanded.
- The friends chat plugin answers `friends-chat:channel` ({ player } or { key }), `friends-chat:join` and `friends-chat:leave`, and announces `friends-chat:left` when anyone leaves a channel.

**The recruiting board (499)** lists 40 advertised parties. Each row (script 1566) is leader, members, preferred size, combat level and skill total, Challenge Mode, and age in ticks. Its buttons are Refresh, Make party, and each row's View.

**The party page (507):**
- One script 1517 per member: name, combat, total, kill count (Challenge Mode's when it is on), then 23 skills in the script's order.
- Then the header (script 1524): the title, your state (0 outsider, 1 member, 2 leader), advertised, and adverts left.
- Varbits:

  | Varbit | What |
  | --- | --- |
  | 5428 | You lead the party |
  | 6385 | Challenge Mode |
  | 5433 | Preferred size |
  | 5426 | Preferred combat level |
  | 5427 | Preferred skill total |
  | 9539 | Scale (varp 3062) |
  | 5408 | Map layout: 0 Small, 1 Large, 2 Full (varp 1432); Challenge Mode shows Full |
  | 9541, 3288 | The maker's last scale and party type (varp 4064), kept over a login; 3 is Challenge Mode |

- Buttons (component 3, slots 0-10, enum 1539): Join/Leave, Advertise/Delist, Disband, Refresh, Back, the three preferences, Scaling ("Set the number of players to scale the raid by (or 0 to clear it):"), Challenge Mode, and Map Layout ("How large of a layout to generate?" Small, Large, Full). Captures 820, 843 and 3389.
- The header's adverts number is 15 in every capture, and the cache has `raids_daily_adverts`, so it's a daily allowance here (the reset is an estimate).
- Settings can't change once the party has entered.

**The entrance:**
1. The first time, a warning: "Items left in a dungeon cannot be retrieved. Participants may be ejected at any time. Don't risk dropping items that you want to keep." with "Accept warning and proceed." or "Cancel.".
2. Then it checks, in order:
   - you need a chat-channel and a party;
   - you can't enter a started raid;
   - before the leader is in, only Generals and up may enter.
3. The raid is built on the first entry ("Please wait a few moments as your raid is being constructed...", 3 ticks).

## The raid

**Layouts.** Rooms were rebuilt from where NPCs stand in each recording:
- A raid takes one of the party's map layout's patterns: room kinds and the direction each is entered from, two floors. Small has 24 patterns, Large 3.
- "Map Layout: Small." / "Large." / "Full." / "Challenge Mode (Full)." follows "The raid has begun!".
- Large raids have five combat rooms and three puzzles (Wiki). Recordings 843 and 3282 are `#SCFCPC*#CPPCSF*`, 3285 is `#SCCFPC*#CPCSPF*`. The third pattern and all but one small one (`#SCFPC*#PCCSF*`, 820) aren't confirmed by a recording.
- Combat rooms are a run from one of two rotations, either way round (843 and 820 forward, 3282 and 3285 backward):
  - Tekton, Vasa, Guardians, Mystics, Shamans, Muttadiles, Vanguards, Vespula;
  - or Tekton, Muttadiles, Guardians, Vespula, Shamans, Vasa, Vanguards, Mystics.
- Two of the four puzzles are drawn (a layout with a third puzzle slot repeats any of the four); scavenger and resource rooms are drawn from their two kinds.
- Full, and so Challenge Mode, is always the same three floors with every combat and puzzle room. Recording 3389 confirms the rooms and the path through them.
- A floor's end room is always the same version by floor, in all five recordings: the last floor has the second version (hole 29735), the floors above it the first (29734). On Full, the middle floor's is the copy at chunk y 640 (hole 32542).
- Every layout is 4x2 rooms (16x8 chunks).

**Scale** (820: a party scaled to 50 reports "24+ players"): the raid scales to the higher of its raiders and the party's scale. Monsters, the Olm's phases, caps, and the team size in messages and speed tasks all use it.

**Reload** (the first room's steps, 2528): before the raid begins, the leader can generate a new layout ("Reload the raid to generate a new layout?"). Anyone else inside is put out (Wiki).

**The instance** (`CoxMap`):
- Rooms are 4x4 chunks of the cache's raid map: chunk x 408, 412 or 416 for the path turning west, going straight or turning east; chunk y and plane per room.
- Each room is turned to face the way the path enters it.
- Floors go on planes 3, 2 and (Challenge Mode) 1. The gaps are a wall chunk (416, 647) turned at random.
- The Olm's chamber, 5x7 chunks from (402, 713), is copied beside the raid on plane 0, so the whole raid is one 16x16 instance.
- Tiles inside rooms are given as they are on the cache's map and turned with the room.
- Landings on ropes and holes move to the nearest open tile (the player is then walked off them).

**Starting and stages:**
- Everyone lands in the first room. Its passage stays shut until the leader starts the raid from the party tab ("No-one may join the party after the raid begins."). The first room's bank chest shuts as the raid begins (47420 to 47419).
- Reaching plane 2, plane 1 (three-floor layouts) and the Olm's chamber completes the Upper, Middle and Lower levels: "<Level> level complete! Duration: m:ss", and the respawn moves to that floor's start.
- Music: Upper Depths (492) on the top floor, Lower Depths (487) below it, Fire in the Deep (493) at the Olm, silence (147) and jingle 152 on completing.
- The party tab (500) replaces the chat-channel tab:
  - Varbits: 5423 you lead, 5424 raiders, 9540 the scale, 12285 the highest combat level, 5425 the stage (5 once complete, which stops the client's timer), 6386 the timer.
  - Scripts: 1547 the list's size, 1548 a member, 1553 who you can kick.
- The points overlay (513) is on the HUD: varbit 5431 the total and varp 4609 (`raids_playerscore`) your points.

**Points:**
- Damage dealt to the raid's NPCs gives 5 points per hitpoint, within a per-room cap of 5 x its NPCs' hitpoints + 5% (unverified).
- Only raiders there at the start earn points.
- Personal points aren't capped during the raid (Wiki); the team total's varbit shows up to 131,071.

**Deaths are safe** (Wiki):
- 40% of the player's points are lost; if they had under 5% of the team's total, the team loses 5% instead.
- Raid-only items drop where they fell, and they wake at the floor's respawn.

**Leaving:**
- The first room's steps: "You will not be able to rejoin this raid again." (Leave the raid. / Stay.). Out is (1246, 3558) on the mountain.
- Raid-only items are dropped on the way out.
- The raid is destroyed when no one left inside can lead it ("As there is no one else eligible to kick players from this channel, the raid has been destroyed.").
- Logging out inside puts you back in when you log in, if the raid is still going and you were in it from the start; otherwise you are put outside ("Your party could not be re-found.").

**Rules:** no teleporting ("You cannot teleport from the Chambers of Xeric."); no dropping items before the raid starts ("You should keep your raiding dungeon tidy until your raid has begun."); the raid is multi-combat.

**Not in OSRS, so not built:** member-rank point boosts, and reduced points below combat level 115.

## Supplies

**Storage units** (Wiki):
- Every unit in the raid starts tiny (25 personal items, no shared space) and is built up together: small (Construction 30), medium (60), large (90), massive (99), two mallignum root planks and 150 XP a tier, 100 points a tier. Building past a tier costs the tiers between.
- Personal / shared space: 30 / 250, 60 / 500, 90 / 1,000, 120 / 1,500.
- The shared storage takes the items of cache enum 1666 only. Kindling can't be stored (since December 2023).
- Raid-only items left in private storage are gone once outside; anything else waits in the mountain's unit, which must be emptied before entering again.
- Interfaces (unverified): private 271 (inventory 583), shared 550 (inventory 582), side panel 551. Withdraw/deposit 1, 5, 10, All, X.
- Building opens the creation menu (458), by the Wiki's key list. No recording opens it, so its rows and icons are a best reading of the cache (items 21037-21042, 24660-24663).

**Resource rooms** (Wiki for levels and XP, unverified timings):
- Fishing (room A): rod and cave worms, fish 1/15/30/45/60/75/90 for 20-38 XP. One of three spots hides a cave snake that rises, bites (3-6) and steals a food when fished; the spot moves every 50 ticks or after 10 rises.
- Bats (room B): a butterfly net wielded (99 Hunter barehanded); two or three bats of one type among the three best the raid's top Hunter level allows.
- Herb patches: golpar 27, buchu 39, noxifer 55 Farming; seeds from raking weeds (until cancelled, 1-3 seeds of a kind) or later from bosses. A stage every 12 ticks, grown at 4; three lives when picking.
- Gourds: Pick or Pick-lots at the gourd tree, filled at a geyser (click it, or use a gourd on it).
- Saplings give kindling (28 at most), Woodcutting XP by how many a chop gave (Mod Bruno's table). Kindling lights a fire for cooking (Firemaking 48 XP).
- Tools lying about: old tools (rake, spade, seed dibber), bronze axe, iron pickaxe, hammer, tinderbox. The energy well restores run energy.

**Herblore** (Wiki): herbs clean at 47/52/60 for 1/2/3 XP. A clean herb, a second ingredient and a water-filled gourd make a 4-dose potion of the best strength the level allows; overloads take noxifer and an elder, twisted and kodai potion of one strength and come out no stronger than the level allows. Antipoisons (noxifer and cicely) give 90 seconds, six and nine minutes.

**Food and potion points** (Wiki): the cook gets 4 + 8 x tier per piece eaten (x1.5 when someone else eats it; soft cap 20 x raiders pieces, falling to nothing at the hard cap of 40 x raiders). Potion makers get points per sip (x1.5 for someone else's), up to 5 sips per raider plus 5 at half. The maker is on the item itself (meta `cox:maker`), which follows it through inventories, storage, drops and doses. A potion from a boss credits whoever picks it up, and thieved Psykk bats their finder; anything from Vespula's room credits nobody. Prayer enhance and overload sips while the last is still working give nothing (captures 3282, 3285 and 820 put the limit between 376 and 458 ticks; 400 is used).

## Monsters and rooms

**Scaling** (`Monsters.ChambersOfXeric.js`): base stats and bonuses from the Wiki's DPS calculator data, scaled as its Chambers of Xeric code does (checked against its tests): levels by the party's highest Hitpoints level, hitpoints by its highest combat level, both by party size, +50% in Challenge Mode (Tekton's defence +20%/+35%). Scavengers and vespine soldiers scale as solo monsters; the Olm's hitpoints follow its own formula. Core gives an NPC its own stats and max hit with `NPC.setCombatOverride` (core change). Max hits grow with the scaled offence (a derived rule; the Wiki gives them at base scale).

**Stat restore** (Wiki, Mod Ash): each monster's drained stats come back at its own rate.

**Drops** from the raid's monsters are everyone's at once (captures: timeUntilPublic 0). Bosses announce them: "As Tekton is slain by X, his supplies are dropped for all."

**Rooms** share the `Room` base: exit crystals (`blockExit`/`clearExit`), the room's raiders, template objects, and death, before-death and hit hooks dispatched from `Raid.ChambersOfXeric`. Each room's header comment lists what comes from the Wiki and what is unverified. In short:

| Room | Wiki rules used | Not on the Wiki |
| --- | --- | --- |
| Ice Demon | Lighting 8%-78%, icefiends steal a kindling 1 in 6 every 3-4 ticks, 32 + 36 points, damage a third (fire 250%, demonbane full), prayer-chosen attacks, drops for everyone. From rsprox captures: the storm bar, thaw rate, thaw and death sequences, both attacks' projectiles, impacts and sounds, the freeze (see below) | attack bases 30/25, prayer reduction, freeze length |
| Thieving | Open chance 39%-61% (+21 lockpick), grubs 0..level/25 (min 1, 2 at 95), 16 grubs/raider (30 solo), 115 points, cap max(4500, Thieving/6 x 150), bats chest 5-25, 5/5/4 clearing batch | one version's tiles |
| Tightrope | Agility 80-100% of the party average, keystone dispels and kills the guards | XP formula, wander radius |
| Crabs | Style colours, smash stun by party size | orb turns at walls, crab count by party size |
| Tekton | Ranged immune, magic a fifth, 10-14 attacks, sparks 10-20, ~1.33% heals | timings, tiles |
| Muttadiles | Meat tree (health, chance, damage), 1/3 erratic hits, eating at half health up to 3 times, stomp 1.5x, attack bases | submerged base |
| Vanguards | 40% / 33.3% imbalance, shuffles every 20-36 ticks, shells | prayer multipliers |
| Vasa | Teleport and blast rules, 1% every 2 ticks siphon, 66-67 tick crystal timer, crystal resistances, Defence restored on healing | boulder base, one version's tiles |
| Vespula | Flying (magic, ranged, halberds), landing from 20%, enraged stings, grubs 125, blossom heals 30 | landing, soldiers feeding |
| Guardians | Pickaxes only with the Mining multiplier, hitpoints formula | knock-backs |
| Shamans | Blob 31-39, counts, bases, spawn blast | aggression range |
| Mystics | Prayer-reactive melee, counts, range | aggression range |
| Scavengers | Bones and two rolls from their table, shortcut points 5 x level | counts between solo and 50 |

## The Great Olm

`Olm.ChambersOfXeric.js`, a room registered for the chamber (`raid.olmRoom`):
- The mystical barrier ("Pass" asks, "Quick-pass" doesn't; no way back) wakes it; it rises on a random side with a power (acid, flame, crystal), never the same twice in a row.
- The head attacks every 4 ticks through the Wiki's rotation (standard / empty / Crystal Burst / ... / Swap, plus the infinity sign in the last phase), facing the zone with most players and catching up a skipped standard attack.
- Standard attacks (1 in 5 to switch style, prayer lets 20% through), spheres, phase attacks (1 in 3, 1 in 2 in the last phase, preferring unused ones), claw specials, Life Siphon in the final stand.
- Phases: 3 + raiders/8 claw phases. Both claws down: falling crystals, then it rises on the other side. In the last one the claws must fall within 34 ticks of each other, then the final stand.
- Its death shatters the exit crystal and turns the crystal by the steps into the ancient chest.

## Rewards

`Rewards.ChambersOfXeric.js` on `Raid.onComplete`:
- Completion message, Normal / Challenge Mode counts (attributes), personal bests by mode and team size.
- Challenge Mode within the Wiki's target time: +5,000 points each, the kit (1/75) and dust (1/400) rolls.
- Uniques by the Wiki: 1% per 8,676 points, 570,000 a roll, the 2026 weights, the receiver by personal points (left raiders' uniques discarded), olmlet 1/53. Otherwise two different commons scaled by points (a third of herbs as seeds), the ancient tablet, elite clue 1/12; the dark journal if not banked.
- The ancient chest opens interface 539 (Take, Take-all, Bank-all, Discard-all); unclaimed loot is placed on the ground on leaving.
- Captain Rimor's Claim-cape gives the cape for the Challenge Mode count.

## Developer commands

| Command | What it does |
| --- | --- |
| `::cox` | To Mount Quidamortem. |
| `::coxlayout` | The raid's layout and the room you're in. |
| `::coxpoints <amount>` | Points for you in your raid. |
| `::coxnext` | To the next floor's start (or the Olm's chamber). |
| `::coxclear` | Completes the room you're in: a puzzle's own ending (the Ice Demon just thaws), or its monsters go and its exit opens. |

The raid is also in `::teleports` under Minigames.

## Ice Demon, from rsprox captures

Five recordings (820, 843, 3282, 3285, 3389; revisions 234-235, all on event worlds) cover seven Ice Demon rooms, six of them solo and one a duo.

- **Lighting** is retried every tick (anim 3687, area sound 2066). The tick after a success the brazier is lit and all the kindling held goes in, with no message. Without a tinderbox or kindling: "You need a tinderbox and some suitable kindling to light the brazier." in a message box. Points come as 12 a kindling plus 32 + 24 a kindling (the Wiki's 32 + 36); Challenge Mode pays 48 a kindling and 48 a lighting, up to 6,480.
- **The storm** is headbar 7 over the frozen demon (100 to 0, every tick). Party size and Firemaking level (54, 75, 99) don't change it: four raids that fed two braziers 28 kindling each follow the same curve to within a point. Fitted from them: each lit brazier thaws 0.15% + 0.02% per kindling in it a tick and burns a kindling every 8 ticks; an icefiend's successful steal takes a kindling; with nothing lit the storm regrows 0.17% a tick. The fit is within about a point of the captured bar throughout.
- **Thawed**: the braziers go out with smoke puffs (gfx 188) and sound 1930; a tick later the icefiends die (anim 1580, sound 532) and the demon walks out; it turns hostile 8 ticks after the thaw.
- **Fighting**: it stands still and every 3 ticks attacks a random raider in the room (anim 69), with the style that raider prays against, or either. Boulder: projectile 1324, 2 ticks to land within 3 tiles and 3 beyond, gfx 1325 and sound 1021 on landing. Ice Burst: projectile 366, 2 ticks, gfx 363 rippling over the 3x3, sound 170; "You have been frozen!" 2 ticks after a hit, renewable by the next burst, lasting 9 ticks. A hit freezes only if the target is still on the 3x3 when it lands.
- **Dying**: anim 67; it goes 5 ticks later and takes the storm with it.

## Tekton, from rsprox captures

Recordings 820 (a duo, six anvil visits) and 3389 (solo) show the whole fight.

- Woken, he rises (7474) and walks 2 ticks later as the fire shuts the way in. In reach, the fighting form, his stance and the walk-blocker come on one tick, and he swings 3 ticks later (2 enraged), then every 3. Stab and crush land the tick after the swing, slash two ticks after.
- He leaves on his 9th swing the first time and his 16th after each repair; back from the anvil he is enraged until his 6th swing.
- At the anvil (12-21 ticks) sparks come every 4 ticks, each spot in turn, and he heals every 3 ticks (85 at 8,400 hitpoints), not on the last tick.
- He wakes on a 4-tick pulse, with a raider within 4 tiles. The first step away comes 2 ticks after his last swing.
- Every room's exit crystal shatters with loc anim 7506 and area sounds 1021 and 3821, and is gone 4 ticks later.
- Defence specials on him follow the Wiki's rules: the first dragon warhammer or elder maul special always lands, and failed ones still drain ([defence-drain-specials.md](defence-drain-specials.md)).

## Muttadiles, from rsprox captures

All five recordings have the room (four solo, one duo).

- The tendrils, meat tree and both muttadiles are there from the start; passing the tendrils is a two-tile walk with sound 3728.
- Submerged, the large one fires projectile 393 every 6 ticks. The small one spits (7421, projectile 1291, sound 385) about every 4 ticks and bites up close.
- The small one dies and goes 3 ticks later; the large one then crawls out a tile a tick for 5 ticks, turns, and attacks 2 ticks later with spits, magic (7422, projectile 393), bites and slams (7424, sound 163).
- Below half health they eat from the tree: 3 bites on consecutive ticks, 15% of their hitpoints each (35 at 236, 37 at 250), at most three meals. Heals show as hitsplat 6.
- Chopping the tree rolls every 5 ticks: "You swing your axe...", then "You hack away some of the meat." with a hitsplat on the tree.

## Vanguards, from rsprox captures

Recordings 843, 3285 and 3389.

- Woken, they stir (7428) and take their roles 5 ticks later. Each attacks every 4 ticks: melee 7441, ranged 7446 with three different projectiles (1332-1334) landing 2 ticks later as gfx 305, magic 7436 with three projectiles 1331 landing 3 ticks later as gfx 659.
- Balance is checked every 2 ticks and a shuffle follows at once. Swirls (57 on the healthiest, 56 on the lowest) show from about half the limit. They fall into their shells on one tick, heal to full 4 ticks in when out of balance (7431), and stand up 9-13 ticks later; their first attack comes 5 ticks after that.

## Vasa Nistirio, from rsprox captures

Recording 820 has a whole fight (five specials), 3282 the end of one.

- Woken: 7408, the fire 4 ticks later, then 7409 and his first special. A special runs from 7409: the teleport 3 ticks later (those beside him stunned, gfx 245), prayers blocked for 13 ticks ("Vasa Nistirio has blocked your use of prayers." and sound 2673 only on trying one), the explosion (7410, eight falling projectiles) at 8 and the blast landing at 12; he lights the next crystal on the first pulse from 12.
- Walking, he throws a boulder at each raider every 3 ticks (landing 2 ticks later) and stomps twice a tick (sound 3834).
- At a crystal: 7412 and the healing form on one tick, sound 2885 every 2 ticks, 66-67 ticks, then 7414, the crystal going 2 ticks later. His hitsplat of 1% every 2 ticks shows the siphon; the healing is one lump at the end, and nothing if the crystal falls.
- Dying: 7415; 3 ticks later he and his crystal go, the exit crystals shatter and the fire goes.

## Vespula, from rsprox captures

Recordings 820 (a whole fight at the portal), 843 and 3389.

- She stings a random grub with 7454 and sound 570; swinging at the portal enrages her and closes the tendrils, and enraged she stings every 3 ticks (sound 819), dropping to flying for a tick every 21. Under attack, the portal fires projectile 1366 every 2 ticks, draining 3 prayer (or 3 hitpoints) from raiders within 8 tiles.
- A stung grub goes to 71 of 125 hitpoints and loses one a tick. At 0 a soldier hatches (7460, gfx 1365), and the grub is healthy again 37 ticks later; soldiers heal every 5 ticks (gfx 1367, sound 808).
- The portal falling: everything dies on that tick (7459) with "As the link to the Abyss disintegrates, the abyssal creatures perish."; 2 ticks later they are gone and the boils burst; the pillars close 2 ticks after.

## Guardians, from rsprox captures

Recordings 820, 3282 and 3389.

- Stepping on the far row: both sweep (440, sound 2524); the player is thrown a tile back (anim 1258) to the near row, which is safe, hit by each, 38 points from each.
- Melee 1203 (sound 2533); stomp 4278 (sound 3188) with a falling rock (projectile 645, gfx 305) landing the next tick (sound 360).
- Crumbling: 836 and sound 977, then the same NPC turns to its remains 2 ticks later, with "The Stone Guardian slain by X dropped seeds for all."; with both down the gap opens 3 ticks after.

## Skeletal Mystics, from rsprox captures

Recordings 3282, 3285 and 3389.

- They cast with 5528: fire (gfx 1322, projectile 130, sounds 155 / 156, impact gfx 131 or splash 85) or Vulnerability (gfx 1321, projectile 109, sounds 127 / 3012, impact gfx 110). Dying 5491, gone 5 ticks later.
- The portals appear when the last one dies (49996 start, 49997 middle with "Choose location", 49998 end). Travelling shows the portal overlay (634) and moves the player 2 ticks later. Live then leaves the points overlay closed until the next floor; we put it back.

## Lizardman Shamans, from rsprox captures

Recordings 3282 and 3389.

- The tendrils and the exit's blocking spawns are there from the start.
- Ranged 7193 with projectile 1291 (sound 385) landing 3 ticks later; the acid (projectile 1293) lands 5-6 ticks later as gfx 1294 with sound 1070.
- Dying 7196, gone 3 ticks later. After the last: the blockers raise their hands (7159, sound 665) at 5 ticks, the tendrils go at 6, the blockers burst (gfx 1295, sound 1021) at 8.

## Tightrope, from rsprox captures

All five recordings.

- Crossing: the walk starts 2 ticks after arriving, a tile a tick, with sound 2495 (2 loops) each tick and the XP the tick after landing; there are no messages. Attacks loosed during it land the tick after arriving. Dispelling the barrier gives 2,000 points.
- Mages cast 1162 (gfx 129, sound 155, projectile 130, impact gfx 131 / 85 and sound 156); rangers shoot 426 (gfx 24, sound 2693, projectile 15) landing the next tick. They shout one a tick once fighting.

## Crab puzzle, from rsprox captures

Recording 3389 (solo).

- The orb fizzles at the end of its path (gfx 119, sound 219) and the next comes as it goes a tick later; meeting a crab it takes its colour (sound 3274). At the wrong crystal it bursts as a bolt, on a player as a wave.
- Lighting a crystal turns it white (29762, sound 1476), gives 400 points, and the dark crystal brightens a step 1-3 ticks later; with all four the crabs go at 4 ticks and the dark crystal shatters at 5 (gfx 1326).
- Struck crabs keep their colour about 12 ticks; smashing: player 1755, crab gfx 245, sounds 556 and 2727; crabs bite with 2368.

## Thieving, from rsprox captures

Recording 3389.

- Opening a chest gives its grubs the tick after the animation (sound 52, "Some cavern grubs have hatched; you take them."); it locks again about 12 ticks later. A full stack gets a message box. Depositing (sound 3637) has no message; the trough fills the tick after.
- The scavenger's hunger is headbar 7; it eats a trough/8 every 3 ticks, at least 1. Fed, it walks aside, yawns ("Yawwwwwn!") 7 ticks later, sleeps at 14 and snores (gfx 277, sound 869) every 8 ticks from 21.

## Scavengers, from rsprox captures

- Scavenger beasts bite with 255 and die with 258; one is gone 2 ticks after dying and another comes within 3 tiles of it 2 ticks later (recording 3389), so the rooms never empty. One solo, two otherwise (3389, 820).

## The Great Olm, from rsprox captures

All five recordings (820 a long multi-player fight, 3389 a quick solo one).

- It rises 7 ticks after the barrier is passed, with "The Great Olm rises with the power of <col=00ff00>acid</col>." (flame ff0000, crystal ff00ff) at once, the rising animations a tick later, risen at 6 and attacking at 7 (at 10 on later rises). All three powers are used before any repeats.
- Head projectiles leave 32 cycles in from height 340-360: magic 1339 (sound 3749), ranged 1340 (1784), spheres 1341/1343/1345 landing at 180 cycles (1784), acid 1354, the burn 1349 (585), fire walls 1347 (3750), bombs 1357 (exploding 11 ticks after the throw, gfx 40, sound 1021). Targeted falling crystals come every 2 ticks (projectile 1352, gfx 1353, sound 3821, "The falling crystal shatters into you.").
- A claw falls (7352 / 7370), its cave 2 ticks later; with the right claw down the left grips (7363). The last claw down: the head falls 4 ticks later, its cave at 6, and it rises across the chamber at 38.
- Fire walls: 1348s are thrown at once, the blocking loc 26209 comes at 2 ticks and the NPCs at 4. Douse is the fire NPC's real op1 (all 8 captured douses), reach 10: it plays the raider's castable water or ice spell without using runes, and the loc goes a tick later. Using a watering can or water gourd on it, or casting on it, work too (Wiki).
- Deep burn: every 8 ticks from landing, draining all five combat stats. A claw's fall: at 3 ticks it becomes marker 7556 with headbar 8, back at 33 if not paired. The clench: 7360 at once, 7361 at 3, 44 ticks.
- Crystals in a transition: every 2 ticks, one on a raider and one per third of the chamber (two with four or more).
- The live messages (sphere colours ff3045 / 229628 / 3366ff, swaps, pairing, the clench, Life Siphon, deep burn) are used word for word.

## Getting around the raid, from rsprox captures

All five recordings.

- Passages: the player faces it and is through 2 ticks after arriving. Before the start the leader gets "Use the controls on the <col=7f0000>side-panel</col><br>when you are ready to begin the raid." and the rest "You cannot proceed until <leader> has started the raid." (message boxes).
- Holes down: 2 ticks after arriving, the climb and fade; "<col=ff289d>Upper level complete! Duration: </col><col=ff0000>m:ss</col>" (Middle, Lower).
- The exit steps ask "You won't be able to re-enter." - "Leave." / "Stay.".
- The ancient chest sets raids_client_needsrewardbook (5457) and opens the rewards with slots 0-5 clickable.

## Values not on the Wiki, to check against a capture

| Value | Where |
| --- | --- |
| Outside tile (1246, 3558) | Leaving |
| Room landing tiles (start 3278,5187 / 3298,5188 / 3330,5188; floor-end 3278,5168 / 3308,5173; floor-start 3280,5711 / 3312,5711 / 3344,5711) | `CoxMap.BOUND` |
| Olm chamber centre (3232, 5734); the entrance (3232, 5719) is from 3389 | `CoxMap.OLM_TILES` |
| Wall chunk (416, 647) and its random turn | `CoxMap` |
| The layout codes no recording confirms | `CoxLayout` |
| Damage points (5 per hitpoint, room cap +5%) | `CoxRaid` |
| Build delay (3 ticks), climb animations 827/828 | `CoxRaid`, `Raid.ChambersOfXeric` |
| Creation menu rows and icons, build delay (2 ticks) | `Storage.ChambersOfXeric` |
| Points per potion sip (overload 400, Xeric's aid 200, others 100, x 0.25/0.5/1) | `Supplies.ChambersOfXeric` |
| Resource room tiles (fishing, snake, bats), snake timings and damage, catch and fishing chances | `Resources.ChambersOfXeric` |
| Patch growth (12 ticks a stage), keep chance, raking cycles; a fallen sapling's 15 ticks | `Resources.ChambersOfXeric` |
| Every room's tiles, animations, graphics, projectiles and sounds | each room unit |
| Ice Demon boulder base 30, prayer letting 2/3 through (a fit on few samples) | `IceDemon.ChambersOfXeric` |
| Boss attack bases where the Wiki says "varies" | the room units |
| The Olm's rising/transition timings, special timings and damage ranges not on the Wiki | `Olm.ChambersOfXeric` |
| Reward interface's Bank-all, Take-all and Discard-all components; varbit 5456 for common loot (all recordings had a unique, which is 1) | `Rewards.ChambersOfXeric` |

**Derived, not from a source** (to check): max hits grown with scaled offence (a Guardian comes to 29 in Challenge Mode, where the Wiki says 33); Vespula grounded 33 ticks; tightrope barrier tile turn; the team-size names between Solo and 24+.

**Known differences:** lightning's prayer block says the engine's message rather than "You've been injured and can't use that prayer!"; the reward book's varbit (5457) isn't cleared when the chest's interface closes; the Olm's NPCs spawn in their risen forms rather than turning into them.

**Not built:** the Challenge Timeboard (live also says "Your team has made it onto this world's Challenge Timeboard!"), private-storage drag reorder, ironman storage rules.

## Checking it

With the agent MCP on: make a party through the board (`resume_pausebutton` as `dialogue_continue` on 499:3 and 507:3), enter, start from 500:14, then walk each room's passages. `set_npc_hitpoints` shortens a fight and `::coxclear` finishes a puzzle.

To rebuild a recording's layout, group its `NpcInfo` spawns by `x >> 5, z >> 5` and plane. The text decode doesn't print a rebuild's zones.
