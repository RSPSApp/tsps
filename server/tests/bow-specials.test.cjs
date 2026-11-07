// Run after `yarn build`: node --test tests/bow-specials.test.cjs
// Magic shortbow Snapshot, Dark bow Descent and Ballista Concentrated Shot.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { Ammunition, RangedWeapon } = require("../dist/game/content/combat/ranged/RangedData");
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");

// Real core, with the pieces that touch a live world replaced by recorders.
const drains = [];
const projectiles = [];
let rolledBounds = [];
let sourceMax = 0;
const hitDamageHandlers = [];
const customHandlers = new Map();
const synthSounds = [], areaSounds = [];
const core = {
  ...PluginManager.getCoreApi(),
  CombatSpecial: Object.assign(Object.create(CombatSpecial), { drain: (_, amount) => drains.push(amount) }),
  CombatFactory: {
    checkAmmo: () => true,
    decrementAmmo: () => {},
    // Stands in for the roll: always the top of the bounds.
    getHitDamage: (_a, _t, _type, _bypass, bounds) => {
      rolledBounds.push(bounds);
      return new HitDamage(bounds.maximumBonus, HitMask.RED);
    },
  },
  DamageFormulas: { sourceMaxHit: () => sourceMax },
  PluginManager: { modifyRangedMaxHit: (_a, _t, maxHit) => maxHit },
  Projectile: { ticksToLand: (cycles) => Math.max(1, Math.ceil(cycles / 30)), createProjectile: (...args) => {
    const shot = { args };
    projectiles.push(shot);
    return {
      withAngle(angle) { shot.angle = angle; return this; },
      withProgress(progress) { shot.progress = progress; return this; },
      sendProjectile() {},
    };
  } },
  Sounds: {
    sendSound(entity,sound) { synthSounds.push({entity,id:sound.getId(),delay:sound.getDelay()}); },
    playAreaSound(options) { areaSounds.push({...options}); },
    playAreaSoundAt(entity,sound,radius) { const at=entity.getLocation(); areaSounds.push({ source:entity,soundId:sound.getId(),delay:sound.getDelay(),radius,x:at.getX?.(),y:at.getY?.(),level:at.getZ?.() }); },
  },
};
const api = {
  core,
  registerCombatSpecial: CombatSpecial.register,
  onCombatHitDamage: (handler) => hitDamageHandlers.push(handler),
  onCustomEvent: (name,handler) => customHandlers.set(name,handler),
};
require("../plugins/combat/specials/MagicShortbow.SpecialAttack")(api);
require("../plugins/combat/specials/DarkBow.SpecialAttack")(api);
require("../plugins/combat/specials/Ballista.SpecialAttack")(api);
require("../plugins/combat/specials/WebweaverBow.SpecialAttack")(api);

function fakePlayer({ weapon, ammo = Ammunition.RUNE_ARROW, rangedWeapon, special, ammoStrength = 0, rangedLevel = 99, activated = true }) {
  const state = { activated, special: CombatSpecial.getById(special), animations: 0, slotGraphics: [] };
  const player = {
    isPlayer: () => true,
    getAsPlayer: () => player,
    isSpecialActivated: () => state.activated,
    getCombatSpecial: () => state.special,
    getCombat: () => ({ getAmmunition: () => ammo, getRangedWeapon: () => rangedWeapon }),
    getWeapon: () => rangedWeapon === RangedWeapon.BALLISTA ? WeaponInterfaces.BALLISTA : WeaponInterfaces.SHORTBOW,
    getEquipment: () => ({
      getItems: () => {
        const items = new Array(14).fill(null).map(() => ({ getId: () => 0 }));
        items[Equipment.WEAPON_SLOT] = { getId: () => weapon };
        return items;
      },
      get: (slot) => slot === Equipment.WEAPON_SLOT
        ? { getId: () => weapon }
        : { getId: () => 0, getDefinition: () => ({ getBonuses: () => ({ 11: ammoStrength }) }) },
    }),
    getSkillManager: () => ({ getCurrentLevel: () => rangedLevel }),
    getLocation: () => new core.Location(3200, 3200, 0),
    performAnimation: () => { state.animations++; },
    performGraphic: () => {},
    performGraphicInSlot: (slot, graphic) => state.slotGraphics.push({ slot, graphic }),
    state,
  };
  return player;
}

