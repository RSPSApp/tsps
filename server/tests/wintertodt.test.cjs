// Run after `yarn build`: node --test tests/wintertodt.test.cjs
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { World } = require('../dist/game/World');
const { Location } = require('../dist/game/model/Location');
const Shared = require('../plugins/minigames/wintertodt/WintertodtShared');
const Round = require('../plugins/minigames/wintertodt/WintertodtRound');
const Doors = require('../plugins/minigames/wintertodt/Doors.Wintertodt');
const Braziers = require('../plugins/minigames/wintertodt/Braziers.Wintertodt');
const Supplies = require('../plugins/minigames/wintertodt/Supplies.Wintertodt');
const Pyromancers = require('../plugins/minigames/wintertodt/Pyromancers.Wintertodt');
const Cart = require('../plugins/minigames/wintertodt/Cart.Wintertodt');
const Corners = require('../plugins/minigames/wintertodt/WintertodtCorners');
const Warmth = require('../plugins/minigames/wintertodt/WintertodtWarmth');
const Attacks = require('../plugins/minigames/wintertodt/WintertodtAttacks');
const Rewards = require('../plugins/minigames/wintertodt/WintertodtRewards');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');

const hooks = {
  objects: {}, zoneEnter: [], zoneExit: [], login: [], logout: [], prompts: [], events: [],
  itemOnObject: {}, itemOnItem: {}, items: {}, itemOnNpc: [], drops: [], custom: {}, npcs: {},
};

function fakeApi() {
  return {
    core: PluginManager.getCoreApi(),
    persistAttribute() {},
    onServerStartup() {},
    onObjectInteraction: (name, actions) => { hooks.objects[name] = actions; },
    onZoneEnter: (zone, handler) => hooks.zoneEnter.push({ zone, handler }),
    onZoneExit: (zone, handler) => hooks.zoneExit.push({ zone, handler }),
    onPlayerLogin: (handler) => hooks.login.push(handler),
    onPlayerLogout: (handler) => hooks.logout.push(handler),
    sendMultiChatboxPrompt: (player, title, ...args) => hooks.prompts.push({ player, title, args }),
    emitCustomEvent: (name, payload) => {
      hooks.events.push(name);
      for (const handler of hooks.custom[name] ?? []) handler(payload);
    },
    onItemOnObject: (item, object, handler) => { hooks.itemOnObject[`${item}|${object}`] = handler; },
    onItemOnItem: (a, b, handler) => { hooks.itemOnItem[`${a}|${b}`] = handler; },
    onItemAction: (name, actions) => { hooks.items[name] = actions; },
    onItemOnNpc: (handler) => hooks.itemOnNpc.push(handler),
    onItemDropPolicy: (handler) => hooks.drops.push(handler),
    onCustomEvent: (name, handler) => (hooks.custom[name] ??= []).push(handler),
    onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
    onObjectRoute: () => {},
  };
}

/** A container of { id, amount } slots, close enough to ItemContainer for these units. */
function container(size) {
  const slots = new Array(size).fill(null);
  const view = (slot) => slot ? { getId: () => slot.id, getAmount: () => slot.amount } : null;
  const self = {
    slots,
    getItems: () => slots.map(view),
    setItem(slot, item) {
      const id = item?.getId?.() ?? -1;
      slots[slot] = id > 0 ? { id, amount: item.getAmount?.() || 1 } : null;
      return self;
    },
    /** Coins, and anything given more than one at a time (noted loot), stack in one slot. */
    adds(id, amount = 1) {
      const stacks = STACKABLE.has(id) || amount > 1;
      const stack = stacks && slots.find((slot) => slot?.id === id);
      if (stack) stack.amount += amount;
      else if (stacks) slots[slots.indexOf(null)] = { id, amount };
      else slots[slots.indexOf(null)] = { id, amount: 1 };
      return self;
    },
    delete(id, amount = 1) {
      for (let i = 0; i < slots.length && amount > 0; i++) {
        if (slots[i]?.id !== id) continue;
        const taken = Math.min(amount, slots[i].amount);
        slots[i].amount -= taken;
        amount -= taken;
        if (slots[i].amount <= 0) slots[i] = null;
      }
      return self;
    },
    contains: (id) => slots.some((slot) => slot?.id === id),
    getAmount: (id) => slots.reduce((sum, slot) => sum + (slot?.id === id ? slot.amount : 0), 0),
    getFreeSlots: () => slots.filter((slot) => !slot).length,
    refreshItems() { return self; },
  };
  return self;
}
const STACKABLE = new Set([995]);

