// Run after `yarn build`: node --test tests/jewellery.test.cjs
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Item } = require("../dist/game/model/Item");
const { ItemIds } = require("../dist/util/IdEnums");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { TeleportHandler } = require("../dist/game/model/teleportation/TeleportHandler");

/** Teleports are recorded and arrive immediately; the real handler needs a live world. */
const teleports = [];
TeleportHandler.checkReqs = (player, target, wildernessLevel) => {
  teleports.push({ target: [target.getX(), target.getY(), target.getZ()], wildernessLevel });
  return true;
};
/** When set, arrivals wait here instead of landing at once (something can happen mid-teleport). */
let pendingArrivals = null;
TeleportHandler.teleport = (player, target, type, warning, onArrival) =>
  (pendingArrivals ? pendingArrivals.push(onArrival) : onArrival?.());

let prompts = [];
let itemAction;
let itemOnObject;
const completeQuests = new Set();
require("../plugins/quests/QuestRuntime").getRegisteredQuests = () =>
  ["Heroes' Quest", "Legends' Quest"].map((name) => ({ name, isComplete: () => completeQuests.has(name) }));
const { ObjectIdentifiers } = require("../dist/util/ObjectIdentifiers");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const Jewellery = require("../plugins/items/Jewellery.plugin");
const customEvents = [];
/** Players the Colosseum plugin would say have the Hero title. */
const colosseumHeroes = new Set();
/** Quest keys "quest:is-complete" answers done. */
const doneQuestKeys = new Set();
class DialogueChainBuilder {
  add(dialogue) { this.dialogue = dialogue; return this; }
}
class StatementDialogue {
  constructor(index, text) { this.text = text; }
}
Jewellery.register({
  getBonusManager: () => ({ update() {} }),
  core: { ObjectIdentifiers, ItemIdentifiers, ItemDefinition, ObjectDefinition, Flag: require("../dist/game/model/Flag").Flag, DialogueChainBuilder, StatementDialogue },
  onItemAction: (handler) => { itemAction = handler; },
  onItemOnObject: (handler) => { itemOnObject = handler; },
  onSpellCast() {},
  emitCustomEvent: (name, payload) => {
    customEvents.push([name, payload]);
    if (name === "colosseum:has-rank" && payload.rank === "Hero") payload.reached = colosseumHeroes.has(payload.player);
    if (name === "quest:is-complete") payload.complete = doneQuestKeys.has(payload.key);
  },
  sendMultiChatboxPrompt: (player, title, ...pairs) => {
    const options = [];
    for (let i = 0; i < pairs.length; i += 2) options.push({ text: pairs[i], pick: pairs[i + 1] });
    prompts.push({ title, options });
    return true;
  },
});

function container(capacity) {
  const items = new Array(capacity).fill(null);
  return {
    getItems: () => items,
    setItem: (slot, item) => { items[slot] = item; },
    deleteAtSlot: (slot) => { items[slot] = null; },
    refreshItems() {},
  };
}

function createPlayer({ farming = 1, clientType = 0 } = {}) {
  const messages = [];
  const statements = [];
  return {
    messages,
    statements,
    getDialogueManager: () => ({ startDialogues: (chain) => statements.push(chain.dialogue.text) }),
    inventory: container(28),
    equipment: container(14),
    getInventory() { return this.inventory; },
    getEquipment() { return this.equipment; },
    sendMessage: (message) => messages.push(message),
    getUpdateFlag: () => ({ flag() {} }),
    getPacketSender: () => ({ getVarbit: () => clientType, getVarp: () => 0 }),
    getSkillManager: () => ({ getMaxLevel: () => farming }),
  };
}

function inventoryClick(player, item, option, extra = {}) {
  const slot = player.inventory.getItems().indexOf(item);
  const event = { player, item, itemId: item.getId(), slot, interfaceId: 149, clickType: 2, option, handled: false, ...extra };
  itemAction(event);
  return event;
}

function equippedClick(player, item, clickType, option) {
  const slot = player.equipment.getItems().indexOf(item);
  const event = { player, item, itemId: item.getId(), slot, interfaceId: Equipment.INVENTORY_INTERFACE_ID, clickType, option, handled: false };
  itemAction(event);
  return event;
}

function pick(text) {
  const prompt = prompts.at(-1);
  const option = prompt.options.find((entry) => entry.text === text);
  assert.ok(option, `"${text}" not offered: ${prompt.options.map((entry) => entry.text).join(", ")}`);
  option.pick();
}

before(async () => {
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize();
  ObjectDefinition.init();
});

beforeEach(() => {
  teleports.length = 0;
  prompts = [];
  pendingArrivals = null;
});

test("rubbing a glory offers its destinations and uses a charge on arrival", () => {
  const player = createPlayer();
  const glory = new Item(ItemIds.AMULET_OF_GLORY_4_, 1);
  player.inventory.setItem(0, glory);

  assert.equal(inventoryClick(player, glory, "Rub").handled, true);
  assert.deepEqual(prompts[0].options.map((entry) => entry.text), ["Edgeville", "Karamja", "Draynor Village", "Al Kharid", "Nowhere"]);
  pick("Karamja");

  assert.deepEqual(teleports, [{ target: [2918, 3176, 0], wildernessLevel: 30 }]);
  assert.equal(glory.getId(), ItemIds.AMULET_OF_GLORY_3_);
  assert.ok(player.messages.includes("<col=7f007f>Your amulet has three charges left.</col>"));
});

