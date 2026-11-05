import type {
    LeagueMasteryChallengeRow,
    LeagueMasteryNodeRow,
    LeagueRelicRow,
    LeagueTaskRow,
} from "./GamemodeDataTypes";

export type WorldLocChangeRow = {
    oldId: number;
    newId: number;
    x: number;
    y: number;
    level: number;
    newRotation?: number;
    moveToX?: number;
    moveToY?: number;
    matchType?: number;
    matchRotation?: number;
};

export type WorldLocSpawnRow = {
    locId: number;
    x: number;
    y: number;
    level: number;
    shape: number;
    rotation: number;
};

export type WorldTerrainOverrideRow = {
    x: number;
    y: number;
    level: number;
    underlay?: number;
    overlay?: number;
    shape?: number;
    rotation?: number;
    renderFlags?: number;
};

let tasksByStructId: Map<number, LeagueTaskRow> | null = null;
let tasksByTaskId: Map<number, LeagueTaskRow> | null = null;
let relicsByStructId: Map<number, LeagueRelicRow> | null = null;
let masteryNodesByStructId: Map<number, LeagueMasteryNodeRow> | null = null;
let masteryChallengesByStructId: Map<number, LeagueMasteryChallengeRow> | null = null;

let customTasksByStructId: Map<number, any> | null = null;
let customTasksByTaskId: Map<number, any> | null = null;
let customChallengesByStructId: Map<number, any> | null = null;
let customEnumOverrides: Map<number, any[]> | null = null;
let replacedCacheStructIds: Set<number> = new Set();

/** A server-defined struct's params (or a cache struct's replaced ones), read by struct_param before the cache. */
export type StructOverrideRow = {
    structId: number;
    params: Record<string, number | string>;
};

/**
 * A server-defined enum (a new id, or a cache enum replaced whole), read by the enum ops before
 * the cache. `valueType` is "s" for strings, anything else for ints; entries are [key, value].
 */
export type EnumOverrideRow = {
    enumId: number;
    valueType?: string;
    defaultValue?: number | string;
    entries: Array<[number, number | string]>;
};

/**
 * A server-defined DB row (a new id, or a cache row replaced whole), read by the db ops before the
 * cache: `columns` maps a column id to its values, typed by the table's column definition.
 */
export type DbRowOverrideRow = {
    rowId: number;
    tableId: number;
    columns: Record<string, Array<number | string>>;
};

/** The shape the cs2 enum handlers read from a cache EnumType. */
export type EnumOverride = {
    keys: number[];
    intValues?: number[];
    stringValues?: string[];
    defaultInt: number;
    defaultString: string;
    outputCount: number;
};

let structOverrides: Map<number, Record<string, number | string>> | null = null;
let enumOverrides: Map<number, EnumOverride> | null = null;
let dbRowOverrides: Map<number, DbRowOverrideRow> | null = null;

let dynamicWidgetGroups: Map<number, { root: any; widgets: Map<number, any> }> | null = null;
// Behaviour declarations for server-defined interfaces, keyed by group id. See
// widgets/custom/CustomInterfaceRuntime for what the client does with them.
let customInterfaces: Map<number, any> | null = null;
let worldLocChanges: WorldLocChangeRow[] = [];
let worldLocSpawns: WorldLocSpawnRow[] = [];
let worldTerrainOverrides: WorldTerrainOverrideRow[] = [];

let ready = false;

export function isReady(): boolean {
    return ready;
}

/** A new connection clears the old world's overlays, including legacy worlds without datasets. */
export function clearWorldOverlays(): void {
    worldLocChanges = [];
    worldLocSpawns = [];
    worldTerrainOverrides = [];
}

