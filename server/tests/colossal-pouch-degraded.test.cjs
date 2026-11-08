// Run after `yarn build`: node --test tests/colossal-pouch-degraded.test.cjs
// A degraded colossal pouch holds less than an intact one (Wiki, Colossal pouch: "holds less essence, starting at 35",
// at 85 Runecraft where it holds 40), never more than the player's level allows (8 at 25). Real engine: every plugin
// loaded, a real Player, Fill through ItemActionPacketListener.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");

let core, Pouches;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  Pouches = require("../plugins/skills/runecrafting/Pouches.Runecrafting");
});
after(() => PM.emitServerShutdown({}));

let next = 9950;
function fill(t, level, degradedPouch) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("colossal" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  p.getSkillManager().setMaxLevels(core.Skill.RUNECRAFTING, level, false).setCurrentLevel(core.Skill.RUNECRAFTING, level, false);
  const pouch = core.CacheDefinitions.getObjId(degradedPouch ? "rcu_pouch_colossal_degrade" : "rcu_pouch_colossal");
  const essence = core.CacheDefinitions.getObjId("blankrune_high");
  p.getInventory().add(new core.Item(pouch, 1), true);
  for (let i = 0; i < 26; i++) p.getInventory().add(new core.Item(essence, 1), true);
  const def = core.CacheDefinitions.getItem(pouch), op = def.inventoryActions.indexOf("Fill") + 1;
  assert.ok(op > 0, "Fill is cache-backed");
  ItemActionPacketListener.handleAction(p, Inventory.INTERFACE_ID, pouch, p.getInventory().getSlotForItemId(pouch), op);
  return Pouches._test.states(p).colossal?.amount ?? 0;
}

test("at 25 Runecraft a degraded colossal pouch takes no more than the intact one's 8", (t) => {
  assert.equal(fill(t, 25, false), 8, "intact: 8 at 25");
  assert.equal(fill(t, 25, true), 8, "degraded: not 35");
  assert.equal(fill(t, 85, true), 26, "at 85 the degraded pouch still takes all 26 held (its cap is 35)");
});
