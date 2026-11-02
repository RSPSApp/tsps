# Combat Achievements

Combat Achievements live in `server/plugins/achievements/combatachievements/`. The 655 tasks, their tiers, points, monsters and the tier rewards are read from the cache. A player's finished tasks, claimed tiers, kill counts and the interfaces' last view are persisted per player.

## What finishes a task

- **Kill-count tasks finish themselves.** A task whose description is only a target and a count ("Kill the King Black Dragon 10 times.", "Open Obor's chest once.", "Kill a Black Dragon.") gets its target from the description. 160 tasks work this way. A kill counts for its monster when an NPC of that name dies with the player as killer. Content that isn't one NPC's death (Barrows chests, the Wintertodt, the Gauntlet, raids, the Fight Caves) is counted by its plugin through `combat-achievements:kill`.
- **Fight rules derived from the descriptions.** For the phrasings the cache repeats, the rule comes from the description too: "Kill Vorkath in less than 54 seconds.", "... without a slayer task.", "Kill Skotizo without taking any damage.", "... without taking any damage from her.", "... with only magical attacks.", "... with the Protect from Melee prayer activated.", "... solo.", "... using only special attacks.", "... without equipping any weapon.", "... with a stab weapon." The description has to be exactly one of these. A fight is timed from the first hit either way to the death (`Fights.CombatAchievements.js`, `DerivedRules.CombatAchievements.js`); this covers 34 tasks.
- **Hand-written fight rules** for a few bosses, in `combatachievements/tasks/<Unit>.CombatAchievements.js`: the Barrows brothers, Bryophyta, Obor, the Kalphite Queen, the Giant Mole, the Dagannoth Kings and Vorkath (melee only, fists only, the zombified spawn without magic).
- **Content plugins finish their own tasks**, as diaries do with `diary:task`, from a `CombatAchievements.<Plugin>.js` unit in their folder:

