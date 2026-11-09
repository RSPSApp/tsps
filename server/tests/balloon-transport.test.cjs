// From server/: node --test tests/balloon-transport.test.cjs (after yarn build).
//
// The balloon transport system against the OSRS Wiki (Balloon_transport_system, Enlightened
// Journey) and the assistants' transcripts: the map and its buttons, the quest gate, a trip's
// log, level, weight and pet checks, the Entrana search, opening routes from Entrana at the
// balloon controls (rsprox 226/01702 and the Wiki's solutions), the saved routes' varbits, and
// logging out or dying mid-flight.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, beforeEach, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

let Common, Travel, Controls, tasks, questDone, pets;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Common = require('../plugins/world/balloontransport/Common.BalloonTransport');
  Travel = require('../plugins/world/balloontransport/Travel.BalloonTransport');
  Controls = require('../plugins/world/balloontransport/Controls.BalloonTransport');
  let entranaCheck;
  const api = new Proxy({
    core: {
      ...core,
      TaskManager: { submit: (task) => { task.setRunning(true); tasks.push(task); } },
      World: { getNpcs: () => pets },
    },
    onCustomEvent(name, handler) { if (name === 'entrana:check-items') entranaCheck = handler; },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete') event.complete = questDone;
      if (name === 'entrana:check-items') entranaCheck(event);
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/npcs/Entrana.plugin').register(api);
  assert.equal(typeof entranaCheck, 'function');
  Common.init(api);
});

beforeEach(() => {
  tasks = [];
  questDone = true;
  pets = [];
});

const loc = (x, y) => new core.Location(x, y, 0);
const xy = (location) => [location.getX(), location.getY()];
const station = (key) => Common.data.stations.find((entry) => entry.key === key);

function fakePlayer({ at = [2808, 3354], firemaking = 99, boosted = firemaking, items = {}, worn = {} } = {}) {
  let tile = loc(...at);
  const inventory = new Map(Object.entries(items).map(([k, v]) => [Common.ids.objs[k] ?? Number(k), v]));
  const equipment = Array.from({ length: 14 }, () => new core.Item(-1, 0));
  for (const [slot, id] of Object.entries(worn)) equipment[core.Equipment[slot]] = new core.Item(id, 1);
  const player = {
    attributes: {}, varbits: {}, messages: [], said: [], fades: [], interface: -1, blocked: false, registered: true, xp: 0,
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    isRegistered: () => player.registered,
    getInterfaceId: () => player.interface,
    isDyingReturn: () => player.dying === true,
    getHitpoints: () => 99,
    getAttribute: (k) => player.attributes[k],
    setAttribute: (k, v) => { player.attributes[k] = v; },
    sendMessage: (m) => player.messages.push(m),
    getSkillManager: () => ({
      getMaxLevel: () => firemaking,
      getCurrentLevel: () => boosted,
      addExperience: (skill, amount) => { player.xp += amount; },
    }),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      delete: (id, n) => inventory.set(id, (inventory.get(id) ?? 0) - n),
      adds: (id, n) => inventory.set(id, (inventory.get(id) ?? 0) + n),
      getItems: () => [...inventory].filter(([, n]) => n > 0).map(([id, n]) => new core.Item(id, n)),
      getValidItems: () => [...inventory].filter(([, n]) => n > 0).map(([id, n]) => new core.Item(id, n)),
      refreshItems() {},
    }),
    inventory,
    getEquipment: () => ({ get: (slot) => equipment[slot], getItems: () => equipment, getValidItems: () => equipment.filter(item => item.getId() > 0 && item.getAmount() > 0) }),
    getSpellbook: () => ({ getInterfaceId: () => 218 }),
    setInterfaceId: (id) => { player.interface = id; },
    getMovementQueue: () => ({ setBlockMovement(v) { player.blocked = v; return this; }, reset() { return this; } }),
    getDialogueManager: () => ({
      startDialogues: (chain) => {
        player.said.push(chain);
        player.lastChain = chain;
      },
    }),
    getPacketSender: () => ({
      sendInterfaceRemoval: () => { player.interface = -1; },
      sendInterface: (id) => { player.interface = id; },
      sendVarbit: (id, v) => { player.varbits[id] = v; },
      sendSubInterface: (uid, id, type, { postScripts } = {}) => player.fades.push(`fade:${postScripts?.[0]?.args?.[3]}`),
      closeSubInterface: () => player.fades.push('closed'),
      sendJingle: (id) => { (player.jingles ??= []).push(id); },
      sendSong: (id) => { (player.songs ??= []).push(id); },
      sendTypedMessage: (type, line) => player.messages.push(line),
      sendInterfaceRawModel: (uid, model) => { (player.models ??= []).push([uid, model]); (player.grid ??= []).push(['model', uid, model]); },
      sendInterfaceAnimation: (uid, seq) => { player.journey = seq; (player.grid ??= []).push(['anim', uid, seq]); },
      sendInterfaceAngle: (uid, x, y, zoom) => { (player.grid ??= []).push(['angle', uid, x, y, zoom]); },
      sendInterfaceDisplayState() {},
      sendInterfacePosition: (uid, x, y) => { (player.positions ??= []).push([uid, x, y]); },
      sendSound: (id) => { (player.sounds ??= []).push(id); },
      sendTabInterface() {},
    }),
  };
  return player;
}

