import type { CosmeticNpc } from "../ScenePresentation";

export interface DistantSpawn { key: string; typeId: number; x: number; y: number; plane: number; name: string; radius?: number; rotation?: number }
export type Tile = { x: number; y: number; plane: number };
export const distanceTo = (a: Tile, b: Tile): number => a.plane === b.plane ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : Infinity;
export const MAX_DISTANT_SPAWNS = 1024;
const MAX_CATALOG_PAGES = MAX_DISTANT_SPAWNS / 32;

/** Wire validation and presentation state contain no authoritative entities. */
export class DistantWorldState {
    spawns: DistantSpawn[] = [];
    links = new Map<string, number>();
    viewDistance = 15;
    supported = true;
    request = -1;
    truncated = false;
    private assembly?: { request: number; parts: number; viewDistance: unknown; supported: unknown; truncated: unknown; pages: Map<number, Record<string, unknown>> };
    clear(): void { this.spawns = []; this.links.clear(); this.request = -1; this.truncated = false; this.assembly = undefined; }

    accept(data: Record<string, unknown>, request: number): boolean {
        if (data.type !== "catalog" || data.request !== request) return false;
        if (data.parts !== undefined) {
            const parts = Number(data.parts), part = Number(data.part);
            if (!Number.isInteger(parts) || parts < 1 || parts > MAX_CATALOG_PAGES || !Number.isInteger(part) || part < 0 || part >= parts
                || !Array.isArray(data.spawns) || data.spawns.length > 32 || !Array.isArray(data.links) || data.links.length > 32) return false;
            if (this.assembly?.request !== request) this.assembly = { request, parts, viewDistance: data.viewDistance, supported: data.supported, truncated: data.truncated, pages: new Map() };
            const assembly = this.assembly;
            if (assembly.parts !== parts || assembly.viewDistance !== data.viewDistance || assembly.supported !== data.supported || assembly.truncated !== data.truncated || assembly.pages.has(part)) return false;
            assembly.pages.set(part, data);
            if (assembly.pages.size !== parts) return false;
            const pages = [...assembly.pages.entries()].sort((a, b) => a[0] - b[0]).map(entry => entry[1]);
            this.assembly = undefined;
            return this.accept({ ...data, parts: undefined, part: undefined, spawns: pages.flatMap(page => page.spawns as unknown[]), links: pages.flatMap(page => page.links as unknown[]) }, request);
        }
        if (data.type !== "catalog" || data.request !== request || !Array.isArray(data.spawns) || data.spawns.length > MAX_DISTANT_SPAWNS || !Array.isArray(data.links) || data.links.length > 255) return false;
        const spawns: DistantSpawn[] = [], keys = new Set<string>();
        for (const raw of data.spawns) {
            if (!raw || typeof raw !== "object") return false;
            const s = raw as DistantSpawn;
            if (typeof s.key !== "string" || s.key.length > 100 || keys.has(s.key) || !Number.isInteger(s.typeId) || s.typeId < 0
                || !Number.isInteger(s.x) || s.x < 0 || s.x > 16383 || !Number.isInteger(s.y) || s.y < 0 || s.y > 16383
                || !Number.isInteger(s.plane) || s.plane < 0 || s.plane > 3 || typeof s.name !== "string") return false;
            keys.add(s.key);
            spawns.push({ key: s.key, typeId: s.typeId, x: s.x, y: s.y, plane: s.plane, radius: Math.max(0, Math.min(32, Number(s.radius) || 0)),
                ...(Number.isInteger(s.rotation) && s.rotation! >= 0 && s.rotation! <= 2047 ? { rotation: s.rotation } : {}),
                name: s.name.replace(/<[^>]*>/g, "").slice(0, 80) });
        }
        const links = new Map<string, number>();
        for (const raw of data.links) {
            const link = raw as { key?: string; index?: number };
            if (!link || typeof link.key !== "string" || !keys.has(link.key) || !Number.isInteger(link.index) || link.index! <= 0 || link.index! > 65534) return false;
            links.set(link.key, link.index!);
        }
        if (!Number.isInteger(data.viewDistance) || Number(data.viewDistance) < 1 || Number(data.viewDistance) > 127) return false;
        this.spawns = spawns; this.links = links;
        this.viewDistance = Number(data.viewDistance); this.supported = data.supported === true; this.request = request;
        this.truncated = data.truncated === true;
        return true;
    }

    visible(player: Tile, distance: number, limit: number, isLinked: (index: number) => boolean,
        priority: (spawn: DistantSpawn) => number = () => 0): DistantSpawn[] {
        return this.spawns.map(spawn => ({ spawn, distance: distanceTo(player, spawn) }))
            .filter(s => s.distance > this.viewDistance + 3 && s.distance <= distance && !isLinked(this.links.get(s.spawn.key) ?? -1))
            .map(s => ({ ...s, priority: priority(s.spawn) }))
            .sort((a, b) => a.priority - b.priority || a.distance - b.distance).slice(0, limit).map(s => s.spawn);
    }
}

/** Shared quantized poses keep identical NPCs from requesting a distinct mesh every frame. */
export function idleFrame(lengths: readonly number[], now: number, phase = 0): number {
    const total = lengths.reduce((sum, n) => sum + Math.max(1, n), 0);
    if (total <= 0) return 0;
    let cycle = (Math.floor(now / 100) * 5 + phase) % total;
    for (let i = 0; i < lengths.length; i++) { cycle -= Math.max(1, lengths[i]); if (cycle < 0) return i; }
    return 0;
}

export function cosmeticActor(spawn: DistantSpawn, size: number, seqId: number, frameId: number): CosmeticNpc {
    return { key: spawn.key, typeId: spawn.typeId, x: spawn.x + size / 2, y: spawn.y + size / 2,
        plane: spawn.plane, rotation: spawn.rotation ?? 0, seqId, frameId };
}
