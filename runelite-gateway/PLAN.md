# Gateway plan

Goal: the official OSRS client (rev 241, launched through RSProx with a custom target) logs in to
tsps and plays with prod-like parity to the browser client. tsps-only plugin features are dropped
and counted.

## Status

M0–M13 are done: login through trade, settings, the character designer, NPC model changes and
tint, chat colours, and sailing. `COVERAGE.md` has no `todo` rows, and `yarn gateway:test` runs 56
tests, live ones included. Fixes from play in RuneLite: forced movement (agility), instance
rebuilds, scenes in private areas on the real map (the Fractured Archive), bank drags and tabs,
the welcome screen laid out as live, and volume sliders saved as live does (both from RSProx
recordings of live).

Open:
- Two players on one boat isn't implemented yet.

## Decisions

Made before this plan:
- A separate Kotlin process in `runelite-gateway/`, on rsprot.
- One tsps WebSocket session per player.
- Target is the rev-241 client through RSProx (RuneLite launched through RSProx works too).
- Plugin messages are dropped and counted.

Made during planning:
- **Capability bit.** Gateway sessions set a `native` bit in HANDSHAKE. Fields the browser wire lacks (equipment quantities, weight, fine run energy, chat colour/effects, NPC tint, boat level/owner, hit delay) are sent only to flagged sessions. The browser wire format is unchanged.
- **Custom content is dropped and counted.** This covers server-only interfaces (group ≥30000), GAMEMODE_DATA (custom items/models, league overrides) and the quest-list widget. Custom items fall back to `baseItemId`. A patched cache is a possible follow-up.
- **Test client codecs** come from RSProx's MIT `protocol/osrs-241` module, pinned to a commit as a test-only Gradle source dependency. Its LICENSE is kept with it; it is a tool, so no credit is needed in code or docs.

## Investigation results

### rsprot / RSProx
- **rsprot supports rev 241.** `net.rsprot:osrs-241-{api,model,desktop,shared,internal,common}:1.0.0-ALPHA-20261014` is on Maven Central. It covers:
  - JS5 (`Js5GroupProvider`), login (RSA, ISAAC, optional proof-of-work, `LoginBlock`) and huffman;
  - all 241 server packets: `RebuildLoginV2`/`NormalV2`/`RegionV2`/`WorldEntityV4`, `IfSetEventsV2`, `UpdateStatV2`, `ProjAnimSpecificV4`, `CamTargetV4`, and the rest;
  - PLAYER_INFO, NPC_INFO (`NpcInfoSmallV6`/`LargeV6`) and WORLDENTITY_INFO (`V7`), through avatar APIs (`PlayerAvatarExtendedInfo`, `NpcAvatarExtendedInfo`);
  - client packets, as decoders only. rsprot is server-side: it has no client-side codecs and no `UPDATE_PLAYER_MODEL_V2` decoder.
- **How RSProx targets a custom server.** A custom target is a YAML entry:
  ```yaml
  name, jav_config_url, modulus (our RSA public modulus, hex), revision: 241, game_server_port
  ```
  RSProx reads the jav_config, fetches the world list from the jav_config's `worldlist` param, and picks the world whose host matches the `codebase`. It patches the client to its own key and localhost (43600+N), then relays login re-encrypted with our modulus. JS5 goes through the same port, so the gateway needs `jav_config.ws` and a binary `worldlist.ws` served over HTTP.
- **The cache matches.** `server/caches/osrs-241_2026-10-20` is a live 241 dat2/idx cache. `keys.json` is `{}`, so all XTEAs are zero. tsps itself loads the maps keyless, so the 241 map groups aren't encrypted, and zero keys in REBUILD work.

### tsps protocol
- **The browser wire is custom.**
  - It is plain WebSocket: no RSA or ISAAC, and the password is sent in cleartext.
  - Login is `LOGIN(204)` with user, pass, revision and flags, answered by `LOGIN_RESPONSE(3)`. Then `HANDSHAKE(202)` with clientType gets the server's `HANDSHAKE(2)` with index, admin and members.
  - Keepalive is `PING(201)` at most every 5 s; 30 s of silence closes the socket.
  - `X-Real-IP` is honoured from loopback, so IP bans and mutes keep working through the gateway.
  - An unknown client opcode closes the session, so the gateway only sends opcodes on a whitelist.
