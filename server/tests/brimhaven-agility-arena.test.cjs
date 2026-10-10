// Run after `yarn build`: node --test tests/brimhaven-agility-arena.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { Skill } = require("../dist/game/model/Skill");
const { ItemIds } = require("../dist/util/IdEnums");
const { Location } = require("../dist/game/model/Location");

const plugin = require("../plugins/minigames/BrimhavenAgilityArena.plugin");
const {
  init, cycle, stateOf, hasSession, tick, advanceCycle, activeTile, setRandom,
  tagXp, trapDamage, trapAt, isBladeHit, isInArena, CYCLE_TICKS, DISPENSER_TILES, OBSTACLE_XP,
  ENTRY, HUT, createArea, processPlayer, stepTrap, stepBlades,
  enterArena, leaveArena, tagDispenser, logout, death,
  PAID_ATTRIBUTE, payIzzy, climbDown, hasPaid, answerCondition, transcriptPayment,
  obstacleXp, familyAt, crossingTarget,
} = plugin._test;

init({ core: PluginManager.getCoreApi() });

const TICKET = ItemIds.AGILITY_ARENA_TICKET;
const VOUCHER = ItemIds.BRIMHAVEN_VOUCHER;
const COINS = ItemIds.COINS;

function player({ agility = 50, coins = 0, hitpoints = 99, x = 2804, y = 9590, z = 3 } = {}) {
  const inventory = new Map();
  if (coins > 0) inventory.set(COINS, coins);
  const attributes = new Map();
  const p = {
    messages: [], xp: 0, hits: [], levels: {}, hints: [], hintCleared: false,
    varbits: new Map(), dialogues: [], animations: [],
    x, y, z,
    getLocation: () => ({ getX: () => p.x, getY: () => p.y, getZ: () => p.z }),
    moveTo: (loc) => { p.x = loc.getX(); p.y = loc.getY(); p.z = loc.getZ(); },
    setLocation: (loc) => { p.x = loc.getX(); p.y = loc.getY(); p.z = loc.getZ(); },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    performAnimation: (animation) => p.animations.push(animation.getId()),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      deleteNumber: (id, n) => inventory.set(id, (inventory.get(id) ?? 0) - n),
      forceAdd: (_p, item) => inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()),
    }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === Skill.AGILITY ? p.agility : 99),
      addExperiences: (skill, xp) => { assert.equal(skill, Skill.AGILITY); p.xp += xp; },
      setCurrentLevel: (skill, level) => { if (skill === Skill.AGILITY) p.agility = level; },
    }),
    getHitpoints: () => hitpoints,
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => p.hits.push(hits[0]) }) }),
    getPacketSender: () => ({
      sendPositionalHint: (loc) => p.hints.push(loc),
      clearHintArrow: () => { p.hintCleared = true; },
      sendVarbit: (id, value) => p.varbits.set(id, value),
    }),
    getDialogueManager: () => ({ startDialogues: (builder) => p.dialogues.push(builder) }),
    sendMessage: (message) => p.messages.push(message),
    inventory,
  };
  p.agility = agility;
  return p;
}

const tileOfId = (id) => DISPENSER_TILES.find((tile) => tile.id === id);
const setActive = (tile) => { cycle.active = tile; cycle.nextAt = cycle.tick + CYCLE_TICKS; };

test("paying Cap'n Izzy takes 200 coins once and only unlocks the ladder", () => {
  const paying = player({ coins: 250, x: 2808, y: 3193, z: 0 });
  payIzzy({ player: paying });
  assert.equal(paying.inventory.get(COINS), 50);
  assert.equal(hasPaid(paying), true);
  assert.equal(paying.varbits.get(5964), 1, "agilityarena_canenter");
  assert.deepEqual([paying.x, paying.y, paying.z], [2808, 3193, 0], "paying does not move the player");

  payIzzy({ player: paying });
  assert.equal(paying.inventory.get(COINS), 50, "a paid fee is not taken twice");

  const broke = player({ coins: 199, x: 2808, y: 3193, z: 0 });
  payIzzy({ player: broke });
  assert.equal(broke.inventory.get(COINS), 199);
  assert.equal(hasPaid(broke), false);
});

test("the hut ladder needs the fee; unpaid, the Parrot speaks first", () => {
  const unpaid = player({ coins: 500, x: 2808, y: 3193, z: 0 });
  climbDown(unpaid);
  assert.equal(unpaid.dialogues.length, 1, "Clap 'em in irons!");
  assert.equal(unpaid.animations.length, 0);
  assert.equal(unpaid.inventory.get(COINS), 500, "the fee is taken on continuing, not before");

  const paid = player({ coins: 500, x: 2808, y: 3193, z: 0 });
  payIzzy({ player: paid });
  climbDown(paid);
  assert.deepEqual(paid.animations, [827]);
});

