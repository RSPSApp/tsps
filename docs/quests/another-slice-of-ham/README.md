---
quest: Another Slice of H.A.M.
key: another_slice_of_ham
status: passed
tested: 2026-11-03
tester: agent
model: DeepSeek V4.1 Flash
commit: ed4f07f68
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Another Slice of H.A.M.

The latest run is scripted and unwatched: [route.cjs](route.cjs) played the whole quest over
the agent MCP from a fresh stage-0 account to completion, checking Quest Helper before each leg
and varbit 3550 after it. Three quest bugs were fixed first: the station doorway and train
ladder landed on the sealed captured station tile, handed-in artefacts reverted to the dug
varbit, and the ambush/sniper/special stages were one behind live OSRS. The timed pass asserted
stages 1-5 and 7-11, took 978.1s (16m18s), and finished with the rewards, a repeat talk and a
relog.

To re-run it (needs the Quest Helper bridge and a server with `AGENT_MCP=1`), from `server/`:

```bash
ROUTE_PASSWORD=<any> NODE_PATH=$PWD/node_modules node ../docs/quests/another-slice-of-ham/route.cjs \
  --mcp http://127.0.0.1:<AGENT_MCP_PORT>/mcp --player <fresh account> [--from "<step>"]
```

On a failure it prints the step, the helper's step and the stage, and the `--from` to resume
with on the same account once the cause is fixed. `--from` and `--to` must name a step (the
script lists them otherwise). Step 15 saves the pre-completion observation to `--checkpoint`
(default: a per-account file in the system temp directory), so a resume at "17 rewards"
measures the reward against it; without that checkpoint it stops and asks for a resume from
step 15.

The script tests the server's quest logic, not the client UI: it sends the clicks a client would
send, so a completion scroll, cutscene presentation or a click the client fails to offer is not
caught. Check this quest in a real client before calling the visuals verified.

## Capture search

RSProx database and issue #600 capture list checked on 2026-11-03: no full quest recording was
found. Capture 1885 (rev 233) contains the Dorgesh-Kaan opening argument and its four options,
but the player chose the market permission branch and `slice_quest` (997) stayed 0;
3197/3188/3191/1694 contain only post-quest Ur-tag, Zanik and Oldak lines with 997 already 11.
No start/completion message or stage progression was captured, so the stage values come from the
live varbit table and Quest Helper's pinned commit
`06da90f982518a093f2fe1c9cfac5547fa7053d3`.

## Findings

Newest first.

- **open** The captured station landing is a sealed one-tile room in this cache:
  `server/plugins/world/data/loc-teleports.json:445` sends doorway 23052 to (2488,5536), which
  has no route to the dig floor. The quest plugin now claims the doorway and lands at
  (2513,5556); correcting the capture belongs in the dumper, not generated data.
- **open** Quest Helper cannot see Zanik as a follower:
  `AnotherSliceOfHam.java:154` gates the scribe and Oldak steps on `FollowerRequirement` /
  `NpcInteractingRequirement(SLICE_ZANIK_FOLLOWER)`, while the server models "following" only as
  varbit 3557. At stages 3-4 the helper falls back to "Enter the railway entrance"; the route
  talks to the scribe and Oldak itself. Shared helper integration, not quest code.
- **open** Headless `quest_helper` intermittently returns `unavailable` with `MISSING_STATE` for
  an NPC `interactingIndex` (`SnapshotClient.java:611`) or for 35-77 `objectDefinitions`
  (`BridgeFailure.java:35`); the next call is `active`. The route records it and retries once.
- **open** `travel_to` reports `no-route` inside the swamp cave (for example 3172,9569 to
  3175,9569) and from the H.A.M. tunnel at (2396,5553). The route uses the cave rope, the tunnel
  ladder and the quest's cave zone instead. Not a quest bug.
- **fixed** The Goblin Village doorway 23052 and the train ladder 23504 used the captured
  (2488,5536) landing, so the station was unreachable during the quest. Both now land on
  (2513,5556), the station floor the dig uses; the doorway plays the kidnap transcript at stages
  8-10 and reopens at 11. Covered by the doorway and ladder tests. Fixed in `ed4f07f68`.
- **fixed** Handing an artefact to Tegdak left its `slice_artifact_N` varbit at 1 (dug), so Quest
  Helper kept the hand-in step. The hand-in now sends 2 and persists a delivered bitmask, so
  login re-sends 2/1/0 for handed-in/dug/undug. Covered by the relog varbit test. Fixed in
  `ed4f07f68`.
- **fixed** The stage order was one behind live OSRS after the ambush: the plugin used 6 for
  "both snipers dead" and advanced to 10 on the railway descent. Varbit 3550 is 6 after the
  ambush cutscene (snipers alive), 7 after both deaths, 9 in the tunnel and railway before the
  special, and 10 once the mace special lands. The plugin, journal and Quest Helper text now
  agree. Covered by the live-stage regression test. Fixed in `ed4f07f68`.

## Runs

Newest first.

### 2026-11-03 · agent · DeepSeek V4.1 Flash

- **Start:** fresh account at stage 0 with 5 quest points. Before the baseline, the save was
  given the three prerequisite completions (Death to the Dorgeshuun 14, The Giant Dwarf 50,
  The Dig Site 9), and the only commands were `::master`, `::maxgear ranged`, a rope, a lit
  bullseye lantern, a tinderbox, two super attack potions and `::tele` to Ur-tag.
- **Route:** scripted `route.cjs`; `travel_to` plus the quest's doorway 23052, ladders
  23531/23532/23376/23504, swamp hole 5947 and cave zone. Quest Helper's text was checked for
  the start, station, hand-in, generals, tower, sergeants, swamp caves and final fight.
- **Result:** passed in 978.1s. Stages 1, 2, 3, 4, 5, 7, 8, 9, 10 and 11 were asserted on
  varbit 3550 and varp 997; Quest Helper reported stage 6 with its tower step after the ambush.
  Rewards: 1 quest point (5 to 6), 3,000 Mining, 3,000 Prayer and the ancient mace. The repeat
  Ur-tag talk gave no second reward; relog kept stage 11, the quest points, both XP totals and
  the mace; Quest Helper reported the quest complete. One ancient mace special missed, which
  drained the bar and cost about five minutes of restore before the retry landed.
- **Not checked:** client UI (the completion scroll was closed over MCP), cutscene camera and
  visuals, the follower NPC presentation, and recovery paths other than the doorway/ladder
  cases in the unit tests.
