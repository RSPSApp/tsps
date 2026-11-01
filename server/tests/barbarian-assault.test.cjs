// Run after `yarn build`: node --test tests/barbarian-assault.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { Trading, TradeState } = require("../dist/game/content/Trading");
const { PluginManager } = require("../dist/plugins/PluginManager");

const core = PluginManager.getCoreApi();
const data = require("../plugins/minigames/barbarianassault/Data.BarbarianAssault");
const Items = require("../plugins/minigames/barbarianassault/Items.BarbarianAssault");
const Match = require("../plugins/minigames/barbarianassault/Match.BarbarianAssault");
const Shop = require("../plugins/minigames/barbarianassault/Shop.BarbarianAssault");

const RUNES = [554, 555, 556, 557, 558, 560, 562, 565, 21880];
const STACKABLE = new Set(RUNES);

// Item definitions normally come from the cache; stub the few this test uses.
ItemDefinition.forId = (id) => ({
  getId: () => id,
  getName: () => `item ${id}`,
  getExamine: () => "",
  isStackable: () => STACKABLE.has(id),
  isNoted: () => false,
  unNote: () => id,
  getNoteId: () => -1,
  getValue: () => 1,
  isTradeable: () => true,
  isSellable: () => true,
});

let nextIndex = 1;

function createPlayer(name) {
  const attributes = new Map();
  const messages = [];
  let status = PlayerStatus.NONE;
  let interfaceId = -1;
  const sender = new Proxy({}, {
    get: (_target, key) => {
      if (key === "sendInterfaceRemoval") {
        return () => {
          status = PlayerStatus.NONE;
          interfaceId = -1;
          return sender;
        };
      }
      return () => sender;
    },
  });
  const player = {
    messages,
    getUsername: () => name,
    getIndex: () => player.index,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => messages.push(message),
    getPacketSender: () => sender,
    getSession: () => ({ sendClientPacket: () => true }),
    getFrameUpdater: () => ({ clear() {} }),
    getStatus: () => status,
    setStatus: (next) => { status = next; },
    getInterfaceId: () => interfaceId,
    setInterfaceId: (next) => { interfaceId = next; },
    isPlayerBot: () => false,
    getHitpoints: () => player.hitpoints,
    setHitpoints: (hp) => { player.hitpoints = hp; },
    heal: (amount) => { player.hitpoints = Math.min(99, player.hitpoints + amount); },
    setPoisonDamage: () => {},
    setRunEnergy: () => {},
    getRunEnergy: () => 100,
    getLocation: () => new core.Location(1889, 5458, 0),
    getArea: () => player.area,
    setArea: (area) => { player.area = area; },
    moveTo: () => {},
    isPlayer: () => true,
    getAsPlayer: () => player,
    getCombat: () => ({ reset() {}, getHitQueue: () => ({ addPendingDamage() {} }) }),
    getEquipment: () => ({ get: () => null }),
    getFightType: () => ({ getStyle: () => 0 }),
    getSkillManager: () => ({ getMaxLevel: () => 99 }),
    hitpoints: 99,
    area: null,
    index: nextIndex++,
  };
  player.inventory = new core.Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  player.trading = new Trading(player);
  player.getTrading = () => player.trading;
  return player;
}

const api = {
  core,
  emitCustomEvent() {},
  registerNpcCombatMethodProvider() {},
};

function createMatch(roles) {
  const team = roles.map((role, index) => [createPlayer(`player${index}`), role]);
  const match = new Match.BarbarianAssaultMatch(api, team, () => {});
  for (const [player] of team) player.area = match.area;
  return { match, players: team.map(([player]) => player) };
}

function offer(player, itemId, amount) {
  const inventory = player.getInventory();
  const slot = inventory.getSlotForItemId(itemId);
  player.getTrading().handleItem(itemId, amount, slot, inventory, player.getTrading().getContainer());
}

before(() => {
  Items.init(api);
  Match.attachCombat(api);
});

test("the reward shop stock comes from the plugin source, not shops.json", () => {
  const shops = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/definitions/shops.json"), "utf8"));
  const generated = shops.find((shop) => shop.id === Shop.SHOP_ID);
  assert.ok(generated, "the generated shop row still exists");
  assert.deepEqual(generated.originalStock, [], "the generated row keeps its canonical empty stock");

  const source = Shop.shopSource();
  assert.equal(source.length, 1);
  const [shop] = source;
  assert.equal(shop.id, Shop.SHOP_ID);
  assert.equal(shop.currency, "HONOUR POINTS");
  assert.equal(shop.originalStock.length, data.SHOP_STOCK.length);
  for (const expected of data.SHOP_STOCK) {
    const entry = shop.originalStock.find((item) => item.id === expected.id);
    assert.ok(entry, `plugin source stocks ${expected.id}`);
    assert.equal(entry.price, expected.price);
    assert.equal(entry.amount, 100);
  }
});

test("the plugin registers its reward shop as a shops definition source", () => {
  const sources = [];
  Shop.attach({
    registerDefinitionSource: (type, source) => sources.push({ type, source }),
    onCustomEvent() {},
  });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].type, "shops");
  assert.equal(sources[0].source.name, "barbarian-assault");
  assert.equal(sources[0].source.load()[0].originalStock.length, data.SHOP_STOCK.length);
});

