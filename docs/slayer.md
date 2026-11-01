# Slayer

Slayer is built from the cache's own Slayer tables, with the player's state in the client's
Slayer varps, so the cache's scripts (the Rewards interface, the task overlay) read it directly.
The plugin is `server/plugins/skills/Slayer.plugin.js`; its units are in
`server/plugins/skills/slayer/`, and the data the cache lacks is in `server/plugins/skills/data/`.

## Units

| Unit | Does |
| --- | --- |
| `Data.Slayer.js` | Reads the tables below, the masters file and the areas file |
| `State.Slayer.js` | Reads and writes the Slayer varps and varbits; saves them as one snapshot |
| `Tasks.Slayer.js` | Assigning, counting kills, completing, points and streaks |
| `Masters.Slayer.js` | The Assignment, Trade and Rewards options, and the masters' Wiki transcripts |
| `Choice.Slayer.js` | Mortimer's task choice |
| `Combat.Slayer.js` | The Slayer level needed to attack |
| `Checks.Slayer.js` | The enchanted gem's and slayer ring's Check |
| `Rewards.Slayer.js` | The Slayer Rewards interface |
| `Equipment.Slayer.js` | Protective gear; kurask and turoth weaknesses |
| `SlaughterBracelet.Slayer.js` | Bracelet of slaughter effects, shared charges, Check and Break |
| `Finishers.Slayer.js` | Rock hammer, bag of salt, ice cooler, fungicide spray |
| `Superiors.Slayer.js` | Superior monsters |
| `Keys.Slayer.js` | Brimstone and Larran's keys from Konar's and Krystilia's task kills |

## From the cache

- **`slayer_task` (table 113):** every task: its id (the `slayer_target` varp's value), names,
  the combat level and stats it needs, its extension unlock and range, and the unlock that removes
  it.
- **`slayer_master_task` (114):** each master's tasks with weights and amounts, Konar's areas, and
  the unlock a row needs (Like a Boss for the Boss task).
- **`slayer_area` (115):** Konar's areas: their text ("in the Catacombs of Kourend") and hint.
- **`slayer_task_sublist` (116):** the bosses behind the Boss task.
- **`slayer_unlock` (117):** every unlock: its bit, cost, name and Rewards tab.
- **`slayer_master_task.modifier`:** Mortimer's modifiers per task as (id, min, max) triples; a
  negative range (`2,-15,-30`) shortens the task.
- **`slayer_modifiers` (131):** the five modifiers and the Mortimer tasks each needs: Slayer points
  and quantity from the start, clue scrolls at 15, superior uniques at 25, Slayer XP at 40.
- **`slayer_task_choice` (236):** Mortimer's choice, drawn by script 9739 from the
  `slayer_choose_*` varbits, with the amount range and a third choice at 50 Mortimer tasks.
- **NPC param 50:** the task a monster counts for. Mutated bloodveld count for Bloodveld. Each
  task's Slayer level is the most common level among its attackable monsters.
- **Enums 840-842:** the Rewards Buy tab's items, amounts and prices.
- **Scripts:** Slayer Rewards' confirm slots (414, 423, 426), the block costs (823), cancel costs
  (9741), and the block slots' quest point requirements (9738).

## Not in the cache

- **`slayer-masters.json`:** each master's names, requirements and points per task (Wiki, Slayer
  Master), the streak multipliers, the NPCs of the Boss task's bosses, and the sub-tasks whose
  monsters carry their parent's task id (fever spiders, metal dragons, araxytes), and the quests
  each task needs (Wiki, Slayer task).
- **`slayer-areas.json`:** boxes around Konar's areas. A test checks that every Konar task has
  spawns inside each of its areas.
- **`slayer-gear.json`, `slayer-finishers.json`, `slayer-superiors.json`:** protective gear,
  finishing items and superiors, from the Wiki.

## Client state

- **Task:** varps `slayer_count`, `slayer_target`, `slayer_count_original` and `slayer_area`;
  varbits `slayer_master` and `slayer_target_bossid`.
- **Progress:** varbits `slayer_points`, `slayer_tasks_completed` and
  `slayer_wilderness_tasks_completed`.
- **Unlocks:** bits of `slayer_rewards_unlocks`, `..._unlocks1` and `..._unlocks2`, indexed by the
  unlock's bit. The unlock varbits (`slayer_helm_unlocked`, ...) sit on those bits.
