// Run after `yarn build`: node --test tests/jewellery-kourend-visit.test.cjs
//
// Wiki (Games necklace): Wintertodt Camp "Must have visited Zeah at least once"; (Wintertodt Camp) "provided they
// have already taken Veos's ship to Great Kourend once". The POH jewellery box's init script strikes Wintertodt Camp,
// the Woodcutting Guild and the Farming Guild out on one bit, so the skills necklace's two Kourend guilds share it.
// The visit (varbit zeah_playerhasvisited) is saved and sent again at login. Real engine: every plugin loaded, a real
// Player and items, the worn necklaces' options through ClientConnection.dispatch; the teleport itself is recorded.
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
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

const HOME = [3222, 3218];
const VISITED_ATTRIBUTE = "kourend:visited";
/** Worn options start at click 2, in the item's cache order (param 451 on). */
const FIRST_WORN_OPTION_CLICK = 2;
const WORN_OPTION_PARAM = 451;
/** The worn tab's (387) amulet slot. */
const WORN_NECK = { groupId: 387, childId: 17 };

let core, I, Box, next = 9700, visitedVarbit;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
  Box = require("../plugins/skills/construction/JewelleryBox.Construction")._test;
  visitedVarbit = CacheDefinitions.getVarbitId("zeah_playerhasvisited");
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("kourend" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(...HOME, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  const teleports = [];
  t.mock.method(core.TeleportHandler, "teleport", (_p, to) => teleports.push([to.getX(), to.getY()]));
  return { p, c, teleports };
}

const visit = (f) => f.p.getPacketSender().sendVarbit(visitedVarbit, 1);

/** Clicks a worn necklace's named teleport on the worn tab, as the client sends it. */
async function wornTeleport(f, itemId, label) {
  f.p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(itemId, 1));
  const params = CacheDefinitions.getItem(itemId).params;
  let index = 0;
  while (params.get(WORN_OPTION_PARAM + index) !== label) {
    assert.ok(index < 8, `${label} is a worn option`);
    index++;
  }
  await f.c.dispatch([{ type: "widget_action", widgetId: (WORN_NECK.groupId << 16) | WORN_NECK.childId, ...WORN_NECK, slot: -1, buttonNum: FIRST_WORN_OPTION_CLICK + index }]);
  f.c.processTurnPackets();
  core.TaskManager.process();
}

const KOUREND = [
  ["games necklace", () => I.GAMES_NECKLACE_8_, "Wintertodt Camp"],
  ["skills necklace", () => I.SKILLS_NECKLACE_4_, "Woodcutting Guild"],
  ["skills necklace", () => I.SKILLS_NECKLACE_4_, "Farming Guild"],
];

for (const [name, item, label] of KOUREND) {
  test(`the ${name}'s ${label} needs Veos's trip to Great Kourend`, async (t) => {
    const f = actor(t);
    await wornTeleport(f, item(), label);
    assert.equal(f.teleports.length, 0, "refused before the visit");
    visit(f);
    await wornTeleport(f, item(), label);
    assert.equal(f.teleports.length, 1, "teleports after it");
  });
}

test("the games necklace's other teleports don't need the visit", async (t) => {
  const f = actor(t);
  await wornTeleport(f, I.GAMES_NECKLACE_8_, "Burthorpe");
  assert.equal(f.teleports.length, 1);
});

test("the jewellery box strikes out and refuses its three Kourend destinations until the visit", (t) => {
  const f = actor(t);
  t.mock.method(core.TeleportHandler, "checkReqs", () => true);
  assert.equal(Box.destinationMask(f.p) & 0b00010, 0, "struck out");
  const slots = ["Wintertodt Camp", "Woodcutting Guild", "Farming Guild"].map((label) => Box.DESTINATIONS.findIndex((entry) => entry.label === label));
  for (const slot of slots) {
    assert.notEqual(slot, -1);
    Box.teleport(f.p, slot);
  }
  assert.equal(f.teleports.length, 0, "all three refused");
  visit(f);
  assert.equal(Box.destinationMask(f.p) & 0b00010, 0b00010, "open after the visit");
  for (const slot of slots) Box.teleport(f.p, slot);
  assert.equal(f.teleports.length, 3, "all three teleport");
});

test("a saved visit is sent again at login", (t) => {
  const f = actor(t);
  assert.equal(f.p.getPacketSender().getVarbit(visitedVarbit), 0);
  f.p.setAttribute(VISITED_ATTRIBUTE, true);
  // Login hooks run for an event with the player and its username, as the login flow sends.
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.equal(f.p.getPacketSender().getVarbit(visitedVarbit), 1);
});

/** Runs game ticks until `done` or the limit, as the world does for a voyage. */
function ticks(f, limit, done) {
  for (let i = 0; i < limit && !done(); i++) {
    core.World.processCycle = (core.World.processCycle ?? 0) + 1;
    core.TaskManager.process();
    f.p.getMovementQueue().process();
  }
}

for (const route of ["kourend-landsend", "kourend-piscarilius"]) {
  test(`a ship landing in Kourend (${route}) records the visit, whoever sails it`, (t) => {
    const f = actor(t);
    f.p.setLocation(new core.Location(3054, 3245, 0)); // Port Sarim's pier
    const request = { player: f.p, route, handled: false };
    PM.emitCustomEvent("ferries:travel", request);
    assert.equal(request.handled, true, "the voyage starts");
    ticks(f, 40, () => f.p.getAttribute(VISITED_ATTRIBUTE) === true);
    assert.equal(f.p.getAttribute(VISITED_ATTRIBUTE), true);
    assert.equal(f.p.getPacketSender().getVarbit(visitedVarbit), 1);
    assert.ok(f.p.getLocation().getX() < 2048, "landed in Kourend");
  });
}

test("a save from before the visit was kept counts it from Client of Kourend or a Kourend login", (t) => {
  const quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === "client_of_kourend");
  const started = actor(t);
  quest.setStage(started.p, 1);
  PM.emitPlayerLogin({ player: started.p, username: started.p.getUsername() });
  assert.equal(started.p.getPacketSender().getVarbit(visitedVarbit), 1, "Client of Kourend started");

  const there = actor(t);
  there.p.setLocation(new core.Location(1630, 3940, 0)); // Wintertodt Camp
  PM.emitPlayerLogin({ player: there.p, username: there.p.getUsername() });
  assert.equal(there.p.getPacketSender().getVarbit(visitedVarbit), 1, "logged in on Kourend");

  const never = actor(t);
  PM.emitPlayerLogin({ player: never.p, username: never.p.getUsername() });
  assert.equal(never.p.getPacketSender().getVarbit(visitedVarbit), 0, "nothing for a player who never went");
});
