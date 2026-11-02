import assert from "node:assert/strict";
import { test } from "node:test";
import { combatLevel, formatPreciseCombatLevel, nextCombatLevels, preciseCombatLevel, wildernessCombatRange } from "../game/plugins/combatlevel/CombatLevel";
import { CombatLevelPlugin } from "../game/plugins/combatlevel/CombatLevelPlugin";

const all99 = { attack: 99, strength: 99, defence: 99, hitpoints: 99, ranged: 99, prayer: 99, magic: 99 };

test("combat level reaches 126 at all 99s and 125 with 98 defence", () => {
    assert.equal(combatLevel(all99), 126);
    assert.equal(combatLevel({ ...all99, defence: 98 }), 125);
});

test("odd ranged and magic levels use the integer half-level RuneScape formula", () => {
    const rangedWins = { attack: 1, strength: 1, defence: 1, hitpoints: 10, ranged: 3, prayer: 1, magic: 1 };
    const magicWins = { ...rangedWins, ranged: 1, magic: 3 };
    assert.equal(preciseCombatLevel(rangedWins), 4.05);
    assert.equal(preciseCombatLevel(magicWins), 4.05);
    assert.equal(combatLevel(rangedWins), 4);
    assert.equal(combatLevel(magicWins), 4);
});

test("combat calculation matches the server formula for mixed stats", () => {
    const skills = { attack: 1, defence: 1, strength: 99, hitpoints: 65, ranged: 99, prayer: 1, magic: 99 };
    assert.equal(preciseCombatLevel(skills), 64.6);
    assert.equal(combatLevel(skills), 64);
});

test("level 99 account receives level 99, not virtual levels", () => {
    assert.equal(combatLevel({ attack: 99, strength: 99, defence: 99, hitpoints: 99, ranged: 99, prayer: 99, magic: 99 }), 126);
});

test("wilderness bounds clamp to valid combat levels", () => {
    assert.deepEqual(wildernessCombatRange(3, 1), { min: 3, max: 4 });
    assert.deepEqual(wildernessCombatRange(60, 0), { min: 60, max: 60 });
    assert.deepEqual(wildernessCombatRange(126, 60), { min: 66, max: 126 });
});

test("boosted levels do not enter the base-level formula", () => {
    const base = { attack: 60, strength: 60, defence: 60, hitpoints: 60, ranged: 60, prayer: 60, magic: 60 };
    const boostedAttack = 75;
    assert.equal(combatLevel(base), combatLevel({ ...base, attack: base.attack }));
    assert.notEqual(combatLevel(base), combatLevel({ ...base, attack: boostedAttack }));
});

test("precise level preserves fractions and next-level helper gives skill thresholds", () => {
    const novice = { attack: 1, strength: 1, defence: 1, hitpoints: 10, ranged: 1, prayer: 1, magic: 1 };
    assert.equal(combatLevel(novice), 3);
    assert.equal(formatPreciseCombatLevel(preciseCombatLevel(novice)), "3.4");
    assert.deepEqual(nextCombatLevels(novice), { melee: 2, defenceHitpoints: 3, ranged: 2, magic: 2, prayer: 5 });
    assert.deepEqual(nextCombatLevels(all99), {});
});

test("plugin follows RuneLite's default-enabled configuration", () => {
    assert.equal(CombatLevelPlugin.descriptor.enabledByDefault, true);
    assert.equal(CombatLevelPlugin.descriptor.configKey, "combatlevelplugin");
});