test("a glory's last charge leaves an uncharged amulet that can no longer teleport", () => {
  const player = createPlayer();
  const glory = new Item(ItemIds.AMULET_OF_GLORY_1_, 1);
  player.inventory.setItem(0, glory);
  inventoryClick(player, glory, "Rub");
  pick("Edgeville");
  assert.equal(glory.getId(), ItemIds.AMULET_OF_GLORY);

  prompts = [];
  inventoryClick(player, glory, "Rub");
  assert.equal(prompts.length, 0);
  assert.equal(player.messages.at(-1), "Your amulet hasn't got any charges left.");
});

test("a refused teleport (teleblock or over-level) keeps the charge", () => {
  const player = createPlayer();
  const glory = new Item(ItemIds.AMULET_OF_GLORY_4_, 1);
  player.inventory.setItem(0, glory);

  TeleportHandler.checkReqs = () => false;
  try {
    inventoryClick(player, glory, "Rub");
    pick("Edgeville");
  } finally {
    TeleportHandler.checkReqs = (p, target, wildernessLevel) => {
      teleports.push({ target: [target.getX(), target.getY(), target.getZ()], wildernessLevel });
      return true;
    };
  }
  assert.equal(glory.getId(), ItemIds.AMULET_OF_GLORY_4_, "the rejected teleport consumed no charge");
});

test("an uncharged piece never teleports from a direct worn option", () => {
  const player = createPlayer();
  const glory = new Item(ItemIds.AMULET_OF_GLORY, 1);
  player.equipment.setItem(Equipment.AMULET_SLOT, glory);
  assert.equal(equippedClick(player, glory, 2, "Edgeville").handled, true);
  assert.equal(teleports.length, 0);
  assert.equal(player.messages.at(-1), "Your amulet hasn't got any charges left.");
});

test("a games necklace crumbles after its last charge", () => {
  const player = createPlayer();
  const necklace = new Item(ItemIds.GAMES_NECKLACE_1_, 1);
  player.inventory.setItem(3, necklace);
  inventoryClick(player, necklace, "Rub");
  pick("Wintertodt Camp");
  assert.deepEqual(teleports[0], { target: [1627, 3941, 0], wildernessLevel: 20 });
  assert.equal(player.inventory.getItems()[3], null);
  assert.ok(player.messages.includes("<col=7f007f>Your games necklace crumbles to dust.</col>"));
});

test("equipped jewellery teleports straight from its worn option", () => {
  const player = createPlayer();
  const ring = new Item(ItemIds.RING_OF_DUELING_8_, 1);
  player.equipment.setItem(Equipment.RING_SLOT, ring);
  assert.equal(equippedClick(player, ring, 3, "Castle Wars").handled, true);
  assert.deepEqual(teleports[0].target, [2440, 3090, 0]);
  assert.equal(ring.getId(), ItemIds.RING_OF_DUELING_7_);
});

test("an older worn-option name still finds its destination", () => {
  const player = createPlayer();
  const ring = new Item(ItemIds.RING_OF_DUELING_2_, 1);
  player.equipment.setItem(Equipment.RING_SLOT, ring);
  equippedClick(player, ring, 2, "Duel Arena");
  assert.deepEqual(teleports[0].target, [3315, 3235, 0]);
});

test("the last charge of equipped jewellery empties the slot", () => {
  const player = createPlayer();
  const ring = new Item(ItemIds.RING_OF_DUELING_1_, 1);
  player.equipment.setItem(Equipment.RING_SLOT, ring);
  equippedClick(player, ring, 4, "Ferox Enclave");
  assert.equal(player.equipment.getItems()[Equipment.RING_SLOT].getId(), -1);
});

test("worn options that are not teleports are left to other plugins", () => {
  const player = createPlayer();
  const ring = new Item(ItemIds.SLAYER_RING_8_, 1);
  player.equipment.setItem(Equipment.RING_SLOT, ring);
  assert.equal(equippedClick(player, ring, 3, "Check").handled, false);
  assert.equal(teleports.length, 0);
});

test("long destination lists page onto a second prompt", () => {
  const player = createPlayer({ farming: 45 });
  const necklace = new Item(ItemIds.SKILLS_NECKLACE_6_, 1);
  player.inventory.setItem(0, necklace);
  inventoryClick(player, necklace, "Rub");
  assert.deepEqual(prompts[0].options.map((entry) => entry.text), ["Fishing Guild", "Mining Guild", "Crafting Guild", "Cooking Guild", "More..."]);
  pick("More...");
  pick("Farming Guild");
  assert.deepEqual(teleports[0], { target: [1248, 3725, 0], wildernessLevel: 30 });
});

test("inventory sub-menu options teleport by position", () => {
  const player = createPlayer();
  const pendant = new Item(ItemIds.DIGSITE_PENDANT_5_, 1);
  player.inventory.setItem(0, pendant);
  doneQuestKeys.add("bone_voyage"); // Fossil Island, the second sub-option, needs it (Wiki)
  try {
    inventoryClick(player, pendant, "Rub", { subOpId: 2 });
  } finally {
    doneQuestKeys.delete("bone_voyage");
  }
  assert.deepEqual(teleports[0].target, [3763, 3870, 1]);
  assert.equal(pendant.getId(), ItemIds.DIGSITE_PENDANT_4_);
});

