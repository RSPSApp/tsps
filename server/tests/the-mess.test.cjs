// Run after `yarn build`: node --test tests/the-mess.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");

const TheMess = require("../plugins/minigames/TheMess.plugin");
const {
  init,
  ITEM,
  OBJECT,
  HUD,
  sessions,
  sessionOf,
  decayTick,
  cleanUp,
  COOK_BY_RAW,
  combine,
  cook,
  cookSuccess,
  assemblePineapplePizza,
  serve,
  fillBowl,
  takeMeat,
  searchFood,
  useOnObject,
  refuseEat,
  canEat,
  eweseyCondition,
  enterMess,
  leaveMess,
} = TheMess._test;

const prompts = [];
init({
  core: PluginManager.getCoreApi(),
  sendMultiChatboxPrompt: (player, title, ...pairs) => {
    prompts.push({ player, title, pairs });
    return true;
  },
});

function player({ cooking = 99, items = {} } = {}) {
  const amounts = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  const held = (id) => amounts.get(id) ?? 0;
  const inventory = { get: held, has: (id) => held(id) > 0 };
  const sender = {};
  const p = {
    messages: [], xp: 0, inventory, hud: null, hudOpen: false, hudClosed: false,
    getInventory: () => ({
      getAmount: held,
      contains: (id) => held(id) > 0,
      getFreeSlots: () => 28 - [...amounts.values()].reduce((sum, n) => sum + n, 0),
      deleteNumber: (id, n) => amounts.set(id, held(id) - n),
      addItem: (item) => amounts.set(item.getId(), held(item.getId()) + item.getAmount()),
    }),
    getSkillManager: () => ({
      getCurrentLevel: () => cooking,
      addExperiences: (_, xp) => { p.xp += xp; },
    }),
    getPacketSender: () => sender,
    setEnteredAmountAction: (action) => { p.amountAction = action; },
    sendMessage: (message) => p.messages.push(message),
    performAnimation() {},
  };
  sender.sendInventory = (id, capacity, items) => { p.hud = { id, capacity, items }; return sender; };
  sender.sendSubInterface = () => { p.hudOpen = true; return sender; };
  sender.closeSubInterface = () => { p.hudClosed = true; return sender; };
  sender.sendEnterAmountPrompt = () => sender;
  return p;
}

function use(player, itemId, objectId) {
  const event = { player, objectId, itemId, handled: false };
  useOnObject(event);
  return event;
}

function step(player, a, b) {
  const event = { player, usedItemId: a, usedWithItemId: b, handled: false };
  combine(event);
  return event;
}

beforeEach(() => {
  sessions.clear();
  prompts.length = 0;
});

test("the sink fills bowls and flour makes dough, or offers the pizza base at 65", () => {
  const p = player({ items: { [ITEM.BOWL]: 1, [ITEM.FLOUR]: 1 } });
  fillBowl({ player: p });
  assert.equal(p.inventory.get(ITEM.BOWL), 0);
  assert.equal(p.inventory.get(ITEM.BOWL_OF_WATER), 1);

  const low = player({ cooking: 30, items: { [ITEM.BOWL_OF_WATER]: 1, [ITEM.FLOUR]: 1 } });
  const event = step(low, ITEM.BOWL_OF_WATER, ITEM.FLOUR);
  assert.equal(event.handled, true);
  assert.equal(low.inventory.get(ITEM.PASTRY_DOUGH), 1);
  assert.equal(low.inventory.get(ITEM.BOWL_OF_WATER), 0);
  assert.equal(low.inventory.get(ITEM.FLOUR), 0);

  const high = player({ cooking: 65, items: { [ITEM.BOWL_OF_WATER]: 1, [ITEM.FLOUR]: 1 } });
  step(high, ITEM.FLOUR, ITEM.BOWL_OF_WATER);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].pairs[0], "Servery pastry dough.");
  assert.equal(prompts[0].pairs[2], "Servery pizza base.");
  prompts[0].pairs[3]();
  assert.equal(high.inventory.get(ITEM.PIZZA_BASE), 1);
});

