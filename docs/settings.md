# Settings and level-up notifications

`server/plugins/interface/Settings.plugin.js` applies clicks in the All Settings interface (`settings`, 134). `server/plugins/interface/SkillLevelUp.plugin.js` sends the level-up feedback and follows the "Level-up pop-up notifications" setting.

The behaviour comes from rsprox captures of live OSRS: a capture of All Settings (every row below clicked through), and level-ups from the shared capture index (`levelup_display` in 70 recordings, revisions 223–235, for example recordings 907, 908, 944 and 379; pop-ups disabled in 23 rev 237 recordings, for example 1098, 1102, 1104, 4055). Ids are checked against the rev 241 cache.

## All Settings

The client only reports the click. The server sets the variable and sends it back.

- **The setting list.** Enum 422 lists the categories, each category's param 745 its setting structs in row order. A setting struct carries its id (param 1077), its type (param 1078: 0 toggle, 2 dropdown, 3 key, 9 colour) and its dropdown's option enum (param 1091). A row's slot is its index in the category shown, or, in search results, its index across every category in turn (search result 301 is setting 315).
- **Selected setting** (`settings_selected_setting`, varbit 9657). A row click sets it to the setting's id, toggles included. Choosing a dropdown option, closing the dropdown (`settings:dropdown_close`, 134:26) or clicking a category sets it to 0.
- **A search result clicked** also sets `settings_category` (9656) to the setting's category. The search stays open.
- **A category clicked while searching** ends the search: `floater_is_searching` and `floater_search_listen_for_keyboard` go to 0, the category and selection are sent, then script 2158 (`chatdefault_restoreinput`) runs, as when All Settings closes.
- **Reopening** All Settings shows the category shown last; live sends nothing for it.
- **A toggle** flips its variable between 0 and 1, on the same tick as the selection.
- **A dropdown option** (`settings:dropdown_buttons`, 134:29, three components per option, so option = slot / 3) sets its variables, then clears the selection.

