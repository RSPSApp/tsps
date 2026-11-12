// Run after `yarn build`: node --test tests/blue-moon-frozen-weapon-preset.test.cjs
// Blue Moon's freeze kept the taken weapon as { id, amount } and gave back a fresh one, so a preset AGS (PvP presets)
// came back plain and tradeable, and a charged weapon lost its charges. The weapon's meta comes back with it now,
// also through the logout-and-login path. Real engine: every plugin loaded, a real Player and Equipment.
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
let Blue;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Blue = require("../plugins/bosses/moonsofperil/BlueMoon.MoonsOfPeril")._test;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function fighter(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(8945); p.setUsername("moon8945"); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  return p;
}

function presetAgs() {
  const ags = new core.Item(I.ARMADYL_GODSWORD, 1);
  for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) ags.setMetaValue(meta, true);
  return ags;
}

test("a frozen preset weapon comes back as a preset copy, in the hands or after a relog", (t) => {
  const p = fighter(t);
  const slot = core.Equipment.WEAPON_SLOT;
  p.getEquipment().setItem(slot, presetAgs());
  const fight = { player: p, state: {} };
  assert.equal(Blue.takeWeapon(fight), true);
  assert.equal(p.getEquipment().getItems()[slot].getId(), -1, "taken from the hands");
  Blue.giveWeapon(p, fight.state.weapon);
  const back = p.getEquipment().getItems()[slot];
  assert.equal(back.getId(), I.ARMADYL_GODSWORD);
  assert.equal(back.isPresetItem(), true, "still a preset copy");
  assert.equal(back.isUntradeable(), true);

  // Frozen at logout: the saved attribute goes through JSON and comes back at login.
  Blue.takeWeapon(fight);
  const saved = JSON.parse(JSON.stringify(p.getAttribute(Blue.FROZEN_WEAPON_ATTRIBUTE)));
  Blue.giveWeapon(p, saved);
  assert.equal(p.getEquipment().getItems()[slot].isPresetItem(), true, "still a preset copy after a relog");
});

test("with the hands and the pack full, a preset weapon lands at the feet, not in the bank", (t) => {
  const p = fighter(t);
  const slot = core.Equipment.WEAPON_SLOT;
  p.getEquipment().setItem(slot, presetAgs());
  const fight = { player: p, state: {} };
  Blue.takeWeapon(fight);
  p.getEquipment().setItem(slot, new core.Item(I.ABYSSAL_WHIP, 1));
  for (let i = 0; i < 28; i++) p.getInventory().setItem(i, new core.Item(I.LOGS, 1));
  Blue.giveWeapon(p, fight.state.weapon);
  assert.equal(p.getBank(0).getAmount(I.ARMADYL_GODSWORD), 0, "never into the bank");
  const { World } = require("../dist/game/World");
  const ground = [...World.getItems().values()].filter((g) => g?.getItem().getId() === I.ARMADYL_GODSWORD);
  assert.equal(ground.length, 1, "an AGS at the feet");
  assert.equal(ground[0].getItem().isPresetItem(), true, "still a preset copy");
});

test("a two-handed weapon comes back to the pack, not the hands, when a shield was put on meanwhile", (t) => {
  const p = fighter(t);
  const slot = core.Equipment.WEAPON_SLOT;
  p.getEquipment().setItem(slot, new core.Item(I.ARMADYL_GODSWORD, 1)); // two-handed
  const fight = { player: p, state: {} };
  Blue.takeWeapon(fight);
  p.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(I.DRAGONFIRE_SHIELD, 1));
  Blue.giveWeapon(p, fight.state.weapon);
  assert.equal(p.getEquipment().getItems()[slot].getId(), -1, "the hands stay empty: no godsword with a shield");
  assert.equal(p.getInventory().getAmount(I.ARMADYL_GODSWORD), 1, "the godsword is in the pack");
  assert.equal(p.getEquipment().getItems()[core.Equipment.SHIELD_SLOT].getId(), I.DRAGONFIRE_SHIELD);
});

test("with the hands, the pack and the bank full, a bankable weapon lands at the feet instead of vanishing", (t) => {
  const p = fighter(t);
  const slot = core.Equipment.WEAPON_SLOT;
  p.getEquipment().setItem(slot, new core.Item(I.ARMADYL_GODSWORD, 1));
  const fight = { player: p, state: {} };
  Blue.takeWeapon(fight);
  p.getEquipment().setItem(slot, new core.Item(I.ABYSSAL_WHIP, 1));
  for (let i = 0; i < 28; i++) p.getInventory().setItem(i, new core.Item(I.LOGS, 1));
  const tab = p.getBank(0);
  for (let id = 1000; tab.getFreeSlots() > 0; id += 2) tab.add(new core.Item(id, 1), false);
  const { World } = require("../dist/game/World");
  const before = [...World.getItems().values()].filter((g) => g?.getItem().getId() === I.ARMADYL_GODSWORD).length;
  Blue.giveWeapon(p, fight.state.weapon);
  assert.equal(p.getBank(0).getAmount(I.ARMADYL_GODSWORD), 0, "no room in the bank");
  const after = [...World.getItems().values()].filter((g) => g?.getItem().getId() === I.ARMADYL_GODSWORD).length;
  assert.equal(after - before, 1, "an AGS at the feet");
  assert.equal(p.getAttribute(Blue.FROZEN_WEAPON_ATTRIBUTE), null);
});

test("with the hands and the pack full and room in the bank, a bankable weapon goes to the bank", (t) => {
  const p = fighter(t);
  const slot = core.Equipment.WEAPON_SLOT;
  p.getEquipment().setItem(slot, new core.Item(I.ARMADYL_GODSWORD, 1));
  const fight = { player: p, state: {} };
  Blue.takeWeapon(fight);
  p.getEquipment().setItem(slot, new core.Item(I.ABYSSAL_WHIP, 1));
  for (let i = 0; i < 28; i++) p.getInventory().setItem(i, new core.Item(I.LOGS, 1));
  Blue.giveWeapon(p, fight.state.weapon);
  assert.equal(p.getBank(0).getAmount(I.ARMADYL_GODSWORD), 1, "in the bank");
});
