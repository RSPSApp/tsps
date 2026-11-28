// NPC flat armour (Wiki: Flat armour): each landed melee/ranged splat a player deals gains a negative
// value or loses a positive one (to no less than 0); misses, magic and non-player attackers are untouched.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const DATA = require('../plugins/combat/data/npc-flat-armour.json');
let core, Plugin, index = 6950;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core = PluginManager.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  Plugin = require('../plugins/combat/FlatArmour.plugin');
  Plugin.register(PluginManager.createApi('FlatArmourTest'));
  require('../plugins/npcs/SulphurNagua.plugin').register(PluginManager.createApi('SulphurNaguaTest'));
  core.GameConstants.EXPERIENCE_MULTIPLIER = 1;
});

function actors(t, gameval) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++); player.setUsername('FlatArmour' + player.getIndex());
  player.setRights(core.PlayerRights.NONE); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(3222, 3218)); player.setNeedsPlacement(false);
  const id = typeof gameval === 'number' ? gameval : core.CacheDefinitions.getNpcId(gameval);
  const npc = PluginManager.spawnNpc({ id, x: 3223, y: 3218, z: 0, wanderRadius: 0 });
  assert.ok(npc?.isRegistered(), `spawned ${gameval}`); npc.setNeedsPlacement(false);
  t.after(() => { player.setRegistered(false); npc.getCombat().getHitQueue().clear(); PluginManager.removeNpc(npc); });
  return { player, npc };
}

/** Scripted raw rolls through the real constructor and impact hook, as the hit queue does. */
function rolledHit(npc, attacker, type, damages, protectionType, options = {}) {
  const method = type === core.CombatType.RANGED ? new core.RangedCombatMethod() : new core.MeleeCombatMethod();
  if (type === core.CombatType.MAGIC) method.type = () => core.CombatType.MAGIC;
  const original = core.CombatFactory.getHitDamage;
  const protection = core.PendingHit.prototype.getProtectionType;
  let next = 0;
  core.CombatFactory.getHitDamage = () => new core.HitDamage(damages[next++], core.HitMask.RED);
  if (protectionType) core.PendingHit.prototype.getProtectionType = () => protectionType;
  try {
    return new core.PendingHit(attacker, npc, method, { hitAmount: damages.length, rollAccuracy: false, ...options });
  } finally {
    core.CombatFactory.getHitDamage = original;
    core.PendingHit.prototype.getProtectionType = protection;
  }
}
const hitOn = (npc, ...args) => npc.manipulateHit(rolledHit(npc, ...args));
const splats = hit => hit.getHits().map(h => h.getDamage());

test('every gameval in the data resolves to a cache npc, and the Wiki values are on them', () => {
  for (const monster of DATA.monsters) {
    for (const gameval of monster.npcs) {
      const id = core.CacheDefinitions.getNpcId(gameval);
      assert.ok(id != null, gameval);
      assert.equal(Plugin.flatArmourOf(id), monster.flatArmour, `${gameval} (${monster.wiki})`);
    }
  }
  const of = gameval => Plugin.flatArmourOf(core.CacheDefinitions.getNpcId(gameval));
  assert.equal(of('frost_nagua'), -4);
  assert.equal(of('earth_nagua'), -4);
  assert.equal(of('pmoon_sulphur_nagua'), -4);
  assert.equal(of('pmoon_quest_nagua_vis'), -4);
  assert.equal(of('amoxliatl'), -2);
  assert.equal(of('pmoon_boss_blood_moon'), -2, 'the Moon players fight, not only its visual multi');
  assert.equal(of('pmoon_boss_blue_moon'), -5);
  assert.equal(of('superior_rockslug'), 2);
  assert.equal(of('elite_black_knight_1'), 7);
  assert.equal(of('wilderness_rune_golem'), 4);
  assert.equal(of('pmoon_boss_eclipse_moon_vis'), 0, 'Eclipse Moon is left to its fight (6, 4 during Clones)');
});

