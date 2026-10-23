const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { I = core.ItemIdentifiers } = {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

function playerWith(weapon) {
  const items = [];
  items[core.Equipment.WEAPON_SLOT] = { getId: () => weapon, getDefinition: () => ItemDefinition.forId(weapon) };
  const player = {
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => player,
    getEquipment: () => ({ get: (slot) => items[slot], getItems: () => items }),
    getPrayerActive: () => [],
    getBonusManager: () => ({ getOtherBonus: () => [0, 0, ItemDefinition.forId(weapon).getBonuses()[12] ?? 0] }),
  };
  return player;
}

test("Kodai's real item bonus increases spell damage by 15%, ancient sceptre by 10%", () => {
  for (const [item, expected] of [[I.KODAI_WAND, 23], [I.KODAI_WAND_3, 23], [I.ANCIENT_SCEPTRE, 22], [I.ANCIENT_SCEPTRE_L_, 22]]) {
    assert.equal(core.DamageFormulas.applyMagicDamageBonus(playerWith(item), 20), expected);
  }
});

test("all four Power of Death animation and graphic ids match the cache gamevals", () => {
  const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
  const animations = new Gamevals().namesOf(GamevalKind.SEQ);
  const graphics = new Gamevals().namesOf(GamevalKind.SPOTANIM);
  for (const [item, animation, graphic, animationName, graphicName] of [
    [I.STAFF_OF_THE_DEAD, 7083, 1228, "sotd_special", "sotd_special_start"],
    [I.STAFF_OF_LIGHT, 7967, 1516, "staff_of_light_special", "staff_of_light_special_start"],
    [I.STAFF_OF_BALANCE, 3652, 1733, "staff_of_balance_special", "staff_of_balance_special_start"],
    [I.TOXIC_STAFF_OF_THE_DEAD, 1720, 1228, "sotd_special_toxic_charged", "sotd_special_start"],
  ]) {
    assert.equal(animations.get(animation), animationName);
    assert.equal(graphics.get(graphic), graphicName);
    let definition;
    require(`../plugins/combat/specials/${item === I.STAFF_OF_THE_DEAD ? "StaffOfTheDead" : item === I.STAFF_OF_LIGHT ? "StaffOfLight" : item === I.STAFF_OF_BALANCE ? "StaffOfBalance" : "ToxicStaffOfTheDead"}.SpecialAttack`)({
      core: { ...core, CombatSpecial: { drain() {} } }, registerCombatSpecial: (entry) => { definition = entry; },
      registerIncomingDamageModifier() {}, onCustomEvent() {},
    });
    const player = playerWith(item);
    player.performAnimation = (value) => { player.animation = value.getId(); };
    player.performGraphic = (value) => { player.graphic = value.getId(); };
    player.setAttribute = () => {};
    player.sendMessage = () => {};
    definition.combatMethod.start(player);
    assert.equal(player.animation, animation);
    assert.equal(player.graphic, graphic);
  }
});

test("NPC ranged defences retain the Wiki light/standard/heavy split and cache rolls separately", () => {
  const stats = NpcDefinitionLoader.fromMonsterDump({ defence_ranged_light: -10, defence_ranged_standard: 30, defence_ranged_heavy: 80 });
  assert.deepEqual([stats.defenceBonuses.light, stats.defenceBonuses.ranged, stats.defenceBonuses.heavy], [-10, 30, 80]);
  const definition = new NpcDefinition();
  definition.stats = Array(18).fill(0);
  definition.stats[14] = 30;
  definition.rangedDefenceBonuses = { light: -10, heavy: 80 };
  const npc = {
    isPlayer: () => false, isNpc: () => true, getAsNpc: () => npc,
    getDefenceLevel: () => 99, getCurrentLevel: () => 99, getCurrentDefinition: () => definition,
    getRollFactor: () => 1,
    getDefenceBonus: (index, type) => NPC.prototype.getDefenceBonus.call(npc, index, type),
  };
  const rolls = ["light", "standard", "heavy"].map((type) => core.AccuracyFormulasDpsCalc.defenseRangedRoll(npc, type));
  assert.deepEqual(rolls, [108 * 54, 108 * 94, 108 * 144]);
  assert.equal(core.AccuracyFormulasDpsCalc.specialRolls(npc, npc, core.CombatType.RANGED, core.CombatType.RANGED, "heavy").defence, 108 * 144);
  const chin = playerWith(I.RED_CHINCHOMPA_2);
  chin.getWeapon = () => core.WeaponInterfaces.CHINCHOMPA;
  assert.equal(core.WeaponProfiles.ranged(chin).rangedDefenceType, "heavy");
});

test("Hamstring multiplies the actual run drain and refreshes without stacking", () => {
  let modifier, special;
  require("../plugins/combat/specials/MorrigansThrowingAxeBh.SpecialAttack")({ core,
    registerCombatSpecial: (entry) => { special = entry; }, registerRunEnergyDrainModifier: (entry) => { modifier = entry; },
  });
  const attributes = new Map();
  const victim = { isPlayer: () => true, getAsPlayer: () => victim, performGraphic() {}, sendMessage() {},
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
  };
  const hit = { isAccurate: () => true, getTotalDamage: () => 10, getTarget: () => victim };
  assert.equal(modifier(victim, 0.5), 0.5);
  special.combatMethod.handleAfterHitEffects(hit);
  assert.equal(modifier(victim, 0.5), 3);
  special.combatMethod.handleAfterHitEffects(hit);
  assert.equal(modifier(victim, 0.5), 3);
  attributes.set("morrigans-throwing-axe:hamstring-until", Date.now() - 1);
  assert.equal(modifier(victim, 0.5), 0.5);
});

test("3rd Age bow keeps shortbow speed, 9 tile reach, 65 Ranged and +80 accuracy", () => {
  const player = playerWith(I._3RD_AGE_BOW);
  player.getWeapon = () => core.WeaponInterfaces.SHORTBOW;
  player.getFightType = () => null;
  assert.equal(core.WeaponProfiles.attackSpeed(player, 6), 4);
  assert.equal(core.WeaponProfiles.attackDistance(player, 6), 9);
  assert.equal(ItemDefinition.forId(I._3RD_AGE_BOW).getBonuses()[4], 80);
  assert.equal(ItemDefinition.forId(I._3RD_AGE_BOW).getRequirements()[4], 65);
});

test("seeking dragon arrows have their own ammunition and successful minimum, leaving specials alone", () => {
  assert.equal(core.Ammunition.getForItem(I.SEEKING_DRAGON_ARROW), core.Ammunition.SEEKING_DRAGON_ARROW);
  assert.ok(core.RangedWeapon.DARK_BOW.getAmmunitionData().includes(core.Ammunition.SEEKING_DRAGON_ARROW));
  let handler;
  require("../plugins/items/SeekingArrows.plugin").register({ core, onCombatHitDamage: (entry) => { handler = entry; } });
  const attacker = playerWith(I.DARK_BOW);
  attacker.isSpecialActivated = () => false;
  attacker.getCombat = () => ({ getAmmunition: () => core.Ammunition.SEEKING_DRAGON_ARROW });
  const damage = new core.HitDamage(1, core.HitMask.RED);
  handler({ attacker, damage, accurate: true, combatType: core.CombatType.RANGED });
  assert.equal(damage.getDamage(), 3);
  damage.setDamage(0);
  handler({ attacker, damage, accurate: false, combatType: core.CombatType.RANGED });
  assert.equal(damage.getDamage(), 0);
  attacker.isSpecialActivated = () => true;
  damage.setDamage(8);
  handler({ attacker, damage, accurate: true, combatType: core.CombatType.RANGED });
  assert.equal(damage.getDamage(), 8);
});

function sceptreEffects(t, veto = () => {}) {
  const handlers = new Map();
  require("../plugins/items/AncientSceptre.plugin").register({
    core, onCustomEvent: (name, handler) => handlers.set(name, handler),
  });
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => {
    handlers.get(name)?.(event);
    if (name === "magic:hit-effects") veto(event);
  });
}

