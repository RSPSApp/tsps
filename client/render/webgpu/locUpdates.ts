/**
 * World-object (LOC) updates for the WebGPU backend: port of render/render/locs.ts, locs2.ts,
 * streaming.ts (refreshGamemodeWorldLocs) and WebGLOsrsRenderer.onRegionReplacement.
 *
 * Packets update the renderer's loc state (locOverrides, locSpawns, addedLocs, terrain and region
 * replacements), which every map build hands to the worker; the affected map squares are then
 * rebuilt in a debounced batch and replace the drawn squares in place. Each map has a reload
 * version: a build started before a change is dropped when it completes (`isCurrent`).
 *
 * As in WebGL (scheduleLocGeometryUpdate), a change that only touches doors rebuilds just the
 * square's door geometry, one that only touches other locs just its loc geometry (the worker skips
 * terrain and the other group: SdMapLoaderInput.doorOnly/locOnly); anything else, or a mix of
 * groups changed before a build is applied, rebuilds the whole square.
 */
import type { WebGLOsrsRendererHost } from "../render/hostInterface";
import { getLocAnimationDurationMs } from "../render/locs2";
import { applyGamemodeWorldLocs } from "../render/streaming";
import { RENDER_CONSTANTS } from "../render/constants";
import { LocModelType } from "../../rs/config/loctype/LocModelType";
import { isDoorLocType } from "../loc/SceneLocs";
import { matchingLocSlotIds, shapeSlotOverride, suppressShapeSlotAt } from "../loc/LocSlots";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import type { LocChangeOptions, RegionReplacementEvent } from "../../game/GameRenderer";
import type { WebGPURenderer } from "./WebGPURenderer";

type Tile = { x: number; y: number };
/** Which geometry a reload rebuilds. */
export type LocReloadGroup = "door" | "loc" | "full";

function mergeGroups(a: LocReloadGroup | undefined, b: LocReloadGroup): LocReloadGroup {
    return a === undefined || a === b ? b : "full";
}

export class LocUpdates {
    // Read and replaced by applyGamemodeWorldLocs (shared with WebGL through this facade).
    gamemodeWorldLocOverrideKeys = new Set<string>();
    gamemodeWorldLocSpawnKeys = new Set<string>();
    gamemodeWorldTerrainOverrideKeys = new Set<string>();

    private readonly versions = new Map<number, number>();
    private readonly pending = new Map<number, Tile>();
    /** Groups changed since each square last applied a current build. */
    private readonly dirty = new Map<number, LocReloadGroup>();
    private flushTimer?: ReturnType<typeof setTimeout>;
    private readonly animTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(private readonly r: WebGPURenderer) {}

    get locOverrides() {
        return this.r.locOverrides;
    }
    get locSpawns() {
        return this.r.locSpawns;
    }
    get terrainOverrides() {
        return this.r.terrainOverrides;
    }
    getMapIdForWorldTile(x: number, y: number): number {
        return getMapSquareId(x >> 6, y >> 6);
    }

    /** Reload version of a map square; a build is current while it still matches. */
    version(mapX: number, mapY: number): number {
        return this.versions.get(getMapSquareId(mapX, mapY)) ?? 0;
    }

    isCurrent(mapX: number, mapY: number, version: number): boolean {
        return this.version(mapX, mapY) === version;
    }

    /** A current build was applied: it includes every change so far. */
    applied(mapX: number, mapY: number): void {
        this.dirty.delete(getMapSquareId(mapX, mapY));
    }

    /** "door"/"loc" when every id is known and in that group, else "full" (locs.ts onLocChange). */
    private groupOf(...ids: number[]): LocReloadGroup {
        let doors = 0;
        let locs = 0;
        for (const id of ids) {
            if ((id | 0) <= 0) continue;
            const type = this.r.osrsClient.locTypeLoader.load(id | 0);
            if (!type) return "full";
            if (isDoorLocType(type)) doors++;
            else locs++;
        }
        if (doors > 0 && locs === 0) return "door";
        if (locs > 0 && doors === 0) return "loc";
        return "full";
    }

