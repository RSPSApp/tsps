// Run after `yarn build`: node --test tests/brimhaven-agility-arena-store.test.cjs
// Pirate Jackie's Agility Arena Store with all plugins, the real cache and real widget packets.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { GameConstants } = require("../dist/game/GameConstants");
const ROOT = path.resolve(__dirname, "..");
const JACKIE = { x: 2811, y: 3192 };
/** The cache's stock order (omnishop row agilityarena_rewards_newshop). */
const ENTRY = { XP: 0, TOADFLAX: 1, SNAPDRAGON: 2, RECOLOUR: 3, HOOK: 4, AMYLASE: 5 };
let core, Store, Items;
let actorIndex = 300;

before(async () => {
  await CachePipeline.initialize(ROOT);
  PluginManager.loadFromDirectory(path.join(ROOT, "plugins"));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(JACKIE.x, JACKIE.y);
  Store = require("../plugins/minigames/brimhavenagilityarena/Store.BrimhavenAgilityArena");
  Items = core.ItemIdentifiers;
});

function channel() {
  return {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
}

function shopper(t, inventory = []) {
  const transport = channel();
  const p = new Player(new PlayerSession(transport));
  p.setUsername("jackieqa" + actorIndex);
  p.setIndex(actorIndex++);
  p.setRegistered(true);
  p.setLocation(new core.Location(JACKIE.x - 1, JACKIE.y, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (text) => {
    messages.push(text);
    return p.getPacketSender();
  });
  for (const [id, amount] of inventory) p.getInventory().add(new core.Item(id, amount), false);
  const npc = core.NPC.create(core.NpcIdentifiers.PIRATE_JACKIE_THE_FRUIT, new core.Location(JACKIE.x, JACKIE.y, 0));
  const connection = new ClientConnection(transport);
  connection.player = p;
  const trade = () => PluginManager.emitNpcInteraction({
    player: p, npc, definition: npc.getDefinition(), option: "Trade", clickType: 3, handled: false,
  });
  async function buy(entry, op = 2) {
    const uid = core.CacheDefinitions.getComponentId("omnishop_main:list");
    await connection.dispatch([{
      type: "widget_action", widgetId: uid, groupId: uid >>> 16, childId: uid & 65535, slot: entry * 12, buttonNum: op,
    }]);
    connection.processTurnPackets();
  }
  return {
    p, npc, messages, trade, buy,
    amount: (id) => p.getInventory().getAmount(id),
    // The stored total keeps tenths; getExperience shows whole experience.
    xp: () => p.getSkillManager().skills.experience[core.Skill.AGILITY.getIndex()],
  };
}

const obj = (name) => core.CacheDefinitions.getObjId(name);

test("Trade opens the cache's Agility Arena Store, not the generic shop", (t) => {
  const f = shopper(t);
  assert.equal(f.trade(), true);
  assert.equal(f.p.getInterfaceId(), 819, "omnishop_main");
  assert.equal(f.p.getAttribute("omnishop:shop"), core.CacheDefinitions.getDbRowId(Store.STORE));
});

test("a ticket buys 345 Agility XP, 10% more with Karamja gloves 2 or better", async (t) => {
  const plain = shopper(t, [[Items.AGILITY_ARENA_TICKET_3, 3]]);
  plain.trade();
  const before = plain.xp();
  await plain.buy(ENTRY.XP);
  assert.equal(plain.amount(Items.AGILITY_ARENA_TICKET_3), 2);
  const gained = plain.xp() - before;
  assert.equal(gained, Math.floor(345 * GameConstants.EXPERIENCE_MULTIPLIER * 10) / 10);
  assert.equal(plain.amount(Store.STOCK.XP), 0, "the XP row hands over no item");

  const gloved = shopper(t, [[Items.AGILITY_ARENA_TICKET_3, 1]]);
  gloved.p.getEquipment().setItem(core.Equipment.HANDS_SLOT, new core.Item(Items.KARAMJA_GLOVES_2, 1));
  gloved.trade();
  const start = gloved.xp();
  await gloved.buy(ENTRY.XP);
  assert.equal(gloved.amount(Items.AGILITY_ARENA_TICKET_3), 0);
  assert.equal(gloved.xp() - start, Math.floor(379.5 * GameConstants.EXPERIENCE_MULTIPLIER * 10) / 10);
});

test("Buy 10 on Agility XP spends the tickets held, then refuses the rest (rsprox 75)", async (t) => {
  const f = shopper(t, [[Items.AGILITY_ARENA_TICKET_3, 3]]);
  f.trade();
  const before = f.xp();
  await f.buy(ENTRY.XP, 4);
  assert.equal(f.amount(Items.AGILITY_ARENA_TICKET_3), 0);
  assert.equal(f.xp() - before, 3 * Math.floor(345 * GameConstants.EXPERIENCE_MULTIPLIER * 10) / 10);
  assert.ok(f.messages.includes("You don't have enough Agility Arena Tickets."), f.messages.join(" | "));
});

/** A shopper whose inventory is full: these items, then bronze daggers. */
function fullShopper(t, inventory) {
  const f = shopper(t, inventory);
  while (f.p.getInventory().getFreeSlots()) f.p.getInventory().add(new core.Item(obj("bronze_dagger"), 1), false);
  f.trade();
  return f;
}

test("Agility XP needs no free inventory slot", async (t) => {
  const xp = Math.floor(345 * GameConstants.EXPERIENCE_MULTIPLIER * 10) / 10;
  for (const [op, spent] of [[2, 1], [3, 3]]) {
    const f = fullShopper(t, [[Items.AGILITY_ARENA_TICKET_3, 3]]);
    const before = f.xp();
    await f.buy(ENTRY.XP, op);
    assert.equal(f.amount(Items.AGILITY_ARENA_TICKET_3), 3 - spent, `op ${op}`);
    assert.equal(f.xp() - before, spent * xp, `op ${op}`);
    assert.ok(!f.messages.includes("You don't have enough inventory space."), f.messages.join(" | "));
  }
});

test("the herbs still need inventory space", async (t) => {
  // The voucher stack outlives the payment, so its slot doesn't free up for the herb.
  const f = fullShopper(t, [[Items.BRIMHAVEN_VOUCHER, 6]]);
  await f.buy(ENTRY.TOADFLAX);
  assert.equal(f.amount(Items.BRIMHAVEN_VOUCHER), 6);
  assert.ok(f.messages.includes("You don't have enough inventory space."), f.messages.join(" | "));
});

test("Buy 5 on the herbs still buys five", async (t) => {
  const f = shopper(t, [[Items.BRIMHAVEN_VOUCHER, 15]]);
  f.trade();
  await f.buy(ENTRY.TOADFLAX, 3);
  assert.equal(f.amount(Items.BRIMHAVEN_VOUCHER), 0);
  assert.equal(f.amount(core.ItemDefinition.forId(obj("toadflax")).getNoteId()), 5);
});

test("the info panel texts are the captured ones", () => {
  const text = (stock) => {
    const request = { shop: Store.STORE, stock, description: "" };
    Store.describe(request);
    return request.description;
  };
  assert.equal(text("agility_arena_shop_stock_1"), "Grants a flat amount of Agility experience.");
  assert.equal(text("agility_arena_shop_stock_4"), "Recolours your Graceful set to be in the Brimhaven colour scheme.");
  assert.equal(text("agility_arena_shop_stock_5"), "You should see the shark...");
});

test("other shops' multiplier-0 rows still buy one unit an order", () => {
  const request = { shop: "tithe_shop_data", stock: "tithe_shop_autoweed_toggle", single: true };
  Store.units(request);
  assert.equal(request.single, true);
});

test("without a ticket the XP row refuses and pays nothing", async (t) => {
  const f = shopper(t);
  f.trade();
  const before = f.xp();
  await f.buy(ENTRY.XP);
  assert.equal(f.xp(), before);
  assert.ok(f.messages.includes("You don't have enough Agility Arena Tickets."), f.messages.join(" | "));
});

test("vouchers buy the herbs noted at the Wiki's prices", async (t) => {
  const f = shopper(t, [[Items.BRIMHAVEN_VOUCHER, 13]]);
  f.trade();
  await f.buy(ENTRY.TOADFLAX);
  await f.buy(ENTRY.SNAPDRAGON);
  assert.equal(f.amount(Items.BRIMHAVEN_VOUCHER), 0, "3 + 10 vouchers");
  assert.equal(f.amount(core.ItemDefinition.forId(obj("toadflax")).getNoteId()), 1);
  assert.equal(f.amount(core.ItemDefinition.forId(obj("snapdragon")).getNoteId()), 1);
});

test("the recolour takes 250 vouchers and the whole outfit, and hands back the Agility Arena one", async (t) => {
  const pieces = ["hood", "cape", "top", "legs", "gloves", "boots"];
  const f = shopper(t, [[Items.BRIMHAVEN_VOUCHER, 260], ...pieces.map((piece) => [obj(`graceful_${piece}`), 1])]);
  f.trade();
  await f.buy(ENTRY.RECOLOUR);
  assert.equal(f.amount(Items.BRIMHAVEN_VOUCHER), 10);
  for (const piece of pieces) {
    assert.equal(f.amount(obj(`graceful_${piece}`)), 0, piece);
    assert.equal(f.amount(obj(`graceful_${piece}_skillcapecolour`)), 1, `${piece} recoloured`);
  }
  assert.equal(f.amount(Items.GRACEFUL_RECOLOUR), 0, "no dummy item");
});

test("the recolour refuses an incomplete outfit", async (t) => {
  const f = shopper(t, [[Items.BRIMHAVEN_VOUCHER, 250], [obj("graceful_hood"), 1]]);
  f.trade();
  await f.buy(ENTRY.RECOLOUR);
  assert.equal(f.amount(Items.BRIMHAVEN_VOUCHER), 250);
  assert.equal(f.amount(obj("graceful_hood")), 1);
  assert.equal(f.amount(obj("graceful_hood_skillcapecolour")), 0);
});

test("the old-or-new shop question needs both tickets", (t) => {
  const definition = core.NpcDefinition.forId(core.NpcIdentifiers.PIRATE_JACKIE_THE_FRUIT);
  const text = "If the player has both old and new tickets:";
  const ask = (inventory) => Store.answerCondition({ definition, text, player: shopper(t, inventory).p });
  assert.equal(ask([[Items.AGILITY_ARENA_TICKET_3, 1]]), false);
  assert.equal(ask([[Items.AGILITY_ARENA_TICKET, 1]]), false);
  assert.equal(ask([[Items.AGILITY_ARENA_TICKET, 1], [Items.AGILITY_ARENA_TICKET_3, 1]]), true);
  assert.equal(Store.answerCondition({ definition, text: "Otherwise:", player: shopper(t).p }), null);
});

test("the transcript's new-shop step opens the store a tick later", (t) => {
  const f = shopper(t);
  const request = { player: f.p, action: "open_shop", target: "Agility Arena Store", handled: false };
  Store.openFromDialogue(request);
  assert.equal(request.handled, true);
  assert.equal(request.end, true);
  for (let i = 0; i < 2; i++) core.TaskManager.process();
  assert.equal(f.p.getInterfaceId(), 819);
});

test("discontinued tickets used on Jackie start her conversion and become vouchers 1:1", (t) => {
  const f = shopper(t, [[Items.AGILITY_ARENA_TICKET, 7], [Items.BRIMHAVEN_VOUCHER, 2]]);
  let started = null;
  t.mock.method(PluginManager, "emitCustomEvent", function (name, payload) {
    if (name === "npc-dialogue:start") started = payload;
  });
  const event = { player: f.p, target: f.npc, definition: f.npc.getDefinition(), npcId: f.npc.getId(), itemId: Items.AGILITY_ARENA_TICKET, item: new core.Item(Items.AGILITY_ARENA_TICKET, 7), handled: false };
  Store.useOldTicket(event);
  t.mock.restoreAll();
  assert.equal(event.handled, true);
  assert.ok(started, "the transcript variant starts");
  assert.equal(started.variant, "using-a-discontinued-agility-arena-ticket-on-pirate-jackie-the-fruit");
  const steps = started.select([{ type: "choice", options: [{ text: "Convert [number] tickets to vouchers" }] }]);
  assert.equal(steps[0].options[0].text, "Convert 7 tickets to vouchers");

  Store.convert({ player: f.p, kind: "message", stepId: "DTDJGP", handled: false });
  assert.equal(f.amount(Items.AGILITY_ARENA_TICKET), 0);
  assert.equal(f.amount(Items.BRIMHAVEN_VOUCHER), 9);
});

test("other items on Jackie are left alone", (t) => {
  const f = shopper(t, [[Items.AGILITY_ARENA_TICKET_3, 1]]);
  const event = { player: f.p, target: f.npc, definition: f.npc.getDefinition(), itemId: Items.AGILITY_ARENA_TICKET_3, handled: false };
  Store.useOldTicket(event);
  assert.equal(event.handled, false);
});
