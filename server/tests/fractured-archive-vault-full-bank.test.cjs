// Run after `yarn build`: node --test tests/fractured-archive-vault-full-bank.test.cjs
// Leaving the Fractured Archive's vault (or logging out in it) with loot unclaimed banks the loot. What a full
// bank can't hold goes to the inventory, and the rest is kept with the player (saved) and given at the next
// login with room: never deleted, and never dropped inside the raid's private area. Real engine: every plugin
// loaded, a real Player with a real bank and inventory, the vault room's own bankUnclaimed and the real login.
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
let next = 9840;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("vault" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages };
}

function preset(item) {
  item.setMetaValue(core.Item.UNTRADEABLE_META, true);
  item.setMetaValue(core.Item.UNBANKABLE_META, true);
  item.setMetaValue(core.Item.PRESET_META, true);
  return item;
}
const Vault = require("../plugins/minigames/tfa/Vault.FracturedArchive");

function fillBank(p) {
  const tab = p.getBank(core.Bank.getTabForItem(p, I.DRAGON_BONES));
  for (let id = 1000; tab.getFreeSlots() > 0; id += 2) tab.add(new core.Item(id, 1), false);
  return tab;
}

function vaultWith(p, entries) {
  return { loot: new Map([[p.getUsername(), { entries }]]) };
}

test("with a full bank the unclaimed loot goes to the inventory instead of vanishing", (t) => {
  const f = actor(t);
  fillBank(f.p);
  const room = vaultWith(f.p, [{ id: I.DRAGON_BONES, amount: 10 }]);
  Vault.VaultRoom.prototype.bankUnclaimed.call(room, f.p);
  assert.equal(f.inv.getAmount(I.DRAGON_BONES) + f.inv.getAmount(I.DRAGON_BONES + 1), 10, "noted or not, all ten");
  assert.equal(room.loot.has(f.p.getUsername()), false);
  assert.equal(f.messages.at(-1), "Your bank couldn't hold all of your unclaimed rewards from the Archive; the rest are in your inventory.");
});

test("with a full bank and a full inventory the rest is kept and given at the next login with room", (t) => {
  const f = actor(t);
  const tab = fillBank(f.p);
  for (let slot = 0; slot < 28; slot++) f.inv.setItem(slot, new core.Item(I.BRONZE_DAGGER, 1));
  const dropped = [];
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (...args) => { dropped.push(args); });
  const room = vaultWith(f.p, [{ id: I.DRAGON_BONES, amount: 10 }]);
  Vault.VaultRoom.prototype.bankUnclaimed.call(room, f.p);
  assert.equal(dropped.length, 0, "nothing on the floor");
  assert.deepEqual(f.p.getAttribute(Vault.HELD_ATTRIBUTE), [{ id: I.DRAGON_BONES, amount: 10 }]);
  assert.equal(f.messages.at(-1), "Your bank couldn't hold all of your unclaimed rewards from the Archive; the rest will be given to you when you have space.");
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.deepEqual(f.p.getAttribute(Vault.HELD_ATTRIBUTE), [{ id: I.DRAGON_BONES, amount: 10 }], "still no room: still kept");
  tab.resetItems?.();
  for (let slot = 0; slot < 28; slot++) f.inv.setItem(slot, new core.Item(-1, 0));
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.equal(f.p.getAttribute(Vault.HELD_ATTRIBUTE) ?? null, null);
  const banked = f.p.getBank(core.Bank.getTabForItem(f.p, I.DRAGON_BONES)).getAmount(I.DRAGON_BONES);
  const carried = f.inv.getAmount(I.DRAGON_BONES) + f.inv.getAmount(I.DRAGON_BONES + 1);
  assert.equal(banked + carried, 10, "all ten delivered");
});

test("a second vault's overflow joins rewards already held", (t) => {
  const f = actor(t);
  fillBank(f.p);
  for (let slot = 0; slot < 28; slot++) f.inv.setItem(slot, new core.Item(I.BRONZE_DAGGER, 1));
  f.p.setAttribute(Vault.HELD_ATTRIBUTE, [{ id: I.DRAGON_BONES, amount: 4 }]);
  Vault.VaultRoom.prototype.bankUnclaimed.call(vaultWith(f.p, [{ id: I.DRAGON_BONES, amount: 6 }]), f.p);
  const total = f.p.getAttribute(Vault.HELD_ATTRIBUTE).reduce((sum, entry) => sum + entry.amount, 0);
  assert.equal(total, 10);
});

test("with bank room everything is banked as before", (t) => {
  const f = actor(t);
  const room = vaultWith(f.p, [{ id: I.DRAGON_BONES, amount: 10 }]);
  Vault.VaultRoom.prototype.bankUnclaimed.call(room, f.p);
  assert.equal(f.p.getBank(core.Bank.getTabForItem(f.p, I.DRAGON_BONES)).getAmount(I.DRAGON_BONES), 10);
  assert.equal(f.inv.getAmount(I.DRAGON_BONES), 0);
  assert.equal(f.messages.at(-1), "Your unclaimed rewards from the Archive have been sent to your bank.");
});
