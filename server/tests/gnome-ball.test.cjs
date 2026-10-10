// Run after `yarn build`: node --test tests/gnome-ball.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");

const plugin = require("../plugins/minigames/GnomeBall.plugin");
const Pitch = require("../plugins/minigames/gnomeball/Pitch.GnomeBall");
const Referee = require("../plugins/minigames/gnomeball/Referee.GnomeBall");

const core = PluginManager.getCoreApi();
const REFEREE = core.NpcIdentifiers.GNOME_BALL_REFEREE;
const WEAPON_SLOT = core.Equipment.WEAPON_SLOT;

const events = [];
const registered = [];
const api = {
  core,
  emitCustomEvent: (name, payload) => events.push({ name, payload }),
  persistAttribute: (key) => registered.push({ kind: "persist", key }),
  registerArea: (area) => registered.push({ kind: "area", area }),
  onObjectInteraction: (name, actions) => registered.push({ kind: "object", name, actions }),
  onObjectRoute: (handler) => registered.push({ kind: "objectRoute", handler }),
  onNpcInteraction: (name, actions) => registered.push({ kind: "npc", name, actions }),
  onItemAction: (name, actions) => registered.push({ kind: "itemAction", name, actions }),
  onItemDropPolicy: (handler) => registered.push({ kind: "itemDrop", handler }),
  onPlayerLogout: (handler) => registered.push({ kind: "logout", handler }),
  onPlayerDisconnect: (handler) => registered.push({ kind: "disconnect", handler }),
  onPlayerDeath: (handler) => registered.push({ kind: "death", handler }),
  onPlayerLogin: (handler) => registered.push({ kind: "login", handler }),
  onNpcDialogueVariant: (handler) => registered.push({ kind: "dialogueVariant", handler }),
  onNpcDialogueCondition: (handler) => registered.push({ kind: "dialogueCondition", handler }),
  onCustomEvent: (name, handler) => registered.push({ kind: "customEvent", name, handler }),
  // Delayed steps (the throw, the result) run at once here.
  getTaskManager: () => ({ submit: (task) => task.execute() }),
};

/** Records every packet-sender call; each returns the sender, so chains keep working. */
function recordingSender(calls) {
  const sender = new Proxy({}, {
    get: (_target, name) => (...args) => {
      calls.push([name, ...args]);
      return sender;
    },
  });
  return sender;
}

plugin.register(api);
Pitch._test.setApi(api);

beforeEach(() => {
  Pitch._test.sessions.clear();
  events.length = 0;
  Pitch._test.resetRandom();
});

function fakePlayer({ x = 2390, y = 3488, agility = 1, ranged = 1, items = {}, weapon = -1, freeSlots = 20 } = {}) {
  const attributes = new Map();
  const counts = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  const equipmentItems = new Array(14).fill(null);
  if (weapon >= 0) equipmentItems[WEAPON_SLOT] = new core.Item(weapon, 1);
  const messages = [];
  const hits = [];
  const stuns = [];
  const cancels = [];
  const xp = { RANGED: 0, AGILITY: 0 };
  const inventory = {
    counts,
    getAmount: (id) => counts.get(id) ?? 0,
    contains: (id) => inventory.getAmount(id) > 0,
    deleteNumber: (id, amount) => counts.set(id, inventory.getAmount(id) - amount),
    addItem: (item) => {
      counts.set(item.getId(), inventory.getAmount(item.getId()) + item.getAmount());
      return inventory;
    },
    adds(id, amount) {
      return inventory.addItem(new core.Item(id, amount));
    },
    getFreeSlots: () => freeSlots,
  };
  const equipment = {
    items: equipmentItems,
    getItems: () => equipment.items,
    getSlot: (slot) => equipment.items[slot]?.getId?.() ?? -1,
    setItem: (slot, item) => {
      equipment.items[slot] = item?.getId?.() >= 0 ? item : null;
    },
    refreshItems: () => equipment,
  };
  const skills = {
    levels: { RANGED: ranged, AGILITY: agility },
    getCurrentLevel: (skill) =>
      skill === core.Skill.RANGED ? skills.levels.RANGED : skill === core.Skill.AGILITY ? skills.levels.AGILITY : 1,
    addExperiences: (skill, amount) => {
      if (skill === core.Skill.RANGED) xp.RANGED += amount;
      else if (skill === core.Skill.AGILITY) xp.AGILITY += amount;
    },
  };
  const timers = {
    registers: (key, ticks) => stuns.push({ key, ticks }),
    cancel: (key) => cancels.push(key),
    has: () => false,
  };
  const packets = [];
  const animations = [];
  const sender = recordingSender(packets);
  const p = {
    messages,
    hits,
    stuns,
    cancels,
    xp,
    packets,
    animations,
    getPacketSender: () => sender,
    setPositionToFace: () => {},
    location: new core.Location(x, y, 0),
    getLocation: () => p.location,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => equipment,
    getSkillManager: () => skills,
    getTimers: () => timers,
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (damage) => hits.push(...damage) }) }),
    getUpdateFlag: () => ({ flag: () => {} }),
    sendMessage: (message) => messages.push(message),
    performAnimation: (animation) => animations.push(animation.getId()),
  };
  return p;
}

