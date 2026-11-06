// Run after `yarn build`: node --test tests/restricted-input.test.cjs
//
// Free preset copies do not pay for charges, go into storage that keeps no metadata, or sell on the
// Grand Exchange, and a plain item is taken from its own stack rather than a preset one beside it.
//
// Clicks go through ClientConnection.dispatch as decoded packets. Preset copies come from applyPreset
// with a custom preset, as the save prompt builds one, though the prompt is not driven. Seams: the
// Grand Exchange opens with the real ::ge command, and deposit-all calls Bank.depositItems directly
// without the bank open. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { Presetable } = require("../dist/game/content/presets/Presetable");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const Presets = require("../plugins/modes/pvp/Presets.PvpMode");
const Sang = require("../plugins/items/SanguinestiStaff.plugin");
const Trident = require("../plugins/items/Trident.plugin");
const Quiver = require("../plugins/items/DizanasQuiver.plugin");
const Pouch = require("../plugins/items/runepouch/Common.RunePouch");

const HOME = [3222, 3218];
const PRESET_TEXT = "Preset items cannot be used for this.";
const QUIVER_SLOT = (387 << 16) | 28;
const FILL_OR_SWAP = 2;
const GE = 465;
const GE_SIDE = 467;
const OFFERS = "grand-exchange-offers";
const PLUS_100 = 5;
const STAFF = 20;

let core;
let I;
let next = 7500;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("restrictqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const sender = p.getPacketSender();
  const senderMessage = sender.sendMessage.bind(sender);
  sender.sendMessage = (message) => {
    messages.push(message);
    return senderMessage(message);
  };
  const playerMessage = p.sendMessage.bind(p);
  p.sendMessage = (message) => {
    messages.push(message);
    return playerMessage(message);
  };
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), eq: p.getEquipment(), messages };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

async function useOn(f, slot, targetSlot) {
  await send(f, {
    type: "inventory_use_on", slot, itemId: f.inv.getItems()[slot].getId(),
    target: { kind: "inventory", slot: targetSlot, itemId: f.inv.getItems()[targetSlot].getId() },
  });
}

const item = (id, amount = 1) => new core.Item(id, amount);
const put = (f, value, slot) => f.inv.setItem(slot, value);
const plainOf = (f, id) => f.inv.getItems().filter((held) => held.getId() === id && !held.isPresetItem()).reduce((sum, held) => sum + held.getAmount(), 0);
const presetOf = (f, id) => f.inv.getItems().filter((held) => held.getId() === id && held.isPresetItem()).reduce((sum, held) => sum + held.getAmount(), 0);
const slotOfPlain = (f, id) => f.inv.getItems().findIndex((held) => held.getId() === id && !held.isPresetItem());
const slotOfPreset = (f, id) => f.inv.getItems().findIndex((held) => held.getId() === id && held.isPresetItem());

/** `amount` preset copies of each id from the real load, in the lowest slots. */
function presets(f, ...entries) {
  const preset = new Presetable("qa", entries.map(([id, amount]) => item(id, amount)), [], [99, 99, 99, 99, 99, 99, 99], MagicSpellbook.NORMAL, false);
  Presets.applyPreset(f.p, preset);
  for (const [id, amount] of entries) assert.equal(presetOf(f, id), amount, `marked copies of ${id}`);
}

// ------------------------------------------------------------------ Sanguinesti staff

test("Sanguinesti: preset blood runes do not charge it", async (t) => {
  const control = actor(t);
  put(control, item(I.BLOOD_RUNE, 200), 0);
  put(control, item(I.SANGUINESTI_STAFF_UNCHARGED_), STAFF);
  await useOn(control, 0, STAFF);
  assert.equal(Sang._test.chargesOf(control.inv.getItems()[STAFF]), 100, "control: charged");
  assert.equal(plainOf(control, I.BLOOD_RUNE), 0, "control: the runes went");

  const f = actor(t);
  presets(f, [I.BLOOD_RUNE, 300]);
  put(f, item(I.SANGUINESTI_STAFF_UNCHARGED_), STAFF);
  await useOn(f, 0, STAFF);
  assert.equal(Sang._test.chargesOf(f.inv.getItems()[STAFF]), 0, "no charges");
  assert.equal(presetOf(f, I.BLOOD_RUNE), 300, "nothing taken");
  assert.ok(f.messages.includes(PRESET_TEXT), "says why");
});

