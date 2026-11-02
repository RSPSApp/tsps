import { Entity } from "../../Entity";
import { ObjectDefinition } from "../../../definition/ObjectDefinition"
import { World } from "../../../World";
import { Player } from "../player/Player";
import { Animation } from "../../../model/Animation"
import { Graphic } from "../../../model/Graphic"
import { Location } from "../../../model/Location"
import { PrivateArea } from "../../../model/areas/impl/PrivateArea"


export class GameObject extends Entity {

    private id: number;
    private type: number;
    private face: number;
    private privateArea: PrivateArea;
    private owner: Player | null = null;
    /**
     * Stands for an object of the cache's map (loaded with the region, or put back in place of
     * one). Only these are remembered once removed, so a reloaded scene keeps them hidden.
     */
    private baseMap = false;
    /** The very instance the region loader created from the cache's map data. */
    private mapOriginal = false;
    /** The plugin whose code registered this object, or null for core's own. */
    private spawnedBy: string | null = null;

    constructor(id: number, position: Location, type: number, face: number, privateArea: PrivateArea) {
        super(position);
        this.id = id;
        this.type = type;
        this.face = face;
        if (privateArea != null) {
            privateArea.add(this);
        }
        this.privateArea = privateArea;
    }

    public getId(): number {
        return this.id;
    }

    public isBaseMap(): boolean {
        return this.baseMap;
    }

    public markBaseMap(): this {
        this.baseMap = true;
        return this;
    }

    public isMapOriginal(): boolean {
        return this.mapOriginal;
    }

    /** Set by the region loader only: this object is the cache map's own. */
    public markMapOriginal(): this {
        this.mapOriginal = true;
        return this.markBaseMap();
    }

    public getSpawnedBy(): string | null {
        return this.spawnedBy;
    }

    public setSpawnedBy(pluginName: string | null): this {
        this.spawnedBy = pluginName;
        return this;
    }

    public getType(): number {
        return this.type;
    }

    public setType(type: number): void {
        this.type = type;
    }

    public getFace(): number {
        return this.face;
    }

    public getOwner(): Player | null {
        return this.owner;
    }

    public setOwner(owner: Player | null): this {
        this.owner = owner;
        return this;
    }

    public setFace(face: number): void {
        this.face = face;
    }

    public getDefinition(): ObjectDefinition {
        return ObjectDefinition.forId(this.id);
    }

    public performAnimation(animation: Animation): void {
        World.forEachNetworkPlayer((player) => {
            if (player.getPrivateArea() !== this.getPrivateArea()) {
                return;
            }
            if (!player.getLocation().isViewableFrom(this.getLocation())) {
                return;
            }
            player.getPacketSender().sendObjectAnimation(this, animation);
        });
    }

    public performGraphic(graphic: Graphic): void {
        World.forEachNetworkPlayer((player) => {
            if (player.getPrivateArea() !== this.getPrivateArea()) {
                return;
            }
            if (!player.getLocation().isViewableFrom(this.getLocation())) {
                return;
            }
            player.getPacketSender().sendGraphic(graphic, this.getLocation());
        });
    }

    public getSize(): number {
        const definition: ObjectDefinition = this.getDefinition();
        if (definition == null) {
            return 1;
        }
        return (definition.getSizeX() + definition.getSizeY()) - 1;
    }

    /**
     * Tiles (Chebyshev) from a location to the nearest tile of this loc's footprint, its sizes
     * swapped by a quarter turn; Infinity on another plane. A 5x5 essence rock is next to a
     * player on any of its 24 edge tiles, not only near its south-west corner.
     */
    public footprintDistance(from: Location): number {
        const at = this.getLocation();
        if (from.getZ() !== at.getZ()) return Number.POSITIVE_INFINITY;
        const definition = this.getDefinition();
        const sizeX = definition?.getSizeX() ?? 1;
        const sizeY = definition?.getSizeY() ?? 1;
        const turned = (this.face & 1) === 1;
        const width = Math.max(1, turned ? sizeY : sizeX);
        const length = Math.max(1, turned ? sizeX : sizeY);
        const gap = (point: number, start: number, size: number) => Math.max(0, start - point, point - (start + size - 1));
        return Math.max(gap(from.getX(), at.getX(), width), gap(from.getY(), at.getY(), length));
    }

    /** Whether a skilling action on this loc may continue from that tile (within 2 of its footprint). */
    public isWithinInteractionDistance(from: Location): boolean {
        return this.footprintDistance(from) <= GameObject.INTERACTION_DISTANCE;
    }

    private static readonly INTERACTION_DISTANCE = 2;

    equals(o: any): boolean {
        if (!(o instanceof GameObject))
            return false;
        let object = o as GameObject;
        return object.getLocation().equals(this.getLocation()) && object.getId() === this.getId() && object.getFace() === this.getFace()
            && object.getType() === this.getType() && object.getPrivateArea() === this.getPrivateArea();
    }

    clone(): GameObject {
        return new GameObject(
            this.getId(),
            this.getLocation().clone(),
            this.getType(),
            this.getFace(),
            this.getPrivateArea()!
        ).setOwner(this.getOwner());
    }
}
