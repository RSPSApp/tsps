// Run after `yarn build`: node --test tests/desert-quarry.test.cjs
//
// The Desert Quarry's grinder and Drew against rsprox 232/03162 and 232/03165 (the grinds, the deposits,
// the claims and their lines) and the Wiki (25,000 buckets, 50 coins a bucket of sand).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

let Quarry, hooks, core;
const obj = (name) => core.CacheDefinitions.getObjId(name);

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  hooks = { npcs: {}, objects: {}, itemOnObject: null, prompts: [] };
  const api = {
    core,
    persistAttribute() {},
    onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
    onObjectInteraction: (name, actions) => { hooks.objects[name] = actions; },
    onItemOnObject: (fn) => { hooks.itemOnObject = fn; },
    emitCustomEvent: (name, payload) => { if (name === 'desert-quarry:ground') ground.push([payload.player, payload.amount]); },
    sendMultiChatboxPrompt: (player, title, ...pairs) => { player.menus.push(pairs.filter((x) => typeof x === 'string')); player.menu = pairs; return true; },
  };
  Quarry = require('../plugins/areas/DesertQuarry.plugin');
  Quarry.register(api);
});

function container() {
  const stacks = new Map();
  return {
    stacks,
    getAmount: (id) => stacks.get(id) ?? 0,
    add(item) { stacks.set(item.getId(), (stacks.get(item.getId()) ?? 0) + item.getAmount()); },
    deleteNumber(id, amount) { stacks.set(id, (stacks.get(id) ?? 0) - amount); },
    getFreeSlots: () => 28 - [...stacks.values()].filter((n) => n > 0).length,
    getAddableAmount: (item) => ((stacks.get(item.getId()) ?? 0) > 0 || 28 - [...stacks.values()].filter((n) => n > 0).length > 0 ? item.getAmount() : 0),
    refreshItems() {},
  };
}

function player() {
  const attributes = new Map();
  const p = {
    messages: [], pages: [], menus: [], prompts: [], amountAction: null, inventory: container(),
    getAttribute: (k) => attributes.get(k), setAttribute: (k, v) => attributes.set(k, v),
    getInventory: () => p.inventory, sendMessage: (m) => p.messages.push(m),
    setEnteredAmountAction(action) { p.amountAction = action; },
    getPacketSender: () => ({ sendEnterAmountPrompt: (text) => p.prompts.push(text) }),
    getDialogueManager: () => ({
      startDialogues(builder) {
        for (const page of builder.getDialogues().values()) {
          if (page.getText) p.pages.push(page.getText());
          else if (page.action?.execute) page.action.execute();
        }
      },
    }),
    choose(text) { const i = p.menu.indexOf(text); p.menu[i + 1](); },
    enter(count) { const action = p.amountAction; p.amountAction = null; action.execute(count); },
  };
  return p;
}

const drew = () => ({ getId: () => core.CacheDefinitions.getNpcId('grinder_drew') });
const grinder = () => ({ getId: () => core.CacheDefinitions.getLocId('grinder_machine') });
const op = (p, option) => hooks.npcs.Drew[option]({ player: p, npc: drew() });

const ground = [];

test('the grinder takes every piece at once: 1kg 1, 2kg 2, 5kg 4, 10kg 8 buckets (232/03162: 2 medium, 2 large, 1 small -> 26)', () => {
  const p = player();
  hooks.objects.Grinder.Deposit({ player: p, object: grinder() });
  assert.deepEqual(p.messages, ['You do not have any sandstone to grind.']);
  p.inventory.add(new core.Item(obj('enakh_sandstone_medium'), 2));
  p.inventory.add(new core.Item(obj('enakh_sandstone_large'), 2));
  p.inventory.add(new core.Item(obj('enakh_sandstone_small'), 1));
  hooks.objects.Grinder.Deposit({ player: p, object: grinder() });
  assert.equal(p.messages.at(-1), 'The grinder is holding enough sandstone for 26 buckets of sand.');
  assert.equal(p.inventory.getAmount(obj('enakh_sandstone_large')), 0);
  // 6 tiny + 5 small + 2 medium -> 50, as recorded; used on the grinder it does the same.
  p.inventory.add(new core.Item(obj('enakh_sandstone_tiny'), 6));
  p.inventory.add(new core.Item(obj('enakh_sandstone_small'), 5));
  p.inventory.add(new core.Item(obj('enakh_sandstone_medium'), 2));
  hooks.itemOnObject({ player: p, object: grinder(), item: {}, itemId: obj('enakh_sandstone_tiny'), handled: false });
  assert.equal(p.messages.at(-1), 'The grinder is holding enough sandstone for 50 buckets of sand.');
  // desert-quarry:ground per grind with the buckets it added, none for the empty one (a league's Drew task).
  assert.deepEqual(ground.filter(([who]) => who === p).map(([, amount]) => amount), [26, 24]);
});