test("the burning amulet asks before teleporting into the Wilderness", () => {
  const player = createPlayer();
  const amulet = new Item(ItemIds.BURNING_AMULET_5_, 1);
  player.inventory.setItem(0, amulet);
  inventoryClick(player, amulet, "Rub");
  pick("Lava Maze");
  assert.equal(teleports.length, 0);
  assert.match(prompts.at(-1).title, /^That's in level \d+ Wilderness\.$/);
  pick("No.");
  assert.equal(teleports.length, 0);

  inventoryClick(player, amulet, "Rub");
  pick("Chaos Temple");
  prompts.at(-1).options[0].pick();
  assert.deepEqual(teleports[0].target, [3235, 3637, 0]);
});

test("eternal jewellery never loses a charge", () => {
  const player = createPlayer();
  const glory = new Item(ItemIds.AMULET_OF_ETERNAL_GLORY, 1);
  player.equipment.setItem(Equipment.AMULET_SLOT, glory);
  equippedClick(player, glory, 2, "Edgeville");
  assert.equal(glory.getId(), ItemIds.AMULET_OF_ETERNAL_GLORY);
});

test("the ring of returning rubs straight to the respawn point", () => {
  const player = createPlayer();
  const ring = new Item(ItemIds.RING_OF_RETURNING_5_, 1);
  player.inventory.setItem(0, ring);
  inventoryClick(player, ring, "Rub");
  assert.equal(prompts.length, 0);
  assert.equal(teleports.length, 1);
  assert.ok(player.messages.includes("<col=7f007f>Your ring of returning has four uses left.</col>"));
});

test("the ring of wealth's Rub submenu and worn options follow the cache's order", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  await CachePipeline.initialize();
  // Params 451-456 label the ring's destinations; the client lists Rub's submenu in this order.
  const labels = [451, 452, 453, 454].map((param) => CacheDefinitions.getItem(11980).params.get(param));
  assert.deepEqual(labels, ["Miscellania", "Grand Exchange", "Falador", "Dondakan"]);
  const { ACTIONS } = require("../plugins/items/RingOfWealth.plugin");
  assert.deepEqual(ACTIONS.slice(0, 4).map((action) => action.teleport.label),
    ["Miscellania", "Grand Exchange", "Falador Park", "Dondakan"], "sub-op 2 is the Grand Exchange");
  const landing = ACTIONS[1].teleport.destination;
  assert.deepEqual([landing.getX(), landing.getY(), landing.getZ()], [3163, 3478, 0],
    'land on the southern approach, clear of the bank');
  assert.deepEqual(ACTIONS.slice(4).map((action) => action.type), ["boss-log", "coin-collection"]);
});

test("the slayer ring's Rub submenu is its actions: Check, Teleport, then Master, Partner and Log", () => {
  const player = createPlayer();
  const ring = new Item(ItemIds.SLAYER_RING_8_, 1);
  player.inventory.setItem(0, ring);

  inventoryClick(player, ring, "Rub", { subOpId: 1 });
  assert.equal(player.messages.at(-1), "Your Slayer ring has 8 charges left.");
  assert.equal(customEvents.at(-1)[0], "slayer:check", "the Slayer plugin adds the task");
  assert.equal(teleports.length, 0, "Check doesn't teleport");

  inventoryClick(player, ring, "Rub", { subOpId: 2 });
  pick("Stronghold Slayer Cave");
  assert.deepEqual(teleports.at(-1).target, [2431, 3424, 0], "Teleport offers the destinations");

  const before = teleports.length;
  for (const subOpId of [3, 4, 5]) {
    inventoryClick(player, ring, "Rub", { subOpId });
    assert.equal(player.messages.at(-1), "Nothing interesting happens.");
  }
  assert.equal(teleports.length, before, "Master, Partner and Log don't teleport");
});

test("the ring of dueling's Fortis Colosseum teleport needs the Colosseum's Hero title", () => {
  const player = createPlayer();
  const ring = new Item(ItemIds.RING_OF_DUELING_8_, 1);
  player.inventory.setItem(0, ring);

  // rsprox 723: "You rub the ring...", then this message box; no teleport, no charge.
  inventoryClick(player, ring, "Rub", { subOpId: 4 });
  assert.equal(player.messages.at(-1), "You rub the ring...");
  assert.deepEqual(player.statements,
    ["This destination is unlocked by reaching <col=ff0000>Hero</col> status in the Fortis<br>Colosseum."]);
  assert.equal(teleports.length, 0);
  assert.equal(ring.getId(), ItemIds.RING_OF_DUELING_8_);

  // rsprox 3238: Rub still lists it; picking it while locked is refused the same way.
  inventoryClick(player, ring, "Rub");
  assert.deepEqual(prompts.at(-1).options.map((entry) => entry.text),
    ["Emir's Arena", "Castle Wars", "Ferox Enclave", "Fortis Colosseum", "Nowhere"]);
  pick("Fortis Colosseum");
  assert.equal(player.statements.length, 2);
  assert.equal(teleports.length, 0);

  colosseumHeroes.add(player);
  try {
    inventoryClick(player, ring, "Rub", { subOpId: 4 });
  } finally {
    colosseumHeroes.delete(player);
  }
  assert.deepEqual(teleports.at(-1).target, [1793, 3107, 0]);
  assert.equal(ring.getId(), ItemIds.RING_OF_DUELING_7_);
});

