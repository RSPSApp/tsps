import assert from "assert";
import type { NpcType } from "../rs/config/npctype/NpcType";
import type { NpcTypeLoader } from "../rs/config/npctype/NpcTypeLoader";
import { CustomNpcTypeLoader } from "../custom/npcs/CustomNpcTypeLoader";
import { baseNpcTypeId, isSyntheticNpcTypeId, registerNpcModelOverride } from "../custom/npcs/NpcModelOverrideRegistry";

const base = { id: 13668, name: "Araxxor", size: 7, modelIds: [54289, 54290] } as unknown as NpcType;
const loader = { load: (id: number) => (id === 13668 ? base : (undefined as unknown as NpcType)), getCount: () => 16576, clearCache: () => {} } as NpcTypeLoader;

const custom = new CustomNpcTypeLoader(loader);
const synthetic = registerNpcModelOverride(13668, [{ slot: 0, modelId: 54288 }, { slot: 1, modelId: 54290 }]);

assert.strictEqual(isSyntheticNpcTypeId(synthetic), true);
assert.strictEqual(baseNpcTypeId(synthetic), 13668);
assert.strictEqual(custom.load(13668), base, "real ids fall through untouched");

const enraged = custom.load(synthetic);
assert.strictEqual(enraged.name, "Araxxor", "everything but the models is the cache's");
assert.strictEqual(enraged.size, 7);
assert.deepStrictEqual(enraged.modelIds, [54288, 54290], "slot 0 becomes the venomous model");
assert.strictEqual(enraged.id, synthetic, "the clone carries the synthetic id (model caches key on it)");
assert.strictEqual(custom.load(synthetic), enraged, "resolved once, then cached");

const sameAgain = registerNpcModelOverride(13668, [{ slot: 0, modelId: 54288 }, { slot: 1, modelId: 54290 }]);
assert.strictEqual(sameAgain, synthetic, "the same override set resolves to the same id");
console.log("npc model customisation passed");