function fakePlayer(name = 'Tester', { firemaking = 99, level = 99, x = 1631, y = 3959 } = {}) {
  const varbits = new Map();
  const attributes = new Map();
  const p = {
    messages: [], statements: [], scripts: [], interfaces: [], animations: [], splats: [], damage: [],
    xp: 0, xpBySkill: {}, hp: 99,
    location: new Location(x, y, 0),
    inventory: container(28),
    equipment: container(14),
    getUsername: () => name,
    getLocation: () => p.location,
    moveTo(location) { p.location = location; },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => p.messages.push(message),
    getInventory: () => p.inventory,
    getEquipment: () => p.equipment,
    getBanks: () => [],
    getHitpoints: () => p.hp,
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => p.damage.push(...hits.map((hit) => hit.getDamage())) }) }),
    showHitsplat: (damage, splat, health) => p.splats.push({ damage, splat, health }),
    performAnimation: (animation) => p.animations.push(animation.getId?.() ?? animation.id),
    getSkillManager: () => ({
      getMaxLevel: (skill) => (skill?.getName?.() === 'Firemaking' || String(skill?.name ?? skill).toUpperCase() === 'FIREMAKING' ? firemaking : level),
      getCurrentLevel: () => level,
      addExperiences(skill, amount) {
        p.xp += amount;
        const key = skill?.getName?.() ?? String(skill);
        p.xpBySkill[key] = (p.xpBySkill[key] ?? 0) + amount;
      },
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => p.statements.push(chain) }),
    getPacketSender() {
      const sender = {
        sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
        getVarbit: (id) => varbits.get(id) ?? 0,
        sendConfig: (id, value) => { varbits.set(`varp${id}`, value); return sender; },
        sendSubInterface: (uid, id, type, options) => { p.interfaces.push([id, options?.postScripts?.[0]?.scriptId]); return sender; },
        closeSubInterface: (uid) => { p.interfaces.push([-1]); return sender; },
        sendClientScript: (id, ...args) => { p.scripts.push([id, ...args]); return sender; },
        sendProjectile: () => sender,
        sendGraphic: () => sender,
      };
      return sender;
    },
    varbits,
    lastHud: () => p.scripts.filter((s) => s[0] === Shared.SCRIPT.HUD_UPDATE).at(-1)?.slice(1),
  };
  return p;
}

function ticks(count) {
  for (let i = 0; i < count; i++) {
    Round.tick();
    TaskManager.process();
  }
}

/** Runs the zone hooks the way the server does after a player moves. */
function moved(player, from) {
  const inside = (zone, at) => Shared.inZone(zone, at);
  for (const { zone, handler } of hooks.zoneExit) if (inside(zone, from) && !inside(zone, player.location)) handler({ player, zone });
  for (const { zone, handler } of hooks.zoneEnter) if (!inside(zone, from) && inside(zone, player.location)) handler({ player, zone });
}

function walkIn(player) {
  const from = player.location;
  player.location = new Location(1630, 3980, 0);
  moved(player, from);
}

function startRound() {
  if (!Round.isActive()) Round.startRound();
}

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  const api = fakeApi();
  Doors(api);
  Braziers(api);
  Supplies(api);
  Pyromancers(api);
  Cart(api);
});

const attacksTick = Attacks.tick;

beforeEach(() => {
  // The Wintertodt's random attacks are tested on their own.
  Attacks.tick = () => {};
  if (Round.isActive()) Round.endRound();
  Round._round.watchers.clear();
  hooks.prompts.length = 0;
});

test('rewards follow the Wiki: two at 500 points, one more per 500 and a share of a chance past it', () => {
  assert.equal(Round.rewardsFor(499), 0);
  assert.equal(Round.rewardsFor(500, () => 0), 2);
  assert.equal(Round.rewardsFor(580, () => 0.99), 2, 'the capture: 580 points, 2 rewards');
  assert.equal(Round.rewardsFor(580, () => 0.1), 3, '16% chance of a third');
  assert.equal(Round.rewardsFor(1200, () => 0.5), 3);
  assert.equal(Round.rewardsFor(1200, () => 0.3), 4, '1200 points: a 40% chance of a fourth');
});

