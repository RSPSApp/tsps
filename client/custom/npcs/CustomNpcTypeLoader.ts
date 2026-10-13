import type { NpcType } from "../../rs/config/npctype/NpcType";
import type { NpcTypeLoader } from "../../rs/config/npctype/NpcTypeLoader";
import { npcModelOverrideFor } from "./NpcModelOverrideRegistry";

/**
 * Wrapping NpcTypeLoader that resolves the synthetic ids registered by
 * NpcModelOverrideRegistry: a clone of the base type with the overridden model slots
 * replaced. Everything else (name, size, animations) stays the cache's.
 */
export class CustomNpcTypeLoader implements NpcTypeLoader {
    private readonly customCache = new Map<number, NpcType>();

    constructor(private readonly base: NpcTypeLoader) {}

    load(id: number): NpcType {
        const override = npcModelOverrideFor(id);
        if (!override) {
            return this.base.load(id);
        }
        const cached = this.customCache.get(id);
        if (cached) {
            return cached;
        }
        console.info("[npc-models] resolving synthetic type", id, "base", override.baseId, "models", JSON.stringify(override.models));
        const baseType = this.base.load(override.baseId);
        const clone = Object.assign(Object.create(Object.getPrototypeOf(baseType)), baseType) as NpcType;
        const models = (baseType.modelIds ?? []).slice();
        for (const entry of override.models) {
            if (entry.slot >= 0 && entry.slot < models.length) {
                models[entry.slot] = entry.modelId | 0;
            }
        }
        clone.modelIds = models;
        (clone as { id: number }).id = id | 0;
        this.customCache.set(id, clone);
        return clone;
    }

    getCount(): number {
        return this.base.getCount();
    }

    clearCache(): void {
        this.customCache.clear();
        this.base.clearCache();
    }
}