test('negative flat armour: a landed 1 against a Frost Nagua becomes 5, a miss stays 0, every splat of a multi-hit gets 4', t => {
  const { player, npc } = actors(t, 'frost_nagua');
  assert.deepEqual(splats(hitOn(npc, player, core.CombatType.MELEE, [1])), [5]);
  assert.deepEqual(splats(hitOn(npc, player, core.CombatType.MELEE, [0])), [0]);
  const multi = hitOn(npc, player, core.CombatType.RANGED, [3, 0, 7]);
  assert.deepEqual(splats(multi), [7, 0, 11]);
  assert.equal(multi.getTotalDamage(), 18);
});

test('the Sulphur Nagua keeps its -4 (now from the shared table)', t => {
  for (const gameval of ['pmoon_sulphur_nagua', 'pmoon_quest_nagua', 'pmoon_quest_nagua_vis']) {
    const { player, npc } = actors(t, gameval);
    assert.deepEqual(splats(hitOn(npc, player, core.CombatType.MELEE, [1])), [5], gameval);
    assert.equal(npc.getCombatXpMultiplier(), gameval === 'pmoon_sulphur_nagua' ? 1.05 : 1, gameval);
  }
});

test('positive flat armour: a Giant rockslug (2) takes 2 off a landed hit, and a hit of 2 or less does nothing', t => {
  const { player, npc } = actors(t, 'superior_rockslug');
  assert.deepEqual(splats(hitOn(npc, player, core.CombatType.MELEE, [10])), [8]);
  const low = hitOn(npc, player, core.CombatType.RANGED, [2, 1, 3]);
  assert.deepEqual(splats(low), [0, 0, 1]);
  assert.equal(low.getTotalDamage(), 1);
});

test('magic, other NPCs and monsters without flat armour are untouched', t => {
  const { player, npc } = actors(t, 'frost_nagua');
  assert.deepEqual(splats(hitOn(npc, player, core.CombatType.MAGIC, [5])), [5], 'player magic ignores flat armour');
  assert.deepEqual(splats(hitOn(npc, player, core.CombatType.MELEE, [5], core.CombatType.MAGIC)), [5],
    'a melee swing dealing magic damage (the Voidwaker special) ignores it');
  const other = actors(t, core.NpcIdentifiers.SAND_CRAB);
  assert.deepEqual(splats(hitOn(npc, other.npc, core.CombatType.MELEE, [5])), [5], 'an NPC attacker (a thrall, say) is untouched');
  assert.deepEqual(splats(hitOn(other.npc, player, core.CombatType.MELEE, [2])), [2], 'a sand crab has no flat armour');
});


// #6782: the real constructor/queue/XP producer, not a manually modified completed hit.
function queuedBlow(player, npc, damage, options = {}) {
  const hit = new core.PendingHit(player, npc, new core.MeleeCombatMethod(), {
    damage, rollAccuracy: false, experienceSkills: [core.Skill.ATTACK.getIndex()], ...options,
  });
  core.CombatFactory.addPendingHit(hit);
  return hit;
}

test('6782: a Sulphur Nagua landed 1 pays 21 Attack XP for its adjusted 5 damage exactly once', t => {
  const { player, npc } = actors(t, 'pmoon_sulphur_nagua');
  const skills = player.getSkillManager();
  const before = skills.getExperience(core.Skill.ATTACK);
  const hpBefore = skills.getExperience(core.Skill.HITPOINTS);
  const hit = queuedBlow(player, npc, 1);
  assert.equal(skills.getExperience(core.Skill.ATTACK) - before, 21);
  assert.equal(skills.getExperience(core.Skill.HITPOINTS) - hpBefore, 7);
  assert.equal(hit.getTotalDamage(), 5);
  const hp = npc.getHitpoints();
  npc.getCombat().getHitQueue().process(core.World.getProcessCycle() + 10);
  assert.equal(hp - npc.getHitpoints(), 5);
  assert.equal(skills.getExperience(core.Skill.ATTACK) - before, 21, 'landing pays no second XP');
});

