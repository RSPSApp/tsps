// Run after `yarn build`: node --test tests/genie-lamp-construction.test.cjs
// Wiki (Lamp): the genie lamp's and the Book of knowledge's Construction option "cannot be selected unless the player
// owns a house". Rub and the skill choice go through the real dispatch.
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
  p.setUsername("genielamp" + p.getIndex());
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
async function rub(f, skill) {
  const slot = f.inv.getItems().findIndex((held) => held?.getId() === LAMP);
  await send(f, { type: "inventory_action", slot, itemId: LAMP, widgetId: 3214, option: "Rub" });
  await send(f, { type: "dialogue_continue", widgetId: 240 << 16, childIndex: xpSlot(skill) });
  f.p.getDialogueManager().reset();
  f.p.getPacketSender().sendInterfaceRemoval();
}
function ownsHouse(f) {
  const request = { player: f.p, owns: true };
  PM.emitCustomEvent("construction:owns-house", request);
  return request.owns;
}

test("without a house, Construction can't be chosen: the lamp is kept and no XP lands", async (t) => {
  const f = actor(t);
  assert.equal(ownsHouse(f), false, "a fresh account owns no house");
  f.inv.add(new core.Item(LAMP, 1), true);
  const before = xp(f, core.Skill.CONSTRUCTION);
  await rub(f, core.Skill.CONSTRUCTION);
  assert.equal(xp(f, core.Skill.CONSTRUCTION), before);
  assert.equal(f.inv.getAmount(LAMP), 1);
  await rub(f, core.Skill.FISHING);
  assert.equal(f.inv.getAmount(LAMP), 0, "another skill still takes it");
});

test("a house owner can choose Construction", async (t) => {
  const f = actor(t);
  t.mock.method(PM, "emitCustomEvent", ((original) => function (name, event) {
    if (name === "construction:owns-house") { event.owns = true; return; }
    return original.call(this, name, event);
  })(PM.emitCustomEvent));
  f.inv.add(new core.Item(LAMP, 1), true);
  const before = xp(f, core.Skill.CONSTRUCTION);
  await rub(f, core.Skill.CONSTRUCTION);
  assert.equal(xp(f, core.Skill.CONSTRUCTION) - before, 500, "10 x level 50");
  assert.equal(f.inv.getAmount(LAMP), 0);
});
