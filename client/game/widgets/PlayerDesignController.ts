import type { BasTypeLoader } from "../../rs/config/bastype/BasTypeLoader";
import type { IdkTypeLoader } from "../../rs/config/idktype/IdkTypeLoader";
import type { ObjTypeLoader } from "../../rs/config/objtype/ObjTypeLoader";
import { PlayerAppearance } from "../../rs/config/player/PlayerAppearance";
import { PLAYER_BODY_RECOLOR_TO_1 } from "../../rs/config/player/PlayerDesignColors";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import type { VarManager } from "../../rs/config/vartype/VarManager";
import type { ModelLoader } from "../../rs/model/ModelLoader";
import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import type { SkeletalSeqLoader } from "../../rs/model/skeletal/SkeletalSeqLoader";
import type { TextureLoader } from "../../rs/texture/TextureLoader";
import type { WidgetManager } from "../../widgets/WidgetManager";
import { sendPlayerDesignConfirm } from "../../network/ServerConnection";
import type { PlayerEcs } from "../ecs/PlayerEcs";

export type PlayerDesignControllerDeps = {
    getIdkTypeLoader: () => IdkTypeLoader | undefined;
    getObjTypeLoader: () => ObjTypeLoader | undefined;
    getModelLoader: () => ModelLoader | undefined;
    getTextureLoader: () => TextureLoader | undefined;
    getSeqTypeLoader: () => SeqTypeLoader | undefined;
    getSeqFrameLoader: () => SeqFrameLoader | undefined;
    getBasTypeLoader: () => BasTypeLoader | undefined;
    getSkeletalSeqLoader: () => SkeletalSeqLoader | undefined;
    varManager: VarManager;
    widgetManager: WidgetManager;
    playerEcs: PlayerEcs;
    getControlledPlayerServerId: () => number;
};

/**
 * Client-side PlayerDesign (interface group 679) appearance editor.
 * Mutates local player appearance and keeps CS2/widget preview in sync.
 */
export class PlayerDesignController {
    // PlayerDesign (679) is client-side; keep a local editable appearance even before a world player exists.
    private playerDesignAppearance?: PlayerAppearance;

    constructor(private readonly deps: PlayerDesignControllerDeps) {}

    clear(): void {
        this.playerDesignAppearance = undefined;
    }

    /** Keep local, unconfirmed edits while accepting the server's independent pronouns. */
    preserveDraftAppearance(appearance: PlayerAppearance): void {
        const draft = this.playerDesignAppearance;
        if (!draft) return;
        draft.pronouns = appearance.pronouns;
        appearance.gender = draft.gender;
        appearance.colors = Array.from(draft.colors);
        appearance.kits = Array.from(draft.kits);
    }