test("the Colosseum answers the Hero check from the player's best Glory", () => {
  const Lobby = require("../plugins/minigames/colosseum/Lobby.Colosseum");
  const Shared = require("../plugins/minigames/colosseum/Shared.Colosseum");
  const attributes = new Map();
  const player = { getAttribute: (key) => attributes.get(key) };
  const ask = () => {
    const request = { player, rank: "Hero", reached: false };
    Lobby.answerHasRank(request);
    return request.reached;
  };
  attributes.set(Shared.ATTR.GLORY, 11999);
  assert.equal(ask(), false, "Gladiator is not yet Hero");
  attributes.set(Shared.ATTR.GLORY, 12000);
  assert.equal(ask(), true);
  attributes.set(Shared.ATTR.GLORY, 20000);
  assert.equal(ask(), true, "Grand Champion keeps the Hero unlock");
});

test("the slayer ring teleports up to level 30 Wilderness (Wiki)", () => {
  const player = createPlayer();
  const ring = new Item(ItemIds.SLAYER_RING_8_, 1);
  player.inventory.setItem(0, ring);
  doneQuestKeys.add("priest_in_peril"); // Slayer Tower needs it (Wiki)
  try {
    inventoryClick(player, ring, "Rub", { subOpId: 2 });
    pick("Slayer Tower");
  } finally {
    doneQuestKeys.delete("priest_in_peril");
  }
  assert.equal(teleports.at(-1).wildernessLevel, 30);
});

test("the slayer ring's Slayer Tower, Tarn's Lair and Dark Beasts need their quests (Wiki)", () => {
  for (const [label, key, name] of [
    ["Slayer Tower", "priest_in_peril", "Priest in Peril"],
    ["Tarn's Lair", "haunted_mine", "Haunted Mine"],
    ["Dark Beasts", "mournings_end_part_ii", "Mourning's End Part II"],
  ]) {
    const player = createPlayer();
    const ring = new Item(ItemIds.SLAYER_RING_8_, 1);
    player.inventory.setItem(0, ring);
    const before = teleports.length;
    inventoryClick(player, ring, "Rub", { subOpId: 2 });
    pick(label);
    assert.equal(teleports.length, before, `${label}: no teleport before ${name}`);
    assert.deepEqual(player.statements.at(-1), "You have not yet unlocked that destination.");
    assert.equal(ring.getId(), ItemIds.SLAYER_RING_8_, "no charge used");
    doneQuestKeys.add(key);
    inventoryClick(player, ring, "Rub", { subOpId: 2 });
    pick(label);
    assert.equal(teleports.length, before + 1, `${label}: after ${name} it teleports`);
    doneQuestKeys.delete(key);
  }
});

test("the charge is spent on arrival even if the piece was equipped mid-teleport", () => {
  const player = createPlayer();
  const glory = new Item(ItemIds.AMULET_OF_GLORY_4_, 1);
  player.inventory.setItem(0, glory);
  pendingArrivals = [];
  inventoryClick(player, glory, "Rub");
  pick("Edgeville");
  assert.equal(glory.getId(), ItemIds.AMULET_OF_GLORY_4_, "nothing is spent before arrival");

  // Equipping can move a copy of the item rather than the same object.
  player.inventory.setItem(0, null);
  const worn = new Item(ItemIds.AMULET_OF_GLORY_4_, 1);
  player.equipment.setItem(Equipment.AMULET_SLOT, worn);
  pendingArrivals.shift()();
  assert.equal(worn.getId(), ItemIds.AMULET_OF_GLORY_3_);
  assert.ok(player.messages.includes("<col=7f007f>Your amulet has three charges left.</col>"));
});

test("a piece gone before arrival spends nothing and says nothing", () => {
  const player = createPlayer();
  const necklace = new Item(ItemIds.GAMES_NECKLACE_3_, 1);
  player.inventory.setItem(0, necklace);
  pendingArrivals = [];
  inventoryClick(player, necklace, "Rub");
  pick("Burthorpe");
  player.inventory.setItem(0, null);
  const before = player.messages.length;
  pendingArrivals.shift()();
  assert.equal(player.messages.length, before);
});

test("two players' jewellery never shares charge state", () => {
  const alice = createPlayer();
  const bob = createPlayer();
  const aliceGlory = new Item(ItemIds.AMULET_OF_GLORY_4_, 1);
  const bobGlory = new Item(ItemIds.AMULET_OF_GLORY_4_, 1);
  alice.inventory.setItem(0, aliceGlory);
  bob.equipment.setItem(Equipment.AMULET_SLOT, bobGlory);
  pendingArrivals = [];
  inventoryClick(alice, aliceGlory, "Rub");
  pick("Karamja");
  // Alice's amulet leaves her mid-teleport; Bob's identical amulet must not pay for her trip.
  alice.inventory.setItem(0, null);
  pendingArrivals.shift()();
  assert.equal(bobGlory.getId(), ItemIds.AMULET_OF_GLORY_4_);
  assert.equal(bob.messages.length, 0);

  equippedClick(bob, bobGlory, 2, "Edgeville");
  pendingArrivals.shift()();
  assert.equal(bobGlory.getId(), ItemIds.AMULET_OF_GLORY_3_);
  assert.equal(aliceGlory.getId(), ItemIds.AMULET_OF_GLORY_4_);
});

