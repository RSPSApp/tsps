// Run after `yarn build`: node --test tests/corsair-curse-stairs-native.test.cjs
// Ithoi's stairs in Corsair Cove (#2410): the map has loc 31735 (ds2_corsair_cove_stairs_ramp, one
// "Climb" option) at 2531,2833 on the ground and at 2529,2834 on the floor above. Each only goes
// one way, so a click must climb that way and never ask "Which way would you like to climb?".
// Real object_option packets through the real Ladders plugin and the real map.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const core = PluginManager.getCoreApi();

const STAIRS = 31735;
const BOTTOM = { x: 2531, y: 2833, z: 0, rotation: 1 }, TOP = { x: 2529, y: 2834, z: 1, rotation: 0 };
let nextIndex = 1950;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2529, 2837);
  require("../plugins/objects/Ladders.plugin").register(PluginManager.createApi("LaddersStairsNativeTest"));
  // The quest plugin owns the click on its own stairs, as it does for the vine ladder (ladders:climb).
  require("../plugins/quests/quests/CorsairCurse.Quest")(PluginManager.createApi("CorsairStairsNativeTest"));
});

/**
 * A walkable tile the stairs can be used from (their access mask and rotation, the reach check object clicks
 * use), so the click needs no walk and cannot stall on the wrong side of a wall or ramp.
 */
function standingTile(stairs) {
  const ClimbLinks = require("../plugins/objects/ClimbLinks");
  const stand = { getId: () => STAIRS, getLocation: () => new core.Location(stairs.x, stairs.y, stairs.z), getFace: () => stairs.rotation, getType: () => 10 };
  const tile = ClimbLinks.landingTile(stand, { x: stairs.x, y: stairs.y }, null);
  assert.ok(tile, `a tile next to the stairs at ${stairs.x},${stairs.y},${stairs.z} can reach them`);
  return tile;
}

async function climb(t, stairs) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++); player.setUsername(`stairs${nextIndex}`); player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(standingTile(stairs));
  const connection = new ClientConnection(channel); connection.player = player;
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); });
  const tick = () => {
    core.World.processCycle++;
    core.TaskManager.process();
    connection.processTurnPackets();
    player.getMovementQueue().process(); core.TaskManager.processWalkTo(player.getIndex());
    player.getSession().flushClient(core.World.processCycle);
    player.resetUpdating();
  };
  await connection.dispatch([{ type: "object_option", id: STAIRS, x: stairs.x, y: stairs.y, clickType: 1 }]);
  let asked = null;
  for (let i = 0; i < 25; i++) {
    tick();
    const pending = MultiChatboxPrompt.getPending(player);
    if (pending) asked ??= JSON.stringify(pending.options);
  }
  return { player, asked, at: [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()] };
}

const inHut = ([x, y]) => x >= 2524 && x <= 2535 && y >= 2829 && y <= 2845;

test("the ground-floor stairs climb up without asking which way", async (t) => {
  const result = await climb(t, BOTTOM);
  assert.equal(result.asked, null, "a one-way staircase never offers up or down");
  assert.equal(result.at[2], 1, `the player is on the floor above, at ${result.at}`);
  assert.ok(inHut(result.at), `and inside Ithoi's hut, at ${result.at}`);
});

test("the upper-floor stairs climb down without asking which way", async (t) => {
  const result = await climb(t, TOP);
  assert.equal(result.asked, null, "a one-way staircase never offers up or down");
  assert.equal(result.at[2], 0, `the player is on the ground floor, at ${result.at}`);
  assert.ok(inHut(result.at), `and next to the hut, at ${result.at}`);
});
