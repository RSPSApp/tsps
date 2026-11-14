// OPT-IN PREPARATION; mixed-world bootstrap correction below is not yet runtime qualified.
// Preparations003/006/007/008/010 remain retained; source63233 passed the six preparation checks.
// Each profile case needs its own ordinary native process because world selection is process-wide.
// This uses the existing compiled/cache/login/save fixture route; see the document for runtime scope.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { before, after, test } = require("node:test");

const SERVER = path.resolve(__dirname, "../..");
const ORIGINAL_CWD = process.cwd();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deadman-preparation-"));
const scenario = process.env.DMM_PREPARATION_FIXTURE_PROFILE;
assert.ok(["main", "league", "hardcore", "deadman", "conflict"].includes(scenario), "valid fixture scenario, not a feature-absence assertion");
const conflict = scenario === "conflict";
const competing = process.env.DMM_PREPARATION_CONFLICT_KIND ?? "hardcore";
assert.ok(["hardcore", "league", "both"].includes(competing));
const lockRegression = process.env.DMM_PREPARATION_LOCK_REGRESSION === "1";
if (lockRegression) assert.ok(["main", "deadman"].includes(scenario));
const profile = conflict ? "deadman" : scenario;
process.env.DISABLE_PLAYER_BOTS = "1";
process.env.TSPS_ACCOUNTS_FILE = path.join(directory, "accounts.json");
process.env.TSPS_DISPLAY_NAMES_FILE = path.join(directory, "display-names.json");
process.env.PLAYER_SAVE_DATABASE_PATH = path.join(directory, "players.sqlite");
process.env.PLAYER_SAVE_IMPORT_LEGACY_JSON = "0";

// Only the disposable deployment receives fixture config. No shipped/local live world file is written.
fs.mkdirSync(path.join(directory, "data", "definitions"), { recursive: true });
for (const entry of fs.readdirSync(path.join(SERVER, "data"))) {
  if (entry === "definitions" || entry === "saves") continue;
  // The loader requires each model's real path to stay inside this deployment's model root.
  // A real copy preserves that containment check in the disposable deployment.
  if (entry === "models") fs.cpSync(path.join(SERVER, "data", entry), path.join(directory, "data", entry), { recursive: true, dereference: true });
  else fs.symlinkSync(path.join(SERVER, "data", entry), path.join(directory, "data", entry));
}
for (const entry of fs.readdirSync(path.join(SERVER, "data", "definitions"))) {
  if (entry === "world.json" || entry === "world.local.json") continue;
  fs.symlinkSync(path.join(SERVER, "data", "definitions", entry), path.join(directory, "data", "definitions", entry));
}
const world = JSON.parse(fs.readFileSync(path.join(SERVER, "data", "definitions", "world.json"), "utf8"));
world.name = `Disposable preparation fixture: ${scenario}`;
delete world.disabledPlugins;
world.plugins = { ...world.plugins, JsonPlayerPersistence: true, SqlitePlayerPersistence: false, PlayerBots: false, TutorialIsland: false };
if (lockRegression) world.plugins.PvpMode = true;
world.pluginConfig = { ...world.pluginConfig, "DeadmanMode:enabled": profile === "deadman",
  "league:type": profile === "league" || (conflict && competing !== "hardcore") ? 4 : 0,
  "HardcoreWorld:enabled": profile === "hardcore" || (conflict && competing !== "league") };
fs.writeFileSync(path.join(directory, "data", "definitions", "world.json"), JSON.stringify(world));
// Eager plugins also resolve compiled modules from deployment CWD before Server's
// resolver can be installed. Bind the real code root without changing world data.
fs.symlinkSync(path.join(SERVER, "dist"), path.join(directory, "dist"));
// Server.main uses the deployment CWD. Copy plugins so any legacy relative source
// requests stay within this deployment's resolver roots, including the real CLI child.
fs.cpSync(path.join(SERVER, "plugins"), path.join(directory, "plugins"), { recursive: true });
fs.symlinkSync(path.join(SERVER, "node_modules"), path.join(directory, "node_modules"), "dir");
fs.copyFileSync(path.join(SERVER, "target.txt"), path.join(directory, "target.txt"));
fs.mkdirSync(path.join(directory, "caches"));
for (const entry of fs.readdirSync(path.join(SERVER, "caches"))) {
  const source = path.join(SERVER, "caches", entry);
  const destination = path.join(directory, "caches", entry);
  if (fs.statSync(source).isDirectory()) fs.symlinkSync(source, destination);
  else fs.copyFileSync(source, destination);
}

