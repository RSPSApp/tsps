---
quest: In Aid of the Myreque
key: in_aid_of_the_myreque
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# In Aid of the Myreque

No native playthrough recorded; natural completion pending.

## Live capture: the library books

rsprox.net recording 365 (revision 231; the account had finished the quest) searches both
Paterdomus library bookcases and reads all three books cover to cover. `InAidOfTheMyreque.Quest.js`
follows it:

- **Bookcases.** Search sends "You search the bookcase..." and then, for each book of that case
  the player does not carry, the book and an item box (193) "You find a book called <title>."
  (Ivandis case 12767, ticks 2918-2923; history case 12766, ticks 3876-3884, Histories of the
  Hallowland then Modern day Morytania, one box after the other). Searching again with the book
  held sends only the search line (2927-2928). With one free slot, the second book went on the
  floor under the player (owner only, despawn 200) and its box still showed.
- **Read** opens book 392 with the reading animation (human_readbook, 1350): The Sleeping Seven
  runs to 9 spreads (3114-3123), Histories of the Hallowland to 11 (4170-4183), Modern day
  Morytania to 8 (4545-4554). The text is in `server/plugins/quests/data/in-aid-of-the-myreque-books.json`.

## Findings

None recorded.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q061); PRs: [#1133](https://github.com/RSPSApp/tsps/pull/1133).