test('the break counts down 100 ticks on varbit 7980, then a round starts at 3500 energy', () => {
  Round._round.timer = Shared.BREAK_TICKS;
  const player = fakePlayer('Watcher');
  walkIn(player);
  assert.deepEqual(player.interfaces.at(-1), [Shared.INTERFACE.HUD, Shared.SCRIPT.HUD_INSIDE]);
  assert.equal(player.varbits.get(Shared.VARBIT.ROUND_TIMER), 100);
  assert.equal(player.varbits.get(Shared.VARBIT.WARMTH), 1000, 'warmth is full on entering');
  assert.deepEqual(player.lastHud(), [0, 0, 1, 1, 1, 1, 1, 1, 1, 1], 'between rounds: no energy, all healthy, all unlit');
  ticks(10);
  assert.equal(player.varbits.get(Shared.VARBIT.ROUND_TIMER), 90);
  ticks(89);
  assert.equal(Round.isActive(), false);
  ticks(1);
  assert.equal(Round.isActive(), true);
  assert.equal(player.varbits.get(Shared.VARBIT.ROUND_TIMER), 0);
  assert.deepEqual(player.lastHud(), [0, 3500, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.ok(hooks.events.includes('wintertodt:round-start'));
});

test('lit braziers drain 5 energy per pyromancer every 2 ticks; with all out it recovers 1 a tick', () => {
  startRound();
  for (let i = 0; i < 4; i++) Round.corner(i).brazier = Shared.BRAZIER.LIT;
  ticks(2);
  assert.equal(Round.energy(), 3480, 'the capture: 20 every 2 ticks with all four lit');
  Round.corner(3).pyromancerHealthy = false;
  ticks(2);
  assert.equal(Round.energy(), 3465, 'a downed pyromancer stops draining');
  for (let i = 0; i < 4; i++) Round.corner(i).brazier = Shared.BRAZIER.UNLIT;
  ticks(5);
  assert.equal(Round.energy(), 3470);
  Round.corner(3).brazier = Shared.BRAZIER.LIT;
  ticks(5);
  assert.equal(Round.energy(), 3470, 'a lit brazier stops the recovery even with its pyromancer down');
});

test('a round ends at 0 energy: 500+ points earn XP, a kill and rewards; fewer earn the message', () => {
  startRound();
  const winner = fakePlayer('Winner');
  const loser = fakePlayer('Loser');
  walkIn(winner);
  walkIn(loser);
  assert.match(winner.messages[0], /perhaps you should find some warmer clothes/, 'no warm clothing on');
  winner.messages.length = 0;
  loser.messages.length = 0;
  Round.addPoints(winner, 490);
  assert.equal(winner.messages.length, 0);
  Round.addPoints(winner, 90);
  assert.deepEqual(winner.messages, ['You have helped enough to earn a supply crate.']);
  Round.addPoints(winner, 10);
  assert.equal(winner.messages.length, 1, 'only once');
  Round.addPoints(loser, 70);

  Round.setEnergy(0);
  assert.equal(Round.isActive(), false);
  assert.equal(winner.xp, 9900);
  const gained = 9900 * (PluginManager.getCoreApi().GameConstants.EXPERIENCE_MULTIPLIER ?? 1);
  assert.equal(winner.messages[1], `You have gained ${gained.toLocaleString('en-US')} Firemaking XP.`);
  assert.equal(winner.messages[2], 'Your subdued Wintertodt count is: <col=ff0000>1</col>.');
  const owed = Round.rewardsOwed(winner);
  assert.ok(owed === 2 || owed === 3);
  assert.equal(winner.messages[3], `You're owed an additional ${owed} rewards from the reward cart. You're now owed ${owed} rewards.`);
  assert.equal(winner.varbits.get(Shared.VARBIT.REWARDS_OWED), owed);
  assert.equal(winner.varbits.get(`varp${Shared.VARP.KILLS}`), 1);
  assert.deepEqual(loser.messages, ['You did not earn enough points to be worthy of a gift from the citizens of Kourend this time.']);
  assert.equal(loser.xp, 0);
  assert.equal(Round.pointsOf(winner), 0, 'points reset for the next round');
  assert.equal(winner.varbits.get(Shared.VARBIT.ROUND_TIMER), 100);
  assert.ok(hooks.events.includes('wintertodt:round-end'));
});

test('points only count during a round, and only inside the prison on the HUD', () => {
  const player = fakePlayer('Idle');
  walkIn(player);
  Round.addPoints(player, 100);
  assert.equal(Round.pointsOf(player), 0);
  startRound();
  Round.addPoints(player, 100);
  Round.sendHud(player);
  assert.equal(player.lastHud()[0], 100);
});

test('the doors need 50 Firemaking, fade you in two ticks later, and Peek reports the round', () => {
  const novice = fakePlayer('Novice', { firemaking: 49 });
  hooks.objects['Doors of Dinh'].Enter({ player: novice });
  assert.equal(novice.statements.length, 1);
  assert.ok(!Round.inPrison(novice));

  const player = fakePlayer('Entrant');
  hooks.objects['Doors of Dinh'].Enter({ player });
  assert.deepEqual(player.interfaces[0], [Shared.INTERFACE.FADE, Shared.SCRIPT.FADE]);
  ticks(1);
  assert.ok(!Round.inPrison(player));
  ticks(1);
  assert.ok(Round.inPrison(player), 'moved two ticks after the fade');

  hooks.objects['Doors of Dinh'].Peek({ player: novice });
  assert.equal(novice.statements.length, 2);
});

test('leaving mid-round asks first and loses the points and the prison supplies', () => {
  startRound();
  const player = fakePlayer('Leaver');
  walkIn(player);
  Round.addPoints(player, 300);
  player.inventory.adds(Shared.ITEM.BRUMA_ROOT, 5);
  player.inventory.adds(Shared.ITEM.BRUMA_KINDLING, 3);
  hooks.objects['Doors of Dinh'].Enter({ player });
  assert.equal(hooks.prompts.length, 1, 'a round is on: confirm first');
  assert.equal(hooks.prompts[0].args[0], 'Leave and lose all progress.');
  hooks.prompts[0].args[1]();
  const from = player.location;
  ticks(2);
  moved(player, from);
  assert.ok(Shared.inZone(Shared.CAMP_ZONE, player.location));
  assert.equal(Round.pointsOf(player), 0);
  assert.equal(player.inventory.getAmount(Shared.ITEM.BRUMA_ROOT), 0);
  assert.equal(player.inventory.getAmount(Shared.ITEM.BRUMA_KINDLING), 0);
  assert.deepEqual(player.interfaces.at(-1), [Shared.INTERFACE.HUD, Shared.SCRIPT.HUD_OUTSIDE], 'the HUD stays up in the camp');
});

test('leaving between rounds asks nothing; a login inside the prison wakes up outside', () => {
  const player = fakePlayer('Breaker');
  walkIn(player);
  hooks.objects['Doors of Dinh'].Enter({ player });
  assert.equal(hooks.prompts.length, 0);
  ticks(2);
  assert.ok(!Round.inPrison(player));

  const sleeper = fakePlayer('Sleeper', { x: 1630, y: 3990 });
  sleeper.setAttribute(Round.ATTR_KILLS, 12);
  hooks.login[0]({ player: sleeper });
  assert.ok(!Round.inPrison(sleeper));
  assert.equal(sleeper.varbits.get(`varp${Shared.VARP.KILLS}`), 12);
});

test('the round keeps the storm and braziers in the world in step', () => {
  const at = (tile) => World.getObjects().find((o) => o.getLocation().getX() === tile.x && o.getLocation().getY() === tile.y)?.getId();
  startRound();
  assert.equal(at(Shared.STORM_TILE), Shared.OBJECT.STORM);
  Round.endRound();
  assert.equal(at(Shared.STORM_TILE), Shared.OBJECT.STORM_IDLE);
  for (const c of Shared.CORNERS) assert.equal(at(c.brazier), Shared.OBJECT.BRAZIER_UNLIT);
});

// ------------------------------------------------------------------ phase 2: the fight

/** A player standing by the south-west brazier, inside the prison and out of the safe area. */
function fighter(name, options = {}) {
  const player = fakePlayer(name, options);
  player.location = new Location(1623, 3999, 0);
  moved(player, new Location(1631, 3959, 0));
  player.messages.length = 0;
  return player;
}

const SW = 0;
const swBrazier = { getLocation: () => new Location(1620, 3997, 0) };

test('the Wiki damage formulas give the captured hits', () => {
  const player = fighter('Cold');
  for (const id of [I.PYROMANCER_HOOD, I.PYROMANCER_GARB, I.PYROMANCER_ROBE, I.PYROMANCER_BOOTS]) player.equipment.adds(id);
  assert.equal(Warmth.warmItems(player), 4);
  startRound();
  for (let i = 0; i < 3; i++) Corners.corner(i).brazier = Shared.BRAZIER.LIT;
  assert.equal(Warmth.damageFor(player, 'standard'), 6, 'capture: 6 at 99 FM, 4 warm items');
  assert.equal(Warmth.damageFor(player, 'brazier'), 12, 'capture: shrapnel 12');
  assert.equal(Warmth.damageFor(player, 'area'), 18, 'capture: area attack 18');
  const novice = fighter('Novice', { firemaking: 50 });
  for (let i = 0; i < 4; i++) Corners.corner(i).brazier = Shared.BRAZIER.UNLIT;
  assert.equal(Warmth.damageFor(novice, 'standard'), 32);
  assert.equal(Warmth.damageFor(novice, 'area'), 60);
});

test('warm clothing is read from cache names, variants included', () => {
  for (const id of [I.PYROMANCER_HOOD, 29777, 11865, I.WARM_GLOVES]) assert.ok(Warmth.isWarm(id), String(id));
  assert.equal(Warmth.isWarm(1127), false, 'rune platebody');
});

test('cold hits take ten times their hitsplat from warmth, show on bar 79, and kill at 0', () => {
  const player = fighter('Freezing');
  startRound();
  Warmth.hurt(player, 'standard', Attacks.COLD_MESSAGE);
  const damage = Warmth.damageFor(player, 'standard');
  assert.equal(Warmth.warmthOf(player), 1000 - damage * 10);
  assert.equal(player.varbits.get(Shared.VARBIT.WARMTH), 1000 - damage * 10);
  assert.deepEqual(player.splats[0].splat, { mine: 75, others: 76 });
  assert.deepEqual(player.splats[0].health.bar, { id: 79, width: 30 });
  Warmth.setWarmth(player, 10);
  Warmth.hurt(player, 'area', Attacks.AREA_MESSAGE);
  assert.ok(player.messages.includes('<col=ef1020>The cold of the Wintertodt has overcome you!'));
  assert.deepEqual(player.damage, [99], 'a hit for all your hitpoints');
});

test('warmth regenerates 8% a minute plus 1% per warm item; food and potions restore it', () => {
  const player = fighter('Thawing');
  for (const id of [I.PYROMANCER_HOOD, I.PYROMANCER_GARB]) player.equipment.adds(id);
  Warmth.setWarmth(player, 500);
  Round._round.ticks = 99;
  ticks(1);
  assert.equal(Warmth.warmthOf(player), 600, '80 + 2 x 10 at the 100-tick beat');
  hooks.custom['food:eaten'][0]({ player, itemId: I.SHARK, heal: 20 });
  assert.equal(Warmth.warmthOf(player), 950);
  hooks.custom['food:eaten'][0]({ player, itemId: I.SHRIMPS, heal: 3 });
  assert.equal(Warmth.warmthOf(player), 950, 'under 4 healed does nothing');
  Warmth.setWarmth(player, 100);
  player.inventory.adds(Shared.ITEM.REJUVENATION_2);
  hooks.items['Rejuvenation potion (2)'].Drink({ player, slot: 0, itemId: Shared.ITEM.REJUVENATION_2 });
  assert.equal(Warmth.warmthOf(player), 400);
  assert.equal(player.inventory.slots[0].id, Shared.ITEM.REJUVENATION_1);
});

test('lighting needs a tinderbox or torch and a healthy pyromancer; it pays 25 points and 6x XP', () => {
  startRound();
  const player = fighter('Lighter');
  hooks.objects.Brazier.Light({ player, object: swBrazier });
  assert.deepEqual(player.messages, ['You need a tinderbox or bruma torch to light that brazier.']);
  player.inventory.adds(Shared.ITEM.TINDERBOX);
  Corners.damagePyromancer(SW, 14);
  hooks.objects.Brazier.Light({ player, object: swBrazier });
  assert.equal(player.messages.at(-1), 'Heal the Pyromancer before lighting the brazier.');
  Corners.healPyromancer(SW);
  hooks.objects.Brazier.Light({ player, object: swBrazier });
  assert.equal(player.animations.at(-1), Shared.ANIM.LIGHT_TINDERBOX);
  ticks(1);
  assert.equal(Corners.corner(SW).brazier, Shared.BRAZIER.UNLIT);
  ticks(1);
  assert.equal(Corners.corner(SW).brazier, Shared.BRAZIER.LIT);
  assert.equal(player.messages.at(-1), 'You light the brazier.');
  assert.equal(Round.pointsOf(player), 25);
  assert.equal(player.xp, 6 * 99);
  const torch = fighter('Torch');
  torch.equipment.adds(Shared.ITEM.BRUMA_TORCH);
  Corners.setBrazier(SW, Shared.BRAZIER.UNLIT);
  hooks.objects.Brazier.Light({ player: torch, object: swBrazier });
  assert.equal(torch.animations.at(-1), Shared.ANIM.LIGHT_TORCH, 'capture: 7174 with the bruma torch');
});

test('feeding burns kindling first, then roots, one every 3 ticks, until they run out', () => {
  startRound();
  Corners.setBrazier(SW, Shared.BRAZIER.LIT);
  const player = fighter('Feeder');
  player.inventory.adds(Shared.ITEM.BRUMA_KINDLING, 1);
  player.inventory.adds(Shared.ITEM.BRUMA_ROOT, 1);
  hooks.objects['Burning brazier'].Feed({ player, object: swBrazier });
  assert.equal(Round.pointsOf(player), 25, 'kindling first');
  ticks(3);
  assert.equal(Round.pointsOf(player), 35, 'then a root');
  ticks(3);
  assert.equal(player.messages.at(-1), 'You have run out of bruma roots.');
  assert.equal(player.xp, 99 * 3.8 + 99 * 3);
});

test("a small attack puts a brazier out and tells whoever was feeding it", () => {
  startRound();
  Corners.setBrazier(SW, Shared.BRAZIER.LIT);
  const player = fighter('Feeding');
  player.inventory.adds(Shared.ITEM.BRUMA_ROOT, 20);
  hooks.objects['Burning brazier'].Feed({ player, object: swBrazier });
  Attacks.smallBrazierAttack(SW, { players: Round.playersInPrison, isActive: Round.isActive, broadcast: Round.broadcast });
  ticks(3);
  assert.equal(Corners.corner(SW).brazier, Shared.BRAZIER.LIT);
  ticks(1);
  assert.equal(Corners.corner(SW).brazier, Shared.BRAZIER.UNLIT);
  assert.equal(player.messages.at(-1), Attacks.GONE_OUT_MESSAGE);
  assert.equal(Shared.actionOf(player), null);
});

test('a large attack breaks the brazier and its shrapnel hits players beside it; a hammer fixes it', () => {
  startRound();
  Corners.setBrazier(SW, Shared.BRAZIER.LIT);
  const near = fighter('Near');
  const far = fighter('Far');
  far.location = new Location(1630, 4000, 0);
  Attacks.largeBrazierAttack(SW, { players: Round.playersInPrison, isActive: Round.isActive, broadcast: Round.broadcast });
  ticks(4);
  assert.equal(Corners.corner(SW).brazier, Shared.BRAZIER.BROKEN);
  assert.ok(near.messages.includes(Attacks.SHRAPNEL_MESSAGE));
  assert.ok(!far.messages.includes(Attacks.SHRAPNEL_MESSAGE));
  hooks.objects.Brazier.Fix({ player: near, object: swBrazier });
  assert.equal(near.messages.at(-1), 'You need a hammer to fix this brazier.');
  near.inventory.adds(Shared.ITEM.HAMMER);
  hooks.objects.Brazier.Fix({ player: near, object: swBrazier });
  ticks(2);
  assert.equal(Corners.corner(SW).brazier, Shared.BRAZIER.UNLIT);
  assert.equal(near.messages.at(-1), 'You fix the brazier.');
  assert.equal(Round.pointsOf(near), 25);
  assert.equal(near.xpBySkill.Construction ?? 0, 0, 'no house, no Construction XP');
});

test('pyromancers fall at 14 damage; Help heals with the emptiest potion for 75 points', () => {
  startRound();
  const player = fighter('Healer');
  const npc = { getId: () => Shared.NPC.INCAPACITATED_PYROMANCER, getLocation: () => new Location(1619, 3996, 0) };
  assert.equal(Corners.damagePyromancer(SW, 8), false);
  assert.equal(Corners.damagePyromancer(SW, 8), true, 'two hits');
  hooks.npcs['Incapacitated Pyromancer'].Help({ player, npc });
  assert.equal(player.statements.length, 1, 'no potion');
  player.inventory.adds(Shared.ITEM.REJUVENATION_4);
  player.inventory.adds(Shared.ITEM.REJUVENATION_2);
  hooks.npcs['Incapacitated Pyromancer'].Help({ player, npc });
  assert.equal(Corners.corner(SW).pyromancerHealthy, true);
  assert.equal(Round.pointsOf(player), 75);
  assert.deepEqual(player.inventory.slots.slice(0, 2).map((slot) => slot.id), [Shared.ITEM.REJUVENATION_4, Shared.ITEM.REJUVENATION_1]);
});

test('roots come every 3 ticks at 99 with a dragon axe; kindling every 4 outside the safe area', () => {
  startRound();
  const player = fighter('Chopper');
  hooks.objects['Bruma roots'].Chop({ player });
  assert.equal(player.messages.at(-1), 'You do not have an axe which you have the woodcutting level to use.');
  player.inventory.adds(I.DRAGON_AXE);
  hooks.objects['Bruma roots'].Chop({ player });
  assert.equal(player.messages.at(-1), 'You swing your axe at the roots.');
  ticks(9);
  assert.equal(player.inventory.getAmount(Shared.ITEM.BRUMA_ROOT), 3);

  player.inventory.adds(Shared.ITEM.KNIFE);
  const safe = player.location;
  player.location = new Location(1630, 3980, 0);
  hooks.itemOnItem['Knife|Bruma root']({ player });
  assert.equal(player.messages.at(-1), 'Your hands are too cold to fletch here - move closer to the braziers.');
  player.location = safe;
  hooks.itemOnItem['Knife|Bruma root']({ player });
  ticks(3);
  assert.equal(player.inventory.getAmount(Shared.ITEM.BRUMA_KINDLING), 1);
  ticks(4);
  assert.equal(player.inventory.getAmount(Shared.ITEM.BRUMA_KINDLING), 2);
  assert.equal(player.messages.at(-1), 'You carefully fletch the root into a bundle of kindling.');
});

test('the crates give one tool while you have none, and up to ten concoctions', () => {
  const player = fighter('Supplier');
  hooks.objects.Crate['Take-knife']({ player });
  assert.equal(player.messages.at(-1), 'You take a knife from the crate.', 'capture');
  hooks.objects.Crate['Take-knife']({ player });
  assert.equal(player.messages.at(-1), 'You already have a knife.');
  hooks.objects.Crate['Take-10 concoctions']({ player });
  assert.equal(player.inventory.getAmount(Shared.ITEM.REJUVENATION_UNF), 10);
  player.inventory.adds(Shared.ITEM.BRUMA_HERB);
  hooks.itemOnItem['Bruma herb|Rejuvenation potion (unf)']({ player });
  assert.equal(player.inventory.getAmount(Shared.ITEM.REJUVENATION_4), 1);
  const outside = fakePlayer('Outside');
  hooks.itemOnItem['Bruma herb|Rejuvenation potion (unf)']({ player: outside });
  assert.equal(outside.messages.at(-1), 'You can only do that within the influence of the Bruma tree.');
});

test("the Wintertodt's attacks follow its energy: standard ones fade, brazier ones grow", () => {
  startRound();
  const player = fighter('Target');
  const ctx = { ticks: 5, energy: 3500, players: Round.playersInPrison, isActive: Round.isActive, broadcast: Round.broadcast };
  Attacks.useRandom(() => 0.5);
  attacksTick(ctx);
  assert.equal(player.messages.at(-1), Attacks.COLD_MESSAGE, 'a roll under full energy hits');
  attacksTick({ ...ctx, ticks: 10 });
  assert.equal(player.messages.filter((m) => m === Attacks.COLD_MESSAGE).length, 1, '10-tick cooldown');
  attacksTick({ ...ctx, ticks: 15, energy: 100 });
  assert.equal(player.messages.filter((m) => m === Attacks.COLD_MESSAGE).length, 1, 'rare near the end');
  assert.equal(Attacks.standardChance(3500), 1);
  assert.ok(Math.abs(Attacks.standardChance(2100) - 0.216) < 0.001, '60% energy: 0.6 cubed');
  Attacks.useRandom(Math.random);
});

// ------------------------------------------------------------------ phase 3: the reward cart

test('the reward tables follow the Wiki module', () => {
  assert.equal(Rewards.interpolate(1, -70, 40), 0, 'no torstol at level 1');
  assert.equal(Rewards.interpolate(99, -70, 40), 41);
  assert.equal(Rewards.interpolate(50, 255, 255), 256, 'the last item always hits');
  const player = fighter('Looter');
  for (let i = 0; i < 2000; i++) {
    const reward = Rewards.roll(player);
    assert.ok(reward && reward.id > 0 && reward.amount > 0, JSON.stringify(reward));
  }
  const fish = Rewards.rollSkillTable(fakePlayer('Fisher', { level: 99 }), 'FISHING', () => 0);
  assert.equal(fish.id, 384, 'noted raw shark');
  assert.equal(Rewards.pyromancerPiece(player), I.PYROMANCER_GARB, 'ties: garb first');
  player.inventory.adds(I.PYROMANCER_GARB);
  assert.equal(Rewards.pyromancerPiece(player), I.PYROMANCER_HOOD);
});

test('the cart: Check counts, Search takes one every 3 ticks, and the last ends with a message box', () => {
  const player = fakePlayer('Searcher');
  Cart.check({ player });
  assert.equal(player.messages.at(-1), "You aren't owed any rewards from the cart.");
  Round.setRewardsOwed(player, 2);
  assert.equal(player.varbits.get(Shared.VARBIT.REWARDS_OWED), 2, 'the cart multiloc');
  Cart.check({ player });
  assert.equal(player.messages.at(-1), 'You are owed 2 more rewards from the cart.', 'capture');
  Cart.search({ player });
  assert.equal(player.animations.at(-1), Shared.ANIM.CART_SEARCH);
  ticks(3);
  assert.equal(Round.rewardsOwed(player), 1);
  assert.match(player.messages.at(-1), /^You found some loot: \d+ x .+/);
  Cart.bigSearch({ player });
  ticks(3);
  assert.equal(Round.rewardsOwed(player), 0, 'the last one');
  assert.equal(player.statements.length, 1, "You think you've taken as much as you're owed...");

  player.inventory.slots.fill(null);
  Round.setRewardsOwed(player, 25);
  Cart.bigSearch({ player });
  ticks(2);
  assert.equal(Round.rewardsOwed(player), 25);
  ticks(1);
  assert.equal(Round.rewardsOwed(player), 15, 'ten in one search');
  player.inventory.slots.fill(null);
  Round.setRewardsOwed(player, 9);
  Cart.bigSearch({ player });
  ticks(3);
  assert.equal(Round.rewardsOwed(player), 0, 'all nine when fewer than ten are owed');
});

test('a brazier click walks to the nearest open tile beside it, walled side included (as live)', () => {
  const seBrazier = { getLocation: () => new Location(1638, 3997, 0) };
  const event = { objectId: Shared.OBJECT.BRAZIER_UNLIT, object: seBrazier, sourceLocation: { x: 1638, y: 3994, z: 0 }, destination: null };
  Braziers.routeToBrazier(event);
  assert.deepEqual(event.destination, { x: 1638, y: 3996, z: 0 }, 'the capture: lit and fed from (1638, 3996)');
  const inner = { objectId: Shared.OBJECT.BRAZIER_LIT, object: seBrazier, sourceLocation: { x: 1634, y: 4003, z: 0 }, destination: null };
  Braziers.routeToBrazier(inner);
  assert.ok(inner.destination && (inner.destination.x === 1637 || inner.destination.y === 4000), JSON.stringify(inner.destination));
  const elsewhere = { objectId: Shared.OBJECT.BRAZIER_UNLIT, object: { getLocation: () => new Location(3200, 3200, 0) }, sourceLocation: { x: 3200, y: 3198, z: 0 }, destination: null };
  Braziers.routeToBrazier(elsewhere);
  assert.equal(elsewhere.destination, null);
});

test('bruma roots and kindling go at the end of a round; every prison supply on leaving or logging out', () => {
  startRound();
  const player = fighter('Hoarder');
  player.inventory.adds(Shared.ITEM.BRUMA_ROOT);
  player.inventory.adds(Shared.ITEM.BRUMA_KINDLING);
  player.inventory.adds(Shared.ITEM.REJUVENATION_4);
  player.inventory.adds(I.DRAGON_AXE);
  Round.endRound();
  assert.equal(player.inventory.getAmount(Shared.ITEM.BRUMA_ROOT), 0);
  assert.equal(player.inventory.getAmount(Shared.ITEM.BRUMA_KINDLING), 0);
  assert.equal(player.inventory.getAmount(Shared.ITEM.REJUVENATION_4), 1, 'potions last the break');
  assert.equal(player.inventory.getAmount(I.DRAGON_AXE), 1);

  player.inventory.adds(Shared.ITEM.BRUMA_ROOT);
  hooks.logout[0]({ player });
  assert.equal(player.inventory.getAmount(Shared.ITEM.BRUMA_ROOT), 0);
  assert.equal(player.inventory.getAmount(Shared.ITEM.REJUVENATION_4), 0);
  assert.equal(player.inventory.getAmount(I.DRAGON_AXE), 1);

  const returning = fakePlayer('Returning', { x: 1630, y: 3990 });
  returning.inventory.adds(Shared.ITEM.BRUMA_KINDLING);
  hooks.login[0]({ player: returning });
  assert.equal(returning.inventory.getAmount(Shared.ITEM.BRUMA_KINDLING), 0);
});