| Content | Tasks |
| --- | --- |
| Wintertodt | count, Why Fletch?, Cosy, Leaving No One Behind, Can We Fix It?, Mummy!, Handyman |
| Gauntlet / Corrupted | counts, speed, 3-2-1, Perfect Hunllef, Defence Doesn't Matter, Egniol Diet, Wolf Puncher, perfected armour |
| Fight Caves | count, speed, Facing Jad Head-on, No Time for a Drink, the Tz-Kih, Yt-MejKot and Yt-HurKot tasks, A Near Miss! |
| Inferno | count, speed, Half-Way There, The Floor Is Lava, Nibblers Begone!, Wasn't Even Close, Budget Setup, Nibbler Chaser, Facing Jad Head-on II, Jad? What Are You Doing Here?, No Luck Required, Playing with Jads |
| Chambers of Xeric | counts per mode, deathless raids, Solo, Trio and 5-scale speed tasks, Dust Seeker, Putting It Olm on the Line, and every room task: the Ice Demon, Crabs, Tightrope, Tekton, Muttadile, Vanguards, Vasa, Vespula, Guardian and Shaman tasks, Perfect Olm, A Not So Special Lizard |
| Tombs of Amascut | counts per mode and Entry-or-above, raid level, deathless raid level, Hardcore Raiders/Tombs, Resourceful Raider, the three speed runners |
| Doom of Mokhaiotl | depth (3, 8, 16), Doom Crawler, Doom Chaser, Doom Racer; count = delves completed |
| Fortis Colosseum | count, speed (total of every wave), One-off, Reinforcements |
| Barrows | chest count, Pray for Success, Faithless Crypt Run, Can't Touch Me |
| Obor, Bryophyta | chest counts, Fighting as Intended (I and II) on a free-to-play world |
| Zulrah | count, speed (off a slayer task), Perfect Zulrah, Snake. Snake!? Snaaaaaake! |
| Vorkath | speed (timed from her waking), Faithless Encounter, The Walk, Dodging the Dragon and Extended Encounter (kills in a row without leaving her area; her specials' damage) |
| Araxxor | count, the three speed tasks (N kills in 10:00 in one stay), Perfect Araxxor (I and II), Relaxxor, Let it seep in, Araxyte Betrayal, Arachnid Lover, Swimming in Venom |
| Skotizo | counts, Demonic Weakening, Demonbane Weaponry, Up for the Challenge, Demon Evasion, Precise Positioning |

That's 345 of the 655 tasks: Easy 27/41, Medium 40/64, Hard 40/89, Elite 95/166, Master 84/173, Grandmaster 59/122. Most of the rest belong to content this server doesn't have yet (the Theatre of Blood, the Nightmare, the Desert Treasure II bosses) or need a boss's own mechanics reported (ToA's rooms, Doom's grubs, the GWD instances).

From another plugin:

```js
api.emitCustomEvent("combat-achievements:complete", { player, task: "Perfect Zulrah" });   // name or id
api.emitCustomEvent("combat-achievements:kill", { player, monster: "Barrows", count });     // count: the plugin's own, optional
// The request comes back with `total`, the count it now holds; announce(total), when given, runs
// before any task finishes, so the plugin's kill-count message comes first (live's order).
api.emitCustomEvent("combat-achievements:kill", { player, monster: "Araxxor", count, announce: (total) => tell(total) });
api.onCustomEvent("combat-achievements:kill-count", ({ player, counts }) => { counts.Zulrah = kills(player); }); // at login
api.onCustomEvent("combat-achievements:personal-best", (request) => { request.best = bestTicks(request.player); });
api.onCustomEvent("combat-achievements:reset-best", (request) => { /* ... */ request.handled = true; });
```

Monster names are the cache's (enum 3970): "Zulrah", "DK: Rex", "Nightmare, The". The login kill-count answer is what makes kill-count tasks retroactive, as the Wiki says they were.

**Admin command:**
- `::ca complete <task name|id>` finishes a task through the real path;
- `::ca kc <monster> <n>` sets a kill count;
- `::ca reset` clears everything.

## The cache

| What | Where |
| --- | --- |
| Tasks | Enums 3981–3986, one per tier → task struct: 1306 id, 1308 name, 1309 description, 1310 tier (1–6), 1311 type (enum 3968), 1312 monster (enum 3970) |
| Tier rewards | Enum 3980 → struct: 1330 name, 1333 antique lamp, 1335 Ghommal's hilt, 1337–1339 the unlocks it shows |
| Bosses list | Enum 3987 → struct: 1313 name, 1315 monster, 1317 its coordinate (Locate) |
| Completion | Task N is bit N % 32 of `ca_task_completed_0..20` (varps 3116–3128, 3387, 3718, 3773, 3774, 4204, 4496, 4721, 5673; script 4834) |
| Boss kill counts, tasks done per boss | Scripts 4778 and 4780, one switch on the monster each: `yarn dump:ca-bosses` writes them to `plugins/achievements/combatachievements/data/bosses.json` |

A task is worth its tier in points. A tier unlocks at all the points of its own tasks and the tiers below: 41 / 169 / 436 / 1100 / 1965 / 2697 in our rev 241 cache, the same values live sent at login in the capture. Grandmaster is every task.

## From the captures

The rsprox captures used (https://rsprox.net/database): a 2026 capture of the interfaces being browsed, and recordings 3285 (rev 234), 1158 and 1107 (rev 237, Leagues VI) and 1693 (rev 226) for task completions and a tier being claimed.

**Login** sends every set value: the task varps; per tier `ca_tier_status_*` (0 locked, 1 unlocked, 2 claimed), `ca_lamp_claimed_*` and `ca_total_tasks_completed_*`; per boss `ca_total_tasks_completed_<boss>`; `ca_points` (14815); the six `ca_threshold_*`; and the view varbits (filters, `ca_boss_selected`, `ca_last_opened_interface`).

**A task finished**, all on one tick:
1. its `ca_task_completed_*` varp, its tier's count, `ca_points`, its boss's count, and the tier's status when the points cross its threshold;
2. `CA_ID:<id>|Congratulations, you've completed an elite combat task: <col=0cc919>{name}</col> (4 points).` The `CA_ID:` prefix is from rev 234 on; chat script 84 strips it and gives the line a "View" option;
3. on an unlock: `You've completed enough Combat Achievement tasks to unlock Easy Tier rewards! You can now claim your rewards from Ghommal.` (the captures were Leagues and Grid Master worlds naming their own NPCs; Ghommal is ours);
4. the popup: `notification_display` (660) and script 3343 `["Combat Task Completed!", "Task Completed: <col=ffffff>{name}</col> (4 points)", 14733725]`, with jingle 76 (4,974 ms). It closes 13 ticks later, and a waiting popup opens 2 ticks after that. Popups queue through `plugins/interface/Notifications.plugin.js` (`notification:show`), which the collection log uses too. `ca_task_popup` (varbit 12455) = 1 is taken as "no popup"; popups showed while it was 0.

**The interfaces**, all opened as the main modal (161:16). From the account summary (712:3, row 5, op1) the last screen used opens, after script 2524 `[-1, -1]`. The burger menu (slots 10 Overview, 12 Tasks, 14 Bosses, 16 Rewards) closes one screen and opens the next. Each sets `ca_last_opened_interface` (17940): 0 overview, 1 tasks, 2 rewards, 3 bosses, 4 boss.

| Screen | Group | Events (OP1 unless noted) | Clicks |
| --- | --- | --- | --- |
| Overview | 717 | burger 17 (12–16), tiers 8 (0–5) | a tier: Tasks at that tier (`ca_task_filter_tier` 12858 = tier; the monster filter cleared) |
| Tasks | 715 | tier 30 (1–8), completed 33 (1–4), type 31 (1–8), monster 32 (1–93), list 9 (0–655), burger 25 (10–16) | dropdown sub N → its filter varbit (12858 tier, 12859 type, 12860 monster, 12861 completed) = N − 1; a task row is the client's |
| Bosses | 716 | burger 23 (10–16), list 15 (0–71, pause button + OP1) | a boss (resume, sub = its position): `ca_boss_selected` (12862), its personal best in varp 261 (−1 "N/A"), then its page opens without closing the list |
| Boss | 713 | burger 27 (10–16), stats 23 (0–1), progress bar 24 (0) | "Boss list" (stats 0): every count re-sent, then Bosses; "Reset time" (stats 1); progress bar: Tasks filtered to the boss; "Locate" (713:9): the world map, then script 3331 `[595:3, coord, -1]`; "Collection-log" (713:13): the boss page closes and the log opens at its category |
| Rewards | 714 | burger 16 (10–16), tiers 17 (0–5) | a tier: `ca_last_reward_tier_selected` (17941) |

A collection log boss's **Combat Achievements** button (621:21) closes the log and opens that boss's page. There's no capture of that click, so the order is inferred.

**Claiming a tier** (rec 1107, from the Leagues tutor; Ghommal's lines are his Wiki transcript, already in `npc-dialogues.json`):
- "Can I claim some combat achievement rewards?" → "I've completed some more Combat Achievement tasks!" → "You'll be expecting your easy rewards?" → "Yes please!".
- Continuing past "Yes please!" sets `ca_tier_status_easy` 1 → 2 and `ca_lamp_claimed_easy` 0 → 1, and the inventory gets the antique lamp and Ghommal's hilt 1 as "There you go..." opens.
- Rubbing the lamp opens `xpreward` with varp 261 = 20 (its level), and the box says "<col=0000ff>Your wish has been granted!</col> You have been awarded 5,000 Runecraft experience!".
- Lamp experience and levels per tier are from the Wiki: 5k/20, 10k/30, 15k/40, 25k/50, 35k/60, 50k/70. Master also gives Ghommal's lucky penny (Wiki).

Ghommal plays the transcript's "combat-achievement-rewards" variant while a tier waits. Its conditions are answered here: the lowest waiting tier, and whether the inventory has room.

## Not modelled

- **Tasks for content this server doesn't have,** and the per-boss mechanics no plugin reports yet (see above).
- **The tier perks** (better clue chances, Slayer, GWD, cannon and Pest Control boosts, the hilts' teleports and the slayer helmet recolours). They belong to their own plugins.
- **Replacing lost rewards** at Ghommal, and handing in an older hilt.
- **The Combat Achievements settings** (`ca_failure_notifications_enabled` and the rest) and failure messages.

## Reward claim parity (26 October 2026)

- Both Ghommal and his post-While Guthix Sleeps replacement Laidee Gnonock run
  their canonical reward variants. All initial tiers work at the appropriate NPC;
  this does not implement the separate lost-hilt reclaim interface.
- Native confirmation retains the original nearby, registered reward NPC
  context. Death, trade, placement, teleport, forced movement, ownership changes
  or leaving the conversation's range cannot grant a delayed bundle.
- The lamp/hilt/penny bundle is planned in a real copied Inventory before either
  inventory or tier entitlement changes. Exact-fit bags work; failed bundles stay
  unclaimed. Master still includes the nonstackable lucky penny.
- Lamp confirmation rechecks the earned tier, exact item object/ID/slot, metadata,
  life/status/movement and skill requirement. Logout clears pending requests;
  refused XP keeps the lamp. Successful consumption requests a persistence save.
- Six new real-object native tests cover Ghommal tiers1–5, Laidee tiers1–6, duplicate
  continuation, full/exact-fit bags, delayed state changes, item replacement and
  logout. Together with the existing framework tests, the focused suite passes26.
- Independent Codex review found no gameplay blocker within this phase. It asked
  to narrow an inherited comment equating all worlds with a League recording; the
  comment now attributes only the observed LeagueVI tutor packet behavior.
- Sources: RSProx237/01107 for the Easy claim and lamp; current Wiki
  [Laidee Gnonock](https://oldschool.runescape.wiki/w/Laidee_Gnonock),
  [Ghommal](https://oldschool.runescape.wiki/w/Ghommal), and
  [Antique lamp](https://oldschool.runescape.wiki/w/Antique_lamp) for normal-world
  roles and reward rules. No generated dialogue/index data was edited.

Reclaim UI, current lucky-penny consumption/charge effects and other tier perks
remain separate follow-ups; this phase does not certify the whole tracker item.

Native worktree checks: the prepared QA account claimed Easy and then the remaining tiers through Ghommal’s complete canonical conversation, used its earned lamp for exactly5,000 Runecraft XP, and retained inventory/tier/XP state after relog. This uses a prepared completion-bit state, not a natural completion of655 tasks. The live walkthrough caught a lazy dialogue condition reading a cleared claim after the grant; its new regression fails before the fix and passes after it. The successful result is retained only until that condition is consumed, so the success text no longer becomes a false no-space warning. Codex re-review cleared it.

Natural post-quest Laidee access is a separate data gap: the shipped generated spawn still uses an obsolete ID (13647), which resolves to an unnamed/no-option NPC on the active241 cache. Native unit tests use the correct cache named NPC; this PR does not certify that spawn. Repair through the canonical spawn generator is still needed; no generated JSON was hand-edited.

Final complete suite after the real dialogue regression and legacy thrall fixture update:8,670/8,670 pass,0 failures/skips (node --test --test-concurrency=4 tests/). All owned native QA worlds are stopped.
