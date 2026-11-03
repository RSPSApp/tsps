// Run after `yarn build`: node --test tests/quest-shops.test.cjs
//
// Issue 1971: shops the Wiki keeps shut until a quest is done opened for anyone on Trade.
// plugins/quests/data/quest-shops.json against shops.json and the Wiki's refusal lines.
const assert = require("node:assert/strict");
const { beforeEach, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { NpcIdentifiers } = require("../dist/util/NpcIdentifiers");

const Shops = require("../plugins/quests/Shops.Quests");
const DATA = require("../plugins/quests/data/quest-shops.json");
const shopsJson = require("../data/definitions/shops.json");

/** Quests this fake server has, and which of them the player finished or started. */
const KNOWN = new Set(["Dragon Slayer I", "The Fremennik Trials", "Cabin Fever", "Enter the Abyss", "Regicide", "Watchtower"]);
const state = { complete: new Set(), started: new Set() };
const dialogues = [];

function api() {
  return {
    core: {
      ItemIdentifiers,
      NpcIdentifiers,
      ShopDefinition: { forId: (id) => ({ getName: () => shopsJson.find((shop) => shop.id === id)?.name }) },
      DialogueChainBuilder: class { constructor() { this.entries = []; } add(entry) { this.entries.push(entry); return this; } },
      NpcDialogue: class { constructor(index, npcId, text) { Object.assign(this, { index, npcId, text }); } },
      StatementDialogue: class { constructor(index, text) { Object.assign(this, { index, text, statement: true }); } },
    },
    emitCustomEvent(name, request) {
      if (!KNOWN.has(request.name)) return;
      if (name === "quest:is-complete") request.complete = state.complete.has(request.name);
      if (name === "quest:is-started") request.started = state.started.has(request.name) || state.complete.has(request.name);
    },
  };
}

function player(carrying = []) {
  const messages = [];
  const inventory = { contains: (id) => carrying.includes(id) };
  return {
    messages,
    sendMessage: (message) => messages.push(message),
    getInventory: () => inventory,
    getEquipment: () => ({ contains: () => false }),
    getDialogueManager: () => ({ startDialogues: (chain) => dialogues.push(chain.entries) }),
    isPlayerBot: () => false,
  };
}

const shopId = (name) => shopsJson.find((shop) => shop.name === name).id;

function trade(who, name) {
  const event = { player: who, shopId: shopId(name), allow: null };
  Shops._test.canShop(event);
  return event.allow;
}

beforeEach(() => {
  Shops._test.setApi(api());
  state.complete.clear();
  state.started.clear();
  dialogues.length = 0;
});

test("Oziach won't sell his armour before Dragon Slayer I, with his own line", () => {
  const who = player();
  assert.equal(trade(who, "Oziach (shop)"), false);
  assert.deepEqual(dialogues[0].map((entry) => [entry.npcId, entry.text]),
    [[NpcIdentifiers.OZIACH, "I ain't got nothing to sell ye, adventurer. Leave me be!"]]);
  state.complete.add("Dragon Slayer I");
  assert.equal(trade(who, "Oziach (shop)"), null, "after the quest the shop opens");
});

test("Rellekka's traders refuse outerlanders with the Wiki's game messages", () => {
  const who = player();
  assert.equal(trade(who, "Skulgrimen's Battle Gear"), false);
  assert.equal(trade(who, "Rellekka Longhall Bar"), false);
  assert.deepEqual(who.messages, ["Only Fremenniks may purchase weapons and armour here.", "Only Fremenniks may buy drinks here."]);
  state.complete.add("The Fremennik Trials");
  assert.equal(trade(who, "Fremennik Fish Monger"), null);
});

test("a shop whose quest the server doesn't have stays open", () => {
  assert.equal(trade(player(), "Ava's Odds and Ends"), null);
});

test("Mos Le'Harmless traders want the Book o' Piracy as well as the quest", () => {
  state.started.add("Cabin Fever");
  assert.equal(trade(player(), "Two Feet Charley's Fish Shop."), false);
  assert.equal(trade(player([ItemIdentifiers.BOOK_O_PIRACY]), "Two Feet Charley's Fish Shop."), null);
  assert.equal(trade(player([ItemIdentifiers.BOOK_O_PIRACY]), "Smithing Smith's Shop."), false, "Smith needs Cabin Fever done");
});

test("a started-only gate opens once the quest is started", () => {
  const who = player();
  assert.equal(trade(who, "Dal's General Ogre Supplies"), false);
  assert.deepEqual(who.messages, ["You need to start Watchtower to trade here."]);
  state.started.add("Watchtower");
  assert.equal(trade(who, "Dal's General Ogre Supplies"), null);
});

test("player bots are never gated", () => {
  const bot = { ...player(), isPlayerBot: () => true };
  assert.equal(trade(bot, "Oziach (shop)"), null);
});

test("gated stock is hidden until its quest is done", () => {
  const event = { player: player(), shopName: "Quartermaster's Stores", itemId: ItemIdentifiers.DRAGON_HALBERD, visible: true };
  Shops._test.stockVisible(event);
  assert.equal(event.visible, false);
  state.complete.add("Regicide");
  const after = { ...event, visible: true };
  Shops._test.stockVisible(after);
  assert.equal(after.visible, true);
});

test("Battle Runes opens its post-miniquest version once Enter the Abyss is done", () => {
  const shops = ["Battle Runes (Post-miniquest)", "Battle Runes (Pre-miniquest)"];
  const before = { player: player(), shops, shop: null };
  Shops._test.pickVersion(before);
  assert.equal(before.shop, "Battle Runes (Pre-miniquest)");
  state.complete.add("Enter the Abyss");
  const after = { player: player(), shops, shop: null };
  Shops._test.pickVersion(after);
  assert.equal(after.shop, "Battle Runes (Post-miniquest)");
});

test("every gate names a shops.json shop and stock it carries", () => {
  const names = new Set(shopsJson.map((shop) => shop.name));
  for (const entry of DATA.shops) for (const name of entry.shops) assert.ok(names.has(name), name);
  for (const entry of [...DATA.stock, ...DATA.versions]) assert.ok(names.has(entry.shop), entry.shop);
  for (const entry of DATA.stock) {
    const stock = shopsJson.find((shop) => shop.name === entry.shop).originalStock.map((row) => row.id);
    for (const item of entry.items) assert.ok(stock.includes(ItemIdentifiers[item]), `${entry.shop} sells ${item}`);
  }
});
