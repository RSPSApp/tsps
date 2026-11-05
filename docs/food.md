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
| `heal` | A number, `{ "min", "max" }` (a roll), `{ "flat", "percent" }` of the Hitpoints level (strawberry, sweetcorn, watermelon slice), or `{ "lowestOf": { skill: divisor }, "round"? }`: the lowest of those base levels divided by their numbers, rounded down or `"nearest"` (the Neypotzli foods: cooked bream the lower of Cooking/3 and Fishing/3, to the nearest, as the Wiki's 7 at 20 Fishing shows; cooked moss lizard the lower of Cooking/3 and Hunter/2, down). |
| `eatDelay` | Ticks until the next bite, per bite or for all (default 3). |
| `combo` | A combo food. |
| `leaves` | The item left after the last bite (`Pie dish`, `Bowl`). |
| `boost`, `drain`, `restore` | Skills by name and amount: a boost to base + amount, a drain from it, a restore up to base. Restore amounts may be `{ "flat", "percent" }` of the base level. |
| `stamina`, `area`, `option` | Apply the shared stamina effect, require a `food:area` scene check (its owner may set the refusal `message`), or consume via a cache action other than Eat. |
| `runEnergy`, `curePoison`, `cureVenom`, `poisonImmunity` | Run energy restored; ordinary poison cured/venom converted to poison; explicit full poison-and-venom cure; seconds of poison immunity. |
| `then` | A second heal `ticks` later, with its own effects (hunter meats, 7 ticks). A newer one replaces a pending one. |

## Poison treatments

Checked 24 October 2026 against [Guthix rest](https://oldschool.runescape.wiki/w/Guthix_rest),
[cooked moonlight antelope](https://oldschool.runescape.wiki/w/Cooked_moonlight_antelope),
and [Venom](https://oldschool.runescape.wiki/w/Venom):

- Guthix rest converts venom to ordinary poison at the same damage, or reduces
  existing poison damage by one. A conversion does not also reduce damage on
  that dose. It restores 5 run energy and heals 5 HP, allowing a boost up to
  base +5 when already at full HP; it never lowers a higher existing overheal.
- Moonlight antelope's secondary heal, seven task ticks after eating, removes
  poison or converts venom at matching damage. Neither treatment grants or
  replaces immunity. Another hunter meat replaces the pending heal/cure;
  ordinary food and potion effects do not replace it.
- Strange fruit explicitly requests the full venom cure and retains its existing
  short protection and energy restoration.

The shared `ConsumableEffects.curePoison(player, damageReduction)` defaults to
removing ordinary poison, with an optional reduction in displayed hit damage.
The server represents poison as five severity points per starting damage and
venom as direct damage. Conversion preserves damage through that representation
without submitting or restarting a poison task. The existing explicit
`curePoisonAndVenom` remains a full purge for callers that need it.

Regressions in `tests/food-poison-treatments.test.cjs` use real Player poison
fields and CountdownTask ticks, covering treatment stages, expiry timing,
replacement, death, overheal boundaries and existing immunity. Potion intake,
quest unlocks, broader antidote/anti-venom tiers and orb remedy selection remain
separate audits; this correction does not establish complete food/potion parity.
| `outcomes` | A table of results by `weight`, each with its heal, boosts, drains, `drainRandom` (a random skill but Hitpoints) and messages (kebabs). |
| `special` | `anglerfish`: its heal from the eater's Hitpoints level (the level levelled up to, not the health left) and its overheal (not in combat in a PvP area). |
| `wildernessOnly` | Can only be eaten in the Wilderness (blighted food). |
| `message`, `messages`, `healMessage`, `afterMessage` | The eat line (or one per bite), the heal line (`null` for none), and a line after it. |
| `refuse` | The item can't be eaten; this is the message. |

## Ours, not live

- **Ration amounts:** the Wiki describes prison rations as similar to Scarred scraps without
  giving numerical Hitpoints/Prayer amounts. Their 15 HP and 25% base Prayer follow that
  comparison; calibrate them when a numerical prison capture is available.

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
nightshade, Servery food); event sweets and candy; food only eaten in one
area (Vampyrium); unobtainable items; and the whole watermelon, which is sliced first.

## Guthix rest recipe permission

The [Guthix rest Wiki page](https://oldschool.runescape.wiki/w/Guthix_rest) says
Sanfew's recipe explanation during One Small Favour unlocks both making and
drinking the tea. Making requires 18 Herblore; drinking has no Herblore gate.

One Small Favour owns this permission. Its stage 11 starts before the explanation,
so continuing past the imported Sanfew recipe line persists the false-default
`one-small-favour:guthix-rest-learned` flag. Later quest stages already imply
the lesson was completed, including existing saves without the new flag.
Interrupting the conversation before completing that line does not unlock it.

Potions emits `potions:validate-drink` with `{ player, itemId, allowed, message }`
after its normal area/food checks and before dose consumption, effects or
cooldowns. A content plugin can deny the drink and supply the reason. This keeps
quest rules in their quest plugin and applies to each normal potion entry point.

`tests/guthix-rest-unlock.test.cjs` covers all four doses, early/later stages,
dialogue continuation, denied ingredient preservation and the making-only level
gate. An unlearned player also cannot skip the lesson by handing purchased tea
to Bleemadge and advancing the quest. This correction retains the existing simplified, single-step brewing
recipe; it does not claim the staged live-game tea preparation is implemented.

## Hitpoints orb potion selection

The [Poison Wiki page](https://oldschool.runescape.wiki/w/Poison) describes
preferring stronger remedies, then the least-dosed vessel of the remedy, with
inventory order breaking dose ties. [Venom](https://oldschool.runescape.wiki/w/Venom)
also lists Guthix rest as an applicable partial treatment and puts potions ahead
of other remedies.

The potion handler selects the strongest supported treatment family, then its
least-dosed vessel, retaining the first slot for a dose tie. Selection uses the
registered dose chains; consuming the selected vessel still goes through the
normal drink restrictions, effects, messages, animation and cooldowns.
Guthix rest is available as a partial treatment when no stronger supported
potion is carried.

Relative strength follows the Wiki's increasing poison protection tiers and
explicit anti-venom upgrades. Antipoison/mix, superantipoison/Sanfew, and
Antidote+/mix share their respective treatment strength. Different families at
the same strength retain their existing inventory precedence: their exact live
tie priority has not been established. Non-potion fallback selection and remedies
not yet registered by Potions remain separate work; this does not establish
complete health-orb or poison/venom parity.

`tests/health-orb-potion-selection.test.cjs` checks all pairwise supported tier
comparisons for both afflictions, dose ties, mixes, partial tea, noted items,
unrelated potions and the existing drink cooldown.

## Beer drink feedback

Ordinary Beer uses the potion handler's existing `drink.messages` field. It reports
"You drink the beer. You feel slightly reinvigorated..." followed by
"...and slightly dizzy too.", instead of the generic potion-completion message.

Evidence: [rsprox captures](https://rsprox.net/database), recordings **428** and
**3128** (revision 232), both send these two lines on the drink tick and replace
`beer` with `beer_glass`. The [OSRS Wiki chat-message reference](https://oldschool.runescape.wiki/w/User:Skretzo/Chat_messages)
also lists these lines for Drink Beer. This cache resolves those item gamevals to
1917 and 1919; Beer has the inventory action Drink. Effects, cooldowns, animation
and sound retain the existing drink path.

Regression coverage in `server/tests/consumable-edge-cases.test.cjs` dispatches the
registered drink handler, checks both messages and the returned glass, and checks
that a second beer during the cooldown produces no success feedback or consumption.