test("banking and death keep jewellery's charge id", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize();
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  const { Inventory } = require("../dist/game/model/container/impl/Inventory");
  const { Bank } = require("../dist/game/model/container/impl/Bank");
  const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
  const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
  const { Location } = require("../dist/game/model/Location");
  const { PlayerRights } = require("../dist/game/model/rights/PlayerRights");

  // Banking: the charge is the item id, so a deposit and withdrawal give back the same glory (3).
  const sender = new Proxy({}, { get: () => () => sender });
  const banker = {
    getUsername: () => "banker", sendMessage() {}, isSearchingBank: () => false, getPacketSender: () => sender,
    getStatus: () => PlayerStatus.BANKING, insertModeReturn: () => false, getInterfaceId: () => Bank.MAIN_INTERFACE_ID,
    getCurrentBankTab: () => 0, setCurrentBankTab() {}, withdrawAsNote: () => false, isPlaceholders: () => false,
    isPlayerBot: () => false, getBankCustomQuantity: () => 0, getBankQuantityMode: () => 0,
  };
  banker.inventory = new Inventory(banker).resetItems();
  banker.banks = Array.from({ length: Bank.TOTAL_BANK_TABS }, () => new Bank(banker).resetItems());
  banker.getInventory = () => banker.inventory;
  banker.getBank = (tab = 0) => banker.banks[tab];
  banker.setBank = (tab, bank) => { banker.banks[tab] = bank; };
  banker.getInventory().add(new Item(ItemIds.AMULET_OF_GLORY_3_, 1), false);
  Bank.deposit(banker, ItemIds.AMULET_OF_GLORY_3_, 0, 1, true);
  assert.equal(banker.getBank(0).getAmount(ItemIds.AMULET_OF_GLORY_3_), 1);
  Bank.withdraw(banker, ItemIds.AMULET_OF_GLORY_3_, 0, 1, 0);
  assert.deepEqual(banker.getInventory().getValidItems().map((item) => item.getId()), [ItemIds.AMULET_OF_GLORY_3_]);

  // Death: the kept jewellery is the same charged pieces.
  const carried = [new Item(ItemIds.AMULET_OF_GLORY_3_, 1), new Item(ItemIds.RING_OF_DUELING_5_, 1),
    new Item(ItemIds.SKILLS_NECKLACE_2_, 1)];
  const victim = {
    getInventory: () => ({ getItems: () => carried }), getEquipment: () => ({ getItems: () => [] }),
    getSkullTimer: () => 0, getSkullType: () => 0, getPrayerActive: () => new Array(40).fill(false),
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99 }),
    getLocation: () => new Location(3090, 3490, 0), getRights: () => PlayerRights.NONE,
  };
  assert.deepEqual(PlayerDeathTask.getItemsToKeep(victim).map((item) => item.getId()).sort(),
    carried.map((item) => item.getId()).sort());

  // An imbued ring of wealth always loses its imbue on death, keeping its three charges (Wiki: Ring of wealth (i)). A
  // player killer gets its 50,000 coins; any other death adds them to what it loses (ring-of-wealth-death.test.cjs).
  const { removeImbueOnDeath } = require("../plugins/items/RingOfWealth.plugin")._test;
  const paid = [];
  const killer = { isPlayer: () => true, getInventory: () => ({ forceAdd: (_who, coins) => paid.push(coins.getAmount()) }) };
  const ring = new Item(20788, 1);
  removeImbueOnDeath({ item: ring, killer });
  assert.equal(ring.getId(), 11984, "ring of wealth (3)");
  assert.deepEqual(paid, [50000]);
  for (const [name, event] of [
    ["a PvM death", { killer: null }],
    ["an NPC kill", { killer: { isPlayer: () => false, getInventory: () => ({ forceAdd: () => paid.push("npc") }) } }],
  ]) {
    const extraDrops = [];
    const lost = new Item(20788, 1);
    removeImbueOnDeath({ item: lost, ...event, extraDrops });
    assert.equal(lost.getId(), 11984, `${name}: unimbued`);
    assert.deepEqual(extraDrops.map((item) => [item.getId(), item.getAmount()]), [[995, 50000]], `${name}: coins go with the death`);
  }
  const kept = new Item(20788, 1);
  removeImbueOnDeath({ item: kept, killer, kept: true });
  assert.equal(kept.getId(), 11984, "a kept ring is unimbued too");
  assert.deepEqual(paid, [50000, 50000], "a player killer is paid for a kept ring as well; no NPC is");
});

test("the ring of wealth spends its charge on arrival, from wherever the ring is", () => {
  const RingOfWealth = require("../plugins/items/RingOfWealth.plugin");
  const { teleport, TELEPORTS } = RingOfWealth._test;
  const player = createPlayer();
  const other = createPlayer();
  const ring = new Item(11984, 1);
  const othersRing = new Item(11984, 1);
  player.inventory.setItem(0, ring);
  other.equipment.setItem(Equipment.RING_SLOT, othersRing);
  pendingArrivals = [];
  teleport(player, { interfaceId: 149, slot: 0 }, ring, TELEPORTS[0].destination);
  assert.equal(ring.getId(), 11984, "nothing is spent before arrival");

  player.inventory.setItem(0, null);
  const worn = new Item(11984, 1);
  player.equipment.setItem(Equipment.RING_SLOT, worn);
  pendingArrivals.shift()();
  assert.equal(worn.getId(), 11986, "ring of wealth (2)");
  assert.equal(othersRing.getId(), 11984, "another player's ring is untouched");

  TeleportHandler.checkReqs = () => false;
  try {
    teleport(player, { interfaceId: Equipment.INVENTORY_INTERFACE_ID, slot: Equipment.RING_SLOT }, worn, TELEPORTS[0].destination);
  } finally {
    TeleportHandler.checkReqs = (p, target, wildernessLevel) => {
      teleports.push({ target: [target.getX(), target.getY(), target.getZ()], wildernessLevel });
      return true;
    };
  }
  assert.equal(pendingArrivals.length, 0);
  assert.equal(worn.getId(), 11986, "a refused teleport keeps the charge");
});

