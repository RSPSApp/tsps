# Oaknock's exchanger and replacement discs

The Eyes of Glouphrie's exchanger opens the cache's native interface 111 with
side inventory 185. Select a disc in the side inventory and press **Insert coin**;
up to three tokens totalling at most 35 points can be reserved. **Exchange** offers
up to four discs of equal total value and can be pressed again to reroll.
**Accept exchange** commits the trade. **Cancel exchange** clears the preview.

The [Wiki quest guide](https://oldschool.runescape.wiki/w/The_Eyes_of_Glouphrie)
describes equal-value exchanges and the 35-point limit. It also establishes that
Brimstail's random discs are neither circles nor red shapes, and that yellow circles
cannot be obtained. His two initial fixed discs are unchanged; the later three-disc
bundle and replacement bundles now draw from the 18 eligible shapes.

## Native interface

The active revision-242 cache supplies these bindings:

| Purpose | Cache binding |
| --- | --- |
| Exchanger | Interface 111 |
| Insert / Exchange / Cancel / Accept / Close | Children 14 / 13 / 15 / 17 / 20 |
| Three input previews | Inventory 438, children 4–6, script 3797 |
| Four output previews | Inventory 439, children 8–11, script 3798 |
| Carried disc selection | Interface 185, inventory 440, script 149 |
| Selected disc in the hand | Varp 856, script 3795 |

The previews reserve inventory slots and individual units, including repeated tokens
from a stack. Nothing leaves the inventory before acceptance. A changed or reduced
input stack invalidates payment. The complete result is planned in a separate inventory
before being committed, so insufficient space and overflowing stacks cannot lose inputs
or drop outputs. Closing or logging out discards the preview and leaves the inputs held.

The server chooses uniformly among valid unordered combinations of one to four output
discs for the input value, including equivalent shapes and unchanged offers. Combinations
are cached by value. This supplies random rerollable exchanges; the exact retail
combination probabilities and generation formula have not been established.

## Verification and remaining scope

`server/tests/remaining-goblin-glouphrie-parity.test.cjs` sends native IF_BUTTON1 bytes
through ClientConnection and the turn queue to the production quest plugin. It checks
preview/reroll/cancel, stacked reservations, the value cap, stale inputs, atomic payment,
full inventories, repeat acceptance and lifecycle cleanup. Brimstail's existing real
dialogue route also exercises replacement awards with controlled random draws.

`client/tests/native-quest-state-a.test.ts` runs the server's actual inventory and script
arguments through the real cache CS2 VM, checking the native selected disc and input/output
widgets. No game client or rendered scene was opened for this change.

The quest's fixed lock/control-panel values, retained unlocking disc and existing cutscene
approximations remain separate work; this change does not assert full quest parity.
