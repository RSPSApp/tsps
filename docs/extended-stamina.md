# Extended stamina potion and the ring of endurance

Plugins: `server/plugins/items/Potions.plugin.js`, `server/plugins/items/RingOfEndurance.plugin.js`.
Tests: `server/tests/consumable-edge-cases.test.cjs`, `server/tests/ring-of-endurance.test.cjs`.

Source: OSRS Wiki, [Extended stamina potion](https://oldschool.runescape.wiki/w/Extended_stamina_potion)
and [Ring of endurance](https://oldschool.runescape.wiki/w/Ring_of_endurance). No rsprox capture
mentions the extended potion, so the numbers below are the Wiki's.

## Behaviour

- Each dose restores 40% run energy and cuts run-energy drain by 70% for 4 minutes (a stamina
  potion: 20% and 2 minutes). Another dose resets the timer; the effect does not stack.
- Worn charged ring of endurance: the dose is doubled to 80% energy and 8 minutes and spends
  2 charges (a stamina dose spends 1).
- Using an extended potion on a ring adds 2 charges per dose (a stamina potion adds 1).
- The Herblore recipe (stamina potion plus marlin scales, level 85) already lives in
  `plugins/skills/data/herblore.json`.

## Expiry lines (rsprox captures)

Every stamina effect (stamina potion, mix, extended potion, Egniol potion) ends with the same two
game messages, recorded in 173 recordings (224/01440, 231/00391, 237/01087 among them):

- 20 ticks before the end, on the tick `stamina_duration` (varbit 24) goes from 3 to 2:
  `<col=8f4808>Your stamina enhancement is about to expire.</col>` and sound 3120, three loops.
- On the tick it reaches 0 and `stamina_active` (varbit 25) clears:
  `<col=8f4808>Your stamina enhancement has expired.</col>` and sound 3424.

A new dose re-arms the warning. Test: `server/tests/stamina-expiry.test.cjs`.

## How it is wired

`Potions.plugin.js` registers the potion and sends the shared `potions:stamina-effect`
payload with `energy`, `durationMs` and `charges`. The ring listens to that event and doubles
the payload, spending `charges`. `CHARGES_BY_ITEM` in the ring plugin holds what each potion
adds.

## Not covered

- "Unequipping the ring immediately halves the effect" (Wiki): the effect is stored as an end
  time and not tied to the ring, and the Wiki gives no detail on how the halving works.
- A ring with only one charge left, drinking an extended dose: the Wiki does not say; the
  ring spends what it has and still doubles the dose.
