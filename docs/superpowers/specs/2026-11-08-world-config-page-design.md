# World config page: design

Date: 2026-11-08. Status: draft for review; built as an early v0.1, a basic framework meant to be built on by others.

## Why

Someone running their own tsps server (Node, `yarn start` / `yarn start:prod`, not the website's
/host page) wants to change world settings: turn on auto-bury bones, switch the world to a league.
Today `server/data/definitions/world.local.json` doesn't exist until someone creates it (it is gitignored), and the only way to learn what can go
in it is to search the docs. The two real examples were both `pluginConfig` options
(`Prayer:sequentialBurying`, documented only in `docs/prayer-bones.md`; the league type key,
documented only in `server/docs/leagues.md`). 28 plugin files read 27 such keys, and core reads 3 more (`CrossFloor:visibility`, `CrossFloor:combat`, `commands:permissions`), via
`getPluginConfig(key, default)`. Nothing lists them, and their defaults sit in the code that reads them.

The problem is **finding** settings, not typing JSON.

## What it is

A local admin page served by the game server that lists every setting the world can change,
grouped by area, each with a plain-English explanation and the right control. It writes
`world.local.json`. Because plugins **describe their own settings** in code, a new plugin's
options and switch appear on the page with no change to the page.

Used both before a world's first start and on a running server (then: save, and a restart notice).

## Goals

1. One page shows every changeable world setting: top-level world values, plugin on/off switches,
   and every `pluginConfig` option. Each shows its current value, its shipped default, and a sentence of help.
2. Plugins declare their options (key, type, default, allowed values, label, help) and an optional
   one-line description. The page, the server's defaults, and validation all read that declaration.
3. The page appears or updates by itself when plugins add or remove options or switches. No hand-kept list.
4. Saving writes only `world.local.json`, only the values that differ from the shipped config, and
   keeps any keys in that file the page doesn't manage. It never writes `world.json`.
5. Before saving: a preview of exactly what changes in `world.local.json`, and warnings
   (turning a plugin off disables the plugins that `dependsOn` it; members plugins don't load on a
   free world).
6. On a running server, saving starts the normal world-update countdown for online players, then
   applies the change and restarts, where the server can restart itself.

## Non-goals

- Editing zones, spawns, NPC drops, or region packs (the /host page has its own tabs for some of these).
- Applying changes without a restart.
- Running in browser-host mode (`BROWSER_HOST=1`). The /host page owns configuration there.
- Multiple admin accounts, roles, or an audit log.
- Renaming existing `pluginConfig` keys. Worlds in the wild already use them.

## Anti-goals (failure even if it works)

- A save that produces a `world.local.json` the server then refuses to start with.
- Any route that can change files being reachable from another machine, or from a web page the
  host happens to visit, without a secret.
- A hand-maintained list of settings anywhere (in the page, a JSON file, or a doc table) that
  silently goes stale.
- Burying the ~20 options people actually change under 584 plugin names.

## Decided

### Plugins describe their options

`PluginModule` (`server/src/main/typescript/elvarg/plugins/PluginTypes.ts`) gains two optional fields:

```js
module.exports = {
  name: "Prayer",
  description: "Bone burying, altars and prayer drain.",       // one line, optional
  config: {
    "Prayer:sequentialBurying": {
      type: "boolean",
      default: false,
      label: "Bury all bones with one click",
      help: "Bury continues through every eligible bone in the inventory, two ticks each.",
    },
  },
  register(api) { ... },
};
```

- Keys are the existing full `pluginConfig` keys, unchanged (`"Prayer:sequentialBurying"`,
  `"league:start"`, `"random-events:enabled"`, ...). One plugin may declare several. A key belongs
  to exactly one plugin; declaring it twice is a startup error.
- Types: `boolean`, `number` (optional `min`, `max`, `integer`), `string`, `enum` (`values`:
  list of `{ value, label }`), `date` (ISO string), and `json` for the few structured values
  (e.g. `commands:permissions`, bot site lists). On the page, `json` is a validated text box.
