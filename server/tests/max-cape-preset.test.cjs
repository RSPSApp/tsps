// Run after `yarn build`: node --test tests/max-cape-preset.test.cjs
//
// Free preset items must not become ordinary items through a max cape. Items come from the real
// preset producer; the use and the answer go through ClientConnection.dispatch: a native fixture.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const Capes = require("../plugins/items/skillcapes/Common.SkillCapes");
const Presets = require("../plugins/modes/pvp/Presets.PvpMode");

const HOME = [3222, 3218];
const YES = 1;
const PRESET_TEXT = "Preset items cannot be used for this.";

let core;
let I;
let next = 5000;

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
  p.setUsername("capepreset" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), messages };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const useOn = (f, slot, targetSlot) => send(f, {
  type: "inventory_use_on", slot, itemId: f.inv.getItems()[slot].getId(),
  target: { kind: "inventory", slot: targetSlot, itemId: f.inv.getItems()[targetSlot].getId() },
});
const answerYes = (f) => send(f, {
  type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: YES,
});
const pending = (f) => core.MultiChatboxPrompt.getPending(f.p);
const plain = (id) => new core.Item(id, 1);

/** A copy from the real producer, out of the named global preset that really carries it. */
function presetCopy(presetName, id) {
  const source = Presets.getGlobalPresetByName(presetName);
  assert.ok(source, `the ${presetName} preset exists`);
  const carried = [...source.getInventory(), ...source.getEquipment()].some((item) => item?.getId?.() === id);
  assert.ok(carried, `the ${presetName} preset carries item ${id}`);
  const item = Presets._test.spawnPresetItem(plain(id), source);
  assert.equal(item.isPresetItem(), true, "the producer marked the copy");
  return item;
}

const isRestricted = (item) => item.isPresetItem() || item.isUnbankable() || item.isUntradeable();
const plainCount = (f, id) => f.inv.getItems().filter((item) => item?.getId() === id && !isRestricted(item)).length;
const restrictedCount = (f, id) => f.inv.getItems().filter((item) => item?.getId() === id && isRestricted(item)).length;

function capeAndHood(f) {
  f.inv.setItem(0, plain(Capes.MAX.cape));
  f.inv.setItem(1, plain(Capes.MAX.hood));
}

function assertUntouched(f, itemId) {
  assert.equal(plainCount(f, Capes.MAX.cape), 1, "the max cape is kept");
  assert.equal(plainCount(f, Capes.MAX.hood), 1, "the hood is kept");
  assert.equal(restrictedCount(f, itemId), 1, "the preset copy is kept, still restricted");
  assert.equal(f.inv.getAmount(Capes.COMBINED_BY_ITEM.get(itemId).cape), 0, "nothing is made");
}

test("every preset cape that can combine is refused at the prompt, used either way round", async (t) => {
  const obtainable = [
    ["Main Rune", I.FIRE_CAPE],
    ["Main Barrage", I.SARADOMIN_CAPE],
    ["Obby Mauler", I.ZAMORAK_CAPE],
    ["G Mauler (R)", I.AVAS_ACCUMULATOR],
  ];
  for (const [presetName, id] of obtainable) {
    const combined = Capes.COMBINED_BY_ITEM.get(id);
    assert.ok(combined, `item ${id} combines with a max cape`);

    const control = actor(t);
    capeAndHood(control);
    control.inv.setItem(2, plain(id));
    await useOn(control, 2, 0);
    assert.ok(pending(control), "control: a real item is asked about");
    await answerYes(control);
    assert.equal(plainCount(control, combined.cape), 1, "control: it combines");
    assert.equal(control.inv.getAmount(id), 0, "control: the item is consumed");

    for (const [used, usedWith] of [[2, 0], [0, 2]]) {
      const f = actor(t);
      capeAndHood(f);
      f.inv.setItem(2, presetCopy(presetName, id));
      await useOn(f, used, usedWith);
      assert.equal(pending(f), null, "no prompt");
      assert.equal(f.messages.at(-1), PRESET_TEXT);
      assertUntouched(f, id);
    }
  }
});

