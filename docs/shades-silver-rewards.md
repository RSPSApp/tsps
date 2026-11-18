# Silver Shade Catacombs chest rewards

This repair restores the silver chest reward set and documented conditions.
**It does not claim exact unconditional OSRS probabilities.** The published
rates do not form a consistent mutually exclusive distribution.

## Evidence and known uncertainty

Checked 2026-11-17 against the OSRS Wiki pages for
[red](https://oldschool.runescape.wiki/w/Silver_Chest_%28red%29),
[brown](https://oldschool.runescape.wiki/w/Silver_Chest_%28brown%29),
[crimson](https://oldschool.runescape.wiki/w/Silver_Chest_%28crimson%29),
[black](https://oldschool.runescape.wiki/w/Silver_Chest_%28black%29), and
[purple](https://oldschool.runescape.wiki/w/Silver_Chest_%28purple%29).

The red main rows total weight 152 with the published denominator 152.39:
99.7441%. Add the separately listed locks (1/63) and the two book-or-scroll
outcomes (2/154.45, not four outcomes), and the total is 102.6263%.
The other four colours have the same approximately 2.62 percentage-point
excess. This is too large to be explained by denominator rounding.

The page says the scroll gate is tried only after the previous gate fails.
It lists a conditional scroll chance of 1/76, and a 1/63 locks chance.
Those two gates imply a main-table reach probability of
(62/63)*(75/76). The implied underlying main weight from the listed
denominator would be approximately 148, while the visible weights total 152.
No item is silently removed to force this discrepancy to disappear.

### Explicit provisional model

- Roll silver locks first: 1/(63-colourIndex-wealthBonus).
- On failure, roll the two-outcome scroll gate:
  1/(76-colourIndex-wealthBonus), then a fair swamp/blood choice.
- On failure, draw from the complete main table with its **actual sum of
  weights**, rather than the inconsistent published unconditional denominator.
- colourIndex is red=0, brown=1, crimson=2, black=3, purple=4.
- wealthBonus is 2 when a Ring of Wealth (charged, uncharged or imbued) is worn.
- Main fine-cloth weight is 16+quality; log weights are
  3*(5-quality)/5 and 2*(5-quality)/5.
  quality=min(4,colourIndex+wealthBonus).
  This preserves the visible colour progression and the two-colour wealth
  shift in the logs. Some fine-cloth wealth footnotes also disagree; the
  capped two-colour rule is a declared approximation, not hidden precision.
- If the shared clue-capacity service refuses another hard clue, remove the
  clue row before normalization. If eligible, resolve through the shared
  clue-item service so unlocked scroll boxes are respected.

For example, ordinary red silver chest fine cloth in this model is
(62/63)*(75/76)*(16/152) = about 10.223%, versus the published 10.5007%.
The code intentionally calls these *relative weights*. A future verified
Jagex mechanic/capture or corrected source table can replace this model.

## Restored behaviour

All 32 silver main items are reachable, including fine cloth, the full Amulet
of the Damned, missing weapons/armour, and 5-10 noted yew/magic logs.
Coins use the unnoted main item's value, following the
[minigame coin formula](https://oldschool.runescape.wiki/w/Shades_of_Mort%27ton_%28minigame%29#Coin_amounts).

The first swamp/blood outcome gives its book; after a successful receipt it
gives the corresponding runescroll. Existing inventory/bank books are
recognized. Receipt is persisted only after the whole chest fits and opens.
Reading each first book yields its scroll once without consuming the book;
full inventories and stale Read actions do not consume that entitlement.
Book narrative UI and subsequent scroll-reading/crafting unlocks are outside
this chest-reward repair.

A Flamtaer bag replaces swamp paste on a 1/2 roll only if no real bag is held
in inventory, equipment or any bank tab. Zero-quantity placeholders are ignored.
Otherwise paste is 25-40. All rewards fit before a key is consumed.
Collection-log events use the unnoted reward IDs.

Scope: **silver chests only**. Other metal tiers retain their existing reward
tables and secondary rolls. No Voidburn XP, temple-repair or drop-rate
customizations are included.

## Verification

Build the server, then run tests/shades-of-mortton.test.cjs through run-with-env.

The deterministic tests cover every main row in all five colours, gate
boundaries with/without wealth, clue-capacity/box resolution, bag ownership,
book receipt/read-once/full-inventory behaviour, matching keys, noted delivery
and coin valuation. Existing bronze/chest/pyre/zealot tests remain in the run.
