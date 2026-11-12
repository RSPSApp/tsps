// Run after `yarn build`: node --test tests/presets-bank-carried-full.test.cjs
// Loading a preset banks everything carried (bare bank.add) and then resets the inventory and equipment. With the bank
// full, `add` dropped each item, so they were deleted; and it never asked the bank's own refusal hooks, so a loot key
// (refused at the bank) went in too. Now the load is refused, with nothing moved, when either would happen. Real
// engine: every plugin loaded with PvpMode, a real Player, Bank and Inventory, the real applyPreset.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
require("./helpers/pvp-mode-on.cjs");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Bank } = require("../dist/game/model/container/impl/Bank");
const { Presetable } = require("../dist/game/content/presets/Presetable");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");

let core;
let I;
let Presets;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Presets = require("../plugins/modes/pvp/Presets.PvpMode");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 8980;
function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("preset" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0));
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => p.setRegistered(false));
  return { p, messages };
}
const preset = () => new Presetable("qa", [new core.Item(I.SHARK, 5)], [], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);

test("a full bank refuses the load and keeps what was carried", (t) => {
  const f = actor(t);
  assert.ok(Presets.isEnabled(), "PvpMode presets are on");
  f.p.getInventory().setItem(0, new core.Item(I.ABYSSAL_WHIP, 1));
  t.mock.method(Bank, "freeSlots", () => 0);
  Presets.applyPreset(f.p, preset());
  assert.equal(f.p.getInventory().getAmount(I.ABYSSAL_WHIP), 1, "the whip is still carried, not deleted");
  assert.equal(f.p.getInventory().getAmount(I.SHARK), 0, "the preset was not loaded");
  assert.ok(f.messages.some((m) => /bank space/.test(m)));
});

test("an item the bank refuses (a loot key) stops the load instead of being banked", (t) => {
  const f = actor(t);
  f.p.getInventory().setItem(0, new core.Item(I.LOOT_KEY, 1));
  Presets.applyPreset(f.p, preset());
  assert.equal(f.p.getInventory().getAmount(I.LOOT_KEY), 1, "still carried");
  const banked = Array.from({ length: 10 }, (_, tab) => f.p.getBank(tab)?.getAmount?.(I.LOOT_KEY) ?? 0).reduce((a, b) => a + b, 0);
  assert.equal(banked, 0, "and not in the bank");
});

test("with room, the load banks what was carried as before", (t) => {
  const f = actor(t);
  f.p.getInventory().setItem(0, new core.Item(I.ABYSSAL_WHIP, 1));
  Presets.applyPreset(f.p, preset());
  assert.equal(f.p.getInventory().getAmount(I.SHARK), 5, "the preset is loaded");
  assert.equal(f.p.getBank(Bank.getTabForItem(f.p, I.ABYSSAL_WHIP)).getAmount(I.ABYSSAL_WHIP), 1, "the whip is banked");
});

test("a full bank holding the item's placeholder still takes it, so the load goes ahead", (t) => {
  const f = actor(t);
  f.p.getInventory().setItem(0, new core.Item(I.ABYSSAL_WHIP, 1));
  const tab = f.p.getBank(Bank.getTabForItem(f.p, I.ABYSSAL_WHIP));
  tab.setItem(0, new core.Item(I.ABYSSAL_WHIP, 0)); // the whip's placeholder
  t.mock.method(Bank, "freeSlots", () => 0);
  Presets.applyPreset(f.p, preset());
  assert.equal(f.p.getInventory().getAmount(I.SHARK), 5, "the preset is loaded");
  assert.equal(tab.getAmount(I.ABYSSAL_WHIP), 1, "the whip fills its placeholder");
});

