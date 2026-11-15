// Run after `yarn build`: node --test tests/black-mask-i-pvp-death.test.cjs
//
// Wiki, Black mask (i): "If lost on death in PvP situations, the mask will lose its imbued status,
// but the player will be reimbursed". A real PvP death (PlayerDeathTask.dropItems with a player
// killer in the Wilderness, then the kept items returned and "player:died"), every plugin loaded,
// real Players and Inventories; only the ground-item registration is recorded.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");

let core, I, Slayer, NmzCommon;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Slayer = require("../plugins/items/SlayerHelmet.plugin")._test;
  NmzCommon = require("../plugins/minigames/nightmarezone/Common.NightmareZone");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const WILDERNESS_10 = [3090, 3600, 0];
const EDGEVILLE = [3090, 3490, 0];

let next = 9400;
function player(t, at = WILDERNESS_10) {
  const ch = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(ch));
  p.setIndex(next++); p.setUsername("bmd" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(...at));
  t.after(() => p.setRegistered(false));
  return p;
}

/** A skulled death (nothing kept), as PlayerDeathTask runs it; returns the ground drops [owner, id, amount]. */
function die(t, victim, killer) {
  const drops = [];
  const original = ItemOnGroundManager.registerLocation;
  ItemOnGroundManager.registerLocation = (owner, item) => { drops.push([owner, item.getId(), item.getAmount()]); };
  t.after(() => { ItemOnGroundManager.registerLocation = original; });
  victim.setSkullTimer(500);
  const kept = PlayerDeathTask.dropItems(victim, killer, victim.getLocation());
  PlayerDeathTask.returnKeptItems(victim, kept);
  PM.emitCustomEvent("player:died", { player: victim, killer, itemsLost: true });
  ItemOnGroundManager.registerLocation = original;
  return drops;
}

test("a scroll-imbued mask lost to a PKer drops as the plain mask and gives the victim the scroll", (t) => {
  const victim = player(t);
  const killer = player(t);
  victim.getInventory().setItem(0, new core.Item(I.BLACK_MASK_10_I_, 1));
  const drops = die(t, victim, killer);
  assert.deepEqual(drops.filter(([, id]) => id !== I.BONES), [[killer, I.BLACK_MASK_10_, 1]], "the killer gets Black mask (10)");
  assert.equal(victim.getInventory().getAmount(I.BLACK_MASK_10_I_), 0);
  assert.equal(victim.getInventory().getAmount(I.SCROLL_OF_IMBUING), 1, "the scroll comes back");
  assert.equal(NmzCommon.points(victim), 0);
});

// Our cache marks Black mask (1)-(9) untradeable, which core would give back to the victim; the Wiki (Black mask
// infobox, Tradeable: Yes) and osrsreboxed-db list every charge level as tradeable, so the killer gets them too.
test("a partly charged mask (5) (i) lost to a PKer drops for the killer as Black mask (5), not back to the victim", (t) => {
  const victim = player(t);
  const killer = player(t);
  victim.getInventory().setItem(0, new core.Item(I.BLACK_MASK_5_I_, 1));
  const drops = die(t, victim, killer);
  assert.deepEqual(drops.filter(([, id]) => id !== I.BONES), [[killer, I.BLACK_MASK_5_, 1]], "the killer gets Black mask (5)");
  assert.equal(victim.getInventory().getAmount(I.BLACK_MASK_5_), 0, "the victim does not keep the plain mask");
  assert.equal(victim.getInventory().getAmount(I.BLACK_MASK_5_I_), 0);
  assert.equal(victim.getInventory().getAmount(I.SCROLL_OF_IMBUING), 1, "the scroll comes back");
});

test("a Nightmare Zone imbue is refunded in points, and the dropped mask carries no mark", (t) => {
  const victim = player(t);
  const killer = player(t);
  const mask = new core.Item(I.BLACK_MASK_I_, 1, { [Slayer.IMBUED_BY_NMZ_META]: true });
  victim.getEquipment().setItem(core.Equipment.HEAD_SLOT, mask);
  const drops = die(t, victim, killer);
  assert.deepEqual(drops, [[killer, I.BLACK_MASK, 1]]);
  assert.equal(mask.getMetaValue(Slayer.IMBUED_BY_NMZ_META), undefined, "no forged mark for the killer");
  assert.equal(NmzCommon.points(victim), 1_250_000, "the whole price back");
  assert.equal(victim.getInventory().getAmount(I.SCROLL_OF_IMBUING), 0, "no scroll as well");
});

