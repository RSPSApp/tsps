# Cooking

`server/plugins/skills/Cooking.plugin.js` registers its units in `server/plugins/skills/cooking/`:

- `Common.Cooking.js` – the data, level and cape checks, message helpers and the keyed step runner.
- `Cookers.Cooking.js` – fires, ranges and ovens: one loop for every cooker.
- `Recipes.Cooking.js` – one item used on another: doughs, pie shells, pie fillings, the pizza
  steps and toppings, the baked potato toppings and the bowl foods chopped with a knife.
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
  diary the Wiki requires to use the kitchen's ranges is checked; the refusal line is ours.
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
- **Fireplaces.** A lit fireplace cooks as a fire (Wiki: Fireplace: "carries the same burn rate
  as a regular fire", and no range food). rsprox capture 1001621 (rev 241) uses raw shrimps on
  the Draynor Village fireplace (`fireplace` 24969, 3100,3256) at tick 627: the how-many menu,
  then `human_firecooking`, sound 2577 and the usual shrimp lines and burn. The ids are the
  Wiki infobox's lit ones (4618, 4650, 5165, 7185, 8712, 10058, 10824, 17640-17643, 21795,
  24969, 24970, 26179, 30138); Misthalin Mystery's riddle fireplace (30136/30137) is not one.
  Other locs named "Fireplace" (unlit, quest props, house fireplaces) are not cookers. The
  op-less "Cooking pot" over the Lumbridge farmhouse fireplace (`fireplacecookingpot` 26180,
  3225,3290) is a fire too: rsprox captures 911358 (tick 1197-1201) and local 1001342 (rev 240,
  tick 1197-1231) show the menu, `human_firecooking`, "You cook some chicken.", and one raw beef
  cooking at once with no Sinew choice. The other op-less pots (12969, 7483) are not captured and
  are not cookers.
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
  `synth_sound 2577`, the sinew in the meat's slot and Cooking XP (3, Wiki).
  `cooking_success_count` does not move.
- The first sinew is on the tick the choice is handled, then 3 ticks, then every 4 (1749; Wiki:
  "Make-all is 0, 3, then 4 ticks"). One piece is the same. The server's own writes for the
  choice, `skillmulti_previousselection` 0→1 and `busy` 1→0, come in the same tick as the first
  sinew in both recordings: tick 2666 in 1749, and tick 1066 in 89, where the client's
  `resume_pausebutton` is listed under 1065. A transcript shows when a client packet was read,
  not which tick handled it.
- One meat whose range refuses it (Cook's Assistant, the Hosidius diary) is refused before the
  menu opens, as it was before Sinew was offered. Ours: no capture shows a refusal.
- It can fail on the Wiki's "Sinew cooking chance" chart (range 128/512, the Hosidius Kitchen's
  +12 as for other food), the meat's curve: certain from level 34. Both recordings are at 87+,
  so a failure is not captured. Ours: it gives burnt meat with "You accidentally burn the meat."
  and resets `cooking_success_count` like any burn.
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

### Nettle tea

