# Varrock Museum: Historian Minas's reports

Historian Minas pays Kudos for completed quests. Choose "I have some information which might be
of use in your displays." and he hears every unreported quest in one conversation: 5 Kudos each,
10 for Curse of the Empty Lord, and an antique lamp for five of them.

- Code: `server/plugins/world/Museum.plugin.js` (the dig site and display cases are there too;
  the basement quiz is [natural-history-quiz.md](natural-history-quiz.md)).
- Words: Minas's transcript in `npc-dialogues.json`, from osrsreboxed-db. Its report lines follow
  the captures through that repo's `capture-sources.json` (RSPSApp/osrsreboxed-db#72).
- Test: `server/tests/qh728-museum.test.cjs`.

## From rsprox captures

rsprox.net recordings 3278 (rev 234, Grid Master) and 1757 (rev 227, Leagues V) report most
quests in one conversation each; 1843 (rev 227, Leagues V) has Curse of the Empty Lord. Dialogue
and Kudos agree across the three and with the Wiki's Kudos page.

- **Narration boxes:** Temple of Ikov's "You describe the staff in detail…", Curse of the Empty
  Lord's "You recount the tale…", Hazeel Cult's "The historian pulls out his writing implements…"
  and What Lies Below's two are message boxes (`messagebox`, 229).
- **When a report pays:** the display varbit, then `vm_kudos`, the spam message "You have earned
  Kudos with the Museum!" and sound 3653, on one tick:
  - with a lamp, once the player continues past Minas's "You're welcome!"; the game message and
    the message box "You receive an old lamp." follow, then the next report;
  - otherwise just before Minas's closing display line shows (after Hazeel Cult's and Ikov's
    boxes, straight after Demon Slayer's player line).
- **Every Kudos rise** (reports, dig site display cases, the quiz, salvaging finds in 960) has the
  same spam message and sound 3653.
- **Display varbits** (varp 1011):

  | Report | Varbit |
  | --- | --- |
  | Demon Slayer | `vm_silverlight` 3653 = 1 |
  | Shield of Arrav | `vm_soa` 3656 = 1, `vm_soa_vis` 9679 = 1 |
  | Rune Mysteries | `vm_runes` 3661 = 1 |
  | Merlin's Crystal | `vm_excalibur` 3655 = 1 |
  | The Grand Tree | `vm_glider` 3658 = 1 |
  | Priest in Peril | `vm_salveknights` 3651 = 1 |
  | In Aid of the Myreque | `vm_salveknights` 3651 = 2 |
  | A Tail of Two Cats | `vm_robert` 3657 = 1 |
  | Making History | `vm_lathas` 3654 = 1 |
  | Temple of Ikov | `vm_staff_of_armadyl` 3650 = 1 |
  | Curse of the Empty Lord | `vm_staff_of_armadyl` 3650 = 2 |
  | Hazeel Cult | `vm_ardy` 3659 = 1 |
  | Defender of Varrock | `vm_dov` 9678 = 1 |

  Not captured: Observatory Quest and What Lies Below. The cache names `vm_observatory` (3652) and
  `vm_surok` (3660), whose display cases (locs 24642, 24662) show the display at 1.
- **Report order:** live plays them as Ikov, Shield of Arrav, Merlin's Crystal, Demon Slayer, The
  Grand Tree, A Tail of Two Cats, Making History, Priest in Peril, In Aid of the Myreque, Hazeel
  Cult, What Lies Below, Rune Mysteries, Defender of Varrock. The transcript keeps the Wiki's order
  (Observatory Quest's place is not captured).

- **Curse of the Empty Lord** (1843): after "You're welcome!" live sent `vm_staff_of_armadyl`
  1 -> 2 and +10 Kudos only: no lamp, no lamp line and no box, and the player was not carrying
  one. The Wiki's Kudos page gives this report a 10,000 XP lamp; we hand it out (silently, as
  the transcript has no lamp line). Whether live skips it once claimed is not captured.

## Ours

- A shared varbit shows the highest value any reported quest gives it, whatever the order.
- A full bag on a lamp report says "You need at least 1 free inventory space to receive the
  lamp." and ends the conversation there; the report stays open for the next talk.
- A player still holding a report's lamp gets no second one and no lamp line.

# Curator Haig Halen: Sailing salvaging relics

Code: `server/plugins/world/museum/SalvagingRelics.Museum.js`; test:
`server/tests/salvaging-relics.test.cjs`.

## From rsprox captures (revision 235: 908, 958, 960, 968, 3848, 3911, 4292)

- **Inspect** (op3) on the compass, mirror, coin and doll opens objectbox (193) with the relic
  at zoom 400, the examine sentence then "You get the feeling that an item this old belongs in a
  museum." with live's line breaks (the chatbox layout reproduces all four), and the same text as
  a `mesbox` chat line.
- **Hand-in** (the relic used on `curator`, 960 and 3848): the player's "I found a strange relic
  while salvaging...", an objectbox with the relic "You show the <relic> to Curator Haig Halen.",
  Haig's offer, then `chatbox_multi_init` "Trade the <relic> in for a lamp?" "Yes.|No." The
  mirror's prompt names the mirror (the Wiki transcript says "broken compass" there).
- On "Yes.", one tick: `salvaging_rare_<relic>_claimed` 0 -> 1 (a bit of
  `salvaging_rare_all_claimed`, varp 5208 bits 0-7), `vm_kudos` +1, the Kudos spam line, the
  objectbox (the relic) "You hand Curator Haig Halen the <relic> and he gives you the promised
  lamp in return.", the relic out and the lamp into the first free slot, sound 3653. Then the
  inscription line and "Anyway, thank you for bringing it to us...".
- Lamps: mirror and doll the large lamp, coin and compass the medium one.

## From the Wiki (Transcript:Curator Haig Halen, Antique lamp (salvaging))

- The inscriptions of the locket, mouldy block, dull knife and sextant, the repeat offer (5,000
  coins, "The museum thanks you for your generosity.") and "No." ("Actually, I think I'll keep
  it." / "Oh... very well.").
- Lamps: small (5,000 xp, level 30) for the locket, block and knife; medium (10,000 xp, level 40)
  for the compass, coin and sextant; large (15,000 xp, level 50) for the mirror and doll. A lamp
  only for the first of each relic; 1 Kudos each.
- Talk-to offers "I found a strange relic while salvaging..." only while a relic is carried.

## Ours

- With several relics carried, Talk-to shows the first in item order.
- The repeat hand-in's box shows the relic, as the first-time one does (not captured).
- A relic gone from the inventory by the time "Yes." is picked ends the conversation unpaid.
- Not played: the lines after all eight are handed in (their trigger is not documented).