const target = { getLocation: () => new core.Location(3201, 3200, 0), performGraphic: () => {}, isNpc: () => true };

function shoot(attacker, accurate, startingDamage = 0) {
  rolledBounds = [];
  const damage = new HitDamage(startingDamage, HitMask.BLUE);
  const event = { attacker, target, combatType: 1, hit: {}, damage, accurate };
  for (const handler of hitDamageHandlers) handler(event);
  return { damage: damage.getDamage(), bounds: rolledBounds };
}

test("each special is registered for every wieldable variant", () => {
  for (const id of [I.MAGIC_SHORTBOW, I.MAGIC_SHORTBOW_I_, I.MAGIC_SHORTBOW_3]) {
    assert.equal(CombatSpecial.getForWeaponId(id).getId(), "magic_shortbow");
  }
  for (const id of [I.DARK_BOW, I.DARK_BOW_3, I.DARK_BOW_4, I.DARK_BOW_5, I.DARK_BOW_6, I.DARK_BOW_7, I.DARK_BOW_BH_, I.CORRUPTED_DARK_BOW, I.DARK_BOW_DEADMAN_]) {
    assert.equal(CombatSpecial.getForWeaponId(id).getId(), "dark_bow", `special for ${id}`);
    assert.equal(RangedWeapon.rangedWeapons.get(id), RangedWeapon.DARK_BOW, `painted bows fire as the dark bow: ${id}`);
  }
  for (const id of [I.LIGHT_BALLISTA, I.HEAVY_BALLISTA, I.LIGHT_BALLISTA_4, I.HEAVY_BALLISTA_OR_]) {
    assert.equal(CombatSpecial.getForWeaponId(id).getId(), "ballista", `special for ${id}`);
    assert.equal(RangedWeapon.rangedWeapons.get(id), RangedWeapon.BALLISTA, `ballista fires javelins: ${id}`);
  }
});

test("Snapshot costs 55%, or 50% on the imbued bow, drained once per shot", () => {
  const snapshot = CombatSpecial.getById("magic_shortbow");
  assert.equal(snapshot.getDrainAmountForWeaponId(I.MAGIC_SHORTBOW), 55);
  assert.equal(snapshot.getDrainAmountForWeaponId(I.MAGIC_SHORTBOW_I_), 50);
  assert.equal(snapshot.getTraits().hitCount, 1, "each PendingHit rolls one arrow");
  assert.ok(Math.abs(snapshot.getAccuracyMultiplier() - 10 / 7) < 1e-9);
  for (const [weapon, cost] of [[I.MAGIC_SHORTBOW, 55], [I.MAGIC_SHORTBOW_I_, 50]]) {
    drains.length = 0;
    const attacker = fakePlayer({ weapon, rangedWeapon: RangedWeapon.MAGIC_SHORTBOW, special: "magic_shortbow" });
    const method = snapshot.getCombatMethod();
    assert.equal(method.canAttack(attacker, target), true);
    assert.deepEqual(drains, [], "checking the attack drains nothing");
    method.start(attacker, target);
    assert.deepEqual(drains, [cost]);
  }
});

test("Snapshot cannot fire from another bow and drains nothing", () => {
  drains.length = 0;
  const attacker = fakePlayer({ weapon: I.MAGIC_SHORTBOW, rangedWeapon: RangedWeapon.RUNE_CROSSBOW ?? null, special: "magic_shortbow" });
  assert.equal(CombatSpecial.getById("magic_shortbow").getCombatMethod().canAttack(attacker, target), false);
  assert.deepEqual(drains, []);
});