- **No byte relay.** "Native" client opcodes share OSRS semantics (packed interface ids, sub/obj, ops) but not 241 opcode numbers or byte transforms. Every packet is decoded and re-encoded.
- **Visibility is server-side.** tsps decides who each viewer can see. Sync is OSRS-like with deltas, and the update blocks carry almost everything rsprot's avatars need (detail in `COVERAGE.md`).
- **Server→client gaps the gateway fills.** Full mapping table in `COVERAGE.md`.
  - **Vars:** varbits are a custom packet, so the gateway keeps a varp mirror and composes values from cache varbit definitions. Fake GE varps 7900–7955 are rebuilt as `UPDATE_STOCKMARKET_SLOT`, and every varp id ≥ the cache varp count is filtered.
  - **Bundled packets:** `WIDGET_OPEN_SUB` bundles varps, varbits, hides and pre/post scripts; `WIDGET_RUN_SCRIPT` bundles inventories. Both are split into their parts, with the order kept.
  - **Interface mounts:** every mount targets root 161, so targets are remapped to 548/164/601 through cache enums 1129/1130/1131/1745, as the browser client does. `WIDGET_OPEN`/`CLOSE` carry no target, so the gateway keeps a group → target map.
  - **Zone updates:** these use absolute coordinates and no zone grouping. They are regrouped into `UPDATE_ZONE_PARTIAL_ENCLOSED`. Locs and ground items are re-sent after every rebuild from gateway-side state. Ground-item removals come by stack id only.
  - **Equipment:** inventory 94 is never sent. It is built from appearance, and quantities need the capability bit.
  - **Public chat** arrives twice (overhead force-chat plus a type-2 chatbox message). It is merged into a single `setChat`, with the crown parsed from `<img=N>`.
  - **Tick order:** `TICK` comes before sync and other packets go out immediately. The gateway buffers per tick and flushes in OSRS order, ending with `SERVER_TICK_END`.
- **Client→server gaps the gateway fills.**
  - **Settings and the run orb:** settings reach tsps only as `VARP_TRANSMIT(191)`, which the real client never sends. The gateway maps those buttons to 191 from its varp mirror.
  - **Item use vs spell:** `OP*T` is split by selected component (149:0 means item use) into tsps `*_U` or `*_T`. Item-on-item goes to `INVENTORY_USE_ON(241)` and inventory drag to `INVENTORY_MOVE(242)`.
  - **Logout:** the logout button becomes `LOGOUT(203)`, and `LOGOUT_RESPONSE` becomes `LOGOUT` or a game message.
  - **Trade** is a custom protocol (`TRADE_OPEN`/`UPDATE`, `TRADE_ACTION(180)`). The gateway translates the 335/334 interfaces and buttons.
  - **Player options:** baseline Trade with/Follow are client-local in the browser. The gateway sends `SET_PLAYER_OP` at login, and Attack when the wilderness/PvP varbit is on.
- **Browser-local behaviour that would break silently** (all handled above): the varp-transmit settings, equipment from appearance, combat level varbit 13027, weight (never sent), player options, notifications (group 660 + script 3349 mounted locally) and the quest list.

## Architecture

```
official client 241 ── RSProx (43600+N) ── TCP ─▶ gateway (GATEWAY_PORT)
                                                   │  rsprot: JS5, login, ISAAC, 241 codecs
                                                   │  per player: GatewaySession
                                                   └─ WebSocket ─▶ tsps (WEBSOCKET_PORT), one per player,
                                                                   X-Real-IP, HANDSHAKE native bit
RSProx target YAML → http://127.0.0.1:<WEBSOCKET_PORT>/gateway/jav_config.ws (+ /gateway/worldlist.ws)
```

- **jav_config and the world list** are served by tsps's existing HTTP handler on the WebSocket port. This is one additive route that reads `GATEWAY_PORT` and `GATEWAY_MODULUS` from `.env`, so no fifth port is needed. The route returns 404 when no gateway is configured.
- **One rsprot "world" per session.** Each session has its own player/NPC/world-entity info protocol instances, with avatars created and removed exactly when tsps adds or removes them. This keeps tsps in charge of visibility and makes per-viewer hitsplat colours correct. It needs an M0 spike, because rsprot normally owns one global world (see Risks).
- **Per-session state:**
  - varp mirror;
  - interface tree (root, group → target, open modals);
  - inventories 93/94/95/90/516/620;
  - zone state (locs, ground items by stack id);
  - absolute positions decoded from tsps deltas;
  - tick buffer;
  - selected component, for the `OP*T` split.

