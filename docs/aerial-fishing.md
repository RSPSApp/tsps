# Aerial fishing

Aerial fishing trains Fishing and Hunter together at Lake Molch. Borrowing a cormorant
from Alry requires 35 Hunter and 43 Fishing, with empty weapon, shield and hands slots.
The borrowed bird and suitable bait are required for each catch.

## Borrowing boosts

The [OSRS Wiki's aerial fishing page](https://oldschool.runescape.wiki/w/Aerial_fishing)
explicitly permits boosting to borrow the bird and continuing to catch bluegill after
those boosts expire. The minimum levels therefore apply when borrowing, rather than
when sending the bird or receiving its catch. Current levels still determine eligibility
for higher fish and the catch roll. Bluegill is the fallback and awards 16.5 Hunter XP
and 11.5 Fishing XP before world multipliers.

Previously, both sending the bird and completing its flight checked the borrowing
requirements again. Expiry before a click refused fishing; expiry during flight silently
lost the catch. Both checks are removed. The borrowing gate, bait check and cancellation
on player movement, combat, return of the bird or session cleanup remain in place.

## Clue bottles

Aerial fishing has its own [clue bottle](https://oldschool.runescape.wiki/w/Clue_bottle)
rolls. The matching Combat Achievement tier's 5% bonus applies to its eligible
non-beginner bottle tier. This follows the Wiki's general bottle formula and listed
Aerial base; it is not a separate captured Aerial reward observation.

## Comparison and verification

The Wiki also describes guaranteed catches, distance-based travel time, fishing with a
full inventory, fish cutting, and doubling from spirit flakes and Rada's blessing. The
source review found that ordinary fish that do not fit are discarded,
rare rewards can fall on the ground, doubling does not add XP, and pearls have their own
roll. These reward branches were reviewed in code, rather than certified by the in-game
boost check.

Regression coverage exercises borrowing below either requirement, expiry of either or
both boosts before sending the bird, expiry during its flight, the bluegill item and both
XP gains, missing bait or bird, walking away and returning the bird. The before-click and
in-flight expiry regressions failed against the original code.

An in-game check borrowed the bird at the required levels, then lowered Hunter to 34
and Fishing to 42 as a fixture for expired boosts. The original version refused the
Catch action with the Hunter requirement message. With the fix, the ordinary Catch
interaction returned a bluegill and awarded both skills' XP. This check uses supplied
levels and bait; it does not time natural potion decay.

## Evidence limits

There are no indexed player actions for Alry or the aerial fishing spot, so the boost
rule is Wiki evidence, not capture evidence. Exact aerial-fishing messages, animations,
graphics and interface packets have not been compared against a live recording.

Frenzied spots and moving-pool lifecycle are separate, unimplemented pool behaviour;
the available Wiki description supplies no spawn/depletion probabilities or lifecycle
capture, so they are not implemented here. The aerial-fishing page and Molch pearl page
also disagree on the revised pearl formula; this change preserves the existing formula
which follows the [Molch pearl page](https://oldschool.runescape.wiki/w/Molch_pearl).
