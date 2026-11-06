// Run after `yarn build`: node --test tests/fractured-archive-vault-full-bank.test.cjs
// Leaving the Fractured Archive's vault (or logging out in it) with loot unclaimed banks the loot. What a full
// bank can't hold goes to the inventory, then to the floor outside where the player arrives, and is never
// deleted. Real engine: every plugin loaded, a real Player with a real bank and inventory, and the vault room's
// own bankUnclaimed.
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
const Shared = require("../plugins/minigames/tfa/Shared.FracturedArchive");

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
  assert.equal(f.messages.at(-1), "Your bank couldn't hold all of your unclaimed rewards from the Archive; the rest are with you.");
});

test("with a full bank and a full inventory the rest goes to the floor outside, owned by the player", (t) => {
  const f = actor(t);
  fillBank(f.p);
  for (let slot = 0; slot < 28; slot++) f.inv.setItem(slot, new core.Item(I.BRONZE_DAGGER, 1));
  const dropped = [];
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (owner, item, location) => { dropped.push([owner, item.getId(), item.getAmount(), location]); });
  const room = vaultWith(f.p, [{ id: I.DRAGON_BONES, amount: 10 }]);
  Vault.VaultRoom.prototype.bankUnclaimed.call(room, f.p);
  assert.equal(dropped.length, 1);
  const [owner, id, amount, location] = dropped[0];
  assert.equal(owner, f.p);
  assert.deepEqual([id, amount], [I.DRAGON_BONES, 10]);
  assert.deepEqual([location.getX(), location.getY(), location.getZ()], [Shared.TILE.LEAVE.x, Shared.TILE.LEAVE.y, Shared.TILE.LEAVE.z]);
});

test("with bank room everything is banked as before", (t) => {
  const f = actor(t);
  const room = vaultWith(f.p, [{ id: I.DRAGON_BONES, amount: 10 }]);
  Vault.VaultRoom.prototype.bankUnclaimed.call(room, f.p);
  assert.equal(f.p.getBank(core.Bank.getTabForItem(f.p, I.DRAGON_BONES)).getAmount(I.DRAGON_BONES), 10);
  assert.equal(f.inv.getAmount(I.DRAGON_BONES), 0);
  assert.equal(f.messages.at(-1), "Your unclaimed rewards from the Archive have been sent to your bank.");
});
