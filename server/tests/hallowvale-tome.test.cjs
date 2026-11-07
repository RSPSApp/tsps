// Run after `yarn build`: node --test tests/hallowvale-tome.test.cjs
// Darkness of Hallowvale's Tome of Experience (Wiki): three chapters of 2,000 XP in a skill of 30+, then it crumbles.
// Read and the skill choice go through the real dispatch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const XpReward = require("../plugins/interface/XpReward.plugin");

let core;
let next = 5000;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("hallowtome" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0));
  p.needsPlacement = false;
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 50, false).setCurrentLevels(skill, 50, false);
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory() };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const TOMES = [9656, 9657, 9658];
const slotOf = (f, id) => f.inv.getItems().findIndex((held) => held?.getId() === id);
const held = (f) => TOMES.find((id) => f.inv.getAmount(id) > 0) ?? null;
const xp = (f, skill) => f.p.getSkillManager().getExperience(skill);

function xpSlot(skill) {
  for (let slot = 0; slot < 24; slot++) if (XpReward._test.skillForSlot(slot) === skill) return slot;
  assert.fail("no xpreward slot for the skill");
}

async function read(f, skill) {
  const id = held(f);
  await send(f, { type: "inventory_action", slot: slotOf(f, id), itemId: id, widgetId: 3214, option: "Read" });
  await send(f, { type: "dialogue_continue", widgetId: 240 << 16, childIndex: xpSlot(skill) });
  f.p.getDialogueManager().reset();
  f.p.getPacketSender().sendInterfaceRemoval();
}

test("three chapters pay 2,000 XP each, wearing the tome down until it crumbles", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(9656, 1), true);
  const before = xp(f, core.Skill.FISHING);
  await read(f, core.Skill.FISHING);
  assert.equal(held(f), 9657, "(3) to (2)");
  await read(f, core.Skill.FISHING);
  assert.equal(held(f), 9658, "(2) to (1)");
  await read(f, core.Skill.FISHING);
  assert.equal(held(f), null, "the book crumbles");
  assert.equal(xp(f, core.Skill.FISHING) - before, 6000);
});

test("a skill below 30 can't be chosen; the chapter stays unread", async (t) => {
  const f = actor(t);
  f.p.getSkillManager().setMaxLevels(core.Skill.COOKING, 29, false).setCurrentLevels(core.Skill.COOKING, 29, false);
  f.inv.add(new core.Item(9656, 1), true);
  const before = xp(f, core.Skill.COOKING);
  await read(f, core.Skill.COOKING);
  assert.equal(xp(f, core.Skill.COOKING), before);
  assert.equal(held(f), 9656);
});
