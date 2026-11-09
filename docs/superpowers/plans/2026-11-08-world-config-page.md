# World Config Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A loopback-only admin page, served by the tsps server, that lists every world setting
(world values, plugin switches, every `pluginConfig` option) from plugin self-declarations and
saves changes to `world.local.json` through the normal world-update countdown.

**Architecture:** Core gains option declarations (types + validation), a lazily built catalog
from the same plugin discovery `PluginManager` uses, and a store that diffs, validates and
atomically writes `world.local.json`; both are exposed on `api.core`. A new `WorldAdmin` plugin
(same pattern as `AgentMcp.plugin.js`: its own `127.0.0.1` listener) serves the page and API, and
drives restarts through custom events that `GameUpdate` handles, using a new after-persist hook
in `Server.shutdown`.

**Tech Stack:** TypeScript (server core, `tsc --build`), CommonJS plugins, `node:http`,
`node --test` (`server/tests/*.test.cjs`, run after `yarn build`), one self-contained HTML page.

**Spec:** `docs/superpowers/specs/2026-11-08-world-config-page-design.md`

## Global Constraints

- Never write `server/data/definitions/world.json`; only `world.local.json` (gitignored).
- Existing `pluginConfig` keys are not renamed. Call sites keep their inline defaults.
- No hand-maintained list of settings anywhere; the docs table is generated and checked by a test.
- Admin listener: bound to `127.0.0.1`, own port `WORLD_ADMIN_PORT` (default `49600`; `scripts/wt`
  slot `n` gets `49600 + n`), token required on every request, no CORS headers.
- `WORLD_ADMIN_BIND` (non-loopback bind) is honoured only when `WORLD_ADMIN_TOKEN` is set.
- Not started when `BROWSER_HOST=1`.
- Countdown default 60 seconds; file written only when the countdown reaches zero, after players
  are persisted. Supervised restart (`TSPS_SUPERVISED=1`) exits with code `75`.
- Plugin rules from `server/docs/agents/plugins.md`: `register` is attach-only, handlers at module
  scope, core classes via `api.core` (add to `getCoreApi()` and `PluginCoreApi`).
- Testing per the user's rules: run the focused test files named in each task, not the full suite.
- PRs: push as the user's own account via the fork, never to `main`; no real name; body ends with
  "Please wait for our own review before merging". Two PRs: Tasks 1–3, then Tasks 4–9.
- Live checks use this worktree's own ports (`.env`) and a gitignored `world.local.json` with
  `"plugins": { "PvpMode": false, "TutorialIsland": false }`; stop the server afterwards.

## Review Focus

1. **A `world.local.json` hand-edited while the page is open** (or by another tab): apply must
   re-read the file and refuse with "changed since you loaded it" when its hash differs from the
   one the page loaded. Test in Task 7.
2. **A malformed existing `world.local.json`** (bad JSON): the page loads read-only with the parse
   error shown and never overwrites the file. Tests in Tasks 5 and 7.
3. **Pressing Apply twice / while a countdown runs**: the second request gets `409` and the
   pending change is not replaced silently. Test in Task 7.
4. **A server that crashes or is killed mid-countdown**: nothing was written, so the old config
   stays. Covered by "write only at zero" (Task 6 test asserts no write before `afterPersist`).
5. **Options whose owner plugin is switched off**: they still show (catalog requires metadata),
   marked "plugin is off". Test in Task 4.

---

### Task 1: Option declaration types and validation

**Files:**
- Create: `server/src/main/typescript/elvarg/game/definition/WorldSettingDeclarations.ts`
- Modify: `server/src/main/typescript/elvarg/plugins/PluginTypes.ts` (`PluginModule`, ~line 1713)
- Test: `server/tests/world-config-declarations.test.cjs`