test("the ring of wealth's destination tiles are the Wiki's", () => {
  const { RING_OF_WEALTH_DESTINATIONS } = require("../plugins/items/Teleports.Jewellery");
  const tiles = Object.fromEntries(RING_OF_WEALTH_DESTINATIONS.map((d) => [d.label, d.tile]));
  assert.deepEqual(tiles["Miscellania"], [2534, 3862, 0]);
  assert.deepEqual(tiles["Falador Park"], [2995, 3375, 0]);
});

function useOnObject(player, item, objectId) {
  const event = { player, item, itemId: item.getId(), objectId, handled: false };
  itemOnObject(event);
  return event;
}

test("the Fountain of Rune recharges glories and skills necklaces to 6", () => {
  completeQuests.clear();
  completeQuests.add("Heroes' Quest").add("Legends' Quest");
  const player = createPlayer();
  const glory = new Item(ItemIds.AMULET_OF_GLORY, 1);
  const skills = new Item(ItemIds.SKILLS_NECKLACE_2_, 1);
  const worn = new Item(ItemIds.AMULET_OF_GLORY_1_, 1);
  player.inventory.setItem(0, glory);
  player.inventory.setItem(1, skills);
  player.equipment.setItem(Equipment.AMULET_SLOT, worn);
  const event = useOnObject(player, glory, ObjectIdentifiers.FOUNTAIN_OF_RUNE);
  assert.equal(event.handled, true);
  assert.ok([ItemIds.AMULET_OF_GLORY_6_, ItemIdentifiers.AMULET_OF_ETERNAL_GLORY].includes(glory.getId()));
  assert.equal(skills.getId(), ItemIds.SKILLS_NECKLACE_6_);
  assert.ok([ItemIds.AMULET_OF_GLORY_6_, ItemIdentifiers.AMULET_OF_ETERNAL_GLORY].includes(worn.getId()));
});

test("the Fountain of Rune can turn a trimmed glory into an eternal glory", () => {
  completeQuests.clear();
  completeQuests.add("Heroes' Quest");
  const player = createPlayer();
  const trimmed = new Item(ItemIds.AMULET_OF_GLORY_T1_, 1);
  player.inventory.setItem(0, trimmed);
  const random = Math.random;
  Math.random = () => 0;
  try {
    useOnObject(player, trimmed, ObjectIdentifiers.FOUNTAIN_OF_RUNE);
  } finally {
    Math.random = random;
  }
  assert.equal(trimmed.getId(), ItemIdentifiers.AMULET_OF_ETERNAL_GLORY);
});

test("the Legends' Guild totem pole recharges skills necklaces and combat bracelets to 4", () => {
  completeQuests.clear();
  completeQuests.add("Legends' Quest");
  const player = createPlayer();
  const skills = new Item(ItemIds.SKILLS_NECKLACE_1_, 1);
  const combat = new Item(ItemIds.COMBAT_BRACELET, 1);
  const glory = new Item(ItemIds.AMULET_OF_GLORY_1_, 1);
  player.inventory.setItem(0, skills);
  player.inventory.setItem(1, combat);
  player.inventory.setItem(2, glory);
  const event = useOnObject(player, skills, ObjectIdentifiers.TOTEM_POLE_5);
  assert.equal(event.handled, true);
  assert.equal(skills.getId(), ItemIds.SKILLS_NECKLACE_4_);
  assert.equal(combat.getId(), ItemIds.COMBAT_BRACELET_4_);
  assert.equal(glory.getId(), ItemIds.AMULET_OF_GLORY_1_, "the totem does not recharge glories");
  assert.equal(player.messages.at(-1), "The totem pole recharges your jewellery.");
});

test("the Fountain of Heroes recharges glories to 4 but not skills necklaces", () => {
  completeQuests.clear();
  completeQuests.add("Heroes' Quest").add("Legends' Quest");
  const player = createPlayer();
  const glory = new Item(ItemIds.AMULET_OF_GLORY_2_, 1);
  const skills = new Item(ItemIds.SKILLS_NECKLACE, 1);
  player.inventory.setItem(0, glory);
  player.inventory.setItem(1, skills);
  useOnObject(player, glory, ObjectIdentifiers.FOUNTAIN_OF_HEROES);
  assert.equal(glory.getId(), ItemIds.AMULET_OF_GLORY_4_);
  assert.equal(skills.getId(), ItemIds.SKILLS_NECKLACE);
  assert.equal(useOnObject(player, skills, ObjectIdentifiers.FOUNTAIN_OF_HEROES).handled, true);
  assert.equal(skills.getId(), ItemIds.SKILLS_NECKLACE);
});

test("the fountains need the jewellery's quest", () => {
  completeQuests.clear();
  const player = createPlayer();
  const glory = new Item(ItemIds.AMULET_OF_GLORY, 1);
  player.inventory.setItem(0, glory);
  useOnObject(player, glory, ObjectIdentifiers.FOUNTAIN_OF_RUNE);
  assert.equal(glory.getId(), ItemIds.AMULET_OF_GLORY);
  assert.equal(player.messages.at(-1), "Nothing interesting happens.");
});

// The map's morph parent has no named ObjectIdentifiers entry. Its displayed child is
// FOUNTAIN_OF_RUNE; item-on-object packets carry the parent id.
const RUNE_FOUNTAIN_MORPH_PARENT = 26782;

