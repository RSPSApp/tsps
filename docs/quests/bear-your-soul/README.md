---
quest: Bear Your Soul
key: bear_your_soul
status: in-progress
tested: 2026-10-31
tester: agent
model: DeepSeek V4.1 Flash
commit:
cache: osrs-241_2026-10-20
start: stage 1 via ::quest; diagnostic teleports
travel: ::tele (not a natural travel run)
---

# Bear Your Soul

Source-reviewed, covered by a focused plugin test
(`server/tests/bear-your-soul.test.cjs`), and checked interactively through the
headless agent MCP. No natural start-to-finish playthrough (walking between the
library, Soul Altar, crypt and Taverley) has been done.

## What is implemented

- The four cache progression values in varbit **5078**
  (`arceuus_soulbearer_story`, varp **695**, bits 30-31): 0 unread, 1 book read,
  2 sent to the crypt/repair, 3 complete. Quest Helper's
  `QuestVarbits.QUEST_BEAR_YOUR_SOUL` points at the same varbit, and its
  `loadSteps()` keys are 0 (find/read), 1 (Aretha) and 2 (dig/repair).
- The Journey of Souls from an Arceuus Library bookshelf, the `Read` option and
  the book interface text.
- Aretha's transcript conditions, including the damaged-bearer reminder absent
  from the generated dialogue dump.
- Spade digging in the Arceuus church crypt and the damaged-bearer recovery loop.
- The Key Master's `during-bear-your-soul` conversation, item swap and
  completion scroll.

## Findings

- **fixed** Completion used the generic quest scroll/jingle/chat line. Live only
  sends sound 1595 and the repair item box, so the repair now calls
  `quest.complete(player, { scroll: false, announce: false })`.
- **fixed** The shelf search used an invented chat message. It now plays
  `human_pickuptable` (832) and shows item box 19637 on the next tick with the
  live "You find:" text.
- **fixed** Reading advanced the stage and sent a chat message as the book
  opened. It now plays `human_readbook` (1350), advances 0 -> 1 and shows item
  box 19637 only when the book is closed.
- **fixed** The book had 8 uncoloured spreads. It now has the live 9 spreads
  (pages 1-18), with `<col=7f0000>` headings and the Wiki/capture pagination.
- **fixed** Digging sent a chat line. It now plays `human_dig` (830), sound 1470
  and item box 19636 ("You have found the soul bearer.").
- **fixed** Aretha's directions branch was only offered at stage 1. It is now
  also offered at stage 2 until the bearer is dug up, and the stage changes 1 ->
  2 on the "Now, we buried the artefact..." line rather than on "Yes please.".
- **fixed** Full inventory now uses the server's standard
  "Not enough space in your inventory." message.
- **approximation** OSRS pins the book to one random Arceuus Library shelf. The
  server has no library-shelf rotation, so any shelf in the library finds it
  while it is unread.
- **approximation** Digging is scoped to the crypt area rather than a single
  tile, matching the Wiki's "dig anywhere" wording.
- **not checked live** Taverley Dungeon and Cerberus' Lair access are provided by
  existing world content, not this plugin.
- **out of scope** The reward's Fill/charge/Uncharge actions are not implemented
  by this miniquest change; only the reward item is granted.

## Runs

### 2026-10-31 - capture 1702 review fixes (source, focused test, live handlers)

Recording 1702 (revision 226) was used as the live reference. The stage order
(0 -> 1 on book close, 1 -> 2 during Aretha, 2 -> 3 at the repair) and the
Aretha/Key Master words matched. The book pagination and heading colours were
taken from the Wiki's live interface screenshots for pages 1-18.

A live handler run on slot 25 confirmed the corrected behaviour:

- Bookshelf `Search` showed item box 19637 with `You find: / The Journey of
  Souls, by Aretha. / You take a copy.`; the quest stayed at stage 0.
- `Read` stayed at stage 0 while the book was open; closing it moved to stage 1
  and showed item box 19637 with the artefact hint.
- Aretha's dialogue stayed at stage 1 through `Yes please.` and moved to stage 2
  on the `Now, we buried the artefact...` line. Returning at stage 2 without the
  bearer still offered `I've been reading your book...`.
- Crypt `Dig` showed item box 19636 (`You have found the soul bearer.`).
- The Key Master repair showed item box 19634, advanced to stage 3, and produced
  no completion jingle, scroll or `Congratulations` chat line (`messages: []`).

### 2026-10-31 — focused live handler checks (not a full playthrough)

Account `bearqh` on slot 25. Quest stages were moved with `::quest bear your
soul <n>`, `::clearinv`/`::item` supplied or removed test items, and every move
used `::tele`; this is handler evidence, not a natural route.

- **Library:** `Bookshelf` object 28199 at (1620, 3814): `Search` added item
  19637 (Soul Journey). `Read` opened the book interface; closing it left the
  quest at stage 1 (varbit 5078 = 1).
- **Aretha:** nearest-spawn NPC 7042 at the Soul Altar. The menu offered
  "I've been reading your book..."; choosing it and then "Yes please." played
  the generated transcript and moved the quest to stage 2 (varbit 5078 = 2).
  *Pre-review timing; the capture-fix run above moved the stage on the following
  crypt-directions line.*
- **Crypt:** spade `Dig` at (1699, 3794, 0) added item 19636 (Damaged soul
  bearer); the helper's next step became "Go to Taverley Dungeon...".
- **Key Master:** NPC 12599 at (1311, 1251). `Talk-to` played
  `during-bear-your-soul`, showed the item box "The Key Master repairs your
  soul bearer.", replaced one 19636 with one 19634, and moved the quest to
  stage 3 (varbit 5078 = 3); `helperStatus` became `complete` and the contract
  agreed.
- **Not checked:** natural travel, full inventory at the hand-in, relog,
  post-quest Aretha dialogue, losing and reclaiming the bearer.

### 2026-10-31 — headless Quest Helper pre-flight (not a playthrough)

Stages were set with `::quest bear your soul <n>`; no route was walked. The
server was on this worktree's slot with the pinned bridge at `06da90f`.

| Saved stage | Wire / contract | Helper step |
| --- | --- | --- |
| 0 | varbit 5078 = 0; row 5 endstate 3, agrees | "Go to the Arceuus library and find The Soul journey book..." |
| 1 | varbit 5078 = 1; agrees | "Talk to Aretha at the Soul Altar." choices "I've been reading your book...", "Yes please."; NPC 7042 cache known |
| 2 | varbit 5078 = 2; agrees | "Go to the Arceuus church and dig for the Damaged soul bearer." |
| 2 + damaged bearer | varbit 5078 = 2; agrees | "Go to Taverley Dungeon..." ladder object 16680 cache known |
| 3 | varbit 5078 = 3; complete, agrees | `helperStatus: complete`, "Quest completed!" |

This confirms the stage order and the wire value Quest Helper reads. It does not
prove the book search, dialogue hand-offs or item swap in a live client; the
focused test covers those handlers.
