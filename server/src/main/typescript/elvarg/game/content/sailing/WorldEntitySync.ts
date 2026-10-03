import { CachePipeline } from "../../cache/CachePipeline";
import type { Player } from "../../entity/impl/player/Player";
import { packTemplateChunk } from "../../plugin/impl/construction/HousePaletteCompiler";
import {
    encodeLocAddChange,
    encodeRebuildWorldEntity,
    encodeWorldEntityInfo,
    type WorldEntityPosition,
    type WorldEntitySpawn,
    type WorldEntityUpdate,
} from "../../../net/protocol/ClientProtocol";
import type { Boat } from "./Boat";
import { BoatManager } from "./BoatManager";
import type { BoatDeckLoc } from "./BoatSpec";

/** How far from a viewer (their root tile, in tiles) a boat is shown. */
export const BOAT_VIEW_DISTANCE = 32;
/**
 * WORLDENTITY_INFO has a one-byte length. An update is at most 19 bytes and a spawn 25, so
 * capping the list at 8 boats (and 4 new ones a tick) keeps it under 255.
 */
const MAX_BOATS_IN_VIEW = 8;
const MAX_NEW_BOATS_PER_TICK = 4;

interface ViewerState {
    /** Boats the client has, in the client's order. */
    order: number[];
    /** The boat sent for each entity index (an index is reused once its boat is gone). */
    boats: Map<number, Boat>;
    /** The position each boat was last sent at. */
    positions: Map<number, WorldEntityPosition>;
    /** How many of each boat's deck loc changes the client has. */
    locChanges: Map<number, number>;
}

/**
 * Keeps each player's client in step with the boats around them, like NPC sync: a boat that
 * comes into range is built (its deck scene, then the spawn, then its deck locs), a boat in
 * range is moved, and one that leaves range is removed.
 */
export class WorldEntitySync {
    private static readonly viewers = new WeakMap<Player, ViewerState>();

    /** The packets to send this tick, before player sync, or none if nothing changed. */
    public static flush(player: Player): Buffer[] {
        let state = WorldEntitySync.viewers.get(player);
        if (!state) {
            state = { order: [], boats: new Map(), positions: new Map(), locChanges: new Map() };
            WorldEntitySync.viewers.set(player, state);
        }
        const visible = WorldEntitySync.boatsInView(player);
        const visibleIds = new Set(visible.map((boat) => boat.entityIndex));

        const updates: WorldEntityUpdate[] = [];
        const kept: number[] = [];
        /** Deck locs changed (facilities built or removed) on boats the client already has. */
        const changedLocs: Buffer[] = [];
        for (const entityIndex of state.order) {
            const boat = BoatManager.getBoat(entityIndex);
            if (!boat || boat !== state.boats.get(entityIndex) || !visibleIds.has(entityIndex)) {
                updates.push({ updateType: 0 });
                state.boats.delete(entityIndex);
                state.positions.delete(entityIndex);
                state.locChanges.delete(entityIndex);
                continue;
            }
            kept.push(entityIndex);
            const { count, changes } = BoatManager.deckLocChanges(boat, state.locChanges.get(entityIndex) ?? 0);
            state.locChanges.set(entityIndex, count);
            changedLocs.push(...changes.map((loc) => WorldEntitySync.encodeDeckLoc(boat, loc)));
            const position = WorldEntitySync.positionOf(boat);
            const last = state.positions.get(entityIndex)!;
            const delta = {
                x: position.x - last.x,
                y: 0,
                z: position.z - last.z,
                orientation: position.orientation - last.orientation,
            };
            if (delta.x === 0 && delta.z === 0 && delta.orientation === 0) {
                updates.push({ updateType: 1 });
            } else {
                updates.push({ updateType: 2, delta });
                state.positions.set(entityIndex, position);
            }
        }

        const packets: Buffer[] = [];
        const spawns: WorldEntitySpawn[] = [];
        const locs: Buffer[] = [];
        const room = Math.min(MAX_NEW_BOATS_PER_TICK, MAX_BOATS_IN_VIEW - kept.length);
        for (const boat of visible) {
            if (spawns.length >= room) break;
            // An index despawned this tick can't be respawned in the same packet.
            if (state.order.includes(boat.entityIndex)) continue;
            const position = WorldEntitySync.positionOf(boat);
            packets.push(WorldEntitySync.encodeScene(boat));
            spawns.push({
                entityIndex: boat.entityIndex,
                sizeX: boat.sizeX,
                sizeZ: boat.sizeZ,
                configId: boat.configId,
                drawMode: 0,
                position,
            });
            state.boats.set(boat.entityIndex, boat);
            state.positions.set(boat.entityIndex, position);
            state.locChanges.set(boat.entityIndex, BoatManager.deckLocChanges(boat).count);
            locs.push(...WorldEntitySync.encodeDeckLocs(boat));
        }

        const changed = spawns.length > 0 || updates.some((update) => update.updateType !== 1);
        state.order = [...kept, ...spawns.map((spawn) => spawn.entityIndex)];
        if (!changed) return [...packets, ...changedLocs];
        packets.push(encodeWorldEntityInfo(updates, spawns), ...locs, ...changedLocs);
        return packets;
    }