test("Sanguinesti: with both stacks, the plain runes pay and a click on the preset stack refuses", async (t) => {
  const setup = () => {
    const f = actor(t);
    presets(f, [I.BLOOD_RUNE, 300]);
    put(f, item(I.BLOOD_RUNE, 200), 5);
    put(f, item(I.SANGUINESTI_STAFF_UNCHARGED_), STAFF);
    return f;
  };
  const plainClick = setup();
  await useOn(plainClick, 5, STAFF);
  assert.equal(Sang._test.chargesOf(plainClick.inv.getItems()[STAFF]), 100, "charged from the plain stack");
  assert.deepEqual([plainOf(plainClick, I.BLOOD_RUNE), presetOf(plainClick, I.BLOOD_RUNE)], [0, 300]);

  const presetClick = setup();
  await useOn(presetClick, 0, STAFF);
  assert.equal(Sang._test.chargesOf(presetClick.inv.getItems()[STAFF]), 0, "no charges");
  assert.deepEqual([plainOf(presetClick, I.BLOOD_RUNE), presetOf(presetClick, I.BLOOD_RUNE)], [200, 300]);
  assert.ok(presetClick.messages.includes(PRESET_TEXT), "says why");
});

// ------------------------------------------------------------------ Trident

test("Trident: preset death runes do not charge it, and plain ones beside them pay", async (t) => {
  const recipe = () => Trident._test.RECIPES.find((entry) => entry.primaryName === "coins");
  const give = (f) => {
    put(f, item(I.CHAOS_RUNE, 10), 10);
    put(f, item(I.FIRE_RUNE, 50), 11);
    put(f, item(I.COINS, 100), 12);
    put(f, item(recipe().unchargedId), STAFF);
  };
  const charges = (f) => Trident._test.getCharges(f.inv.getItems()[STAFF]);

  const control = actor(t);
  put(control, item(I.DEATH_RUNE, 10), 0);
  give(control);
  await useOn(control, 0, STAFF);
  assert.equal(charges(control), 10, "control: charged");
  assert.equal(plainOf(control, I.DEATH_RUNE), 0, "control: the runes went");

  const only = actor(t);
  presets(only, [I.DEATH_RUNE, 300]);
  give(only);
  await useOn(only, 10, STAFF);
  assert.equal(charges(only), 0, "only preset death runes: no charges");
  assert.equal(presetOf(only, I.DEATH_RUNE), 300, "nothing taken");
  assert.equal(plainOf(only, I.CHAOS_RUNE), 10, "not the chaos runes either");
  assert.ok(only.messages.includes(PRESET_TEXT), "says why");

  const both = actor(t);
  presets(both, [I.DEATH_RUNE, 300]);
  put(both, item(I.DEATH_RUNE, 10), 5);
  give(both);
  await useOn(both, 5, STAFF);
  assert.equal(charges(both), 10, "charged from the plain stack");
  assert.deepEqual([plainOf(both, I.DEATH_RUNE), presetOf(both, I.DEATH_RUNE)], [0, 300]);
});

// ------------------------------------------------------------------ Rune pouch

test("Rune pouch: preset runes are refused, and plain ones beside them go in alone", async (t) => {
  const control = actor(t);
  put(control, item(I.BLOOD_RUNE, 200), 0);
  put(control, item(I.RUNE_POUCH), 1);
  await useOn(control, 0, 1);
  assert.equal(Pouch.amountOf(control.p, I.BLOOD_RUNE), 200, "control: stored");
  assert.equal(plainOf(control, I.BLOOD_RUNE), 0, "control: the runes went");

  const only = actor(t);
  presets(only, [I.BLOOD_RUNE, 300]);
  put(only, item(I.RUNE_POUCH), 5);
  await useOn(only, 0, 5);
  assert.equal(Pouch.amountOf(only.p, I.BLOOD_RUNE), 0, "nothing stored");
  assert.equal(presetOf(only, I.BLOOD_RUNE), 300, "nothing taken");
  assert.ok(only.messages.includes(PRESET_TEXT), "says why");

  const both = actor(t);
  presets(both, [I.BLOOD_RUNE, 300]);
  put(both, item(I.BLOOD_RUNE, 200), 4);
  put(both, item(I.RUNE_POUCH), 5);
  await useOn(both, 4, 5);
  assert.equal(Pouch.amountOf(both.p, I.BLOOD_RUNE), 200, "the plain stack went in");
  assert.deepEqual([plainOf(both, I.BLOOD_RUNE), presetOf(both, I.BLOOD_RUNE)], [0, 300]);
});

// ------------------------------------------------------------------ Dizana's quiver

