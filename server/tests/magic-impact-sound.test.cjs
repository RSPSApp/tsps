// Run after `yarn build`: node --test tests/magic-impact-sound.test.cjs
//
// #2524: successful combat-spell hits are silent. Live sends the impact sound as a sound_area packet at the
// TARGET's tile with range 10, whoever the target is (RSProx 102 tick 232: Fire Strike on a Guard NPC,
// `sound_area id=161 loops=1 delay=106 range=10 coord=<target tile>`; the delay is the projectile's end
// cycle, ours plays when the hit lands so it is 0; 3275 shows the same for player targets, id 3010 range 10).
// The client drops an area sound of range 0 unless it is the local player's own (SoundEffectSystem), so the
// radius-0 area sound the server sent for an NPC target was silent for everyone, and a player target got a
// private synth that the caster never hears.
//
// Real engine classes: real Players (packets captured at the session), the real NPC and the real
// MagicCombatMethod.handleAfterHitEffects on a hit built by the real spell and combat method.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server'); Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { Location } = require('../dist/game/model/Location');
const { Sound } = require('../dist/game/Sound');
const { World } = require('../dist/game/World');
const { PrivateArea } = require('../dist/game/model/areas/impl/PrivateArea');
const { encodeSound } = require('../dist/net/protocol/ClientProtocol');
const core = PluginManager.getCoreApi();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  // The powered staves resolve their own combat method through the registered plugins, as in the server.
  require('../plugins/items/TumekensShadow.plugin').register(PluginManager.createApi('MagicImpactTumeken'));
  require('../plugins/items/WarpedSceptre.plugin').register(PluginManager.createApi('MagicImpactWarped'));
  require('../plugins/items/SanguinestiStaff.plugin').register(PluginManager.createApi('MagicImpactSanguinesti'));
  // The Warped sceptre builds its powered-staff definition on server startup; without it the resolver
  // returns nothing and the wielder falls back to an ordinary melee swing.
  PluginManager.emitServerStartup({});
});

// A cast also sends stat, inventory and XP packets to a real session; only the sound packets are compared.
const SOUND_OPCODE = encodeSound(1)[0];
const isSound = (frame) => frame[0] === SOUND_OPCODE;

let index = 3100;
function actor(t, x, y = 3200, area = null) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel), player = new Player(session), packets = [];
  player.setIndex(index++); player.setUsername('mag' + player.getIndex());
  player.setLocation(new Location(x, y, 0)); player.setRegistered(true);
  if (area) area.add(player);
  session.sendClientPacket = (frame) => { packets.push(frame); return true; };
  t.after(() => player.setRegistered(false));
  t.mock.method(player, 'sendMessage', () => {});
  return { player, packets, sounds: () => packets.filter(isSound) };
}

/** A Fire Strike cast by `caster` at `target`, resolved into the hit the combat method lands. */
function castFireStrike(t, caster, target, accurate) {
  const spell = core.CombatSpells.FIRE_STRIKE;
  caster.getSkillManager().setMaxLevel(core.Skill.MAGIC, 99);
  caster.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99, false);
  t.mock.method(target, 'getHitpoints', () => 200);
  t.mock.method(target, 'getSize', () => 1);
  t.mock.method(caster.getCombat(), 'getTarget', () => target);
  caster.getCombat().setCastSpell(spell);
  for (const rune of spell.itemsRequired(caster)) caster.getInventory().add(new core.Item(rune.getId(), rune.getAmount() * 10));
  assert.equal(spell.canCast(caster, true), true, 'the cast is paid for');
  const method = new core.MagicCombatMethod();
  const hit = method.hits(caster, target)[0];
  t.mock.method(hit, 'isAccurate', () => accurate);
  method.handleAfterHitEffects(hit);
}

const impact = (x, y) => encodeSound(161, { x, y, level: 0, loops: 1, delay: 0, radius: 10, attenuation: 0 });

test('a successful Fire Strike on an NPC plays the captured area impact sound for the caster and bystanders nearby', (t) => {
  const caster = actor(t, 3200), near = actor(t, 3206), far = actor(t, 3240), other = actor(t, 3204, 3200, new PrivateArea());
  const npc = new core.NPC(core.NpcIdentifiers.MAN, new Location(3203, 3200));
  t.mock.method(World, 'getPlayers', () => [caster, near, far, other].map((a) => a.player));
  castFireStrike(t, caster.player, npc, true);
  assert.deepEqual(caster.sounds(), [impact(3203, 3200)], 'the caster hears it at the target tile, range 10');
  assert.deepEqual(near.sounds(), [impact(3203, 3200)], 'so does a player standing nearby');
  assert.deepEqual(far.sounds(), [], 'out of range hears nothing');
  assert.deepEqual(other.sounds(), [], 'a private room does not leak into the world');
});

