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

Wiki (Small meat pouch, Large meat pouch, Fur pouch, Small/Medium/Large fur pouch, Bank-use item,
Hunter meat); no capture of them exists (the user's captures and the rsprox.net index have none).

- **Sewing** (Crafting's needle table, `skills/data/crafting.json` `leather`): a needle (with thread, or a
  costume needle) on 4 fox fur makes a small meat pouch (35 Crafting, 30 XP), on 4 larupia fur a small
  fur pouch (35, 20 XP). Upgrades use 3 fur and the closed pouch below (the recipe's `with`): sunlight
  antelope fur for a large meat pouch (65, 60 XP), graahk fur for a medium fur pouch (50, 40 XP), kyatt
  fur for a large fur pouch (65, 60 XP). 3 ticks each, as the other needle crafts.
- **One store per kind:** every meat pouch shares one store, as does every fur pouch ("shares its inventory
  with every meat pouch the player owns"). The largest pouch carried sets the room, so an upgrade keeps the
  contents. The Wiki's small meat pouch page has an upgrade overwrite a large pouch's separate store, and
  both pages describe an Empty that deletes another pouch's contents; those bugs are left out.
- **Open pouches** take a catch's meat or fur first (Hunter's `storage:gather` with skill Hunter, from trap
  collection and falconry, through `catchExchange` in `Context.Hunter.js`), so a full inventory still
  takes it.
- **Empty:** both kinds empty into an open bank (and through the bank panel's op9, param 595 "Empty"). A
  meat pouch also empties into the inventory near a bank (LeagueMode's `league:near-bank`, as the chugging
  barrel asks it) or on the Hunters' Guild's top floor (plane 2 inside the guild's walls, x 1552-1564,
  y 3033-3053 in the cache map); elsewhere "You can't empty your meat pouch here." (Wiki, Bank-use item).
- Every other line (full, empty, Check's count, the fur pouch's bank-only refusal, a missing pouch for an
  upgrade) is ours.

## Events

Other plugins reach the containers only through custom events (owned by `Common.StorageItems.js`):

| Event | Payload | Emitted by |
| --- | --- | --- |
| `storage:room` | `{ player, itemId, room }` | Mining, Fishing, Woodcutting: a full inventory doesn't stop them while an open container has room |
| `storage:gather` | `{ player, itemId, amount, stored, announce? }` | Mining, Fishing, Woodcutting, the sawmill, stall thieving, pickpocketed gems, Shooting Stars: open containers take what fits, the rest goes to the inventory |
| `storage:amount` | `{ player, itemId, amount }` | Smithing (smelting), Construction, Fishing (bait) |
| `storage:take` | `{ player, itemId, amount, taken }` | the same, after the inventory's own items |

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
| Meat pouch | "You can't empty your meat pouch here." | Wiki |
| Meat and fur pouches | "Your pouch is full." / "Your pouch is empty." / "Your pouch contains # pieces of meat/fur." / "You empty your pouch." / "You empty as much meat as you can carry." / "You have no meat/fur to put in the pouch." / "You can only empty your fur pouch into a bank." | Ours (not captured) |

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

## Not done

- The Forestry kit's clothes and cape pouches, and Forester's ration run-energy effects while using a felling axe.
- The deposit box's container options; the Ultimate Ironman bank-booth emptying of the fish
  barrel.
- The meat pouch's refusal at Emerald Benedict, Eniola and Odovacar and inside Mor Ul Rek (Wiki).