function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    const due = tasks;
    tasks = [];
    for (const task of due) if (task.tick()) tasks.push(task);
  }
}

/** The text of the last dialogue started for the player. */
function lastLine(player) {
  return player.lastChain?.getDialogues().get(0)?.getText() ?? null;
}

/** Runs the chain's follow-up action (the Entrana search's outcome). */
function continueChain(player) {
  player.lastChain.getDialogues().get(1)?.action?.execute();
}


/** Presses a control on zep_interface_side, by gameval. */
function press(player, button) {
  const uid = core.CacheDefinitions.getComponentId(`zep_interface_side:${button}`);
  const event = { player, buttonId: uid, groupId: uid >>> 16, childId: uid & 0xffff, handled: false };
  Controls.controlClick(event);
  return event;
}

const MOVES = { S: 'zep_btn_sandbags', L: 'zep_btn_logs', R: 'zep_btn_relax', N: 'zep_btn_tug', E: 'zep_btn_tug_emerg' };

/** Flies a Wiki/captured solution ("R3 L2 ...", screens split by |), one move per two ticks. */
function flySolution(player, solution) {
  for (const step of solution.replace(/\|/g, ' ').split(/\s+/).filter(Boolean)) {
    for (let i = 0; i < Number(step.slice(1)); i++) {
      press(player, MOVES[step[0]]);
      tick(2);
    }
  }
}

/** The captured Crafting Guild flight (rsprox 226/01702), as the Wiki's route gives it. */
const CRAFTING = 'R3 L2 R2 E1 R4 L1 E1 R2 N1 R1 L1 R1 | R1 N1 R1 L1 R4 N1 R3 L1 R6 | R2 S1 R6 E1 R3 N1 R3 N1';

/** The Wiki's solutions (Balloon_transport_system), one per route. */
const SOLUTIONS = {
  craft: CRAFTING,
  varrock: 'L4 R2 N3 R2 N1 L1 R2 N1 L2 R2 | R6 L2 R1 E2 R3 S1 R4 | R3 S1 R1 N2 S1 R1 N2 S1 R1 E1 R2 E1 N1',
  castle: 'S2 L1 R5 E1 L1 R2 E1 R2 L2 R3 | L1 R2 E1 N1 R7 S1 R2 E1 L1 N1 R1 | L1 R2 N1 R3 L1 E1 R4 S1 E1 R2 N1',
  gnome: 'R7 N1 R12 | L1 N1 L1 N1 L1 R2 L1 N1 R2 S1 R2 E1 R1 N1 R2 | L3 R2 N1 L1 R5 E1 R1 E1 N1 R2',
};

/** Starts opening a route from Entrana: the "You board the balloon." box, then take-off. */
function takeOff(player, key) {
  Travel.travel(player, station('entrana'), station(key));
  assert.equal(lastLine(player), 'You board the balloon.');
  continueChain(player);
}