function playerMobile(player) {
  return {
    isPlayer: () => true,
    isNpc: () => false,
    getIndex: () => 9001,
    getAsPlayer: () => player,
    getLocation: () => player.getLocation(),
    getArea: () => null,
  };
}

let npcIndex = 0;
function baller(x, y) {
  const npc = {
    animations: [],
    stuns: [],
    getLocation: () => new core.Location(x, y, 0),
    getDefinition: () => ({ getName: () => Pitch.BALLER_NAME }),
    getHitpoints: () => 10,
    performAnimation: (animation) => npc.animations.push(animation),
    setPositionToFace: () => {},
    // Knocked down while a stun is registered (the fake never expires it).
    getTimers: () => ({ registers: (key, ticks) => npc.stuns.push({ key, ticks }), has: () => npc.stuns.length > 0 }),
  };
  const mobile = {
    isPlayer: () => false,
    isNpc: () => true,
    getIndex: () => ++npcIndex,
    getAsNpc: () => npc,
    getLocation: () => npc.getLocation(),
    getArea: () => null,
  };
  return { mobile, npc };
}

const shootEvent = (player, x = 2404, y = 3488) => ({ player, location: { x, y, z: 0 } });

test("the plugin declares itself members content and wires the pitch hooks", () => {
  assert.equal(plugin.name, "GnomeBall");
  assert.equal(plugin.members, true);
  assert.ok(registered.some((entry) => entry.kind === "area"));
  assert.ok(registered.some((entry) => entry.kind === "object" && entry.name === "Gnome goal"));
  assert.ok(registered.some((entry) => entry.kind === "objectRoute"));
  assert.ok(registered.some((entry) => entry.kind === "npc" && entry.name === "Gnome baller"));
  assert.ok(registered.some((entry) => entry.kind === "itemAction" && entry.name === "Gnomeball"));
  assert.ok(registered.some((entry) => entry.kind === "itemDrop"));
  assert.ok(registered.some((entry) => entry.kind === "death"));
});

test("shoot chance follows the wiki curve and is capped at 1", () => {
  const { shotChance } = Pitch._test;
  assert.equal(shotChance(1, 99), 1);
  assert.ok(Math.abs(shotChance(11, 1) - 26 / 256) < 1e-12);
  assert.ok(Math.abs(shotChance(11, 99) - 245 / 256) < 1e-12);
  assert.equal(shotChance(30, 1), shotChance(11, 1), "distance clamps at 11");
});

test("tackle chance lerps 31/256 to 201/256, or 221/256 against a ball carrier", () => {
  const { tackleChance } = Pitch._test;
  assert.equal(tackleChance(1), 31 / 256);
  assert.equal(tackleChance(99), 201 / 256);
  assert.equal(tackleChance(99, true), 221 / 256);
  assert.ok(Math.abs(tackleChance(50) - (31 / 256 + (201 / 256 - 31 / 256) * (49 / 98))) < 1e-12);
});