test("the mapped Fountain of Rune resolves its player-visible name", () => {
  completeQuests.clear();
  const player = createPlayer();
  const ring = new Item(ItemIdentifiers.RING_OF_WEALTH, 1);
  player.inventory.setItem(0, ring);
  assert.equal(useOnObject(player, ring, RUNE_FOUNTAIN_MORPH_PARENT).handled, true);
  assert.equal(ring.getId(), ItemIdentifiers.RING_OF_WEALTH_5_);
  assert.equal(player.messages.at(-1), "You feel a power emanating from the fountain as it recharges your jewellery.");
});

test("using a full ring charges other carried and worn jewellery, preserving imbues", () => {
  completeQuests.clear();
  completeQuests.add("Heroes' Quest").add("Legends' Quest");
  const player = createPlayer();
  const ids = [ItemIdentifiers.RING_OF_WEALTH_5_, ItemIdentifiers.RING_OF_WEALTH, ItemIdentifiers.RING_OF_WEALTH_I_, ItemIds.SKILLS_NECKLACE_2_, ItemIds.COMBAT_BRACELET_1_];
  const items = ids.map((id, slot) => { const item = new Item(id, 1); player.inventory.setItem(slot, item); return item; });
  const worn = new Item(ItemIdentifiers.RING_OF_WEALTH_I1_, 1);
  player.equipment.setItem(Equipment.RING_SLOT, worn);
  useOnObject(player, items[0], ObjectIdentifiers.FOUNTAIN_OF_RUNE);
  assert.deepEqual(items.map(item => item.getId()), [ItemIdentifiers.RING_OF_WEALTH_5_, ItemIdentifiers.RING_OF_WEALTH_5_, ItemIdentifiers.RING_OF_WEALTH_I5_, ItemIds.SKILLS_NECKLACE_6_, ItemIds.COMBAT_BRACELET_6_]);
  assert.equal(worn.getId(), ItemIdentifiers.RING_OF_WEALTH_I5_);
});

test("ring charging needs no quest and skips the other jewellery's unmet quests", () => {
  completeQuests.clear();
  const player = createPlayer();
  const ids = [ItemIdentifiers.RING_OF_WEALTH, ItemIds.AMULET_OF_GLORY, ItemIds.SKILLS_NECKLACE, ItemIds.COMBAT_BRACELET];
  const items = ids.map((id, slot) => { const item = new Item(id, 1); player.inventory.setItem(slot, item); return item; });
  useOnObject(player, items[0], ObjectIdentifiers.FOUNTAIN_OF_RUNE);
  assert.deepEqual(items.map(item => item.getId()), [ItemIdentifiers.RING_OF_WEALTH_5_, ...ids.slice(1)]);
});

test("a used skills necklace charges the other eligible families in both containers", () => {
  completeQuests.clear();
  completeQuests.add("Legends' Quest").add("Heroes' Quest");
  const player = createPlayer();
  const skills = new Item(ItemIds.SKILLS_NECKLACE_1_, 1);
  const ring = new Item(ItemIdentifiers.RING_OF_WEALTH, 1);
  const worn = new Item(ItemIds.COMBAT_BRACELET_2_, 1);
  player.inventory.setItem(0, skills);
  player.inventory.setItem(1, ring);
  player.equipment.setItem(Equipment.HANDS_SLOT, worn);
  assert.equal(useOnObject(player, skills, ObjectIdentifiers.FOUNTAIN_OF_RUNE).handled, true);
  assert.equal(skills.getId(), ItemIds.SKILLS_NECKLACE_6_);
  assert.equal(ring.getId(), ItemIdentifiers.RING_OF_WEALTH_5_);
  assert.equal(worn.getId(), ItemIds.COMBAT_BRACELET_6_);
});

test("Rune accepts noted skills necklaces and bracelets, preserving stack quantities", () => {
  completeQuests.clear();
  completeQuests.add("Legends' Quest");
  const player = createPlayer();
  const skills = new Item(ItemDefinition.forId(ItemIds.SKILLS_NECKLACE).getNoteId(), 150);
  const combat = new Item(ItemDefinition.forId(ItemIds.COMBAT_BRACELET_2_).getNoteId(), 75);
  const ring = new Item(ItemDefinition.forId(ItemIdentifiers.RING_OF_WEALTH).getNoteId(), 20);
  const glory = new Item(ItemDefinition.forId(ItemIds.AMULET_OF_GLORY).getNoteId(), 30);
  [skills, combat, ring, glory].forEach((item, slot) => player.inventory.setItem(slot, item));
  assert.equal(useOnObject(player, skills, RUNE_FOUNTAIN_MORPH_PARENT).handled, true);
  assert.deepEqual([skills.getId(), skills.getAmount()], [ItemDefinition.forId(ItemIds.SKILLS_NECKLACE_6_).getNoteId(), 150]);
  assert.deepEqual([combat.getId(), combat.getAmount()], [ItemDefinition.forId(ItemIds.COMBAT_BRACELET_6_).getNoteId(), 75]);
  assert.equal(ring.getId(), ItemDefinition.forId(ItemIdentifiers.RING_OF_WEALTH).getNoteId());
  assert.equal(glory.getId(), ItemDefinition.forId(ItemIds.AMULET_OF_GLORY).getNoteId());
  assert.equal(useOnObject(player, ring, RUNE_FOUNTAIN_MORPH_PARENT).handled, false);
  assert.equal(useOnObject(player, glory, RUNE_FOUNTAIN_MORPH_PARENT).handled, false);
});

// Cache morph parents are intentionally absent from ObjectIdentifiers (their name is null).
const HEROES_FOUNTAIN_MORPH_PARENT = 2939;
const LEGENDS_TOTEM_MORPH_PARENT = 2638;

