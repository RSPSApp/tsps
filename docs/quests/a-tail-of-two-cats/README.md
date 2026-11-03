---
quest: A Tail of Two Cats
key: a_tail_of_two_cats
status: in-progress
tested: 2026-11-03
tester: agent
model: DeepSeek V4.1 Flash
commit: e21c6b5f1
cache: osrs-241_2026-10-20
start: fresh
travel: not run
---

# A Tail of Two Cats

Source/cache and Quest Helper audit. **No usable capture exists in the RSProx archive**: the
three recordings that mention the quest's varbit contain no quest start/completion message,
and no recording contains the quest's own NPCs. A full native route was not replayed.

## Findings

- **checked** The durable-to-wire map is explicit and matches the helper: 1→5 (Hild), 2→15
  (catspeak amulet), 3→20 (Gertrude), 4→25 (Reldo), 5→30 (Bob), 6→35 (Sphinx), 10→40
  (chores), 20→45 (Unferth ill), 30→50 (Apothecary), 40→55 (cure), 50→60 (Bob back), 60→65
  (finish), 70→70. Every value resolved a helper step and the returned step matched the plugin's
  stage meaning; cache DB row 142 completes at **70** and the completion stage is 70.
- **checked** The five chore sub-varbits (`twocats_chores_*` 1029-1033) and the Bob/Neite
  visibility bits (6144, 6145) are re-sent from `player:bootstrap-complete`, so the cache
  object/NPC transforms survive the login bootstrap.
- **accepted difference** Bob is a static spawn at Unferth's house and cannot wander; the
  catspeak amulet(e) locate interface is not modelled, so the amulet only gates the
  cat-speech branches. The plugin header records this.
- **accepted difference** The potato patch grows in 20 minutes here (Wiki: 15-35) and the
  "skip cutscene and view summary" option plays the post-hypnosis tail because the transcript
  has no text for it. Both documented in the plugin header.
- **unchecked** No capture means the exact start/completion text, the Sphinx cutscene, the
  hat switch/destroy recovery, the present contents and jingle are not verified live.

## Capture-search note

Varbit 1028 returns three submissions (3274 revision 234, 1710 revision 227, 1149 revision
237) but those are login writes of varp 568; none of the three decoded files contains any
`started a new quest` message at all, let alone this quest's. Submission **3219** (revision
232) has two text hits for the name and no start/completion line
(`rsprox-3219.bin` SHA-256
`62F8098DDBDB06A6DECF4951D279F584C928953E1D6BB7C5A73CCCBA85AAB4DA`). NPC 8034 (Bob) returns
**0**, and the `twocats_chores_*` hits all resolve to the same login varp write.

## Runs

### 2026-11-03 — source/cache/helper audit

- **Start:** none played. A fixture account was moved through every durable stage with
  `::quest` to compare the wire value and the helper step; it is not a playthrough.
- **Wire:** varbit 1028 `twocats_quest` in varp 568 bits 0-6; cache DB row 142 completes at
  **70**. Wire values listed above; all are helper keys.
- **Rewards (source):** 2 Quest Points, a Doctor's or Nurse hat, and a present containing two
  antique lamps (2,500 XP each, skills 30+) and a mouse toy; the plugin matches the Wiki.
  Not observed live; the 5 Kudos are not modelled.
- **Not checked:** the whole route (Unferth, Hild, amulet enchant, Bob, Gertrude, Reldo,
  Sphinx/Neite, five chores, Apothecary disguise and cure, Bob's return), cutscenes, hat
  recovery, full-bag present, repeat/relog, post-quest dialogue, visuals and jingle.
