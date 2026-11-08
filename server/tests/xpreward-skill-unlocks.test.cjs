// Run after `yarn build`: node --test tests/xpreward-skill-unlocks.test.cjs
// Wiki (Lamp): Herblore, Runecraft and Sailing can't be chosen before Druidic Ritual, Rune Mysteries and Pandemonium, nor
// Construction without a house. The client's script 3809 refuses them, but only the slot reaches the server.
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
  p.setUsername("xpunlock" + p.getIndex());
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


const LAMP = 2528;
const xp = (f, skill) => f.p.getSkillManager().getExperience(skill);
function xpSlot(skill) {
  for (let slot = 0; slot < 24; slot++) if (XpReward._test.skillForSlot(slot) === skill) return slot;
  assert.fail("no xpreward slot for the skill");
}
async function rubAndChoose(f, skill) {
  const slot = f.inv.getItems().findIndex((held) => held?.getId() === LAMP);
  await send(f, { type: "inventory_action", slot, itemId: LAMP, widgetId: 3214, option: "Rub" });
  // A modified client sends the locked slot anyway.
  await send(f, { type: "dialogue_continue", widgetId: 240 << 16, childIndex: xpSlot(skill) });
  f.p.getDialogueManager().reset();
  f.p.getPacketSender().sendInterfaceRemoval();
}

const LOCKS = [
  ["HERBLORE", "druidic_ritual", 4],
  ["RUNECRAFTING", "rune_mysteries", 6],
  ["SAILING", "pandemonium", 50],
];

for (const [name, quest, stage] of LOCKS) {
  test(`${name}: refused before ${quest}, granted after`, async (t) => {
    const f = actor(t);
    const skill = core.Skill[name];
    f.inv.add(new core.Item(LAMP, 1), true);
    const before = xp(f, skill);
    await rubAndChoose(f, skill);
    assert.equal(xp(f, skill), before, "no XP before the quest");
    assert.equal(f.inv.getAmount(LAMP), 1, "the lamp is kept");
    f.p.setAttribute(`quest.${quest}.stage`, stage);
    await rubAndChoose(f, skill);
    assert.equal(xp(f, skill) - before, 500, "10 x level 50 after it");
    assert.equal(f.inv.getAmount(LAMP), 0);
  });
}
