/**
 * Server-driven NPC body-model overrides (OSRS npc model customisation), e.g. Araxxor's
 * venom-coated legs on enrage.
 *
 * The server names no new NPC type: it sends slot -> replacement model ids for an existing
 * type. The client turns each distinct override into a synthetic type id (mirroring the
 * custom-items system) so the whole render pipeline - square keys, model caches - keys on
 * it without any further changes. Resolve them through CustomNpcTypeLoader.
 */
export type NpcModelOverride = { slot: number; modelId: number };

/** Synthetic ids start well above any cache npc id (the cache tops out far below this). */
const SYNTHETIC_BASE = 0x40000000;

const overrides = new Map<number, { baseId: number; models: NpcModelOverride[] }>();
const idsByKey = new Map<string, number>();
let nextSyntheticId = SYNTHETIC_BASE;

function keyOf(baseId: number, models: NpcModelOverride[]): string {
    return `${baseId | 0}:${models.map((entry) => `${entry.slot | 0}=${entry.modelId | 0}`).join(",")}`;
}

/** The synthetic type id for these overrides, registering them once per distinct set. */
export function registerNpcModelOverride(baseId: number, models: NpcModelOverride[]): number {
    const key = keyOf(baseId, models);
    const existing = idsByKey.get(key);
    if (existing !== undefined) {
        return existing;
    }
    const id = nextSyntheticId++;
    overrides.set(id, { baseId: baseId | 0, models: models.map((entry) => ({ slot: entry.slot | 0, modelId: entry.modelId | 0 })) });
    idsByKey.set(key, id);
    return id;
}

/**
 * Registers a synthetic id decided elsewhere (the main thread's render instance carries it
 * to the worker, which is a separate thread with its own copy of this module).
 */
export function registerNpcModelOverrideWithId(id: number, baseId: number, models: NpcModelOverride[]): void {
    if (overrides.has(id | 0)) {
        return;
    }
    overrides.set(id | 0, {
        baseId: baseId | 0,
        models: models.map((entry) => ({ slot: entry.slot | 0, modelId: entry.modelId | 0 })),
    });
}

/** The overrides behind a synthetic id, or undefined for real cache types. */
export function npcModelOverrideFor(id: number): { baseId: number; models: NpcModelOverride[] } | undefined {
    return overrides.get(id | 0);
}

/** The cache type id behind a (possibly synthetic) type id. */
export function baseNpcTypeId(id: number): number {
    return overrides.get(id | 0)?.baseId ?? (id | 0);
}

export function isSyntheticNpcTypeId(id: number): boolean {
    return overrides.has(id | 0);
}