    /** The tile's cache locs in the slot this shape/rotation addresses (locs2.ts onLocDel). */
    private locSlotIdsAt(tile: Tile, level: number, shape: number, rotation: number): number[] {
        // By bounds: an instance scene is one square that spans several.
        const square = this.r.mapManager.getMapForWorldTile?.(tile.x, tile.y);
        if (!square || typeof square.getLocIdsAtLocal !== "function") return [];
        const lx = tile.x - square.getRenderBaseWorldX();
        const ly = tile.y - square.getRenderBaseWorldY();
        const typeRots =
            typeof square.getLocTypeRotsAtLocal === "function"
                ? square.getLocTypeRotsAtLocal(level, lx, ly)
                : [];
        return matchingLocSlotIds(square.getLocIdsAtLocal(level, lx, ly), typeRots, shape, rotation);
    }

    /** The override that removes one cache loc at a tile (`newId: 0`, keyed by its id). */
    private suppressLocAt(tile: Tile, level: number, id: number): void {
        this.r.locOverrides.set(`${tile.x | 0},${tile.y | 0},${level | 0},${id | 0}`, { newId: 0 });
    }

    /** Gamemode world loc/terrain changes, re-applied before every map build (streaming2.ts). */
    applyGamemode(): Set<number> {
        return applyGamemodeWorldLocs(this as unknown as WebGLOsrsRendererHost);
    }

    onLocChange(oldId: number, newId: number, tile: Tile, level: number, opts?: LocChangeOptions): void {
        const oldTile = opts?.oldTile ?? tile;
        const newTile = opts?.newTile;
        const overrideRotation = typeof opts?.newRotation === "number" ? opts.newRotation & 0x3 : undefined;
        const spawnKey = `${oldTile.x | 0},${oldTile.y | 0},${level | 0}`;
        const existingSpawn = this.r.locSpawns.get(spawnKey);
        // Locs spawned on empty ground (oldId 0) and the lifecycle of a spawned loc use locSpawns.
        const isSpawnedLoc = (oldId | 0) === 0 || (existingSpawn !== undefined && existingSpawn.id === (oldId | 0));

        for (const t of newTile ? [oldTile, newTile] : [oldTile]) {
            const prefix = `${t.x | 0},${t.y | 0},${level},`;
            for (const key of Array.from(this.r.locOverrides.keys())) {
                if (key.startsWith(prefix)) this.r.locOverrides.delete(key);
            }
        }

        if (isSpawnedLoc) {
            if ((newId | 0) === 0) {
                this.r.locSpawns.delete(spawnKey);
            } else {
                // The server's shape (loc_add_change_v2), else the existing spawn's, else NORMAL.
                const type = typeof opts?.newShape === "number" ? opts.newShape : existingSpawn?.type ?? LocModelType.NORMAL;
                this.r.locSpawns.set(spawnKey, { id: newId | 0, type, rotation: overrideRotation ?? 0 });
            }
        } else {
            const moved = newTile && ((newTile.x | 0) !== (oldTile.x | 0) || (newTile.y | 0) !== (oldTile.y | 0));
            this.r.locOverrides.set(`${oldTile.x},${oldTile.y},${level},${oldId}`, {
                newId: newId | 0,
                newRotation: overrideRotation,
                moveToX: moved ? newTile!.x | 0 : undefined,
                moveToY: moved ? newTile!.y | 0 : undefined,
            });
        }

        // A moving loc can cross a map-square edge (e.g. a gate): reload both squares.
        const group = this.groupOf(oldId, newId);
        this.reloadTile(oldTile, group);
        if (newTile) this.reloadTile(newTile, group);
    }

    onLocAddChange(locId: number, tile: Tile, level: number, shape: number, rotation: number): void {
        const key = `${tile.x},${tile.y},${level},${shape}`;
        const existing = this.r.addedLocs.get(key);
        // An instance's template hotspot is never removed by the server (build furniture only
        // sends the new object), so there it is replaced by shape, at whatever rotation the
        // hotspot was placed. In the main world the server removes what it replaces, so only the
        // exact (shape, rotation) slot goes: the GE's paving is NORMAL locs of another rotation,
        // and matching by shape alone erased a floor tile per fire (issue #1748).
        const replaced = this.r.instanceActive ? [] : this.locSlotIdsAt(tile, level, shape, rotation);
        const recorded = this.r.instanceActive
            ? shapeSlotOverride(this.r.locOverrides, tile.x, tile.y, level, shape)?.newId === 0
            : replaced.every(
                  (id) => this.r.locOverrides.get(`${tile.x | 0},${tile.y | 0},${level | 0},${id}`)?.newId === 0,
              );
        // A replay of the same add (the server re-sends while the object stands) needs no work
        // once the replacements it suppresses are recorded.
        if (existing?.locId === locId && existing.rotation === rotation && recorded) {
            return;
        }
        this.r.addedLocs.set(key, { locId, x: tile.x, y: tile.y, level, shape, rotation, replacedIds: replaced });
        if (this.r.instanceActive) {
            suppressShapeSlotAt(this.r.locOverrides, tile.x, tile.y, level, shape);
        } else {
            for (const id of replaced) this.suppressLocAt(tile, level, id);
        }
        this.reloadTile(tile, this.groupOf(locId));
    }

