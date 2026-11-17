// Run after yarn build: node --test tests/soulflame-horn-special.test.cjs
const assert = require("node:assert/strict");
const { before, beforeEach, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { World } = require("../dist/game/World");
const { Location } = require("../dist/game/model/Location");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");

before(() => CachePipeline.initialize(require("node:path").resolve(__dirname, "..")));

const handlers = { roll: [], damage: [], accuracy: [] };
require("../plugins/combat/specials/SoulflameHorn.SpecialAttack")({
  core: PluginManager.getCoreApi(),
  registerCombatSpecial: CombatSpecial.register,
  onCombatHitRoll: (handler) => handlers.roll.push(handler),
  onCombatHitDamage: (handler) => handlers.damage.push(handler),
  onCustomEvent() {},
  registerMeleeAttackAccuracyModifier: (modifier) => handlers.accuracy.push(modifier),
});
const special = CombatSpecial.getById("soulflame_horn");

let cycle = 1000;
beforeEach(() => {
  cycle += 100;
  World.getProcessCycle = () => cycle;
});

const ENCOURAGE = (name) => `<col=3366ff>${name} encourages you with their Soulflame horn, empowering your next melee attack!`;
const USER = "<col=3366ff>You encourage nearby allies, which also empowers your next melee attack!";
const NO_ONE = "<col=ef1020>You blow your horn into the wind. No-one nearby is able to listen.";
const FADE = "<col=3366ff>The Soulflame horn's effect fades away.";

function fakePlayer(name, { x = 3200, y = 3200, z = 0, energy = 100, acceptAid, area = null, privateArea = null } = {}) {
  const calls = { animations: [], graphics: [], messages: [], sounds: [] };
  const attributes = new Map();
  if (acceptAid !== undefined) attributes.set("accept-aid", acceptAid);
  const player = {
    name, calls, energy, activated: false, local: [], location: new Location(x, y, z),
    isPlayer: () => true,
    isNpc: () => false,
    isRegistered: () => true,
    getHitpoints: () => 99,
    getAsPlayer() { return this; },
    getDisplayName() { return this.name; },
    getCombatSpecial: () => special,
    isSpecialActivated() { return this.activated; },
    setSpecialActivated(value) { this.activated = value; },
    getSpecialPercentage() { return this.energy; },
    decrementSpecialPercentage(amount) { this.energy -= amount; },
    isRecoveringSpecialAttack: () => true,
    getDueling: () => ({ inDuel: () => false }),
    getEquipment: () => ({ get: () => ({ getId: () => ItemIdentifiers.SOULFLAME_HORN }) }),
    getWeapon: () => ({ getSpecialBar: () => -1, getSpecialMeter: () => -1 }),
    getPacketSender: () => ({
      updateSpecialAttackOrb() {}, sendSpecialAttackState() {}, sendAreaSound() {},
      sendSoundEffect: (id) => calls.sounds.push(id),
    }),
    getLocation() { return this.location; },
    getLocalPlayers() { return new Map(this.local.map((other, i) => [i, other])); },
    getArea: () => area,
    getPrivateArea: () => privateArea,
    getAttribute: (key) => attributes.get(key) ?? null,
    setAttribute: (key, value) => { attributes.set(key, value); },
    sendMessage: (message) => calls.messages.push(message),
    performAnimation: (animation) => calls.animations.push(animation.getId()),
    performGraphic: (graphic) => calls.graphics.push({ id: graphic.getId(), delay: graphic.delay, height: graphic.height }),
  };
  return player;
}

function party(user, ...others) {
  user.local = others;
  for (const other of others) other.local = [user, ...others.filter((o) => o !== other)];
}

function blow(player) {
  CombatSpecial.activate(player);
}

function roll(attacker, target = { isPlayer: () => false }, combatType = CombatType.MELEE) {
  const event = { attacker, target, combatType, forceAccurate: false, forceMaxHit: false, bypassProtectionPrayer: false };
  for (const handler of handlers.roll) handler(event);
  return event;
}

function tick(n) {
  for (let i = 0; i < n; i++) {
    cycle++;
    TaskManager.process();
  }
}

test("with no one in range the horn costs nothing and sends the captured refusal", () => {
  const user = fakePlayer("Blower");
  party(user, fakePlayer("Far", { x: 3204 }));
  blow(user);
  assert.equal(user.energy, 100);
  assert.deepEqual(user.calls.messages, [NO_ONE]);
  assert.deepEqual(user.calls.animations, [CacheDefinitions.getSeqId("soulflame_horn_blow_03_no_fire")]);
  assert.deepEqual(user.calls.graphics, []);
  assert.equal(roll(user).forceAccurate, false, "the user was not empowered either");
});

test("one ally: 25%, the captured user/ally lines, animation, graphics and sound; both empowered", () => {
  const user = fakePlayer("Blower");
  const ally = fakePlayer("Friend", { x: 3203, y: 3197 });
  party(user, ally);
  blow(user);
  assert.equal(user.energy, 75);
  assert.equal(user.activated, false);
  assert.deepEqual(user.calls.messages, [USER]);
  assert.deepEqual(user.calls.animations, [CacheDefinitions.getSeqId("soulflame_horn_blow_03")]);
  assert.deepEqual(user.calls.graphics, [{ id: CacheDefinitions.getSpotanimId("vfx_soulflame_horn_spotanim01"), delay: 0, height: 100 }]);
  assert.deepEqual(user.calls.sounds, [10236]);
  assert.deepEqual(ally.calls.messages, [ENCOURAGE("Blower")]);
  assert.deepEqual(ally.calls.graphics, [{ id: CacheDefinitions.getSpotanimId("vfx_soulflame_horn_impact_spotanim01"), delay: 30, height: 0 }]);
  assert.deepEqual(ally.calls.sounds, [10236]);
  assert.equal(roll(user).forceAccurate, true);
  assert.equal(roll(ally).forceAccurate, true);
  assert.equal(roll(ally).forceAccurate, false, "spent by the first melee roll");
});

test("25% per ally, at most three, nearest first; energy limits how many", () => {
  const user = fakePlayer("Blower");
  const allies = [3, 1, 2, 0].map((d) => fakePlayer(`A${d}`, { x: 3200 + d }));
  party(user, ...allies);
  blow(user);
  assert.equal(user.energy, 25);
  assert.deepEqual(allies.map((a) => a.calls.messages.length), [0, 1, 1, 1], "the farthest of four is left out");

  const poor = fakePlayer("Poor", { energy: 50 });
  const near = [1, 2, 3].map((d) => fakePlayer(`B${d}`, { y: 3200 + d }));
  party(poor, ...near);
  blow(poor);
  assert.equal(poor.energy, 0);
  assert.deepEqual(near.map((a) => a.calls.messages.length), [1, 1, 0]);
});

test("Accept Aid off (Ironmen) refuses it outside the exempt content, but not inside a raid or boss instance", () => {
  const user = fakePlayer("Blower");
  const iron = fakePlayer("Iron", { x: 3201, acceptAid: false });
  party(user, iron);
  blow(user);
  assert.deepEqual(user.calls.messages, [NO_ONE]);
  assert.equal(user.energy, 100);

  class CoxMap {}
  const raid = new CoxMap();
  const raider = fakePlayer("Raider", { privateArea: raid });
  const ironRaider = fakePlayer("IronRaider", { x: 3201, acceptAid: false, privateArea: raid });
  party(raider, ironRaider);
  blow(raider);
  assert.deepEqual(ironRaider.calls.messages, [ENCOURAGE("Raider")]);
});

test("players in another instance or plane are not reached", () => {
  const user = fakePlayer("Blower");
  const other = fakePlayer("Elsewhere", { x: 3201, privateArea: {} });
  const upstairs = fakePlayer("Upstairs", { z: 1 });
  party(user, other, upstairs);
  blow(user);
  assert.deepEqual(user.calls.messages, [NO_ONE]);
});

test("an unspent effect fades after 10 ticks with the captured line; a spent one says nothing", () => {
  const user = fakePlayer("Blower");
  const ally = fakePlayer("Friend", { x: 3201 });
  party(user, ally);
  blow(user);
  roll(ally);
  tick(9);
  assert.equal(user.calls.messages.includes(FADE), false);
  tick(1);
  assert.equal(user.calls.messages.at(-1), FADE);
  assert.equal(ally.calls.messages.includes(FADE), false);
  assert.equal(roll(user).forceAccurate, false, "faded");
});

test("ranged and magic rolls leave the effect for the next melee attack", () => {
  const user = fakePlayer("Blower");
  party(user, fakePlayer("Friend", { x: 3201 }));
  blow(user);
  assert.equal(roll(user, undefined, CombatType.RANGED).forceAccurate, false);
  assert.equal(roll(user, undefined, CombatType.MAGIC).forceAccurate, false);
  assert.equal(roll(user).forceAccurate, true);
});

test("against a player it is +50% to that roll's attack roll, not a guaranteed hit", () => {
  const user = fakePlayer("Blower");
  party(user, fakePlayer("Friend", { x: 3201 }));
  blow(user);
  const accuracy = (value) => handlers.accuracy.reduce((v, m) => m(user, v), value);
  assert.equal(accuracy(1000), 1000);
  const event = roll(user, fakePlayer("Victim"));
  assert.equal(event.forceAccurate, false);
  assert.equal(accuracy(1000), 1500);
  for (const handler of handlers.damage) handler({ attacker: user });
  assert.equal(accuracy(1000), 1000, "only that roll");
});

test("a press inside the 4-tick cooldown does nothing", () => {
  const user = fakePlayer("Blower");
  const ally = fakePlayer("Friend", { x: 3201 });
  party(user, ally);
  blow(user);
  cycle += 3;
  blow(user);
  assert.equal(user.energy, 75);
  cycle += 1;
  blow(user);
  assert.equal(user.energy, 50);
});

test("every exempt area class name still names an area class in the plugins", () => {
  const { execFileSync } = require("node:child_process");
  const { AID_FREE_AREAS } = require("../plugins/combat/specials/SoulflameHorn.SpecialAttack");
  const plugins = require("node:path").resolve(__dirname, "../plugins");
  for (const name of AID_FREE_AREAS) {
    const found = execFileSync("grep", ["-rlE", `class ${name} extends`, plugins], { encoding: "utf8" }).trim();
    assert.ok(found.length > 0, `${name} is not declared in server/plugins`);
  }
});
