// Run after `yarn build`: node --test tests/golden-wool-crafting-xp.test.cjs
// Wiki (Golden wool): spinning the golden fleece "Level 1 is required, and the action grants 2.5 XP" (Crafting); the
// Fremennik Trials' spin gave the wool and no XP.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

test("spinning the golden fleece gives golden wool and 2.5 Crafting XP", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9840); p.setUsername("fleece9840"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  // The Seers' Village wheel (rsprox 235/03467: kr_spinningwheel at 2710, 3471, 1).
  p.setLocation(new core.Location(2711, 3471, 1)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  p.setAttribute("quest.fremennik_trials.trials", 1 << 3); // the bard's trial started
  p.getInventory().add(new core.Item(core.ItemIdentifiers.GOLDEN_FLEECE, 1), true);
  const wheel = new core.GameObject(core.ObjectIdentifiers.SPINNING_WHEEL, new core.Location(2710, 3471, 1), 10, 0, null);
  assert.equal(wheel.getDefinition().getName(), "Spinning wheel");
  const raw = () => p.getSkillManager().skills.experience[core.Skill.CRAFTING.getIndex()];
  const before = raw();
  PM.emitItemOnObject({ player: p, object: wheel, objectId: wheel.getId(), itemId: core.ItemIdentifiers.GOLDEN_FLEECE,
    slot: p.getInventory().getSlotForItemId(core.ItemIdentifiers.GOLDEN_FLEECE), item: p.getInventory().forSlot(0), location: { x: 2710, y: 3471, z: 1 }, handled: false });
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.GOLDEN_WOOL), 1);
  assert.equal(raw() - before, 2.5);
});
