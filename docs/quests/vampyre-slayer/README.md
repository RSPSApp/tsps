---
quest: Vampyre Slayer
key: vampyre_slayer
status: passed-with-issues
tested: 2026-11-03
tester: agent
model: claude-opus-5-5
commit: 9c0850318
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Vampyre Slayer

A fresh account completed the quest from Morgan to the Count's death and the scroll. The
mechanics follow rsprox 3275 (full route), 1710 and 1718; their dialogue predates the 30 June
2026 rewrite, so the words follow the current wiki transcript, which the generated data
already matched.

## Findings

Newest first.

- **fixed** "You've started a new quest: Vampyre Slayer" was never sent; below combat 20
  the recommendation is now a blocking box before the start menu (1718), not a chat line.
- **fixed** The coffin rise: the lid now opens 2 ticks after the player reaches the coffin
  and the Count first swings the tick after he rises (both captures), which was reported as
  the rise animation being missing. Measured live: click to risen Count in 7 ticks, as 3275.
- **fixed** Garlic drained 10 Hitpoints as a visible hitsplat and capped the Count's max hit
  at 2; both captures show no such splat and 3s while weakened. Now a silent drain.
- **fixed** Without both tools the Count healed to full silently; now the red "You're unable
  to push the stake far enough in!" / "The vampyre seems to regenerate!" and a heal hitsplat
  of 20 (1710; one sample).
- **fixed** The stake message and animation 806 came with completion; now they come the tick
  after the last hit with the death animation, and completion two ticks later (both captures).
- **fixed** Completion played jingle 238; the captures play 154.
- **fixed** The journal follows the wiki's rewritten journal at each stage.
- **open** The candles' "The candles burn your feet!" exclamations (1710) are not implemented;
  their trigger tiles are not derivable from the captures.
- **open** Garlic restores at once after 50 ticks; the wiki says one point per 5 ticks with a
  re-drain. The captured fights are too short to check.
- **open** No capture of the current (rev 241) dialogue or chat-head animations.
- **fixed** The coffin-rise animation appeared missing; the fight was available
  ([#1257](https://github.com/RSPSApp/tsps/pull/1257)). See the coffin rise above.

## Runs

### 2026-11-03 — agent — Claude Opus 5.5

- **Start:** fresh level-3 account (varp 178 = 0), placed at Morgan with `::tele` (the only
  teleport). Declared setup after the start: `::master` for the fight, a beer, a hammer and a
  rune scimitar.
- **Route:** Morgan (warning box, start); Morgan's cupboard for garlic; `travel_to` the Blue
  Moon Inn (the first leg returned `no-route` at (3193, 3344), the retry arrived); Dr Harlow,
  beer, stake; `travel_to` Draynor Manor and the basement stairs; the coffin.
- **Result:** varp 178: 1 on "Yes.", 2 on Harlow's "buy ush a beer", 3 at completion; the
  regenerate path healed the Count to 20 with both red messages; with stake and hammer the
  Count hit 0, the red stake message and death animation came the next tick and completion two
  ticks after, with 3 quest points, the stake removed and the hammer kept. Morgan's post-quest
  lines played; a relog kept the stage and points.
- **Not checked:** candles, garlic re-application over a long fight, the Count's timeout
  return to the coffin, the jingle on a client.

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
