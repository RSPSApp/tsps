---
quest: Cabin Fever
key: cabin_fever
status: in-progress
tested: 2026-10-31
tester: agent
model: DeepSeek V4.1 Flash
commit:
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Cabin Fever

One headless main-route completion recorded (stage 0 to varp 655 = 140). It is
not a natural playthrough: prerequisites and max levels were granted with
commands, and `::tele` was used to return to the ship after a relog. The enemy
hold chest could not be reached during the run, so the ten plunder came from
crate/barrel respawns.

## Findings

- **open** The enemy hold chest at 1823,4840z0 answers `Plunder` with
  "You can't reach that!" from 1824,4840z0; `travel_to` reports no route to
  1822,4840z0. The crate and barrel supply enough plunder over respawns, but the
  chest leg needs a map/collision check.
- **fixed** The port-ship Bill spawn row (4013) transforms to 4011 and is created
  lazily when a player enters the region, so the startup-only swap never found it
  and the ship had a nameless Bill with no Talk-to option. The fix now runs on
  login, region load and active-region updates, finds the row by its real id and
  keeps one 4014 Bill at the tile.
- **fixed** The five objectives could be advanced out of order (arrival, fuse
  blast, cannon loading, ammo type, plunder storage and completion). Every
  action, object and item handler now checks the canonical stage and its
  required items first.
- **fixed** Canister and cannonball ammo values were reversed against the cache
  transforms and Quest Helper (1 is a cannonball, 2 is a canister). A canister
  hit now kills the pirate it catches and the NPC death records the crew hit.
- **fixed** The Book o' Piracy is granted once instead of unconditionally, is
  readable, and Bill still replaces a lost copy. Quest supplies are removed on
  completion and on the next login of a completed save, keeping rope, hammer,
  tinderbox and swamp paste.
- **known difference** The durable wire mapping sends the next phase value when
  Bill advances the dialogue (50/70/90/110/130), while Quest Helper also has
  transient talk-to-Bill keys (40/60/80/100/120). The client journal is driven by
  this plugin, so the gameplay order is unaffected.

## Runs

### 2026-10-31 — headless main route (aided)

- **Start:** stage 0 on a new account; `master` plus `quest Pirate's Treasure
  complete`, `quest Rum Deal complete` and `quest Priest in Peril complete`.
- **Route:** pub Bill start dialogue, `travel_to` across the gangplank, ship Bill
  "Let's go Cap'n!", cutscene arrival (varp 30, cannon 1741=1), repair/gun
  lockers and floor tinderbox, rope swing, fuse attach (1756=2) and light (1749=1),
  swing back, Bill (varp 50), three holes planked and pasted (1759/1760=3),
  Bill (varp 70), crate/barrel plunder to 10, storage (1752=10), Bill (varp 90),
  barrel repair (1741=0), Bill (varp 110), three canister hits with ramrod
  cleaning, Bill (varp 130), three cannonball hits with ramrod cleaning, end
  cutscene.
- **Result:** varp 655 = 140, quest points varp 101 = 7, Book o' Piracy (7144)
  in the inventory, position 3665,2982 (The Other Inn). The first canister hit
  killed a pirate; later hits advanced the crew counter through the no-pirate
  fallback while pirates were out of the target box.
- **Not checked:** a fully natural run, chest reachability, repeat dialogue,
  relog persistence, the 10,000-coin claim and the book reclaim.
- **Focused tests:** `node --test tests/qh728-q009.test.cjs` — 13/13.

Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q009);
PRs: [#1100](https://github.com/RSPSApp/tsps/pull/1100).
