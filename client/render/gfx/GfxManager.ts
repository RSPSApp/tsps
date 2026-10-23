import { notifyActorGraphic } from "../../game/ActorEventHooks";
import { getClientCycle } from "../../network/ServerConnection";
import type { WebGLMapSquare } from "../WebGLMapSquare";
import type { WebGLOsrsRenderer } from "../WebGLOsrsRenderer";

export type GfxAnchor = "ground" | "offset";

export interface GfxInstance {
    id: number;
    spotId: number;
    /** OSRS spot animation slot (0..255). When set, newer instances replace older ones for the same anchor. */
    slot?: number;
    // Attach by server id; resolve pid each frame
    attachPlayerServerId?: number;
    attachNpcServerId?: number;
    anchor: GfxAnchor;
    yOffsetTiles?: number; // only for anchor=offset
    loop: boolean;
    startCycle: number; // client cycle when scheduled to start
    // Wall-clock playback for correct speed (~20ms per client cycle)
    startTimeMs?: number; // set when startCycle gate passes
    durationMs?: number; // computed from sequence duration if not looping
    endTimeMs?: number; // startTimeMs + durationMs
    // Internal: last frame index we dispatched frame-sounds for (to avoid duplicates across passes)
    lastSoundFrame?: number;
    world?: {
        tileX: number;
        tileY: number;
        level: number;
        heightOffsetTiles?: number;
        mapId?: number;
        slot?: number;
    };
    /**
     * A tile graphic sent again on its tile each tick (a looping effect such as a floor portal):
     * it keeps playing a moment past its end, until the next one starts, so tick jitter doesn't
     * leave a gap between them.
     */
    chained?: boolean;
    graceUntilMs?: number;
    /** Tile and graphic of a tile graphic, the key it chains by. */
    chainKey?: string;
}

/** How long a chained tile graphic outlives its end waiting for the next (ms). */
const CHAIN_GRACE_MS = 150;
/** The same graphic sent within this of the last one on its tile continues it (ms). */
const CHAIN_WINDOW_MS = 800;

/**
 * Minimal GFX manager: tracks actor-attached spot animations and exposes
 * per-map instance queries for the renderer. Auto-attaches 833 to all players.
 */
export class GfxManager {
    private nextId = 1;
    private instances: Map<number, GfxInstance> = new Map();
    private readonly actorInstances = {
        player: new Map<number, Set<GfxInstance>>(),
        npc: new Map<number, Set<GfxInstance>>(),
    };
    // Reusable buffers (avoid per-call allocation)
    private worldInstancesBuffer: GfxInstance[] = [];
    private worldInstancesWithSlotBuffer: Array<{ inst: GfxInstance; slot: number }> = [];
    /** When each graphic was last sent on each tile (chain key), to tell a repeated one. */
    private lastTileSpawnMs: Map<string, number> = new Map();
    /** The chained tile graphic outliving its end on each chain key, until the next one comes. */
    private graceByChainKey: Map<string, number> = new Map();
    constructor(private renderer: WebGLOsrsRenderer) {}

    private addInstance(id: number, instance: GfxInstance): void {
        this.instances.set(id, instance);
        for (const kind of ["player", "npc"] as const) {
            const serverId = kind === "player" ? instance.attachPlayerServerId : instance.attachNpcServerId;
            if (serverId === undefined) continue;
            const index = this.actorInstances[kind];
            let instances = index.get(serverId);
            if (!instances) index.set(serverId, instances = new Set());
            instances.add(instance);
        }
    }

    /** The legacy graphic getter represents the default (slot zero) actor spot animation. */
    private removeInstance(id: number): void {
        const instance = this.instances.get(id);
        if (!instance) return;
        this.instances.delete(id);
        if (instance.chainKey !== undefined && this.graceByChainKey.get(instance.chainKey) === id) {
            this.graceByChainKey.delete(instance.chainKey);
        }
        for (const kind of ["player", "npc"] as const) {
            const serverId = kind === "player" ? instance.attachPlayerServerId : instance.attachNpcServerId;
            if (serverId === undefined) continue;
            const index = this.actorInstances[kind];
            const instances = index.get(serverId);
            instances?.delete(instance);
            if (instances?.size === 0) index.delete(serverId);
        }
        const player = instance.attachPlayerServerId;
        const npc = instance.attachNpcServerId;
        if (player !== undefined) notifyActorGraphic({ type: "player", serverId: player, graphic: this.getActorGraphic("player", player) });
        if (npc !== undefined) notifyActorGraphic({ type: "npc", serverId: npc, graphic: this.getActorGraphic("npc", npc) });
    }

