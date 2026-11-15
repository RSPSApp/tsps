// Run after `yarn build`: node --test tests/vineyard-foreman-barrel.test.cjs
//
// Issue #5743: the Vineyard foreman's transcript offers the grape barrel, but no plugin answered
// its message steps, so the barrel was never added. Real cache, every plugin loaded, a real Player
// and the foreman's own spawn; Talk-to is dispatched natively and the option is picked from the
// real multi-chatbox prompt.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");

const FOREMAN = 13908;
const BARREL = 30037;
const AT = [1370, 2915, 0];
let core, foreman, next = 9900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
  foreman = [...core.World.getNpcs()].find((npc) => npc && npc.getId() === FOREMAN)
    ?? PM.spawnNpc({ id: FOREMAN, x: AT[0], y: AT[1], z: 0, wanderRadius: 0 });
});
after(() => PM.emitServerShutdown({}));

function player(freeSlots = 28) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("vineyard" + next); p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  const at = foreman.getLocation();
  p.setLocation(new core.Location(at.getX() + 1, at.getY(), 0)); p.needsPlacement = false;
  if (freeSlots < 28) p.getInventory().adds(core.ItemIdentifiers.BONES, 28 - freeSlots);
  return p;
}

function tick(p, connection) {
  core.TaskManager.processWalkTo(p.getIndex()); p.getMovementQueue().process(); core.TaskManager.process(); connection.processTurnPackets();
}

/** Advances the open line dialogue until the multi-chatbox prompt appears. */
function promptFor(p) {
  for (let i = 0; i < 20; i++) {
    const pending = MultiChatboxPrompt.getPending(p);
    if (pending) return pending;
    const current = p.getDialogueManager().getCurrent?.();
    if (!current) return null;
    p.getDialogueManager().advance();
    for (let t = 0; t < 2; t++) core.TaskManager.process();
  }
  return MultiChatboxPrompt.getPending(p);
}

async function talk(p) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const connection = new ClientConnection(channel); connection.player = p;
  const op = foreman.getCurrentDefinition(p).getActions().findIndex((action) => action === "Talk-to") + 1;
  assert.ok(op > 0, "the foreman has a Talk-to option");
  await connection.dispatch([{ type: "npc_option", index: foreman.getIndex(), clickType: op }]);
  for (let i = 0; i < 6; i++) tick(p, connection);
  return connection;
}

/** Ends the open branch after an option was picked, showing every line. */
function finish(p) {
  for (let i = 0; i < 30; i++) {
    const current = p.getDialogueManager().getCurrent?.();
    if (!current) return;
    p.getDialogueManager().advance();
    core.TaskManager.process();
  }
}

async function askForWork(p) {
  await talk(p);
  const prompt = promptFor(p);
  assert.ok(prompt, "the foreman opens a menu");
  const index = prompt.options.findIndex((text) => text.startsWith("Do you need any help"));
  assert.ok(index >= 0, "the menu offers the vineyard work");
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player: p, groupId: 219, slot: index + 1 }), true);
  finish(p);
}

test("the foreman gives the grape barrel the first time the player asks for work (#5743)", async () => {
  const p = player();
  await askForWork(p);
  assert.equal(p.getInventory().getAmount(BARREL), 1, "the barrel is in the inventory");
});

test("asking again with the barrel does not give a second one", async () => {
  const p = player();
  await askForWork(p);
  assert.equal(p.getInventory().getAmount(BARREL), 1);
  await askForWork(p);
  assert.equal(p.getInventory().getAmount(BARREL), 1, "still one barrel");
});

test("a player with no inventory space is refused and gets no barrel", async () => {
  const p = player(0);
  await askForWork(p);
  assert.equal(p.getInventory().getAmount(BARREL), 0, "no barrel when the inventory is full");
});

test("a player who lost the barrel is given another on the repeat branch", async () => {
  const p = player();
  await askForWork(p);
  assert.equal(p.getInventory().getAmount(BARREL), 1);
  p.getInventory().deleteNumber(BARREL, 1);
  await askForWork(p);
  assert.equal(p.getInventory().getAmount(BARREL), 1, "the foreman replaces a lost barrel");
});
