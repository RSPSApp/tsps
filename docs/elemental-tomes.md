# Elemental tomes

Fire, Water and Earth tomes store their charges on each item. Twenty charges are
added per page, up to 20,000. Inventory and worn Check/Pages operations and page-on-tome
interactions are supported. Removing pages returns only whole remaining pages;
the partially used page is consumed. Burnt and searing pages cannot be mixed.

Bank Configure-Charges saves a persistent target. Withdrawing a tome tops it up
using matching pages in the bank. Configuration itself spends nothing; zero
disables automatic charging. Existing charges are never reduced to the target.

Equipped charged tomes supply their elemental rune to any spell. Matching standard
Strike/Bolt/Blast/Wave/Surge spells spend one charge per paid cast, including splashes.
Water also spends charges on the six stat curses and Bind/Snare/Entangle, excluding
Tele Block. Unrelated spells get the rune supply without spending charges.

Matching NPC damage increases by 10%. PvP increases are Fire50%, Water20%, Earth10%.
Water damaging accuracy increases by 10% against NPCs and20% against players;
its supported curses gain20% accuracy. Water-enhanced stat curses use7% or15%
reductions. Searing pages set the damage-roll minimum to10% of the pre-tome maximum.
The tome damage multiplier follows equipment and elemental weakness calculations.

Paid cast contexts preserve the final charge's bonuses through hit calculation and
delayed utility impact. Previews and later casts cannot spend or borrow that state.
Bank withdrawals retain independent item metadata, including search withdrawals
where identical item IDs have different charge states.

## Primary references and limits

- [Tome of Fire](https://oldschool.runescape.wiki/w/Tome_of_Fire)
- [Tome of Water](https://oldschool.runescape.wiki/w/Tome_of_Water)
- [Tome of Earth](https://oldschool.runescape.wiki/w/Tome_of_Earth)
- [Configure-Charges](https://oldschool.runescape.wiki/w/Configure-Charges)
- [Original Charges QoL update](https://oldschool.runescape.wiki/w/Update:Game_Jam:_Charges_QoL)
- [Original Wiki damage calculator](https://github.com/weirdgloop/osrs-dps-calc/tree/d50c49c589793dc2ee691592015ba63ff9c49fab)

Current Wiki pages explicitly give damaging Water accuracy as10% against NPCs;
the pinned calculator has20% with an ordering TODO. This implementation follows
the current written rule and does not claim recording-exact accuracy ordering.

Four ordinary RSProx recordings (1702,3236,3170,3085) were decoded using the official
decoder. Relevant bank snapshots establish possession only; none contains a selected
tome charge operation. Exact cosmetic dialogue wording is therefore unverified.
Bank top-ups provisionally round the missing target charges up to whole pages,
bounded by available pages and whole-page capacity. A partial page is preserved;
if fewer than20 slots remain below capacity it is not topped beyond20,000.

Binding spell base-damage discrepancies, global Hofuthand configuration and exact
boss encounter timing/RNG are separate work; this feature does not establish their parity.

## Native verification

An isolated revision241 world was exercised using native item-use, amount-entry,
equipment, spell-cast, bank-widget and logout/login packets. Burnt Fire, searing
Fire, Water and Earth each accepted two pages, changed40 charges to39 on a paid
Wave cast, and retained their independent page kind after relogging. Both Fire
page kinds remained normal charged item20714 with usable Check/Pages controls.
An Earth bank target of59 charged its withdrawn39-charge tome from one banked
soiled page; the saved account retained both that target and all four tome states.

Focused verification covers104 combined checks, including actual cache item
actions, per-item serialization, all15 matching spell payments, all9 Water curse
payments, splashes, last charges, delayed impacts, lower damage bounds and bank
search conservation. Scoped and whole-branch reviews were independently performed.