    getActorGraphic(kind: "player" | "npc", serverId: number): number {
        const instances = this.actorInstances[kind].get(serverId);
        if (instances) for (const instance of instances) {
            if ((instance.slot ?? 0) === 0) return instance.spotId;
        }
        return -1;
    }
    *getActorInstances(kind:"player"|"npc",serverId:number):IterableIterator<GfxInstance> {
        const instances = this.actorInstances[kind].get(serverId);
        if (instances) yield* instances;
    }
    removeActorInstances(kind:"player"|"npc",serverId:number):void { for(const instance of this.getActorInstances(kind,serverId))this.removeInstance(instance.id); }
    getActorFrame(instance:GfxInstance):{frame:number;cycle:number} {
        if(instance.startTimeMs===undefined)return {frame:-1,cycle:0};
        const cache=this.renderer.gfxRenderer?.getCache(),lengths=cache?.getFrameLengths(instance.spotId);
        const cycles=Math.max(0,Math.floor((performance.now()-instance.startTimeMs)/20));
        const total=lengths?.reduce((sum,value)=>sum+Math.max(1,value),0) ?? Math.max(1,cache?.getFrameCount(instance.spotId) ?? 1);
        let remaining=cycles%total;
        if(lengths){for(let frame=0;frame<lengths.length;frame++){const length=Math.max(1,lengths[frame]);if(remaining<length)return {frame,cycle:remaining};remaining-=length;}}
        return {frame:remaining,cycle:0};
    }
    setActorFrame(instance:GfxInstance,frame:number,cycle=0):void {
        if(frame<0){instance.startTimeMs=undefined;instance.endTimeMs=undefined;return;}
        const lengths=this.renderer.gfxRenderer?.getCache()?.getFrameLengths(instance.spotId);
        const elapsed=(lengths ? lengths.slice(0,Math.max(0,frame)).reduce((sum,value)=>sum+Math.max(1,value),0):Math.max(0,frame))+Math.max(0,cycle);
        instance.startTimeMs=performance.now()-elapsed*20;
        if(instance.durationMs!==undefined)instance.endTimeMs=instance.startTimeMs+instance.durationMs;
    }

    update(): void {
        const nowCycle = getClientCycle() | 0;
        const nowMs = (performance?.now?.() as number) || Date.now();
        for (const [id, inst] of this.instances) {
            // Activate when the scheduled start tick has passed
            if (inst.startCycle <= nowCycle && inst.startTimeMs == null) {
                inst.startTimeMs = nowMs;
                if (!inst.loop && typeof inst.durationMs === "number" && inst.durationMs > 0) {
                    inst.endTimeMs = inst.startTimeMs + inst.durationMs;
                }
            }
            if (!inst.loop && typeof inst.endTimeMs === "number" && nowMs >= (inst.endTimeMs | 0)) {
                if (inst.chained && inst.graceUntilMs === undefined) {
                    inst.graceUntilMs = nowMs + CHAIN_GRACE_MS;
                    if (inst.chainKey !== undefined) this.graceByChainKey.set(inst.chainKey, id);
                    continue;
                }
                if (inst.graceUntilMs !== undefined && nowMs < inst.graceUntilMs) continue;
                this.removeInstance(id);
            }
        }
    }

    // Auto policy: ensure 833 exists per visible player
    private ensureAttached833ForAllPlayers(): void {
        const pe: any = this.renderer.osrsClient.playerEcs as any;
        const n = pe?.size?.() ?? 0;
        for (let i = 0; i < n; i++) {
            const sid = pe.getServerIdForIndex?.(i);
            if (typeof sid !== "number" || sid <= 0) continue;
            const key = this.findAttachedInstanceKey(833, sid);
            if (key === undefined) {
                this.spawnAttachedToPlayer(833, sid, "ground", undefined, true);
            }
        }
    }

