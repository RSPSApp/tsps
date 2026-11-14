# Storage items

`server/plugins/items/StorageItems.plugin.js`, with one unit per container in
`server/plugins/items/storage/`: the coal bag, gem bag, gem pouch and its upgrades, gem sack, fish barrel
(and fish sack barrel), log basket (and forestry basket), Forestry kit, plank sack, tackle box, and the
Hunters' Guild meat and fur pouches (`HunterPouches.StorageItems.js`).
The herb sack and seed box are in the Farming plugin.

## Replaces

The earlier `items/CoalBag.plugin.js`: its coal (`coal-bag:coal`) moves into the coal bag's store on
login, and Mining's `mining:ore` event it listened to is now `storage:gather`.

## Sources

- **OSRS Wiki** pages for each item: capacities, what each one takes, auto-fill, death and
  bank behaviour.
- **Jagex** [gem bag expansion](https://store.steampowered.com/news/posts/?enddate=1778665947&feed=steam_community_announcements):
  gem sack recipe, capacity and retention of the previous containers' contents.
- **rsprox captures** (https://rsprox.net/database): the tackle box (rev 227, recording 1858, a
  Leagues world) for its interface; the herb sack and seed box (rev 235/238) for the bank
  panel's op9, which empties a container into the bank with no message. Fill, Empty and Check
  on the bags, barrel, basket and sack were never captured.
- **Message wording** that client plugins parse from live chat, for the coal bag and the log
  basket. Every other line is marked "Ours (not captured)" in the code.

## How contents are kept

As with the rune pouch, a container's contents live on the player in the attribute
`storage-items:<family>` (`coal-bag`, `gem-bag`, `gem-pouch`, `gem-sack`, `fish-barrel`, `log-basket`, `forestry-kit`,
`plank-sack`, `tackle-box`, `meat-pouch`, `fur-pouch`), not on the item. Every copy a player owns shares one store (Wiki: Fish barrel,
Log basket, Tackle box). The open and closed variants are the same container (`Coal bag` /
`Open coal bag` and so on); Open and Close swap the item in place.

| Container | Holds | Fills itself | Used from it |
| --- | --- | --- | --- |
| Coal bag | 27 coal, 36 with the Smithing cape's perk (`skillcape:has-perk`) | open: mined coal | smelting, after the inventory's coal |
| Gem bag | 60 of each uncut sapphire to dragonstone | open: picked-up gems, mined gems, the gem stall, pickpocketed gems, Shooting Star gems | - |
| Gem pouch, gem satchel, gem tote | 5, 10 and 20 of each uncut opal, jade and red topaz | open: mined gems only | - |
| Gem sack | 60 of each of the eight uncut gems held by the bag and tote | open: precious gems from the gem bag's sources; semi-precious gems from mining | - |
| Fish barrel, fish sack barrel | 28 raw fish (no stackable fish) | open: caught fish | - |
| Log basket, forestry basket | 28 logs or bark, carried or worn | open: chopped logs | - |
| Forestry kit (and the kit in a forestry basket) | enum 817: bark, nature offerings, rations, secateurs attachment, leaves | carried or worn: Forestry bark and leaves | the Forestry Shop's bark |
| Plank sack | 28 planks | always: sawmill planks | Construction, after the inventory's planks |
| Tackle box | 35 kinds of tackle (`data/storage-items.json`) | - | fishing bait only; gear has to come out first |
| Small and large meat pouch | 14 / 28 raw hunter meats (`hunterMeat`; no raw bird meat), by the largest carried | open: Hunter catches | - |
| Small, medium and large fur pouch | 14 / 21 / 28 hunter furs (`hunterFur`; no tatty or combat fur), by the largest carried | open: Hunter catches | - |

Upgrading a tote and real gem bag to a gem sack transfers both family stores to the sack. If no sack
is owned but its store remains, the upgrade also preserves those gems, combining matching kinds up to
60 each. The server refuses the upgrade without consuming items if the combined contents exceed that
capacity, another lower-tier copy is owned, or a saved store is inconsistent; this is a conservative
policy for existing server saves, not an observed game rule.
The sack's action, sewing and pickup messages follow this server's pouch and bag wording; no sack
transcript is retained. Gem bag, gem sack and herb sack ground pickup use this server's ordinary
pickup sound; live container audio is not established. Semi-precious auto-storage is limited to
mining here; the source does not establish every live-game gather source.

## Meat and fur pouches

Sources: **rsprox captures** of the small and large meat pouch (recordings pyre-fur-and-smallpouch-1
to -4, rev 242: sewing, every option, the bank panel, Destroy and pyre fox deadfall catches), and the
OSRS Wiki (Small/Large meat pouch, Fur pouch, Small/Medium/Large fur pouch, Hunter meat, Bank-use item)
for levels, XP, sizes, what each holds and the fur pouches, which weren't captured.

- **Sewing** (`Leather.Crafting.js`, `skills/data/crafting.json` `huntersPouches`): a needle (with
  thread, or a costume needle) on the fur, or the fur on the needle, makes one pouch with **no menu**:
  `human_leather_crafting` at once, then 2 ticks later "You make a small meat pouch." (spam), the XP and
  the pouch, with the reel counted as the other needle crafts ("You use up one of your reels of
  thread." on the fifth). 4 fox fur make a small meat pouch (35 Crafting, 30 XP), 4 larupia fur a small
  fur pouch (35, 20 XP). Upgrades use 3 fur and the **closed** pouch below; the pouch takes the first free slot: sunlight antelope fur for a large meat pouch (65, 60 XP), graahk fur for a medium fur pouch
  (50, 40 XP), kyatt fur for a large fur pouch (65, 60 XP).
  - Without thread: messagebox "You'll need a needle and some thread to craft a small meat pouch."
  - Without the closed pouch below (an open one doesn't count): objectbox with that pouch, "You need a
    small meat pouch to upgrade into a large pouch."
  - Ours: the level box and the too-little-fur line; the fur pouches' versions of the lines above.
- **One store per kind:** every meat pouch shares one store, as does every fur pouch. The largest pouch
  carried sets the room. An upgrade keeps the contents (captured: 11 meat before and after); destroying
  the only pouch loses them (captured: a new pouch then held only what went in).
- **Fill**, or a meat used on the pouch (open or closed): every meat carried goes in, silently. With
  none, "You don't have any meats that can go into this pouch."; with the pouch full, "Your pouch is
  full.".
- **Check:** "Your meat pouch is currently holding # meat." (0 included).
- **Open / Close:** "You open your small meat pouch." / "You close your large meat pouch.", the item
  swapped in place.
- **Catches** (trap collection, falconry and noose-wand tracking, through `catchExchange` in
  `Context.Hunter.js`): the catch needs inventory room for all of its loot, meat and fur included,
  even with an open pouch that has room (captured: "You don't have enough inventory space. You need 3
  more free slots." on a deadfall; rsprox.net rev 237 recordings 01102, 01108 and 01115 show it on
  bird snares and net traps, "1 more free slot." for one). Once it fits, an open pouch takes the meat or fur
  (`storage:gather`, skill Hunter), silently, also when that fills it.
- **Empty:** an empty pouch says "Your meat pouch is empty." anywhere. Away from a bank, "You can't
  empty your meat pouch here."; next to one with the bank closed (`league:near-bank`, as the chugging
  barrel asks it) or on the Hunters' Guild's top floor (Wiki; plane 2 inside the guild's walls, x
  1552-1564, y 3033-3053 in the cache map) the meat goes into the inventory silently; with no room the
  inventory-full line is ours. The bank panel's op9 (param 595 "Empty") puts it in the bank, "You
  deposit some meat into your bank." (spam), sound 2285. The fur pouch empties only into the bank (Wiki).
- **Destroy:** "If you destroy this item, you will lose all contents stored within."

## Events

Other plugins reach the containers only through custom events (owned by `Common.StorageItems.js`):

| Event | Payload | Emitted by |
| --- | --- | --- |
| `storage:room` | `{ player, itemId, room }` | Mining, Fishing, Woodcutting: a full inventory doesn't stop them while an open container has room |
| `storage:gather` | `{ player, itemId, amount, stored, announce? }` | Mining, Fishing, Woodcutting, the sawmill, stall thieving, pickpocketed gems, Shooting Stars: open containers take what fits, the rest goes to the inventory |
| `storage:amount` | `{ player, itemId, amount }` | Smithing (smelting), Construction, Fishing (bait) |
| `storage:take` | `{ player, itemId, amount, taken }` | the same, after the inventory's own items |
| `storage:empty-to-bank` | `{ player, key, moved, left }` | Forestry's Woodcutting Leprechaun ("Yes, bank it all"): a carried or worn container of family `key` (the log basket) empties into the bank |

`DestroyItem` emits `destroy-item:destroyed` `{ player, itemId, amount }` after a confirmed
Destroy. When the last container of a family is destroyed, its contents go with it.

## Bank panel

The bank's inventory panel puts each container's bank op on op9 (cache script 297, text from
script 2576: the item's param 595, "Empty" or "Use"). The plank sack's op fills from the
inventory while it holds planks and otherwise empties into the bank (Wiki). Since 27 August 2025
its label follows: script 2576 shows "Fill" for every slot whose bit is set in varp 264 (`if4`),
which the plugin sets on each `bank:refreshed` (emitted by `Bank.refreshItems`).

The client used to send any item op named "Empty", "Fill", "Check" and so on as a plain
inventory option, even from the bank panel; it now leaves the bank panel's ops to the bank.

## Messages

| Container | Line | Source |
| --- | --- | --- |
| Coal bag | "The coal bag contains # pieces of coal." / "The coal bag is empty." / "The coal bag is now empty." / "The coal bag can hold only # pieces of coal." | parsed from live chat |
| Gem bag | "You just found a/an [gem]!" / "You put it straight into your open gem bag." / "You open your gem bag, ready to fill it." / "You close your gem bag." / "Sapphires: # / Emeralds: # / Rubies: #" / "Diamonds: # / Dragonstones: #" / "Only uncut gems can be stored in the bag." / "Your bag is too full to hold all your gems." / "You have nothing suitable for storing in the bag." | Wiki; Fill itself has no line |
| Fish barrel | "The barrel is full. It may be emptied at a bank." | Wiki |
| Log basket | "The basket is full." / "Your basket is empty." / "The basket is empty." / "You empty your basket." / "You empty as many logs as you can carry." / "You empty your basket into the bank." | parsed from live chat |
| Log basket | "You empty some of your basket's contents into the bank." / "Your bank cannot hold the remaining contents of your basket." | Ours (not captured) |
| Tackle box | "The tackle box is now empty." | captured |
| Tackle box | "The tackle box cannot hold itself! How weird would that be?" | Wiki |
| Meat pouch | the lines in "Meat and fur pouches" above | captured (rev 242) |
| Fur pouches | the meat pouch's lines with "fur" | Ours (not captured) |

The barrel's and basket's Check opens a box that starts "The barrel contains:" or "The basket
contains:" and lists "# x Item" per kind.

## Tackle box interface

Captured, rev 227: View sends inventory 651, runs script 917 (-1, -1), opens 683 (main modal)
and 684 (side modal), and sets OP1-5, OP10, DEPTH1 and DRAGTARGET on 683:11 and 684:0. The
rev 241 cache sizes inventory 651 at 35, so the grid flags go to slot 34.

The quantity buttons 683:4-7 set varbit 11795 (`ii_elnock_storage_selectedquantity`, which the
box's scripts share): 0 = 1, 1 = 5, 2 = All, 3 = X. Cache scripts 4052 (Withdraw) and 4053
(Deposit) put the selected quantity on op1 and fix ops 2-5 as 1, 5, X and All. Fill (683:8)
moves everything the box takes, silently; Empty (683:9) says "The tackle box is now empty."

## Forester's rations and ordinary axes

On a successful chop with a carried or worn one-handed ordinary axe, a ration in
the inventory or a carried/worn Forestry kit has a 30% chance to restore 20 run
energy points when energy is below 90%. The proc consumes one ration. This
combines [Jagex's original rule](https://secure.runescape.com/m=news/forestry-the-way-of-the-forester---part-one?oldschool=1)
with the current [Forestry kit threshold](https://oldschool.runescape.wiki/w/Forestry_kit);
it is not a captured numeric observation. The separate felling-axe energy and
ration-consumption interaction remains unimplemented and unverified.

## Forestry kit interface

Captured (rsprox 1704, rev 227; 1104, rev 237): View sends inventory 814, runs script 917
(-1, -3), opens 823 (main modal) and 822 (side modal), and sets events 1150 (ops 1-6, op 10) on
823:21 slots 0-252 and 1180734 on 822:0 slots 0-27. Fill with nothing storable says "You have
nothing that can be stored in the forestry kit."; bark awarded during an event went straight
into the worn kit.

The withdraw buttons 823:11-14 set varbit 14985 (`forestry_kit_selectedquantity`), with the tackle
box's values (0 = 1, 1 = 5, 2 = All, 3 = X); script 1768 puts the selected quantity on the side
panel's op1 and fixes ops 2-5 as 1, 5, X and All. The main grid is taken to work the same way
(not captured). Fill (823:15) and Empty (823:16) move everything.

The forestry basket's "Forestry kit" sub-options on Fill and View reach the same store, and
Configure > Dismantle splits the basket into its log basket, the Forestry kit and the sturdy
harness, each keeping its contents. The kit's bank op ("Use") empties it into the inventory
(Wiki). The Forestry Shop spends bark from the inventory and then from a carried or worn kit; this
is ours, as neither the Wiki nor a capture shows it.

The Lumberjack and Forestry outfits and the Woodcutting cape are also in enum 817, but only
with the clothes or cape pouch installed (Wiki); tsps has no pouches, so they stay out.

## Death

`deathDrops` in `Events.StorageItems.js` decides, once per death, what happens to the contents of
the fish barrel and tackle box, and of the containers other plugins add through
`storage:death-containers`: the rune pouch, the essence pouches, the herb sack and the seed box
(`tests/container-death.test.cjs`).

- **PvM deaths:** the contents stay in the container, kept or lost; a lost one goes to the grave
  with them. With its "Always empty ... on death" setting on (All Settings 354-359), the contents
  go to the grave as items, and the container, kept or lost, is left empty. A fish barrel or
  tackle box that falls to the floor (no grave) takes its contents along.
- **PvP deaths** always empty them, kept or lost, and the contents drop for the killer with the
  rest of the loot ("The pouch is always emptied ... if the death is in PvP", the setting's own
  text). A seed box's seeds go to the bank first, where it has room (Wiki: Seed box, 7 March 2019).
  A fish barrel the death keeps keeps its fish.
- **Safe deaths** change nothing.
- Every other container (coal bag, gem bag, log basket, plank sack, ...) keeps its contents on the
  player.

## Superheat Item

`server/plugins/skills/smithing/Superheat.Smithing.js`, a unit of the Smithing plugin (the spell is
free-to-play). It reuses the furnace recipes: the same Smithing level, coal and XP, with the coal
bag's coal used after the inventory's. Iron ore with two coal (and 30 Smithing) makes steel,
otherwise iron, never failing (Wiki). 43 Magic, 4 fire and 1 nature rune, 53 Magic XP, one
cast every 3 ticks.

Captured (rev 227, recordings 100, 1749, 1834, 1835): sequence 725 (`human_castsuperheatitem`)
with spotanim 148 (`superheatitem_casting`) at height 92, the ores swapped for the bar, script
915 (6) to switch back to the spellbook tab, sound 190, then Magic and Smithing XP, all on the
cast tick. Cast on coal (rev 237, recording 1149): "You need to cast superheat item on ore.",
spotanim 85 (`failedspell_impact`) at height 92, script 915 (6) and sound 191; no runes or XP.
Elemental ore: "Even this spell is not hot enough to heat this item." (Wiki).

## Tackle box extras

- Lit lanterns go in by gameval (`oil_lantern_lit`, `bullseye_lantern_lit`,
  `candle_lantern_lit`), because lit and unlit lanterns share their names.
- Dragging within the grid swaps the two slots, as cache script 4056 redraws them. The box keeps
  its items packed, so a drop on an empty slot moves the item to the end.

## Reagent pouch

`items/storage/ReagentPouch.StorageItems.js`, the Mastering Mixology reward. Sources: the Wiki
(Reagent pouch: 26 of each kind, its "Storable items" list, Empty only near a bank, the bank
panel's Fill / Empty to bank) and rsprox.net recordings 4218, 4220, 4226, 4227 (Leagues VI,
rev 238; the pouch has no league rule of its own).

- **One store** for the closed and open pouch, 26 of each storable secondary (stackable and noted
  copies refused). Destroy clears it.
- **Fill:** "You search your inventory for items appropriate to put in the pouch..." and "You
  add the items to your pouch." (spam); "You don't have enough space for the items." when none
  fit; "You have no items in your inventory that can be stored in the pouch." with none held.
- **A secondary used on it:** one held goes straight in; more opens "Add one or all of this
  type?" (One. / All of this type.); either says "You add the <name> to your sack." A full kind:
  "You don't have enough space for the <name>." Anything else: "You can't possibly put that in
  there. It would spoil your pouch."
- **Empty:** near a bank (the shared `league:near-bank` check: booths, bankers and bank chests within 8 tiles), "You rummage around to see if
  you can extract any items from your Reagent pouch." and the contents into the inventory as far
  as they fit; "You have no space to put any items!"; "This isn't a suitable place to empty your
  pouch." elsewhere; "The Reagent pouch is empty."
- **Check:** "You look in your Reagent pouch and see:" and "N x <name>" per kind, in the order
  they went in.
- **Open / Close:** "You open your Reagent pouch, ready to fill it." / "You close your Reagent
  pouch." Open, a picked-up secondary goes in: "You put the <name> into your Reagent pouch."
  (spam) with the pickup sound.
- **Bank panel:** Fill (as above) while the inventory holds a secondary, otherwise "You empty
  your Reagent pouch into the bank."
- **Not done:** Herblore taking secondaries from the pouch near a bank (Wiki), the deposit box's
  Fill from inventory.

## Not done

- The Forestry kit's clothes and cape pouches, and Forester's ration run-energy effects while using a felling axe.
- The deposit box's container options; the Ultimate Ironman bank-booth emptying of the fish
  barrel.
- The meat pouch's refusal at Emerald Benedict, Eniola and Odovacar and inside Mor Ul Rek (Wiki).

## Huntsman's kit

The kit's View, Fill and Empty actions use native interfaces 871 and 872 and inventory
855. It holds 32 different item IDs in stable slots; withdrawing the last item from a
slot leaves a gap. Empty starts at the last slot and moves what fits into inventory.
The native 1/5/X/All controls apply to both item grids, and dragging swaps slots.
Using a storable item on the kit, or the kit on it, moves every plain copy in with no
message (Leagues VI captures 4046, 1128, 4051 and 4054, rev 237: nets, ropes, a teasing
stick and a stack of box traps); other items fall through to the usual use response.
Equipment must be withdrawn before Hunter can use it. The kit's player-owned contents
persist through banking, save/load, death and reclamation, including Wilderness PvP;
confirmed destruction clears them. A kit awaiting grave, Death's Office or item-retrieval
reclamation counts as owned when opening loot sacks. Pending sack rewards recheck kit
ownership at delivery while retaining every other reward roll.

The eligibility list in `server/plugins/items/data/huntsmans-kit.json` uses canonical
cache gamevals, excluding notes, placeholders and unrelated same-name quest items.
The current Wiki's insect net names refer to cache 242's butterfly net IDs. Both
imp-in-a-box charge variants, normal and worn camouflage pieces, Guild hunter clothing,
charged/empty Horns of Plenty, gryphon feathers and net traps are included. Metadata and
preset items stay physical so storing them cannot discard their properties. Amounts
are bounded by the server's signed-int inventory representation; this is a conservation
safeguard, not a claim that retail imposes that per-ID limit. The Wiki does not specify
one. The separate Verity kit exchange is outside this action/storage implementation.

Behavior source: [Wiki revision 15400877](https://oldschool.runescape.wiki/w/Huntsman%27s_kit?oldid=15400877).
Cache reference: [242 dump 853150e3f75e1463391b470f98caf5d3bf796339](https://github.com/Joshua-F/osrs-dumps/tree/853150e3f75e1463391b470f98caf5d3bf796339).
That cache defines 33 display slots; the supported storage slots remain 0–31.
The following citations identify a **frozen shared decoded snapshot** of RSProx
recordings 1206 and 1207, both revision 238.1. They refer to different decoded files
from the maintainer's local `rsprox_transcripts/238/01206.txt` and `01207.txt` exports;
the line offsets below must not be applied to those local files. We re-streamed every
retained decoded byte and re-read these complete bounded intervals:

| Recording | Decoded bytes | Physical LF lines | Inspected interval | Decoded SHA-256 |
| --- | ---: | ---: | --- | --- |
| 1206 | 386,444 | 3,803 | 1990–2190 | `7c47d3989aac8bc9ce3c73461666f6aed6f127b95d10e8ba60d040d15f98a0e7` |
| 1207 | 1,148,713 | 15,086 | 11530–11635 | `6575be6ca7fc3d7c35e292658f929ce0fe3adb855e0df01544f8d271ffe3e144` |

Stable event anchors in this snapshot are the bracketed transcript markers and item
transitions, not a claim about elapsed retail timing. In 1206, marker `[52]` has
inventory 855 at line 2046, script 917 at 2047, interfaces 871/872 at 2048–2049 and
slot flags 0–31/0–27 at 2050–2051. Its stored list includes an interior empty slot.
The first withdrawals at `[56]` and `[58]` move one net 303 (5→4) and rope 954 (3→2),
respectively. Later `[59]` repeats both operations: lines 2137/2140 and 2150–2151
show physical +1 each and stored net 4→3 / rope 2→1. In 1207, `[939]` has the same
inventory/script/open/flags at 11557–11562; `[942]` deposits one rope (1→2) at
11586/11596–11597 and `[943]` one net (3→4) at 11603/11612–11613.

[Maintainer review 5883193461](https://github.com/RSPSApp/tsps/pull/4860#pullrequestreview-5883193461)
reports alternate local decoded exports: 01206 hash prefix `e006c23e…`, opening at
3593–3596 and withdrawals at 3633–3700; 01207 prefix `83686661…`, opening at
10527–10529. These are **maintainer-reported alternate-export pointers**. We have not
acquired or independently hashed those alternate bytes; their full hashes, line counts
and decoder provenance are not asserted here. The maintainer's reported net 4→3 / rope
2→1 observation corresponds to the later `[59]` transitions in our inspected snapshot,
not its first withdrawals.

These historical observations support View, unit transfers and the observed interior
hole. They do not prove arbitrary quantity limits, death behavior, Fill/Empty messages,
drag behavior or a rendered current client. The supplied decoder build and capture
dates for our frozen snapshot remain unknown. Native cache and gameplay validation use
`node --test --test-concurrency=1 tests/huntsmans-kit-native.test.cjs` after the server build.
The fixture supplies items and positions, drives decoded `ClientConnection` inputs and
real `World` turns, and uses actual save/death/grave services. Skulled PvM cases explicitly
assert that the kit reached a grave before reclaiming it. Unique-ownership checks use
actual grave expiration into Death's Office and supplied Mimic retrieval state through
its real query consumer; they do not claim a natural boss fight. Uncaptured refusal
wording and the signed-int safety ceiling are TSPS choices. The fixture does not claim
natural loot-sack acquisition or a rendered client playthrough.

For an inventory check, carry a kit, several ropes, a small fishing net and an unlit torch. View opens
the native kit; Fill stores the eligible inventory. Withdraw 1/5/X/All from the grid,
leave an interior gap, then Empty with one free inventory slot to check reverse-slot
order. Stored tools are unavailable until withdrawn. The maintained native fixture
passed 13 cases; the separate existing storage and Hunter-rumour suites passed 21
and 14 cases. Those latter suites include component/unit controls, rather than 35
additional native playthroughs.

The accepted Linux x64 run used Node **v22.17.0** in
`node@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0`.
Preparation downloaded Yarn **4.12.0** from its versioned distribution and verified
its SHA-512 against `server/package.json`'s `packageManager` pin, then ran
`node <verified-yarn-cli> install --immutable --mode=skip-build`.
It downloaded the [node-datachannel 0.32.1 NAPI-v8 Linux-x64 archive](https://github.com/murat-dogan/node-datachannel/releases/download/v0.32.1/node-datachannel-v0.32.1-napi-v8-linux-x64.tar.gz):
archive SHA-256 `1a31d28a7aec9c1538cb96b76260d062399715b4dcea0ff3a0ebd6f58df5e391`,
exact member `build/Release/node_datachannel.node`, binary SHA-256
`98ad24d9b992a7974628b339ce81dfe159ca8d255459da5531dfcd7be659af06`.
Native `ldd` and load checks exited 0 with `NATIVE_LOAD_OK`.
The [existing public preparation reference](https://github.com/RSPSApp/tsps/blob/fecb70473f9540ff2faae324ea26901e706a15e2/docs/steel-key-ring.md#reproducing-the-verification)
links the equivalent shell download/hash/extraction recipe. It requires `curl`,
`tar`, `sha256sum`, `ldd` and network access to Yarn, GitHub releases and OpenRS2.
Those shell steps reproduce the preparation; the actual executor performed its
bounded download/hash/member checks in Node. Ordinary Yarn lifecycle installation
was not the executed preparation.

After that preparation, the literal build/cache/test arguments from `server/` were:

```sh
node --max-old-space-size=3072 node_modules/typescript/bin/tsc --build tsconfig.json --pretty false
node --max-old-space-size=4096 node_modules/ts-node/dist/bin.js --compiler-options '{"target":"es2020"}' scripts/ensure-cache.ts
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/huntsmans-kit-native.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/storage-items.test.cjs
node --max-old-space-size=3072 --test --test-concurrency=1 --test-reporter=tap tests/hunter-rumours.test.cjs
```

The target was `osrs-242_2026-11-03`, OpenRS2 2757, with all 28 cache files checked.
This run did not generate documentation. The later reproduction-documentation edits
change no tested gameplay, data or fixture bytes.
