# Hunter

`Hunter.plugin.js` attaches hooks only; each activity is a module in this folder and reaches the
server through `api.core`. One shared tick task (`Runtime.Hunter.js`) drives cancellable actions, trap
lifetimes, creature respawns and session timers. Attribute state (birdhouses, crab traps, drift
nets, rumours, pursuit charges) is persisted and restored on login.

## Implemented

- **Trap families** (`Traps.Hunter.js`, `Rabbits.Hunter.js`, `Broavs.Hunter.js`): bird snares, box traps, deadfalls,
  net traps (swamp/orange/red/black/tecu salamanders), magic boxes/imp banking, monkey deadfall,
  rabbit snares flushed by ferret, and pitfalls with teasing (`Pitfalls.Hunter.js`).
- **Imp-in-a-box** (`MagicBoxes.Hunter.js`): use it on an item, or "Bank" opens the Imp Release
  Negotiation Form (widget 478, rsprox recording 2256). The imp banks two items or stacks, then
  becomes a magic box. It refuses under Tele Block, above Wilderness level 30 and for the items
  the Wiki lists (https://oldschool.runescape.wiki/w/Imp-in-a-box). The refusal messages for Tele
  Block and the listed items are not captured; the form closing after the second item and the
  Deposit click being op 1 are assumed, not recorded.
- **Bait and scent**: tars, spicy tomato/minced meat, jerboa tail and kebbit baits (3% bonus for
  the matching creature), smoke from a lit/bruma torch or auto-applied anti-odour salt (2%).
  Ownership, per-kind trap limits (extra in the Wilderness), expiry/collapse and preflighted
  inventory transactions are enforced centrally.
- **Tracking** (`Tracking.Hunter.js`): five pursuit species, noose wand catches, ring of pursuit with
  10 persisted charges, trail varbits sent to the client.
- **Catching** (`Catching.Hunter.js`, `LuckyLoot.Hunter.js`): falconry, four butterflies, sunlight/moonlight
  moths with barehand and net curves, twelve impling species with rebuilt Wiki loot tables,
  released-butterfly boosts, and Lucky jars resolved through `hunter:lucky-loot` or the local
  reward-casket tables.
- **Hunter's mixes** (`Catching.registerMixes`): Drink on the six two-dose butterfly and moth mixes,
  registered with the Potions plugin (`potions:register`) so they share its doses and 3-tick delay,
  without its eating delay (`eatingDelay: false`; Wiki: no eating or attack delay), and kept out of
  the chugging barrel (`chuggable: false`; Wiki: Chugging barrel).
  Each dose gives the jar's own bonus (`bonus`) to the drinker and, in a multicombat area, to up to
  three other players within two tiles who accept aid (Wiki "Hunter's mix" and each mix's page).
  The last dose leaves a butterfly jar. A moonlight moth mix drink sends "You drink some of your
  potion." before the doses-left line (rev 241 rsprox_transcripts/241/900128.txt ticks 12 and 15,
  `data/potion-drink-lines.json`); the other five have no recorded drink, so they send only the
  doses-left line. Making the
  mixes (jar + raw hunter meat with a pestle and mortar) and their Empty option (no source says what it
  leaves) are not implemented.
- **Birdhouses** (`Birdhouses.Hunter.js`): nine tiers, crafting, seeding (hop/herb/allotment/flower/
  bush), 50-minute wall-clock growth, nest/ring/egg/clue-nest/scroll-box rewards, reset.
- **Aerial fishing** (`Aerial.Hunter.js`): cormorant hire, king worms/fish offcuts/whole-fish feeding,
  Molch pearls, golden tench, spirit flakes, Rada's blessing, fish cutting and clue bottles.
- **Herbiboar** (`Herbiboar.Hunter.js`): five starts, cache-derived trail graph, fossil/numulite
  inspections, tunnel flush, 1-4 herbs by Herblore level with magic secateurs, Herbi pet.
- **Drift net fishing** (`DriftNets.Hunter.js`): Ceto or the tunnel beside her (daily/permanent numulite;
  the sea floor is reached by the rowboats in `plugins/areas/FossilIslandUnderwater.plugin.js`), two anchors,
  Annette's 2,000-net storage, active chase and passive capture, fish/fossil/clue rewards and
  bank-for-5-numulite, 44 Hunter/47 Fishing level-gated.
- **Crab traps** (`Crabs.Hunter.js`): red/blue/rainbow traps built with Construction, baiting,
  auto-rebait, crab meat/paste cutting.
- **Dungeon** (`Dungeon.Hunter.js`): seven Chambers of Xeric bats and the Neypotzli moss-lizard rope trap.
- **Rumours** (`Rumours.Hunter.js`): six guild hunters, eligibility and consecutive-rumour settings,
  rare-part pity/outfit rates, four loot sacks, quetzal-whistle blueprints and guild armour.
- **Broavs** (`Broavs.Hunter.js`): While Guthix Sleeps pit trapping, wild broav capture, hunting-expert
  training, release and pick-up.
- **Free bird snare** (`Supplies.Hunter.js`): Take on the Isle of Souls bird snare loc
  (`hunting_bird_snare_for_taking`, 2167,2981) plays human_pickupfloor and gives one bird snare with
  sound 2582 a tick later; holding three it says "You already have plenty of those." (rsprox.net
  recording 70, rev 227 Leagues V, ticks 2603-2627). Only the inventory counts, and the cap of three is
  the one recorded boundary (refused at 3, taken at 2); the full-inventory reply is not recorded.
- **Pets**: baby chinchompas, Herbi and Quetzin roll from `hunter:success`; spawns for the
  Varlamore creatures/moths, guild NPCs and tecu salamanders live in `npc-spawns.json`.

## Approximations and known limits

Catch curves use the Wiki's published success-chart low/high values with the 256-roll
interpolation in `Context.probability`. Where the Wiki publishes no numbers, the code carries a
`ponytail:` comment naming the estimate:

- Tatty-fur quality, Herbiboar's 1/100 tracking failure, birdhouse clue-nest pre-rolls
  (1-30/1500, marked approximate on the Wiki), drift-net scare odds/passive timing/fossil
  amounts, aerial pearl and clue rates, and rumour rare-part rates are estimates.
- Drift-net shoals are scared into swimming to the nearest non-full net and caught on arrival;
  they cannot get stuck on rocks, each other or the player.
- Pitfall prey follows the player (the engine's NPC follow) and attacks on contact, for about 100 ticks
  (larupia capture: teased at 252, gave up at 355). Ours: the 16-tile range. Sunlight/moonlight antelopes
  use the Wiki's flat 255/255 chart.
- Lucky jars only give one clue-table roll; another plugin may answer `hunter:lucky-loot`.
- Wyrmscraig goats, Letvek and Stymphalak have no usable rev237 assets and are excluded. Aerial
  fishing uses king worms/fish offcuts because fish chunks and javelin heads are absent.
- Box traps need Eagles' Peak from stage 6, when Nickolaus teaches them at the camp (the Wiki asks
  for partial completion); quest plugins answer `quest:is-complete`, or the fallback reads
  `quest.<key>.stage >= 2`. Tracking, box traps, Herbiboar and a full drift-net cycle have been
  played through with the agent MCP; most other methods have not.

## Trap, catch and trail feedback

From rsprox captures (box traps 119, 120, 1104, 1108, 1871, 4002, 4051; bird snares 70, 1102, 1788;
net traps 1108, 1115, 1128, 1858; deadfalls 1105, 1757; pitfalls 1108, 1757, 1858; broav pit 1698;
butterflies and moths 95, 1634, 3279, 4051; herbiboar 127, 552, 554, 1858; bird houses 545-572):

- Laying: the lay animation, the set-up sound (box 2636, bird snare 2646, net 2644, deadfall 2645)
  and `You begin setting up the trap.` (`... a trap.` for nets and deadfalls) come at once, all
  spam. A box trap or snare goes on the floor until its loc replaces it (2 and 3 ticks); a tree or
  boulder shows its setting loc and the trap stands a tick later. Reset lays again three ticks
  after the dismantle.
- Deadfalls leave their 5212 animation to play out (about 4 ticks) after setting up, baiting and
  dismantling: live sends no reset (`keepsAnimation`; the user's rsprox recording
  pyre-fur-and-smallpouch-1, rev 242, and 1105, 1108, 1757). Other traps still reset when the action
  ends. Baiting one says `You lay the jerboa tail beneath the deadfall as bait.` (the same recording;
  other deadfall baits take the same line).
- Each trap state sends the cache's `add_overlaytimer_loc` timer: yellow while it waits, green on a
  catch, red when it failed.
- A catch shows the creature's trapping loc (the cache's `_full_` loc renamed `_trapping_`, or
  `_catching_` for saplings; box traps add the side the creature came from) and a miss the failing
  loc, with the trap's sound; the full or failed loc follows two ticks later. No message is sent.