test("the meat pie chain consumes and produces the right items", () => {
  const p = player({ items: { [ITEM.PASTRY_DOUGH]: 1, [ITEM.DISH]: 1, [ITEM.RAW_MEAT]: 1 } });
  step(p, ITEM.PASTRY_DOUGH, ITEM.DISH);
  assert.equal(p.inventory.get(ITEM.PIE_SHELL), 1);
  assert.equal(p.inventory.get(ITEM.PASTRY_DOUGH), 0);
  assert.equal(p.inventory.get(ITEM.DISH), 0);

  cook(p, COOK_BY_RAW.get(ITEM.RAW_MEAT), () => 0);
  assert.equal(p.inventory.get(ITEM.COOKED_MEAT), 1);
  assert.equal(p.inventory.get(ITEM.RAW_MEAT), 0);
  assert.equal(p.xp, 1);

  step(p, ITEM.COOKED_MEAT, ITEM.PIE_SHELL);
  assert.equal(p.inventory.get(ITEM.UNCOOKED_PIE), 1);
  assert.equal(p.inventory.get(ITEM.COOKED_MEAT), 0);
  assert.equal(p.inventory.get(ITEM.PIE_SHELL), 0);

  cook(p, COOK_BY_RAW.get(ITEM.UNCOOKED_PIE), () => 0);
  assert.equal(p.inventory.get(ITEM.MEAT_PIE), 1);
  assert.equal(p.xp, 1 + 3);
});

test("either stew order reaches the same uncooked stew", () => {
  const fromMeat = player({ items: { [ITEM.COOKED_MEAT]: 1, [ITEM.BOWL_OF_WATER]: 1, [ITEM.POTATO]: 1 } });
  step(fromMeat, ITEM.COOKED_MEAT, ITEM.BOWL_OF_WATER);
  assert.equal(fromMeat.inventory.get(ITEM.STEW_MEAT), 1);
  step(fromMeat, ITEM.POTATO, ITEM.STEW_MEAT);
  assert.equal(fromMeat.inventory.get(ITEM.UNCOOKED_STEW), 1);

  const fromPotato = player({ items: { [ITEM.POTATO]: 1, [ITEM.BOWL_OF_WATER]: 1, [ITEM.COOKED_MEAT]: 1 } });
  step(fromPotato, ITEM.POTATO, ITEM.BOWL_OF_WATER);
  assert.equal(fromPotato.inventory.get(ITEM.STEW_POTATO), 1);
  step(fromPotato, ITEM.COOKED_MEAT, ITEM.STEW_POTATO);
  assert.equal(fromPotato.inventory.get(ITEM.UNCOOKED_STEW), 1);
});

test("the knife slices the pineapple and the pizza assembles with its 5 XP", () => {
  const p = player({ items: { [ITEM.KNIFE]: 1, [ITEM.PINEAPPLE]: 1, [ITEM.PLAIN_PIZZA]: 1 } });
  step(p, ITEM.KNIFE, ITEM.PINEAPPLE);
  assert.equal(p.inventory.get(ITEM.PINEAPPLE_CHUNKS), 1);
  assert.equal(p.inventory.get(ITEM.KNIFE), 1, "the knife is kept");
  assemblePineapplePizza(p);
  assert.equal(p.inventory.get(ITEM.PINEAPPLE_PIZZA), 1);
  assert.equal(p.xp, 5);
});

