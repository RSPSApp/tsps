// Run after yarn build: node --test tests/noxious-halberd-special.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { World } = require("../dist/game/World");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");

before(() => CachePipeline.initialize(require("node:path").resolve(__dirname, "..")));

const handlers = {};
require("../plugins/combat/specials/NoxiousHalberd.SpecialAttack")({
  core: PluginManager.getCoreApi(),
  registerCombatSpecial: CombatSpecial.register,
  onCustomEvent: (name, handler) => { handlers[name] = handler; },
});
const special = CombatSpecial.getById("noxious_halberd");

function fakePlayer({ poison = 0, venomed = false, weaponId = ItemIdentifiers.NOXIOUS_HALBERD, energy = 100 } = {}) {
  const calls = { animations: [], graphics: [], messages: [] };
  const attributes = new Map();
  const player = {
    calls, energy, poison, venomed, weaponId, activated: false,
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getCombatSpecial: () => special,
    isSpecialActivated() { return this.activated; },
    setSpecialActivated(value) { this.activated = value; },
    getSpecialPercentage() { return this.energy; },
    decrementSpecialPercentage(amount) { this.energy -= amount; },
    isRecoveringSpecialAttack: () => true,
    getDueling: () => ({ inDuel: () => false }),
    getEquipment() { return { get: () => ({ getId: () => this.weaponId }) }; },
    getWeapon: () => ({ getSpecialBar: () => -1, getSpecialMeter: () => -1 }),
    getPacketSender: () => ({ updateSpecialAttackOrb() {}, sendSpecialAttackState() {}, sendAreaSound() {} }),
    getLocation: () => ({ getX: () => 3200, getY: () => 3200, getZ: () => 0 }),
    getPoisonDamage() { return this.poison; },
    setPoisonDamage(value) { this.poison = value; },
    isPoisoned() { return this.poison > 0; },
    isVenomed() { return this.venomed && this.poison > 0; },
    setVenomed(value) { this.venomed = value; },
    getAttribute: (key) => attributes.get(key) ?? null,
    setAttribute: (key, value) => { attributes.set(key, value); },
    sendMessage: (message) => calls.messages.push(message),
    performAnimation: (animation) => calls.animations.push(animation),
    performGraphic: (graphic) => calls.graphics.push(graphic),
  };
  return player;
}

function activate(player) {
  const getPlayers = World.getPlayers;
  World.getPlayers = () => [player];
  try {
    CombatSpecial.activate(player);
  } finally {
    World.getPlayers = getPlayers;
  }
}

/** The next accurate hit: core rolls `damage` within 0..maximum, then emits combat:hit-rolled. */
function rollHit(player, damage, maximum = 30) {
  const event = { attacker: player, target: {}, combatType: CombatType.MELEE, damage, minimum: 0, maximum };
  handlers["combat:hit-rolled"](event);
  return event.damage;
}

test("Virulence refuses with the live message, and costs nothing, when not poisoned", () => {
  const player = fakePlayer();
  activate(player);
  assert.deepEqual(player.calls.messages, ["You can only use this special attack whilst you are poisoned."]);
  assert.equal(player.energy, 100);
  assert.equal(player.calls.animations.length, 0);
  assert.equal(rollHit(player, 0), 0, "no bonus was stored");
});

test("Virulence cures poison, plays the captured animation and graphic, and costs 50%", () => {
  const player = fakePlayer({ poison: 54 });
  activate(player);
  assert.equal(player.poison, 0);
  assert.equal(player.energy, 50);
  assert.equal(player.activated, false);
  assert.equal(player.calls.animations[0].getId(), CacheDefinitions.getSeqId("human_halberd_virulence_02"));
  assert.equal(player.calls.graphics[0].getId(), CacheDefinitions.getSpotanimId("vfx_noxious_halberd_spec"));
});

test("the next accurate hit rolls at least the cured poison damage, once", () => {
  const player = fakePlayer({ poison: 54 }); // severity 54 would hit for 11
  activate(player);
  assert.equal(rollHit(player, 3), 11);
  assert.equal(rollHit(player, 3), 3, "the bonus is spent by that hit");
});

test("a roll above the cured damage is kept, and the bonus is still spent", () => {
  const player = fakePlayer({ poison: 20 }); // 4 damage
  activate(player);
  assert.equal(rollHit(player, 9), 9);
  assert.equal(rollHit(player, 1), 1);
});

test("envenomed damage is the stored value, and venom is cured too", () => {
  const player = fakePlayer({ poison: 16, venomed: true });
  activate(player);
  assert.equal(player.isVenomed(), false);
  assert.equal(player.poison, 0);
  assert.equal(rollHit(player, 2), 16);
});

test("the floor never exceeds the hit's maximum", () => {
  const player = fakePlayer({ poison: 20, venomed: true });
  activate(player);
  assert.equal(rollHit(player, 4, 12), 12);
});

test("only the wielder's melee hits spend the bonus; a weapon change loses it", () => {
  const player = fakePlayer({ poison: 54 });
  activate(player);
  const other = fakePlayer();
  assert.equal(rollHit(other, 1), 1);
  const ranged = { attacker: player, combatType: CombatType.RANGED, damage: 2, minimum: 0, maximum: 30 };
  handlers["combat:hit-rolled"](ranged);
  assert.equal(ranged.damage, 2);
  player.weaponId = ItemIdentifiers.ABYSSAL_WHIP;
  handlers["equipment:changed"]({ player });
  player.weaponId = ItemIdentifiers.NOXIOUS_HALBERD;
  assert.equal(rollHit(player, 2), 2, "swapping away and back does not restore it");
});