test("Snapshot uses its delayed slot-1 graphic and the two captured trajectories", () => {
  const { Location } = core;
  const { PacketSender } = require("../dist/net/packet/PacketSender");
  for (const distance of [1, 2, 4, 7, 9]) {
    projectiles.length = 0;
    const attacker = fakePlayer({ weapon: I.MAGIC_SHORTBOW_I_, rangedWeapon: RangedWeapon.MAGIC_SHORTBOW, special: "magic_shortbow" });
    attacker.getLocation = () => new Location(3200, 3200, 0);
    const victim = { getLocation: () => new Location(3200 + distance, 3200, 0) };
    CombatSpecial.getById("magic_shortbow").getCombatMethod().start(attacker, victim);
    assert.deepEqual(attacker.state.slotGraphics.map(({ slot, graphic }) => [slot, graphic.getId(), graphic.getDelay(), graphic.getHeight()]), [[1, 256, 30, 92]], "RSProx 412 ticks 92/99");
    assert.deepEqual(projectiles.map(({ args, angle, progress }) => [args[2], args[3], args[4], args[5] * 4, args[6] * 4, angle, progress]), [
      [249, 20, 30 + 3 * distance, 163, 146, 15, 11],
      [249, 50, 50 + 3 * distance, 163, 146, 15, 11],
    ], "RSProx 412 d1/d2 and 4008 d2/d4");
    const sent = [];
    const sender = new PacketSender({ getSession: () => ({ sendClientPacket: (packet) => { sent.push(packet); return true; } }) });
    for (const { args, angle, progress } of projectiles) {
      sender.sendProjectile(attacker.getLocation(), victim.getLocation(), 0, args[4], args[2], args[5], args[6], null, args[3], angle, progress);
    }
    assert.equal(sent.length, 2);
    for (let i = 0; i < sent.length; i++) {
      const packet = sent[i].subarray(sent[i].length - 29);
      assert.equal(packet.readUInt16BE(7), 163, "serialized source height");
      assert.equal(packet.readUInt16BE(14), 146, "serialized target height");
      assert.equal(packet[16], 15, "serialized angle");
      assert.equal(packet.readUInt16BE(17), 11, "serialized progress");
      assert.equal(packet.readUInt16BE(19), i === 0 ? 20 : 50, "serialized launch cycle");
      assert.equal(packet.readUInt16BE(21), (i === 0 ? 30 : 50) + 3 * distance, "serialized landing cycle");
    }
  }
});

test("Snapshot hits land with each projectile for NPC and player targets", (t) => {
  const { PendingHit, CombatFactory, Location } = PluginManager.getCoreApi();
  const { World } = require("../dist/game/World");
  t.mock.method(PendingHit.prototype, "prepareHits", () => []);
  t.mock.method(PluginManager, "emitPlayerDealtDamage", () => {});
  t.mock.method(CombatFactory, "rewardExp", () => {});
  t.mock.method(CombatFactory, "handleSkull", () => {});
  t.mock.method(World, "getProcessCycle", () => 100);
  for (const npc of [true, false]) {
    for (let distance = 1; distance <= 9; distance++) {
      const attacker = fakePlayer({ weapon: I.MAGIC_SHORTBOW, special: "magic_shortbow" });
      attacker.getLocation = () => new Location(3200, 3200, 0);
      const due = [];
      const victim = {
        getLocation: () => new Location(3200 + distance, 3200, 0),
        isNpc: () => npc,
        isPlayer: () => !npc,
        getAsPlayer: () => victim,
        getHitpoints: () => 99,
        isUntargetable: () => false,
        isNeedsPlacement: () => false,
        getCombat: () => ({ getHitQueue: () => ({ addPendingHit: (_hit, cycle) => due.push(cycle - 100) }) }),
      };
      const hits = CombatSpecial.getById("magic_shortbow").getCombatMethod().hits(attacker, victim);
      for (const hit of hits) CombatFactory.addPendingHit(hit);
      assert.deepEqual(due, [Math.ceil((30 + 3 * distance) / 30), Math.ceil((50 + 3 * distance) / 30)]);
      if (npc && distance <= 2) assert.deepEqual(due, [2, 2], "both dummy hits at +2 ticks in RSProx 412");
    }
  }
});

test("Snapshot's max hit counts only the visible Ranged level and the arrow's strength", () => {
  sourceMax = 40; // gear, prayers and Void would give this - Snapshot ignores it
  const attacker = fakePlayer({ weapon: I.MAGIC_SHORTBOW, special: "magic_shortbow", ammoStrength: 49 });
  // floor(0.5 + (99 + 10) * (49 + 64) / 640) = 19
  const hit = shoot(attacker, true);
  assert.equal(hit.bounds.length, 1);
  assert.equal(hit.bounds[0].maximumBonus, 19);
  assert.equal(hit.damage, 19);
  assert.equal(shoot(fakePlayer({ weapon: I.MAGIC_SHORTBOW, special: "magic_shortbow", ammoStrength: 49, rangedLevel: 70 }), true).damage, Math.floor(0.5 + (80 * 113) / 640));
  assert.equal(shoot(attacker, false, 0).damage, 0, "a missed arrow stays a miss");
});