const pick = (player, key) => {
  const childId = [...Common.ids.buttons].find(([, s]) => s.key === key)[0];
  const event = { player, groupId: Common.ids.map, childId, handled: false };
  Travel.chooseDestination(event);
  return event;
};

test('the map and its six buttons resolve from the cache; the logs too', () => {
  assert.equal(Common.ids.map, 469);
  const buttons = Object.fromEntries([...Common.ids.buttons].map(([child, s]) => [s.key, child]));
  assert.deepEqual(buttons, { castle: 13, gnome: 14, craft: 15, entrana: 16, taverley: 17, varrock: 18 });
  assert.deepEqual(Common.ids.objs, { logs: 1511, oak: 1521, willow: 1519, yew: 1515, magic: 1513 });
});

test('the map opens after Enlightened Journey only: Fly, Use on a basket, and the assistants\' "Yes."', () => {
  questDone = false;
  const before = fakePlayer();
  assert.equal(Travel.flyNpc({ player: before, npc: { getLocation: () => loc(2808, 3355), getId: () => 4715 } }), false);
  assert.equal(before.interface, -1, 'the quest keeps Auguste until then');
  questDone = true;
  const player = fakePlayer();
  Travel.flyNpc({ player, npc: { getLocation: () => loc(2808, 3355), getId: () => 4715 } });
  assert.equal(player.interface, 469);
  const basket = fakePlayer({ at: [2938, 3421] });
  assert.equal(Travel.useBasket({ player: basket, location: { x: 2939, y: 3421, z: 0 } }), true);
  assert.equal(basket.interface, 469);
  assert.equal(Travel.useBasket({ player: fakePlayer({ at: [3200, 3200] }), location: { x: 3200, y: 3200, z: 0 } }), false, 'not a station basket');
  const talk = fakePlayer({ at: [2938, 3421] });
  const action = { player: talk, npcId: 4723, action: 'open_interface', target: 'Balloon transport system', handled: false };
  Travel.onAction(action);
  assert.deepEqual([action.handled, action.end], [true, true]);
  tick();
  assert.equal(talk.interface, 469, 'the map opens as the talk closes');
  const other = { player: talk, action: 'open_interface', target: 'balloon construction diagram', handled: false };
  Travel.onAction(other);
  assert.equal(other.handled, false, "the quest's own interfaces are the quest's");
});

// Recorded (rsprox 3225, rev 232): the jingle, the clear overlay and the map flying the route at
// once; the teleport and the boarding line at 4; the map closed and the fade at 5; the overlay
// gone at 6.
test('Entrana to Taverley as recorded: one log, the map flying the route, Taverley 4 ticks later', () => {
  const player = fakePlayer({ items: { logs: 2 } });
  Travel.openMap(player, station('entrana'));
  pick(player, 'taverley');
  assert.equal(player.interface, 469, 'the map again, flying');
  assert.equal(player.journey, core.CacheDefinitions.getSeqId('zep_balloon_journey_entrana_taverley'));
  assert.deepEqual([player.jingles, player.songs], [[118], [147]]);
  assert.equal(player.inventory.get(1511), 1, 'one log');
  assert.deepEqual(player.fades, ['fade:0']);
  assert.equal(player.blocked, true);
  tick(3);
  assert.deepEqual(xy(player.getLocation()), [2808, 3354], 'not yet');
  tick(1);
  assert.deepEqual(xy(player.getLocation()), [2941, 3420]);
  assert.deepEqual(player.messages, ['You board the balloon and fly to Taverley.']);
  assert.equal(player.blocked, false);
  tick(1);
  assert.equal(player.interface, -1);
  assert.deepEqual(player.fades, ['fade:0', 'fade:255']);
  tick(1);
  assert.deepEqual(player.fades, ['fade:0', 'fade:255', 'closed']);
});

test("the last log used says so; the same station is 'You're already there!'", () => {
  const player = fakePlayer({ items: { logs: 1 } });
  Travel.travel(player, station('entrana'), station('taverley'));
  assert.deepEqual(player.messages, ['You used the last of your Logs.']);
  const there = fakePlayer({ items: { logs: 1 } });
  assert.equal(Travel.travel(there, station('entrana'), station('entrana')), false);
  assert.equal(lastLine(there), "You're already there!");
});

