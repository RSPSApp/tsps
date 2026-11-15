// Run after `yarn build`: node --test tests/black-mask-i-uncharge.test.cjs
//
// Uncharge on a black mask (i) gives back what its imbue cost (Wiki, Black mask (i)): a mask the
// Nightmare Zone imbued refunds its points, a scroll-imbued one (or one with no mark, from an older
// save) gives the scroll of imbuing back. Every plugin is loaded; real Player, real Inventory, the
// real scroll imbue (item-on-item) and the real Nightmare Zone Imbue.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, I, Slayer, NmzCommon, Rewards;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Slayer = require("../plugins/items/SlayerHelmet.plugin")._test;
  NmzCommon = require("../plugins/minigames/nightmarezone/Common.NightmareZone");
  Rewards = require("../plugins/minigames/nightmarezone/Rewards.NightmareZone");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9300;
function player(t) {
  const ch = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(ch));
  p.setIndex(next++); p.setUsername("bmi" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3222, 3218, 0));
  t.after(() => p.setRegistered(false));
  return p;
}

/** Uncharge, then Yes. (the prompt's own answer). */
function uncharge(p, slot) {
  const item = p.getInventory().getItems()[slot];
  assert.equal(Slayer.unimbue({ player: p, item }), true, "Uncharge asks");
  Slayer.removeImbue(p, item, slot);
  return item;
}

test("a scroll-imbued black mask (i) gives the scroll back, never Nightmare Zone points", (t) => {
  const p = player(t);
  const inv = p.getInventory();
  inv.setItem(0, new core.Item(I.BLACK_MASK_10_, 1));
  inv.setItem(1, new core.Item(I.SCROLL_OF_IMBUING, 1));
  const event = { player: p, usedItem: inv.get(1), usedItemId: I.SCROLL_OF_IMBUING, usedItemSlot: 1,
    usedWithItem: inv.get(0), usedWithItemId: I.BLACK_MASK_10_, usedWithItemSlot: 0, handled: false };
  PM.emitItemOnItem(event);
  assert.equal(inv.get(0).getId(), I.BLACK_MASK_10_I_, "the scroll imbues it");
  assert.equal(inv.getAmount(I.SCROLL_OF_IMBUING), 0);

  uncharge(p, 0);
  assert.equal(inv.get(0).getId(), I.BLACK_MASK_10_, "back to the charged plain mask");
  assert.equal(inv.getAmount(I.SCROLL_OF_IMBUING), 1, "the scroll comes back");
  assert.equal(NmzCommon.points(p), 0, "no points");
});

test("a Nightmare Zone imbue is marked on the mask, and Uncharge refunds its points", (t) => {
  const p = player(t);
  const inv = p.getInventory();
  inv.setItem(0, new core.Item(I.BLACK_MASK, 1));
  NmzCommon.addPoints(p, 1_250_000);
  Rewards.upgrades({ player: p, slot: 0, opId: 1 });
  assert.equal(inv.get(0).getId(), I.BLACK_MASK_I_, "imbued at the chest");
  assert.equal(NmzCommon.points(p), 0);
  assert.equal(inv.get(0).getMetaValue(Slayer.IMBUED_BY_NMZ_META), true, "marked as the Nightmare Zone's");

  uncharge(p, 0);
  assert.equal(inv.get(0).getId(), I.BLACK_MASK);
  assert.equal(NmzCommon.points(p), 1_250_000, "the whole price back");
  assert.equal(inv.getAmount(I.SCROLL_OF_IMBUING), 0, "no scroll");
  assert.equal(inv.get(0).getMetaValue(Slayer.IMBUED_BY_NMZ_META), undefined, "the mark goes with the imbue");
});

test("the Nightmare Zone mark survives a Slayer helmet and back", (t) => {
  const p = player(t);
  const inv = p.getInventory();
  inv.setItem(0, new core.Item(I.BLACK_MASK, 1));
  NmzCommon.addPoints(p, 1_250_000);
  Rewards.upgrades({ player: p, slot: 0, opId: 1 });
  const helm = new core.Item(I.SLAYER_HELMET_I_, 1, { [Slayer.IMBUED_BY_NMZ_META]: true });
  inv.setItem(0, helm);
  inv.setItem(1, new core.Item(-1, 0));
  Slayer.disassemble({ player: p, item: helm });
  const mask = inv.getItems().find((item) => item?.getId?.() === I.BLACK_MASK_I_);
  assert.ok(mask, "the imbued mask comes out");
  assert.equal(mask.getMetaValue(Slayer.IMBUED_BY_NMZ_META), true);
});

test("an unmarked black mask (i) from an older save gives a scroll, and nothing with no room for it", (t) => {
  const p = player(t);
  const inv = p.getInventory();
  inv.setItem(0, new core.Item(I.BLACK_MASK_I_, 1));
  for (let slot = 1; slot < 28; slot++) inv.setItem(slot, new core.Item(I.EARMUFFS, 1));
  uncharge(p, 0);
  assert.equal(inv.get(0).getId(), I.BLACK_MASK_I_, "no room for the scroll: it stays imbued");
  assert.equal(NmzCommon.points(p), 0);
  inv.setItem(27, new core.Item(-1, 0));
  uncharge(p, 0);
  assert.equal(inv.get(0).getId(), I.BLACK_MASK);
  assert.equal(inv.getAmount(I.SCROLL_OF_IMBUING), 1);
  assert.equal(NmzCommon.points(p), 0, "never points without the mark");
});