test("baller tackle chance is the low chosen default, falling with agility", () => {
  const { ballerTackleChance } = Pitch._test;
  assert.ok(Math.abs(ballerTackleChance(1) - 0.12) < 1e-12);
  assert.ok(Math.abs(ballerTackleChance(99) - 0.02) < 1e-12);
  assert.ok(Math.abs(ballerTackleChance(50) - (0.12 + (0.02 - 0.12) * (49 / 98))) < 1e-12);
});

test("a clicked Shoot is not pre-empted: ballers pause and the adjacent shot still scores", () => {
  const p = fakePlayer();
  Pitch.beginGame(p);
  const area = Pitch._test.createPitch();
  const target = baller(2390, 3488);
  area.enter(target.mobile);
  const mobile = playerMobile(p);
  area.enter(mobile);
  const goal = { getName: () => "Gnome goal", getInteractions: () => ["Shoot"] };
  Pitch._test.routeShot({ player: p, definition: goal, clickType: 1 });
  Pitch._test.setRandom(() => 0); // a tackle would otherwise fire on the next check
  for (let tick = 0; tick < 3; tick++) area.process(mobile);
  assert.equal(p.hits.length, 0, "the tackle wait covers the shot");
  assert.equal(p.getEquipment().getSlot(WEAPON_SLOT), Pitch.GNOMEBALL);
  Pitch._test.shootGoal(shootEvent(p));
  assert.equal(p.xp.RANGED, 4, "the shot resolves while a baller is adjacent");
  assert.equal(p.cancels.length, 1, "a stun cannot swallow the throw");
});

test("starting a game unequips the weapon, equips the ball, and never doubles up", () => {
  const p = fakePlayer({ weapon: 4151 });
  assert.equal(Pitch.beginGame(p), true);
  assert.equal(p.getEquipment().getSlot(WEAPON_SLOT), Pitch.GNOMEBALL);
  assert.equal(p.getInventory().getAmount(4151), 1, "weapon moved to the inventory");
  assert.equal(Pitch.beginGame(p), false, "a player cannot carry two balls");
  assert.ok(p.messages.some((message) => message.includes("already have a ball")));
});

test("a goal pays 4 XP in both skills exactly once and consumes the ball", () => {
  const p = fakePlayer({ items: { [Pitch.GNOMEBALL]: 1 } });
  assert.equal(Pitch.beginGame(p), true);
  assert.equal(p.getInventory().getAmount(Pitch.GNOMEBALL), 0, "the player's own ball waits with the ref");
  Pitch._test.setRandom(() => 0);
  Pitch._test.shootGoal(shootEvent(p));
  assert.equal(p.xp.RANGED, 4);
  assert.equal(p.xp.AGILITY, 4);
  assert.equal(Pitch._test.sessions.get(p).goals, 1);
  assert.equal(Pitch.isCarrying(p), false, "the ball is consumed by the shot");
  assert.ok(events.some((event) => event.name === "diary:task" && event.payload.task === "score-a-goal-in-a-gnomeball-match"));
});

test("five goals pay 4/5/6/7/30 and reset the score with a win", () => {
  const p = fakePlayer();
  Pitch._test.setRandom(() => 0);
  const perGoal = [];
  let previous = 0;
  for (let goal = 0; goal < 5; goal++) {
    assert.equal(Pitch.beginGame(p), true);
    Pitch._test.shootGoal(shootEvent(p));
    perGoal.push(p.xp.RANGED - previous);
    previous = p.xp.RANGED;
  }
  assert.deepEqual(perGoal, [4, 5, 6, 7, 30]);
  assert.equal(p.xp.AGILITY, 52);
  const session = Pitch._test.sessions.get(p);
  assert.equal(session.goals, 0, "the score resets on the fifth goal");
  assert.equal(session.won, true);
});