    private findAttachedInstanceKey(spotId: number, serverId: number): number | undefined {
        for (const inst of this.getActorInstances("player", serverId)) {
            if (inst.spotId === spotId) return inst.id;
        }
        return undefined;
    }

    clearAttachedSlotPlayer(serverId: number, slotArg?: number): void {
        const slot = typeof slotArg === "number" ? (slotArg | 0) & 0xff : 0;
        for (const inst of this.getActorInstances("player", serverId | 0)) {
            if ((inst.slot ?? 0) === slot) this.removeInstance(inst.id);
        }
    }

    clearAttachedSlotNpc(serverId: number, slotArg?: number): void {
        const slot = typeof slotArg === "number" ? (slotArg | 0) & 0xff : 0;
        for (const inst of this.getActorInstances("npc", serverId | 0)) {
            if ((inst.slot ?? 0) === slot) this.removeInstance(inst.id);
        }
    }

    spawnAttachedToPlayer(
        spotId: number,
        serverId: number,
        anchor: GfxAnchor = "ground",
        yOffsetTiles?: number,
        loop: boolean = false,
        startCycleArg?: number,
        slotArg?: number,
    ): number {
        const slot = typeof slotArg === "number" ? (slotArg | 0) & 0xff : undefined;
        if (slot !== undefined) {
            for (const inst of this.getActorInstances("player", serverId | 0)) {
                if (inst.slot === slot) this.removeInstance(inst.id);
            }
        }
        const id = this.nextId++;
        // Compute approximate duration for lifetime when not looping (ms from client cycles)
        let durationMs: number | undefined = undefined;
        try {
            const cache = (this.renderer as any).gfxRenderer?.getCache?.();
            const durationTicks = cache?.getDurationTicks?.(spotId | 0);
            if (typeof durationTicks === "number" && durationTicks > 0) {
                durationMs = durationTicks * 20;
            } else {
                const fc = cache?.getFrameCount?.(spotId | 0) ?? 0;
                if ((fc | 0) > 0) durationMs = Math.max(20, (fc | 0) * 20);
            }
        } catch {}

        this.addInstance(id, {
            id,
            spotId: spotId | 0,
            attachPlayerServerId: serverId | 0,
            attachNpcServerId: undefined,
            slot,
            anchor,
            yOffsetTiles,
            loop,
            startCycle:
                typeof startCycleArg === "number" ? startCycleArg | 0 : getClientCycle() | 0,
            startTimeMs: undefined,
            durationMs,
            endTimeMs: undefined,
        });
        return id;
    }

    spawnAttachedToNpc(
        spotId: number,
        serverId: number,
        anchor: GfxAnchor = "ground",
        yOffsetTiles?: number,
        loop: boolean = false,
        startCycleArg?: number,
        slotArg?: number,
    ): number {
        const slot = typeof slotArg === "number" ? (slotArg | 0) & 0xff : undefined;
        if (slot !== undefined) {
            for (const inst of this.getActorInstances("npc", serverId | 0)) {
                if (inst.slot === slot) this.removeInstance(inst.id);
            }
        }
        const id = this.nextId++;
        let durationMs: number | undefined = undefined;
        try {
            const cache = (this.renderer as any).gfxRenderer?.getCache?.();
            const durationTicks = cache?.getDurationTicks?.(spotId | 0);
            if (typeof durationTicks === "number" && durationTicks > 0) {
                durationMs = durationTicks * 20;
            } else {
                const fc = cache?.getFrameCount?.(spotId | 0) ?? 0;
                if ((fc | 0) > 0) durationMs = Math.max(20, (fc | 0) * 20);
            }
        } catch {}

        this.addInstance(id, {
            id,
            spotId: spotId | 0,
            attachPlayerServerId: undefined,
            attachNpcServerId: serverId | 0,
            slot,
            anchor,
            yOffsetTiles,
            loop,
            startCycle:
                typeof startCycleArg === "number" ? startCycleArg | 0 : getClientCycle() | 0,
            startTimeMs: undefined,
            durationMs,
            endTimeMs: undefined,
        });
        return id;
    }