test("Izzy's transcript takes the fee on its hand-over line", () => {
  const izzy = { getName: () => "Cap'n Izzy No-Beard" };
  const rich = player({ coins: 300 });
  assert.equal(answerCondition({ player: rich, definition: izzy, text: "If the player has enough coins:" }), true);
  assert.equal(answerCondition({ player: rich, definition: izzy, text: "If the player doesn't have enough coins:" }), false);
  assert.equal(answerCondition({ player: rich, definition: { getName: () => "Hans" }, text: "If the player has enough coins:" }), null);

  const event = { player: rich, kind: "message", stepId: "geqhzb" };
  transcriptPayment(event);
  assert.equal(rich.inventory.get(COINS), 100);
  assert.equal(hasPaid(rich), true);
  assert.deepEqual(event.box, { items: [COINS] });
});

test("exactly one dispenser is active and the cycle moves on after 100 ticks", () => {
  setRandom(() => 0.5);
  advanceCycle();
  const active = activeTile();
  assert.ok(active);
  assert.equal(DISPENSER_TILES.filter((tile) => tile.x === active.x && tile.y === active.y).length, 1);

  for (let i = 0; i < CYCLE_TICKS - 1; i++) tick();
  assert.deepEqual({ ...activeTile() }, { ...active }, "still the same just before the minute");
  tick();
  assert.notDeepEqual({ ...activeTile() }, { ...active });
  assert.ok(DISPENSER_TILES.includes(activeTile()), "the new active one is a real dispenser");
});

test("tagging the active dispenser pays a ticket, a voucher and scaled XP once per cycle", () => {
  advanceCycle();
  setActive(tileOfId(3608));
  const p = player({ agility: 50 });
  const event = { player: p, objectId: 3608, location: { x: cycle.active.x, y: cycle.active.y, z: 3 } };

  tagDispenser(event);
  assert.equal(p.xp, tagXp(50));
  assert.equal(p.xp, 150);
  assert.equal(p.inventory.get(TICKET), 1);
  assert.equal(p.inventory.get(VOUCHER), 1);
  assert.ok(p.messages.includes("You have received an Agility Arena Ticket and Brimhaven Voucher!"));

  tagDispenser(event);
  assert.equal(p.xp, 150, "a second tag in the same cycle is free of XP");
  assert.equal(p.inventory.get(TICKET), 1);
  assert.equal(p.inventory.get(VOUCHER), 1);
  assert.ok(p.messages.includes("You can only get one ticket at a time, wait till the arrow moves again."));
});

test("a miss on an inactive dispenser awards nothing and says so", () => {
  advanceCycle();
  setActive(tileOfId(3608));
  const inactive = DISPENSER_TILES.find((tile) => tile.x !== cycle.active.x || tile.y !== cycle.active.y);
  const p = player({ agility: 50 });
  tagDispenser({ player: p, objectId: inactive.id, location: { x: inactive.x, y: inactive.y, z: 3 } });
  assert.equal(p.xp, 0);
  assert.equal(p.inventory.get(TICKET) ?? 0, 0);
  assert.ok(p.messages.includes("You can only get a ticket when the flashing arrow is above the pillar."));
});

test("the darts dispenser needs 40 Agility and can hit for damage and a drain", () => {
  advanceCycle();
  setActive(tileOfId(3581));
  const event = (p) => ({ player: p, objectId: 3581, location: { x: cycle.active.x, y: cycle.active.y, z: 3 } });

  const low = player({ agility: 30 });
  setRandom(() => 0);
  tagDispenser(event(low));
  assert.ok(low.messages.some((message) => message.includes("at least 40")));
  assert.equal(low.xp, 0);

  const miss = player({ agility: 40 });
  setRandom(() => 0.99);
  tagDispenser(event(miss));
  assert.equal(miss.agility, 38, "a miss drains two Agility levels");
  assert.equal(miss.hits.length, 1);
  assert.ok(miss.messages.includes("You were hit by some darts, something on them makes you feel dizzy!"));
  assert.equal(miss.inventory.get(TICKET) ?? 0, 0);
  assert.equal(miss.xp, 0);

  const success = player({ agility: 40 });
  setRandom(() => 0);
  tagDispenser(event(success));
  assert.equal(success.xp, 30 + tagXp(40), "darts XP plus the tag XP");
  assert.equal(success.inventory.get(TICKET), 1);
  assert.equal(success.inventory.get(VOUCHER), 1);
});

test("logging out in the arena ejects to the hut and forgets the tag lock", () => {
  advanceCycle();
  setActive(tileOfId(3608));
  const p = player({ agility: 50 });
  tagDispenser({ player: p, objectId: 3608, location: { x: cycle.active.x, y: cycle.active.y, z: 3 } });
  assert.ok(hasSession(p));

  p.setAttribute(PAID_ATTRIBUTE, true);
  logout({ player: p });
  assert.equal(hasSession(p), false, "the one-tag flag does not survive a logout");
  assert.deepEqual([p.x, p.y, p.z], [HUT.x, HUT.y, HUT.z]);
  assert.equal(p.getAttribute(PAID_ATTRIBUTE), null, "the fee is spent");
  assert.equal(p.inventory.get(TICKET), 1, "the tag already paid stays paid");
});

