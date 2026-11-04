# Mastering Mixology

The Alchemical Society's Herblore lab under Aldarin. Players refine herbs into Mox, Aga and Lye paste, mix potions from three levers, finish them at one of three stations and hand them in against orders for resin, which buys the rewards. Behaviour follows the [OSRS Wiki](https://oldschool.runescape.wiki/w/Mastering_Mixology) for XP, resin, order weights, paste per herb and digweed. Ids, messages, animations, sounds, varbits and tick timing come from rsprox captures (https://rsprox.net/database) and the rev 241 cache.

It is one plugin, `server/plugins/minigames/MasteringMixology.plugin.js`, which delegates to one unit per part of the lab in `server/plugins/minigames/mixology/`. The reward shop runs on the generic [omnishop](omnishop.md).

Most Mixology recordings come from Leagues VI worlds, whose relics speed stations up and multiply XP and resin by 8. Timings come from the normal-world recordings: 4184, 4186, 4187, 4191, 4194 and 4197, plus 2762 for the entrance. The Leagues recordings (1107, 4177-4242) were only used for things relics don't change: messages, varbits, the skillshot shape, digweed and the shop. The retort was only recorded on Leagues worlds.

## Layout

| File | What it owns |
| --- | --- |
| `Shared.Mixology.js` | Ids, the potion table (cache enums + data file), the player's varbit-backed state, colours, helpers. |
| `State.Mixology.js` | Persistence and the login sync of every lab varbit, the resin and the orders count. |
| `Area.Mixology.js` | The lab (y 9319 and up) as an Area: the HUD, the stations' idle loops, per-tick work, leaving. |
| `Stairs.Mixology.js` | The staircase both ways, with Clanila's first-time gate (60 Herblore). |
| `Supervisor.Mixology.js` | Supervisor Lalo's transcript variants, the lines the Wiki transcript lacks, the shop. |
| `Refiner.Mixology.js` | The refiner (herbs to paste) and the hopper (paste into the mixer). |
| `Mixer.Mixology.js` | The three levers, their mixers and the mixing vessel. |
| `Stations.Mixology.js` | The retort, agitator and alembic: progress, clicks, skillshots, Check. |
| `Orders.Mixology.js` | Orders, the conveyor belt hand-in and its rewards. |
| `Digweed.Mixology.js` | Digweed patches, collecting it, mixing it in, withering. |
| `LabNotes.Mixology.js` | The lab books, the notes' formulas interface, inspecting a finished potion. |
| `RewardShop.Mixology.js` | Mixology Rewards' currencies, descriptions and the potion storage unlock. |
| `Commands.Mixology.js` | `::resin <mox> [aga] [lye]` and `::digweed` (developer). |
| `../data/mastering-mixology.json` | Potions (paste, XP, weight, resin), herb paste values, shop descriptions. |

