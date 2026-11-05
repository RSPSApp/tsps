# Warped sceptre charging

Its built-in spell and combat method are the shared powered staff's ([powered-staves.md](powered-staves.md)).

Live OSRS evidence comes from rsprox recording **3899** (revision 235),
with charge checks also present in recording **13** (revision 223).
The active cache confirms sceptre item IDs 28583 (uncharged) and 28585
(charged), the Charge/Check/Uncharge/Wield actions, and `busy` varbit 12393.

## Confirmed behaviour

- Charge on either form, or using earth runes on the uncharged sceptre,
  asks **“How many charges do you want to add? (0 - N)”**. It does not
  spend runes until the player enters a quantity. Each charge costs two
  chaos runes and five earth runes. The prompt maximum reflects available
  runes and remaining capacity. Zero cancels without spending runes.
- A first charge shows the charged sceptre in an item dialogue:
  “You add 1 charge to your warped sceptre.” A top-up instead says
  “You add an additional 50 charges to your warped sceptre. It now has
  5,051 charges in total.” Those quantities are examples recorded in 3899.
- Uncharge first checks inventory space, then asks **“Fully uncharge your
  warped sceptre?”**, with **“Yes.” / “No.”**. No preserves the charges.
  Yes returns the stored chaos and earth runes and shows the uncharged
  sceptre in an item dialogue, including both refund quantities and
  “in the process.”
- Insufficient runes and insufficient refund space produce the captured
  chat messages. Check uses “charge remaining” for one and “charges
  remaining” for multiple charges, with thousands separators.
- Wielding an uncharged sceptre is refused with the captured instruction
  to charge it using two chaos runes and five earth runes per charge.
  A last cast sends the red “Your warped sceptre has run out of charges!”
  warning; a subsequent attack explains that chaos and earth runes are needed.
- `busy` is set during the quantity prompt, confirmation and item dialogues,
  and cleared when the interaction is dismissed or cancelled.

## Regression and runtime verification

The regression tests exercise the registered item handlers and equipment
eligibility hook. They cover partial charges, top-ups, zero, affordable and
capacity limits, missing runes, item movement while a prompt is open, both
confirmation choices, refund space revalidation, existing rune stacks,
message text, item dialogues, charge exhaustion and the busy lifecycle.
The original implementation fails the charge-selection, confirmation,
equipment-refusal and related feedback regressions.

In-game verification confirmed uncharged Wield refusal; unchanged runes
before quantity entry; adding three charges and then two through rune use;
zero cancellation; No preserving five charges; Yes refunding ten chaos and
25 earth runes; walking cancelling the busy state; and charging ten casts
before successfully wielding the sceptre with the worn charge count of ten.
Failure checks also confirmed the missing-runes refusal and uncharging
refused with one free slot but completed with two when neither rune stack
was present.

The evidence concerns charge management. Combat balance and projectile
presentation were not re-audited. Rune-use evidence specifically records
earth runes on the uncharged form; the existing shared handler continues
to support both rune types and both sceptre forms. No generated data changes
are required.
