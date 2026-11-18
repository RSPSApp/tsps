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

## Live capture parity (issue #4032)

From rsprox captures **local 1001800** (rev 242) and **local 1001683** (rev 241), both the whole quest. The
ticks below are 1001800's. Where these differ from the Wiki transcript, the Wiki's wording is kept.

- **Varp 314** only ever takes 0, 10, 20, 30, 40, 50, 55, 60, 70 and 80. The balls placed set 70 (tick 24537), and
  Saba, Tenzing, Dunstan, the map and the scouting change nothing until 80. The plugin keeps its finer saved
  stages (65-78) and sends all of them as 70 (`varpValue`). Quest Helper keys its last section on 70.
- **Hand-over boxes.** Each hand-over is an item box: objectbox 193 with the item, or objectbox_double 11 for the iron
  bar with the climbing boots and for the trout with the bread. The knocks and "Harold is so drunk..." use
  messagebox 229. Live sends the line to chat together with the box (gamemessage plus mesbox). "Harold has given
  you some of your winnings!" is the box alone (tick 24394). The Wiki's {{mes}} twin after each {{tbox}} is
  therefore not sent a second time.
- **Ale** (ticks 24262-24271): after the box's continue, Harold plays human_eat (829) at +2 and says "Arrh. That
  hit the spot!" at +5.
- **Blurberry special** (ticks 24311-24321): human_eat at +1, an overhead "Wow!" at +4, the stunned spotanim (80)
  at height 124 at +7, then "Now THAT hit the spot!" at +10.
- **Dice** (ticks 24357-24376, the same in 1001683): on opening, varps if1/if2 (261/262) select the coin-pile
  model (7 for 101 coins, following coins' stack thresholds 2/3/4/5/25/100/250/1000/10000). Opening also sends
  "Harold rolls...", sets the four dice to dice_idle, hides Roll and Continue, fills in the name and both stakes,
  and runs toplevel_mainmodal_open. Harold's dice land at +3 and +6, each with dice_shake (1475). Roll appears at
  +9 with "Your roll...". The player's first die lands on the Roll click and the second 3 ticks later. Continue
  appears 3 ticks after that, with the result of the dice and its jingle: 93 "Bad Roll" (captured), or 94 "Lucky
  Win" (Wiki cacheid). Both recordings show "You lose!" while a drunk Harold still pays out.
- **Doors.** Tenzing's front door (3745) and back door (3746) are pass-through doors. The doorway gets inviswall
  38848, the open door 14975 goes on the tile east or north, and door_open (62) plays. The player steps through
  and the door is back two ticks later (ticks 24737, 25196, 25264). Before Tenzing has given his boots, opening
  the front door from outside plays the knock box with knock_knock (1735). After Saba, Tenzing lets the player
  in on the continue of "Oh...OK. You'd better come in then." Before Saba, the Wiki's "No milk today!" ends it.
- **Stone mechanism:** "The equipment room door has unlocked.", varp 314 60->70 and unlock_and_move (1473), all on
  the fifth ball's tick.
- **Scouting** (tick 25337): "You can see that there are no trolls on the secret path." and "You should go and speak to
  Denulth." go to chat together with the player's own line. It triggers at 2864,3609 (2865 in 1001683).
- **Death Plateau notice** (warning 24, cws_warning_24 581, varbit 3872): it opens on the first step into the
  zone 2832-2839 x 3592-3599. It is captured from the west at tick 25305, from the south in local 1001997, and
  on later visits in local 1001676.
- **Stile** (3730): it crosses from 2817,3562 to 2817,3563 with human_walk_style (839) and exact_move at cycles
  30-94, with no message (5 crossings in 1001676, 1001683 and 1001800).
- **Stone balls:** they lie as live has them (x 2893: red 3565, blue 3564, purple 3563, green 3562, yellow 3561).
  They respawn after the Wiki's 10 ticks (Stone ball infobox).
- **Drunk Harold's jingle:** a drunk Harold pays out after "You lose!" with Bad Roll (93), as both recordings show.
- **Recorded differences, not followed:** the stone balls come back 8 ticks after a pickup in both recordings (1001800 ticks 24484-24539),
  where the Wiki says 10. Every live dialogue line in 1001800 is in the transcript data.
