import { ObjectDefinition } from "../../../definition/ObjectDefinition";
import { RegionManager } from "../../../collision/RegionManager";
import { Player } from "../player/Player";
import { Location } from "../../../model/Location";
import { Area } from "../../../model/areas/Area";
import { PrivateArea } from "../../../model/areas/impl/PrivateArea";
import { PlayerRights } from "../../../model/rights/PlayerRights";
import { GameObject } from "./GameObject";

export class MapObjects {

    public static mapObjects: Map<number, GameObject[]> = new Map<number, GameObject[]>();
    private static readonly ownerObjects = new WeakMap<Player, Map<number, GameObject[]>>();

    private static addOwnerObject(player: Player, object: GameObject): void {
        let objects = this.ownerObjects.get(player);
        if (!objects) this.ownerObjects.set(player, objects = new Map());
        const hash = this.getHash(object.getLocation().getX(), object.getLocation().getY(), object.getLocation().getZ());
        let atTile = objects.get(hash);
        if (!atTile) objects.set(hash, atTile = []);
        if (!atTile.includes(object)) atTile.push(object);
    }

    private static removeOwnerObject(player: Player, object: GameObject): void {
        const objects = this.ownerObjects.get(player);
        if (!objects) return;
        const hash = this.getHash(object.getLocation().getX(), object.getLocation().getY(), object.getLocation().getZ());
        const atTile = objects.get(hash);
        if (!atTile) return;
        const index = atTile.indexOf(object);
        if (index >= 0) atTile.splice(index, 1);
        if (atTile.length === 0) objects.delete(hash);
    }

    public static ownerObjectsInScene(player: Player, baseX: number, baseY: number, size: number): GameObject[] {
        const objects = this.ownerObjects.get(player);
        if (!objects) return [];
        const result: GameObject[] = [];
        for (const atTile of objects.values()) {
            for (const object of atTile) {
                const location = object.getLocation();
                if (location.getX() >= baseX && location.getX() < baseX + size
                    && location.getY() >= baseY && location.getY() < baseY + size) result.push(object);
            }
        }
        return result;
    }

    public static getPrivateArea(player: Player, id: number, location: Location): GameObject {
        const hash = this.getHash(location.getX(), location.getY(), location.getZ());
        const owned = this.ownerObjects.get(player)?.get(hash)?.find((entry) =>
            entry.getLocation().equals(location) && ObjectDefinition.forPlayer(entry.getId(), player)?.id === id
        ) ?? null;
        if (owned) return owned;
        let object = this.get(id, location, player.getPrivateArea());
        if (!object) {
            const candidates = player.getPrivateArea()?.getObjects() ?? [];
            const shared = this.mapObjects.get(this.getHash(location.getX(), location.getY(), location.getZ())) ?? [];
            object = [...candidates, ...shared].find((entry) => entry.getLocation().equals(location)
                && ObjectDefinition.forPlayer(entry.getId(), player)?.id === id) ?? null;
        }
        if (!object) {
            object = player.getPrivateArea()?.resolveObject(id, location, player) ?? null;
        }
        // Locs on bridge tiles are loaded one plane down (RegionManager), but the player
        // standing beside them - on a castle wall, say - is still on the plane above.
        if (!object && location.getZ() > 0) {
            object = this.get(id, new Location(location.getX(), location.getY(), location.getZ() - 1), player.getPrivateArea());
        }
        if (object && !ObjectDefinition.forPlayer(object.getId(), player)) return null;

        if (object == null && player.getRights() == PlayerRights.DEVELOPER) {
            player.sendMessage("@red@Object with id " + id + " does not exist.");
        }

        return object;
    }

    /**
     * Whether the loc a player clicked, or one just like it, still stands where they clicked:
     * nobody removed or changed it while they walked there (a door another player opened).
     */
    public static stillStands(player: Player, id: number, location: Location, object: GameObject): boolean {
        const current = this.getPrivateArea(player, id, location);
        return current === object || (current != null && current.getId() === object.getId()
            && current.getType() === object.getType() && current.getFace() === object.getFace());
    }

    public static get(id: number, location: Location, privateArea: PrivateArea): GameObject {
        // Check instanced objects..
        if (privateArea != null) {
            const instanced = MapObjects.preferReachable(privateArea.getObjects()
                .filter((object) => object.getId() == id && object.getLocation().equals(location)));
            if (instanced) return instanced;
        }

        // Load region..
        RegionManager.loadMapFiles(location.getX(), location.getY());

        // Get hash..
        if (location.getZ() >= 4) {
            location = location.clone().setZ(0);
        }
        let hash = this.getHash(location.getX(), location.getY(), location.getZ());

        // Check if the map contains the hash..
        if (!this.mapObjects.has(hash)) {
            return null;
        }

        // Go through the objects in the list..
        let list = this.mapObjects.get(hash);
        if (list != null) {
            return MapObjects.preferReachable(list.filter((o) => o.getId() == id && o.getLocation().equals(location)));
        }
        return null;
    }