    /** Boats near the player's root tile, nearest first, with the one they're on always shown. */
    private static boatsInView(player: Player): Boat[] {
        const root = BoatManager.rootLocation(player);
        const aboard = BoatManager.getBoatAboard(player);
        const distance = (boat: Boat) =>
            Math.max(Math.abs(boat.tileX - root.getX()), Math.abs(boat.tileY - root.getY()));
        return BoatManager.all()
            .filter((boat) => boat === aboard
                || (boat.level === root.getZ() && distance(boat) <= BOAT_VIEW_DISTANCE
                    && BoatManager.canSeeBoat(player, boat)))
            .sort((a, b) => (a === aboard ? -1 : b === aboard ? 1 : distance(a) - distance(b)))
            .slice(0, MAX_BOATS_IN_VIEW);
    }

    private static positionOf(boat: Boat): WorldEntityPosition {
        return { x: boat.fineX, y: 0, z: boat.fineY, orientation: boat.angle };
    }

    /**
     * The deck scene: the boat's template zones (8x8 tiles each, a sloop's are 1x2) copied into
     * a 13x13 scene from its centre chunk.
     */
    private static encodeScene(boat: Boat): Buffer {
        const spec = BoatManager.getSpec(boat)!;
        const chunks = Array.from({ length: 4 }, () =>
            Array.from({ length: 13 }, () => new Array<number>(13).fill(-1)));
        for (let plane = 0; plane < 4; plane++) {
            for (let zoneX = 0; zoneX < Math.ceil(spec.sizeX / 8); zoneX++) {
                for (let zoneY = 0; zoneY < Math.ceil(spec.sizeZ / 8); zoneY++) {
                    chunks[plane][6 + zoneX][6 + zoneY] = packTemplateChunk({
                        sourceChunkX: spec.templateChunkX + zoneX,
                        sourceChunkY: spec.templateChunkY + zoneY,
                        sourcePlane: plane,
                        rotation: 0,
                    });
                }
            }
        }
        const regionId = ((spec.templateChunkX >> 3) << 8) | (spec.templateChunkY >> 3);
        return encodeRebuildWorldEntity(
            boat.entityIndex, boat.configId, boat.sizeX, boat.sizeZ,
            boat.deckRegionX, boat.deckRegionY, chunks, [CachePipeline.getXtea(regionId)],
        );
    }

    private static encodeDeckLocs(boat: Boat): Buffer[] {
        return BoatManager.getSpec(boat)!.locs.map((loc) => WorldEntitySync.encodeDeckLoc(boat, loc));
    }

    private static encodeDeckLoc(boat: Boat, loc: BoatDeckLoc): Buffer {
        return encodeLocAddChange(loc.id, boat.deckBaseX + loc.x, boat.deckBaseY + loc.y, loc.level, loc.shape, loc.rotation);
    }
}
