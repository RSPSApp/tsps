// Run after `yarn build`: node --test tests/barrows-death-durability.test.cjs
// Every Barrows piece was broken on every death, protected or not, PvM or PvP. Wiki (Items Kept on Death): an
// unprotected piece goes to the grave unbroken after a PvM death, and to the PKer as its broken version; a protected
// piece is kept as it is. Real engine: every plugin loaded, real Players, the real PlayerDeathTask.dropItems.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
let core, I, L;
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, "..")); PM.loadFromDirectory(path.resolve(__dirname, "../plugins")); core = PM.getCoreApi(); I = core.ItemIdentifiers; L = require("../plugins/items/LootKeys.plugin"); PM.emitServerStartup({}); });
after(() => PM.emitServerShutdown({}));
let next = 9010;
function wp(t) { const ch = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(ch)); p.setIndex(next++); p.setUsername("dk" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3100, 3600, 0)); t.after(() => p.setRegistered(false)); return p; }
const keysOf = (p) => [I.LOOT_KEY, I.LOOT_KEY_2, I.LOOT_KEY_3, I.LOOT_KEY_4, I.LOOT_KEY_5].reduce((n, id) => n + p.getInventory().getAmount(id), 0);
const Barrows = () => require("../plugins/items/BarrowsEquipment.plugin");
const stand = (p) => { p.setLocation(new core.Location(3222, 3218, 0)); return p; }; // Lumbridge, not the Wilderness
function dressed(p) {
  const kept = new core.Item(I.DHAROKS_PLATEBODY, 1);
  const lost = new core.Item(I.DHAROKS_PLATELEGS, 1);
  p.getEquipment().setItem(core.Equipment.BODY_SLOT, kept);
  p.getEquipment().setItem(core.Equipment.LEG_SLOT, lost);
  // Three pricier items take the kept slots after the platebody's place: an AGS and two dragon claws.
  p.getInventory().setItem(0, new core.Item(I.ARMADYL_GODSWORD, 1));
  p.getInventory().setItem(1, new core.Item(I.DRAGON_CLAWS, 1));
  return { kept, lost };
}
const broken = (item) => String(core.ItemDefinition.forId(item.getId()).getName()).endsWith(" 0");

test("a PvM death breaks no Barrows piece, kept or sent to the grave", (t) => {
  const victim = stand(wp(t));
  const { kept, lost } = dressed(victim);
  const keptItems = PlayerDeathTask.dropItems(victim, null, victim.getLocation());
  assert.equal(broken(kept) || broken(lost), false, "neither piece broken");
  assert.ok(keptItems.length > 0);
});

test("a PvP death breaks only the unprotected Barrows piece", (t) => {
  const killer = wp(t), victim = wp(t);
  const { kept, lost } = dressed(victim);
  const keptItems = PlayerDeathTask.dropItems(victim, killer, victim.getLocation());
  const wasKept = (item) => keptItems.includes(item);
  assert.notEqual(wasKept(kept), wasKept(lost), "one piece protected, the other lost");
  for (const item of [kept, lost]) assert.equal(broken(item), !wasKept(item), `${wasKept(item) ? "kept" : "lost"} piece`);
});
