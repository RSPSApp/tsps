# Boss Kill Log

`server/plugins/interface/KillLog.plugin.js` draws the Boss Kill Log (interface `kill_log`, 549).
It opens from the ring of wealth's **Boss Log** (worn option, or the Rub submenu) and from the
**Boss log** entry of the POH adventure log's "The Exploits of <owner>" menu. Plugins open it with
`kill-log:open { player, owner?, log: "boss" }`.

## What live sends (rsprox captures 2905 and 1001169, rev 230)

- The adventure log menu's sub 1 ("Boss log") opens `kill_log` as the main modal.
- `IF_SETEVENTS` on `kill_log:reset` (549:16), slots 0 to rows - 1, op 1.
- Script `killcounts` with the row names, the kill counts, the streaks, the row count, the title
  `Boss Kill Log` and `true`. The capture has 71 rows, listed in
  `server/plugins/interface/data/kill-log.json`.
- A streak can differ from its kill count (Barrows Chests 325 / 316, Wintertodt 720 / 81). Rows
  that were never reset show the same number twice. The four Awakened rows show
  `<col=9f9f9f>---</col>` as their streak.
- Clicking a row's Reset Streak sends `kill_log:reset` with the row as its slot and gets no reply.
  The client shows the confirm box itself. Cancel Reset (549:27) gets no reply either (rsprox 2906).
  No capture shows a Confirm Reset.

## The rev 242 cache

- `killcounts` is script 9525 (1584 through rev 237). It takes one int and four objects: the
  names as a `stringarray`, the kills and the streaks as `intarray`s, and the title. An int of 1
  gives each row its "Reset Streak" op.
- Script 9527 writes kill counts with commas, and `Lots! (…+)` at the maximum int. Script 9528
  writes a negative streak as `---`, and a streak of 65,535 or more as `Lots!`.
- Script 1587 opens the "Reset streak:<br><boss>" box. For an Awakened row it says "The Awakened
  version of a boss shares its streak with the standard version." and opens no box.
- `RUNCLIENTSCRIPT` sends array arguments as type 3 (int array) and type 4 (string array): a type
  byte, a u16 length, then the values. They reach the VM as `Cs2ArrayObject`s on the object stack.
- Script 9525 copies its names whole with `array_copy` and a length of -1. In the VM, a negative
  length copies the rest of the source, just as a negative bound means the array's edge in
  `array_fill_sequence`. Before this change the VM threw, and the log stayed empty under the
  cache's placeholder title "This is a title!".

## Ours

- Each row's kill count is the owner's cache kill-count varp (`total_*_kills`,
  `total_completed_*`, the `*_awakened_kills` varps). The boss plugins and Combat Achievements
  set these varps, and they are what the boss pages read.
- A streak counts the kills since the last Confirm Reset. Before any reset it equals the kill
  count. A standard row's streak includes its Awakened row's kills, and Awakened rows send -1.
- Confirm Reset redraws the log. No capture shows the server's reply.
- A visitor reading someone else's adventure log sees the owner's counts, but gets no Reset
  Streak op and no `IF_SETEVENTS`.
- Bosses released after rev 230 are not rows, because no capture shows where live puts them. The
  Wiki notes that the log lacks some recent bosses, such as the Mad Angel and the Maggot King.