**Changes outside the plugin:**
- **The generic stand-in shop is gone.** Shop 1234 "Mixology Rewards" (priced in coins, bound to Lalo's op3) is removed from `shops.json`; the omnishop replaces it.
- **`npc-spawns.json`** gains Supervisor Lalo (multinpc 14099) and the lab techs Juatil and Kali, at their captured sites.
- **`CacheDefinitions.getDbRowId(name)` / `getDbRowName(id)`** look DB rows up by gameval name, like `getVarbitId`.

## Cache

**Varps:** 4414-4416 Lye, Aga and Mox resin; 4480 `total_mixology_orders` (hand-ins that filled an order).

**Varbits**

| Varbit | Name | Values |
| --- | --- | --- |
| 11295 | `mm_potion_storage_unlocked` | bought in the shop |
| 11315-11320 | `mm_lab_order_N_type` / `_modifier` | type: enum 5542 index; modifier: 1 Homogenous (agitator), 2 Concentrated (retort), 3 Crystalised (alembic) (enum 5545) |
| 11324-11326 | `mm_lab_mixer_slot_0..2` | 1 mox, 2 aga, 3 lye; slot 0 is the newest pull (multilocs 55392-55394) |
| 11327-11329 | retort, alembic, agitator progress | 0 to `45 - floor(Herblore / 3)` |
| 11330-11333 | `mm_herb_ready_1..4` | digweed patches 55396-55399: NE, SE, SW, NW |
| 11334 | `mm_orders_since_herb` | hand-ins since the last digweed |
| 11335 | `mm_introduction_complete` | Clanila let the player in |
| 11336 | `mm_met_supervisor` | Lalo explained the lab (14099 shows 13921 with Rewards) |
| 11337, 11338 | skillshot hit | agitator, alembic |
| 11339 | `mm_lab_vessel_ready` | the vessel's potion (multiloc 55395) |
| 11340-11342 | station potion | agitator, retort, alembic (multilocs 55390, 55389, 55391) |
| 11431-11433 | `mm_available_mox/aga/lye` | paste in the hopper, up to 3,000 each |

**Potions** are indexed as enum 5542 lists their unfinished items: 1 MMM, 2 MMA, 3 MML, 4 AAA, 5 AAM, 6 AAL, 7 LLL, 8 LLM, 9 LLA, 10 MAL. The vessel and stations' multiloc transforms and the order varbits use the same index. Note that the item ids run AAL before AAM and LLA before LLM. A finished potion is its unfinished id + 10. Levels come from enum 5548. The HUD (882) draws itself from the order and paste varbits (scripts 7063, 7064).

## Captured behaviour

- **Entrance:** Climb-down the first time plays Clanila's entering variant. With 60 base Herblore, her last line sets 11335 and the player goes down as it closes. Climbing either way fades out (fade_overlay, script 948), moves the player two ticks later (to 1388, 9313 or 1388, 2918), fades back in a tick after that, and closes the overlay two ticks later.
- **Supervisor:** the first-time transcript plays until the run-through choice. The Wiki transcript leaves out two lines there ("Now, as you produce these potions..." and "Right, that covers the basics..."). Live sends them (recording 4184) and sets 11336 on the first. Before then, every machine answers "Hey! I haven't given you permission to do that!".
- **Refiner:** each click refines one herb straight away, then the refiner keeps going every second tick. Each herb gives `human_alchemy01_mill01_interact01`, its paste (Lantadyme +40 Aga, Harralander +20 Mox) and 6 XP.
- **Hopper:** puts all carried paste in at once. The message box reads "You deposit the following into the mixer:<br>410 Mox paste<br>...", with `human_alchemy01_hopper01_interact01` and synth 2739.
- **Levers:** a pull plays `human_alchemy01_lever01_interact01`, synth 2400 (delay 2), the lever's interact loop, and a colour change on each changed mixer (mox blue, aga green, lye red: `machinery_alchemy01_mixer_clear_to_blue01` and so on). With three slots set, the vessel takes that potion and plays `vessel01_filling01`. Taking from the vessel plays `human_pickuptable_walkmerge`, then a tick later synth 2582 and `vessel01_emptying01`. The mixers go back to clear and 10 paste per letter comes out of the hopper. When paste is short, a message box lists what is missing.
- **Stations:** see `Stations.Mixology.js`. Progress goes up 1 per tick to `45 - floor(Herblore / 3)`, counting boosted levels (normal worlds: 20 at 75, 12 at 99 and 100; Leagues: 21 at 72, 11 at 102, 8 at 111). Each click on the retort adds 1 more. The alembic's initial cue is counted after four active processing pumps rather than saved progress (see the recovery caveat below) (synth 2655 and its vfx, 30 cycles late); a click on the next tick hits. The agitator cues at progress 2-5, and either of the next two ticks hits. A hit adds a third of the total, then +2 for that tick, and gives 14 XP (the agitator's second hit gives 2 more). A miss loses 2. A potion left in a station waits there.
- **Conveyor:** each finished potion fills the first open order that matches both its potion and its modifier. With none matching, the first finished potion goes in unordered. All three orders are redrawn on the same tick. The resin message reads "You are rewarded a/b/c. You now have x/y/z.". Each potion gets a `mm_conveor_travel_<potion>` projectile, and NPC 13919 says "<col=389cff>+10 Mox</col>" over the belt for ten ticks.
- **Digweed:** spawning, collecting and mixing it in are described in `Digweed.Mixology.js`. "A herb to the south east has matured..." and "The matured herb has died."
- **Colours:** live picks the message colours from the chatbox's transparency (varbit 4608): <col=6800bf> and <col=0000b2>/<col=06600c>/<col=e00a19> on the opaque chatbox, <col=a53fff> and <col=3366ff>/<col=229628>/<col=ff3045> on the transparent one.

## From the Wiki, not the captures

- XP per potion (190-365), with an unordered potion giving a third. Resin per potion, with an unordered potion giving 10 of its best resin (lye over aga over mox). The +20%/+40% bonus for filling two or three orders at once. Order weights. Paste per herb. Hopper capacity. Digweed doubling a potion's XP and resin, lasting 20 seconds, and withering when the player leaves the lab.
- Captured hand-ins agree with these: 63 XP and 10 Mox for an unordered Mammoth-might mix (4197), and the Leagues totals divide back to the Wiki's resin × 1.4.

## Approximations

These aren't in the captures, so they are reasoned from what is:
- **Digweed spawn rule.** The count reached somewhere between 9 and 12 at levels 72-80 and 4 to 7 at 100+ before a herb matured, a few ticks after a hand-in. The threshold here is drawn from that range by level, and the herb matures 1-15 ticks after the hand-in that reaches it.
- **Alembic recovery after a mistimed click.** The Wiki's seventh-pump retry is modelled as a cue after seven following active processing updates, retaining the existing delayed-cue response window. Counting resets on leaving/restarting, while the saved potion hit prevents a second bonus. Recovery timing is not independently captured: the active-update/pump phase is an explicit implementation approximation, not a new raw retail tick/cycle claim. Only one recovery is scheduled per continuous work session; further opportunities and passive expiry without a mistimed click are not established.
- **Uncaptured messages:**
  - an empty refiner: "You have nothing that can be refined."
  - a vessel potion above the player's level: "You need a Herblore level of N to mix that potion."
  - nothing to deposit on the belt: "You don't have any finished potions to deposit."
  - no space for a vessel potion: "You don't have enough inventory space."
  - the agitator and alembic's "not carrying" line, by analogy with the retort's: "...that can be homogenised."
  - digweed withering removes it silently.
- **Not modelled:** unfinished potions refined into paste keep no vial (the captures only show herbs).

## Rewards

The shop sells everything at the cache's prices. Buying potion storage sets 11295. The rewards' own behaviour is a follow-up: the potion packs' Open, the goggles' and amulet's Herblore effects, the reagent pouch, the chugging barrel, and the potion storage bank section.
