# Food

Eating is `server/plugins/items/Food.plugin.js`. What each food does is
`server/plugins/items/data/food.json`, one food per line, keyed by the item's cache name: every
id with that name eats the same way, so variants (a minigame's shark, the noted-and-unnoted pairs)
need no id lists. Tests: `server/tests/food-effects.test.cjs` and `eat-attack-delay.test.cjs`.

## Sources

- **The OSRS Wiki:** heals, bites, eat delays, combo foods, boosts and effects, from
  [Food/All food](https://oldschool.runescape.wiki/w/Food/All_food),
  [Food/Fast foods](https://oldschool.runescape.wiki/w/Food/Fast_foods), the hunter meats section of
  [Food](https://oldschool.runescape.wiki/w/Food) and the item pages (kebab effect tables, pie dishes).
- **rsprox recordings** ([rsprox.net database](https://rsprox.net/database)): the eat messages of
  about 90 foods, "It heals some health." after a heal, and the `tracking_food_eaten` varp (4518)
  that counts every bite. The animation (`human_eat`) and sound (2393) match them.
- **The cache:** which items can be eaten (an Eat option), their names, and their ids.

## How eating works

- **Timers (Wiki: Food):** a bite adds 3 ticks to the attack timer and blocks the next bite for
  the food's eat delay: 3 ticks, or less for fast foods (cakes 2, 2, 3; pies and pizzas 1, 2 or
  1, 1; giant crab meat 2). Combo foods (karambwan, halibut, gnome food, crystal paddlefish) add 2
  to the attack timer and have their own 3-tick timer, so one can follow other food, and a potion,
  in the same tick.
- **Messages (rsprox):** "You eat the <name>." unless the food has its own line, then "It heals
  some health." when it healed (not at full Hitpoints). Multi-bite foods have a line per bite
  ("You eat part of the cake.", "You eat half the Wild pie.").
- **Refusals:** "You cannot eat here." where a plugin bars food (`onCanEat`), "You're currently
  stunned!", the blighted foods outside the Wilderness ("The blighted manta ray can be eaten only
  in the Wilderness."), and a whole pineapple ("You can't eat it whole; maybe you should cut it
  up.").
- **Events:** `food:eaten` (`{ player, itemId, heal }`) after every bite.

## The data

| Field | Meaning |
| --- | --- |
| `name` | The item's cache name. |
| `bites` | The bite names, first to last (`["Cake", "2/3 cake", "Slice of cake"]`), or a number when every bite has the same name: that name's ids, lowest first, are the bites (giant crab meat). |
| `heal` | A number, `{ "min", "max" }` (a roll), or `{ "flat", "percent" }` of the Hitpoints level (strawberry, sweetcorn, watermelon slice). |
| `eatDelay` | Ticks until the next bite, per bite or for all (default 3). |
| `combo` | A combo food. |
| `leaves` | The item left after the last bite (`Pie dish`, `Bowl`). |
| `boost`, `drain`, `restore` | Skills by name and amount: a boost to base + amount, a drain from it, a restore up to base. |
| `runEnergy`, `curePoison`, `poisonImmunity` | Run energy restored, poison and venom cured, seconds of poison immunity. |
| `then` | A second heal `ticks` later, with its own effects (hunter meats, 7 ticks). A newer one replaces a pending one. |
| `outcomes` | A table of results by `weight`, each with its heal, boosts, drains, `drainRandom` (a random skill but Hitpoints) and messages (kebabs). |
| `special` | `anglerfish`: its heal from the eater's Hitpoints level (the level levelled up to, not the health left) and its overheal (not in combat in a PvP area). |
| `wildernessOnly` | Can only be eaten in the Wilderness (blighted food). |
| `message`, `messages`, `healMessage`, `afterMessage` | The eat line (or one per bite), the heal line (`null` for none), and a line after it. |
| `refuse` | The item can't be eaten; this is the message. |

## Ours, not live

- **Inferred messages:** the pies, pizzas and cakes with no recording use the pattern of the
  recorded ones ("You eat half the meat pie.", "You eat the remaining Wild pie."); the
  capitalised pie names (Garden, Admiral, Summer) follow Wild and Fish pie, the ones recorded
  capitalised.
- **Bowls:** the Wiki says an empty bowl remains for stew, curry and banana stew; the other bowl
  foods ("a bowl of ...") leave one the same way.
- Mackerel's "You eat the cod." is live's own text (recorded).

## Not food here

Items with an Eat option that aren't in the data, each listed with its reason in the test:
handled by another plugin (Poisoned cheese, White pearl, ToA's Honey locust, Castle Wars bandages
use Heal); quest, event and minigame items with their own effects (rock cakes, poison karambwan,
nightshade, Servery food, the Vampyrium foods); event sweets and candy; food only eaten in one
fight (Moons of Peril); unobtainable items; and the whole watermelon, which is sliced first.
