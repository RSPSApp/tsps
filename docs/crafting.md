# Crafting

`server/plugins/skills/Crafting.plugin.js` registers the units in `server/plugins/skills/crafting/`:

| Unit | What it covers |
| --- | --- |
| `Shared.Crafting.js` | The skillmulti menu and common make-many loop |
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
| Gems | 12, "How many gems would you like to cut?" | - | 1 | 2 | human_*cutting, 2586 | "You cut the diamond." (spam) |
| Glassblowing | 0, "How many do you wish to make?" | 0 | 2 | 3 | human_glassblowing, 2724 (delay 10) | "You make a beer glass." |
| Spinning wheel | 16, "What would you like to spin?" ("How many would you like to spin?" with one product) | 0 | 2 | 2 | human_spinningwheel_60, 2590, wheel loc anim spinningwheel | none |
| Loom | 35, "How many would you like to weave?" | 0 | 3 | 3 | farming_useloom, 2587 (delay 2) | none |
| Potter's wheel | 0, "How many do you wish to make?" | 0 | 2 | 3 | human_potterywheel, 2588 | bowl/set-of-cups shaping message (spam) |
| Pottery oven | 9, "What would you like to fire in the oven?" | 0 | 6 | 7 | potteryoven_quick, 2725 | bowl/cup put and remove messages (spam) |
| Gold/silver furnace | interface 446 / 6 | 0 | 2 | 3 | human_furnace, 2725 | none |

## Captured facts (rsprox captures)

Recording ids refer to the capture database at https://rsprox.net/database.

- **Gems** (recordings 1875, 2246, 4211): the menu offers only the gem used, up to the number carried.
  A semi-precious gem can fail: "You mis-hit the chisel and smash the jade to pieces!" (spam), the
  item crushed_gemstone (1633), and sound 2589 as well as 2586. Below the level (recordings 1102,
  1723), the tick after the click brings an item box with the uncut gem, "You need a Crafting
  level of 20 to cut sapphires." ("to cut jade."); the plural is `plural` in `crafting.json`.
- **Glassblowing** (recording 1842): all eight items are always listed, labelled Beer glass, Candle lantern,
  Oil lamp, Vial, Fishbowl, Unpowered staff orb, Lantern lens, Light orb. Picking one above the
  player's level answers "You need level 87 Crafting to make a light orb." and makes nothing.
- **Spinning wheel** (recording 3467, rev 235): the menu lists what the carried materials make. With flax
  that is Linen yarn, then Bow string. With one product (wool only, recording 1105, Leagues) the
  title is "How many would you like to spin?". The animation, sound and wheel animation start on
  the choice tick in 4 of 7 windows (the other 3 a tick later, as the click landed late) and the
  first item comes 2 ticks after them. Older recordings (69, 89, 1718; Leagues) used a different
  label set. Linen yarn is 16 Crafting XP and a bolt of linen 20 (Wiki); the recording's stat
  packets don't give per-item XP.
- **Loom** (recording 3467, `fossil_loom`): with linen yarn the menu offers only Bolt of linen; each bolt uses
  2 yarn. Weaving starts on the choice tick (6 of 7 windows) and the first bolt is 3 ticks later.
  A `spinningwheel` loc animation two tiles away in 2 windows is a nearby wheel, not the loom. Building the Fossil Island loom (recording 73: oak plank, "You build the loom.",
  varbit fossil_loom 0→1) is not implemented.
- **Gold jewellery** (recordings 1102, 1104, 1105): human_furnace and 2725 play on the click, and the item
  comes 2 ticks later. The click also sets varbit crafting_gold_item_lasttype (recording 1851) to
  the button's value in enum 4318, which the menu's script (`crafting_gold_checkgem`) reads to
  highlight the last item.
- **Silver jewellery** (recording 102): a silver bar on a furnace opens silver_crafting in the main modal.
  Choosing the tiara made one 2 ticks later. Products, levels and moulds are cache script
  1596's, and the quantity is varp 2224 (scripts 3599, 2928), the same as gold. The click sets
  crafting_silver_item_lasttype to the button's value in enum 4319 (tiara 18).
- **Stringing amulets** (recordings 91, 1105, 1135, 1843, 1854, 1858): a ball of wool on an
  unstrung amulet strings it the tick after the click, with "You put some string on your amulet."
  (spam) and no animation. With several carried, rev 238 opens a "How many would you like to
  string?" menu (recording 4211); no capture shows that loop, so one is strung per use.

## Wiki-only (no capture)

- **Pre-nature amulet**: magic string used on an unstrung emerald amulet makes a pre-nature
  amulet for 4 Crafting XP. Wool on the same amulet makes an ordinary emerald amulet. The selected
  material determines the result; the existing one-item stringing path is reused, with no separate
  timing capture for magic string.

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
- Pottery: the cup crack rate, exact crack messages, messages for other pottery types and
  full-inventory cup behaviour still need capture evidence. Cups retain their previous guaranteed
  firing success until their rate is established. Tassie's initial teaching dialogue still supplies
  its first unfired lid; reviewing that lesson is a separate quest dialogue interaction.

