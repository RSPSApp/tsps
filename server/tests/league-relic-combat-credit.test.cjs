// Damage a Demonic Pacts relic deals outside an attack is credited to its owner through the real
// hit queue, so a kill is theirs (loot, kill count, tasks): Flask of Fervour's explosions.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { GameConstants } = require("../dist/game/GameConstants");

let core;
let next = 2100;
const AT = [1666, 3136, 0];
const FLASK_OF_FERVOUR = { 7: 3 };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  GameConstants.setWorldProfile("league");
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function pactsCharacter(t, relics) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername(`credit${next}`);
  player.setProfile("league");
  player.setRegistered(true);
  player.setLocation(new core.Location(...AT));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  PM.emitPlayerLogin({ player, username: player.getUsername(), isNewAccount: true, profile: "league" });
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  player.setAttribute("league:tutorial-stage", 14);
  player.setAttribute("league:relics", relics);
  player.moveTo(new core.Location(...AT));
  player.needsPlacement = false;
  player.getInventory().resetItems();
  player.getPacketSender().sendInterfaceRemoval();
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return { player, connection };
}

test("Flask of Fervour: an explosion's kill of an untouched NPC is the flask owner's", async (t) => {
  const f = pactsCharacter(t, FLASK_OF_FERVOUR);
  f.player.getSkillManager().setMaxLevel(core.Skill.PRAYER, 99);
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  const id = [...Array(20000).keys()].find((each) => {
    const npc = core.CacheDefinitions.getNpc(each);
    return npc?.name === "Chicken" && (npc.actions ?? []).includes("Attack");
  });
  const chicken = core.NPC.create(id, new core.Location(AT[0] + 1, AT[1], 0));
  core.World.getNpcs().add(chicken);
  t.after(() => core.World.getNpcs().remove(chicken));
  f.player.getLocalNpcs = () => [chicken];
  const flask = core.ItemIdentifiers.FLASK_OF_FERVOUR;
  f.player.getInventory().add(new core.Item(flask), true);
  await f.connection.dispatch([{ type: "inventory_action", widgetId: 149 << 16, slot: 0, itemId: flask, option: "Activate", optionIndex: 1 }]);
  f.connection.processTurnPackets();
  let killer = null;
  for (let tick = 0; tick < 8 && !killer; tick++) {
    core.TaskManager.process();
    for (const npc of core.World.getNpcs()) npc?.getCombat?.().getHitQueue?.().process?.(npc);
    if (chicken.getHitpoints() <= 0) killer = chicken.getCombat().getKiller(false);
  }
  assert.equal(chicken.getHitpoints(), 0, "the explosion kills the chicken");
  assert.equal(killer, f.player, "its killer is the flask's owner");
});
