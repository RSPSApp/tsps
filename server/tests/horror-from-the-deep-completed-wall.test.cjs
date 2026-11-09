const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

// Issue #3851: a Horror from the Deep completed without playing it through (a Leagues quest
// pack, a league's start quests) left the strange wall shut. A completed account's login sends
// every HFTD varbit as 1 (rsprox_transcripts/224/01512.txt, 226/01636.txt), the wall's horrordoor
// (35) and its six offerings included.

let core;
let quest;
const hooks = { objects: [], custom: new Map(), login: [] };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    persistAttribute() {},
    onObjectInteraction(handler) { hooks.objects.push(handler); },
    onPlayerLogin(handler) { hooks.login.push(handler); },
    onCustomEvent(name, handler) {
      const list = hooks.custom.get(name) ?? [];
      list.push(handler);
      hooks.custom.set(name, list);
    },
    emitCustomEvent(name, event) { for (const handler of hooks.custom.get(name) ?? []) handler(event); },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  require("../plugins/quests/quests/HorrorFromTheDeep.Quest")(api);
  quest = QuestRuntime.getRegisteredQuests().find(({ key }) => key === "horror_from_the_deep");
  assert.ok(quest, "Horror from the Deep is registered with QuestRuntime");
});

function playerFixture() {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const player = new Player(null);
  const varbits = new Map();
  const messages = [];
  const sender = new Proxy({}, { get: (_target, key) => key === "sendVarbit"
    ? (id, value) => { varbits.set(id, value); return sender; }
    : () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = (message) => messages.push(message);
  // West of the far wall (4545 at 2516,10003), in the strange-wall room.
  player.setLocation(new core.Location(2515, 10003, 0));
  return { player, varbits, messages };
}

function clickFarWall(player) {
  const event = { player, objectId: core.ObjectIdentifiers.STRANGE_WALL_3,
    location: new core.Location(2516, 10003, 0), handled: false };
  for (const handler of hooks.objects) handler(event);
  return event;
}

test("a quest pack's completion opens the strange wall and sends the completed varbits", () => {
  const { player, varbits, messages } = playerFixture();
  // Unlocks.LeagueMode's completeQuest: the runtime completion with no experience or scroll.
  quest.complete(player, { experience: false, scroll: false });
  assert.equal(quest.isComplete(player), true);
  for (const id of [35, 36, 37, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48]) {
    assert.equal(varbits.get(id), 1, `varbit ${id} reads as a completed account's`);
  }
  const event = clickFarWall(player);
  assert.equal(event.handled, true);
  assert.ok(!messages.includes("You cannot see any way to move this part of the wall..."));
  assert.ok(messages.includes("You pass through the opening in the strange wall."));
  assert.equal(player.getLocation().getX(), 2517, "crosses to the far side");
});

test("a save completed before the fix opens the wall and replays the varbits on login", () => {
  const { player, varbits, messages } = playerFixture();
  // Completed with no offerings recorded: only the stage, as an earlier auto-completion saved it.
  player.setAttribute("quest.horror_from_the_deep.stage", 10);
  for (const handler of hooks.login) handler({ player });
  assert.equal(varbits.get(35), 1);
  assert.equal(varbits.get(40), 1);
  clickFarWall(player);
  assert.ok(messages.includes("You pass through the opening in the strange wall."));
});

test("an unfinished quest still keeps the wall shut until all six offerings are in", () => {
  const { player, varbits, messages } = playerFixture();
  player.setAttribute("quest.horror_from_the_deep.stage", 4);
  for (const handler of hooks.login) handler({ player });
  assert.equal(varbits.get(35), 0);
  clickFarWall(player);
  assert.ok(messages.includes("You cannot see any way to move this part of the wall..."));
  assert.equal(player.getLocation().getX(), 2515);
});
