# Boss fights: rsprox and Wiki audit

A sweep of the boss fights the server implements, against the OSRS Wiki and the packet recordings on
[rsprox.net](https://rsprox.net/database). Branch `audit/boss-fights`, based on `main`
(`2cc079bee`), 2 November 2026.

The Wiki page [Boss](https://oldschool.runescape.wiki/w/Boss) lists 209 named encounters. The
server implements the world, Wilderness, instanced, Slayer, minigame, skilling and raid bosses;
quest bosses live in the quest plugins and are listed separately in [Quest bosses](#quest-bosses).

## Method

1. **Wiki first.** Each fight is checked against its page and `/Strategies` page: hitpoints, max
   hit, attack speed and range, attack mix, special cadence, damage tables, effect durations,
   messages, animations, projectiles and respawn.
2. **Then rsprox.** Recordings are found with the search API (NPC id, animation, graphics, loc,
   interface, varbit, text), downloaded and decoded using the [packet-capture guidance](https://github.com/RSPSApp/tsps/blob/main/server/docs/agents/sources.md#packet-captures),
   and read tick by tick. A recording only ever confirms or corrects what the Wiki says; it never
   overrides the Wiki on gameplay intent.
3. **Then the cache.** Ids are checked against rev 241 (`server/caches`), never guessed.

Recording ids below are rsprox submissions. The parenthesised number is how many lines in that
recording matched the boss's NPC id; a large number can still be a spawn or a walk-past, so the
recording was opened before being relied on.

## Coverage

### World bosses

| Boss | Implementation | Doc | rsprox evidence | Result |
| --- | --- | --- | --- | --- |
| Ahrim the Blighted | `plugins/minigames/Barrows.plugin.js` | — | 1885 (222-459 per brother), 4057 (95-162) | not yet audited |
| Karil the Tainted | `plugins/minigames/Barrows.plugin.js` | — | 1885 (222-459 per brother), 4057 (95-162) | not yet audited |
| Dharok the Wretched | `plugins/minigames/Barrows.plugin.js` | — | 1885 (222-459 per brother), 4057 (95-162) | not yet audited |
| Guthan the Infested | `plugins/minigames/Barrows.plugin.js` | — | 1885 (222-459 per brother), 4057 (95-162) | not yet audited |
| Torag the Corrupted | `plugins/minigames/Barrows.plugin.js` | — | 1885 (222-459 per brother), 4057 (95-162) | not yet audited |
| Verac the Defiled | `plugins/minigames/Barrows.plugin.js` | — | 1885 (222-459 per brother), 4057 (95-162) | not yet audited |
| Gemstone Crab | `plugins/bosses/GemstoneCrab.plugin.js` | `gemstone-crab.md` | 1156 (52), 1098 (6) | checked |
| Scurrius | `plugins/bosses/Scurrius.plugin.js` | `scurrius.md` | 2156 (77), 2155 (43) | checked |
| Giant Mole | `plugins/bosses/GiantMole.plugin.js` | `giant-mole.md` | none found (5779/6499) | **respawn fixed** |
| Deranged Archaeologist | `plugins/bosses/DerangedArchaeologist.plugin.js` | — | 83 (172, mostly skilling), 1751 | checked |
| Dagannoth Supreme/Rex/Prime | `plugins/bosses/DagannothKings.plugin.js` | `dagannoth-kings.md` | 89 (151), 3433 (109) | checked (Supreme splash ambiguous) |
| Sarachnis | `plugins/bosses/Sarachnis.plugin.js` | `sarachnis.md` | 3932 (240) | checked |
| Blood/Blue/Eclipse Moon | `plugins/bosses/MoonsOfPeril.plugin.js` | `moons-of-peril.md` | none found (13011-13013/13485-13487) | Wiki-only |
| Kalphite Queen | `plugins/bosses/KalphiteQueen.plugin.js` | `kalphite-queen.md` | 95 (262), 96 (140) | checked |
| Kree'arra | `plugins/bosses/GodWars.plugin.js` | `god-wars-dungeon.md` | 801 (300) | checked (melee gap) |
| Commander Zilyana | `plugins/bosses/GodWars.plugin.js` | `god-wars-dungeon.md` | 801 (244) | checked |
| General Graardor | `plugins/bosses/GodWars.plugin.js` | `god-wars-dungeon.md` | 3282 (205) | **fixed** (chamber reset) |
| K'ril Tsutsaroth | `plugins/bosses/GodWars.plugin.js` | `god-wars-dungeon.md` | 801 (256) | **fixed** |
| The Hueycoatl | `plugins/bosses/Hueycoatl.plugin.js` | `hueycoatl.md` | 4054 (161), 3274 (145) | checked |
| Corporeal Beast | `plugins/bosses/CorporealBeast.plugin.js` | `corporeal-beast.md` | 3365 (327), 3359 (177) | checked |
| Nex | `plugins/bosses/Nex.plugin.js` | `nex.md` | 806 (434), 807 (416) | checked |

### Wilderness bosses

| Boss | Implementation | Doc | rsprox evidence | Result |
| --- | --- | --- | --- | --- |
| Chaos Fanatic | `plugins/bosses/ChaosFanatic.plugin.js` | — | 3930 (1, spawn only) | **fixed** |
| Crazy archaeologist | `plugins/bosses/CrazyArchaeologist.plugin.js` | — | 1463 (3), 1440 (2) | **fixed** |
| Scorpia | `plugins/bosses/wildernessbosses/Scorpia.WildernessBosses.js` | `wilderness-bosses.md` | none found (6615/6616) | Wiki-only |
| King Black Dragon | `plugins/bosses/KingBlackDragon.plugin.js` | this file | none found (239/2642/6502) | **fixed** (below) |
| Chaos Elemental | `plugins/bosses/ChaosElemental.plugin.js` | — | 3886 (6), 3889 (2) | checked (no fight capture) |
| Revenant maledictus | `plugins/npcs/revenants/Maledictus.Revenants.js` | `revenants.md` | not searched separately | Wiki-only |
| Calvar'ion / Vet'ion | `plugins/bosses/wildernessbosses/Vetion.WildernessBosses.js` | `wilderness-bosses.md` | Vet'ion 3411 (105); Calvar'ion 3408 (13) | checked |
| Spindel / Venenatis | `plugins/bosses/wildernessbosses/Spiders.WildernessBosses.js` | `wilderness-bosses.md` | Venenatis 3376 (200); Spindel 3366 (16) | checked |
| Artio / Callisto | `plugins/bosses/wildernessbosses/Bears.WildernessBosses.js` | `wilderness-bosses.md` | Artio 829 (283); Callisto 3293 (125) | checked |

### Instanced bosses

| Boss | Implementation | Doc | rsprox evidence | Result |
| --- | --- | --- | --- | --- |
| Brutus / Demonic Brutus | `plugins/quests/quests/IdesOfMilk.Quest.js` | `ides-of-milk.md` | 4153 (5) | quest boss, not audited here |
| Obor | `plugins/bosses/GiantLairs.plugin.js` | — | 550 (28), 91 (10) | Wiki-only (estimates noted) |
| Bryophyta | `plugins/bosses/GiantLairs.plugin.js` | — | 569 (90), 571 (44) | Wiki-only |
| Amoxliatl | `plugins/bosses/Amoxliatl.plugin.js` | `amoxliatl.md` | 1140 (780), 1147 (11) | checked |
| Royal Titans | `plugins/bosses/RoyalTitans.plugin.js` | `royal-titans.md` | 3402 (80), 3398 (51) | checked |
| Doom of Mokhaiotl | `plugins/bosses/DoomOfMokhaiotl.plugin.js` | `doom-of-mokhaiotl.md` | 1164 (345), 1168 (226) | checked |
| Mad Angel | `plugins/bosses/MadAngel.plugin.js` | `wyrmscraig.md` | no NPC hits found; the Wyrmscraig doc cites a kill capture | checked |
| Zulrah | `plugins/bosses/Zulrah.plugin.js` | `zulrah.md` | 820 (393), 3276 (126) | checked |
| Vorkath | `plugins/bosses/Vorkath.plugin.js` | — | 8058: 1857 (145), 1851 (110), 3279 (102) | **partly fixed** |
| Phantom Muspah | `plugins/bosses/PhantomMuspah.plugin.js` | `phantom-muspah.md` | 1762 (480), 1774 (225) | checked |
| Maggot King | **not implemented** | — | none (15742) | gap, see below |
| The Nightmare | `plugins/bosses/Nightmare.plugin.js` | `nightmare.md` | 1875 (88), 552 (85) | checked |
| Yama | `plugins/bosses/Yama.plugin.js` | `yama.md` | 3285 (402), 799 (344) | checked |
| Duke Sucellus | `plugins/bosses/DukeSucellus.plugin.js` | `duke-sucellus.md` | 1751 (7), 555 (4) | checked |
| The Leviathan | `plugins/bosses/Leviathan.plugin.js` | `leviathan.md` | 555 (427), 550 (395) | checked |
| The Whisperer | `plugins/bosses/Whisperer.plugin.js` | `whisperer.md` | 3281 (172), 3285 (149) | checked |
| Vardorvis | `plugins/bosses/Vardorvis.plugin.js` | `vardorvis.md` | 3344 (261), 1156 (232) | checked |
| The Mimic | `plugins/bosses/Mimic.plugin.js` | `mimic.md` | none found (7979/8633) | Wiki-only |

### Slayer bosses

| Boss | Implementation | Doc | rsprox evidence | Result |
| --- | --- | --- | --- | --- |
| Hespori | `plugins/skills/farming/Hespori.Farming.js` | — | 3282 (76) | **fixed** (below) |
| Skotizo | `plugins/bosses/Skotizo.plugin.js` | `skotizo.md` | 3329 (35), 3323 (15) | checked |
| Shellbane gryphon | `plugins/bosses/ShellbaneGryphon.plugin.js` | — | 3456 (14) | **fixed** |
| Grotesque Guardians | `plugins/bosses/GrotesqueGuardians.plugin.js` | — | 1754 (44), 1144 (10) | checked |
| Abyssal Sire | `plugins/bosses/AbyssalSire.plugin.js` | `abyssal-sire.md` | 572 (264), 1762 (356) | checked |
| Kraken | `plugins/bosses/Kraken.plugin.js` | `kraken.md` | 1151 (1556), 1150 (105) | **fixed** |
| Cerberus | `plugins/bosses/Cerberus.plugin.js` | — | none found (5862/5863/5866/13657) | checked (fire wall gap) |
| Araxxor | `plugins/bosses/Araxxor.plugin.js` | `araxxor.md` | 1768 (625), 550 (542) | checked |
| Thermonuclear smoke devil | `plugins/bosses/ThermonuclearSmokeDevil.plugin.js` | `thermonuclear-smoke-devil.md` | 1161 (1212), 1158 (114) | checked |
| Alchemical Hydra | `plugins/bosses/AlchemicalHydra.plugin.js` | — | 1521 (1) | **fixed** |

### Minigame, skilling and raid bosses

| Boss | Implementation | Doc | rsprox evidence | Result |
| --- | --- | --- | --- | --- |
| Crystalline/Corrupted Hunllef | `plugins/minigames/gauntlet/` | `gauntlet.md` | Corrupted 1158 (991), 3285 (8) | checked |
| TzTok-Jad / TzKal-Zuk | `plugins/minigames/tzhaar/`, `plugins/minigames/inferno/` | — | Jad 3276 (717), 551 (402); Zuk 1754 (40) | **Jad and Zuk fixed** (below) |
| Sol Heredit | `plugins/minigames/colosseum/` | `fortis-colosseum.md` | 1150 (536), 1156 (346) | checked |
| Tempoross | `plugins/minigames/tempoross/` | `tempoross.md` | none found (6257) | Wiki-only |
| Wintertodt | `plugins/minigames/wintertodt/` | `wintertodt.md` | 3262 (50), 3254 (16) | checked |
| Zalcano | `plugins/bosses/Zalcano.plugin.js` | — | 4057 (18), 4056 (2) | checked |
| CoX bosses | `plugins/minigames/cox/` | `chambers-of-xeric.md` | not searched per room | not re-audited |
| ToB bosses | `plugins/minigames/tob/` | `theatre-of-blood.md` | not searched per room | not re-audited |
| ToA bosses | `plugins/minigames/toa/` | `tombs-of-amascut.md` | not searched per room | not re-audited |
| Archive Guardian | `plugins/minigames/tfa/` | `fractured-archive.md` | not searched | not re-audited |

## Findings and fixes

| Boss | Discrepancy | Fixed |
| --- | --- | --- |
| King Black Dragon | dragonfire table, breath mix, ice/poison/shock effects | yes |
| Hespori | protection prayers quartered instead of capping | yes |
| TzTok-Jad | melee speed 8 instead of 4; magic max 97 instead of 95 | yes |
| TzKal-Zuk | projectile rolled 0-251 instead of 0-148; shield took no damage from Zuk | yes |
| Alchemical Hydra | a wrong vent sent a message but did not empower (35 → 52) | yes |
| Kraken | a ranged 1-6 roll was floored to 0 instead of 1 | yes |
| Chaos Fanatic | special weights, 12-attack explosion cooldown, disarm projectile, explosion max 31 | yes |
| Crazy archaeologist | special max 25 instead of 24, 3x3 book coverage, death line | yes |
| Shellbane gryphon | stun counter-attack window, recorded message colours | yes |
| K'ril Tsutsaroth | prayer smash could miss; it always lands 35-49 | yes |
| General Graardor / GWD | an emptied chamber reset only Defence, not every drained stat | yes |
| Giant Mole | respawn 25 ticks instead of the Wiki's 16 | yes |
| Vorkath (quest form) | ranged attack capped at 32 instead of the Wiki's 28 | yes |

Detailed sections below; the Slayer, Wilderness/simple and GWD/classic clusters also have
their own reports with the per-boss evidence tables.

### King Black Dragon — dragonfire, breath mix and effects

Source: [King Black Dragon](https://oldschool.runescape.wiki/w/King_Black_Dragon),
[King Black Dragon/Strategies](https://oldschool.runescape.wiki/w/King_Black_Dragon/Strategies) and
[Dragonfire/King_Black_Dragon](https://oldschool.runescape.wiki/w/Dragonfire/King_Black_Dragon).
No rsprox recording of KBD was found: NPC 239, 2642 and 6502 all return no submissions.

The plugin resolved his dragonfire itself, but the old model was wrong in several ways:

| Thing | Old behaviour | Wiki | Fix |
| --- | --- | --- | --- |
| Fiery breath max | 50 (25 base magic + 25) | 65 unprotected; 15 shield; 20 prayer; 5 prayer+antifire; 0 super antifire | explicit 65/50 table, one entry per protection combination |
| Special breath max | 50 | 50 unprotected; 10 shield; 15 prayer; 10 shield+prayer | same table, special column |
| Breath mix | 4/11 fiery, 3/11 shock, 3/11 poison, 1/11 ice | 50% fiery, then ice/toxic/shocking equally often (1/6 each outside melee, 1/9 each in melee) | 50/50 then 1/3 each |
| Icy breath | freeze 5 seconds (8 ticks) | 10 ticks (6 seconds) | `freezeTicks(player, 10)` |
| Toxic breath | poison severity 30 | poison starts at 8 | `poisonEntity(player, 8)` |
| Shocking breath | not implemented | drains two levels from all stats | drains every skill except Hitpoints by 2, floor 1 |
| Effect chance | not implemented | 1/2 unprotected, 1/8 with a shield and/or Protect from Magic | 1/2 / 1/8, only on a damaging hit |

Tests: `server/tests/king-black-dragon.test.cjs` covers both damage tables for all twelve
protection combinations.

### Hespori — protection prayers were quartering instead of capping

Source: [Hespori](https://oldschool.runescape.wiki/w/Hespori) and
[Hespori/Strategies](https://oldschool.runescape.wiki/w/Hespori/Strategies), checked against
rsprox submission 3282 (76 Hespori lines, including the flower phases, the entangle and the
"currently immune" messages).

The Wiki gives the protected maxima as absolute caps: green spores hit twice for up to 8 each,
and Protect from Missiles makes that 2+2; the magic wave hits up to 14, and Protect from Magic
makes that 3. The plugin divided the roll by four instead, so a 4-damage spore became 1 rather
than 2 and a 3-damage wave became 0 rather than 3. It now caps at 2 per spore and 3 for the wave.
Everything else checked out: attack speed 6, the 100/66/33% flower phases, one-hit flowers,
the 10-tick entangle with the 40+ damage and the five loosen messages, poison 4, and recoil
immunity.

### TzTok-Jad — melee speed and magic max hit

Source: [TzTok-Jad](https://oldschool.runescape.wiki/w/TzTok-Jad) and
[TzTok-Jad/Strategies](https://oldschool.runescape.wiki/w/TzTok-Jad/Strategies). rsprox
submissions 3276 (717 Jad lines) and 551 (402) were used for the wave and attack shapes.

Two numbers were off. Jad's normal attack speed is 8, but the Wiki states his melee bite can
come every 4 ticks; the plugin left every style at 8. And his melee/ranged max hit is 97 while
his magic blast is 95; the cache's single max-hit value (97) was used for all three. The melee
branch now sets a 4-tick delay and the magic impact clamps to 95. The style read, the 15-tile
range, the 3-tick impact, the protection-prayer-at-impact rule and the healer waves already
matched.

### TzKal-Zuk — projectile max hit and shield damage

Source: [TzKal-Zuk](https://oldschool.runescape.wiki/w/TzKal-Zuk). rsprox submission 1754 has 40
Zuk lines.

The Wiki gives Zuk's projectile a single roll between 0 and **148**, the average of his 128
magic and 169 ranged maxima; 251 is his melee maximum and is never used. The Inferno plugin
rolled 0..251 for the projectile, which let an unshielded hit exceed the real maximum by 103.
It also played the shield's block animation but never reduced the shield's 600 hitpoints when
Zuk's own attack struck it. Both are fixed: the projectile rolls 0..148, and a shielded hit
takes the same roll off the glyph. Attack speeds (10, 7 enraged), the 480/240 summon thresholds,
the 600-hitpoint shield, the 15-24 healer ticks and the 5-10 healer blasts already matched.

## Quest bosses

The Wiki's second list (Ezekiel through Colossal Chocco Chicken) is implemented in
`plugins/quests/` where the quest exists: Count Draynor in `VampyreSlayer`, Elvarg in
`DragonSlayer`, the Recipe for Disaster fights in `RecipeForDisaster`, the Desert Treasure II
bosses in `DesertTreasureII`, Brutus in `IdesOfMilk`, and so on. They are quest content rather
than repeatable boss encounters, so they are outside this sweep; the ones with their own docs
(`elvarg-parity.md`, `ides-of-milk.md`, `demonic-gorillas.md`) record earlier capture work.

## Gaps

- **Maggot King** (NPC 15742) is on the Wiki's boss page and has combat achievements and a pet,
  but no fight exists in the server. It needs a full plugin (arena, burrow/egg phases, marquess
  adds, drops) rather than a discrepancy fix.
- **Barrows brothers** and **Hespori** have implementations but no dedicated audit document. Hespori
  is covered above; the brothers' set effects (Dharok's scaling, Guthan's heal, Karil's Agility
  drain, Torag's run drain, Verac's prayer penetration, Ahrim's Strength drain) are implemented in
  `BarrowsEquipment.plugin.js`, and rsprox 1885/4057 contain full runs, but those recordings were
  not read tick by tick in this pass.
- **Kree'arra's melee attack** (Wiki: up to 25/26 when nobody is targeting him) is not
  implemented; no capture in the corpus shows a melee animation for 3162, so adding one would
  invent the animation and trigger. The knockback on his room attacks is also missing.
- **Vorkath's quest-form dragonfire cap (72)** is not applied, because the Wiki's protection
  table is only given for the post-quest form; the spawn landing distance is 8 from the
  recordings but 10 on the Wiki, and packet dumps could not re-measure it.
- **Dagannoth Supreme's splash** is radius 3 (7x7); the Wiki's "6x6 area around his target" is
  not a symmetric box around one tile and the capture has no projectile packets to settle it.
- **Chaos Elemental's special weights** (1/20 Confusion, 3/20 Madness) and its two messages have no
  Wiki figure and no capture; the code keeps its own values. **Chaos Fanatic's** 8-tile range and
  the 5-tick delay after an explosion are likewise unsourced. **Crazy archaeologist's** opening
  scatter radius and the 2-tick burst delay are the Wiki's "in an arc"/"after a delay".
- **Shellbane gryphon's corrosion spacing** is 5 ticks in the data; the Wiki says six hits over
  32 ticks and capture 3456 shows gaps of about six ticks, so it is worth re-checking against a
  longer recording. The "knock it back one tile" and free-attack parts of the counter are not
  modelled.
- **Zalcano's** attack interval (8-12), glowing-rock move (45 ticks), boulder count and golem walk
  speed are calibrated estimates; the Wiki gives no intervals and 4057 was not measured for them.
- **Raids** were not re-opened room by room; their own docs record earlier capture work. The
  Inferno's TzTok-Jad and TzKal-Zuk are covered above, but the other Inferno waves and Zuk's
  minion set timings were not re-read.
- **Quest bosses** (the Wiki's second list, from Ezekiel to Colossal Chocco Chicken) are implemented
  in `plugins/quests/` where the quest exists. They are outside this boss-fight sweep.

## Reproducing the searches

```powershell
$body = @{ conditions = @(@{ type = 0; query = "8058" }); mode = "ALL" } |
  ConvertTo-Json -Depth 5 -Compress
Invoke-RestMethod -Uri "https://rsprox.net/api/search" -Method Post `
  -ContentType "application/json" -Body $body
```

Decode a submission with `~/.rsprox/launcher/repository`:

```bash
java -cp "*" net.rsprox.proxy.cli.BinaryToStringCommandKt -name=rsprox-<id>
```

Companion cluster reports: [slayer](boss-fights-slayer.md),
[Wilderness/simple](boss-fights-wilderness-simple.md), [GWD/classic](boss-fights-gwd-classic.md).
