---
quest: Fairytale I - Growing Pains
key: fairytale_i_growing_pains
status: passed-with-issues
tested: 2026-11-04
tester: Codex headless MCP
model:
commit:
cache: osrs-241-2026-10-20
start: earlier full route plus a stage 50 checkpoint to replay the changed final stages
travel: normal dialogue, walking, inventory and combat actions after debug setup
---

# Fairytale I - Growing Pains

The full quest route was completed with the headless MCP on 2026-11-04, then the
Nature Spirit blessing and Tanglefoot room changes were replayed live from a
stage 50 checkpoint. The final replay confirmed the blessing grants Magic
secateurs after its timed scene, the owner-only Tanglefoot despawns on leaving
its chamber and respawns on re-entry, and the Queen's secateurs can be returned
to complete the quest. The route was audited against the [Wiki quick guide](https://oldschool.runescape.wiki/w/Fairytale_I_-_Growing_Pains/Quick_guide),
the active cache, the decoded local RSProx corpus and issue [#2150](https://github.com/RSPSApp/tsps/issues/2150).

## Route audit

The Wiki route is Martin in Draynor, five Advanced Gardeners, the Fairy
Godfather and Nuff in Zanaris, Zandar, Malignius and the Draynor grave, three
assigned ingredients, Nature Spirit's blessing, the Gatekeeper and the
winding grove, Tanglefoot, then the Queen's secateurs returned to Zanaris.
Existing source handlers cover those stages; native/headless tests cover quest
start and saved progress, Nuff handovers, the Draynor dig, gatekeeper item
ownership, lair pathing, and the Tanglefoot fight restrictions.

## Findings

- **open** The Wiki says Tanglefoot's damage uses both Farming and Strength,
  but no source gives the exact roll and no matching capture is available. The
  existing melee damage formula remains an unverified parity gap.
- Issue #2150's skull dig behavior was already fixed on the base branch by
  [PR #2232](https://github.com/RSPSApp/tsps/pull/2232). This audit preserved
  that behavior.
- The Nature Spirit blessing now uses cache sequences 3256/3257 and spotanim
  568, then grants magic secateurs only after the 12-tick player animation ends.
  The Wiki GIF supports the order and sequence length; the local decoded capture
  corpus has no blessing scene to establish tick-by-tick timing.
- Tanglefoot now spawns only when the player reaches the cache-mapped end room,
  and its owner-only copy is removed when that player leaves the room. This
  closes the tunnel pursuit leak reported in #2150. Leaving and re-entering
  recreates an unfinished fight; another player's copy is unaffected.
- Non-secateur hit damage is still blocked, while reflected ring-of-recoil
  damage is allowed, as the Wiki describes.

## Evidence gaps

The local decoded RSProx corpus was searched for the blessing, Tanglefoot and
the relevant Nature Spirit lines. Candidate submissions 101 and 1695 were
unrelated Hespori dialogue; no blessing or lair fight was found. This is a
finding about the local corpus only; the central archive was unavailable to the
headless API search during this audit.

The room rectangle is inferred from active cache wall placements, not from a
captured encounter instance.

The Wiki GIF shows the 58-frame blessing scene over about 8.2 seconds, but no
RSProx capture establishes its exact server-tick timing.

## Verification

The live replay observed the Nature Spirit dialogue enter its timed, movement-
blocked scene, then finish with stage 70 and Magic secateurs. The Tanglefoot
spawned at the cache-mapped chamber, disappeared after leaving the room, and
respawned after re-entry. The player defeated it with Magic secateurs, took the
Queen's secateurs, returned them through the Fairy Godfather dialogue, and
received the completion message at stage 90 (varbit 1803).

The stage 50 checkpoint and positioning used test setup commands; the final
quest actions used normal dialogue, movement, inventory, and combat controls.
The full-route run and targeted native event-entrypoint coverage exercise the
earlier stages, quest dig, Tanglefoot restrictions, reflected recoil, and timed
blessing completion.

## Runs

### 2026-11-04 · Codex · headless MCP

- **Start:** The earlier full-route run completed the quest start to finish.
  The follow-up replay began at stage 50 with Lost City and Nature Spirit
  complete; test setup commands supplied the checkpoint and positioned the
  player at the Nature Grotto and grove entrance.
- **Route:** Completed the timed Nature Spirit blessing; entered the grove,
  crossed the Tanglefoot room boundary out and back in, defeated Tanglefoot,
  collected the Queen's secateurs, and returned them to the Fairy Godfather.
- **Result:** Magic secateurs were awarded after the blessing; Tanglefoot's
  owner-only spawn despawned and respawned at the room boundary; the boss drop
  was collected; stage 90 and the quest-completion message followed the final
  dialogue.
- **Not checked:** The live screenshot call timed out while the blessing scene
  was running, so the live observation does not pin its exact duration. No
  matching RSProx scene establishes that timing or the Tanglefoot damage formula.
