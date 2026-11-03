// Run after `yarn build`: node --test tests/abyssal-tentacle.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const AbyssalTentacle = require("../plugins/items/AbyssalTentacle.plugin");

const poisoned = [];
AbyssalTentacle.register({
  core: {
    Equipment,
    ItemIdentifiers: ItemIds,
    CombatFactory: { poisonEntity: (target, severity, orb) => poisoned.push({ target, severity, orb }) },
  },
  onServerStartup: (handler) => handler(),
  onItemOnItem() {},
  onCombatHitResolved() {},
});

function item(id) {
  return {
    id,
    getId() { return this.id; },
    setId(next) { this.id = next; },
  };
}

function createPlayer(weapon = null) {
  const equipment = new Array(14).fill(null).map(() => item(0));
  if (weapon) equipment[Equipment.WEAPON_SLOT] = weapon;
  return {
    getEquipment: () => ({ getItems: () => equipment }),
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
}

function strike(player, { accurate = true, damage = 5 } = {}) {
  AbyssalTentacle._test.onHitResolved({
    attacker: player,
    target: {},
    hit: { isAccurate: () => accurate, getTotalDamage: () => damage },
  });
}

test("a successful hit has a 25% chance to poison for 4 damage", () => {
  poisoned.length = 0;
  const player = createPlayer(item(ItemIds.ABYSSAL_TENTACLE));
  const original = Math.random;
  try {
    Math.random = () => 0.24;
    strike(player);
    assert.equal(poisoned.length, 1);
    assert.equal(poisoned[0].severity, 4);
    assert.equal(poisoned[0].orb, 1);
    Math.random = () => 0.9;
    strike(player);
    assert.equal(poisoned.length, 1, "outside the 25% roll");
  } finally {
    Math.random = original;
  }
});

test("the abyssal tentacle (or) also poisons", () => {
  poisoned.length = 0;
  const player = createPlayer(item(ItemIds.ABYSSAL_TENTACLE_OR_));
  const original = Math.random;
  try {
    Math.random = () => 0.01;
    strike(player);
    assert.equal(poisoned.length, 1);
    assert.equal(poisoned[0].severity, 4);
    assert.equal(poisoned[0].orb, 1);
  } finally {
    Math.random = original;
  }
});

test("misses and zero-damage hits do not roll, and an unwielded tentacle never poisons", () => {
  poisoned.length = 0;
  const player = createPlayer(item(ItemIds.ABYSSAL_TENTACLE));
  const original = Math.random;
  try {
    Math.random = () => 0;
    strike(player, { accurate: false });
    strike(player, { damage: 0 });
    strike(createPlayer());
    assert.equal(poisoned.length, 0);
  } finally {
    Math.random = original;
  }
});

test("creation through the real item-use dispatcher confirms, consumes one pair and rejects stale ingredients", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  const { Item } = require("../dist/game/model/Item");
  const { Inventory } = require("../dist/game/model/container/impl/Inventory");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
  const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");

  assert.equal(CacheDefinitions.getItem(ItemIds.ABYSSAL_WHIP).name, "Abyssal whip");
  assert.equal(CacheDefinitions.getItem(ItemIds.KRAKEN_TENTACLE).name, "Kraken tentacle");
  assert.equal(CacheDefinitions.getItem(ItemIds.ABYSSAL_TENTACLE).name, "Abyssal tentacle");
  AbyssalTentacle.register(PluginManager.createApi("AbyssalTentacle"));
  PluginManager.emitServerStartup({});

  function setup(first = ItemIds.ABYSSAL_WHIP, second = ItemIds.KRAKEN_TENTACLE) {
    let chatbox;
    const sender = new Proxy({}, { get: (_target, key) => {
      if (key === "sendChatboxInterface") return (id) => { chatbox = id; };
      if (key === "isChatboxInterface") return (id) => chatbox === id;
      if (key === "sendInterfaceRemoval") return () => { chatbox = null; };
      return () => sender;
    } });
    const player = { getPacketSender: () => sender, sendMessage() {} };
    const inventory = new Inventory(player);
    player.getInventory = () => inventory;
    for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new Item(ItemIds.BRONZE_DAGGER, 1));
    inventory.setItem(0, new Item(first, 1));
    inventory.setItem(1, new Item(second, 1));
    inventory.setItem(2, new Item(ItemIds.ABYSSAL_WHIP, 1));
    inventory.setItem(3, new Item(ItemIds.KRAKEN_TENTACLE, 1));
    return { player, inventory };
  }
  function choose(player, option) {
    return MultiChatboxPrompt.handleInterfaceActionClick({
      player, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: option,
    });
  }

  for (const reversed of [false, true]) {
    const { player, inventory } = setup();
    inventory.getItems()[0].setMeta({ unbankable: true });
    UseItemPacketListener.itemOnItem(player, reversed ? 1 : 0, reversed ? 0 : 1);
    assert.match(MultiChatboxPrompt.getPending(player)?.title ?? "", /irreversible.*untradeable/);
    assert.equal(inventory.getItems()[0].getId(), ItemIds.ABYSSAL_WHIP, "confirmation has not consumed either ingredient");
    assert.equal(inventory.getItems()[1].getId(), ItemIds.KRAKEN_TENTACLE);
    assert.equal(choose(player, 1), true);
    assert.equal(inventory.getItems()[0].getId(), ItemIds.ABYSSAL_TENTACLE, "the clicked whip transforms even in a full inventory");
    assert.equal(inventory.getItems()[0].getMetaValue("unbankable"), true, "existing item restrictions survive");
    assert.equal(inventory.getItems()[1].getId(), -1, "only the clicked tentacle is consumed");
    assert.equal(inventory.getItems()[2].getId(), ItemIds.ABYSSAL_WHIP);
    assert.equal(inventory.getItems()[3].getId(), ItemIds.KRAKEN_TENTACLE);
    assert.equal(choose(player, 1), false, "a repeated confirmation cannot consume another pair");
  }

  for (const change of ["cancel", "remove-whip", "remove-tentacle", "replace-whip", "change-whip-id", "move-tentacle"]) {
    const { player, inventory } = setup();
    UseItemPacketListener.itemOnItem(player, 0, 1);
    assert.ok(MultiChatboxPrompt.getPending(player));
    if (change === "remove-whip") inventory.deleteAtSlot(0, 1, false);
    if (change === "remove-tentacle") inventory.deleteAtSlot(1, 1, false);
    if (change === "replace-whip") inventory.setItem(0, new Item(ItemIds.ABYSSAL_WHIP, 1));
    if (change === "change-whip-id") inventory.getItems()[0].setId(ItemIds.BRONZE_DAGGER);
    if (change === "move-tentacle") inventory.swap(1, 4);
    const before = inventory.getItems().map(item => [item.getId(), item.getAmount()]);
    choose(player, change === "cancel" ? 2 : 1);
    assert.deepEqual(inventory.getItems().map(item => [item.getId(), item.getAmount()]), before, change);
  }

  for (const [first, second] of [
    [ItemIds.ABYSSAL_WHIP_2, ItemIds.KRAKEN_TENTACLE],
    [ItemIds.ABYSSAL_WHIP, ItemIds.KRAKEN_TENTACLE_2],
    [ItemIds.ABYSSAL_WHIP_3, ItemIds.KRAKEN_TENTACLE],
    [ItemIds.ABYSSAL_WHIP, ItemIds.KRAKEN_TENTACLE_3],
    [ItemIds.BRONZE_DAGGER, ItemIds.KRAKEN_TENTACLE],
  ]) {
    const { player, inventory } = setup(first, second);
    UseItemPacketListener.itemOnItem(player, 0, 1);
    assert.equal(MultiChatboxPrompt.getPending(player), null, `invalid pair ${first}/${second}`);
    assert.equal(inventory.getItems()[0].getId(), first);
    assert.equal(inventory.getItems()[1].getId(), second);
  }
});
