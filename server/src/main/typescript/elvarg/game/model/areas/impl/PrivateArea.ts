
import { Area } from '../Area';
import { Boundary } from '../../Boundary';
import { Entity } from '../../../entity/Entity';
import { World } from '../../../World'
import { ObjectManager } from '../../../entity/impl/object/ObjectManager';
import { ItemOnGroundManager } from '../../../entity/impl/grounditem/ItemOnGroundManager'
import { GameObject } from '../../../entity/impl/object/GameObject';
import { Mobile } from '../../../entity/impl/Mobile';
import { Location } from '../../Location';
import type { Player } from '../../../entity/impl/player/Player';

export abstract class PrivateArea extends Area {
    public entities: Entity[];
    private clips: Map<string, number>;
    private destroyed: boolean;

    constructor(boundaries?: Boundary[]) {
        super(boundaries);
        this.entities = [];
        this.clips = new Map();
        this.destroyed = false;
    }

    postLeave(mobile: Mobile, logout: boolean) {
        this.remove(mobile);
        if (this.getPlayers().length === 0) {
            this.destroy();
        }
    }

    postEnter(mobile: Mobile) {
        this.add(mobile);
    }

    remove(entity: Entity) {
        this.detach(entity);
        entity.setArea(null);
    }

    detach(entity: Entity) {
        this.entities = this.entities.filter((e) => e !== entity);
    }

    add(entity: Entity) {
        const entered = !this.entities.includes(entity);
        if (entered) {
            this.entities.push(entity);
        }
        entity.setArea(this);
        // "private-area:entered" { player, area }: a player has just joined this instance.
        if (entered && (entity as any)?.isPlayer?.() === true) {
            require("../../../../plugins/PluginManager").PluginManager.emitCustomEvent("private-area:entered", { player: entity, area: this });
        }
    }

    public destroy() {
        if (this.destroyed) {
            return;
        }
        // NPCs that entered the area, and those attached with add() (a boss or minions spawned for the instance, which
        // never pass through enter() while the area is unregistered): none outlives the instance, a pending spawn included.
        const removeQueue = World.getRemoveNPCQueue();
        const addQueue = World.getAddNPCQueue();
        const npcs = new Set(this.getNpcs());
        for (const entity of this.entities as any[]) {
            if (entity?.isNpc?.() === true) npcs.add(entity.getAsNpc());
        }
        for (const npc of npcs) {
            for (let index = addQueue.indexOf(npc); index !== -1; index = addQueue.indexOf(npc)) {
                addQueue.splice(index, 1);
            }
            if (npc.isRegistered() && !removeQueue.includes(npc)) {
                removeQueue.push(npc);
            }
        }
        for (let object of this.getObjects()) {
            ObjectManager.deregister(object, false);
        }
        const removedObjects = World.getRemovedObjects();
        for (let index = removedObjects.length - 1; index >= 0; index--) {
            if (removedObjects[index].getPrivateArea() === this) removedObjects.splice(index, 1);
        }
        for (let item of World.getItems()) {
            if (item.getPrivateArea() === this) {
                ItemOnGroundManager.deregister(item);
            }
        }
        this.entities = [];
        this.clips.clear();
        this.destroyed = true;
    }

    public getObjects(): GameObject[] {
        let objects: GameObject[] = [];
        for (let entity of this.entities) {
            if (entity instanceof GameObject) {
                objects.push(entity);
            }
        }
        return objects;
    }

    /**
     * Whether people in this area see, and are seen from, the main world around them. A boat
     * deck does: it is drawn where the boat is at sea.
     */
    public countsAsMainWorld(): boolean {
        return false;
    }

    /** Optional default lifetime for floor items in this instance, in game ticks. */
    public groundItemDespawnDelay(): number | null {
        return null;
    }

    /** Whether this area's scene is copied from cache template chunks instead of the normal map. */
    public usesTemplateMap(): boolean {
        return false;
    }

    /** Template-map scenery at a tile; ordinary private areas use the regular map instead. */
    public getTemplateObjects(_location: Location): GameObject[] {
        return [];
    }

    /** Allows an instance to validate client-only dynamic locs on demand. */
    public resolveObject(_id: number, _location: Location, _player?: Player): GameObject | null {
        return null;
    }

    private clipKey(location: Location): string {
        return `${location.getX()},${location.getY()},${location.getZ()}`;
    }

    public setClip(location: Location, mask: number) {
        this.clips.set(this.clipKey(location), mask | 0);
    }

    public removeClip(location: Location) {
        this.clips.delete(this.clipKey(location));
    }

    public hasClip(location: Location): boolean {
        return this.clips.has(this.clipKey(location));
    }

    public getClip(location: Location) {
        return this.clips.get(this.clipKey(location)) ?? 0;
    }

    public isDestroyed() {
        return this.destroyed;
    }

}
