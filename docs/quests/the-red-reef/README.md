---
quest: The Red Reef
key: the_red_reef
status: untested
tested:
tester:
model:
commit: 48e008a41
cache: osrs-241_2026-10-20
start:
travel:
---

# The Red Reef

Capture and source audit only; no native playthrough was recorded for this batch. Capture 4152
shows a complete run through stage 42, and its start NPC, stage ladder, rewards, jingle and
scroll item agree with the plugin aside from the issues fixed below.

## Findings

Newest first.

- **fixed** The quest never sent the captured start message. It now sends
  `You've started a new quest: <col=0ab0ff>The Red Reef</col>` (capture 4152, tick 57).
- **fixed** Completion played the default jingle 238 and drew the reward schematic 33423
  instead of the captured scroll item. Capture 4152 plays jingle 154 and draws
  `trr_red_coral` 31405; both are now set on the quest. The scroll's reward lines now read
  "Great Conch Sacred Grove Access" and "Bosun's Workbench Schematic" as captured.
- **fixed** The completion chat line colour is now `<col=0ab0ff>`; the quest sets `completionMessageColor`.
- **unchecked** A native run of the diving route, the pirate-ship sinking, the six-island-crew
  fight and Black Eye Bethel's scimitar switches. The carousel below is capture/source only.
- **unchecked** Recovery: full bag at the schematic handout, losing the schematic, and an
  interrupted display-case or Bethel encounter.

## Capture evidence

- Archive **4152**, revision 238.1, `rsprox-4152.bin`, 553,604 bytes,
  sha256 `dcd26b1b98766cd5ef4a0f3043600f3994316cef6f3360a1f3f2492127d68b09`.
  Packet lines 5597-54953, ticks 57-2335.
- Start: tick 57, `opnpc1_v2` on Elder Raley 15002 at 3187,2403, then
  "You've started a new quest" and varbit 18335 = 2.
- Capture route: Raley → ask around town → Elder Katt and the Sacred Grove → Floopa →
  Red Rock receptionist → four display cases → Theodore Paxton → Last Light pirate ships and
  the six island crew → Black Eye Bethel → the Zenith and Spencer → first dive and dredger →
  report to Floopa and Elder Raley.
- Stage ladder (varbit 18335, varp 4962 bits 0-5): 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22,
  24, 26, 28, 30, 32, 34, 36, 38, 40, 42. Display-case varbits 18338-18341 set as each case is
  inspected at 14.
- Completion: tick 2335, jingle 154, scroll item 31405 x400, "2 Quest Points",
  "Great Conch Sacred Grove Access", "Bosun's Workbench Schematic", "15,000 Sailing XP",
  "5,000 Smithing XP"; `update_stat_v2` Sailing 15,000 and Smithing 5,000.
- Cache contract: quest DB row 7107, endstate 42. `quest_helper` reports
  `{varbit 18335, varp 4962, bits 0-5}` and `agrees: true`.
- Alternate downloads 4155, 4153 and 4151 were decoded: 4153 is The Ides of Milk, and 4155
  and 4151 do not contain The Red Reef's start or completion messages, so they were not used.

## Runs

No native run yet.