test("death outside the arena leaves the tag lock alone", () => {
  const p = player({ agility: 50, x: 2808, y: 3193, z: 0 });
  stateOf(p);
  death({ player: p, handled: false });
  assert.equal(hasSession(p), true, "not in the arena, nothing to clean");
  assert.equal(p.x, 2808);
});

test("floor spikes pay 24 XP, never fail at 50+ and refuse below 20", () => {
  const expert = player({ agility: 50 });
  setRandom(() => 0.99);
  stepTrap(expert, "FLOOR_SPIKES");
  assert.equal(expert.xp, 24);
  assert.equal(expert.hits.length, 0);

  const low = player({ agility: 10 });
  stepTrap(low, "FLOOR_SPIKES");
  assert.equal(low.xp, 0);
  assert.ok(low.messages.some((message) => message.includes("at least 20")));

  const unlucky = player({ agility: 30, hitpoints: 99 });
  setRandom(() => 0.99);
  stepTrap(unlucky, "FLOOR_SPIKES");
  assert.equal(unlucky.xp, 0);
  assert.equal(unlucky.hits.length, 1);
  assert.equal(trapDamage(99), 6);
});

test("pressure pads pay twice, then sit out eight ticks", () => {
  const p = player({ agility: 50 });
  stepTrap(p, "PRESSURE_PAD");
  stepTrap(p, "PRESSURE_PAD");
  assert.equal(p.xp, 52);

  stepTrap(p, "PRESSURE_PAD");
  assert.equal(p.xp, 52, "the third consecutive use is on cooldown");
  for (let i = 0; i < 8; i++) tick();
  stepTrap(p, "PRESSURE_PAD");
  assert.equal(p.xp, 78);
});

test("spinning blades need 40 Agility and their miss hurts", () => {
  const low = player({ agility: 30 });
  setRandom(() => 0);
  stepBlades(low);
  assert.ok(low.messages.some((message) => message.includes("at least 40")));
  assert.equal(low.xp, 0);

  const miss = player({ agility: 60 });
  setRandom(() => 0.99);
  stepBlades(miss);
  assert.ok(miss.messages.includes("You were hit by the spinning blades!"));
  assert.equal(miss.hits.length, 1);
  assert.equal(miss.xp, 0);

  const success = player({ agility: 60 });
  setRandom(() => 0);
  stepBlades(success);
  assert.equal(success.xp, 28);
});

test("trap tiles trigger once per tile entered, through the area's process", () => {
  const p = player({ agility: 50, x: 2772, y: 9551 });
  const mobile = { isPlayer: () => true, getAsPlayer: () => p };
  processPlayer(mobile);
  assert.equal(p.xp, 24);
  processPlayer(mobile);
  assert.equal(p.xp, 24, "standing still does not re-roll");
  p.y = 9552;
  processPlayer(mobile);
  assert.equal(p.xp, 48, "the next spike tile rolls again");
});

test("the arena area covers the map's pillar grid and nothing else", () => {
  const area = createArea();
  const [boundary] = area.getBoundaries();
  const inside = new Location(2783, 9568, 3);
  const outside = new Location(2783, 9568, 0);
  assert.equal(boundary.inside(inside), true);
  assert.equal(boundary.inside(outside), false);
  assert.equal(isInArena({ getLocation: () => inside }), true);
  assert.equal(isInArena({ getLocation: () => outside }), false);
});

test("every clickable obstacle maps to its family and documented XP", () => {
  const expected = {
    BALANCING_ROPE: 10, LOG_BALANCE: 12, BALANCING_LEDGE: 16, MONKEY_BARS: 14, LOW_WALL: 8,
    ROPE_SWING: 20, PLANK: 6, PILLAR: 18, HAND_HOLDS: 22, PRESSURE_PAD: 26, FLOOR_SPIKES: 24,
    SPINNING_BLADES: 28, DARTS: 30,
  };
  for (const [kind, xp] of Object.entries(expected)) {
    assert.equal(obstacleXp(kind), xp, `${kind} XP`);
    assert.equal(OBSTACLE_XP[kind], xp);
  }
  assert.equal(familyAt(3551), "BALANCING_ROPE");
  assert.equal(familyAt(3570), "PLANK");
  assert.equal(familyAt(3583), "HAND_HOLDS");
  assert.equal(familyAt(3608), null, "dispensers are not obstacles");
});

test("walking over an obstacle steps one tile past the clicked one", () => {
  const p = player({ x: 2760, y: 9546, z: 3 });
  const object = { getLocation: () => new Location(2764, 9546, 3), getFace: () => 0 };
  assert.deepEqual(crossingTarget(p, object), { x: 2765, y: 9546, z: 3 });
});

test("the trap tiles are the cache's, and the blades catch the tiles beside them", () => {
  assert.equal(trapAt(2772, 9551), "FLOOR_SPIKES");
  assert.equal(trapAt(2799, 9557), "PRESSURE_PAD");
  assert.equal(trapAt(2783, 9546), null, "a dispenser pillar is not a trap");
  assert.equal(isBladeHit(2777, 9555), true);
  assert.equal(isBladeHit(2777, 9556), false, "the blade tile itself is not walkable");
});
