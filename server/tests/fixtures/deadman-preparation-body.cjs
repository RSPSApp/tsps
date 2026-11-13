// SOURCE PREPARATION ONLY — NOT A CAUSAL BASELINE OR A USABLE MODE.
// The preceding af74 fixture failed native preparation003; these corrections are unexecuted.
// Each profile case needs its own ordinary native process because world selection is process-wide.
// This file is a proposed extension of the existing compiled/cache/login/save fixture route.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { before, after, test } = require("node:test");

const SERVER = path.resolve(__dirname, "../..");
const ORIGINAL_CWD = process.cwd();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deadman-preparation-"));
const scenario = process.env.DMM_PREPARATION_FIXTURE_PROFILE;
assert.ok(["main", "league", "hardcore", "deadman", "conflict"].includes(scenario), "valid fixture scenario, not a feature-absence assertion");
const conflict = scenario === "conflict";
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
  fs.symlinkSync(path.join(SERVER, "data", entry), path.join(directory, "data", entry));
}
for (const entry of fs.readdirSync(path.join(SERVER, "data", "definitions"))) {
  if (entry === "world.json" || entry === "world.local.json") continue;
  fs.symlinkSync(path.join(SERVER, "data", "definitions", entry), path.join(directory, "data", "definitions", entry));
}
const world = JSON.parse(fs.readFileSync(path.join(SERVER, "data", "definitions", "world.json"), "utf8"));
world.name = `Disposable preparation fixture: ${scenario}`;
delete world.disabledPlugins;
world.plugins = { ...world.plugins, JsonPlayerPersistence: true, SqlitePlayerPersistence: false, PlayerBots: false, TutorialIsland: false };
world.pluginConfig = { ...world.pluginConfig, "DeadmanMode:enabled": profile === "deadman",
  "league:type": profile === "league" ? 4 : 0, "HardcoreWorld:enabled": profile === "hardcore" || conflict };
fs.writeFileSync(path.join(directory, "data", "definitions", "world.json"), JSON.stringify(world));
// Eager plugins also resolve compiled modules from deployment CWD before Server's
// resolver can be installed. Bind the real code root without changing world data.
fs.symlinkSync(path.join(SERVER, "dist"), path.join(directory, "dist"));

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
// The existing resolver still captures the actual source/dist/plugin roots. No core import
// is performed while changing CWD for this already-imported method call.
process.chdir(SERVER);
Server.installProductionPathResolver();
process.chdir(directory);
const { CachePipeline } = require("../../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../../dist/plugins/PluginManager");
const { Player } = require("../../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../../dist/game/entity/impl/player/persistence/PlayerSave");
const { GameConstants } = require("../../dist/game/GameConstants");
const { getWorldDefinition, WORLD_ZONE_BOUNDARIES } = require("../../dist/game/definition/WorldDefinition");
const { connectHeadlessClient, dispatchClientMessages } = require("../../dist/net/NetworkBuilder");
const { PasswordUtil } = require("../../dist/util/PasswordUtil");
const { JsonPlayerPersistence } = require("../../plugins/persistence/JsonPlayerPersistence.plugin");
let core;
let backend;
const actors = new Set();
const PASSWORD = "fixture-only-password";

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
  await CachePipeline.initialize(SERVER);
  console.error = recordInitializationError;
  try { PM.loadFromDirectory(path.join(SERVER, "plugins")); }
  finally { console.error = originalError; }
  assert.equal(initializationErrors.some((message) => message.includes("ItemDefinitionLoader")), false,
    "setup: ItemDefinitionLoader cold import and registration must not emit an error");
  assert.equal(Array.isArray(PM.loadedPlugins) && PM.loadedPlugins.includes("ItemDefinitionLoader"), true,
    "setup: actual loader registry contains ItemDefinitionLoader");
  core = PM.getCoreApi();
  backend = GameConstants.PLAYER_PERSISTENCE;
  assert.ok(backend instanceof JsonPlayerPersistence, "actual selected backend");
  // An invalid mixed configuration is NOT allowed into any ordinary-entry fixture below.
  // The actual loader catches setter errors and continues: this case documents that limit.
  if (conflict) return;
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
  assert.equal(core.World.getPlayerByName(player.getUsername()) === undefined, true,
    "logout phase: actor absent from world after ordinary input delivery and removal tick");
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
  async function remove(actor, option) {
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
    assert.equal(chosen, true, "ordinary menu reached; missing setup is not feature absence");
    actor.getDialogueManager().reset();
  }

  await remove(player, "On second thoughts, leave it.");
  assert.equal(protection(player), full);
  await remove(player, "Yes, arrange for my PvP protection to end in 1 minute.");
  assert.equal(protection(player), 60_000);
  const before = player.getSkillManager().getExperience(core.Skill.COOKING);
  t.mock.timers.tick(60_000);
  assert.equal(protection(player), 0);
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
  const instantXp = instant.getSkillManager().getExperience(core.Skill.COOKING);
  instant.getSkillManager().addExperiences(core.Skill.COOKING, 10);
  assert.equal(instant.getSkillManager().getExperience(core.Skill.COOKING), instantXp);
  await logout(instant);
  await logout(player);
  await logout(other);
});

if (conflict) test("actual loader catches a competing profile claim; deployment rejection remains unfinished", () => {
  assert.ok(initializationErrors.some((message) => /World already selects .* profile; cannot also select/.test(message)),
    "actual plugin initialization must attempt a competing claim, not a direct setter unit call");
  assert.ok(["deadman", "hardcore"].includes(GameConstants.WORLD_PROFILE), "one claim remains; no coherent refusal is claimed");
  assert.equal(core.World.getPlayerByName("DmmSeed"), undefined);
  for (const other of ["main", "league", "hardcore", "deadman"]) {
    assert.equal(backend.exists("DmmSeed", other), false);
  }
  // Observe readiness locks only. No login/handshake/startup or feature-absence target is attempted.
  const actor = new Player(null);
  const before = actor.getSkillManager().getExperience(core.Skill.COOKING);
  actor.getSkillManager().addExperience(core.Skill.COOKING, 10, true);
  actor.getSkillManager().addExperience(core.Skill.COOKING, 10, false);
  assert.equal(actor.getSkillManager().getExperience(core.Skill.COOKING), before);
  assert.equal(PM.emitCanAttack(actor, new Player(null)), false);
});
