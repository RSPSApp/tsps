# Shantay Pass

The Shantay Pass is handled by `server/plugins/areas/ShantayPass.plugin.js` and its units in `server/plugins/areas/shantaypass/`:

- `Gate.ShantayPass.js`: the gate, its warning, the gate guard and the billboard
- `Shantay.ShantayPass.js`: Shantay's pass and his transcript's conditions and actions
- `Jail.ShantayPass.js`: his jail and the Port Sarim cell
- `UnkahGuard.ShantayPass.js`: the passes the Ruins of Unkah guards sell

Shantay's conversations are the Wiki transcript in `server/data/definitions/npc-dialogues.json` ("Shantay"), played by `NpcDialogues`. `server/tests/shantay-pass.test.cjs` covers the gate, the warning, the conditions and the pick-lock chance.

Behaviour comes from rsprox captures ([rsprox.net/database](https://rsprox.net/database) recordings 321–329, 1203, 1694 and 1788). Recording 323 is a full session of Shantay's dialogue, jail and Port Sarim cell. Requirements come from the [Wiki](https://oldschool.runescape.wiki/w/Shantay_Pass).

## The gate

The gate is loc 4031 "Shantay pass", 4×1 at 3302–3305, 3116.

**Going south takes a Shantay pass.** Ticks count from the player arriving north of the gate:

| Tick | What live sends |
| --- | --- |
| +1 | "The guard takes your Shantay Pass as you go through the gate." The pass goes, and the player steps onto the gate's row |
| +2 | A step into the desert |
| +3 | Facing south |

- **Without a pass**, the gate guard (NPC 4648) says at +1: "You need a Shantay pass to get through this gate. See Shantay, he will sell you one for a very reasonable price."
- **The elite Desert Diary** lets a player through without a pass (Wiki).
- **Going north is free**, with no message.
- **The guard's "Pass" option** does the same crossing from wherever the player stands north of the gate. The plugin walks them to the gate first.

**The desert warning.** Interface 565, `cws_warning_10`, opens at +1 (script 2524 `[-1, -1]`, then the modal) until the player turns it off. Each showing counts varbit 3860 up to 6. From then on, the "Don't ask me this again" layer (565:21) is shown. Clicking it sets 3860 to 7 with "You have toggled this warning screen off. You will not see this warning screen unless you speak to the Doomsayer in Lumbridge to turn it on again.", and the warning doesn't open again. "Proceed regardless" (17) crosses; "Stay out" (18) closes it.

**Desert robes.** Crossing south wearing a desert shirt, robe and boots completes the easy Desert Diary task "Enter the Desert with a set of Desert robes equipped." Live credits it on the second step.

**Look-at** reads the billboard as three message boxes:

1. "You look at the huge stone gate. Near the gate is a large billboard poster, it reads:"
2. The poster, in dark red.
3. "Despite this warning lots of people seem to pass through the gate."

Not implemented: the desert heat timer that starts on the second step south (`buff_bar_desert_heat_timer_iteration`, varbit 13137). tsps has no desert heat yet.

## Shantay

- **Buy-pass** (op4) and "I want to buy a Shantay pass for 5 gold coins." take 5 coins and show the pass in an item box: "You purchase a Shantay Pass."
  - With fewer than 5 coins: "Sorry friend, the Shantay Pass is 5 gold coins. You don't seem to have enough money!"
  - On free-to-play worlds: "Sorry effendi, I can't offer this service right now."
- **His greeting** is "Hello effendi, I am Shantay." the first time, then "Hello again friend…". The first greeting is remembered.
- **"Why do I have to pay to go into the desert?"** is answered after the message "Shantay opens his arms wide as if to embrace you.", then offers the shop or "I must be going.".

The Wiki transcript's export had folded the "inexperienced" and "adventurer" answers into the fine menu. This branch now follows the captures.

## The Ruins of Unkah guards

The two Shantay Guards in the Ruins of Unkah (NPC 10634, `tempoross_pass_guard`) sell passes too. Their conversation is the Wiki transcript "Shantay Guard (Ruins of Unkah)"; their shop is the Shantay Pass Shop. From rsprox.net recordings 327 (rev 230) and 1437 (rev 224):

- **Buy-pass** (op4) takes 5 coins and opens the pass item box, "You purchase a Shantay Pass.", on the same tick, with no lines first.
- **"I want to buy a Shantay pass for 5 gold coins."** does the same after the guard's "Absolutely, friend.".
- **With fewer than 5 coins** the guard says "Sorry friend, the Shantay Pass is 5 gold coins. You don't seem to have enough money!" (Wiki transcript). No recording has Buy-pass without the coins; it plays the same line here.
- **With no room for a pass**, nothing is taken: "You cannot hold any more Shantay passes.", as with Shantay.

`server/tests/shantay-unkah-guard.test.cjs` covers these with a real player, NPC and dialogue.

## The jail

- **"I am definitely an outlaw, prepare to die!"** is answered with "Ha, very funny....." and "Guards arrest him!" (or her), then the message "The guards arrest you and place you in the jail." Three ticks later the player is in the cell west of Shantay (3296, 3124), and Shantay asks for the fine.
- **The prison door** (loc 2692, 3297, 3124):
  - While jailed: "This door is locked." and "Shantay saunters over to talk with you.", then the fine again.
  - Unlocked: each "Open" steps the player one tile through while the door swings open (an invisible wall on its tile and the open door, loc 1548, east of it; sound 71). It closes two ticks later.
- **Paying the fine** sends "You hand over five gold pieces to Shantay." and "Shantay unlocks the door to the cell.".
- **Without the coins**, Shantay offers the bank, which opens the next tick. Ultimate Ironmen and players without 5 banked coins are sent to Port Sarim.
- **Refusing twice** ("No, do your worst!") sends the player to Port Sarim. So does refusing the bank: "Very well, I grow tired of you, you'll be taken to a new jail in Port Sarim."

**Port Sarim.** A fade out; two ticks later the player is in the cell at (3014, 3180); a tick after that the fade lifts.

Its door (loc 9565, 3014, 3182):
- "Open": "The door seems to be fairly well locked."
- Pick-lock from outside: "You simply cannot find a way to pick the lock from this side."
- Pick-lock from inside: each attempt sends "You attempt to pick the lock on the door.". On success, "You pick the lock on the prison door.", and the player steps out while the door swings open (sounds 52 and 71). A failed attempt plays `human_openingchest_mid` (2094) with sound 2402, and the next attempt is 11 ticks later.

**Pick-lock chance and XP.** The Wiki gives 4 Thieving XP on success and 0.5 on failure, members' worlds only. The chance is Mod Ash's (quoted on the Wiki): 0% at level 1 to 39% at 99 for the first try, rising with each failure to 82% / 127%. With a lockpick it is 23% / 117%, rising to 106% / 206%. The rate it rises at isn't published; this server reaches the top after four failures.

**Escapes.** Leaving either cell without paying, by the Port Sarim lock or a teleport, counts as an escape. Shantay then answers "What is this place?" with "You should be in jail!…", and the prison door gets the same line. The transcript doesn't say whether this ever wears off, so it doesn't here.

**Not captured.** The "No, do your worst!" lines, and "You find yourself in a prison." after them, are from the Wiki transcript.
