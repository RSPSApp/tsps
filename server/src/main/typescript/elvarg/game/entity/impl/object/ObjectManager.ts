import { World } from "../../../World";
import { RegionManager } from "../../../collision/RegionManager";
import { Player } from "../player/Player";
import { Location } from "../../../model/Location";
import { GameObject } from "./GameObject";
import { MapObjects } from "./MapObjects";
import { PluginContext } from "../../../../plugins/PluginContext";

import type { PrivateArea } from "../../../model/areas/impl/PrivateArea";
export class ObjectManager {

    private static readonly SCENE_SIZE = 104;
    private static readonly NONE: readonly GameObject[] = Object.freeze([]);
    /**
     * World.getObjects() indexed by tile and by 64x64 region (all planes), kept in step by
     * register/deregister (the only writers), so tile checks and scene loads stop scanning
     * every runtime object in the world.
     */
    private static readonly objectsByTile = new Map<string, GameObject[]>();
    private static readonly objectsByRegion = new Map<string, Set<GameObject>>();
    /**
     * Shared-world objects each player's client was sent and still shows, by tile and shape (the
     * client's own key), and the ones among them that were removed while the tile was outside
     * that player's scene. The client keeps a sent loc until told otherwise, so a door that
     * closed while its opener was away would otherwise still stand open when they come back.
     */
    private static readonly shownObjects = new WeakMap<Player, Map<string, GameObject>>();
    private static readonly missedRemovals = new WeakMap<Player, Map<string, GameObject>>();

    private static tileKey(location: Location): string {
        return `${location.getX()},${location.getY()},${location.getZ()}`;
    }

    private static shownKey(object: GameObject): string {
        return `${ObjectManager.tileKey(object.getLocation())},${object.getType()}`;
    }

    private static playerMap(maps: WeakMap<Player, Map<string, GameObject>>, player: Player): Map<string, GameObject> {
        let map = maps.get(player);
        if (!map) {
            map = new Map();
            maps.set(player, map);
        }
        return map;
    }

    private static sendShown(player: Player, object: GameObject): void {
        player.getPacketSender().sendObject(object);
        if (object.getPrivateArea()) return;
        const key = ObjectManager.shownKey(object);
        ObjectManager.playerMap(ObjectManager.shownObjects, player).set(key, object);
        ObjectManager.missedRemovals.get(player)?.delete(key);
    }

    /** Removals of objects this player was shown that happened while they were away, in the new scene. */
    private static sendMissedRemovals(player: Player, baseX: number, baseY: number): void {
        const missed = ObjectManager.missedRemovals.get(player);
        if (!missed?.size) return;
        for (const [key, object] of missed) {
            const location = object.getLocation();
            if (location.getX() < baseX || location.getX() >= baseX + this.SCENE_SIZE
                || location.getY() < baseY || location.getY() >= baseY + this.SCENE_SIZE) {
                continue;
            }
            missed.delete(key);
            // A removal also hides the map's own loc there, so put that back instead.
            const standing = MapObjects.getType(location.clone(), object.getType(), null);
            if (standing && !World.getRemovedObjects().some((removed) => ObjectManager.sameObjectIdentity(removed, standing))) {
                player.getPacketSender().sendObject(standing);
            } else {
                player.getPacketSender().sendObjectRemoval(object);
            }
        }
    }

    private static regionKey(x: number, y: number): string {
        return `${x >> 6},${y >> 6}`;
    }

    private static addToWorld(object: GameObject): void {
        World.getObjects().push(object);
        const location = object.getLocation();
        const tile = ObjectManager.tileKey(location);
        const onTile = ObjectManager.objectsByTile.get(tile);
        if (onTile) onTile.push(object);
        else ObjectManager.objectsByTile.set(tile, [object]);
        const region = ObjectManager.regionKey(location.getX(), location.getY());
        const inRegion = ObjectManager.objectsByRegion.get(region);
        if (inRegion) inRegion.add(object);
        else ObjectManager.objectsByRegion.set(region, new Set([object]));
    }

    private static removeFromWorld(object: GameObject): void {
        const objects = World.getObjects();
        const index = objects.indexOf(object);
        if (index >= 0) objects.splice(index, 1);
        const location = object.getLocation();
        const tile = ObjectManager.tileKey(location);
        const onTile = ObjectManager.objectsByTile.get(tile);
        if (onTile) {
            const at = onTile.indexOf(object);
            if (at >= 0) onTile.splice(at, 1);
            if (onTile.length === 0) ObjectManager.objectsByTile.delete(tile);
        }
        const region = ObjectManager.regionKey(location.getX(), location.getY());
        const inRegion = ObjectManager.objectsByRegion.get(region);
        if (inRegion) {
            inRegion.delete(object);
            if (inRegion.size === 0) ObjectManager.objectsByRegion.delete(region);
        }
    }

