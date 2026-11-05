// Run after `yarn build`: node --test tests/fractured-archive-vault-rewards.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core;
let Vault;
let Records;
let PlayerSave;
let next = 2400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  ({ PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave"));
  Vault = require("../plugins/minigames/tfa/Vault.FracturedArchive");
  Records = require("../plugins/minigames/tfa/Records.FracturedArchive");
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(4096, 5568);
  PM.emitServerStartup({});
});

after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("tfaqa" + next);
  player.setRegistered(true);
  player.setLocation(new core.Location(4127, 5574, 0));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
    for (const npc of [...core.World.getNpcs()]) if (npc?.getOwner?.() === player) core.World.getNpcs().remove(npc);
  });
  return { player, connection };
}

function vaultRoom(player) {
  const room = Object.create(Vault.VaultRoom.prototype);
  room.raid = { players: [player], slotOf: () => 0 };
  room.loot = new Map();
  room.sendChest = () => {};
  return room;
}

test("Orion is the cache's two-form follower family, logged under the base item", () => {
  const { PETS, petFamily } = require("../plugins/npcs/Pets.plugin").__internals;
  const orion = PETS.find((pet) => pet.enumName === "ORION");
  const robed = PETS.find((pet) => pet.enumName === "ORION_ROBED");
  assert.equal(orion.petId, core.CacheDefinitions.getNpcId("ocellus_pet"));
  assert.equal(orion.houseNpcId, core.CacheDefinitions.getNpcId("poh_ocellus_pet"));
  assert.equal(orion.itemId, core.ItemIdentifiers.ORION);
  assert.equal(orion.morphId, robed.petId);
  assert.equal(robed.petId, core.CacheDefinitions.getNpcId("ocellus_pet_variant_1"));
  assert.equal(robed.itemId, core.ItemIdentifiers.ORION_3);
  assert.equal(petFamily(orion), petFamily(robed));
  assert.equal(orion.familyItemId, core.ItemIdentifiers.ORION);
});

test("a chest Orion reaches ownership, the follower and the collection log exactly once", async (t) => {
  const { player } = actor(t);
  const room = vaultRoom(player);
  const loot = {
    unique: null,
    entries: [{ id: core.ItemIdentifiers.RONDACHE, amount: 1 }],
    pet: core.ItemIdentifiers.ORION,
    logged: false,
  };
  room.openChest(player, loot);
  assert.equal(loot.pet, null, "the chest no longer carries the pet item");
  assert.deepEqual(player.getAttribute("pets.owned"), [core.ItemIdentifiers.ORION]);
  assert.equal(player.getAttribute("pets:current")?.getId(), core.CacheDefinitions.getNpcId("ocellus_pet"));
  await new Promise(setImmediate);
  assert.equal(player.getAttribute("clog.items")[core.ItemIdentifiers.ORION], 1);
  assert.equal(player.getAttribute("clog.items")[core.ItemIdentifiers.RONDACHE], 1);

  room.openChest(player, loot);
  await new Promise(setImmediate);
  assert.equal(player.getAttribute("clog.items")[core.ItemIdentifiers.ORION], 1, "reopening logs nothing again");
});

test("ownership and the collection log survive a save after the chest", (t) => {
  const { player } = actor(t);
  const room = vaultRoom(player);
  const loot = { unique: null, entries: [], pet: core.ItemIdentifiers.ORION, logged: false };
  room.openChest(player, loot);

  const restored = actor(t);
  PlayerSave.fromPlayer(player).applyToPlayer(restored.player);
  PM.emitPlayerLogin({ player: restored.player, username: restored.player.getUsername(), isNewAccount: false });

  assert.deepEqual(restored.player.getAttribute("pets.owned"), [core.ItemIdentifiers.ORION]);
  assert.equal(restored.player.getAttribute("clog.items")[core.ItemIdentifiers.ORION], 1);
});

test("an actual rollLoot pet goes through toEntries and is delivered by the chest", async (t) => {
  const { player } = actor(t);
  t.mock.method(Math, "random", () => 0);
  const rolled = Vault.rollLoot();
  assert.equal(rolled.pet, "ocelluspet");
  const loot = Vault.toEntries(rolled);
  assert.equal(loot.pet, core.ItemIdentifiers.ORION);
  const room = vaultRoom(player);
  room.openChest(player, loot);
  await new Promise(setImmediate);
  assert.equal(player.getAttribute("pets:current")?.getId(), core.CacheDefinitions.getNpcId("ocellus_pet"));
  assert.equal(player.getAttribute("clog.items")[core.ItemIdentifiers.ORION], 1);
});

test("an actual rollLoot pet is delivered when unclaimed loot is banked", async (t) => {
  const { player } = actor(t);
  t.mock.method(Math, "random", () => 0);
  const loot = Vault.toEntries(Vault.rollLoot());
  const room = vaultRoom(player);
  room.loot.set(player.getUsername(), loot);
  room.bankUnclaimed(player);
  await new Promise(setImmediate);
  assert.equal(player.getAttribute("pets:current")?.getId(), core.CacheDefinitions.getNpcId("ocellus_pet"));
  assert.equal(player.getAttribute("clog.items")[core.ItemIdentifiers.ORION], 1);
  for (const entry of loot.entries) {
    assert.ok(player.getBank(core.Bank.getTabForItem(player, entry.id)).contains(entry.id), `banked ${entry.id}`);
  }
});

test("a missing Pets consumer cannot silently lose the earned pet", async (t) => {
  const { player } = actor(t);
  const original = PM.emitCustomEvent;
  t.after(() => { PM.emitCustomEvent = original; });
  PM.emitCustomEvent = function (name, event) {
    if (name === "pets:award") return;
    return original.call(this, name, event);
  };
  const room = vaultRoom(player);
  const loot = { unique: null, entries: [], pet: core.ItemIdentifiers.ORION, logged: false };
  room.openChest(player, loot);
  await new Promise(setImmediate);
  assert.equal(loot.pet, null);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.ORION), 1);
  assert.equal(player.getAttribute("clog.items")[core.ItemIdentifiers.ORION], 1);
});

test("an owned Orion is still a duplicate miss, not an extra item", async (t) => {
  const { player } = actor(t);
  const room = vaultRoom(player);
  room.openChest(player, { unique: null, entries: [], pet: core.ItemIdentifiers.ORION, logged: false });
  const before = player.getInventory().getAmount(core.ItemIdentifiers.ORION);
  const second = { unique: null, entries: [], pet: core.ItemIdentifiers.ORION, logged: false };
  room.openChest(player, second);
  await new Promise(setImmediate);
  assert.equal(second.pet, null);
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.ORION), before);
  assert.equal(player.getAttribute("clog.items")[core.ItemIdentifiers.ORION], 1);
});

test("the collection log's Fractured Archive count is its overall completion record", (t) => {
  const { player } = actor(t);
  Records.record(player, "overall", "completions");
  Records.record(player, "overall", "completions");
  const request = { player, category: "The Fractured Archive", count: null };
  PM.emitCustomEvent("collection-log:category-count", request);
  assert.equal(request.count, 2);

  // Asked directly: the Chambers' own plugin answers this event for its category.
  const other = { player, category: "Chambers of Xeric", count: null };
  Records.collectionLogCount(other);
  assert.equal(other.count, null);
});
