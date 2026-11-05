// Run after `yarn build`: node --test tests/abyssal-tentacle.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemIds } = require("../dist/util/IdEnums");

const AbyssalTentacle = require("../plugins/items/AbyssalTentacle.plugin");

const poisoned = [];
const itemActions = {};
const bonusUpdates = [];
const CombatType = { MELEE: "melee", MAGIC: "magic" };
AbyssalTentacle.register({
  core: {
    CombatType,
    Equipment,
    Flag: { APPEARANCE: "appearance" },
    Item: class { constructor(id, amount) { this.id = id; this.amount = amount; } },
    ItemIdentifiers: ItemIds,
    WeaponInterfaceManager: { assign() {} },
    BonusManager: { update: (player) => bonusUpdates.push(player) },
    CombatFactory: { poisonEntity: (target, severity, orb) => poisoned.push({ target, severity, orb }) },
  },
  emitCustomEvent() {},
  onServerStartup: (handler) => handler(),
  onItemOnItem() {},
  onCombatHitDamage() {},
  onCombatHitResolved() {},
  onCustomEvent() {},
  onItemAction(name, actions) { itemActions[name] = actions; },
});

function item(id, meta = {}) {
  return {
    id,
    meta,
    getId() { return this.id; },
    setId(next) { this.id = next; },
    getMetaValue(key) { return this.meta[key]; },
    setMetaValue(key, value) { this.meta[key] = value; },
  };
}

