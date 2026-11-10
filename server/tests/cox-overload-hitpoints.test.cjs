// Run after `yarn build`: node --test tests/cox-overload-hitpoints.test.cjs
// The Chambers of Xeric overload needs more than 50 Hitpoints (Wiki, Overload (Chambers of Xeric); as Overload (+) and
// the refusal text): at exactly 50 it is refused, at 51 it is drunk. Real engine: every plugin loaded, a real Player,
// the sip through ClientConnection.dispatch (no capture of the refusal).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const OVERLOAD_4 = 20996; // Overload (+) (Chambers of Xeric), 4 doses
const HOME = [3222, 3218];
let core, next = 9880;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
  // Inside the raid: the area answer the raid plugin gives its members.
  PM.createApi("CoxOverloadTest").onCustomEvent("potions:area", (request) => { if (request.player?.__inRaid) request.inside = true; });
});
after(() => PM.emitServerShutdown({}));

function actor(t, hitpoints) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("coxoverload" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  p.__inRaid = true;
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  p.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, hitpoints, false);
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (message) => { messages.push(message); return sender; });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  p.getInventory().setItem(0, new core.Item(OVERLOAD_4, 1));
  return { p, c, messages };
}

async function sip({ p, c }) {
  await c.dispatch([{ type: "inventory_action", slot: 0, itemId: p.getInventory().getItems()[0].getId(), widgetId: 3214, option: "Drink" }]);
  c.processTurnPackets?.();
}

test("the raid's overload is refused at exactly 50 Hitpoints and drunk at 51", async (t) => {
  assert.equal(core.ItemDefinition.forId(OVERLOAD_4).getName(), "Overload (+)(4)");
  const at50 = actor(t, 50);
  await sip(at50);
  assert.equal(at50.p.getInventory().getItems()[0]?.getId(), OVERLOAD_4, "50: no dose taken");
  assert.ok(at50.messages.some((m) => /more than 50 Hitpoints/.test(m)), at50.messages.join(" | "));
  const at51 = actor(t, 51);
  await sip(at51);
  assert.notEqual(at51.p.getInventory().getItems()[0]?.getId(), OVERLOAD_4, "51: a dose taken");
});

// Leaving the raid ends its timed potions with no line: both timers go to 0 as raids_client_indungeon does
// (rsprox_transcripts/234/03285.txt:288134, 234/00820.txt:321992). Running out inside it:
// "<col=ef1020>The effects of overload have worn off, and you feel normal again." (234/00820.txt:199330).
test("the raid's overload ends silently on leaving the raid, and with its recorded line when it runs out inside", async (t) => {
  const leaver = actor(t, 99);
  await sip(leaver);
  assert.ok(leaver.p.getAttribute("potions:overload:state"), "the overload is running");
  leaver.messages.length = 0;
  const hitpoints = leaver.p.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS);
  leaver.p.__inRaid = false;
  PM.emitPlayerProcess({ player: leaver.p });
  assert.equal(leaver.p.getAttribute("potions:overload:state"), null, "gone with the raid");
  assert.deepEqual(leaver.messages.filter((m) => /overload/i.test(m)), [], "no line");
  assert.equal(leaver.p.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS), hitpoints, "and no end-of-overload heal");

  const stayer = actor(t, 99);
  await sip(stayer);
  stayer.messages.length = 0;
  stayer.p.getAttribute("potions:overload:state").endsAt = Date.now() - 1;
  PM.emitPlayerProcess({ player: stayer.p });
  assert.equal(stayer.p.getAttribute("potions:overload:state"), null);
  assert.ok(stayer.messages.includes("<col=ef1020>The effects of overload have worn off, and you feel normal again."), stayer.messages.join(" | "));
});

// The same for prayer enhance (234/03285.txt:288135, its timer zeroed beside the overload's), and its recorded
// expiry line "<col=ff0000>Your prayer enhance effect has worn off.</col>" (234/03285.txt:265414).
test("the raid's prayer enhance ends silently on leaving the raid, and with its recorded line inside", (t) => {
  const running = () => ({ endsAt: Date.now() + 60_000, nextAt: Date.now() + 60_000, area: "chambers-of-xeric" });
  const leaver = actor(t, 99);
  leaver.p.setAttribute("potions:prayer-enhance", running());
  leaver.p.__inRaid = false;
  PM.emitPlayerProcess({ player: leaver.p });
  assert.equal(leaver.p.getAttribute("potions:prayer-enhance"), null);
  assert.deepEqual(leaver.messages.filter((m) => /prayer enhance/i.test(m)), []);

  const stayer = actor(t, 99);
  stayer.p.setAttribute("potions:prayer-enhance", { ...running(), endsAt: Date.now() - 1 });
  PM.emitPlayerProcess({ player: stayer.p });
  assert.equal(stayer.p.getAttribute("potions:prayer-enhance"), null);
  assert.ok(stayer.messages.includes("<col=ff0000>Your prayer enhance effect has worn off.</col>"), stayer.messages.join(" | "));
});
