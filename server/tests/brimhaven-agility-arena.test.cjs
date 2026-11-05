// Run after `yarn build`: node --test tests/brimhaven-agility-arena.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { Skill } = require("../dist/game/model/Skill");
const { ItemIds } = require("../dist/util/IdEnums");
const { Location } = require("../dist/game/model/Location");
const { TaskManager } = require("../dist/game/task/TaskManager");
const ObstacleRunner = require("../plugins/skills/agility/ObstacleRunner.Agility");

const plugin = require("../plugins/minigames/BrimhavenAgilityArena.plugin");
const {
  init, cycle, stateOf, hasSession, tick, advanceCycle, activeTile, setRandom,
  tagXp, trapDamage, trapAt, trapSpanAt, isInArena, CYCLE_TICKS, DISPENSER_TILES, OBSTACLE_XP,
  ENTRY, HUT, createArea, processPlayer, stepTrap, LAPS_ATTRIBUTE, lineAt, crossing, crossingSteps,
  enterArena, leaveArena, tagDispenser, logout, death,
  PAID_ATTRIBUTE, payIzzy, climbDown, hasPaid, answerCondition, transcriptPayment,
  obstacleXp, familyAt, crossingTarget, ropeSwingSteps, routeToObstacle,
} = plugin._test;

init({ core: PluginManager.getCoreApi(), emitCustomEvent() {} });
ObstacleRunner.init({ core: PluginManager.getCoreApi(), getTaskManager: () => TaskManager });