test("Snapshot's roll applies only while the special is switched on", () => {
  const attacker = fakePlayer({ weapon: I.MAGIC_SHORTBOW, special: "magic_shortbow", ammoStrength: 49, activated: false });
  const hit = shoot(attacker, true, 7);
  assert.equal(hit.bounds.length, 0);
  assert.equal(hit.damage, 7);
});

test("Descent of Dragons: dragon arrows hit up to 1.5x, at least 8, at most 48", () => {
  const attacker = fakePlayer({ weapon: I.DARK_BOW, ammo: Ammunition.DRAGON_ARROW, special: "dark_bow" });
  sourceMax = 20;
  assert.equal(shoot(attacker, true).damage, 30);
  assert.deepEqual(rolledBounds[0].minimumBonus, 0);
  sourceMax = 40; // 1.5x would be 60
  assert.equal(shoot(attacker, true).damage, 48);
  sourceMax = 3; // a tiny max hit still gets the minimum
  const small = shoot(attacker, true);
  assert.equal(small.bounds[0].minimumBonus, 0);
  assert.equal(small.damage, 8);
});

test("Descent of Darkness: other arrows hit up to 1.3x, at least 5, uncapped", () => {
  const attacker = fakePlayer({ weapon: I.DARK_BOW, ammo: Ammunition.RUNE_ARROW, special: "dark_bow" });
  sourceMax = 50;
  const hit = shoot(attacker, true);
  assert.equal(hit.damage, 65);
  assert.equal(hit.bounds[0].minimumBonus, 0);
});