    handleWidgetAction(childId: number): boolean {
        // PlayerDesign (Interface group 679) is a client-side appearance editor.
        // Cache widgets in this group are mostly empty containers; clicks should mutate the local
        // player appearance immediately and let CS2 redraw visuals (e.g. body type A/B via varbit).
        const id = childId | 0;

        // Component IDs from cache (group 679)
        const COMP_HEAD_LEFT = 15;
        const COMP_HEAD_RIGHT = 16;
        const COMP_JAW_LEFT = 19;
        const COMP_JAW_RIGHT = 20;
        const COMP_TORSO_LEFT = 23;
        const COMP_TORSO_RIGHT = 24;
        const COMP_ARMS_LEFT = 27;
        const COMP_ARMS_RIGHT = 28;
        const COMP_HANDS_LEFT = 31;
        const COMP_HANDS_RIGHT = 32;
        const COMP_LEGS_LEFT = 35;
        const COMP_LEGS_RIGHT = 36;
        const COMP_FEET_LEFT = 39;
        const COMP_FEET_RIGHT = 40;
        const COMP_HAIR_LEFT = 46;
        const COMP_HAIR_RIGHT = 47;
        const COMP_TORSO_COL_LEFT = 50;
        const COMP_TORSO_COL_RIGHT = 51;
        const COMP_LEGS_COL_LEFT = 54;
        const COMP_LEGS_COL_RIGHT = 55;
        const COMP_FEET_COL_LEFT = 58;
        const COMP_FEET_COL_RIGHT = 59;
        const COMP_SKIN_LEFT = 62;
        const COMP_SKIN_RIGHT = 63;
        const COMP_BODYTYPE_A = 68;
        const COMP_BODYTYPE_B = 69;
        const COMP_CONFIRM = 74;

        const VARBIT_PLAYER_DESIGN_BODYTYPE = 14021;

        const idkTypeLoader = this.deps.getIdkTypeLoader();
        if (!idkTypeLoader) return true;
        const pa = this.getOrInitPlayerDesignAppearance();
        if (!pa) return true;

        const gender = ((pa.gender ?? 0) | 0) === 1 ? 1 : 0;
        const kits = Array.isArray(pa.kits) ? pa.kits : (pa.kits = new Array(7).fill(-1));
        const colors = Array.isArray(pa.colors) ? pa.colors : (pa.colors = [0, 0, 0, 0, 0]);
        if (kits.length < 7) kits.length = 7;
        if (colors.length < 5) colors.length = 5;
        for (let i = 0; i < 7; i++) kits[i] = (kits[i] ?? -1) | 0;
        for (let i = 0; i < 5; i++) colors[i] = (colors[i] ?? 0) | 0;

        const expectedIdkBodyPartId = (g: number, partIndex: number): number =>
            ((partIndex | 0) + (((g | 0) === 1 ? 7 : 0) | 0)) | 0;

        const cycleKit = (partIndex: number, dir: -1 | 1): boolean => {
            const loader: any = idkTypeLoader as any;
            const count = (loader?.getCount?.() ?? 0) | 0;
            if (count <= 0 || typeof loader?.load !== "function") return false;

            const want = expectedIdkBodyPartId(pa.gender | 0, partIndex | 0) | 0;
            const currentKitId = (kits[partIndex] ?? -1) | 0;
            let idkId = currentKitId;
            if (idkId < 0 || idkId >= count) {
                idkId = dir === 1 ? count - 1 : 0;
            }

            for (let i = 0; i < count; i++) {
                idkId = (idkId + (dir === 1 ? 1 : -1) + count) % count;
                try {
                    const kit: any = loader.load(idkId);
                    if (!kit || kit.nonSelectable) continue;
                    const rawPart = kit.bodyPartId ?? kit.bodyPartyId;
                    const bodyPartId = typeof rawPart === "number" ? rawPart | 0 : -1;
                    if (bodyPartId !== want) continue;
                    kits[partIndex] = idkId | 0;
                    return true;
                } catch {
                    continue;
                }
            }
            return false;
        };

        const cycleColor = (colorIndex: number, dir: -1 | 1): boolean => {
            const idx = Math.max(0, Math.min(4, colorIndex | 0)) | 0;
            const palette = PLAYER_BODY_RECOLOR_TO_1[idx] ?? [];
            const len = (palette.length | 0) >>> 0;
            if (len <= 0) return false;
            let v = (colors[idx] ?? 0) | 0;
            for (let i = 0; i < len; i++) {
                v = (v + (dir === 1 ? 1 : -1) + len) % len;
                // restrict skin palette (index 4) to < 8
                if (idx !== 4 || v < 8) break;
            }
            colors[idx] = v | 0;
            return true;
        };

        const setGender = (g: 0 | 1): boolean => {
            const newGender = g | 0;
            const was = ((pa.gender ?? 0) | 0) === 1 ? 1 : 0;
            if (((pa.gender ?? 0) | 0) !== newGender) {
                pa.gender = newGender as any;
                const defaults =
                    newGender === 1
                        ? PlayerAppearance.defaultFemale(idkTypeLoader)
                        : PlayerAppearance.defaultMale(idkTypeLoader);
                const defKits = Array.isArray(defaults.kits)
                    ? defaults.kits
                    : new Array(7).fill(-1);
                pa.kits = defKits.slice(0, 7).map((n) => Number(n) | 0);
            }
            // Mirror gender into player_design_bodytype for CS2 UI (script3755) and other scripts.
            this.deps.varManager?.setVarbit?.(VARBIT_PLAYER_DESIGN_BODYTYPE, newGender);
            return was !== newGender;
        };

        const confirm = (): boolean => {
            try {
                // Server receives only the final selection; it will validate + persist + close the interface.
                const payload = {
                    gender: ((pa.gender ?? 0) | 0) === 1 ? 1 : 0,
                    colors: Array.from(pa.colors ?? [])
                        .slice(0, 5)
                        .map((n) => Number(n) | 0),
                    kits: Array.from(pa.kits ?? [])
                        .slice(0, 7)
                        .map((n) => Number(n) | 0),
                };
                sendPlayerDesignConfirm(payload);
            } catch {}
            // Ensure UI remains consistent even if server response is delayed.
            this.syncPlayerDesignAppearanceToUi(pa);
            return true;
        };

        let changed = false;
        switch (id) {
            case COMP_HEAD_LEFT:
                changed = cycleKit(0, -1);
                break;
            case COMP_HEAD_RIGHT:
                changed = cycleKit(0, 1);
                break;
            case COMP_JAW_LEFT:
                changed = cycleKit(1, -1);
                break;
            case COMP_JAW_RIGHT:
                changed = cycleKit(1, 1);
                break;
            case COMP_TORSO_LEFT:
                changed = cycleKit(2, -1);
                break;
            case COMP_TORSO_RIGHT:
                changed = cycleKit(2, 1);
                break;
            case COMP_ARMS_LEFT:
                changed = cycleKit(3, -1);
                break;
            case COMP_ARMS_RIGHT:
                changed = cycleKit(3, 1);
                break;
            case COMP_HANDS_LEFT:
                changed = cycleKit(4, -1);
                break;
            case COMP_HANDS_RIGHT:
                changed = cycleKit(4, 1);
                break;
            case COMP_LEGS_LEFT:
                changed = cycleKit(5, -1);
                break;
            case COMP_LEGS_RIGHT:
                changed = cycleKit(5, 1);
                break;
            case COMP_FEET_LEFT:
                changed = cycleKit(6, -1);
                break;
            case COMP_FEET_RIGHT:
                changed = cycleKit(6, 1);
                break;
            case COMP_HAIR_LEFT:
                changed = cycleColor(0, -1);
                break;
            case COMP_HAIR_RIGHT:
                changed = cycleColor(0, 1);
                break;
            case COMP_TORSO_COL_LEFT:
                changed = cycleColor(1, -1);
                break;
            case COMP_TORSO_COL_RIGHT:
                changed = cycleColor(1, 1);
                break;
            case COMP_LEGS_COL_LEFT:
                changed = cycleColor(2, -1);
                break;
            case COMP_LEGS_COL_RIGHT:
                changed = cycleColor(2, 1);
                break;
            case COMP_FEET_COL_LEFT:
                changed = cycleColor(3, -1);
                break;
            case COMP_FEET_COL_RIGHT:
                changed = cycleColor(3, 1);
                break;
            case COMP_SKIN_LEFT:
                changed = cycleColor(4, -1);
                break;
            case COMP_SKIN_RIGHT:
                changed = cycleColor(4, 1);
                break;
            case COMP_BODYTYPE_A:
                changed = setGender(0);
                break;
            case COMP_BODYTYPE_B:
                changed = setGender(1);
                break;
            case COMP_CONFIRM:
                return confirm();
            default:
                return false;
        }

        // Appearance controls edit locally; other ops (such as pronouns) reach the server.
        if (!changed) {
            this.syncPlayerDesignAppearanceToUi(pa);
            return true;
        }

        // Commit appearance change for local preview and keep CS2 vars/sprites in sync.
        this.playerDesignAppearance = pa;
        const localIdx = this.deps.playerEcs.getIndexForServerId(
            this.deps.getControlledPlayerServerId(),
        );
        if (localIdx !== undefined) {
            pa.pronouns = this.deps.playerEcs.getAppearance(localIdx)?.pronouns ?? pa.pronouns;
            this.deps.playerEcs.setAppearance(localIdx, pa);
            try {
                this.deps.playerEcs.ensureBaseForIndex(localIdx, {
                    idkTypeLoader,
                    objTypeLoader: this.deps.getObjTypeLoader(),
                    modelLoader: this.deps.getModelLoader(),
                    textureLoader: this.deps.getTextureLoader(),
                    npcTypeLoader: undefined,
                    seqTypeLoader: this.deps.getSeqTypeLoader(),
                    seqFrameLoader: this.deps.getSeqFrameLoader(),
                    skeletalSeqLoader: this.deps.getSkeletalSeqLoader(),
                    varManager: this.deps.varManager,
                    basTypeLoader: this.deps.getBasTypeLoader(),
                });
            } catch {}
        }

        // Keep the bodytype varbit in sync with current gender for CS2 state (A/B buttons).
        if ((pa.gender | 0) !== gender) {
            this.deps.varManager?.setVarbit?.(
                VARBIT_PLAYER_DESIGN_BODYTYPE,
                (pa.gender | 0) === 1 ? 1 : 0,
            );
        }
        this.syncPlayerDesignAppearanceToUi(pa);

        return true;
    }