/** The 2024 ticket (29480); ItemIds.AGILITY_ARENA_TICKET (2996) is the discontinued one. */
const TICKET = ItemIds.AGILITY_ARENA_TICKET_3;
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
    getLocation: () => new Location(p.x, p.y, p.z),
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
    isRegistered: () => true,
    setSkillAnimation() {},
    getUpdateFlag: () => ({ flag() {} }),
    setForceMovement() {},
    getForceMovement: () => null,
    setPositionToFace() {},
    setWalkingDirection() {},
    getMovementQueue: () => ({ reset() {}, setBlockMovement() {}, handleRegionChange() {} }),
    getPacketSender: () => ({
      sendSoundEffect() {},
      sendTypedMessage: (_type, message) => p.messages.push(message),
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
  assert.equal(p.getAttribute(LAPS_ATTRIBUTE), 1);
  assert.ok(p.messages.includes("Your Agility Arena lap count is: <col=ff0000>1</col>."), "the count comes first (rsprox 75)");
  assert.equal(p.dialogues.length, 1, "the ticket's item box");

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

test("a darts dispenser tags like any other: its darts are in the corridors, not on the tag", () => {
  // rsprox 75 ticks 13549/13580 and 1863 tick 2030: tagging 3581 pays only the tag XP.
  advanceCycle();
  setActive(tileOfId(3581));
  const p = player({ agility: 30 });
  setRandom(() => 0.99);
  tagDispenser({ player: p, objectId: 3581, location: { x: cycle.active.x, y: cycle.active.y, z: 3 } });
  assert.equal(p.xp, tagXp(30));
  assert.equal(p.hits.length, 0);
  assert.equal(p.inventory.get(TICKET), 1);
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

/** Runs the obstacle task the trap started until it is done. */
function settle(ticks = 12) {
  for (let i = 0; i < ticks; i++) TaskManager.process();
}

test("floor spikes jump the whole span for 24 XP once, never fail at 50+ and refuse below 20", () => {
  // rsprox 75 13531-13533: on 2800,9568 heading west, 1115 over both spike tiles to 2798.
  const expert = player({ agility: 50, x: 2800, y: 9568 });
  setRandom(() => 0.99);
  stepTrap(expert, trapSpanAt(2800, 9568), { x: 2801, y: 9568 });
  settle();
  assert.equal(expert.xp, 24);
  assert.equal(expert.hits.length, 0);
  assert.deepEqual([expert.x, expert.y], [2798, 9568]);

  const low = player({ agility: 10, x: 2772, y: 9551 });
  stepTrap(low, trapSpanAt(2772, 9551), { x: 2772, y: 9550 });
  settle();
  assert.equal(low.xp, 0);
  assert.ok(low.messages.some((message) => message.includes("at least 20")));

  const unlucky = player({ agility: 30, hitpoints: 99, x: 2772, y: 9551 });
  setRandom(() => 0.99);
  stepTrap(unlucky, trapSpanAt(2772, 9551), { x: 2772, y: 9550 });
  settle();
  assert.equal(unlucky.xp, 0);
  assert.equal(unlucky.hits.length, 1);
  assert.equal(trapDamage(99), 6);
});

test("pressure pads pay twice, then sit out eight ticks", () => {
  const p = player({ agility: 50, x: 2800, y: 9557 });
  setRandom(() => 0);
  const cross = () => {
    p.x = 2800;
    stepTrap(p, trapSpanAt(2800, 9557), { x: 2801, y: 9557 });
    settle();
  };
  cross();
  cross();
  assert.equal(p.xp, 52);
  cross();
  assert.equal(p.xp, 52, "the third consecutive use is on cooldown");
  for (let i = 0; i < 8; i++) tick();
  cross();
  assert.equal(p.xp, 78);
});

test("spinning blades need 40 Agility, use their own chart and knock a miss back a tile", () => {
  const low = player({ agility: 30, x: 2783, y: 9573 });
  stepTrap(low, trapSpanAt(2783, 9573), { x: 2783, y: 9572 });
  assert.ok(low.messages.some((message) => message.includes("at least 40")));
  assert.equal(low.xp, 0);

  // rsprox 4308 2173-2175: 1114 back to 9572, the message, then the hit.
  const miss = player({ agility: 60, x: 2783, y: 9573 });
  setRandom(() => 0.99);
  stepTrap(miss, trapSpanAt(2783, 9573), { x: 2783, y: 9572 });
  settle();
  assert.equal(miss.hits.length, 1);
  assert.ok(miss.messages.includes("You were hit by the spinning blades!"));
  assert.equal(miss.xp, 0);
  assert.deepEqual([miss.x, miss.y], [2783, 9572]);

  // rsprox 4308 2176-2180: from 9573 over the three blade tiles to 9576.
  const success = player({ agility: 60, x: 2783, y: 9573 });
  setRandom(() => 0);
  stepTrap(success, trapSpanAt(2783, 9573), { x: 2783, y: 9572 });
  settle();
  assert.equal(success.xp, 28);
  assert.deepEqual([success.x, success.y], [2783, 9576]);
});

test("the darts dodge walks the player past the corridor's middle for 30 XP; a hit drains two", () => {
  // rsprox 1735 378-387: stop on 2778,9568 heading west, 1110, then walked to 2776.
  const dodge = player({ agility: 70, x: 2778, y: 9568 });
  setRandom(() => 0);
  stepTrap(dodge, trapSpanAt(2778, 9568), { x: 2779, y: 9568 });
  settle();
  assert.equal(dodge.xp, 30);
  assert.deepEqual([dodge.x, dodge.y], [2776, 9568]);

  // rsprox 1735 2901-2904: knocked back to 2779, then the message, 6 damage and -2 Agility.
  const hit = player({ agility: 70, x: 2778, y: 9568 });
  setRandom(() => 0.99);
  stepTrap(hit, trapSpanAt(2778, 9568), { x: 2779, y: 9568 });
  settle();
  assert.equal(hit.xp, 0);
  assert.equal(hit.hits.length, 1);
  assert.equal(hit.agility, 68);
  assert.ok(hit.messages.includes("You were hit by some darts, something on them makes you feel dizzy!"));
  assert.deepEqual([hit.x, hit.y], [2779, 9568]);
});

test("a trap span goes off once when the area sees the player stop on it", () => {
  const p = player({ agility: 50, x: 2772, y: 9550 });
  const mobile = { isPlayer: () => true, getAsPlayer: () => p };
  processPlayer(mobile);
  p.y = 9551;
  setRandom(() => 0);
  processPlayer(mobile);
  processPlayer(mobile);
  settle();
  assert.equal(p.xp, 24, "one jump over both spike tiles, one payment");
  assert.deepEqual([p.x, p.y], [2772, 9553]);
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

test("the rope swing lands three tiles past the rope in one 5-tile swing, as captured", () => {
  // rsprox capture 1102: from 2806,9587 over the rope at 2806,9585 to 2806,9582.
  const p = player({ x: 2806, y: 9587, z: 3 });
  const rope = { getLocation: () => new Location(2806, 9585, 3), getFace: () => 0 };
  const target = crossingTarget(p, rope, 3, true);
  assert.deepEqual(target, { x: 2806, y: 9582, z: 3 });
  assert.deepEqual(ropeSwingSteps(target), [
    { anim: 751, delay: 5 },
    { objAnim: 497 },
    { sound: 2494, delay: 5 },
    { move: [2806, 9582, 3], speed: [30, 55], ticks: 2 },
  ]);
});

test("a rope swing is walked to two tiles before the rope, not onto the gap under it", () => {
  // rsprox capture 1863: from 2774,9568 the player stops on 2769,9567 for the rope at 2767,9567.
  const rope = { getLocation: () => new Location(2767, 9567, 3), getFace: () => 1 };
  const event = { player: player({ x: 2774, y: 9567, z: 3 }), object: rope, objectId: 3566, clickType: 1, destination: null };
  routeToObstacle(event);
  assert.deepEqual(event.destination, { x: 2769, y: 9567, z: 3 });
});

test("a diagonal rope swing click picks the rope's axis, not the longer offset", () => {
  // The rope at 2806,9585 is cache rotation 0 and swings north-south; from the platform corner
  // 2804,9587 the X offset ties the Y one and used to route onto the blocked 2804,9585.
  const rope = { getLocation: () => new Location(2806, 9585, 3), getFace: () => 0 };
  const event = { player: player({ x: 2804, y: 9587, z: 3 }), object: rope, objectId: 3566, clickType: 1, destination: null };
  routeToObstacle(event);
  assert.deepEqual(event.destination, { x: 2806, y: 9587, z: 3 });
});

test("the trap spans are the cache's tiles; the blades' spans are the path beside them", () => {
  assert.equal(trapAt(2772, 9551), "FLOOR_SPIKES");
  assert.equal(trapAt(2799, 9557), "PRESSURE_PAD");
  assert.equal(trapAt(2783, 9546), null, "a dispenser pillar is not a trap");
  assert.equal(trapAt(2778, 9557), "SPINNING_BLADES");
  assert.equal(trapAt(2777, 9556), null, "the blade loc itself is not walkable");
  assert.equal(trapAt(2794, 9573), "DARTS");
});

test("one click crosses a whole obstacle and pays its XP once, as every capture shows", () => {
  const cases = [
    // [kind, loc, player, approach, landing, source]
    ["BALANCING_ROPE", [2783, 9581], [2783, 9580], [2783, 9580], [2783, 9588], "rsprox 1863 2624"],
    ["LOG_BALANCE", [2794, 9587], [2794, 9588], [2794, 9588], [2794, 9581], "rsprox 1863 2017"],
    ["BALANCING_LEDGE", [2769, 9546], [2772, 9548], [2770, 9546], [2763, 9546], "rsprox 1738 692"],
    ["PLANK", [2802, 9590], [2803, 9590], [2803, 9590], [2796, 9590], "rsprox 1738 113"],
    ["PILLAR", [2805, 9576], [2805, 9577], [2805, 9577], [2805, 9570], "rsprox 75 13517"],
    ["HAND_HOLDS", [2792, 9592], [2794, 9591], [2792, 9592], [2785, 9592], "rsprox 1738 123"],
    ["MONKEY_BARS", [2771, 9570], [2773, 9569], [2772, 9570], [2772, 9578], "rsprox 1735 2638"],
    ["LOW_WALL", [2783, 9562], [2783, 9564], [2783, 9564], [2783, 9561], "rsprox 1735 750"],
  ];
  for (const [kind, [lx, ly], [px, py], approach, landing, source] of cases) {
    const line = lineAt(kind, lx, ly);
    const route = crossing(line, player({ x: px, y: py }));
    assert.deepEqual(route.approach, approach, `${kind} approach (${source})`);
    assert.deepEqual(route.path[route.path.length - 1], landing, `${kind} landing (${source})`);
    assert.ok(crossingSteps(line, route).length > 0);
  }
});
