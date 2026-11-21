# Varrock West Bank's locked back door

The Door behind the Varrock West Bank counter (`fai_varrock_bank_locked_door`, loc 11788, at
3186,3446) has one option, Knock-at. It never opens.

From rsprox captures (rsprox.net rec 3213, rev 232, ticks 4464-5070: five knocks; rec 444, rev
233, tick 131: clicked, then the ladder beside it instead):

- The player walks to the door's west side (3185,3446) and turns to it.
- The player's chathead says "I don't think I'm ever going to be allowed in there." with
  `chatbored1` (seq 562), the same line on every knock. Nothing else is sent: no message, sound,
  animation or varbit.

Handled in `server/plugins/areas/Misthalin.plugin.js` (`knockVarrockBankDoor`); tested in
`server/tests/varrock-bank-locked-door.test.cjs`.