### Layout
```
runelite-gateway/
  settings.gradle.kts  build.gradle.kts  gradle/libs.versions.toml  gradlew  (JDK 17 toolchain, Kotlin 2.2)
  README.md      how to run, RSProx target setup, ports
  COVERAGE.md    packet table: tsps msg ⇄ 241 packet, state mapped / dropped / todo, notes
  src/main/kotlin/gateway/
    Main.kt, config/GatewayConfig.kt     reads root .env (GATEWAY_PORT, WEBSOCKET_PORT), server/target.txt
    crypto/RsaKeys.kt                    runelite-gateway/keys/rsa.pem (gitignored), generated on first run, prints modulus
    cache/  Js5Store (dat2/idx reader), VarbitTypes, ObjTypes (wearpos), NpcTypes (anims, models), Enums, Huffman
    net/    GatewayNetworkFactory (rsprot), LoginBridge, Js5Provider
    tsps/   TspsSocket (WebSocket client), TspsDecoder (mirrors ClientProtocol.ts encoders), TspsEncoder (client opcodes, whitelist)
    session/ GatewaySession, TickBuffer, VarpMirror, InterfaceTree, Inventories, ZoneState, EntityMirror
    down/   tsps→241 translators, one file per domain: Login, Map, Players, Npcs, WorldEntities, Interfaces,
            Vars, Inventories, GroundItems, Zones, Chat, Social, Audio, Camera, Combat, Misc
    up/     241→tsps translators: Buttons, Targets (OP*T split), Movement, Dialogs, Chat, Social, Settings, Trade, Logout
    coverage/ DropCounter                counts every dropped type (down and up), logged per minute and on exit
  src/test/kotlin/gateway/
    unit/      translator tests on captured tsps frames (golden files), no server
    headless/  HeadlessClient (RSProx 241 codecs): JS5 fetch, RSA login, ISAAC, decoded packet stream + assertions
    it/        integration suites per milestone; need a running tsps on this worktree's slot
```

### Config and ports
- **`scripts/wt` and `docs/worktrees.md`** gain a fourth slot column: **`GATEWAY_PORT`**, 43595 for the main checkout and 43900+N for slot N. That avoids 43594, 43700+N and RSProx's 43600+N. `wt ls` shows it.
- **Commands:** `yarn gateway` runs `runelite-gateway/gradlew run` and is separate from `yarn start` for now. `yarn gateway:test` runs the tests.
- **RSA key** is per checkout in `runelite-gateway/keys/` (gitignored). The modulus is printed at startup and written into the RSProx YAML snippet in the README.

## tsps server changes

Each change is minimal and is either inert for the browser or gated by the native bit:

| Change | Browser impact |
| --- | --- |
| `/gateway/jav_config.ws` and `/gateway/worldlist.ws` HTTP routes | None (new paths) |
| HANDSHAKE `native` capability flag, stored on the session | None (browser sends 0) |
| Native: send inventory 94 with quantities | None |
| Native: `RUN_ENERGY` with full-resolution energy plus weight | None |
| Native: keep public chat colour/effects, and add the NPC tint mask | None |
| Native: boat level and owner in the world-entity spawn | None |
| Pass `hit.delay` through `hitView` | Wire-compatible: the field exists and is always 0 now |

Fixes the investigation turned up:
- Key the XTEA lookup by region id rather than archive group (`CachePipeline`). It's a latent bug, inert while keys are zero.
- Optionally drop unknown opcodes instead of closing. This makes the browser more tolerant. The whitelist in the gateway makes it unnecessary.

## Milestones

Each milestone is one commit and updates `COVERAGE.md`. Every milestone runs `gradlew test` (unit tests plus the headless integration suites against `yarn start` on this slot) and stops any server it started.

**M0 — Skeleton, ports and spike**
- Work:
  - add the `GATEWAY_PORT` column to `scripts/wt` and `docs/worktrees.md`;
  - Gradle project with rsprot 241, config, RSA keygen and cache reader;
  - `COVERAGE.md` generated from the decoder tables, every row `todo`;
  - spike: two independent rsprot player-info instances in one JVM.
