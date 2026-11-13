export const NPC_SPAWN_REQUEST_MESSAGE = "elvarg:npc-spawns-request";
export const NPC_SPAWN_MESSAGE = "elvarg:npc-spawns";
export const CUSTOM_NPC_SPAWNS_MESSAGE = "elvarg:custom-npc-spawns";
export type BrowserHostNpcSpawn = {
    id: number;
    tileX: number;
    tileY: number;
    plane: number;
    direction?: number;
    /** Wandering range; 0 anchors the NPC. Omitted means the server default. */
    wanderRadius?: number;
    /** Marks a persisted game spawn as removed rather than added. */
    remove?: boolean;
};
export type NpcSpawnRequestMessage = { type: typeof NPC_SPAWN_REQUEST_MESSAGE; regionIds: number[] };
export type NpcSpawnMessage = { type: typeof NPC_SPAWN_MESSAGE; regionIds: number[]; spawns: BrowserHostNpcSpawn[] };
export type CustomNpcSpawnsMessage = { type: typeof CUSTOM_NPC_SPAWNS_MESSAGE; spawns: BrowserHostNpcSpawn[] };

/** One edited spawn, in the on-disk npc-spawns.json shape. */
export type EditedNpcSpawn = {
    id: number;
    x: number;
    y: number;
    level: number;
    direction?: number;
    wanderRadius?: number;
    remove?: boolean;
};

export function regionIdForTile(tileX: number, tileY: number): number {
    return ((tileX >> 6) << 8) | (tileY >> 6);
}

/** Identity of a persisted spawn, used to hide and restore it across map reloads. */
export function npcSpawnKey(spawn: { id: number; tileX: number; tileY: number; plane: number }): string {
    return `${spawn.id}:${spawn.tileX}:${spawn.tileY}:${spawn.plane}`;
}

/**
 * One spawn record from npc-spawns.json or its editor patch. Entries named by
 * an NpcIdentifiers `key` have no numeric id here (the client has no
 * identifiers table), so they are skipped.
 */
export type NpcSpawnRecord = {
    id: number;
    tileX: number;
    tileY: number;
    plane: number;
    direction?: number;
    wanderRadius?: number;
    remove?: boolean;
};

/**
 * How the server's loader reads each record of a saved patch over the canonical spawns
 * (NpcSpawnDefinitionLoader: spawns sharing a tile pair one for one). A remove drops one spawn with its key and
 * frees a slot that the patch's next record with the key fills ("add"); otherwise a record replaces one canonical
 * spawn still standing ("override"), or is a new spawn when none is left ("add").
 */
export function classifyNpcSpawnPatch(
    canonical: readonly { id: number; tileX: number; tileY: number; plane: number }[],
    records: readonly NpcSpawnRecord[],
): Array<"remove" | "override" | "add"> {
    const canonicalLeft = new Map<string, number>();
    for (const spawn of canonical) {
        const key = npcSpawnKey(spawn);
        canonicalLeft.set(key, (canonicalLeft.get(key) ?? 0) + 1);
    }
    const added = new Map<string, number>();
    const freed = new Map<string, number>();
    return records.map((record) => {
        const key = npcSpawnKey(record);
        const left = canonicalLeft.get(key) ?? 0;
        if (record.remove) {
            // The oldest surviving spawn goes first: a canonical one, then an earlier addition.
            if (left > 0) canonicalLeft.set(key, left - 1);
            else if ((added.get(key) ?? 0) > 0) added.set(key, (added.get(key) ?? 0) - 1);
            else return "remove";
            freed.set(key, (freed.get(key) ?? 0) + 1);
            return "remove";
        }
        const credit = freed.get(key) ?? 0;
        if (credit === 0 && left > 0) {
            canonicalLeft.set(key, left - 1);
            return "override";
        }
        if (credit > 0) freed.set(key, credit - 1);
        added.set(key, (added.get(key) ?? 0) + 1);
        return "add";
    });
}

/**
 * Spawns the editor hides, counted per key: each removal marker hides one spawn of a stacked tile, as the
 * server's loader drops one per remove record, so the other spawns there stay visible and selectable.
 */
export class HiddenNpcSpawns {
    private readonly counts = new Map<string, number>();

    hide(key: string): void {
        this.counts.set(key, this.count(key) + 1);
    }