const initializationErrors = [];
const originalError = console.error;
function recordInitializationError(...args) {
  initializationErrors.push(args.map((value) => value instanceof Error ? value.message : String(value)).join(" "));
  originalError(...args);
}

// FIRST core import sees only the disposable deployment. Requiring Server imports
// WorldDefinition/GameConstants transitively, before its resolver method can be called.
process.chdir(directory);
let Server;
console.error = recordInitializationError;
try { ({ Server } = require("../../dist/Server")); }
finally { console.error = originalError; }
// Capture this disposable deployment's roots before loading its copied plugins.
// The dist symlink preserves canonical compiled class identity.
Server.installProductionPathResolver();
const { PluginManager: PM } = require("../../dist/plugins/PluginManager");
const { Player } = require("../../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../../dist/game/entity/impl/player/persistence/PlayerSave");
const { GameConstants } = require("../../dist/game/GameConstants");
const { getWorldDefinition, WORLD_ZONE_BOUNDARIES } = require("../../dist/game/definition/WorldDefinition");
const { connectHeadlessClient, dispatchClientMessages } = require("../../dist/net/NetworkBuilder");
const { PasswordUtil } = require("../../dist/util/PasswordUtil");
const { JsonPlayerPersistence } = require(path.join(directory, "plugins/persistence/JsonPlayerPersistence.plugin"));
let core;
let backend;
const actors = new Set();
const PASSWORD = "fixture-only-password";
let bootstrap;

async function observeBootstrapBoundaries() {
  const { GameBuilder } = require("../../dist/game/GameBuilder");
  const { NetworkBuilder } = require("../../dist/net/NetworkBuilder");
  const calls = [];
  const exits = [];
  // Explicit lifecycle test stubs: no game engine, listener or harness exit. The
  // actual Server.main, cache initialization and plugin loader remain in use.
  const replacements = [
    [GameBuilder.prototype, "initialize", () => calls.push("game")],
    [NetworkBuilder.prototype, "initialize", () => calls.push("network")],
    [process, "exit", (code) => exits.push(code)],
    [Server, "setupFileLogging", () => {}],
    [Server, "installGlobalCrashHandlers", () => {}],
    [Server, "installGracefulShutdownHandlers", () => {}],
  ].map(([owner, key, value]) => ({ owner, key, value, original: owner[key] }));
  for (const replacement of replacements) replacement.owner[replacement.key] = replacement.value;
  console.error = recordInitializationError;
  try { await Server.main(["1", "--disablePlayerBots"]); }
  finally {
    console.error = originalError;
    for (const replacement of replacements.reverse()) replacement.owner[replacement.key] = replacement.original;
  }
  return { calls, exits };
}

before(async () => {
  const cacheModule = path.join("game", "cache", "CacheDefinitions");
  assert.equal(require.resolve(path.join(directory, "dist", cacheModule)),
    require.resolve(path.join(SERVER, "dist", cacheModule)), "setup: disposable code resolves to canonical compiled module");
  assert.equal(require(path.join(directory, "dist", cacheModule)) === require(path.join(SERVER, "dist", cacheModule)),
    true, "setup: CacheDefinitions module identity is shared");
  const definition = getWorldDefinition();
  assert.equal(definition.name, world.name, "cold cached deployment identity must be disposable");
  assert.deepEqual(definition.spawn, world.spawn);
  assert.deepEqual(definition.pluginConfig, world.pluginConfig);
  assert.deepEqual(definition.zones, world.zones.map(({ _description, ...zone }) => zone));
  assert.equal(definition.membersWorld, true);
  assert.equal(GameConstants.DEFAULT_LOCATION.getX(), world.spawn.x);
  assert.equal(GameConstants.DEFAULT_LOCATION.getY(), world.spawn.y);
  assert.equal(GameConstants.DEFAULT_LOCATION.getZ(), world.spawn.z);
  assert.equal(GameConstants.EXPERIENCE_MULTIPLIER, world.experienceMultiplier);
  assert.ok(WORLD_ZONE_BOUNDARIES.pvp.length > 0, "cached zone consumers initialized from the same fixture definition");
  // First and only loader initialization runs through actual Server.main.
  bootstrap = await observeBootstrapBoundaries();
  if (conflict) {
    core = PM.getCoreApi();
    backend = GameConstants.PLAYER_PERSISTENCE;
    return;
  }
  assert.deepEqual(bootstrap, { calls: ["game", "network"], exits: [] },
    "setup: valid initial bootstrap reached both explicit downstream boundaries");
  assert.equal(initializationErrors.some((message) => message.includes("ItemDefinitionLoader")), false,
    "setup: ItemDefinitionLoader cold import and registration must not emit an error");
  assert.equal(Array.isArray(PM.loadedPlugins) && PM.loadedPlugins.includes("ItemDefinitionLoader"), true,
    "setup: actual loader registry contains ItemDefinitionLoader");
  core = PM.getCoreApi();
  backend = GameConstants.PLAYER_PERSISTENCE;
  assert.ok(backend instanceof JsonPlayerPersistence, "actual selected backend");
  core.RegionManager.init();
  PM.emitServerStartup({});
  assert.equal(GameConstants.WORLD_PROFILE, profile, "actual plugin init, not manually assigned profile");
});

