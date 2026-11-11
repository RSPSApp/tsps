# Settings and level-up notifications

`server/plugins/interface/Settings.plugin.js` applies clicks in the All Settings interface (`settings`, 134). `server/plugins/interface/SkillLevelUp.plugin.js` sends the level-up feedback and follows the "Level-up pop-up notifications" setting.

The behaviour comes from rsprox captures of live OSRS: a capture of All Settings (every row below clicked through), and level-ups from the shared capture index (`levelup_display` in 70 recordings, revisions 223–235, for example recordings 907, 908, 944 and 379; pop-ups disabled in 23 rev 237 recordings, for example 1098, 1102, 1104, 4055). Ids are checked against the rev 241 cache.

Each group of rows has its own section below, ending with a **Not done** line for what is still missing in it. A new group of rows gets its own section, above "Containers on death".

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
| Ammo-picking behaviour | 305 | varbit 5697 `take_ammo_toggle`; see [Pickups into containers](#pickups-into-containers) |
| Sailing side panel (dropdown: Always show, Only show on boat) | 454 | varbit 18131 `settings_sailing_side_panel_onlyonboat` = option; off a boat, Sailing sets 19153 `sailing_sidepanel_visible_from_combat_tab` from it (see below) |
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

**Sailing side panel.** The combat tab's "View" button for the sailing sidepanel (593:48) shows while 19153 is 1 (script 7593, run as the tab is built); script 8583 also shows it while the option is Always show and The Pandemonium (`sailing_intro`, 18314) is at stage 6 or later. Off a boat, Sailing sets 19153 to 1 for Always show from that stage and to 0 otherwise, at login, on leaving a boat, when the option changes and when The Pandemonium changes stage; boarding sets it to 1. Live sends 1 at login in 352 of the 356 default-state logins off a boat past that stage in the rsprox captures (rev 235+), and 0 before it. Clicking "View" off a boat opens the same sidepanel on the combat tab, with no boat described (script 8757 titles it "Not on boat"), and sets `sailing_sidepanel_visible` (19151) to 1; its "Combat Options" puts the combat tab back and sets it to 0, as both buttons do aboard.

- **Not done**:
  - Player Trade options: the official client gets no "Trade with" from the server (live sends `set_player_op` 4), so the row only hides the browser client's own entry. See [Player menu options and Ctrl-run](#player-menu-options-and-ctrl-run).

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
| Show mouseover tooltips | 114 | varbit 12344 `mouseover_tooltips_disabled` | mouseover tooltips (scripts 4581, 4728) |
| Show attack style | 123 | varbit 12352 `attack_style_enabled` | HUD layout (4731) |
| Leagues: Display Relics | 127 | varbit 12383 `buff_league_relics_hidden` (1 hides them) | buff bar |
| Show mouseover text | 147 | varbit 10035 `mouseover_text_disabled`, see below | our client's top-left text, HUD layout (4731) |
| Agility helper | 163 | varbit 12379 `agility_helper_disabled` | Agility helper (script 5184), from the course data `Agility.plugin.js` sends |
| Highlight Agility obstacles | 164 | varbit 12380 `agility_helper_highlight_obstacles_enabled` | our client's obstacle highlight |
| Enable Minimap zoom | 166 | varbit 12983 `minimap_zoom_lock_disabled` | minimap scroll zoom (scripts 876, 5190, 7025, 7028) |
| Show the Store button on desktop | 181 | varbit 13037 `tli_storebutton_toggle_desktop` | the minimap's Store button (scripts 389, 920, 2414) |
| Chatbox Mode - Set Automatically | 195 | varbit 13120 `option_chatbox_mode_autoset` | chat input (script 73) |
| Show number of options in mouseover tooltips | 209 | varbit 13133 `mouseover_tooltips_hide_opcount` | mouseover tooltips (script 4728) |
| Show Activity Adviser | 257 | varbit 5368 `option_content_recommender_hide`; a fresh account starts with 1, the button hidden (sent as 1 by 5 of the 6 Tutorial Island logins in the rsprox captures, and by 4,265 logins in all) | the minimap's Activity Adviser button (scripts 636, 2481), which opens the Adviser (`ActivityAdviser.plugin.js`) |
| Hide minimap icons when zoomed out | 265 | varbit 14179 `option_minimap_icons_max_zoom_disabled` | `minimap_seticonzoomlimit` (6463, 6465) |
| Precise combat level | 311 | varbit 14806 `combat_level_decimal_enabled` | combat tab |
| Ignore List - Remove permanently banned / muted accounts daily | 313, 314 | varbits 8059 `purgeignored_permbanned_disabled`, 8060 `purgeignored_permmuted_enabled` | nothing: there are no permanent bans or mutes |
| Options on the compass for orienting the camera also set its vertical angle | 362 | varbit 15323 `compass_reorientation_setheight` | compass (script 1050) |
| Block spontaneous pop-up promotional messages | 365 | varbit 9597 `crm_surprisepopup_blocked` | nothing: there are no promotional pop-ups |
| Leagues: Display Combat Masteries | 418 | varbit 11562 `buff_league_masteries_hidden` (1 hides them) | buff bar |
| Always show chat filters | 430 | varbit 16116 `settings_mobile_show_filter_stones_enabled` | chat filter buttons (scripts 113, 178, 3179) |
| Enable interface resizing and repositioning | 442 | varbit 17772 `settings_interface_resizing` | resizable interfaces |
| Disable colourful fade effects | 460 | varbit 18132 `settings_colourful_fade_disabled` | Barracuda Trials |
| Show charting hints | 464 | varbit 18138 `sailing_show_charting_hints` | the captain's log (scripts 8702, 8706) |
| Show boat customisation material messages | 466 | varbit 18140 `sailing_show_customisation_material_messages`; a fresh account starts with 1 (sent in all 501 default-state logins since rev 235 that carry it) | the boat customisation materials list (script 8828) |
| Modern menu interface, and its transparent background | 472, 473 | varbits 19615 `settings_new_menu_interface`, 19646 `settings_new_menu_transparent_interface_disabled` | menu scripts |
| Rune pouch loadout name tags | 474 | varbit 19647 `settings_runepouch_loadout_names_disabled` | rune pouch |
| Quetzal whistle - Default to hunter guild | 476 | varbit 19681 `settings_quetzalwhistle_default_tp` | the whistle's Signal (`Whistle.Quetzals.js`) |
| Show quest rating prompts | 505 | varbit 16774 | nothing: there are no quest rating prompts |

- **Friend Login/Logout messages.** Script 4487 shows `loginlogout_permanent` when it is set, else `loginlogout_setting`; the chat script (84) reads only `loginlogout_permanent`, for the message timeout. Timeout sets both to 0, Off sets the setting to 2. Ours: On sets both to 1, so the chat script sees it too (no capture has On; live logins send `loginlogout_setting` 2, Off, in 3225 of 4281 recordings).
- **Show mouseover text.** Login sends the saved value, 0 for a fresh account (it used to force 0). The top-left text and HUD overlays laid out by script 4731 (Wintertodt, ToA...) follow it when they are laid out: with the text on they sit 23px lower, with it off at the top.
- **Disable colourful fade effects.** Barracuda Trials' "Yes" to its effects question sets this row through `settings:set`. A per-trial "effects off" flag saved before the row existed moves into the setting at the next login.
- **Not done**:
  - Disable colourful fade effects does not change Guardians of the Rift, which keeps its own `gotr_colourful_fade_disabled` (the barrier's Visual-effects option).

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
  - The other effects' vars are in [Buff timers read from a var](#buff-timers-read-from-a-var). The freeze, the Staff of the dead special, poison damage and the Sire stun are in [Buff timers started by buff_bar_start](#buff-timers-started-by-buff_bar_start). Still not drawn: Mark of Darkness, the active Shadow Veil, Ward of Arceuus and Resurrection, cannon decay and the Tombs of Amascut effects (no var: see that section), and the surge potion (no surge potion).
  - Modified stats overlay (148-151): now wired, see "Health and modified stats overlays" below.

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

- **Not done**: nothing known.

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
| Lizardman Shamans | 427 | 16107 `option_camera_effect_shamans_disabled` | `shamans` | the Chambers of Xeric shamans' jump |
| Great Olm | 428 | 16108 `option_camera_effect_olm_disabled` | `olm` | the falling crystals |
| Ape Atoll tunnel rock fall | 429 | 16109 `option_camera_effect_monkey_madness_disabled` | `apeAtollRockfall` | none yet |
| Toggle all atmospheric camera shake effects | 426 | 16110 `option_camera_effect_atmospherics_disabled` | `atmospheric`, and every atmospheric sub-row | Guardians of the Rift's surge, quest scenes |
| Baba Yaga's house | 281 | 14197 `option_camera_effect_baba_yaga_disabled` | `babaYaga` | none yet |
| Fishing Trawler | 282 | 4814 `trawler_camera_static` | `trawler` | none yet |
| Barrows chest | 283 | 14198 `option_camera_effect_barrows_disabled` | `barrows` | the looted tunnels |

- **Groups.** A sub-row's struct param 1080 names its group (3335 combat, 5198 atmospheric).
  Script 7825 counts a sub-row as off while its master is off, and the settings scripts lock it;
  the sub-row keeps its own value for when the master comes back on. Ours: a click on a locked
  sub-row changes nothing on the server either.
- **Fishing Trawler.** Script 1134 (the trawler's own camera button) also sets 4814, in the client
  alone, and says "You have disabled all atmospheric camera effects in your settings. Turn them on
  to enable this button." while the atmospheric master is off.
- **Not done**: the Ape Atoll rock falls, Baba Yaga's house and the Fishing Trawler send no camera
  shake yet; their rows only save (see "Camera shake and visual effect content" below).

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

- **"Show level & unlocks"**: continuing opens a box per level with what it unlocked, straight after that skill's pop-up and before a queued skill's or a combat level's (rsprox 223/00014: Attack's box, then the combat pop-up). As live sends it: a `mesbox` chat line with the box text, the pop-up's skill icon hidden, `toplevel_chatbox_resetbackground` (2379), then `objectbox` (193, one picture: `ItemStatementDialogue`) or `objectbox_double` (11, two: `DoubleItemStatementDialogue`) at zoom 400. The text is server-side and comes from the Wiki's level-up transcripts (`plugins/interface/data/level-up-messages.json`), generated by `server/scripts/dump-level-up-messages.cjs` (`--check` fails if the committed file is stale). The pictures are obj gamevals in `plugins/interface/data/level-up-pictures.json`; Sailing has all 80 levels there (71 from rsprox captures, the rest the skill guide icon of each picture the transcript shows). Other skills' levels use the generated `items` ids instead: a level with a single unlock whose transcript picture names a cache item (resolved by exact cache item name); pictures that are not items, or whose wiki name the cache renamed, keep the plain message box (229).
- **Level-up chatbox list**: with "Show level & unlocks" on (and pop-ups shown), the unlock text goes to the chat only as the box's `mesbox` line, as live (no capture has a plain "You can now..." game message on a level-up). A level-up given up before its box opens (walking, using an item, logging out, dying) sends the lines as chat messages instead, for the open pop-up's skill and any queued ones (ours), so they are never lost. Otherwise the same lines go to the chatbox on the level-up tick, but only with "Level-up chatbox list" on (varbit 20158); see "Skilling and level-up notices".
- **Jingles.** Each skill plays its `advance <skill>` jingle (cache gamevals index 24 kind 18); the `...2` one plays on levels that unlock something unless the guide list is disabled (varbit 20159). Hitpoints/Strength switch at 50, Construction every 10th, Hunter on odd levels (the Wiki's Even/Odd order is the only evidence), Sailing at 99, combat 299 with the combat message.
- **Not done**:
  - Level-up guide list (494): no chat invitation to open the skill guide after a level-up, and nothing lists unlocks in the guide. No capture has the invitation's text.
  - "Show level & unlocks": the box text's `<col=000080>` highlights (the dumper strips the Wiki's `{{Colour}}` spans), and the box's `mesbox` lines for a lamp's several levels go out together when the first box opens.

## Chat colours

The chat colour rows (type 9) open the colour picker as the quest-list rows do (overlay 288 in the settings popup layer 134:9, script 4185). Each saves the chosen colour + 1 in the varp the cache's colour reader (script 4181) reads for its row; 0 selects the struct default (param 1230). The chatbox scripts draw each chat type in its varp's colour, so nothing else changes on the server.

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

- **Not done**: the other colour pickers (type 9), the Activities overlay colours (113, 174, 177, 180, 262, 263, 266, 504).

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
mounts colour picker 288 as an overlay in the settings popup layer (134:9), sets
varbit 12284 while it is open, enables op1 on its palette (288:11) and custom buttons
(288:8), and calls 4185 with that layer. Scripts4208 →4209 →614
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

- **Not done**: nothing known.

## Notification and warning rows

These rows show, save and resend the player's choice (`data/settings.json`; cache check in `tests/builtin-warning-settings.test.cjs`). **Most do not change anything in game yet.** In the osrs-dumps client scripts, the drop warning (5411/5412), loot notification (5399/5400/5402), Grand Exchange price warning (14700/14701) and Alchemy value (6091) varbits are read only by the settings scripts themselves; on live the server shows those warnings, and tsps does not read the varbits yet. The other rows below were not traced to a reader either.

- **Toggles** (flip 0/1): loot drop notifications (38, 40), spam-filter boss kill counts (41), drop item warning (42), Combat Achievement popup and failure notifications (159, 161, 162), logout notifier (185), bird nest (189), cannon low/out of ammo (248, 250), High Risk lever / Ferox / canoe warnings (254, 308, 309) and the canoe warning (256), Grand Exchange buy/sell price warnings (297, 298), Poison Karambwan (370), Plank Make confirmations (420-423, see "Confirmations and messages"), farming patch digging (446), birdhouse seeds (448), Sailing charting popups, cargo and boat teleport warnings (456, 463, 467, 469, 471; 471 is under "Confirmations and messages") and the Leagues stepping-stones teleport (500).
- **Defaults** are what the 703 default-state logins in the rsprox captures (rev 235+, drop-warning value 150000) have: on for 38, 40, 42, 161, 297, 420, 423; off for the rest. Thresholds: drop warning 150000 (43), loot notification 10000 (39), Alchemy warning 20000 (66).
- **Alchemy threshold** (66) asks "Set value threshold for alchemy warnings:" (rsprox 338, 3275); `AlchemyWarningThreshold.plugin.js` saves the answer through `settings:set`.
- **Value warnings** (`ValueWarnings.plugin.js`, shared pieces in `ValueWarning.js`). An item's worth is the Grand Exchange guide price of the unnoted item times the quantity; an untradeable item is worth nothing. A warning shows when the worth is at least the threshold.
  - Drop item warning (42, 43): before the item lands on the floor, the captured item box "The item you are trying to put down is considered valuable. Are you absolutely sure you want to do that?", then "<name>: Really put it down?" with "Put it down." / "No, don't put it down." (rsprox 1514). Core emits `item:drop-warning` with the warnings already `answered`, so it and the boat warning (465) ask in turn.
  - Drop item warnings on boats (465, `skills/sailing/DropWarning.Sailing.js`): any item dropped on a boat's deck asks first, the captured message box "Are you sure you want to put that down? If you leave the boat, you may not be able to retrieve it." (also a mesbox chat line), then "Select an option": "Put it down.", "Put it down, and don't ask again." (sets varbit 18143 `settings_sailing_dropitem_warning` to 1, saved as the row), "Put it down, and don't ask again this session." (varbit 19114 `sailing_dropitem_warning_temp`, until logout) and "Don't drop it." (rsprox 901, 3792). The row is ticked while 18143 is 0 (struct param 1084), the default; captured logins that send 1 are players who turned it off.
  - Alchemy (65, 66): "That item is considered valuable. Really cast High Level Alchemy on it?" (rsprox 338), with the untradeable confirm's options. Untradeable items warn while 65 is on (varbit 6092 `alchemy_warning_untradeables`, 1 in 2,664 of 3,978 captured logins). Core emits `magic:alchemy-warning`.
  - Loot drop notifications (38-40): each stack an NPC drops for the player, from `npc-drops:roll`: `<col=ef1020>Valuable drop: 3 x Spider cave teleport (108,567 coins)</col>` and `<col=ef1020>Untradeable drop: Brimstone key</col>` (rsprox 788, 806 and others). Clicking 40 while 38 is off gives the row's own cache line instead.
  - Grand Exchange (297, 298): a buy offer more than 10 times the guide price, or a sell offer under 10% of it (the rows' cache text), asks before it is placed. The varbits are `option_ge_price_buy/sell_warning_disabled` (14700/14701): 1 turns the warning off (the rows' structs have param 1084, ticked while the varbit is 0), so the captured default leaves the buy warning off and the sell warning on.
  - Birdhouse seeds (448, 449): seeds worth at least the value (varp 4850 `settings_birdhouse_seed_warning_value`, 1000 in 1,263 captured logins) ask before they go in.
  - Cannon (248-250): a popup when the cannon is down to the amount (varbit 14176) or empty; the red "Your cannon is out of ammo." chat line is always sent.
  - Ours, with no capture: the number prompts for 39, 43, 249 and 449 (worded after the Alchemy one), the Grand Exchange, birdhouse and cannon wording, and that a threshold of 0 never warns.
- **Not done**:
  - The respawn timer dropdowns (187, 188).
  - Rows already handled elsewhere: levers 253, Ferox 255 and drink crate 455 are under "Rows owned by other plugins".
  - The Leagues stepping-stones teleport warning (500, varbit 20362 `league_teleport_dragons_stepping_stones_warning`) is saved, and the settings reader (script 6716) reads it, but nothing asks before a teleport: its destination, the Map of Alacrity's "Catacombs: Dragons stepping stones", is left out of `server/plugins/modes/data/league-map-of-alacrity.json` (no landing side the shortcut data and the Wiki's pin agree on), and there is no capture or Wiki line for the warning's wording. The Leagues category's own rows, Display Relics (127) and Display Combat Masteries (418), are done (see "Rows the client scripts already apply").

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

## Confirmations and messages

Each row is a toggle in `data/settings.json`, read when its dialogue or message would show. Tests: `tests/settings-confirmations.test.cjs` (which also checks each row's varbit against the cache's toggle reader, script 6716) and `tests/settings-trade-delay.test.cjs`.

| Setting | Id | Varbit (live default) | While on |
| --- | --- | --- | --- |
| Clue scroll warnings, Beginner to Master | 374–379 | 10693, 10694, 10695, 10723, 10724, 10725 `option_trail_reminder_*` (off) | A clue an NPC drops for a player already holding that tier says "You have a sneaking suspicion that you would have received a medium clue scroll." ("scroll box" once boxes are unlocked; "an" before easy and elite; rsprox 224/1445, 231/391, 235/941, 236/3932) |
| STASH units take equipped items | 451 | 17938 `option_hidey_holes_equipped` (off) | Filling a STASH takes each outfit item from the inventory first, then from what the player wears |
| Plank Make confirmation: basic, oak, teak, mahogany | 420–423 | 624, 2319, 2320, 3939 `dream_plankspell_*` (on, off, off, on) | Plank Make on that log asks "Pay 70 coins for each plank?" (the log's price), Yes / No, before it takes coins, runes or the log; the other logs never ask |
| Show confirmation when paying for items from gravestone | 192 | 13113 `gravestone_disable_warning`, read as is (on) | The grave's pay button asks "Pay 15,000 coins to retrieve your items?", Yes / No; either answer reopens the grave's interface while the player is within reach, and Yes pays only if the fee is unchanged |
| Accept trade delay | 205 | 13130 `trade_delay_disabled`, read as is (on) | Accept on the first trade screen does nothing for 3 seconds after either player changes an offer; each player's own setting decides their wait |
| Show warning when teleporting from your boat at sea | 471 | 16620 `sailing_warning_teleportoffboat` (off) | A teleport spell cast aboard your own boat (which would leave it lost at sea) asks "Accept that your boat may be lost at sea?", "Yes, teleport away." / "No, stay on the boat.", after any Wilderness warning the spell has (`skills/sailing/TeleportWarning.Sailing.js`) |

- **Defaults** for 192 and 205: all 918 default-state logins (rev 235+) in the rsprox captures send both varbits as 1. Row 278 ("Display a warning on login if there are items stored in an item retrieval service") is shown by the toggle reader as 1 − varbit 14194 `option_item_retrieval_warning_disabled`, so it now flips 14194 instead of sharing 192's 13113. The gravestone login warning reads 14194 too, so it shows by default.
- **Ours** (no capture or Wiki text): the Plank Make, gravestone and boat teleport questions and options (the boat one follows live's Escape prompt), and that a click on Accept during the trade delay does nothing and says nothing.
- **Not done**:
  - The boat teleport warning for tablets, jewellery and other non-spell teleports; the row's description names teleport spells.
  - Port task cargo deposit (463), port task cargo in hold (467) and Ironman cargo hold (469) warnings: no capture or Wiki text of any of them. 469's varbit (10385) is read by no cache script, and is not the cargo hold panel's own dismissable warning (19123, scripts 8888-8890).

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

- **Not done**:
  - **Combat Achievement Tasks - Repeat completion** (160): needs task checks to run for done tasks, and no capture or Wiki text gives the line.

## Row locks and hit sounds

**Locked rows.** A setting struct with param 1115 can be locked, and param 1116 is its locked text; the cache's settings scripts grey the row out while script 2520 says so. `Settings.refuseLockedSetting(player, settingId)` is the server's check: a click on a locked row, or a dropdown option chosen for one, sends the row's text, sends back the var the row keeps (the client may have flipped it itself) and changes nothing. Its `ROW_UNLOCKS` table says when each row unlocks; any other path that changes a row from the client should ask it first. Rows 380 and 381 keep their own checks in their plugins (see "Rows owned by other plugins").

| Setting | Id | Unlocked by | Asked through |
| --- | --- | --- | --- |
| Deep Wilderness lever default option | 296 | Any tier of the Wilderness Diary | `diary:is-complete`. The diaries also send varbit 4470 `wilderness_diary_any_complete` (a bit per tier done, easy first; live logins send 1, 3, 7 and 15), which script 2520 reads for this row |
| Disable Phantom Muspah messages | 302 | Secrets of the North | `quest:is-complete`. Ours: script 2520 has no case for this row, so the client never greys it out; the row's locked text names the quest |
| Make-X barbarian potions | 373 | Barbarian Training's Herblore section | `herblore:unlocked` "barbarian_herblore" (script 2520: varbit 3761 `brut_herb_potion` at 3) |

**Hit sounds** (382, a dropdown: Type A / Type B, varbit 10731 `settings_hit_sounds`). `combat/PlayerHitSounds.plugin.js` owns the row through `settings:option-chosen` and saves the choice (`hit-sounds:type`). Type A is the body0 hurt voices (518-521), Type B the body1 ones (509, 510); most captures are body type A characters on Type A. Ours: until the player chooses, the voice follows the body type as before, and a body type B player's login sends Type B so the row shows it. Tests: `tests/player-hit-sounds.test.cjs`, `tests/settings-row-locks.test.cjs`.

**Pronouns.** The Ironman trade refusal and the Surprise Exam's praise follow the player's pronouns (he, she, they), not the body type: "<name> is an Ironman. They stand alone." (the Wiki gives the They form).

- **Not done**: nothing known.

## Chat and social rows

Chat and social rows whose choice the game now follows.

- **Friend Login/Logout messages** (44). The client writes "<name> has logged in." and "... logged out." itself from the friends list, as the official client does (`FriendLoginUpdates.ts`). With Off (`loginlogout_setting` 2, read as script 4487 does, `loginlogout_permanent` first) it writes none.
- **Show chat effects** (34, varp 171 `option_chat`). While it is 1, every player's overhead chat is drawn plain yellow and static: no colours, patterns or wave, scroll and slide effects (`overlays3.ts`, used by both renderers).
- **Update clan 'last seen' records** (431, varbit 16118 `clan_disable_lastseen`). While it is 1, logging in leaves the member's last seen day as it was and sends no `member_extra_info` delta for it. The owner's own absence timer (for the ownership hand-over) still runs.
- **'Did you know?' tips** (433, varbit 16235 `settings_didyouknow_disabled`). `LoginTips.plugin.js` sends one tip at random, as chat type 117, straight after the login greeting (`welcome-screen:greeted`), unless the saved setting is 1; rows 434 and 435 colour it. The 40 tips in `data/login-tips.json` are live's own lines from rev 238 and 239. In the rsprox captures, live sends a tip right after "Welcome to Old School RuneScape." in 1,380 of 1,381 logins since rev 235 (for example 239/4251), none of them with the setting sent as 1. Live's navigator tip is cut short at "</col", and is kept as sent.
- **Not done**: nothing known.

## Skilling and level-up notices

Tests: `tests/settings-skilling-notices.test.cjs` and `tests/skill-max-level.test.cjs`.

| Setting | Id | Varbit (live default) | While on |
| --- | --- | --- | --- |
| Clue scroll warnings, Beginner to Master | 374–379 | 10693–10695, 10723–10725 (off) | A clue rolled by skilling for a player who can't take another of that tier says the "sneaking suspicion" line, as NPC drops do (see "Confirmations and messages") |
| Level-up chatbox list | 493 | 20158 `option_level_up_chatbox_list` (off) | A level-up with no unlock box writes what the level unlocked in the chat |

- **Skilling clues.** Clue nests (Woodcutting), clue geodes (Mining), clue bottles (Fishing), the Wilderness Agility dispenser's medium clue, salvage clues (Sailing) and Hunter's bird house clue nests, aerial fishing clue bottles, impling jar clues and drift net clue bottles now roll each tier first and only then check the player's clue capacity; a roll that hits at capacity emits `treasure-trails:missed-clue` `{player, tier}`, which `Capacity.ClueCapacity.js` answers with the tier's warning ("scroll box" once boxes are unlocked). A bird house warns once a tier however many of its nests roll (ours), and a drift net clue that becomes pufferfish warns too. Free worlds never warn about a members tier. Ours: the captured warnings all follow NPC drops (rsprox 224/1445, 231/391, 236/3932); no capture shows a skilling clue missed at capacity.
- **Level-up chatbox list.** In 775 level-ups at levels that unlock something, from rev 237 recordings with pop-ups disabled and the chatbox list off (for example rsprox 237/1100: Woodcutting 61, Fletching 46 and 47), live sends no unlock line, and no "master of" line at 99. So the lines that go to the chat when no box shows them now need 20158 on. The four recordings with 20158 on have no level-up that unlocks anything, so the wording with it on is ours: the Wiki transcripts' lines, as the box uses. The Wiki's Settings page: "a short list may be written in your chatbox when you level-up a skill".
- **Not done**:
  - Bird nest notification (189): on live this is a desktop (operating system) notification that the official client raises by itself; a nest drop sends only the red chat line and the ground item (rsprox 237/1108), and the web client has no desktop notifications.
  - Level-up guide list (494): see "Level-ups".

## Camera shake and visual effect content

What each content plugin sends for the camera shake rows above, and the visual effect rows still
open. Every shake goes through `CameraShake.send`, so its row and its group's master turn it off.

| Row | Content | What it sends |
| --- | --- | --- |
| Barrows chest (283) | `Barrows.plugin.js` | Slot 0, random 5 when the chest is looted, and again on each arrival in the tunnels while the run stays looted; the camera resets when the player leaves the tunnels. |
| Great Olm (428) | `cox/Olm.ChambersOfXeric.js` | Slots 0-2, random 2-5 each, with every volley of falling crystals (between sides and in the final stand); the camera resets with the last volley before the Olm rises, and as it dies. |
| Lizardman Shamans (427) | `cox/Shamans.ChambersOfXeric.js` | Slot 0, random 10, sine amplitude 5, a tick after a jump lands on the raider (the 3x3 it crushes). |

- **Sources.** rsprox 237/04055 and 227/01885 (Barrows: the looting tick, a teleport back into a
  looted run's chest room, the reset on leaving); 234/00820 and 234/03282 (the Olm's transitions and
  final stand); 234/03276 (the Molch shamans: the jump landing on the player at tick 6309 shakes at
  6310, landings beside them do not).
- **Not done**:
  - Lizardman Shamans: in 234/03276 two of the spawns' appearances also shake (slot 0, random 4,
    sine 2) but most do not; which ones do is not settled, so spawns send none.
  - Baba Yaga's house (281): live shakes slot 1 with sine amplitude 10, frequency 25 (and sound
    1692) a tick after arriving inside the house (227/00086, 227/01754), but there is no way into
    the house here yet (her chicken house is not enterable).
  - Fishing Trawler (282): no capture has a trawler game.
  - Show snow overlays (436, varbit 16236): live opens `snow_flakes` (167), `snow_verylight` (176),
    `snow_medium` (177) and `snow_heavy` (204) in `overlay_atmosphere` in snowy areas (Trollweiss,
    heavy to very light going down the slope, 227/00075, 227/00091, 234/00787), but the captures do
    not pin down each area's edges, so the server opens none yet.
  - Disable colourful fade effects (460): no capture shows a Guardians of the Rift fade with
    varbit 18132 set, so the minigame still follows only its own `gotr_colourful_fade_disabled`.

## Health and modified stats overlays

**Modified stats overlay** (`stat_boosts_hud`, 708). The login gameframe opens it at `toplevel_osrs_stretch:stat_boosts_hud` (161:5), next to the buff bar, as live does on every layout. Its own scripts draw the boosted and drained stats from the stat updates. Its four rows are `data/settings.json` rows, saved and sent back at login:

| Setting | Id | Variable |
| --- | --- | --- |
| Display modified stats overlay | 148 | varbit 12373 `stat_boosts_hud_hidden` |
| Show tooltips for modified stat overlays | 149 | varbit 12374 `stat_boosts_hud_tooltips_hidden` |
| Number of modified stats to show (dropdown) | 150 | varbit 12375 `stat_boosts_hud_num_displays` = option; a fresh account gets 5, which live sends at login in every rsprox recording |
| Display relative stat value | 151 | varbit 12376 `stat_boosts_hud_display_relative` |

Its tooltip's "Stats restoring" and "Boosts draining" countdowns run on the client from two scripts, sent at login and every 25 ticks of the stat restore cycle, as live does:

- `stat_boosts_hud_update_restore_up_timer` (4517): `(0, 100, ticks to the next restore)` from the core's restore timer (`Player.processStatRestoration`). Rapid Restore's own timer goes out as `(1, 100, 100)` when the prayer starts and at each of its restores, and `(1, 0, 0)` when it stops.
- `stat_boosts_hud_update_restore_down_timer` (4518): `(period, ticks to the next boost drain)` from the Potions plugin's boost cycle. The period is 150 while Preserve is on, and a player with nothing boosted gets a full period.

**Normal health overlay** (row 111, varbit 12390 `hpbar_hud_standard_disabled`, on by default: no capture sets it). It is the boss health HUD (303) in standard mode (`hpbar_hud_boss` 0), driven by `BossHud.plugin.js` for any NPC no boss plugin drives. A player's attack roll on an NPC shows it: `hpbar_hud_npc`, its hitpoints and maximum, the usual colours, open script 2376 and fade-in 2887. Each hit on it updates the hitpoints. 8 ticks after the player's last attack the HUD fades out (2889) and clears 4 ticks later. This matches rsprox recordings 1382, 2148 and 3979 (a Falador guard, a Canifis man, a calf). The Wiki gives the option to the mobile and Steam clients only, which is why desktop recordings never show it. A boss HUD always wins: an NPC id any boss event has named never gets the standard HUD, and a boss show replaces it. The client's opponent information panel steps aside for either mode while that mode's setting is on.

- **Not done**:
  - The normal health overlay fades in once when it opens. Live runs the fade-in again on the ticks after each hit.

## Buff timers read from a var

The buff bar's script (5923) draws most buffs from a var, in steps set by the buff's struct (param 1541, ticks per step). `BuffTimers.plugin.js` reads each effect's own state every tick and sends the var when it changes; the client starts them at 0 at login, so only running ones go out then. `tests/buff-timers-effects.test.cjs` checks each one.

| Row | Effect | Var | Value |
| --- | --- | --- | --- |
| 130 | Charge | varp 272 `magearena_charge` | time left in steps of 2 ticks (350 for a cast, as recorded) |
| 131 | God Wars altar | varbit 4099 `godwars_altar_delay` | cooldown left in steps of 100 ticks |
| 137 | Prayer enhance (Chambers of Xeric) | varbits 12397 tier, 5419 rate, 5417 timer | tier 1-3 for (-), plain and (+); rate 6; timer in steps of 6 ticks, as recorded |
| 138 | Overload (Chambers of Xeric) | varbits 5420 tier, 5418 timer | tier 1-3; timer in steps of 25 ticks, as recorded. The Nightmare Zone overload keeps 3955 |
| 139 | Magic Imbue | varbit 5438 `magic_imbue_active` | time left in steps of 10 ticks |
| 143 | Divine potions | varbits 8429-8433 (attack, strength, defence, ranged, magic), 13663-13665 (combat, bastion, battlemage) | ticks left (500 for a dose); a combined potion's while all its skills are locked, as recorded |
| 152 | Lesser and greater corruption | varbit 12136 `arceuus_corruption`, 12288 cooldown | 1 or 2 while the corruption waits for its hit; the cooldown 1 while it lasts |
| 154, 156, 157 | Shadow Veil, Ward of Arceuus and Resurrection cooldowns; a thrall | varbits 12291, 12293, 12290; 12413 `arceuus_resurrection_active` | 1 while each cooldown lasts (17 ticks for a thrall, as recorded); 1 while a thrall is up |
| 170 | Remaining ammo | varps 3158 `buff_bar_ammo_type`, 3159 amount, 3160 weapon | the ammo slot's item (-1 when empty) and count; the weapon -1, as recorded |
| 213 | Cannon ammo | varp 3 `rockthrower`, with varp 2 at 4 and varbit 1968 `mcannon_world` | the bar shows it only while 1968 is the client's world modulo 128, so it is now 45 (world 301) |
| 284 | Menaphite remedy | varbit 14448 `statrenewal_potion_timer` | time left in steps of 25 ticks |
| 363 | Group Woodcutting Bonus | varp 4007, varbits 15347, 15348 | 96 while chopping a tree with the bonus (-1 when not), the players at it, and one less as the value shown (as recorded) |

- **Not done**:
  - Mark of Darkness (153), the active Shadow Veil, Ward of Arceuus and Resurrection buffs (154, 156, 157), cannon decay (246), Apmeken's sight (285) and the Tombs of Amascut effects (286-291) have no var. The bar keeps their timer in a client varc that only script 5927 writes, and only `buff_bar_start` (script 5931, a struct and a value) calls it; no cache script calls 5931, so only the server can start them. Most hold the `map_clock` tick the buff ends on (the freeze, "Bound.", struct 3092: varc 476, drawn as varc 476 − `map_clock`); the Sire stun stores the client clock it started at. They stay unsent, because live never sends them: across the rsprox captures `buff_bar_start` appears in 4 recordings only, always with 0 at login or on entering a house, clearing burn damage (struct 989) and bleeding (struct 4499). It is absent from all 45 freeze recordings (rev 226-235), the 31 with a stun and the 22 Tombs of Amascut ones, where a freeze sends only its message and a thrall only its varbits. The Wiki's Settings page lists these rows as buff bar settings, but none of them is driven on live in the recordings.
  - Desert water (244): not checked. Its buff (struct 340) reads no var in script 5923, so what drives it is unknown.

## Buff timers started by buff_bar_start

The freeze (141), Staff of the dead special (142), poison damage (186) and Abyssal Sire stun (140) buffs keep their timer in a client varc that only `buff_bar_start` (script 5931: a struct and a value) writes, through script 5927. `BuffBarStart.plugin.js` runs it from each effect's own state when the value changes, and on the first tick after a login for all four, 0 for those not running, since the varcs outlive a logout and the bar ignores a start for a buff it hasn't built yet. Script 5923 draws each against varp 3079 `map_clock`, the tick count the server sends every tick. `tests/buff-bar-start.test.cjs` checks each one.

| Row | Effect | Struct, varc | Value |
| --- | --- | --- | --- |
| 140 | Abyssal Sire stun | 3091, varc 475 | any: the client stores its own clock and draws 30 seconds from it; a restun starts it again. It can't be cleared, so it runs out by itself, a few seconds after the Sire's 46-tick stun ends |
| 141 | Freeze, bind, snare, entangle ("Bound.") | 3092, varc 476 | the tick the freeze ends on (script 4678: varc − map_clock); 0 when it ends, or at death, which cancels it |
| 142 | Staff of the dead special | 3093, varc 477 | the tick it started (script 5940 draws param 1541, 100 ticks, from it); 0 once the minute is up or the effect ends early. A death doesn't end the effect, so the buff runs on through it |
| 186 | Poison and venom damage | 3740 poison, 3741 venom, varc 983 | the tick the current 30-tick pulse started, so it shows the time to the next hit; shown only while varp 102 `poison` is a poison or venom value; 0 once cured |

- Ours: live has not been recorded sending `buff_bar_start` for any of these (see the "Not done" note above, which still holds for the other varc buffs); the structs, varcs and durations are the cache's.

## Sailing helm and orb

These rows are in `data/settings.json` and are read by the Sailing helm plugins when the player acts. Each struct has param 1084 apart from 462, so the toggles are ticked while their varbit is 0, which is also a new account's value. Tests: `tests/sailing.test.cjs` ("All Settings 461/462/501") and `tests/settings-wired-rows.test.cjs`.

| Setting | Id | Varbit | Effect |
| --- | --- | --- | --- |
| Stop the boat when leaving the helm | 461 | 18135 | At 1, letting go of the helm (Stop-navigating, clicking another loc, a charting spot) frees the helm and walks again, but the sails, move mode and heading stay, so a boat under sail sails on with nobody steering (`Helm.Sailing.js` `leaveHelm`). A boat at rest, or a content scene's ship (the Pandemonium's supplied helm), stops as before |
| Start the boat when setting a heading (dropdown: First time only, Always, Never) | 462 | 18136 `sailing_start_boat_when_setting_heading` = option | First time only: a heading raises full sail only while moored (just after taking the helm). Always: from stopped too. Never: a heading only turns the boat (`raiseSailForHeading`) |
| Special Attack orb releases wind motes | 501 | 11624 `settings_sailing_wind_on_orb_disabled` | The client's orb script (9482) shows "Release" on "Wind Mote" in place of the special attack while the player is on their own boat with a catcher (11629 set), locked in at the helm, and 11624 is 0. Op1 then releases a mote as the catcher's Release-mote does (rsprox 4151 and 4152, rev 238: "You release the wind mote for a burst of speed!" on the click's tick). 11629 `sailing_sidepanel_boat_max_wind_charges` is the catcher's capacity (2, or 3 for a gale catcher), sent on boarding your own boat and set back to 0 on leaving it, as live does (`WindCatcher.Helm.js`) |

- **Not done**:
  - **Cargo hold access privacy** (470, varbit 19614: Navigators, All players, No players): a guest can't open another player's cargo hold at all yet, and no capture or Wiki text gives the refusal line.
  - Ours: with the catcher switched off, the orb's Release does nothing, as Release-mote does.

## Pickups into containers

Rows 305 and 306 are `data/settings.json` toggles, off for a new account. While one is on, a ground stack goes somewhere other than the inventory when the cache's row text says so; otherwise the ordinary pickup runs. These pickups pass the same Ironman guard and take checks, report `ground-items:taken` and play the pickup sound, as an ordinary pickup does (`plugins/items/TakeInto.js`). All or nothing: a stack that doesn't fit whole goes to the inventory. Tests: `tests/pickup-containers.test.cjs`, `tests/tutors-ammo-pickup.test.cjs`.

| Setting | Id | Variable | Where the stack goes |
| --- | --- | --- | --- |
| Ammo-picking behaviour | 305 | varbit 5697 `take_ammo_toggle` | Ammo matching the worn ammo slot stacks there (`npcs/Tutors.plugin.js`); otherwise ammo matching a worn Dizana's quiver goes into it (`items/DizanasQuiver.plugin.js`) |
| Rune-picking behaviour | 306 | varbit 5698 `take_runes_toggle` | Runes picked up, or made at an altar, go into the carried rune pouch when a slot already holds that rune with room for all of them (`items/runepouch/Pickup.RunePouch.js`, [rune-pouch.md](rune-pouch.md)) |

The tutors write the same rows: the Ranged combat tutor's "Can you toggle my ammo to equip when I pick it up please?" sets 305, and the Magic combat tutor's "Let's discuss how my runes act when I pick them up." sets 306. A pre-Settings Ranged tutor choice saved on the old `ranged:equip-ammo-on-pickup` attribute is migrated into row 305 at login unless a setting is already saved.

- **Not done**: the bolt pouch, the row's other target for ammo, is not in tsps yet (see row 356).

## Settings the client changes itself

The cache's toggle script (3965) flips some rows' varbits in the browser before the row click is sent, and the client transmits the whole varp (`TRANSMIT_VARPS` in `client/common/vars.ts`). `Settings.plugin.js` keeps the bits of its own `settings.json` rows from varps 1224, 1734 and 2856 (other bits, like the collection log's on 2856, stay with their plugins), asking `refuseLockedSetting` first. The row click that follows takes the transmitted value (`SettingVarpTransmit`) instead of flipping it back; with no transmit (the official client) the click toggles it on the server as before.

| Setting | Id | Var | Notes |
| --- | --- | --- | --- |
| Anti Drag | 115 | varbit 12345 (varp 2856) | toggle; the cache's inventory scripts apply it |
| Anti Drag - Delay (number) | 236 | varbit 13830, 8 bits | `AntiDragDelay.plugin.js` asks for milliseconds and keeps them in 20 ms steps, up to 5000 ms (the row's description) |
| Anti Drag - Enable Key / Disable Key | 237, 238 | varbits 13828, 13829 | the option's key code, which script 3962 reads back through enum 4302: 0 none, 81 Shift, 82 Ctrl |
| Esc closes the current interface | 57 | varbit 4681 (varp 1224, bit 31) | saved in its keybind (`keybind_4681`), as the keybindings panel's toggle; both share one toggle |
| Display Relics | 127 | varbit 12383 (varp 1734) | the buff bar's relic op (script 3231) flips it with no click; varp 1734 is transmitted for it |

Scripts 518, 2518, 4607 and 4611 are only called by the toggle script for their All Settings rows, which are saved from the click. Live logins send varp 3416 as 1 (no delay, no keys). Tests: `tests/settings-client-saves.test.cjs`, `client/tests/buff-bar-settings-varps.test.ts`.

- **Not done**: the official client transmits no varps, so a relic change made on its buff bar is still not saved. Ours: the delay prompt's wording (no capture of it).

## Examine price info

Rows 234 (Grand Exchange, varbit 13826 `examine_price_ge_enabled`) and 235 (Alchemy, varbit 13827 `examine_price_alch_enabled`) are `data/settings.json` toggles, on by default. Examining an item adds a line after its examine text:

- `Price of Steel scimitar: GE 67  HA 240  LA 160` for one item, `Price of 100 x Feather: GE 300 (3ea)  HA 100 (1ea)` for a stack, with the numbers in red. Grand Exchange adds the GE part, Alchemy the HA and LA parts.
- A part whose value is 0 is left out, and so is the whole line when nothing is left. Untradeable items have no line. A note is priced and named as the item it notes.
- The GE part is the world's guide price (the one `/api/item-prices` serves); HA and LA are what the alchemy spells pay (none for an item they refuse, such as a bond).

The server's item examines all go through `examineItem` (`game/content/ExaminePrice.ts`): the inventory and ground items (`net/NetworkBuilder.ts`), the worn equipment tab, the bank and its worn-items view (`Bank.ts`), the shop's stock and side inventory (`ShopManager.ts`), the equipment stats screen (`EquipmentStats.plugin.js`), and the plugins' own item interfaces: the looting bag's Check and Deposit views and its bank view, the gravestone, Death's office and coffer, the Zulrah, Vorkath, Mimic, Theatre of Blood and Tombs of Amascut retrieval chests, the seed vault, the chugging barrel, the Explorer's ring alchemy screen, Tai Bwo Wannai's parcels, Probita's pet list, the menagerie, and the Duel Arena and Last Man Standing loadouts. Live answers a looting bag examine with the price values too (rsprox 224/1545). The trade window's items are examined in the client (`OsrsClient.examineWidgetItem`, `client/game/examinePrice.ts`), with the guide prices from `/api/item-prices` and the alchemy values from `/api/item-alchemy` (`ItemDefinitionLoader.plugin.js`), so both sides show the same values. A shop prices its whole stock, as the bank prices the banked stack (ours). The format is from screenshots of the official client. Defaults: the Alchemy varbit is 1 in all 3,239 rsprox logins that send it. The Grand Exchange one is 1 in all 2,244 non-Ironman logins and in all 218 Ironman ones but for a single fallen Hardcore Ironman account (777 logins, the same death date in each), which has it off: that player's own setting, not an Ironman default, so every account starts with both on. No capture has an Ultimate, Hardcore or group Ironman (the `ironman` varbit is 1 in each); ours: they start with it on as well. Tests: `tests/examine-price.test.cjs`, `tests/examine-price-routes.test.cjs` (each server route), `client/tests/examine-price.test.ts`.

- **Ours**: the exact red (`<col=ff0000>`) and the two spaces between parts, read off the screenshots.

## Player menu options and Ctrl-run

| Setting | Id | Variable | What it does |
| --- | --- | --- | --- |
| Player Trade options | 312 | varbit 6580 `tradeoption_disabled` | while 1, the browser client leaves "Trade with" off the player menu (`client/render/render/interact/playerMenu.ts`) |
| Player Report options | 372 | varbit 1334 `rightclick_report_abuse_disabled` | while 1, `ReportAbuse.plugin.js` sends player option 8 empty instead of "Report", at login and on the row's click; a slot 8 click is then not a report |
| Ctrl+click to invert run mode (dropdown) | 207 | varbit 13132 `runinvert_mode` = option | options from enum 4074: 0 Never, 1 Walk -> Run Only, 2 Run -> Walk Only, 3 Always. A Ctrl-click walk, or a Ctrl-click on an NPC, object, ground item or player (their op, use-on and spell-on packets), inverts the run mode only in the directions the option allows (`clickRunOverride` in `net/NetworkBuilder.ts`) |

Live sends the player ops at login after the varbits: with 1334 at 1, `set_player_op` 8 is null, otherwise "Report" (rsprox 238/4238, 229/2375); 1334 is 1 at login in 1,813 recordings. `runinvert_mode` is 3 (Always) at login in all 4,281 recordings that send it, so a fresh account starts at Always (`default` in settings.json). No capture changes `tradeoption_disabled`, and none shows the option toggled in game, so sending the option on the click is ours. Tests: `tests/report-abuse.test.cjs`, `tests/run-invert-mode.test.cjs`, `tests/settings-wired-rows.test.cjs`, `client/tests/player-follow-menu.test.ts`, `tests/ctrl-click-interaction-run.test.cjs`.

The row's text (struct param 1096) covers both: holding Ctrl "when clicking to walk or interact" temporarily inverts the run mode. A walk click's inversion is `MovementQueue`'s run override for that path only. An interaction click's is its click run override: it takes effect when the click starts its walk, lasts through the interaction's re-paths (a walking NPC, a followed player, a fight's chase), and ends at the end of the first turn the player is idle (no route, follow, fight or walk-to left), or at the next click. A retaliation chase isn't a click, so it always follows the run setting. The captures carry the Ctrl byte (`ctrl=true` on `opnpc2` and `oploc1`, rsprox 227/1851 and 227/572) only on clicks that walk nowhere, so how long the inversion lasts while chasing is ours.

- **Not done**: the browser client's own loc, ground item and use-on packets (`LOC_INTERACT`, `GROUND_ITEM_ACTION`, `INVENTORY_USE_ON`) and boat clicks carry no Ctrl byte, so they always follow the run setting. Menu clicks in both clients send the op packets above.

## Mouse, hotkeys and the World Switcher

These rows are `data/settings.json` toggles, off for a new account; the browser client applies them as soon as the var changes, and again at login.

| Setting | Id | Variable | What it does |
| --- | --- | --- | --- |
| Single mouse button mode | 48 | varp 170 | while 1, a left click where there is more than one option opens the menu, as a right click does (`settings.leftClickOpensMenu`; the cache's scripts never set it, the engine follows the varp) |
| Middle mouse button controls the camera | 49 | varbit 4134 `mousecam_disabled` | while 1, the middle button no longer turns the camera (`InputManager.mouseCamEnabled`); script 907 also sets it when the layout is built |
| Move follower options lower down | 50 | varbit 5599 `followerops_deprioritised` | while 1, a follower's options go below Walk here (`ClientState.followerOpsLowPriority`) |
| Modern Layout - Side panel can be closed by the hotkeys | 54 | varbit 4611 `hotkey_cannot_close_sidepanel` | while 1, a hotkey (an F-key, or Esc when there is nothing for it to close) for the side panel already open leaves it open. The client handles the F-keys itself and calls the side-panel switch (script 71) with closing off, as the cache's own key handler (script 905, bound by 907) does |
| World Switcher confirmation | 347 | varbit 4100 `worldswitcher_disable_confirmation` | while 0, choosing another server in the in-game World Switcher asks "Are you sure you wish to switch to <server>?" with Cancel and Switch world first |
| World Map Hotkey | 441 | varbit 16621 `settings_world_map_hotkey_disabled` | while 0, Ctrl+M opens the World Map: the minimap's key-down listener (script 1492 binds 5141) triggers the orb's op |

Opcodes 1430/2430 and 1431/2431 set a component's key-down and key-up listeners (`if_setonkeydown`, `if_setonkeyup`; the client had them as item-on-item and clan settings). They run for every key pressed or released, with the key's code as `event_keycode`. Live's confirmation is the server's objectbox (193) with "Cancel|Switch world" and the world's number (rsprox 235/3313); here the World Switcher lists servers, not worlds, so the client asks in the list itself and names the server (ours). Tests: `tests/settings-wired-rows.test.cjs`, `client/tests/control-settings.test.ts`.

- **Not done**: with the middle-mouse camera off, a middle click does nothing; whether live then treats it as a left click isn't documented.

## Game client layout and data orbs

Two Interfaces rows that change the gameframe itself, handled in `Settings.plugin.js`.

| Setting | Id | Variable | What it does |
| --- | --- | --- | --- |
| Game client layout (dropdown: Fixed - Classic, Resizable - Classic, Resizable - Modern, Resizable - 317, Fixed - 317) | 12 | the saved layout (`client-layout-root`), as the side panel's dropdown | the same switch as the side panel's dropdown (116:40): the root interface becomes 548, 164 or 161, the open interfaces move onto it and the orbs are reopened for it |
| Show data orbs | 8 | varbit 4084 `orbs_disabled` (1 hides them) | the orbs interface (160, or 897 on the mobile layout) closes while it is set and opens again when it is cleared |

- **Game client layout.** Both dropdowns are on enum 3509. The cache has its first three options; our client adds the two 317 layouts to it, so both list all five, and the server takes all five (the official client shows only the three). On the mobile client the layout stays mobile and the choice isn't saved, as with the side panel.
- **Show data orbs.** A login, the welcome screen's Play and a layout change open the orbs only while the row is on, as live logs in with `orbs_disabled` set (the speedrunning and Leagues tutorial logins in the rsprox captures leave 160 closed and open it at `toplevel:orbs` when the var goes back to 0). The Leagues tutorial hides them while it runs, and its end puts the player's own choice back (`settings:restore-data-orbs`). Tests: `tests/settings-gameframe-orbs.test.cjs`, `tests/settings-wired-rows.test.cjs`.
- **Not done**: no capture shows the row itself being clicked; ours: a click closes or opens 160 at once, as the tutorial captures do when the var changes.

## Minimenu options and filters

The rows sit on varp 4503. The cache's own scripts apply them in the client: a click runs the row's script there (7458 start position toggle, 7459 start entry, 7460 spacing, 7461 a filter, 728 scrollbar), and the login script (876) runs 7468, which applies them all from the varbits. So the server only keeps them: varp 4503 is one the browser client transmits whole when a script changes it, and the settings.json rows on it are saved from that (the spacing slider sends nothing else), as from a row click.

| Setting | Id | Variable | In the client |
| --- | --- | --- | --- |
| Modify minimenu start position | 391 | varbit 11520 `settings_minimenu_start_index_toggle` | game option 13: 0, or the start entry + 1 |
| Minimenu start position (dropdown: Entry 1-8) | 392 | varbit 11522 `settings_minimenu_start_index` = option | that entry opens under the mouse (the last one, for a shorter menu) |
| Minimenu spacing (slider) | 393 | varbit 11523 `settings_minimenu_spacing` | game option 14, 0-100; each row is that many pixels taller |
| Minimenu spacing value (number) | 394 | varbit 11523 | asks for the spacing, then runs 7460 with it |
| Reset minimenu spacing (button) | 395 | varbit 11523 = 0 | runs 7460 with 0 |
| Minimenu scrollbar | 419 | varbit 71 `settings_minimenu_scrollbar_toggle`, ticked while 0 (param 1084), so on for a new account | the client's scroll flag (`1 - varbit`); a menu taller than the screen then shows a scrollbar |
| Disable entity options | 398 | varbit 11526 `settings_minimenu_filter_entity` | block slot 2: NPC, object and ground item options leave the world menu |
| Disable player options | 402 | varbit 11530 `settings_minimenu_filter_player` | block slot 6: player options leave it |
| Disable examine | 405 | varbit 11533 `settings_minimenu_filter_examine` | block slot 9: Examine on NPCs, objects and ground items leaves it |

`minimenu_setblockmode(slot, 1 - varbit)` sets the filters, so mode 0 leaves an entry out (`client/ui/menu/minimenuFilters.ts`). Item use ("Use <item> -> <target>", while an item is selected) and spell entries have filters of their own (slots 7 and 1, rows not in the desktop list, enum 422), so the entity and player filters leave them in; a loc or NPC op that is itself named Use is an entity option. The menu's layout is drawn in `client/widgets/gl/choose-option.ts`. No capture shows these rows changed: the minimenu varbits appear only in rev 223-226 recordings, which predate this varp layout, so the start entry and spacing units, the scrollbar's look and the number row's prompt are ours. Tests: `tests/settings-minimenu.test.cjs`, `tests/settings-wired-rows.test.cjs`, `client/tests/minimenu-settings.test.ts`.

- **Not done**: Minimenu reordering (406, 407). The other filter rows on the same varp (396, 397, 399-401, 403, 404: visual feedback, target, interface, walk, global click, use, cancel), which the desktop list doesn't show, are not saved or obeyed. The touch controls' tap panel (`client/game/plugins/touchcontrols`) offers its own option list and ignores the filters.

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

### Death protection from cosmetics (row 386)

Row 386 is a `data/settings.json` toggle on varbit 10987 `death_waivecosmeticsprotection`, saved and sent back at login. The varbit is 1 when the player turns protection off, so a fresh account (0) has it on; no rsprox capture ever sets it to 1. Its cache text: "When enabled, cosmetic upgrades such as ornament kits may cause certain items to be protected during a non-PvP death, rather than falling to a grave."

- **What it protects** (Wiki: Items Kept on Death, the Mechanics table; Ornament kit; Bounty hunter ornament kit; Volcanic abyssal whip): an item in `items/data/ornament-kits.json` made with a tradeable ornament kit, mix or paint, or with the untradeable Bounty Hunter ornament kit (`OrnamentKits.plugin.js` answers `player-death:cosmetic`). The granite clamp counts on a granite maul with the ornate handle too, in either order of attaching (Wiki: Ornament kit, Granite maul (ornate handle, clamp)). Not protected: untradeable modifications (the Wiki's example is the twisted ancestral colour kit) and recolours made at an NPC (Deadman imbued capes), which go to the grave. Ours: the other untradeable kits (dark dye, the Theatre of Blood holy and sanguine kits, the cursed phalanx, Vorkath's head) are treated the same way; their Wiki pages give no PvM rule. The death ranks a protected item like any other. If it is among the kept ones it takes that slot; if not, it is kept on top of them, skulled or not (`PlayerDeathTask.getKeptItems`).
- **When:** not on a death to another player, and not in the Wilderness (`PlayerDeathTask.protectsCosmetics`). A failed Tombs of Amascut raid is a PvM death: its retrieval chest takes what the death doesn't keep, so a protected item stays with the player (`toa/Retrieval.TombsOfAmascut.js`). With the row off the item ranks normally and, unkept, goes to the grave.
- **Items Kept on Death** keeps its three (or four) kept slots for the ranked items and lists a protected item with the others, marked kept. Its PvP and Wilderness toggles show the death without the protection.
- Tests: `tests/cosmetic-death-protection.test.cjs`.
- **Evidence:** the cache has no per-item flag for this; only the settings scripts (3965, 6716) read the varbit. In the 24 Items Kept on Death opens with full item lists in the rsprox captures (recordings 430 to 4291, revisions 230-239), no ornamented item sits outside the kept slots, so none confirms the protection directly; none of the items live marks lost there is one this protects (tests/cosmetic-death-protection.test.cjs checks a sample). The four Tombs of Amascut failures captured (recordings 1753, 1762 twice, 3431) hold no ornamented item either, so the chest rule follows the Wiki's: the raid's death is "the same as dying under normal circumstances" (Tombs of Amascut, Death mechanics). The cache item 24226 the clamp entry used to give is the handled maul's placeholder (value 1, its note id 24225).
- **Bounty Hunter risk skulls** rank without it on purpose: a skull shows what a death to another player would lose, and such a death never protects cosmetics (Wiki: Items Kept on Death, the PvP column drops ornamented items to the killer).
- **Deadman recolours** made at an NPC (Nigel's imbued god capes and weapons) go to the grave on live (Wiki: Items Kept on Death, "Items recoloured via NPC interaction"); none exists here yet.
