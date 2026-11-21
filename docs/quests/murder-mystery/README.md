---
quest: Murder Mystery
key: murder_mystery
status: passed
tested: 2026-11-22
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: manual
---

# Murder Mystery

Aligned with four whole runs of the quest on live: the user's RSProx capture `MurderMystery.bin`
(revision 242, SHA-256 `ac4e418a...3bff81`, Frank the murderer; every accusation, every interview and
every clue, the hand-in at tick 2248 and the post-quest lines), and the local recordings 1001551
(revision 241) and 1001958 (revision 242), David the murderer, and 1001930 (revision 242), Carol the
murderer. Ticks below are `MurderMystery.bin`'s unless a recording is named.

The plugin is `server/plugins/quests/quests/MurderMystery.Quest.js` with its units in
`server/plugins/quests/murdermystery/` (State, Journal, Evidence, Poison). The words are the Wiki's: the
"Murder Mystery" transcript, with the lines it lacks added from these captures in osrsreboxed-db's
`capture-sources.json`, and the Pierre page after the quest. Where the capture words or plays a line
differently, the Wiki's is kept (see "Recorded differences").

Checked by `server/tests/murder-mystery-capture.test.cjs` (real Player, packets, plugins, cache and map)
and in game over the agent MCP: the whole quest with Anna the murderer, a relog in the middle, the
hand-in and the post-quest lines.

## State

| Varp | Values (tick) |
| --- | --- |
| 192 murderquest | 0 -> 1 on "Yes." (72), 1 -> 2 at the hand-in (2248); nothing in between |
| 195 murdersus | the murderer from the start, 1 Anna ... 6 Frank (72: 6; 1001958 t1359 and 1001551 t10056: 4; 1001930 t1592: 3); 0 at the hand-in |

The murderer is random (the Wiki; four runs, three murderers). The rest is server-side: the thread and
fingerprint evidence, the salesman having named the buyers, each Sinclair's poison story, the poison
proof. The criminal's thread is the murderer's colour: blue `murderthreadb` 1810 for Frank (t929),
green 1809 for David (1001958), red 1808 for Carol (1001930); the Wiki gives Elizabeth blue, Bob red.

## Messages

Every message of the quest's conversations is a messagebox (`mesbox`), as the Wiki's `{{tbox}}` lines
are; its `{{mes}}` lines are chat messages (`gamemessage`): before the start, the flour and flypaper
lines, the plain investigations, the "I already have" lines, "You take the thread.", "You leave the
paper in the sack." and the print matches (`State.MESSAGE_STEPS`, `MESSAGE_VARIANT`).

## The guard

- Start (56-74): "What's going on here?", the guard's two lines, "Start the Murder Mystery quest?"
  Yes. / No.
- Accusing someone (233-560): after "It was one of the women/men" the guard asks "Oh really? Which
  one?" again; each name gets the box "You tell the guard who you suspect of the crime." before
  "Great work.".
- With the thread alone, "I know who did it!" goes straight to "I have proof that it wasn't any of the
  servants!", with the box "You show the guard the thread you found on the window." before "All the
  servants dress in black..." (1074-1078, 1367-1371; the Wiki's note on one piece of evidence).
- All the evidence (2232-2248): the Wiki's case, its "hold her here ... bring her to trial" for every
  murderer (see "Recorded differences"). The proof is checked again
  at "You hand over all the evidence."; live takes everything the player carries as that box is
  continued (2247: the dagger, thread, pungent pot, Frank's pot, Frank's print and the killer's
  print), then 3 Quest points, 1,406 Crafting XP and 2,000 coins in one stack (2248). The scroll's
  title is "You have solved the Murder Mystery!" with the murder weapon at zoom 400 placed at (78, 128)
  (the shared scroll now does this for every quest, as 49 rev 242 recordings do), and the jingle
  "quest complete 2" (153).
- After the quest the house guard (6194) says "No, your work here is done." (2299); the courtyard
  guard (4218) "Seems awfully quiet up at the house..." / "Nothing right now, we have it all under
  control." (2384-2385).

## The crime scene

