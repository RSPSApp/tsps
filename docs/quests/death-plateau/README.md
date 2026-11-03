---
quest: Death Plateau
key: death_plateau
status: passed
tested: 2026-10-23
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start: checkpoint
travel:
---

# Death Plateau

Harold's IOU, stone balls, Saba's cave, Tenzing/Dunstan chain and the secret trail were played naturally to Denulth. Rewards paid once and persisted.

## Findings

- **fixed** Shared dialogue runner now continues explicitly true linear sibling conditions.

## Runs

### 2026-10-23 · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q017); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** checkpoint: fresh stage 0, linked across three server runs.
- **Result:** varp 314 = 80; QP 0->1, Attack +3,000 XP, steel claws x1.
- **Checked:** repeat dialogue (Denulth), relog, logout/offline, full-bag certificate recovery.
- **Not checked:** Other recovery, alternate dialogue and overlay unchecked; Invulnerability used during optional troll encounters.
- **PRs:** [#1107](https://github.com/RSPSApp/tsps/pull/1107).

### 2026-11-03 · offline Harold gambling regression

- Replaced the automatic 60-coin IOU with a wager prompt, the cache's native `death_dice` interface 99, Harold/player dice animations, Roll and Continue, real wins/losses and the existing outcome transcript. The ale and Blurberry routes remain available.
- [Wiki quest guide](https://oldschool.runescape.wiki/w/Death_Plateau): Blurberry guarantees a win, and an IOU requires a 60–1000-coin bet. The [quick guide](https://oldschool.runescape.wiki/w/Death_Plateau/Quick_guide) explicitly recommends 101 to bankrupt him immediately. Initial 100 coins and an IOU when a qualifying win exceeds his remaining money follow from that guidance; an exact 100-coin win exhausts the cash without leaving a debt.
- The [canonical transcript](https://oldschool.runescape.wiki/w/Transcript:Death_Plateau) warns that backing out after Harold rolls forfeits the stake. The imported transcript supplies amount validation, pre-roll lines and winning/losing/IOU dialogue; generated JSON is unchanged.
- Cache `osrs-241_2026-10-20`: `death_dice` group 99, Roll child 28, Continue child 30, `dice_idle` 1149 and `dice_roll_1`–`dice_roll_6` 1150–1155. The [pinned cache dump](https://github.com/Joshua-F/osrs-dumps/blob/6e5033af6215963581a51b348f452320ff18f0f6/interface/death_dice.if) confirms the two dice per side and native components.
- Native `ClientConnection` regression covers NPC dialogue, numeric input, the two different widget packet routes, repeat clicks, wins/losses, drunk wins, limits, forfeit/cancel, changed position/coins, IOU recovery after closing/disconnect, full inventory and coin-stack overflow. Existing progression checks remain in the same suite: `cd server && node --test tests/qh728-q017.test.cjs` after building.
- **Limit:** no usable live dice capture or independent tie rule was found. Equal sober totals return the stake; that is a disclosed inference. Native animation sequences are used, but exact timing and jingles are not claimed as captured. No interactive client/server test was run.
- **Scope:** the seated soldier and boots/certificate reports are tracked separately in [#1979](https://github.com/RSPSApp/tsps/issues/1979).