test("a trip needs its log and its Firemaking level; the same station refuses", () => {
  const player = fakePlayer({ at: [2938, 3421], items: { logs: 5 } });
  Common.openRoute(player, station('craft'));
  Travel.travel(player, station('taverley'), station('craft'));
  assert.equal(lastLine(player), 'You need 1 oak logs to make this trip.');
  assert.equal(Travel.flying(player), false);
  const low = fakePlayer({ at: [2938, 3421], firemaking: 29, items: { oak: 1 } });
  Common.openRoute(low, station('craft'));
  Travel.travel(low, station('taverley'), station('craft'));
  assert.equal(lastLine(low), 'You need a Firemaking level of 30 to fly there.');
  // Wiki: boostable. 29 boosted to 30 flies; 30 drained to 29 doesn't.
  const up = fakePlayer({ at: [2938, 3421], firemaking: 29, boosted: 30, items: { oak: 1 } });
  Common.openRoute(up, station('craft'));
  Travel.travel(up, station('taverley'), station('craft'));
  assert.equal(Travel.flying(up), true, 'a boost to 30 is enough');
  const down = fakePlayer({ at: [2938, 3421], firemaking: 30, boosted: 29, items: { oak: 1 } });
  Common.openRoute(down, station('craft'));
  Travel.travel(down, station('taverley'), station('craft'));
  assert.equal(lastLine(down), 'You need a Firemaking level of 30 to fly there.');
  assert.equal(Travel.travel(player, station('taverley'), station('taverley')), false);
});

test('to Entrana the player is searched using the shared carried and worn policy', () => {
  const armed = fakePlayer({ at: [2938, 3421], items: { logs: 1 }, worn: { WEAPON_SLOT: core.ItemIdentifiers.ABYSSAL_WHIP } });
  Travel.travel(armed, station('taverley'), station('entrana'));
  assert.equal(lastLine(armed), 'Weapons are not allowed on Entrana. I must search you first.');
  continueChain(armed);
  assert.deepEqual(armed.messages, ['You are quickly searched.']);
  assert.equal(lastLine(armed), "I'm sorry, no weapons or armour may be worn to Entrana. Come back when you have laid them down.");
  assert.equal(Travel.flying(armed), false);
  assert.equal(armed.inventory.get(1511), 1, 'the log kept');

  const clean = fakePlayer({ at: [2938, 3421], items: { logs: 1 } });
  Travel.travel(clean, station('taverley'), station('entrana'));
  continueChain(clean);
  assert.equal(Travel.flying(clean), true);
  tick(4);
  assert.deepEqual(xy(clean.getLocation()), [2808, 3354]);
});

test('opening a route from Entrana: its 10 logs (3 magic), the controls flown, 2,000 Firemaking XP, saved and shown', () => {
  const player = fakePlayer({ items: { oak: 12 } });
  takeOff(player, 'craft');
  assert.equal(player.inventory.get(1521), 2, '10 oak logs, paid at take-off');
  flySolution(player, CRAFTING);
  tick(4);
  assert.deepEqual(xy(player.getLocation()), [2923, 3302]);
  assert.equal(Common.opened(player, station('craft')), true);
  assert.equal(player.xp, 2000);
  assert.equal(player.varbits[2871], 1, "the Crafting Guild's basket and Brock shown");
  assert.equal(player.messages.at(-1), 'You arrive safely at the Crafting Guild.');
  // Opened: one log from then on, from anywhere opened.
  Travel.travel(player, station('craft'), station('entrana'));
  continueChain(player);
  tick(4);
  Travel.travel(player, station('entrana'), station('craft'));
  assert.equal(player.inventory.get(1521), 1);

  const gnome = fakePlayer({ items: { magic: 3 } });
  takeOff(gnome, 'gnome');
  assert.equal(gnome.inventory.get(1513), 0, '3 magic logs');
  flySolution(gnome, SOLUTIONS.gnome);
  tick(4);
  assert.equal(gnome.messages.at(-1), 'You arrive safely at the Grand Tree.');
  assert.deepEqual([gnome.varbits[2870], gnome.varbits[5032]], [1, 1], 'the Grand Tree basket and Le Smith');

  const short = fakePlayer({ items: { yew: 9 } });
  Travel.travel(short, station('entrana'), station('castle'));
  assert.equal(lastLine(short), 'You need 10 yew logs to open this route.');
});

