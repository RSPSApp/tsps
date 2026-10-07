# Achievement diaries

The diary framework lives in `server/plugins/diaries/`, and its data is `server/data/definitions/achievement-diaries.json`. It covers:
- progress and the diary tab;
- every diary's task list;
- claiming rewards from all 12 diary NPCs;
- the reward lamps;
- an admin command.

**What's not here yet:** no task is wired to gameplay. Follow-up PRs make existing plugins complete tasks, one diary at a time, and add the reward items' effects.

## Completing tasks from a plugin

```js
// Marks the task done (once); request.completed tells whether it was new.
api.emitCustomEvent("diary:task", { player, diary: "ardougne", task: "steal-a-cake-from-the-ardougne-market-stalls" });

// For effects: is a tier finished?
const request = { player, diary: "ardougne", tier: "hard" };
api.emitCustomEvent("diary:is-complete", request); // request.complete
```

- **Diary keys:** `karamja`, `ardougne`, `falador`, `fremennik`, `kandarin`, `desert`, `lumbridge`, `morytania`, `varrock`, `wilderness`, `western`, `kourend`.
- **Task keys:** the task's text in lower case with dashes, cut at 48 characters, as listed in the data file.

## Admin command

| Command | What it does |
| --- | --- |
| `::diary <name>` | Shows each tier's progress |
| `::diary <name> <easy\|medium\|hard\|elite\|all> complete` | Completes the tier(s) task by task, with the messages and the tier-complete box |
| `::diary <name> <tier\|all> reset` | Clears the tier(s), claimed rewards included |

Names match like `::quest`: a key or name in any case, or a unique part of a name.

## From the captures

The rsprox captures cover opening every diary, completing ten Ardougne easy tasks, claiming the reward from Two-pints, and logging in afterwards.

**Completing a task** sends, on one tick:
1. The game message `<col=dc143c>Well done! You have completed an easy task in the Ardougne area. Your Achievement Diary has been updated.</col>`.
2. The tier's count varbit + 1 (`ardougne_easy_count`, 6291).
3. On a diary's first task, its started varbit.

OSRS also sets one bit per task in a varp (Ardougne: 1196/1197). No cache script reads those bits, so progress is kept server-side and the varps aren't sent.