export function loadFromPayload(payload: {
    gamemodeId: string;
    datasets: Array<{ key: string; rows: unknown[] }>;
}): void {
    for (const dataset of payload.datasets) {
        switch (dataset.key) {
            case "customDefinitions": {
                const { replaceCustomDefinitions } = require("../../custom/definitions/CustomDefinitionStore");
                replaceCustomDefinitions(dataset.rows);
                break;
            }
            case "definitionArchives": {
                const { replaceDefinitionArchives } = require("../../custom/archives/ArchivedDefinitionStore");
                replaceDefinitionArchives(dataset.rows);
                break;
            }
            case "leagueTasks":
                tasksByStructId = new Map();
                tasksByTaskId = new Map();
                for (const row of dataset.rows as LeagueTaskRow[]) {
                    const taskId = row.taskId | 0;
                    if (taskId >= 0) tasksByTaskId.set(taskId, row);
                    const structId = typeof row.structId === "number" ? row.structId | 0 : -1;
                    if (structId >= 0) tasksByStructId.set(structId, row);
                }
                break;
            case "leagueRelics":
                relicsByStructId = new Map();
                for (const row of dataset.rows as LeagueRelicRow[]) {
                    relicsByStructId.set(row.structId | 0, row);
                }
                break;
            case "leagueMasteryNodes":
                masteryNodesByStructId = new Map();
                for (const row of dataset.rows as LeagueMasteryNodeRow[]) {
                    masteryNodesByStructId.set(row.structId | 0, row);
                }
                break;
            case "leagueMasteryChallenges":
                masteryChallengesByStructId = new Map();
                for (const row of dataset.rows as LeagueMasteryChallengeRow[]) {
                    masteryChallengesByStructId.set(row.structId | 0, row);
                }
                break;
            // The override datasets are replaced whole when sent: the server sends one complete payload
            // (a league's relics, ranks and tasks together), so a payload without the dataset keeps
            // the last set and an empty one clears it.
            case "structOverrides":
                structOverrides = new Map();
                for (const row of dataset.rows as StructOverrideRow[]) {
                    if (row?.structId == null || !row.params || typeof row.params !== "object") continue;
                    structOverrides.set(row.structId | 0, row.params);
                }
                break;
            case "dbRowOverrides":
                dbRowOverrides = new Map();
                for (const row of dataset.rows as DbRowOverrideRow[]) {
                    if (row?.rowId == null || row.tableId == null || !row.columns || typeof row.columns !== "object") continue;
                    dbRowOverrides.set(row.rowId | 0, row);
                }
                break;
            case "enumOverrides":
                enumOverrides = new Map();
                for (const row of dataset.rows as EnumOverrideRow[]) {
                    if (row?.enumId == null || !Array.isArray(row.entries)) continue;
                    const strings = row.valueType === "s";
                    const keys: number[] = [];
                    const values: Array<number | string> = [];
                    for (const entry of row.entries) {
                        if (!Array.isArray(entry) || entry.length < 2) continue;
                        keys.push(entry[0] | 0);
                        values.push(strings ? String(entry[1]) : (entry[1] as number) | 0);
                    }
                    enumOverrides.set(row.enumId | 0, {
                        keys,
                        intValues: strings ? undefined : (values as number[]),
                        stringValues: strings ? (values as string[]) : undefined,
                        defaultInt: typeof row.defaultValue === "number" ? row.defaultValue | 0 : -1,
                        defaultString: typeof row.defaultValue === "string" ? row.defaultValue : "null",
                        outputCount: keys.length,
                    });
                }
                break;
            case "customTasks":
                customTasksByStructId = new Map();
                customTasksByTaskId = new Map();
                customEnumOverrides = new Map();
                for (const row of dataset.rows as any[]) {
                    if (row.structId != null) customTasksByStructId.set(row.structId | 0, row);
                    if (row.taskId != null) customTasksByTaskId.set(row.taskId | 0, row);
                    if (row.enumGroupId != null) {
                        const group = customEnumOverrides.get(row.enumGroupId) ?? [];
                        group.push(row);
                        customEnumOverrides.set(row.enumGroupId, group);
                    }
                }
                break;
            case "customChallenges":
                customChallengesByStructId = new Map();
                replacedCacheStructIds = new Set();
                if (!customEnumOverrides) customEnumOverrides = new Map();
                for (const row of dataset.rows as any[]) {
                    if (row.structId != null) customChallengesByStructId.set(row.structId | 0, row);
                    if (row.replacesStructId != null)
                        replacedCacheStructIds.add(row.replacesStructId | 0);
                }
                // Register challenges into enum 5695 overrides (prepended)
                if (customChallengesByStructId.size > 0) {
                    const challengeEntries = Array.from(customChallengesByStructId.values());
                    const existing = customEnumOverrides.get(5695) ?? [];
                    customEnumOverrides.set(5695, [...challengeEntries, ...existing]);
                }
                break;
            case "customWidgets":
                try {
                    dynamicWidgetGroups = new Map();
                    for (const group of dataset.rows as any[]) {
                        if (!group?.groupId || !Array.isArray(group.widgets)) continue;
                        const widgets = new Map<number, any>();
                        let root: any = undefined;
                        for (const w of group.widgets) {
                            if (w.uid != null) widgets.set(w.uid, w);
                            if (w.parentUid === -1 || w.parentUid === undefined) root = w;
                        }
                        dynamicWidgetGroups.set(group.groupId | 0, { root, widgets });
                    }
                    console.log(
                        `[GamemodeContentStore] registered ${dynamicWidgetGroups.size} custom widget group(s)`,
                    );
                } catch (err) {
                    console.log("[GamemodeContentStore] failed to load custom widgets", err);
                }
                break;
            case "customInterfaces":
                try {
                    customInterfaces = new Map();
                    for (const declaration of dataset.rows as any[]) {
                        if (declaration?.groupId == null) continue;
                        customInterfaces.set(declaration.groupId | 0, declaration);
                    }
                    console.log(
                        `[GamemodeContentStore] registered ${customInterfaces.size} custom interface(s)`,
                    );
                } catch (err) {
                    console.log("[GamemodeContentStore] failed to load custom interfaces", err);
                }
                break;
            case "customItems":
                try {
                    const { CustomItemRegistry } = require("../../custom/items/CustomItemRegistry");
                    CustomItemRegistry.clear();
                    for (const def of dataset.rows as any[]) {
                        CustomItemRegistry.register(def, def.objType?.name);
                    }
                    console.log(
                        `[GamemodeContentStore] registered ${dataset.rows.length} custom item(s)`,
                    );
                } catch (err) {
                    console.log("[GamemodeContentStore] failed to register custom items", err);
                }
                break;
            case "customModels": {
                const { CustomModelRegistry } = require("../../custom/items/CustomModelRegistry");
                if (dataset.rows.length === 0) CustomModelRegistry.clear();
                for (const row of dataset.rows) CustomModelRegistry.register(row);
                break;
            }
            case "worldLocChanges":
                worldLocChanges = (dataset.rows as WorldLocChangeRow[]).filter(
                    (row) =>
                        typeof row?.oldId === "number" &&
                        typeof row?.newId === "number" &&
                        typeof row?.x === "number" &&
                        typeof row?.y === "number" &&
                        typeof row?.level === "number",
                );
                break;
            case "worldLocSpawns":
                worldLocSpawns = (dataset.rows as WorldLocSpawnRow[]).filter(
                    (row) =>
                        typeof row?.locId === "number" &&
                        typeof row?.x === "number" &&
                        typeof row?.y === "number" &&
                        typeof row?.level === "number" &&
                        typeof row?.shape === "number" &&
                        typeof row?.rotation === "number",
                );
                break;
            case "worldTerrainOverrides":
                worldTerrainOverrides = (dataset.rows as WorldTerrainOverrideRow[]).filter(
                    (row) =>
                        typeof row?.x === "number" &&
                        typeof row?.y === "number" &&
                        typeof row?.level === "number",
                );
                break;
        }
    }
    ready = true;
    console.log(
        `[GamemodeContentStore] loaded: ${tasksByTaskId?.size ?? 0} tasks, ${
            relicsByStructId?.size ?? 0
        } relics, ${masteryNodesByStructId?.size ?? 0} mastery nodes, ${
            customTasksByStructId?.size ?? 0
        } custom tasks`,
    );
}

