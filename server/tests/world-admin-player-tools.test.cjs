// Run after `yarn build`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { toolAction, playerTools, toolRoutes } = require("../plugins/tools/worldadmin/PlayerTools.WorldAdmin");

let core, Skill, SkillManager, I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  ({ Skill, SkillManager, ItemIdentifiers: I } = core);
});

test("WorldAdmin player tools use real item containers and persist levels, XP and teleports in isolated JSON saves", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "world-admin-native-"));
  const plugin = require("../plugins/persistence/JsonPlayerPersistence.plugin");
  const originalDirectory = plugin.JsonPlayerPersistence.SAVE_DIRECTORY;
  const originalPersistence = core.GameConstants.PLAYER_PERSISTENCE;
  plugin.JsonPlayerPersistence.SAVE_DIRECTORY = directory;
  let persistence;
  plugin.register({ getSkillManager: () => SkillManager, setPlayerPersistence: value => { persistence = value; }, log() {} });
  core.GameConstants.PLAYER_PERSISTENCE = persistence;
  t.after(async () => {
    await persistence.flush();
    core.GameConstants.PLAYER_PERSISTENCE = originalPersistence;
    plugin.JsonPlayerPersistence.SAVE_DIRECTORY = originalDirectory;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const player = new Player(null).setUsername("Panel Fixture");
  player.isRegistered = () => true;
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  const originalPlayers = core.World.players;
  core.World.players = { [Symbol.iterator]: function* () { yield player; } };
  t.after(() => { core.World.players = originalPlayers; });
  const api = { core, emitCustomEvent() {} };
  await toolAction(api, player, { action: "skill", skill: "Attack", level: 60 });
  await toolAction(api, player, { action: "give", itemId: I.BRONZE_ARROW, quantity: 10 });
  const partial = await toolAction(api, player, { action: "give", itemId: I.BRONZE_SCIMITAR, quantity: 100 });
  assert.match(partial.message, /Only 27 of 100 fit/);
  assert.equal(player.getInventory().getAmount(I.BRONZE_ARROW), 10);
  assert.equal(player.getInventory().getAmount(I.BRONZE_SCIMITAR), 27);
  await toolAction(api, player, { action: "teleport", destination: "varrock teleport" });
  assert.equal(player.getLocation().getX(), 3213);
  assert.equal(player.getLocation().getY(), 3424);
  player.getSkillManager().setCurrentLevels(Skill.ATTACK, 20);
  player.setRunEnergy(15);
  await toolAction(api, player, { action: "restore" });
  assert.equal(player.getSkillManager().getCurrentLevel(Skill.ATTACK), 60);
  assert.equal(player.getRunEnergy(), 100);
  const saved = persistence.load(player.getUsername(), player.getProfile());
  assert.equal(saved.getSkills().maxLevel[Skill.ATTACK.getIndex()], 60);
  assert.equal(saved.getSkills().experience[Skill.ATTACK.getIndex()], SkillManager.getExperienceForLevel(60));
  assert.equal(saved.getPosition().getX(), 3213);
  const preview = playerTools(api, player);
  assert.equal(preview.skills.find(skill => skill.name === "Attack").current, 60);
  assert.ok(preview.skills.some(skill => skill.name === "Sailing"));
  let search;
  toolRoutes({ method: "GET" }, {
    writeHead() {}, end(json) { search = JSON.parse(json); },
  }, new URL("http://localhost/api/players/items?q=Bronze%20arrow"), api);
  assert.ok(search.items.some(item => item.id === I.BRONZE_ARROW && item.name === "Bronze arrow"));
});
