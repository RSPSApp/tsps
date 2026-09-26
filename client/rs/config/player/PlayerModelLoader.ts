import { Model } from "../../model/Model";
import { ModelData } from "../../model/ModelData";
import { ModelLoader } from "../../model/ModelLoader";
import { TextureLoader } from "../../texture/TextureLoader";
import { IdkTypeLoader } from "../idktype/IdkTypeLoader";
import { ObjType } from "../objtype/ObjType";
import { ObjTypeLoader } from "../objtype/ObjTypeLoader";
import {
    EquipmentSlot,
    deriveEquipSlotFromParams,
} from "./Equipment";
import { Gender, PlayerAppearance } from "./PlayerAppearance";
import {
    PLAYER_BODY_RECOLOR_FROM_1,
    PLAYER_BODY_RECOLOR_FROM_2,
    PLAYER_BODY_RECOLOR_TO_1,
    PLAYER_BODY_RECOLOR_TO_2,
} from "./PlayerDesignColors";

// Model face colours are stored as unsigned 16-bit HSL values.  Some of the
// PlayerComposition palette constants originate from signed Java shorts, so
// normalise them before comparing them with ModelData.faceColors.
const asUnsignedHsl = (color: number): number => color & 0xffff;

const compositionSlotToKitPart: Record<number, number> = {
    4: 2,
    6: 3,
    7: 5,
    8: 0,
    9: 4,
    10: 6,
    11: 1,
};

const equipmentModelRenderOrder = (slot: EquipmentSlot): number => {
    if (slot === EquipmentSlot.BODY) return EquipmentSlot.AMULET;
    if (slot === EquipmentSlot.AMULET) return EquipmentSlot.BODY;
    return slot;
};

const equipmentRenderLayer = (slot: EquipmentSlot): number => {
    if (slot === EquipmentSlot.BODY || slot === EquipmentSlot.LEGS) return 0;
    if (slot === EquipmentSlot.AMULET) return 4;
    return 7;
};

// Phase A: compose body from IdentityKits only (no equipment yet)
export class PlayerModelLoader {
    private readonly defaultKitsCache = new Map<number, number[]>();

    constructor(
        readonly idkTypeLoader: IdkTypeLoader,
        readonly objTypeLoader: ObjTypeLoader,
        readonly modelLoader: ModelLoader,
        readonly textureLoader: TextureLoader,
    ) {}