test("a miss consumes the ball and pays nothing; shooting without a ball does nothing", () => {
  const p = fakePlayer({ ranged: 1 });
  Pitch.beginGame(p);
  Pitch._test.setRandom(() => 0.999);
  Pitch._test.shootGoal(shootEvent(p, 2404, 3488));
  assert.equal(p.xp.RANGED, 0);
  assert.equal(p.xp.AGILITY, 0);
  assert.equal(Pitch._test.sessions.get(p).goals, 0);
  assert.equal(p.getEquipment().getSlot(WEAPON_SLOT), -1);
  assert.deepEqual(p.messages, ["You throw the ball at the goal...", "... and miss."]);
  assert.deepEqual(p.animations, [783], "the captured throw");
  assert.ok(p.packets.some(([name, , , , , projectile]) => name === "sendProjectile" && projectile === 55));
  Pitch._test.shootGoal(shootEvent(p));
  assert.equal(p.messages.at(-1), "You need a ball in your hand to throw.");
});

test("a tackle knocks the baller down or is dodged, with the captured animations", () => {
  const p = fakePlayer();
  const target = baller(2390, 3488);
  Pitch._test.setRandom(() => 0.999);
  Pitch._test.tackleBaller({ player: p, npc: target.npc });
  assert.equal(target.npc.stuns.length, 0, "a failed tackle knocks nobody down");
  assert.deepEqual(p.animations, [780]);
  assert.deepEqual(target.npc.animations.map((animation) => animation.getId()), [204]);

  Pitch._test.setRandom(() => 0);
  Pitch._test.tackleBaller({ player: p, npc: target.npc });
  assert.equal(target.npc.stuns.length, 1);
  assert.equal(target.npc.stuns[0].ticks, 5);
  assert.deepEqual(p.animations, [780, 778]);
  assert.deepEqual(target.npc.animations.map((animation) => animation.getId()), [204, 203]);
  assert.equal(p.xp.RANGED, 0);
  assert.equal(p.xp.AGILITY, 0);
  assert.deepEqual(p.messages, [], "no message either way");

  Pitch._test.tackleBaller({ player: p, npc: target.npc });
  assert.deepEqual(p.messages, ["That gnome is being tackled."]);
  assert.equal(target.npc.stuns.length, 1);
});

test("an adjacent baller tackles the carrier every third tick for 1 damage", () => {
  const p = fakePlayer();
  Pitch.beginGame(p);
  const area = Pitch._test.createPitch();
  const target = baller(2390, 3488);
  area.enter(target.mobile);
  const mobile = playerMobile(p);
  area.enter(mobile);
  Pitch._test.setRandom(() => 0);
  area.process(mobile);
  area.process(mobile);
  assert.equal(p.hits.length, 0, "the roll is periodic, not every tick");
  assert.equal(p.getEquipment().getSlot(WEAPON_SLOT), Pitch.GNOMEBALL);
  area.process(mobile);
  assert.equal(p.hits.length, 1);
  assert.equal(p.hits[0].getDamage(), 1);
  assert.equal(Pitch.isCarrying(p), false, "the carrier loses the ball");
  assert.ok(Pitch.isPlaying(p), "the session stays open for a new ball");
  assert.ok(p.stuns.length >= 1, "the carrier is knocked down");
  assert.ok(p.animations.includes(779), "the carrier falls");
});

test("leaving the pitch removes the carried ball and only a won game pays out", () => {
  const p = fakePlayer();
  const area = Pitch._test.createPitch();
  const mobile = playerMobile(p);
  Pitch.beginGame(p);
  area.enter(mobile);
  area.leave(mobile, false);
  assert.equal(p.getEquipment().getSlot(WEAPON_SLOT), -1);
  assert.equal(p.getInventory().getAmount(Pitch.GNOMEBALL), 0);
  assert.equal(Pitch.isPlaying(p), false);

  Pitch.beginGame(p);
  Pitch._test.sessions.get(p).won = true;
  area.enter(mobile);
  area.leave(mobile, false);
  assert.equal(p.getInventory().getAmount(Pitch.GNOMEBALL), 1, "the win hands out a ball");
});

test("leaving after a win with an own ball returns the own ball instead of a reward", () => {
  const p = fakePlayer({ items: { [Pitch.GNOMEBALL]: 1 } });
  const area = Pitch._test.createPitch();
  const mobile = playerMobile(p);
  Pitch.beginGame(p);
  Pitch._test.sessions.get(p).won = true;
  area.enter(mobile);
  area.leave(mobile, false);
  assert.equal(p.getInventory().getAmount(Pitch.GNOMEBALL), 1);
});