test('a successful Fire Strike on a player is heard by the caster too, as the same area sound, not a private synth', (t) => {
  const caster = actor(t, 3200), target = actor(t, 3203), near = actor(t, 3206), far = actor(t, 3240);
  t.mock.method(World, 'getPlayers', () => [caster, target, near, far].map((a) => a.player));
  castFireStrike(t, caster.player, target.player, true);
  for (const a of [caster, target, near]) assert.deepEqual(a.sounds(), [impact(3203, 3200)]);
  assert.deepEqual(far.sounds(), []);
});

// Splashes are the same area sound: 3275 has 492 `sound_area id=227 range=10` at the target's tile (e.g. line
// 1370, a wind strike on a rat with failedspell_impact), 102 has two. 227 is Sound.SPELL_FAIL_SPLASH.
const splash = (x, y) => encodeSound(Sound.SPELL_FAIL_SPLASH.getId(), { x, y, level: 0, loops: 1, delay: 0, radius: 10, attenuation: 0 });

test('a splash on an NPC is the captured range-10 area sound at the target, heard by the caster and nearby, with no impact sound', (t) => {
  const caster = actor(t, 3200), near = actor(t, 3206), far = actor(t, 3240);
  const npc = new core.NPC(core.NpcIdentifiers.MAN, new Location(3203, 3200));
  t.mock.method(World, 'getPlayers', () => [caster, near, far].map((a) => a.player));
  castFireStrike(t, caster.player, npc, false);
  assert.deepEqual(caster.sounds(), [splash(3203, 3200)]);
  assert.deepEqual(near.sounds(), [splash(3203, 3200)]);
  assert.deepEqual(far.sounds(), []);
});

// INFERRED, not captured: 3275 shows a splash on the capture's own player as a private synth 227 (42 ticks, 39 of
// them with no area copy). Splashes on NPC targets are the area sound (above); a player target is taken to be
// the same, as the impact sound is, but no capture of a player-target splash as an area sound exists.
test('(inferred) a splash on a player target is the same area sound, heard by the caster and the target', (t) => {
  const caster = actor(t, 3200), target = actor(t, 3203), far = actor(t, 3240);
  t.mock.method(World, 'getPlayers', () => [caster, target, far].map((a) => a.player));
  castFireStrike(t, caster.player, target.player, false);
  for (const a of [caster, target]) assert.deepEqual(a.sounds(), [splash(3203, 3200)]);
  assert.deepEqual(far.sounds(), []);
});

/** A real powered-staff hit: the plugin's own combat method, resolved for a real Player wielding the staff. */
for (const [name, itemId, chargesKey] of [
  ["Tumeken's shadow", core.ItemIdentifiers.TUMEKENS_SHADOW, 'tumekens-shadow-charges'],
  ['the Warped sceptre', core.ItemIdentifiers.WARPED_SCEPTRE, 'warped-sceptre'],
]) {
  test(`a successful hit with ${name} plays the captured 1460 impact as an area sound at the target`, (t) => {
    const caster = actor(t, 3200), near = actor(t, 3206), far = actor(t, 3240);
    const npc = new core.NPC(core.NpcIdentifiers.MAN, new Location(3203, 3200));
    t.mock.method(World, 'getPlayers', () => [caster, near, far].map((a) => a.player));
    const player = caster.player, staff = new core.Item(itemId);
    staff.setMetaValue(chargesKey, 5);
    player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] = staff;
    t.mock.method(npc, 'getHitpoints', () => 200);
    t.mock.method(npc, 'getSize', () => 1);
    t.mock.method(player.getCombat(), 'getTarget', () => npc);
    const method = core.CombatFactory.getMethod(player);
    assert.notEqual(method, core.CombatFactory.MAGIC_COMBAT, `${name} attacks with its own method`);
    assert.ok(method instanceof core.MagicCombatMethod, `${name}'s own method is a magic one, not a melee fallback`);
    assert.equal(method.canAttack(player, npc), true);
    const hit = method.hits(player, npc)[0];
    t.mock.method(hit, 'isAccurate', () => true);
    method.handleAfterHitEffects(hit);
    const impact1460 = encodeSound(1460, { x: 3203, y: 3200, level: 0, loops: 1, delay: 0, radius: 10, attenuation: 0 });
    assert.deepEqual(caster.sounds(), [impact1460]);
    assert.deepEqual(near.sounds(), [impact1460]);
    assert.deepEqual(far.sounds(), []);
  });
}

