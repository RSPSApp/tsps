# Cooking

`server/plugins/skills/Cooking.plugin.js` registers its units in `server/plugins/skills/cooking/`:

- `Common.Cooking.js` – the data, level and cape checks, message helpers and the keyed step runner.
- `Cookers.Cooking.js` – fires, ranges and ovens: one loop for every cooker.
- `Recipes.Cooking.js` – one item used on another: doughs, pie shells, pie fillings, the pizza
  steps and toppings.
- `Wine.Cooking.js` – unfermented wine and its fermenting.
- `Churn.Cooking.js` – dairy churns: cream, butter and cheese.

Every food, dough, recipe and wine is in `server/plugins/skills/data/cooking.json`, by cache
gameval. The Gauntlet's range is `server/plugins/minigames/gauntlet/Prep.Gauntlet.js`. Tests:
`server/tests/cooking.test.cjs`, `server/tests/cooking-gauntlets.test.cjs`,
`server/tests/cooking-burn-chances.test.cjs`, `server/tests/cooking-dairy-churn.test.cjs`.

## Burn chances

Each food's `chance` is the Wiki's cooking chart from its page: a low and a high value out of 256
for each cooker (`fire`, `range`, `lumbridge` for the Lumbridge Castle range, `gauntlets` for
worn cooking gauntlets at a fire or range). The chance of cooking it at level L is the Wiki's
skilling success function (Module:Skilling success chart, `interp`):

    (floor(low * (99 - L) / 98 + high * (L - 1) / 98 + 0.5) + 1) / 256, between 0 and 1

`Common.successChance` computes it, for the cookers, the Gauntlet's range (paddlefish, low 155,
high 368) and the Mess's clay oven. L is the current Cooking level with any boost, and the line
keeps rising past 99: a food that still burns at 99, such as a shark on a fire, stops burning at
a higher level (shark: 109 on a range, 125 on a fire; moonlight antelope: 126 and 137, the
highest). Every charted food stops burning by 150 on every cooker.

- **Hosidius Kitchen.** Its two ranges (clay ovens, object 21302, at 1677,3622 and 1680,3622)
  add 12 to both values, 25 with the elite Kourend & Kebos Diary (Wiki: Hosidius Kitchen). The
  clay oven in the mess next door, and the ones at Neitiznot and Nardah, add nothing. The easy
  diary the Wiki requires to use the kitchen's ranges is not checked.
- **A roll of 0 burns** anything that can still burn, and a roll at or above the burn chance
  cooks it, as before.
- **Foods without a chart** (seaweed and swamp weed, which never fail; the Ruins of Camdozaal
  fish; the lava eel; the Chambers of Xeric fish and bats except the kyren fish)
  keep a `stopBurn` level and the old straight line from a 42% burn chance at their level to none
  at `stopBurn`.
- **Hunters' Rumours.** Graahk, kyatt and pyre fox need 25 rumours, the sunlight and moonlight
  antelope and the dashing kebbit 50 (Wiki: Hunters' Rumours, its rewards table). The refusal
  line is ours; the Wiki gives none. Bots pick their food through `canCookFood`, so they skip
  meat their rumours, or a quest gate such as karambwanji's, don't allow.
- **The Mess's clay oven** cooks ordinary food as well as servery food (Wiki: Clay oven, which
  "acts like a regular range"); only servery food is limited to it.

## Sources

