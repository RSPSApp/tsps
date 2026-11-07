// Run after `yarn build`: node --test tests/agility-dispenser.test.cjs
//
// The Wilderness Agility Course's Agility dispenser against rsprox 233/00449-00461 (the varbits, a lap's
// end, Tag, Pay, Redeem and their lines) and the Wiki (the loot tables and the ticket XP).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');

let Dispenser, LootingBag, core;
const hooks = { events: {}, objects: {}, login: null, logout: null, prompts: [] };
const TICKET = 29460;
const OPEN_BAG = 22586;

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const api = {
    core,
    persistAttribute() {},
    onCustomEvent: (name, fn) => { hooks.events[name] = fn; },
    emitCustomEvent: (name, event) => hooks.events[name]?.(event),
    onObjectInteraction: (name, actions) => { hooks.objects[name] = actions; },
    onPlayerLogin: (fn) => { hooks.login = fn; },
    onPlayerLogout: (fn) => { hooks.logout = fn; },
    sendMultiChatboxPrompt: (player, title, ...pairs) => { player.prompt = { title, pairs }; return true; },
  };
  Dispenser = require('../plugins/skills/AgilityDispenser.plugin');
  LootingBag = require('../plugins/items/LootingBag.plugin');
  Dispenser.register(api);
  hooks.events['looting-bag:store'] = LootingBag._test.storeLoot;
});

function inventory() {
  const slots = [];
  const inv = {
    slots,
    getAmount: (id) => slots.filter((s) => s.getId() === id).reduce((n, s) => n + s.getAmount(), 0),
    add(item) {
      const same = core.ItemDefinition.forId(item.getId()).isStackable() && slots.find((s) => s.getId() === item.getId());
      if (same) same.setAmount(same.getAmount() + item.getAmount()); else slots.push(item);
    },
    deleteNumber(id, amount) {
      for (const s of slots) if (s.getId() === id && amount > 0) { const n = Math.min(amount, s.getAmount()); s.setAmount(s.getAmount() - n); amount -= n; }
      for (let i = slots.length - 1; i >= 0; i--) if (slots[i].getAmount() <= 0) slots.splice(i, 1);
    },
    getFreeSlots: () => 28 - slots.length,
    getValidItems: () => slots,
    refreshItems() {},
  };
  return inv;
}

const created = [];
function player() {
  const attributes = new Map();
  const p = {
    messages: [], boxes: [], varbits: new Map(), xp: [], sounds: [], energy: 50, inv: inventory(),
    location: new Location(3004, 3936, 0),
    getAttribute: (k) => attributes.get(k), setAttribute: (k, v) => attributes.set(k, v),
    getInventory: () => p.inv, getLocation: () => p.location, isRegistered: () => p.online !== false,
    sendMessage: (m) => p.messages.push(m), setRunEnergy(e) { p.energy = e; },
    energySent: 0, banks: [],
    getBanks: () => p.banks,
    getPacketSender: () => ({ sendVarbit: (id, v) => p.varbits.set(id, v), sendSoundEffect: (id) => p.sounds.push(id), sendRunEnergy() { p.energySent++; } }),
    getDialogueManager: () => ({ startDialogues: (b) => { for (const d of b.getDialogues().values()) p.boxes.push(d.getText()); } }),
    getSkillManager: () => ({ addExperiences: (skill, xp) => p.xp.push(xp) }),
    choose(text) { const i = p.prompt.pairs.indexOf(text); p.prompt.pairs[i + 1](); },
  };
  created.push(p);
  return p;
}

const varbit = (name) => core.CacheDefinitions.getVarbitId(name);
const op = (p, option) => hooks.objects['Agility dispenser'][option]({ player: p });
const lap = (p) => hooks.events['agility:lap']({ player: p, course: 'wilderness', laps: 1 });

test('Tag before a lap: the recorded line; an unpaid lap gives just the ticket, and Tag restores run energy', () => {
  const p = player();
  op(p, 'Tag');
  assert.deepEqual(p.messages, ['You need to complete one full lap to receive a ticket and pay 150,000 coins to receive a reward after each lap.']);
  assert.equal(p.energy, 100);
  assert.equal(p.energySent, 1, 'the client is told');
  lap(p);
  assert.equal(p.varbits.get(varbit('wildy_agility_token_available')), 1);
  assert.equal(p.messages.length, 1, 'no streak line when unpaid');
  op(p, 'Tag');
  assert.equal(p.messages.at(-1), 'You received <col=ef1020>a Wilderness agility ticket</col> from the Agility dispenser.');
  assert.equal(p.inv.getAmount(TICKET), 1);
  assert.equal(p.varbits.get(varbit('wildy_agility_token_available')), 0);
});