- Check and Dismantle: the trap's own animation (5212, or 5207 for snares and nets), then two ticks
  later sound 2632, `You dismantle the trap.` and `You've caught a <creature>.` (spam). Pitfalls
  send the dismantle line at once and `You've caught a <creature>!` a tick later. Collapses:
  `The box trap that you laid has collapsed.`, `The net trap that you set has collapsed.` (spam),
  `The bird snare that you laid has fallen over.` (game), `The deadfall trap that you constructed has
  collapsed.` (game; 1108 tick 19220).
- Setting a deadfall without logs or a knife says `You need some logs and a knife to set a deadfall
  trap.` (the user's rev 242 recording 20261112T001359 tick 36; 1108 ticks 17710, 18947).
- Barehanded butterflies and moths resolve on arrival: `hunting_impling_catch`, the creature's
  `_out_spot_anim` graphic and sound 7870 (45 cycles late), `You catch and release the <name>.`
- Herbiboar trails: the bush-search animation, then the object's line two ticks later; the harvest is
  `pruning_high` with the herbiboar waking, then sound 1641, the herbs and two game messages.

## Pitfalls

From rsprox captures (spined larupia: a main-game capture, rev 242, `hunter/larupia`; graahk 1108, 1858;
kyatt 1757; sunlight antelope 1108, 4046, 4051, Leagues worlds) and the Wiki ([Pitfall trapping](https://oldschool.runescape.wiki/w/Pitfall_trapping)):

- Each pit is the map's 2x2 multiloc (`hunting_pitfall_1..18`) on its own varbit
  (`hunt_pitfall_state<n>`): 0 Pit, 1 Spiked pit, 2 collapsing, 3 or 4 full. The loc never changes,
  so Trap, Jump and Dismantle route to the pit from either side.
- Every state change sends script 6678 at the pit's coord; a set pit then gets the yellow
  `add_overlaytimer_coord` timer (301 ticks) and a full one the green (141; 143 on Leagues worlds). An untouched set pit
  collapses after 300 ticks: varbit 0 and `The pitfall trap that you constructed has collapsed.`
- Tease: `hunting_teasing_animal` with sound 2524, no message. Without a teasing stick or spear:
  `I don't want to lose a finger by poking it. Maybe I should get a professional teasing implement instead.`
- The player lands three tiles from where they jumped, on the far side of the pit.
- Catch, in ticks after the jump: the creature steps one tile at a time onto the loc's coord, along its
  row or column: from 2 tiles at +5 and +6, from 3 at +3, +5, +6, from 4 at +3, +5, +7, +8 (larupia
  tick 506). Two ticks after the last step the varbit goes to 2 and it plays its fall (5234, antelopes
  10928) with graphic 933 or 935 and pit sound 2638. Three ticks later the pit shows full, with the
  creature's sound (larupia and graahk 667, kyatt 836, sunlight antelope 7890): 3 when the jump runs
  the loc's own way ((rotation + 2) % 4, north = 0), with graphic 933; 4 the other way, with 935. The
  creature goes then and is back at its spawn a tick later. The same pit catches the next creature at
  once (1757, ticks 19124 and 19143; larupia ticks 201 and 229).
- Miss (1108, tick 21487; larupia, tick 422): a step towards the pit at +3; at +5
  `hunter_bigcat_leap_npc` (5231), sound 2619 and the creature's two `leaptrap` projectiles; at +7 the
  creature is beyond the pit, knocks a player standing there back two tiles (5206, sound 513) and
  follows on. That creature won't use that pit again, even teased afresh, until it is caught: the player
  still jumps, and three ticks later gets `The larupia won't jump the same pit twice in a row.` (larupia
  ticks 438 and 471). Ours: antelopes use the cache's `unicorn_rework_leap_npc` (10929); no antelope
  miss is captured.
- A full pit left alone collapses with the same message about 140 ticks after it filled, the catch lost
  (larupia ticks 519 and 659). Not copied: on Leagues worlds live also sent it after the pit was
  dismantled.

## Impling catching

From rsprox captures (main game 1342, 1389, 1510, 2520; Leagues 92, 95, 164, 1757, 1823, 1858)
and the Wiki ([Implings](https://oldschool.runescape.wiki/w/Implings),
[Baby impling](https://oldschool.runescape.wiki/w/Baby_impling)):

- A catch resolves on the tick the player reaches the impling (most attempts by a player already
  in reach land on the click's own tick, most others one tick later): the net throw
  (`ii_human_net_throw_oldnet`, 6606) or barehanded grab (`hunting_impling_catch`, 7171), sound
  2623, the message, the jar or loot and the XP arrive together.
- The impling plays `ii_impling_caught` (6615) and is removed two ticks later, in every attempt
  whose window shows the removal (1342; Leagues 92, 95, 1858).
- Messages: "You manage to catch the impling and squeeze it into a jar.", "You manage to catch the
  impling and acquire some loot." (barehanded without a jar, outside Puro-Puro), "You don't have
  an empty impling jar in which to keep an impling.", "You need a Hunter level of at least # to
  catch this impling." (with " barehanded" when no net is wielded), and "You'll need to clear
  some space in your pack to catch this impling without a jar."
- Puro-Puro's fixed spawns return 50 ticks after removal for earth and essence implings and 7
  ticks for the others (Wiki). Puro-Puro needs a jar for every catch; outside it a barehanded
  catch without a jar is looted at once.

Impling jar supplies: [Anchovy oil, revision 15186565](https://oldschool.runescape.wiki/w/Anchovy_oil?oldid=15186565) describes eight anchovy paste used on an empty vial with a sieve; [Imp repellent, revision 15185078](https://oldschool.runescape.wiki/w/Imp_repellent?oldid=15185078) gives the flowers, unboostable Herblore 3 and 5 XP. [Impling jar, revision 15183926](https://oldschool.runescape.wiki/w/Impling_jar?oldid=15183926) describes one repellent followed by one butterfly jar at the Rimmington still. The existing Herblore plugin applies its Druidic Ritual gate to the flower mix; its applicability to this recipe is not established here. As a conservative server policy, either still refuses swamp tar while Rimmington holds repellent, and Rimmington refuses repellent while the player has stored lamp oil; retail collision behavior has not been captured.

Not reproduced: the two main-game barehanded loot catches gave 14 (earth, 1510) and 16 (essence,
2520) Hunter XP, against the Wiki's overworld 27 and 29; no source explains it, so the
Wiki value stays. 
Roaming spawns ([Implings](https://oldschool.runescape.wiki/w/Implings)):

- Puro-Puro (`minigames/impetuousimpulses/Roaming.ImpetuousImpulses.js`): each point holds an
  invisible impling that manifests after the existing 200 ticks and is replaced two ticks after
  capture, rolling its tier's Wiki table. The embedded Puro-Puro map in
  [Implings revision 15360701](https://oldschool.runescape.wiki/w/Implings?oldid=15360701)
  supplies 10 low, 12 mid and two high precursor points. The high points are (2576, 4336) and
  (2610, 4301); the previous extra points (2570, 4298) and (2610, 4338) are uncorroborated.
  That revision's prose instead says 21 low/12 mid/two high, contradicting its map; eleven
  additional low points are not invented. The map's integer X/Y descriptions match its marker
  centers offset by half a tile. This is plugin-owned spawn configuration, not a generated
  NPC-definition export.
- The same Wiki revision explicitly says implings cross obstacles including water and magical
  wheat. Roaming Puro-Puro implings use the existing movement clipping opt-out. The estimated
  wander radius remains eight, capped by each point's distance to the cache-backed interior
  rectangle (2562..2621, 4290..4349) to contain ordinary spawn-centered wandering. This cap is a
  server containment choice, not evidence for retail radius or a forced-displacement boundary.
  Overworld movement remains outside this change. The Wiki's two-minute
  invisibility claim carries a confirmation-needed qualification; this change preserves the
  server's timers rather than establishing retail timing.
- Overworld (`Overworld.Hunter.js`, driven by the shared tick): every 30 minutes the previous
  implings are removed and 4 high, N (5-10) mid and 2N low implings appear at random points from
  the cache's map data, invisible for two minutes, plus a crystal impling in Prifddinas. A caught
  one is gone until the next cycle. Not in: the Wiki's fixed low-tier points (ten, and Zanaris
  marketplace) have no coordinates here, and the wander radius (8) is an estimate. The imp
  defenders (npc 5738) freeing jarred implings are not in.

The same flight rule also applies to the 51 fixed Puro-Puro implings loaded by the world spawn
definitions. The existing `npc:added` event applies it after the loader has set each NPC's
position and radius, covering deferred activation on ordinary entry. Radius never grows:
the fixed default of five is capped by the same interior rectangle (edge points at 2563 or 2620
can otherwise target across the enclosing walls). The broader Hunter realm rectangle remains
2560..2623, 4288..4351. This is the same server containment inference as for roaming.
The Hunter-owned fixed return path is preserved: two ticks of the caught animation, then seven
hidden ticks for baby/young/gourmet/eclectic or 50 for earth/essence before returning visibly
to the original spawn. The existing native suite now also loads the actual world definitions,
activates the fixed population, checks real wheat collision and NPC/realm controls, dispatches
Catch, and completes both seven- and 50-tick return paths through another ordinary Catch.
Actor placement/equipment/levels/approach and successful RNG are supplied. Natural random
wandering, client rendering and generic impling teleport/expiry timing remain unverified.
The Wiki also distinguishes obstacles drawn as minimap lines. Cache242 supplies 244 unique
wall-type placements, all on the enclosing edges x2561/2622 or y4289/4350 (raw records can
repeat when preceding cases load the same map). The native fixture checks actual
wall orientations and player collision on all four edges, every fixed/roaming destination
square's interior containment, and the real coordinator/queue with supplied extreme rolls.
The interior cap prevents ordinary spawn-centered wandering across those walls; it does not
provide generic wall collision after forced displacement or establish overworld wall parity.

The existing `impetuous-impulses.test.cjs` suite includes a native roaming route: real plugin
startup, cache-backed Puro-Puro magical wheat, movement queues with player/ordinary-NPC collision
controls, packet-listener Catch dispatch, jar conversion, and real task-owned removal,
replacement and manifestation. It supplies actor location/levels/equipment, approach and
successful catch RNG. It does not prove natural random wandering, client rendering, travel,
retail timing or imp-defender behavior. Run from `server/` after building:
`node --test tests/impetuous-impulses.test.cjs`.

On cache revision 242, immutable source `9ae5d54ff3a1312f3326bbd97977d20862c9b6dc` passed all
22 suite tests plus three `movement-stopping.test.cjs` controls in HF. The identical roaming
fixture on baseline `718926828fcb000dcd314641844f2f70ba7d6ac1` exposed 26 instead of 24 points,
clipped flight and the missing replacement flag (four leaf failures plus a parent summary).
At cached wheat 25026, (2579,4331) to (2580,4331), the player and ordinary NPC stayed blocked;
the roaming impling was blocked before and crossed after. The fixed run also passed jar
conservation on a repeated Catch and an invisible replacement, plus removal and manifestation
completion. Source, compiled output and all 28 cache-file checks were unchanged. These results
qualify that revision; later source integrations need their own relevant validation.

## Sources

Requirements, drop tables and success charts come from the [OSRS Wiki](https://oldschool.runescape.wiki/w/Hunter)
and were checked against the rev237 cache with the `dump:*` scripts. Tracking trail
coordinates/varbits adapt [Void](https://github.com/GregHib/void)'s data (BSD-3, see
`Tracking.LICENSE`); Herbiboar search coordinates adapt RuneLite's herbiboar plugin (BSD-2, see
`Herbiboar.LICENSE`); leap/rabbit spotanims use RuneLite `SpotanimID` ids. Earlier trap work used
Near-Reality as a behaviour sketch; no code from it is used (it has no license).

Check: `yarn build && node --test tests/skill-max-level.test.cjs` from `server/`.

## Drift-net clue rewards

The [OSRS Wiki's drift net fishing reward table](https://oldschool.runescape.wiki/w/Drift_net_fishing)
specifies pufferfish when a successful medium-clue roll cannot award another clue. The harvest
now retains that outcome when the medium-clue capacity is reached in inventory or bank, and
when a clue has already been rolled earlier in the same harvest. Previously those successful
rolls instead chose an ordinary fish from the level-dependent table.

The reward path still checks the fossil pre-roll before the clue roll. An empty fossil roll
stays empty, as the Wiki's cited explanation specifies. A failed clue roll still selects an
ordinary fish. The server's explicit clue-vessel opt-out continues to skip the clue roll and
select fish; its existing quest-dependent scroll-box conversion and capacity rules are preserved.

Regression coverage exercises the real reward generator with the shared clue-capacity policy,
both inventory and bank ownership, and repeated clue wins within a harvest. Five regressions
failed before the fix. A native harvest regression takes the generated rewards through the
registered object interaction and collection dialogue. Rare clue-roll branches are selected
deterministically in regressions; no direct drift-net reward capture was found in the indexed
recordings, so these changes rely on the Wiki rather than a recording ID.

A live check used supplied ordinary equipment and skills plus Bone Voyage completion as setup:
Ceto charged 200 numulite, setting a net consumed one net, one passive catch at level 99 gave
77 Fishing XP and no Hunter XP, and taking the harvest delivered one oyster and cleared the
net. This checks the normal collection path; the rare clue outcomes were verified by the
regressions, not by that live catch.

## Jar generator and Elnock equipment payment

[Jar generator, revision 15367163](https://oldschool.runescape.wiki/w/Jar_generator?oldid=15367163)
specifies 100% charge, 3% per impling jar and 1% per butterfly jar, with the generator disappearing
when exhausted. Charges are stored on the item and survive bank cloning. The final output replaces
the exhausted item, so it can fit in that slot in a full bag. Earlier uses require an empty slot;
refused uses preserve charge. Its `Impling-jar`, `Butterfly-jar`, `Check` and `Destroy` options are
confirmed by revision 242's `ii_jar_generator` item (11258); Destroy uses the existing shared item
handler. Exact Check, insufficient-charge, full-bag and recharge dialogue wording is not recorded;
the plugin supplies functional messages. The charge arithmetic comes from the Wiki, without a
captured generation event. The initial RSProx item-11258 query found no matches; this is not proof
that no relevant recording exists.

The Wiki specifies one owned generator and a choice to recharge the existing one for the same
payment when requesting another. Elnock detects it in carried equipment/inventory or non-search
bank tabs, asks for confirmation, and checks the current item and full payment again. Charge
updates affect that instance rather than creating another. A generator lost on an unsafe death
is not kept or dropped. Safe deaths preserve it.

The equipment payment recipes require all three listed stacks. The imported Elnock transcript
explicitly uses **and**: three baby/two young/one gourmet for repellent; three gourmet/two earth/one
essence for the net; three essence/two eclectic/one nature for the generator. Cache structs
1240–1242 bind those item/count pairs; the earlier plugin incorrectly treated them as alternatives.
The separate offer exchanging one filled jar of any type for three empty jars remains a choice
of a single jar. Generated dialogue data is unchanged.

Validation extends `impetuous-impulses.test.cjs` for cumulative payment and refusal
conservation, and `small-conversions-preset-copies.test.cjs` for registered Trade/Confirm and jar
actions with real Player/Inventory, seeded bank/skills and a registered Hunter catch. The recharge
choice uses the real dialogue handler. Seeded actors, positions and deterministic catch RNG are
supplied setup; these checks do not establish natural travel, packet/client rendering, precise
retail wording or a complete death sequence. From `server/`, after building and obtaining the
matching cache, run `node --test tests/impetuous-impulses.test.cjs` and
`node --test tests/small-conversions-preset-copies.test.cjs`. The PR retains the observed execution
results and their validated revisions.
