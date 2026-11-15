# The Fremennik Trials

Server: `server/plugins/quests/quests/FremennikTrials.Quest.js`.

## Peer the Seer's entrance door

The west door of Peer's house (`viking_seers_door1`, loc 4165 at 2631,3667) has a combination
lock under a riddle plaque. Facts from rsprox captures 1001646 (rev 241, ticks 2931-3101) and
1002236 (rev 242, ticks 9896-10024):

- Open shows a message box: "There is a combination lock on this door. Above the lock you can
  see<br>that there is a metal plaque with a riddle on it.", then the menu "What would you like
  to do?" with Read the riddle / Solve the riddle / Forget it.
- Forget it: "You leave the riddle for later."
- Read the riddle: two message boxes (the four letter lines, then "My whole ...<br>What am I?"),
  then the lock opens. Solve the riddle opens the lock at once.
- The lock is `seer_combolock` (298), an if1 modal: script `toplevel_mainmodal_open` (-1, -1),
  then the modal, with each wheel's letter (`seera`..`seerd`, 298:43-46) set to "A" first.
  `seerX_left` steps a wheel back a letter (A to Z, Y, X ...), `seerX_right` forward; the server
  answers each click with the wheel's new letter.
- `seerenter` (298:56) closes the lock with "You have solved the riddle!" or "You have failed to
  solve the riddle.". Solving does not move the player.
- Opening the door after solving lets the player in, with `door_open` (synth 62).

Riddles: MIND (1002236) and WIND (1001646) as the captures show them. LIFE, TIME and TREE are from
the Wiki's Transcript:The Fremennik Trials. FIRE's transcript lines repeat "the sea" and "mountains",
so its lines come from the riddle table on the quest page.

Ours:

- Each player's riddle is rolled once and kept (`quest.fremennik_trials.seer_riddle`). No
  recording shows how live picks it, but 1001646 read the same riddle three times in 100 ticks.
- The door's open animation is not shown. Live briefly swaps in `inviswall` (38848) at the door
  and `viking_door_inactive` (4249) at 2631,3666 for two ticks. The player is moved inside instead.
- The `busy` varbit (12393) that live sets during the plaque and lock is not sent.