test("Pay: the prompt, 150,000 coins, a looting bag for a player without one; then already paid; \"don't ask again\" skips the prompt", () => {
  const p = player();
  p.inv.add(new core.Item(995, 150000));
  op(p, 'Pay');
  assert.equal(p.prompt.title, "Do you want to pay 150,000 coins to receive a reward after each lap?<br>You'll lose your payment if you leave the course.");
  assert.deepEqual(p.prompt.pairs.filter((x) => typeof x === 'string'), ['Yes.', "Yes, and don't ask again.", 'No.']);
  p.choose("Yes, and don't ask again.");
  assert.equal(p.inv.getAmount(995), 0);
  assert.equal(p.inv.getAmount(11941), 1);
  assert.deepEqual(p.messages, ['You have paid 150,000 coins to receive a reward after each lap.', 'You received <col=ef1020>a Looting bag</col> from the Agility dispenser.']);
  assert.equal(p.varbits.get(varbit('wildy_agility_deposit')), 1);
  assert.equal(p.varbits.get(varbit('wildy_agility_payment_warning')), 1);
  op(p, 'Pay');
  assert.equal(p.boxes.at(-1), 'You have already paid 150,000 coins to receive a reward after each lap.');
  const poor = player();
  poor.setAttribute(Dispenser.ATTRIBUTES.paymentWarning, 1);
  op(poor, 'Pay');
  assert.equal(poor.boxes.at(-1), 'You need 150,000 coins to pay to receive additional rewards.');
});

test('a paid lap: the streak line; Tag wants an open looting bag, then fills it, with an extra in the inventory', () => {
  const p = player();
  p.inv.add(new core.Item(995, 150000));
  p.setAttribute(Dispenser.ATTRIBUTES.paymentWarning, 1);
  op(p, 'Pay');
  lap(p);
  assert.equal(p.messages.at(-1), 'Your Wilderness Agility reward streak is: <col=ff0000>1</col>');
  assert.equal(p.varbits.get(varbit('wildy_agility_reward_available')), 1);
  op(p, 'Tag');
  assert.equal(p.boxes.at(-1), 'You must have an open looting bag in your inventory before trying to claim loot.');
  assert.equal(p.inv.getAmount(TICKET), 0, 'nothing is given until the bag is open');
  p.inv.deleteNumber(11941, 1);
  const bag = new core.Item(OPEN_BAG, 1);
  p.inv.add(bag);
  op(p, 'Tag');
  assert.equal(p.inv.getAmount(TICKET), 1);
  assert.match(p.messages.at(-1), /^You have been awarded <col=ef1020>\d+ x Blighted .+<\/col> and <col=ef1020>1 x .+<\/col>, and an extra <col=ef1020>Blighted .+<\/col> from the Agility dispenser\.$/);
  const stored = LootingBag._test.bagItems(bag);
  assert.equal(stored.length, 2);
  assert.ok(stored.every(({ id }) => core.ItemDefinition.forId(id).isNoted()), 'noted resources and armour');
});

test('a completed lap can still be tagged after starting the next lap at the pipe (#2711)', () => {
  const p = player();
  p.inv.add(new core.Item(995, 150000));
  p.setAttribute(Dispenser.ATTRIBUTES.paymentWarning, 1);
  op(p, 'Pay');
  lap(p);
  assert.equal(p.getAttribute(Dispenser.ATTRIBUTES.ticket), 1);
  assert.equal(p.getAttribute(Dispenser.ATTRIBUTES.reward), 1);
  assert.equal(p.getAttribute(Dispenser.ATTRIBUTES.streak), 1);
  hooks.events['agility:obstacle-start']({
    player: p, objectId: core.CacheDefinitions.getLocId('obstical_pipe2'), success: true,
  });
  assert.equal(p.getAttribute(Dispenser.ATTRIBUTES.ticket), 1, 'the finished lap is still claimable');
  assert.equal(p.getAttribute(Dispenser.ATTRIBUTES.reward), 1, 'and its reward too');
  assert.equal(p.getAttribute(Dispenser.ATTRIBUTES.streak), 0, 'the Wiki resets the streak');
  p.inv.deleteNumber(11941, 1);
  p.inv.add(new core.Item(OPEN_BAG, 1));
  op(p, 'Tag');
  assert.match(p.messages.at(-1), /^You have been awarded /);
  assert.equal(p.inv.getAmount(TICKET), 1);
  assert.equal(p.getAttribute(Dispenser.ATTRIBUTES.ticket), 0);
  assert.equal(p.getAttribute(Dispenser.ATTRIBUTES.reward), 0);
});

