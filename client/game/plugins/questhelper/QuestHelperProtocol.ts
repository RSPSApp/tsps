/** Read-only bridge DTOs. Sparse varps omit zero; varbits must be explicitly supplied. */
export type WorldTile = {
    x: number;
    y: number;
    plane: number;
};
export type HelperItem = {
    id: number;
    quantity: number;
    slot?: number;
};
export type HelperNpc = WorldTile & {
    index: number;
    id: number;
    transformedId?: number;
    name: string;
    animation?: number;
    orientation?: number;
    combatLevel?: number;
};
export type HelperWidget = {
    id: number;
    text?: string;
    hidden?: boolean;
    bounds?: PixelBounds;
    children?: HelperWidget[];
    itemId?: number;
    itemQuantity?: number;
};
export type PixelBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type HelperGeometry = PixelBounds & {
    baseX?:number;baseY?:number;projectionType?:"perspective"|"orthographic";gpu?:boolean;
    cameraX?:number;cameraY?:number;cameraZ?:number;cameraPitch?:number;cameraYaw?:number;
    cameraFpX?:number;cameraFpY?:number;cameraFpZ?:number;cameraFpPitch?:number;cameraFpYaw?:number;
    scale?:number;viewportWidth?:number;viewportHeight?:number;viewportXOffset?:number;viewportYOffset?:number;
    screenWidth?:number;screenHeight?:number;viewProjectionMatrix?:number[];
    tileHeightsPacked?:{encoding:"int16-le-base64";shape:[4,105,105];multiplier:-8;data:string};
    tileSettingsPacked?:{encoding:"uint8-base64";shape:[4,104,104];data:string};
    loadedTilesPacked?:{encoding:"bitset-lsb-base64";shape:[4,104,104];data:string};
};
export type ReadonlyClientSnapshot = Readonly<{
    varps: Readonly<Record<string, number>>;
    varbits: Readonly<Record<string, number>>;
    varbitDefinitions?: Readonly<Record<string, {
        varp: number;
        lsb: number;
        msb: number;
    }>>;
    questStates?: Readonly<Record<string, "NOT_STARTED" | "IN_PROGRESS" | "FINISHED">>;
    inventory: readonly HelperItem[];
    equipment: readonly HelperItem[];
    bank?: readonly HelperItem[];
    localPlayer: WorldTile & {
        name: string;
        combatLevel?: number;
        animation?: number;
        poseAnimation?: number;
        orientation?: number;
        interactingIndex?: number;
    };
    skills: Readonly<Record<string, {
        real: number;
        boosted: number;
        xp: number;
    }>>;
    npcs: readonly HelperNpc[];
    objects: readonly (WorldTile & {
        id: number;
        type?: number;
        orientation?: number;
    })[];
    groundItems: readonly (WorldTile & HelperItem)[];
    widgets: readonly HelperWidget[];
    baseX: number;
    baseY: number;
    plane: number;
    tick: number;
    instanceTemplateChunks?: number[][][];
    geometry?: HelperGeometry;
    itemDefinitions?: Readonly<Record<string, Record<string, unknown>>>;
    objectDefinitions?: Readonly<Record<string, Record<string, unknown>>>;
    npcDefinitions?: Readonly<Record<string, Record<string, unknown>>>;
    containers?: Readonly<Record<string, readonly HelperItem[]>>;
}>;
export type OrderedClientEvent = {
    type: string;
    tick: number;
    [field: string]: unknown;
};
export type HelperTarget = {
    kind: "npc" | "object" | "item" | "tile" | "widget";
    id?: number;
    ids?: number[];
    x?: number;
    y?: number;
    plane?: number;
    label?: string;
};
export type RequirementState = {
    name: string;
    met: boolean;
    ids?: number[];
    quantity?: number;
};
export type DialogueChoice = {
    text: string;
    index?: number;
};
export type WidgetHighlight = {
    id: number;
    bounds?: PixelBounds;
    label?: string;
};
export type OverlayCommand = {
    kind: "rect" | "line" | "text" | "polygon" | "path" | "image";
    color?: number | string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    x2?: number;
    y2?: number;
    text?: string;
    font?: string;
    fontSize?: number;
    points?: {
        x: number;
        y: number;
    }[];
    path?: {
        op: "M" | "L" | "Q" | "C" | "Z";
        values: number[];
    }[];
    fill?: string;
    stroke?: string;
    lineWidth?: number;
    dataUrl?: string;
};
export type HelperStep = {
    id: string;
    text: string[];
    targets: HelperTarget[];
    requirements: RequirementState[];
    dialogueChoices: DialogueChoice[];
    widgets: WidgetHighlight[];
    overlays: OverlayCommand[];
};
export type HelperPanel = {
    title: string;
    text?: string[];
    requirements?: RequirementState[];
};
export type HelperDiagnostic = {
    code: string;
    message: string;
    helper?: string;
    method?: string;
};
export type HelperStateRequest = {
    kind: string;
    id: number;
};
export type HelperResponse = {
    protocol: 1;
    session: string;
    sequence: number;
    questKey: string;
    sourceCommit: string;
    status: "active" | "complete" | "unsupported" | "unavailable";
    activeStep: HelperStep | null;
    panels: HelperPanel[];
    diagnostics: HelperDiagnostic[];
    requests?: HelperStateRequest[];
};
export type HelperQuest = {
    questKey: string;
    name: string;
    supported: boolean;
    helperClass?: string;
    helperVariant?: string;
    requiredVarbits?: number[];
    status?: "NOT_STARTED" | "IN_PROGRESS" | "FINISHED";
    stage?: number;
};
export type HelperCatalog = {
    protocol: 1;
    sourceCommit: string;
    quests: HelperQuest[];
    diagnostics: HelperDiagnostic[];
};
export type HelperEvaluateRequest = {
    protocol: 1;
    session: string;
    sequence: number;
    questKey: string;
    helperVariant?: string;
    snapshot: ReadonlyClientSnapshot;
    events: readonly OrderedClientEvent[];
};
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length <= 16384;
const int = (v: unknown): v is number => Number.isSafeInteger(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e7;
const list = (v: unknown, check: (v: unknown) => boolean, max = 4096): boolean => Array.isArray(v) && v.length <= max && v.every(check);
const optional = (o: Obj, key: string, check: (v: unknown) => boolean): boolean => o[key] === undefined || check(o[key]);
const bounds = (v: unknown): boolean => obj(v) && finite(v.x) && finite(v.y) && finite(v.width) && finite(v.height) && v.width >= 0 && v.height >= 0;
const requirement = (v: unknown): boolean => obj(v) && str(v.name) && typeof v.met === "boolean" && optional(v, "ids", v => list(v, int)) && optional(v, "quantity", int);
const diagnostic = (v: unknown): boolean => obj(v) && str(v.code) && str(v.message) && optional(v, "helper", str) && optional(v, "method", str);
const target = (v: unknown): boolean => obj(v) && ["npc", "object", "item", "tile", "widget"].includes(v.kind as string) && optional(v, "id", int) && optional(v, "ids", v => list(v, int)) && optional(v, "x", int) && optional(v, "y", int) && optional(v, "plane", v => int(v) && v >= 0 && v <= 3) && optional(v, "label", str);
const paint = (v: unknown): boolean => typeof v === "string" && (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v) || v === "none");
const pathPart = (v: unknown): boolean => obj(v) && ["M", "L", "Q", "C", "Z"].includes(v.op as string) && list(v.values, finite, 6) && (v.values as number[]).length === ({ M: 2, L: 2, Q: 4, C: 6, Z: 0 } as Record<string, number>)[v.op as string];
const overlay = (v: unknown): boolean => {
    if (!obj(v) || !["rect", "line", "text", "polygon", "path", "image"].includes(v.kind as string) || !["x", "y", "width", "height", "x2", "y2", "fontSize"].every(k => optional(v, k, finite)) || !optional(v, "color", v => finite(v) || paint(v)) || !optional(v, "text", str) || !optional(v, "font", str) || !optional(v, "fill", paint) || !optional(v, "stroke", paint) || !optional(v, "lineWidth", v => finite(v) && v >= 0 && v <= 100))
        return false;
    if (v.kind === "path")
        return list(v.path, pathPart, 8192);
    if (v.kind === "image")
        return typeof v.dataUrl === "string" && v.dataUrl.length <= 350000 && /^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(v.dataUrl) && finite(v.x) && finite(v.y) && finite(v.width) && finite(v.height) && v.width > 0 && v.height > 0;
    return optional(v, "points", v => list(v, p => obj(p) && finite(p.x) && finite(p.y), 512));
};
const step = (v: unknown): boolean => obj(v) && str(v.id) && list(v.text, str) && list(v.targets, target) && list(v.requirements, requirement) && list(v.dialogueChoices, v => obj(v) && str(v.text) && optional(v, "index", int)) && list(v.widgets, v => obj(v) && int(v.id) && optional(v, "bounds", bounds) && optional(v, "label", str)) && list(v.overlays, overlay);
export function parseHelperResponse(value: unknown): HelperResponse | null {
    if (!obj(value) || value.protocol !== 1 || !str(value.session) || !str(value.questKey) || !str(value.sourceCommit) || !int(value.sequence) || value.sequence < 1 || !["active", "complete", "unsupported", "unavailable"].includes(value.status as string) || !(value.activeStep === null || step(value.activeStep)) || !list(value.panels, v => obj(v) && str(v.title) && optional(v, "text", v => list(v, str)) && optional(v, "requirements", v => list(v, requirement))) || !list(value.diagnostics, diagnostic) || !optional(value, "requests", v => list(v, r => obj(r) && typeof r.kind === "string" && /^(geometry|varbit|varbitDefinition|itemDefinitions|objectDefinitions|npcDefinitions|widgetBounds|questState|container)(\.[a-zA-Z][a-zA-Z0-9]{0,63})?$/.test(r.kind) && int(r.id) && r.id >= 0)))
        return null;
    // Copy across the trust boundary; callers cannot mutate in-flight results.
    return JSON.parse(JSON.stringify(value)) as HelperResponse;
}
export function parseHelperCatalog(value: unknown): HelperCatalog | null {
    if (!obj(value) || value.protocol !== 1 || !str(value.sourceCommit) || !list(value.quests, v => obj(v) && str(v.questKey) && str(v.name) && typeof v.supported === "boolean" && optional(v, "helperClass", str) && optional(v, "helperVariant", str) && optional(v, "requiredVarbits", v => list(v, int)) && optional(v, "variants", v => list(v, x => obj(x) && str(x.helperVariant) && str(x.helperClass), 32)), 512) || !list(value.diagnostics, diagnostic))
        return null;
    const quests = (value.quests as (HelperQuest & {
        variants?: {
            helperVariant: string;
            helperClass: string;
        }[];
    })[]).flatMap(quest => quest.variants?.length ? quest.variants.map(variant => ({ ...quest, ...variant })) : [{ ...quest, helperVariant: quest.helperVariant || undefined }]);
    const keys = quests.map(q => `${q.questKey}:${q.helperVariant ?? ""}`);
    if (new Set(keys).size !== keys.length)
        return null;
    return JSON.parse(JSON.stringify({ ...value, quests })) as HelperCatalog;
}
