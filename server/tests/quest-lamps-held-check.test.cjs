// Run after `yarn build`: node --test tests/quest-lamps-held-check.test.cjs
// King's Ransom's antique lamp and In Search of Knowledge's lamp of knowledge paid their XP at Confirm before checking
// the lamp was still there, then deleted it (a no-op if gone). A lamp moved away while the choice was open paid again
// later. Now Confirm is refused without the lamp. Real engine: every plugin loaded, a real Player, each lamp's own Rub
// through PluginManager.emitItemAction; the xpreward request it sends is confirmed directly.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, requests = [], next = 9340;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.createApi("LampRequests").onCustomEvent("xpreward:open", (request) => requests.push(request));
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

for (const [label, lamp] of [["King's Ransom antique lamp", 11679], ["In Search of Knowledge lamp of knowledge", 23516]]) {
  test(`${label}: Confirm without the lamp pays nothing`, (t) => {
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const p = new Player(new PlayerSession(channel));
    p.setIndex(next++); p.setUsername("lamp" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
    t.after(() => p.setRegistered(false));
    for (const skill of [core.Skill.ATTACK]) { p.getSkillManager().setMaxLevels(skill, 60, false); p.getSkillManager().setCurrentLevels(skill, 60, false); }
    p.getInventory().add(new core.Item(lamp, 1), false);
    const slot = p.getInventory().getSlotForItemId(lamp);
    const clickType = (core.CacheDefinitions.getItem(lamp).inventoryActions ?? []).indexOf("Rub") + 1;
    assert.ok(clickType > 0);
    requests = [];
    PM.emitItemAction({ player: p, itemId: lamp, slot, item: p.getInventory().getItems()[slot], option: "Rub", clickType, handled: false });
    const request = requests.find((r) => r.player === p);
    assert.ok(request, "the lamp opened the XP choice");
    p.getInventory().delete(lamp, 1); // moved away while the choice is open
    const before = p.getSkillManager().getExperience(core.Skill.ATTACK);
    assert.equal(request.onConfirm(core.Skill.ATTACK, "Attack"), null, "refused");
    assert.equal(p.getSkillManager().getExperience(core.Skill.ATTACK), before, "no XP");
  });
}
