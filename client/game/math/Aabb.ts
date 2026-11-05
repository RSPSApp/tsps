import { sampleActorHeightForWorldTile, sampleBridgeHeightForWorldTile } from "../scene/BridgeHeightSampler";
import { BridgePlaneStrategy } from "../scene/PlaneResolver";

export interface Aabb {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

export type LocSizeCache = Map<number, { sizeX: number; sizeY: number }>;
export type LocInteractiveCache = Map<number, boolean>;

function getLocSize(
    locId: number,
    loader: any,
    cache: LocSizeCache | undefined,
): { sizeX: number; sizeY: number } | undefined {
    const key = locId | 0;
    if (cache?.has(key)) return cache.get(key);
    if (!loader?.load) return undefined;
    try {
        const loc = loader.load(key);
        if (!loc) return undefined;
        const sizeX = Math.max(1, typeof loc.sizeX === "number" ? loc.sizeX : 1);
        const sizeY = Math.max(1, typeof loc.sizeY === "number" ? loc.sizeY : 1);
        const size = { sizeX, sizeY };
        cache?.set(key, size);
        return size;
    } catch {
        return undefined;
    }
}

function isLocInteractive(
    locId: number,
    loader: any,
    varManager: any,
    cache: LocInteractiveCache | undefined,
): boolean {
    const key = locId | 0;
    const cached = cache?.get(key);
    if (cached !== undefined) return cached;
    if (!loader?.load) {
        cache?.set(key, false);
        return false;
    }

    let result = false;
    try {
        let lt = loader.load(key);
        if (lt?.transforms) {
            const t = lt.transform(varManager, loader);
            if (t) lt = t;
        }
        if (lt) {
            if (Array.isArray(lt.actions)) {
                for (const a of lt.actions) {
                    if (a && a.length > 0) {
                        result = true;
                        break;
                    }
                }
            }
            if (!result) {
                result = (lt.isInteractive | 0) === 1;
            }
        }
    } catch {
        result = false;
    }

    cache?.set(key, result);
    return result;
}

export function buildLocAabb(params: {
    locId: number;
    tileX: number;
    tileY: number;
    level: number;
    mapManager: any;
    locTypeLoader: any;
    varManager: any;
    locSizeCache?: LocSizeCache;
    locInteractiveCache?: LocInteractiveCache;
    planeStrategy?: BridgePlaneStrategy;
}): Aabb | undefined {
    const strategy =
        params.planeStrategy !== undefined ? params.planeStrategy : BridgePlaneStrategy.RENDER;
    if (
        !isLocInteractive(
            params.locId,
            params.locTypeLoader,
            params.varManager,
            params.locInteractiveCache,
        )
    ) {
        return undefined;
    }

    const size = getLocSize(params.locId, params.locTypeLoader, params.locSizeCache);
    const sizeX = Math.max(1, size && typeof size.sizeX === "number" ? size.sizeX : 1);
    const sizeY = Math.max(1, size && typeof size.sizeY === "number" ? size.sizeY : 1);

    // Inflate footprint to cope with unknown orientation; use larger dimension and resize.
    let resizeX = 1.0;
    let resizeY = 1.0;
    let resizeZ = 1.0;
    try {
        let lt = params.locTypeLoader?.load?.(params.locId | 0);
        if (lt?.transforms) {
            const t = lt.transform(params.varManager, params.locTypeLoader);
            if (t) lt = t;
        }
        if (lt) {
            if (typeof lt.resizeX === "number") resizeX = Math.max(0.25, lt.resizeX / 128);
            if (typeof lt.resizeY === "number") resizeY = Math.max(0.25, lt.resizeY / 128);
            if (typeof lt.resizeZ === "number") resizeZ = Math.max(0.25, lt.resizeZ / 128);
        }
    } catch {}

    // Keep 1x1 decor tight; inflate larger/rotated footprints.
    const useTight = sizeX <= 1 && sizeY <= 1;
    const baseFoot = useTight ? sizeX : Math.max(sizeX, sizeY);
    const footprintScale = useTight ? 1 : Math.max(resizeX, resizeY);
    const widthTight = Math.min(1.0, Math.max(0.45, sizeX * resizeX * 0.9));
    const depthTight = Math.min(1.0, Math.max(0.45, sizeY * resizeY * 0.9));
    const width = useTight ? widthTight : baseFoot * footprintScale;
    const depth = useTight ? depthTight : baseFoot * footprintScale;
    const centerX = params.tileX + sizeX * 0.5;
    const centerZ = params.tileY + sizeY * 0.5;
    const minX = centerX - width * 0.5;
    const maxX = centerX + width * 0.5;
    const minZ = centerZ - depth * 0.5;
    const maxZ = centerZ + depth * 0.5;

    const h00 = sampleBridgeHeightForWorldTile(
        params.mapManager,
        minX + 0.001,
        minZ + 0.001,
        params.level,
        strategy,
    ).height;
    const h11 = sampleBridgeHeightForWorldTile(
        params.mapManager,
        maxX - 0.001,
        maxZ - 0.001,
        params.level,
        strategy,
    ).height;

    const h01 = sampleBridgeHeightForWorldTile(
        params.mapManager,
        minX + 0.001,
        maxZ - 0.001,
        params.level,
        strategy,
    ).height;
    const h10 = sampleBridgeHeightForWorldTile(
        params.mapManager,
        maxX - 0.001,
        minZ + 0.001,
        params.level,
        strategy,
    ).height;

    const groundY = Math.min(h00, h11, h01, h10);
    const baseHeight = useTight
        ? Math.max(0.4, Math.min(1.0, 0.6 * resizeZ || 1.0))
        : Math.max(2.5, (sizeX + sizeY) * 0.6);
    const height = useTight ? baseHeight : Math.max(baseHeight, baseHeight * resizeZ);
    const topY = groundY - height;

    return {
        minX,
        minY: Math.min(groundY, topY),
        minZ,
        maxX,
        maxY: Math.max(groundY, topY),
        maxZ,
    };
}

export function buildGroundItemAabb(params: {
    tileX: number;
    tileY: number;
    level: number;
    mapManager: any;
    planeStrategy?: BridgePlaneStrategy;
}): Aabb {
    const strategy =
        params.planeStrategy !== undefined ? params.planeStrategy : BridgePlaneStrategy.RENDER;
    const hSample = sampleBridgeHeightForWorldTile(
        params.mapManager,
        params.tileX + 0.5,
        params.tileY + 0.5,
        params.level,
        strategy,
    );
    const groundY = hSample.height;
    return {
        minX: params.tileX,
        minY: groundY - 0.2,
        minZ: params.tileY,
        maxX: params.tileX + 1,
        maxY: groundY + 0.1,
        maxZ: params.tileY + 1,
    };
}

export function buildNpcAabb(params: {
    worldX: number;
    worldZ: number;
    level: number;
    size: number;
    mapManager: any;
    planeStrategy?: BridgePlaneStrategy;
    npcTypeId?: number;
    npcTypeLoader?: any;
}): Aabb {
    const strategy =
        params.planeStrategy !== undefined ? params.planeStrategy : BridgePlaneStrategy.RENDER;
    // Allow npc resize from type data when available
    let resizeX = 1.0;
    let resizeY = 1.0;
    let resizeZ = 1.0;
    if (params.npcTypeId != null && params.npcTypeLoader?.load) {
        try {
            const t = params.npcTypeLoader.load(params.npcTypeId | 0);
            if (t) {
                if (typeof t.resizeX === "number") resizeX = Math.max(0.25, t.resizeX / 128);
                if (typeof t.resizeY === "number") resizeY = Math.max(0.25, t.resizeY / 128);
                if (typeof t.resizeZ === "number") resizeZ = Math.max(0.25, t.resizeZ / 128);
            }
        } catch {}
    }
    const horizScale = Math.max(resizeX, resizeY);
    // Keep NPC click bounds tighter than a full tile to reduce false-positive hover hits.
    const half = Math.max(0.32, params.size * 0.42 * horizScale);
    const hSample = sampleActorHeightForWorldTile(
        params.mapManager,
        params.worldX,
        params.worldZ,
        params.level,
        strategy,
    );
    const groundY = hSample.height;
    // Scale height with NPC size and resize so large models aren't under-bounded.
    const height = Math.max(1.55, params.size * 1.1 * resizeZ);
    return {
        minX: params.worldX - half,
        minY: groundY - height,
        minZ: params.worldZ - half,
        maxX: params.worldX + half,
        maxY: groundY - 0.05,
        maxZ: params.worldZ + half,
    };
}

export function buildPlayerAabb(params: {
    worldX: number;
    worldZ: number;
    level: number;
    mapManager: any;
    planeStrategy?: BridgePlaneStrategy;
    half?: number;
}): Aabb {
    const strategy =
        params.planeStrategy !== undefined ? params.planeStrategy : BridgePlaneStrategy.RENDER;
    const half = typeof params.half === "number" ? params.half : 0.6;
    const hSample = sampleActorHeightForWorldTile(
        params.mapManager,
        params.worldX,
        params.worldZ,
        params.level,
        strategy,
    );
    const groundY = hSample.height;
    const topY = groundY - 2.5;
    return {
        minX: params.worldX - half,
        minY: Math.min(groundY, topY),
        minZ: params.worldZ - half,
        maxX: params.worldX + half,
        maxY: Math.max(groundY, topY),
        maxZ: params.worldZ + half,
    };
}