test("noted sandstone on the grinder gets Drew's refusal and stays", () => {
  const p = player();
  const noted = core.ItemDefinition.forId(obj('enakh_sandstone_large')).getNoteId();
  p.inventory.add(new core.Item(noted, 3));
  const event = { player: p, object: grinder(), item: {}, itemId: noted, handled: false };
  hooks.itemOnObject(event);
  assert.equal(event.handled, true);
  assert.deepEqual(p.pages, ["Sorry mate, ya can't turn noted sandstone into sand. Come back with some real sandstone."]);
  assert.equal(p.inventory.getAmount(noted), 3);
});

test('Deposit buckets: none, zero, one, then up to the 25,000 Drew holds (232/03162, 232/03165)', () => {
  const p = player();
  op(p, 'Deposit buckets');
  assert.equal(p.pages.at(-1), "You haven't got any buckets for me to hold.");
  p.inventory.add(new core.Item(obj('cert_bucket_empty'), 500));
  op(p, 'Deposit buckets');
  assert.equal(p.prompts.at(-1), 'How many buckets do you wish to deposit?');
  p.enter(0);
  assert.equal(p.pages.at(-1), "You can't deposit zero buckets.");
  op(p, 'Deposit buckets');
  p.enter(1);
  assert.equal(p.pages.at(-1), 'I am only holding onto one bucket for ya.');
  op(p, 'Deposit buckets');
  p.enter(800);
  assert.equal(p.pages.at(-1), 'I am holding onto 500 buckets for ya.');
  assert.equal(p.inventory.getAmount(obj('cert_bucket_empty')), 0);
  p.inventory.add(new core.Item(obj('cert_bucket_empty'), 26700));
  op(p, 'Deposit buckets');
  p.enter(50000);
  assert.equal(p.pages.at(-1), 'I am holding onto 25,000 buckets for ya. Why would ya want so many buckets?');
  assert.equal(p.inventory.getAmount(obj('cert_bucket_empty')), 2200, 'only up to 25,000 is taken');
  op(p, 'Deposit buckets');
  assert.equal(p.pages.at(-1), "I can't hold any more buckets for you.");
});