function ancientHit(cast, target, damage = 40, accurate = true) {
  return { isAccurate: () => accurate, getAttacker: () => cast, getTarget: () => target, getTotalDamage: () => damage };
}

test("ancient sceptre modifies all sixteen base effects once; ordinary staves retain their base effects", (t) => {
  sceptreEffects(t);
  const frozen = [], poisoned = [], heals = [];
  t.mock.method(core.CombatFactory, "freezeTicks", (_target, ticks) => frozen.push(ticks));
  t.mock.method(core.CombatFactory, "poisonEntity", (_target, severity) => poisoned.push(severity));
  t.mock.method(core.Misc, "getRandom", () => 0);
  let attack = 100;
  const target = { isPlayer: () => true, getSkillManager: () => ({ getCurrentLevel: () => attack, getMaxLevel: () => 100,
    setCurrentLevelCombat: (_skill, value) => { attack = value; }, updateSkill() {} }) };
  for (const weapon of [I.ANCIENT_STAFF, I.ANCIENT_SCEPTRE, I.ANCIENT_SCEPTRE_L_]) {
    const enhanced = weapon !== I.ANCIENT_STAFF;
    const cast = playerWith(weapon);
    cast.heal = (damage) => heals.push(damage);
    for (const [index, tier] of ["RUSH", "BURST", "BLITZ", "BARRAGE"].entries()) {
      for (const family of ["ICE", "SMOKE", "BLOOD", "SHADOW"]) {
        attack = 100;
        const spell = core.CombatSpells[`${family}_${tier}`];
        const baseEffect = spell.spellEffectOnHitCalc;
        let calls = 0;
        const check = t.mock.method(spell, "spellEffectOnHitCalc", function (...args) {
          calls++;
          assert.equal(args[3], enhanced ? 1.1 : 1);
          baseEffect.apply(this, args);
        });
        const before = [frozen.length, poisoned.length, heals.length];
        spell.onHitCalc(ancientHit(cast, target));
        assert.equal(calls, 1, `${family}_${tier}: base callback is preserved`);
        assert.deepEqual([frozen.length, poisoned.length, heals.length], before.map((n, i) => n + Number(family === ["ICE", "SMOKE", "BLOOD"][i])));
        if (family === "SHADOW") {
          assert.equal(attack, index < 2 ? (enhanced ? 89 : 90) : (enhanced ? 84 : 85));
          spell.onHitCalc(ancientHit(cast, target));
          assert.equal(attack, index < 2 ? (enhanced ? 89 : 90) : (enhanced ? 84 : 85), "does not stack");
        }
        check.mock.restore();
      }
      assert.equal(frozen.at(-1), (enhanced ? [8, 17, 26, 35] : [8, 16, 24, 32])[index]);
      assert.equal(poisoned.at(-1), (index < 2 ? 10 : 20) * (enhanced ? 1.1 : 1));
      assert.equal(heals.at(-1), enhanced ? 11 : 10);
    }
  }
});

