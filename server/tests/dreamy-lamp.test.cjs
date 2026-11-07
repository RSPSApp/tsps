// Run after `yarn build`: node --test tests/dreamy-lamp.test.cjs
// Dream Mentor's dreamy lamp (Wiki): one wish of 15,000 XP in Strength, Ranged, Magic, Hitpoints or Defence.
// Rub and the skill choice go through the real dispatch.
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
let next = 4900;

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
  p.setUsername("dreamylamp" + p.getIndex());
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

const lamp = () => core.ItemIdentifiers.DREAMY_LAMP;
const slotOf = (f, id) => f.inv.getItems().findIndex((held) => held?.getId() === id);
const xp = (f, skill) => f.p.getSkillManager().getExperience(skill);

function xpSlot(skill) {
  for (let slot = 0; slot < 24; slot++) if (XpReward._test.skillForSlot(slot) === skill) return slot;
  assert.fail("no xpreward slot for the skill");
}

async function rub(f, skill) {
  await send(f, { type: "inventory_action", slot: slotOf(f, lamp()), itemId: lamp(), widgetId: 3214, option: "Rub" });
  await send(f, { type: "dialogue_continue", widgetId: 240 << 16, childIndex: xpSlot(skill) });
  f.p.getDialogueManager().reset();
  f.p.getPacketSender().sendInterfaceRemoval();
}

test("the dreamy lamp pays 15,000 Defence XP once and is used up", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(lamp(), 1), true);
  const before = xp(f, core.Skill.DEFENCE);
  await rub(f, core.Skill.DEFENCE);
  assert.equal(xp(f, core.Skill.DEFENCE) - before, 15000);
  assert.equal(f.inv.getAmount(lamp()), 0, "the lamp is gone");
});

test("Attack and Prayer can't be chosen; the lamp stays", async (t) => {
  const f = actor(t);
  f.inv.add(new core.Item(lamp(), 1), true);
  const attack = xp(f, core.Skill.ATTACK);
  const prayer = xp(f, core.Skill.PRAYER);
  await rub(f, core.Skill.ATTACK);
  await rub(f, core.Skill.PRAYER);
  assert.equal(xp(f, core.Skill.ATTACK), attack);
  assert.equal(xp(f, core.Skill.PRAYER), prayer);
  assert.equal(f.inv.getAmount(lamp()), 1);
});
