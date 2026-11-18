/**
 * Server-driven NPC type overrides for one NPC: OSRS npc model customisation (slot swaps, e.g.
 * Araxxor's venom-coated legs on enrage) and the type customisation (body customisation, name
 * change and level change, e.g. a Leagues Echo boss: the normal boss with the Echo's models,
 * name and combat level).
 *
 * The server names no new NPC type: it sends changes to an existing type. The client turns each
 * distinct set into a synthetic type id (mirroring the custom-items system) so the whole render
 * pipeline and the menus - square keys, model caches, names, combat levels - key on it without
 * further changes. Resolve them through CustomNpcTypeLoader.
 */
export type NpcModelOverride = { slot: number; modelId: number };

/** A type customisation: each field replaces the type's own (recolours: an empty list clears them). */
export type NpcTypeCustomisation = {
    models?: number[];
    recolours?: Array<{ from: number; to: number }>;
    name?: string;
    combatLevel?: number;
};

export type NpcOverride = { baseId: number; models: NpcModelOverride[]; type?: NpcTypeCustomisation };

/** Synthetic ids start well above any cache npc id (the cache tops out far below this). */
const SYNTHETIC_BASE = 0x40000000;

const overrides = new Map<number, NpcOverride>();
const idsByKey = new Map<string, number>();
let nextSyntheticId = SYNTHETIC_BASE;

function copy(baseId: number, models: NpcModelOverride[], type?: NpcTypeCustomisation): NpcOverride {
    return {
        baseId: baseId | 0,
        models: models.map((entry) => ({ slot: entry.slot | 0, modelId: entry.modelId | 0 })),
        ...(type ? { type: structuredClone(type) } : {}),
    };
}

function keyOf(override: NpcOverride): string {
    return JSON.stringify([override.baseId, override.models.map((entry) => [entry.slot, entry.modelId]), override.type ?? null]);
}

/** The synthetic type id for these overrides, registering them once per distinct set. */
export function registerNpcModelOverride(baseId: number, models: NpcModelOverride[], type?: NpcTypeCustomisation): number {
    const override = copy(baseId, models, type);
    const key = keyOf(override);
    const existing = idsByKey.get(key);
    if (existing !== undefined) {
        return existing;
    }
    const id = nextSyntheticId++;
    overrides.set(id, override);
    idsByKey.set(key, id);
    return id;
}

/**
 * Registers a synthetic id decided elsewhere (the main thread's render instance carries it
 * to the worker, which is a separate thread with its own copy of this module).
 */
export function registerNpcModelOverrideWithId(id: number, baseId: number, models: NpcModelOverride[], type?: NpcTypeCustomisation): void {
    if (overrides.has(id | 0)) {
        return;
    }
    overrides.set(id | 0, copy(baseId, models, type));
}

/** The overrides behind a synthetic id, or undefined for real cache types. */
export function npcModelOverrideFor(id: number): NpcOverride | undefined {
    return overrides.get(id | 0);
}

/** The cache type id behind a (possibly synthetic) type id. */
export function baseNpcTypeId(id: number): number {
    return overrides.get(id | 0)?.baseId ?? (id | 0);
}

export function isSyntheticNpcTypeId(id: number): boolean {
    return overrides.has(id | 0);
}
