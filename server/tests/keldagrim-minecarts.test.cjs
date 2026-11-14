// From server/: node --test tests/keldagrim-minecarts.test.cjs (after yarn build).
//
// The Keldagrim minecarts against the OSRS Wiki (Keldagrim_minecart_system, the cart conductors'
// transcripts) and the rsprox recordings in plugins/world/data/keldagrim-minecarts.json: the ids,
// the conductors' conditions and sales, the station's tracks and refusals, the rides' recorded
// steps and timing, the Grand Exchange trapdoor, and logging out or dying mid-ride.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, beforeEach, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

let Common, Tickets, Ride, tasks, events, registered, quests;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Common = require('../plugins/world/keldagrimminecarts/Common.KeldagrimMinecarts');
  Tickets = require('../plugins/world/keldagrimminecarts/Tickets.KeldagrimMinecarts');
  Ride = require('../plugins/world/keldagrimminecarts/Ride.KeldagrimMinecarts');
  const api = new Proxy({
    core: {
      ...core,
      TaskManager: { submit: (task) => { task.setRunning(true); tasks.push(task); } },
      ObjectManager: { register: (object) => registered.push(object), deregister() {} },
    },
    emitCustomEvent(name, event) {
      events.push([name, event]);
      if (name === 'npc-dialogue:start') event.handled = true;
      if (name === 'quest:is-started') event.started = quests.has(`started:${event.key}`) || quests.has(`complete:${event.key}`);
      if (name === 'quest:is-complete') event.complete = quests.has(`complete:${event.key}`);
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Common.init(api);
});

beforeEach(() => {
  tasks = [];
  events = [];
  registered = [];
  quests = new Set(['started:giant_dwarf']);
});

const COINS = 995;
const loc = (x, y) => new core.Location(x, y, 0);
const xy = (location) => [location.getX(), location.getY()];

function fakePlayer({ coins = 1000, free = 27, ring = false } = {}) {
  const items = new Map([[COINS, coins]]);
  let freeSlots = free;
  let tile = loc(2909, 10174);
  const equipment = Array.from({ length: 14 }, (_, slot) => new core.Item(slot === 3 ? core.ItemIdentifiers.ABYSSAL_WHIP : -1, slot === 3 ? 1 : 0));
  if (ring) equipment[core.Equipment.RING_SLOT] = new core.Item(Common.ids.objs.ringOfCharosA, 1);
  const player = {
    messages: [], statements: [], fades: [], objects: [], moves: [], glides: [], displayed: [], worn: [], stances: [], kits: [],
    registered: true, dying: false, blocked: false, talking: null,
    getLocation: () => tile,
    moveTo: (to) => { tile = to; player.moves.push(xy(to)); },
    isRegistered: () => player.registered,
    isDyingReturn: () => player.dying,
    getHitpoints: () => 99,
    sendMessage: (m) => player.messages.push(m),
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0,
      contains: (id) => (items.get(id) ?? 0) > 0,
      getFreeSlots: () => freeSlots,
      delete: (id, n) => { items.set(id, (items.get(id) ?? 0) - n); if (id !== COINS && items.get(id) === 0) freeSlots++; },
      adds: (id, n) => { if (!items.get(id)) freeSlots--; items.set(id, (items.get(id) ?? 0) + n); },
      refreshItems() {},
    }),
    items,
    getEquipment: () => ({ getItems: () => equipment, capacity: () => 14, sendWornInventory: () => player.worn.push('restored') }),
    setDisplayedEquipment: (value) => player.displayed.push(value),
    setRenderAnimations: (value) => player.stances.push(value),
    setDisplayedKits: (value) => player.kits.push(value),
    getAppearance: () => ({ isMale: () => true }),
    setForceMovement: (movement) => { if (movement) player.glides.push(movement); },
    getMovementQueue: () => ({ setBlockMovement(value) { player.blocked = value; return this; }, reset() { return this; } }),
    getDialogueManager: () => ({
      startDialogues: (chain) => player.statements.push(chain),
      getCurrent: () => player.talking,
    }),
    getPacketSender: () => ({
      sendSubInterface: (uid, id, type, { postScripts } = {}) => player.fades.push(postScripts?.[0]?.args?.[1] === 255 ? 'out' : 'in'),
      closeSubInterface: () => player.fades.push('closed'),
      sendObject: (object) => player.objects.push(['add', object.getId(), xy(object.getLocation())]),
      sendObjectRemoval: (object) => player.objects.push(['del', object.getId(), xy(object.getLocation())]),
      sendInventory: (id, size, list) => player.worn.push(list.map((entry) => entry?.id ?? -1)),
    }),
  };
  return player;
}