- **Blocks:** varbits `slayer_blocked_<master>_1..6` and `_diary`.
- **Combat checks:** varbit `combat_level_reqs_disabled`.
- **Mortimer:** varbits `slayer_modifier_id`, `_value` and `_negative` (the task's modifier),
  `slayer_choose_task_1..3` with `_boss_id`, `_modifier_id`, `_modifier_value` and
  `_modifier_negative`, `slayer_choose_rolled_master`, `mortimer_introduction`; varp
  `slayer_mortimer_tasks_completed`.

They are saved as one snapshot attribute (`slayer:varps`) and sent again on login. The old
plugin's attributes (`slayer:task`, `slayer:points`, `slayer:streak`) are cleared on login, so
old tasks are gone.

## Rules

### Assigning

A master only assigns rows the player qualifies for:

- the task's Slayer level;
- its combat level, unless combat checks are off (Krystilia never checks);
- its stat requirements;
- its required unlock, and no unlock that removes it;
- its quests: any one of them complete (Abyssal demons take Priest in Peril or Fairytale II), or
  only started where the Wiki needs a quest partly done (Dragon Slayer I for the dragons, Olaf's
  Quest for brine rats...). A quest tsps doesn't have yet doesn't block its task, so Venators
  (The Blood Moon Rises) aren't in the list;
- not blocked with that master.

A row is picked by weight. Its amount is the row's range, or the extension's range with that
unlock. Konar also picks one of the task's areas. The Boss task picks a boss the player has the
levels for, 3-35 kills (Wiki; in OSRS the player chooses the amount).

### Mortimer

- **Choice:** instead of assigning, Mortimer rolls two different tasks (three after 50 of his
  tasks), each with one modifier, and opens his choice. Closing it keeps the roll; he offers the
  same tasks until one is picked, and the other masters refuse while it waits (Wiki: "Hmm... It
  appears as though Mortimer has provided you with a task choice, you must go to them in order to
  pick.").
- **Modifiers:** one of the task's, from those the player has done enough Mortimer tasks for, its
  value a multiple of 5 in the task's range (Wiki).
  - Slayer points: the points the task gives on completion (his tasks give no others).
  - Quantity: added to, or taken from, the rolled amount.
  - Clue scrolls: clue scroll drops on the task are that much likelier.
  - Superior uniques: superiors on the task roll their unique tables that much likelier.
  - Slayer XP: kills on the task, superiors included, give that much more Slayer XP.
- **Completing:** his tasks add to his own streak and give their points modifier, with no streak
  multiplier.
- **Talk:** his transcript's assignment opens the choice; after the pick he says the line for the
  task's modifier, then offers tips, cancelling (100 points) or "Okay, great!".

### Superior uniques

A superior rolls two unique tables, each at 1 in (200 - (Slayer level + 55)² / 125) (Wiki,
Superior slayer monster): an imbued heart (1/8), dust battlestaff (7/16) or mist battlestaff
(7/16) from the first, an eternal gem 1/8 of the time from the second. The Wiki also says either
table is equally likely; here each table is rolled on its own. Before the roll the plugin asks
`drops:chance` { player, source: "superior-slayer-monster", rules } and a rule whose pattern
matches one of a table's items multiplies that table's chance (a league's boosted drops,
[server/docs/leagues.md](https://github.com/RSPSApp/tsps/blob/main/server/docs/leagues.md)). Whether a task kill brings a superior at all
is asked first on `slayer:superior-spawn` { player, npc, unlocked, chance }: Bigger and Badder's
bit and 1 in 200, which a listener may unlock or shorten; the toggle-off always holds.

### Kills

- **Counting:** a kill counts when the monster counts for the task. Konar's kills must be in her
  area, and Krystilia's in the Wilderness.
- **XP:** a monster's hitpoints in Slayer XP.
- **Keys (Wiki: Brimstone key, Larran's key):** a kill that counts for a Konar task may drop a
  brimstone key, one for a Krystilia task a Larran's key, at a chance set by the monster's combat
  level (1 in 2,060 at level 1 up to 1 in 50 from level 350 for brimstone; 1 in 1,972 to 1 in 50
  for Larran's). Monsters with a Slayer level are 20% likelier, and Larran's keys a further 15%
  inside the Wilderness Slayer Cave. A superior on such a task always drops its key. The keys are
  on no monster's drop table: `NpcDrops` strips the Wiki's "Konar task bonus" rows, which dropped
  a brimstone key from every superior kill, on task or not.

### Bracelet of slaughter

[Wiki mechanics](https://oldschool.runescape.wiki/w/Bracelet_of_slaughter): while item
`BRACELET_OF_SLAUGHTER` is in the hands slot at the Slayer XP drop, a qualifying task kill has
a 25% chance to preserve the remaining count. Slayer XP, task XP accounting, superior rolls
and drops still run. TzTok-Jad and TzKal-Zuk are excluded. A preserved last kill leaves the task
active; the next kill rolls normally.

Charges belong to the player, shared by every bracelet of slaughter: the persisted attribute
`slayer:slaughter-charges` starts at 30. Only activations spend charges. Replacing, banking,
dropping or trading the bracelet does not reset the pool. The last activation resets it to 30
and removes the worn bracelet, except for a 10% regeneration roll once the Elite Combat
Achievements rewards are claimed from Ghommal (`combat-achievements:tier` answers `claimed`;
reaching the points alone is not enough). Sources: the
[bracelet page](https://oldschool.runescape.wiki/w/Bracelet_of_slaughter) (“the elite Combat
Achievements rewards add a 10% chance for the bracelet to regenerate rather than disappearing”)
and the [Elite rewards list](https://oldschool.runescape.wiki/w/Combat_Achievements#Rewards)
(“10% chance to fully recharge instead of breaking”); the Wiki says rewards are claimed from
Ghommal once the points are reached. Inventory Break consumes that exact
bracelet and resets the pool; Check works in inventory and while worn. Notes and bank
placeholders cannot use either action. This does not implement the expeditious bracelet.

Evidence:

- User-supplied live rsprox capture `slayer/braceletofslaughter.txt`, inspected 2026-10-26:
  11 monster-kill counter increments, nine `slayer_count` decrements (54 to 45), and two
  preserved counts. At ticks 1042 and 1083 the server sends `message_game type=spam`:
  “Your bracelet of slaughter prevents your slayer count from decreasing. It has 26 charges
  left.”, then the same with 25. No `slayer_count` update occurs on those two ticks. The
  implementation sends the captured activation text on the same spam channel, after XP.
- Local `osrs-captures` index: `facts '*slaughter*'` finds the item in 103 recordings but no
  recorded item actions. It provides no Check/Break or terminal-charge transcript.
- Revision 241 cache (`osrs-241_2026-10-20`): item 21183 is the wearable bracelet, 21184 its
  note, 21185 its bank placeholder; inventory actions are Wear/Check/Break/Drop; item param
  451 is the worn Check action. No bracelet-charge varp or varbit exists by those names.
- Check, Break, depletion and regeneration **mechanics** follow the Wiki; their message wording
  (including “It then regenerates itself to full charge!” and singular-charge grammar) is not on
  the Wiki and remains unverified against live captures. No raw logs or
  account details are committed.

Regression coverage extends `server/tests/slayer.test.cjs`: real death handlers and named item
hook dispatch, 25% and 10% boundaries, last-kill XP/count behavior, shared charges, attribute
save/load, exact inventory removal, normal completion after depletion, Jad/Zuk exclusions,
and note/placeholder rejection.

Verification (2026-10-26, branch `fix/bracelet-of-slaughter`): server TypeScript build passed;
`node --test tests/slayer.test.cjs tests/slayer-helmet.test.cjs tests/combat-achievements.test.cjs`
passed all 78 tests. Omitting the bracelet kill-count integration made four new regressions
fail. The worktree client returned HTTP 200 on port 3149 and the game server listened on
43749. Live MCP checks were not completed: the OS rejected the assigned port 49849 with
`EADDRINUSE`, including an independent bind probe. No worktree port was overridden.

### Completing

- **Streaks:** Krystilia's tasks add to the Wilderness streak, Mortimer's to his own. All others
  add to the standard streak.
- **Points:** none for the first four tasks. After that, the master's points (Turael, Aya and
  Spria give none), times 5, 15, 25, 35 or 50 on every 10th, 50th, 100th, 250th or 1,000th task.
  Both numbers are asked first on `slayer:task-reward` { player, master, freeTasks, multiplier }
  (Mortimer's completions ask too): a listener may lower the free tasks or multiply the points
  (a league's tier passive, [server/docs/leagues.md](https://github.com/RSPSApp/tsps/blob/main/server/docs/leagues.md)).

### Other rules

- **Turael and Aya** offer to replace a task they wouldn't give, which resets the streak (Wiki).
- **Slayer level:** a monster with a Slayer level can't be attacked below it.

## Captured messages (rsprox captures)

- **Assigning:** "Your new task is to kill # X."
- **Assignment with a task** (recordings 424, 1445, 2965, 3434 and others): most masters say
  "You're still hunting X; you have # to go. Come back when you've finished your task." Turael
  and Aya say the short "You're still hunting X, you have # to go.", and for a task they wouldn't
  give go on with their transcript's offer to replace it, naming the standard and the Wilderness
  streak ("...standard task streak of 1. ... Wilderness task streak of 13."). Assignment plays that
  branch of their transcript.
- **Krystilia's first task** (recordings 3279, 3434): Assignment starts with her Wilderness warning
  ("Before I assign you anything, ..."), her transcript's branch for a player who has never had a
  Wilderness task.
- **Slayer level:** "You need a higher Slayer level to know how to wound this monster."
- **Completing:**
  - "You have completed your task! You killed # X. You gained # xp."
  - the points line ("You've completed # tasks and received # points, giving you a total of #");
  - the free-task line ("...will need # more before you start receiving Slayer points");
  - the line for masters that give no points.
- **Gem Check:** the streak line.
- **Finishing items:** the gargoyle's "The gargoyle cracks apart." and the zygomite's "The Zygomite
  is covered in fungicide. It bubbles away to nothing!"
- **Superiors:** "<col=ff0000>A superior foe has appeared...</col>"
- **Mortimer** (recording `mortimer-and-task-completion`):
  - Assignment with no task: the `slayer_choose_*` varbits and `slayer_choose_rolled_master`, then
    `slayer_task_choice` on the main modal, with `PAUSEBUTTON, OP1` on each offered slot (0, 10,
    20). No dialogue.
  - Closing it keeps the roll; opening it again sends nothing new.
  - Picking (resume_pausebutton on `content`, the choice's slot): the modifier varbits, the task with
    its rolled count, then the count with the quantity modifier; the choice varbits cleared; "Your
    new task is to kill 183 Aberrant Spectres."; the choice closes; then the tips / cancel (100
    Points) / "Okay, great!" menu.
  - Completing: `slayer_mortimer_tasks_completed` and `slayer_points` on the last kill's tick, then
    "You've completed 2 Mortimer tasks and received 5 points, giving you a total of 195; return to
    a Slayer master."
- **Rewards interface:**
  - opening it: `slayer_master_in_focus`, varps `if1`-`if3` (the task's count, id and boss), and
    the `if_setevents` ranges;
  - the task list popup (script 8059);
  - the block confirmation popup (script 4212).

Konar's lines and the gem's task line are the Wiki's.

## Ours

- **Below a master's requirements:** the master's line.
- **Assembling a Slayer helmet without the unlock:** the message.
- **Drains:** where the Wiki only says "greatly reduced", unprotected drains take 10% of the level
  per hit.
- **Gem:** its Activate gives the same answer as Check.
- **Mortimer:**
  - which modifier a choice gets: any of the unlocked ones, equally likely; every choice has one;
  - the completion line for a task without a points modifier ("You've completed # Mortimer tasks;
    return to a Slayer master.");
  - the line for the Slayer XP modifier (the Wiki has none);
  - cancelling from his menu works like the Rewards interface's cancel (the Wiki has no text).

## Developer commands

| Command | Does |
| --- | --- |
| `::completetask` | Completes the current task, with its points, streak and messages |
| `::slayerpoints <amount>` | Sets the Slayer points |
| `::clearunlocks` | Locks every Rewards unlock and extension again |
| `::superior` | Spawns the current task's superior beside you |
| `::slayertask <amount> <task>` | Sets a task outright |
| `::mortimertasks <amount>` | Sets how many Mortimer tasks are done (modifier unlocks, third choice) |

## Not built

- **Mortimer:** Partner Slayer's rules for his tasks; showing modifiers on the gem. His tips are
  the generic line, as for the other masters.
- **Rewards:** task storage (Store/Unstore), including a stored task's modifier. Picking tasks to block from the task list.
- **Equipment and monsters:** the gem's Partner and Log, killerwatts, cave horrors, fever spiders,
  harpie bug swarms and mogres. Zygomites don't regenerate.