test("Dizana's quiver: Fill and Swap refuse worn preset ammo", async (t) => {
  const quiverClick = (f) => send(f, { type: "widget_action", widgetId: QUIVER_SLOT, groupId: 387, childId: 28, buttonNum: FILL_OR_SWAP });
  const worn = (f) => f.eq.getItems()[core.Equipment.AMMUNITION_SLOT];

  const control = actor(t);
  control.eq.setItem(core.Equipment.AMMUNITION_SLOT, item(I.DRAGON_ARROW, 100));
  await quiverClick(control);
  assert.equal(Quiver.stored(control.p)?.amount, 100, "control: filled");
  assert.equal(worn(control).getId(), -1, "control: taken off");

  const fill = actor(t);
  presets(fill, [I.DRAGON_ARROW, 100]);
  const preset = fill.inv.getItems()[0].clone();
  put(fill, item(-1, 0), 0);
  fill.eq.setItem(core.Equipment.AMMUNITION_SLOT, preset);
  await quiverClick(fill);
  assert.equal(Quiver.stored(fill.p), null, "nothing stored");
  assert.equal(worn(fill).isPresetItem(), true, "the worn ammo stays preset");
  assert.equal(worn(fill).getAmount(), 100);
  assert.ok(fill.messages.includes(PRESET_TEXT), "says why");

  const swap = actor(t);
  presets(swap, [I.DRAGON_ARROW, 100]);
  const worn2 = swap.inv.getItems()[0].clone();
  put(swap, item(-1, 0), 0);
  swap.eq.setItem(core.Equipment.AMMUNITION_SLOT, worn2);
  swap.p.setAttribute(Quiver.ATTRIBUTE, { id: I.RUNE_ARROW, amount: 50 });
  await quiverClick(swap);
  assert.deepEqual(Quiver.stored(swap.p), { id: I.RUNE_ARROW, amount: 50 }, "the stored ammo stays");
  assert.equal(worn(swap).isPresetItem(), true, "the worn ammo stays preset");
  assert.ok(swap.messages.includes(PRESET_TEXT), "says why");
});

// ------------------------------------------------------------------ Grand Exchange

async function geButton(f, groupId, childId, slot, itemId) {
  await send(f, { type: "widget_action", widgetId: (groupId << 16) | childId, groupId, childId, buttonNum: 1, slot, itemId });
}

function openGe(f) {
  PM.emitCommand({ player: f.p, raw: "ge", base: "ge", parts: ["ge"], handled: false });
  assert.equal(f.p.getInterfaceId(), GE, "the GE opened");
}

const placed = (f) => Object.values(f.p.getAttribute(OFFERS) ?? {});

test("Grand Exchange: a preset stack cannot be offered", async (t) => {
  const f = actor(t);
  presets(f, [I.DRAGON_ARROW, 300]);
  openGe(f);
  await geButton(f, GE_SIDE, 0, 0, I.DRAGON_ARROW);
  await geButton(f, GE, 30);
  assert.equal(placed(f).length, 0, "no offer");
  assert.equal(presetOf(f, I.DRAGON_ARROW), 300, "nothing taken");
  assert.ok(f.messages.includes(PRESET_TEXT), "says why");
});

test("Grand Exchange: a plain sale takes the plain stack, not a preset one before it", async (t) => {
  const f = actor(t);
  presets(f, [I.DRAGON_ARROW, 300]);
  assert.equal(slotOfPreset(f, I.DRAGON_ARROW), 0, "the preset stack comes first");
  put(f, item(I.DRAGON_ARROW, 100), 5);
  openGe(f);
  await geButton(f, GE_SIDE, 0, 5, I.DRAGON_ARROW);
  await geButton(f, GE, 34, PLUS_100);
  await geButton(f, GE, 30);
  assert.equal(placed(f).length, 1, "offer placed");
  assert.deepEqual([plainOf(f, I.DRAGON_ARROW), presetOf(f, I.DRAGON_ARROW)], [0, 300]);
});

test("Grand Exchange: unstackable, the plain copy sells and the preset one stays", async (t) => {
  const f = actor(t);
  presets(f, [I.ABYSSAL_WHIP, 1]);
  put(f, item(I.ABYSSAL_WHIP), 5);
  openGe(f);
  await geButton(f, GE_SIDE, 0, 5, I.ABYSSAL_WHIP);
  await geButton(f, GE, 30);
  assert.equal(placed(f).length, 1, "offer placed");
  assert.deepEqual([plainOf(f, I.ABYSSAL_WHIP), presetOf(f, I.ABYSSAL_WHIP)], [0, 1]);
});

test("Grand Exchange: if the plain stack leaves before Confirm, the preset one does not pay", async (t) => {
  const f = actor(t);
  presets(f, [I.DRAGON_ARROW, 300]);
  put(f, item(I.DRAGON_ARROW, 100), 5);
  openGe(f);
  await geButton(f, GE_SIDE, 0, 5, I.DRAGON_ARROW);
  put(f, item(-1, 0), 5);
  await geButton(f, GE, 30);
  assert.equal(placed(f).length, 0, "no offer");
  assert.equal(presetOf(f, I.DRAGON_ARROW), 300, "nothing taken");
  assert.ok(f.messages.includes(PRESET_TEXT), "says why");
});

