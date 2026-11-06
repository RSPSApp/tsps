# Cooking

`server/plugins/skills/Cooking.plugin.js` registers four units in `server/plugins/skills/cooking/`:

- `Common.Cooking.js` – the data, level and cape checks, message helpers and the keyed step runner.
- `Cookers.Cooking.js` – fires, ranges and ovens: one loop for every cooker.
- `Recipes.Cooking.js` – one item used on another: doughs, pie shells, pie fillings, the pizza
  steps and toppings.
- `Wine.Cooking.js` – unfermented wine and its fermenting.

Every food, dough, recipe and wine is in `server/plugins/skills/data/cooking.json`, by cache
gameval. The Gauntlet's range is `server/plugins/minigames/gauntlet/Prep.Gauntlet.js`. Tests:
`server/tests/cooking.test.cjs`, `server/tests/cooking-gauntlets.test.cjs`.

## Sources

- **The OSRS Wiki:** levels, XP and burn levels from each food's page and
  [Cooking/Burn level](https://oldschool.runescape.wiki/w/Cooking/Burn_level) (the fire column;
  a food that never stops burning there is 99). The burnt items come from the
  [Burnt fish](https://oldschool.runescape.wiki/w/Burnt_fish) pages (herring and mackerel burn
  to 357, trout, cod, pike and salmon to 343, tuna and bass to 367, sardine to 369, anchovies to
  323), [Cooked rabbit](https://oldschool.runescape.wiki/w/Cooked_rabbit) (burnt meat), and
  [Cooked meat](https://oldschool.runescape.wiki/w/Cooked_meat) for burning it on purpose.
  The pie, pizza and dough recipes come from each item's page, the wine timer and
  success chances from [Jug of wine](https://oldschool.runescape.wiki/w/Jug_of_wine),
  [Unfermented wine](https://oldschool.runescape.wiki/w/Unfermented_wine) and
  [Wine of Zamorak](https://oldschool.runescape.wiki/w/Wine_of_Zamorak).
- **rsprox captures** ([rsprox.net database](https://rsprox.net/database)): recordings 269, 1087,
  1098, 1102, 1718, 1723, 3270, 4103 and 4283 for fires, ranges and ovens (4103 for the Sailing
  fish); 75, 564 and 1858 for doughs, pies and pizza; 91 and 1105 for wine; 1158, 3276 and 3285
  for the Gauntlet.

## What the captures show

### Fires, ranges and ovens

- **The menu.** Using a raw food on a cooker, or "Cook" on a range or oven, opens `skillmulti`
  (clientscript argument 6). One kind of food: "How many would you like to cook?" with the raw
  item, offering as many as are carried. Several kinds ("Cook" only): "What would you like to
  cook?" with what each cooks into. A single raw item cooks without a menu.
- **Timing.** The first food is 2 ticks after the choice (or after reaching the cooker with a
  single item), the second 3 ticks after that, then every 4. `busy` is 1 from the choice to the
  first food.
- **Animation.** Fires and a house's firepits and stoves, ovens included, play
  `human_firecooking`; every other range and oven (`range`, `cooksquestrange`, `fortis_stove`
  "Oven") plays `human_cooking`. Each food plays `synth_sound 2577`. Pies and pizzas bake the
  same way, on a range only.
- **Lines** (spam channel). "You successfully cook a shark." / "an anglerfish" / "some shrimps"
  for most fish; "You cook a bass.", "You manage to cook a tuna.", "You cook the rabbit.", "You
  cook a piece of meat.", "You cook the thin snail.", "You successfully bake some bread.", and for
  a karambwan before Tai Bwo Wannai Trio "You cook the karambwan. It looks very dodgy." The
  Sailing fish: "You successfully cook the giant krill." (and the haddock, yellowfin, halibut,
  bluefin, marlin), "You successfully cook a swordtip squid." / "a jumbo squid". Baking: "You
  successfully bake a traditional apple pie.", "You successfully bake a delicious redberry pie.",
  "You successfully bake a pizza." A burn is "You accidentally burn the herring." Cooked meat on
  a cooker: "You deliberately burn the nicely cooked meat."
- **`cooking_success_count`** goes up one for each food cooked and back to 0 on a burn, the
  Gauntlet's paddlefish included. It is saved with the player.
- **Refusals** are message boxes: "You need a Cooking level of 80 to cook a shark.", "You haven't
  got anything to cook." ("Cook" with no raw food, also at the Gauntlet), and "You can't cook
  that." (anything else used on a cooker that no other content takes).
- **The Gauntlet.** "Cook" cooks without a menu; the first paddlefish is 2 ticks after reaching
  the range, with the same sound and spam-channel line.

### Doughs, pies and pizza

- **Dough.** A pot of flour on a bucket of water (or the other way round) opens `skillmulti`
  (argument 0) "What sort of dough do you wish to make?" with bread dough, pastry dough, pizza
  base and pitta dough, even for one pot of flour. The first dough is a tick after the choice,
  the second a tick later, then every 2, each with "You mix the water and flour to make some
  pastry dough." / "...to make a pizza base." The pot and bucket come back. With a full
  inventory: "You don't have enough inventory space to make any dough." (game message).
- **Pie shells and fillings.** "How many do you wish to make?" (argument 0) with the product,
  the first a tick after the choice, then every 2, with no line, animation or sound.
- **Pizza.** "You add the tomato to the pizza." and "You add the cheese to the pizza." One item
  is made without a menu.

### Wine

- Grapes on a jug of water open "How many do you wish to make?" with unfermented wine. Each jug
  is 2 ticks apart, starting 2 ticks after the choice; `human_make_wine`, the
  `cooking_make_wine_spotanim` graphic and `synth_sound 2489` (2-tick delay) start each jug, the
  first as the menu closes. "You squeeze the grapes into the jug. The wine begins to ferment."
  comes once, with the last jug.
- **Fermenting.** 20 ticks after the last jug, every unfermented wine the player has ferments at
  once, in the inventory and the bank: the bank's unfermented stack goes and its wine stack
  grows. All the Cooking XP comes on that tick.

## From the Wiki only

- Wine's success chance: about 60% at 35 Cooking and sure at 68 (low 48, high 352); Zamorak's
  wine about 50% at 65 and sure at 98 (low -125, high 260). A stack rolls as 15 equal batches,
  plus one roll for each jug left over. A failed jug is a jug of bad wine, with no XP.
- The pizza toppings' XP (meat 26, anchovies 39, pineapple 45) and every recipe's level.
- Leaping fish (`server/plugins/skills/cooking/LeapingFish.Cooking.js`), the only source of roe
  and caviar for Barbarian Herblore, cut with a knife at any Cooking level, Mod Ash's rates:
  - every cut uses one fish. A successful cut gives roe (caviar from sturgeon), the static
    Cooking XP and, on a second roll, one fish offcuts; a failed cut gives nothing;
  - trout: roe at level/150 (1/150 at 1, 99/150 at 99), offcuts 1/2, 10 XP; salmon: roe at
    level/80 (certain from 80), offcuts 3/4, 10 XP; sturgeon: caviar at the salmon's rates,
    offcuts 5/6, 15 XP;
  - the knife use cuts at once and the same kind of fish is then cut every 3 ticks until none are
    left (changelog 16 November 2022). Using the knife again cuts at once, one fish a tick at most,
    which is why manual cutting is faster.

## Not captured

- The level refusals for doughs, pies, pizza and wine ("You need a Cooking level of 35 to make a
  pizza base.") follow the cooker's refusal.
- The baking lines of the other pies, pitta bread and the burn lines of pies and pizza; the
  bread and pitta dough lines; the topping lines ("You add the meat to the pizza."); the mud,
  garden, fish, admiral, wild and summer part pies' lines (none are sent for the captured
  fillings).
- What happens to wine still fermenting at logout: it ferments 20 ticks after the next login.
- A full bank: the banked jugs' wine and bad wine join stacks the bank holds, or take the
  unfermented stack's slot or a free one. When they would not fit, the banked jugs stay
  unfermented (the carried ones still ferment) until the next jug made or the next login.
- The lean and fat snail lines follow the captured thin snail; beef and rat meat follow the
  captured impaler and mystery meat.
- Cutting leaping fish: the recordings show leaping fish caught and dropped, never cut, and the
  Wiki gives no message, animation or sound, so a cut sends and plays none. With a full inventory
  and no offcuts stack, the offcuts fall to the floor (unconfirmed).

## Not covered

Sinew on the Lumbridge range ("What would you like to cook?|Cooked meat|Sinew"), potatoes, stew,
cakes and the Hosidius Kitchen's lower burn chance.
