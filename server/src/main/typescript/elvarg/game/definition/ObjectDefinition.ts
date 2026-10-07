import { CacheDefinitions } from "../cache/CacheDefinitions";
import { ObjectIdentifiers } from "../../util/ObjectIdentifiers";
import { Misc } from "../../util/Misc";

export class ObjectDefinition extends ObjectIdentifiers {
    private static readonly definitions = new Map<number, ObjectDefinition>();
    static totalObjects = 0;

    id: number;
    name: string;
    description?: string;
    clipType: number;
    private readonly sizeX: number;
    private readonly sizeY: number;
    private readonly projectileBlocking: boolean;
    private readonly blockingMask: number;
    private readonly interactive: boolean;
    private readonly interactions: string[] | null;
    private readonly minimapFunction: number;
    /** Multi-loc: what a player sees depends on a varbit/varp (forPlayer resolves it). */
    private readonly multiLoc: boolean;

    private constructor(id: number) {
        super();
        const cached = CacheDefinitions.getObject(id);
        this.id = id;
        this.name = cached.name;
        this.description = cached.desc;
        this.clipType = cached.clipType;
        this.sizeX = cached.sizeX;
        this.sizeY = cached.sizeY;
        this.projectileBlocking = cached.blocksProjectile;
        this.blockingMask = cached.clipMask;
        this.interactive = cached.isInteractive === 1;
        this.interactions = cached.actions?.some(Boolean) ? [...cached.actions] : null;
        this.minimapFunction = cached.mapFunctionId;
        this.multiLoc = !!cached.transforms;
    }

    static init(): void {
        this.definitions.clear();
        this.totalObjects = CacheDefinitions.getCounts().objects;
    }

    static forId(id: number): ObjectDefinition | undefined {
        if (!Number.isInteger(id) || id < 0 || id >= this.totalObjects) return undefined;
        let definition = this.definitions.get(id);
        if (!definition) {
            definition = new ObjectDefinition(id);
            this.definitions.set(id, definition);
        }
        return definition;
    }

    /**
     * A floor decoration (shape 22) blocks movement only when its blockWalk is 1, as in the OSRS
     * client and rsmod. Being interactive doesn't make it block: ToA's pressure plates and the
     * POH's build spaces are walked on.
     */
    isClippedDecoration(): boolean {
        return this.clipType === 1;
    }

    /** Resolve the same per-player loc variant that the client displays. */
    static forPlayer(id: number, player: { getPacketSender(): { getVarbit(id: number): number; getVarp(id: number): number } }): ObjectDefinition | null {
        // Most locs are not multi-locs: answer from the kept definition, without
        // re-decoding the cache type (its LRU churns when bots scan wide areas).
        const definition = this.forId(id);
        if (!definition?.multiLoc) return definition ?? null;
        const cached = CacheDefinitions.getObject(id);
        const vars = player.getPacketSender();
        const index = cached.transformVarbit !== -1 ? vars.getVarbit(cached.transformVarbit)
            : cached.transformVarp !== -1 ? vars.getVarp(cached.transformVarp) : -1;
        const resolved = index >= 0 && index < cached.transforms.length - 1
            ? cached.transforms[index] : cached.transforms[cached.transforms.length - 1];
        return resolved === -1 ? null : this.forId(resolved);
    }

    getName(): string { return this.name; }

    /**
     * OSRS sends loc examine text from the server, so the cache has none of it
     * (`desc` only ever gets set on older caches). Without a dump to link up,
     * unknown locs get a generic line instead of the bare name the examine
     * packet used to echo back.
     */
    getExamine(): string {
        if (this.description) return this.description;
        if (!this.name || this.name === "null") return "It's nothing special.";
        return `It's ${Misc.anOrA(this.name)} ${this.name}.`;
    }

    getSizeX(): number { return this.sizeX; }
    getSizeY(): number { return this.sizeY; }
    hasActions(): boolean { return this.interactive; }
    isSolid(): boolean { return this.clipType !== 0; }
    isImpenetrable(): boolean { return this.projectileBlocking; }
    getBlockingMask(): number { return this.blockingMask; }
    getInteractions(): string[] | null { return this.interactions; }
    getMinimapFunction(): number { return this.minimapFunction; }

    // Barrows crypt staircases (Ahrim/Dharok/Guthan/Karil/Verac=20667-20670,20672,
    // Torag=20671) - the cache names all six generically "Staircase" with no
    // per-brother distinction, so these can't be represented as named
    // ObjectIdentifiers constants. Referenced by raw id here instead.
    private static readonly BARROWS_STAIRCASE_SIZE_2 = new Set([20667, 20668, 20669, 20670, 20672]);
    private static readonly BARROWS_STAIRCASE_SIZE_3 = 20671;

    getSize(): number {
        switch (this.id) {
            case ObjectDefinition.BARROWS_STAIRCASE_SIZE_3:
                return 3;
            default:
                if (ObjectDefinition.BARROWS_STAIRCASE_SIZE_2.has(this.id)) return 2;
                return this.sizeX + this.sizeY - 1;
        }
    }
}
