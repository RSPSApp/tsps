---
quest: Prince Ali Rescue
key: prince_ali_rescue
status: passed-with-issues
tested: 2026-11-07
tester: agent
model: claude-opus-5-5
commit: 756db7e10 + fix/prince-ali-live-capture
cache: osrs-241_2026-10-20
start: checkpoint
travel: travel_to
---

# Prince Ali Rescue

A watched account with the quest unstarted finished the Wiki route: Hassan, Osman, the
Draynor disguise, the jail key print smelted at the Lumbridge furnace, Joe, Lady Keli, Prince
Ali, Hassan's reward, a repeat talk, and a relog. `travel_to` blocked on the Broken Raft both
ways across the river and went around it on the next call.

## Findings

- **open** `travel_to` Jump-to on Broken Raft 17070 at 3253, 3180, and later 17069 at 3252,
  3180, returned blocked with "You can't reach that!". The next call routed around the raft.
  The Al Kharid toll gate still worked: 10 coins at stage 20, free passage at stage 100.

## Live capture

A full live run recorded with RSProx (revision 242.1, 2026-11-06, file sha256
`63491fb1fe6f160446a0e7a811c706cf3154f478ffbcb825177757f5023e08d1`; the raw log stays out of Git)
sets varp 273 0, 10, 20, 30, 31, 40, 50, 100, 110. Facts the plugin relies on:

- **Key.** Smelt on the Lumbridge furnace 24009 (3226, 3256) with the key print and a bronze bar
  plays anim 899 and gives Bronze key 2418 and 2 Crafting XP, with no prompt or message. Osman is
  never visited for the key and the stage stays 20.
- **Leela.** Met for the first time with the disguise, key and rope: "You must be Leela...", "Yes,
  he sent word ahead...", "Yes. In fact, I already have everything we need.", then "Good work..."
  (stage 30).
- **Joe.** Three beers in one talk: one beer (stage 31), "That was perfect!", then straight to
  "Would you care for another beer, my friend?" and the other two (stage 40).
- **Keli and Prince Ali.** Rope on Keli and the Prince's escape each update the stage and
  inventory 3 ticks after their message box.
- **Hassan.** The completion update adds the 700 coins and removes the bronze key.

## Runs

### 2026-11-07 · agent · claude-opus-5-5

- **Start:** checkpoint. A new account set to stage 20 with `::quest prince ali rescue 20` at the
  Lumbridge furnace. Declared setup: 2 key prints and 2 bronze bars, then a blonde wig, pink
  skirt, skin paste, rope, 3 beers and 100 coins.
- **Route:** Smelt on furnace 24009 made the key at the next tick with +2 Crafting XP and no
  prompt; using the second print on the furnace did the same. Smelt with only iron ore still
  opened the make-x menu (270). `travel_to` Leela: the captured first-visit lines, stage 30. Joe,
  three beers: the captured lines with no "Not too drunk?" question, stage 40. The server
  restarted here (dialogue import); the relogged account kept stage 40 and its items. Rope on
  Lady Keli: stage 50 and the rope gone 3 ticks later. Prison Gate 2881 opened; Prince Ali took
  the disguise and left the keys, stage 100 3 ticks after the box.
- **Result:** Hassan completed the quest: stage 110, quest points 0 to 3, coins 100 to 800, and
  one bronze key taken (2 to 1). After relog: stage 110, varp 101 = 3, 800 coins.
- **Also checked:** with one beer, Joe asks "How are you? Still okay? Not too drunk?" and answers
  "No, I don't get drunk from only one drink..." (stage 31). Aggie's skin paste offer reads the
  captured "Yes, I can. I see you already have the ingredients - the water, flour, ashes and
  redberries...".
- **Not checked:** a fresh start from stage 0, Osman making the key, Leela's replacement key, the
  return visit to Leela, and the Quest Helper overlay.


### 2026-10-29 · agent · grok-4.7

- **Start:** fresh. Varp 273 = 0, quest points varp 101 = 0, empty inventory and equipment.
  Every skill was already 99 (13,034,431 XP). Placed at 3301, 3163 with `::tele` (the only
  teleport). Declared setup before the baseline: soft clay, 3 balls of wool, 2 onions,
  redberries, ashes, a jug of water, a pot of flour, a bronze bar, a pink skirt, 3 beers, and
  150 coins. The user watched in their own client.
- **Route:** Hassan, "Is there anything I can help you with?" then "Yes." Stage 10, varp 10.
  `travel_to` to Osman opened large door 1511. Both follow-up questions, then leave. Stage 20,
  varp 20. `travel_to` to Ned blocked on the raft, then paid the toll (Gate 44050, 10 coins)
  and arrived. Ned made Wig 2421 from the wool. His rope shop sold Rope 954 for 18 coins.
  Aggie's door 1535 opened. Yellow dye 1765 cost 2 onions and 5 coins; skin paste 2424 took
  the ashes, flour, water and redberries. Dyeing the wig made Wig 2419. Jail door 1543 opened.
  Lady Keli's key dialogue turned the soft clay into Key print 2423. Lumbridge furnace 24009
  at 3226, 3256 asked "Create a key using the key print?"; Yes consumed the print and bronze
  bar, gave Bronze key 2418, and added 2 Crafting XP (13,034,431 to 13,034,433). Stage stayed
  20. Leela, with the disguise, key and rope, set stage 30. Joe drank all three beers in one
  talk (stage 40). Rope on Lady Keli set stage 50 and consumed the rope. Prison Gate 2881 at
  3123, 3243 opened into the cell. Prince Ali took the wig, paste and skirt and left the key;
  stage 100, varp 100. The return opened that gate, blocked on the raft again, then opened
  Gate 44050 with no toll and large door 1513.
- **Result:** Hassan completed the quest. Stage 110, varp 273 = 110, quest points 0 to 3,
  coins 117 to 817. The scroll read 3 Quest Points, 700 Coins, and free passage through the
  Al Kharid gate. A second talk ("Thank you for being a friend to Al Kharid. You are always
  welcome here.") added nothing. After relog: stage 110, varp 273 = 110, varp 101 = 3, 817
  coins, the bronze key, and Crafting XP 13,034,433.
- **Not checked:** Osman making the key, Leela's 15-coin replacement key, Ned's 15-coin rope
  dialogue, a full inventory, losing the key or disguise, jail-guard combat, and the Quest
  Helper overlay. Ingredients, beers and the skirt were spawned, not gathered.

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
- **PRs:** [#1152](https://github.com/RSPSApp/tsps/pull/1152).