/** One game tick: every running task ticks; tasks submitted meanwhile start on the next. */
function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    const due = tasks;
    tasks = [];
    for (const task of due) if (task.tick()) tasks.push(task);
  }
}

const ticket = (name) => Common.ids.objs[name];
/** A glide as [from, to] tiles: the engine's start, and start + end. */
const path2 = (g) => [xy(g.getStart()), [g.getStart().getX() + g.getEnd().getX(), g.getStart().getY() + g.getEnd().getY()]];
const held = (player, name) => player.items.get(ticket(name)) ?? 0;
const hubDefinition = { getName: () => 'Cart conductor' };
const hubConductor = { npcId: 2388, definition: hubDefinition };
const mine = () => ({ npcId: Common.ids.npcs.mine, definition: hubDefinition });
const wolf = () => ({ npcId: Common.ids.npcs.wolf, definition: hubDefinition });

test('every id resolves from the cache', () => {
  const { npcs, locs, objs } = Common.ids;
  assert.deepEqual([npcs.wolf, npcs.mine, npcs.trapdoor], [2390, 2391, 2388]);
  assert.deepEqual([locs.hubCart, locs.unridable, locs.iceCart, locs.wolfCart, locs.trapdoor], [7028, 7027, 7029, 7030, 16168]);
  assert.deepEqual([objs.keldaIce, objs.iceKelda, objs.keldaWolf, objs.wolfKelda, objs.coins], [5020, 5021, 5022, 5023, 995]);
  assert.equal(objs.ringOfCharosA, 6465);
});

test("the conductors' conditions: coins for what is being bought, space, Fishing Contest, the ring, The Giant Dwarf", () => {
  const player = fakePlayer({ coins: 120 });
  const ask = (who, text) => Tickets.answerCondition({ player, ...who, text });
  Tickets.onChoice({ player, ...hubConductor, option: 'To Ice Mountain.' });
  Tickets.onChoice({ player, ...hubConductor, option: 'Buy.' });
  assert.equal(ask(hubConductor, 'If the player does not have enough coins:'), true, '150 for Ice Mountain');
  Tickets.onChoice({ player, ...hubConductor, option: '[Charm] Only pay half.' });
  assert.equal(ask(hubConductor, 'If the player does not have enough coins:'), false, '75 with the charm');
  assert.equal(ask(mine(), 'If the player does not have enough money:'), true, 'the Dwarven Mine conductor: 150, whatever was half price with another');
  assert.equal(ask(wolf(), 'If the player does not have enough money:'), false, 'the White Wolf conductor: 100');
  assert.equal(ask(hubConductor, 'If the player does not have any inventory space:'), false);
  assert.equal(ask(mine(), 'If the player has no inventory space:'), false);
  assert.equal(ask(hubConductor, 'If the player has finished Fishing Contest:'), false);
  quests.add('complete:fishing_contest');
  assert.equal(ask(hubConductor, 'If the player has finished Fishing Contest:'), true);
  assert.equal(ask(hubConductor, 'If the player is wearing the Ring of Charos(a):'), false);
  assert.equal(Tickets.answerCondition({ player: fakePlayer({ ring: true }), ...wolf(), text: 'If the player is wearing a Ring of Charos(a):' }), true);
  assert.equal(ask(mine(), 'After starting The Giant Dwarf:'), true);
  assert.equal(ask(mine(), 'Before starting The Giant Dwarf:'), false);
  assert.equal(ask({ npcId: 1, definition: { getName: () => 'Hans' } }, 'If the player does not have enough coins:'), null, 'not a conductor');
  assert.equal(Tickets.chooseVariant(mine()), 'members-dialogue', 'the Dwarven Mine talk has no default');
});