    buildStaticModel(
        appearance: PlayerAppearance,
        extraObjTypes?: ObjType[],
        extraRenderLayers?: number[],
    ): Model | undefined {
        const missesBefore = this.modelLoader.missCount ?? 0;
        const modelDatas: ModelData[] = [];
        // null = keep the model's own per-face priorities (only the torso uses these; its
        // overlay/pocket faces carry higher priorities than the shirt and must win on ties).
        const modelRenderLayers: (number | null)[] = [];
        const colors = Array.isArray(appearance.colors) ? appearance.colors : [];

        // Body parts 0..6 per Idk: 0 head, 1 jaw, 2 torso, 3 arms, 4 hands, 5 legs, 6 feet
        for (let part = 0; part <= 6; part++) {
            const kitId = appearance.kits[part] ?? -1;
            if (kitId === -1) continue;
            try {
                const kit = this.idkTypeLoader.load(kitId) as any;
                const ids: number[] = kit.modelIds ?? [];
                for (let i = 0; i < ids.length; i++) {
                    const md = this.modelLoader.getModel(ids[i]);
                    if (!md) continue;
                    // Apply kit recolors/retextures first
                    if (kit.recolorFrom) {
                        for (let r = 0; r < kit.recolorFrom.length; r++) {
                            md.recolor(kit.recolorFrom[r], kit.recolorTo[r]);
                        }
                    }
                    if (kit.retextureFrom) {
                        for (let r = 0; r < kit.retextureFrom.length; r++) {
                            md.retexture(kit.retextureFrom[r], kit.retextureTo[r]);
                        }
                    }
                    // Apply PlayerComposition body color recolors (hair/torso/legs/feet/skin).
                    // Reference: PlayerComposition.getModel recolor loops.
                    for (let c = 0; c < 5; c++) {
                        const idx = (colors[c] ?? 0) | 0;
                        const pal1 = PLAYER_BODY_RECOLOR_TO_1[c] ?? [];
                        if (idx >= 0 && idx < pal1.length) {
                            md.recolor(
                                asUnsignedHsl(PLAYER_BODY_RECOLOR_FROM_1[c] | 0),
                                asUnsignedHsl(pal1[idx] | 0),
                            );
                        }
                        const pal2 = PLAYER_BODY_RECOLOR_TO_2[c] ?? [];
                        if (idx >= 0 && idx < pal2.length) {
                            md.recolor(
                                asUnsignedHsl(PLAYER_BODY_RECOLOR_FROM_2[c] | 0),
                                asUnsignedHsl(pal2[idx] | 0),
                            );
                        }
                    }
                    modelDatas.push(md);
                    modelRenderLayers.push(part === 2 ? null : 7);
                }
            } catch {}
        }

        // Merge extra wearable object models (e.g., boots, helms)
        if (extraObjTypes && extraObjTypes.length > 0) {
            const isFemale = appearance.gender === (1 as any);
            for (let objIndex = 0; objIndex < extraObjTypes.length; objIndex++) {
                const obj = extraObjTypes[objIndex];
                const renderLayer = extraRenderLayers?.[objIndex] ?? 0;
                const ids: number[] = [];
                const wearModel0 = isFemale ? obj.femaleModel : obj.maleModel;
                const wearModel1 = isFemale ? obj.femaleModel1 : obj.maleModel1;
                const wearModel2 = isFemale ? obj.femaleModel2 : obj.maleModel2;
                if (wearModel0 !== -1) ids.push(wearModel0);
                if (wearModel1 !== -1) ids.push(wearModel1);
                if (wearModel2 !== -1) ids.push(wearModel2);
                for (const id of ids) {
                    const md = this.modelLoader.getModel(id);
                    if (!md) continue;
                    if (obj.resizeX !== 128 || obj.resizeY !== 128 || obj.resizeZ !== 128) {
                        md.resize(obj.resizeX, obj.resizeY, obj.resizeZ);
                    }
                    if (obj.recolorFrom) {
                        for (let r = 0; r < obj.recolorFrom.length; r++) {
                            md.recolor(obj.recolorFrom[r], obj.recolorTo[r]);
                        }
                    }
                    if (obj.retextureFrom) {
                        for (let r = 0; r < obj.retextureFrom.length; r++) {
                            md.retexture(obj.retextureFrom[r], obj.retextureTo[r]);
                        }
                    }
                    // Apply wearable offsets (male assumed for default appearance)
                    try {
                        const male = appearance.gender === (0 as any); // Gender.MALE = 0
                        const ox = male
                            ? (obj as any).manwearXOff | 0
                            : (obj as any).womanwearXOff | 0;
                        const oy = male
                            ? (obj as any).manwearYOff | 0
                            : (obj as any).womanwearYOff | 0;
                        const oz = male
                            ? (obj as any).manwearZOff | 0
                            : (obj as any).womanwearZOff | 0;
                        if (ox !== 0 || oy !== 0 || oz !== 0) {
                            md.translate(ox, oy, oz);
                        }
                    } catch {}
                    modelDatas.push(md);
                    modelRenderLayers.push(renderLayer);
                }
            }
        }

        if (modelDatas.length === 0) {
            return undefined;
        }
        if ((this.modelLoader.missCount ?? 0) !== missesBefore) {
            // A body-part model is still streaming in; don't build (and let
            // callers cache) a partial player model.
            return undefined;
        }

        const merged = ModelData.merge(modelDatas, modelDatas.length);
        const model = merged.light(this.textureLoader, 64, 850, -30, -50, -30);
        model.faceRenderLayers = new Uint8Array(merged.faceCount);
        // Default every face to the priority it came out of the cache with, then override the
        // parts/equipment that use an explicit render layer. The torso keeps its cache
        // priorities so its shaped faces (pockets, hem) stack correctly instead of z-fighting.
        if (model.faceRenderPriorities) model.faceRenderLayers.set(model.faceRenderPriorities);
        // The torso's cache priorities (e.g. 2 = hem, 3 = shirt, 4 = front overlay) sit only one
        // layer apart, but the overlay can be a model-unit behind the shirt surface. One layer of
        // depth bias (~0.015) then barely clears it, so the overlay z-fights and flickers as the
        // camera/animation shifts. Spread the torso's distinct priorities across 0..3 so each step
        // gets a real depth margin while staying under the amulet's layer (4).
        const torsoFaceRanges: number[][] = [];
        {
            let off = 0;
            for (let i = 0; i < modelDatas.length; i++) {
                const end = off + modelDatas[i].faceCount;
                if (modelRenderLayers[i] === null) torsoFaceRanges.push([off, end]);
                off = end;
            }
        }
        if (torsoFaceRanges.length > 0) {
            const distinct = new Set<number>();
            for (const [start, end] of torsoFaceRanges) {
                for (let f = start; f < end; f++) distinct.add(model.faceRenderLayers[f]);
            }
            const sorted = [...distinct].sort((a, b) => a - b);
            const last = sorted.length - 1;
            const remapped = new Map<number, number>();
            sorted.forEach((p, i) => remapped.set(p, i === last ? 3 : Math.min(i, 2)));
            for (const [start, end] of torsoFaceRanges) {
                for (let f = start; f < end; f++) {
                    model.faceRenderLayers[f] = remapped.get(model.faceRenderLayers[f]) ?? 0;
                }
            }
        }
        let faceOffset = 0;
        for (let i = 0; i < modelDatas.length; i++) {
            const faceEnd = faceOffset + modelDatas[i].faceCount;
            const layer = modelRenderLayers[i];
            if (layer !== null) model.faceRenderLayers.fill(layer, faceOffset, faceEnd);
            faceOffset = faceEnd;
        }
        // do not baseline-align the merged player model (PlayerComposition.getModel
        // returns the lit model without translating it to force bottomY=0). Widget modelOffsetY
        // and modelZoom handle framing for UI renders.
        return model;
    }