test("Dark bow cross-floor hits use finite horizontal projectile travel delays", (t) => {
  const { CombatPosition, Location, WeaponProfiles } = core;
  const previous = Object.fromEntries(["CROSS_FLOOR_VISIBILITY", "CROSS_FLOOR_COMBAT"].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.CROSS_FLOOR_VISIBILITY = "1";
  process.env.CROSS_FLOOR_COMBAT = "1";
  t.mock.method(WeaponProfiles, "hitDelays", (_player, distance) => distance > 100
    ? [1501199875790166, 3002399751580331]
    : [1, 2]);
  t.mock.method(core.PendingHit.prototype, "prepareHits", () => []);

  const attacker = fakePlayer({ weapon: I.DARK_BOW, special: "dark_bow" });
  attacker.getLocation = () => new Location(3200, 3200, 1);
  const victim = {
    ...target,
    getLocation: () => new Location(3200, 3200, 0),
    isNpc: () => true,
    getHitpoints: () => 99,
    isUntargetable: () => false,
    isNeedsPlacement: () => false,
  };
  const hits = CombatSpecial.getById("dark_bow").getCombatMethod().hits(attacker, victim);

  assert.equal(CombatPosition.projectileDistance(attacker, victim), 0);
  assert.deepEqual(hits.map((hit) => hit.getDelay()), [2, 2]);
});

test("a dark bow arrow that misses still deals the minimum", () => {
  const dragon = fakePlayer({ weapon: I.DARK_BOW, ammo: Ammunition.DRAGON_ARROW, special: "dark_bow" });
  sourceMax = 40;
  const miss = shoot(dragon, false);
  assert.deepEqual(miss.bounds[0], { minimumMultiplier: 0, maximumMultiplier: 0, minimumBonus: 0, maximumBonus: 8 });
  assert.equal(miss.damage, 8);
  const rune = fakePlayer({ weapon: I.DARK_BOW, ammo: Ammunition.RUNE_ARROW, special: "dark_bow" });
  assert.equal(shoot(rune, false).damage, 5);
});

test("Descent leaves ordinary dark bow shots alone and drains 55% once per shot", () => {
  const off = fakePlayer({ weapon: I.DARK_BOW, ammo: Ammunition.DRAGON_ARROW, special: "dark_bow", activated: false });
  assert.equal(shoot(off, false, 0).bounds.length, 0);
  drains.length = 0;
  const attacker = fakePlayer({ weapon: I.DARK_BOW_4, ammo: Ammunition.DRAGON_ARROW, rangedWeapon: RangedWeapon.DARK_BOW, special: "dark_bow" });
  const method = CombatSpecial.getById("dark_bow").getCombatMethod();
  assert.equal(method.canAttack(attacker, target), true);
  method.start(attacker, target);
  assert.deepEqual(drains, [55]);
});

test("Descent draws the equipped arrows inside both special projectiles and uses its matching impact", () => {
  const { Location } = core;
  const method = CombatSpecial.getById("dark_bow").getCombatMethod();
  for (const [ammo, effect, launchId, impactId] of [
    [Ammunition.DRAGON_ARROW, 1099, 1111, 1100],
    [Ammunition.SEEKING_DRAGON_ARROW, 1099, 1111, 1100],
    [Ammunition.RUNE_ARROW, 1101, 1109, 1103],
    [Ammunition.BROAD_ARROW, 1102, 1112, 1103],
  ]) {
    projectiles.length = 0;
    const attacker = fakePlayer({ weapon: I.DARK_BOW, rangedWeapon: RangedWeapon.DARK_BOW, special: "dark_bow", ammo });
    attacker.getLocation = () => new Location(3200, 3200, 0);
    const impacts = [];
    const victim = { getLocation: () => new Location(3200, 3209, 0), isNpc: () => true, performGraphic: (gfx) => impacts.push(gfx) };
    method.start(attacker, victim);
    assert.deepEqual(attacker.state.slotGraphics.map(({ slot, graphic }) => [slot, graphic.getId(), graphic.getDelay(), graphic.getHeight()]), [[1, launchId, 0, 96]]);
    assert.deepEqual(projectiles.map(({ args, angle, progress }) => [args[2], args[3], args[4], args[5], args[6], angle, progress]), [
      [effect, 41, 91, 40, 36, 5, 11],
      [ammo.getProjectileId(), 41, 91, 40, 36, 5, 11],
      [effect, 41, 145, 40, 36, 25, 11],
      [ammo.getProjectileId(), 41, 145, 40, 36, 25, 11],
    ], "dragon fields from RSProx 273 tick497; shadow variants use their cache effect and equipped arrow");
    assert.deepEqual(impacts.map((gfx) => [gfx.getId(), gfx.getDelay(), gfx.getHeight()]), [[impactId, 145, 96]], "one impact is sent at firing with the second arrow's delay");
    method.handleAfterHitEffects({ getTarget: () => victim });
    method.handleAfterHitEffects({ getTarget: () => victim });
    assert.equal(impacts.length, 1, "hits do not replace the delayed impact or reread changed ammunition");
  }
});

test("Descent serializes both captured player-target flight arcs at different distances", () => {
  const { Location } = core;
  const { PacketSender } = require("../dist/net/packet/PacketSender");
  for (const [distance, ends] of [[3, [64, 85]], [4, [70, 95]]]) {
    projectiles.length = 0;
    const attacker = fakePlayer({ weapon: I.DARK_BOW, rangedWeapon: RangedWeapon.DARK_BOW, special: "dark_bow", ammo: Ammunition.DRAGON_ARROW });
    attacker.getLocation = () => new Location(3200, 3200, 0);
    const victim = { getLocation: () => new Location(3200 + distance, 3200, 0), isNpc: () => false, performGraphic() {} };
    CombatSpecial.getById("dark_bow").getCombatMethod().start(attacker, victim);
    const sent = [];
    const sender = new PacketSender({ getSession: () => ({ sendClientPacket: (packet) => { sent.push(packet); return true; } }) });
    for (const { args, angle, progress } of projectiles) {
      sender.sendProjectile(attacker.getLocation(), victim.getLocation(), 0, args[4], args[2], args[5], args[6], null, args[3], angle, progress);
    }
    assert.equal(sent.length, 4);
    for (let i = 0; i < sent.length; i++) {
      const packet = sent[i].subarray(sent[i].length - 29);
      assert.equal(packet.readUInt16BE(7), 160, "rev229 source height40 in current packet units");
      assert.equal(packet.readUInt16BE(14), 144, "rev229 target height36 in current packet units");
      assert.equal(packet[16], i < 2 ? 5 : 25);
      assert.equal(packet.readUInt16BE(17), 11);
      assert.equal(packet.readUInt16BE(19), 41);
      assert.equal(packet.readUInt16BE(21), ends[i < 2 ? 0 : 1], "RSProx2510 ticks456/683");
    }
  }
});

test("Descent measures its flights in combat coordinates across boat decks", (t) => {
  const { Location, CombatPosition } = core;
  t.mock.method(CombatPosition, "projectileDistance", () => 4);
  projectiles.length = 0;
  const attacker = fakePlayer({ weapon: I.DARK_BOW, rangedWeapon: RangedWeapon.DARK_BOW, special: "dark_bow", ammo: Ammunition.DRAGON_ARROW });
  attacker.getLocation = () => new Location(16000, 16000, 0);
  const impacts = [];
  const victim = { getLocation: () => new Location(3200, 3200, 0), isNpc: () => true, performGraphic: (gfx) => impacts.push(gfx) };
  CombatSpecial.getById("dark_bow").getCombatMethod().start(attacker, victim);
  assert.deepEqual(projectiles.map(({ args }) => args[4]), [66, 66, 95, 95], "world range determines the flight, not distant local deck tiles");
  assert.equal(impacts[0].getDelay(), 95);
});

test("Concentrated Shot costs 65%, drained once, with 25% more accuracy and damage", () => {
  const shot = CombatSpecial.getById("ballista");
  assert.equal(shot.getDrainAmount(), 65);
  assert.equal(shot.getAccuracyMultiplier(), 1.25);
  assert.equal(shot.getStrengthMultiplier(), 1.25);
  assert.equal(shot.getTraits(), undefined, "the flat multipliers drive the roll");
  drains.length = 0;
  const attacker = fakePlayer({ weapon: I.HEAVY_BALLISTA, rangedWeapon: RangedWeapon.BALLISTA, special: "ballista" });
  assert.equal(shot.getCombatMethod().canAttack(attacker, target), true);
  assert.deepEqual(drains, []);
  shot.getCombatMethod().start(attacker, target);
  assert.deepEqual(drains, [65]);
  assert.equal(attacker.state.animations, 1);
});

test("Concentrated Shot from a non-ballista drains nothing", () => {
  drains.length = 0;
  const attacker = fakePlayer({ weapon: I.HEAVY_BALLISTA, rangedWeapon: RangedWeapon.MAGIC_SHORTBOW, special: "ballista" });
  assert.equal(CombatSpecial.getById("ballista").getCombatMethod().canAttack(attacker, target), false);
  assert.deepEqual(drains, []);
});

test("toggling the special off cancels it without draining", () => {
  for (const special of ["magic_shortbow", "dark_bow", "ballista"]) {
    drains.length = 0;
    const sent = [];
    const player = fakePlayer({ weapon: I.DARK_BOW, special });
    player.getDueling = () => ({ inDuel: () => false });
    player.getWeapon = () => null;
    player.setSpecialActivated = (value) => { player.state.activated = value; };
    player.setCombatSpecial = (value) => { player.state.special = value; };
    player.getPacketSender = () => ({
      updateSpecialAttackOrb: () => sent.push("orb"),
      sendSpecialAttackState: (on) => sent.push(on),
    });
    CombatSpecial.activate(player);
    assert.equal(player.state.activated, false, `${special} is off after the second press`);
    assert.deepEqual(drains, []);
    assert.ok(sent.includes("orb"), "the bar is refreshed");
  }
});

test("Snapshot and Descent each launch two independently delayed hits", (t) => {
  const { PendingHit } = core;
  const rolledAmounts = [];
  t.mock.method(PendingHit.prototype, "prepareHits", (amount) => { rolledAmounts.push(amount); return []; });
  const { WeaponInterfaces } = core;
  for (const [special, weapon, profile, expected] of [
    ["magic_shortbow", I.MAGIC_SHORTBOW, WeaponInterfaces.SHORTBOW, [1, 2]],
    ["dark_bow", I.DARK_BOW, WeaponInterfaces.DARK_BOW, [2, 3]],
  ]) {
    const player = fakePlayer({ weapon, special });
    const items = [];
    items[Equipment.WEAPON_SLOT] = { getId: () => weapon };
    player.getEquipment = () => ({ getItems: () => items });
    player.getWeapon = () => profile;
    player.getFightType = () => null;
    player.getLocation = () => new core.Location(3195, 3200, 0);
    const hits = CombatSpecial.getById(special).getCombatMethod().hits(player, target);
    assert.deepEqual(hits.map((hit) => hit.getDelay()), expected);
    assert.equal(hits.length, 2);
  }
  assert.deepEqual(rolledAmounts, [1, 1, 1, 1], "one accuracy and damage roll per arrow");
});

test("seeking dragon arrows use Descent of Dragons, and BH increases each minimum by two", () => {
  sourceMax = 40;
  for (const ammo of [Ammunition.DRAGON_ARROW, Ammunition.SEEKING_DRAGON_ARROW]) {
    assert.equal(shoot(fakePlayer({ weapon: I.DARK_BOW, ammo, special: "dark_bow" }), false).damage, 8);
    const bh = fakePlayer({ weapon: I.DARK_BOW_BH_, ammo, special: "dark_bow" });
    assert.equal(shoot(bh, false).damage, 10);
    assert.equal(shoot(bh, true).damage, 48);
    assert.equal(rolledBounds[0].minimumBonus, 10);
  }
  assert.equal(shoot(fakePlayer({ weapon: I.DARK_BOW_BH_, ammo: Ammunition.RUNE_ARROW, special: "dark_bow" }), false).damage, 7);
});

test("ordinary Descent rolls before clamping so over-cap rolls keep their probability", () => {
  sourceMax = 40;
  const shot = shoot(fakePlayer({ weapon: I.DARK_BOW, ammo: Ammunition.DRAGON_ARROW, special: "dark_bow" }), true);
  assert.equal(shot.bounds[0].maximumBonus, 60);
  assert.equal(shot.bounds[0].minimumBonus, 0);
  assert.equal(shot.damage, 48);
});


test("Webweaver Swarm rolls four independent hits, each capped at ceil(40% max)", (t) => {
  const { AccuracyFormulasDpsCalc, Misc, RangedCombatMethod } = core;
  const { BonusManager } = require("../dist/game/model/equipment/BonusManager");
  const { DamageFormulas } = PluginManager.getCoreApi();
  t.mock.method(RangedCombatMethod, "playerHitDelays", () => [2]);
  t.mock.method(DamageFormulas, "effectiveRangedStrength", () => 500);
  const accuracyRolls = [];
  t.mock.method(AccuracyFormulasDpsCalc, "rollAccuracyCount", (...args) => {
    accuracyRolls.push(args);
    return 1;
  });
  const damageRolls = [];
  t.mock.method(Misc, "randomInclusive", (minimum, maximum) => {
    damageRolls.push([minimum, maximum]);
    return maximum;
  });

  const attacker = fakePlayer({ weapon: I.WEBWEAVER_BOW, special: "webweaver_bow" });
  attacker.isNpc = () => false;
  attacker.getBonusManager = () => ({ getOtherBonus: () => ({ [BonusManager.RANGED_STRENGTH]: 0, [BonusManager.STRENGTH]: 0 }) });
  const victim = {
    ...target,
    isPlayer: () => false,
    getHitpoints: () => 200,
    getCombat: () => ({ getLastDamager: () => null }),
  };
  const hits = CombatSpecial.getById("webweaver_bow").getCombatMethod().hits(attacker, victim);

  assert.equal(hits.length, 4, "the four Swarm hits are four PendingHits");
  assert.deepEqual(hits.map((hit) => hit.getHits().length), [1, 1, 1, 1], "each PendingHit rolls one splat, not four");
  assert.equal(hits.flatMap((hit) => hit.getHits()).length, 4, "four hit splats total");
  assert.equal(accuracyRolls.length, 4, "one independent accuracy roll per hit");
  assert.equal(damageRolls.length, 4, "one damage roll per hit");
  assert.deepEqual(damageRolls.map(([, maximum]) => maximum), [20, 20, 20, 20], "each hit caps at ceil(40% of 50)");
  assert.equal(hits.reduce((total, hit) => total + hit.getTotalDamage(), 0), 80);
});

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname,'..'));
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {},onPlayerLogin() {},registerContentEndpoint() {} });
});

