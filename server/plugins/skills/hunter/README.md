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
- Pitfall prey follows the player and attacks on contact; leap graphics are validated against
  rev237 (`dump:spotanim`). Sunlight/moonlight antelopes use the Wiki's flat 255/255 chart.
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
- Each trap state sends the cache's `add_overlaytimer_loc` timer: yellow while it waits, green on a
  catch, red when it failed.
- A catch shows the creature's trapping loc (the cache's `_full_` loc renamed `_trapping_`, or
  `_catching_` for saplings; box traps add the side the creature came from) and a miss the failing
  loc, with the trap's sound; the full or failed loc follows two ticks later. No message is sent.
- Check and Dismantle: the trap's own animation (5212, or 5207 for snares and nets), then two ticks
  later sound 2632, `You dismantle the trap.` and `You've caught a <creature>.` (spam). Pitfalls
  send the dismantle line at once and `You've caught a <creature>!` a tick later. Collapses:
  `The box trap that you laid has collapsed.`, `The net trap that you set has collapsed.` (spam),
  `The bird snare that you laid has fallen over.` (game).
- Barehanded butterflies and moths resolve on arrival: `hunting_impling_catch`, the creature's
  `_out_spot_anim` graphic and sound 7870 (45 cycles late), `You catch and release the <name>.`
- Herbiboar trails: the bush-search animation, then the object's line two ticks later; the harvest is
  `pruning_high` with the herbiboar waking, then sound 1641, the herbs and two game messages.

Not in yet: live pitfalls are one varbit-driven loc per spot (`hunt_pitfall_state<n>`) with a coord
timer, and the creature falls in about 8 ticks after the jump; here the pit is replaced by spawned
locs and the catch lands on the jump.

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
  invisible impling that roams two minutes before it shows and is replaced as soon as it is
  caught, rolling its tier's Wiki table. Points come from the cache's map data (10 low, 12 mid,
  4 high); the Wiki counts 35 (21/12/2) without coordinates, so the low tier is short.
- Overworld (`Overworld.Hunter.js`, driven by the shared tick): every 30 minutes the previous
  implings are removed and 4 high, N (5-10) mid and 2N low implings appear at random points from
  the cache's map data, invisible for two minutes, plus a crystal impling in Prifddinas. A caught
  one is gone until the next cycle. Not in: the Wiki's fixed low-tier points (ten, and Zanaris
  marketplace) have no coordinates here, and the wander radius (8) is an estimate. The imp
  defenders (npc 5738) freeing jarred implings are not in.

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
