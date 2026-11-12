# Wilderness bosses

The 2023 Wilderness boss rework: Callisto, Vet'ion and Venenatis in multi-combat lairs joined by the Escape Caves, their weaker variants Artio, Calvar'ion and Spindel in singles-plus lairs, one shared entry fee, and loot split between the players who fought. Scorpia beneath the Scorpion Pit is here too. Built from the [OSRS Wiki](https://oldschool.runescape.wiki/w/Wilderness_bosses) and live rsprox captures (<https://rsprox.net/database>).

**Every capture of these bosses is from a Leagues V world** (revisions 234-235): the bosses' own animations, graphics, projectiles, lines, transformations and timings carry over, but damage and loot numbers are skewed by relics, so those come from the Wiki. Recordings used: Callisto 3293, 3294, 3332, 3334, 3335; Artio 829, 3286, 3295, 3297, 3300-3302; Vet'ion 3411; Calvar'ion 3403-3409; Venenatis 3376, 3377, 3383; Spindel 3362-3382; the entrances, exits and Escape Caves 829, 3293, 3336-3338. There is no capture of Scorpia's fight or her cave.

The plugin is `server/plugins/bosses/WildernessBosses.plugin.js`, with its units in `server/plugins/bosses/wildernessbosses/` and its cave data in `server/plugins/bosses/data/wilderness-bosses.json`.

| File | What it owns |
| --- | --- |
| `Common.WildernessBosses.js` | Cave data, attribute keys and varbits, tick helpers, the Wilderness rules lookup. |
| `Caves.WildernessBosses.js` | Entrances, the fee, Peek, Check-Fee, exits, the six lair areas. |
| `EscapeCaves.WildernessBosses.js` | The Escape Caves' area and their air (the decay). |
| `Hud.WildernessBosses.js` | The boss health bar in the lairs. |
| `Loot.WildernessBosses.js` | Kill counts, the fee discount, and the loot split. |
| `Bears.WildernessBosses.js`, `Traps.WildernessBosses.js` | Callisto and Artio, and their bear traps. |
| `Vetion.WildernessBosses.js` | Vet'ion and Calvar'ion, their hellhounds and second form. |
| `Spiders.WildernessBosses.js` | Venenatis and Spindel, their spiderlings and webs. |
| `Scorpia.WildernessBosses.js` | Scorpia's cave, her guardians and her prayer drain. |
| `Commands.WildernessBosses.js` | `::wildboss <boss>` (to a lair's entrance), `::wildbosshp <percent>` (the nearby boss to that much life). |

## The caves

| Lair | Boss | Combat | Level | Entrance (loc) | Arrival | Exit (loc) | Out to |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Callisto's Den | Callisto 6609 | multi | 40 | Cave Entrance 47140 (3291, 3849) | (3358-3360, 10334-10336, 0) | Cave 47122 (3358, 10315) | Escape Caves |
| Hunter's End | Artio 11992 | singles-plus | 21 | Cave Entrance 47141 (3115, 3676) | (1758-1760, 11550-11552, 0) | Cave 47122 (1758, 11531) | (3115-3117, 3675) |
| Vet'ion's Rest | Vet'ion 6611 | multi | 35 | Crevice 46995 (3221, 3787), "Jump-Down" | (3295, 10203, 1) | Cave 46925 (3294, 10190, 1) | Escape Caves |
| Skeletal Tomb | Calvar'ion 11993 | singles-plus | 21 | Memorial 46996 (3180, 3683) | (1886-1888, 11545-11547, 1) | Cave 46925 (1886, 11534, 1) | (3179-3181, 3682-3683) |
| Silk Chasm | Venenatis 6610 | multi | 35 | Cave Entrance 47077 (3321, 3794) | (3423-3424, 10212-10213, 2) | Cave 47000 (3422, 10183, 2) | Escape Caves |
| Web Chasm | Spindel 11998 | singles-plus | 29 | Cave Entrance 47078 (3183, 3744) | (1630-1632, 11555-11557, 2) | Cave 47000 (1630, 11527, 2) | (3182, 3744-3746) |

- **Wilderness levels:** cache script 384 gives each lair's map square a fixed level and the Escape Caves 33 + (y % 64 - 6) * 7 / 50. The plugin answers `Wilderness.levelAt` for those squares from its data (`Wilderness.setLevelSource`). Each lair and the Escape Caves are PvP zones in `world.json`; the multi lairs and the Escape Caves are multi-combat; the singles lairs show the singles-plus icon (varbit 5961) as captured.
- **Areas:** each lair is an `Area`, and so are the Escape Caves. An actor holds one area, so they run the Wilderness plugin's own rules first (overlay, PvP, the level teleport limit), asked for through `"wilderness:rules"`. A player moved in from the surface keeps the Wilderness area while it still contains them, so the entrances put them in the lair's area themselves.
- **Entering**, as captured: the player faces the entrance and crawls (`godwars_human_crawling`); a tick later they land (`human_falling_end`) on a random tile of the arrival box. "A Dangerous Game" (track 684) plays in every lair and the Escape Caves (`UNMAPPED_AREAS` in `server/scripts/import-music-areas.mjs`, as the Wiki's music maps miss them).
- **The gate:** the Wiki locks each lair behind the medium Wilderness Diary or a Slayer boss task of that boss (a bear or spider task doesn't count). `world.json` `pluginConfig` `"WildernessBosses:requireDiary": false` turns it off. The refusal message is ours.
- **Teleports:** for 3 ticks after entering a lair the player can't teleport out, unless the hard Wilderness Diary is done (Wiki). The message is ours.
- **Logging out** in a multi lair puts the player at one of the Escape Caves' arrival points when they log back in, as leaving by any means does (Wiki).

### The fee

As captured (recording 829), with the fee unpaid:

1. A box with coins (item 1004): "You need to pay a 50,000 coin fee to enter.<br>This can be taken from your inventory, bank, or both."
2. "Pay 50,000 coins to enter?": "Yes.", "Yes, and don't ask again.", "No."
3. On paying: "<col=ef1020>You enter the cave and 50,000 coins is taken from your inventory to pay the entry fee." and varbit 14693 (`wbr_entrance_fee_paid`) 1, then the crawl. The bank's and both's messages follow the inventory's wording (not captured).

- The fee is shared by all six lairs and the Escape Caves. It stays paid until the player dies to another player without having left the Wilderness since their last visit to a lair or the caves; the killer then gets what they paid as loot (Wiki).
- **Discount:** each kill where the player did the most damage takes 10,000 off the next fee, up to 50,000: "Your entry fee discount has increased. It is now 10,000 / 50,000 coins." and at the top "... You now have the maximum discount." (captured). Varbit 14694 (`wbr_entrance_discount`) holds it in tens of thousands. Paying uses the discount up.
- **Check-Fee**, as captured when paid: "The base entry fee for these caves is 50,000 coins,<br>which you have paid. Killing wilderness bosses will<br>reduce the fee by 10,000. You have a 50,000 discount<br>towards your next fee." The unpaid and no-discount wordings are ours.
- **Peek:** with fewer than 20 kills of that boss: "You don't know this cave well enough to glean any useful information. You feel that you'll be more successful once you've killed whatever is inside, 20 times." (no kills) or "... killed the boss inside, N more times."; then "You peek into the darkness and everything seems quiet. The cave is empty." or "You peek into the darkness and can make out some movement. There is activity inside." (all captured).

### The Escape Caves

- **Ways in** (each a "Cave" 47175 on the surface, a long crawl, `human_longcrawl`, and a tick later in): (3260, 3832) to (3337, 10286); (3282, 3774) to (3358-3360, 10246); (3284, 3807) to (3360, 10273); (3320, 3830) to (3381-3382, 10286-10287). They take the fee too.
- **Ways out:** Cave 47147 (3358, 10244) to (3282-3284, 3773); Cave 47148 (3336, 10287) to (3260-3262, 3831) and (3382, 10287) to (3320-3322, 3829), crawling; Exit 47149 (3361, 10273) to (3284-3286, 3806), climbing (`human_climbing_loop`).
- **From a multi lair** the player arrives at one of three points at random: (3341-3342, 10254-10255), (3360-3362, 10296-10297), (3376-3377, 10256-10257). Leaving the same lair within 10 seconds of the player before lands at the same point (Wiki).
- **The air** (varbit 14692 `wbr_decay_state`), only for players who came in from the surface: every 10 ticks in the caves the state goes up one; from 6 each step drains 1 Prayer point and 2% run energy, and the visit's first drain says "<col=ef1020>You feel a chill down your spine as the air in the cave weakens you, the air seems to be getting thicker over time." The state carries between visits, and through a logout in the caves. Leaving a lair into the caves resets it to 0; so does coming in from the surface 10 minutes or more after the last visit (captured: 10 minutes reset it, 1 minute did not; the exact threshold isn't known).

### The health bar

Through the BossHud plugin ([boss-hud.md](boss-hud.md)). As captured: everyone in a lair sees the boss's bar from the tick after they arrive; it follows its hitpoints and form (varp 1683 changes with Vet'ion's form); eight ticks after the dead boss is removed the values clear, and the next boss shows it again as it spawns.

## Kills and loot

As the Wiki gives it for the three main bosses (the singles lairs follow the same rules):

- Up to 10 players get drops, the top damagers. Each rolls the boss's table, with quantities scaled to their share of the damage, at least 25% of the solo amount; an Ironman under 7% of the damage gets 5%.
- Uniques are decided per kill: one roll of the unique section, given to one of those players chosen by share. The pet is rolled for each of them, kept as likely as their share.
- The top damager gets big bones and the fee discount; the others bones.
- Captured message order, four ticks into the death: "Your Artio kill count is: <col=ff0000>N</col>.", the discount, then the drops, announced to everyone in the lair: "<col=005f00>Name received a drop: 12,000 x Coins</col> <col=106f10>(Artio)</col>" (bones without the boss's name).
- **Kill counts:** everyone rewarded gets the kill. Callisto's, Venenatis's and Vet'ion's counts are Combat Achievements' (`"combat-achievements:kill"`, so it tells the count before any task it finishes, and Peek reads it); the singles bosses keep their own, sent in varps 3761-3763 (`total_artio_kills`...), and each of their kills also counts for the main boss's Combat Achievements, as the Wiki says.
- NpcDrops hands such a kill over through `"npc-drops:claim"`; each share is rolled with `"npc-drops:roll-table"` (now with an `entryFilter`), announced as the player's own `"npc-drops:roll"` (collection log, saves, Ironman) and placed with `"npc-drops:place"`.

## Callisto and Artio

| | Callisto (6609) | Artio (11992) |
| --- | --- | --- |
| Melee (Wiki) | 35-55, halved by Protect from Melee | 15-35 |
| Ranged (Wiki) | up to 31, blocked by Protect from Missiles | up to 17 |
| Roar graphic | 2352 `fx_callisto_enrage` | 2353 `fx_callisto_enrage_small` |

- **Cadence** (captured, hundreds of attacks): melee 6 ticks to the next attack, ranged 5, the orb 8; the first attack 7 ticks after the spawn (`npc_callisto_spawn01`). The Wiki's attack speeds (4 and 5) don't match the captures.
- **Melee** (`npc_callisto_attack_melee01`) on a target next to the bear, diagonals included; the same blow lands on anyone next to the target (Wiki).
- **Ranged** (`attack_ranged01`, cast graphic 2349): at everyone in the lair when it can't reach. Projectile 2350, cycles 30 to 30 + 6 per tile (from the bear's middle, plus one), heights 0 to 40, angle 10, progress 50; impact 2351 and sound 6968 delayed to its arrival.
- **Knockback orb** (`attack_magic01`): every 8-12 attacks (captured: 8-12 attacks, 50-70 ticks apart). Projectile 133 (`windblast_travel`), cycles 60 to 60 + 12 per tile, heights 40/40. It lands floor(end / 30) ticks later; unless Protect from Magic is on, everyone within a tile of the target is thrown 3 tiles away from the bear (a move with `human_troll_flyback_withsound`, sounds 6934 and 6960), and 3 ticks later takes 5, plus 15 for each tile a wall stopped them short; a trap that stops them deals the 5 and springs on them (Wiki, Artio's page).
- **Roars** at 66% and 33% (`npc_callisto_enraged01` with the roar graphic), the tick after the hit that crossed. The roar shakes off a freeze, and the next attack is 6 ticks later.
- **Traps:** from the first roar, five every 6 ticks on random open tiles up to 12 from the bear's middle: graphic 2343 with sound 6908 (range 15), the trap loc 47146 a tick later, gone 30 ticks after. Stepping on one: "<col=ef1020>The bear trap immobilizes you.</col>", `trap_bear01_activate` and sound 6891; held 3 ticks; up to 15 damage the tick after as the trap goes. When the bear dies every trap springs (sound 6920) and goes a tick later.
- **Freezing:** both can be frozen despite their size; the first freeze always lands when the bear isn't frozen and the caster's magic accuracy is positive (Wiki).
- **Death:** `npc_callisto_death01`, sound 301, loot and removal 4 ticks later, back 11 ticks after that.

## Vet'ion and Calvar'ion

| | Vet'ion (6611, second form 6612) | Calvar'ion (11993, second form 11994) |
| --- | --- | --- |
| Lightning | up to 30 on the bolt's tile, 15 next to it | 26 / 13 |
| Shield bash (Wiki) | up to 35 | up to 26 |
| Hellhounds | 6613, then Greater 6614 | 12107, then Greater 12108 |

Damage in the second form is a quarter higher (Vet'ion's 35 bash becomes the Wiki's 44). Lightning values are the captured maxima.

- **Lightning**, every attack he isn't bashing: a magic (`npc_vetion_attack_magic_01/02`, cast graphic 2344/2345) or a melee swing (`attack_melee_01/02`, graphic 2348), said aloud (19 captured lines; capitals in the second form). One bolt on or next to each player in the lair (up to 7) and 4 more within 8 tiles, shown at once (2346, orange 2347 in the second form); 3 ticks later each strikes its 3x3.
- **Shield bash** (`defend_parry_01/02`, 8 captured lines, about one attack in six next to a player): shadows (1446) on one side two deep (widening by a tile each row), a corner's two-deep L, or one deep all round him; 3 ticks later dust (2184) and the hit on those standing in them, with "The shield bash staggers you, slowing your next attack!" and 8 ticks before they may attack.
- **Hellhounds** at half health: 3 ticks after the hit that crossed, `defend_shield_01/02` and one of six lines, and two hounds within 6 tiles. He takes no damage while they live, and a tenth before they come. When the last dies he says one of four lines.
- **Rebirth** at 0 in his first form, as captured: a tick on he becomes his rising form (12002 / 11995); the next tick "Now... DO IT AGAIN!!!" and twelve orange bolts in a ring 3 tiles from his middle (standing under him is safe); then `npc_vetion_enrage_01` with 2345; 5 ticks after the death he is his second form at full health, his Attack, Strength, Defence, Magic and Ranged restored (the first form's reductions reset), attacking every 5 ticks instead of 6.
- **His coffin** (Vet'ion (3293, 10210, 1), Calvar'ion (1885, 11554, 1)): 43108 while he lives, 46910 from his rebirth, 46911 when he dies.
- **Death:** `npc_vetion_death_02` with one of five lines, loot and removal 6 ticks later; back 15 (Vet'ion) or 14 (Calvar'ion) ticks after that. First attack 5 ticks after the spawn (`npc_vetion_spawn_01`).

## Venenatis and Spindel

| | Venenatis (6610) | Spindel (11998) |
| --- | --- | --- |
| Melee / ranged / magic (Wiki) | 21 / 35 / 30 | 14 / 31 / 24 |
| Spiderlings | 12000 | 12001 |

- **Next to a player** she only bites (`npc_venenatis_melee_01`). Otherwise she works through 8 ranged spits (`ranged_01`, projectile 2356) then 8 webs (`magic_01`, projectile 2358), every 4 ticks (captured), moving a few tiles every fourth attack (Wiki). Both projectiles fly cycles 25 to 25 + 2 per tile from two tiles in from her south-west corner, from height 150, angle 14, progress 48; impacts 2357 (height 30) and 2359 (height 90) delayed to their arrival.
- **Spiderlings:** the cycle's first spit tops them up to two. While any live she hits through protection prayers (Wiki). Each bite drains a Prayer point: "You feel yourself drained by the spiderling." (captured). They die with her.
- **Sticky web** on the cycle's third web (Wiki): projectile 2360 to the player's tile (cycles 0-120, heights 150 to 0, angle 30), impact 2361 there; 4 ticks later the web spreads as captured: 37 tiles around that tile (a 5x5 of 47084 with 47086 corners, and three 47085 edges along each side), lasting 39 ticks. Each tick in it costs 3 hitpoints, 3 Prayer and 10% run energy (Wiki); "You feel yourself drained by the webs!" once a visit (captured).
- **Death:** `npc_venenatis_death_01`, loot and removal 5 ticks later, back 10 ticks after that. First attack 7 ticks after the spawn (`npc_venenatis_spawn_01`).

## Scorpia

From the Wiki only: there is no capture of her fight or her cave.

- **Her cave:** each Cavern 26762 (`wilderness_scorpion_entrance`) on the pit floor leads to the Crevice 26763 (`wilderness_scorpion_exit`) nearest it in the cave, with a long crawl. The pairs and arrival tiles come from the cache's placements: (3231, 3936) and (3233, 10331), (3231, 3951) and (3232, 10352), (3241, 3949) and (3243, 10352). The cave is a PvP, multi-combat zone like the pit.
- **Her melee** is the engine's, from her definition; she and her offspring poison through theirs. With Protect from Melee on, each of her blows drains 2 Prayer, hit or miss.
- **Guardians:** the first attack on her once she is at 99 or less calls two Scorpia's guardians (6617) beside her. Each heals her 8 every 3 ticks (a curse, projectile 109) while within 3 tiles; one that hasn't healed for 25 ticks despawns; killed ones don't come back that fight.

## Engine changes

- `Wilderness.setLevelSource(name, (x, y) => level | null)`: a plugin gives the level of its own tiles (replaced by name on reload); `levelAt` asks the sources before the levelled strips.
- `"wilderness:rules"` (Wilderness plugin): its area rules, for an area of its own on PvP ground.
- `"npc-drops:claim"`, `"npc-drops:place"` and `entryFilter`/`npc` on `"npc-drops:roll-table"` (NpcDrops).
- NPC flags: `"combat:freezable"` lets a large NPC be frozen; `"combat:no-regen"` keeps an NPC from healing 10% a tick after 20 seconds unattacked (Vet'ion's immune phases would otherwise undo the fight).
- Single combat: an always-multi NPC (a boss's hellhound or spiderling) no longer ties up whoever it fights, so a player a hound is biting may still attack its master in a singles lair, and nobody else may.
- Client: a plane-1 tile drawn from plane 0 (tile flag 8) is click-tested only where it is drawn. Callisto's Den and Hunter's End have an invisible (0xff00ff) layer above the floor that caught every click a tile off.
- The old core `Vetion`, `Venenatis` and `VetionHellhound` classes and their combat methods were never used and are gone; so is the old Callisto plugin. The Chaos Elemental, Chaos Fanatic, Crazy archaeologist and King Black Dragon plugins now take core classes from `api.core` (their fights are unchanged).

## Not done, or not verified

- The unpaid-fee and no-discount Check-Fee wording, the bank fee messages, the gate and teleport-lock messages, and a fee with a full discount (entered free, silently).
- Spiderlings raising her damage and cutting the player's and thralls' (Wiki gives no numbers); the second rising NPC (11996) captured beside him, a visual only.
- Singles-plus is shown (the icon) but plays as singles.
- **An abandoned fight starts over:** a lair boss that has had no target and not been hit for 100 ticks gets its hitpoints and first form back, its hounds, spiderlings, traps and webs go, and its damage record clears (our timing; OSRS's isn't known).
- Scorpia's fight and cave are uncaptured.
