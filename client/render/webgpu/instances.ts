/**
 * Instanced areas (REBUILD_REGION) for the WebGPU backend: port of render/render/instance.ts.
 *
 * While an instance is active the scene is one map square, built by the worker from the 13x13
 * template chunk grid (104 tiles, rendered at the instance's world base), and normal map
 * streaming is suppressed. Builds are sequenced: only the latest build's scene is applied, and
 * WebGPURenderer.applyInstanceScene swaps it in for whatever was drawn in a single frame.
 */
import { Scene } from "../../rs/scene/Scene";
import type { SdMapData } from "../loader/SdMapData";
import type { WebGPURenderer } from "./WebGPURenderer";

export class WebGPUInstances {
    /** Bumped per build (and on clear); only the latest build's result is applied. */
    private buildSeq = 0;
    private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
    private builtScene: SdMapData | null = null;

    constructor(private readonly renderer: WebGPURenderer) {}

    async load(templateChunks: number[][][], regionX: number, regionY: number): Promise<void> {
        const r = this.renderer;
        if (!r.osrsClient.loadedCache) return;

        // The server replays its spawned locs after every rebuild.
        r.addedLocs.clear();
        r.locOverrides.clear();
        r.locSpawns.clear();

        r.instanceActive = true;
        r.instanceTemplateChunks = templateChunks;
        r.instanceRegionX = regionX;
        r.instanceRegionY = regionY;

        // The current scene stays drawn while the new one builds. LOC_ADD_CHANGE packets arrive
        // right after REBUILD_REGION in the same batch: start once they are in, so the scene is
        // built once, with them.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!r.instanceActive || r.instanceTemplateChunks !== templateChunks) return;
        this.cancelRebuild();
        await this.build();
    }

    /** Rebuilds the scene with the current loc state, debounced (locs arrive in bursts). */
    scheduleLocRebuild(): void {
        this.cancelRebuild();
        this.rebuildTimer = setTimeout(() => {
            this.rebuildTimer = null;
            if (this.renderer.instanceActive && this.renderer.instanceTemplateChunks) void this.build();
        }, 100);
    }

    /** The latest finished build, once; the renderer applies it. */
    takeBuiltScene(): SdMapData | null {
        const scene = this.builtScene;
        this.builtScene = null;
        return scene;
    }

    clear(): void {
        const r = this.renderer;
        this.buildSeq++;
        this.cancelRebuild();
        this.builtScene = null;
        r.instanceActive = false;
        r.instanceSceneMap = null;
        r.instanceTemplateChunks = null;
        r.addedLocs.clear();
        r.locOverrides.clear();
        r.locSpawns.clear();
        r.osrsClient.clearMinimapImageUrls();
    }

    private cancelRebuild(): void {
        if (this.rebuildTimer !== null) {
            clearTimeout(this.rebuildTimer);
            this.rebuildTimer = null;
        }
    }

    private async build(): Promise<void> {
        const r = this.renderer;
        const templateChunks = r.instanceTemplateChunks;
        if (!templateChunks) return;
        const build = ++this.buildSeq;
        const regionX = r.instanceRegionX;
        const regionY = r.instanceRegionY;
        // regionX/Y are chunk coordinates: the player tile is regionX * 8, its square tile / 64.
        const mapData = await r
            .loadSceneData({
                mapX: ((regionX * 8) / Scene.MAP_SQUARE_SIZE) | 0,
                mapY: ((regionY * 8) / Scene.MAP_SQUARE_SIZE) | 0,
                maxLevel: Scene.MAX_LEVELS - 1,
                loadNpcs: false,
                smoothTerrain: true,
                ...r.osrsClient.clientPlugins.objectSettings(),
                minimizeDrawCalls: true,
                instance: { templateChunks, regionX, regionY },
                locOverrides: r.locOverrides,
                locSpawns: r.locSpawns,
                terrainOverrides: r.terrainOverrides,
                mapRegionReplacements: r.mapRegionReplacements,
                // The scene builder keeps the ones inside the instance's bounds.
                extraLocs: r.getExtraLocs(),
            })
            .catch((error) => {
                console.error("[webgpu] instance scene build failed", error);
                return undefined;
            });
        if (build !== this.buildSeq || !r.instanceActive) return;
        if (mapData) this.builtScene = mapData;
        else console.warn("[webgpu] instance scene load returned no data");
    }
}