test('6782: armour is applied before the first HP cap in both directions', t => {
  const positive = actors(t, 'superior_rockslug');
  positive.npc.setHitpoints(10);
  const hit = queuedBlow(positive.player, positive.npc, 20);
  assert.equal(hit.getTotalDamage(), 10, '20 minus 2 armour is capped to 10 HP');
  assert.equal(positive.player.getSkillManager().getExperience(core.Skill.ATTACK), 40);
  positive.npc.getCombat().getHitQueue().process(core.World.getProcessCycle() + 10);
  assert.equal(positive.npc.getHitpoints(), 0, 'lethal positive-armour hit is not reduced twice');
  const negative = actors(t, 'pmoon_quest_nagua_vis');
  negative.npc.setHitpoints(3);
  const small = queuedBlow(negative.player, negative.npc, 1);
  assert.equal(small.getTotalDamage(), 3, '1 plus 4 armour bonus is capped to 3 HP');
  assert.equal(negative.player.getSkillManager().getExperience(core.Skill.ATTACK), 12, 'quest Nagua has no XP bonus');
});


test('6782: multi-splat damage and XP share the HP and producer budget after flat armour', t => {
  const { player, npc } = actors(t, 'frost_nagua');
  npc.setHitpoints(9);
  const hit = rolledHit(npc, player, core.CombatType.RANGED, [1, 0, 3], undefined, {
    damageBudget: { remaining: 6 }, experienceSkills: [core.Skill.RANGED.getIndex()],
  });
  assert.deepEqual(splats(hit), [5, 0, 4], 'each landed splat gets armour before the shared HP cap');
  core.CombatFactory.addPendingHit(hit);
  assert.deepEqual(splats(hit), [5, 0, 1]);
  assert.equal(player.getSkillManager().getExperience(core.Skill.RANGED), 24);
  npc.getCombat().getHitQueue().process(core.World.getProcessCycle() + 10);
  assert.equal(npc.getHitpoints(), 3);
  assert.equal(player.getSkillManager().getExperience(core.Skill.RANGED), 24);
});

test('6782: positive armour can zero XP; a size multiplier precedes flat armour', t => {
  const positive = actors(t, 'superior_rockslug');
  assert.equal(queuedBlow(positive.player, positive.npc, 1).getTotalDamage(), 0);
  assert.equal(positive.player.getSkillManager().getExperience(core.Skill.ATTACK), 0);
  const negative = actors(t, 'frost_nagua');
  assert.equal(queuedBlow(negative.player, negative.npc, 2, { damageMultiplier: 1.5 }).getTotalDamage(), 7,
    'size bonus multiplies the raw 2 to 3, then negative armour adds 4');
});

test('6782: the first-successful special branch finalizes each distributed splat', t => {
  const { player, npc } = actors(t, 'frost_nagua');
  const traits = { hitCount: 4, guaranteedHit: true, firstSuccessfulAccuracyDamageRanges: [{
    minimumDamageMultiplier: 1, maximumDamageMultiplier: 1,
    hitDamageMultipliers: [0.5, 0.25, 0.25, 0.125],
  }] };
  t.mock.method(core.CombatSpecial, 'activeTraitsFor', () => traits);
  const hit = rolledHit(npc, player, core.CombatType.MELEE, [8, 8, 8, 8]);
  assert.deepEqual(splats(hit), [8, 6, 6, 5], 'raw 4,2,2,1 splats each gain 4');
});

test('6782: status damage and directly queued recoil/burn damage bypass roll armour and XP', t => {
  const { player, npc } = actors(t, 'frost_nagua');
  const hp = npc.getHitpoints();
  const status = queuedBlow(player, npc, 3, { statusDamage: true });
  assert.equal(status.getTotalDamage(), 3);
  npc.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(2, core.HitMask.RED).setSource(player)]);
  npc.getCombat().getHitQueue().process(core.World.getProcessCycle() + 10);
  assert.equal(hp - npc.getHitpoints(), 5);
  assert.equal(player.getSkillManager().getExperience(core.Skill.ATTACK), 0);
});