after(async () => {
  for (const player of actors) {
    if (player.isRegistered()) {
      assert.equal(dispatchClientMessages(player, [{ type: "logout" }]), true, "cleanup logout phase: input accepted");
      await new Promise(setImmediate);
      core.World.process();
      assert.equal(player.isRegistered(), false, "cleanup logout phase: actor removed by ordinary world tick");
    }
  }
  PM.emitServerShutdown({});
  if (backend) await backend.flush();
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(directory, { recursive: true, force: true });
});

async function enter(name, password = PASSWORD) {
  const result = await connectHeadlessClient(name, password);
  assert.ok(result.player, result.error ?? "ordinary headless login must enter");
  actors.add(result.player);
  assert.equal(result.player.getProfile(), profile);
  assert.equal(result.player.isRegistered(), true);
  return result.player;
}

async function logout(player) {
  assert.equal(dispatchClientMessages(player, [{ type: "logout" }]), true);
  await new Promise(setImmediate);
  core.World.process();
  await backend.flush();
  // World delegates to MobileList.search, which returns null when no actor matches.
  const remaining = core.World.getPlayerByName(player.getUsername());
  assert.equal(remaining === null, true,
    `logout phase: actor absent after ordinary input/removal tick (lookup=${remaining === player ? "same actor" : remaining === null ? "null" : typeof remaining}, registered=${player.isRegistered()})`);
  assert.equal(player.isRegistered(), false, "logout phase: actor deregistered");
  actors.delete(player);
}

function protection(player) {
  const request = { player, remainingMilliseconds: null };
  PM.emitCustomEvent("deadman:protection", request);
  return request.remainingMilliseconds;
}

if (!conflict) test("canonical profile init, main credentials, real login, snapshot and offline reload", async (t) => {
  // A main save is seeded, not passed off as an authenticated main login. The main scenario
  // separately exercises that entry through the same real connection path.
  const seed = new Player(null);
  seed.setUsername("DmmSeed");
  seed.setPasswordHashWithSalt(await PasswordUtil.generatePasswordHashWithSalt(PASSWORD));
  seed.getInventory().setItem(0, new core.Item(core.ItemIdentifiers.COINS, 77));
  seed.getSkillManager().setExperiences(core.Skill.COOKING, 1234, false);
  backend.save(seed, "fixture-seed-main");
  await backend.flush();
  const mainPath = backend.resolveFilePath("DmmSeed", "main");
  const mainBytes = fs.readFileSync(mainPath);
  assert.equal(backend.exists("DmmSeed", "deadman"), false);
  assert.equal(backend.exists("DmmSeed", "league"), false);
  assert.equal(backend.exists("DmmSeed", "hardcore"), false);
  const refused = await connectHeadlessClient("DmmSeed", "wrong-fixture-password");
  assert.equal(refused.player === undefined, true, "credential phase: wrong main password refuses selected-profile entry");

  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const player = await enter("DmmSeed");
  const skills = player.getSkillManager();
  if (profile === "deadman") {
    assert.equal(skills.getCombatLevel(), 3);
    assert.equal(skills.getExperience(core.Skill.COOKING), 0);
    assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
    assert.equal(protection(player), 12 * 60 * 60 * 1000);
    const before = skills.getExperience(core.Skill.COOKING);
    skills.addExperience(core.Skill.COOKING, 10, true);
    skills.addExperience(core.Skill.COOKING, 10, false);
    assert.equal(skills.getExperience(core.Skill.COOKING), before, "unqualified XP cannot fall through");
  } else {
    const before = skills.getExperience(core.Skill.COOKING);
    skills.addExperience(core.Skill.COOKING, 10, true);
    assert.ok(skills.getExperience(core.Skill.COOKING) > before, "ordinary supported profile XP remains open");
  }

  t.mock.timers.tick(30_000);
  const first = PlayerSave.fromPlayer(player);
  const second = PlayerSave.fromPlayer(player);
  assert.equal(first.attributes["account-summary:play-time"], 30_000);
  assert.equal(second.attributes["account-summary:play-time"], 30_000, "snapshot must not reset or double count");
  const query = { player, milliseconds: null };
  PM.emitCustomEvent("account:play-time", query);
  assert.equal(query.milliseconds, 30_000);
  backend.save(player, "preparation-snapshot");
  await backend.flush();
  assert.equal(backend.load("DmmSeed", profile).attributes["account-summary:play-time"], 30_000);
  await logout(player);
  if (profile !== "main") assert.deepEqual(fs.readFileSync(mainPath), mainBytes, "other profile never rewrites main belongings");
  t.mock.timers.tick(60 * 60 * 1000);
  const reloaded = await enter("DmmSeed");
  const restoredTime = { player: reloaded, milliseconds: null };
  PM.emitCustomEvent("account:play-time", restoredTime);
  assert.equal(restoredTime.milliseconds, 30_000, "offline interval excluded by actual logout/login");
  if (profile === "deadman") assert.equal(protection(reloaded), 12 * 60 * 60 * 1000 - 30_000);
  await logout(reloaded);
});