test("sceptre effects preserve later quest vetoes, misses, non-ancient effects and smoke's poison roll", (t) => {
  let veto = false;
  sceptreEffects(t, (event) => { if (veto) event.allowed = false; });
  let healed = 0, poisoned = 0;
  const cast = playerWith(I.ANCIENT_SCEPTRE);
  cast.heal = (damage) => { healed += damage; };
  t.mock.method(core.CombatFactory, "poisonEntity", () => poisoned++);
  t.mock.method(core.Misc, "getRandom", (upper) => { assert.equal(upper, 7); return 7; });
  const npc = { isPlayer: () => false, getAsNpc: () => npc, getCurrentLevel: () => 100, getMaxLevel: () => 100,
    setCurrentLevels: () => { throw new Error("vetoed Shadow must not drain"); } };
  veto = true;
  core.CombatSpells.BLOOD_BARRAGE.onHitCalc(ancientHit(cast, npc));
  core.CombatSpells.SHADOW_BARRAGE.onHitCalc(ancientHit(cast, npc));
  veto = false;
  core.CombatSpells.BLOOD_BARRAGE.onHitCalc(ancientHit(cast, npc, 40, false));
  assert.equal(healed, 0);
  core.CombatSpells.SMOKE_BARRAGE.onHitCalc(ancientHit(cast, npc));
  assert.equal(poisoned, 0, "sceptre does not force poisoning");
  t.mock.method(core.CombatSpells.FIRE_SURGE, "spellEffectOnHitCalc", (_cast, _target, _damage, multiplier) => {
    assert.equal(multiplier, 1, "non-ancient base effects are untouched");
    healed++;
  });
  core.CombatSpells.FIRE_SURGE.onHitCalc(ancientHit(cast, npc));
  assert.equal(healed, 1);
});

test("ancient sceptre's Shadow supplement drains NPC Attack once after the base effect", (t) => {
  sceptreEffects(t);
  let level = 100, baseCalls = 0;
  const target = { isPlayer: () => false, getAsNpc: () => target, getMaxLevel: () => 100,
    getCurrentLevel: () => level, setCurrentLevels: (_skill, value) => { assert.ok(baseCalls > 0); level = value; },
  };
  const spell = core.CombatSpells.SHADOW_BARRAGE;
  const baseEffect = spell.spellEffectOnHitCalc;
  t.mock.method(spell, "spellEffectOnHitCalc", function (...args) { baseCalls++; baseEffect.apply(this, args); });
  const hit = ancientHit(playerWith(I.ANCIENT_SCEPTRE), target, 10);
  spell.onHitCalc(hit);
  assert.equal(level, 84);
  spell.onHitCalc(hit);
  assert.equal(level, 84, "shadow drain does not stack");
  assert.equal(baseCalls, 2, "base callback is never suppressed");
});

test("sceptre ice durations use whole real timer ticks and retain freeze immunity", (t) => {
  sceptreEffects(t);
  const { TimerRepository } = require("../dist/util/timers/TimerRepository");
  const { TimerKey } = require("../dist/util/timers/TimerKey");
  const cast = playerWith(I.ANCIENT_SCEPTRE);
  for (const [tier, ticks] of [["RUSH", 8], ["BURST", 17], ["BLITZ", 26], ["BARRAGE", 35]]) {
    const timers = new TimerRepository();
    const target = { isPlayer: () => false, getTimers: () => timers, getSize: () => 1, getMovementQueue: () => ({ reset() {} }) };
    core.CombatSpells[`ICE_${tier}`].onHitCalc(ancientHit(cast, target));
    assert.equal(timers.getTicks(TimerKey.FREEZE), ticks);
    assert.equal(timers.getTicks(TimerKey.FREEZE_IMMUNITY), ticks + 5);
    timers.process();
    core.CombatSpells[`ICE_${tier}`].onHitCalc(ancientHit(cast, target));
    assert.equal(timers.getTicks(TimerKey.FREEZE), ticks - 1, "existing freeze is not refreshed");
    for (let i = 1; i < ticks; i++) timers.process();
    assert.equal(timers.has(TimerKey.FREEZE), false, "expires after exactly the Wiki tick count");
    core.CombatSpells[`ICE_${tier}`].onHitCalc(ancientHit(cast, target));
    assert.equal(timers.has(TimerKey.FREEZE), false, "immunity prevents immediate refreezing");
  }
});