rsprox capture 1001702 (rev 242, the user's own recording, Edgeville house stove
`100_dave_stove`), the Ghosts Ahoy capture 20261112T092603 (ticks 373-383, the porcelain cup) and
the Wiki ([Nettle tea](https://oldschool.runescape.wiki/w/Nettle_tea),
[Nettle-water](https://oldschool.runescape.wiki/w/Nettle-water),
[Cup of tea (nettle)](https://oldschool.runescape.wiki/w/Cup_of_tea_(nettle)),
[Porcelain cup](https://oldschool.runescape.wiki/w/Porcelain_cup)):

- A bowl of water used on nettles (or the other way round): a tick later "You place the nettles
  into the bowl of water." (spam), the nettles' slot empties and the bowl's slot holds the
  nettle-water (1001702, ticks 15606-15607). No XP; 20 Cooking (Wiki); it is a `cooking.json`
  recipe (`productSlot` keeps the bowl's slot), so more than one opens the make menu.
- Nettle-water on the stove: `human_cooking`, `synth_sound fry` (2577), "You boil the water and make
  nettle tea." (spam), the tea in the first free slot, 52 Cooking XP and `cooking_success_count` up one,
  two ticks after the player arrived (1001702, ticks 15648-15651). It is a `cooking.json` cookable,
  so fires, ranges and the cook menu all take it.
- The water can boil over, leaving the empty bowl, on the Wiki's "Nettle tea cooking chance"
  chart (fire or range 78/412, the Hosidius Kitchen's +12 as for other food): certain from 53.
  The Wiki's prose says it stops at 54; the chart's values give 53. Ours: the line "The water
  boils over." (no capture or Wiki text for a boil-over).
- The tea (plain or milky) into an empty cup or a porcelain cup, and a bucket of milk into the tea
  in a bowl or either cup: a tick after the use, no line, no XP, sound 2401, the brew in the cup's
  slot (the tea's, for milk) and the emptied bowl or bucket in the other slot (Ghosts Ahoy capture
  20261112T092603: tea into the porcelain cup at 373, response 374; milk at 382, response 383; no
  Cooking stat update). The Wiki: the porcelain cup "works like a normal teacup", so the plain
  cup pours the same. The Wiki's Cup of tea (nettle) recipe box lists 20 Cooking and 52 XP, the
  boiling's values; the recording shows neither for a pour (recorded difference).

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
- Baked potato toppings, from each potato's page ([Potato with butter](https://oldschool.runescape.wiki/w/Potato_with_butter),
  [Potato with cheese](https://oldschool.runescape.wiki/w/Potato_with_cheese),
  [Chilli potato](https://oldschool.runescape.wiki/w/Chilli_potato),
  [Egg potato](https://oldschool.runescape.wiki/w/Egg_potato),
  [Mushroom potato](https://oldschool.runescape.wiki/w/Mushroom_potato),
  [Tuna potato](https://oldschool.runescape.wiki/w/Tuna_potato)): butter (or not garlic butter)
  on a baked potato at 39 (40 XP), then on the potato with butter cheese at 47 (40), chilli con
  carne at 41 (15), egg and tomato at 51 (45), mushroom & onion at 64 (55) or tuna and corn at
  68 (10). Every step is 2 ticks. The chilli and tuna bowls come back empty.
- Bowl foods, from each item's recipe box ([Chopped onion](https://oldschool.runescape.wiki/w/Chopped_onion),
  [Sliced mushrooms](https://oldschool.runescape.wiki/w/Sliced_mushrooms),
  [Chopped tomato](https://oldschool.runescape.wiki/w/Chopped_tomato),
  [Chopped garlic](https://oldschool.runescape.wiki/w/Chopped_garlic),
  [Chopped tuna](https://oldschool.runescape.wiki/w/Chopped_tuna),
  [Minced meat](https://oldschool.runescape.wiki/w/Minced_meat),
  [Chopped ugthanki](https://oldschool.runescape.wiki/w/Chopped_ugthanki),
  [Sweetcorn (bowl)](https://oldschool.runescape.wiki/w/Sweetcorn_(bowl)),
  [Spicy sauce](https://oldschool.runescape.wiki/w/Spicy_sauce),
  [Chilli con carne](https://oldschool.runescape.wiki/w/Chilli_con_carne),
  [Egg and tomato](https://oldschool.runescape.wiki/w/Egg_and_tomato),
  [Mushroom & onion](https://oldschool.runescape.wiki/w/Mushroom_%26_onion),
  [Tuna and corn](https://oldschool.runescape.wiki/w/Tuna_and_corn),
  [Onion & tomato](https://oldschool.runescape.wiki/w/Onion_%26_tomato),
  [Ugthanki & onion](https://oldschool.runescape.wiki/w/Ugthanki_%26_onion),
  [Ugthanki & tomato](https://oldschool.runescape.wiki/w/Ugthanki_%26_tomato),
  [Kebab mix](https://oldschool.runescape.wiki/w/Kebab_mix)), all members-only, 2 ticks each
  unless noted:
  - with a knife carried (a recipe's `tools`), an onion, mushroom, tomato, garlic, tuna, cooked
    meat or ugthanki meat goes into an empty bowl: no level, no XP, the knife stays. Cooked
    sweetcorn goes into a bowl without one;
  - with a knife, onion, tomato and ugthanki meat combine two at a time into onion & tomato,
    ugthanki & onion and ugthanki & tomato, and the third makes kebab mix (all level 1, no XP);
  - spicy sauce: chopped garlic and gnome spice, 9 (25 XP). Chilli con carne at 11: spicy sauce
    and cooked meat with a knife, or spicy sauce and minced meat (one bowl back), 1 tick each.
    Egg and tomato at 23: scrambled egg and a tomato, no knife. Mushroom & onion at 57: fried
    mushrooms and fried onions. Tuna and corn at 67: a bowl of sweetcorn and tuna with a knife,
    a bowl of sweetcorn and chopped tuna (one bowl back), or cooked sweetcorn and chopped tuna.
    None of these mixes gives XP but spicy sauce;
  - without the knife the pair does nothing and says nothing (item-on-item has no fallback line
    here; live presumably says "Nothing interesting happens."). The Wiki quotes no line
    for any of them, so they are made silently.
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

### Baked potato toppings

- Butter on a baked potato (rsprox.net recording 1105, rev 237, Leagues VI, tick 14341): no menu
  for one potato, no animation or sound, and two ticks after the use the potato and the butter
  become a potato with butter, with the Cooking XP and the spam line "You add the butter to the
  potato.".

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
- The bowl foods' lines: the Wiki gives none and nothing is captured, so they are made silently.
  Ours: mushroom & onion gives one of its two bowls back (the Wiki's text uses two bowls, its
  recipe box lists none back). A Fletching knife worn does not count as the knife (Tuna and corn
  page); only the plain knives carried do.
- The ugthanki kebab (kebab mix on pitta bread, 40 XP): its failure chance to a bad kebab is from
  a Discord answer, not stated by the Wiki, so it is not made here.
- The potato topping lines other than butter's: no capture or Wiki text gives them, so cheese,
  chilli, egg, mushroom and tuna potatoes are made without a line. The egg and mushroom bowls
  come back like the chilli and tuna ones (ours: their Wiki recipes list no bowl). The toppings'
  2-tick first item follows the captured butter.
- Roast rabbit and the skewered chompy (iron spit); the Ogre spit-roast for jubbly and chompy,
  which cook on a fire here.
- Gnome cuisine beyond the tutorial products (worm hole, veg ball, tangled toad's legs, the other
  battas and crunchies, the cocktails' drunk dragon), the stuffed snake, fresh monkfish, undead
  meat and chicken, and giant seaweed's six soda ash.

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