if (profile === "deadman" && !conflict) test("ordinary Doomsayer removal input cannot unlock unqualified XP or player combat", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 2_000_000 });
  const player = await enter("DmmChoice");
  const other = await enter("DmmOther");
  const { NpcSpawnDefinitionLoader } = require("../../dist/game/definition/loader/impl/NpcSpawnDefinitionLoader");
  const loader = new NpcSpawnDefinitionLoader();
  assert.equal(loader.load(), true, "setup: canonical spawn data must load");
  core.RegionManager.loadMapFiles(3232, 3223);
  player.moveTo(new core.Location(3232, 3222, 0)); // Seeded approach tile, not natural travel proof.
  NpcSpawnDefinitionLoader.activateNear(player.getLocation());
  const DOOMSAYER_SPAWN_ID = 119; // Actual cache cws_doomsayer and canonical spawn row.
  const npc = [...core.World.getNpcs()].find((entry) => entry.getId() === DOOMSAYER_SPAWN_ID
    && entry.getLocation().getX() === 3232 && entry.getLocation().getY() === 3223);
  assert.ok(npc, "setup: actual pending-region spawn must be registered");
  const actions = npc.getCurrentDefinition(player).getActions();
  const removeIndex = actions.indexOf("Remove-protection");
  assert.ok(removeIndex >= 0, "actual cache morph offers the ordinary shortcut");
  const full = protection(player);

  async function send(actor, packet) {
    assert.equal(dispatchClientMessages(actor, [packet]), true);
    await new Promise(setImmediate);
    core.World.process();
  }
  function inputState(actor) {
    const position = (entity) => {
      const location = entity.getLocation();
      return [location.getX(), location.getY(), location.getZ()];
    };
    const pending = core.MultiChatboxPrompt.getPending(actor);
    return {
      actor: { position: position(actor), registered: actor.isRegistered(), placement: actor.isNeedsPlacement(),
        busy: actor.busy(), interfaceId: actor.getInterfaceId(), mobile: actor.getMovementQueue().getMobility().canMove(),
        actorTask: core.TaskManager.hasActiveTask(actor), indexTask: core.TaskManager.hasActiveTask(actor.getIndex()) },
      npc: { position: position(npc), index: npc.getIndex(), id: npc.getId(), registered: npc.isRegistered(),
        visible: npc.isVisible(), local: actor.getLocalNpcs().includes(npc) },
      dialogue: { active: actor.getDialogueManager().isActive(), group: actor.getPacketSender().getChatboxGroupId(),
        options: pending?.options?.slice(0, 8) ?? null },
    };
  }
  async function remove(actor, option) {
    // A fresh ordinary login opens the designer, then the tutorial-off initial mode choice.
    // Finish both through their actual widget input routes before attempting an NPC action.
    const DESIGNER_INTERFACE = 679;
    const DESIGNER_CONFIRM = 74; // Existing MakeOverMage cache component and native designer precedent.
    const initialLook = [...actor.getAppearance().getLook()];
    const initialProtection = protection(actor);
    if (actor.getInterfaceId() === DESIGNER_INTERFACE) {
      assert.equal(actor.getAppearance().getCanChangeAppearance(), true, "setup: initial designer is active");
      await send(actor, { type: "widget_action", widgetId: (DESIGNER_INTERFACE << 16) | DESIGNER_CONFIRM,
        groupId: DESIGNER_INTERFACE, childId: DESIGNER_CONFIRM, buttonNum: 1, slot: -1, itemId: -1 });
      assert.equal(actor.getAppearance().getCanChangeAppearance(), false, "setup: ordinary Confirm completed the designer");
      assert.notEqual(actor.getInterfaceId(), DESIGNER_INTERFACE, "setup: designer closed through ordinary input");
    }
    const INITIAL_SETUP_PENDING = "ironman:initial-setup-pending";
    if (actor.getAttribute(INITIAL_SETUP_PENDING) === true) {
      const setup = require("../../plugins/modes/data/ironman.json").setup;
      const noneChild = Number(Object.entries(setup.buttons).find(([, mode]) => mode === "none")?.[0]);
      assert.ok(Number.isInteger(noneChild), "setup: canonical initial None component exists");
      assert.equal(actor.getInterfaceId(), setup.interface, "setup: ordinary designer completion offered initial mode choice");
      await send(actor, { type: "widget_action", widgetId: (setup.interface << 16) | noneChild,
        groupId: setup.interface, childId: noneChild, buttonNum: 1, slot: -1, itemId: -1 });
      assert.equal(actor.getAttribute(INITIAL_SETUP_PENDING), false, "setup: ordinary None completed initial onboarding");
      assert.notEqual(actor.getInterfaceId(), setup.interface, "setup: initial choice closed through ordinary input");
    }
    assert.deepEqual(actor.getAppearance().getLook(), initialLook, "setup: confirmation preserves the seeded appearance");
    assert.equal(protection(actor), initialProtection, "setup: onboarding does not remove protection");
    assert.equal(actor.getProfile(), profile, "setup: initial account choice does not change world profile");
    const beforeTick = inputState(actor);
    // moveTo leaves placement pending. Ordinary input is processed before the tick's update reset.
    // Settle the seeded approach with a real world tick before sending the click, including DmmNow.
    core.World.process();
    const afterTick = inputState(actor);
    const setup = JSON.stringify({ beforeTick, afterTick });
    assert.equal(afterTick.actor.registered, true, `setup: NPC actor remains registered ${setup}`);
    assert.equal(afterTick.actor.placement, false, `setup: seeded placement settled before NPC input ${setup}`);
    assert.equal(afterTick.actor.busy, false, `setup: ordinary NPC input is not busy ${setup}`);
    assert.equal(afterTick.actor.mobile, true, `setup: ordinary NPC route is mobile ${setup}`);
    assert.equal(afterTick.npc.registered && afterTick.npc.visible && afterTick.npc.local, true,
      `setup: canonical NPC is registered and ordinarily visible ${setup}`);
    await send(actor, { type: "npc_option", index: npc.getIndex(), clickType: removeIndex + 1 });
    let chosen = false;
    for (let i = 0; i < 60; i++) {
      const pending = core.MultiChatboxPrompt.getPending(actor);
      if (pending) {
        const index = pending.options.findIndex((text) => text === option);
        assert.ok(index >= 0, "ordinary generated option must exist");
        await send(actor, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 });
        chosen = true;
        break;
      }
      const manager = actor.getDialogueManager();
      const group = actor.getPacketSender().getChatboxGroupId();
      const child = { 231: 5, 217: 5, 193: 0, 229: 2 }[group];
      if (manager.isActive() && child !== undefined) {
        await send(actor, { type: "dialogue_continue", widgetId: (group << 16) | child, childIndex: -1 });
      } else core.World.process();
    }
    assert.equal(chosen, true,
      `ordinary menu reached; missing setup is not feature absence ${JSON.stringify({ beforeTick, afterTick, final: inputState(actor) })}`);
    actor.getDialogueManager().reset();
  }

  await remove(player, "On second thoughts, leave it.");
  assert.equal(protection(player), full);
  if (lockRegression) await assertOrdinaryStatSetting(player, true);
  await remove(player, "Yes, arrange for my PvP protection to end in 1 minute.");
  assert.equal(protection(player), 60_000);
  const before = player.getSkillManager().getExperience(core.Skill.COOKING);
  t.mock.timers.tick(60_000);
  assert.equal(protection(player), 0);
  if (lockRegression) await assertOrdinaryStatSetting(player, true);
  player.getSkillManager().addExperience(core.Skill.COOKING, 10, false);
  assert.equal(player.getSkillManager().getExperience(core.Skill.COOKING), before);
  assert.equal(PM.emitCanAttack(player, other), false, "preparation lock remains after expiry (hook boundary only)");
  player.moveTo(new core.Location(3100, 3540, 0));
  other.moveTo(new core.Location(3101, 3540, 0));
  core.World.process();
  assert.equal(core.CombatFactory.canAttackByPolicy(player, other), core.CanAttackResponse.CANT_ATTACK_IN_AREA,
    "canonical area/global policy also refuses; no landed combat or PvP runtime claim");
  const instant = await enter("DmmNow");
  instant.moveTo(new core.Location(3232, 3222, 0));
  await remove(instant, "Yes, remove my PvP protection right now.");
  assert.equal(protection(instant), 0);
  if (lockRegression) await assertOrdinaryStatSetting(instant, true);
  const instantXp = instant.getSkillManager().getExperience(core.Skill.COOKING);
  instant.getSkillManager().addExperiences(core.Skill.COOKING, 10);
  assert.equal(instant.getSkillManager().getExperience(core.Skill.COOKING), instantXp);
  await logout(instant);
  await logout(player);
  await logout(other);
});