test("a sale on the conductor's line: the fare taken, the ticket given; none without the coins or space", () => {
  const sale = (who, text, player) => Tickets.onLine({ player, ...who, step: { npc: text }, text });
  const player = fakePlayer({ coins: 1000 });
  sale(hubConductor, 'Thanks, carts to Ice Mountain depart from track 1.', player);
  assert.equal(held(player, 'keldaIce'), 1);
  assert.equal(player.items.get(COINS), 850);
  sale(hubConductor, "You're a decent human, I suppose... I can let you go for 50 coins. Go to track 4 for the carts heading to White Wolf Mountain.", player);
  assert.equal(held(player, 'keldaWolf'), 1);
  assert.equal(player.items.get(COINS), 800);
  sale(mine(), 'Well... I suppose so.', player);
  assert.equal(held(player, 'iceKelda'), 1, 'the Dwarven Mine haggle: 75');
  assert.equal(player.items.get(COINS), 725);
  sale(wolf(), "Thanksh a lot human! Remember to come back for more shtout whenever you want! *hic*", player);
  assert.equal(held(player, 'wolfKelda'), 1);
  assert.equal(player.items.get(COINS), 625);
  sale(mine(), 'Thanks, carts to Ice Mountain depart from track 1.', player);
  assert.equal(player.items.get(COINS), 625, "another conductor's line is not this one's sale");

  const poor = fakePlayer({ coins: 149 });
  sale(hubConductor, 'Thanks, carts to Ice Mountain depart from track 1.', poor);
  assert.equal(held(poor, 'keldaIce'), 0);
  const full = fakePlayer({ free: 0 });
  sale(hubConductor, 'Thanks, carts to Ice Mountain depart from track 1.', full);
  assert.equal(held(full, 'keldaIce'), 0);
  assert.equal(full.items.get(COINS), 1000);
});

test('the Tickets option: its menu (halved with the ring), the pick is the sale a tick later', () => {
  const player = fakePlayer();
  const npc = { getId: () => 2388, getDefinition: () => hubDefinition };
  assert.equal(Tickets.ticketsOption({ player, npc }), true);
  assert.equal(events.at(-1)[1].variant, 'tickets');
  Tickets.ticketsOption({ player: fakePlayer({ ring: true }), npc: { getId: () => Common.ids.npcs.mine, getDefinition: () => hubDefinition } });
  assert.equal(events.at(-1)[1].variant, 'members-dialogue-tickets-option-ring-of-charos-a-equipped');

  Tickets.onChoice({ player, ...hubConductor, option: 'Ice Mountain (150 coins)' });
  assert.equal(held(player, 'keldaIce'), 0, "the transcript's refusals are read first");
  tick();
  assert.equal(held(player, 'keldaIce'), 1);
  assert.equal(player.items.get(COINS), 850);
  Tickets.onChoice({ player, ...wolf(), option: 'Keldagrim (50 coins)' });
  tick();
  assert.equal(held(player, 'wolfKelda'), 1);
  assert.equal(player.items.get(COINS), 800);
  tick();
  Tickets.onChoice({ player, ...hubConductor, option: 'White Wolf Mountain (100 coins)' });
  const action = { player, ...hubConductor, text: '(Same as dialogue for Ice Mountain (150 coins).)', handled: false };
  Tickets.onAction(action);
  assert.deepEqual([action.handled, action.end, action.steps], [true, true, undefined], 'the pick is the sale');
  const broke = fakePlayer({ coins: 20 });
  Tickets.onChoice({ player: broke, ...hubConductor, option: 'White Wolf Mountain (100 coins)' });
  const refused = { player: broke, ...hubConductor, text: '(Same as dialogue for Ice Mountain (150 coins).)', handled: false };
  Tickets.onAction(refused);
  assert.deepEqual(refused.steps, [{ player: "I'm sorry, I've run out of money." }], "the Ice Mountain pick's refusal");
  const full = fakePlayer({ free: 0 });
  Tickets.onChoice({ player: full, ...wolf(), option: 'Keldagrim (50 coins)' });
  const noRoom = { player: full, ...wolf(), text: '(Same as Keldagrim (100 coins).)', handled: false };
  Tickets.onAction(noRoom);
  assert.deepEqual(noRoom.steps, [{ npc: "I'm sorry, [sir/madam], but I don't believe you can hold the ticket." }]);
  tick();

  const poor = fakePlayer({ coins: 10 });
  Tickets.onChoice({ player: poor, ...hubConductor, option: 'Ice Mountain (150 coins)' });
  tick();
  assert.equal(held(poor, 'keldaIce'), 0);
});

test("the station's carts are placed: four rows, each track's front at its east end", () => {
  Ride.placeCarts();
  assert.equal(registered.length, Common.data.hubCarts.length);
  assert.ok(registered.every((object) => object.getId() === Common.ids.locs.hubCart));
  const fronts = Object.fromEntries(Common.data.tracks.filter((t) => !t.closed).map((t) => [t.track, t.front]));
  assert.deepEqual(fronts, { 1: [2923, 10175], 3: [2923, 10171], 4: [2919, 10169] });
  for (const [, [x, y]] of Object.entries(fronts)) {
    const row = Common.data.hubCarts.filter(([, cy]) => cy === y).map(([cx]) => cx);
    assert.equal(Math.max(...row), x, 'the front is the easternmost cart');
  }
});

