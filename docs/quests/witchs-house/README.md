---
quest: Witch's House
key: witchs_house
status: passed-with-issues
tested: 2026-10-30
tester: agent
model: claude-haiku-5-5
commit: f4d1ea6cb
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Witch's House

A fresh playthrough from the Boy north of Taverley to quest complete passed: every stage (1 → 7) was reached, the rewards match the quest data, and the repeat talk and relog were checked. Open items are the diary spawn respawn, the post-completion front door, and an unimplemented Nora garden check.

## Findings

Newest first. One line each, linked to its issue or PR when there is one.

- **closed** Nora patrols and catches players in the garden (#1763). No recording shows a catch: the row and timing are from rsprox 2963, 3246 and 3249 and the lines, teleport and lost ball from the Wiki, while looking only the way she walks is inferred. A simulated route around the hedges reaches the fountain from any point of her patrol, walking or running.
- **open** The Diary ground spawn (2408, at 2903,3471) has `respawn: 30` in `ground-items.json`. After it is taken it reappears 30 ticks later, so a player can carry several. The quest consumes all diaries on completion, so nothing breaks, but live OSRS behaviour is unverified; check against an RSProx capture before changing the spawn.
- **open** After completion the front door (2861) refuses entry with "It would be rude to break into this house." (`WitchsHouse.Quest.js`, `handleObjectInteraction`). Unverified against live OSRS whether the house stays closed after the quest.
- **open** Not checked by this run: the Boy's below-level-10 combat variant, the other shapeshifter death paths, the cupboard/box full-inventory paths, and reading the diary before the mouse step.
- **open** (other code) `PlayerBots.plugin.js` fails to load in a fresh worktree with `Cannot find module 'standardwebhooks'`. Not quest code; the server still starts.
- **open** (travel_to / walk_to) `walk_to` stops at a closed door on the route (returns `stuck`); `travel_to` opens the same door. Recorded so the difference is known, not treated as a quest bug.

## Runs

Newest first. A rerun adds an entry; it never rewrites an older one.

### 2026-10-30 · agent · claude-haiku-5-5

- **Start:** fresh account Tester (all skills 99, empty inventory, quest varp 226 = 0, quest points varp 101 = 0, Hitpoints XP 13,034,431). Placed beside the Boy at 2928,3454 with `::tele` before the baseline, the only teleport used. Declared setup: 1 Cheese (item 1985) for the mouse hole.
- **Route:** Boy (start, stage 1) → potted plant 2867 Look-under for the Door key → front door 2861 → basement ladder 24718 → east-room boxes 24692 for Leather gloves (first search) → electric gate 2866 → cupboard 2868 for the Magnet (stage 2) → cheese on mouse hole 2870 → Magnet on the Mouse (stage 3, back door unlocked) → diary 2408 taken and read (stage 5) → fountain 2864 Check for the shed key (2411) → shed door 2863 → four shapeshifter forms (stage 6) → ball 2407 from the shed spawn → Boy hand-in (stage 7).
- **Result:** varp 226 = 7; quest points 4 (varp 101); Hitpoints XP 13,040,947 (+6,516). The quest grants 6,325; the extra 191 is ordinary Hitpoints XP from damage dealt in the fight (1.33 per damage, `CombatFactory.ts`; the four forms had 21+31+41+51 = 144 HP). The inventory is cleared on completion; repeat talk to the Boy gives "Thank you for getting my ball back!".
- **Relog:** logged out and back in; varp 226 = 7, quest points 4, Hitpoints XP unchanged, and the Boy's post-quest line persists.
- **Not checked:** an alternate route, the combat-level-10 start variant, recovery paths (mid-fight relog, full inventory at each search), and the live-OSRS behaviour of the open items above.