if (conflict) test("mixed profiles stop actual bootstrap before explicit game/network boundaries", () => {
  assert.ok(initializationErrors.some((message) => /World already selects .* profile; cannot also select/.test(message)),
    "actual plugin initialization must attempt a competing claim, not a direct setter unit call");
  assert.ok(initializationErrors.some((message) => message.includes("An error occurred while binding the Bootstrap: WorldProfileConflictError:")),
    "intended typed conflict reaches the actual bootstrap catch, not an import/cache setup failure");
  assert.deepEqual(bootstrap, { calls: [], exits: [1] });
  assert.equal(GameConstants.WORLD_PROFILE, "deadman", "first actual sorted plugin claim remains; no rollback is claimed");
  assert.equal(core.World.getPlayerByName("DmmSeed") === null, true, "conflict phase: no actor entered the world");
  for (const other of ["main", "league", "hardcore", "deadman"]) {
    assert.equal(backend.exists("DmmSeed", other), false);
  }
  // Partial registration still retains the existing preparation locks.
  const actor = new Player(null);
  const before = actor.getSkillManager().getExperience(core.Skill.COOKING);
  actor.getSkillManager().addExperience(core.Skill.COOKING, 10, true);
  actor.getSkillManager().addExperience(core.Skill.COOKING, 10, false);
  assert.equal(actor.getSkillManager().getExperience(core.Skill.COOKING), before);
  assert.equal(PM.emitCanAttack(actor, new Player(null)), false);
});

