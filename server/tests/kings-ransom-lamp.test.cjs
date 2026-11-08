// Run after `yarn build`: node --test tests/kings-ransom-lamp.test.cjs
// King's Ransom's antique lamp (Wiki: 5,000 XP in a skill of 50+) is spent only when its XP lands, and only the lamp
// that was rubbed, still in its slot. Rub and the skill choice go through the real dispatch.
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
  p.setUsername("krlamp" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0));
  p.needsPlacement = false;
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 60, false).setCurrentLevels(skill, 60, false);
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


const LAMP = 11679;
const xp = (f, skill) => f.p.getSkillManager().getExperience(skill);
function xpSlot(skill) {
  for (let slot = 0; slot < 24; slot++) if (XpReward._test.skillForSlot(slot) === skill) return slot;
  assert.fail("no xpreward slot for the skill");
}
async function rub(f, skill, slot) {
  await send(f, { type: "inventory_action", slot, itemId: LAMP, widgetId: 3214, option: "Rub" });
  await send(f, { type: "dialogue_continue", widgetId: 240 << 16, childIndex: xpSlot(skill) });
  f.p.getDialogueManager().reset();
  f.p.getPacketSender().sendInterfaceRemoval();
}

test("a rub under the XP lock keeps the lamp; an unlocked rub spends it for 5,000 XP", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, new core.Item(LAMP, 1));
  const before = xp(f, core.Skill.FISHING);
  f.p.setAttribute("skills:xp-locked", true);
  await rub(f, core.Skill.FISHING, 0);
  assert.equal(xp(f, core.Skill.FISHING), before);
  assert.equal(f.inv.getAmount(LAMP), 1, "the lamp is kept");
  f.p.setAttribute("skills:xp-locked", false);
  await rub(f, core.Skill.FISHING, 0);
  assert.equal(xp(f, core.Skill.FISHING) - before, 5000);
  assert.equal(f.inv.getAmount(LAMP), 0);
});
