import { clamp } from "../../common/utils/MathUtil";
import { formatActorNameWithLevel } from "../../ui/menu/MenuBridge";
import type { SdMapData } from "../loader/SdMapData";

const MAX_TEXTURES = 1024;
const TEXTURE_SIZE = 128;
const MATERIAL_TEXTURE_ROWS = 6;
const WATER_FLAG_HAS_FOAM = 1;
const WATER_FLAG_NORMAL_MAP_2 = 2;
const WATER_TEXTURE_SIZE = 128;
const PUBLIC_PATH = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
const WATER_TEXTURE_ASSETS = [
    `${PUBLIC_PATH}/images/water/water_normal_map_1.png`,
    `${PUBLIC_PATH}/images/water/water_normal_map_2.png`,
    `${PUBLIC_PATH}/images/water/water_flow_map.png`,
    `${PUBLIC_PATH}/images/water/water_foam.jpg`,
    `${PUBLIC_PATH}/images/water/caustics_map.jpg`,
] as const;

export interface WaterMaterialParams {
    surfaceColor: [number, number, number];
    foamColor: [number, number, number];
    depthColor: [number, number, number];
    baseOpacity: number;
    fresnelAmount: number;
    normalStrength: number;
    specularStrength: number;
    specularGloss: number;
    duration: number;
    hasFoam: boolean;
    useNormalMap2: boolean;
}