    /** The runtime objects registered in one 64x64 region (all planes, any private area). */
    public static objectsInRegion(regionX: number, regionY: number): readonly GameObject[] {
        const objects = ObjectManager.objectsByRegion.get(`${regionX},${regionY}`);
        return objects ? [...objects] : ObjectManager.NONE;
    }

    /**
     * Takes out every object a plugin registered, as the server shuts down: plugins never
     * reload, so nothing else would. A stand-in for a map object (a door closed again) stays.
     */
    public static removePluginObjects(): number {
        let removed = 0;
        for (const object of [...World.getObjects()]) {
            if (!object.getSpawnedBy() || object.isBaseMap()) continue;
            ObjectManager.deregister(object, true);
            removed++;
        }
        return removed;
    }

    /** The runtime objects registered on a tile (any private area). */
    public static objectsAt(location: Location): readonly GameObject[] {
        return ObjectManager.objectsByTile.get(ObjectManager.tileKey(location)) ?? ObjectManager.NONE;
    }

    private static sameObjectIdentity(a: GameObject, b: GameObject): boolean {
        return a.getId() === b.getId()
            && a.getType() === b.getType()
            && a.getFace() === b.getFace()
            && a.getPrivateArea() === b.getPrivateArea()
            && a.getOwner() === b.getOwner()
            && a.getLocation().equals(b.getLocation());
    }

    private static matchesBaseMapObject(object: GameObject): boolean {
        if (!object.getPrivateArea()) {
            return false;
        }
        const base = MapObjects.get(object.getId(), object.getLocation().clone(), null);
        return base != null
            && base.getType() === object.getType()
            && base.getFace() === object.getFace();
    }

    /** The area whose objects a player sees: the main world for someone on a boat deck. */
    private static viewedArea(player: Player): PrivateArea | null {
        const area = player.getPrivateArea();
        return area?.countsAsMainWorld() ? null : area;
    }

    public static onRegionChange(player: Player, baseX: number, baseY: number) {
        const viewedArea = this.viewedArea(player);
        if (!viewedArea) this.sendMissedRemovals(player, baseX, baseY);
        // Region sync should only target the requesting player.
        // Broadcasting every object spawn globally here causes redundant updates.
        // Apply base-map removals before additions, including replacements with a different shape.
        // Every plane: the scene holds all four, and the packets carry their own level, so a
        // change upstairs (or below) must not reappear when the scene is rebuilt.
        for (const object of World.getRemovedObjects()) {
            if (!object) {
                continue;
            }
            if (viewedArea !== object.getPrivateArea()) {
                continue;
            }
            const location = object.getLocation();
            if (location.getX() < baseX || location.getX() >= baseX + this.SCENE_SIZE
                || location.getY() < baseY || location.getY() >= baseY + this.SCENE_SIZE) {
                continue;
            }
            player.getPacketSender().sendObjectRemoval(object);
        }

        // Only the regions the scene covers, not every runtime object in the world.
        for (let regionX = baseX >> 6; regionX <= (baseX + this.SCENE_SIZE - 1) >> 6; regionX++) {
            for (let regionY = baseY >> 6; regionY <= (baseY + this.SCENE_SIZE - 1) >> 6; regionY++) {
                for (const object of ObjectManager.objectsByRegion.get(`${regionX},${regionY}`) ?? []) {
                    if (object.getOwner() && object.getOwner() !== player) {
                        continue;
                    }
                    if (viewedArea !== object.getPrivateArea()) {
                        continue;
                    }
                    if (this.matchesBaseMapObject(object)) {
                        continue;
                    }
                    const location = object.getLocation();
                    if (location.getX() < baseX || location.getX() >= baseX + this.SCENE_SIZE
                        || location.getY() < baseY || location.getY() >= baseY + this.SCENE_SIZE) {
                        continue;
                    }
                    this.sendShown(player, object);
                }
            }
        }
        for (const object of MapObjects.ownerObjectsInScene(player, baseX, baseY, this.SCENE_SIZE)) {
            player.getPacketSender().sendObject(object);
        }
    }