test('6782: ordinary configured damage retains weapon hooks; authoritative fixed follow-ups do not', t => {
  const { player, npc } = actors(t, 'frost_nagua');
  const rolls = t.mock.method(PluginManager, 'emitCombatHitDamage');
  const ordinary = queuedBlow(player, npc, 1);
  assert.equal(rolls.mock.calls.length, 1, 'ordinary configured damage still runs the existing hook');
  assert.equal(ordinary.getTotalDamage(), 5);
  const fixed = queuedBlow(player, npc, 2, { handleAfterHitEffects: false, experience: false });
  assert.equal(rolls.mock.calls.length, 1, 'supplied follow-up roll does not proc the worn weapon again');
  assert.equal(fixed.getTotalDamage(), 6, 'flat armour still applies to the supplied roll');
  const scaled = queuedBlow(player, npc, 2, { handleAfterHitEffects: false, experience: false, damageMultiplier: 1.5 });
  assert.equal(scaled.getTotalDamage(), 7, 'authoritative supplied roll retains its explicit size bonus before armour');
  t.mock.method(core.AccuracyFormulasDpsCalc, 'rollAccuracy', () => false);
  const missable = queuedBlow(player, npc, 5, { handleAfterHitEffects: false, rollAccuracy: true });
  assert.equal(missable.getTotalDamage(), 0, 'fixed damage that requests accuracy can still miss (Duke-style producer)');
  assert.equal(rolls.mock.calls.length, 2, 'missable configured hit keeps the ordinary damage hook');
});

test('6782: the actual Karil follow-up keeps half-primary damage, its own armour and no second XP', t => {
  const { player, npc } = actors(t, 'frost_nagua');
  const I = core.ItemIdentifiers, E = core.Equipment;
  for (const [slot, id] of [[E.HEAD_SLOT,I.KARILS_COIF], [E.BODY_SLOT,I.KARILS_LEATHERTOP],
    [E.LEG_SLOT,I.KARILS_LEATHERSKIRT], [E.WEAPON_SLOT,I.KARILS_CROSSBOW], [E.AMULET_SLOT,I.AMULET_OF_THE_DAMNED_FULL_]]) {
    assert.ok(Number.isInteger(id), 'cache-backed equipment id');
    player.getEquipment().setItem(slot, new core.Item(id, 1));
  }
  let dealt, secondary;
  const factory = new Proxy(core.CombatFactory, { get: (obj, key) => key === 'addPendingHit'
    ? hit => { secondary = hit; obj.addPendingHit(hit); } : obj[key] });
  const api = new Proxy({ core, getCombatFactory: () => factory, onPlayerDealtDamage: fn => { dealt = fn; } },
    { get: (obj, key) => key in obj ? obj[key] : () => {} });
  require('../plugins/items/BarrowsEquipment.plugin').register(api);
  const primary = rolledHit(npc, player, core.CombatType.RANGED, [4]);
  assert.equal(primary.getTotalDamage(), 8);
  t.mock.method(Math, 'random', () => 0);
  dealt({ player, target: npc, hit: primary });
  assert.ok(secondary, 'real equipped-set handler queued its follow-up');
  assert.equal(secondary.getTotalDamage(), 8, 'half of primary8, then each landed splat gains4');
  assert.equal(secondary.rewardsExperience(), false);
  assert.equal(player.getSkillManager().getExperience(core.Skill.RANGED), 0);
});

