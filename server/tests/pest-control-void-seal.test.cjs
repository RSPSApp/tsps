// Run after `yarn build`: node --test tests/pest-control-void-seal.test.cjs
// The Void seal's Rub in and out of a Pest Control game (rsprox.net recordings 4015 and 4017,
// docs/pest-control.md "Void seal").
"use strict";
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const path = require("node:path");

process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { GamevalKind } = require("../dist/game/cache/Gamevals");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");
const { World } = require("../dist/game/World");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");
const { Item } = require("../dist/game/model/Item");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const plugin = require("../plugins/minigames/PestControl.plugin");
const VoidSeal = require("../plugins/minigames/pestcontrol/VoidSeal.PestControl");

const core = PluginManager.getCoreApi();
const itemActions = {};
const api = new Proxy({
  core,
  getAreaManager: () => ({ areas: [] }),
  getObjectManager: () => ObjectManager,
  getRegionManager: () => RegionManager,
  getWorld: () => World,
  onItemAction(name, actions) { itemActions[name] = actions; },
}, { get: (object, key) => object[key] ?? (() => {}) });

const { MESSAGES } = VoidSeal._test;
const SEAL = (charges) => ItemIdentifiers[`VOID_SEAL_${charges}_`];
const matches = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load(); // the pests' defend seqs, as the server loads them
  RegionManager.init();
  RegionManager.loadMapFiles(2656, 2592);
  plugin.register(api);
});

after(() => { for (const match of matches) if (!match.ended) match.finish(false, "test over"); });

function realPlayer(location) {
  const player = new Player(null);
  const messages = [];
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => messages.push(text);
  player.getForcedLogoutTimer = () => ({ start() {} });
  player.requestLogout = () => {};
  player.setLocation(location.clone());
  return { player, messages };
}

/** A veteran game with one real player standing at (2668, 2575), as in recording 4017. */
function startMatch() {
  const boat = plugin._test.BOATS.find((entry) => entry.key === "veteran");
  const { player, messages } = realPlayer(boat.waitingLocation);
  const match = new plugin._test.PestControlMatch(boat, [player], () => {});
  matches.push(match);
  player.setLocation(new Location(2668, 2575, 0));
  messages.length = 0;
  return { player, messages, match };
}

function pest(match, x, y) {
  return match.spawnNpc(plugin._test.PEST_IDS.defiler[0][0], new Location(x, y, 0));
}

const pending = (npc) => npc.getCombat().getHitQueue().pendingDamage;

function rubInventory(player, charges, random) {
  player.getInventory().resetItems().setItem(4, new Item(SEAL(charges), 1));
  return VoidSeal._test.rub({ player, itemId: SEAL(charges), slot: 4, interfaceId: 149, clickType: 3, option: "Rub", handled: false }, random);
}

test("every Void seal(1)-(8) is hooked by name with Rub, the cache's inventory and worn option", () => {
  for (let charges = 1; charges <= 8; charges++) {
    const definition = core.CacheDefinitions.getItem(SEAL(charges));
    assert.equal(definition.name, `Void seal(${charges})`);
    assert.ok(definition.inventoryActions.includes("Rub"), `seal(${charges}) inventory Rub`);
    assert.equal(definition.params.get(451), "Rub", `seal(${charges}) worn Rub`);
    assert.deepEqual(Object.keys(itemActions[`Void seal(${charges})`]), ["Rub"]);
  }
  const names = (kind) => core.CacheDefinitions.getGamevals().namesOf(kind);
  assert.equal(names(GamevalKind.SEQ).get(VoidSeal._test.SEQ_RUB), "pest_magic_attack");
  assert.equal(names(GamevalKind.SPOTANIM).get(VoidSeal._test.SPOTANIM_PLAYER), "pest_spiral_attack_on_player");
  assert.equal(names(GamevalKind.SPOTANIM).get(VoidSeal._test.SPOTANIM_PEST), "pest_spiral_attack_on_enemy");
});

test("off the island the seal refuses and keeps its charge (rec 4015)", () => {
  const { player, messages } = realPlayer(new Location(2657, 2639, 0));
  assert.equal(rubInventory(player, 7), true);
  assert.deepEqual(messages, [MESSAGES.outside]);
  assert.equal(player.getInventory().getItems()[4].getId(), SEAL(7));
});