test('leaving the course loses the payment, the reward and the streak, not the ticket; logout takes 10 off the streak', () => {
  const p = player();
  p.inv.add(new core.Item(995, 150000));
  p.setAttribute(Dispenser.ATTRIBUTES.paymentWarning, 1);
  op(p, 'Pay');
  lap(p);
  for (const [x, y] of [[3005, 10357], [3000, 10345]]) {
    p.location = new Location(x, y, 0);
    core.TaskManager.process();
    assert.equal(p.getAttribute(Dispenser.ATTRIBUTES.deposit), 1, 'falling into the course dungeon keeps the payment');
    assert.equal(p.getAttribute(Dispenser.ATTRIBUTES.reward), 1);
  }
  p.location = new Location(2998, 3916, 0);
  core.TaskManager.process();
  assert.equal(p.varbits.get(varbit('wildy_agility_deposit')), 0);
  assert.equal(p.varbits.get(varbit('wildy_agility_reward_available')), 0);
  assert.equal(p.varbits.get(varbit('wildy_agility_reward_lap_new')), 0);
  assert.equal(p.getAttribute(Dispenser.ATTRIBUTES.ticket), 1);
  const q = player();
  q.setAttribute(Dispenser.ATTRIBUTES.streak, 14);
  hooks.logout({ player: q });
  assert.equal(q.getAttribute(Dispenser.ATTRIBUTES.streak), 4);
});

test('Redeem: 200 XP a ticket up to 10, then 210, 220 and 230 (Wiki); the recorded lines and sound', () => {
  assert.deepEqual([1, 10, 11, 50, 51, 100, 101].map(Dispenser.redeemXp), [200, 2000, 2310, 10500, 11220, 22000, 23230]);
  const p = player();
  op(p, 'Redeem');
  assert.equal(p.boxes.at(-1), 'You do not have any Wilderness agility tickets to redeem.');
  p.inv.add(new core.Item(TICKET, 1));
  op(p, 'Redeem');
  assert.equal(p.messages.at(-1), 'You redeem 1 Wilderness agility ticket and have been awarded 200 Agility XP!');
  p.inv.add(new core.Item(TICKET, 3));
  op(p, 'Redeem');
  assert.equal(p.messages.at(-1), 'You redeem 3 Wilderness agility tickets and have been awarded 600 Agility XP!');
  assert.deepEqual(p.xp, [200, 600]);
  assert.deepEqual(p.sounds, [2655, 2655]);
});

test('reward tiers by streak (Wiki): steel and mithril at 1-15, rune chainbodies and kiteshields only from 16', () => {
  const ids = (streak) => new Set(Array.from({ length: 400 }, () => core.ItemDefinition.forId(Dispenser.rollReward(streak)[1].id).getName()));
  assert.ok(!ids(1).has('Rune chainbody') && ids(1).has('Steel platebody'));
  assert.ok(ids(61).has('Rune kiteshield') && !ids(61).has('Steel platebody'));
});

function paidLap(p) {
  p.inv.add(new core.Item(995, 150000));
  p.setAttribute(Dispenser.ATTRIBUTES.paymentWarning, 1);
  op(p, 'Pay');
  lap(p);
}

test('Pay gives no second looting bag to a player with one in the bank', () => {
  const p = player();
  const bank = inventory();
  bank.add(new core.Item(11941, 1));
  p.banks = [bank];
  p.inv.add(new core.Item(995, 150000));
  p.setAttribute(Dispenser.ATTRIBUTES.paymentWarning, 1);
  op(p, 'Pay');
  assert.equal(p.inv.getAmount(11941), 0);
  assert.deepEqual(p.messages, ['You have paid 150,000 coins to receive a reward after each lap.']);
});