    onLocDel(tile: Tile, level: number, shape: number, rotation: number): void {
        const key = `${tile.x},${tile.y},${level},${shape}`;
        const added = this.r.addedLocs.get(key);
        const wasAdded = added !== undefined && (added.rotation & 0x3) === (rotation & 0x3);
        this.r.addedLocs.delete(key);
        if (wasAdded) {
            // The object the server added is gone. Its add never removed the cache scenery at
            // this tile, and whatever it did replace comes back.
            for (const id of added.replacedIds ?? []) {
                this.r.locOverrides.delete(`${tile.x | 0},${tile.y | 0},${level | 0},${id}`);
            }
            this.reloadTile(tile, this.groupOf(added.locId));
            return;
        }
        // A cache object was removed: suppress that one loc so it disappears (e.g. a chopped tree).
        const deleted = this.locSlotIdsAt(tile, level, shape, rotation);
        if (deleted.length > 0) {
            for (const id of deleted) this.suppressLocAt(tile, level, id);
            this.reloadTile(tile, this.groupOf(deleted[0]));
            return;
        }
        // No id to key on: remove this tile's slot only, never every loc of the shape.
        suppressShapeSlotAt(this.r.locOverrides, tile.x, tile.y, level, shape, rotation);
        this.reloadTile(tile, "full");
    }

    onLocAnim(locId: number, tile: Tile, level: number, shape: number, rotation: number, animId: number): void {
        if ((shape | 0) < 0) return;
        const exactKey = `${tile.x | 0},${tile.y | 0},${level | 0},${locId | 0}`;
        const matchKey = `${tile.x | 0},${tile.y | 0},${level | 0},-1`;
        // A loc the server added is found by its own id; the tile-wide key there holds the
        // removal of the cache loc it replaced, which must survive the animation.
        const added = this.r.addedLocs.get(`${tile.x | 0},${tile.y | 0},${level | 0},${shape | 0}`);
        const onAddedLoc = added !== undefined && (added.locId | 0) === (locId | 0);
        const keys = onAddedLoc ? [exactKey] : [exactKey, matchKey];
        // As in OSRS, a sequence with a frame step loops (or holds its last frames) until the
        // loc is animated again or changed; one without plays once and reverts.
        let loops = false;
        try {
            loops = ((this.r.osrsClient.seqTypeLoader.load(animId | 0) as { frameStep?: number })?.frameStep ?? -1) > 0;
        } catch {}
        // A boat deck rebuilds its whole scene for an animation, so the same animation sent
        // again while it plays (a salvaging hook's idle, every few ticks) only extends it.
        const repeating =
            this.deckViewAt(tile) !== undefined &&
            this.r.locOverrides.get(exactKey)?.seqId === (animId | 0) &&
            (loops || this.animTimers.has(exactKey));
        for (const key of keys) {
            clearTimeout(this.animTimers.get(key));
            this.animTimers.delete(key);
        }
        this.r.locOverrides.set(exactKey, {
            newId: locId | 0,
            newRotation: rotation & 0x3,
            seqId: animId | 0,
            seqRandomStart: false,
        });
        if (!onAddedLoc) {
            this.r.locOverrides.set(matchKey, {
                newId: -1,
                newRotation: rotation & 0x3,
                seqId: animId | 0,
                seqRandomStart: false,
                matchType: shape,
                matchRotation: rotation & 0x3,
            });
        }
        const group = this.groupOf(locId);
        if (!repeating) this.reloadTile(tile, group);
        if (loops) return;
        const host = this.r as unknown as WebGLOsrsRendererHost;
        const timer = setTimeout(() => {
            let changed = false;
            for (const key of keys) {
                const current = this.r.locOverrides.get(key);
                if (current && (current.seqId ?? -1) === (animId | 0)) {
                    this.r.locOverrides.delete(key);
                    changed = true;
                }
                this.animTimers.delete(key);
            }
            if (changed) this.reloadTile(tile, group);
        }, getLocAnimationDurationMs(host, animId));
        for (const key of keys) this.animTimers.set(key, timer);
    }

