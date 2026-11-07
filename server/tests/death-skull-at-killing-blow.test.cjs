// Run after `yarn build`: node --test tests/death-skull-at-killing-blow.test.cjs
// A death keeps its items four ticks after the killing blow, and the skull timer kept counting down while dying: a
// skull with four or fewer ticks left was gone when the items were worked out, so a skulled player kept three. The
// skull stands still while dying now. Real engine: every plugin loaded, a real Player, the real appendDeath and
// PlayerDeathTask, each tick the player's own skull countdown and the TaskManager.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { SkullType } = require("../dist/game/model/SkullType");

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

test("a skull two ticks from running out at the killing blow still costs every item", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(9070); p.setUsername("dying9070"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0));
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  for (let slot = 0; slot < 3; slot++) p.getInventory().setItem(slot, new core.Item(I.ABYSSAL_WHIP, 1));
  CombatFactory.skull(p, SkullType.WHITE_SKULL, 0);
  p.setSkullTimer(2); // two ticks of skull left
  p.appendDeath();
  for (let tick = 0; tick < 6; tick++) { p.processSkullTimer(); core.TaskManager.process(); }
  assert.equal(p.getInventory().getAmount(I.ABYSSAL_WHIP), 0, "skulled at the blow: no whip kept");
});