## Pottery production parity

The wheel and oven previously made one item immediately (or offered a one-item dialogue),
so players could bypass the production delay and could not select a batch. Both now open the
native quantity menu before spending materials. Shaping checks the Crafting level; firing has no
level requirement. A batch stops on movement, interface opening, logout, death or exhausted
materials. Cancellation before a result leaves that input unspent.

Evidence checked for this interaction:

- **Recording 3121**, normal world, rev 232: soft clay on the wheel opens mode 0 with the title
  "How many do you wish to make?", quantity limited to the three clay carried, and ordered
  choices Pot, Pie dish, Bowl, Plant pot, Set of cups, Pot lid. **Recording 331** confirms the
  no-materials message box, "You don't have anything suitable to craft with."
- **Recordings 1757 and 1858**, Leagues, rev 227: shaping starts with `human_potterywheel`
  and sound 2588, consumes clay and produces a bowl two ticks after starting, then repeats
  at three-tick intervals, restarting the next shaping animation on the preceding result tick. A set of cups produces four separate unfired cups from one clay.
  Bowl/set-of-cups shaping messages are reproduced, on the spam channel as recorded. The oven offers mode 9, the title
  "What would you like to fire in the oven?", and the full ordered recipe list. Cup firing
  starts at ticks 0 and 7, with results six ticks after each start; bowl firing has the same
  six-tick result delay. `potteryoven_quick`, sound 2725 and the recorded bowl/cup put/remove
  messages accompany firing. **Recording 1098**, Leagues, rev 237, confirms the bowl delay,
  messages and oven animation. Leagues XP values are not used as normal-world XP evidence.
  Choosing pottery the player doesn't carry answers with a message box, "You don't have any
  bowls which need firing." (recordings 1757, 1098; pots in 1098). In recording 1098 neither the
  wheel nor the oven offers a pot lid before One Small Favour teaches it.
- **Soft clay** (recordings 1692, 73, 86, 1098): water on clay sends "You mix the clay and
  water.<br>You now have some soft workable clay." on the spam channel.
- The [unfired bowl creation table](https://oldschool.runescape.wiki/w/Unfired_bowl) gives
  three ticks for shaping. The [pot](https://oldschool.runescape.wiki/w/Pot) and
  [empty cup](https://oldschool.runescape.wiki/w/Empty_cup) creation tables give seven ticks
  for firing. These normal-game rates agree with the recorded production intervals.
- The [Crafting pottery table](https://oldschool.runescape.wiki/w/Crafting#Pottery) supplies
  levels, XP, four cups per clay, membership and the One Small Favour requirement for pot lids.
  The existing quest advances to stage 34 when Tassie's lesson finishes. The wheel queries
  that quest stage through the quest runtime and then offers the level-25 pot-lid recipe.
  Pot lids now use ordinary oven production and award the table's 20 firing XP; the quest's
  separate instant-firing shortcut has been removed.
- The [pot's success section](https://oldschool.runescape.wiki/w/Pot#Success_chance) confirms
  cracking at low levels and guaranteed success from level 13. The
  [oven discussion](https://oldschool.runescape.wiki/w/Talk:Pottery_Oven#Success_chance_of_firing_pottery)
  supplies estimated skilling-curve values 180/800 for non-cup pottery and no firing level
  requirement. These are crowdsourced estimates, not exact Jagex rates. A crack consumes the
  input without a product or XP; the [unfired bowl page](https://oldschool.runescape.wiki/w/Unfired_bowl)
  confirms those consequences. The discussion explicitly leaves cups unconfirmed.

The active cache confirms sequences 883 (`human_potterywheel`) and 1317
(`potteryoven_quick`), native quantity-menu group 270, and the recipe item identifiers.
Recipe additions are plugin-owned data; no generated exports changed.

Regression coverage exercises the registered handlers, menu order/quantities, item and XP
changes, level/membership/quest gates, deterministic crack outcomes, cancellation (including a
completed one-step move), and the removed quest firing shortcut. All twelve new regressions fail
with the original pottery/recipe/quest implementation. The focused Crafting and neighbouring
quest checks pass after the fix (69 checks). The full server suite passed 8,585 checks; its only
failure was `ai-bots.test.cjs`, blocked by a missing `standardwebhooks` dependency, also
reproduced against the base implementation. Final focused checks were rerun after review adjustments.

In-game verification uses the ordinary wheel menu, item-on-oven menu and native item/quantity
selection. Two bowls consume two clay for 36 Crafting XP; two firings produce two bowls for
30 XP after their delays. Additional checks cover pot-lid shaping/firing after a declared quest
prerequisite fixture, four cups per clay, and movement cancellation. This is an interaction check,
not a One Small Favour quest playthrough or a visual client review.
