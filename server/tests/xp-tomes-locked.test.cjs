// Run after `yarn build`: node --test tests/xp-tomes-locked.test.cjs
// Sins of the Father's and The Blood Moon Rises' tomes (Wiki: six chapters of 15,000 / 30,000 XP) spend a chapter only
// when its XP lands, as the Hallowvale tome and the lamps do. Under the XP lock a read spent the chapter for nothing.
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
  p.setUsername("xptome" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0));
  p.needsPlacement = false;
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 80, false).setCurrentLevels(skill, 80, false);
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

const slotOf = (f, id) => f.inv.getItems().findIndex((held) => held?.getId() === id);
const xp = (f, skill) => f.p.getSkillManager().getExperience(skill);

function xpSlot(skill) {
  for (let slot = 0; slot < 24; slot++) if (XpReward._test.skillForSlot(slot) === skill) return slot;
  assert.fail("no xpreward slot for the skill");
}

async function read(f, id, skill) {
  await send(f, { type: "inventory_action", slot: slotOf(f, id), itemId: id, widgetId: 3214, option: "Read" });
  await send(f, { type: "dialogue_continue", widgetId: 240 << 16, childIndex: xpSlot(skill) });
  f.p.getDialogueManager().reset();
  f.p.getPacketSender().sendInterfaceRemoval();
}

const CASES = [
  { quest: "sins_of_the_father", tome: 24690, attribute: "quest.sins_of_the_father.tome-chapters", chapter: 15000 },
  { quest: "the_blood_moon_rises", tome: 33715, attribute: "quest.the_blood_moon_rises.tome-uses", chapter: 30000 },
];

for (const c of CASES) {
  test(`${c.quest}: a read under the XP lock keeps the chapter; an unlocked read spends it`, async (t) => {
    const f = actor(t);
    const quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((q) => q.key === c.quest);
    assert.ok(quest, c.quest);
    quest.setStage(f.p, quest.completionValue);
    f.inv.add(new core.Item(c.tome, 1), true);
    const before = xp(f, core.Skill.FISHING);
    f.p.setAttribute(core.SkillManager?.XP_LOCKED_ATTRIBUTE ?? "skills:xp-locked", true);
    await read(f, c.tome, core.Skill.FISHING);
    assert.equal(xp(f, core.Skill.FISHING), before, "no XP under the lock");
    assert.equal(Number(f.p.getAttribute(c.attribute)) || 0, 0, "no chapter spent");
    f.p.setAttribute(core.SkillManager?.XP_LOCKED_ATTRIBUTE ?? "skills:xp-locked", false);
    await read(f, c.tome, core.Skill.FISHING);
    assert.equal(xp(f, core.Skill.FISHING) - before, c.chapter);
    assert.equal(Number(f.p.getAttribute(c.attribute)), 1);
    assert.equal(f.inv.getAmount(c.tome), 1, "five chapters left");
  });
}