test('a route not yet opened is refused away from Entrana', () => {
  const player = fakePlayer({ at: [2938, 3421], items: { willow: 20 } });
  Travel.travel(player, station('taverley'), station('varrock'));
  assert.equal(lastLine(player), 'You need to fly from Entrana to open that route first.');
  assert.equal(player.inventory.get(1519), 20);
});

test('no more than 40kg, the log aside, and no pet out', () => {
  const heavy = fakePlayer({ items: { logs: 1, [core.ItemIdentifiers.IRON_ORE]: 20 } });
  heavy.getInventory = ((original) => () => ({ ...original(), getItems: () => [new core.Item(1511, 1), ...Array.from({ length: 20 }, () => new core.Item(core.ItemIdentifiers.RUNE_PLATEBODY, 1))] }))(heavy.getInventory);
  assert.ok(Travel.weightKg(heavy, station('taverley')) > 40);
  Travel.travel(heavy, station('entrana'), station('taverley'));
  assert.equal(lastLine(heavy), 'You have too much weight in your bag. You may only bring 40kg of weight.');

  const owner = fakePlayer({ items: { logs: 1 } });
  owner.attributes['pets:current'] = { isRegistered: () => true };
  Travel.travel(owner, station('entrana'), station('taverley'));
  assert.equal(lastLine(owner), 'You need to put your pet into your inventory before the flight.');
});

test('login sends the opened routes; logging out mid-flight lands the player; dying ends it', () => {
  const player = fakePlayer();
  player.attributes[Common.ROUTES_ATTRIBUTE] = station('varrock').bit | station('castle').bit;
  Travel.login({ player });
  assert.deepEqual([player.varbits[2869], player.varbits[2870], player.varbits[2871], player.varbits[2872], player.varbits[5032]], [1, 0, 0, 1, 0]);

  const leaving = fakePlayer({ items: { logs: 1 } });
  Travel.travel(leaving, station('entrana'), station('taverley'));
  Travel.logout({ player: leaving });
  assert.deepEqual(xy(leaving.getLocation()), [2941, 3420]);
  assert.equal(Travel.flying(leaving), false);
  assert.equal(leaving.blocked, false);

  const dying = fakePlayer({ items: { logs: 1 } });
  Travel.travel(dying, station('entrana'), station('taverley'));
  dying.dying = true;
  tick(4);
  assert.deepEqual(xy(dying.getLocation()), [2808, 3354], 'where they were');
  assert.equal(dying.inventory.get(1511), 1, 'the log back');
  assert.equal(dying.fades.at(-1), 'closed');
  assert.equal(Travel.flying(dying), false);
});

test('one flight at a time, and a map pick only from an open map', () => {
  const player = fakePlayer({ items: { logs: 3 } });
  Travel.travel(player, station('entrana'), station('taverley'));
  assert.equal(Travel.travel(player, station('entrana'), station('taverley')), false);
  assert.equal(player.inventory.get(1511), 2);
  const stray = pick(fakePlayer(), 'taverley');
  assert.equal(stray.handled, false, 'no map open');
});

