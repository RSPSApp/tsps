import assert from "assert";
import { EquipmentSlot, withActionSeqHandItems, withSeqHandItems } from "../rs/config/player/Equipment";
import { PlayerAppearance } from "../rs/config/player/PlayerAppearance";

const app = new PlayerAppearance(0, [0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6]);

// No held items: the same appearance, so its cache key and base model are reused.
assert.strictEqual(withSeqHandItems(app, { leftHandItem: -1, rightHandItem: -1 }), app);
assert.strictEqual(withSeqHandItems(app, undefined), app);

// Net fishing holds the small net (303) in the weapon hand; the cache stores ids offset by 512.
const netting = withSeqHandItems(app, { leftHandItem: -1, rightHandItem: 303 + 512 });
assert.strictEqual(netting.equip[EquipmentSlot.WEAPON], 303);
assert.strictEqual(netting.equip[EquipmentSlot.SHIELD], -1);
assert.notStrictEqual(netting.getCacheKey(), app.getCacheKey());
assert.strictEqual(app.equip[EquipmentSlot.WEAPON], -1, "the player's own appearance is untouched");

// Ids past 1024 (a dragon harpoon) only lose the one offset.
assert.strictEqual(withSeqHandItems(app, { leftHandItem: 21028 + 512, rightHandItem: -1 }).equip[EquipmentSlot.SHIELD], 21028);

// 0 empties a hand: carpet_sit_down puts the weapon and shield away.
const armed = new PlayerAppearance(0, [0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6], (() => { const e = new Array(14).fill(-1); e[EquipmentSlot.WEAPON] = 4151; e[EquipmentSlot.SHIELD] = 1201; return e; })());
const seated = withSeqHandItems(armed, { leftHandItem: 0, rightHandItem: 0 });
assert.strictEqual(seated.equip[EquipmentSlot.WEAPON], -1);
assert.strictEqual(seated.equip[EquipmentSlot.SHIELD], -1);

// Native Actor.dp() supplies a sequence to PlayerComposition only once its start delay is zero.
const handOverrides = { leftHandItem: 0, rightHandItem: 0 };
assert.strictEqual(withActionSeqHandItems(armed, handOverrides, 749, 30), armed);
assert.strictEqual(withActionSeqHandItems(armed, handOverrides, 749, 1), armed);
const squeezing = withActionSeqHandItems(armed, handOverrides, 749, 0);
assert.strictEqual(squeezing.equip[EquipmentSlot.WEAPON], -1);
assert.strictEqual(squeezing.equip[EquipmentSlot.SHIELD], -1);
assert.strictEqual(withActionSeqHandItems(armed, handOverrides, -1), armed);
assert.strictEqual(withActionSeqHandItems(armed, handOverrides, 749, 0, true), armed);

// An NPC-transformed player draws the NPC, not held items.
const transformed = new PlayerAppearance(0, [0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6], undefined, undefined, 172);
assert.strictEqual(withSeqHandItems(transformed, { leftHandItem: -1, rightHandItem: 815 }), transformed);

console.log("seq-hand-items ok");
