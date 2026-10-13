import { IdkTypeLoader } from "../idktype/IdkTypeLoader";

export enum Gender {
    MALE = 0,
    FEMALE = 1,
}

// Minimal OSRS-like appearance representation for Phase A
export class PlayerAppearance {
    readonly colorTextureOverrides: Array<{colors:number[]|null;textures:number[]|null}|undefined> = [];
    /** Item replacements in body-kit-only composition slots (arms, hair and jaw). */
    readonly compositionItems = new Map<number,number>();
    // 0 male, 1 female
    gender: Gender;
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
        this.colors = colors;
        this.kits = kits;
        this.equip = equip ?? new Array(14).fill(-1);
        this.headIcons = headIcons ?? { prayer: -1 };
        this.npcTransformationId = npcTransformationId ?? -1;
        this.firstPersonArmsOnly = firstPersonArmsOnly;
    }

    // Polynomial rolling hash for caching composites
    getHash(): bigint {
        const MASK_64 = (1n << 64n) - 1n;
        const PRIME = 31n;
        let h = BigInt(this.npcTransformationId + 1);
        h = (h * PRIME + BigInt(this.gender & 1)) & MASK_64;
        for (let i = 0; i < this.kits.length; i++) {
            const v = BigInt((this.kits[i] ?? -1) + 1);
            h = (h * PRIME + v) & MASK_64;
        }
        for (let i = 0; i < this.colors.length; i++) {
            const v = BigInt(this.colors[i] & 0xff);
            h = (h * PRIME + v) & MASK_64;
        }
        for (let i = 0; i < Math.min(this.equip.length, 12); i++) {
            const v = BigInt((this.equip[i] ?? -1) + 1);
            h = (h * PRIME + v) & MASK_64;
        }
        for (let slot=0;slot<this.colorTextureOverrides.length;slot++) {
            const override=this.colorTextureOverrides[slot];if(!override)continue;
            h=(h*PRIME+BigInt(slot+1))&MASK_64;
            for(const value of override.colors ?? [])h=(h*PRIME+BigInt(value&0xffff))&MASK_64;
            for(const value of override.textures ?? [])h=(h*PRIME+BigInt(value&0xffff))&MASK_64;
        }
        for(const [slot,item] of this.compositionItems)h=(h*PRIME+BigInt((slot<<20)+item))&MASK_64;
        return h;
    }

    getEquipKey(): string {
        const parts: number[] = [];
        const count = Math.min(this.equip.length, 14);
        for (let i = 0; i < count; i++) parts.push((this.equip[i] ?? -1) | 0);
        return `${this.npcTransformationId | 0}|${this.gender | 0}|${parts.join(",")}`;
    }

    getCacheKey(): string {
        const hash = this.getHash?.().toString() ?? "0";
        return `${hash}|${this.getEquipKey()}|${this.firstPersonArmsOnly ? "first-person" : "full"}`;
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