test("the trip is checked again after the Entrana search; armour put on mid-flight, or a teleport, stops it", () => {
  const dropped = fakePlayer({ at: [2938, 3421], items: { logs: 1 } });
  Travel.travel(dropped, station('taverley'), station('entrana'));
  dropped.inventory.set(1511, 0);
  continueChain(dropped);
  assert.equal(Travel.flying(dropped), false);
  assert.equal(lastLine(dropped), 'You need 1 normal logs to make this trip.');

  const armed = fakePlayer({ at: [2938, 3421], items: { logs: 1 } });
  Travel.travel(armed, station('taverley'), station('entrana'));
  continueChain(armed);
  assert.equal(Travel.flying(armed), true);
  armed.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] = new core.Item(core.ItemIdentifiers.ABYSSAL_WHIP, 1);
  tick(4);
  assert.deepEqual(xy(armed.getLocation()), [2938, 3421], 'not landed on Entrana armed');
  assert.equal(armed.inventory.get(1511), 1, 'the log back');

  const away = fakePlayer({ items: { logs: 1 } });
  Travel.travel(away, station('entrana'), station('taverley'));
  away.moveTo(loc(3222, 3218));
  tick(4);
  assert.deepEqual(xy(away.getLocation()), [3222, 3218], 'a teleport on the way is not undone');
});

test("the map opens only at a station the player has open, and with a speaker who has a name", () => {
  const lori = fakePlayer({ at: [2480, 3457] });
  assert.equal(Travel.flyNpc({ player: lori, npc: { getLocation: () => loc(2480, 3457), getId: () => 7179 }, npcId: 7154 }), false, 'the Grand Tree not yet open');
  assert.equal(lori.interface, -1);
  assert.equal(Travel.flyNpc({ player: fakePlayer({ at: [1800, 4893] }), npc: { getLocation: () => loc(1800, 4893), getId: () => 4717 }, npcId: 4717 }), false, 'no station there');
  const brock = fakePlayer({ at: [2925, 3303] });
  Common.openRoute(brock, station('craft'));
  Travel.flyNpc({ player: brock, npc: { getLocation: () => loc(2925, 3303), getId: () => 4731 }, npcId: 4720 });
  Travel.chooseDestination({ player: brock, groupId: Common.ids.map, childId: 17, handled: false });
  assert.equal(brock.lastChain.getDialogues().get(0).getNpcId(), 4720, 'Brock, not his blank multinpc');
});

test("take-off as captured: the counters 8 and 10, the route's first map and height, the interfaces, song 206", () => {
  const player = fakePlayer({ items: { oak: 10 } });
  takeOff(player, 'craft');
  const varbit = (name) => player.varbits[core.CacheDefinitions.getVarbitId(name)];
  assert.deepEqual(['zep_if_current_map', 'zep_if_screen_dist', 'zep_if_balloon_height', 'zep_if_sandbags', 'zep_if_logs'].map(varbit), [4, 0, 8, 8, 10]);
  assert.equal(player.interface, core.CacheDefinitions.getInterfaceId('zep_interface'));
  assert.deepEqual(player.songs, [206]);
  assert.deepEqual(player.positions.slice(-2).map(([, x, y]) => [x, y]), [[13, 104], [13, 128]], 'the envelope and the basket below it');
  assert.ok(player.blocked);
  assert.ok(Controls.inFlight(player));
});

test('each control moves a column: sandbags +2 and logs +1 spend their counter; the ropes come down', () => {
  const player = fakePlayer({ items: { oak: 10 } });
  takeOff(player, 'craft');
  const varbit = (name) => player.varbits[core.CacheDefinitions.getVarbitId(name)];
  press(player, 'zep_btn_relax');
  assert.deepEqual([varbit('zep_if_screen_dist'), varbit('zep_if_balloon_height')], [1, 8]);
  assert.deepEqual(player.sounds.slice(-2), [3242, 3246]);
  press(player, 'zep_btn_logs');
  assert.equal(varbit('zep_if_screen_dist'), 1, 'one move per two ticks: the click waits');
  tick(2);
  assert.deepEqual([varbit('zep_if_screen_dist'), varbit('zep_if_balloon_height'), varbit('zep_if_logs')], [2, 9, 9]);
  press(player, 'zep_btn_tug');
  tick(2);
  assert.equal(varbit('zep_if_balloon_height'), 8);
  assert.deepEqual(player.positions.slice(-2).map(([, x, y]) => [x, y]), [[13 + 24 * 3, 296 - 24 * 8], [13 + 24 * 3, 320 - 24 * 8]]);
});

