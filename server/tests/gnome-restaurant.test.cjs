// Run after `yarn build`: node --test tests/gnome-restaurant.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");

const core = PluginManager.getCoreApi();
const BOX = core.ItemIdentifiers.ALUFT_ALOFT_BOX;
const TOKEN = core.ItemIdentifiers.REWARD_TOKEN_4;
const COINS = core.ItemIdentifiers.COINS;

const GnomeRestaurant = require("../plugins/minigames/GnomeRestaurant.plugin");
const DATA = require("../plugins/minigames/gnomerestaurant/data/gnome-restaurant-orders.json");
const {
  init, reset, sessions, sessionOf, talkTo, acceptOrder, declineOrder, abandon,
  tick, advanceTime, rollOrder, isLocked, creditsOf, deliver, rollEasyTip,
  rollHardReward, eligibleRewards, awardCredits,
} = GnomeRestaurant._test;

let prompt = null;
let dialogueVariant = null;
init({
  core: {
    ...core,
    PluginManager: { emitNpcDialogueVariant: () => dialogueVariant },
  },
  sendMultiChatboxPrompt: (player, title, ...pairs) => {
    const options = [];
    for (let i = 0; i < pairs.length; i += 2) options.push({ text: pairs[i], pick: pairs[i + 1] });
    prompt = { player, title, options };
    return true;
  },
});

beforeEach(() => {
  reset();
  prompt = null;
  dialogueVariant = null;
});

function makeInventory(items = {}) {
  const store = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  return {
    store,
    contains: (id) => (store.get(id) ?? 0) > 0,
    getAmount: (id) => store.get(id) ?? 0,
    getFreeSlots: () => 28 - [...store.values()].filter((amount) => amount > 0).length,
    addItem: (item) => store.set(item.getId(), (store.get(item.getId()) ?? 0) + item.getAmount()),
    adds: (id, amount) => store.set(id, (store.get(id) ?? 0) + amount),
    deleteNumber: (id, amount) => store.set(id, (store.get(id) ?? 0) - amount),
  };
}

function player({ cooking = 99, items = {} } = {}) {
  const attributes = new Map();
  const inventory = makeInventory(items);
  const p = {
    messages: [], xp: 0, dialogues: 0, builder: null, inventory,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getSkillManager: () => ({
      getCurrentLevel: () => cooking,
      addExperiences: (_, xp) => { p.xp += xp; },
    }),
    getDialogueManager: () => ({ startDialogues: (builder) => { p.dialogues++; p.builder = builder; } }),
    sendMessage: (message) => p.messages.push(message),
  };
  return p;
}

/** The NPC lines of the dialogue the player was last sent. */
function dialogueTexts(p) {
  return [...(p.builder?.getDialogues?.().values() ?? [])]
    .map((dialogue) => dialogue.getText?.())
    .filter(Boolean);
}

function orderFor(tier, npcName, item = DATA.items[tier][0]) {
  return { tier, itemId: item.id, itemName: item.name, npcName, hint: item.name };
}

function deliverTo(p, npcName, itemId) {
  const event = {
    player: p,
    itemId,
    handled: false,
    target: { getCurrentDefinition: () => ({ getName: () => npcName }) },
  };
  deliver(event);
  return event;
}

function pickOption(text) {
  return prompt.options.find((option) => option.text === text);
}

/** An rng that lands inside the weight of one named tip entry for this customer. */
function fixedRng(npcName, itemName) {
  const entries = eligibleRewards(npcName);
  const total = entries.reduce((sum, entry) => sum + entry.rate[0] / entry.rate[1], 0);
  let acc = 0;
  for (const entry of entries) {
    const weight = entry.rate[0] / entry.rate[1];
    if (entry.items[0].name === itemName) return () => (acc + weight / 2) / total;
    acc += weight;
  }
  throw new Error(`${npcName} cannot give ${itemName}`);
}

// --- Talking to Gianne jnr.

test("under 29 Cooking Gianne refuses; at 29 he offers easy and hard", () => {
  const weak = player({ cooking: 10 });
  talkTo({ player: weak });
  assert.ok(dialogueTexts(weak).some((line) => /required cooking experience/i.test(line)));

  const cook = player({ cooking: 29 });
  talkTo({ player: cook });
  assert.equal(prompt.player, cook);
  assert.deepEqual(prompt.options.map((option) => option.text), [
    "I think I'll warm up with an easy one.",
    "The edge of the world is no limit for Aluft Aloft Food Deliveries!",
    "I've changed my mind, there's something else I need to do now.",
  ]);
});

test("declining a tier locks it for five minutes and hides it from the choice", () => {
  const cook = player();
  declineOrder(cook, "easy");
  assert.equal(isLocked(cook, "easy"), true);
  talkTo({ player: cook });
  assert.equal(pickOption("I think I'll warm up with an easy one."), undefined);
  assert.ok(pickOption("The edge of the world is no limit for Aluft Aloft Food Deliveries!"));
});