test('station refusals: not the front, the wrong ticket, the closed tunnel', () => {
  const player = fakePlayer();
  const ride = (x, y) => Ride.rideCart({ player, objectId: Common.ids.locs.hubCart, location: { x, y, z: 0 } });
  const said = () => player.statements.at(-1)?.getDialogues?.()?.[0]?.getText?.()?.[0] ?? player.statements.at(-1);
  assert.equal(ride(2909, 10171), true);
  assert.ok(player.statements.length === 1, '"You should take the cart at the front of the queue."');
  assert.equal(ride(2923, 10175), true);
  assert.equal(player.statements.length, 2, '"You don\'t have an appropriate ticket for these carts."');
  ride(2919, 10164);
  assert.deepEqual(player.messages, ['That tunnel is inaccessible.']);
  assert.equal(Ride.riding(player), false);
  assert.ok(said());
});

test('track 1 to Ice Mountain: the ticket taken boarding, the recorded run east, the fade, Ice Mountain', () => {
  const player = fakePlayer();
  player.items.set(ticket('keldaIce'), 1);
  Ride.rideCart({ player, objectId: Common.ids.locs.hubCart, location: { x: 2923, y: 10175, z: 0 } });
  assert.equal(Ride.riding(player), true);
  assert.equal(held(player, 'keldaIce'), 0, 'taken as the player boards');
  assert.deepEqual(player.moves.at(-1), [2923, 10175], 'onto the cart');
  assert.deepEqual(player.objects[0], ['del', 7028, [2923, 10175]], 'the cart leaves with them');
  assert.deepEqual(player.worn[0], [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1], 'no weapon shown');
  assert.equal(player.blocked, true);
  tick();
  const first = player.glides[0];
  assert.deepEqual([xy(first.getStart()), xy(first.getEnd()), first.getSpeed(), first.getReverseSpeed(), first.getDirection()],
    [[2923, 10175], [3, 0], 30, 135, 1536]);
  tick(9);
  assert.deepEqual(path2(player.glides.at(-1)), [[2941, 10175], [2943, 10175]], 'the last glide, as recorded');
  assert.deepEqual(player.moves.at(-1), [2941, 10175], 'on the tile the glide left from: the engine moves the rider as the next one starts');
  assert.deepEqual(player.fades, []);
  tick();
  assert.deepEqual(player.fades, ['out'], 'the fade at 11');
  tick(3);
  assert.deepEqual(player.moves.at(-1), [2995, 9835], 'Ice Mountain at 14');
  assert.equal(player.worn.at(-1), 'restored');
  tick(3);
  assert.deepEqual(player.fades, ['out', 'in']);
  assert.equal(player.blocked, true, 'held until the ride ends');
  tick(3);
  assert.deepEqual(player.fades, ['out', 'in', 'closed']);
  assert.equal(Ride.riding(player), false);
  assert.equal(player.blocked, false);
  assert.deepEqual(player.objects.at(-1), ['add', 7028, [2923, 10175]], 'its cart back at the front at 13');
});

test('track 4 to White Wolf Mountain: the captured run east then south, the fade, White Wolf Mountain; sat in a cart throughout', () => {
  // The user's rsprox capture BetweenARock (rev 242.1), ticks 725-753.
  const player = fakePlayer();
  player.items.set(ticket('keldaWolf'), 1);
  Ride.rideCart({ player, objectId: Common.ids.locs.hubCart, location: { x: 2919, y: 10169, z: 0 } });
  assert.equal(Ride.riding(player), true);
  assert.equal(held(player, 'keldaWolf'), 0);
  const stance = Common.ids.seqs.ridingStance;
  assert.equal(stance, 2148, 'human_minecart_anim');
  assert.deepEqual(player.stances, [Array(7).fill(2148)], 'the riding stance on boarding');
  assert.deepEqual(player.kits, [{ 6: 82 }], 'the cart: feet kit 82');
  tick(3);
  assert.deepEqual(player.objects.at(-1), ['add', 7028, [2919, 10169]], 'its cart back at the front at 3');
  tick(12);
  assert.deepEqual(player.glides.map(path2), Common.data.tracks.find((t) => t.track === 4).steps.map(([, , [fx, fy, , tx, ty]]) => [[fx, fy], [tx, ty]]));
  assert.deepEqual(path2(player.glides.at(-1)), [[2936, 10153], [2936, 10152]], 'south down the tunnel, not east');
  assert.equal(player.glides.at(-1).getDirection(), 2, 'angle 0 is compass index 2');
  tick();
  assert.deepEqual(player.fades, ['out'], 'the fade at 16');
  tick(3);
  assert.deepEqual(player.moves.at(-1), [2876, 9869], 'White Wolf Mountain at 19');
  assert.equal(player.stances.at(-1), null, 'standing again as they land');
  assert.equal(player.kits.at(-1), null, 'their own feet again');
  tick(6);
  assert.deepEqual(player.fades, ['out', 'in'], 'the screen back at 25');
  tick(3);
  assert.equal(Ride.riding(player), false);
});