function createPlayer(weapon = null) {
  const equipment = new Array(14).fill(null).map(() => item(0));
  if (weapon) equipment[Equipment.WEAPON_SLOT] = weapon;
  const messages = [];
  const added = [];
  return {
    messages,
    added,
    getEquipment: () => ({ getItems: () => equipment, refreshItems() {} }),
    getInventory: () => ({ forceAdd: (_player, given) => added.push(given) }),
    getUpdateFlag: () => ({ flag() {} }),
    sendMessage: (message) => messages.push(message),
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
}

/** The swing being made: when the charge goes. */
function swing(player, type = CombatType.MELEE) {
  const event = { attacker: player, target: {}, method: { type: () => type } };
  AbyssalTentacle._test.onAttackStarted(event);
  AbyssalTentacle._test.onAttackFinished(event);
}

/** A hit rolled now, while the swing is made. */
function roll(player, { accurate = true, damage = 5, type = CombatType.MELEE } = {}) {
  const hit = { isAccurate: () => accurate, getTotalDamage: () => damage, getCombatType: () => type };
  AbyssalTentacle._test.onHitDamage({ attacker: player, combatType: type, hit });
  return hit;
}

function land(player, hit) {
  AbyssalTentacle._test.onHitResolved({ attacker: player, target: {}, hit });
}

/** A hit rolled and landing with the same equipment. */
function strike(player, options = {}) {
  land(player, roll(player, options));
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

test("Check reports the attacks left, full for a tentacle with no saved count", () => {
  assert.equal(typeof itemActions["Abyssal tentacle"].Check, "function");
  assert.equal(typeof itemActions["Abyssal tentacle (or)"].Check, "function");
  const player = createPlayer();
  AbyssalTentacle._test.check({ player, item: item(ItemIds.ABYSSAL_TENTACLE, { "abyssal-tentacle": 955 }) });
  AbyssalTentacle._test.check({ player, item: item(ItemIds.ABYSSAL_TENTACLE) });
  assert.deepEqual(player.messages, [
    "Your abyssal tentacle can perform 955 more attacks.",
    "Your abyssal tentacle can perform 10,000 more attacks.",
  ]);
});

test("every melee attack, hit or miss, uses a charge; other attacks do not", () => {
  const tentacle = item(ItemIds.ABYSSAL_TENTACLE, { "abyssal-tentacle": 10 });
  const player = createPlayer(tentacle);
  const original = Math.random;
  try {
    Math.random = () => 0.9;
    swing(player);
    swing(player);
    swing(player, CombatType.MAGIC);
    strike(player);
    strike(player, { accurate: false, damage: 0 });
  } finally {
    Math.random = original;
  }
  assert.equal(AbyssalTentacle._test.charges(tentacle), 8, "two melee swings; impacts spend nothing");
});

test("a swing whose hit is dropped before impact still uses the charge", () => {
  const tentacle = item(ItemIds.ABYSSAL_TENTACLE, { "abyssal-tentacle": 10 });
  swing(createPlayer(tentacle));
  assert.equal(AbyssalTentacle._test.charges(tentacle), 9);
});

test("swapping tentacles before impact charges the one that swung", () => {
  const first = item(ItemIds.ABYSSAL_TENTACLE, { "abyssal-tentacle": 10 });
  const second = item(ItemIds.ABYSSAL_TENTACLE, { "abyssal-tentacle": 10 });
  const player = createPlayer(first);
  swing(player);
  player.getEquipment().getItems()[Equipment.WEAPON_SLOT] = second;
  const original = Math.random;
  try {
    Math.random = () => 0.9;
    strike(player);
  } finally {
    Math.random = original;
  }
  assert.equal(AbyssalTentacle._test.charges(first), 9);
  assert.equal(AbyssalTentacle._test.charges(second), 10);
});

test("the last charge's swing still uses the tentacle; it degrades once the swing is over", () => {
  const tentacle = item(ItemIds.ABYSSAL_TENTACLE, { "abyssal-tentacle": 1 });
  const player = createPlayer(tentacle);
  const event = { attacker: player, target: {}, method: { type: () => CombatType.MELEE } };
  AbyssalTentacle._test.onAttackStarted(event);
  assert.equal(tentacle.getId(), ItemIds.ABYSSAL_TENTACLE, "during the swing");
  assert.equal(AbyssalTentacle._test.charges(tentacle), 0);
  AbyssalTentacle._test.onAttackFinished(event);
  assert.equal(tentacle.getId(), ItemIds.KRAKEN_TENTACLE, "after the swing");
});

test("a damaging spell cast while holding a tentacle does not roll its poison", () => {
  poisoned.length = 0;
  const player = createPlayer(item(ItemIds.ABYSSAL_TENTACLE));
  const original = Math.random;
  try {
    Math.random = () => 0;
    strike(player, { damage: 8, type: CombatType.MAGIC });
  } finally {
    Math.random = original;
  }
  assert.equal(poisoned.length, 0);
});

test("the last charge leaves the kraken tentacle, and an (or) tentacle returns its kit", () => {
  const plain = item(ItemIds.ABYSSAL_TENTACLE, { "abyssal-tentacle": 1 });
  const ornamented = item(ItemIds.ABYSSAL_TENTACLE_OR_, { "abyssal-tentacle": 1 });
  const plainOwner = createPlayer(plain);
  const ornamentedOwner = createPlayer(ornamented);
  const original = Math.random;
  try {
    swing(plainOwner);
    swing(ornamentedOwner);
  } finally {
    Math.random = original;
  }
  assert.equal(plain.getId(), ItemIds.KRAKEN_TENTACLE);
  assert.equal(plainOwner.added.length, 0);
  assert.equal(ornamented.getId(), ItemIds.KRAKEN_TENTACLE);
  assert.equal(ornamentedOwner.added[0].id, ItemIds.SHATTERED_RELICS_VARIETY_ORNAMENT_KIT);
});

test("the last charge's hit still poisons when it lands after the tentacle degraded", () => {
  poisoned.length = 0;
  const tentacle = item(ItemIds.ABYSSAL_TENTACLE, { "abyssal-tentacle": 1 });
  const player = createPlayer(tentacle);
  const event = { attacker: player, target: {}, method: { type: () => CombatType.MELEE } };
  AbyssalTentacle._test.onAttackStarted(event);
  const hit = roll(player);
  AbyssalTentacle._test.onAttackFinished(event);
  assert.equal(tentacle.getId(), ItemIds.KRAKEN_TENTACLE);
  const original = Math.random;
  try {
    Math.random = () => 0;
    land(player, hit);
  } finally {
    Math.random = original;
  }
  assert.equal(poisoned.length, 1);
});

test("poison follows the weapon that rolled the hit, not the one held at impact", () => {
  poisoned.length = 0;
  const player = createPlayer(item(ItemIds.ABYSSAL_WHIP));
  const whipHit = roll(player);
  player.getEquipment().getItems()[Equipment.WEAPON_SLOT] = item(ItemIds.ABYSSAL_TENTACLE);
  const original = Math.random;
  try {
    Math.random = () => 0;
    land(player, whipHit);
  } finally {
    Math.random = original;
  }
  assert.equal(poisoned.length, 0);
});

test("degrading recalculates the player's equipment bonuses", () => {
  bonusUpdates.length = 0;
  const player = createPlayer(item(ItemIds.ABYSSAL_TENTACLE, { "abyssal-tentacle": 1 }));
  swing(player);
  assert.deepEqual(bonusUpdates, [player]);
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

test("native Dissolve confirms and returns only the clicked normal tentacle, rejecting stale confirmations", async (t) => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const { PluginManager } = require("../dist/plugins/PluginManager");
  const core = PluginManager.getCoreApi();
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
  const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  AbyssalTentacle.register(PluginManager.createApi("AbyssalTentacle"));
  PluginManager.emitServerStartup({});
  assert.equal(core.CacheDefinitions.getItem(ItemIds.ABYSSAL_TENTACLE).inventoryActions[4], "Dissolve");
  let index = 2800;

  function actor(itemId = ItemIds.ABYSSAL_TENTACLE) {
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel);
    const player = new Player(session);
    session.setPlayer(player);
    player.setIndex(index++);
    player.setUsername(`dissolve${index}`);
    player.setRegistered(true);
    player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 99, false);
    const inventory = player.getInventory();
    for (let slot = 0; slot < inventory.capacity(); slot++) inventory.setItem(slot, new core.Item(ItemIds.BRONZE_DAGGER, 1));
    const item = new core.Item(itemId, 1, { unbankable: true, untradeable: true });
    inventory.setItem(7, item);
    inventory.setItem(8, new core.Item(ItemIds.ABYSSAL_TENTACLE, 1));
    const connection = new ClientConnection(channel);
    connection.player = player;
    t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
    return { player, inventory, item, connection };
  }
  async function dissolve(actor) {
    const frame = Buffer.alloc(9);
    frame[0] = 14; // Native IF_BUTTON7: inventory action 5, via cache enum 4303.
    frame.writeInt32BE(149 << 16, 1);
    frame.writeUInt16BE(7, 5);
    frame.writeUInt16BE(actor.item.getId(), 7);
    const decoded = decodeClientPackets(frame);
    assert.equal(decoded[0].option, undefined);
    await actor.connection.dispatch(decoded, true);
    actor.connection.processTurnPackets();
  }
  async function choose(actor, option) {
    const frame = Buffer.alloc(7);
    frame[0] = 62; // Native RESUME_PAUSEBUTTON.
    frame[1] = option >>> 8;
    frame[2] = (option + 128) & 255;
    frame.writeInt32BE(MultiChatboxPrompt.OPTIONS_WIDGET_ID, 3);
    const decoded = decodeClientPackets(frame);
    assert.equal(decoded[0].childIndex, option);
    await actor.connection.dispatch(decoded, true);
    actor.connection.processTurnPackets();
  }

  const full = actor();
  await dissolve(full);
  assert.match(MultiChatboxPrompt.getPending(full.player)?.title ?? "", /whip.*permanently lost/i);
  assert.equal(full.inventory.getItems()[7], full.item, "the prompt has not consumed the item");
  assert.equal(full.item.getId(), ItemIds.ABYSSAL_TENTACLE);
  assert.equal(full.inventory.getFreeSlots(), 0);
  await choose(full, 1);
  assert.equal(full.inventory.getItems()[7], full.item, "the same slot returns the kraken tentacle even when full");
  assert.equal(full.item.getId(), ItemIds.KRAKEN_TENTACLE);
  assert.equal(full.inventory.getAmount(ItemIds.KRAKEN_TENTACLE), 1);
  assert.equal(full.inventory.getItems()[8].getId(), ItemIds.ABYSSAL_TENTACLE, "the spare is untouched");
  assert.deepEqual(full.item.getMeta(), { unbankable: true, untradeable: true }, "item restrictions survive");
  await choose(full, 1);
  assert.equal(full.inventory.getAmount(ItemIds.KRAKEN_TENTACLE), 1, "duplicate resume cannot return another tentacle");

  for (const change of ["cancel", "remove", "replace", "move", "change-id", "change-amount", "close"]) {
    const pending = actor();
    await dissolve(pending);
    assert.ok(MultiChatboxPrompt.getPending(pending.player), change);
    if (change === "remove") pending.inventory.deleteAtSlot(7, 1, false);
    if (change === "replace") pending.inventory.setItem(7, new core.Item(ItemIds.ABYSSAL_TENTACLE, 1));
    if (change === "move") pending.inventory.swap(7, 9);
    if (change === "change-id") pending.item.setId(ItemIds.BRONZE_DAGGER);
    if (change === "change-amount") pending.item.setAmount(2);
    if (change === "close") pending.player.getPacketSender().sendInterfaceRemoval();
    const before = pending.inventory.getItems().map(item => [item.getId(), item.getAmount(), item.getMeta()]);
    await choose(pending, change === "cancel" ? 2 : 1);
    assert.deepEqual(pending.inventory.getItems().map(item => [item.getId(), item.getAmount(), item.getMeta()]), before, change);
    assert.equal(MultiChatboxPrompt.getPending(pending.player), null);
  }

  for (const itemId of [ItemIds.ABYSSAL_TENTACLE_2, ItemIds.ABYSSAL_TENTACLE_OR_, ItemIds.ABYSSAL_TENTACLE_OR__2,
    ItemIds.ABYSSAL_TENTACLE_3, ItemIds.ABYSSAL_TENTACLE_4]) {
    const excluded = actor(itemId);
    assert.equal(PluginManager.emitItemAction({ player: excluded.player, interfaceId: core.Inventory.INTERFACE_ID,
      item: excluded.item, itemId, slot: 7, clickType: 5, option: "Dissolve", handled: false }), false);
    assert.equal(excluded.item.getId(), itemId);
    assert.equal(MultiChatboxPrompt.getPending(excluded.player), null);
  }
});

// Registers the plugin with the real core: keep last.
test("through the real attack path, the last charge's swing rolls with the tentacle, and its hit still poisons after the degrade", (t) => {
  const { Combat } = require("../dist/game/content/combat/Combat");
  const { CombatFactory, CanAttackResponse } = require("../dist/game/content/combat/CombatFactory");
  const { CombatType: RealCombatType } = require("../dist/game/content/combat/CombatType");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  AbyssalTentacle.register(PluginManager.createApi("AbyssalTentacle"));
  PluginManager.emitServerStartup({});

  const tentacle = item(ItemIds.ABYSSAL_TENTACLE, { "abyssal-tentacle": 1 });
  const player = createPlayer(tentacle);
  Object.assign(player, { isNpc: () => false, isSpecialActivated: () => false, setSpecialActivated() {}, getUpdateFlag: () => ({ flag() {} }) });
  const target = { getCombat: () => ({ getAttacker: () => player }) };
  const combat = new Combat(player);
  t.mock.method(CombatFactory, "canAttack", () => CanAttackResponse.CAN_ATTACK);
  const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
  const assigned = t.mock.method(WeaponInterfaceManager, "assign", () => {});
  const { BonusManager } = require("../dist/game/model/equipment/BonusManager");
  const recalculated = t.mock.method(BonusManager, "update", () => {});
  t.mock.method(combat, "expectAttackAnimation", () => {});
  t.mock.method(combat, "attackTiming", () => ({ keepDelay: true }));
  const heldDuring = [];
  const weapon = () => player.getEquipment().getItems()[Equipment.WEAPON_SLOT].getId();
  const method = {
    type: () => RealCombatType.MELEE, onCombatBegan() {}, finished() {},
    start: () => heldDuring.push(["start", weapon()]),
    hits: () => {
      heldDuring.push(["hits", weapon()]);
      // The swing's hit, rolled through the real hit-damage hooks as PendingHit rolls it.
      PluginManager.emitCombatHitDamage({ attacker: player, target, combatType: RealCombatType.MELEE, hit: rolled, damage: {}, accurate: true });
      return [];
    },
  };
  const rolled = { isAccurate: () => true, getTotalDamage: () => 11, getCombatType: () => RealCombatType.MELEE };
  const poisonedTargets = t.mock.method(CombatFactory, "poisonEntity", () => {});
  assert.equal(combat.executeAttack(method, target, true, 0, false), true);
  assert.deepEqual(heldDuring, [["start", ItemIds.ABYSSAL_TENTACLE], ["hits", ItemIds.ABYSSAL_TENTACLE]]);
  assert.equal(tentacle.getId(), ItemIds.KRAKEN_TENTACLE, "degraded once the swing finished");
  assert.equal(assigned.mock.callCount(), 1, "the weapon interface changes after the swing");
  assert.equal(recalculated.mock.callCount(), 1, "the kraken tentacle's bonuses replace the tentacle's");

  // The hit lands after the degrade: it was the tentacle's, so it may still poison.
  // (Earlier tests registered this plugin on the shared PluginManager too, so count "any".)
  const unrolled = { isAccurate: () => true, getTotalDamage: () => 11, getCombatType: () => RealCombatType.MELEE };
  const original = Math.random;
  try {
    Math.random = () => 0;
    PluginManager.emitCombatHitResolved({ attacker: player, target, hit: unrolled });
    assert.equal(poisonedTargets.mock.callCount(), 0, "a hit no tentacle rolled never poisons");
    PluginManager.emitCombatHitResolved({ attacker: player, target, hit: rolled });
  } finally {
    Math.random = original;
  }
  assert.ok(poisonedTargets.mock.callCount() > 0, "the tentacle's own last hit poisons");
});