// ------------------------------------------------------------------ deposit-all

const bankAmount = (f, id) => f.p.getBank(core.Bank.getTabForItem(f.p, id)).getAmount(id);

/** Plain copies at `plainSlot` and preset copies at `presetSlot`, moved there with real packets. */
async function bothAt(t, id, plainAmount, presetAmount, plainSlot, presetSlot) {
  const f = actor(t);
  presets(f, [id, presetAmount]);
  if (presetSlot !== 0) await send(f, { type: "inventory_move", from: 0, to: presetSlot, widgetId: 3214 });
  put(f, item(id, plainAmount), plainSlot);
  assert.equal(slotOfPlain(f, id), plainSlot);
  assert.equal(slotOfPreset(f, id), presetSlot);
  return f;
}

test("Deposit-all banks the plain stack and leaves the preset one, in either slot order", async (t) => {
  const control = actor(t);
  put(control, item(I.DRAGON_ARROW, 100), 5);
  core.Bank.depositItems(control.p, control.inv, true);
  assert.equal(bankAmount(control, I.DRAGON_ARROW), 100, "control: banked");
  assert.equal(control.inv.getAmount(I.DRAGON_ARROW), 0, "control: the stack went");

  for (const [plainSlot, presetSlot] of [[5, 0], [0, 5]]) {
    const f = await bothAt(t, I.DRAGON_ARROW, 100, 300, plainSlot, presetSlot);
    core.Bank.depositItems(f.p, f.inv, true);
    assert.equal(bankAmount(f, I.DRAGON_ARROW), 100, `plain at ${plainSlot}: the plain stack is banked`);
    assert.deepEqual([plainOf(f, I.DRAGON_ARROW), presetOf(f, I.DRAGON_ARROW)], [0, 300], `plain at ${plainSlot}: the preset stack stays`);
  }
});

test("Deposit-all with unstackable copies banks the plain one, in either slot order", async (t) => {
  for (const [plainSlot, presetSlot] of [[5, 0], [0, 5]]) {
    const f = await bothAt(t, I.ABYSSAL_WHIP, 1, 1, plainSlot, presetSlot);
    core.Bank.depositItems(f.p, f.inv, true);
    assert.equal(bankAmount(f, I.ABYSSAL_WHIP), 1, `plain at ${plainSlot}: banked`);
    assert.deepEqual([plainOf(f, I.ABYSSAL_WHIP), presetOf(f, I.ABYSSAL_WHIP)], [0, 1], `plain at ${plainSlot}: the preset copy stays`);
  }
});

test("Deposit-all with only preset copies moves nothing", async (t) => {
  const f = actor(t);
  presets(f, [I.DRAGON_ARROW, 300]);
  core.Bank.depositItems(f.p, f.inv, true);
  assert.equal(bankAmount(f, I.DRAGON_ARROW), 0, "nothing banked");
  assert.equal(presetOf(f, I.DRAGON_ARROW), 300, "the preset stack stays");
});

test("Deposit-all while searching updates the search tab as the deposit buttons do", async (t) => {
  const searching = (f, syntax) => {
    f.p.setSearchSyntax(syntax);
    f.p.setSearchingBank(true);
    return f.p.getBank(core.Bank.BANK_SEARCH_TAB_INDEX);
  };
  // The deposit buttons' path, as the control: switchItem with the clicked slot.
  const control = actor(t);
  const controlTab = searching(control, "dragon arrow");
  put(control, item(I.DRAGON_ARROW, 100), 5);
  control.inv.switchItem(control.p.getBank(0), item(I.DRAGON_ARROW, 100), false, 5, false);
  assert.equal(controlTab.getAmount(I.DRAGON_ARROW), 100, "control: a match joins the search tab");

  const f = await bothAt(t, I.DRAGON_ARROW, 100, 300, 5, 0);
  const tab = searching(f, "dragon arrow");
  put(f, item(I.RUNE_ARROW, 50), 6);
  core.Bank.depositItems(f.p, f.inv, true);
  assert.equal(tab.getAmount(I.DRAGON_ARROW), 100, "the plain stack shows, not the preset one");
  assert.equal(tab.getAmount(I.RUNE_ARROW), 0, "what does not match the search stays out");
  assert.equal(bankAmount(f, I.DRAGON_ARROW), 100, "banked once");
  assert.equal(bankAmount(f, I.RUNE_ARROW), 50, "and the other stack too");
  assert.equal(f.p.getBank(0).getAmount(I.DRAGON_ARROW) + f.p.getBank(core.Bank.BANK_SEARCH_TAB_INDEX).getAmount(I.DRAGON_ARROW), 200, "the search tab mirrors, it holds no extra");
});
