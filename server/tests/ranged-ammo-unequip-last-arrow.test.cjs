// Run after `yarn build`: node --test tests/ranged-ammo-unequip-last-arrow.test.cjs
// A shot is paid as it leaves the bow (rsprox_transcripts/237/01156.txt), and lands on the floor later. Moving the
// stack mid-flight (unequip, bank, drop) cannot make it free, and the landed arrow drops as the arrow fired, with
// its meta. Real engine: every plugin loaded, a real Player, Equipment
// and Inventory, the real CombatFactory.decrementAmmo and TaskManager.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { RangedWeapon } = require("../dist/game/content/combat/ranged/RangedData");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");

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

let next = 9020;
function archer(t, bowId, bow, arrows) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("archer" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0));
  t.after(() => { core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(bowId, 1));
  p.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, arrows);
  p.getCombat().setRangedWeapon(bow);
  return p;
}

function fireThenUnequip(t, p, shots) {
  const drops = [];
  t.mock.method(ItemOnGroundManager, "registerLocation", (_player, item) => { drops.push([item.getId(), item.getAmount(), item.isPresetItem()]); });
  t.mock.method(Math, "random", () => 0.5); // every shot lands on the floor (no Ava's)
  CombatFactory.decrementAmmo(p, new core.Location(3223, 3218, 0), shots, 2);
  // Unequip (EquipPacketListener): the worn object itself moves to the empty pack slot.
  const worn = p.getEquipment().getItems()[core.Equipment.AMMUNITION_SLOT];
  p.getInventory().setItem(0, worn);
  p.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(-1, 0));
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  return drops;
}

function presetArrows(amount) {
  const arrows = new core.Item(I.RUNE_ARROW, amount);
  for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) arrows.setMetaValue(meta, true);
  return arrows;
}

test("the last arrow, unequipped mid-flight, lands as one rune arrow and keeps its meta", (t) => {
  const p = archer(t, I.MAGIC_SHORTBOW, RangedWeapon.MAGIC_SHORTBOW, presetArrows(1));
  const drops = fireThenUnequip(t, p, 1);
  assert.deepEqual(drops, [[I.RUNE_ARROW, 1, true]], "one preset rune arrow on the floor, not an emptied item");
  assert.equal(p.getInventory().getAmount(I.RUNE_ARROW), 0, "the pack's last arrow paid");
});

test("a dark bow double shot with one arrow left pays and drops just that one", (t) => {
  const p = archer(t, I.DARK_BOW, RangedWeapon.DARK_BOW, new core.Item(I.RUNE_ARROW, 1));
  const drops = fireThenUnequip(t, p, 2);
  assert.deepEqual(drops, [[I.RUNE_ARROW, 1, false]]);
  assert.equal(p.getInventory().getAmount(I.RUNE_ARROW), 0);
});

test("ammo banked or dropped mid-flight has already paid for the shot", (t) => {
  for (const amount of [50, 1]) {
    const p = archer(t, I.MAGIC_SHORTBOW, RangedWeapon.MAGIC_SHORTBOW, new core.Item(I.RUNE_ARROW, amount));
    const drops = [];
    t.mock.method(ItemOnGroundManager, "registerLocation", (_player, item) => { drops.push([item.getId(), item.getAmount()]); });
    t.mock.method(Math, "random", () => 0.5); // the shot lands on the floor (no Ava's)
    CombatFactory.decrementAmmo(p, new core.Location(3223, 3218, 0), 1, 2);
    // Banked (or dropped) before the arrow lands: whatever is left in the slot leaves the player.
    const moved = p.getEquipment().getItems()[core.Equipment.AMMUNITION_SLOT];
    const movedAmount = moved.getId() === I.RUNE_ARROW ? moved.getAmount() : 0;
    p.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(-1, 0));
    for (let i = 0; i < 3; i++) core.TaskManager.process();
    assert.equal(movedAmount, amount - 1, `${amount}: the fired arrow is no longer in the stack that was moved`);
    assert.deepEqual(drops, [[I.RUNE_ARROW, 1]], `${amount}: the fired arrow still lands`);
    t.mock.restoreAll();
  }
});
