# Streak info noticeboard

`server/plugins/objects/StreakInfo.plugin.js` handles `Read` on Edgeville's Streak info
noticeboard (`target_noticeboard`, loc 37434, at 3096,3506,0). It opens the target streaks board
(`target_streaks`, interface 648).

The Wiki (Streak info): a noticeboard with "the player's Target World streaks", tracking "the
current streak of a player, as well as their best streak", "broken down between Hunter kills and
Rogue kills". Target Worlds were removed on 24 May 2023 (Wiki, Bounty Hunter), and this server
never had them, so every player's streaks are 0.

## Capture facts (rsprox captures)

- 232/03212 tick 2261: Read clicked from a few tiles away; the player walks up to the board
  (arrives tick 2263). At tick 2265 the server runs `toplevel_mainmodal_open` (2524) `[-1, -1]`,
  opens `target_streaks` as the main modal, then writes `target_streaks:hunter` (648:7) and
  `target_streaks:rogue` (648:8), each `<col=ffb83f>0</col><br>0` (current in orange, then best).
- No message, animation, sound or busy varbit goes with it. Closing it is a plain
  `if_closesub` (tick 3230).

## Recorded differences

- Ours: the board opens on the server's normal arrival timing for a loc op, which may be a tick
  sooner than the two ticks after arrival recorded in 232/03212.