if (conflict) for (const kind of ["hardcore", "league", "both"]) {
  test(`actual Server CLI refuses Deadman plus ${kind} registrations`, () => {
    // Real cold CLI, loader, mode registrations and cache. Only disposable config changes.
    const worldPath = path.join(directory, "data", "definitions", "world.json");
    const originalWorld = fs.readFileSync(worldPath);
    const childWorld = JSON.parse(originalWorld);
    childWorld.pluginConfig["HardcoreWorld:enabled"] = kind !== "league";
    childWorld.pluginConfig["league:type"] = kind !== "hardcore" ? 4 : 0;
    let result;
    try {
      fs.writeFileSync(worldPath, JSON.stringify(childWorld));
      result = spawnSync(process.execPath, [path.join(SERVER, "dist", "Server.js"), "1", "--disablePlayerBots"], {
        cwd: directory, env: { ...process.env }, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024,
      });
    } finally { fs.writeFileSync(worldPath, originalWorld); }
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    assert.equal(result.error, undefined, output);
    assert.equal(result.signal, null, output);
    assert.equal(result.status, 1, output);
    assert.match(output, /\[cache\] active .*revision/);
    const second = kind === "league" ? "league" : "hardcore";
    assert.ok(output.includes(`An error occurred while binding the Bootstrap: WorldProfileConflictError: World already selects the deadman profile; cannot also select ${second}`), output);
    assert.doesNotMatch(output, /\[server\] initializing in|\[network\] client websocket listening/);
    console.log(JSON.stringify({ stage: "mixed-world-cli-refusal", competing: kind, status: result.status,
      signal: result.signal, stdout: result.stdout, stderr: result.stderr }));
  });
}

if (!conflict) test("valid profile reaches explicit bootstrap game/network stubs", async () => {
  assert.deepEqual(bootstrap, { calls: ["game", "network"], exits: [] },
    "positive boundary wiring only; ordinary entry is exercised separately above");
  assert.equal(GameConstants.WORLD_PROFILE, profile);
});

// Retained actual032 assertions; this mixed fixture combination is not yet runtime qualified.
async function sendLockInput(actor, packet) {
  assert.equal(dispatchClientMessages(actor, [packet]), true, "ordinary lock-regression input accepted");
  await new Promise(setImmediate);
  core.World.process();
}

