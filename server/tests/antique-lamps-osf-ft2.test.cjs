// Run after `yarn build`: node --test tests/antique-lamps-osf-ft2.test.cjs
// Wiki: Antique lamp (One Small Favour) is item 4447, "10,000 experience in a skill of the player's choosing", skill
// over level 30; Antique lamp (A Tail of Two Cats), 6543, grants 2,500 and "is also received from the Fairy Queen
// after completing Fairytale II". Fairytale II gave and rubbed 4447 for 2,500, so One Small Favour's lamps paid
// 2,500 too. Real engine: every plugin loaded, a real Player, the lamps' own Rub actions and confirm callbacks.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9040;
function rubAndConfirm(t, lampId) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("lamp" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  p.getSkillManager().setMaxLevels(core.Skill.COOKING, 40, false);
  p.getSkillManager().setCurrentLevels(core.Skill.COOKING, 40, false);
  p.getInventory().setItem(0, new core.Item(lampId, 1));
  let request;
  const emit = PM.emitCustomEvent.bind(PM);
  t.mock.method(PM, "emitCustomEvent", (name, event) => {
    if (name === "xpreward:open") { request = event; return event; }
    return emit(name, event);
  });
  const item = p.getInventory().getItems()[0];
  PM.emitItemAction({ player: p, item, itemId: lampId, slot: 0, interfaceId: core.CacheDefinitions.getComponentId("inventory:items"),
    clickType: core.CacheDefinitions.getItem(lampId).inventoryActions.indexOf("Rub") + 1, handled: false });
  assert.ok(request, "the lamp opens the skill choice");
  const before = p.getSkillManager().getExperience(core.Skill.COOKING);
  request.onConfirm(core.Skill.COOKING, "Cooking");
  return { gained: p.getSkillManager().getExperience(core.Skill.COOKING) - before, request, p };
}

test("One Small Favour's lamp pays 10,000 XP at level 30 or more", (t) => {
  const { gained, request, p } = rubAndConfirm(t, I.ANTIQUE_LAMP);
  assert.equal(request.minLevel, 30);
  assert.equal(gained, 10000);
  assert.equal(p.getInventory().getAmount(I.ANTIQUE_LAMP), 0, "the lamp is used up");
});

test("the Fairy Queen's lamp (A Tail of Two Cats') pays 2,500 XP", (t) => {
  const { gained } = rubAndConfirm(t, I.ANTIQUE_LAMP_2);
  assert.equal(gained, 2500);
});