/** A server-sent struct param, or undefined to read the cache. */
export function getStructOverride(structId: number, paramId: number): number | string | undefined {
    return structOverrides?.get(structId | 0)?.[paramId | 0];
}

/** A server-sent enum, or undefined to read the cache. */
export function getEnumOverride(enumId: number): EnumOverride | undefined {
    return enumOverrides?.get(enumId | 0);
}

/** A server-sent DB row, or undefined to read the cache. */
export function getDbRowOverride(rowId: number): DbRowOverrideRow | undefined {
    return dbRowOverrides?.get(rowId | 0);
}

export function getLeagueTaskStructParam(
    structId: number,
    paramId: number,
): number | string | undefined {
    const row = tasksByStructId?.get(structId | 0);
    if (!row) return undefined;
    const pid = paramId | 0;
    switch (pid) {
        case 873:
            return row.taskId | 0;
        case 874:
            return row.name ?? "";
        case 875:
            return row.description ?? "";
        case 1016:
            return typeof row.category === "number" ? row.category | 0 : 0;
        case 1017:
            return typeof row.area === "number" ? row.area | 0 : 0;
        case 1018:
            return typeof row.skill === "number" ? row.skill | 0 : 0;
        case 2044:
        case 1849:
        case 1850:
        case 1851:
        case 1852:
            return row.tier | 0;
        default:
            return undefined;
    }
}