    /**
     * One loc id placed twice on a tile, as a straight wall decoration (shapes 4-5) and as
     * something else (the scoreboard outside Araxxor's lair: shape 10 and shape 4). A click
     * names only the id and the tile, and a straight wall decoration is only reached by
     * standing on its tile, under the other copy, so the other copy is the one used.
     */
    private static preferReachable(matches: GameObject[]): GameObject {
        if (matches.length <= 1) return matches[0] ?? null;
        return matches.find((o) => o.getType() !== 4 && o.getType() !== 5) ?? matches[0];
    }

    public static getType(location: Location, type: number, privateArea: PrivateArea): GameObject {
        // Check instanced objects..
        if (privateArea != null) {
            for (let object of privateArea.getObjects()) {
                if (object.getType() == type && object.getLocation().equals(location)) {
                    return object;
                }
            }
        }

        // Load region..
        RegionManager.loadMapFiles(location.getX(), location.getY());

        // Get hash..
        if (location.getZ() >= 4) {
            location = location.clone().setZ(0);
        }
        let hash = MapObjects.getHash(location.getX(), location.getY(), location.getZ());

        // Check if the map contains the hash..
        if (!this.mapObjects.has(hash)) {
            return null;
        }

        // Go through the objects in the list..
        let list = this.mapObjects.get(hash);
        if (list != null) {
            for (let o of list) {
                if (o.getType() == type && o.getLocation().equals(location)) {
                    return o;
                }
            }
        }
        return null;
    }

    /**
     * All scenery at a tile in the area's view: template/private scenery for template-map
     * instances and the loaded cache map for normal-map scenes, including private encounters.
     */
    public static getObjectsAt(location: Location, privateArea: PrivateArea): GameObject[] {
        const objects = new Set<GameObject>();
        if (privateArea) {
            for (const object of privateArea.getObjects()) {
                if (object.getLocation().equals(location)) objects.add(object);
            }
            for (const object of privateArea.getTemplateObjects(location)) objects.add(object);
        }

        // countsAsMainWorld controls cross-area visibility, not which map scenery is drawn.
        // Ordinary private encounters still use the cache map; template instances do not.
        if (!privateArea || !privateArea.usesTemplateMap()) {
            RegionManager.loadMapFiles(location.getX(), location.getY());
            const mapLocation = location.getZ() >= 4 ? location.clone().setZ(0) : location;
            const hash = this.getHash(mapLocation.getX(), mapLocation.getY(), mapLocation.getZ());
            for (const object of this.mapObjects.get(hash) ?? []) {
                if (object.getPrivateArea() == null && object.getLocation().equals(mapLocation)) {
                    objects.add(object);
                }
            }
        }
        return [...objects];
    }

    static exists(object: GameObject): boolean {
        return this.get(object.getId(), object.getLocation(), object.getPrivateArea()) === object;
    }

    static add(object: GameObject) {
        if (object.getOwner()) {
            this.addOwnerObject(object.getOwner()!, object);
            return;
        }
        if (!object.getPrivateArea()) {

            const hash = this.getHash(object.getLocation().getX(), object.getLocation().getY(), object.getLocation().getZ());

            if (this.mapObjects.has(hash)) {
                let exists = false;
                const list = this.mapObjects.get(hash);
                list.forEach((o: GameObject) => {
                    if (o === object) {
                        exists = true;
                        return;
                    }
                });
                if (!exists) {
                    this.mapObjects.get(hash).push(object);
                }
            } else {
                this.mapObjects.set(hash, [object]);
            }
        }

        RegionManager.addObjectClipping(object);
    }

    static remove(object: GameObject) {
        if (object.getOwner()) {
            this.removeOwnerObject(object.getOwner()!, object);
            return;
        }
        if (!object.getPrivateArea()) {
            const hash = this.getHash(object.getLocation().getX(), object.getLocation().getY(), object.getLocation().getZ());

            if (this.mapObjects.has(hash)) {
                const list = this.mapObjects.get(hash);
                for (let i = list.length - 1; i >= 0; i--) {
                    if (list[i].getId() === object.getId() && list[i].getType() === object.getType()
                        && list[i].getFace() === object.getFace() && list[i].getLocation().equals(object.getLocation())) {
                        list.splice(i, 1);
                    }
                }
            }
        }

        RegionManager.removeObjectClipping(object);
    }

    static clear(position: Location, clipShift: number) {
        const hash = this.getHash(position.getX(), position.getY(), position.getZ());

        if (this.mapObjects.has(hash)) {
            const list = this.mapObjects.get(hash);
            for (let i = 0; i < list.length; i++) {
                if (list[i].getLocation().equals(position)) {
                    list.splice(i, 1);
                }
            }
        }

        RegionManager.removeClipping(position.getX(), position.getY(), position.getZ(), clipShift, null);
    }

    /**
     * One key per tile. JavaScript shifts use only the low five bits of the count and wrap at
     * 32 bits, so the old `z + (x << 24) + (y << 48)` gave far-apart tiles the same key (a
     * Lumbridge cellar tile looked up the castle's first floor). Map coordinates stay below
     * 16384, so this product is unique and well within the exact integer range.
     */
    static getHash(x: number, y: number, z: number): number {
        return (z * 16384 + x) * 16384 + y;
    }
}
