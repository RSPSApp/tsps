
import { Area } from '../Area';
import { Boundary } from '../../Boundary';
import { Entity } from '../../../entity/Entity';
import { World } from '../../../World'
import { ObjectManager } from '../../../entity/impl/object/ObjectManager';
import { ItemOnGroundManager } from '../../../entity/impl/grounditem/ItemOnGroundManager'
import { GameObject } from '../../../entity/impl/object/GameObject';
import { Mobile } from '../../../entity/impl/Mobile';
import { Location } from '../../Location';

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
        if (!this.entities.includes(entity)) {
            this.entities.push(entity);
        }
        entity.setArea(this);
    }

    public destroy() {
        if (this.destroyed) {
            return;
        }
        for (let npc of this.getNpcs()) {
            if (npc.isRegistered()) {
                World.getRemoveNPCQueue().push(npc);
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

    /** Allows an instance to validate client-only dynamic locs on demand. */
    public resolveObject(_id: number, _location: Location): GameObject | null {
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