- Accept:
  - `gradlew build` passes;
  - `scripts/wt ls` shows the gateway port;
  - a unit test reads cache group 2/… and verifies the CRC against the master index;
  - the spike test encodes PLAYER_INFO for two separate worlds.

**M1 — JS5, login and first frame**
- Work:
  - JS5 from `server/caches`;
  - tsps HTTP routes and the native HANDSHAKE bit;
  - login bridge: LOGIN → LOGIN_RESPONSE → HANDSHAKE, with codes mapped (2→7, 27→26, …);
  - `RebuildLoginV2` + `IfOpenTop` + self PLAYER_INFO + `ServerTickEnd`;
  - PING keepalive; X-Real-IP; client disconnect → tsps logout/disconnect.
- Accept (headless):
  - JS5 index CRCs match;
  - a wrong password gets response 3, the same account twice gets 5;
  - a good login gets response 2 with the index from HANDSHAKE;
  - RebuildLogin's zone matches the MCP `observe` position.
- By hand:
  - the client downloads the cache and reaches the game screen at the saved spot;
  - closing the client frees the account (`login` again works).

**M2 — Map and walking**
- Work:
  - `MoveGameClick`/`MoveMinimapClick` → 16, and `SetMapFlagV2`;
  - `RebuildNormalV2` near region edges and `RebuildRegionV2` for templated instances;
  - walk/run/teleport deltas → absolute;
  - `SetHeading`; reconnect (GAMERECONNECT keeps the tsps socket).
- Accept (headless):
  - a walk across a region boundary produces RebuildNormal and per-tick coordinates equal to the MCP position;
  - `::tele` produces a teleport;
  - entering an instance produces RebuildRegion with the expected palette.
- By hand: click-walk, minimap walk, run toggling later in M4, a teleport, an instance (e.g. a boss room), a reconnect after a short network drop.

**M3 — Players and NPCs**
- Work:
  - full PLAYER_INFO: appearance with wearpos from the cache, anims, spotanims, face, force-chat, merged public chat (with colour under the native bit), exact move, tint, move speed;
  - NPC_INFO: spawn, walk/crawl, transform → `setTransmogrification`, base anims from the cache, head icons, headbars, transparency, customisation, tint (native);
  - `SET_PLAYER_OP` baseline;
  - `OpPlayer`/`OpNpcV2` upstream.
- Accept (headless + MCP):
  - with a second MCP-logged-in player nearby, the appearance block decodes to the same equipment;
  - `interact` an NPC → decoded sequence and face;
  - chat from the MCP player arrives as one chat block.
- By hand: other players render with the right gear and animations; NPCs walk smoothly; Talk-to/Attack menus; chat crowns.

**M4 — Interfaces, vars and scripts**
- Work:
  - gameframe with 161 → root remap and `WINDOW_STATUS`-driven root;
  - the `IF_*` family, `IfSetEventsV2` conversion;
  - varp mirror and varbit composition, fake-varp filter;
  - `WIDGET_OPEN_SUB`/`RUN_SCRIPT` split; `RunClientScript`;
  - upstream: `If3Button`, `IfSubOp`, `IfButtonD`/`T`, `IfScriptTrigger`, `ResumeP*`, `CloseModal`;
  - settings and run orb → 191; logout button → 203; notifications (660/3349).
- Accept (headless):
  - every varp the MCP `observe` reports equals the decoded mirror after login;
  - opening a dialogue decodes `IfOpenSub` + text in order;
  - run-orb click → MCP shows running.
- By hand: all tabs, resizable and fixed modes, dialogues, the settings panel, run orb, prayers, combat options, logout button.

**M5 — Items and inventories**
- Work:
  - inventories 93, 95, 94 (native quantities), 516, 90/90|0x8000, 620;
  - `UPDATE_STOCKMARKET_SLOT`;
  - ground items with zone state (`ObjAdd`/`Del`/`Count`, re-sent after rebuild);
  - `OpObjV2`; `OP*T` split into item-use and spell;
  - drag → 242, item-on-item → 241;
  - `UpdateRunWeight` and run energy (native).
- Accept (headless + MCP):
  - `command item` → `UpdateInvPartial`;
  - wield darts → inventory 94 shows the count;
  - drop/take → ObjAdd/ObjDel in the right zone;
  - bank deposit and drag.
- By hand: bank (tabs, placeholders, search), shop buy/sell, GE offer slots, ground items after re-entering an area, item on item and on NPC/loc, weight readout.