test('the extra (Wiki): 5/16 for each blighted food, 1/16 for the super restore, apart from the noted resources', () => {
  assert.deepEqual(Dispenser.DATA.extra.map(([, weight]) => weight), [5, 5, 5, 1]);
  assert.deepEqual(Dispenser.DATA.tiers[0].resources.map((row) => row[3]), [8, 8, 8, 7]);
});

test('the clue goes through the clue services: refused when one is held anywhere, a scroll box after X Marks the Spot', (t) => {
  const random = Math.random;
  t.after(() => { Math.random = random; delete hooks.events['treasure-trails:can-receive']; delete hooks.events['treasure-trails:clue-item']; });
  Math.random = () => 0;
  hooks.events['treasure-trails:can-receive'] = (event) => { event.allowed = false; };
  const refused = player();
  paidLap(refused);
  refused.inv.deleteNumber(11941, 1);
  refused.inv.add(new core.Item(OPEN_BAG, 1));
  op(refused, 'Tag');
  assert.equal(refused.inv.getAmount(2801), 0, 'a medium clue already held (here, banked) blocks another');
  hooks.events['treasure-trails:can-receive'] = (event) => { event.allowed = true; };
  hooks.events['treasure-trails:clue-item'] = (event) => { event.itemId = 24363; event.box = true; };
  const boxed = player();
  paidLap(boxed);
  boxed.inv.deleteNumber(11941, 1);
  boxed.inv.add(new core.Item(OPEN_BAG, 1));
  op(boxed, 'Tag');
  assert.equal(boxed.inv.getAmount(24363), 1, 'the scroll box the service resolves');
  assert.equal(boxed.inv.getAmount(2801), 0);
});

test('with one slot left the clue takes it, not the extra (Wiki)', (t) => {
  const random = Math.random;
  t.after(() => { Math.random = random; delete hooks.events['treasure-trails:can-receive']; });
  Math.random = () => 0;
  hooks.events['treasure-trails:can-receive'] = (event) => { event.allowed = true; };
  const p = player();
  paidLap(p);
  p.inv.deleteNumber(11941, 1);
  p.inv.add(new core.Item(OPEN_BAG, 1));
  p.inv.add(new core.Item(TICKET, 1));
  for (let i = 0; p.inv.getFreeSlots() > 1; i++) p.inv.add(new core.Item(1511, 1));
  op(p, 'Tag');
  assert.equal(p.inv.getAmount(2801), 1, 'the clue is carried, not dropped');
  assert.equal(p.inv.getFreeSlots(), 0);
  assert.match(p.messages.at(-1), /^You have been awarded .+ from the Agility dispenser\.$/);
  assert.doesNotMatch(p.messages.at(-1), /an extra/, 'no extra without a slot for it');
});

test('the paid-player watch runs only while someone has paid: one watch, gone when nobody is paid, back on the next Pay', () => {
  for (const earlier of created) earlier.online = false; // the earlier tests' paid players log off
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  assert.equal(Dispenser.isWatching(), false, 'nobody paid now');
  const first = player();
  const second = player();
  for (const p of [first, second]) {
    p.inv.add(new core.Item(995, 150000));
    p.setAttribute(Dispenser.ATTRIBUTES.paymentWarning, 1);
    op(p, 'Pay');
  }
  assert.equal(Dispenser.isWatching(), true);
  first.location = new Location(2998, 3916, 0);
  second.location = new Location(2998, 3916, 0);
  core.TaskManager.process();
  core.TaskManager.process();
  assert.equal(Dispenser.isWatching(), false, 'nobody paid: no per-tick work');
  const again = player();
  again.inv.add(new core.Item(995, 150000));
  again.setAttribute(Dispenser.ATTRIBUTES.paymentWarning, 1);
  op(again, 'Pay');
  assert.equal(Dispenser.isWatching(), true, 'watched again');
  again.location = new Location(2998, 3916, 0);
  core.TaskManager.process();
  core.TaskManager.process();
  assert.equal(again.getAttribute(Dispenser.ATTRIBUTES.deposit), 0, 'and still forfeits on leaving');
});


