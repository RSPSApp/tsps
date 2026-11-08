// custom-items.json `specialAttack`: the client gives the custom weapon an entry in enum 906 (the
// cache's special attack weapons), so the combat tab shows its special attack bar.
import assert from "node:assert/strict";

import { CustomItemRegistry } from "../custom/items/CustomItemRegistry";
import { SPECIAL_ATTACK_ENUM, customSpecialAttackCost } from "../custom/items/CustomSpecialAttacks";

const objType = { name: "Test weapon" } as any;
CustomItemRegistry.clear();
CustomItemRegistry.register({ id: 50101, objType, specialAttack: { from: 29000 } });
CustomItemRegistry.register({ id: 50102, objType, specialAttack: { from: 29000, energy: 35 } });
CustomItemRegistry.register({ id: 50103, objType });
CustomItemRegistry.register({ id: 50104, objType, specialAttack: { from: 1277 } });

const cache = new Map([[29000, 500]]);
const baseCost = (from: number) => cache.get(from);

assert.equal(SPECIAL_ATTACK_ENUM, 906);
assert.equal(customSpecialAttackCost(50101, baseCost), 500, "the named weapon's cost");
assert.equal(customSpecialAttackCost(50102, baseCost), 350, "its own energy, in tenths of a percent");
assert.equal(customSpecialAttackCost(50103, baseCost), undefined, "no specialAttack: the cache answers");
assert.equal(customSpecialAttackCost(50104, baseCost), undefined, "a named weapon without a special and no energy");
assert.equal(customSpecialAttackCost(4151, baseCost), undefined, "a cache weapon: the cache answers");
CustomItemRegistry.clear();

console.log("custom special attacks: ok");
