# Key chests

`server/plugins/objects/KeyChests.plugin.js` (units in `keychests/`, data in
`objects/data/key-chests.json`): the chests opened with a key, the crystal key halves, and the
enhanced crystal key. Members only.

| Chest | Where | Key | Opened by |
| --- | --- | --- | --- |
| Crystal chest ("Closed chest", loc 172) | Taverley, 2914,3452 | Crystal key | Open, or the key used on it |
| Brimstone chest (multiloc 34662) | Mount Karuulm, beside Konar | Brimstone key | Unlock, or the key |
| Larran's small chest (multiloc 34831) | North-east of the Chaos Temple | Larran's key | Unlock, or the key |
| Larran's big chest (multiloc 34832) | Ship west of the Pirates' Hideout | Larran's key | Unlock, or the key |
| Elven Crystal Chest (multiloc 37342) | Tower of Voices, Prifddinas | Enhanced crystal key | Open, or the key |
| Zombie Pirate's Locker (loc 53222, open 53223) | Shipwreck east of the Chaos Temple, level 14 Wilderness | Zombie pirate key | Open, or the key |

The brimstone and Larran's keys come from Konar's and Krystilia's Slayer tasks
(`plugins/skills/slayer/Keys.Slayer.js`, [slayer.md](slayer.md)). The Elven chest is open to
everyone; Song of the Elves isn't required.

## Units

| Unit | Does |
| --- | --- |
| `Data.KeyChests.js` | Reads `key-chests.json`, resolving its cache gamevals to ids |
| `Loot.KeyChests.js` | Rolls a chest's loot (pre-rolls, always items, one main roll, the fish table) and gives it |
| `Chests.KeyChests.js` | Open/Unlock, the key used on a chest, Check, and the opened counts |
| `CrystalKey.KeyChests.js` | Joining the key halves; the enhanced crystal key at the Prifddinas singing bowls |

## Opening (rsprox captures)

Ticks count from the player's arrival.

**Crystal, brimstone and Elven chests** (crystal chest: recording 2963, rev 230; brimstone chest:
2962, rev 230, and Leagues/event worlds 819-821; Elven chest: Leagues 1149, rev 237):

| Tick | What |
| --- | --- |
| 0 | Animation `human_openchest`, sound 2402, "You unlock the chest with your key." |
| 1 | The key goes, the loot comes, "You find some treasure in the chest!"; the chest shows open: the Taverley chest becomes loc 173 for everyone, the others set their varbit (`brimstone_opening_konar_chest`, `prif_crystal_chest_open`) to 1. The Elven chest says its count here. |
| 2 | The chest closes. The brimstone chest says its count. |

**Larran's chests** (big chest, Leagues 820-821, rev 234; the small chest has no captures and
is opened the same way, under the same varbit):

| Tick | What |
| --- | --- |
| 0 | Animation `human_pickuptable`, sound 1227 (delay 5) |
| 1 | Sound 52, the key goes, `brimstone_opening_konar_chest` 0 -> 1 |
| 2 | Sound 51, the loot, "You have opened Larran's big chest # times.", the varbit back to 0 |

- **Counts:** "You have opened the Brimstone chest # times." ("once." for one), "You have opened
  Larran's big chest # times.", "You have opened the crystal chest # times." (the Elven chest).
  Check says the same line. The counts are saved attributes (`key-chests:*-opened`); the cache
  has no varps for them. The Taverley chest keeps no count.