    refreshGamemodeWorldLocs(): void {
        const affected = this.applyGamemode();
        if (!this.r.osrsClient.loadedCache || this.r.instanceActive) return;
        for (const mapId of affected) this.scheduleReload(mapId >> 8, mapId & 0xff);
    }

    onRegionReplacement(payload: RegionReplacementEvent): void {
        const regionId = payload.regionId | 0;
        if (regionId < 0 || regionId > 0xffff || payload.terrainData.length === 0) return;
        this.r.mapRegionReplacements.set(regionId, {
            terrainData: Int8Array.from(payload.terrainData),
            objectData: payload.objectData?.length ? Int8Array.from(payload.objectData) : undefined,
        });
        if (payload.allowReload) this.scheduleReload(regionId >> 8, regionId & 0xff);
    }

    /**
     * The tile's map square reloads. In an instance the drawn scene is one square: a change that
     * only touches doors, or only other locs, rebuilds that geometry of it (a house door opened a
     * second late when the whole scene rebuilt); anything else, or a change while a whole-scene
     * build is still on its way, rebuilds the scene.
     */
    private reloadTile(tile: Tile, group: LocReloadGroup): void {
        // A deck loc belongs to its boat's scene, which is rebuilt as a whole (as in WebGL):
        // a main-world square under the deck's coordinates would never show the change.
        const deckView = this.deckViewAt(tile);
        if (deckView !== undefined) {
            this.r.scheduleWorldEntityLocRebuild(deckView);
            return;
        }
        if (this.r.instanceActive) {
            const scene = this.r.instanceSceneMap;
            if (group === "full" || !scene || !this.r.mapManager.getMap(scene.mapX, scene.mapY) ||
                this.r.instances.hasPendingWork()) {
                this.r.scheduleInstanceLocRebuild();
            } else {
                this.scheduleReload(scene.mapX, scene.mapY, group);
            }
            return;
        }
        this.scheduleReload(Math.floor(tile.x / 64), Math.floor(tile.y / 64), group);
    }

    /** The boat (world entity) whose deck scene holds a tile, if any. */
    private deckViewAt(tile: Tile): number | undefined {
        const view = this.r.osrsClient?.worldViewManager?.findWorldViewAt(tile.x | 0, tile.y | 0);
        return view && this.r.worldEntityOverlays.has(view.id) ? view.id : undefined;
    }

    /** Port of scheduleLocReload: bump the version, then rebuild loaded/loading squares in a batch. */
    scheduleReload(mapX: number, mapY: number, group: LocReloadGroup = "full"): void {
        const id = getMapSquareId(mapX, mapY);
        this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
        // A build in flight for another group is now stale, so this one must cover both.
        this.dirty.set(id, mergeGroups(this.dirty.get(id), group));
        // Not loaded or loading: its next load reads the current state anyway.
        if (!this.r.mapManager.getMap(mapX, mapY) && !this.r.mapManager.loadingMapIds.has(id)) return;
        this.pending.set(id, { x: mapX | 0, y: mapY | 0 });
        this.flushTimer ??= setTimeout(() => {
            this.flushTimer = undefined;
            const batch = Array.from(this.pending.values());
            this.pending.clear();
            for (const map of batch) {
                this.r.queueLocReload(map.x, map.y, this.dirty.get(getMapSquareId(map.x, map.y)) ?? "full");
            }
        }, RENDER_CONSTANTS.LOC_RELOAD_FLUSH_DELAY_MS);
    }

    /** Drops queued work; also the per-session reset, so it must leave the instance usable. */
    dispose(): void {
        clearTimeout(this.flushTimer);
        this.flushTimer = undefined;
        for (const timer of this.animTimers.values()) clearTimeout(timer);
        this.animTimers.clear();
        this.pending.clear();
        this.dirty.clear();
        this.gamemodeWorldLocOverrideKeys.clear();
        this.gamemodeWorldLocSpawnKeys.clear();
        this.gamemodeWorldTerrainOverrideKeys.clear();
    }
}
