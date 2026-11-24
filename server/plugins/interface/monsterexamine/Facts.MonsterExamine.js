const { plain } = require('./Drops.MonsterExamine');
const { baseAccuracy } = require('./Accuracy.MonsterExamine');
const COLOR = { heading: 'ffd27f', value: 'e8ded0', muted: 'b9ab96', good: '80df91', low: 'ff8f83', caution: 'edbd6e' };
function color(value, tint = COLOR.value) { return `<col=${tint}>${plain(value, 240)}</col>`; }
function heading(label) { return ['', color(label, COLOR.heading)]; }
function bonus(value) { return color(`${value >= 0 ? '+' : ''}${value}`, value > 0 ? COLOR.good : value < 0 ? COLOR.low : COLOR.muted); }
function level(current, max) { return color(`${current}/${max}`, current < max ? COLOR.low : current > max ? COLOR.good : COLOR.value); }
function summary(npc, definition) {
  const healthColor = npc.getHitpoints() * 4 < npc.getMaxHitpoints() ? COLOR.low : COLOR.good;
  return `${color(`Level ${definition.getCombatLevel()}`, COLOR.heading)}    HP ${color(`${npc.getHitpoints()}/${npc.getMaxHitpoints()}`, healthColor)}`;
}

function combatFacts(core, player, npc, definition) {
  const { Skill } = core;
  const lines = [color(definition.getExamine(), COLOR.muted), ...heading('Combat levels'),
    `Hitpoints: ${level(npc.getHitpoints(), npc.getMaxHitpoints())}`];
  for (const [label, skill] of [['Attack', Skill.ATTACK], ['Strength', Skill.STRENGTH],
    ['Defence', Skill.DEFENCE], ['Ranged', Skill.RANGED], ['Magic', Skill.MAGIC]]) {
    lines.push(`${label}: ${level(npc.getCurrentLevel(skill), npc.getMaxLevel(skill))}`);
  }
  lines.push(...heading('Attacks'),
    `Speed: ${color(`${npc.getBaseAttackSpeed()} ticks / ${(npc.getBaseAttackSpeed() * 0.6).toFixed(1)}s`)}`,
    `Default style: ${color(definition.getAttackStyle() || 'Unknown')}`,
    `Current base max hit: ${color(npc.getCurrentMaxHit(definition.getAttackType()), COLOR.caution)}`);
  for (const hit of definition.getMaxHits().slice(0, 10)) {
    lines.push(`${plain(hit.label || 'Source max', 48)}: ${color(hit.value, COLOR.caution)}`);
  }
  const stats = definition.getStats();
  lines.push(...heading('Attack bonuses'), `Melee ${bonus(stats[5] ?? 0)}   Ranged ${bonus(stats[9] ?? 0)}`,
    `Magic ${bonus(stats[7] ?? 0)}`, ...heading('Defence bonuses'));
  for (const [label, index] of [['Stab', 0], ['Slash', 1], ['Crush', 2], ['Magic', 3], ['Ranged', 4]]) {
    lines.push(`${label}: ${bonus(npc.getDefenceBonus(index))}`);
  }
  const light = npc.getDefenceBonus(4, 'light'), heavy = npc.getDefenceBonus(4, 'heavy');
  if (light !== npc.getDefenceBonus(4) || heavy !== npc.getDefenceBonus(4)) {
    lines.push(`Light ${bonus(light)}   Heavy ${bonus(heavy)}`);
  }
  lines.push(...heading('Your accuracy'));
  for (const roll of baseAccuracy(core, player, npc)) {
    lines.push(`${color(roll.name, COLOR.heading)} base hit chance: ${roll.chance === null ? 'Unavailable'
      : color(`${(roll.chance * 100).toFixed(1)}%`, COLOR.good)}`);
  }
  lines.push(...heading('Requirements & traits'), `Slayer level: ${color(definition.getSlayerLevel())}`,
    `Poison immune: ${color(definition.isPoisonImmune() ? 'Yes' : 'No', definition.isPoisonImmune() ? COLOR.good : COLOR.muted)}`,
    `Venom immune: ${color(definition.isVenomImmune() ? 'Yes' : 'No', definition.isVenomImmune() ? COLOR.good : COLOR.muted)}`,
    `Freeze resistance: ${color(`${definition.getFreezeResistance()}%`)}`);
  const weakness = definition.getElementalWeakness();
  if (weakness) lines.push(`Weakness: ${color(`${['', 'Air', 'Water', 'Earth', 'Fire'][weakness.type]} +${weakness.percent}%`, COLOR.good)}`);
  if (definition.getAttributes().length) lines.push(color(definition.getAttributes().join(', '), COLOR.caution));
  return lines;
}
module.exports = { combatFacts, summary };