- **Without a key:** the brimstone chest says "You need a special key that'll fit that keyhole
  to unlock the chest." (captured); Larran's chests use the same line (not captured). The crystal
  chest says "This chest is securely locked shut." with sound 2402 (Wiki); the Elven chest does
  the same (Wiki: the sound plays with or without a key; the line is the crystal chest's).
- **The Falador diary:** opening the Taverley chest completes "Unlock the Crystal chest in Taverley".
- **Collection log:** every item goes through `collection-log:obtain` (the dusk mystic robes,
  the hasta, the Dagon'hai robes, the dragonstone armour, the onyx and the shield left half).

**Zombie Pirate's Locker** (recordings 441 and 442, rev 233; 1440, rev 224):

| Tick | What |
| --- | --- |
| 0 | Animation `human_openchest`, sound 58 |
| 1 | The key goes; the locker becomes loc 53223 for everyone |
| 2 | Animation `human_openchest` again |
| 3 | Sound 51, the loot, "You loot the locker and receive <col=ef1020>4 x Blighted super restore(4)</col>.", "You've opened the Zombie Pirate's locker <col=ef1020>once</col>." (or "<col=ef1020>3</col> times."), any "Valuable drop" line; the locker is loc 53222 again |

- **Locker refusals:** without a key, "You don't have the key for this locker."; with under two
  free inventory slots, "You'll need two free inventory slots to loot the locker." and the key
  stays (both captured, no animation or sound). The count is a saved attribute
  (`key-chests:zombie-pirate-locker-opened`); no variable changes in the captures.
- **Loot notifications:** the locker sends its loot on `drops:received` { player, source, drops },
  which the loot drop notification setting (`ValueWarnings.plugin.js`) answers like an NPC drop.

## Loot (OSRS Wiki)

From each chest's Wiki page. A pre-roll that hits is the whole reward (captured: a dusk mystic
robe or a Dagon'hai piece came alone); otherwise the always items and one main roll.

- **Crystal chest:** an uncut dragonstone, and one of 11 rewards out of 128 (17/128 nothing more).
- **Brimstone chest:** 1/100 pre-roll for the broken dragon hasta (half of it) or a dusk mystic
  piece; otherwise one of 60.
- **Larran's big chest:** 3/256 pre-roll for a Dagon'hai piece; otherwise one of 60.
- **Larran's small chest:** one of 60, with the Wiki's small-chest amounts.
- **Zombie Pirate's Locker:** the zombie pirate table with every amount doubled and no "nothing",
  one item out of 173; the teleport anchoring scroll (1/275, never doubled) as a pre-roll. Ours:
  the scroll replaces the main roll, which fits the two free slots the locker asks for (two
  unnoted weapons). Worn, the amulet of avarice notes everything but the scroll. The scroll's
  league boost (`drops:chance` with the chest's name, `league-boosted-drops.json`) raises the
  pre-rolls' chances, the brimstone chest's hasta and dusk mystic and Larran's big chest's
  Dagon'hai pre-rolls included.
- **Elven Crystal Chest:** 1/10,000 uncut onyx and 1/500 dragonstone armour pre-rolls;
  otherwise an uncut dragonstone and one of 13 rewards out of 256.
- **Fish (the three Slayer chests, 3/60):** the Wiki's fish table (Module:Slayer chest fish
  chart). Rolls at the player's Fishing level for manta ray, sea turtle, shark, monkfish,
  swordfish and tuna, in that order, each a skilling-success chance; raw lobsters when none hits.
  A manta ray, turtle or shark roll gives that fish 2/8 of the time, raw sharks 3/8 and shark
  lures (twice a shark amount) 3/8. The big chest gives 1.5 times the brimstone chest's amounts.
  The Wiki's small-chest fish table is marked incomplete since the June 2025 change, so the small
  chest uses the brimstone chest's amounts.

## Crystal keys

- **Key halves** (captured, recording 2963): the loop and tooth halves used on each other make a
  crystal key, with sound 2127 and "You join the two halves of the key together." Noted halves don't.
- **Enhanced crystal key** (Wiki): Sing-crystal at either Prifddinas singing bowl (loc 36552)
  with a crystal key and 10 crystal shards, at 80 Smithing and Crafting (boostable), for 500
  Smithing and 500 Crafting XP each. The bowl opens the make-X menu ("How many would you like to
  make?") and makes them all at once, with animation `prif_crystal_singing` and sound 8
  (captured: recording 312, the bowl making an eternal teleport crystal). Its captured refusals:
  "You do not have all of the required materials and requirements to make anything." and "You
  need to be at least level 80 Crafting and Smithing to create anything through crystal
  singing." The bowl's other recipes (crystal tools, armour, teleport seeds) aren't built.

## Not built

- The locker on free-to-play worlds (the Wiki: it no longer opens there; the plugin is members
  only, so nothing answers Open), and the zombie pirates' "How many times have I opened your
  lockers?" and teleport anchoring scroll dialogue, which would read the locker's count.

- Larran's big chest announcing the opener and loot around the ship, and the "Valuable drop"
  messages and client script 7192 the captures show after a Slayer chest's loot.
- Conwenna and Reese singing the enhanced key for 15 shards.
