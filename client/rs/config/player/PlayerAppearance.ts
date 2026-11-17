import { IdkTypeLoader } from "../idktype/IdkTypeLoader";

export enum Gender {
    MALE = 0,
    FEMALE = 1,
}

/** Reused output for getHash/getCacheKey (single-threaded; read straight away). */
const HASH_SCRATCH: [number, number] = [0, 0];
/** The two hash lanes while getHashLanes runs (module state, so folding allocates nothing). */
let laneLo = 0;
let laneHi = 0;
function fold(value: number): void {
    laneLo = (Math.imul(laneLo, 31) + value) | 0;
    laneHi = (Math.imul(laneHi ^ value, 0x01000193) + (laneLo >>> 16)) | 0;
}

// Minimal OSRS-like appearance representation for Phase A
export class PlayerAppearance {
    readonly colorTextureOverrides: Array<{colors:number[]|null;textures:number[]|null}|undefined> = [];
    /** Item replacements in body-kit-only composition slots (arms, hair and jaw). */
    readonly compositionItems = new Map<number,number>();
    // 0 male, 1 female
    gender: Gender;
    pronouns: number;
    // hair, torso, legs, feet, skin (indices into palettes; Phase A uses defaults)
    colors: number[];
    // equip slots (head, cape, amulet, weapon, torso, shield, legs, gloves, boots, ring, ammo, ...)
    // Phase A: not used (all -1)
    equip: number[];
    // base body kits by bodyPart index:
    // 0 head/hair, 1 jaw/beard, 2 torso, 3 arms, 4 hands, 5 legs, 6 feet
    kits: number[];
    headIcons: { prayer?: number; skull?: number };
    npcTransformationId: number;
    /** Render only the components that should remain visible in first-person view. */
    firstPersonArmsOnly: boolean;

    constructor(
        gender: Gender,
        colors: number[],
        kits: number[],
        equip?: number[],
        headIcons?: { prayer?: number; skull?: number },
        npcTransformationId?: number,
        firstPersonArmsOnly: boolean = false,
    ) {
        this.gender = gender;
        this.pronouns = gender;
        this.colors = colors;
        this.kits = kits;
        this.equip = equip ?? new Array(14).fill(-1);
        this.headIcons = headIcons ?? { prayer: -1 };
        this.npcTransformationId = npcTransformationId ?? -1;
        this.firstPersonArmsOnly = firstPersonArmsOnly;
    }

    /**
     * Polynomial rolling hash (×31 per value) for caching composites, as two independent
     * 32-bit lanes. It was one 64-bit BigInt fold, which allocated a heap BigInt for every
     * multiply, add and mask, on every player, every frame; integer lanes allocate nothing.
     * The value is only ever a cache key inside this session.
     */
    getHashLanes(out: [number, number] = [0, 0]): [number, number] {
        laneLo = (this.npcTransformationId + 1) | 0;
        laneHi = 0x9e3779b9 | 0;
        fold(this.gender & 1);
        for (let i = 0; i < this.kits.length; i++) fold(((this.kits[i] ?? -1) + 1) | 0);
        for (let i = 0; i < this.colors.length; i++) fold(this.colors[i] & 0xff);
        const equipCount = Math.min(this.equip.length, 12);
        for (let i = 0; i < equipCount; i++) fold(((this.equip[i] ?? -1) + 1) | 0);
        for (let slot = 0; slot < this.colorTextureOverrides.length; slot++) {
            const override = this.colorTextureOverrides[slot];
            if (!override) continue;
            fold(slot + 1);
            const colors = override.colors;
            if (colors) for (let i = 0; i < colors.length; i++) fold(colors[i] & 0xffff);
            const textures = override.textures;
            if (textures) for (let i = 0; i < textures.length; i++) fold(textures[i] & 0xffff);
        }
        if (this.compositionItems.size > 0) {
            for (const [slot, item] of this.compositionItems) fold(((slot << 20) + item) | 0);
        }
        out[0] = laneLo >>> 0;
        out[1] = laneHi >>> 0;
        return out;
    }