test('track 3 to the Grand Exchange is free; its turn south is sent as angle 0 (compass index 2)', () => {
  const player = fakePlayer();
  Ride.rideCart({ player, objectId: Common.ids.locs.hubCart, location: { x: 2923, y: 10171, z: 0 } });
  assert.equal(Ride.riding(player), true);
  tick(16);
  assert.deepEqual(player.moves.at(-1), [3141, 3504]);
  const south = player.glides.find((g) => g.getStart().getX() === 2937 && g.getStart().getY() === 10171);
  assert.equal(south.getDirection(), 2, 'angle 0 is sent as compass index 2');
  tick(6);
  assert.equal(Ride.riding(player), false);
});

test('Ice Mountain to Keldagrim: no ticket refused; with it, taken at the fade, the recorded arrival', () => {
  const player = fakePlayer();
  Ride.rideCart({ player, objectId: Common.ids.locs.iceCart, location: { x: 2995, y: 9836, z: 0 } });
  assert.equal(Ride.riding(player), false);
  assert.equal(player.statements.length, 1, '"You must purchase a ticket to Keldagrim before you can ride the mine cart."');
  player.items.set(ticket('iceKelda'), 1);
  Ride.rideCart({ player, objectId: Common.ids.locs.iceCart, location: { x: 2995, y: 9836, z: 0 } });
  assert.equal(held(player, 'iceKelda'), 0);
  assert.deepEqual(player.fades, ['out']);
  tick(3);
  assert.deepEqual(player.moves.at(-1), [2943, 10170], 'on the station track at 3');
  tick();
  assert.equal(player.worn.length, 1, 'the worn view blanked at 4');
  tick();
  assert.deepEqual(player.fades, ['out', 'in'], 'the screen back at 5');
  tick(11);
  assert.equal(player.glides.length, 12);
  assert.deepEqual(player.glides.map(path2), Common.data.arrival.steps.map(([, , [fx, fy, , tx, ty]]) => [[fx, fy], [tx, ty]]), 'every recorded glide');
  for (let i = 1; i < player.glides.length; i++) {
    assert.deepEqual(xy(player.glides[i].getStart()), Common.data.arrival.steps[i - 1][1], 'each glide starts on the tile the one before left the player on');
  }
  tick(6);
  assert.deepEqual(player.moves.at(-1), [2909, 10174], 'off the cart at 22');
  assert.deepEqual(player.fades.at(-1), 'closed');
  assert.deepEqual(player.objects.at(-1), ['add', 7027, [2909, 10173]], 'the unridable cart left behind');
  assert.equal(Ride.riding(player), false);
  assert.equal(player.blocked, false);
});