export function getRelicOrMasteryStructParam(
    structId: number,
    paramId: number,
): number | string | undefined {
    const relic = relicsByStructId?.get(structId | 0);
    if (relic) {
        const pid = paramId | 0;
        switch (pid) {
            case 879:
                return relic.name ?? "";
            case 880:
                return relic.description ?? "";
            case 1855:
                return relic.hasItem ? 1 : 0;
            default:
                return undefined;
        }
    }
    const node = masteryNodesByStructId?.get(structId | 0);
    if (node) {
        const pid = paramId | 0;
        switch (pid) {
            case 2026:
                return node.name ?? "";
            case 2027:
                return node.category ?? 0;
            case 2028:
                return node.description ?? "";
            default:
                return undefined;
        }
    }
    const challenge = masteryChallengesByStructId?.get(structId | 0);
    if (challenge) {
        const pid = paramId | 0;
        switch (pid) {
            case 2028:
                return challenge.description ?? "";
            default:
                return undefined;
        }
    }
    return undefined;
}

export function getCustomStructParam(
    structId: number,
    paramId: number,
): number | string | undefined {
    const task = customTasksByStructId?.get(structId | 0);
    if (task?.params) {
        const val = task.params[paramId];
        if (val !== undefined) return val;
    }
    const challenge = customChallengesByStructId?.get(structId | 0);
    if (challenge?.params) {
        const val = challenge.params[paramId];
        if (val !== undefined) return val;
    }
    return undefined;
}

export function getCustomEnumCountOverride(enumId: number): number {
    const entries = customEnumOverrides?.get(enumId);
    if (!entries || entries.length === 0) return 0;
    // Replacement challenges take the place of cache entries, so they don't
    // increase the total count. Only genuinely new entries add to the count.
    const newEntries = entries.filter((e: any) => e.replacesStructId === undefined).length;
    return newEntries;
}

export function getCustomEnumValueOverride(
    enumId: number,
    key: number,
    baseCount: number,
): { custom: number } | { shiftedKey: number } | undefined {
    const customCount = customEnumOverrides?.get(enumId)?.length ?? 0;
    if (customCount === 0) return undefined;
    const tasks = customEnumOverrides!.get(enumId)!;
    if (key < customCount) {
        return { custom: tasks[key].structId };
    }
    return { shiftedKey: key - customCount };
}

export function getReplacedChallengeStructIds(): ReadonlySet<number> {
    return replacedCacheStructIds;
}

/**
 * Installs a definition fetched from /api/interfaces/<groupId>: its widgets become a
 * loadable group and the rest of the document becomes the behaviour declaration.
 */
export function setCustomInterface(definition: any): boolean {
    const groupId = definition?.groupId | 0;
    if (!groupId || !Array.isArray(definition?.widgets)) {
        return false;
    }
    const widgets = new Map<number, any>();
    let root: any = undefined;
    for (const widget of definition.widgets) {
        if (widget?.uid != null) widgets.set(widget.uid, widget);
        if (widget?.parentUid === -1 || widget?.parentUid === undefined) root = widget;
    }
    if (!dynamicWidgetGroups) dynamicWidgetGroups = new Map();
    dynamicWidgetGroups.set(groupId, { root, widgets });
    if (!customInterfaces) customInterfaces = new Map();
    customInterfaces.set(groupId, definition);
    return true;
}

export function getCustomInterface(groupId: number): any | undefined {
    return customInterfaces?.get(groupId | 0);
}

export function getDynamicWidgetGroup(
    groupId: number,
): { root: any; widgets: Map<number, any> } | undefined {
    return dynamicWidgetGroups?.get(groupId | 0);
}

export function getWorldLocChanges(): readonly WorldLocChangeRow[] {
    return worldLocChanges;
}

export function getWorldLocSpawns(): readonly WorldLocSpawnRow[] {
    return worldLocSpawns;
}

export function getWorldTerrainOverrides(): readonly WorldTerrainOverrideRow[] {
    return worldTerrainOverrides;
}