    /**
     * Convenience: build a static model from an appearance and equipped items by slot (12 slots).
     * Applies head coverage (hair/beard hiding) from the head-slot item before composing.
     */
    buildStaticModelFromEquipment(
        appearance: PlayerAppearance,
        equippedItemIdsBySlot?: Array<number | null | undefined>,
    ): Model | undefined {
        // Clone the appearance so equipment-specific overrides do not mutate the caller state
        const workingAppearance = new PlayerAppearance(
            appearance.gender,
            Array.isArray(appearance.colors) ? [...appearance.colors] : [],
            Array.isArray(appearance.kits) ? [...appearance.kits] : [],
            Array.isArray(appearance.equip) ? [...appearance.equip] : new Array(14).fill(-1),
            appearance.headIcons ? { ...appearance.headIcons } : { prayer: -1 },
        );

        const kits = workingAppearance.kits;
        if (kits.length < 7) kits.length = 7;

        const equippedSlots = new Set<EquipmentSlot>();
        const hiddenParts = new Set<number>();
        const equipSource =
            equippedItemIdsBySlot && equippedItemIdsBySlot.length > 0
                ? equippedItemIdsBySlot
                : Array.isArray(workingAppearance.equip)
                  ? workingAppearance.equip
                  : [];
        for (let slot = 0; slot < equipSource.length; slot++) {
            const itemId = equipSource[slot];
            if (typeof itemId !== "number" || itemId < 0) continue;
            let obj: ObjType | undefined;
            try {
                obj = this.objTypeLoader.load(itemId);
            } catch {}
            const metaSlot = deriveEquipSlotFromParams(obj) ?? (slot as EquipmentSlot);
            if (metaSlot !== undefined) equippedSlots.add(metaSlot);
            for (const compositionSlot of [obj?.wearPos2, obj?.wearPos3]) {
                const part = compositionSlotToKitPart[compositionSlot ?? -1];
                if (part !== undefined) {
                    hiddenParts.add(part);
                    kits[part] = -1;
                }
            }
        }

        const fallbackKits = this.getDefaultKitsForGender(workingAppearance.gender);
        for (let part = 0; part < 7; part++) {
            if ((kits[part] ?? -1) !== -1) continue;
            if (hiddenParts.has(part)) continue;
            if (this.partCoveredByEquipment(part, equippedSlots, hiddenParts)) continue;
            if (fallbackKits[part] !== -1) kits[part] = fallbackKits[part];
        }
        const extras: Array<{ obj: ObjType; slot: EquipmentSlot }> = [];
        if (equippedItemIdsBySlot && equippedItemIdsBySlot.length > 0) {
            // Walk the equipped items and apply coverage/suppression based on metadata when available
            for (let slot = 0; slot < equippedItemIdsBySlot.length; slot++) {
                const id = equippedItemIdsBySlot[slot];
                if (id == null || id < 0) continue;
                let obj: ObjType | undefined;
                try {
                    obj = this.objTypeLoader.load(id);
                } catch {}
                if (!obj) continue;

                // Determine actual equipment slot from item params if present (full fidelity)
                const metaSlot = deriveEquipSlotFromParams(obj) ?? (slot as EquipmentSlot);

                // OSRS PlayerComposition.getModel only renders the 12 composition slots; the
                // ammo, ring and secondary-head slots never contribute a worn model. Skip them
                // so a stackable ammo item (now carried in equip[]) can't leak into the model.
                if (
                    metaSlot === EquipmentSlot.AMMO ||
                    metaSlot === EquipmentSlot.RING ||
                    metaSlot === EquipmentSlot.HEAD2
                ) {
                    continue;
                }

                // A body item replaces the torso. OSRS only replaces the separate arms
                // composition slot when wearPos2/wearPos3 is slot 6 (for example platebodies).
                if (metaSlot === EquipmentSlot.BODY) {
                    if (kits.length < 7) kits.length = 7;
                    kits[2] = -1; // torso
                }
                // Head + jaw suppression
                // Legs suppression
                if (metaSlot === EquipmentSlot.LEGS) {
                    if (kits.length < 7) kits.length = 7;
                    kits[5] = -1; // legs
                }
                // Hands suppression
                if (metaSlot === EquipmentSlot.GLOVES) {
                    if (kits.length < 7) kits.length = 7;
                    kits[4] = -1; // hands
                }
                // Feet suppression
                if (metaSlot === EquipmentSlot.BOOTS) {
                    if (kits.length < 7) kits.length = 7;
                    kits[6] = -1; // feet
                }

                extras.push({ obj, slot: metaSlot });
            }
        }

        extras.sort((a, b) => equipmentModelRenderOrder(a.slot) - equipmentModelRenderOrder(b.slot));
        return this.buildStaticModel(
            workingAppearance,
            extras.map(({ obj }) => obj),
            extras.map(({ slot }) => equipmentRenderLayer(slot)),
        );
    }