test('raw Dark Bow dragon and shadow impacts are queued once per arrow at the original target tile', () => {
  const { Location }=core;
  for (const [npc,distance,ends,ammo] of [
    [true,9,[91,145],Ammunition.DRAGON_ARROW],
    [false,3,[64,85],Ammunition.RUNE_ARROW],
  ]) {
    const archer=fakePlayer({weapon:I.DARK_BOW,ammo,rangedWeapon:RangedWeapon.DARK_BOW,special:'dark_bow'});
    archer.getLocation=()=>new Location(3005,3309+distance);
    let location=new Location(3005,3309);
    const victim={getLocation:()=>location,isNpc:()=>npc,performGraphic() {}};
    areaSounds.length=0;synthSounds.length=0;
    CombatSpecial.getById('dark_bow').getCombatMethod().start(archer,victim);
    assert.deepEqual(synthSounds.map(s=>s.id),ammo===Ammunition.DRAGON_ARROW?[3731,3733]:[3731,3736],'private activation contract from attacker273 is retained');
    assert.deepEqual(areaSounds.map(s=>[s.soundId,s.delay,s.radius,s.x,s.y]),ends.map(delay=>[3737,delay,10,3005,3309]),npc?'raw273 tick497':'raw2510 tick940');
    location=new Location(3010,3310);
    assert.ok(areaSounds.every(s=>s.x===3005&&s.y===3309),'scheduled impact locations are independent of later target movement/removal');
  }
});

