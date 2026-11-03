---
quest: Shadows of Custodia
key: shadows_of_custodia
status: untested
tested:
tester:
model:
commit: 48e008a41
cache: osrs-241_2026-10-20
start:
travel:
---

# Shadows of Custodia

Capture and source audit only; no native playthrough was recorded for this batch. Two complete
captures agree on every stage checkpoint, the notice-board start, the rewards and the completion
scroll.

## Findings

Newest first.

- **fixed** The quest never sent the captured start message. It now sends
  `You've started a new quest: <col=0ab0ff>Shadows of Custodia</col>` (capture 4190, tick 517).
- **fixed** Completion played the default jingle 238 and drew no scroll item. Capture 4190
  plays jingle 153 and draws `custodian_antler_guard` 31081; both are now set on the quest. The
  scroll's other-reward line is now the captured "Stalker Den Access".
- **fixed** The completion chat line colour is now `<col=0ab0ff>`; the quest sets `completionMessageColor`.
- **note** Capture 4190 is a Leagues VI world, so it also emits a medium-task completion and
  jingles 283/829 around the quest scroll. Those belong to the league, not the quest.
- **unchecked** A native run of the wall reinforce/bow hand-in, the Stalker Den scene, the three
  strange creatures and Antos's rescue conversation. The carousel below is capture/source only.
- **unchecked** Recovery: full bag during the bow hand-in, a lost wet fabric scrap, and an
  interrupted den entry.

## Capture evidence

- Primary archive **4190**, revision 238 (Leagues VI), `rsprox-4190.bin`, 3,483,791 bytes,
  sha256 `4620f5759171953f9d9ac21ca4670fcc703c376f41af2053cd1216425809aac7`.
  Packet lines 13258-25794, ticks 517-1162.
- Alternate archive **3127**, revision 232, `rsprox-3127.bin`, 297,048 bytes,
  sha256 `7313823bdcb9cce6870712c31ff93b907c0a240be4de69c312dcfc1b42ad4834`.
  Ticks 294-1010; the same stage ladder and rewards.
- Start: tick 517, `OpLocV2` on 56416 (notice board, 1396,3356), then
  "You've started a new quest" and varbit 16632 = 2.
- Capture route: notice board → bartender/shopkeeper/citizen → house wall → puddles and the
  plank → wet fabric scrap to the parents → Stalker Den → wall reinforce and Ariadna's bows →
  strange creatures → Antos's rescue → Captain Ariadna's hand-in.
- Stage ladder (varbit 16632, varp 4734 bits 0-5): 2, 4, 5, 6, 8, 9, 10, 12, 14, 15, 16, 18,
  20, 22, 24. Sibling varbits 16633-16659 move with the individual tasks.
- Completion: tick 1162, jingle 153, scroll item 31081 x400, "2 Quest Points",
  "Stalker Den Access", "10,000 Slayer XP", "4,000 Hunter XP", "3,000 Fishing XP",
  "3,000 Construction XP"; `UpdateStatV2` Fishing, Slayer, Hunter and Construction.
- Cache contract: quest DB row 5190, endstate 24. `quest_helper` reports
  `{varbit 16632, varp 4734, bits 0-5}` and `agrees: true`.

## Runs

No native run yet.
