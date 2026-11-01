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
| Max hit hitsplats | 279 | varbit 14196 `hitsplat_maxhit_disabled` |
| Show boss health overlay | 10 | varbit 12389 `hpbar_hud_boss_disabled` |
| Show enemy name on health overlay | 299 | varbit 14706 `hpbar_hud_boss_name_disabled` |
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
| Player Trade options | 312 | varbit 6580 `tradeoption_disabled` |
| Player Report options | 372 | varbit 1334 `rightclick_report_abuse_disabled` |
| Side panel can be closed by the hotkeys | 54 | varbit 4611 `hotkey_cannot_close_sidepanel` |
| Player Attack options (dropdown) | 55 | varp 1107 `option_attackpriority` = option |
| NPC Attack options (dropdown) | 56 | varp 1306 `option_attackpriority_npc` = option |
| Scroll wheel can change zoom distance | 13 | varbit 6357 `camera_zoom_mouse_disabled` |
| Enable profanity filter | 37 | varp 1074 `option_chatfilter_disabled` |
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

The attack options are also dropdowns on the side panel's Controls tab (`settings_side:attack_priority_player_buttons` 116:38 and `attack_priority_npc_buttons` 116:39). Live sends op1 on their option rows 1–5 and 1–4 at login, and a click sets the varp straight to the option (slot − 1) on the same tick, as the All Settings rows do. Options from enums 3993 and 3991: 0 depends on combat levels, 1 always right-click, 2 left-click where available, 3 hidden, and for players 4 right-click for clanmates.

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

- **"Show level & unlocks"** behaves as "Show level only". On live, continuing opens an `objectbox` or `objectbox_double` listing what the level unlocks, with item models (for example `Members can now wield <col=000080>Osmumten's Fang<col=000000>!`). The text is server-side and isn't in the cache.
- **Level-up chatbox list and guide list**: the settings are stored, but no capture shows what they send.
- **Jingles.** Live plays `midi_jingle` per skill, two per skill (Attack 29/30, Defence 37/38, Magic 51/52, combat 299 …). Which one plays depends on the level: Magic's second plays at levels that unlock a spell, while Hitpoints and Strength switch to it at 50. The rule per skill still needs working out.
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