test("a dropped gnomeball returns to the ref with no ground item", () => {
  const p = fakePlayer({ items: { [Pitch.GNOMEBALL]: 2 } });
  const event = { player: p, itemId: Pitch.GNOMEBALL, item: new core.Item(Pitch.GNOMEBALL, 1), handled: false, dropToGround: true };
  Pitch._test.dropPolicy(event);
  assert.equal(event.handled, true);
  assert.equal(event.dropToGround, false);
  assert.equal(p.getInventory().getAmount(Pitch.GNOMEBALL), 1);
  assert.ok(p.messages.includes(Pitch.BALL_RETURNS_MESSAGE));
  assert.equal(Pitch._test.dropBall({ player: p, itemId: 752 }), false, "notes drop normally");
});

test("death clears the session and the carried ball", () => {
  const p = fakePlayer();
  Pitch.beginGame(p);
  Pitch._test.endOnDeath({ player: p });
  assert.equal(Pitch.isPlaying(p), false);
  assert.equal(p.getEquipment().getSlot(WEAPON_SLOT), -1);
});

test("the referee picks the transcript variant from the ball state", () => {
  const p = fakePlayer();
  assert.equal(Referee._test.selectVariant({ player: p, npcId: REFEREE }), Referee.variants.FIRST_TALK);
  assert.equal(Referee._test.selectVariant({ player: p, npcId: REFEREE }), null, "the default takes over");
  Pitch.beginGame(p);
  assert.equal(Referee._test.selectVariant({ player: p, npcId: REFEREE }), Referee.variants.WITH_BALL);
  Pitch._test.endSession(p);
  Pitch._test.sessions.set(p, { goals: 1, won: false, ownBall: true, ticks: 0 });
  assert.equal(Referee._test.selectVariant({ player: p, npcId: REFEREE }), Referee.variants.OUT_OF_PLAY);
});

test("the referee's conditions and hand-outs follow the transcript", () => {
  const p = fakePlayer({ items: { [Pitch.GNOMEBALL]: 1 } });
  assert.equal(
    Referee._test.answerCondition({ player: p, npcId: REFEREE, text: "If the player has a gnomeball in their inventory:" }),
    true
  );
  assert.equal(Referee._test.answerCondition({ player: fakePlayer(), npcId: REFEREE, text: "If the player has a gnomeball in their inventory:" }), false);
  const receive = { player: p, npcId: REFEREE, action: "receive", handled: false };
  Referee._test.handleAction(receive);
  assert.equal(receive.handled, true);
  assert.equal(p.getEquipment().getSlot(WEAPON_SLOT), Pitch.GNOMEBALL);
  assert.equal(p.getInventory().getAmount(Pitch.GNOMEBALL), 0, "the own ball is held by the ref");

  const outOfPlay = fakePlayer();
  Pitch._test.sessions.set(outOfPlay, { goals: 0, won: false, ownBall: false, ticks: 0 });
  Referee._test.handleLine({ player: outOfPlay, npcId: REFEREE, text: "Have a new ball!" });
  assert.equal(outOfPlay.getEquipment().getSlot(WEAPON_SLOT), Pitch.GNOMEBALL);
});

test("entering the pitch moves the weapon and shield to the pack and opens the HUD", () => {
  const SHIELD_SLOT = core.Equipment.SHIELD_SLOT;
  const p = fakePlayer({ weapon: 1277 });
  p.getEquipment().items[SHIELD_SLOT] = new core.Item(1171, 1);
  const area = Pitch._test.createPitch();
  const mobile = playerMobile(p);
  area.enter(mobile);
  assert.equal(p.getEquipment().getSlot(WEAPON_SLOT), -1);
  assert.equal(p.getEquipment().getSlot(SHIELD_SLOT), -1);
  assert.equal(p.getInventory().getAmount(1277), 1);
  assert.equal(p.getInventory().getAmount(1171), 1);
  assert.ok(p.packets.some(([name, , group]) => name === "sendSubInterface" && group === 139));
  area.leave(mobile, false);
  assert.ok(p.packets.some(([name]) => name === "closeSubInterface"));
});