function packetPlayer() {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null), frames = [];
  p.setUsername('dispenser-refresh');
  p.setLocation(new Location(3004, 3936, 0));
  p.getSession = () => ({ sendClientPacket(frame) { frames.push(Buffer.from(frame)); return true; } });
  return { p, frames };
}

// Decode the actual inventory snapshot frame produced by Inventory -> PacketSender.
function inventoryPackets(frames) {
  return frames.filter((frame) => frame[0] === 50).map((frame) => {
    const result = new Map(), count = frame.readUInt16BE(3);
    let at = 5;
    for (let i = 0; i < count; i++) {
      const slot = frame.readUInt16BE(at), id = frame.readUInt16BE(at + 2) - 1;
      let amount = frame[at + 4]; at += 5;
      if (amount === 255) { amount = frame.readInt32BE(at); at += 4; }
      if (id >= 0) result.set(id, (result.get(id) ?? 0) + amount);
    }
    return result;
  });
}

test('Tag immediately emits the real inventory snapshot for a new ticket and an existing large stack', () => {
  for (const initial of [0, 300]) {
    const { p, frames } = packetPlayer();
    if (initial) p.getInventory().add(new core.Item(TICKET, initial), false);
    lap(p); frames.length = 0;
    op(p, 'Tag');
    assert.equal(p.getInventory().getAmount(TICKET), initial + 1);
    const packets = inventoryPackets(frames);
    assert.equal(packets.length, 1, 'successful ticket claim sends one inventory refresh');
    assert.equal(packets[0].get(TICKET), initial + 1, 'the wire stack is updated before another action');
  }
});

test('paid Tag sends one final inventory snapshot containing ticket and bonus food', (t) => {
  t.mock.method(Math, 'random', () => 0.5); // No clue; deterministic existing reward table.
  const { p, frames } = packetPlayer();
  p.getInventory().add(new core.Item(OPEN_BAG, 1), false);
  p.setAttribute(Dispenser.ATTRIBUTES.deposit, 1);
  lap(p); frames.length = 0;
  op(p, 'Tag');
  const packets = inventoryPackets(frames);
  assert.equal(packets.length, 1, 'publish the completed reward batch');
  assert.equal(packets[0].get(TICKET), 1);
  const food = Dispenser.DATA.extra.map(([id]) => id).find((id) => p.getInventory().getAmount(id) > 0);
  assert.ok(food, 'existing roll awarded an extra');
  assert.equal(packets[0].get(food), 1, 'bonus appears in the same immediate refresh');
  const bag = p.getInventory().getItems().find((item) => item.getId() === OPEN_BAG);
  assert.equal(LootingBag._test.bagItems(bag).length, 2, 'noted loot still goes into the bag');
});

test('failed paid claim emits no inventory reward update and leaves the pending claim untouched', () => {
  const { p, frames } = packetPlayer();
  p.setAttribute(Dispenser.ATTRIBUTES.deposit, 1);
  lap(p); frames.length = 0;
  op(p, 'Tag');
  assert.equal(inventoryPackets(frames).length, 0);
  assert.equal(p.getInventory().getAmount(TICKET), 0);
  assert.equal(p.getAttribute(Dispenser.ATTRIBUTES.ticket), 1);
  assert.equal(p.getAttribute(Dispenser.ATTRIBUTES.reward), 1);
});

test('a full inventory still updates its existing ticket stack without adding an extra', (t) => {
  t.mock.method(Math, 'random', () => 0.5);
  const { p, frames } = packetPlayer();
  p.getInventory().add(new core.Item(OPEN_BAG, 1), false);
  p.getInventory().add(new core.Item(TICKET, 300), false);
  while (p.getInventory().getFreeSlots()) p.getInventory().add(new core.Item(1511, 1), false);
  p.setAttribute(Dispenser.ATTRIBUTES.deposit, 1);
  lap(p); frames.length = 0;
  op(p, 'Tag');
  const packets = inventoryPackets(frames);
  assert.equal(p.getInventory().getAmount(TICKET), 301);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].get(TICKET), 301);
  assert.equal(p.getInventory().getFreeSlots(), 0);
  assert.ok(Dispenser.DATA.extra.every(([id]) => !packets[0].has(id)), 'no extra when full');
});
