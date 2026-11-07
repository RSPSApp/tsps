// Run after `yarn build`: node --test tests/tob-entry-bandages.test.cjs
// Entry Mode's bandages (25730) are the Theatre's own supplies (Wiki, Bandages (Theatre of Blood): an Entry Mode
// consumable, neither tradeable nor bankable). Leaving the raid takes them, and one carried out anyway (an older
// save) heals nothing. Real engine: every plugin loaded, a real Player in a real Entry raid (Parties, RaidState),
// the chest's real handout, and Heal as the native inventory_action packet through ClientConnection.dispatch.
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
const Raid = require("../plugins/minigames/tob/RaidState.TheatreOfBlood");
const Parties = require("../plugins/minigames/tob/Parties.TheatreOfBlood");
const Supplies = require("../plugins/minigames/tob/Supplies.TheatreOfBlood");
const Shared = require("../plugins/minigames/tob/Shared.TheatreOfBlood");

const BANDAGES = 25730;
let core;
let next = 9720;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, at) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("tobband" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(...at, 0));
  p.needsPlacement = false;
  const skills = p.getSkillManager();
  for (const skill of [core.Skill.HITPOINTS, core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE, core.Skill.RANGED, core.Skill.MAGIC, core.Skill.PRAYER]) {
    skills.setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  }
  skills.setCurrentLevels(core.Skill.HITPOINTS, 50, false);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, c, skills, messages };
}

function ticks(count) {
  for (let i = 0; i < count; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
  }
}

function entryRaid(f, mode = "entry") {
  const party = Parties.create(f.p);
  party.mode = mode;
  const raid = Raid.begin(f.p);
  raid.enter(f.p);
  ticks(3);
  return raid;
}

async function heal(f) {
  const slot = f.p.getInventory().getItems().findIndex((item) => item?.getId() === BANDAGES);
  await f.c.dispatch([{ type: "inventory_action", slot, itemId: BANDAGES, widgetId: 3214, option: "Heal" }]);
  f.c.processTurnPackets();
}

test("leaving an Entry Mode raid leaves its bandages behind", (t) => {
  const f = actor(t, [3667, 3219]);
  const raid = entryRaid(f);
  Supplies.takeBandages(f.p, raid.member(f.p), { key: "maiden", raid });
  assert.equal(f.p.getInventory().getAmount(BANDAGES), Supplies.BANDAGES_PER_CHEST, "the chest hands out ten");
  raid.leave(f.p, "You leave the Theatre.");
  ticks(6);
  assert.equal(Raid.raidOf(f.p) ?? null, null);
  assert.ok(Shared.inVerSinhaza(f.p.getLocation()), `out at Ver Sinhaza, at ${f.p.getLocation()}`);
  assert.equal(f.p.getInventory().getAmount(BANDAGES), 0);
});

test("a bandage carried outside the Theatre heals and boosts nothing", async (t) => {
  const f = actor(t, [3222, 3218]);
  f.p.getInventory().setItem(0, new core.Item(BANDAGES, 1));
  await heal(f);
  assert.deepEqual(f.messages, ["You can only use these bandages in an Entry Mode raid."]);
  assert.equal(f.skills.getCurrentLevel(core.Skill.HITPOINTS), 50);
  assert.equal(f.skills.getCurrentLevel(core.Skill.STRENGTH), 99);
  assert.equal(f.skills.getCurrentLevel(core.Skill.RANGED), 99);
  assert.equal(f.p.getInventory().getAmount(BANDAGES), 1, "and is not used up");
});

test("inside an Entry Mode raid a bandage still heals and boosts", async (t) => {
  const f = actor(t, [3667, 3219]);
  const raid = entryRaid(f);
  Supplies.takeBandages(f.p, raid.member(f.p), { key: "maiden", raid });
  await heal(f);
  assert.equal(f.skills.getCurrentLevel(core.Skill.HITPOINTS), 70);
  assert.equal(f.skills.getCurrentLevel(core.Skill.STRENGTH), 99 + Math.floor(99 * 0.15) + 4);
  assert.equal(f.p.getInventory().getAmount(BANDAGES), Supplies.BANDAGES_PER_CHEST - 1);
  raid.dispose();
});

test("logging out of an Entry raid and back in after it ended leaves the bandages behind", (t) => {
  const f = actor(t, [3667, 3219]);
  const raid = entryRaid(f);
  Supplies.takeBandages(f.p, raid.member(f.p), { key: "maiden", raid });
  assert.equal(f.p.getInventory().getAmount(BANDAGES), Supplies.BANDAGES_PER_CHEST);
  raid.onLogout(f.p); // the raid's own logout handling: alone, so the raid ends
  assert.equal(raid.over || Raid.byId(raid.id) == null || raid.players.length === 0, true);
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  ticks(2);
  assert.equal(Raid.raidOf(f.p) ?? null, null, "not back in a raid");
  assert.equal(f.p.getInventory().getAmount(BANDAGES), 0);
});

test("a bandage brought into a Normal Mode raid heals nothing", async (t) => {
  const f = actor(t, [3667, 3219]);
  const raid = entryRaid(f, "normal");
  assert.equal(raid.isEntry, false);
  f.p.getInventory().setItem(27, new core.Item(BANDAGES, 1));
  await heal(f);
  assert.ok(f.messages.includes("You can only use these bandages in an Entry Mode raid."));
  assert.equal(f.skills.getCurrentLevel(core.Skill.HITPOINTS), 50);
  assert.equal(f.p.getInventory().getAmount(BANDAGES), 1);
  raid.dispose();
});