test("below the dish's level the step is refused with a message", () => {
  const p = player({ cooking: 19, items: { [ITEM.PASTRY_DOUGH]: 1, [ITEM.DISH]: 1 } });
  const event = step(p, ITEM.PASTRY_DOUGH, ITEM.DISH);
  assert.equal(event.handled, true);
  assert.equal(p.inventory.get(ITEM.PASTRY_DOUGH), 1);
  assert.equal(p.inventory.get(ITEM.PIE_SHELL), 0);
  assert.match(p.messages.at(-1), /level of at least 20/);

  const p2 = player({ cooking: 64, items: { [ITEM.PIZZA_BASE]: 1, [ITEM.TOMATO]: 1 } });
  step(p2, ITEM.PIZZA_BASE, ITEM.TOMATO);
  assert.equal(p2.inventory.get(ITEM.INCOMPLETE_PIZZA), 0);
  assert.match(p2.messages.at(-1), /level of at least 65/);
});

test("the oven's chart roll burns until the dish's stop-burn level", () => {
  const pie = COOK_BY_RAW.get(ITEM.UNCOOKED_PIE);
  // Wiki charts: ~79/256 at level 1, ~142/256 at level 20, guaranteed at 53.
  assert.equal(cookSuccess(pie, 20, () => 0.55), true);
  assert.equal(cookSuccess(pie, 20, () => 0.99), false);
  assert.equal(cookSuccess(pie, 53, () => 0.999), true);
  assert.equal(cookSuccess(COOK_BY_RAW.get(ITEM.RAW_MEAT), 1, () => 0.5), true);
  assert.equal(cookSuccess(COOK_BY_RAW.get(ITEM.RAW_MEAT), 1, () => 0.99), false);

  const p = player({ cooking: 20, items: { [ITEM.UNCOOKED_PIE]: 2 } });
  cook(p, pie, () => 0.99);
  assert.equal(p.inventory.get(ITEM.UNCOOKED_PIE), 1);
  assert.equal(p.inventory.get(ITEM.BURNT_PIE), 1);
  assert.equal(p.xp, 0);
});

test("serving drains the dish's bar, lifts the others and scales XP", () => {
  const p = player({ items: { [ITEM.MEAT_PIE]: 2, [ITEM.PINEAPPLE_PIZZA]: 1 } });
  assert.equal(serve(p, ITEM.MEAT_PIE), true);
  assert.equal(p.xp, 160);
  assert.deepEqual(sessionOf(p).appreciation, { pie: 850, pizza: 1000, stew: 1000 });
  assert.equal(p.hud.id, HUD.INVENTORY);
  assert.deepEqual(p.hud.items.map((item) => item.amount), [850, 1000, 1000]);

  assert.equal(serve(p, ITEM.MEAT_PIE), true);
  assert.equal(p.xp, 160 + 136);
  assert.equal(serve(p, ITEM.PINEAPPLE_PIZZA), true);
  assert.equal(p.xp, 160 + 136 + 369);
  assert.deepEqual(sessionOf(p).appreciation, { pie: 750, pizza: 850, stew: 1000 });
});

test("a second serve click without a dish pays nothing", () => {
  const p = player({ items: { [ITEM.STEW]: 1 } });
  assert.equal(serve(p, ITEM.STEW), true);
  assert.equal(serve(p, ITEM.STEW), false);
  assert.equal(p.xp, 168);
  assert.equal(p.inventory.get(ITEM.STEW), 0);
});

