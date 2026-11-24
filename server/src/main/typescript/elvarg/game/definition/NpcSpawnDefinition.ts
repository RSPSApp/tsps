import { Direction } from "../model/Direction";
import { Location } from "../model/Location";
import { DefaultSpawnDefinition } from "./DefaultSpawnDefinition";

export class NpcSpawnDefinition extends DefaultSpawnDefinition {
    private static definitions: NpcSpawnDefinition[] = [];

    private facing: Direction;
    private radius: number | null;
    private description: string;
    private source: string;

    constructor(
        id: number,
        position: Location,
        facing: Direction,
        radius: number | null,
        description: string = "",
        source: string = "core",
        private readonly leashRadius?: number,
    ) {
        super(id, position);
        this.facing = facing;
        this.radius = radius;
        this.description = description;
        this.source = source;
    }

    public static replace(definitions: NpcSpawnDefinition[]): void {
        this.definitions = definitions.slice();
    }

    public static all(): readonly NpcSpawnDefinition[] {
        return this.definitions;
    }

    public getFacing(): Direction {
        return this.facing;
    }

    public getRadius(): number | null {
        return this.radius;
    }

    public getLeashRadius(): number | undefined {
        return this.leashRadius;
    }

    public getDescription(): string {
        return this.description;
    }

    public getSource(): string {
        return this.source;
    }

    public equals(o: Object): boolean {
        if (!(o instanceof NpcSpawnDefinition))
            return false;
        let def = o as NpcSpawnDefinition;
        return def.getPosition().equals(this.getPosition())
            && def.getId() == this.getId()
            && def.getFacing() == this.getFacing()
            && def.getRadius() == this.getRadius()
            && def.getLeashRadius() === this.getLeashRadius();
    }
}