**Interfaces:**
- Produces:
  ```ts
  type ConfigOptionType = "boolean" | "number" | "string" | "enum" | "date" | "json";
  interface ConfigOptionDeclaration {
    type: ConfigOptionType; label: string; help: string;
    default?: unknown; defaultText?: string;            // exactly one of these
    values?: { value: string | number; label: string }[]; // enum only
    min?: number; max?: number; integer?: boolean;       // number only
    members?: boolean;
  }
  type ConfigCheck = { ok: true; value: unknown } | { ok: false; error: string };
  function validateDeclaration(key: string, decl: unknown): string[]   // problems, [] when valid
  function checkConfigValue(decl: ConfigOptionDeclaration, value: unknown): ConfigCheck
  const WORLD_SETTING_DECLARATIONS: Record<string, ConfigOptionDeclaration>   // top-level world.json keys
  const CORE_CONFIG_DECLARATIONS: Record<string, ConfigOptionDeclaration>     // owner "core"
  ```
  `PluginModule` gains `description?: string` and `config?: Record<string, ConfigOptionDeclaration>`.

- [ ] **Step 1: Write the failing tests** in `world-config-declarations.test.cjs` (require from `../dist/...`):
  - `checkConfigValue({type:"number",min:1}, "30")` → `{ok:true, value:30}`; `(…, "abc")` → `ok:false`; `(…, 0)` → `ok:false`.
  - `checkConfigValue({type:"enum",values:[{value:"a",label:"A"}]}, "b")` → `ok:false`.
  - `checkConfigValue({type:"boolean"}, "true")` → `ok:false` (booleans are not coerced).
  - `checkConfigValue({type:"date"}, "2026-11-08")` → `ok:true`; `"next week"` → `ok:false`.
  - `validateDeclaration("X:y", {type:"boolean",label:"L",help:"H"})` → contains "default or defaultText".
  - `validateDeclaration("noColon", …)` → contains "namespace:key".
  - `CORE_CONFIG_DECLARATIONS` has exactly `CrossFloor:visibility`, `CrossFloor:combat`, `commands:permissions`.
  - Every key `parseWorldDefinition` reads (`name`, `description`, `experienceMultiplier`, `spawn`,
    `membersWorld`, plus each other top-level key it reads, check `WorldDefinition.ts:167-210`) is in
    `WORLD_SETTING_DECLARATIONS`, and every declaration passes `validateDeclaration`.
- [ ] **Step 2: Run, expect FAIL** — `cd server && yarn build && node --test tests/world-config-declarations.test.cjs` (module not found).
- [ ] **Step 3: Implement** the file above and the two `PluginModule` fields. Numbers accept numeric
  strings (`Number(value)` finite); `spawn` is `json` with `defaultText`; labels/help come from
  `docs/world-configuration.md` and the core keys' docs.
- [ ] **Step 4: Run, expect PASS** (same command).
- [ ] **Step 5: Commit** — `feat(world-config): option declaration types and validation`.

### Task 2: PluginManager collects declarations

**Files:**
- Modify: `server/src/main/typescript/elvarg/plugins/PluginManager.ts` (`collectPluginLoadCandidates` ~2211, `loadFromDirectory` ~646, `loadPluginConfig` ~2182)
- Test: `server/tests/plugin-config-declarations.test.cjs`