async function finishLockOnboarding(actor) {
    // A fresh ordinary login opens the designer, then the tutorial-off initial mode choice.
    // Finish both through their actual widget input routes before attempting an NPC action.
    const DESIGNER_INTERFACE = 679;
    const DESIGNER_CONFIRM = 74; // Existing MakeOverMage cache component and native designer precedent.
    const initialLook = [...actor.getAppearance().getLook()];
    const initialProtection = protection(actor);
    if (actor.getInterfaceId() === DESIGNER_INTERFACE) {
      assert.equal(actor.getAppearance().getCanChangeAppearance(), true, "setup: initial designer is active");
      await sendLockInput(actor, { type: "widget_action", widgetId: (DESIGNER_INTERFACE << 16) | DESIGNER_CONFIRM,
        groupId: DESIGNER_INTERFACE, childId: DESIGNER_CONFIRM, buttonNum: 1, slot: -1, itemId: -1 });
      assert.equal(actor.getAppearance().getCanChangeAppearance(), false, "setup: ordinary Confirm completed the designer");
      assert.notEqual(actor.getInterfaceId(), DESIGNER_INTERFACE, "setup: designer closed through ordinary input");
    }
    const INITIAL_SETUP_PENDING = "ironman:initial-setup-pending";
    if (actor.getAttribute(INITIAL_SETUP_PENDING) === true) {
      const setup = require("../../plugins/modes/data/ironman.json").setup;
      const noneChild = Number(Object.entries(setup.buttons).find(([, mode]) => mode === "none")?.[0]);
      assert.ok(Number.isInteger(noneChild), "setup: canonical initial None component exists");
      assert.equal(actor.getInterfaceId(), setup.interface, "setup: ordinary designer completion offered initial mode choice");
      await sendLockInput(actor, { type: "widget_action", widgetId: (setup.interface << 16) | noneChild,
        groupId: setup.interface, childId: noneChild, buttonNum: 1, slot: -1, itemId: -1 });
      assert.equal(actor.getAttribute(INITIAL_SETUP_PENDING), false, "setup: ordinary None completed initial onboarding");
      assert.notEqual(actor.getInterfaceId(), setup.interface, "setup: initial choice closed through ordinary input");
    }
    assert.deepEqual(actor.getAppearance().getLook(), initialLook, "setup: confirmation preserves the seeded appearance");
    assert.equal(protection(actor), initialProtection, "setup: onboarding does not remove protection");
    assert.equal(actor.getProfile(), profile, "setup: initial account choice does not change world profile");
}

function skillState(actor) {
  return JSON.parse(JSON.stringify({ skills: actor.getSkillManager().getSkills(), combat: actor.getSkillManager().getCombatLevel() }));
}

async function assertOrdinaryStatSetting(actor, blocked) {
  const Presets = require("../../plugins/modes/pvp/Presets.PvpMode");
  assert.equal(Presets.isEnabled(), true, "setup: PvpMode stat-setting route enabled");
  assert.equal(actor.busy(), false, "setup: onboarding/dialogue finished");
  assert.equal(core.Wilderness.isIn(actor), false, "setup: outside Wilderness");
  assert.equal(actor.getEquipment().getItems().some(item => (item?.getId?.() ?? 0) > 0), false, "setup: unarmed");
  const before = skillState(actor);
  await sendLockInput(actor, { type: "widget_action", widgetId: (320 << 16) | 1, groupId: 320, childId: 1, buttonNum: 2, slot: -1, itemId: -1 });
  assert.ok(actor.getEnteredAmountAction(), "real guide operation installed an amount callback");
  await sendLockInput(actor, { type: "dialogue_amount", amount: 99 });
  assert.equal(actor.getEnteredAmountAction(), null, "ordinary amount dispatch consumed callback");
  if (blocked) assert.deepEqual(skillState(actor), before, "preparation locks ordinary stat-setting current/max/XP/combat");
  else {
    assert.equal(actor.getSkillManager().getExperience(core.Skill.ATTACK), core.SkillManager.getExperienceForLevel(99));
    assert.equal(actor.getSkillManager().getMaxLevel(core.Skill.ATTACK), 99);
    assert.notEqual(actor.getSkillManager().getCombatLevel(), before.combat, "positive actual setter reached");
  }
}