test('6782: Ward of Arceuus still takes 10% off a fixed, no-accuracy roll from Duke Sucellus (a demon)', t => {
  const { player, npc: duke } = actors(t, 12191);
  assert.equal(duke.getCurrentDefinition().isDemon(), true);
  player.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 99, false);
  player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 99, false);
  const method = new core.MeleeCombatMethod();
  method.type = () => core.CombatType.MAGIC;
  const strike = () => new core.PendingHit(duke, player, method, {
    delay: 0, damage: 40, bypassProtectionPrayer: true, rollAccuracy: false, experience: false, handleAfterHitEffects: false,
  }).getTotalDamage();
  assert.equal(strike(), 40, 'no ward: the full fixed hit');
  player.setAttribute('arceuus:ward-until', core.World.getProcessCycle() + 100);
  assert.equal(strike(), 36, 'warded: 40 less floor(40 / 10)');
});

test('6782: Infernal tecpatl Brand splits the raw roll, then each splat gets its own flat armour (both signs)', t => {
  let brand;
  const api = PluginManager.createApi('FlatArmourBrandTest');
  require('../plugins/combat/specials/InfernalTecpatl.SpecialAttack')(new Proxy(
    { registerCombatSpecial: definition => { brand = definition; } },
    { get: (obj, key) => key in obj ? obj[key] : api[key] }));
  t.mock.method(core.CombatSpecial, 'activeTraitsFor', () => null);
  t.mock.method(core.AccuracyFormulasDpsCalc, 'rollAccuracy', () => true);
  const brandOn = (gameval, raw) => {
    const { player, npc } = actors(t, gameval);
    npc.setHitpoints(200);
    const original = core.CombatFactory.getHitDamage;
    core.CombatFactory.getHitDamage = () => new core.HitDamage(raw, core.HitMask.RED);
    let hit;
    try { [hit] = brand.combatMethod.hits(player, npc); } finally { core.CombatFactory.getHitDamage = original; }
    npc.manipulateHit(hit);
    return { splats: splats(hit), total: hit.getTotalDamage() };
  };
  assert.deepEqual(brandOn('frost_nagua', 20), { splats: [9, 9, 9, 9], total: 36 }, '20 as 5s, each gains 4');
  assert.deepEqual(brandOn('elite_black_knight_1', 20), { splats: [0, 0, 0, 0], total: 0 }, '20 as 5s, each loses 7');
  assert.deepEqual(brandOn('elite_black_knight_1', 5), { splats: [0, 0, 0, 0], total: 0 },
    'the split minimum of 1 comes before the armour, so it does not revive a zeroed splat');
});

test('6848: the max hit splat marks the top of the range after flat armour, in both directions', t => {
  /** Rolls of a weapon whose maximum is `maximum`, through the real constructor and impact hook. */
  const maxHitsOn = (gameval, maximum, damages) => {
    const { player, npc } = actors(t, gameval);
    player.getSession().setPlayer(player);
    npc.setHitpoints(500);
    const original = core.CombatFactory.getHitDamage;
    let next = 0;
    core.CombatFactory.getHitDamage = () => new core.HitDamage(damages[next++], core.HitMask.RED).setRolledMaximum(maximum);
    let hit;
    try {
      hit = new core.PendingHit(player, npc, new core.MeleeCombatMethod(), { hitAmount: damages.length, rollAccuracy: false });
    } finally { core.CombatFactory.getHitDamage = original; }
    npc.manipulateHit(hit);
    return hit.getHits().map(h => {
      h.setSource(player);
      // What the attacker's client is sent: 43 is the max hit splat, 16 the ordinary one.
      return [h.getDamage(), player.getSession().hitView(h, false).type];
    });
  };
  assert.deepEqual(maxHitsOn('frost_nagua', 30, [30, 29]), [[34, 43], [33, 16]], '-4: a 30 max shows the max splat on 34');
  assert.deepEqual(maxHitsOn('superior_rockslug', 30, [30, 29]), [[28, 43], [27, 16]], '2: a 30 max shows it on 28');
  assert.deepEqual(maxHitsOn('elite_black_knight_1', 7, [7]), [[0, 12]], 'a max of the armour or less is a 0, never a max');
  assert.deepEqual(maxHitsOn('man', 30, [30]), [[30, 43]], 'no flat armour: the max is the roll top');
});
