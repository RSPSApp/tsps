# Per-server Character Slots Implementation Plan


**Historical implementation plan:** the current implementation moves character-slot behavior into the disabled-by-default Characters plugin and replaces the core-specific login code below with generic extension hooks. See [current architecture and setup](../../character-slots.md).
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One login owns up to N characters on a server; the browser client shows a character picker after login; every other client keeps entering the last played character.

**Architecture:** A small core `Accounts` record (JSON file beside `display-names.json`) maps a login name to its character names. Each character stays an ordinary player with its own name and save, so nothing name-keyed changes. The existing two-packet login (`login` → `handshake`) gains an optional middle step: clients that set a new login flag receive a `CHARACTER_LIST` and may `CHARACTER_SELECT`/`CREATE`/`DELETE` before `handshake`; clients that don't get the default character. The browser login screen gains one new `LoginIndex` stage.

**Tech Stack:** TypeScript server (`server/`, built with Yarn 4 via `npx --yes --package @yarnpkg/cli-dist@4.12.0 -- yarn build`, tests `node --test tests/<file>.test.cjs`), JS plugins, TypeScript browser client (`client/`, tests `node scripts/run-tests.mjs <word>`), Kotlin gateway table (`runelite-gateway/`), node:sqlite.

**Spec:** `docs/superpowers/specs/2026-11-05-character-slots-design.md`

## Global Constraints

