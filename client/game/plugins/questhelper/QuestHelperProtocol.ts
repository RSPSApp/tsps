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
    ecsIndex: number;
    id: number;
    transformedId?: number;
    name: string;
    animation?: number;
    orientation?: number;
    combatLevel?: number;
    interactingIndex?: number;
};
export type HelperWidget = {
    id: number;
    runtimeId?: number;
    index?: number;
    parentId?: number;
    fileId?: number;
    groupId?: number;
    originalX?: number;
    originalY?: number;
    originalWidth?: number;
    originalHeight?: number;
    animationId?: number;
    modelId?: number;
    name?: string;
    spriteId?: number;
    type?: number;
    text?: string;
    hidden?: boolean;
    bounds?: PixelBounds;
    children?: HelperWidget[];
    staticChildren?: (HelperWidget | null)[];
    dynamicChildren?: (HelperWidget | null)[];
    nestedChildren?: (HelperWidget | null)[];
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
    mouse?:{x:number;y:number};
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
    hintArrowNpcIndex: number;
    mouse?: {x:number;y:number};
    weight?: number;
    gender?: number;
    combatLevel?: number;
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
        index: number;
        name: string;
        combatLevel?: number;
        gender?: number;
        weight?: number;
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
export type RequirementCheck = "pass" | "fail" | "partial" | "boost" | "neutral";
export type RequirementState = {
    name: string;
    met: boolean;
    /** Upstream colour: passed, failed, in the bank, boostable, or not an actual item. */
    state?: RequirementCheck;
    tooltip?: string;
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
    recommended?: RequirementState[];
    teleports?: RequirementState[];
    /** Item ids the step highlights in the inventory (teleports and highlightInInventory items). */
    inventoryHighlights?: number[];
    /** QuestStep.getGeInterfaceIcon: items a Grand Exchange search shows for this step. */
    geItems?: number[];
    choiceRules?: ChoiceRule[];
};
/** WidgetChoiceStep.highlightChoice's rule: which option of groupId:childId to recolour. */
export type ChoiceRule = {
    groupId: number;
    childId: number;
    number: boolean;
    id?: number;
    text?: string;
    pattern?: string;
    /** DialogChoiceChange / WidgetTextChange: the text that replaces the option's. */
    replace?: string;
    /** WidgetTextChange: the widget itself, not one of its children, is changed. */
    whole?: boolean;
    excludeGroupId?: number;
    excludeChildId?: number;
    excludes?: string[];
};
/** QuestOverviewPanel's contents. */
export type HelperOverview = {
    name: string;
    difficulty?: string;
    questType?: string;
    wikiUrl?: string;
    generalRequirements?: RequirementState[];
    generalRecommended?: RequirementState[];
    itemRequirements?: RequirementState[];
    itemRecommended?: RequirementState[];
    combatRequirements?: string[];
    notes?: string[];
    rewards?: { type: "EXPERIENCE" | "UNLOCK" | "QUEST_POINT" | "ITEM"; text: string }[];
};
/** One QuestStepPanel. `index` names it for lockSection. */
export type HelperSection = {
    index: number;
    title: string;
    hidden: boolean;
    active: boolean;
    lockable: boolean;
    locked?: boolean;
    unlockable?: boolean;
    requirements: RequirementState[];
    recommended: RequirementState[];
    steps: { text: string[]; active: boolean; faded: boolean; tooltip?: string }[];
    children?: HelperSection[];
};
/** A QuestHelperOverlay PanelComponent row. */
export type OverlayLine = {
    kind: "title" | "line";
    text?: string;
    left?: string;
    right?: string;
    color?: string;
    leftColor?: string;
    rightColor?: string;
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
    questProgress?: QuestProgress[];
    /** Digests of the reusable snapshot sections the server holds for this session (QuestHelperReuse). */
    cached?: Readonly<Record<string, string>>;
    overview?: HelperOverview;
    sections?: HelperSection[];
    overlayPanel?: OverlayLine[];
    /** PluginMessages upstream's steps posted since the last evaluation (namespace "shortestpath"). */
    pluginMessages?: HelperPluginMessage[];
    /** QuestBankTab's sections and the GE search's missing items, when the request asked. */
    bankTab?: HelperBankTab;
};
export type HelperPoint = { x: number; y: number; plane: number };
export type HelperPluginMessage = { namespace: string; name: string; data: { start?: HelperPoint; target?: HelperPoint } };
/** QuestHelperBankTagService's BankTabItem. */
export type HelperBankTabItem = { quantity: number; text?: string; itemIds: number[]; displayId: number; details?: string; met: boolean };
export type HelperBankTabSection = { name: string; items: HelperBankTabItem[]; recommendedItems: HelperBankTabItem[] };
export type HelperBankTab = { sections: HelperBankTabSection[]; missingItems: number[] };
export type QuestEligibility = {known:boolean;eligible:boolean;missing:string[];recommendedMissing:string[];difficulty:number;length:number};
export type QuestProgress = {questKey:string;status:"NOT_STARTED"|"IN_PROGRESS"|"FINISHED";stage:number;eligibility?:QuestEligibility};
export type HelperQuest = {
    questKey: string;
    name: string;
    supported: boolean;
    helperClass?: string;
    helperVariant?: string;
    requiredVarbits?: number[];
    status?: "NOT_STARTED" | "IN_PROGRESS" | "FINISHED";
    stage?: number;
    eligibility?: QuestEligibility;
    questId?: number;
    difficulty?: string;
    questType?: string;
    releaseOrder?: number;
    optimalOrder?: number;
    ironmanOrder?: number;
    questPoints?: number;
    /** Skills it requires or rewards, and the quests it requires (SkillFiltering's inputs). */
    filterSkills?: string[];
    requiredQuests?: string[];
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
    config?: Readonly<Record<string, boolean | number>>;
    lockSection?: { section: number; locked: boolean };
};
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length <= 16384;
const int = (v: unknown): v is number => Number.isSafeInteger(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e7;
const list = (v: unknown, check: (v: unknown) => boolean, max = 4096): boolean => Array.isArray(v) && v.length <= max && v.every(check);
const optional = (o: Obj, key: string, check: (v: unknown) => boolean): boolean => o[key] === undefined || check(o[key]);
const bounds = (v: unknown): boolean => obj(v) && finite(v.x) && finite(v.y) && finite(v.width) && finite(v.height) && v.width >= 0 && v.height >= 0;
const requirement = (v: unknown): boolean => obj(v) && str(v.name) && typeof v.met === "boolean" && optional(v, "state", v => ["pass", "fail", "partial", "boost", "neutral"].includes(v as string)) && optional(v, "tooltip", str) && optional(v, "ids", v => list(v, int)) && optional(v, "quantity", int);
const requirements = (v: unknown): boolean => list(v, requirement, 512);
const choiceRule = (v: unknown): boolean => obj(v) && int(v.groupId) && int(v.childId) && typeof v.number === "boolean" && optional(v, "id", int) && ["text", "pattern", "replace"].every(k => optional(v, k, str)) && optional(v, "whole", x => typeof x === "boolean") && optional(v, "excludeGroupId", int) && optional(v, "excludeChildId", int) && optional(v, "excludes", x => list(x, str, 64));
const strings = (v: unknown): boolean => list(v, str, 512);
const overview = (v: unknown): boolean => obj(v) && str(v.name) && ["difficulty", "questType", "wikiUrl"].every(k => optional(v, k, str)) && ["generalRequirements", "generalRecommended", "itemRequirements", "itemRecommended"].every(k => optional(v, k, requirements)) && optional(v, "combatRequirements", strings) && optional(v, "notes", strings) && optional(v, "rewards", r => list(r, x => obj(x) && ["EXPERIENCE", "UNLOCK", "QUEST_POINT", "ITEM"].includes(x.type as string) && str(x.text), 256));
const section = (v: unknown, depth = 0): boolean => obj(v) && depth < 4 && int(v.index) && str(v.title) && typeof v.hidden === "boolean" && typeof v.active === "boolean" && typeof v.lockable === "boolean" && optional(v, "locked", x => typeof x === "boolean") && optional(v, "unlockable", x => typeof x === "boolean") && requirements(v.requirements) && requirements(v.recommended) && list(v.steps, s => obj(s) && strings(s.text) && typeof s.active === "boolean" && typeof s.faded === "boolean" && optional(s, "tooltip", str), 1024) && optional(v, "children", c => list(c, x => section(x, depth + 1), 256));
const overlayLine = (v: unknown): boolean => obj(v) && (v.kind === "title" || v.kind === "line") && ["text", "left", "right"].every(k => optional(v, k, str)) && ["color", "leftColor", "rightColor"].every(k => optional(v, k, paint));
const diagnostic = (v: unknown): boolean => obj(v) && str(v.code) && str(v.message) && optional(v, "helper", str) && optional(v, "method", str);
const eligibility = (v:unknown):boolean => obj(v)&&typeof v.known==="boolean"&&typeof v.eligible==="boolean"&&list(v.missing,str,128)&&list(v.recommendedMissing,str,128)&&int(v.difficulty)&&int(v.length);
const progress = (v:unknown):boolean => obj(v)&&str(v.questKey)&&["NOT_STARTED","IN_PROGRESS","FINISHED"].includes(v.status as string)&&int(v.stage)&&optional(v,"eligibility",eligibility);
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
const step = (v: unknown): boolean => obj(v) && str(v.id) && list(v.text, str) && list(v.targets, target) && list(v.requirements, requirement) && list(v.dialogueChoices, v => obj(v) && str(v.text) && optional(v, "index", int)) && list(v.widgets, v => obj(v) && int(v.id) && optional(v, "bounds", bounds) && optional(v, "label", str)) && list(v.overlays, overlay) && optional(v, "recommended", requirements) && optional(v, "teleports", requirements) && optional(v, "inventoryHighlights", x => list(x, int, 512)) && optional(v, "choiceRules", x => list(x, choiceRule, 64)) && optional(v, "geItems", x => list(x, int, 512));
const point = (v: unknown): boolean => obj(v) && int(v.x) && int(v.y) && int(v.plane);
const pluginMessage = (v: unknown): boolean =>
    obj(v) && v.namespace === "shortestpath" && (v.name === "path" || v.name === "clear") && obj(v.data) && optional(v.data, "start", point) && optional(v.data, "target", point);
const bankTabItem = (v: unknown): boolean =>
    obj(v) && int(v.quantity) && optional(v, "text", str) && list(v.itemIds, int, 64) && int(v.displayId) && optional(v, "details", str) && typeof v.met === "boolean";
const bankTab = (v: unknown): boolean =>
    obj(v) && list(v.sections, s => obj(s) && str(s.name) && list(s.items, bankTabItem, 512) && list(s.recommendedItems, bankTabItem, 512), 256) && list(v.missingItems, int, 4096);
export function parseHelperResponse(value: unknown): HelperResponse | null {
    if (obj(value) && !(optional(value, "pluginMessages", v => list(v, pluginMessage, 64)) && optional(value, "bankTab", bankTab))) return null;
    if (obj(value) && !optional(value,"questProgress",v=>list(v,progress,512))) return null;
    if (obj(value) && !optional(value, "cached", v => obj(v) && Object.keys(v).length <= 16 && Object.values(v).every(d => typeof d === "string" && /^[0-9a-f]{1,64}$/.test(d)))) return null;
    if (obj(value) && !(optional(value, "overview", overview) && optional(value, "sections", v => list(v, x => section(x), 256)) && optional(value, "overlayPanel", v => list(v, overlayLine, 512)))) return null;
    if (!obj(value) || value.protocol !== 1 || !str(value.session) || !str(value.questKey) || !str(value.sourceCommit) || !int(value.sequence) || value.sequence < 1 || !["active", "complete", "unsupported", "unavailable"].includes(value.status as string) || !(value.activeStep === null || step(value.activeStep)) || !list(value.panels, v => obj(v) && str(v.title) && optional(v, "text", v => list(v, str)) && optional(v, "requirements", v => list(v, requirement))) || !list(value.diagnostics, diagnostic) || !optional(value, "requests", v => list(v, r => obj(r) && typeof r.kind === "string" && /^(geometry|varbit|varbitDefinition|itemDefinitions|objectDefinitions|npcDefinitions|widget|widgetBounds|questState|container)(\.[a-zA-Z][a-zA-Z0-9]{0,63})?$/.test(r.kind) && int(r.id) && r.id >= 0)))
        return null;
    // Copy across the trust boundary; callers cannot mutate in-flight results.
    return JSON.parse(JSON.stringify(value)) as HelperResponse;
}
export function parseHelperCatalog(value: unknown): HelperCatalog | null {
    if (obj(value) && Array.isArray(value.quests) && !value.quests.every(q=>obj(q)&&optional(q,"eligibility",eligibility))) return null;
    const ordering = (q: unknown): boolean => obj(q) && ["difficulty", "questType"].every(k => optional(q, k, str)) && ["releaseOrder", "optimalOrder", "ironmanOrder", "questPoints"].every(k => optional(q, k, int)) && ["filterSkills", "requiredQuests"].every(k => optional(q, k, v => list(v, str, 64)));
    if (obj(value) && Array.isArray(value.quests) && !value.quests.every(q => ordering(q) && (!obj(q) || optional(q, "variants", v => Array.isArray(v) && v.every(ordering))))) return null;
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