    /** The hash as one 64-bit value (hi:lo). Prefer getHashLanes or getCacheKey in hot paths. */
    getHash(): bigint {
        const [lo, hi] = this.getHashLanes(HASH_SCRATCH);
        return (BigInt(hi) << 32n) | BigInt(lo);
    }

    getEquipKey(): string {
        const count = Math.min(this.equip.length, 14);
        let key = `${this.npcTransformationId | 0}|${this.gender | 0}|`;
        for (let i = 0; i < count; i++) {
            if (i > 0) key += ",";
            key += (this.equip[i] ?? -1) | 0;
        }
        return key;
    }

    getCacheKey(): string {
        const [lo, hi] = this.getHashLanes(HASH_SCRATCH);
        return `${hi.toString(36)}.${lo.toString(36)}|${this.getEquipKey()}|${this.firstPersonArmsOnly ? "first-person" : "full"}`;
    }

    static defaultMale(idkLoader: IdkTypeLoader): PlayerAppearance {
        const gender = Gender.MALE;
        const colors = [0, 0, 0, 0, 0];
        const kits = new Array<number>(7).fill(-1);
        const expectedBodyPartId = (partIndex: number) => partIndex | 0 | 0;

        const count = idkLoader.getCount();
        // First pass: selectable kits only
        for (let id = 0; id < count; id++) {
            try {
                const kit = idkLoader.load(id) as any;
                if (!kit || kit.nonSelectable) continue;
                const part: number = kit.bodyPartId ?? kit.bodyPartyId;
                if (typeof part === "number") {
                    for (let p = 0; p < 7; p++) {
                        if ((part | 0) === expectedBodyPartId(p) && kits[p] === -1) kits[p] = id;
                    }
                }
            } catch {}
        }
        // Second pass: allow non-selectable for missing head/jaw so we always get hair/beard
        for (let id = 0; id < count && (kits[0] === -1 || kits[1] === -1); id++) {
            try {
                const kit = idkLoader.load(id) as any;
                if (!kit) continue;
                const part: number = kit.bodyPartId ?? kit.bodyPartyId;
                if ((part | 0) === expectedBodyPartId(0) && kits[0] === -1) kits[0] = id;
                if ((part | 0) === expectedBodyPartId(1) && kits[1] === -1) kits[1] = id;
            } catch {}
        }

        return new PlayerAppearance(gender, colors, kits, new Array(14).fill(-1), { prayer: -1 });
    }

    static defaultFemale(idkLoader: IdkTypeLoader): PlayerAppearance {
        const gender = Gender.FEMALE;
        const colors = [0, 0, 0, 0, 0];
        const kits = new Array<number>(7).fill(-1);
        const expectedBodyPartId = (partIndex: number) => ((partIndex | 0) + 7) | 0;

        const count = idkLoader.getCount();
        for (let id = 0; id < count; id++) {
            try {
                const kit = idkLoader.load(id) as any;
                if (!kit || kit.nonSelectable) continue;
                const part: number = kit.bodyPartId ?? kit.bodyPartyId;
                if (typeof part === "number") {
                    for (let p = 0; p < 7; p++) {
                        if ((part | 0) === expectedBodyPartId(p) && kits[p] === -1) kits[p] = id;
                    }
                }
            } catch {}
        }
        for (let id = 0; id < count && (kits[0] === -1 || kits[1] === -1); id++) {
            try {
                const kit = idkLoader.load(id) as any;
                if (!kit) continue;
                const part: number = kit.bodyPartId ?? kit.bodyPartyId;
                if ((part | 0) === expectedBodyPartId(0) && kits[0] === -1) kits[0] = id;
                if ((part | 0) === expectedBodyPartId(1) && kits[1] === -1) kits[1] = id;
            } catch {}
        }

        return new PlayerAppearance(gender, colors, kits, new Array(14).fill(-1), { prayer: -1 });
    }
}