    public static register(object: GameObject, playerUpdate: boolean) {
        if (object.getSpawnedBy() === null) object.setSpawnedBy(PluginContext.current());
        // Check for matching object on this tile.
        for (const o of [...ObjectManager.objectsAt(object.getLocation())]) {
            if (o.getType() === object.getType() && object.getPrivateArea() == o.getPrivateArea()
                && object.getOwner() === o.getOwner()) {
                // Replacing a solid loc with an empty form must clear its old clipping too.
                if (playerUpdate) MapObjects.remove(o);
                if (o !== object) o.getPrivateArea()?.detach(o);
                ObjectManager.removeFromWorld(o);
            }
        }

        // Put back exactly as the map had it (a door closed again, from Doors' snapshot copy).
        for (let index = World.getRemovedObjects().length - 1; index >= 0; index--) {
            const removed = World.getRemovedObjects()[index];
            if (removed.getType() !== object.getType()) {
                continue;
            }
            if (!removed.getLocation().equals(object.getLocation())) {
                continue;
            }
            if (removed.getPrivateArea() !== object.getPrivateArea()) {
                continue;
            }
            RegionManager.removeObjectClipping(removed);
            World.getRemovedObjects().splice(index, 1);
            // It takes a removed map object's place (a door closed again): removing it later must
            // hide that spot on scene reloads, as for the original.
            object.markBaseMap();
        }

        // Original map objects need no replay when they respawn. Snapshot copies (doors)
        // must replay their restored state to clients that cached the open door while away.
        if (!object.isMapOriginal() || object.getPrivateArea()) {
            ObjectManager.addToWorld(object);
        }
        if (playerUpdate) {
            ObjectManager.perform(object, OperationType.SPAWN);
        }
    }
    /** True for a map object, or a copy of one (Doors rebuild theirs from a snapshot). */
    private static standsForMapObject(object: GameObject): boolean {
        if (object.isBaseMap()) {
            return true;
        }
        const placed = MapObjects.get(object.getId(), object.getLocation().clone(), null);
        return placed != null && placed.isBaseMap() && placed.getType() === object.getType();
    }

    public static deregister(object: GameObject, playerUpdate: boolean) {
        // Before the despawn takes it out of MapObjects.
        const mapObject = object.getPrivateArea() != null || ObjectManager.standsForMapObject(object);
        for (const existing of [...ObjectManager.objectsAt(object.getLocation())]) {
            if (ObjectManager.sameObjectIdentity(existing, object)) {
                existing.getPrivateArea()?.detach(existing);
                ObjectManager.removeFromWorld(existing);
            }
        }
        object.getPrivateArea()?.detach(object);

        if (playerUpdate) {
            ObjectManager.perform(object, OperationType.DESPAWN);
        }

        // Only map objects have to stay hidden when a scene reloads. Runtime objects (fires,
        // traps, temporary locs) used to pile up here for good: every scene load re-sent their
        // removals and every register/deregister scanned them all.
        if (!mapObject) {
            return;
        }
        const alreadyMarkedRemoved = World.getRemovedObjects().some((removed) =>
            ObjectManager.sameObjectIdentity(removed, object)
        );
        if (!alreadyMarkedRemoved) {
            World.getRemovedObjects().push(object);
        }
    }

    /**
     * Performs the given OperationType on the given GameObject.
     * Used for spawning and despawning objects. If the object has an owner, it will
     * only be spawned for them. Otherwise, it will act as global.
     *
     * @param object
     * @param type
     */
    public static perform(object: GameObject, type: OperationType) {
        if (object.getId() == -1) {
            type = OperationType.DESPAWN;
        }
        /**
         * We add/remove to/from mapobjects aswell. This is because the server handles
         * clipping via the map objects and also checks for cheatclients via them.
         */
        switch (type) {
            case OperationType.SPAWN:
                MapObjects.add(object);
                break;
            case OperationType.DESPAWN:
                MapObjects.remove(object);
                break;
        }

        /**
         * Send the object to nearby players.
         */
        switch (type) {
            case OperationType.SPAWN:
            case OperationType.DESPAWN:
                World.forEachNetworkPlayer((player) => {
                    if (object.getOwner() && object.getOwner() !== player) return;
                    if (this.viewedArea(player) != object.getPrivateArea()) {
                        return;
                    }
                    const location = object.getLocation();
                    if (!object.getPrivateArea() && !player.getSession().isTileInScene(
                        location.getX(), location.getY(), location.getZ()
                    )) {
                        if (type == OperationType.DESPAWN) this.recordMissedRemoval(player, object);
                        return;
                    }
                    if (type == OperationType.SPAWN) {
                        this.sendShown(player, object);
                    } else {
                        player.getPacketSender().sendObjectRemoval(object);
                        if (!object.getPrivateArea()) {
                            const key = this.shownKey(object);
                            this.shownObjects.get(player)?.delete(key);
                            this.missedRemovals.get(player)?.delete(key);
                        }
                    }
                });
                break;
        }
    }

    /**
     * Checks if a GameObject exists at the given location.
     *
     * @param position
     * @return
     */

    private static recordMissedRemoval(player: Player, object: GameObject): void {
        const key = ObjectManager.shownKey(object);
        const shown = ObjectManager.shownObjects.get(player);
        const sent = shown?.get(key);
        if (!sent || !ObjectManager.sameObjectIdentity(sent, object)) return;
        shown!.delete(key);
        ObjectManager.playerMap(ObjectManager.missedRemovals, player).set(key, object);
    }

    public static exists(id: number, position: Location): boolean {
        // As before: any runtime object on the tile counts, whatever its id.
        return ObjectManager.objectsAt(position).length > 0;
    }

    public static existsLocation(position: Location): boolean {
        return ObjectManager.objectsAt(position).length > 0;
    }
}

export enum OperationType {
    SPAWN, DESPAWN
}
