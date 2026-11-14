# Meiyerditch tatty note

A lore note from Sins of the Father, found by the skeleton (loc 38091, `blood_altar_skeleton`) at
3551, 9778 in the north of the Meiyerditch Laboratories, by the ruins to the true Blood Altar.
Plugin: `server/plugins/items/MeiyerditchTattyNote.plugin.js`.

## From rsprox captures (rsprox.net rec 395, rev 231)

- **Search** (tick 23976): the player faces the skeleton on arrival; two ticks later the note
  (obj 24684, `blood_altar_note`) goes into the backpack and an objectbox shows it (zoom 400) with
  "You find a note by the skeleton which you take." No animation or sound.
- **Search again** with the note in the backpack (tick 24049): the game message
  "You search the skeleton, but find nothing of interest." and nothing else.
- **Read** (tick 24079): the long scroll (625) opens through `longscroll_setup` (script 418) with
  an empty title and the note's text, paragraphs split by `<br><br>`. No animation or sound.
  It closes from its close button (tick 24388).

## Wiki

"Tatty note (Sins of the Father)": a quest item searched from the skeleton near the ruins to the
true Blood Altar; examine "A tatty note found beneath Meiyerditch."

## Ours

- A full backpack refuses with "You don't have enough inventory space."
- Only a note in the backpack counts as held: a banked or dropped one doesn't stop another being
  found. Neither source says.
- The note and its objectbox come on the interaction tick. In rec 395 they came one tick after the
  face (the player had walked a tile that tick), while the repeat search's message came with the
  face. One attempt doesn't show whether that is a delay on the find or walk-arrival timing.