**The tier's last task:** 3 ticks later, the tier's complete varbit is set (Karamja's legacy easy to hard tiers use the value 2), and a message box says "Congratulations! You have completed all of the easy tasks in the Ardougne area. Speak to Two-pints at the Flying Horse Inn in Ardougne to claim your reward."

**The task list** opens when a row of the diary tab (259:2, slot = the diary's index in cache enum 595) is clicked. The server:
1. sets `pagepos` (varp 334) to the line count and `busy` (12393) to 1;
2. runs script 6844;
3. writes the title (741:2) and every line (741:4 onwards):
   - tier headers are yellow, or green once the tier is done;
   - finished tasks are `<str>`, open ones `<col=000000>`;
   - each claimed tier gets the reminder "If I ever lose my … I can speak to …";
4. runs script 2524, opens the journal scroll (741) as the main modal, and runs script 6845 with the line count.

Each diary's layout differs slightly (blank lines, Kourend's `</col>` endings), so the data file keeps the captured lines around each tier. The test rebuilds all 12 captured lists line for line.

**When the side journal mounts the tab,** the rows get OP1 and OP2 (`if_setevents` on 259:2, slots 0–11).

**On login,** each diary's started, count, complete and reward varbits are sent, only those that are set.

**Claiming (Two-pints):**
1. The player: "I've completed all of the easy tasks in my Ardougne achievement diary!"
2. Two-pints: "I can see that, well done! You'll be wanting your reward then!"
3. The player: "Yes please!"
4. The reward varbit (`ardougne_easy_reward`, 4499) = 1, then Ardougne cloak 1 and an easy lamp, then the reward speech, "Wow, thanks!" and "If you ever lose your cloak, come back to me to reclaim it."

## Varbits

Script 56 reads started and complete; script 2200 reads count, the total and reward.

| Diary | Started | Count (easy–elite) | Complete | Reward |
| --- | --- | --- | --- | --- |
| Karamja | 3576 | 2423, 6288, 6289, 6290 | 3578, 3599, 3611 (= 2), 4566 | 3577, 3598, 3610, 4567 |
| Ardougne | 4448 | 6291–6294 | 4458–4461 | 4499–4502 |
| Falador | 4449 | 6299–6302 | 4462–4465 | 4503–4506 |
| Fremennik | 4450 | 6303–6306 | 4491–4494 | 4531–4534 |
| Kandarin | 4451 | 6307–6310 | 4475–4478 | 4515–4518 |
| Desert | 4452 | 6295–6298 | 4483–4486 | 4523–4526 |
| Lumbridge & Draynor | 4453 | 6311–6314 | 4495–4498 | 4535–4538 |
| Morytania | 4454 | 6315–6318 | 4487–4490 | 4527–4530 |
| Varrock | 4455 | 6319–6322 | 4479–4482 | 4519–4522 |
| Wilderness | 4457 | 6323–6326 | 4466–4469 | 4507–4510 |
| Western Provinces | 4456 | 6327–6330 | 4471–4474 | 4511–4514 |
| Kourend & Kebos | 7924 | 7933–7936 | 7925–7928 | 7929–7932 |

## Rewards

**From the Wiki:**
- **Items:** each tier gives "<diary item> 1–4" plus a lamp.
- **The lamps:** easy 2,500 XP (skill at least 30), medium 7,500 (40), hard 15,000 (50), elite 50,000 (70). Karamja's easy to hard tiers give Karamja's own lamps instead: 1,000 (any level), 5,000 (30) and 10,000 (40).

**The claim conversations** come from each NPC's Wiki transcript, stored per tier in the data file. Claiming works like this:
- **Which tier:** the lowest finished, unclaimed tier, as long as every lower tier is finished. Otherwise Talk-to plays the NPC's transcript as before.
- **Skill requirement:** Ardougne's elite reward needs 91 Smithing, per its transcript.
- **Reclaiming:** the transcript's "<NPC> gives you another …" line hands back the highest claimed tier's item, if the player owns none.

## Lamps and the xpreward interface

Every lamp (the genie's lamp and the diary lamps) uses OSRS's "Choose the stat you wish to be advanced!" interface (xpreward, 240), through `server/plugins/interface/XpReward.plugin.js` and the `xpreward:open` event. As captured rubbing a genie's lamp:

| Step | What happens |
| --- | --- |
| Rub | `busy` = 1; varp 261 (the lowest level a skill can be chosen at; the diary lamp's level) and varp 262 (the skills offered, one bit each from enum 81, all set; a clear bit gives "This skill is not available.") are set; 240 opens as the main modal with its 24 skill slots (240:0) as pause buttons, and the title is written on 240:26 |
| Choose and confirm | Client-side (cache scripts 3804/3806/3809). Only the confirmed slot reaches the server, as a resume on 240:0; slot + 1 is a key of enum 681, which gives the stat. Enum 680 names it ("Runecraft") |
| The reward | A message box ("Your wish has been granted!<br>You have been awarded 980 Runecraft XP!" for the genie's 10 × level), sound 2655, the interface closed; `busy` = 0 when the box is dismissed |

## Unverified

- **The NPC locations in the tier-complete box and the reminder.** Only Ardougne ("Two-pints at the Flying Horse Inn in Ardougne") and the Karamja, Morytania and Western reminders are captured; the rest follow the Wiki's description of where the NPC stands.
- **Messages this server writes itself:**
  - "You need 2 free inventory spaces to claim your reward."
  - "You don't need another … right now."
  - the diary lamps' message box, "You have been awarded … XP!" (the genie lamp's is captured).
- **The task message's area name for the other diaries:** "… in the Kourend & Kebos area."
