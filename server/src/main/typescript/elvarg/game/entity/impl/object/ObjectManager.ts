import { World } from "../../../World";
import { RegionManager } from "../../../collision/RegionManager";
import { Player } from "../player/Player";
import { Location } from "../../../model/Location";
import { GameObject } from "./GameObject";
import { MapObjects } from "./MapObjects";

import type { PrivateArea } from "../../../model/areas/impl/PrivateArea";
export class ObjectManager {

    private static readonly SCENE_SIZE = 104;

    private static sameObjectIdentity(a: GameObject, b: GameObject): boolean {
        return a.getId() === b.getId()
            && a.getType() === b.getType()
            && a.getFace() === b.getFace()
            && a.getPrivateArea() === b.getPrivateArea()
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

        for (const object of World.getObjects()) {
            if (!object) {
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
            player.getPacketSender().sendObject(object);
        }
    }

    public static register(object: GameObject, playerUpdate: boolean) {
        // Check for matching object on this tile.
        for (let index = World.getObjects().length - 1; index >= 0; index--) {
            const o = World.getObjects()[index];
            if (o.getType() === object.getType() && o.getLocation().equals(object.getLocation()) && object.getPrivateArea() == o.getPrivateArea()) {
                World.getObjects().splice(index, 1);
            }
        }

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
        }

        World.getObjects().push(object);
        if (playerUpdate) {
            ObjectManager.perform(object, OperationType.SPAWN);
        }
    }
    public static deregister(object: GameObject, playerUpdate: boolean) {
        for (let index = World.getObjects().length - 1; index >= 0; index--) {
            const existing = World.getObjects()[index];
            if (!ObjectManager.sameObjectIdentity(existing, object)) {
                continue;
            }
            World.getObjects().splice(index, 1);
        }

        if (playerUpdate) {
            ObjectManager.perform(object, OperationType.DESPAWN);
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
                    if (this.viewedArea(player) != object.getPrivateArea()) {
                        return;
                    }
                    const location = object.getLocation();
                    if (!object.getPrivateArea() && !player.getSession().isTileInScene(
                        location.getX(), location.getY(), location.getZ()
                    )) {
                        return;
                    }
                    if (type == OperationType.SPAWN) {
                        player.getPacketSender().sendObject(object);
                    } else {
                        player.getPacketSender().sendObjectRemoval(object);
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

    public static exists(id: number, position: Location): boolean {
        for (const object of World.getObjects()) {
            if (object.getLocation().equals(position) && object.getId() == id) {
                return true;
            }
            if (object.getLocation().equals(position)) {
                return true;
            }
        }
        return false;
    }

    public static existsLocation(position: Location): boolean {
        const objects: GameObject[] = World.getObjects();
        for (const object of objects) {
          if (object.getLocation().equals(position)) {
            return true;
          }
        }
        return false;
      }
}

export enum OperationType {
    SPAWN, DESPAWN
}