    private getOrInitPlayerDesignAppearance(): PlayerAppearance | undefined {
        if (this.playerDesignAppearance) return this.playerDesignAppearance;
        const idkTypeLoader = this.deps.getIdkTypeLoader();
        if (!idkTypeLoader) return undefined;

        try {
            const idx = this.deps.playerEcs.getIndexForServerId(
                this.deps.getControlledPlayerServerId(),
            );
            const ap = idx !== undefined ? this.deps.playerEcs.getAppearance(idx) : undefined;
            if (ap) {
                this.playerDesignAppearance = new PlayerAppearance(
                    (ap.gender as any) ?? 0,
                    Array.from(ap.colors ?? []),
                    Array.from(ap.kits ?? []),
                    Array.from(ap.equip ?? []),
                    { ...(ap.headIcons ?? { prayer: -1 }) },
                );
                return this.playerDesignAppearance;
            }
        } catch {}

        this.playerDesignAppearance = PlayerAppearance.defaultMale(idkTypeLoader);
        return this.playerDesignAppearance;
    }

    private syncPlayerDesignAppearanceToUi(pa: PlayerAppearance): void {
        // Expose gender to CS2 (A/B button state uses player_design_bodytype varbit).
        try {
            this.deps.varManager?.setVarbit?.(14021, ((pa.gender ?? 0) | 0) === 1 ? 1 : 0);
        } catch {}

        // Keep the model widget fed even if the local ECS player isn't spawned yet.
        try {
            const w = this.deps.widgetManager?.findWidget?.(679, 73);
            if (w) {
                (w as any).playerAppearance = {
                    gender: (pa.gender ?? 0) | 0,
                    colors: Array.from(pa.colors ?? [])
                        .slice(0, 5)
                        .map((n) => Number(n) | 0),
                    kits: Array.from(pa.kits ?? [])
                        .slice(0, 7)
                        .map((n) => Number(n) | 0),
                    equip: new Array(14).fill(-1),
                };
                this.deps.widgetManager.invalidateWidgetRender(w, "player-design");
            }
        } catch {}
    }
}