test('Claim Sand: noted buckets of sand at 50 coins each, as many as the sand, buckets and coins allow', () => {
  const p = player();
  op(p, 'Claim Sand');
  assert.match(p.pages.at(-1), /^Ya don't have any buckets of sand to withdraw\./);
  p.setAttribute(Quarry.BUCKETS_ATTRIBUTE, 1000);
  p.setAttribute(Quarry.SAND_ATTRIBUTE, 642);
  op(p, 'Claim Sand');
  assert.match(p.pages.at(-1), /^Ya do not have enough money to withdraw even one bucket of sand;/);
  p.inventory.add(new core.Item(995, 796138));
  op(p, 'Claim Sand');
  assert.equal(p.prompts.at(-1), 'How many buckets of sand do ya want? (50 coins each)');
  p.enter(0);
  assert.equal(p.pages.at(-1), 'Come back when ya actually want some buckets of sand.');
  op(p, 'Claim Sand');
  p.enter(1);
  assert.equal(p.inventory.getAmount(995), 796088);
  assert.equal(p.inventory.getAmount(obj('cert_bucket_sand')), 1);
  assert.equal(p.pages.at(-1), 'If ya need any more sand, please come back and use Sandstorm again.');
  op(p, 'Claim Sand');
  p.enter(50000);
  assert.equal(p.inventory.getAmount(obj('cert_bucket_sand')), 642, 'capped at the ground sand');
  assert.equal(p.inventory.getAmount(995), 796138 - 642 * 50);
  assert.equal(p.getAttribute(Quarry.BUCKETS_ATTRIBUTE), 1000 - 642);
  assert.equal(p.getAttribute(Quarry.SAND_ATTRIBUTE), 0);
});

test('Check, and Talk-to: the recorded lines, the menu, and Yes leading to the claim', () => {
  const p = player();
  op(p, 'Check');
  assert.deepEqual(p.pages, ["I have 0 of your buckets and you've ground enough sandstone for 0 buckets of sand."]);
  p.setAttribute(Quarry.BUCKETS_ATTRIBUTE, 10);
  p.setAttribute(Quarry.SAND_ATTRIBUTE, 4);
  p.inventory.add(new core.Item(995, 1000));
  op(p, 'Check');
  assert.equal(p.pages.at(-1), 'Would ya like to purchase some buckets of sand?');
  p.choose('Yes.');
  assert.equal(p.prompts.at(-1), 'How many buckets of sand do ya want? (50 coins each)');
  op(p, 'Talk-to');
  assert.equal(p.pages.at(-1), 'Hey there, what can I do for ya?');
  assert.deepEqual(p.menus.at(-1), ['Tell me about yourself.', 'Deposit buckets.', 'Withdraw buckets of sand.', 'Check my buckets and sand.', 'Nothing.']);
  p.choose('Tell me about yourself.');
  assert.equal(p.pages.at(-1), "Anyway, that's all in the past. Can I help ya with anything else?");
  p.choose('Nothing.');
  assert.deepEqual(p.pages.slice(-2), ['Nothing sorry. I have to be going now.', 'Oh, bye then.']);
});

// ---------------------------------------------------------------- with a real Player and Inventory

function realPlayer(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.pages = [];
  t.mock.method(p, 'getDialogueManager', () => ({
    startDialogues(builder) {
      for (const page of builder.getDialogues().values()) {
        if (page.getText) p.pages.push(page.getText());
        else if (page.action?.execute) page.action.execute();
      }
    },
  }));
  t.mock.method(p.getPacketSender(), 'sendEnterAmountPrompt', () => {});
  t.mock.method(p.getInventory(), 'refreshItems', () => p.getInventory());
  return p;
}

/** As the client's amount packet does it (NetworkBuilder "dialogue_amount"): 0 only reaches a prompt that takes it. */
function dispatchAmount(p, amount) {
  const action = p.getEnteredAmountAction();
  if (action && (amount > 0 || (amount === 0 && action.acceptsZero === true))) action.execute(amount);
}

test("entering 0 reaches Drew's own zero lines through the client's amount dispatch", (t) => {
  const p = realPlayer(t);
  p.getInventory().add(new core.Item(obj('cert_bucket_empty'), 5));
  op(p, 'Deposit buckets');
  dispatchAmount(p, 0);
  assert.equal(p.pages.at(-1), "You can't deposit zero buckets.");
  p.setAttribute(Quarry.BUCKETS_ATTRIBUTE, 10);
  p.setAttribute(Quarry.SAND_ATTRIBUTE, 10);
  p.getInventory().add(new core.Item(995, 1000));
  op(p, 'Claim Sand');
  dispatchAmount(p, 0);
  assert.equal(p.pages.at(-1), 'Come back when ya actually want some buckets of sand.');
});

test('Claim Sand pays only for the sand that fits: a stack near its cap, and a full pack whose last coins free a slot', (t) => {
  const note = obj('cert_bucket_sand');
  const p = realPlayer(t);
  p.getInventory().add(new core.Item(note, 2147483645));
  p.getInventory().add(new core.Item(995, 1000));
  p.setAttribute(Quarry.BUCKETS_ATTRIBUTE, 10);
  p.setAttribute(Quarry.SAND_ATTRIBUTE, 10);
  op(p, 'Claim Sand');
  dispatchAmount(p, 10);
  assert.equal(p.getInventory().getAmount(note), 2147483647);
  assert.equal(p.getInventory().getAmount(995), 900, 'two buckets of sand, 100 coins');
  assert.equal(p.getAttribute(Quarry.BUCKETS_ATTRIBUTE), 8);
  assert.equal(p.getAttribute(Quarry.SAND_ATTRIBUTE), 8);
  // A full pack: 27 logs and exactly 50 coins. Paying them frees the slot the sand goes into.
  const full = realPlayer(t);
  for (let i = 0; i < 27; i++) full.getInventory().add(new core.Item(1511, 1));
  full.getInventory().add(new core.Item(995, 50));
  full.setAttribute(Quarry.BUCKETS_ATTRIBUTE, 5);
  full.setAttribute(Quarry.SAND_ATTRIBUTE, 5);
  op(full, 'Claim Sand');
  dispatchAmount(full, 1);
  assert.equal(full.getInventory().getAmount(note), 1);
  assert.equal(full.getInventory().getAmount(995), 0);
  // The same full pack with 100 coins: nothing fits, so nothing is spent.
  const stuck = realPlayer(t);
  for (let i = 0; i < 27; i++) stuck.getInventory().add(new core.Item(1511, 1));
  stuck.getInventory().add(new core.Item(995, 100));
  stuck.setAttribute(Quarry.BUCKETS_ATTRIBUTE, 5);
  stuck.setAttribute(Quarry.SAND_ATTRIBUTE, 5);
  op(stuck, 'Claim Sand');
  dispatchAmount(stuck, 1);
  assert.equal(stuck.pages.at(-1), "Ya don't have room in your pack for the sand.");
  assert.equal(stuck.getInventory().getAmount(995), 100);
  assert.equal(stuck.getAttribute(Quarry.BUCKETS_ATTRIBUTE), 5);
});

test('the grinder holds 25,000 buckets of sand (Wiki): a piece that would go over stays in the pack', (t) => {
  const p = realPlayer(t);
  p.setAttribute(Quarry.SAND_ATTRIBUTE, 24995);
  p.getInventory().add(new core.Item(obj('enakh_sandstone_large'), 1));
  p.getInventory().add(new core.Item(obj('enakh_sandstone_medium'), 2));
  p.getInventory().add(new core.Item(obj('enakh_sandstone_tiny'), 1));
  t.mock.method(p, 'sendMessage', (m) => p.pages.push(m));
  hooks.objects.Grinder.Deposit({ player: p, object: grinder() });
  assert.equal(p.getAttribute(Quarry.SAND_ATTRIBUTE), 25000, '1 tiny + 1 medium fit; the 10kg and one 5kg do not');
  assert.equal(p.pages.at(-1), 'The grinder is holding enough sandstone for 25,000 buckets of sand.');
  assert.equal(p.getInventory().getAmount(obj('enakh_sandstone_large')), 1);
  assert.equal(p.getInventory().getAmount(obj('enakh_sandstone_medium')), 1);
  assert.equal(p.getInventory().getAmount(obj('enakh_sandstone_tiny')), 0);
});