test("an obstacle in the balloon's two cells crashes it: no route, no XP, the logs gone", () => {
  const player = fakePlayer({ items: { oak: 10 } });
  takeOff(player, 'craft');
  // Map 4 has a cloud at row 7, columns 4-6: four relaxes at height 8 fly the basket into it.
  flySolution(player, 'R4');
  assert.equal(Controls.inFlight(player), true, "still the player's flight until it has set them down");
  assert.ok(player.messages.includes('The balloon crashes.'));
  tick(2);
  assert.deepEqual(xy(player.getLocation()), [2808, 3354], 'down on Entrana from the first screen');
  tick(6);
  assert.equal(Controls.inFlight(player), false);
  assert.equal(Common.opened(player, station('craft')), false);
  assert.equal(player.xp, 0);
  assert.equal(player.inventory.get(1521), 0);
  assert.equal(player.blocked, false);
});

test("a finished flight keeps the player until it lands: no new flight in the gap, and no move during one", () => {
  const player = fakePlayer({ items: { oak: 10, willow: 10 } });
  takeOff(player, 'craft');
  flySolution(player, CRAFTING);
  tick(1);
  assert.equal(Common.opened(player, station('craft')), true, 'the route opens at +1');
  assert.equal(player.blocked, false, 'and the player may move');
  Travel.travel(player, station('entrana'), station('varrock'));
  continueChain(player);
  assert.equal(Controls.inFlight(player), true, 'still the Crafting Guild flight');
  tick(3);
  assert.deepEqual(xy(player.getLocation()), station('craft').land, 'set down at the Crafting Guild');
  tick(4);
  assert.equal(Controls.inFlight(player), false, 'free to fly again');
  assert.equal(player.inventory.get(1519), 10, 'no Varrock flight was paid for');
});

test('logging out while a finished flight comes down saves the player where it was taking them', () => {
  const player = fakePlayer({ items: { oak: 10 } });
  takeOff(player, 'craft');
  flySolution(player, CRAFTING);
  Controls.logout({ player });
  assert.deepEqual(xy(player.getLocation()), station('craft').land);
  assert.equal(Common.opened(player, station('craft')), true);
  assert.equal(Controls.inFlight(player), false);
});

test('bailing over Entrana lands safely there; a logout at the controls loses the logs', () => {
  const bailer = fakePlayer({ items: { oak: 10 } });
  takeOff(bailer, 'craft');
  flySolution(bailer, 'R2');
  press(bailer, 'zep_btn_close');
  assert.ok(bailer.messages.includes('You bail, but land safely on Entrana.'));
  tick(8);
  assert.equal(Controls.inFlight(bailer), false);

  const leaver = fakePlayer({ items: { oak: 10 } });
  takeOff(leaver, 'craft');
  flySolution(leaver, 'R2');
  Controls.logout({ player: leaver });
  assert.equal(Controls.inFlight(leaver), false);
  assert.equal(leaver.inventory.get(1521), 0, 'the logs are gone');
  assert.equal(Common.opened(leaver, station('craft')), false);
});

test('every route with screens lands its Wiki solution without touching an obstacle', () => {
  const logs = { craft: 'oak', varrock: 'willow', castle: 'yew', gnome: 'magic' };
  assert.deepEqual(Object.keys(Controls.data().routes).sort(), ['castle', 'craft', 'gnome', 'taverley', 'varrock']);
  // Taverley is Enlightened Journey's flight (tests/enlightened-journey-flight.test.cjs).
  for (const key of Object.keys(logs)) {
    const player = fakePlayer({ items: { [logs[key]]: 10 } });
    takeOff(player, key);
    flySolution(player, SOLUTIONS[key]);
    tick(4);
    assert.equal(Common.opened(player, station(key)), true, key);
    assert.deepEqual(xy(player.getLocation()), station(key).land, key);
  }
});