**M6 — Chat and social**
- Work:
  - private messages, echo, friends chat (`UpdateFriendChatChannelFullV2` diffing), friend/ignore lists and `FriendListLoaded`, filters;
  - `ClientCheat` (`::`) → chat kind 0 `::cmd`; report abuse;
  - upstream social packets → 196/197/198/199.
- Accept (headless): two gateway clients exchange a PM and FC messages; friend online/offline status updates.
- By hand: commands, FC join/kick, filters.

**M7 — Audio, camera and world updates**
- Work:
  - `LocAddChangeV2`/`LocDel`/`LocAnim`, `MapAnim`, `SoundArea`/`SynthSound`, `MidiSongV2`/`MidiJingle`;
  - the camera family with the easing map;
  - `HintArrow`, interaction mode;
  - `UpdateRebootTimerV2`.
- Accept (headless): opening a door gives a LocAddChange in the enclosed zone; a cutscene gives the expected camera packet sequence.
- By hand: doors and gates, area music, sound effects, a quest cutscene camera, hint arrows.

**M8 — Combat**
- Work:
  - hitsplats with per-viewer types and native delay; headbars;
  - `ProjAnimSpecificV4`;
  - Attack op in the wilderness/PvP; special-attack orb; auto-retaliate; prayer overheads; multi-hit timing.
- Accept (headless + MCP): `cast_spell` on an NPC gives a projectile, then a hitsplat, then a headbar, in tick order; PvP between a gateway player and an MCP player.
- By hand: melee, ranged, magic, special attacks, prayer flicking feel, a boss with projectiles.

**M9 — Trade, sailing and full coverage**
- Work:
  - trade 335/334 translation;
  - world entities (`RebuildWorldEntityV4`, `WorldEntityInfoV7`, set-active-world for deck locs, native level/owner);
  - `LogoutWithReason`;
  - every remaining `COVERAGE.md` row becomes mapped or dropped with a reason.
- Accept: `COVERAGE.md` has 0 `todo` rows; trade between gateway and browser players completes; boarding a boat and sailing renders.
- By hand: a full trade, sailing, a long play session with the drop counters logged.

## Verification

- **Unit tests:** translator tests on golden tsps frames, captured once through the MCP and checked in under `src/test/resources`.
- **Headless client:** RSProx 241 codecs.
  - It fetches JS5, does RSA login and ISAAC, and decodes PLAYER_INFO/NPC_INFO into the RSProx model.
  - It asserts on packet sequences.
  - The agent MCP drives the same player ("tools act on whatever connection the player has"), so the tests can act through the MCP and assert what the official client would receive.
- **Agent MCP** on this worktree's slot (`login`, `observe`, `interact`, `command`, `cast_spell`, …) checks the server side. The vision tools cover only the browser client, which is useful for side-by-side comparison.
- **Hand checks** are listed per milestone. Each milestone ends with `Ready to test:` plus the gateway port and the RSProx target YAML.

## Risks and estimates

| Risk / unknown | Mitigation | Effort |
| --- | --- | --- |
| rsprot assumes one global world; per-session info instances may need internals | M0 spike. Fallback: one shared mirror world keyed by tsps indices, with hitsplat types approximated. | 1–2 d spike |
| Ordering bugs between bundled vars, scripts and opens; wrong root remap | Golden tests per bundle; compare against browser behaviour | M4 is the largest, ~1.5 wk |
| RSProx custom target quirks (jav_config params, world list format, Windows RSProx → WSL gateway) | Build `worldlist.ws` with RSProx's own world-list decoder in a test | 1–2 d |
| RSProx module isn't published; Gradle source dependency on a pinned commit may need build tweaks | Fallback: build its jar once into `runelite-gateway/libs` with LICENSE | 1 d |
| rsprot 241 is ALPHA; API churn between ALPHA dates | Pin the version | ongoing |
| Delta-to-absolute decoding drifts | Assert against MCP positions every tick in tests | in M2 |
| Server-only interfaces and custom items are absent | Dropped and counted; patched cache is a follow-up | — |
| Trade translation (custom server protocol) | Contained in M9 | 3–4 d |
| Sailing world entities are rsprot's newest area | Last milestone | ~1 wk |

**Total:** about 7–9 weeks of focused work. M0–M2 take about 1.5 weeks and give a walkable client.