test('Dark Bow target doublefire is emitted by the actual first attack after equipping, with stale ranged state empty', t => {
  const { Player }=require('../dist/game/entity/impl/player/Player');
  const { WeaponInterfaceManager }=require('../dist/game/content/combat/WeaponInterfaceManager');
  const real=PluginManager.getCoreApi();
  const api=PluginManager.createApi('DarkBowFirstAttackTest');
  api.onCustomEvent('combat:attack-started',customHandlers.get('combat:attack-started'));
  const player=new Player(null);player.setUsername('darkbow-first');player.setIndex(1805);
  const sender=new Proxy({}, {get:()=>()=>sender});player.getPacketSender=()=>sender;player.getSession=()=>({sendClientPacket:()=>true});
  player.setLocation(new real.Location(3220,3220));player.setRegistered(true);player.setNeedsPlacement(false);
  for (const skill of real.Skill.values()) {player.getSkillManager().setCurrentLevel(skill,99);player.getSkillManager().setMaxLevel(skill,99);}
  real.RegionManager.init();real.RegionManager.loadMapFiles(3220,3220);
  player.getEquipment().set(Equipment.WEAPON_SLOT,new real.Item(I.DARK_BOW));
  player.getEquipment().set(Equipment.AMMUNITION_SLOT,new real.Item(I.DRAGON_ARROW,30));
  WeaponInterfaceManager.assign(player);
  player.getCombat().setRangedWeapon(null);player.getCombat().setAmmunition(null);
  const victim=PluginManager.spawnNpc({id:real.NpcIdentifiers.MUGGER_2,x:3220,y:3224});
  victim.setHitpoints(500);victim.setNeedsPlacement(false);victim.getMovementQueue().setBlockMovement(true);
  t.after(()=> {
    player.getCombat().reset();player.setRegistered(false);PluginManager.removeNpc(victim);real.World.unregisterPlayerPosition(player);
    const hooks=PluginManager.customEventHooks.get('combat:attack-started')??[];
    PluginManager.customEventHooks.set('combat:attack-started',hooks.filter(h=>h.pluginName!=='DarkBowFirstAttackTest'));
  });
  areaSounds.length=0;player.getCombat().attack(victim);
  for(let i=0;i<12&&areaSounds.length===0;i++) {
    real.World.processCycle++;real.TaskManager.process();
    player.getCombat().preMovementProcess();player.getMovementQueue().process();player.getCombat().postMovementProcess();
  }
  assert.equal(player.getCombat().getRangedWeapon(),RangedWeapon.DARK_BOW,'native method resolution populated ranged state');
  assert.equal(areaSounds.length,1,'one target sound on the first accepted ordinary shot');
  const sound=areaSounds[0];
  assert.deepEqual([sound.soundId,sound.x,sound.y,sound.radius],[3731,3220,3224,10]);
  assert.equal(sound.source,victim);assert.equal(sound.exclude,player,'the archer retains only the private launch');
});