| What | Live (tick) |
| --- | --- |
| Window, Investigate | the box, then on its continue "You take the thread." and the thread (928-929); again: the box and "You have already taken the thread." (Wiki); lost: "Lucky for you..." and the thread |
| Window, Break | "You don't want to damage evidence!" (951) |
| Pungent pot, dagger (Take, the study's fixed spawns) | the box and the item the same tick, no reach, no sound, the player facing the item; the ground item stays (1048, 1050: no `obj_del`); again "I already have the murder weapon." (1053) |
| A suspect's barrel | the box, the silver belonging on its continue (1468-1469); again "I already have ..." |
| Sacks | the box, the menu; Yes: the flypaper with "You take a piece of fly paper..." (1645-1646); No: "You leave the paper in the sack." (1420) |
| Sturdy wooden gate | the dog's box during and after the quest (913, 2355) |
| Flour on evidence | the dusted item into the lower of the two slots, the empty pot into the higher (1562, 1580; 1001958 t1660, the flour in the higher slot) |
| Flypaper on dusted evidence | the flypaper and the dusted item go, then the clean item and the print into the first free slots (1566, 1649) |
| A print that doesn't match | its box; the print is destroyed on its continue (1666-1668) |
| The match | "The finger prints are an exact match to Frank's."; the unknown print becomes the killer's in its slot, the suspect's print stays (1715) |

## Questioning

- "Do you recognise this thread?" is offered only while the player holds the thread: Bob's menu has
  two options before it is found (575). The Wiki notes Frank asks it regardless.
- On the blue thread Elizabeth says "Looks like Blue thread to me..." and the player "It looks a lot
  like the material your trousers are made of doesn't it?" (1331-1333); Frank "It kind of looks like
  the same material as my trousers are made of..." (1036).
- Gossip's "I am so confused" hint is one of three: the Wiki's poison salesman line and the two the
  capture plays (819, 826).

## The poison

- The salesman's intro and menu; once he has named the buyers ("Who did you sell Poison to at the
  house?") he goes straight to his menu (1895, 1904). With The Fremennik Trials under way he first
  asks which quest; "Talk about the Fremennik Trials" is that quest's own talk (1842-1857).
- Everyone gets the poison question once he has named them; a Sinclair's story is told when their
  answer ends. A place then reads as the Wiki's "after questioning the Sinclairs": the murderer's spot
  shows no poison and is the poison proof (2209-2219: the crest; 1001930 t2233: the drain; 1001958
  t2041: the spiders' nest). Before that it reads as at the start (958: the crest; 966: the drain).
- The drain is a ground loc outside the kitchen, stood on from the path (965-966).

## Journal (946, 1159, 1732, 1920, 2041)

The struck story of the murder, the guard's request in blue with its key words red, an empty line,
then fixed lines for the coloured thread, the murder weapon and the strange smelling pot; one not yet
earned is sent empty (946).

## After the quest

- The barrels, sacks and poison places ask for the guards' permission, as before the quest (the Wiki:
  the crest says so, the belongings "cannot be obtained again"); the gate keeps the dog's box (2355).
- The evidence goes from the bank too (the Wiki's silver necklace "will disappear if a player has it in
  their bank or inventory upon finishing the quest").

## Recorded differences

- The house arrest line: the Wiki's "hold her here ... bring her to trial" is kept for every murderer;
  the captures say "him" for a son (2245; 1001551 t10769, 1001958 t2138) and "her" for Carol (1001930
  t2373).
- The capture plays "Hobbes the butler. The butler ALWAYS did it." as "The butler did it!" with the
  guard's "I hope you have proof..." (334-339); the Wiki gives it "Great work." like the other names,
  which is kept.

## Not covered

- Ours: a clue line in the journal shows while the item is carried; the completed journal (not
  captured) strikes the entry and adds QUEST COMPLETE!.
- Ours: the guard takes the evidence at the completion step, one line after live (2247 vs 2248), so a
  chat closed on "Please accept this reward from the family!" keeps both the evidence and the quest open.
- Ours: the Wiki's bank removal is applied to every evidence item, its "permission" line to every
  place and to the sacks.
- Ours: a dagger or pot dropped elsewhere, and a criminal's thread outside the quest (King's Ransom's),
  are taken as any item.
- Ours: what does not fit a full inventory (the barrel's belonging, the flypaper) goes on the floor,
  as the Wiki says of the thread; flour on the pungent pot keeps the flour.
- Ours: a place reads "after questioning" once that suspect has told their own story; before the
  quest the places read as at its start and the drain asks for the guards' permission.
- Missing from the Wiki and the captures: Anna's and David's answers on the green thread, and the
  guard's poison-proof telling for Anna, Elizabeth and Frank (`{{tmissing}}`).
- The mansion's drawers, bookcases and dairy churn and King's Ransom's scrap paper and address form
  (clicked in the capture) are not part of this quest.

## Runs

### 2026-11-22 · agent · claude-opus-5-5

- **Start:** fresh account, quest started at the courtyard guard; Anna the murderer.
- **Result:** varp 192 = 2, 195 = 0; 3 QP, 2,000 coins; the evidence taken, the pots kept.
- **Checked:** the crime scene, barrels, sacks, flour, flypaper and prints, the salesman, Anna's story
  and the compost heap, a relog mid-quest (varps 192/195 and the evidence restored), the hand-in,
  the house guard's, the courtyard guard's and Pierre's post-quest lines.

### 2026-10-25 · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q080); Anna route only.
- **Result:** varp 192 = 2; QP +3, Crafting +1,406 XP, coins +2,000; evidence consumed.
- **PRs:** [#1146](https://github.com/RSPSApp/tsps/pull/1146).
