const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const plugin = require("../plugins/npcs/RisingSunInn.plugin.js");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core;
let emily;
let nextPlayer = 9500;

test("native Talk-to reaches the frozen stock Emily from the public side of her bar", async (t) => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2951, 3373);
  PM.emitServerStartup({});
  emily = [...core.World.getNpcs()].find((npc) => npc && npc.getId() === 1315
    && npc.getSpawnPosition?.()?.getX() === 2954 && npc.getSpawnPosition?.()?.getY() === 3373)
    ?? PM.spawnNpc({ id: 1315, x: 2954, y: 3373, z: 0, wanderRadius: 0 });
  assert.ok(emily, "the stock Emily definition is spawned at the canonical tile");
  emily.setScriptedMovement(true);

  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextPlayer++);
  player.setUsername(`rising${nextPlayer}`);
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(2951, 3373, 0));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  player.getSession().setPlayer(player);
  player.getSession().setTurnPacketProcessor(() => connection.processTurnPackets());
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player);
    core.TaskManager.cancelTasks(player.getIndex());
    PM.emitServerShutdown({});
  });

  const tick = () => {
    core.TaskManager.processWalkTo(player.getIndex());
    player.getMovementQueue().process();
    core.TaskManager.process();
    connection.processTurnPackets();
  };
  const actions = emily.getCurrentDefinition(player).getActions();
  await connection.dispatch([{ type: "npc_option", index: emily.getIndex(), clickType: actions.indexOf("Talk-to") + 1 }]);
  for (let i = 0; i < 20 && !player.getDialogueManager().isActive(); i++) tick();

  assert.equal(player.getDialogueManager().isActive(), true, "the native NPC option starts dialogue");
  assert.equal(player.getDialogueManager().getCurrent().getNpcId(), 1315);
  assert.equal(player.getDialogueManager().getCurrent().getText(), "Heya! What can I get you?");
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2955, 3375]);
});

test("Emily can be talked to across the Rising Sun Inn bar only", () => {
  let route;
  plugin.register({ onNpcRoute(handler) { route = handler; } });

  const emilyTalk = { npcId: 1315, clickType: 1, range: 1, ignoreProjectileClip: false };
  route(emilyTalk);
  assert.equal(emilyTalk.range, 2);
  assert.equal(emilyTalk.ignoreProjectileClip, true);

  const emilyOtherOption = { npcId: 1315, clickType: 2, range: 1, ignoreProjectileClip: false };
  route(emilyOtherOption);
  assert.equal(emilyOtherOption.range, 1);
  assert.equal(emilyOtherOption.ignoreProjectileClip, false);

  const otherNpc = { npcId: 1316, clickType: 1, range: 1, ignoreProjectileClip: false };
  route(otherNpc);
  assert.equal(otherNpc.range, 1);
  assert.equal(otherNpc.ignoreProjectileClip, false);
});