- **Call sites keep their inline defaults** (my call). `getPluginConfig(key, default)` behaves as
  it does today. A key can be read by a plugin that is loaded while its owner isn't (`league:type`
  is read by LeagueMode and LeagueAreaUnlocks), and plugins switched off in `world.json` are never
  `require`d, so a runtime fallback to the declared default can't be relied on. Declarations are
  for the page, for validation and for docs. A test checks that each declared constant `default`
  equals the inline default at its call sites, so the two can't drift apart.
- `default` is optional. A default that depends on something else (LastManStanding and SoulWars
  `minPlayers` per mode, ShootingStars' interval from its data file, WelcomeScreen's text using the
  world name, `PlayerBots:sites`/`PlayerBots:ai` merged over data files) declares
  `defaultText` instead, e.g. "per mode: 2 for …". The page shows that text and an empty
  ("use default") control.
- Values are checked the way call sites already read them (my call): numbers accept numeric
  strings, since call sites wrap reads in `Number(...)` and worlds may already use `"30"`. A value
  that is invalid even so is reported as a warning at startup and is left for the call site to
  handle as it does today, so a running world never changes behaviour. The page itself always
  writes correctly typed values and refuses to save invalid ones.
- Every `pluginConfig` key read anywhere on the server gets declared in this change: the 27 read in
  `server/plugins` and the 3 read in core (`CrossFloor:visibility`, `CrossFloor:combat` in
  `game/CrossFloor.ts`; `commands:permissions` in `PluginManager.ts`). Core keys are declared beside
  the world-setting declarations in `WorldDefinition.ts`, with owner "core". A test scans both
  `server/plugins` and `server/src` and fails when code reads a key nobody declares.
- Plugin `description` is optional. It is required (by test) for plugins whose default is off
  (`enabled: false`) and for the plugins in the current switches table in
  `docs/world-configuration.md`, because those are the switches people actually flip.

### Top-level world settings

The values `parseWorldDefinition` accepts (`name`, `description`, `experienceMultiplier`, `spawn`,
`membersWorld`, gameframes, ...) get the same kind of declaration, kept beside the parser in
`WorldDefinition.ts`, so the page shows them with help text and validates them using the same rules
the server does when it starts.

### Catalog

The server builds a catalog: every plugin file, and for each plugin its name, area, description,
`members`, `dependsOn`, default on/off, current on/off, and declared options with shipped and current values.

- It's built **at runtime from the same plugin discovery `PluginManager` uses**, so it can never fall out of date.
  Plugins switched off in `world.json` `plugins` are skipped before `require` today
  (`PluginManager.ts` ~696). Default-off and members-only plugins are already required and then
  filtered out. The catalog is built **lazily, the first time the admin page asks**, not at every
  startup. It `require`s the remaining modules for metadata only, never `register`s them. Plugin
  modules must not have side effects at module scope (already the convention: `register` is
  attach-only). The builder checks this holds for every module before relying on it.
- Area = the plugin's first folder under `server/plugins/` (`skills`, `modes`, `minigames`, ...),
  so grouping needs no new field.

### The page (as built)

- **Settings first:** world values and all declared options grouped by area, with search. Plugin
  switches are a second tab, grouped by area, with default-off and documented plugins pinned first.
- Each row: control, label, help, "default: X", and a marker when it differs from the shipped value.
  Options whose plugin is switched off (or won't load, for example a members plugin on a free
  world) carry a "plugin off" badge and are greyed.
- Save shows a preview of the `world.local.json` change, then the countdown. While the server
  restarts the page shows a reconnect overlay and reloads when the world is back.
- The spawn point is picked on a map drawn from OSRS Wiki map tiles. This is the only external
  request the page makes: the user's browser fetches the tiles, only while the map is open (the
  user's choice; the server itself makes no outside request).
- Served by the server as one self-contained page, on its own listener (see Access).

### Saving

- Only values that differ from `world.json` go in `world.local.json`. Setting a value back to its
  shipped default removes it from the file.
- Keys in the existing `world.local.json` the page doesn't manage (e.g. `zones`, unknown keys) are
  preserved as they are.
- Before writing, the server validates the resulting merged config with the same code it uses at
  startup (`parseWorldDefinition`, plugin switch rules, option declarations). If that fails, nothing
  is written and the page shows the error.
