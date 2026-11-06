# Mining rocks

`plugins/skills/Mining.plugin.js` mines the ore rocks (clay to runite, blurite, barronite, the essence mines) and the
skilling rocks below them: soft clay, lead, lovakite, nickel, rubium, sunstone, infernal shale, gem rocks, amethyst,
Daeyalt and the Cam Torum calcified rocks.
Pickaxe-specific rules are in `plugins/skills/mining/`.

`plugins/areas/MiningGuild.plugin.js` checks 60 current Mining at all four Falador entrance
ladders and the Dwarven Mine door; temporary boosts count. It also operates both doors into
the members' section, including the east door. Exits never require a Mining level, and those
inner doors only admit players on members' worlds. The Motherlode tunnel has its own level check.

## What live OSRS does

From rsprox captures (recordings 3139 and 3182, iron rocks, rev 232) unless another source is named.

| Moment | Live response |
| --- | --- |
| Click on a rock | The first swing lands the tick after the click (after arrival, if the player walked): `You swing your pick at the rock.` (spam) and the pickaxe animation, both at +1 |
| Each roll | The swing sequence is sent again on every roll tick, at the pickaxe's interval, hit or miss (recordings 1636, 3162, 3165; 468 with a bronze pickaxe: +2, +9, +17, +25). The ore that empties the rock resets it (-1) |
| Ore received | `You manage to mine some iron.` (spam; the ore's word; copper, tin, clay, silver, coal, gold, mithril and adamantite are recorded too, some on Leagues worlds), sound 3600, the rock turns into `rocks1`/`rocks2`, `tracking_ore_mined` goes up by one |
| Depletion | `add_overlaytimer_loc` (cache script 5474) is run for the miner with the depleted loc and the respawn in ticks (recordings 3139 and 3182: 9 for iron) |
| Infernal pickaxe | When the ore combusts: `smokepuff` (height 150), sound 2725, no ore and no `tracking_ore_mined` change; the usual mining message, sound 3600 and the Mining XP still come, and the Smithing XP is the Wiki table's (5.5 for iron, recording 3139) |
| Mining cape | `Your cape allows you to mine an additional ore.` (spam) after the ore line, a second ore with its XP, and `tracking_ore_mined` counts both (recordings 3139, 3165) |
| Click on a depleted rock | The swing stops (sequence -1), sound 2661 and `There is currently no ore available in this rock.` as a game message (recording 3139) |
| No usable pickaxe | Message box: `You need a pickaxe to mine this rock. You do not have a pickaxe which you have the Mining level to use.` (recording 73, iron rocks) |
| Level too low | Message box: `You need a Mining level of 55 to mine this rock.` (recording 3280, mithril, a Leagues world; the Wiki gives the same level) |
| Full inventory | Message box, `Your inventory is too full to hold any more <item>.` (recording 70, rune essence, a Leagues world; no recording has the message for an ore rock, so the ore's lowercase item name is the same pattern applied to it) |

Each pickaxe swings its own sequence (`human_mining_<pickaxe>`): dragon 7139, infernal 4482, crystal 8347 and
black 3873 are recorded (recordings 561, 1634, 3276 and 90); mithril 629 and adamant 628 follow the cache names
(mithril is recorded in 1098; the plugin had these two swapped, and gave dragon, crystal and infernal the rune
animation and black the steel one).

The depleted loc is named after the rock's own variant: `ironrock2` becomes `rocks2`,
`ironrock1` becomes `rocks1` (recordings 3139, 3182; copper and mithril rocks in Leagues recordings follow the same pattern). The plugin
reads the digit from the rock's gameval, so every rock with a `...rock<digit>` name follows without a table.

## Levels, experience and respawn

OSRS Wiki rock pages (https://oldschool.runescape.wiki/w/Iron_rocks, `/w/Copper_rocks`, `/w/Tin_rocks`,
`/w/Clay_rocks`, `/w/Silver_rocks`, `/w/Coal_rocks`, `/w/Gold_rocks`, `/w/Mithril_rocks`,
`/w/Adamantite_rocks`, `/w/Runite_rocks`). Respawn is seconds divided by 0.6, rounded to ticks:

| Rock | Level | XP | Respawn |
| --- | ---: | ---: | --- |
| Clay | 1 | 5 | 2 ticks |
| Copper, tin | 1 | 17.5 | 2.4 s (4 ticks) |
| Iron | 15 | 35 | 5.4 s (9 ticks; recordings 3139, 3182 agree) |
| Silver | 20 | 40 | 1 min (100 ticks) |
| Coal | 30 | 50 | 30 s (50 ticks) |
| Gold | 40 | 65 | 1 min (100 ticks) |
| Mithril | 55 | 80 | 2 min (200 ticks) |
| Adamantite | 70 | 95 | 4 min (400 ticks) |
| Runite | 85 | 125 | 12 min (1200 ticks) |

Recording 3280's live message agrees with mithril's level 55.

## Other rocks

OSRS Wiki rock pages (https://oldschool.runescape.wiki/w/Soft_clay_rocks, `/w/Lead_rocks`, `/w/Lovakite_rocks`,
`/w/Nickel_rocks`, `/w/Rubium_rocks`, `/w/Sunstone_rocks`, `/w/Infernal_shale_rocks`, `/w/Gem_rocks`,
`/w/Amethyst_crystals`, `/w/Daeyalt_rocks`, `/w/Calcified_rocks`; pet base rates from `/w/Rock_golem`):

| Rock | Level | XP | Respawn | Before it goes |
| --- | ---: | ---: | --- | --- |
| Soft clay | 70 | 5 | 1.2 s (2 ticks) | 1 |
| Lead | 25 | 40.5 | 6 s (10 ticks) | 1 |
| Lovakite | 65 | 60 | 35 s (58 ticks) | 1 |
| Nickel | 74 | 80.5 | 2 min (200 ticks) | 2-16 ores |
| Rubium | 48 | 30 | 35.4 s (59 ticks) | at least 2 successes, then a 1/6 chance each |
| Sunstone | 53 | 23 | 5.4 s (9 ticks) | 1 |
| Infernal shale | 78 | 13.2-100 (one of ten values) | 9 ticks | 1 |
| Gem rocks | 40 | 65 | 99 ticks | 1 |
| Amethyst | 92 | 240 | 75 s (125 ticks) | 2-3 |
| Daeyalt | 20 | 17.5 | 28 s (47 ticks) | 3 (one stage each) |
| Calcified | 41 | 33 (shards), 36 (deposit) | 30 s (50 ticks) | about 70 s (117 ticks) of being mined, or the end of its water |

- **Mined-out locs:** the Sailing rocks have their own `<gameval>_empty` loc (`leadrock1_empty`, `nickelrock1_empty`,
  `rubiumrock1_empty`, all named "Rocks"); clicking Mine on one says there is no ore, like `rocks1`/`rocks2`. Amethyst
  becomes `amethystrock_empty` ("Empty wall"), and its respawn timer uses the wall's shape 0 (recorded, rev 233-234,
  a Leagues world). The timer always sends the depleted loc's own shape.
- **Rubium:** splinters stack, so a full inventory that already holds some keeps mining. Two splinters a
  success from Mining 72 (visible level).
- **Nickel:** only Varrock armour 4 adds ore (Wiki), so no `mining:extra-ore` (celestial ring, Mining cape). Gem rocks
  and infernal shale take no mining enhancers either: their ore comes from `outcomes`, which never asks for one.
- **Gem rocks** (recordings 1846 and 1858, rev 227, a Leagues world, Shilo Village): `You just mined an Opal!` /
  `a piece of Jade!` / `a Red Topaz!` / `a Sapphire!` / `an Emerald!` / `a Diamond!` (the ruby line follows the same
  pattern), sound 2655 instead of 3600, `tracking_ore_mined` counts the gem, and `gemrock` becomes `rocks2`,
  `gemrock1` `rocks1`. The Wiki table: opal 60, jade 30, red topaz 15, sapphire 9, emerald 5, ruby 5, diamond 4 of
  128. A charged glory changes the success chart itself (below). The recorded respawn timer was 19 ticks, a
  Leagues world; the Wiki's 99 is used.
- **Barronite** (recording 1636, rev 226, Camdozaal; Wiki Barronite rocks): wall swings
  (`human_mining_<pickaxe>_pickaxe_wall`), `You manage to mine some barronite shards.` / `... a barronite deposit.`, and
  the rock stays standing through its ores. It runs out 20 seconds (33 ticks of being mined) after it starts being
  mined, not on an ore: `camdozaalrock1` becomes `camdozaalrock1_empty`, with area sound 2661 (delay 10, range 1).
  The recorded XP packets give 16 for shards and 32 for a deposit, as the Wiki does.
- **Rune essence** (recordings 70 and 3027, Leagues worlds): no chat line for an essence, but sound 3600 and
  `tracking_ore_mined` go up with each one.
- **Sandstone** (recordings 3162 and 3165, rev 232): `You manage to quarry some sandstone.`, `rocks1` for 9 ticks.
  An infernal pickaxe combusts it: `smokepuff`, sounds 2725 and 3600, the quarry line and Mining XP, and
  Smithing 10.2 (1kg), 19.2 (5kg) or 28.2 (10kg), solved from the recorded XP drops. No recording combusts a 2kg
  piece, so 2kg is kept for now. Granite combusts for the Wiki's 7.2, 13.2 and 22.2. A Mining cape's extra piece is
  the same size (Wiki Sandstone rocks; recording 3165: two 1kg pieces).
- **Miscellania coal** (recording 1757, rev 227, a Leagues world): a regent's coal goes to Miner Magnus:
  `You manage to mine some coal, and give it to Miner Magnus.`, no coal, no sound 3600, no ore count,
  `misc_approval` up by one, and Magnus says "Thanks!". Managing Miscellania answers `mining:hand-over`.
- **Amethyst** (recordings, rev 233-234, a Leagues world): wall swings (`human_mining_<pickaxe>_pickaxe_wall`) and
  `You manage to mine some amethyst.`.
- **Daeyalt** (recordings, rev 226-231, Meiyerditch mine): sang wall swings (`sang_mining_wall_<pickaxe>_pickaxe`),
  sound 2998, `You manage to mine some ore.`, and the rock face steps down a stage with each ore,
  `area_sanguine_mine_minerocks_01` -> `_02` -> `_03` while the player mines on, then `_04` with
  `This rock face is now empty.`. It grows back as `_01`. Its ore line is a game message (recording 1637), where
  every other rock's is spam.

### Calcified rocks

Cam Torum mine (Wiki Calcified rocks; rsprox capture 1105, rev 237, a Leagues world, ten water cycles).
`plugins/skills/mining/CalcifiedWater.Mining.js` runs the water.

- **Mining:** wall swings (`human_mining_<pickaxe>_pickaxe_wall`). Each success is 1-3 blessed bone shards (74/75,
  33 XP) or a calcified deposit (1/75, 36 XP): `You manage to chip off some bone shards.` /
  `You manage to mine a calcified deposit.` (spam), sound 3600. `tracking_ore_mined` goes up by the number of
  shards (+3 for three). The gem pre-roll applies; mining enhancers don't. A full inventory stops mining even with
  shards in it (Wiki: shards stack, but a free slot is still needed).
- **Running out:** the rock stays through its ores and runs out on a timer that counts the ticks it is mined: the
  Wiki's "around 70 seconds" (117 ticks). In the capture each mined-out rock went with the first ore after
  121-127 ticks of mining (three of three), so the rock goes with the next ore once the timer is over. The rock
  becomes its own `_empty` loc (`varlamore_mining_rock` -> `varlamore_mining_rock_empty`,
  `varlamore_mining_rock02` -> `varlamore_mining_rock_empty02`, ...), with area sound 2661 (delay 10, range 1)
  and the respawn timer.
- **Water:** `<col=a53fff>Some cracks around the cave begin to ooze water.` (game message) and sound 2041, and
  `varlamore_mining_special_rock` is added as a wall decoration (shape 4) on four rocks' tiles, with each rock's
  rotation. Cycles started 117-146 ticks apart and the water lasted 38-54 ticks (the Wiki: every 1-2 minutes,
  for 20-30 seconds). When it stops the decorations go, and the next tick every one of the four rocks is mined out,
  mined or not, with sound 2661 and the respawn timer for the players there. Every recorded cycle wet two rocks
  of the west half (x 1497-1505) and two of the east half (x 1514-1521).
- **Boost:** the Wiki's 15% better success rate while a rock is wet.

Estimated, not recorded: the success chart (below); that the 15% multiplies the roll's chance (×1.15, capped at
1); that the water picks only standing rocks, at random within each half; the mine's area (x 1490-1528,
y 9530-9553, level 1). The capture's respawns were 11-14 ticks (timers of 12 and 13) on a Leagues world; the
Wiki's 30 s is used, as for gem rocks.

