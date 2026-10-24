# Standard binding spells

Bind, Snare and Entangle declare base damage maxima0/2/5 and hold durations8/16/24
game ticks. Swampbark helm, body and legs add2 ticks each, to maxima14/22/30; gloves
and boots do not count. Paid casts snapshot this bonus so equipment changes during
flight cannot change a launched hold. The existing generic freeze service retains
its NPC immunity, movement interruption and five-tick grace period.

Already-held and freeze-immune targets are refused before rune payment or Tome of
Water charge consumption. A hold or immunity applied during projectile flight is
not refreshed at impact. Splashes and unrelated utility spells do not apply a bind.
Protect from Magic does not shorten the hold. Snare is free-to-play and consumes
four Water, four Earth and three Nature runes.

## Evidence

- [Bind](https://oldschool.runescape.wiki/w/Bind)
- [Snare](https://oldschool.runescape.wiki/w/Snare)
- [Entangle](https://oldschool.runescape.wiki/w/Entangle)
- [Protect from Magic](https://oldschool.runescape.wiki/w/Protect_from_Magic)

The current individual Snare page specifies max hit2. An older generic spell table
and pinned Wiki damage calculator specify3. This implementation follows the current
individual page and discloses the disagreement; it does not claim recording-exact
Snare damage. Exact fade-warning timing and the general PvP owner-distance escape
policy remain separate audits and are not changed by this patch.

The public rsps.app progress data marks normal DT2 encounters functional but retains
unverified balance values. Its Magic completion label is not evidence of exact spell
parity. This shared repair does not establish complete boss timing/RNG equivalence.

## Verification

Tests exercise real spell payment, cached equipment, PendingHit calculations,
delayed impact receipts and timer boundaries. They cover damage maxima, all four
Swampbark piece counts, gear changes and a later paid cast, held/immunity refusals
without rune or tome-charge loss, intervening effects, splashes, large NPC immunity
and player targets with Protect from Magic. Initial tests reproduced the missing
maxima, fractional/incorrect hold times and refusal behavior before implementation;
separate failing checks reproduced Snare's members flag and missing Water rune.

Native revision241 casts on an isolated world confirmed hold/immunity receipts of
8/13,16/21,24/29 ticks for the three ordinary spells and30/35 ticks for full-Swampbark
Entangle. Each matched its paid cast's captured duration. A subsequent cast on that
held target produced the refusal message without changing its caster's rune counts.
The QA account logged out cleanly and its server was stopped before full testing.