test('with no sandbags left a sandbag click does nothing: no move, no counter, no sound', () => {
  const player = fakePlayer({ items: { yew: 10 } });
  takeOff(player, 'castle');
  const varbit = (name) => player.varbits[core.CacheDefinitions.getVarbitId(name)];
  // All eight sandbags spent clear of Castle Wars' first screen.
  flySolution(player, [...'SSEESSRRNEENSSESS'].map((move) => `${move}1`).join(' '));
  assert.equal(Controls.inFlight(player), true);
  assert.deepEqual([varbit('zep_if_sandbags'), varbit('zep_if_screen_dist'), varbit('zep_if_balloon_height')], [0, 17, 9]);
  const sounds = player.sounds.length;
  flySolution(player, 'S1');
  assert.deepEqual([varbit('zep_if_sandbags'), varbit('zep_if_screen_dist'), varbit('zep_if_balloon_height')], [0, 17, 9]);
  assert.equal(player.sounds.length, sounds);
  assert.equal(Controls.inFlight(player), true);
});

test('IF_SETANGLE as captured: an animated cell gets its model, its angle, then its animation; the rest keep the default', () => {
  const player = fakePlayer({ items: { oak: 10 } });
  takeOff(player, 'craft');
  const cell = (row, col) => core.CacheDefinitions.getComponentId(`zep_interface:zep_grid_${row}_${col}`);
  const of = (uid) => player.grid.filter(([, at]) => at === uid);
  // Map 4's bird at row 10, column 2 and its storm creature at row 8, column 5 (rsprox 226/01702).
  assert.deepEqual(of(cell(10, 2)), [['model', cell(10, 2), 19780], ['angle', cell(10, 2), 201, 318, 2576], ['anim', cell(10, 2), 342]]);
  assert.deepEqual(of(cell(8, 5)), [['model', cell(8, 5), 19781], ['angle', cell(8, 5), 99, 333, 3472], ['anim', cell(8, 5), 3160]]);
  assert.deepEqual(of(cell(3, 0)), [['model', cell(3, 0), 19609]], 'scenery: the model alone');
  const animated = Controls.data().routes.craft.screens[0].filter(([, , model]) => Controls.data().angles[model]).length;
  assert.equal(player.grid.filter(([kind]) => kind === 'angle').length, animated);
});

test('a screen change clears the 220 cells row by row, puts every angle back, then draws the next screen', () => {
  const player = fakePlayer({ items: { oak: 10 } });
  takeOff(player, 'craft');
  // The first screen's nineteen moves to column 19; its twentieth (R1) is the change.
  flySolution(player, 'R3 L2 R2 E1 R4 L1 E1 R2 N1 R1 L1');
  player.grid = [];
  flySolution(player, 'R1');
  const cell = (row, col) => core.CacheDefinitions.getComponentId(`zep_interface:zep_grid_${row}_${col}`);
  const cleared = player.grid.slice(0, 220);
  const reset = player.grid.slice(220, 440);
  const order = [];
  for (let row = 0; row <= 10; row++) for (let col = 0; col < 20; col++) order.push(cell(row, col));
  assert.deepEqual(cleared, order.map((uid) => ['model', uid, 65535]));
  assert.deepEqual(reset, order.map((uid) => ['angle', uid, 0, 0, 2576]));
  const next = Controls.data().routes.craft.screens[1];
  assert.equal(player.grid.slice(440).filter(([kind]) => kind === 'model').length, next.length);
  // Map 5's shark at row 3, column 19 (99, 333, 2576 as captured).
  assert.deepEqual(player.grid.filter(([, at]) => at === cell(3, 19)).slice(-3), [['model', cell(3, 19), 19717], ['angle', cell(3, 19), 99, 333, 2576], ['anim', cell(3, 19), 5154]]);
});

test("every route draws the balloon controls' own models, and each animated one has its captured angle", () => {
  const { routes, angles } = Controls.data();
  for (const [key, route] of Object.entries(routes)) {
    for (const [index, cells] of route.screens.entries()) {
      for (const [row, col, model, anim] of cells) {
        assert.ok(model >= 19519 && model <= 19781, `${key} screen ${index + 1} (${row}, ${col}): ${model}`);
        if (anim >= 0) assert.ok(angles[model], `${key} screen ${index + 1} (${row}, ${col}): ${model} animates without an angle`);
      }
    }
  }
});
