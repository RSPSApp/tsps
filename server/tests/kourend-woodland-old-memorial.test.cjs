// Run after `yarn build`: node --test tests/kourend-woodland-old-memorial.test.cjs
//
// The Old Memorial in the Kourend Woodland (kourendwoodland_statue, 1520,3478) offered Inspect but nothing
// happened. Recorded (rsprox.net recording 363, rev 231, five inspects): a message box with King Kharedst IV's
// inscription. Real map, real Player, packets in; no client ran.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const MEMORIAL = [1520, 3478, 0];
const BESIDE = [1520, 3477, 0];
const RECORDED = "'Obey the <col=800080>Laws<col=000000> of your <col=800080>Body<col=000000>, "
  + "<col=800080>Mind<col=000000> and <col=800080>Soul<col=000000>.' - King Kharedst IV";

let core;
let memorialId;
let next = 9850;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(MEMORIAL[0], MEMORIAL[1]);
  PM.emitServerStartup({});
  memorialId = core.CacheDefinitions.getLocId("kourendwoodland_statue");
});
after(() => PM.emitServerShutdown({}));

function actor(t, at) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("memorialqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(...at));
  p.needsPlacement = false;
  core.World.getPlayers().add(p);
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const boxes = [];
  const sendMessage = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); return sendMessage(text); });
  const dialogues = p.getDialogueManager();
  const start = dialogues.startDialogues.bind(dialogues);
  t.mock.method(dialogues, "startDialogues", (chain) => {
    for (const box of chain.dialogues.values()) boxes.push({ type: box.constructor.name, text: String(box.text) });
    return start(chain);
  });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.World.getPlayers().remove(p);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, messages, boxes };
}

function tick(f) {
  core.World.processCycle++;
  core.TaskManager.process();
  f.c.processTurnPackets();
  f.p.getMovementQueue().process();
  core.TaskManager.processWalkTo(f.p.getIndex());
  f.p.getSession().flushClient(core.World.processCycle);
  f.p.resetUpdating();
}

test("the map has the Old Memorial, offering Inspect", () => {
  const definition = core.ObjectDefinition.forId(memorialId);
  assert.equal(definition.getName(), "Old Memorial");
  const found = core.MapObjects.get(memorialId, new core.Location(...MEMORIAL), null);
  assert.ok(found, "loc 31714 stands at 1520,3478");
});

test("Inspect opens the recorded inscription in a message box", async (t) => {
  const f = actor(t, BESIDE);
  await f.c.dispatch([{ type: "object_option", id: memorialId, x: MEMORIAL[0], y: MEMORIAL[1], clickType: 1 }]);
  f.c.processTurnPackets();
  for (let i = 0; i < 3 && f.boxes.length === 0; i++) tick(f);
  assert.deepEqual(f.boxes, [{ type: "StatementDialogue", text: RECORDED }]);
  assert.ok(!f.messages.includes("Nothing interesting happens."), JSON.stringify(f.messages));
});
