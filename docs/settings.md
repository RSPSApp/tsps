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

## Buff Bar

The buff bar (interface 651) is mounted at login and drawn by the cache scripts. Every row of Interfaces > Buff Bar is in `settings.json` on the varbit script 6716 (3962 for the dropdown) reads for it, so the scripts hide the whole bar (124, varbit 9528 `buff_bar_hidden`), its tooltips (128, 9529 `buff_bar_tooltips_hidden`) or one buff. Every buff row starts shown, as live. `tests/buff-bar-settings.test.cjs` checks that every row of the section is wired, against both scripts, and that a click hides only its own buff and comes back at login.

| Rows | Varbits |
| --- | --- |
| Home and minigame teleport, Tele Block, charge, God Wars altar, dragonfire shield, imbued heart, Vengeance cooldown and active, stamina, prayer enhance, overload, magic imbue, Sire stun, freeze, Staff of the dead, divine, antifire, antipoison (125, 126, 129-145) | 12353-12371 `buff_*_disabled` |
| Corruption, Mark of Darkness, Shadow Veil, Death Charge, Ward of Arceuus, Resurrection (152-157) | 12405-12410 |
| Remaining ammo (170), poison damage (186), desert heat (208), cannon ammo (213), desert water (244), cannon decay (246) | 12985, 13084, 13134, 13667, 14166, 14173 |
| Menaphite remedy and the Tombs of Amascut effects (284-293) | 14287-14296 |
| Wilderness cave decay (307), Group Woodcutting Bonus (363), Scurrius food pile (369), Deadman blighted overload (385), prayer regeneration (388), goading potion (390), surge potion (437), bowstring spool (443), Vale totem trail (444) | 14691, 15349, 4139, 10946, 11032, 10068, 16239, 17773, 17774 |
| Woodcutting Leprechaun's Luck (364, dropdown) | 15350 = option |

**Timers.** The bar shows a buff only while the server sends its timer var. `BuffTimers.plugin.js` sends these from the effect's own state each tick, next to the custom varps 7990-7993 the client's infobox timers read:

| Effect | Varbit | Value |
| --- | --- | --- |
| Antifire, extended antifire | 3981 `antifire_potion` | time left in steps of 30 ticks |
| Super antifire, extended super antifire | 6101 `super_antifire_potion` | time left in steps of 20 ticks |
| Tele Block | 4163 `teleblock_cycles` | ticks left |
| Stamina potion | 24 `stamina_duration`, 25 `stamina_active` | time left in steps of 10 ticks; 1 while it lasts |