test("a match refuses teammate trades and arena runes cannot leave the match", () => {
  const { match, players } = createMatch([data.ROLE.ATTACKER, data.ROLE.COLLECTOR]);
  const [attacker, collector] = players;

  // A player's own runes are a separate, untagged stack.
  attacker.getInventory().adds(554, 500);
  Items.give(attacker, 554, 500);
  const runes = attacker.getInventory().getItems().filter((item) => item.getId() === 554)
    .find((item) => item.isUntradeable());
  assert.equal(runes.getAmount(), 500);
  assert.equal(runes.isUntradeable(), true, "arena supplies carry the untradeable meta");
  assert.equal(runes.getMetaValue(Items.ARENA_ITEM_META), true);
  assert.equal(Items.isTracked(attacker, 554), true);

  // The match area refuses the request before any trade state changes.
  attacker.getTrading().requestTrade(collector);
  assert.ok(!attacker.getTrading().getInteract(), "the request was refused before state changed");
  assert.ok(attacker.messages.includes("You cannot trade here."));

  // Even a trade opened outside the area cannot offer the arena copies.
  const outsider = createPlayer("outsider");
  Items.give(attacker, 555, 500);
  attacker.area = null;
  outsider.area = null;
  attacker.getTrading().requestTrade(outsider);
  outsider.getTrading().requestTrade(attacker);
  assert.equal(attacker.getTrading().getState(), TradeState.TRADE_SCREEN, "the trade window opened");
  offer(attacker, 555, 500);
  assert.equal(attacker.getInventory().getAmount(555), 500, "the untradeable runes stay put");
  assert.ok(attacker.messages.includes("You cannot trade that item."));

  Items.clear(attacker);
  assert.equal(attacker.getInventory().getAmount(554), 500, "cleanup leaves the player's own runes");
  assert.equal(attacker.getInventory().getAmount(555), 0, "cleanup removes every arena rune stack");

  Items.give(attacker, 556, 500);
  Items.stripRoleItems(attacker);
  assert.equal(attacker.getInventory().getAmount(554), 500, "reconnect cleanup leaves the player's own runes");
  assert.equal(attacker.getInventory().getAmount(556), 0, "reconnect cleanup removes arena runes");

  attacker.getTrading().closeTrade();
  match.finish(false);
});

test("the Queen egg chain passes each egg to the next role and fires an omega shot", () => {
  const { match, players } = createMatch([
    data.ROLE.ATTACKER,
    data.ROLE.COLLECTOR,
    data.ROLE.DEFENDER,
    data.ROLE.HEALER,
  ]);
  const [attacker, collector, defender, healer] = players;
  match.wave = 10;

  Items.give(collector, data.ITEM.YELLOW_EGG, 1);
  assert.equal(match.handleItemOnPlayer(collector, healer, data.ITEM.YELLOW_EGG), true);
  assert.equal(collector.getInventory().getAmount(data.ITEM.YELLOW_EGG), 0);
  assert.equal(healer.getInventory().getAmount(data.ITEM.YELLOW_EGG), 1);
  assert.equal(Items.isTracked(collector, data.ITEM.YELLOW_EGG), false);
  assert.equal(Items.isTracked(healer, data.ITEM.YELLOW_EGG), true);
  // Cleanup follows the holder, not the collector who first picked the egg up.
  Items.clear(collector);
  assert.equal(healer.getInventory().getAmount(data.ITEM.YELLOW_EGG), 1);

  assert.equal(match.handleItemOnObject(healer, data.ITEM.YELLOW_EGG, data.OBJECT.POISON_CRATER[0]), true);
  assert.equal(healer.getInventory().getAmount(data.ITEM.POISONED_EGG), 1);

  assert.equal(match.handleItemOnPlayer(healer, attacker, data.ITEM.POISONED_EGG), true);
  Items.give(attacker, data.ITEM.SPIKES, 1);
  assert.equal(match.handleItemOnItem(attacker, data.ITEM.SPIKES, data.ITEM.POISONED_EGG), true);
  assert.equal(attacker.getInventory().getAmount(data.ITEM.SPIKED_POISONED_EGG), 1);

  assert.equal(match.handleItemOnPlayer(attacker, defender, data.ITEM.SPIKED_POISONED_EGG), true);
  assert.equal(match.handleItemOnObject(defender, data.ITEM.SPIKED_POISONED_EGG, data.OBJECT.LAVA_CRATER[0]), true);
  assert.equal(defender.getInventory().getAmount(data.ITEM.OMEGA_EGG), 1);

  assert.equal(match.handleItemOnPlayer(defender, collector, data.ITEM.OMEGA_EGG), true);
  assert.equal(collector.getInventory().getAmount(data.ITEM.OMEGA_EGG), 1);
  assert.equal(match.handleItemOnObject(collector, data.ITEM.OMEGA_EGG, data.OBJECT.EGG_HOPPER[0]), true);
  assert.equal(match.cannon.omega, 1);

  const queen = {
    __baType: "queen",
    hitpoints: 250,
    getHitpoints() { return queen.hitpoints; },
    setHitpoints(hp) { queen.hitpoints = hp; },
    getLocation: () => new core.Location(1886, 5408, 0),
    getDefinition: () => ({ getHitpoints: () => 250 }),
    getAttackAnim: () => -1,
    performAnimation() {},
  };
  match.queen = queen;
  match.queenSpawned = true;
  match.npcs.add(queen);
  match.npcMeta.set(queen, { type: "queen", hp: 250 });

  assert.equal(match.fireCannon(collector), true);
  assert.equal(match.cannon.omega, 0);
  assert.equal(match.queenHits, 1);
  assert.ok(queen.hitpoints < 250, "the omega egg damages the Queen");

  match.finish(false);
});