`server/plugins/interface/data/settings.json` maps setting ids to their variables. A toggle or a dropdown with one varbit names it (a dropdown sets it to the option's index). A dropdown that sets several lists them per option. Every value chosen, and the category shown (`settings_category`, which live also keeps), is saved in the `settings:values` attribute and sent again on login. Another plugin can still claim a row first through `settings:setting-clicked` (RunAutoEnable does).

| Setting | Id | Variable |
| --- | --- | --- |
| Hide roofs | 7 | varbit 12378 `option_hide_rooftops` |
| Hitsplat tinting | 5 | varbit 10236 `hitsplat_tint_disabled` |
| Max hit hitsplats | 279 | varbit 14196 `hitsplat_maxhit_disabled`; the client swaps hitsplat types 43-47 for the ordinary ones by it |
| Show boss health overlay | 10 | varbit 12389 `hpbar_hud_boss_disabled` |
| Show enemy name on health overlay | 299 | varbit 14706 `hpbar_hud_boss_name_disabled` |
| Max hit hitsplats threshold (number) | 280 | varbit 14195 `settings_hitsplat_threshold` (9 bits), set by `MaxHitThreshold.plugin.js` from an enter-amount prompt; PlayerSession sends type 43 (red) or 46 (yellow) for a rolled max hit the player dealt that is at least the threshold |
| Health overlay display type (dropdown) | 301 | varbit 14708 `hpbar_hud_boss_percentage_enabled` = option |
| Compact boss health overlay | 300 | varbit 14707 `hpbar_hud_boss_compact_enabled` |
| Last Man Standing fog colour (dropdown) | 81 | varbit 11865 `br_custom_fog_colour` = option |
| Clue scroll warnings, Beginner to Elite | 374–378 | varbits 10693, 10694, 10695, 10723, 10724 |
| STASH units take equipped items | 451 | varbit 17938 `option_hidey_holes_equipped` |
| 'Did you know?' tips | 433 | varbit 16235 `settings_didyouknow_disabled` |
| Update clan 'last seen' records | 431 | varbit 16118 `clan_disable_lastseen` |
| Show chat effects | 34 | varp 171 `option_chat` |
| Split friends private chat | 35 | varp 287 `option_pm`, then script 83 `splitpm_changed` |
| Chat timestamps (dropdown: Off, On (Server time), On (Local time)) | 119 | varbit 12384 `settings_chat_timestamps` = option, then script 4586 `settings_chat_timestamps`; a fresh account starts Off (live sends 1, server time, at login in 532 of 540 rsprox recordings) |
| Enable precise timing | 82 | varbit 11866 `option_precise_timing` |
| Combat Achievement Tasks - Repeat completion | 160 | varbit 12456 |
| Collection log - New addition notification | 85 | varbit 11959 bit 0 (owned by the collection log plugin) |
| Collection log - New addition popup | 171 | varbit 11959 bit 1 (owned by the collection log plugin) |
| Player Trade options | 312 | varbit 6580 `tradeoption_disabled` |
| Player Report options | 372 | varbit 1334 `rightclick_report_abuse_disabled` |
| PK Skull Prevention | 206 | varbit 13131 `skull_prevent_enabled` |
| Side panel can be closed by the hotkeys | 54 | varbit 4611 `hotkey_cannot_close_sidepanel` |
| Player Attack options (dropdown) | 55 | varp 1107 `option_attackpriority` = option |
| NPC Attack options (dropdown) | 56 | varp 1306 `option_attackpriority_npc` = option |
| Scroll wheel can change zoom distance | 13 | varbit 6357 `camera_zoom_mouse_disabled` |
| Enable profanity filter | 37 | varp 1074 `option_chatfilter_disabled` |
| Shift click to drop items | 51 | varbit 11556 `desktop_shiftclickdrop_enabled`; a fresh account starts with it on (live sent 1 at login in all 8 transcribed rsprox recordings). The login script (876, via 7431) passes it to `setshiftclickdrop` on desktop; with Shift held the inventory item's shift-click op is its top entry |
| Ammo-picking behaviour | 305 | varbit 5697 `take_ammo_toggle`; the Ranged combat tutor's toggle writes the same setting, which is authoritative. A pre-Settings tutor choice saved on the old `ranged:equip-ammo-on-pickup` attribute is migrated into this row at login unless a setting is already saved |
| Sailing side panel (dropdown) | 454 | varbit 18131 `settings_sailing_side_panel_onlyonboat` = option |
| Level-up pop-up notifications (dropdown) | 315 | see below |
| Level-up chatbox list | 493 | varbit 20158 `option_level_up_chatbox_list` |
| Level-up guide list | 494 | varbit 20159 `option_level_up_guide_list_disabled` |

"Level-up pop-up notifications" (options from enum 2513):

| Option | `option_level_up_message_disabled` (20157) | `option_level_up_popup_list` (4371) |
| --- | --- | --- |
| Disabled | 1 | 0 |
| Show level only | 0 | 0 |
| Show level & unlocks | 0 | 1 |

The keybind dropdowns (ids 16–29) set their key varbits as before, then clear the selection.

The Controls tab's `settings_side:skull_prevention` toggle (116:5) flips the same varbit as its All Settings row 206, and is saved and restored with the other settings.

The attack options are also dropdowns on the side panel's Controls tab (`settings_side:attack_priority_player_buttons` 116:38 and `attack_priority_npc_buttons` 116:39). Live sends op1 on their option rows 1–5 and 1–4 at login, and a click sets the varp straight to the option (slot − 1) on the same tick, as the All Settings rows do. Options from enums 3993 and 3991: 0 depends on combat levels, 1 always right-click, 2 left-click where available, 3 hidden, and for players 4 right-click for clanmates.

## Rows the client scripts already apply

These rows only needed wiring: the cache's own scripts (or our client and server code) already act on their variable. Each variable is the one the cache's setting reader returns for the row: script 6716 for toggles and 3962 for dropdowns, each a switch on the setting id. `tests/settings-wired-rows.test.cjs` reads both scripts from the cache and checks every row against them, then that a click flips or sets it and a login brings it back.

| Setting | Id | Variable | What acts on it |
| --- | --- | --- | --- |
| Chat box scrollbar position (dropdown: Right, Left) | 1 | varbit 6374 `chatbox_scrollbarside` = option | chatbox scripts |
| Transparent side panel | 2 | varbit 4609 `side_transparency`; a fresh account starts with 1 (all 9 Tutorial Island logins in the rsprox captures send it) | side panel scripts |
| Show the remaining XP for a level in the stats panel | 3 | varbit 4181 `option_hidexptolevel` | stats tooltip |
| Show prayer tooltips | 4 | varbit 5711 `option_prayertooltips` | prayer book |
| Show special attack tooltip | 6 | varbit 5712 `option_satooltips` | special attack bar |
| Show Wiki entity lookup | 9 | varbit 10113 `wiki_icon_disabled` | orbs' Wiki button, our client's wiki plugin |
| Hide private chat when the chatbox is hidden | 36 | varbit 4089 `hide_pm_alongside_chatbox` | chat scripts |
| Friend Login/Logout messages (dropdown: Timeout, On, Off) | 44 | varbits 12274 `loginlogout_setting` and 1627 `loginlogout_permanent`, see below | chat scripts |
| Enable separating hours | 83 | varbit 11890 `option_separate_hours`, on varp 2856 with precise timing (82) and the collection log rows (85, 171): the click is matched with the client's varp transmission as for those | timer scripts |
| Modern Layout - Side panel visual appearance (dropdown: Stone Border, Steel Border) | 86 | varbit 12135 `side_container_steel` = option | side panel border (script 4127) |
| Show attack style | 123 | varbit 12352 `attack_style_enabled` | HUD layout (4731) |
| Leagues: Display Relics | 127 | varbit 12383 `buff_league_relics_hidden` (1 hides them) | buff bar |
| Show mouseover text | 147 | varbit 10035 `mouseover_text_disabled`, see below | our client's top-left text, HUD layout (4731) |
| Highlight Agility obstacles | 164 | varbit 12380 `agility_helper_highlight_obstacles_enabled` | our client's obstacle highlight |
| Chatbox Mode - Set Automatically | 195 | varbit 13120 `option_chatbox_mode_autoset` | chat input (script 73) |
| Hide minimap icons when zoomed out | 265 | varbit 14179 `option_minimap_icons_max_zoom_disabled` | `minimap_seticonzoomlimit` (6463, 6465) |
| Precise combat level | 311 | varbit 14806 `combat_level_decimal_enabled` | combat tab |
| Ignore List - Remove permanently banned / muted accounts daily | 313, 314 | varbits 8059 `purgeignored_permbanned_disabled`, 8060 `purgeignored_permmuted_enabled` | nothing: there are no permanent bans or mutes |
| Options on the compass for orienting the camera also set its vertical angle | 362 | varbit 15323 `compass_reorientation_setheight` | compass (script 1050) |
| Leagues: Display Combat Masteries | 418 | varbit 11562 `buff_league_masteries_hidden` (1 hides them) | buff bar |
| Always show chat filters | 430 | varbit 16116 `settings_mobile_show_filter_stones_enabled` | chat filter buttons (scripts 113, 178, 3179) |
| Enable interface resizing and repositioning | 442 | varbit 17772 `settings_interface_resizing` | resizable interfaces |
| Disable colourful fade effects | 460 | varbit 18132 `settings_colourful_fade_disabled` | Barracuda Trials |
| Modern menu interface, and its transparent background | 472, 473 | varbits 19615 `settings_new_menu_interface`, 19646 `settings_new_menu_transparent_interface_disabled` | menu scripts |
| Rune pouch loadout name tags | 474 | varbit 19647 `settings_runepouch_loadout_names_disabled` | rune pouch |
| Quetzal whistle - Default to hunter guild | 476 | varbit 19681 `settings_quetzalwhistle_default_tp` | the whistle's Signal (`Whistle.Quetzals.js`) |

- **Friend Login/Logout messages.** Script 4487 shows `loginlogout_permanent` when it is set, else `loginlogout_setting`; the chat script (84) reads only `loginlogout_permanent`, for the message timeout. Timeout sets both to 0, Off sets the setting to 2. Ours: On sets both to 1, so the chat script sees it too (no capture has On; live logins send `loginlogout_setting` 2, Off, in 3225 of 4281 recordings).
- **Show mouseover text.** Login sends the saved value, 0 for a fresh account (it used to force 0). The top-left text and HUD overlays laid out by script 4731 (Wintertodt, ToA...) follow it when they are laid out: with the text on they sit 23px lower, with it off at the top.
- **Disable colourful fade effects.** Barracuda Trials' "Yes" to its effects question sets this row through `settings:set`. A per-trial "effects off" flag saved before the row existed moves into the setting at the next login.
- **Not done**:
  - Show data orbs (8, varbit 4084 `orbs_disabled`): live also leaves the orbs interface (160) closed while it is set and opens it when the player turns them back on (rsprox 229/2375 tick 8), which needs server work.
  - Friend Login/Logout messages: the server sends no friend login or logout messages yet, so Off has nothing to stop.
  - Disable colourful fade effects does not change Guardians of the Rift, which keeps its own `gotr_colourful_fade_disabled` (the barrier's Visual-effects option).
  - Cache scripts 518, 2518 and 3231 (the buff bar's own toggles) also flip the relic and mastery varbits, in the client alone, so a change made there is not saved.

## Level-ups

All on the tick the level is gained:

1. **Message:** `Congratulations, you've just advanced your <Skill> level. You are now level <n>.` At 99 it is `Congratulations, you've reached the highest possible <Skill> level of 99.` instead.
2. **Graphic:** `levelup_anim` (199), or `levelup_99_anim` (1388) at 99, at height 124.
3. **Sounds:** area sounds 2396, then 2384 with a 25-cycle delay, at the player, range 1.
4. **Total level:** on passing a multiple of 25, `Congratulations, you've reached a total level of <n>.`
5. **Pop-up**, unless set to Disabled: script 2379 (`toplevel_chatbox_resetbackground`), then `levelup_display` (233) in the chatbox modal with `<col=000080>Congratulations, you just advanced a <Skill> level.`, `Your <Skill> level is now <n>.`, `Click here to continue`, and only that skill's icon shown.

With pop-ups disabled, players kept skilling and fighting straight through their level-ups (one recording has 539 in a row). With pop-ups enabled, SkillLevelUp emits `level-up:popup-opened` `{ player, skill, pause }`; skilling plugins retain their current session and pause its progress. Continuing the last queued skill/combat notification resumes that session with its remaining resources and work. Moving, starting another action, closing/replacing the popup, dying or logging out cancels it. Resume-on-Continue follows issue #1071's requested behavior; the captured popup packets remain unchanged.

World owners can set `"SkillLevelUp:interruptActions": false` in world.json's `pluginConfig` (or world.local.json) to keep actions running on level-up. This skips the blocking skill/combat pop-ups while retaining chat messages, total-level announcements, graphics and sounds. The default is `true`, which follows the player's existing pop-up preference. Restart the server after changing the world configuration.

**Combat level.** A tick after the skill's level-up: `Congratulations, you've just advanced your Combat level. You are now level <n>.` with the same graphic and sounds. With pop-ups on, its pop-up comes when the skill's is continued: `<col=000080>Congratulations, you just advanced a combat level.` (or `<n> combat levels.`), `Your combat level is now <n>.`, with the combat icon (233:55 in rev 241).

## Not done yet

- **"Show level & unlocks"**: continuing opens a box per level with what it unlocked, straight after that skill's pop-up and before a queued skill's or a combat level's (rsprox 223/00014: Attack's box, then the combat pop-up). As live sends it: a `mesbox` chat line with the box text, the pop-up's skill icon hidden, `toplevel_chatbox_resetbackground` (2379), then `objectbox` (193, one picture: `ItemStatementDialogue`) or `objectbox_double` (11, two: `DoubleItemStatementDialogue`) at zoom 400. The text is server-side and comes from the Wiki's level-up transcripts (`plugins/interface/data/level-up-messages.json`), generated by `server/scripts/dump-level-up-messages.cjs` (`--check` fails if the committed file is stale). The pictures are obj gamevals in `plugins/interface/data/level-up-pictures.json`; Sailing has all 80 levels there (71 from rsprox captures, the rest the skill guide icon of each picture the transcript shows). Other skills' levels use the generated `items` ids instead: a level with a single unlock whose transcript picture names a cache item (resolved by exact cache item name); pictures that are not items, or whose wiki name the cache renamed, keep the plain message box (229). Not done: the box text's `<col=000080>` highlights (the dumper strips the Wiki's `{{Colour}}` spans), and the box's `mesbox` lines for a lamp's several levels go out together when the first box opens.
- **Level-up chatbox list**: with "Show level & unlocks" on (and pop-ups shown), the unlock text goes to the chat only as the box's `mesbox` line, as live (no capture has a plain "You can now..." game message on a level-up). A level-up given up before its box opens (walking, using an item, logging out, dying) sends the lines as chat messages instead, for the open pop-up's skill and any queued ones (ours), so they are never lost. Otherwise the same lines go to the chatbox on the level-up tick. Varbit 20158 is stored but does not gate them: no capture shows what it sends, so this is our reading of the setting, not a recording.
- **Level-up guide list**: still not done; nothing lists unlocks in the skill guide.
- **Jingles.** Done: each skill plays its `advance <skill>` jingle (cache gamevals index 24 kind 18); the `...2` one plays on levels that unlock something unless the guide list is disabled (varbit 20159). Hitpoints/Strength switch at 50, Construction every 10th, Hunter on odd levels (the Wiki's Even/Odd order is the only evidence), Sailing at 99, combat 299 with the combat message.
- **Player Trade and Report options**: live also sends `set_player_op` (4 "Trade with", 8 "Report") or removes them. The tsps client builds those menu entries itself, so only the varbits are set.
- **Sailing side panel**: live also sets `sailing_sidepanel_visible_from_combat_tab` (19153) from the option. Sailing sets that varbit itself when boarding and leaving.
- **Other colour pickers** (type 9, for example Public chat colour) are not handled; quest-list colours are supported below.

## Quest list preferences (cache 241)

Settings at `399:11` opens native All Settings (`134`) on Interfaces (category6,
struct3621 / enum4025). Quest List occupies rows38–55. Button scripts5996 →3944
→3945 only play a sound; the server owns opening the modal. Authored mappings in
Settings.plugin.js are independent of generated JSON. Cache structs3107/3108/3110/
3599/3744/3751–3755/4286/2735 and reader6716 establish setting ids214–223,239,240
and varbits13772–13781,13889–13890. Enums4244/4245/4246 define twelve sorting
modes, three requirement choices and Small/Large.

Quest DB table0 supplies metadata through named gameval columns. Regression tests
verify every registered quest has a cache record. Requirements use registered quest
completion, cache stat pairs, quest points and combat level. Recommended stats and
combat are a separate filter. Quest stages and level-ups refresh active filters.
Classic separates Free Quests, Members' Quests and Miniquests. All twelve sorting
modes rebuild the same server slot mapping; tied names use quest keys. Hidden
headers reserve no slots. Old flags are cleared and clicks use the last sent snapshot.

The renderer reads text/shadow settings and colour varps, recomputes row heights,
scroll extents and dragger bounds, and preserves the native scrollbar. CS2 2633 uses
fonts494/495 for small/large. Reader4181 maps settings224/225/226/227 to varps
3410/3409/3411/3412, stored as RGB+1; zero selects the struct default. The server
mounts native colour modal288 in134:2 and calls4185. Scripts4208 →4209 →614
return RGB via resume_countdialog;2147483647 cancels and -1 selects default.
Amount replies allow zero/negative only when the prompt opts in; plugin validation
accepts -1..0xffffff. Setting228 resets all four colours. Preferences persist through
the existing settings:values framework and restore on login/remount.

Verification: settings/quest suites412passed, existing quest-list/runtime smokes,
client rendering/scrollbar tests, server build, client typecheck/production build.
Native acceptance: at the isolated worktree URL open Quests →Settings, scroll
Interfaces to Quest List, change sorting/filter, close and open row journals. Choose
Large, disable shadows, choose a colour (including black), reset and relog. Use the
worktree ports; leave the main play world running.

## Notification and warning rows

These rows show, save and resend the player's choice (`data/settings.json`; cache check in `tests/builtin-warning-settings.test.cjs`). **Most do not change anything in game yet.** In the osrs-dumps client scripts, the drop warning (5411/5412), loot notification (5399/5400/5402), Grand Exchange price warning (14700/14701) and Alchemy value (6091) varbits are read only by the settings scripts themselves; on live the server shows those warnings, and tsps does not read the varbits yet. The other rows below were not traced to a reader either.

- **Toggles** (flip 0/1): loot drop notifications (38, 40), spam-filter boss kill counts (41), drop item warning (42), Combat Achievement popup and failure notifications (159, 161, 162), logout notifier (185), bird nest (189), cannon low/out of ammo (248, 250), High Risk lever / Ferox / canoe warnings (254, 308, 309) and the canoe warning (256), Grand Exchange buy/sell price warnings (297, 298), Poison Karambwan (370), Plank Make confirmations (420-423), farming patch digging (446), birdhouse seeds (448), Sailing charting popups, cargo and boat teleport warnings (456, 463, 467, 469, 471) and the Leagues stepping-stones teleport (500).
- **Defaults** are what the 703 default-state logins in the rsprox captures (rev 235+, drop-warning value 150000) have: on for 38, 40, 42, 161, 297, 420, 423; off for the rest. Thresholds: drop warning 150000 (43), loot notification 10000 (39), Alchemy warning 20000 (66).
- **Alchemy threshold** (66) asks "Set value threshold for alchemy warnings:" (rsprox 338, 3275); `AlchemyWarningThreshold.plugin.js` saves the answer through `settings:set`. Nothing reads it yet: `castAlchemy` only confirms untradeable items.
- **Not done**:
  - Using the values: the drop warning (nothing checks 5411/5412 when an item is dropped), the loot drop notifications, the Grand Exchange price warnings and the Alchemy value check before the untradeable confirm.
  - The drop-warning (43) and loot-notification (39) threshold prompts (no capture of their text).
  - The respawn timer dropdowns (187, 188), the "enable/disable all" tablet and Wilderness teleport buttons (74-77) and the Sailing drop-item warning (465, default differs between captures).
  - Rows already handled elsewhere: teleport spells 60-64, levers 253, Ferox 255, drink crate 455.

## Rows that switch existing behaviour

Each of these rows is a plain toggle (`data/settings.json`). The plugin that owns the behaviour reads the varbit when it acts, so a change applies from the next time. A row whose cache struct has param 1084 is ticked while its varbit is 0. New accounts start with every one at 0, as live sends none of them at login (161 aside, which is on). Tests: `tests/settings-gates.test.cjs`, plus the area suites named below.

| Setting | Id | Varbit | With the varbit at 1 |
| --- | --- | --- | --- |
| Warning on digging up a farming patch | 446 | 17797 `settings_farming_dig_disable_warning` | Dig-up clears the patch without "Are you sure you want to dig up this patch?" |
| Show warning on taking a canoe to the Wilderness | 256 | 13988 `wildy_canoe_warning` | The waka goes into the Wilderness without the one-way-trip question |
| Bank Deposit Box item quantity check | 424 | 15958 `bank_depositbox_oplocu_askquantity` | An item used on a deposit box deposits all of it, without "How many would you like to deposit?" (a full bank keeps them, as Bank.deposit does) |
| Disable Phantom Muspah messages | 302 | 14711 `settings_muspah_messages` | No darkness, prayer shield or corruption lines in the fight (`Common.PhantomMuspah.fightMessage`) |
| Iron loot restriction messages | 183 | 13040 `iron_noloot_message_disabled` | No "you might not receive kill-credit" or shared-kill loot line for an Ironman |
| Filter out boss kill-count with spam-filter | 41 | 4930 `boss_killcount_filtered` | Boss kill-count lines go to the spam channel, which the chatbox's Game filter hides (ours: no capture shows the setting on). Every boss sends them through `interface/BossKillCount.plugin.js`; a test fails on one sent any other way |
| Combat Achievement Tasks - Failure | 161 | 12454 `ca_failure_notifications_enabled` | (on by default) "You have failed <task>: <reason>" for tasks not yet done; at 0, no failure lines. Content reports failures with `combat-achievements:failed` { player, task, reason } |
| Combat Achievement Tasks - Repeat failure | 162 | 12457 `ca_refailure_notifications_enabled` | Failure lines for tasks already done too, while 161 is on |
| Charting popups | 456 | 18142 `settings_sailing_charting_popup` | Charting is told in chat only, with no "Charting Complete!" popup |
| Make-X barbarian potions | 373 | 5983 `settings_barbarian_potion_makex` | A barbarian mix offers the Make-X menu; at 0 (default) it is made one at a time |
| Deep Wilderness lever default option | 296 | 14674 `wilderness_lever_first_op` | Landing in the Deserted Keep with the easy Wilderness Diary sets `wildoutlever_vis` to 2: Edgeville first (rsprox 4155) |
| Current duck hint arrow | 458 | 18133 `sailing_current_duck_hintarrow_disabled` | No hint arrow (or `current_hint_arrow`) over a released current duck |
| Barracuda trials hint arrow | 459 | 18134 `sailing_barracuda_trials_hintarrow_disabled` | No hint arrow over the trial's rum or toad boat. The intro tour's arrows stay |
| Combat task interface remembers last interface opened | 452 | 17939 `settings_ca_open_last_interface_disabled` | The account summary's row opens the overview instead of the screen used last |

**Reset volume sliders to default** (468, a button row): the master, music, sound effect and area sound volumes (varps 3796, 168, 169, 872) go back to 100, a new account's level, as if each slider had been dragged there, and are sent.

Not done yet:

- **Combat Achievement Tasks - Repeat completion** (160): needs task checks to run for done tasks, and no capture or Wiki text gives the line.
- **Level-up chatbox list** (493): no capture shows what it writes.
- **Stop the boat when leaving the helm** (461): keeping the boat sailing with nobody at the helm is a new movement state, and no capture shows it.
- **Hit sounds** (382, Type A / Type B): neither the cache nor the Wiki says how the options relate to body type or which is the default.
- **Alchemy on untradeables warning** (65): its own change with the alchemy value warning.