test("the buffet only accepts the three dishes", () => {
  const p = player({ items: { [ITEM.RAW_MEAT]: 1, [385]: 1 } });
  assert.equal(use(p, ITEM.RAW_MEAT, OBJECT.BUFFET_TABLE).handled, true);
  assert.match(p.messages.at(-1), /not going to eat anything you've got there/);
  use(p, 385, OBJECT.BUFFET_TABLE);
  assert.match(p.messages.at(-1), /not going to eat that/);
  assert.equal(p.xp, 0);
});

test("the oven only cooks servery food", () => {
  const p = player({ items: { [383]: 1 } });
  assert.equal(use(p, 383, OBJECT.CLAY_OVEN).handled, false);
  assert.equal(p.xp, 0);
});

test("cupboards take their items back", () => {
  const p = player({ items: { [ITEM.BOWL]: 3, [ITEM.BOWL_OF_WATER]: 2, [ITEM.DISH]: 1, [ITEM.FLOUR]: 4 } });
  use(p, ITEM.BOWL, OBJECT.UTENSIL_CUPBOARD);
  assert.equal(p.inventory.get(ITEM.BOWL), 0);
  assert.equal(p.inventory.get(ITEM.BOWL_OF_WATER), 2, "only the used kind is returned");
  use(p, ITEM.FLOUR, OBJECT.FOOD_CUPBOARD);
  assert.equal(p.inventory.get(ITEM.FLOUR), 0);
});

test("the food cupboard offers its five ingredients and hands one over", () => {
  const p = player();
  searchFood({ player: p });
  assert.equal(prompts.length, 1);
  assert.deepEqual(prompts[0].pairs.filter((_, index) => index % 2 === 0), [
    "Servery flour.", "Servery pineapple.", "Servery potato.", "Servery cheese.", "Servery tomato.",
  ]);
  prompts[0].pairs[1]();
  assert.equal(p.inventory.get(ITEM.FLOUR), 1);
});

test("the meat table hands out raw meat", () => {
  const p = player();
  takeMeat({ player: p });
  assert.equal(p.inventory.get(ITEM.RAW_MEAT), 1);
});

test("entering opens the HUD at 100% and leaving closes it and clears the session", () => {
  const p = player();
  enterMess({ player: p });
  assert.equal(p.hudOpen, true);
  assert.deepEqual(p.hud.items.map((item) => item.amount), [1000, 1000, 1000]);
  leaveMess({ player: p });
  assert.equal(p.hudClosed, true);
  assert.equal(sessions.has(p), false);
});

test("leaving clears servery items but leaves ordinary ones", () => {
  const p = player({ items: { [ITEM.RAW_MEAT]: 2, [ITEM.MEAT_PIE]: 1, [ITEM.BOWL]: 1 } });
  sessionOf(p);
  cleanUp(p);
  assert.equal(p.inventory.get(ITEM.RAW_MEAT), 0);
  assert.equal(p.inventory.get(ITEM.MEAT_PIE), 0);
  assert.equal(p.inventory.get(ITEM.BOWL), 1);
  assert.equal(sessions.has(p), false);
});

test("unused bars recover 1% every 30 ticks", () => {
  const p = player({ items: { [ITEM.STEW]: 1 } });
  serve(p, ITEM.STEW);
  assert.equal(sessionOf(p).appreciation.stew, 850);
  decayTick();
  assert.equal(sessionOf(p).appreciation.stew, 860);
  assert.equal(sessionOf(p).appreciation.pie, 1000, "capped");
});

test("servery food cannot be eaten", () => {
  const p = player({ items: { [ITEM.MEAT_PIE]: 1 } });
  const event = { player: p, itemId: ITEM.MEAT_PIE, option: "Eat", handled: false };
  refuseEat(event);
  assert.equal(event.handled, true);
  assert.deepEqual(p.messages, ["Hey, that's not for you!"]);

  const canEvent = { player: p, itemId: ITEM.MEAT_PIE, allow: null };
  canEat(canEvent);
  assert.equal(canEvent.allow, false);
  const bowl = { player: p, itemId: ITEM.BOWL, allow: null };
  canEat(bowl);
  assert.equal(bowl.allow, null);
});

test("Ewesey's Cooking conditions answer from the real level", () => {
  const low = player({ cooking: 19 });
  assert.equal(eweseyCondition({ npcId: 6926, player: low, text: "With less than 20 Cooking:" }), true);
  assert.equal(eweseyCondition({ npcId: 6926, player: low, text: "With at least 20 Cooking:" }), false);
  assert.equal(eweseyCondition({ npcId: 6926, player: low, text: "If the player does not have enough Hosidius Favour:" }), false);
  assert.equal(eweseyCondition({ npcId: 6926, player: player(), text: "With at least 20 Cooking:" }), true);
  assert.equal(eweseyCondition({ npcId: 1, player: low, text: "With at least 20 Cooking:" }), null);
});