test("with a preset and a real fire cape, Yes consumes the real one wherever they lie", async (t) => {
  const combined = () => Capes.COMBINED_BY_ITEM.get(I.FIRE_CAPE);
  const control = actor(t);
  capeAndHood(control);
  control.inv.setItem(3, plain(I.FIRE_CAPE));
  await useOn(control, 3, 0);
  await answerYes(control);
  assert.equal(plainCount(control, combined().cape), 1, "control: only a real cape combines");

  const f = actor(t);
  capeAndHood(f);
  f.inv.setItem(2, presetCopy("Main Rune", I.FIRE_CAPE));
  f.inv.setItem(3, plain(I.FIRE_CAPE));
  await useOn(f, 3, 0);
  assert.ok(pending(f), "the real cape is asked about");
  await answerYes(f);
  assert.equal(plainCount(f, combined().cape), 1, "it combines");
  assert.equal(plainCount(f, I.FIRE_CAPE), 0, "the real cape is the one consumed");
  assert.equal(restrictedCount(f, I.FIRE_CAPE), 1, "the preset copy stays, restricted");

  const swapped = actor(t);
  capeAndHood(swapped);
  swapped.inv.setItem(2, presetCopy("Main Rune", I.FIRE_CAPE));
  swapped.inv.setItem(3, plain(I.FIRE_CAPE));
  await useOn(swapped, 3, 0);
  await send(swapped, { type: "inventory_move", from: 2, to: 3, widgetId: 3214 });
  await answerYes(swapped);
  assert.equal(plainCount(swapped, I.FIRE_CAPE), 0, "after a swap, still the real one");
  assert.equal(restrictedCount(swapped, I.FIRE_CAPE), 1, "and the preset copy stays");
});

test("Yes takes nothing if only a preset copy is left", async (t) => {
  const start = async (f) => {
    capeAndHood(f);
    f.inv.setItem(2, presetCopy("Main Rune", I.FIRE_CAPE));
    f.inv.setItem(3, plain(I.FIRE_CAPE));
    await useOn(f, 3, 0);
    assert.ok(pending(f), "the real cape is asked about");
  };
  const control = actor(t);
  await start(control);
  await answerYes(control);
  assert.equal(plainCount(control, Capes.COMBINED_BY_ITEM.get(I.FIRE_CAPE).cape), 1, "control: the real cape combines");

  const f = actor(t);
  await start(f);
  f.inv.deleteAtSlot(3, 1);
  await answerYes(f);
  assertUntouched(f, I.FIRE_CAPE);
});

test("a restricted max cape or hood is refused too, though no preset carries one", async (t) => {
  const copy = (id) => Presets._test.spawnPresetItem(plain(id), Presets.getGlobalPresetPool()[0]);
  const control = actor(t);
  capeAndHood(control);
  control.inv.setItem(2, plain(I.FIRE_CAPE));
  await useOn(control, 0, 2);
  assert.ok(pending(control), "control: a real cape and hood are asked about");

  const cape = actor(t);
  cape.inv.setItem(0, copy(Capes.MAX.cape));
  cape.inv.setItem(1, plain(Capes.MAX.hood));
  cape.inv.setItem(2, plain(I.FIRE_CAPE));
  await useOn(cape, 0, 2);
  assert.equal(pending(cape), null, "no prompt for a restricted max cape");
  assert.equal(cape.messages.at(-1), PRESET_TEXT);

  const hood = actor(t);
  hood.inv.setItem(0, plain(Capes.MAX.cape));
  hood.inv.setItem(1, copy(Capes.MAX.hood));
  hood.inv.setItem(2, plain(I.FIRE_CAPE));
  await useOn(hood, 2, 0);
  if (pending(hood)) await answerYes(hood);
  assert.equal(plainCount(hood, Capes.COMBINED_BY_ITEM.get(I.FIRE_CAPE).cape), 0, "nothing made from a restricted hood");
  assert.equal(plainCount(hood, I.FIRE_CAPE), 1, "the real cape is kept");
  assert.equal(plainCount(hood, Capes.MAX.cape), 1, "the max cape is kept");
});