    spawnAtTile(
        spotId: number,
        tile: { x: number; y: number; level?: number },
        opts?: { heightTiles?: number; startCycle?: number },
    ): number {
        const id = this.nextId++;
        const level = tile.level ?? 0;
        const chainKey = `${tile.x | 0},${tile.y | 0},${level},${spotId}`;
        const nowMs = (performance?.now?.() as number) || Date.now();
        const last = this.lastTileSpawnMs.get(chainKey);
        const chained = last !== undefined && nowMs - last <= CHAIN_WINDOW_MS;
        this.lastTileSpawnMs.set(chainKey, nowMs);
        if (this.lastTileSpawnMs.size > 4096) {
            for (const [key, at] of this.lastTileSpawnMs) if (nowMs - at > CHAIN_WINDOW_MS) this.lastTileSpawnMs.delete(key);
        }
        // The one it continues stops waiting now this one is here.
        const waiting = this.graceByChainKey.get(chainKey);
        if (waiting !== undefined) this.removeInstance(waiting);
        let durationMs: number | undefined = undefined;
        try {
            const cache = (this.renderer as any).gfxRenderer?.getCache?.();
            const durationTicks = cache?.getDurationTicks?.(spotId | 0);
            if (typeof durationTicks === "number" && durationTicks > 0) {
                durationMs = durationTicks * 20;
            } else {
                const fc = cache?.getFrameCount?.(spotId | 0) ?? 0;
                if ((fc | 0) > 0) durationMs = Math.max(20, (fc | 0) * 20);
            }
        } catch {}

        this.addInstance(id, {
            id,
            spotId: spotId | 0,
            anchor: opts?.heightTiles ? "offset" : "ground",
            yOffsetTiles: opts?.heightTiles,
            loop: false,
            startCycle:
                typeof opts?.startCycle === "number" ? opts.startCycle | 0 : getClientCycle() | 0,
            startTimeMs: undefined,
            durationMs,
            endTimeMs: undefined,
            chained,
            chainKey,
            world: {
                tileX: tile.x | 0,
                tileY: tile.y | 0,
                level,
                heightOffsetTiles: opts?.heightTiles,
            },
        });
        return id;
    }

    kill(id: number): void {
        this.removeInstance(id);
    }

    /**
     * Return attached-player instances that belong to the given map square,
     * along with resolved ECS indices and per-map slot order.
     */
    getAttachedPlayersForMap(
        map: WebGLMapSquare,
    ): Array<{
        inst: GfxInstance;
        pid: number; // ECS player index
        slot: number; // order within this map square (0..N-1)
    }> {
        const out: Array<{ inst: GfxInstance; pid: number; slot: number }> = [];
        const pe: any = this.renderer.osrsClient.playerEcs as any;
        const pidsInMap = this.renderer.playerRenderer.getRenderPlayersForMap(map);
        if (pidsInMap.length === 0) return out;
        const nowCycle = getClientCycle() | 0;
        for (let slot = 0; slot < pidsInMap.length; slot++) {
            const pid = pidsInMap[slot] | 0;
            const sid = pe.getServerIdForIndex?.(pid);
            for (const inst of this.getActorInstances("player", sid | 0)) {
                if ((inst.startCycle | 0) > nowCycle) continue; // honor start cycle delay
                out.push({ inst, pid, slot });
            }
        }
        return out;
    }

    getAttachedNpcsForMap(
        map: WebGLMapSquare,
    ): Array<{ inst: GfxInstance; ecsId: number; slot: number }> {
        const out: Array<{ inst: GfxInstance; ecsId: number; slot: number }> = [];
        const ids: number[] = map.npcEntityIds;
        if (!ids || ids.length === 0) return out;
        const ecs: any = this.renderer.osrsClient?.npcEcs;
        if (!ecs) return out;

        const sidToInfo = new Map<number, { ecsId: number; slot: number }>();
        for (let slot = 0; slot < ids.length; slot++) {
            const ecsId = ids[slot] | 0;
            if (!ecs.isActive?.(ecsId) || !ecs.isLinked?.(ecsId)) continue;
            if (!this.renderer.shouldRenderNpcFromMap(map, ecsId)) continue;
            const sid = ecs.getServerId?.(ecsId);
            if (typeof sid !== "number" || sid <= 0) continue;
            sidToInfo.set(sid | 0, { ecsId, slot });
        }
        if (sidToInfo.size === 0) return out;

        const nowCycle = getClientCycle() | 0;
        for (const inst of this.instances.values()) {
            const sid = inst.attachNpcServerId;
            if (typeof sid !== "number" || sid <= 0) continue;
            if ((inst.startCycle | 0) > nowCycle) continue;
            const info = sidToInfo.get(sid | 0);
            if (!info) continue;
            out.push({ inst, ecsId: info.ecsId, slot: info.slot });
        }
        return out;
    }