- Write is atomic (temp file + rename). The file is created if it doesn't exist.
- A legacy `disabledPlugins` list overrides `plugins` and every plugin default, so leaving it in
  would make every switch saved from the page do nothing. On save the page converts it to the
  equivalent `plugins` entries (`"Name": false`) and removes it. The preview shows this.

### Restart

- **Online players get the normal world-update countdown** (decided by the user). The page uses
  the existing `GameUpdate` plugin (`server/plugins/world/GameUpdate.plugin.js`, the `::update
  <duration>` command): the same timer packet and login push, and the same cancel. The page shows a
  countdown length (default 60 seconds, my call), the time remaining while it runs, and a Cancel
  button. With nobody online, it skips the countdown. If `GameUpdate` is switched off, the page
  says so and offers only "restart now".
- **The file is written when the countdown ends, not when you press Save** (my call). Until then
  the change only exists in the pending update, and Cancel leaves `world.local.json` untouched.
  At zero the server saves every online player, writes the file, then restarts. This also covers
  dev: `yarn start` runs under nodemon, which watches `world.local.json` (not in
  `server/nodemon.json`'s ignore list) and on Windows kills the process without the graceful save.
  Players are saved first, so nodemon's restart loses nothing.
- How the server comes back:
  - dev (nodemon): restarts by itself after the write.
  - `start:prod` under a supervisor: the host opts in with an env var (e.g. `TSPS_SUPERVISED=1`,
    for systemd/pm2/docker). The shutdown exits with a **non-zero code**, so `Restart=on-failure`
    and docker `on-failure` policies restart it too (my call). The builder checks the exit code of
    `Server.shutdown` / `gracefulShutdown` (`Server.ts` ~147-193) and how GameUpdate calls it.
  - `start:prod` without the opt-in: the page offers "save only" (write now, takes effect at the
    next restart) and says to restart the server by hand.
- Shutdown cancels itself when saving players fails. The page then shows that failure, the file is
  not written, and the server keeps running.

### Access (as built)

- The page has **its own HTTP listener, bound to `127.0.0.1`**, on its own port (`WORLD_ADMIN_PORT`,
  default 49600; `scripts/wt` slot `n` gets `49600 + n`). The game port can't be trusted for this:
  production sits behind nginx, so every internet request reaches it from loopback. A VPS host
  reaches the page through an SSH tunnel. The `Host` header must be `localhost`/`127.0.0.1`.
- The page is served at `/` and the server prints `http://localhost:<port>/?token=...`. The token
  is generated once and persists in `server/data/definitions/world-admin.token`, so the link
  survives restarts; deleting the file issues a new one. Visiting with the token sets a cookie
  scoped to that port, so the bare URL works afterwards.
- `WORLD_ADMIN_TOKEN` replaces the generated token. Only with it set may `WORLD_ADMIN_BIND` open the
  listener to other machines.
- No CORS headers; write routes reject cross-origin requests. Not started when `BROWSER_HOST=1`.

### Docs

`docs/world-configuration.md` points to the page. Its hand-kept "Available switches" table is replaced
by text generated from the declarations (same catalog code), with a test that fails when the
committed text is stale. The per-feature docs (`prayer-bones.md`, `leagues.md`, ...) stay and can
mention that the option is on the page.

## Left to the builder

- Route names and the exact JSON shapes of the catalog / save / restart endpoints.
- Page markup and styling (plain, readable, works on a laptop screen; one inline file is fine).
- How the token reaches the page after the first visit (cookie vs. header).
- Wording of labels and help text, taken from the existing docs where they exist.
- Where the declaration registry lives (`PluginManager` or a small helper).
- Test layout, following the user's focused-testing rules: catalog completeness (every read key
  declared), save round-trip (only diffs written, unmanaged keys kept, invalid merges rejected),
  access checks (non-loopback, missing token, cross-origin), and one real run of the page against a
  worktree server via the browser pane.
- Splitting this into PRs. A natural order: (1) declarations for all 30 keys + descriptions +
  completeness and default-match tests; (2) admin listener, access, catalog, read-only page;
  (3) save, preview, restart.
