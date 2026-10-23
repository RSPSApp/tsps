# Crafting

`server/plugins/skills/Crafting.plugin.js` registers the units in `server/plugins/skills/crafting/`:

| Unit | What it covers |
| --- | --- |
| `Shared.Crafting.js` | The skillmulti menu and the make-many loop every unit uses |
| `Leather.Crafting.js` | Needle on leather, hard leather, dragon leather, snakeskin, Xerician fabric and Hueycoatl hide; studs, kebbit claws, hide shields |
| `Gems.Crafting.js` | Cutting gems (with crushing) and amethyst |
| `Jewellery.Crafting.js` | Gold (446) and silver (6) jewellery at a furnace, 'perfect' jewellery, stringing amulets |
| `Glassblowing.Crafting.js` | Glassblowing pipe on molten glass |
| `Pottery.Crafting.js` | Soft clay, potter's wheel, pottery oven |
| `Spinning.Crafting.js` | Spinning wheels and looms |
| `Battlestaves.Crafting.js` | Charged orbs on battlestaves |

The recipes are in `server/plugins/skills/data/crafting.json`, items by their generated
`ItemIdentifiers` names (an unknown name throws at load).

The spells that make Crafting materials are the `CraftingSpells` plugin
(`server/plugins/skills/CraftingSpells.plugin.js`, units in `craftingspells/`, data in
`data/crafting-spells.json`). It covers Spin Flax, Tan Leather and Superglass Make on the Lunar
spellbook, and Charge Water/Earth/Fire/Air Orb on the obelisks. The Lunar spells reach it through
the generic `api.onSpellCast` hook (a spellbook spell cast on nothing, by its cache name). Core
dispatches that hook before its own spellbooks. The other Lunar spells are still in core
`LunarSpells.ts`; moving them onto the same hook is a separate change.

Levels, XP and materials come from the [OSRS Wiki](https://oldschool.runescape.wiki/w/Crafting).
Ids come from the rev 241 cache. Animations and graphics are named by their cache gamevals in
the data files. Spin Flax, Superglass Make and Tan Leather each use their own spotanim
(quest_lunar_magic_flax_strim, quest_lunar_magic_superglass, lunar_tan_leather), cast with
core's Lunar animation lunar_human_magic_summon2.

## The make-many loop

Every captured method follows the same pattern, counted from the tick the player picks an item in
the skillmulti menu. The start animation and sound play on one tick. The first item comes on a later
tick, then one more every few ticks, and each item replays the animation. Walking, opening an
interface or running out of materials stops it.

| Method | Menu (mode, title) | Start | First item | Every | Animation, sound | Message |
| --- | --- | --- | --- | --- | --- | --- |
| Leather | 0, "How many do you wish to make?" | 0 | 2 | 3 | human_leather_crafting | "You make a leather body." |
| Gems | 12, "How many gems would you like to cut?" | - | 1 | 2 | human_*cutting, 2586 | "You cut the diamond." |
| Glassblowing | 0, "How many do you wish to make?" | 0 | 2 | 3 | human_glassblowing, 2724 (delay 10) | "You make a beer glass." |
| Spinning wheel | 16, "What would you like to spin?" | 1 | 3 | 2 | human_spinningwheel_60, 2590, wheel loc anim spinningwheel | none |
| Loom | 35, "How many would you like to weave?" | 1 | 4 | 3 | farming_useloom, 2587 (delay 2) | none |
| Gold/silver furnace | interface 446 / 6 | 0 | 2 | 3 | human_furnace, 2725 | none |

## Captured facts (rsprox captures)

Recording ids refer to the capture database at https://rsprox.net/database.

- **Gems** (recordings 1875, 2246, 4211): the menu offers only the gem used, up to the number carried.
  A semi-precious gem can fail: "You mis-hit the chisel and smash the jade to pieces!", the
  item crushed_gemstone (1633), and sound 2589 as well as 2586.
- **Glassblowing** (recording 1842): all eight items are always listed, labelled Beer glass, Candle lantern,
  Oil lamp, Vial, Fishbowl, Unpowered staff orb, Lantern lens, Light orb. Picking one above the
  player's level answers "You need level 87 Crafting to make a light orb." and makes nothing.
- **Spinning wheel** (recording 3467, rev 235): the menu lists what the carried materials make. With flax
  that is Linen yarn and Bow string. Older recordings (69, 89, 1718; Leagues) used a different label
  set.
- **Loom** (recording 3467, `fossil_loom`): with linen yarn the menu offers only Bolt of linen; each bolt uses
  2 yarn. Building the Fossil Island loom (recording 73: oak plank, "You build the loom.",
  varbit fossil_loom 0→1) is not implemented.
- **Gold jewellery** (recordings 1102, 1104, 1105): human_furnace and 2725 play on the click, and the item
  comes 2 ticks later. The client also sets varbit crafting_gold_item_lasttype, which the server
  does not yet send.
- **Silver jewellery** (recording 102): a silver bar on a furnace opens silver_crafting in the main modal.
  Choosing the tiara made one 2 ticks later. Products, levels and moulds are cache script
  1596's, and the quantity is varp 2224 (scripts 3599, 2928), the same as gold.

## Wiki-only (no capture)

- Amethyst cutting (15 bolt tips, 15 arrowtips, 5 javelin tips, 8 dart tips; 60 XP, 2 ticks).
- Battlestaves: first staff 3 ticks after the choice, then every 2.
- Charge Water/Earth/Fire/Air Orb on the obelisks: repeats every 6 ticks (the Wiki's autocast speed).
- Crush chance: the Wiki's low/high values (opal 128/250, jade 100/245, red topaz 90/240) on the
  skilling curve. A Jeweller's chisel adds 20% and has a 10% chance to cut two.
- Studs, kebbit claws and hide shields, and the snakeskin, Xerician and Hueycoatl items.
- The Lunar spells:
  - Spin Flax: up to 5 flax per cast, 15 Crafting XP each.
  - Tan Leather: up to 5 hides per cast, now including cowhide and snake hide.
  - Superglass Make: soda ash, seaweed, swamp weed or giant seaweed (giant seaweed counts as 6), 10 Crafting XP per sand. Bonus glass averages 1.3 per sand (1.6 with giant seaweed), and glass that doesn't fit is dropped.
- Messages marked `ponytail:` in the code (low-level refusals, nothing to spin) are placeholders until
  captured.

## Other plugins touched

- **Sheep Shearer** had its own wool-only spinning wheel handler. It is removed, and the wheels are
  Crafting's.
- **Recipe for Disaster** had a stand-in that turned every pipe-on-glass use into a fishbowl (6668,
  the water-filled one). It is removed. Murphy now takes the empty fishbowl (6667) that glassblowing
  makes, as the Wiki's quest guide asks for.
- **Lunar spells:** Spin Flax, Superglass Make and Tan Leather moved out of core `LunarSpells.ts`
  into the plugin. Their rune costs now follow the Wiki: Spin Flax takes an astral, 2 nature and 5 air;
  Superglass Make 2 astral, 6 fire and 10 air; Tan Leather 2 astral, a nature and 5 fire. The old
  water/law costs meant none of them could be cast.

## Not done

- Golem crafting (Wyrmscraig) and fixing the Dorgesh-Kaan lamps: separate follow-ups.
- Splitbark, mixed hide armour, snelms, crab armour, and the Broodoo shields.
- Pottery firing never fails, and pot lids are left to One Small Favour.
