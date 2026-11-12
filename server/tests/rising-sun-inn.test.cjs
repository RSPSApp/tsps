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

test("native Talk-to reaches Emily from the public side, not through the west wall", async (t) => {
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

  const players = [];
  const createPlayer = (x, y) => {
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const player = new Player(new PlayerSession(channel));
    player.setIndex(nextPlayer++);
    player.setUsername(`rising${nextPlayer}`);
    player.setRegistered(true);
    player.setAttribute("bot-skip-persistence", true);
    player.setLocation(new core.Location(x, y, 0));
    player.needsPlacement = false;
    const connection = new ClientConnection(channel);
    connection.player = player;
    player.getSession().setPlayer(player);
    player.getSession().setTurnPacketProcessor(() => connection.processTurnPackets());
    players.push({ player, connection });
    return { player, connection };
  };
  t.after(() => {
    for (const { player } of players) {
      PM.emitPlayerLogout({ player, username: player.getUsername() });
      core.TaskManager.cancelTasks(player);
      core.TaskManager.cancelTasks(player.getIndex());
    }
    PM.emitServerShutdown({});
  });

  const tick = ({ player, connection }) => {
    core.TaskManager.processWalkTo(player.getIndex());
    player.getMovementQueue().process();
    core.TaskManager.process();
    connection.processTurnPackets();
  };
  const clickTalk = async ({ player, connection }) => {
    const actions = emily.getCurrentDefinition(player).getActions();
    await connection.dispatch([{ type: "npc_option", index: emily.getIndex(), clickType: actions.indexOf("Talk-to") + 1 }]);
  };

  const inside = createPlayer(2955, 3373);
  await clickTalk(inside);
  for (let i = 0; i < 20 && !inside.player.getDialogueManager().isActive(); i++) tick(inside);

  assert.equal(inside.player.getDialogueManager().isActive(), true, "the native option starts dialogue from the public side of the counter");
  assert.equal(inside.player.getDialogueManager().getCurrent().getNpcId(), 1315);
  assert.equal(inside.player.getDialogueManager().getCurrent().getText(), "Heya! What can I get you?");
  assert.deepEqual([inside.player.getLocation().getX(), inside.player.getLocation().getY()], [2955, 3373], "the counter-side click does not cross the bar");

  const outside = createPlayer(2952, 3373);
  await clickTalk(outside);
  for (let i = 0; i < 20 && !outside.player.getDialogueManager().isActive(); i++) tick(outside);
  assert.equal(outside.player.getDialogueManager().isActive(), false, "the native option cannot start Emily's dialogue through the west wall");
  assert.ok(outside.player.getLocation().getX() < 2955, "outside movement stays on the wall side");

  // Emily's cache wander radius is 2. Move the frozen stock NPC to an edge tile and
  // send real native clicks from each side; the route guard uses her current location.
  emily.setLocation(new core.Location(2956, 3375, 0));
  const insideWanderEdge = createPlayer(2955, 3373);
  await clickTalk(insideWanderEdge);
  for (let i = 0; i < 20 && !insideWanderEdge.player.getDialogueManager().isActive(); i++) tick(insideWanderEdge);
  assert.equal(insideWanderEdge.player.getDialogueManager().isActive(), true, "the public side can talk to Emily at her wander edge");

  const outsideWanderEdge = createPlayer(2952, 3373);
  await clickTalk(outsideWanderEdge);
  tick(outsideWanderEdge);
  assert.equal(outsideWanderEdge.player.getDialogueManager().isActive(), false, "Emily's wandered edge does not start dialogue through the wall");
  assert.ok(outsideWanderEdge.player.getLocation().getX() < 2955, "the wandering-edge refusal stays outside");
});

test("Emily can be talked to across the Rising Sun Inn bar only", () => {
  let route;
  plugin.register({ onNpcRoute(handler) { route = handler; } });

  const request = (playerX, x, y) => ({
    player: { getLocation: () => ({ getX: () => playerX, getZ: () => 0 }) },
    npcId: 1315, clickType: 1, location: { x, y, z: 0 }, range: 1, ignoreProjectileClip: false,
  });
  for (const x of [2952, 2956]) for (const y of [3371, 3375]) {
    const inside = request(2955, x, y);
    route(inside);
    assert.equal(inside.range, 2, `inside talk reaches Emily at wander edge ${x},${y}`);
    assert.equal(inside.ignoreProjectileClip, true);

    const outside = request(2952, x, y);
    route(outside);
    assert.equal(outside.range, 1, `west wall does not widen talk at wander edge ${x},${y}`);
    assert.equal(outside.ignoreProjectileClip, false);
  }

  const emilyOtherOption = request(2955, 2954, 3373);
  emilyOtherOption.clickType = 2;
  route(emilyOtherOption);
  assert.equal(emilyOtherOption.range, 1);
  assert.equal(emilyOtherOption.ignoreProjectileClip, false);

  const otherNpc = request(2955, 2954, 3373);
  otherNpc.npcId = 1316;
  route(otherNpc);
  assert.equal(otherNpc.range, 1);
  assert.equal(otherNpc.ignoreProjectileClip, false);
});