/** A full backpack after the death: untradeables a death in the Wilderness gives back. */
function fillKept(victim) {
  for (let slot = 0; slot < 28; slot++) victim.getInventory().setItem(slot, new core.Item(I.FIRE_CAPE, 1));
}

test("with a full backpack after the death the scroll goes to the bank, never the death tile", (t) => {
  const victim = player(t);
  victim.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(I.BLACK_MASK_I_, 1));
  fillKept(victim);
  const drops = die(t, victim, player(t));
  assert.equal(victim.getInventory().getFreeSlots(), 0, "28 (broken) fire capes came back and fill it");
  assert.equal(victim.getInventory().getAmount(I.SCROLL_OF_IMBUING), 0);
  assert.equal(drops.some(([, id]) => id === I.SCROLL_OF_IMBUING), false, "nothing on the floor");
  const banked = core.Bank.getTabForItem(victim, I.SCROLL_OF_IMBUING);
  assert.equal(victim.getBank(banked).getAmount(I.SCROLL_OF_IMBUING), 1, "the scroll is banked");
});

test("with the bank full too the scroll lands where the victim respawned, a tick later", (t) => {
  const victim = player(t);
  victim.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(I.BLACK_MASK_I_, 1));
  fillKept(victim);
  const bank = victim.getBank(0);
  for (let slot = 0; bank.getFreeSlots() > 0; slot++) bank.setItem(slot, new core.Item(1000 + slot, 1));
  const drops = [];
  const original = ItemOnGroundManager.registerLocation;
  t.after(() => { ItemOnGroundManager.registerLocation = original; });
  die(t, victim, player(t));
  victim.moveTo(new core.Location(3222, 3218, 0)); // the respawn, as PlayerDeathTask moves after "player:died"
  ItemOnGroundManager.registerLocation = (owner, item, at) => { drops.push([owner, item.getId(), at.getX(), at.getY()]); };
  core.TaskManager.process();
  assert.deepEqual(drops, [[victim, I.SCROLL_OF_IMBUING, 3222, 3218]], "the victim's own, at the respawn point");
});

test("a protected mask, a monster's kill or a death outside the Wilderness keeps the imbue", (t) => {
  const protectedVictim = player(t);
  protectedVictim.getInventory().setItem(0, new core.Item(I.BLACK_MASK_I_, 1));
  const kept = PlayerDeathTask.dropItems(protectedVictim, player(t), protectedVictim.getLocation());
  assert.deepEqual(kept.map((item) => item.getId()), [I.BLACK_MASK_I_], "kept as one of the three");

  for (const [where, killer] of [[WILDERNESS_10, null], [EDGEVILLE, "player"]]) {
    const victim = player(t, where);
    const mask = new core.Item(I.BLACK_MASK_I_, 1);
    victim.getInventory().setItem(0, mask);
    const drops = die(t, victim, killer ? player(t) : null);
    assert.equal(drops.some(([, id]) => id === I.BLACK_MASK), false);
    assert.equal(mask.getId(), I.BLACK_MASK_I_, "still imbued (kept, or in the grave)");
    assert.equal(victim.getInventory().getAmount(I.SCROLL_OF_IMBUING), 0);
  }
});

test("Items Kept on Death shows the mask lost on a PvP death and kept otherwise", (t) => {
  const p = player(t);
  p.getInventory().setItem(0, new core.Item(I.BLACK_MASK_I_, 1));
  let lost = { item: p.getInventory().get(0), lost: false };
  PM.emitCustomEvent("items:lost-to-pvp-killer", lost);
  assert.equal(lost.lost, true);
  lost = { item: new core.Item(I.BLACK_MASK, 1), lost: false };
  PM.emitCustomEvent("items:lost-to-pvp-killer", lost);
  assert.equal(lost.lost, false, "a plain mask is tradeable already");
});
