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
| `Combat.Slayer.js` | The Slayer level needed to attack |
| `Checks.Slayer.js` | The enchanted gem's and slayer ring's Check |
| `Rewards.Slayer.js` | The Slayer Rewards interface |
| `Equipment.Slayer.js` | Protective gear; kurask and turoth weaknesses |
| `Finishers.Slayer.js` | Rock hammer, bag of salt, ice cooler, fungicide spray |
| `Superiors.Slayer.js` | Superior monsters |

## From the cache

- **`slayer_task` (table 113):** every task: its id (the `slayer_target` varp's value), names,
  the combat level and stats it needs, its extension unlock and range, and the unlock that removes
  it.
- **`slayer_master_task` (114):** each master's tasks with weights and amounts, Konar's areas, and
  the unlock a row needs (Like a Boss for the Boss task).
- **`slayer_area` (115):** Konar's areas: their text ("in the Catacombs of Kourend") and hint.
- **`slayer_task_sublist` (116):** the bosses behind the Boss task.
- **`slayer_unlock` (117):** every unlock: its bit, cost, name and Rewards tab.
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
  Quest for brine rats...). A quest tsps doesn't have yet doesn't block its task, so Mogres
  (Skippy and the Mogres) and Venators (The Blood Moon Rises) aren't in the list;
- not blocked with that master.

A row is picked by weight. Its amount is the row's range, or the extension's range with that
unlock. Konar also picks one of the task's areas. The Boss task picks a boss the player has the
levels for, 3-35 kills (Wiki; in OSRS the player chooses the amount).

### Kills

- **Counting:** a kill counts when the monster counts for the task. Konar's kills must be in her
  area, and Krystilia's in the Wilderness.
- **XP:** a monster's hitpoints in Slayer XP.

### Completing

- **Streaks:** Krystilia's tasks add to the Wilderness streak. Mortimer's add to neither streak.
  All others add to the standard streak.
- **Points:** none for the first four tasks. After that, the master's points (Turael, Aya and
  Spria give none), times 5, 15, 25, 35 or 50 on every 10th, 50th, 100th, 250th or 1,000th task.

### Other rules

- **Turael and Aya** offer to replace a task they wouldn't give, which resets the streak (Wiki).
- **Slayer level:** a monster with a Slayer level can't be attacked below it.

## Captured messages (rsprox captures)

- **Assigning:** "Your new task is to kill # X."
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

## Developer commands

| Command | Does |
| --- | --- |
| `::completetask` | Completes the current task, with its points, streak and messages |
| `::slayerpoints <amount>` | Sets the Slayer points |
| `::clearunlocks` | Locks every Rewards unlock and extension again |
| `::superior` | Spawns the current task's superior beside you |

## Not built

- **Mortimer:** he assigns from his list like the other masters. He has no task choice or
  modifiers, and gives no points.
- **Rewards:** task storage (Store/Unstore). Picking tasks to block from the task list.
- **Equipment and monsters:** the gem's Partner and Log, killerwatts, cave horrors, fever spiders,
  harpie bug swarms and mogres. Zygomites don't regenerate.
