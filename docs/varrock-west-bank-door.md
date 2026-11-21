# Varrock West Bank's locked back door

The Door behind the Varrock West Bank counter (`fai_varrock_bank_locked_door`, loc 11788, at
3186,3446) has one option, Knock-at. It never opens.

From rsprox captures (rsprox.net rec 3213, rev 232, ticks 4464-5070: five knocks; rec 444, rev
233, tick 131: clicked, then the ladder beside it instead):

- The player walks to the door's west side (3185,3446) and turns to it.
- The player's chathead says "I don't think I'm ever going to be allowed in there." with
  `chatbored1` (seq 562), the same line on every knock.
- Continue: a message box "Knock knock..." (navy text) with no Continue and synth sound 1735.
  Two ticks later the Banker (`varrock_bank_doorguard`, NPC 8666, spawned behind the door at
  3187,3446) says "Who's there?" with `chatang1` (614).
- Continue: "What would you like to say?" with five answers. Each was picked once in rec 3213:

  | Answer | Exchange |
  | --- | --- |
  | I'm *name*. Please let me in. (`chathap1`) | Banker: "No. Staff only beyond this point. You can't come in here." (`chatang2`) |
  | Boo. (`chatshifty1`) | "Boo who?" (`chatquiz1`); "There's no need to cry!" (`chatlaugh1`); "What? I'm not... oh, just go away!" (`chatcon1`) |
  | Kanga. | "Kanga who?"; "No, 'kangaroo'."; "Stop messing about and go away!" (`chatang1`) |
  | Thank. | "Thank who?"; "You're welcome!"; "Stop it!" (`chatang1`) |
  | Doctor. | "Doctor wh.. hang on, I'm not falling for that one again! Go away." (`chatang2`) |

  The Banker's last Continue closes the chatbox. No message, animation or varbit is sent, and
  the door stays shut.
- Live also turns the Banker to face the player during the exchange and back south (1024)
  after it. tsps does not turn him yet, and he stands behind the closed door.

Handled in `server/plugins/areas/Misthalin.plugin.js` (`knockVarrockBankDoor`); tested in
`server/tests/varrock-bank-locked-door.test.cjs`.