test("with no pest on or next to the player's tile it says so and keeps the charge (rec 4017)", () => {
  const { player, messages, match } = startMatch();
  const far = pest(match, 2670, 2575);
  assert.equal(rubInventory(player, 7), true);
  assert.deepEqual(messages, [MESSAGES.noMonsters]);
  assert.equal(player.getInventory().getItems()[4].getId(), SEAL(7));
  assert.equal(pending(far).length, 0);
});

test("a rub hits every pest within a tile for one 8-12 roll, not the knight or portals, and spends a charge", () => {
  const { player, messages, match } = startMatch();
  const sameTile = pest(match, 2668, 2575);
  const diagonal = pest(match, 2667, 2576);
  const beside = pest(match, 2669, 2574);
  const far = pest(match, 2668, 2577);
  const portal = [...match.portalByNpc.keys()][0];
  portal.setLocation(new Location(2669, 2572, 0));
  match.knight.setLocation(new Location(2667, 2574, 0));

  assert.equal(rubInventory(player, 7, () => 0.6), true);
  assert.deepEqual(messages, [MESSAGES.unleash]);
  assert.equal(player.getAnimation().getId(), VoidSeal._test.SEQ_RUB);
  assert.equal(player.getGraphic().getId(), VoidSeal._test.SPOTANIM_PLAYER);
  for (const npc of [sameTile, diagonal, beside]) {
    const hits = pending(npc);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].getDamage(), 11, "8 + floor(0.6 * 5)");
    assert.equal(hits[0].getSource(), null, "no source: live shows the others hitsplat, and no activity");
    assert.equal(npc.getGraphic().getId(), VoidSeal._test.SPOTANIM_PEST);
    assert.equal(npc.getBlockAnim(), 3921, "defiler_defend");
    assert.equal(npc.getAnimation()?.getId(), npc.getBlockAnim(), "the pest plays its defend seq (rec 4017 defiler_defend)");
  }
  for (const npc of [far, portal, match.knight]) assert.equal(pending(npc).length, 0);
  assert.equal(player.getInventory().getItems()[4].getId(), SEAL(6), "seal(7) becomes seal(6) in its slot");
});

test("the damage spans the Wiki's 8-12", () => {
  for (const [random, damage] of [[0, 8], [0.999, 12]]) {
    const { player, match } = startMatch();
    const npc = pest(match, 2668, 2576);
    rubInventory(player, 5, () => random);
    assert.equal(pending(npc)[0].getDamage(), damage);
  }
});

test("a pest larger than a tile is near when any tile under it is", () => {
  const npc = { getLocation: () => new Location(2665, 2573, 0), getSize: () => 3 };
  const { player } = realPlayer(new Location(2668, 2575, 0));
  assert.equal(VoidSeal._test.distanceTo(player, npc), 1);
});

test("the last charge, worn, dissolves the seal and empties the neck slot (rec 4017 tick 349)", () => {
  const { player, messages, match } = startMatch();
  const npc = pest(match, 2668, 2576);
  player.getEquipment().setItem(Equipment.AMULET_SLOT, new Item(SEAL(1), 1));
  const handled = VoidSeal._test.rub({ player, itemId: SEAL(1), slot: Equipment.AMULET_SLOT,
    interfaceId: Equipment.INVENTORY_INTERFACE_ID, clickType: 2, option: "Rub", handled: false });
  assert.equal(handled, true);
  assert.deepEqual(messages, [MESSAGES.unleash, MESSAGES.dissolve]);
  assert.equal(player.getEquipment().getItems()[Equipment.AMULET_SLOT].getId(), -1);
  assert.equal(pending(npc).length, 1);
});

test("worn seal(8) becomes seal(7) in the neck slot", () => {
  const { player, match } = startMatch();
  pest(match, 2667, 2575);
  player.getEquipment().setItem(Equipment.AMULET_SLOT, new Item(SEAL(8), 1));
  VoidSeal._test.rub({ player, itemId: SEAL(8), slot: Equipment.AMULET_SLOT,
    interfaceId: Equipment.INVENTORY_INTERFACE_ID, clickType: 2, option: "Rub", handled: false });
  assert.equal(player.getEquipment().getItems()[Equipment.AMULET_SLOT].getId(), SEAL(7));
});