    /**
     * Builds the local player's first-person model. Keep the arm and hand kits,
     * plus their gloves, weapon, and shield; all other body and equipment parts
     * would either obstruct the camera or show the player's head/body.
     */
    buildFirstPersonModel(appearance: PlayerAppearance): Model | undefined {
        const kits = new Array<number>(7).fill(-1);
        kits[3] = appearance.kits[3] ?? -1; // arms
        kits[4] =
            (appearance.equip[EquipmentSlot.GLOVES] ?? -1) >= 0
                ? -1
                : (appearance.kits[4] ?? -1); // hands
        const armAppearance = new PlayerAppearance(
            appearance.gender,
            Array.isArray(appearance.colors) ? [...appearance.colors] : [],
            kits,
            Array.isArray(appearance.equip) ? [...appearance.equip] : new Array(14).fill(-1),
            appearance.headIcons ? { ...appearance.headIcons } : { prayer: -1 },
            appearance.npcTransformationId,
            true,
        );
        const extras: Array<{ obj: ObjType; slot: EquipmentSlot }> = [];
        for (const slot of [EquipmentSlot.WEAPON, EquipmentSlot.SHIELD, EquipmentSlot.GLOVES]) {
            const itemId = armAppearance.equip[slot] ?? -1;
            if (itemId < 0) continue;
            try {
                const obj = this.objTypeLoader.load(itemId);
                if (obj) extras.push({ obj, slot });
            } catch {}
        }
        extras.sort((a, b) => equipmentModelRenderOrder(a.slot) - equipmentModelRenderOrder(b.slot));
        return this.buildStaticModel(
            armAppearance,
            extras.map(({ obj }) => obj),
            extras.map(({ slot }) => equipmentRenderLayer(slot)),
        );
    }