test("the map's Heroes fountain charges carried and worn glories to four", () => {
  completeQuests.clear();
  completeQuests.add("Heroes' Quest");
  const player = createPlayer();
  const carried = new Item(ItemIds.AMULET_OF_GLORY_1_, 1);
  const worn = new Item(ItemIds.AMULET_OF_GLORY_T2_, 1);
  player.inventory.setItem(0, carried);
  player.equipment.setItem(Equipment.AMULET_SLOT, worn);
  assert.equal(useOnObject(player, carried, HEROES_FOUNTAIN_MORPH_PARENT).handled, true);
  assert.equal(carried.getId(), ItemIds.AMULET_OF_GLORY_4_);
  assert.equal(worn.getId(), ItemIds.AMULET_OF_GLORY_T4_);
});

test("the map's Legends totem charges to four and keeps existing five/six charges", () => {
  completeQuests.clear();
  completeQuests.add("Legends' Quest");
  const player = createPlayer();
  const ids = [ItemIds.SKILLS_NECKLACE, ItemIds.COMBAT_BRACELET_1_, ItemIds.SKILLS_NECKLACE_5_, ItemIds.COMBAT_BRACELET_6_];
  const items = ids.map((id, slot) => { const item = new Item(id, 1); player.inventory.setItem(slot, item); return item; });
  assert.equal(useOnObject(player, items[0], LEGENDS_TOTEM_MORPH_PARENT).handled, true);
  assert.deepEqual(items.map(item => item.getId()), [ItemIds.SKILLS_NECKLACE_4_, ItemIds.COMBAT_BRACELET_4_, ...ids.slice(2)]);
});

test("unrelated Kharazi Jungle totems do not recharge jewellery", () => {
  completeQuests.clear();
  completeQuests.add("Legends' Quest");
  const player = createPlayer();
  const skills = new Item(ItemIds.SKILLS_NECKLACE, 1);
  player.inventory.setItem(0, skills);
  for (const id of [ObjectIdentifiers.TOTEM_POLE_2, ObjectIdentifiers.TOTEM_POLE_3, ObjectIdentifiers.TOTEM_POLE_4]) {
    assert.equal(useOnObject(player, skills, id).handled, false);
    assert.equal(skills.getId(), ItemIds.SKILLS_NECKLACE);
  }
});

test("desktop and mobile cache transforms both resolve the charging sites", () => {
  completeQuests.clear();
  completeQuests.add("Heroes' Quest").add("Legends' Quest");
  for (const clientType of [0, 1]) {
    const player = createPlayer({ clientType });
    for (const [objectId, before, after] of [
      [RUNE_FOUNTAIN_MORPH_PARENT, ItemIdentifiers.RING_OF_WEALTH, ItemIdentifiers.RING_OF_WEALTH_5_],
      [HEROES_FOUNTAIN_MORPH_PARENT, ItemIds.AMULET_OF_GLORY, ItemIds.AMULET_OF_GLORY_4_],
      [LEGENDS_TOTEM_MORPH_PARENT, ItemIds.SKILLS_NECKLACE, ItemIds.SKILLS_NECKLACE_4_],
    ]) {
      const item = new Item(before, 1);
      player.inventory.setItem(0, item);
      assert.equal(useOnObject(player, item, objectId).handled, true);
      assert.equal(item.getId(), after);
    }
  }
});

test("the digsite pendant's Lithkren and Fossil Island teleports need Dragon Slayer II and Bone Voyage (Wiki)", () => {
  for (const [label, key, name] of [["Lithkren Dungeon", "dragon_slayer_ii", "Dragon Slayer II"], ["Fossil Island", "bone_voyage", "Bone Voyage"]]) {
    const player = createPlayer();
    const pendant = new Item(ItemIds.DIGSITE_PENDANT_5_, 1);
    player.inventory.setItem(0, pendant);
    const before = teleports.length;
    inventoryClick(player, pendant, "Rub");
    pick(label);
    assert.equal(teleports.length, before, `${label}: no teleport before ${name}`);
    assert.deepEqual(player.statements.at(-1), "You have not yet unlocked that destination.", "the Wiki's line");
    assert.equal(pendant.getId(), ItemIds.DIGSITE_PENDANT_5_, "no charge used");
    doneQuestKeys.add(key);
    inventoryClick(player, pendant, "Rub");
    pick(label);
    assert.equal(teleports.length, before + 1, `${label}: after ${name} it teleports`);
    doneQuestKeys.delete(key);
  }
});

test("the games necklace's Tears of Guthix needs Tears of Guthix (Wiki)", () => {
  const player = createPlayer();
  const necklace = new Item(ItemIds.GAMES_NECKLACE_8_, 1);
  player.inventory.setItem(0, necklace);
  const before = teleports.length;
  inventoryClick(player, necklace, "Rub");
  pick("Tears of Guthix");
  assert.equal(teleports.length, before, "no teleport before the quest");
  assert.deepEqual(player.statements.at(-1), "You have not yet unlocked that destination.");
  assert.equal(necklace.getId(), ItemIds.GAMES_NECKLACE_8_, "no charge used");
  doneQuestKeys.add("tears_of_guthix");
  try {
    inventoryClick(player, necklace, "Rub");
    pick("Tears of Guthix");
  } finally {
    doneQuestKeys.delete("tears_of_guthix");
  }
  assert.equal(teleports.length, before + 1, "teleports after it");
});