if (lockRegression) test("ordinary PvpMode stat and preset routes preserve preparation lock and logout restoration", async (t) => {
  // Keep the existing online-play clock fixed across ordinary awaited onboarding inputs.
  t.mock.timers.enable({ apis: ["Date"], now: 3_000_000 });
  const actor = await enter("DmmLock");
  await finishLockOnboarding(actor);
  await assertOrdinaryStatSetting(actor, profile === "deadman");
  const Presets = require("../../plugins/modes/pvp/Presets.PvpMode");
  const { GROUP_ID, COMPONENT, uid } = require("../../plugins/modes/pvp/PresetsWidget.PvpMode");
  const selected = Presets.getGlobalPresetPool()[0];
  assert.ok(selected, "setup: canonical selected global preset exists");
  const snapshot = () => JSON.parse(JSON.stringify({ skills: skillState(actor), inventory: actor.getInventory().getItems(),
    equipment: actor.getEquipment().getItems(), banks: actor.getBanks().map(bank => bank?.getItems() ?? null) }));
  if (profile === "deadman") {
    await sendLockInput(actor, { type: "chat", messageType: "public", text: "::presets" });
    assert.notEqual(actor.getInterfaceId(), GROUP_ID, "ordinary preset opening refused");
    // Explicit stale UI checkpoint only: simulate an already-open selected preset.
    // Do not bypass applyPreset's policy; native Load must refuse before any mutation.
    const previousInterface = actor.getInterfaceId();
    actor.setInterfaceId(GROUP_ID);
    actor.setAttribute("pvp:current-preset", selected);
    const before = snapshot();
    await sendLockInput(actor, { type: "widget_action", widgetId: uid(COMPONENT.LOAD_BUTTON), groupId: GROUP_ID,
      childId: COMPONENT.LOAD_BUTTON, buttonNum: 1, slot: -1, itemId: -1 });
    assert.deepEqual(snapshot(), before, "actual stale Load leaves bank/gear/inventory/all skills untouched");
    actor.setInterfaceId(previousInterface);
    actor.setAttribute("pvp:current-preset", null);
  } else {
    await sendLockInput(actor, { type: "chat", messageType: "public", text: "::presets" });
    assert.equal(actor.getInterfaceId(), GROUP_ID, "positive: ordinary main preset opening works");
    // Supplied simple preset selection, using the existing Presetable fixture pattern.
    // This qualifies native Load/apply, not natural selection or eligibility of every shipped kit.
    const { Presetable } = require("../../dist/game/content/presets/Presetable");
    const positive = new Presetable("lock-positive", [new core.Item(core.ItemIdentifiers.SHARK, 1)], [],
      [50, 1, 99, 85, 99, 1, 1], core.MagicSpellbook.NORMAL, true);
    actor.setAttribute("pvp:current-preset", positive);
    await sendLockInput(actor, { type: "widget_action", widgetId: uid(COMPONENT.LOAD_BUTTON), groupId: GROUP_ID,
      childId: COMPONENT.LOAD_BUTTON, buttonNum: 1, slot: -1, itemId: -1 });
    assert.equal(actor.getSkillManager().getMaxLevel(core.Skill.STRENGTH), 99, "positive: main native Load reached stat writes");
    assert.equal(actor.getInventory().getAmount(core.ItemIdentifiers.SHARK), 1, "positive: supplied preset reached inventory writes");
    assert.equal(actor.getProfile(), profile);
  }
  const skillsBeforeLogout = skillState(actor);
  await logout(actor);
  const stored = backend.load("DmmLock", profile);
  assert.deepEqual(JSON.parse(JSON.stringify(stored.skills)), skillsBeforeLogout.skills, "actual JSON logout retains exact skill state");
  const reloaded = await enter("DmmLock");
  assert.deepEqual(skillState(reloaded), skillsBeforeLogout, "actual saved skills restore without low-level setter blocking");
  await logout(reloaded);
  // A preexisting nonzero Deadman save must also restore: source seed, not gameplay gain.
  if (profile === "deadman") {
    const seed = new Player(null);
    seed.setUsername("DmmRestore"); seed.setProfile(profile);
    seed.setPasswordHashWithSalt(await PasswordUtil.generatePasswordHashWithSalt(PASSWORD));
    seed.getSkillManager().setCurrentLevels(core.Skill.ATTACK, 20, false).setMaxLevels(core.Skill.ATTACK, 20, false)
      .setExperiences(core.Skill.ATTACK, core.SkillManager.getExperienceForLevel(20), false);
    backend.save(seed, "fixture-existing-profile"); await backend.flush();
    const restored = await enter("DmmRestore");
    assert.equal(restored.getSkillManager().getExperience(core.Skill.ATTACK), core.SkillManager.getExperienceForLevel(20));
    assert.equal(restored.getSkillManager().getMaxLevel(core.Skill.ATTACK), 20);
    await logout(restored);
  }
});
