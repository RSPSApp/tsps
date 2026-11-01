# Coverage

Every tsps message, and the revision-241 packet it becomes. **State** is `mapped`, `dropped`
(never reaches the official client; counted at runtime) or `todo`. **M** is the milestone that
maps it. A row only becomes `mapped` with a test that decodes the result.

Native-bit rows need the `native` HANDSHAKE capability: tsps sends the extra fields only to gateway
sessions, so the browser wire format doesn't change.

## tsps → client

| tsps message | 241 packet(s) | State | M | Notes |
| --- | --- | --- | --- | --- |
| 0 WELCOME | — | dropped | 1 | browser clock sync |
| 1 TICK | SERVER_TICK_END | mapped | 1 | tsps sends it first; the gateway flushes the tick and ends with it |
| 2 HANDSHAKE | login response OK, first PLAYER_INFO | mapped | 1 | index, admin → staff level, members |
| 3 LOGIN_RESPONSE | login response | mapped | 1 | 2 (full) → 7, 27 → 26, others 1:1; token dropped |
| 4 LOGOUT_RESPONSE | LOGOUT / MESSAGE_GAME | mapped | 4 | a refusal becomes a game message |
| 6 PLUGIN_MESSAGE | — | dropped | 1 | plugin features (quest helper, voice, pest control) |
| 20 PLAYER_SYNC | PLAYER_INFO | mapped | 2–3 | every player tsps shows gets an avatar in the session's world; update blocks become extended info; worn slots hide by the cache's wearpos2/3 |
| 21 NPC_INFO | NPC_INFO | mapped | 3, 8 | tsps's remove-and-re-add (jump, type change) becomes a teleport/setId of the same avatar; rsprot's own range culling is off, tsps decides visibility. Model customisation: tsps's per-slot overrides are applied to the type's models from the cache (an empty list resets). Tint: tsps sends NPC tint (mask 0x100) as it does for players. Hit delays and exact-move pass through |
| 22 ANIM | — | dropped | 1 | base anims are in appearance |
| 23 MOVEMENT_POSITION | — | dropped | 2 | sub-tile movement has no OSRS form |
| 40 / 41 / 44 VARP_SMALL / LARGE / LONG | VARP_SMALL / LARGE / LONG | mapped | 4 | ids ≥ the cache varp count (5996) dropped |
| 42 VARBIT | VARP_SMALL / LARGE | mapped | 4 | written into the session's varp mirror from the cache varbit definition |
| 50 / 51 INVENTORY_SNAPSHOT / SLOT | UPDATE_INV_FULL / PARTIAL (93) | mapped | 5 | |
| 52 / 53 BANK_SNAPSHOT / SLOT | UPDATE_INV_FULL / PARTIAL (95) | mapped | 5 | tab/placeholder bits dropped (tabs are varbits; placeholders are their own obj ids) |
| 54 / 55 GROUND_ITEMS / DELTA | OBJ_ADD / DEL / COUNT _SPECIFIC | mapped | 5 | stack-id state, scene-filtered and re-sent after each rebuild; tick timers become ticks until public/despawn |
| 70 / 71 SKILLS_SNAPSHOT / DELTA | UPDATE_STAT_V2 per skill | mapped | 4 | the combat level goes to varbit 13027, which the browser sets itself |
| 81 RUN_ENERGY | UPDATE_RUNENERGY, UPDATE_RUNWEIGHT, varp 173 | mapped | 4–5 | energy in 1% steps; weight is worked out from cache obj weights over inventory and worn items, since tsps never sends it |
| 83 SPOT_ANIM | MAP_ANIM_SPECIFIC | mapped | 7 | tile spot anims (actor ones are in the sync blocks) |
| 84 PROJECTILES | PROJANIM_SPECIFIC_V4 | mapped | 8 | heights pass through (tsps already ×4); actors locked as rsprot expects (player -(i+1), NPC i+1) |
| 87 DESTINATION | SET_MAP_FLAG_V2 | mapped | 2 | 0,0 clears the flag |
| 88 PLAYER_OPTION | SET_PLAYER_OP | mapped | 3, 8 | plus Trade with (op 2) and Follow (op 3) at login, and Attack (op 1) while the wilderness varbit (5963) is set, which the browser adds itself |
| 89 HINT_ARROW | HINT_ARROW | mapped | 7 | npc, tile, player, world entity, reset; a tile arrow's level scope is lost |
| 90 ATTACK_TIMER | — | dropped | 8 | tsps HUD |
| 100 / 101 WIDGET_OPEN / CLOSE | IF_OPENSUB / IF_CLOSESUB | mapped | 4 | modal opens go to the main modal area and are remembered for the close; non-modal ones are dropped (tsps's browser mounts nothing for them either) |
| 102 WIDGET_SET_ROOT | IF_OPENTOP | mapped | 1 | sets the root the 161 remap uses | |
| 103 WIDGET_OPEN_SUB | VARP_*, RUNCLIENTSCRIPT, IF_OPENSUB, IF_SETHIDE, RUNCLIENTSCRIPT | mapped | 4 | split in that order; 161 targets remapped through cache enums 1129/1131/1132/1745; groups ≥ 30000 dropped |
| 104 WIDGET_CLOSE_SUB | IF_CLOSESUB | mapped | 4 | 161 remap |
| 105–108, 113–115, 117–119 WIDGET_SET_* | IF_SETTEXT / HIDE / OBJECT / NPCHEAD / ANGLE / ANIM / PLAYERHEAD / MODEL / POSITION / COLOUR | mapped | 4 | colour splits tsps's 15-bit RGB into its channels |
| 109 / 111 / 112 WIDGET_SET_FLAGS* | IF_SETEVENTS_V2 | mapped | 4 | old op bits 1–10 move to events2 |
| 110 WIDGET_RUN_SCRIPT | VARP_*, UPDATE_INV_FULL, RUNCLIENTSCRIPT | mapped | 4–5 | script -1 = vars and inventories only |
| 116 WIDGET_SET_QUEST_LIST | — | dropped | 4 | browser-only quest list widget |
| 120 CHAT_MESSAGE | MESSAGE_GAME, PLAYER_INFO chat, MESSAGE_PRIVATE(_ECHO), MESSAGE_FRIENDCHANNEL, MESSAGE_CLANCHANNEL | mapped | 3–6, 12 | public: one PLAYER_INFO chat block (overhead copy suppressed, crown from `<img=N>`) with the colour, effect and pattern tsps appends, and the autotyper flag for autochat; game/system types → MESSAGE_GAME; private in/out, friends chat and clan chat (41 own clan, 44 guest clan: clan types 0 and -1) → their packets with a gateway message counter and world 1. Clan notices 43 and 46 stay MESSAGE_GAME, as the live intro notice is; live's MESSAGE_CLANCHANNEL_SYSTEM is for broadcasts, which tsps doesn't send. Mod private (7) has no tsps source |
| 124 CLAN_SETTINGS_FULL | CLANSETTINGS_FULL | mapped | — | display names, no hashes (flags 2), as live; a null clan is the leave form. Loot and coin share ranks are 0, which tsps doesn't have. The owner and replacement slots are dropped: the packet has no field for them |
| 125 CLAN_CHANNEL_FULL | CLANCHANNEL_FULL | mapped | — | display names, no version, as live; a null channel is the leave form |
| 126 CLAN_CHANNEL_DELTA | CLANCHANNEL_DELTA | mapped | — | add and delete user. Live's update number is the count the delta applies on top of, tsps's the count after it, so the gateway counts from the last full update and ignores tsps's. Dropped when no channel with that key is up |
| 127 CLAN_SETTINGS_DELTA | CLANSETTINGS_DELTA | mapped | — | add member (V2), delete member, rank, muted, extra info, int setting; numbered as 126, owner 0 as live. Dropped before a full update |
| 128 CLAN_VAR | VARCLAN_ENABLE, VARCLAN | mapped | — | int values; enabled once, before the first. No recording has a VARCLAN, so that it needs enabling is unconfirmed |
| 121 FRIENDS_CHAT_UPDATE | UPDATE_FRIENDLIST, UPDATE_IGNORELIST, UPDATE_FRIENDCHAT_CHANNEL_FULL_V2, FRIENDLIST_LOADED | mapped | 6 | the channel only goes when it changed; FRIENDLIST_LOADED once |
| 122 CHAT_FILTER_SETTINGS | CHAT_FILTER_SETTINGS + _PRIVATECHAT | mapped | 6 | |
| 123 TRIGGER_ONDIALOGABORT | TRIGGER_ONDIALOGABORT | mapped | 4 | |
| 131 SOUND | SYNTH_SOUND / SOUND_AREA | mapped | 7 | an area sound's delay is clamped to a byte; radius → radius, attenuation → size |
| 132 PLAY_JINGLE / 133 PLAY_SONG | MIDI_JINGLE / MIDI_SONG_V2 | mapped | 7 | |
| 134 / 135 / 136 LOC_ADD_CHANGE / DEL / ANIM | LOC_ADD_CHANGE_V2 / LOC_DEL behind UPDATE_ZONE_PARTIAL_FOLLOWS; LOC_ANIM_SPECIFIC | mapped | 7 | tsps replays the scene's loc changes itself after a rebuild |
| 137 CAMERA_CONTROL | CAM_* | mapped | 7 | easings remapped to OSRS ids; plain instant/animated moves use rates 100/100 and 2/10; translate dropped, a tile glide becomes a tile target, trackTarget dropped: rev 241 has no form for them (no target tracking during a timed move, no timed tile glide, no shift of a running shot), and imitating them would need guessed camera state |
| 140 / 141 REBUILD_REGION / NORMAL | REBUILD_REGION_V2 / REBUILD_LOGIN_V2 / REBUILD_NORMAL_V2 | mapped | 1–2 | the scene before login becomes REBUILD_LOGIN (an instance follows as REBUILD_REGION); tsps's template chunks are rsprot ReferenceZones. tsps's rebuilds of a scene that still covers the player (it moves an instance's scene every zone or two) are dropped, as the client would reload. In a private area on the real map (the Fractured Archive) tsps sends none, so the gateway sends REBUILD_NORMAL itself once the player is 16 tiles from the scene's edge, tsps's own rule |
| 142 / 143 REBUILD_WORLDENTITY / WORLDENTITY_INFO | REBUILD_WORLDENTITY_V4 / WORLDENTITY_INFO_V7, SET_ACTIVE_WORLD_V2 | mapped | 13 | each boat is a world-entity avatar (fine coords and angle as tsps sends them; owner 0, which tsps doesn't send and rsprot doesn't need: the world the player is on goes first). Its deck scene is REBUILD_WORLDENTITY_V4 from tsps's template grid, sent inside the boat's world when rsprot adds it. tsps keeps everything on a deck at real instance coordinates, as rsprot does: deck locs and animations go to the boat's world relative to the deck (held until that world is active), deck NPCs are placed from the deck's corner, and players and NPCs aboard are lifted to the deck's level 1, where OSRS has them (tsps keeps them on 0 for its browser renderer); boats get session-local world ids, as rsprot takes ids below 2048 and tsps numbers boats from 3000. Tick order: boats, then each boat's world (scene, zones, NPCs), then the main world. Boarding, the helm and sailing work in RuneLite |
| 144 REGION_REPLACEMENT | — | dropped | 2 | server map data the client can't load |
| 145 / 146 SET / RESET_INTERACTION_MODE | SET / RESET_INTERACTION_MODE | mapped | 7 | |
| 150 / 152 SHOP_OPEN / CLOSE | UPDATE_INV_FULL / STOP_TRANSMIT (516) | mapped | 5 | interface and script come separately; tsps's prices and modes are dropped (the client works prices out) |
| 154 TRADE_REQUEST | — | dropped | 9 | the type-101 game message carries it |
| 155 / 156 / 157 TRADE_OPEN / UPDATE / CLOSE | UPDATE_INV_FULL (90, 90 \| 0x8000), MESSAGE_GAME | mapped | 9 | tsps opens 335/334/336 and writes their text itself; only the offers needed translating |
| 190 COLLECTION_LOG_SNAPSHOT | UPDATE_INV_FULL (620) | mapped | 5 | |
| 210 GAMEMODE_DATA | — | dropped | 4 | custom items/models, league overrides; custom items fall back to `baseItemId` |
| 220 SYSTEM_UPDATE | UPDATE_REBOOT_TIMER_V2 | mapped | 7 | centiseconds → ticks |
| (equipment) | UPDATE_INV_FULL (94) | mapped | 5 | native bit: tsps sends inventory 94 on WIDGET_RUN_SCRIPT at login and on every change, with quantities; otherwise built from the local appearance |
| (GE varps 7900–7955) | UPDATE_STOCKMARKET_SLOT_V2 | mapped | 5 | 8 slots × 7 fields; selling states are buying + 8 |

## Client → tsps

| 241 packet | tsps opcode | State | M | Notes |
| --- | --- | --- | --- | --- |
| login block | 204 LOGIN, 202 HANDSHAKE | mapped | 1 | X-Real-IP; native bit; token logins rejected |
| NO_TIMEOUT | 201 PING | mapped | 1 | sent by the gateway every 5 s while ticks arrive |
| MOVE_GAMECLICK / MOVE_MINIMAPCLICK | 16 MOVE_GAMECLICK | mapped | 2 | key combination passes through (1 ctrl, 2 ctrl+shift) |
| SET_HEADING | 214 | mapped | 2 | |
| IF_BUTTON (if1) / IF_BUTTONX | 13 / 91 | mapped | 2 | mapped early: returning accounts log in to the welcome screen, whose play button is an IF_BUTTONX |
| IF_SUBOP | 89 | mapped | 4 | |
| IF_BUTTOND | 1, or 242 INVENTORY_MOVE for 149:0 | mapped | 4–5 | |
| IF_BUTTONT | 90, or 241 INVENTORY_USE_ON for item on item | mapped | 4–5 | the client only sends it onto a slot whose events make it a target: the gateway adds live's target events (bits 11-16 and 21) to tsps's inventory slots (149:0), which the browser builds its menus without |
| IF_SCRIPT_TRIGGER | 30 IF_TRIGGEROPLOCAL | mapped | 4 | the script's crc goes in tsps's op field; the argument bytes pass through |
| RESUME_PAUSEBUTTON / P_COUNT / P_NAME / P_STRING / P_LONG | 62 / 192 / 193 / 194 / 192 | mapped | 4 | a long count is clamped to an int |
| CLOSE_MODAL | 55 IF_CLOSE | mapped | 4 | |
| settings / run orb buttons | 191 VARP_TRANSMIT, tsps button handlers | mapped | 10 | run orb (160:28) toggles varp 173 from the mirror. Volumes are stored by the server, as live does: the sliders' scripts set the varp in the client and, when released, send IF_SCRIPT_TRIGGER on 116:95/109/123/137 with the new level, which sets tsps's stored master, music, sound-effect and area volumes (varps 3796/168/169/872); tsps sends them back at login. The client sends those triggers only with the transmit-trigger event (bit 23) on the slider, which tsps sets as live does. Esc-to-close is the keybinds toggle tsps already handles. XP drops setup (137): tsps enables the dropdown rows for native sessions and saves the choice (varp 1227), as it does for the browser's VARP_TRANSMIT |
| logout button | 203 LOGOUT | mapped | 4 | logout tab 182:8 and world switcher 69:25 |
| OPPLAYER1–8 / OPPLAYERT | 44… / 32 or 65 | mapped | 3, 5 | `T` from the inventory (149:0) is item use (65), otherwise a spell (32) |
| OPNPC1–5 / OPNPC6 / OPNPCT | 76, 12, 34, 70, 57 / 9 / 75 or 36 | mapped | 3, 5 | subop dropped; `T` split as for players |
| OPLOC1–5 / OPLOC6 / OPLOCT | 96, 28, 42, 38, 51 / 85 / 2 or 86 | mapped | 5 | subop dropped |
| OPOBJ1–5 / OPOBJ6 / OPOBJT | 102, 43, 103, 56, 82 / 104 / 94 or 79 | mapped | 5 | |
| OPWORLDENTITY1–5 | 220–224 | mapped | 9 | (boats aren't drawn yet, see 142/143) |
| OPWORLDENTITY6 | — | dropped | 9 | 241 sends a type id, tsps reads an index |
| MESSAGE_PUBLIC / CLIENT_CHEAT | 190 CHAT | mapped | 2–3 | public (0), autotyper (1 → autochat) and friends chat (2); colour, effect and pattern are appended for tsps. Clan chat: type 3 with clan type 0 → kind 4 clan 0, type 4 (guest) → kind 4 clan -1, without colour or effect, which tsps's clan chat has no field for; other clan types dropped. CLIENT_CHEAT: `::cmd`, autocomplete requests dropped |
| CLANCHANNEL_KICKUSER, AFFINEDCLANSETTINGS_ADDBANNED_FROMCHANNEL, AFFINEDCLANSETTINGS_SETMUTED_FROMCHANNEL | 181 CLAN_CHANNEL_ACTION | mapped | — | action 0 kick, 1 ban, 2 mute, by channel slot. Only for clan id 0: tsps's packet means the player's own channel, so other clan ids are dropped rather than acting on the wrong one |
| MESSAGE_PRIVATE | 197 | mapped | 6 | |
| FRIENDLIST / IGNORELIST ADD / DEL, FRIENDCHAT_* | 196 FRIENDS_CHAT_ACTION | mapped | 6 | join, leave, kick, rank and the list edits share one tsps packet |
| CHAT_SETFILTER | 198 | mapped | 6 | |
| SEND_SNAPSHOT | 199 REPORT_ABUSE | mapped | 6 | |
| CLICKWORLDMAP / TELEPORT | 105 / 212 | mapped | 9 | developer teleports in tsps |
| UPDATE_PLAYER_MODEL_V2 | 37 APPEARANCE_SET | mapped | 9 | the official client's designer (679) never sends it: each arrow, A/B and Confirm is an IF_BUTTON that tsps's Makeover Mage plugin applies on the server (the ops are enabled when 679 opens). The gateway still decodes it (rsprot 241 has no decoder, and an undecodable packet disconnects), passing a design only when its ids are valid |
| trade interface buttons | 180 TRADE_ACTION | mapped | 9 | accept/decline (335:10/13, 334:13/14/32), Offer/Remove ×1/5/10/All on 336:0 and 335:25, and X through the count dialog (script 108) the gateway opens itself |
| WINDOW_STATUS | — | dropped | 4 | tsps picks the root from the saved layout setting, as for the browser |
| MAP_BUILD_COMPLETE | — | dropped | 2 | gateway-only signal |
| EVENT_*, IDLE, REFLECTION_CHECK_REPLY, SEND_PING_REPLY, CONNECTION_TELEMETRY, DETECT_MODIFIED_CLIENT, MEMBERSHIP_PROMOTION_ELIGIBILITY, RSEVEN_STATUS, SOUND_JINGLEEND, BUG_REPORT, HISCORE_REQUEST, IF_CRMVIEW_OP, EXIT_FREECAM, CLANCHANNEL_FULL_REQUEST, CLANSETTINGS_FULL_REQUEST | — | dropped | 1 | no tsps handler; tsps sends clan state unasked |