    resetWorldBindings(): void {
        for (const inst of this.instances.values()) {
            if (inst.world) {
                inst.world.mapId = undefined;
                inst.world.slot = undefined;
            }
        }
    }

    /**
     * The world graphics drawn by a map square: those on the tiles it draws, from where it is
     * drawn (an instance scene starts at its centre chunk less 6, not at its map square's start).
     */
    listWorldInstancesForDrawnMap(map: { mapX: number; mapY: number; getRenderBaseTileX?(): number; getRenderBaseTileY?(): number; getLocalTileSpan?(): number }): GfxInstance[] {
        const baseX = map.getRenderBaseTileX?.() ?? map.mapX * 64;
        const baseY = map.getRenderBaseTileY?.() ?? map.mapY * 64;
        const span = map.getLocalTileSpan?.() || 64;
        const out = this.worldInstancesBuffer;
        out.length = 0;
        const nowCycle = getClientCycle() | 0;
        for (const inst of this.instances.values()) {
            if (!inst.world) continue;
            if ((inst.startCycle | 0) > nowCycle) continue;
            const tileX = inst.world.tileX | 0;
            const tileY = inst.world.tileY | 0;
            if (tileX < baseX || tileX >= baseX + span) continue;
            if (tileY < baseY || tileY >= baseY + span) continue;
            out.push(inst);
        }
        return out;
    }

    listWorldInstancesForMap(mapX: number, mapY: number): GfxInstance[] {
        const out = this.worldInstancesBuffer;
        out.length = 0; // Clear and reuse buffer
        const baseX = mapX * 64;
        const baseY = mapY * 64;
        const nowCycle = getClientCycle() | 0;
        for (const inst of this.instances.values()) {
            if (!inst.world) continue;
            if ((inst.startCycle | 0) > nowCycle) continue;
            const tileX = inst.world.tileX | 0;
            const tileY = inst.world.tileY | 0;
            if (tileX < baseX || tileX >= baseX + 64) continue;
            if (tileY < baseY || tileY >= baseY + 64) continue;
            out.push(inst);
        }
        return out;
    }

    /**
     * The world graphics on a world entity's own tiles (a boat deck's, such as the wind on its
     * sails), which its overlay map draws: those tiles lie outside every normal map square.
     */
    listWorldInstancesInView(view: { containsTile(tileX: number, tileY: number): boolean }): GfxInstance[] {
        const out = this.worldInstancesBuffer;
        out.length = 0;
        const nowCycle = getClientCycle() | 0;
        for (const inst of this.instances.values()) {
            if (!inst.world) continue;
            if ((inst.startCycle | 0) > nowCycle) continue;
            if (!view.containsTile(inst.world.tileX | 0, inst.world.tileY | 0)) continue;
            out.push(inst);
        }
        return out;
    }

    getWorldInstancesForMap(map: WebGLMapSquare): Array<{ inst: GfxInstance; slot: number }> {
        const out = this.worldInstancesWithSlotBuffer;
        let idx = 0;
        const nowCycle = getClientCycle() | 0;
        for (const inst of this.instances.values()) {
            if (!inst.world) continue;
            if ((inst.startCycle | 0) > nowCycle) continue;
            if (inst.world.mapId !== map.id) continue;
            if (typeof inst.world.slot !== "number") continue;
            // Reuse existing objects in the buffer when possible
            if (idx < out.length) {
                out[idx].inst = inst;
                out[idx].slot = inst.world.slot | 0;
            } else {
                out.push({ inst, slot: inst.world.slot | 0 });
            }
            idx++;
        }
        out.length = idx; // Truncate to actual size
        return out;
    }
}