/**
 * The Sanguinesti staff times its own impact like the tridents: the impact graphic and the range-10 area sound go
 * out WITH the cast, delayed to the projectile's end (46 cycles + 10 a tile to the target's nearest tile). A hit is
 * spotanim 1541 at height 60 (1696 ticks 640, 778, 1073; 1698 4181, 4238), a hit with the life-leech proc is spotanim
 * 1542 (sanguinesti_staff_heal) at height 92 (1698 tick 4265, 1696 631, 1485, 1509), both with sound 1460; a miss is
 * spotanim 85 at height 124 and sound 227 (1696 774, 1063; 1698 4177).
 */
for (const [label, accurate, procs, graphic, sound] of [
  ['hit', true, false, { id: 1541, height: 60 }, 1460],
  ['hit with the life-leech proc', true, true, { id: 1542, height: 92 }, 1460],
  ['miss', false, false, { id: 85, height: 124 }, 227],
]) {
  test(`a Sanguinesti staff ${label} sends its captured impact with the cast, delayed to the projectile's end, and nothing more at landing`, (t) => {
    const caster = actor(t, 3200), near = actor(t, 3206), far = actor(t, 3240);
    const npc = new core.NPC(core.NpcIdentifiers.MAN, new Location(3203, 3200));
    t.mock.method(World, 'getPlayers', () => [caster, near, far].map((a) => a.player));
    const player = caster.player, staff = new core.Item(core.ItemIdentifiers.SANGUINESTI_STAFF);
    staff.setMetaValue('sanguinesti-staff-charges', 5);
    player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] = staff;
    const graphics = [];
    t.mock.method(npc, 'getHitpoints', () => 200);
    t.mock.method(npc, 'getSize', () => 1);
    t.mock.method(npc, 'performGraphic', (g) => graphics.push(g));
    t.mock.method(player.getCombat(), 'getTarget', () => npc);
    t.mock.method(core.AccuracyFormulasDpsCalc, 'rollAccuracy', () => accurate);
    t.mock.method(Math, 'random', () => (procs ? 0.1 : 0.99)); // the 1 in 5 proc rolls below 0.2
    const method = core.CombatFactory.getMethod(player);
    assert.ok(method instanceof core.MagicCombatMethod && method !== core.CombatFactory.MAGIC_COMBAT, 'the staff own magic method, not the generic one');
    assert.equal(method.canAttack(player, npc), true);
    const hit = method.hits(player, npc)[0];
    const end = 46 + 3 * 10;
    const area = encodeSound(sound, { x: 3203, y: 3200, level: 0, loops: 1, delay: end, radius: 10, attenuation: 0 });
    assert.deepEqual(caster.sounds(), [area]);
    assert.deepEqual(near.sounds(), [area]);
    assert.deepEqual(far.sounds(), []);
    assert.deepEqual(graphics.map((g) => [g.id, g.delay, g.height]), [[graphic.id, end, graphic.height]]);
    t.mock.method(hit, 'isAccurate', () => accurate);
    method.handleAfterHitEffects(hit);
    assert.deepEqual(caster.sounds(), [area], 'landing adds no second sound');
    assert.equal(graphics.length, 1, 'or a second graphic');
  });
}

/** 1696 ticks 774/778 (from the east of the size-3 Balance Elemental: end 86) and 1063/1073 (end 76); the code measured to the south-west tile. */
for (const [casterX, end] of [[3206, 86], [3205, 76]]) {
  test(`a Sanguinesti staff cast at a size-3 target from the east (${casterX - 3200 - 2} tiles from its nearest tile) ends at ${end}, landing in ${Math.ceil(end / 30)} ticks`, (t) => {
    const caster = actor(t, casterX);
    const npc = new core.NPC(core.NpcIdentifiers.MAN, new Location(3200, 3200));
    t.mock.method(World, 'getPlayers', () => [caster.player]);
    const player = caster.player, staff = new core.Item(core.ItemIdentifiers.SANGUINESTI_STAFF);
    staff.setMetaValue('sanguinesti-staff-charges', 5);
    player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] = staff;
    t.mock.method(npc, 'getHitpoints', () => 200);
    t.mock.method(npc, 'getSize', () => 3);
    t.mock.method(npc, 'performGraphic', () => {});
    t.mock.method(player.getCombat(), 'getTarget', () => npc);
    t.mock.method(core.AccuracyFormulasDpsCalc, 'rollAccuracy', () => true);
    t.mock.method(Math, 'random', () => 0.99);
    const method = core.CombatFactory.getMethod(player);
    assert.equal(method.canAttack(player, npc), true);
    const hit = method.hits(player, npc)[0];
    assert.deepEqual(caster.sounds(), [encodeSound(1460, { x: 3200, y: 3200, level: 0, loops: 1, delay: end, radius: 10, attenuation: 0 })]);
    assert.equal(hit.getDelay(), Math.ceil(end / 30), 'the hit lands with the projectile');
  });
}