test("a quest-owned Gianne dialogue falls through to the transcript runtime", () => {
  dialogueVariant = "yewnock-s-legacy-talking-to-gianne-jnr";
  const cook = player();
  assert.equal(talkTo({ player: cook }), false, "not handled, so the transcript plays");
  dialogueVariant = null;
  talkTo({ player: cook });
  assert.ok(prompt, "the minigame offers a job again");
});

test("only one order at a time: a second order is refused", () => {
  const cook = player();
  acceptOrder(cook, orderFor("easy", "Burkor"));
  const first = sessionOf(cook);
  assert.ok(first);
  assert.equal(cook.inventory.getAmount(BOX), 1, "the order box");
  acceptOrder(cook, orderFor("hard", "Wingstone"));
  assert.equal(sessionOf(cook), first, "the original order stays");
  assert.equal(cook.inventory.getAmount(BOX), 1, "no second box");
});

// --- Time limit

test("an expired order discards the box and the order", () => {
  const cook = player();
  acceptOrder(cook, orderFor("easy", "Burkor"));
  sessionOf(cook).deadline = Date.now() - 1;
  tick();
  assert.equal(sessionOf(cook), undefined);
  assert.equal(cook.inventory.getAmount(BOX), 0, "the box is discarded");
  assert.ok(cook.messages.some((message) => /delivery is too late/i.test(message)));
});

test("agent:advance-time moves the deadline and expires the order", () => {
  const cook = player();
  acceptOrder(cook, orderFor("easy", "Burkor"));
  const event = { player: cook, ms: 7 * 60_000, handledBy: [] };
  advanceTime(event);
  assert.deepEqual(event.handledBy, ["GnomeRestaurant"]);
  assert.equal(sessionOf(cook), undefined);
  assert.ok(cook.messages.some((message) => /delivery is too late/i.test(message)));
});

// --- Delivery

test("the correct dish to the assigned gnome pays the easy coin tip once", () => {
  const cook = player({ items: { 2217: 1 } });
  acceptOrder(cook, orderFor("easy", "Burkor", { id: 2217, name: "Toad crunchies" }));
  const event = deliverTo(cook, "Burkor", 2217);
  assert.equal(event.handled, true);
  assert.equal(sessionOf(cook), undefined);
  assert.equal(cook.inventory.getAmount(2217), 0);
  assert.equal(cook.inventory.getAmount(BOX), 0);
  assert.equal(cook.xp, 150);
  assert.equal(creditsOf(cook), 1);
  assert.ok(cook.inventory.getAmount(COINS) >= 2 && cook.inventory.getAmount(COINS) <= 500);
  assert.ok(cook.messages.some((message) => message === "You hand over your delivery of Toad crunchies to Burkor."));

  const again = deliverTo(cook, "Burkor", 2217);
  assert.equal(again.handled, false, "no order left to deliver");
  assert.equal(cook.xp, 150, "no second reward");
});

test("a wrong dish, a premade dish, a wrong recipient and a missing box all give nothing", () => {
  const cook = player({ items: { 2217: 1, 2213: 1, 2219: 1 } });
  acceptOrder(cook, orderFor("easy", "Burkor", { id: 2217, name: "Toad crunchies" }));

  const wrongDish = deliverTo(cook, "Burkor", 2213);
  assert.equal(wrongDish.handled, true);
  assert.equal(cook.inventory.getAmount(2213), 1);
  assert.ok(cook.messages.some((message) => /correct food/i.test(message)));

  const premade = deliverTo(cook, "Burkor", 2219);
  assert.equal(premade.handled, true);
  assert.equal(cook.inventory.getAmount(2219), 1);
  assert.ok(cook.messages.some((message) => /premade dishes will not do/i.test(message)));

  const wrongGnome = deliverTo(cook, "Dalila", 2217);
  assert.equal(wrongGnome.handled, false);
  assert.equal(cook.inventory.getAmount(2217), 1);
  assert.ok(sessionOf(cook), "the order survives");

  const missingBox = player({ items: { 2217: 1 } });
  sessions.set(missingBox, { ...sessionOf(cook) });
  const noBox = deliverTo(missingBox, "Burkor", 2217);
  assert.equal(noBox.handled, true);
  assert.equal(missingBox.inventory.getAmount(2217), 1);
  assert.ok(missingBox.messages.some((message) => /aluft aloft box/i.test(message)));
});

test("logout abandons the order and the box with no reward", () => {
  const cook = player();
  acceptOrder(cook, orderFor("easy", "Burkor"));
  abandon({ player: cook });
  assert.equal(sessionOf(cook), undefined);
  assert.equal(cook.inventory.getAmount(BOX), 0);
  assert.equal(creditsOf(cook), 0);
  assert.equal(cook.xp, 0);
});

test("a new order after a delivery starts with no leftover state", () => {
  const cook = player({ items: { 2217: 1 } });
  acceptOrder(cook, orderFor("easy", "Burkor", { id: 2217, name: "Toad crunchies" }));
  deliverTo(cook, "Burkor", 2217);
  acceptOrder(cook, orderFor("easy", "Dalila", { id: 2277, name: "Fruit batta" }));
  assert.equal(sessionOf(cook).npcName, "Dalila");
  assert.equal(sessionOf(cook).itemId, 2277);
  assert.equal(cook.inventory.getAmount(BOX), 1, "one fresh box");
  assert.equal(cook.inventory.getAmount(2217), 0, "the old dish is gone");
});