Poison and venom already go out on varp 102 `poison` (the hitpoints orb's), which the bar reads too.

- **Not done**:
  - Freeze: live sends no var for it (the freeze message comes alone), so the bar's freeze buff isn't driven from the server; the infobox timer (7998/7999) still shows it.
  - No timer var yet for charge, the God Wars altar, divine potions, magic imbue, the Sire stun, Staff of the dead, prayer enhance, Corruption, Shadow Veil, Ward of Arceuus, Resurrection, the cannon, the Menaphite remedy, the surge potion and the Tombs of Amascut effects, so their rows have nothing to hide yet.
  - The buff bar's own toggle scripts (4607 for freeze, 4611 for antipoison and the like) flip their varbits in the client alone, so a change made there is not saved.
  - Modified stats overlay (148-151): the cache HUD (708) is not mounted, so its rows stay unwired.

## Rows owned by other plugins

These features keep their own state and had their own switch before All Settings could change
them. Each owning plugin listens for `settings:setting-clicked`, flips that same state through its
own code path, sends the row's varbit and sets `handled`, so a click flips it once. The feature's
own switch and the row stay in step both ways, and the state comes back at login.

| Setting | Id | State and variable | The feature's own switch |
| --- | --- | --- | --- |
| Accept aid | 59 | `accept-aid` attribute, varbit 4180 `option_acceptaid` | The Controls side panel button (116:29). An Ironman is refused ("Ironmen do not accept aid.") from both. |
| Load-x value for the Dwarf multicannon (number) | 450 | `dwarf-cannon:load-x`, varbit 17870 `option_cannonballs_load_x` | The row asks the cannon's own "Set load-x cannonballs (1 - N):" |
| Looting bag - Store all | 352 | `looting-bag:store-everything`, varbit 6068 `lootingbag_useallitems` | The bag's Settings menu |
| Looting bag - Ignore supplies | 353 | `looting-bag:skip-supplies`, varbit 15310 `lootingbag_ignore_food` | The bag's Settings menu |
| Automatically smash empty vials | 380 | `alfred-grimhands-barcrawl:auto-smash`, varbit 5668 `auto_smash_vials` | The barbarian guard after the Barcrawl. Until it is done the row says the cache's locked text: "You must have completed the Alfred Grimhand's Barcrawl miniquest to access this setting." |
| Automatically smash empty plant pots | 381 | farm state `barbarian.autoSmash`, varbit 9614 `brut_smash_pots_automatically` (now also sent at login) | Otto's "Toggle automatic pot-smashing". Until his Farming training is done the row says "You must complete the Farming portion of Barbarian Training to access this setting." |
| Show warning on Wilderness teleport levers | 253 | `levers:skip-wilderness-warning`, varbit 13985 `wilderness_lever_blockwarning_standard` | The warning's "don't ask again" |
| Show warning on exiting Ferox Enclave | 255 | `ferox:barrier-dont-ask`, varbit 10532 `wildy_hub_warning` | The barrier's "Yes, and don't ask again." |
| Charter Ships confirmation | 294 | `charter-ships:skip-confirmation`, varbit 75 `settings_warning_confirmation_charter_ships` | The fare question's "don't ask again" |
| Forgotten drink crate warning | 455 | `charting:drink-no-warning`, varbit 19609 `sailing_charting_drink_crate_warning` | The warning's "Yes, and don't ask again." |
| Farming protection payment confirmation | 295 | varbit 98 `settings_warning_confirmation_farming_protection`, an ordinary `settings.json` row | The gardener's "Yes and don't ask again." turns the row on through `settings:set`. A save's old per-player `gardenerNoAsk` farm flag moves onto the row once at login and is removed. |

Ours: a row click that changes the setting sends no chat message (only the locked rows and the Ironman refusal say something); the feature's own switch keeps its messages.

## Camera shake rows

Every camera shake the server sends goes through `CameraShake.send(sender, effect, ...)`
(`plugins/interface/CameraShake.plugin.js`), which names the effect and sends it only when the
player's settings allow it. Each var is an `option_camera_effect_*_disabled` flag (1 = off), saved
and resent at login like any `settings.json` toggle; all start at 0 (on). A shake with no amplitude
(one that stops a shake) is always sent.

| Setting | Id | Varbit | Effect | Shakes today |
| --- | --- | --- | --- | --- |
| Toggle all combat camera shake effects | 425 | 16106 `option_camera_effect_combat_disabled` | `combat`, and every combat sub-row | Hueycoatl, Phantom Muspah, Zebak, Nylocas, Obor, the Fractured Archive batteries, Meat and Greet's minotaur |
| Doom of Mokhaiotl | 445 | 17776 `option_camera_effect_dom_disabled` | `doom` | the burrow |
| Lizardman Shamans | 427 | 16107 `option_camera_effect_shamans_disabled` | `shamans` | none yet |
| Great Olm | 428 | 16108 `option_camera_effect_olm_disabled` | `olm` | none yet |
| Ape Atoll tunnel rock fall | 429 | 16109 `option_camera_effect_monkey_madness_disabled` | `apeAtollRockfall` | none yet |
| Toggle all atmospheric camera shake effects | 426 | 16110 `option_camera_effect_atmospherics_disabled` | `atmospheric`, and every atmospheric sub-row | Guardians of the Rift's surge, quest scenes |
| Baba Yaga's house | 281 | 14197 `option_camera_effect_baba_yaga_disabled` | `babaYaga` | none yet |
| Fishing Trawler | 282 | 4814 `trawler_camera_static` | `trawler` | none yet |
| Barrows chest | 283 | 14198 `option_camera_effect_barrows_disabled` | `barrows` | none yet |

- **Groups.** A sub-row's struct param 1080 names its group (3335 combat, 5198 atmospheric).
  Script 7825 counts a sub-row as off while its master is off, and the settings scripts lock it;
  the sub-row keeps its own value for when the master comes back on. Ours: a click on a locked
  sub-row changes nothing on the server either.
- **Fishing Trawler.** Script 1134 (the trawler's own camera button) also sets 4814, in the client
  alone, and says "You have disabled all atmospheric camera effects in your settings. Turn them on
  to enable this button." while the atmospheric master is off.
- **Not done**: the shamans' jump, the Great Olm, the Ape Atoll rock falls, Baba Yaga's house, the
  Fishing Trawler and the Barrows chest send no camera shake yet; their rows only save.

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
- **Other colour pickers** (type 9): the Activities overlay colours (113, 174, 177, 180, 262, 263, 266, 504) are not handled; the chat, quest-list and music player colours are supported below.

## Chat colours

The chat colour rows (type 9) open the colour picker as the quest-list rows do (modal 288, script 4185). Each saves the chosen colour + 1 in the varp the cache's colour reader (script 4181) reads for its row; 0 selects the struct default (param 1230). The chatbox scripts draw each chat type in its varp's colour, so nothing else changes on the server.

| Chat type | Opaque | Transparent |
| --- | --- | --- |
| Public | 87 → varp 2992 | 88 → 3000 |
| Private | 89 → 2993 | 90 → 3001 |
| Auto chat | 92 → 2994 | 93 → 3002 |
| Broadcast | 94 → 2995 | 95 → 3003 |
| Friends chat | 97 → 2996 | 98 → 3004 |
| Clan chat | 99 → 2997 | 100 → 3005 |
| Incoming trade request | 101 → 2998 | 102 → 3006 |
| Incoming challenge request | 103 → 2999 | 104 → 3007 |
| Guest clan chat | 105 → 3060 | 106 → 3061 |
| Ironman Group chat | 193 → 3191 | 194 → 3194 |
| Clan broadcasts | 196 → 3192 | 197 → 3195 |
| Ironman Group broadcasts | 198 → 3193 | 199 → 3196 |
| 'Did you know?' | 434 → 4697 | 435 → 4698 |

Split private chat: Private 91 → varp 3008, Broadcast 96 → 3009. The reset rows clear their group's varps: 107 opaque, 108 transparent, 109 split. `server/tests/settings-chat-colours.test.cjs` checks every row against script 4181 and its struct.

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
- **Alchemy threshold** (66) asks "Set value threshold for alchemy warnings:" (rsprox 338, 3275); `AlchemyWarningThreshold.plugin.js` saves the answer through `settings:set`.
- **Value warnings** (`ValueWarnings.plugin.js`, shared pieces in `ValueWarning.js`). An item's worth is the Grand Exchange guide price of the unnoted item times the quantity; an untradeable item is worth nothing. A warning shows when the worth is at least the threshold.
  - Drop item warning (42, 43): before the item lands on the floor, the captured item box "The item you are trying to put down is considered valuable. Are you absolutely sure you want to do that?", then "<name>: Really put it down?" with "Put it down." / "No, don't put it down." (rsprox 1514). Core emits `item:drop-warning`, so another drop warning (the boat row 465) can use the same check.
  - Alchemy (65, 66): "That item is considered valuable. Really cast High Level Alchemy on it?" (rsprox 338), with the untradeable confirm's options. Untradeable items warn while 65 is on (varbit 6092 `alchemy_warning_untradeables`, 1 in 2,664 of 3,978 captured logins). Core emits `magic:alchemy-warning`.
  - Loot drop notifications (38-40): each stack an NPC drops for the player, from `npc-drops:roll`: `<col=ef1020>Valuable drop: 3 x Spider cave teleport (108,567 coins)</col>` and `<col=ef1020>Untradeable drop: Brimstone key</col>` (rsprox 788, 806 and others). Clicking 40 while 38 is off gives the row's own cache line instead.
  - Grand Exchange (297, 298): a buy offer more than 10 times the guide price, or a sell offer under 10% of it (the rows' cache text), asks before it is placed. The varbits are `option_ge_price_buy/sell_warning_disabled` (14700/14701): 1 turns the warning off (the rows' structs have param 1084, ticked while the varbit is 0), so the captured default leaves the buy warning off and the sell warning on.
  - Birdhouse seeds (448, 449): seeds worth at least the value (varp 4850 `settings_birdhouse_seed_warning_value`, 1000 in 1,263 captured logins) ask before they go in.
  - Cannon (248-250): a popup when the cannon is down to the amount (varbit 14176) or empty; the red "Your cannon is out of ammo." chat line is always sent.
  - Ours, with no capture: the number prompts for 39, 43, 249 and 449 (worded after the Alchemy one), the Grand Exchange, birdhouse and cannon wording, and that a threshold of 0 never warns.
- **Not done**:
  - The respawn timer dropdowns (187, 188) and the Sailing drop-item warning (465, default differs between captures).
  - Rows already handled elsewhere: levers 253, Ferox 255 and drink crate 455 are under "Rows owned by other plugins".

## Wilderness teleport warnings

`server/plugins/combat/SpellTeleports.plugin.js` warns before a Wilderness teleport spell is cast or a Wilderness tablet is broken, while the spell's or tablet's row is on (cache check and every case in `tests/wilderness-teleport-warnings.test.cjs`).

| Setting | Id | Variable | Warns while |
| --- | --- | --- | --- |
| Show warning when casting: Teleport to Target, Dareeyak, Carrallanger, Annakarl, Ghorrock Teleport | 60-64 | varbits 236 `bounty_teleport_warning`, 6284-6287 `*_teleport_warning` | 1 (default, sent at login) |
| Show warning when using tablet: Ice Plateau, Cemetery, Wilderness Crabs, Dareeyak, Carrallanger, Annakarl, Ghorrock | 67-73 | varbits 2323, 2322, 3932, 3930, 2325, 2324, 3931 `teletab_*_warning` | 0 (default; the row's struct reads it inverted, param 1084) |
| Enable / Disable Wilderness teleport warnings (buttons) | 77 / 76 | sets 60-64 | |
| Enable / Disable tablet warnings (buttons) | 75 / 74 | sets 67-73 | |

- **Defaults.** Live sends 1 for the four Ancient spells' varbits at login in 3,238 rsprox recordings (and `bounty_teleport_warning` in 2,966), and never changes the tablets' varbits, whose warning shows: both are on by default.
- **One value.** The rows are in `data/settings.json`, so they are saved in `settings:values`. The spellbook's op10 ("Disable warning" / "Enable warning") sets the same row through `settings:set`. The `spell-teleports:wilderness-warnings` attribute that op10 used to save (off by default, and read by nothing) is cleared at login.
- **Spells** (rsprox 3330, an event world, Annakarl Teleport): "Are you sure you wish to teleport to the Wilderness?", "Yes, teleport me now." / "No, I want to stay here."; Yes casts on that tick. The spell's level, rune and Wilderness checks run before the warning, and again on Yes, when the runes are taken. Ours: the same line for the other spells, Teleport to Target included (it asks after its own Bounty Hunter checks).
- **Tablets** (rsprox 3931 Annakarl and Ghorrock, 1463 Dareeyak): "Teleport into the DEEP wilderness?" or "Teleport into the wilderness?", "Yes" / "No"; Yes breaks the tablet then, which is used up as it is absorbed. Ours: the deep line for Ice Plateau, Cemetery and Wilderness crabs (past level 30), the other for Carrallanger.
- **Buttons.** No capture; each sets every row of its group on or off, with no message.
- **Not done:** the tablets' own Configure option (no capture).

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

## Containers on death

Rows 354-359 are `data/settings.json` toggles, saved and sent back at login. Each is off by default: no rsprox capture ever sets its varbit. With a row on, a PvM death empties that container into the grave even when it is kept, as the row's cache text says ("its contents will be emptied into your grave, even if the pouch itself is not lost"). The storage items' death hook applies them; what each death does is in [storage-items.md](storage-items.md#death) (cases in `tests/container-death.test.cjs`).

| Setting | Id | Variable | Container |
| --- | --- | --- | --- |
| Always empty rune pouches on death | 354 | varbit 15311 `emptyondeath_runepouch` | rune pouch and divine rune pouch (`items/runepouch/Death.RunePouch.js`) |
| Always empty tackle boxes on death | 355 | varbit 15312 `emptyondeath_tacklebox` | tackle box |
| Always empty bolt pouches on death | 356 | varbit 15313 `emptyondeath_boltpouch` | none: there is no bolt pouch yet, so the row only saves |
| Always empty seed boxes on death | 357 | varbit 15314 `emptyondeath_seedbox` | seed box (`skills/farming/Guild.Farming.js`) |
| Always empty essence pouches on death | 358 | varbit 15315 `emptyondeath_essencepouch` | small to colossal pouches (`skills/runecrafting/Pouches.Runecrafting.js`) |
| Always empty herb sacks on death | 359 | varbit 15316 `emptyondeath_herbsack` | herb sack and silklined herb sack |

- **Not done:** a seed box lost above level 20 Wilderness is destroyed on live with its seeds kept for the next box (Wiki: Seed box, 14 April 2021); here its seeds go to the bank and the killer like any other PvP death.