## Rolls and success chance

The pickaxe decides how often the game rolls, the Mining level decides the chance of each roll
(Wiki https://oldschool.runescape.wiki/w/Pickaxe and https://oldschool.runescape.wiki/w/Mining, quoting Mod Ash:
"Your level affects the chance of getting ore each time the game rolls; your pickaxe affects how often that happens.").

- **First roll:** with the skilling timer clear, the tick after the swing message, so +2 after arrival
  (recordings 3139 and 3182, iron, where a high level succeeds on every roll: the ore came the tick after the
  swing message in 33 of 34 attempts with infernal pickaxes; the one dragon pickaxe attempt, in 3182, two ticks after).
- **Ticks between rolls** (Wiki Pickaxe): bronze 8, iron 7, steel 6, black and mithril 5, adamant 4, rune 3,
  dragon and infernal 3 with a 1/6 chance of 2, crystal 3 with a 1/4 chance of 2. The early roll is members-only
  (Wiki Pickaxe changes, 4 May 2022).
- **The timer carries over:** a roll on the next rock waits for the previous roll's interval to run out
  (Wiki https://oldschool.runescape.wiki/w/Tick_manipulation, skilling timer).
- **Chance per roll** (Wiki https://oldschool.runescape.wiki/w/Skilling_success_rate):
  `(1 + floor(low × (99 − L) / 98 + high × (L − 1) / 98 + 0.5)) / 256`, capped to 0-1. The visible level counts
  up to 99; invisible boosts (the celestial ring's +4) add on top and count past 99 (Wiki Skilling success rate,
  Boosts over 99; https://oldschool.runescape.wiki/w/Mining_Guild).

Low and high values from each rock's Wiki skilling success chart (the rock pages above, plus
https://oldschool.runescape.wiki/w/Blurite_rocks and https://oldschool.runescape.wiki/w/Barronite_rocks):

| Rock | Low | High |
| --- | ---: | ---: |
| Clay | 128 | 400 |
| Copper, tin | 100 | 350 |
| Blurite | 90 | 350 |
| Iron | 96 | 350 |
| Barronite | 80 | 100 |
| Silver | 25 | 200 |
| Coal | 16 | 100 |
| Gold | 7 | 75 |
| Mithril | 4 | 50 |
| Adamantite | 2 | 25 |
| Runite | 1 | 18 |
| Lead | 112 | 278 |
| Gem rocks | 28 | 70 |
| Gem rocks, charged glory | 84 | 210 |
| Amethyst | -18 | 10 |

The Wiki has no chart for the rocks below; these are estimates, to replace once there is one:

| Rock | Low | High | Estimated from |
| --- | ---: | ---: | --- |
| Soft clay | 128 | 400 | clay's chart; the Wiki says success is certain well before 70 |
| Lovakite | 16 | 100 | coal's chart |
| Nickel | 4 | 50 | mithril's chart |
| Rubium | 107 | 230 | the Wiki's splinters per hour at 48 and 99 |
| Sunstone | 69 | 301 | the Wiki's momentum rate (75% at 53, 100% at 80) |
| Infernal shale | 60 | 180 | the Wiki: "between iron and coal" to mine |
| Daeyalt | 96 | 350 | iron's chart; recordings got ore on every roll |
| Calcified | 20 | 200 | the Wiki training rates (23,500-49,000 XP an hour at 50-99), and 46% at level 61 in capture 1105 (51% here) |

The Runite rocks page checks the formula: 17/256 at level 85 and 19/256 from 97.

Sandstone and granite charts cascade (Wiki https://oldschool.runescape.wiki/w/Sandstone_rocks,
https://oldschool.runescape.wiki/w/Granite_rocks): the biggest piece is rolled first and each failed roll falls
through to the next size; failing them all gives nothing. Sandstone 10kg 4/50, 5kg 8/75, 2kg 16/100, 1kg 25/200;
granite 5kg 6/64, 2kg 8/75, 500g 16/100.

Rune essence rocks succeed on every roll (Wiki https://oldschool.runescape.wiki/w/Pure_essence, Mod Ash).

## Clue geodes

[Clue geode rates](https://oldschool.runescape.wiki/w/Clue_geode) use the rock's
base, the visible Mining level and each eligible clue tier. The matching Combat
Achievement reward applies its 5% bonus before the level and tier calculations;
beginner geodes do not receive a tier reward. The documented floor order is also
used without a Combat Achievement reward. The present ring-of-wealth effect for
geodes remains unverified here.

## Mining gloves

On members worlds, the equipped gloves keep eligible rocks standing for extra successful gathers before depletion.
Regular, superior and expert gloves respectively save copper, tin, iron, silver, lead, coal and gold rocks one,
two and three times. Superior and expert gloves save mithril and adamantite once and twice. Expert gloves save
sandstone, sunstone, runite and amethyst once. Amethyst retains its normal two or three gathers before that save;
the save budget is cleared when the rock depletes. Granite is unaffected.

The original tier changes are in Jagex's [Project Rebalance](https://secure.runescape.com/m=news/project-rebalance-skilling--poll-81-mta-changes?oldschool=1),
and its [follow-up](https://secure.runescape.com/m=news/minigame-tweaks-skilling-adjustments--more?oldschool=1)
restored the single sandstone save. The current [Mining enhancers](https://oldschool.runescape.wiki/w/Mining_enhancers),
[Lead rocks](https://oldschool.runescape.wiki/w/Lead_rocks) and [Sunstone rocks](https://oldschool.runescape.wiki/w/Sunstone_rocks)
pages cover the later rock entries. As elsewhere on this page, this is the source contract, not an in-game test result.

## Varrock armour and extra ore

On members worlds the worn armour has a 10% extra-ore roll on the ordinary metal rocks supported here:
tier 1 or higher for copper, tin, iron, silver, coal, gold and lead; tier 2 for mithril; tier 3 for
adamantite; tier 4 for runite. The Mining cape and charged celestial ring roll independently where each
is eligible. Each delivered bonus gives normal XP and counts as an ore; each must fit in the inventory
or an accepting storage path. A charged ring loses one charge on the base gather, including when its
bonus roll misses. Treat the single charge in a simultaneous multi-enhancer case as the implementation's
nonrecursive interpretation, not a captured retail observation. See the Wiki's [Mining enhancers](https://oldschool.runescape.wiki/w/Mining_enhancers),
[Iron rocks](https://oldschool.runescape.wiki/w/Iron_rocks) and [Lead rocks](https://oldschool.runescape.wiki/w/Lead_rocks).

## Gems while mining

Before each ore roll on the ore rocks above (not sandstone, granite, essence, gem rocks, sunstone or Daeyalt,
whose Wiki pages have no pre-roll), a 1/256 gem roll; a charged
amulet of glory (glory(1)-(6), (t1)-(t6), eternal) adds a 3/256 roll when it misses
(Wiki https://oldschool.runescape.wiki/w/Template:MiningPreGemDropTable). A hit gives nothing (70/128), an uncut
sapphire (32), emerald (16), ruby (8) or diamond (2), never the ore, no XP, and the rock stays.

Recording 403 (rev 231): the roll after `You swing your pick at the rock.` gave `You just found a Sapphire!`
and `+uncut_sapphire`, with no mining sound or experience and the mining animation carrying on. Recording 90 (a
Leagues world) has `You just found a Sapphire!` while mining coal rocks, and the Leagues recordings have
`You just found an Emerald!`, `a Ruby!` and `a Diamond!` too.

## Not done

- The Mining Guild halves the respawn of iron, adamantite and runite (Wiki rock pages) and gives an invisible +7
  Mining (Wiki Mining Guild), which needs the guild's members area.
- The skilling timer is Mining's own: other skills' actions (herb tar, food) don't delay it, so tick
  manipulation is not modelled.
- The first roll after the swing: main-game captures with dragon and infernal pickaxes have it the tick after the
  swing, but slower pickaxes were recorded later (bronze on gold, recording 468: seven ticks after the swing; steel
  and iron on Leagues worlds: interval minus one). Not enough to model; every pickaxe rolls the tick after.
- Barronite's 1-minute respawn was 67 ticks in recording 1636, and the timer the client was sent read 86.
- Other plugins that mine rocks of their own (quests, minigames, stars, Motherlode) keep their wording.
- No recordings of a successful Mine on lead, nickel, rubium, soft clay, lovakite, sunstone or infernal shale: the
  messages follow the recorded pattern (`You manage to mine some lead.`, `... soft clay.`, `... rubium splinters.`,
  `... infernal shale.`) and are unverified.
- Sunstone momentum (better odds, 28 XP and a 20% extra chunk for 5 ticks after a success) is not modelled.
- Infernal shale's Wiki lists ten XP values at 1/11 each; one value must be twice as likely, so all ten are
  equally weighted for now.
- Varrock armour is supported only on the ordinary ores listed above; other rocks and the armour 4 gem-table
  bonus remain unverified or unmodelled. Mining glove saves use a shared standing-rock budget; the precise OSRS
  behavior when miners compete or change gloves on a partly mined rock is not established here. Depletion
  hooks see a glove-kept rock as already handled. On ordinary iron, Power Miner stacks its four-ore budget
  with glove saves (up to seven). Other finite-yield rocks and stacking with other rock-saving effects remain unverified.
- Access isn't checked: Shilo Village for the Shilo gem rocks, the Mining Guild for amethyst, the Yama contract for
  infernal shale, Sailing islands for lead, nickel and rubium.
- A Daeyalt face only grows back once it is empty; a face left part-mined stays at its stage.
- Calcified rocks: the world-hop debuff (`Your pickaxe keeps slipping on the rocks as it's still wet from the last
  deposit.`) and the Varlamore red token are not modelled.
- Not mineable yet, each needing its own area or mechanic: limestone (stages with their own respawns), rubium and
  infernal shale deposits (one of two active, timed), Daeyalt Essence,
  Tai Bwo Wannai gem rocks, the Lovatt Mine ore veins, the Fossil Island boulders, ash piles and volcanic
  sulphur, the Keldagrim gold vein, the salt rocks, and the Easter egg rock. `tests/mining-parity.test.cjs` lists
  every loc with a Mine option, so a new one without a handler fails the test.
