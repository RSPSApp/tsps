# Brimhaven Dungeon back entrance (Banisoch)

The hole west of Tai Bwo Wannai that leads down to the bronze dragons in the Brimhaven Dungeon.
Code: `server/plugins/areas/brimhavendungeon/Backdoor.BrimhavenDungeon.js` (part of the
`BrimhavenDungeon` plugin). Tests: `server/tests/brimhaven-backdoor.test.cjs`.

## Sources

- rsprox captures: local recording 1002134 (revision 242): talking to Banisoch and paying
  (ticks 5793-5837), the first Climb with his warning (5832-5843), and Climb with the warning
  turned off (8373-8377, 10114).
- OSRS Wiki: Banisoch, Brimhaven Dungeon, Transcript:Banisoch (npc-dialogues.json "Banisoch").

## Captured behaviour

- `karam_dungeon_backdoor` (varbit 5629, varp 393 bits 1-2): 0 unpaid, 1 paid, 2 paid with the
  warning turned off. It turns Banisoch (npc 424) into `karam_dungeon_backdoor_unpaid` or
  `_paid`, and the hole (loc 66) from `brimhaven_backdoor_disabled` ("Hole", no options) into
  `brimhaven_backdoor_enabled` ("Rope", Climb). The varp also carries Saniboch's
  `karam_dungeon_entryfee` and `_permanentaccess`: `karam_dungeon_doordata` read 2 after paying
  and 4 after turning the warning off.
- Paying: "It's a deal - here's 5,000 trading sticks." then, on its continue, the varbit to 1, the
  sticks taken (5,100 became 100), sound `slug_dry_sticks` (3023), and a double item box with
  `village_trade_sticks4` and a rope: "You pay 5,000 trading sticks. Banisoch adds a climbing rope
  to the hole for you."
- Climb at varbit 1: Banisoch (paid head, `chatshifty2`): "I think there's dragons down there.
  Make sure you're prepared.", then "Select an option": Enter the dungeon. / Enter, and don't see
  this warning again. / Stay out. The second sets the varbit to 2. On the answer the fade out
  (script 948, 0→255 over 15 cycles), a tick later the move to 2734,9478,0 with sound `tightrope`
  (2495), two ticks after that the fade back in (50 cycles) and the overlay closed the same tick.
- Climb at varbit 2: the same fade, move and fade back in, the fade out a tick after the click.

## Ours

- The crevice (`brimhaven_backdoor_exit`, Use, at 2734,9477) is not captured. For a player who has
  paid it leaves to 2760,3061,0, the tile the recording climbed down from, with the same fade and
  sound. For one who hasn't (the Wiki: the fee is needed "either entering or exiting") it does
  nothing of ours, so the default "Nothing interesting happens." stays.
- Using items on the hole (a rope before paying, anything on the rope after) plays the
  transcript's line for it; not captured.