    private partCoveredByEquipment(
        part: number,
        equippedSlots: Set<EquipmentSlot>,
        hiddenParts?: Set<number>,
    ): boolean {
        if (hiddenParts?.has(part)) return true;
        switch (part) {
            case 0:
                return hiddenParts?.has(0) ?? false;
            case 1:
                return hiddenParts?.has(1) ?? false;
            case 2:
                return equippedSlots.has(EquipmentSlot.BODY);
            case 3:
                return false;
            case 4:
                return equippedSlots.has(EquipmentSlot.GLOVES);
            case 5:
                return equippedSlots.has(EquipmentSlot.LEGS);
            case 6:
                return equippedSlots.has(EquipmentSlot.BOOTS);
            default:
                return false;
        }
    }

    private getDefaultKitsForGender(gender: Gender): number[] {
        const key = Number(gender ?? 0) | 0;
        const cached = this.defaultKitsCache.get(key);
        if (cached) return cached;

        const defaults = new Array<number>(7).fill(-1);
        const count = this.idkTypeLoader.getCount?.() ?? 0;
        const expectedBodyPartId = (partIndex: number) =>
            ((partIndex | 0) + (gender === Gender.FEMALE ? 7 : 0)) | 0;
        for (let id = 0; id < count; id++) {
            try {
                const kit = this.idkTypeLoader.load(id) as any;
                if (!kit || kit.nonSelectable) continue;
                const rawPart = kit.bodyPartId ?? kit.bodyPartyId;
                const part = typeof rawPart === "number" ? rawPart | 0 : -1;
                if (part >= 0 && part < 14) {
                    const base = gender === Gender.FEMALE ? (part - 7) | 0 : part | 0;
                    if (base >= 0 && base < defaults.length) {
                        if (part === expectedBodyPartId(base) && defaults[base] === -1) {
                            defaults[base] = id;
                        }
                    }
                }
            } catch {}
        }

        if (defaults[0] === -1 || defaults[1] === -1) {
            try {
                const fallback =
                    gender === Gender.FEMALE
                        ? PlayerAppearance.defaultFemale(this.idkTypeLoader)
                        : PlayerAppearance.defaultMale(this.idkTypeLoader);
                if (defaults[0] === -1 && fallback.kits[0] !== undefined) {
                    defaults[0] = fallback.kits[0] ?? -1;
                }
                if (defaults[1] === -1 && fallback.kits[1] !== undefined) {
                    defaults[1] = fallback.kits[1] ?? -1;
                }
            } catch {}
        }
        if (defaults[0] <= 0) {
            for (let id = 1; id < count; id++) {
                try {
                    const kit = this.idkTypeLoader.load(id) as any;
                    const rawPart = kit.bodyPartId ?? kit.bodyPartyId;
                    if ((rawPart | 0) === expectedBodyPartId(0)) {
                        defaults[0] = id;
                        break;
                    }
                } catch {}
            }
        }
        if (defaults[1] === -1) {
            for (let id = 0; id < count; id++) {
                try {
                    const kit = this.idkTypeLoader.load(id) as any;
                    const rawPart = kit.bodyPartId ?? kit.bodyPartyId;
                    if ((rawPart | 0) === expectedBodyPartId(1)) {
                        defaults[1] = id;
                        break;
                    }
                } catch {}
            }
        }

        this.defaultKitsCache.set(key, defaults);
        return defaults;
    }
}
