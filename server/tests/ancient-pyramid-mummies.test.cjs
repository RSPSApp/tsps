const assert = require("node:assert/strict");
const plugin = require("../plugins/areas/AncientPyramidMummies.plugin");

const handlers = [];
const events = [];
const api = {
  core: {
    NpcIdentifiers: { MUMMY_2: 720, MUMMY_3: 721, MUMMY_4: 722, MUMMY_5: 723, MUMMY_7: 725, MUMMY_8: 726, MUMMY_9: 727, MUMMY_10: 728 },
    CombatType: { MAGIC: 2 },
    CombatSpells: { FIRE_STRIKE: {}, WATER_STRIKE: {}, ICE_BARRAGE: {} },
  },
  onCombatHitResolved(handler) { handlers.push(handler); },
  emitCustomEvent(name, event) { events.push({ name, event }); },
};
plugin.register(api);
const [hitResolved] = handlers;
const player = {};
const attacker = { isPlayer: () => true, getAsPlayer: () => player };
function target(id) {
  return { isNpc: () => true, id, getId() { return this.id; }, setNpcTransformationId(next) { this.id = next; } };
}
function hit(spell, damage = 1, accurate = true) {
  return { getCombatType: () => 2, getSpell: () => spell, getTotalDamage: () => damage, isAccurate: () => accurate };
}

for (const [base, lit] of [[720, 725], [721, 726], [722, 727], [723, 728]]) {
  const mummy = target(base);
  hitResolved({ attacker, target: mummy, hit: hit(api.core.CombatSpells.FIRE_STRIKE) });
  assert.equal(mummy.id, lit);
  hitResolved({ attacker, target: mummy, hit: hit(api.core.CombatSpells.WATER_STRIKE) });
  assert.equal(mummy.id, base);
}
assert.equal(events.length, 4);
assert.ok(events.every(({ name, event }) => name === "league:complete-task" && event.player === player && event.id === "set-a-mummy-ablaze"));

const splash = target(720);
hitResolved({ attacker, target: splash, hit: hit(api.core.CombatSpells.FIRE_STRIKE, 0) });
assert.equal(splash.id, 720);
hitResolved({ attacker, target: splash, hit: hit(api.core.CombatSpells.ICE_BARRAGE) });
assert.equal(splash.id, 720);
