// Run after `yarn build`: node --test tests/jewellery.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

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
TeleportHandler.teleport = (player, target, type, warning, onArrival) => onArrival?.();

let prompts = [];
let itemAction;
let itemOnObject;
const completeQuests = new Set();
require("../plugins/quests/QuestRuntime").getRegisteredQuests = () =>
  ["Heroes' Quest", "Legends' Quest"].map((name) => ({ name, isComplete: () => completeQuests.has(name) }));
const { ObjectIdentifiers } = require("../dist/util/ObjectIdentifiers");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const Jewellery = require("../plugins/items/Jewellery.plugin");
Jewellery.register({
  getBonusManager: () => ({ update() {} }),
  core: { ObjectIdentifiers, ItemIdentifiers },
  onItemAction: (handler) => { itemAction = handler; },
  onItemOnObject: (handler) => { itemOnObject = handler; },
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

function createPlayer({ farming = 1 } = {}) {
  const messages = [];
  return {
    messages,
    inventory: container(28),
    equipment: container(14),
    getInventory() { return this.inventory; },
    getEquipment() { return this.equipment; },
    sendMessage: (message) => messages.push(message),
    getUpdateFlag: () => ({ flag() {} }),
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

beforeEach(() => {
  teleports.length = 0;
  prompts = [];
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
  assert.ok(player.messages.includes("<col=7F00FF>Your amulet has 3 charges left.</col>"));
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

test("a games necklace crumbles after its last charge", () => {
  const player = createPlayer();
  const necklace = new Item(ItemIds.GAMES_NECKLACE_1_, 1);
  player.inventory.setItem(3, necklace);
  inventoryClick(player, necklace, "Rub");
  pick("Wintertodt Camp");
  assert.deepEqual(teleports[0], { target: [1627, 3941, 0], wildernessLevel: 20 });
  assert.equal(player.inventory.getItems()[3], null);
  assert.ok(player.messages.includes("<col=7F00FF>Your games necklace crumbles to dust.</col>"));
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
  inventoryClick(player, pendant, "Rub", { subOpId: 2 });
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
  assert.ok(player.messages.includes("<col=7F00FF>Your ring of returning has 4 uses left.</col>"));
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
  assert.deepEqual(ACTIONS.slice(4).map((action) => action.type), ["boss-log", "coin-collection"]);
});

test("the slayer ring's Rub submenu is its actions: Check, Teleport, then Master, Partner and Log", () => {
  const player = createPlayer();
  const ring = new Item(ItemIds.SLAYER_RING_8_, 1);
  player.inventory.setItem(0, ring);

  inventoryClick(player, ring, "Rub", { subOpId: 1 });
  assert.equal(player.messages.at(-1), "Your slayer ring has 8 charges left.");
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

test("the ring of dueling's fourth destination is the Fortis Colosseum", () => {
  const player = createPlayer();
  const ring = new Item(ItemIds.RING_OF_DUELING_8_, 1);
  player.inventory.setItem(0, ring);
  inventoryClick(player, ring, "Rub", { subOpId: 4 });
  assert.deepEqual(teleports.at(-1).target, [1793, 3107, 0]);
});

function useOnObject(player, item, objectId) {
  const event = { player, item, itemId: item.getId(), objectId, handled: false };
  itemOnObject(event);
  return event;
}

test("the Fountain of Rune recharges every glory and skills necklace carried or worn to 6", () => {
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