// --- Hard tip table

test("hard tip entries are restricted to their customers", () => {
  const ninto = eligibleRewards("Captain Ninto").map((entry) => entry.items[0].name);
  assert.ok(ninto.includes("Gnome goggles") && ninto.includes("Gnome scarf"));
  assert.ok(!ninto.includes("Goutweed") && !ninto.includes("Raw oomlie") && !ninto.includes("Law rune"));

  const imblewyn = eligibleRewards("Professor Imblewyn").map((entry) => entry.items[0].name);
  assert.ok(imblewyn.includes("Law rune") && imblewyn.includes("Pure essence"));
  assert.ok(!imblewyn.includes("Gnome goggles"));

  const brambickle = eligibleRewards("Brambickle").map((entry) => entry.items[0].name);
  assert.ok(brambickle.includes("Goutweed") && brambickle.includes("Grand seed pod") && brambickle.includes("Mint cake"));
  assert.ok(!brambickle.includes("Raw oomlie") && !brambickle.includes("Snake charm"));

  const penwie = eligibleRewards("Penwie").map((entry) => entry.items[0].name);
  assert.ok(penwie.includes("Raw oomlie") && penwie.includes("Mint cake"));
  assert.ok(!penwie.includes("Snake charm") && !penwie.includes("Goutweed"));

  const manglethorp = eligibleRewards("Professor Manglethorp").map((entry) => entry.items[0].name);
  assert.ok(manglethorp.includes("Gold ore"));
  const roll = rollHardReward("Professor Manglethorp", fixedRng("Professor Manglethorp", "Gold ore"));
  assert.deepEqual(roll.items.map((item) => [item.id, item.name]), [[444, "Gold ore"], [453, "Coal"]],
    "gold ore and coal are one tip");
  assert.ok(roll.items[0].amount >= 6 && roll.items[0].amount <= 11);
  assert.ok(roll.items[1].amount >= 12 && roll.items[1].amount <= 22);
});

test("a hard roll only ever picks entries its customer can give", () => {
  for (const entry of DATA.rewards) {
    if (!entry.only) continue;
    for (const recipient of DATA.recipients) {
      if (entry.only.includes(recipient.name)) continue;
      assert.ok(!eligibleRewards(recipient.name).includes(entry),
        `${recipient.name} must not roll ${entry.items[0].name}`);
    }
  }
  assert.equal(rollHardReward("Captain Ninto", () => 0).items[0].name, "Gnome goggles");
  assert.equal(rollHardReward("Wingstone", () => 0).items[0].name, "Gnomeball");
  assert.equal(rollEasyTip(() => 0), 2);
  assert.equal(rollEasyTip(() => 0.999999), 500);
});

// --- Credits and the reward token

test("every 12 credits earns a reward token", () => {
  const cook = player();
  for (let delivery = 0; delivery < 4; delivery++) awardCredits(cook, 3);
  assert.equal(creditsOf(cook), 12);
  assert.equal(cook.inventory.getAmount(TOKEN), 1);
  for (let delivery = 0; delivery < 4; delivery++) awardCredits(cook, 3);
  assert.equal(creditsOf(cook), 24);
  assert.equal(cook.inventory.getAmount(TOKEN), 2);
});

// --- Every recipient in the data

test("every recipient in the data accepts its ordered dish", () => {
  for (const recipient of DATA.recipients) {
    const item = DATA.items[recipient.tier][0];
    const cook = player({ items: { [item.id]: 1 } });
    acceptOrder(cook, { tier: recipient.tier, itemId: item.id, itemName: item.name, npcName: recipient.name, hint: "" });
    assert.ok(sessionOf(cook), `${recipient.name} gets an order`);
    const event = deliverTo(cook, recipient.name, item.id);
    assert.equal(event.handled, true, `${recipient.name} accepts ${item.name}`);
    assert.equal(sessionOf(cook), undefined, `${recipient.name} receives the delivery`);
    assert.ok(cook.messages.some((message) => message.includes(`to ${recipient.name}.`)), `${recipient.name} hand-over line`);
  }
});

test("rollOrder always lands on a recipient and item of the right tier", () => {
  for (const tier of ["easy", "hard"]) {
    const names = new Set(DATA.recipients.filter((entry) => entry.tier === tier).map((entry) => entry.name));
    const ids = new Set(DATA.items[tier].map((item) => item.id));
    for (let roll = 0; roll <= 1; roll += 0.05) {
      const order = rollOrder(tier, () => Math.min(roll, 0.999999));
      assert.ok(names.has(order.npcName), `${tier} recipient ${order.npcName}`);
      assert.ok(ids.has(order.itemId), `${tier} item ${order.itemId}`);
    }
  }
});