- **The OSRS Wiki:** levels, XP and cooking charts from each food's page; the stop-burn levels
  they give agree with [Cooking/Burn level](https://oldschool.runescape.wiki/w/Cooking/Burn_level)
  to within a level (the Wiki notes that page predates a change to the success roll). The burnt items come from the
  [Burnt fish](https://oldschool.runescape.wiki/w/Burnt_fish) pages (herring and mackerel burn
  to 357, trout, cod, pike and salmon to 343, tuna and bass to 367, sardine to 369, anchovies to
  323), [Cooked rabbit](https://oldschool.runescape.wiki/w/Cooked_rabbit) (burnt meat), and
  [Cooked meat](https://oldschool.runescape.wiki/w/Cooked_meat) and
  [Burnt chicken](https://oldschool.runescape.wiki/w/Burnt_chicken) for burning them on purpose.
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
- **Timing.** The first food is 2 ticks after the choice (or after item-on-object admission with a
  single item), the second 3 ticks after that, then every 4. `busy` is 1 from the choice to the
  first food.
- **Single-item Cook clicks.** [Wiki 2-tick cooking](https://oldschool.runescape.wiki/w/Cooking#2-tick_cooking)
  alternates ground pickup and left-clicking the range. With exactly one raw food and no
  food-specific delay, the Cook action skips the menu and cooks in that interaction turn.
  Item-on-object and menu choices retain the captured delays above.
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
  a cooker: "You deliberately burn the nicely cooked meat." Cooked chicken (Wiki): "You deliberately burn
  the nicely cooked chicken."
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

### Sinew

rsprox captures 89 (tick 1061) and 1749 (ticks 2644-2677), both rev 227 Leagues V worlds at the
Lumbridge Castle range, and the Wiki ([Sinew](https://oldschool.runescape.wiki/w/Sinew)):

- Raw beef on a range opens `skillmulti` (argument 6) "What would you like to cook?" with Cooked
  meat and Sinew, even with one piece (89). Raw bear, boar and impaler meat dry the same (Wiki).
  The Sinew entry dries every sinew meat carried, like the Cooked meat entry cooks them.
- Each piece: "You dry a piece of meat and extract the sinew." (spam), `human_cooking`,
  `synth_sound 2577`, the sinew in the meat's slot and Cooking XP (3, Wiki). It never burns and
  `cooking_success_count` does not move.
- The first sinew is a tick after the choice (89; 1749 shows it on the choice tick), then 3, then
  every 4 (1749).
- Members only and range only (Wiki): fires and free worlds keep the plain meat menu.

### Dairy churn

rsprox captures 90 (rev 227, ticks 8637-8685) and 1105 (rev 237, ticks 14296-14331), both on
Leagues worlds:

- Churn on `dairy_churn` with milk opens skillmulti (mode 0) "What would you like to make?" with
  Cream, Butter and Cheese (`pot_of_cream`, `pot_of_butter`, `cheese`), on the number of buckets
  carried (1 and 2), even for one bucket.
- On the choice, `player_churns_milk_medium` (seq 2794) plays for milk to butter. The butter comes
  18 ticks after the choice and the next 19 ticks after that, the animation starting again with
  it. No sound and no loc animation.
- Each butter: "You churn your milk to make butter." (spam). The butter takes the milk's slot and
  the empty bucket a free one. The XP was 486, which is the Wiki's 40.5 under the Leagues
  multiplier.

## From the Wiki only

- Ordinary wine production stops at 60,000 unfermented jugs across the inventory and real
  bank tabs ([Jug of wine](https://oldschool.runescape.wiki/w/Jug_of_wine), 10 January 2024
  change). The limit is checked when starting a queued action and before each jug, including
  submission of an already-open quantity menu. A refused jug consumes no ingredients and
  does not reset fermentation. Once the pending jugs ferment, production can resume.
  The limit lives on the ordinary wine recipe; the Wine of Zamorak page does not establish
  an equivalent cap.
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

- The churn's other rows ([Dairy churn](https://oldschool.runescape.wiki/w/Dairy_churn),
  [Pot of cream](https://oldschool.runescape.wiki/w/Pot_of_cream),
  [Pat of butter](https://oldschool.runescape.wiki/w/Pat_of_butter),
  [Cheese](https://oldschool.runescape.wiki/w/Cheese)): milk to cream (21, 18 XP, 10 ticks),
  butter (38, 40.5, 19) or cheese (48, 64, 26); cream to butter (38, 22.5, 10) or cheese (48, 46,
  19); butter or not garlic butter to cheese (48, 23.5, 10). With a full inventory the product
  drops to the ground. Cream needs no empty pot. Churning is members-only.

## Not captured

- The level refusals for doughs, pies, pizza and wine ("You need a Cooking level of 35 to make a
  pizza base.") follow the cooker's refusal.
- The baking lines of the other pies, pitta bread and the burn lines of pies and pizza; the
  bread and pitta dough lines; the topping lines ("You add the meat to the pizza."); the mud,
  garden, fish, admiral, wild and summer part pies' lines (none are sent for the captured
  fillings).
- The exact message at the 60,000-jug limit: no recording or Wiki wording was found, so
  reaching the limit stops the action without adding a new refusal line. The cap is
  Wiki evidence, independent of the mixing recordings cited above.
- What happens to wine still fermenting at logout: it ferments 20 ticks after the next login.
- A full bank: the banked jugs' wine and bad wine join stacks the bank holds, or take the
  unfermented stack's slot or a free one. When they would not fit, the banked jugs stay
  unfermented (the carried ones still ferment) until the next jug made or the next login.
- The lean and fat snail lines follow the captured thin snail; beef and rat meat follow the
  captured impaler and mystery meat.
- Cutting leaping fish: the recordings show leaping fish caught and dropped, never cut, and the
  Wiki gives no message, animation or sound, so a cut sends and plays none. With a full inventory
  and no offcuts stack, the offcuts fall to the floor (unconfirmed).

- Churns other than milk to butter: the 10- and 26-tick rows play `player_churns_milk_short` and
  `_long` (the medium one fits the 19-tick rows), the first item a tick short of the cycle like
  the captured butter, and their lines follow it ("You churn your cream to make cheese.").
- Churning cream or butter gives no empty pot back, and only the inputs carried decide the menu:
  each product uses the most processed one (butter, then cream, then milk), then the next once
  it runs out. Used on the churn,
  an input offers only its own products.
- The level refusal ("You need a Cooking level of 48 to make a cheese.") follows the recipes';
  Churn with nothing to churn says "You have nothing to churn." On a free world Churn says "To
  use this item please login to a members' world." and an item used on a churn gets the usual
  fallback. None of these is captured.

## Not covered

- Where Sinew sits in a range's menu among other foods (ours: after them all); no capture mixes
  them. Sinew on a player-owned house range plays its `human_firecooking`, unconfirmed.
- Making chopped onions and sliced mushrooms (a knife and a bowl): the recipes have no tools, so
  only the cooking of them is here.
- Nettle tea: Ghosts Ahoy makes nettle-water and boils it, without a burn chance.
- Roast rabbit and the skewered chompy (iron spit); the Ogre spit-roast for jubbly and chompy,
  which cook on a fire here.
- Gnome cuisine beyond the tutorial products (worm hole, veg ball, tangled toad's legs, the other
  battas and crunchies, the cocktails' drunk dragon), the stuffed snake, fresh monkfish, undead
  meat and chicken, giant seaweed's six soda ash, and the easy diary for the Hosidius Kitchen.

- The bottomless milk bucket on a churn (Wiki: it replaces a bucket of milk).

## Pending wine limit regression coverage

The boundary checks cover a batch crossing 60,000, a single jug attempted at the cap,
submission of a quantity menu after the total changes, unchanged ingredients and timer on
refusal, and making wine again after fermentation. All three boundary regressions fail
against the previous implementation. Live validation with a 59,999-jug bank fixture and
three ingredient pairs made one pending jug, preserved two pairs, fermented all 60,000 for
12,000,000 Cooking XP, and then made the two remaining jugs normally. Existing cooking
regressions also cover the two-tick mixing cadence, 20-tick fermentation, levels, success
and failure XP, and bank capacity handling.