    show(key: string): void {
        const count = this.count(key) - 1;
        if (count > 0) this.counts.set(key, count);
        else this.counts.delete(key);
    }

    count(key: string): number {
        return this.counts.get(key) ?? 0;
    }

    /** The spawns left once each key's hidden count is skipped (the first ones with that key). */
    visible<T extends { id: number; tileX: number; tileY: number; plane: number }>(spawns: readonly T[]): T[] {
        const skipped = new Map<string, number>();
        return spawns.filter((spawn) => {
            const key = npcSpawnKey(spawn);
            const done = skipped.get(key) ?? 0;
            if (done >= this.count(key)) return true;
            skipped.set(key, done + 1);
            return false;
        });
    }
}

/** A loaded spawn and the client id it shows under; `hidden`: suppressed by a removal marker. */
export type LoadedNpcSpawnEntry<T> = { spawn: T; serverId: number; hidden?: boolean };

/**
 * A region's spawns as loaded entries. The ones a removal marker already hides are kept too, hidden, with a
 * reserved id, so undoing that marker (showNpcSpawn) can bring them back without reloading the region.
 */
export function loadNpcSpawnRegion<T extends { id: number; tileX: number; tileY: number; plane: number }>(
    spawns: readonly T[],
    hidden: HiddenNpcSpawns,
    spawnNpc: (spawn: T) => number | undefined,
    reserveId: () => number,
): LoadedNpcSpawnEntry<T>[] {
    // As HiddenNpcSpawns.visible: each key's first `count` spawns are the hidden ones.
    const skipped = new Map<string, number>();
    return spawns.flatMap((spawn): LoadedNpcSpawnEntry<T>[] => {
        const key = npcSpawnKey(spawn);
        const done = skipped.get(key) ?? 0;
        if (done < hidden.count(key)) {
            skipped.set(key, done + 1);
            return [{ spawn, serverId: reserveId(), hidden: true }];
        }
        const serverId = spawnNpc(spawn);
        return serverId === undefined ? [] : [{ spawn, serverId }];
    });
}

export function parseNpcSpawnRecords(contents: string): NpcSpawnRecord[] {
    if (typeof contents !== "string" || contents.length > 20_000_000) throw new Error("Invalid npc-spawns.json");
    const parsed = JSON.parse(contents);
    const integer = (value: unknown, max: number) =>
        Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
    if (!Array.isArray(parsed) || parsed.some((spawn) =>
        !spawn
        || !integer(spawn.x, 0x3fff)
        || !integer(spawn.y, 0x3fff)
        || !integer(spawn.level, 3)
        || (!integer(spawn.id, 0x7fffffff) && typeof spawn.key !== "string")
        || (spawn.direction !== undefined && !integer(spawn.direction, 7))
        || (spawn.wanderRadius !== undefined && !integer(spawn.wanderRadius, 255))
        || (spawn.remove !== undefined && typeof spawn.remove !== "boolean")
    )) throw new Error("Invalid npc-spawns.json");
    return parsed.flatMap((spawn): NpcSpawnRecord[] => {
        if (!integer(spawn.id, 0x7fffffff)) return [];
        return [{
            id: spawn.id,
            tileX: spawn.x,
            tileY: spawn.y,
            plane: spawn.level,
            ...(Number.isInteger(spawn.direction) ? { direction: spawn.direction } : {}),
            ...(Number.isInteger(spawn.wanderRadius) ? { wanderRadius: spawn.wanderRadius } : {}),
            ...(spawn.remove === true ? { remove: true } : {}),
        }];
    });
}

/** The playable spawns in a file; removal markers are dropped. */
export function parseNpcSpawns(contents: string): BrowserHostNpcSpawn[] {
    return parseNpcSpawnRecords(contents).flatMap((record): BrowserHostNpcSpawn[] => {
        if (record.remove) return [];
        return [{
            id: record.id,
            tileX: record.tileX,
            tileY: record.tileY,
            plane: record.plane,
            ...(record.direction === undefined ? {} : { direction: record.direction }),
            ...(record.wanderRadius === undefined ? {} : { wanderRadius: record.wanderRadius }),
        }];
    });
}

export function formatCustomNpcSpawns(spawns: readonly EditedNpcSpawn[]): string {
    return spawns.length ? "[\n" + spawns.map((spawn) => "  " + JSON.stringify(spawn)).join(",\n") + "\n]\n" : "[]\n";
}
