// Run after `yarn build`: node --test tests/shipwright-before-pandemonium.test.cjs
// Before Pandemonium a shipwright has no boats for the player (Wiki, Transcript:Shipwright Sam): Talk-to plays
// "before-completing-pandemonium" and Buy-boat / Customise-boat / Recover-boat play his refusal. They used to serve the
// standard dialogue and open the boat services. Real engine: every plugin loaded, a real Player, Shipwright Sam on his
// Port Sarim tile, native npc_option and dialogue_continue packets.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

let core;
const shopsOpened = [];
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(SAM.x, SAM.y);
  PM.createApi("ShipwrightBeforePandemoniumTest").onCustomEvent("omnishop:open", ({ player }) => shopsOpened.push(player));
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const SAM = { x: 3024, y: 3204 };

function actor(t, name, pandemoniumDone) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setUsername(name); p.setLongUsername(core.Misc.stringToLongBigInt(name)); p.setAttribute("bot-skip-persistence", true);
  assert.equal(core.World.getPlayers().add(p), true);
  const beside = [[0, -1], [1, 0], [-1, 0], [0, 1]].map(([dx, dy]) => new core.Location(SAM.x + dx, SAM.y + dy, 0))
    .find((tile) => !core.RegionManager.blocked(tile, null));
  assert.ok(beside, "a free tile beside Sam");
  p.moveTo(beside); p.setNeedsPlacement(false);
  const c = new ClientConnection(channel); c.player = p;
  p.getSession().setPlayer(p); p.getSession().setTurnPacketProcessor(() => c.processTurnPackets());
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "pandemonium");
  if (pandemoniumDone) quest.setStage(p, quest.completionValue);
  const npc = core.NPC.create(core.NpcIdentifiers.SHIPWRIGHT_SAM, new core.Location(SAM.x, SAM.y, 0));
  assert.equal(core.World.getNpcs().add(npc), true);
  t.after(() => {
    p.closeInterruptibleInterfaces(); core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
    core.World.getNpcs().remove(npc); core.World.getPlayers().remove(p);
  });
  return { p, c, npc };
}

async function option(f, name) {
  const actions = f.npc.getCurrentDefinition(f.p).getActions();
  const index = actions.findIndex((action) => action?.toLowerCase() === name.toLowerCase());
  assert.ok(index >= 0, `${name} in ${JSON.stringify(actions)}`);
  await f.c.dispatch([{ type: "npc_option", index: f.npc.getIndex(), clickType: index + 1 }]);
  for (let i = 0; i < 15 && !f.p.getDialogueManager().getCurrent() && !core.MultiChatboxPrompt.getPending(f.p); i++) core.World.process();
}

const text = (f) => f.p.getDialogueManager().getCurrent()?.getText?.();

async function next(f) {
  const group = f.p.getPacketSender().getChatboxGroupId();
  await f.c.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : 0), childIndex: -1 }]);
  f.c.processTurnPackets();
}

test("before Pandemonium, Talk-to plays Shipwright Sam's 'no boats for sale yet' conversation", async (t) => {
  const f = actor(t, "sampre", false);
  await option(f, "Talk-to");
  assert.equal(text(f), "Greetings! What can I do for you?");
  await next(f);
  assert.equal(text(f), "Hello there. What do you do around here?", "the pre-quest variant, not the services menu");
});

test("before Pandemonium, Buy-boat is refused and opens no Boat Emporium", async (t) => {
  const f = actor(t, "sambuy", false);
  await option(f, "Buy-boat");
  assert.equal(text(f), "I'm afraid I can't help you with that at the moment. You'll have to come back later.");
  assert.deepEqual(shopsOpened.filter((player) => player === f.p), [], "no Boat Emporium");
});

test("after Pandemonium, Buy-boat opens the Boat Emporium", async (t) => {
  const f = actor(t, "sambuyok", true);
  await option(f, "Buy-boat");
  for (let i = 0; i < 3; i++) core.World.process();
  assert.deepEqual(shopsOpened.filter((player) => player === f.p), [f.p]);
});

test("after Pandemonium, Talk-to offers his services as before", async (t) => {
  const f = actor(t, "sampost", true);
  await option(f, "Talk-to");
  assert.equal(text(f), "Greetings! What can I do for you?");
  await next(f);
  const menu = core.MultiChatboxPrompt.getPending(f.p);
  assert.ok(menu && menu.options.includes("I'd like to buy a new boat."), JSON.stringify(menu?.options));
});