test('the Grand Exchange trapdoor: Travel rides at once; Inspect asks, and "Yes please." rides once the talk closes', () => {
  const player = fakePlayer();
  Ride.travelTrapdoor({ player, objectId: Common.ids.locs.trapdoor });
  assert.equal(Ride.riding(player), true);
  tick(22);
  assert.equal(Ride.riding(player), false);

  const asker = fakePlayer();
  asker.moveTo(loc(3141, 3504));
  Ride.inspectTrapdoor({ player: asker, objectId: Common.ids.locs.trapdoor });
  assert.equal(events.at(-1)[1].variant, 'inspecting-the-trapdoor-at-the-grand-exchange');
  assert.equal(events.at(-1)[1].npcId, 2388);
  asker.talking = {};
  Ride.onChoice({ player: asker, npcId: 2388, option: 'Yes please.' });
  tick(2);
  assert.equal(Ride.riding(asker), false, 'the player line still showing');
  asker.talking = null;
  tick();
  assert.equal(Ride.riding(asker), true);

  const declined = fakePlayer();
  declined.moveTo(loc(3141, 3504));
  Ride.inspectTrapdoor({ player: declined, objectId: Common.ids.locs.trapdoor });
  Ride.onChoice({ player: declined, npcId: 2388, option: 'No thanks.' });
  Ride.onChoice({ player: declined, npcId: 2388, option: 'Yes please.' });
  tick(3);
  assert.equal(Ride.riding(declined), false, 'the question was answered "No thanks."; a later "Yes please." is not it');

  const elsewhere = fakePlayer();
  elsewhere.moveTo(loc(3141, 3504));
  Ride.inspectTrapdoor({ player: elsewhere, objectId: Common.ids.locs.trapdoor });
  Ride.onChoice({ player: elsewhere, npcId: 3226, option: 'Yes please.' });
  tick(3);
  assert.equal(Ride.riding(elsewhere), false, "another NPC's \"Yes please.\"");
  Ride.onChoice({ player: elsewhere, npcId: 2388, option: 'Yes please.' });
  elsewhere.moveTo(loc(3222, 3218));
  tick(3);
  assert.equal(Ride.riding(elsewhere), false, 'teleported away before the talk closed');
  assert.equal(Ride.inspectTrapdoor({ player: declined, objectId: 1234 }), false, 'other trapdoors are not this one');
});

test('logging out mid-ride finishes it (saved at the destination); dying ends it where the player is', () => {
  const player = fakePlayer();
  player.items.set(ticket('keldaIce'), 1);
  Ride.rideCart({ player, objectId: Common.ids.locs.hubCart, location: { x: 2923, y: 10175, z: 0 } });
  tick(3);
  Ride.logout({ player });
  assert.deepEqual(player.moves.at(-1), [2995, 9835]);
  assert.equal(Ride.riding(player), false);
  assert.equal(player.blocked, false);

  const dying = fakePlayer();
  dying.items.set(ticket('wolfKelda'), 1);
  Ride.rideCart({ player: dying, objectId: Common.ids.locs.wolfCart, location: { x: 2875, y: 9868, z: 0 } });
  tick(2);
  dying.dying = true;
  tick();
  assert.equal(Ride.riding(dying), false);

  const fell = fakePlayer();
  Ride.rideCart({ player: fell, objectId: Common.ids.locs.hubCart, location: { x: 2923, y: 10171, z: 0 } });
  tick(3);
  fell.dying = true;
  tick();
  assert.deepEqual(fell.objects.at(-1), ['add', 7028, [2923, 10171]], 'its cart shown again after a death on the way out');
  assert.deepEqual(dying.fades.at(-1), 'closed');
  assert.equal(dying.displayed.at(-1), null, 'the worn items shown again');

  // A ticket to Keldagrim kept until the fade: logging out before it still pays it.
  const early = fakePlayer();
  early.items.set(ticket('iceKelda'), 1);
  Ride.rideCart({ player: early, objectId: Common.ids.locs.iceCart, location: { x: 2995, y: 9836, z: 0 } });
  Ride.logout({ player: early });
  assert.deepEqual(early.moves.at(-1), [2909, 10174]);
  assert.equal(held(early, 'iceKelda'), 0);
});

test('one ride at a time, and none before The Giant Dwarf is started', () => {
  const player = fakePlayer();
  Ride.travelTrapdoor({ player, objectId: Common.ids.locs.trapdoor });
  assert.equal(Ride.travelTrapdoor({ player, objectId: Common.ids.locs.trapdoor }), true);
  assert.equal(player.fades.filter((f) => f === 'out').length, 1);
  tick(22);

  quests.clear();
  const stranger = fakePlayer();
  Ride.travelTrapdoor({ player: stranger, objectId: Common.ids.locs.trapdoor });
  assert.equal(Ride.riding(stranger), false);
  assert.deepEqual(stranger.messages, ['You need to start The Giant Dwarf to enter Keldagrim.']);
});

test('a displayed kit shows over the saved look without changing it (the cart in the feet slot)', () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const player = new Player(null);
  const saved = player.getAppearance().getLook()[core.Appearance.FEET];
  player.setDisplayedKits({ [core.Appearance.FEET]: 82 });
  assert.equal(player.getAppearanceLook()[core.Appearance.FEET], 82);
  assert.equal(player.getAppearance().getLook()[core.Appearance.FEET], saved, 'the saved look is untouched');
  player.setDisplayedKits(null);
  assert.equal(player.getAppearanceLook()[core.Appearance.FEET], saved);
});