// A custom preset's non-spawnable item must come from a real copy. Counting the preset's own spawned copy (which is
// wiped, not banked) let the load take nothing and spawn a plain, tradeable item: free preset items became real ones.
test("a custom preset does not turn a preset copy into a real item", (t) => {
  const f = actor(t);
  const ags = I.ARMADYL_GODSWORD;
  const copy = new core.Item(ags, 1);
  copy.setMetaValue(core.Item.UNTRADEABLE_META, true);
  copy.setMetaValue(core.Item.UNBANKABLE_META, true);
  copy.setMetaValue(core.Item.PRESET_META, true);
  f.p.getInventory().setItem(0, copy);
  const custom = new Presetable("mine", [new core.Item(ags, 1)], [], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);
  Presets.applyPreset(f.p, custom);
  const plain = [...f.p.getInventory().getValidItems(), ...f.p.getEquipment().getValidItems()]
    .filter((item) => item.getId() === ags && !item.isPresetItem());
  assert.equal(plain.length, 0, "no real godsword appears");
  assert.ok(f.messages.some((m) => /non-spawnable item/.test(m)), f.messages.join(" | "));
});

test("a custom preset still takes a real non-spawnable item from the bank", (t) => {
  const f = actor(t);
  const ags = I.ARMADYL_GODSWORD;
  f.p.getBank(0).add(new core.Item(ags, 1), false);
  const custom = new Presetable("mine", [new core.Item(ags, 1)], [], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);
  Presets.applyPreset(f.p, custom);
  assert.equal(f.p.getInventory().getAmount(ags), 1, "the godsword is carried");
  const banked = Array.from({ length: 10 }, (_, tab) => f.p.getBank(tab)?.getAmount?.(ags) ?? 0).reduce((a, b) => a + b, 0);
  assert.equal(banked, 0, "and taken from the bank");
});

// A preset copy can reach the bank (::maxgear banks worn items without the bank's check, or an older save). The load
// counted and took bank copies by id, so it counted that copy, could take it, and gave back a plain item.
test("a preset copy in the bank is not counted or taken by a custom preset", (t) => {
  const ags = I.ARMADYL_GODSWORD;
  const presetCopy = () => {
    const copy = new core.Item(ags, 1);
    for (const meta of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) copy.setMetaValue(meta, true);
    return copy;
  };
  const custom = () => new Presetable("mine", [new core.Item(ags, 1)], [], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);
  const plainCarried = (p) => [...p.getInventory().getValidItems(), ...p.getEquipment().getValidItems()]
    .filter((item) => item.getId() === ags && !item.isPresetItem()).length;

  const only = actor(t);
  only.p.getBank(0).setItem(0, presetCopy());
  Presets.applyPreset(only.p, custom());
  assert.equal(plainCarried(only.p), 0, "no real godsword is made from the banked copy");
  assert.ok(only.messages.some((m) => /non-spawnable item/.test(m)), only.messages.join(" | "));
  assert.equal(only.p.getBank(0).getItems()[0].isPresetItem(), true, "the copy is left in the bank");

  const both = actor(t);
  both.p.getBank(0).setItem(0, presetCopy());
  both.p.getBank(0).setItem(1, new core.Item(ags, 1));
  Presets.applyPreset(both.p, custom());
  assert.equal(plainCarried(both.p), 1, "the real godsword is carried");
  const bank = both.p.getBank(0).getItems();
  assert.equal(bank[0].getId(), ags, "the preset copy stays in the bank");
  assert.equal(bank[0].isPresetItem(), true);
  assert.equal(bank.filter((item) => item?.getId() === ags && !item.isPresetItem() && item.getAmount() > 0).length, 0, "the real one was taken");
});

// The preset saves each item with its meta (charges). Loading took any copy from the bank by id but gave back a clone
// carrying the saved meta, so a charged item came back full on every reload. It now keeps the taken copy's own meta.
test("a custom preset gives back the real item as it is, not as it was saved", (t) => {
  const f = actor(t);
  const ags = I.ARMADYL_GODSWORD;
  const saved = new core.Item(ags, 1);
  saved.setMetaValue("test-charges", 11000);
  const real = new core.Item(ags, 1);
  real.setMetaValue("test-charges", 100);
  f.p.getBank(0).add(real, false);
  const custom = new Presetable("charged", [saved], [], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);
  Presets.applyPreset(f.p, custom);
  const loaded = f.p.getInventory().getValidItems().find((item) => item.getId() === ags);
  assert.ok(loaded, "the item is carried");
  assert.equal(loaded.getMetaValue("test-charges"), 100, "with the bank copy's charges, not the saved ones");
});

