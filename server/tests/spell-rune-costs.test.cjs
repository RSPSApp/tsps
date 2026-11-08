const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();

// Rune ids (cache): air 556, water 555, earth 557, fire 554, mind 558, body 559, death 560, nature 561,
// chaos 562, cosmic 564, blood 565, soul 566, wrath 21880.
const AIR = 556, WATER = 555, EARTH = 557, FIRE = 554, MIND = 558, BODY = 559, DEATH = 560, NATURE = 561,
  CHAOS = 562, COSMIC = 564, BLOOD = 565, SOUL = 566, WRATH = 21880;

// OSRS Wiki: Standard spellbook, Ancient Magicks and Arceuus spellbook (spell pages for Fire Strike, Claws of
// Guthix, Flames of Zamorak, Stun, Ice Rush, Smoke Burst, Inferior Demonbane): level, XP, base max hit, runes.
const SPELLS = {
  WIND_STRIKE: [1, 5.5, 2, { [AIR]: 1, [MIND]: 1 }],
  CONFUSE: [3, 13, 0, { [EARTH]: 2, [WATER]: 3, [BODY]: 1 }],
  WATER_STRIKE: [5, 7.5, 4, { [AIR]: 1, [WATER]: 1, [MIND]: 1 }],
  EARTH_STRIKE: [9, 9.5, 6, { [AIR]: 1, [EARTH]: 2, [MIND]: 1 }],
  WEAKEN: [11, 21, 0, { [EARTH]: 2, [WATER]: 3, [BODY]: 1 }],
  FIRE_STRIKE: [13, 11.5, 8, { [AIR]: 2, [FIRE]: 3, [MIND]: 1 }],
  WIND_BOLT: [17, 13.5, 9, { [AIR]: 2, [CHAOS]: 1 }],
  CURSE: [19, 29, 0, { [EARTH]: 3, [WATER]: 2, [BODY]: 1 }],
  BIND: [20, 31, 0, { [EARTH]: 3, [WATER]: 3, [NATURE]: 2 }],
  WATER_BOLT: [23, 16.5, 10, { [AIR]: 2, [WATER]: 2, [CHAOS]: 1 }],
  EARTH_BOLT: [29, 19.5, 11, { [AIR]: 2, [EARTH]: 3, [CHAOS]: 1 }],
  FIRE_BOLT: [35, 22.5, 12, { [AIR]: 3, [FIRE]: 4, [CHAOS]: 1 }],
  CRUMBLE_UNDEAD: [39, 24.5, 15, { [AIR]: 2, [EARTH]: 2, [CHAOS]: 1 }],
  WIND_BLAST: [41, 25.5, 13, { [AIR]: 3, [DEATH]: 1 }],
  WATER_BLAST: [47, 28.5, 14, { [AIR]: 3, [WATER]: 3, [DEATH]: 1 }],
  IBAN_BLAST: [50, 30, 25, { [FIRE]: 5, [DEATH]: 1 }],
  SNARE: [50, 61, 2, { [EARTH]: 4, [WATER]: 4, [NATURE]: 3 }],
  EARTH_BLAST: [53, 31.5, 15, { [AIR]: 3, [EARTH]: 4, [DEATH]: 1 }],
  FIRE_BLAST: [59, 34.5, 16, { [AIR]: 4, [FIRE]: 5, [DEATH]: 1 }],
  SARADOMIN_STRIKE: [60, 35, 20, { [AIR]: 4, [FIRE]: 2, [BLOOD]: 2 }],
  CLAWS_OF_GUTHIX: [60, 35, 20, { [AIR]: 4, [FIRE]: 1, [BLOOD]: 2 }],
  FLAMES_OF_ZAMORAK: [60, 35, 20, { [AIR]: 1, [FIRE]: 4, [BLOOD]: 2 }],
  WIND_WAVE: [62, 36, 17, { [AIR]: 5, [BLOOD]: 1 }],
  WATER_WAVE: [65, 37.5, 18, { [AIR]: 5, [WATER]: 7, [BLOOD]: 1 }],
  VULNERABILITY: [66, 76, 0, { [EARTH]: 5, [WATER]: 5, [SOUL]: 1 }],
  EARTH_WAVE: [70, 40, 19, { [AIR]: 5, [EARTH]: 7, [BLOOD]: 1 }],
  ENFEEBLE: [73, 83, 0, { [EARTH]: 8, [WATER]: 8, [SOUL]: 1 }],
  FIRE_WAVE: [75, 42.5, 20, { [AIR]: 5, [FIRE]: 7, [BLOOD]: 1 }],
  ENTANGLE: [79, 89, 5, { [EARTH]: 5, [WATER]: 5, [NATURE]: 4 }],
  STUN: [80, 90, 0, { [EARTH]: 12, [WATER]: 12, [SOUL]: 1 }],
  CHARGE: [80, 180, null, { [AIR]: 3, [FIRE]: 3, [BLOOD]: 3 }],
  WIND_SURGE: [81, 44.5, 21, { [AIR]: 7, [WRATH]: 1 }],
  WATER_SURGE: [85, 46.5, 22, { [AIR]: 7, [WATER]: 10, [WRATH]: 1 }],
  EARTH_SURGE: [90, 48.2, 23, { [AIR]: 7, [EARTH]: 10, [WRATH]: 1 }],
  FIRE_SURGE: [95, 50.5, 24, { [AIR]: 7, [FIRE]: 10, [WRATH]: 1 }],
  SMOKE_RUSH: [50, 30, 13, { [AIR]: 1, [FIRE]: 1, [CHAOS]: 2, [DEATH]: 2 }],
  SHADOW_RUSH: [52, 31, 14, { [AIR]: 1, [CHAOS]: 2, [DEATH]: 2, [SOUL]: 1 }],
  BLOOD_RUSH: [56, 33, 15, { [BLOOD]: 1, [CHAOS]: 2, [DEATH]: 2 }],
  ICE_RUSH: [58, 34, 16, { [WATER]: 2, [CHAOS]: 2, [DEATH]: 2 }],
  SMOKE_BURST: [62, 36, 17, { [AIR]: 2, [FIRE]: 2, [CHAOS]: 4, [DEATH]: 2 }],
  SHADOW_BURST: [64, 37, 18, { [AIR]: 1, [CHAOS]: 4, [DEATH]: 2, [SOUL]: 2 }],
  BLOOD_BURST: [68, 39, 21, { [BLOOD]: 2, [CHAOS]: 4, [DEATH]: 2 }],
  ICE_BURST: [70, 40, 22, { [WATER]: 4, [CHAOS]: 4, [DEATH]: 2 }],
  SMOKE_BLITZ: [74, 42, 23, { [AIR]: 2, [FIRE]: 2, [BLOOD]: 2, [DEATH]: 2 }],
  SHADOW_BLITZ: [76, 43, 24, { [AIR]: 2, [BLOOD]: 2, [DEATH]: 2, [SOUL]: 2 }],
  BLOOD_BLITZ: [80, 45, 25, { [BLOOD]: 4, [DEATH]: 2 }],
  ICE_BLITZ: [82, 46, 26, { [WATER]: 3, [BLOOD]: 2, [DEATH]: 2 }],
  SMOKE_BARRAGE: [86, 48, 27, { [AIR]: 4, [FIRE]: 4, [BLOOD]: 2, [DEATH]: 4 }],
  SHADOW_BARRAGE: [88, 49, 28, { [AIR]: 4, [BLOOD]: 2, [DEATH]: 4, [SOUL]: 3 }],
  BLOOD_BARRAGE: [92, 51, 29, { [BLOOD]: 4, [DEATH]: 4, [SOUL]: 1 }],
  ICE_BARRAGE: [94, 52, 30, { [WATER]: 6, [BLOOD]: 2, [DEATH]: 4 }],
  GHOSTLY_GRASP: [35, 22.5, 12, { [AIR]: 4, [CHAOS]: 1 }],
  INFERIOR_DEMONBANE: [44, 27, 16, { [FIRE]: 3, [CHAOS]: 1 }],
  SKELETAL_GRASP: [56, 33, 17, { [EARTH]: 8, [DEATH]: 1 }],
  SUPERIOR_DEMONBANE: [62, 36, 23, { [FIRE]: 5, [SOUL]: 1 }],
  UNDEAD_GRASP: [79, 46.5, 24, { [FIRE]: 12, [BLOOD]: 1 }],
  DARK_DEMONBANE: [82, 43.5, 30, { [FIRE]: 7, [SOUL]: 2 }],
  MARK_OF_DARKNESS: [59, 70, null, { [COSMIC]: 1, [SOUL]: 1 }],
  LESSER_CORRUPTION: [64, 75, null, { [DEATH]: 1, [SOUL]: 2 }],
  GREATER_CORRUPTION: [85, 95, null, { [BLOOD]: 1, [SOUL]: 3 }],
  DARK_LURE: [50, 60, null, { [DEATH]: 1, [NATURE]: 1 }],
};

for (const [name, [level, xp, maxHit, runes]] of Object.entries(SPELLS)) {
  test(`${name} matches the Wiki level, XP, max hit and runes`, () => {
    const spell = core.CombatSpells[name];
    assert.ok(spell, `${name} exists`);
    assert.equal(spell.levelRequired(), level);
    assert.equal(spell.baseExperience(), xp);
    if (maxHit !== null) assert.equal(spell.maximumHit(), maxHit);
    const cost = {};
    for (const item of spell.itemsRequired({})) cost[item.getId()] = (cost[item.getId()] ?? 0) + item.getAmount();
    assert.deepEqual(cost, runes);
  });
}