**Interfaces:**
- Consumes: Task 1 types, `validateDeclaration`, `checkConfigValue`, `CORE_CONFIG_DECLARATIONS`.
- Produces: `PluginManager.getConfigDeclarations(): Map<string, { owner: string; decl: ConfigOptionDeclaration }>`
  (core keys plus every *loaded* plugin's `config`).

- [ ] **Step 1: Failing tests** using a temp plugin directory with fixture plugins and `loadFromDirectory`:
  - two plugins declaring the same key → load throws, message names both plugins and the key.
  - an invalid declaration → load throws with the `validateDeclaration` problem.
  - configured `"Fixture:count": "abc"` against `{type:"number"}` → `console.warn` called once with
    the key; `getPluginConfig("Fixture:count", 5)` still returns `"abc"` (behaviour unchanged).
  - `getConfigDeclarations()` contains the fixture key with `owner` = plugin name and the 3 core keys.
- [ ] **Step 2: Run, expect FAIL** — `node --test tests/plugin-config-declarations.test.cjs` after `yarn build`.
- [ ] **Step 3: Implement**: collect in `collectPluginLoadCandidates`; after loading, check the
  configured values in `loadPluginConfig()` against declarations and warn. Do not change `getPluginConfig`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(world-config): PluginManager collects option declarations`.

### Task 3: Declare every option; completeness tests

**Files:**
- Modify: each file listed by `git grep -l getPluginConfig -- server/plugins` (28 files: accounts/characters/Picker, areas/tutorialisland/Leave, bosses/wildernessbosses/Caves, bots/ai/RegisterAiBots, bots/brain/Sites, commands/DisplayName, interface/GrandExchange, interface/SkillLevelUp, interface/WelcomeScreen, minigames/castlewars/Lobby, minigames/duelarena/Hospital + UnrankedDuel, minigames/lms/Bots + Lobby, minigames/soulwars/Bots + Lobby, modes/league/Account + Common + Welcome, modes/leagueareas/Unlock, npcs/NpcDrops, npcs/Pets, npcs/random-events/Common, quests/Equipment, skills/Prayer, skills/shootingstars/Common + Landing, world/gravestones/Death). The declaration goes on the **top-level plugin module** that owns the feature (a `*.plugin.js`), not on a helper file. A key shared by two plugins (`league:type`: LeagueMode + LeagueAreaUnlocks) is declared once, by the plugin it configures (LeagueMode).
- Modify: `description` on default-off plugins (`enabled: false`: Characters, VoiceChat, CustomCharacterSummary, plus any others found) and on the switches-table plugins (TutorialIsland, VoiceChat, DuelStaking, FreezeTimer, FriendsList, GrandExchange, SideJournalDefaults, IgnoreList, VengeanceTimer).
- Test: `server/tests/world-config-completeness.test.cjs`

**Interfaces:**
- Consumes: Task 2 `getConfigDeclarations()` (loaded with every plugin on, via a temp `world.local.json` or the loader's switches).

- [ ] **Step 1: Failing tests:**
  - `every read key is declared`: scan `server/plugins/**/*.js` and `server/src/**/*.ts` for
    `getPluginConfig(`; resolve the key argument when it is a string literal or a `const` string
    in the same file or in a module that file `require`s; an unresolvable key **fails** with the
    file:line, and so does a resolved key that has no declaration.
  - `inline defaults match`: where the default argument is a JSON literal, it deep-equals the
    declared `default`; where it is not a literal, the declaration has `defaultText`.
  - `described plugins`: every plugin with `enabled: false` and every plugin in the list above has a non-empty `description`.
- [ ] **Step 2: Run, expect FAIL** listing the 30 undeclared keys.
- [ ] **Step 3: Add the declarations.** Label/help text comes from the existing docs (`docs/prayer-bones.md`, `server/docs/leagues.md`, `docs/world-configuration.md`, `docs/settings.md`, …); enum `values` for `league:type` come from the league data that `Common.LeagueMode.js` reads.
- [ ] **Step 4: Run, expect PASS**, then `node --test tests/bot-sites-world-config.test.cjs` (touches the bot config files).
- [ ] **Step 5: Commit** — `feat(world-config): declare every pluginConfig option`. **Open PR 1** (Tasks 1–3).

### Task 4: Catalog

**Files:**
- Create: `server/src/main/typescript/elvarg/plugins/WorldConfigCatalog.ts`
- Modify: `PluginManager.ts` (make `discoverPluginFiles`, `pluginNameFromFile`, the switch resolution reusable: static `public` or exported helpers), `getCoreApi()` / `PluginCoreApi` (expose `WorldConfigCatalog`)
- Test: `server/tests/world-config-catalog.test.cjs`

**Interfaces:**
- Produces:
  ```ts
  interface CatalogPlugin { name: string; file: string; area: string; description?: string;
    members: boolean; dependsOn: string[]; defaultEnabled: boolean; enabled: boolean; loaded: boolean }
  interface CatalogOption { key: string; owner: string; decl: ConfigOptionDeclaration;
    shipped: unknown | undefined; local: unknown | undefined; ownerEnabled: boolean }
  interface WorldConfigCatalogData { plugins: CatalogPlugin[]; options: CatalogOption[];
    world: CatalogOption[]; membersWorld: boolean }
  WorldConfigCatalog.build(pluginDirectory: string, layers: WorldConfigLayers): WorldConfigCatalogData  // cached per layers hash
  ```
  `area` = first folder under `server/plugins/`. Modules not loaded are `require`d for metadata; `register` is never called.
  This task also creates `WorldConfigStore.ts` with `WorldConfigLayers` and `WorldConfigStore.read` (signatures in Task 5), since `build` takes layers; Task 5 adds `plan` and `write`.

- [ ] **Step 1: Failing tests:**
  - with fixture plugins, a plugin switched off in `plugins` still appears with `enabled:false, loaded:false` and its option has `ownerEnabled:false` (Review Focus 5).
  - `area` of `server/plugins/skills/Prayer.plugin.js` is `skills`.
  - **side effects**: in a child process, `require` every real plugin file (no `register`); assert it doesn't throw and `process.getActiveResourcesInfo()` gains no `Timeout`/`TCPServerWrap` entries. Fix any module that fails by moving the side effect into `register`.
- [ ] **Step 2: Run, expect FAIL.** `node --test tests/world-config-catalog.test.cjs`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(world-config): catalog from plugin discovery`.

### Task 5: Store (diff, validate, write)

**Files:**
- Create: `server/src/main/typescript/elvarg/game/definition/WorldConfigStore.ts`
- Modify: `WorldDefinition.ts` (export the merge used by `readWorldConfig` as `mergeWorldConfig(shipped, local)`; make `readWorldConfig` call it), `getCoreApi()` / `PluginCoreApi`
- Test: `server/tests/world-config-store.test.cjs`

**Interfaces:**
- Produces:
  ```ts
  interface WorldConfigLayers { shipped: JsonObject; local: JsonObject; localExists: boolean;
    localHash: string; localError?: string }   // localError: parse failure, page goes read-only
  interface WorldConfigChanges { world?: Record<string, unknown>; plugins?: Record<string, boolean | null>;
    pluginConfig?: Record<string, unknown | null> }  // null = back to shipped
  interface WorldConfigPlan { nextLocal: JsonObject; diff: { path: string; before: unknown; after: unknown }[];
    warnings: string[]; errors: string[] }
  WorldConfigStore.read(dir?: string): WorldConfigLayers           // created in Task 4
  WorldConfigStore.plan(layers: WorldConfigLayers, changes: WorldConfigChanges, catalog: WorldConfigCatalogData): WorldConfigPlan
  WorldConfigStore.write(dir: string, nextLocal: JsonObject, expectedHash: string): void  // throws "changed since loaded" on hash mismatch
  ```
- [ ] **Step 1: Failing tests** (temp dir with `world.json` / `world.local.json`):
  - a value equal to shipped is removed from `nextLocal`; `pluginConfig` / `plugins` entries diff key by key.
  - unmanaged keys (`zones`, `"someUnknown": 1`) survive unchanged.
  - `disabledPlugins: ["A"]` becomes `plugins: {A:false}` and is removed; diff shows it.
  - `experienceMultiplier: 0` → `errors` non-empty (same message `parseWorldDefinition` gives); `"Prayer:sequentialBurying": "yes"` → error.
  - turning off a plugin that others `dependsOn` → warning naming them; enabling a members plugin with `membersWorld:false` → warning.
  - malformed `world.local.json` → `read` returns `localError`, and `write` refuses (Review Focus 2).
  - `write` with a stale hash throws; a successful write is atomic (temp file + rename) and creates the file when absent.
- [ ] **Step 2: Run, expect FAIL.** `node --test tests/world-config-store.test.cjs`
- [ ] **Step 3: Implement.** Validation runs `parseWorldDefinition(mergeWorldConfig(shipped, nextLocal))`, the `plugins` boolean rule, and `checkConfigValue` per declared key.
- [ ] **Step 4: Run, expect PASS**, plus `node --test tests/bot-sites-world-config.test.cjs` (uses `readWorldConfig`).
- [ ] **Step 5: Commit** — `feat(world-config): store with diff, validation and atomic write`.

### Task 6: Shutdown hook and GameUpdate events

**Files:**
- Modify: `server/src/main/typescript/elvarg/Server.ts` (`gracefulShutdown` ~147, `shutdown` ~287)
- Modify: `server/plugins/world/GameUpdate.plugin.js`
- Test: `server/tests/game-update-world-config.test.cjs`

**Interfaces:**
- Produces:
  - `Server.shutdown(reason?: string, options?: { afterPersist?: () => void; exitCode?: number })`;
    `afterPersist` runs after player persistence succeeds and before exit; if it throws, shutdown is cancelled like a persistence failure; exit uses `exitCode ?? 0`.
  - Custom events handled by GameUpdate (synchronous; results are set on the payload):
    - `GameUpdate:start` `{ seconds, afterPersist, exitCode }` → sets `payload.accepted = true`, or `payload.error` when one is already scheduled.
    - `GameUpdate:cancel` `{}` → `payload.cancelled: boolean`.
    - `GameUpdate:status` `{}` → `payload.remainingSeconds: number` (0 = none).
    The `::gameUpdate` command keeps its behaviour (no `afterPersist`, exit 0).
- [ ] **Step 1: Failing tests** (mock `api.core` like existing plugin tests):
  - `GameUpdate:start` then advancing the task to zero calls `Server.shutdown` with the given `afterPersist` and `exitCode`; `afterPersist` is not called before zero (Review Focus 4).
  - `GameUpdate:cancel` stops it and pushes `sendSystemUpdate(0)`; `afterPersist` never runs.
  - `start` while scheduled → `payload.error`.
  - `Server.gracefulShutdown` (via `shutdown`) with a persistence failure never calls `afterPersist`.
- [ ] **Step 2: Run, expect FAIL.** `node --test tests/game-update-world-config.test.cjs`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(world-config): after-persist shutdown hook and GameUpdate events`.

### Task 7: WorldAdmin plugin (listener, access, API)

**Files:**
- Create: `server/plugins/tools/WorldAdmin.plugin.js`, `server/plugins/tools/worldadmin/Http.WorldAdmin.js`, `server/plugins/tools/worldadmin/Access.WorldAdmin.js`
- Test: `server/tests/world-admin.test.cjs`

**Interfaces:**
- Consumes: `api.core.WorldConfigCatalog`, `api.core.WorldConfigStore`, `api.core.Server`, `World`; GameUpdate events (Task 6).
- Produces (HTTP, JSON; all require the token):
  - `GET /` → page (Task 8). `GET /?token=T` sets cookie `wa_token` (HttpOnly, SameSite=Strict) and redirects to `/`.
  - `GET /api/catalog` → `{ catalog, layers: { localHash, localExists, localError }, mode, onlinePlayers, countdown: { remainingSeconds } }`.
    `mode` is `"dev"` (nodemon: `process.env.npm_lifecycle_event === "dev"` or nodemon's env var), `"supervised"` (`TSPS_SUPERVISED=1`) or `"manual"`.
  - `POST /api/preview` body `{ changes, localHash }` → `WorldConfigPlan`.
  - `POST /api/apply` body `{ changes, localHash, seconds }` →
    - errors in the plan → `400`; hash mismatch → `409 "changed since you loaded it"`; countdown already running → `409`;
    - `mode:"manual"` → write now, `{ applied: "written", restartNeeded: true }`;
    - otherwise, with `onlinePlayers === 0` or GameUpdate not loaded (no `accepted` on the start payload) → `Server.shutdown("worldConfig", { afterPersist: write, exitCode })` immediately; else `GameUpdate:start` with `seconds` (default 60).
    - `exitCode` is `75` in supervised mode and `0` in dev.
  - `POST /api/cancel` → `GameUpdate:cancel`.
- Access: listen on `WORLD_ADMIN_PORT` (default 49600), host `127.0.0.1` unless `WORLD_ADMIN_TOKEN` and `WORLD_ADMIN_BIND` are both set. Token = `WORLD_ADMIN_TOKEN` or `crypto.randomBytes(24).toString("base64url")`, printed at startup as `http://localhost:<port>/?token=<token>`. Accept a `wa_token` cookie or `Authorization: Bearer`, compared with `crypto.timingSafeEqual`. In loopback mode the `Host` header must be `localhost:<port>` or `127.0.0.1:<port>`. POSTs require `Content-Type: application/json` and an `Origin` that is absent or equal to the page's own origin. No CORS headers. Skip `listen` entirely when `BROWSER_HOST=1`. Close the listener in `onServerShutdown`.
- [ ] **Step 1: Failing tests** (start the plugin on port 0 with a mock core):
  - no token → 401; wrong token → 401; `Host: evil.example` → 403; `Origin: http://evil.example` on POST → 403; response has no `Access-Control-Allow-Origin`.
  - `WORLD_ADMIN_BIND=0.0.0.0` without `WORLD_ADMIN_TOKEN` → still binds `127.0.0.1` and logs why.
  - apply with stale hash → 409 (Review Focus 1); apply twice during a countdown → second 409 (Review Focus 3); malformed local file → catalog returns `localError` and apply → 409 (Review Focus 2).
  - manual mode writes immediately; dev mode with players online sends `GameUpdate:start` with `seconds: 60` and `exitCode: 0`; supervised mode passes `exitCode: 75`.
- [ ] **Step 2: Run, expect FAIL.** `node --test tests/world-admin.test.cjs`
- [ ] **Step 3: Implement.** `register` only wires `onServerStartup` / `onServerShutdown`; handlers at module scope.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(world-config): WorldAdmin listener and API`.

### Task 8: The page, ports, live check

**Files:**
- Create: `server/plugins/tools/worldadmin/page.html` (self-contained: inline CSS/JS, no external requests)
- Modify: `scripts/wt` (write `WORLD_ADMIN_PORT=$((49600 + n))` with the other ports, list it in `wt ls`), `docs/worktrees.md`, `server/README.md` (how to open the page; SSH tunnel example `ssh -L 49600:127.0.0.1:49600 host`)

- Page behaviour (from the spec): two tabs, **Settings** (world values + options grouped by `area`, search) and **Plugins** (switches grouped by area, search, default-off and described plugins pinned first). Row = control by type (toggle / number with limits / dropdown / text / date / JSON textarea validated on blur), label, help, "default: X" or `defaultText`, a "changed" marker, "plugin is off" or "won't load on a free world" notes. Save → preview modal showing the `diff`, warnings and errors (Apply disabled while there are errors) → Apply with a seconds field (default 60) shown when players are online. While a countdown runs: remaining time + Cancel. `mode:"manual"` → the button says "Save (takes effect next restart)". `localError` → read-only banner with the parse error.
- [ ] **Step 1: Live check, fails first**: `yarn start` in this worktree with the test `world.local.json`; open `http://localhost:<WORLD_ADMIN_PORT>/?token=…` (token from the server log) in the browser pane; expect 404 / blank before the page exists.
- [ ] **Step 2: Implement the page and the port wiring.**
- [ ] **Step 3: Live check passes**: search "bury", toggle *Bury all bones with one click*, preview shows `pluginConfig."Prayer:sequentialBurying": true`; apply with a player logged in through the agent MCP → in-game countdown appears; at zero the server saves, writes the file, nodemon restarts, and the option shows as set. Pick the league type from its dropdown, then cancel mid-countdown → file unchanged. Screenshot both.
- [ ] **Step 4: Commit** — `feat(world-config): admin page and worktree port`.

### Task 9: Generated docs

**Files:**
- Create: `server/scripts/world-config-docs.ts` (+ `"world-config-docs"` script in `server/package.json`)
- Modify: `docs/world-configuration.md` (replace "Available switches" table with a generated block between `<!-- world-config:generated:start -->` / `<!-- world-config:generated:end -->`; add a "World config page" section at the top), `docs/prayer-bones.md` and `server/docs/leagues.md` (one line each: the option is on the page)
- Test: `server/tests/world-config-docs.test.cjs`

**Interfaces:**
- Consumes: `WorldConfigCatalog.build` (Task 4).
- Produces: `renderWorldConfigDocs(catalog): string` — an options table (key, type, default/defaultText, help) grouped by area, then a switches table of described plugins.

- [ ] **Step 1: Failing test**: the block in `docs/world-configuration.md` equals `renderWorldConfigDocs(build(...))`; failure message says to run `yarn --cwd server world-config-docs`.
- [ ] **Step 2: Run, expect FAIL.** `node --test tests/world-config-docs.test.cjs`
- [ ] **Step 3: Implement the script and regenerate.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `docs(world-config): generated settings reference`. Run a review agent over the branch, then **open PR 2** (Tasks 4–9).
