// Use the combat engine's integer rolls and inclusive hit-chance formula. Each
// projection has its own formula cache and never changes the actual player's
// stance, selected spell, special toggle, target, weapon or ammunition.
function baseAccuracy(core, player, npc) {
  const { BonusManager: B, CombatType, AccuracyFormulasDpsCalc: formula } = core;
  const fight = player.getFightType();
  const selected = fight.getBonusType();
  const melee = [B.ATTACK_STAB, B.ATTACK_SLASH, B.ATTACK_CRUSH];
  const bonuses = player.getBonusManager().getAttackBonus();
  const meleeBonus = melee.includes(selected) ? selected : melee.reduce((best, index) =>
    (bonuses[index] ?? 0) > (bonuses[best] ?? 0) ? index : best);
  const meleeName = ['stab', 'slash', 'crush'][melee.indexOf(meleeBonus)];
  const result = [];
  for (const [name, type, bonus] of [['Melee', CombatType.MELEE, meleeBonus],
    ['Ranged', CombatType.RANGED, B.ATTACK_RANGE], ['Magic', CombatType.MAGIC, B.ATTACK_MAGIC]]) {
    // A different combat type receives no Accurate/Controlled stance bonus.
    // Magic retains its own powered-staff check only when Magic is selected.
    const sameType = type === CombatType.MELEE ? melee.includes(selected) : selected === bonus;
    const projectedFight = { getBonusType: () => bonus,
      getStyle: () => sameType ? fight.getStyle() : core.FightStyle.DEFENSIVE };
    let view;
    const overrides = { getAsPlayer: () => view, getFightType: () => projectedFight,
      isSpecialActivated: () => false, getCombatSpecial: () => null, combatSpecial: null };
    view = new Proxy(player, { get(target, key) {
      if (Object.hasOwn(overrides, key)) return overrides[key];
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }, set() { throw new Error('Accuracy previews are read-only'); } });
    const rolls = formula.specialRolls(view, npc, type, undefined, undefined, undefined, true);
    result.push({ name, type, meleeStyle: type === CombatType.MELEE ? meleeName : undefined,
      chance: rolls && Number.isFinite(rolls.attack) && Number.isFinite(rolls.defence)
        // Native rollAccuracy clamps inclusive dice bounds at zero. Equipment
        // can take Magic accuracy below -64; that is zero chance, never negative.
        ? formula.hitChance(Math.max(0, rolls.attack), Math.max(0, rolls.defence)) : null });
  }
  return result;
}
module.exports = { baseAccuracy };
