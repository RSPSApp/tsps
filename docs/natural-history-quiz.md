# Natural history quiz

The Varrock Museum basement quiz: Orlando Smith asks the player to check the 14 display
plaques, three questions each, for 2 Kudos per case and 1000 Slayer and Hunter XP at the end.

- Code: `server/plugins/world/museum/NaturalHistoryQuiz.Museum.js`, attached by
  `server/plugins/world/Museum.plugin.js` (Kudos arrive through `museum:award-kudos`).
- Data: `server/plugins/world/data/natural-history-quiz.json` (each case's title, number,
  plaque, progress varbit, models and its three questions with the right answer).
- Orlando's words: his transcript in `npc-dialogues.json`, picked by variant.
- Test: `server/tests/natural-history-quiz.test.cjs`.

## From rsprox captures

Recording 1723 (rev 227, a Leagues V world) has the whole quiz: Orlando's introduction, all
42 questions answered right, and the reward.

- **Agreeing:** Orlando's "Sure thing." option sets `vm_nathis_agreed` (3671).
- **Study (op1) on a plaque** (`vm_plaque_*`, locs 24605-24618): player sequence
  `vm_display_case_ponder`. Interface `vm_natural_history` (533) is then filled: title
  (`vm_nathis_text`), case number (`vm_nathis_display_num`), the case's model component(s)
  (`if_setmodel`), question and three answers. `vm_nathis_quiz_text` is shown and the
  interface opens as the main modal.
- **Questions** are fixed per case and asked in order. The right answer is in a different
  button for different questions.
- **A right answer:** sound 3648 and the case's `vm_nathis_*_display` varbit (3672-3685)
  goes up by one, 0-3. The quiz closes and Orlando (`vm_nathis_apprentice` 6001, `chathap1`)
  says "Nice job, mate. That looks about right.". Continuing reopens the case on its next
  question.
- **The third right answer:** also +2 `vm_kudos`, sound 3653 and "You have earned Kudos with
  the Museum!". Orlando adds "Bonza, mate! I think that's all of them." and the chat
  closes. This is the same on the last case: the Wiki's longer last-case lines were not
  sent.
- **All 14 cases:** the case varbits are 2-bit fields in varp 1012. Full, they read
  `vm_nathis_display_alldone` = 2^28 - 1.
- **Hand-in:** after Orlando's "Right, I'll have a chat to me boss over there and let him
  know you've helped me out.", `vm_nathis_reward_given` (3688) is set, with "You have
  gained 1000xp in Slayer and Hunter." (The capture shows 8000 XP because of the Leagues
  multiplier.) The level-up messages only follow the player's closing "Goodbye.".
  Here a level-up pop-up opened in the middle of a chat replaces it, so the XP is given
  once the conversation is over. It is saved as owed until then, so a logout in between
  gives it on the next login.

## From the OSRS Wiki (Natural history quiz)

Not in the capture:

- Before agreeing, a plaque gives "This looks like some sort of quiz. I wonder if I can
  take part...".
- A wrong answer gets Orlando's "Hmm, I don't think that's right, mate. Try again.". The
  same question then shows again (assumed: the Wiki says there is no penalty).
- A finished case's plaque shows the display without the quiz.

## Besides the quiz

- Quiz models use the native `IF_SETROTATESPEED` packet. rsprox 1723 sends it for
  `vm_natural_history` (533) components 2, 3, 7-12 and 17-20 with `xSpeed=0`, `ySpeed=5`
  each time a case opens; components 4-6 (dragon) and 13-16 (seaslugs) got no rotate
  packet in the capture, so they stay still rather than being spun by guess.
- The `vm_kudos` HUD (532) is mounted in `toplevel:overlay_hud` while a player is inside the
  museum, and right-clicking the Information booth's "Check Kudos" opens the cache's
  `vm_kudos_info` list (600).
- Study on the Digsite (528) and timeline (534) display cases shows the case's world model,
  display number and Wiki description (`server/plugins/world/data/museum-displays.json`).
  Where the same object id changes text after a Historian Minas report, the entry carries
  Wiki `variants` keyed by the saved report (and Hazeel Cult's side): case 7 after Hazeel
  Cult with Hazeel, case 16 after Curse of the Empty Lord, case 17 after Observatory Quest,
  case 23 after In Aid of the Myreque and case 28 after Temple of Ikov.
