---
quest: Demon Slayer
key: demon_slayer
status: passed-with-issues
tested: 2026-11-01
tester: agent
model: claude-opus-5-5
commit: b7fb0e92d
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Demon Slayer

A fresh account played the quest from Aris to Silverlight and the banishment, with `travel_to` after placement, against rsprox 1723 and 1843. Its first attempt hit a bug and resumed from its saved stage after the fix, so this isn't one unbroken run. Stage values and dialogue match the captures, except as listed under Findings.

## Findings

- **open** Menus differ from 1723 and 1843. Pre-start menus always show 4 options where live drops the one just picked. Aris's post-start menus should be titled "What would you like to say?". Rovin's first menu has 5 options (live 3), his second is demon|Goodbye (live demon|Erm|ale), and "Aris said" should be "Fortune-teller Aris said". Shared dialogue code or generated data.
- **open** Boxes don't send the chat mirror the captures show: combat warning, key and sword hand-overs, "The wizards cast...", "Delrith is sucked...", "...back into the dark dimension...". Shared dialogue code.
- **open** Completion's quest link in chat is always `081190`; the captures have `0ab0ff`. Shared code.
- **open** The vision and the fight run in private areas on the real map, where live builds an instance. Side tabs stay open during scenes (1843 tick 10110).
- **open** Possibly the Doorways music unlock overrides Delrith's song at the vision's start, from reading the code. Songs and jingles can't be read over MCP, so jingle 152, song return and the scroll's text weren't verified.
- **open** `travel_to` returns `no-route` into the Wizards' Tower with its doors closed, so they were opened by hand. Those doors reclose quickly. Planner gap.
- **open** Unproven: the 100-tick weakened timeout (41 ticks passed in the capture), "There is no reason to pour water there." (no source, kept for an existing test), Silverlight doubling damage on Delrith. Table 17454 at tick 10225 isn't played.
- **open** Scenes may be missing, shortened or glitchy. [#1257](https://github.com/RSPSApp/tsps/pull/1257)
- **fixed** Weakened Delrith could be killed by the player's next hit, leaving nothing to banish and the quest stuck until leaving and re-entering. Happened on an earlier build as well as this one.
- **fixed** Against rsprox 1723 and 1843: combat warning box, coin leaving after "Okay, here you go.", vision fades and timing, stage 2 after the Traiborn line, item boxes for keys and sword, Traiborn's wardrobe ritual, Prysin's walk and case scene, table order and sounds, "Arise" overheads, Denath's exit, wizard kill varbit 2572, spoken words held 3 ticks, 16-tick vortex with Continue on the second box, jingle 152, chat-head animations.

## Runs

### 2026-11-01 · agent · claude-opus-5-5

- **Start:** fresh account placed with `::tele`; declared setup of 1 coin, 25 bones, 2 buckets of water. Baseline: varp 222 = 0, no quest points, Hitpoints 1184 XP, other skills 0.
- **Route:** Aris and the vision, Prysin, Rovin, the drain and sewer, Traiborn, Prysin's case, then the fight, by `travel_to`, opening the tower doors by hand.
- **Interruptions, declared:** two deaths (sewer zombies, leaving the tower) lost bones, so bones and lobsters were supplied again after the baseline. Prysin and Traiborn then failed to hand over their items on Talk-to, a bug from this audit's own changes. It was fixed and the account resumed from saved stage 2. `::infhp` and `set_npc_hitpoints` were used only once the fight had started.
- **Result:** varbit 2561 reached 1 on "Delrith will come forth", 2 after Prysin's Traiborn line, then stage 29 on the sword box and 30 on continuing past the second banishment box. Quest points 0 → 3, Silverlight kept, no quest XP.
- **Repeat and relog:** Aris plays her after-quest lines with no second reward; stage, points and sword persist.
- **Fight checks:** all three wizards attack a low-level account and block Delrith until they're dead, which the Wiki says is live behaviour (aggressive below combat 15 and 41, single-way combat). The wrong incantation gives a box and Delrith returns at full health.
- **Recheck after the weakened-Delrith fix, with a bounded fixture** (`master`, Silverlight, stage set to 29, `::tele`, `::infhp`, so not a play): the weakened form survives attack attempts, offers only Banish, comes back after a wrong answer and re-kill, and a correct answer completes the quest with 3 quest points.
- **Not checked:** key and sword recovery, client visuals, songs and jingles, journal text (no capture).

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
