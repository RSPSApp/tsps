---
quest: Troubled Tortugans
key: troubled_tortugans
status: passed-with-issues
tested: 2026-11-03
tester: agent
model: deepseek-v4.1-flash
commit: 48e008a41
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to (declared raft and one boat reposition)
---

# Troubled Tortugans

A full fresh run from the Injured Tortugan to the quest scroll, with the real repair,
tracking, cave, gryphon and Little Pearl fights. Stage 44, 1 quest point, 10,000 Sailing and
8,000 Slayer XP, repeat talk and a relog all checked. The boat legs used a declared raft and
`::bt tp` to reposition it; no live sailing was played.

## Findings

Newest first.

- **fixed** The opening conversation left the saved stage at 2 until bandages were crafted, so
  the journal and Quest Helper showed the start step again after the player had already been
  told to fetch seaweed. Capture 3456 sets varbit 18321 = 4 on the final player line ("Right,
  you take it easy...", tick 216); the plugin now does the same.
- **fixed** Two of the six repair scutes (3110,2430 and 3118,2419) had despawned before they
  were collected, and only a relog recreated them. The private floor spawns now use a
  6000-tick despawn, as the Fallen From Grace floor items do. The first pass also showed the
  two tiles empty while the other four were present; the relog restored exactly those two.
- **fixed** The quest never sent the captured start message. It now sends
  `You've started a new quest: <col=0ab0ff>Troubled Tortugans</col>` (capture 3456, tick 212).
- **fixed** Completion played the default jingle 238 and drew no scroll item. Capture 3456
  plays jingle 152 and draws sea shell 31395; both are now set on the quest. The scroll's
  other-reward line is now the captured "Great Conch Access".
- **fixed** The completion chat line used the default `<col=081190>`; capture 3456 uses
  `<col=0ab0ff>`. The quest now sets `completionMessageColor`.
- **fixed** Chopping jatoba with a full bag printed both "You couldn't hold all those items."
  and "You get some jatoba logs." Jatoba logs (32902) do not stack, so the chop now stops on any
  full bag, including one that already holds a log, and no log or success line is given.
- **open** The boat legs were not played naturally. A raft was supplied in declared setup
  (`::raft`, `::maxboat`), the player used `::pandemonium` to reach it, and `::bt tp`
  moved it to Remote Island and the Great Conch. Boarding, docking and disembarking themselves
  used the real mooring/buoy interactions.
- **checked** After completion Elder Raley's talk offered The Red Reef's start (the shared
  follow-up quest) and choosing Yes started it at stage 2. The shared-NPC handoff works and TT
  completion does not block the next quest; no Tortugans reward was repeated.
- **unchecked** The unique post-quest Tortugans line, because the same NPC now routes into the
  Red Reef conversation.
- **unchecked** Destroying or losing the tortugan shield, a full bag at the shield handout,
  and an interrupted Pearl cutscene. The quest has no item reward, so the full-bag reward case
  does not exist.

## Capture evidence

- Archive **3456**, revision 235.1, `rsprox-3456.bin`, 568,368 bytes,
  sha256 `103e8c17b4a9994622d8d1dc6f1380049cb156cb535c692ddec1a86436cdd171`.
  Packet lines 7454-50713, ticks 212-2763 (start message to completion scroll).
- Start: tick 212, `MessageGame` "You've started a new quest"; varbit 18321 = 2.
- Stage ladder read from varp 4961: 2, 4, 6, 7, 8, 10, 12, 13, 14, 16, 18, 20, 22, 24, 26,
  28, 30, 32, 34, 36, 38, 40, 42, 44. Repair varbits set 1 then 2 at stage 16-20; trail
  varbits 18322-18326 set in order by 26 and cleared on completion (tick 2763).
- Completion: tick 2763, jingle 152, scroll item 31395 x400, "1 Quest Point", "Great Conch
  Access", "10,000 Sailing XP", "8,000 Slayer XP"; `UpdateStatV2` Sailing and Slayer.
- Cache contract: quest DB row 7106, endstate 44. `quest_helper` reports
  `{varbit 18321, varp 4961, bits 0-5}` and `agrees: true`.

## Runs

### 2026-11-03 · agent · deepseek-v4.1-flash

- **Start:** fresh `qa tortugan` at 2961,2605 (the only `::tele`). Setup declared before the
  baseline: `::master`, `quest pandemonium complete`, a hammer and saw, later a bronze axe.
  Baseline QP varp 101 = 1, varbit 18321 = 0, all skills 99 (Sailing 13,034,731).
- **Route:** Injured Tortugan (start, 2), palm leaf and seaweed, bandages (4), hand-in (6),
  Floopa conversation (7, 8), raft to the Great Conch (10, 12), Elder Korel (13), Elder Raley
  (14, 16, 18; list of repairs), six repairs (20), tracking conversation (22), monument and
  four trail finds (24, 26), unblock and enter the cave (28, 30), cave Gryphon (32), Elder
  Raley (34), Elder Blunn's shield, Little Pearl approach (36), Shellbane (38), Elder Korel
  (40, 42), Elder Raley (44).
- **Result:** stage 44, QP +1 (varp 101 1 → 2), Sailing +10,000, Slayer +8,000. The
  completion chat line and reward were not retained packet-by-packet; the jingle/scroll item
  were set from the capture and checked in the focused test. Repeat talk gave no second reward.
- **Relog:** stage 44, QP 2 and the XP totals persisted; no items duplicated.
- **Not checked:** natural sailing, the at-sea Floopa dialogue variants, the cutscene camera
  arcs, the shield destroy/reclaim path, and the visual scroll rendering.