export function waterRgb(hex: number): [number, number, number] {
    return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

export function materialByte(value: number): number {
    return Math.round(clamp(value, 0, 255));
}

/** 117HD DefaultSkyColor.DEFAULT — "117 HD Blue" (#B9D6FF). */
export const HD_SKY_COLOR_SRGB: readonly [number, number, number] = [185, 214, 255];

export const HD_SKY_COLOR_VEC4: readonly [number, number, number, number] = [
    HD_SKY_COLOR_SRGB[0] / 255,
    HD_SKY_COLOR_SRGB[1] / 255,
    HD_SKY_COLOR_SRGB[2] / 255,
    1,
];

/**
 * Dynamic fog start as a fraction of render distance (117HD-style adaptive fog).
 * Fog ramps from this start to full opacity at the draw-distance edge.
 */
export const HD_AUTO_FOG_DEPTH_FACTOR = 0.85;

// 117HD water_types.json parameters.
const DEFAULT_WATER_MATERIAL: WaterMaterialParams = {
    surfaceColor: waterRgb(0x69809c),
    foamColor: waterRgb(0xb0a492),
    depthColor: waterRgb(0x00758e),
    baseOpacity: 0.5,
    fresnelAmount: 0.85,
    normalStrength: 0.09,
    specularStrength: 0.5,
    specularGloss: 500,
    duration: 1,
    hasFoam: true,
    useNormalMap2: false,
};
const SWAMP_WATER_MATERIAL: WaterMaterialParams = {
    surfaceColor: waterRgb(0x172114),
    foamColor: waterRgb(0x737865),
    depthColor: waterRgb(0x29521a),
    baseOpacity: 0.8,
    fresnelAmount: 0.3,
    normalStrength: 0.05,
    specularStrength: 0.1,
    specularGloss: 100,
    duration: 1.2,
    hasFoam: true,
    useNormalMap2: false,
};
const ICE_WATER_MATERIAL: WaterMaterialParams = {
    surfaceColor: waterRgb(0xffffff),
    foamColor: waterRgb(0x969696),
    depthColor: waterRgb(0x00758e),
    baseOpacity: 0.85,
    fresnelAmount: 1,
    normalStrength: 0.04,
    specularStrength: 0.3,
    specularGloss: 200,
    duration: 0,
    hasFoam: true,
    useNormalMap2: true,
};
const VANILLA_WATER_SURFACE_COLORS = new Map<number, [number, number, number]>([
    [130, waterRgb(0x556f8f)],
    [131, waterRgb(0x536b88)],
    [132, waterRgb(0x4d5d81)],
    [133, waterRgb(0x3c4b71)],
    [134, waterRgb(0x374467)],
    [135, waterRgb(0x688b9c)],
    [136, waterRgb(0x638189)],
    [137, waterRgb(0x537783)],
    [138, waterRgb(0x55707f)],
    [139, waterRgb(0x445c72)],
    [140, waterRgb(0x4d6b7f)],
    [141, waterRgb(0x4a6578)],
    [142, waterRgb(0x446175)],
    [143, waterRgb(0x425b71)],
    [144, waterRgb(0x3f586c)],
    [145, waterRgb(0x6c78a2)],
    [146, waterRgb(0x606b99)],
    [147, waterRgb(0x585e8f)],
    [148, waterRgb(0x473d72)],
    [149, waterRgb(0x3f3863)],
    [150, waterRgb(0x68799d)],
    [151, waterRgb(0x606e90)],
    [152, waterRgb(0x536489)],
    [153, waterRgb(0x4f5781)],
    [154, waterRgb(0x3f4672)],
    [155, waterRgb(0x6e7595)],
    [156, waterRgb(0x656b88)],
    [157, waterRgb(0x596181)],
    [158, waterRgb(0x585874)],
    [159, waterRgb(0x484664)],
    [160, waterRgb(0x7a8da3)],
    [161, waterRgb(0x728397)],
    [162, waterRgb(0x667a91)],
    [163, waterRgb(0x616e8b)],
    [164, waterRgb(0x505c7a)],
    [165, waterRgb(0x8898ad)],
    [166, waterRgb(0x8290a3)],
    [167, waterRgb(0x79899e)],
    [168, waterRgb(0x747f99)],
    [169, waterRgb(0x68728d)],
    [170, waterRgb(0x7298b4)],
    [171, waterRgb(0x5f86a3)],
    [172, waterRgb(0x547a99)],
    [173, waterRgb(0x496e91)],
    [174, waterRgb(0x43688b)],
    [175, waterRgb(0x5d7f72)],
    [176, waterRgb(0x517c6c)],
    [177, waterRgb(0x4a686d)],
    [178, waterRgb(0x4a686d)],
    [179, waterRgb(0x3d595c)],
    [180, waterRgb(0x5a7b90)],
    [181, waterRgb(0x537084)],
    [182, waterRgb(0x49677b)],
    [183, waterRgb(0x506574)],
    [184, waterRgb(0x324e6c)],
    [185, waterRgb(0x4d5e74)],
    [186, waterRgb(0x445267)],
    [187, waterRgb(0x39485e)],
    [188, waterRgb(0x394d63)],
    [189, waterRgb(0x314157)],
    [208, waterRgb(0x262d45)],
]);

const MAX_HIT_ENTRIES = 256;
const DEFAULT_NPC_HEALTH = 100;
const MAX_ESTIMATED_HEALTH = 4000;
const OVERHEAD_CHAT_COLOR_TABLE = [0xffff00, 0xff0000, 0x00ff00, 0x00ffff, 0xff00ff, 0xffffff];
const DEFAULT_OVERHEAD_CHAT_COLOR_ID = 0;
const DEFAULT_OVERHEAD_CHAT_COLOR = OVERHEAD_CHAT_COLOR_TABLE[DEFAULT_OVERHEAD_CHAT_COLOR_ID];

// Limit how many 20ms client ticks we process per frame when catching up.
const MAX_CLIENT_TICKS_PER_FRAME = 25;
// Cap outstanding tick debt so we do not spiral on extremely long pauses.
const MAX_CLIENT_TICK_DEBT = 600;

export interface ColorRgb {
    r: number;
    g: number;
    b: number;
}

export interface LocHighlightTarget {
    kind: "loc";
    locId: number;
    tileX: number;
    tileY: number;
    plane: number;
    locModelType?: number;
    locRotation?: number;
    /** Set when the outline model was sourced from an overworld visual proxy
     *  rather than the loc's own model.  Suppresses world-entity transforms
     *  and deck-height offsets for the highlight. */
    overworldProxy?: boolean;
}

export interface NpcHighlightTarget {
    kind: "npc";
    ecsId: number;
    serverId: number;
    npcTypeId: number;
    plane: number;
}

export type InteractHighlightTarget = LocHighlightTarget | NpcHighlightTarget;

export type LocReloadBatchState = {
    id: number;
    mapIds: number[];
    pendingMapIds: Set<number>;
    loaded: Map<number, SdMapData>;
};

export type StreamMapBatch = Map<number, SdMapData>;

// Hitsplat and health bar types moved to ../actor/ActorOverlayState.ts

export enum TextureFilterMode {
    DISABLED,
    BILINEAR,
    TRILINEAR,
    ANISOTROPIC_2X,
    ANISOTROPIC_4X,
    ANISOTROPIC_8X,
    ANISOTROPIC_16X,
}

export function getMaxAnisotropy(mode: TextureFilterMode): number {
    switch (mode) {
        case TextureFilterMode.ANISOTROPIC_2X:
            return 2;
        case TextureFilterMode.ANISOTROPIC_4X:
            return 4;
        case TextureFilterMode.ANISOTROPIC_8X:
            return 8;
        case TextureFilterMode.ANISOTROPIC_16X:
            return 16;
        default:
            return 1;
    }
}

export type BrowserQualityProfileKey = "desktop" | "mobile-touch" | "ios-safari";

export interface BrowserQualityProfile {
    key: BrowserQualityProfileKey;
    label: string;
    defaultSceneScale: number;
    fxaaEnabled: boolean;
    renderDistanceCap: number;
    lodThresholdCap: number;
    groundItemOverlayMaxEntries: number;
    groundItemOverlayRadius: number;
    hitsplatMaxEntries: number;
    healthBarMaxEntries: number;
    overheadTextMaxEntries: number;
    overheadPrayerMaxEntries: number;
}

export const DESKTOP_QUALITY_PROFILE: BrowserQualityProfile = {
    key: "desktop",
    label: "Desktop",
    defaultSceneScale: 1,
    fxaaEnabled: false,
    renderDistanceCap: 90,
    lodThresholdCap: 90,
    groundItemOverlayMaxEntries: 40,
    groundItemOverlayRadius: 12,
    hitsplatMaxEntries: MAX_HIT_ENTRIES,
    healthBarMaxEntries: 256,
    overheadTextMaxEntries: 256,
    overheadPrayerMaxEntries: 256,
};

export const MOBILE_TOUCH_QUALITY_PROFILE: BrowserQualityProfile = {
    key: "mobile-touch",
    label: "Mobile Browser",
    defaultSceneScale: 1,
    fxaaEnabled: false,
    renderDistanceCap: 20,
    lodThresholdCap: 14,
    groundItemOverlayMaxEntries: 24,
    groundItemOverlayRadius: 10,
    hitsplatMaxEntries: 128,
    healthBarMaxEntries: 96,
    overheadTextMaxEntries: 48,
    overheadPrayerMaxEntries: 32,
};

export const IOS_SAFARI_QUALITY_PROFILE: BrowserQualityProfile = {
    key: "ios-safari",
    label: "iPhone Safari",
    // The canvas backing store runs at 2x DPR for crisp UI/text; 0.5 keeps the
    // 3D scene framebuffer at CSS resolution, the same GPU cost as a 1x buffer.
    defaultSceneScale: 0.5,
    fxaaEnabled: false,
    renderDistanceCap: 18,
    lodThresholdCap: 12,
    groundItemOverlayMaxEntries: 20,
    groundItemOverlayRadius: 8,
    hitsplatMaxEntries: 96,
    healthBarMaxEntries: 72,
    overheadTextMaxEntries: 32,
    overheadPrayerMaxEntries: 24,
};

function optimizeAssumingFlatsHaveSameFirstAndLastData(gl: WebGL2RenderingContext) {
    const epv = gl.getExtension("WEBGL_provoking_vertex");
    if (epv) {
        epv.provokingVertexWEBGL(epv.FIRST_VERTEX_CONVENTION_WEBGL);
    }
}

export function formatPlayerCombatLabel(
    name: string,
    localCombatLevel: number,
    targetCombatLevel: number,
): string {
    // Used for Walk-here / non-PLAYER target strings that skip osrsTargetLabel level formatting.
    return formatActorNameWithLevel(name, targetCombatLevel | 0, localCombatLevel | 0, true);
}

export {
    MAX_TEXTURES,
    TEXTURE_SIZE,
    MATERIAL_TEXTURE_ROWS,
    WATER_FLAG_HAS_FOAM,
    WATER_FLAG_NORMAL_MAP_2,
    WATER_TEXTURE_SIZE,
    WATER_TEXTURE_ASSETS,
    MAX_HIT_ENTRIES,
    DEFAULT_NPC_HEALTH,
    MAX_ESTIMATED_HEALTH,
    OVERHEAD_CHAT_COLOR_TABLE,
    DEFAULT_OVERHEAD_CHAT_COLOR_ID,
    DEFAULT_OVERHEAD_CHAT_COLOR,
    MAX_CLIENT_TICKS_PER_FRAME,
    MAX_CLIENT_TICK_DEBT,
    DEFAULT_WATER_MATERIAL,
    SWAMP_WATER_MATERIAL,
    ICE_WATER_MATERIAL,
    VANILLA_WATER_SURFACE_COLORS,
    optimizeAssumingFlatsHaveSameFirstAndLastData,
};

export const RENDER_CONSTANTS = {
    MAX_TEXTURES,
    TEXTURE_SIZE,
    MATERIAL_TEXTURE_ROWS,
    MAX_HIT_ENTRIES,
    DEFAULT_NPC_HEALTH,
    MAX_ESTIMATED_HEALTH,
    DEFAULT_OVERHEAD_CHAT_COLOR_ID,
    DEFAULT_OVERHEAD_CHAT_COLOR,
    MAX_CLIENT_TICKS_PER_FRAME,
    MAX_CLIENT_TICK_DEBT,
    DESKTOP_QUALITY_PROFILE,
    MOBILE_TOUCH_QUALITY_PROFILE,
    IOS_SAFARI_QUALITY_PROFILE,
    PLAYER_INTERACT_BASE: 0x8000,
    ACTOR_GROUND_CLEARANCE_MODEL_UNITS: -10,
    LOC_RELOAD_FLUSH_DELAY_MS: 25,
    MOBILE_GAMEPLAY_UI_SCALE: 1.25,
    MOBILE_GAMEPLAY_UI_PHONE_EDGE: 390,
    PLAYER_FOOTPRINT_RADIUS: (0.4 * 128) | 0,
    /** Base hitsplat sprite/text scale before UI/render scale multiply. */
    HITSPLAT_PLAYER_SCALE: 0.975,
    HITSPLAT_NPC_SCALE: 1.2025,
    /** Extra multiplier for health bars (on top of UI/render scale). */
    HEALTH_BAR_VISUAL_SCALE: 1.2,
    AMBIENT_SOUND_THROTTLE_FRAMES: 3,
    WALK_PHASE_BIAS: 0.0,
    RUN_PHASE_BIAS: 0.0,
} as const;
