# Bryophyta's staff

`server/plugins/items/BryophytasStaff.plugin.js`.

## Charging

rsprox captures, local recording 1000564 (rev 227), tick 31098-31099: a nature rune used on the
uncharged staff (22368) takes every nature rune held (31) in the same tick, with no amount prompt.
The staff becomes the charged staff (22370) in the same slot and an objectbox opens with the charged
staff (zoom 400) and "Your Bryophyta's staff now has 31 charges.", also sent to the chat as a mesbox
line.

The Wiki caps the staff at 1,000 charges, so a larger stack adds only what fits. Preset (untradeable)
nature runes are refused with the shared preset message, as for the circlet of water: they would
otherwise become tradeable charges.

## Paying spells

Wiki: while equipped, it acts as if the player held the charged number of nature runes. It is a spell
rune source (`registerSpellRuneSource`), so combat spells (`Spell.ts`) and the item spells (High and
Low Level Alchemy, Telekinetic Grab and the rest in `MagicOnItemPacketListener.ts`) can use it.

The engine now lets each rune of a cast come from a different source when no single source holds the
whole shortfall. Fire runes from the rune pouch and nature runes from the staff pay for one High
Level Alchemy. One rune is never split between two sources.

Wiki (with Mod Ash, 23 March 2020): a spell paid from the staff has a 1/15 chance to save one charge,
"Your staff saved you a nature rune.", whatever its nature rune cost.

## Ours

- Nature runes in the inventory are spent before the staff's charges, the order every rune source
  uses here. No capture shows a cast with both.
- Check: "Your Bryophyta's staff has N charges.", worded after the captured charge message.
- A full staff: "Your Bryophyta's staff already has 1,000 charges."
- Spending the last charge turns it back into the uncharged staff.

Not done: Uncharge (the Wiki says the runes are lost, but the confirmation wording is not captured),
the bank's Configure-Charges, and Ultimate Ironman death rules.
