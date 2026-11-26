import { IndexType } from "../../rs/cache/IndexType";
import type { CacheSystem } from "../../rs/cache/CacheSystem";
import { retryOnMissingGroup } from "../../rs/cache/js5/retryOnMissingGroup";
import { compositeMapFileFor, worldMapGroupId } from "../../rs/map/WorldMapArea";

/**
 * An area's whole-map picture (world map group "compositetexture", one PNG per area), which the
 * client draws as the map overview (WorldMapRenderer.drawOverview). The main area's is 768x544
 * for 3072x2176 tiles. Ours: it is also drawn under the map's tiles, stretched over the area,
 * so a square whose tile is still rendering shows the area's colours instead of black.
 */
export type WorldMapCompositeTexture = {
    key: string;
    pixels: Uint8Array;
    width: number;
    height: number;
};

export type DecodeImage = (
    bytes: Uint8Array,
) => Promise<{ pixels: Uint8Array; width: number; height: number } | undefined>;

const RETRY_MS = 2500;

/** PNG/JPEG bytes to RGBA pixels with the browser's decoder. */
export const decodeImageWithBrowser: DecodeImage = async (bytes) => {
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
        return undefined;
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const image = await createImageBitmap(new Blob([copy.buffer]));
    try {
        const width = image.width | 0;
        const height = image.height | 0;
        if (width <= 0 || height <= 0) return undefined;
        const context = new OffscreenCanvas(width, height).getContext("2d");
        if (!context) return undefined;
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, width, height).data;
        return { pixels: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width, height };
    } finally {
        image.close?.();
    }
};

export class WorldMapCompositeTextures {
    private readonly loaded = new Map<number, WorldMapCompositeTexture | null>();
    private readonly pending = new Set<number>();
    private readonly failedAt = new Map<number, number>();
    private generation = 0;

    constructor(
        private readonly getCacheSystem: () => CacheSystem | undefined,
        private readonly onLoaded: () => void,
        private readonly evictTextureKey: (key: string) => void,
        private readonly decodeImage: DecodeImage = decodeImageWithBrowser,
    ) {}

    /** The area's composite texture, or undefined while it loads (or when it has none). */
    get(area: { id: number; internalName: string } | undefined): WorldMapCompositeTexture | undefined {
        if (!area) return undefined;
        const areaId = area.id | 0;
        const cached = this.loaded.get(areaId);
        if (cached !== undefined) return cached ?? undefined;
        if (this.pending.has(areaId)) return undefined;
        const failedAt = this.failedAt.get(areaId);
        if (failedAt !== undefined && performance.now() - failedAt < RETRY_MS) return undefined;
        this.load(area);
        return undefined;
    }

    clear(): void {
        this.generation++;
        for (const texture of this.loaded.values()) {
            if (texture) this.evictTextureKey(texture.key);
        }
        this.loaded.clear();
        this.pending.clear();
        this.failedAt.clear();
    }

    private load(area: { id: number; internalName: string }): void {
        const areaId = area.id | 0;
        const generation = this.generation;
        this.pending.add(areaId);
        void (async () => {
            const cache = this.getCacheSystem();
            if (!cache) return undefined;
            // Waits for the group to stream in when the cache is sparse.
            const file = await retryOnMissingGroup(() => {
                const index = cache.getIndex(IndexType.OSRS.worldMap);
                const groupId = worldMapGroupId(index, "compositetexture");
                if (groupId < 0) return null;
                return compositeMapFileFor(index.getArchive(groupId), area) ?? null;
            });
            if (file === undefined) throw new Error("composite texture group never arrived");
            if (!file) return null;
            const data = file.data as Int8Array;
            return this.decodeImage(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        })()
            .then((image) => {
                if (generation !== this.generation) return;
                if (image === undefined) {
                    this.failedAt.set(areaId, performance.now());
                    return;
                }
                const valid =
                    image &&
                    image.width > 0 &&
                    image.height > 0 &&
                    image.pixels.length >= image.width * image.height * 4;
                this.loaded.set(
                    areaId,
                    valid
                        ? {
                              key: `worldmap-composite:${areaId}:${generation}`,
                              pixels: image.pixels,
                              width: image.width | 0,
                              height: image.height | 0,
                          }
                        : null,
                );
                if (valid) this.onLoaded();
            })
            .catch((error) => {
                if (generation !== this.generation) return;
                console.log("[WorldMapCompositeTextures] Failed to load composite texture", { areaId, error });
                this.failedAt.set(areaId, performance.now());
            })
            .finally(() => {
                if (generation === this.generation) this.pending.delete(areaId);
            });
    }
}
