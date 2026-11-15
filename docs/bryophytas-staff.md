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

## Bank Configure-Charges

Wiki: the charges can be configured while the staff is in the bank, with Configure-Charges (bank
item op 9; the charged staff carries cache param 2257). The prompt and the shortfall line are live's
shared ones, captured for the toxic blowpipe (rsprox_transcripts/229/911020.txt, ticks 41-45):
"How many charges would you like the item to have on withdrawal? (0 - 1,000)", and a withdrawn
staff is charged from the banked nature runes up to that amount. When the bank runs short it charges
what there is and says "<col=ff3045>You did not have enough resources to charge your Bryophyta's
staff up to 1000." (the number unformatted, as captured).

Ours: the amount is kept per player (`bryophytas-staff:withdrawal-charges`), a withdrawal only tops
up and never takes charges off, and only the charged staff is topped up. Not modelled: Uncharge (the
Wiki says the nature runes are not returned, but no capture shows its prompt or reply) and the
Wiki's Ultimate Ironman death rule.

## Ours

- Nature runes in the inventory are spent before the staff's charges, the order every rune source
  uses here, and the staff's charges are spent before the rune pouch's (plugin load order, pinned by
  a test). No capture shows a cast with more than one.
- Check: "Your Bryophyta's staff has N charges remaining.", worded as the captured bone staff
  (rsprox 2152, tick 2826) and Sanguinesti staff (rsprox 1696, tick 1077).
  The uncharged staff's Check uses the same line, with 0 charges; live's wording for an empty staff
  is not captured.
- A full staff: "Your Bryophyta's staff is already fully charged.", as the captured full bone staff
  (rsprox 2152, tick 4158).
- Spending the last charge turns it back into the uncharged staff.

Not done: Uncharge (the Wiki says the runes are lost, but the confirmation wording is not captured),
the bank's Configure-Charges, and Ultimate Ironman death rules.
