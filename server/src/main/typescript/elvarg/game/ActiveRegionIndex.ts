import type { Player } from "./entity/impl/player/Player";

export interface ActiveRegionInfo {
    key: string;
    regionX: number;
    regionY: number;
    z: number;
    lastActiveAtMs: number;
}

export interface ActiveRegionSnapshot {
    processCycle: number;
    updatedAtMs: number;
    radius: number;
    regions: ActiveRegionInfo[];
    regionKeys: string[];
}

export class ActiveRegionIndex {
    private static readonly HISTORY_RETENTION_MS = 15 * 60 * 1000;

    private readonly radius: number;
    private readonly lastActiveAtByKey = new Map<string, number>();
    private currentRegionKeys = new Set<string>();
    private processCycle = 0;
    private updatedAtMs = 0;

    constructor(radius: number) {
        this.radius = Math.max(0, Math.floor(radius));
    }

    private static getRegionKey(regionX: number, regionY: number, z: number): string {
        return `${z}:${regionX}:${regionY}`;
    }

    private static parseRegionKey(key: string): { z: number; regionX: number; regionY: number } | null {
        const [zRaw, xRaw, yRaw] = String(key).split(":");
        const z = Number(zRaw);
        const regionX = Number(xRaw);
        const regionY = Number(yRaw);
        if (!Number.isInteger(z) || !Number.isInteger(regionX) || !Number.isInteger(regionY)) {
            return null;
        }
        return { z, regionX, regionY };
    }

    private pruneHistory(nowMs: number): void {
        const cutoff = nowMs - ActiveRegionIndex.HISTORY_RETENTION_MS;
        for (const [key, lastActiveAtMs] of this.lastActiveAtByKey.entries()) {
            if (this.currentRegionKeys.has(key)) {
                continue;
            }
            if (lastActiveAtMs < cutoff) {
                this.lastActiveAtByKey.delete(key);
            }
        }
    }

    /**
     * `alsoAt` gives a second place a player keeps awake: the main-world tile under a player on a
     * boat deck, so the sea round a sailing player (storm clouds, ships' crews) is processed too.
     */
    update(
        players: Iterable<Player>,
        includePlayer: (player: Player) => boolean,
        processCycle: number,
        nowMs: number,
        alsoAt?: (player: Player) => { getX(): number; getY(): number; getZ(): number } | undefined,
        allPlanes = false,
    ): ActiveRegionSnapshot {
        const nextKeys = new Set<string>();
        const mark = (location: { getX(): number; getY(): number; getZ(): number }) => {
            const baseRegionX = location.getX() >> 6;
            const baseRegionY = location.getY() >> 6;
            const planes = allPlanes && location.getZ() >= 0 && location.getZ() < 4 ? [0, 1, 2, 3] : [location.getZ()];
            for (const z of planes) for (let dx = -this.radius; dx <= this.radius; dx++) {
                for (let dy = -this.radius; dy <= this.radius; dy++) {
                    const key = ActiveRegionIndex.getRegionKey(baseRegionX + dx, baseRegionY + dy, z);
                    nextKeys.add(key);
                    this.lastActiveAtByKey.set(key, nowMs);
                }
            }
        };
        for (const player of players) {
            if (!player || includePlayer(player) !== true) {
                continue;
            }
            const location = player.getLocation?.();
            if (!location) {
                continue;
            }
            mark(location);
            const other = alsoAt?.(player);
            if (other && (other.getX() >> 6 !== location.getX() >> 6 || other.getY() >> 6 !== location.getY() >> 6 || other.getZ() !== location.getZ())) {
                mark(other);
            }
        }

        this.currentRegionKeys = nextKeys;
        this.processCycle = processCycle;
        this.updatedAtMs = nowMs;
        this.pruneHistory(nowMs);
        return this.getSnapshot();
    }

    isRegionKeyActive(key: string): boolean {
        return this.currentRegionKeys.has(key);
    }

    isLocationActive(x: number, y: number, z: number): boolean {
        return this.isRegionKeyActive(ActiveRegionIndex.getRegionKey(x >> 6, y >> 6, z));
    }

    getLastActiveAtForLocation(x: number, y: number, z: number): number | null {
        const value = this.lastActiveAtByKey.get(ActiveRegionIndex.getRegionKey(x >> 6, y >> 6, z));
        return Number.isFinite(value) ? Number(value) : null;
    }

    getActiveRegionKeys(): Set<string> {
        return new Set(this.currentRegionKeys);
    }

    getSnapshot(): ActiveRegionSnapshot {
        const regions: ActiveRegionInfo[] = [];
        for (const key of this.currentRegionKeys) {
            const parsed = ActiveRegionIndex.parseRegionKey(key);
            if (!parsed) {
                continue;
            }
            regions.push({
                key,
                z: parsed.z,
                regionX: parsed.regionX,
                regionY: parsed.regionY,
                lastActiveAtMs: Number(this.lastActiveAtByKey.get(key) ?? this.updatedAtMs),
            });
        }
        regions.sort((a, b) => a.z - b.z || a.regionX - b.regionX || a.regionY - b.regionY);
        return {
            processCycle: this.processCycle,
            updatedAtMs: this.updatedAtMs,
            radius: this.radius,
            regions,
            regionKeys: regions.map((region) => region.key),
        };
    }
}