// One id can sit in several bank stacks: different meta, a legacy split of plain stacks, or a carried stack banked
// beside one with meta. Loading took the amount from the first stack only but still spawned the preset's full amount,
// so the total grew on every reload. Each case loads a preset needing 100 dragon knives (stackable, not spawnable).
const knifeTotal = (p) => {
  const id = I.DRAGON_KNIFE;
  const bank = Array.from({ length: 10 }, (_, tab) => p.getBank(tab)?.getAmount?.(id) ?? 0).reduce((a, b) => a + b, 0);
  return bank + p.getInventory().getAmount(id) + p.getEquipment().getAmount(id);
};
const knifePreset = () => new Presetable("knives", [new core.Item(I.DRAGON_KNIFE, 100)], [], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);
const metaKnives = (amount) => {
  const item = new core.Item(I.DRAGON_KNIFE, amount);
  item.setMetaValue("test-mark", 1);
  return item;
};
for (const [name, setup, total] of [
  ["60 with meta and 60 plain banked", (p) => { p.getBank(0).add(metaKnives(60), false); p.getBank(0).add(new core.Item(I.DRAGON_KNIFE, 60), false); }, 120],
  ["two plain stacks of 60 (a legacy split)", (p) => { p.getBank(0).setItem(0, new core.Item(I.DRAGON_KNIFE, 60)); p.getBank(0).setItem(1, new core.Item(I.DRAGON_KNIFE, 60)); }, 120],
  ["70 plain carried and 40 with meta banked", (p) => { p.getBank(0).add(metaKnives(40), false); p.getInventory().setItem(0, new core.Item(I.DRAGON_KNIFE, 70)); }, 110],
]) {
  test(`a custom preset needing more than one stack keeps the total: ${name}`, (t) => {
    const f = actor(t);
    assert.equal(new core.Item(I.DRAGON_KNIFE, 1).getDefinition().isStackable(), true, "dragon knives stack");
    setup(f.p);
    assert.equal(knifeTotal(f.p), total);
    Presets.applyPreset(f.p, knifePreset());
    assert.equal(f.p.getInventory().getAmount(I.DRAGON_KNIFE), 100, "the preset's 100 are carried");
    assert.equal(knifeTotal(f.p), total, "and none were made: the rest stay banked");
    Presets.applyPreset(f.p, knifePreset());
    assert.equal(knifeTotal(f.p), total, "a reload keeps the total too");
  });
}

test("a worn preset stack from two stacks wears the first and carries the rest, each with its own meta", (t) => {
  const f = actor(t);
  f.p.getBank(0).add(metaKnives(60), false);
  f.p.getBank(0).add(new core.Item(I.DRAGON_KNIFE, 60), false);
  const worn = new Presetable("worn knives", [], [new core.Item(I.DRAGON_KNIFE, 100)], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);
  Presets.applyPreset(f.p, worn);
  const weapon = f.p.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  assert.equal(weapon.getId(), I.DRAGON_KNIFE);
  assert.equal(weapon.getAmount(), 60, "the first stack is worn");
  assert.equal(weapon.getMetaValue("test-mark"), 1, "with its own meta");
  const carried = f.p.getInventory().getValidItems().filter((item) => item.getId() === I.DRAGON_KNIFE);
  assert.deepEqual(carried.map((item) => [item.getAmount(), item.getMetaValue("test-mark") ?? null]), [[40, null]], "the plain rest is carried");
  assert.equal(knifeTotal(f.p), 120, "and the total is kept");
});