- Worktree: `C:/Users/Curt/Desktop/Other/Scripts/OSRS-Local/tsps-feat-character-slots`, branch `feat/character-slots`, port slot 26 (server `PORT=3126`, `WEBSOCKET_PORT=43726`, `AGENT_MCP_PORT=49826`). Never touch another checkout; never push to `main`.
- Server rules (`server/AGENTS.md`): foundations in core, gameplay in plugins; plugins reach core only through `api.core`; attribute keys kebab-case and namespaced; no new smoke scripts; never hand-edit generated JSON.
- Old clients, the gateway (login `flags = 0`), `connectHeadlessClient` and the agent MCP must see no new packets and must enter the default character.
- `LOGIN_RESPONSE` stays byte-for-byte as today (success, code, error, displayName, token). The displayName returned is the **account's primary name**.
- New ids: server packets `CHARACTER_LIST = 7` (length -2), `CHARACTER_RESULT = 8` (length -1); client packets `CHARACTER_SELECT = 206`, `CHARACTER_CREATE = 208`, `CHARACTER_DELETE = 209` (all length -1); login flag `LOGIN_FLAG_CHARACTER_SELECT = 4`; `LoginIndex.CHARACTER_SELECT = 15`.
- `CHARACTER_RESULT` codes: 1 name taken, 2 invalid name, 3 slot limit reached, 4 unknown character / not allowed now, 5 primary cannot be deleted, 6 confirmation did not match, 7 character online, 8 storage error, 9 primary has not entered the world yet, 10 character disabled (banned).
- Current configuration (updated after this original plan): Characters is disabled by default. When enabled, `characters:maxPerAccount` (pluginConfig) defaults to `6`, clamped to 1..6. Browser hosts stay limited to `1` unless `BROWSER_HOST_ACCOUNT_PERSISTENCE === "1"` advertises durable account, character and deletion checkpoints; see [current host requirements](../../character-slots.md#enabling-characters).
- Account file `data/saves/accounts.json`, env override `TSPS_ACCOUNTS_FILE`. Every server test that drives a login sets `process.env.TSPS_ACCOUNTS_FILE` to a temp file before requiring `dist`.
- Name rules for a new character are the login-name rules: 1–12 chars after `Misc.formatNameForProtocol`, `Misc.isValidName`, and not in use per `DisplayNames.loginNameInUse`.
- Commit after each task; messages in the imperative, no attribution lines.

## Review Focus

1. A token (remember-me) login typed with a non-primary character's name must still rotate the token on the primary's save and open the picker with that character preselected. Test in Task 7.
2. Two browser tabs logging into the same account: the second must get code 5 (already logged in) even when each picks a different character. Test in Task 4.
3. A `CHARACTER_SELECT` after `handshake` (player already in world) must be refused with code 4 and change nothing. Test in Task 4.
4. Deleting a character while a previous owner's history exists for the same name must not let `::rollback` on a new owner restore the old character (history re-keyed). Test in Task 5.
5. A new character's first entry must still run the new-player hooks (`isNewAccount` true) while the primary, re-entering, must not. Test in Task 6.

---

### Task 1: Accounts record (core)

**Files:**
- Create: `server/src/main/typescript/elvarg/game/entity/impl/player/Accounts.ts`
- Test: `server/tests/accounts.test.cjs`

**Interfaces:**
- Produces:
  ```ts
  export interface AccountCharacter { name: string; createdAt: number; lastPlayedAt: number }
  export interface AccountEntry { createdAt: number; characters: AccountCharacter[] }
  export class Accounts {
    static readonly FILE_ENV = "TSPS_ACCOUNTS_FILE";
    static key(name: string): string;                       // same normalisation as DisplayNames.key
    static accountOf(name: string): string | undefined;      // account key owning this character name (primary included)
    static entryOf(accountKey: string): AccountEntry | undefined;
    static charactersOf(accountKey: string): AccountCharacter[]; // [] when none
    static primaryOf(accountKey: string): string | undefined;    // characters[0].name
    static isPrimary(accountKey: string, name: string): boolean;
    static ensure(primaryName: string, now?: number): AccountEntry; // lazily creates {createdAt: now, characters: [{name: primaryName (as typed), createdAt: now, lastPlayedAt: 0}]}
    static addCharacter(accountKey: string, name: string, now?: number): AccountCharacter; // appends; throws if the name is owned by any account
    static removeCharacter(accountKey: string, name: string): boolean; // false for the primary or an unknown name
    static touchLastPlayed(accountKey: string, name: string, now?: number): void;
    static reset(): void;                                    // forget memory (tests)
  }
  ```
- File shape: `{ "accounts": { "<key>": { "createdAt": <ms>, "characters": [ { "name", "createdAt", "lastPlayedAt" } ] } } }`, written whole via `<file>.tmp` + rename, exactly like `DisplayNames.save()`. Load lazily once; keep a reverse map character key → account key, rebuilt on every change. A write failure rolls the in-memory change back and rethrows (mirror `DisplayNames.set`).

- [ ] **Step 1: Write the failing test** `server/tests/accounts.test.cjs`

```js
// Run after `yarn build`: node --test tests/accounts.test.cjs
const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tsps-accounts-')), 'accounts.json');
process.env.TSPS_ACCOUNTS_FILE = file;
const { Accounts } = require('../dist/game/entity/impl/player/Accounts');
beforeEach(() => { fs.rmSync(file, { force: true }); Accounts.reset(); });

test('ensure creates an account whose first character is the login name', () => {
  const entry = Accounts.ensure('Zezima', 1000);
  assert.deepEqual(entry, { createdAt: 1000, characters: [{ name: 'Zezima', createdAt: 1000, lastPlayedAt: 0 }] });
  assert.equal(Accounts.accountOf('zezima'), 'zezima');
  assert.equal(Accounts.accountOf('ZEZIMA '), 'zezima', 'key normalisation');
  assert.equal(Accounts.primaryOf('zezima'), 'Zezima');
  assert.equal(Accounts.ensure('Zezima', 2000).createdAt, 1000, 'idempotent');
});

test('characters are added, found by name, touched and removed, never the primary', () => {
  Accounts.ensure('Zezima', 1000);
  const added = Accounts.addCharacter('zezima', 'Zez Alt', 1500);
  assert.deepEqual(added, { name: 'Zez Alt', createdAt: 1500, lastPlayedAt: 0 });
  assert.equal(Accounts.accountOf('zez_alt'), 'zezima');
  assert.throws(() => Accounts.addCharacter('zezima', 'ZEZ ALT'), /owned/);
  Accounts.touchLastPlayed('zezima', 'Zez Alt', 1600);
  assert.equal(Accounts.charactersOf('zezima')[1].lastPlayedAt, 1600);
  assert.equal(Accounts.removeCharacter('zezima', 'Zezima'), false, 'primary stays');
  assert.equal(Accounts.removeCharacter('zezima', 'Zez Alt'), true);
  assert.equal(Accounts.accountOf('zez alt'), undefined);
});

test('the file round-trips through a restart', () => {
  Accounts.ensure('Zezima', 1000); Accounts.addCharacter('zezima', 'Second', 1100);
  Accounts.reset();
  assert.deepEqual(Accounts.charactersOf('zezima').map((c) => c.name), ['Zezima', 'Second']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).accounts.zezima.characters.length, 2);
});
```

- [ ] **Step 2: Build and run to verify it fails**

Run (in `server/`): `npx --yes --package @yarnpkg/cli-dist@4.12.0 -- yarn build && node --test tests/accounts.test.cjs`
Expected: FAIL, cannot find module `../dist/game/entity/impl/player/Accounts`

- [ ] **Step 3: Implement `Accounts.ts`** with the interface above, modelled line-for-line on `DisplayNames.ts` (static class, lazy `load()`, `save()` with tmp+rename, `reindex()`, `reset()`). `key()` delegates to `DisplayNames.key`. `addCharacter` throws `new Error("That name is owned by an account")` when `accountOf(name)` is defined.

- [ ] **Step 4: Build and run to verify it passes**

Run: `npx --yes --package @yarnpkg/cli-dist@4.12.0 -- yarn build && node --test tests/accounts.test.cjs`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add server/src/main/typescript/elvarg/game/entity/impl/player/Accounts.ts server/tests/accounts.test.cjs
git commit -m "Add the Accounts record: one login name, several character names"
```

---

### Task 2: One shared name namespace

**Files:**
- Modify: `server/src/main/typescript/elvarg/game/entity/impl/player/DisplayNames.ts:138-148` (`loginNameInUse`)
- Test: `server/tests/display-name.test.cjs` (add cases)

**Interfaces:**
- Produces: `DisplayNames.loginNameInUse(key: string): boolean` becomes **public** and also returns true when `Accounts.accountOf(key)` is defined. `DisplayNames.refusal` therefore refuses a created-but-never-entered character's name for `::displayname` and the bot roster.

- [ ] **Step 1: Write the failing test** (append to `display-name.test.cjs`, after setting `process.env.TSPS_ACCOUNTS_FILE` to a temp file at the top of the file, before `dist` is required)

```js
test('a name belonging to an account character is in use even without a save', () => {
  const { Accounts } = require('../dist/game/entity/impl/player/Accounts');
  Accounts.reset(); Accounts.ensure('Owner', 1); Accounts.addCharacter('owner', 'Unentered', 2);
  GameConstants.PLAYER_PERSISTENCE = { ...GameConstants.PLAYER_PERSISTENCE, exists: () => false };
  assert.equal(DisplayNames.loginNameInUse('unentered'), true);
  assert.equal(DisplayNames.refusal('someone', 'Unentered'), 'That name is not available.');
  assert.equal(DisplayNames.loginNameInUse('nobody'), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/display-name.test.cjs`
Expected: FAIL (`loginNameInUse` is private / returns false)

- [ ] **Step 3: Make `loginNameInUse` public and add the `Accounts.accountOf(key) !== undefined` clause** (lazy `require` like the others in that function to avoid an import cycle).

- [ ] **Step 4: Build, run to verify it passes**

Run: `npx --yes --package @yarnpkg/cli-dist@4.12.0 -- yarn build && node --test tests/display-name.test.cjs`
Expected: PASS, all cases

- [ ] **Step 5: Commit**

```bash
git add server/src/main/typescript/elvarg/game/entity/impl/player/DisplayNames.ts server/tests/display-name.test.cjs
git commit -m "Count account character names as login names in use"
```

---

### Task 3: Protocol additions (server and gateway table)

**Files:**
- Modify: `server/src/main/typescript/elvarg/net/protocol/ServerPackets.ts` (enum block 0-19 and `SERVER_PACKET_LENGTHS`)
- Modify: `server/src/main/typescript/elvarg/net/protocol/ClientProtocol.ts` (`ClientPacket` enum, `ServerPacket` enum, `ClientMessage` union at :260, decoder switch at :942, new encoders beside `encodeLoginResponse` :2625)
- Modify: `server/src/main/typescript/elvarg/net/login/LoginTokens.ts:16-18` (flag)
- Modify: `runelite-gateway/src/main/kotlin/gateway/tsps/TspsServerPacket.kt` (consts and `LENGTHS`)
- Test: `server/tests/character-slots-protocol.test.cjs`

**Interfaces:**
- Produces:
  ```ts
  // LoginTokens.ts
  export const LOGIN_FLAG_CHARACTER_SELECT = 4;
  // ClientProtocol.ts
  export interface CharacterListEntry { name: string; combatLevel: number; totalLevel: number; lastPlayedAt: number; primary: boolean; hasSave: boolean }
  export function encodeCharacterList(maxCharacters: number, defaultIndex: number, entries: CharacterListEntry[]): Buffer; // packet(CHARACTER_LIST, payload, 2)
  export function encodeCharacterResult(ok: boolean, code: number, message: string): Buffer;              // packet(CHARACTER_RESULT, payload, 1)
  // ClientMessage additions
  | { type: "character_select"; name: string }
  | { type: "character_create"; name: string }
  | { type: "character_delete"; name: string; confirmName: string }
  ```
- Wire: list = `u8 max, u8 defaultIndex, u8 count, then per entry string name, u8 combat, u16 total, i64 lastPlayedAt (writeBigInt64BE), u8 flags (bit0 primary, bit1 hasSave)`. Result = `u8 ok, u8 code, string message`.

- [ ] **Step 1: Write the failing test**

```js
// Run after `yarn build`: node --test tests/character-slots-protocol.test.cjs
const assert = require('node:assert/strict'); const { test } = require('node:test');
const { Server } = require('../dist/Server'); Server.installProductionPathResolver();
const proto = require('../dist/net/protocol/ClientProtocol');
const { ServerPacketId, SERVER_PACKET_LENGTHS } = require('../dist/net/protocol/ServerPackets');
const { LOGIN_FLAG_CHARACTER_SELECT } = require('../dist/net/login/LoginTokens');

test('ids, lengths and the login flag', () => {
  assert.equal(ServerPacketId.CHARACTER_LIST, 7); assert.equal(SERVER_PACKET_LENGTHS[7], -2);
  assert.equal(ServerPacketId.CHARACTER_RESULT, 8); assert.equal(SERVER_PACKET_LENGTHS[8], -1);
  assert.equal(LOGIN_FLAG_CHARACTER_SELECT, 4);
});

test('CHARACTER_LIST encodes max, default and entries', () => {
  const b = proto.encodeCharacterList(3, 1, [
    { name: 'Zezima', combatLevel: 126, totalLevel: 2277, lastPlayedAt: 1700000000000, primary: true, hasSave: true },
    { name: 'Alt', combatLevel: 3, totalLevel: 32, lastPlayedAt: 0, primary: false, hasSave: false },
  ]);
  assert.equal(b[0], 7); assert.equal(b.readUInt16BE(1), b.length - 3);
  let o = 3; assert.deepEqual([b[o], b[o + 1], b[o + 2]], [3, 1, 2]); o += 3;
  const end = b.indexOf(0, o); assert.equal(b.toString('latin1', o, end), 'Zezima'); o = end + 1;
  assert.equal(b[o], 126); assert.equal(b.readUInt16BE(o + 1), 2277);
  assert.equal(b.readBigInt64BE(o + 3), 1700000000000n); assert.equal(b[o + 11], 0b11);
});

test('CHARACTER_RESULT and the three client packets round-trip', () => {
  const r = proto.encodeCharacterResult(false, 3, 'Slot limit reached.');
  assert.equal(r[0], 8); assert.equal(r[2], 0); assert.equal(r[3], 3);
  const str = (s) => Buffer.concat([Buffer.from(s, 'latin1'), Buffer.from([0])]);
  const frame = (op, payload) => Buffer.concat([Buffer.from([op, payload.length]), payload]);
  assert.deepEqual(proto.decodeClientPacket(frame(206, str('Alt'))), { type: 'character_select', name: 'Alt' });
  assert.deepEqual(proto.decodeClientPacket(frame(208, str('New Guy'))), { type: 'character_create', name: 'New Guy' });
  assert.deepEqual(proto.decodeClientPacket(frame(209, Buffer.concat([str('Alt'), str('alt')]))), { type: 'character_delete', name: 'Alt', confirmName: 'alt' });
});
```

- [ ] **Step 2: Build and run to verify it fails**

Run: `npx --yes --package @yarnpkg/cli-dist@4.12.0 -- yarn build && node --test tests/character-slots-protocol.test.cjs`
Expected: FAIL (ids undefined, encoders missing)

- [ ] **Step 3: Add the enum entries, lengths, flag, decoder cases and the two encoders** per Interfaces. Check how `decodeClientPacket` frames length -1 client packets (`CLIENT_PACKET_LENGTHS` on the server side, if mirrored there) and add the three new ids to that table too.

- [ ] **Step 4: Add `CHARACTER_LIST = 7` / `CHARACTER_RESULT = 8` consts and `LENGTHS` entries (`to -2`, `to -1`) in `TspsServerPacket.kt`**

- [ ] **Step 5: Build and run to verify it passes**

Run: `npx --yes --package @yarnpkg/cli-dist@4.12.0 -- yarn build && node --test tests/character-slots-protocol.test.cjs`
Expected: PASS, 3 tests
Run (in `runelite-gateway/`, JAVA_HOME = Adoptium JDK 21; if the rsprox clone fails on `jvmToolchain(11)`, set it to 17 inside the gitignored `runelite-gateway/build/rsprox` clone only): `./gradlew :test --tests gateway.tsps.TspsServerPacketTest`
Expected: BUILD SUCCESSFUL

- [ ] **Step 6: Commit**

```bash
git add server/src/main/typescript/elvarg/net/protocol/ServerPackets.ts server/src/main/typescript/elvarg/net/protocol/ClientProtocol.ts server/src/main/typescript/elvarg/net/login/LoginTokens.ts runelite-gateway/src/main/kotlin/gateway/tsps/TspsServerPacket.kt server/tests/character-slots-protocol.test.cjs
git commit -m "Add CHARACTER_LIST, CHARACTER_RESULT and the character select packets"
```

---

### Task 4: Login resolves the account, lists characters, selects, defaults

**Files:**
- Modify: `server/src/main/typescript/elvarg/net/NetworkBuilder.ts` (`PendingLogin` :237, `login()` :1119-1274, `enterWorld()` :1276-1359, packet switch :1102-1110, `IMMEDIATE_PACKETS` :212, `releasePendingName` :1552)
- Create: `server/src/main/typescript/elvarg/net/login/CharacterSlots.ts`
- Modify: `server/src/main/typescript/elvarg/game/content/skill/SkillManager.ts` (static combat level)
- Test: `server/tests/character-slots-login.test.cjs`
- Modify: `server/tests/login-tokens.test.cjs`, `server/tests/core-disconnect-guards.test.cjs`, `server/tests/mobile-gameframe.test.cjs` (set `TSPS_ACCOUNTS_FILE` to a temp file at the top; grep `tests/` for `type: 'login'` for any other)

**Interfaces:**
- Consumes: `Accounts` (Task 1), `DisplayNames.loginNameInUse` (Task 2), encoders and flag (Task 3).
- Produces:
  ```ts
  // CharacterSlots.ts (pure helpers, no I/O except persistence reads)
  export function maxCharactersPerAccount(): number;        // pluginConfig "characters:maxPerAccount", default 3, clamp 1..20, 1 under BROWSER_HOST=1
  export function characterListFor(accountKey: string, profile: PlayerProfile): CharacterListEntry[]; // loads each character's save for `profile` (null → combat 3 / total 32 / hasSave false)
  export function defaultCharacterIndex(characters: AccountCharacter[], typedKey: string): number;    // typed non-primary → its index; else max lastPlayedAt; else 0
  // SkillManager.ts
  static combatLevelOf(maxLevels: number[]): number;        // extracted from the existing instance computation, which now calls it
  // NetworkBuilder.ts
  type PendingLogin = { account: string; username: string; profile: PlayerProfile; passwordHash: string; save: any | null;
                        loginTokens: LoginTokenEntry[] | null; characters: AccountCharacter[]; wantsCharacterList: boolean };
  ```
- Behaviour pinned by the spec: `login()` resolves `typedKey` → `Accounts.accountOf(typedKey) ?? typedKey`; primary = `Accounts.primaryOf(account) ?? typedName`; credentials come from the **primary's** saves exactly where `main`/`save` are loaded today; token login reads/rotates tokens on the primary's `profile` save; the online check runs over every character of the account plus the account key in `pendingNames`; after a successful auth `Accounts.ensure(primaryName)`; `pending.username` is the default character's display name and `pending.save` its save; `LOGIN_RESPONSE.displayName` = primary name; when `flags & LOGIN_FLAG_CHARACTER_SELECT` send `encodeCharacterList(max, defaultIndex, list)` right after; `character_select` (only while `pending` exists and no player) validates membership, ban (code 10), online (code 7), then swaps `pending.username`/`save`, reserves the character key in `pendingNames`, replies `encodeCharacterResult(true, 0, "")`; outside that window replies code 4. `enterWorld` sets username / display name / long username from `pending.username` as today and calls `Accounts.touchLastPlayed(pending.account, pending.username)`.

- [ ] **Step 1: Write the failing tests** `server/tests/character-slots-login.test.cjs` (copy `stubChannel`, `readString`, the `login()` helper and `REVISION` from `login-tokens.test.cjs`; add a `packetsOf(channel, opcode)` helper and a `handshake(connection)` helper that injects `{ type: 'handshake', name, clientType: 0, capabilities: 0 }` with `World.getPlayers().add` mocked as in `mobile-gameframe.test.cjs:154`). Persistence stub: a `Map` keyed by `saveKey(name, profile)` with `load/exists/save/saveOffline/updateOffline/flush/checkPassword/encryptPassword` reading and writing that map.

```js
test('a first login creates the account and sends no list without the flag', async () => {
  const r = await login('Zezima', 'pw', 0);
  assert.equal(r.success, true); assert.equal(r.displayName, 'Zezima');
  assert.deepEqual(Accounts.charactersOf('zezima').map((c) => c.name), ['Zezima']);
  assert.equal(packetsOf(channel, 7).length, 0);
});
test('with the flag the list follows the response and marks the default', async () => {
  seedSave('Zezima', { maxLevel: ninetyNines }); Accounts.ensure('Zezima', 1); Accounts.addCharacter('zezima', 'Alt', 2); Accounts.touchLastPlayed('zezima', 'Alt', 3);
  const { response, list } = await loginWithList('Zezima', 'pw');
  assert.equal(list.defaultIndex, 1, 'last played wins');
  assert.deepEqual(list.entries.map((e) => [e.name, e.primary, e.hasSave]), [['Zezima', true, true], ['Alt', false, false]]);
  assert.equal(list.entries[0].totalLevel, 23 * 99); assert.equal(list.max, 3);
});
test('typing a non-primary name logs into its account and preselects it', async () => {
  seedSave('Zezima', { passwordHash: hashOf('pw') }); Accounts.ensure('Zezima', 1); Accounts.addCharacter('zezima', 'Alt', 2);
  const { response, list } = await loginWithList('Alt', 'pw');
  assert.equal(response.displayName, 'Zezima'); assert.equal(list.defaultIndex, 1);
  const wrong = await login('Alt', 'nope', 0); assert.equal(wrong.code, 3);
});
test('handshake without a select enters the default character', async () => {
  // Alt last played → player.getUsername() === 'Alt', isNewAccount true (no save), lastPlayedAt updated
});
test('select swaps the character, is refused after handshake, and refuses a banned one', async () => {
  // select 'Alt' → CHARACTER_RESULT ok; handshake → username 'Alt'; select again → code 4
  // PlayerPunishment.banned mocked true for 'Alt' → code 10
});
test('one account online at a time, whichever character', async () => {
  // Zezima online as 'Alt' (World.getPlayerByName mocked for 'Alt') → login('Zezima') code 5; login('Alt') code 5
});
test('old tests still pass', () => {}); // placeholder reminder: run login-tokens, mobile-gameframe, core-disconnect-guards
```

- [ ] **Step 2: Build and run to verify they fail**

Run: `npx --yes --package @yarnpkg/cli-dist@4.12.0 -- yarn build && node --test tests/character-slots-login.test.cjs`
Expected: FAIL (no list packet, no `character_select` handling)

- [ ] **Step 3: Implement `CharacterSlots.ts` and `SkillManager.combatLevelOf`**

- [ ] **Step 4: Rework `login()`**: resolve account and primary, load credentials from the primary (`load(primary, profile)` and `load(primary, MAIN)` replace today's `typedName` loads), keep every existing branch (revision, name rules, bans, IP ban, full world, token checks, legacy plaintext, remember flag) but run the online check over `Accounts.charactersOf(account)` ∪ typed name, reserve the account key, call `Accounts.ensure`, compute `defaultIndex`, load the default character's save for `pending.save`, respond with the primary name, then send the list when the flag is set. `reservedName` becomes `reservedNames: string[]` released together.

- [ ] **Step 5: Add `case "character_select"`** to the switch and `"character_select"`, `"character_create"`, `"character_delete"` to `IMMEDIATE_PACKETS`; implement `selectCharacter(name)` per Interfaces; `enterWorld` adds `Accounts.touchLastPlayed`.

- [ ] **Step 6: Set `TSPS_ACCOUNTS_FILE` in the listed existing tests; build; run the new and the affected suites**

Run: `node --test tests/character-slots-login.test.cjs tests/login-tokens.test.cjs tests/mobile-gameframe.test.cjs tests/core-disconnect-guards.test.cjs tests/display-name.test.cjs tests/league-mode.test.cjs`
Expected: PASS, every file

- [ ] **Step 7: Commit**

```bash
git add server/src/main/typescript/elvarg/net/NetworkBuilder.ts server/src/main/typescript/elvarg/net/login/CharacterSlots.ts server/src/main/typescript/elvarg/game/content/skill/SkillManager.ts server/tests/character-slots-login.test.cjs server/tests/login-tokens.test.cjs server/tests/core-disconnect-guards.test.cjs server/tests/mobile-gameframe.test.cjs
git commit -m "Log into an account, list its characters and select one before the handshake"
```

---

### Task 5: Deleting a save (all backends) with history re-keyed

**Files:**
- Modify: `server/src/main/typescript/elvarg/game/entity/impl/player/persistence/PlayerPersistence.ts` (new method)
- Modify: `server/plugins/persistence/SqlitePlayerPersistence.plugin.js` (`delete`, `enqueue` write kind)
- Modify: `server/plugins/persistence/SaveWorker.SqlitePlayerPersistence.js` (`commit` handles `{ kind: "delete" }`)
- Modify: `server/plugins/persistence/SaveHistory.SqlitePlayerPersistence.js` (`rekey(from, to)`)
- Modify: `server/plugins/persistence/JsonPlayerPersistence.plugin.js` (`delete`)
- Modify: `server/src/main/typescript/elvarg/game/entity/impl/player/persistence/NullPlayerPersistence.ts` (`delete` no-op)
- Test: `server/tests/player-saves.test.cjs` (add cases)

**Interfaces:**
- Produces:
  ```ts
  // PlayerPersistence.ts (not abstract: default throws "This persistence backend does not support deleting saves")
  public async delete(username: string, profile: PlayerProfile = MAIN_PROFILE): Promise<void>;
  // SqliteSaveHistory
  rekey(fromUsername, toUsername)  // UPDATE player_save_history SET username = ? WHERE username = ?
  ```
- SQLite write message: `{ kind: "delete", historyKey: "deleted:<savedAt>:<key>" }`; worker runs, in the same transaction, `DELETE FROM player_saves WHERE username = ?` then `history.rekey(username, historyKey)`; no row validation for that kind. The plugin's `delete` enqueues `[{ kind: "history", json: <current json>, reason: "character-delete" }, { kind: "delete", historyKey }]` when a current save exists, drops `unwritten`/`pendingRestores` for the key, then `await this.flush()`. JSON: `fs.rmSync(path, { force: true })` plus dropping any pending write for that path. IndexedDb inherits JSON.

- [ ] **Step 1: Write the failing tests** (append to `player-saves.test.cjs`, using its existing SQLite and JSON fixtures)

```js
test('deleting a save removes the row, keeps its history under a deleted key, and frees the name', async () => {
  // save 'Doomed' twice (two history rows), then await persistence.delete('Doomed')
  // assert exists('Doomed') === false; listSnapshots('Doomed') is []; a row in player_save_history has username LIKE 'deleted:%:doomed' with reason 'character-delete' as the newest
  // then save a new player named 'Doomed' and assert listSnapshots('Doomed') shows only the new history
});
test('JSON backend deletes the file; Null backend ignores delete', async () => { /* exists false after delete; Null resolves */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/player-saves.test.cjs`
Expected: FAIL (`delete is not a function`)

- [ ] **Step 3: Implement per Interfaces** in the five files.

- [ ] **Step 4: Build and run to verify they pass**

Run: `npx --yes --package @yarnpkg/cli-dist@4.12.0 -- yarn build && node --test tests/player-saves.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/main/typescript/elvarg/game/entity/impl/player/persistence/PlayerPersistence.ts server/src/main/typescript/elvarg/game/entity/impl/player/persistence/NullPlayerPersistence.ts server/plugins/persistence/SqlitePlayerPersistence.plugin.js server/plugins/persistence/SaveWorker.SqlitePlayerPersistence.js server/plugins/persistence/SaveHistory.SqlitePlayerPersistence.js server/plugins/persistence/JsonPlayerPersistence.plugin.js server/tests/player-saves.test.cjs
git commit -m "Let persistence delete a save, re-keying its history"
```

---

### Task 6: Create and delete characters from the login step

**Files:**
- Modify: `server/src/main/typescript/elvarg/net/NetworkBuilder.ts` (two new cases beside `character_select`)
- Test: `server/tests/character-slots-login.test.cjs` (add cases)

**Interfaces:**
- Consumes: `Accounts.addCharacter/removeCharacter`, `DisplayNames.loginNameInUse`, `maxCharactersPerAccount`, `PlayerPersistence.delete`.
- Behaviour: `character_create name` → code 4 unless pending and no player; code 9 unless `exists(primary, MAIN) || exists(primary, LEAGUE)`; code 2 unless 1–12 chars and `Misc.isValidName`; code 1 if `DisplayNames.loginNameInUse(key)`; code 3 if `characters.length >= max`; else `Accounts.addCharacter`, refresh `pending.characters`, reply ok then a fresh `CHARACTER_LIST`. `character_delete name confirmName` → code 4 unknown; code 5 primary; code 7 online; code 6 when `DisplayNames.key(confirmName) !== DisplayNames.key(name)`; else `await delete(name, MAIN)` and `delete(name, LEAGUE)` (ignore "not supported" from Null), `Accounts.removeCharacter`, if the deleted one was `pending.username` fall back to the default, reply ok then a fresh list; a thrown persistence error → code 8 and the account record untouched.

- [ ] **Step 1: Write the failing tests**

```js
test('creating a character: precondition, name rules, cap, success', async () => {
  // no primary save → code 9; seed primary save → 'bad!name' code 2; 'Zezima' code 1; third then fourth create → code 3 at max 3; success → CHARACTER_LIST has the new name with hasSave false
});
test('a new character enters as a new player; the primary re-enters as an old one', async () => {
  // create 'Alt', select 'Alt', handshake → emitPlayerLogin isNewAccount true; fresh connection as Zezima default → isNewAccount false
});
test('deleting: primary, online, confirmation, success, and persistence failure', async () => {
  // codes 5, 7, 6; success removes from Accounts and calls persistence.delete for both profiles; delete throwing → code 8 and Accounts unchanged
});
```

- [ ] **Step 2: Build, run to verify they fail**

Run: `npx --yes --package @yarnpkg/cli-dist@4.12.0 -- yarn build && node --test tests/character-slots-login.test.cjs`
Expected: FAIL on the new tests

- [ ] **Step 3: Implement `createCharacter(name)` and `deleteCharacter(name, confirmName)`** per Behaviour.

- [ ] **Step 4: Build, run to verify they pass**

Run: same command
Expected: PASS, all tests in the file

- [ ] **Step 5: Commit**

```bash
git add server/src/main/typescript/elvarg/net/NetworkBuilder.ts server/tests/character-slots-login.test.cjs
git commit -m "Create and delete an account's characters before the handshake"
```

---

### Task 7: Credentials stay on the primary

**Files:**
- Modify: `server/src/main/typescript/elvarg/game/entity/impl/player/persistence/PlayerPersistence.ts:73-82` (`changePassword`)
- Modify: `server/src/main/typescript/elvarg/net/NetworkBuilder.ts` (`forgetLoginToken` :126-151; token attribute in `enterWorld`)
- Test: `server/tests/login-tokens.test.cjs` (add cases)

**Interfaces:**
- Behaviour: `changePassword(player, hash)`: if `Accounts.isPrimary(account, player.getUsername())` (or no account) → as today; else set the hash on the live player, then `updateOffline(primary, …, "password-change", MAIN, { evenIfOnline: true })` and the same for `LEAGUE` when it exists, clearing `login:tokens` on both. `forgetLoginToken(name, token)`: resolve `Accounts.accountOf(name)` → primary, then today's logic on the primary's `WORLD_PROFILE` save (online lookup by primary too). `enterWorld`: write `pending.loginTokens` to the player only when `pending.username` is the primary.

- [ ] **Step 1: Write the failing tests**

```js
test('a token login typed with a non-primary name rotates the token on the primary save and preselects that character', async () => { /* Review Focus 1 */ });
test('changing the password while playing a non-primary character rewrites the primary save and signs out its tokens', async () => {});
test('login_forget with a character name drops the token from the primary save', async () => {});
```

- [ ] **Step 2: Run to verify they fail** — `node --test tests/login-tokens.test.cjs`

- [ ] **Step 3: Implement** per Behaviour.

- [ ] **Step 4: Build, run to verify they pass** — `npx --yes --package @yarnpkg/cli-dist@4.12.0 -- yarn build && node --test tests/login-tokens.test.cjs tests/character-slots-login.test.cjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/main/typescript/elvarg/game/entity/impl/player/persistence/PlayerPersistence.ts server/src/main/typescript/elvarg/net/NetworkBuilder.ts server/tests/login-tokens.test.cjs
git commit -m "Keep passwords and remembered logins on the account's primary character"
```

---

### Task 8: `::characters` command, core API exposure and docs

**Files:**
- Modify: `server/src/main/typescript/elvarg/plugins/PluginManager.ts:2455` (add `Accounts` beside `DisplayNames`), `server/src/main/typescript/elvarg/plugins/PluginTypes.ts:1572` (`Accounts: any;`)
- Create: `server/plugins/commands/Characters.plugin.js`
- Create: `docs/character-slots.md`
- Modify: `docs/player-saves.md` (history reason `character-delete`, the `deleted:` key), `server/docs/leagues.md` (one paragraph: characters × profiles)
- Test: `server/tests/characters-command.test.cjs`

**Interfaces:**
- `api.registerCommand("characters", handler, <developer rights constant used by AdminCommands.plugin.js>, "List an account's characters")`; handler takes `::characters <name>`, resolves `api.core.Accounts.accountOf(name)` and prints one line per character: `name (primary) · last played <date or never>`; unknown → `No account owns that name.`

- [ ] **Step 1: Write the failing test** (follow `tests/admin-commands.test.cjs` for how a command plugin is loaded and a player's messages captured)

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Implement the plugin, the core API entries and write the docs.** `docs/character-slots.md` covers: what a player sees, the config key with its default, the account file, the primary rule, delete semantics and history re-key, native/bot behaviour, link to the spec.

- [ ] **Step 4: Build, run to verify it passes** — `node --test tests/characters-command.test.cjs`

- [ ] **Step 5: Commit**

```bash
git add server/src/main/typescript/elvarg/plugins/PluginManager.ts server/src/main/typescript/elvarg/plugins/PluginTypes.ts server/plugins/commands/Characters.plugin.js server/tests/characters-command.test.cjs docs/character-slots.md docs/player-saves.md server/docs/leagues.md
git commit -m "Add ::characters, expose Accounts to plugins and document character slots"
```

---

### Task 9: Client protocol and connection plumbing

**Files:**
- Modify: `client/common/packets/ServerPacketId.ts` (ids 7, 8 and lengths), `client/common/packets/ClientPacketId.ts` (206, 208, 209 and lengths -1)
- Modify: `client/network/serverConnection/constants.ts:22-25` (`LOGIN_FLAG_CHARACTER_SELECT = 4`)
- Modify: `client/network/packet/ServerBinaryDecoder.ts` (`DecodedServerMessage` :266, two new cases beside `LOGIN_RESPONSE` :1866)
- Modify: `client/network/packet/ClientBinaryEncoder.ts` (three encoders beside `encodeLoginForget` :205; `encodeClientMessage` cases :634)
- Modify: `client/network/serverConnection/state.ts:161` (`characterListListeners`, `characterResultListeners`, `sessionCharacter: string | null`)
- Modify: `client/network/serverConnection/handlers/authTick.ts` (handle `character_list`, `character_result`)
- Modify: `client/network/serverConnection/login.ts` (`subscribeCharacterList`, `subscribeCharacterResult`, `sendCharacterSelect`, `sendCharacterCreate`, `sendCharacterDelete`)
- Modify: `client/network/serverConnection/connection/init.ts:97-109` (nothing new to send; the re-login carries the stored flags, so the list arrives and Task 10 auto-selects `state.sessionCharacter`)
- Test: `client/tests/character-slots-protocol.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CharacterSummary { name: string; combatLevel: number; totalLevel: number; lastPlayedAt: number; primary: boolean; hasSave: boolean }
  // decoder payloads
  { type: "character_list"; payload: { maxCharacters: number; defaultIndex: number; characters: CharacterSummary[] } }
  { type: "character_result"; payload: { ok: boolean; code: number; message: string } }
  // login.ts
  export function subscribeCharacterList(cb: (p: CharacterListPayload) => void): () => void;
  export function subscribeCharacterResult(cb: (p: { ok: boolean; code: number; message: string }) => void): () => void;
  export function sendCharacterSelect(name: string): void;   // also sets state.sessionCharacter = name
  export function sendCharacterCreate(name: string): void;
  export function sendCharacterDelete(name: string, confirmName: string): void;
  ```

- [ ] **Step 1: Write the failing test** (pattern of `tests/remembered-login.test.ts`: import the server encoders by relative path and decode with `decodeServerPacket`; encode the client packets and decode with the server's `decodeClientPacket`)

```ts
const list = decodeServerPacket(new Uint8Array(encodeCharacterList(3, 1, [zezima, alt]))) as any;
assert.equal(list.type, "character_list");
assert.deepEqual(list.payload, { maxCharacters: 3, defaultIndex: 1, characters: [zezima, alt] });
const result = decodeServerPacket(new Uint8Array(encodeCharacterResult(false, 3, "Slot limit reached."))) as any;
assert.deepEqual(result, { type: "character_result", payload: { ok: false, code: 3, message: "Slot limit reached." } });
assert.deepEqual(decodeClientPacket(Buffer.from(clientEncoder.encodeCharacterSelect("Alt"))), { type: "character_select", name: "Alt" });
assert.deepEqual(decodeClientPacket(Buffer.from(clientEncoder.encodeCharacterDelete("Alt", "alt"))), { type: "character_delete", name: "Alt", confirmName: "alt" });
assert.equal(LOGIN_FLAG_CHARACTER_SELECT, 4);
```

- [ ] **Step 2: Run to verify it fails** — in `client/`: `node scripts/run-tests.mjs character-slots-protocol`

- [ ] **Step 3: Implement** per Interfaces. `lastPlayedAt` is read with the reader's 64-bit method (the one `VARP_LONG` uses) and converted with `Number()`.

- [ ] **Step 4: Run to verify it passes** — `node scripts/run-tests.mjs character-slots-protocol remembered-login`
Expected: both pass

- [ ] **Step 5: Commit**

```bash
git add client/common/packets/ServerPacketId.ts client/common/packets/ClientPacketId.ts client/network/serverConnection/constants.ts client/network/packet/ServerBinaryDecoder.ts client/network/packet/ClientBinaryEncoder.ts client/network/serverConnection/state.ts client/network/serverConnection/handlers/authTick.ts client/network/serverConnection/login.ts client/tests/character-slots-protocol.test.ts
git commit -m "Decode the character list and send character select, create and delete"
```

---

### Task 10: The character picker stage

**Files:**
- Modify: `client/game/login/GameState.ts:42-79` (`CHARACTER_SELECT = 15`)
- Modify: `client/game/login/LoginState.ts` (new fields), `client/game/login/LoginAction.ts` (types and constants)
- Modify: `client/game/login/renderer/layout/geometry.ts` (constants), `client/game/login/renderer/render/loginScreensSecondary.ts` (`drawCharacterSelect`), `client/game/login/renderer/render/loginScreensRouter.ts:41-96`, `client/game/login/renderer/input/mouseHandlers.ts` (`handleCharacterSelectClick`), `client/game/login/renderer/input/mouseClick.ts:240-268`, `client/game/login/renderer/input/keyboard.ts`, `client/game/login/renderer/render/titleScene.ts:17-44` (hash), `client/ui/devoverlay/LoginOverlay.ts:497-524` (hash), `client/render/render/mobileLogin.ts:192-200`
- Modify: `client/game/OsrsClient.ts` (`sendLoginRequest` :5432 adds the flag; `submitLoginFromKeyboard` :5452; `processLoginAction` :5885 new cases; new `onCharacterList(payload)`, `onCharacterResult(payload)`; the CONNECTING timeout near :3604 must not fire while the picker is up)
- Modify: `client/game/OsrsClientApp.tsx:378-402` (hold the handshake; subscribe to list and result)
- Test: `client/tests/character-picker.test.ts`

**Interfaces:**
- `LoginState` fields: `characters: CharacterSummary[] = []`, `maxCharacters = 1`, `selectedCharacter = 0`, `hoveredCharacter = -1`, `pickerMode: "list" | "create" | "delete" = "list"`, `pickerInput = ""`, `pickerMessage = ""`, `pickerBusy = false`; method `showCharacterSelect(payload)` sets the fields from a `character_list` payload, `selectedCharacter = defaultIndex`, `pickerMode = "list"`, `loginIndex = CHARACTER_SELECT`.
- `LoginAction` additions: `select_character {index}`, `play_character`, `new_character`, `delete_character`, `submit_picker_input`, `cancel_picker_input`, `sign_out_picker`; constants `PLAY_CHARACTER`, `NEW_CHARACTER`, `DELETE_CHARACTER`, `SUBMIT_PICKER_INPUT`, `CANCEL_PICKER_INPUT`, `SIGN_OUT_PICKER`.
- Geometry (content space, box x 202–562, y 170–370): `PICKER_TITLE_Y = 192` ("Choose your character", fontBold12, yellow); `PICKER_ROWS_Y = 202`, `PICKER_ROW_X = loginBoxX + 20`, `PICKER_ROW_W = 320`, `PICKER_ROW_H = 22` for ≤4 rows else `floor(88 / rows)`; rows = characters then one "New character" row when `characters.length < maxCharacters` (greyed with the code-9 text when the primary has no save); `PICKER_BUTTON_Y = 322` with left button centre `loginBoxX + 100` (Play in list mode; Create / Delete in the input modes) and right button centre `loginBoxX + 260` (Delete in list mode, greyed on the primary; Cancel in input modes); `PICKER_SIGN_OUT_Y = 356` ("Sign out", plain12, clickable ±40×±8). Row hit = its rectangle. Selected row fill `rgba(255,255,255,0.08)` as the server list uses, hovered `rgba(255,255,255,0.04)`. Row text: name left (fontBold12, white; yellow when selected), `Cmb <n> · Total <n>` right-aligned (fontPlain11), and a second right-aligned `Played <relative>` only when `PICKER_ROW_H >= 22`.
- Input modes: the rows area shows a prompt line (`Name your new character:` / `Type <NAME> to delete it:`) and a text field drawn like the login form's username field holding `pickerInput` with the caret; `pickerMessage` draws in red at `PICKER_ROWS_Y + 70`. Keys in `keyboard.ts` for `CHARACTER_SELECT`: list mode Enter → `PLAY_CHARACTER`; input modes: printable chars append (max 12), Backspace, Enter → `SUBMIT_PICKER_INPUT`.
- `OsrsClient.processLoginAction` cases: `select_character` sets `selectedCharacter`; `play_character` → if `pickerBusy` ignore, else `pickerBusy = true`, `sendCharacterSelect(name)`; `new_character` → `pickerMode = "create"`, clear input; `delete_character` → ignore on primary, else `pickerMode = "delete"`; `submit_picker_input` → `sendCharacterCreate(input)` or `sendCharacterDelete(selectedName, input)`, `pickerBusy = true`; `cancel_picker_input` → list mode; `sign_out_picker` → close the socket without reconnect and `updateGameState(LOGIN_SCREEN)` (then `showRememberedLogin()`).
- Flow in `OsrsClientApp.tsx`: on login success call `client.onLoginAccepted(...)` and **do not** send the handshake. `subscribeCharacterList` → `client.onCharacterList(p)`: when `gameState === CONNECTING` show the picker (and disarm the connecting timeout); otherwise (a reconnect) `sendCharacterSelect(state.sessionCharacter ?? p.characters[p.defaultIndex].name)`. `subscribeCharacterResult` → `client.onCharacterResult(r)`: `pickerBusy = false`; if `ok` and the last request was a select → `sendHandshake(name)`; if `ok` and it was create/delete → back to list mode (the following `character_list` refreshes rows); if not ok → `pickerMessage = r.message`, stay.
- Hashes: append `|${state.loginIndex === LoginIndex.CHARACTER_SELECT ? state.pickerHash() : ""}` to both `computeTitleStateHash` and `LoginOverlay.computeStateHash`, where `pickerHash()` joins `characters.map(c => c.name + c.lastPlayedAt)`, `selectedCharacter`, `hoveredCharacter`, `pickerMode`, `pickerInput.length`, `pickerMessage`, `pickerBusy`, `maxCharacters`. Hover: compute `hoveredCharacter` from the mouse position in the same place `hoveredServerIndex` is computed. Mobile: `shouldUseMobileLoginInput` also true for `CHARACTER_SELECT` with `pickerMode !== "list"`.

- [ ] **Step 1: Write the failing tests** `client/tests/character-picker.test.ts`

```ts
// state transitions
const state = new LoginState();
state.showCharacterSelect({ maxCharacters: 3, defaultIndex: 1, characters: [zezima, alt] });
assert.equal(state.loginIndex, LoginIndex.CHARACTER_SELECT); assert.equal(state.selectedCharacter, 1); assert.equal(state.pickerMode, "list");
// hit tests with the fake host from remembered-sign-out.test.ts
assert.deepEqual(handleCharacterSelectClick(host, state, host.loginBoxX + 100, PICKER_ROWS_Y + 5), { type: "select_character", index: 0 });
assert.equal(handleCharacterSelectClick(host, state, host.loginBoxX + 100, PICKER_ROWS_Y + 2 * PICKER_ROW_H + 5), LoginActions.NEW_CHARACTER, "the empty slot row");
assert.equal(handleCharacterSelectClick(host, state, host.loginBoxX + 100, PICKER_BUTTON_Y), LoginActions.PLAY_CHARACTER);
assert.equal(handleCharacterSelectClick(host, state, host.loginBoxX + 260, PICKER_BUTTON_Y), LoginActions.DELETE_CHARACTER);
state.selectedCharacter = 0; assert.equal(handleCharacterSelectClick(host, state, host.loginBoxX + 260, PICKER_BUTTON_Y), undefined, "no delete on the primary");
assert.equal(handleCharacterSelectClick(host, state, host.loginBoxX + 180, PICKER_SIGN_OUT_Y), LoginActions.SIGN_OUT_PICKER);
state.pickerMode = "create"; assert.equal(handleCharacterSelectClick(host, state, host.loginBoxX + 260, PICKER_BUTTON_Y), LoginActions.CANCEL_PICKER_INPUT);
// keyboard
handleKeyInput(host, state, "", "a"); handleKeyInput(host, state, "", "b"); assert.equal(state.pickerInput, "ab");
handleKeyInput(host, state, "Backspace", ""); assert.equal(state.pickerInput, "a");
// a full account shows no New row
state.showCharacterSelect({ maxCharacters: 2, defaultIndex: 0, characters: [zezima, alt] });
assert.equal(handleCharacterSelectClick(host, state, host.loginBoxX + 100, PICKER_ROWS_Y + 2 * PICKER_ROW_H + 5), undefined);
```

- [ ] **Step 2: Run to verify it fails** — `node scripts/run-tests.mjs character-picker`

- [ ] **Step 3: Implement the state, actions, geometry, draw function, click handler, router and mouse cases, keyboard, both hashes, hover and mobile input** per Interfaces.

- [ ] **Step 4: Wire `OsrsClient` and `OsrsClientApp`** per Flow; `sendLoginRequest` ORs `LOGIN_FLAG_CHARACTER_SELECT` into both the token and the password login flags; `submitLoginFromKeyboard` routes Enter on `CHARACTER_SELECT` through `processLoginAction`.

- [ ] **Step 5: Run the client tests and typecheck**

Run (in `client/`): `node scripts/run-tests.mjs character remembered-login remembered-sign-out login-title-fire` then `npx --yes --package @yarnpkg/cli-dist@4.12.0 -- yarn typecheck` (or the project's tsc script named in `client/package.json`)
Expected: tests pass, no type errors

- [ ] **Step 6: Commit**

```bash
git add client/game/login client/game/OsrsClient.ts client/game/OsrsClientApp.tsx client/ui/devoverlay/LoginOverlay.ts client/render/render/mobileLogin.ts client/tests/character-picker.test.ts
git commit -m "Show a character picker after login in the browser client"
```

---

### Task 11: Live check, review pass and PR

**Files:**
- No source changes expected; fixes found here get their own small commits.

- [ ] **Step 1: Start this worktree's server and client** (never another worktree's): in `server/` build then `AGENT_MCP=1 node ../scripts/run-with-env.mjs - ./dist/Server.js`; client via `preview_start` on the worktree's slot (`http://localhost:3126`). `server/data/definitions/world.local.json` already has PvP and Tutorial Island off.

- [ ] **Step 2: Browser pane flow**: log in as a new name → picker shows one card plus a greyed New slot (code 9 text) → Play → in world → log out → log in → New character → name → Create → list shows two → Play the new one → in world as that name (new-player flow ran) → log out → log in → picker preselects it (last played) → Delete it with confirmation → list shows one. Screenshot each picker state.

- [ ] **Step 3: Default pick for other clients**: through the agent MCP (`http://127.0.0.1:49826/mcp`) `login` as the account name → the player is the last played character; `observe` shows no error. Confirm `data/saves/accounts.json` content and the SQLite `player_saves` rows (`node:sqlite`, read-only).

- [ ] **Step 4: Run the focused server and client suites once more** (the files touched by Tasks 1–10) and `git status` clean.

- [ ] **Step 5: Independent review** (per the project's pre-PR habit): dispatch a fresh reviewer with the spec, the plan and `git diff origin/main...HEAD`; fix real findings with small commits.

- [ ] **Step 6: Push and open the PR**

```bash
git push origin feat/character-slots
gh pr create --repo RSPSApp/tsps --base main --head feat/character-slots --title "Per-server character slots: one login, several characters, a picker after login" --body-file <description>
```

Description: what a player sees, what hosts configure (`characters:maxPerAccount`), what does not change (native, bots, MCP, saves, names), the primary-character rule, a link to the spec, a note that the review loop will hold it as approval-only for the maintainer, and the checks run with counts. End the hand-back to the user with `Ready to test: http://localhost:3126 (feat/character-slots)`.
