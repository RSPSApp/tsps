import { ArchiveVarBitTypeLoader } from "./codec/rs/config/vartype/bit/VarBitTypeLoader";
import type { VarManager } from "./codec/rs/config/vartype/VarManager";
import { CacheIndexDat2 } from "./codec/rs/cache/CacheIndex";
import type { CacheInfo } from "./codec/rs/cache/CacheInfo";
import { ConfigType } from "./codec/rs/cache/ConfigType";
import { IndexType } from "./codec/rs/cache/IndexType";
import { ArchiveLocTypeLoader } from "./codec/rs/config/loctype/LocTypeLoader";
import type { LocType } from "./codec/rs/config/loctype/LocType";
import { ArchiveNpcTypeLoader } from "./codec/rs/config/npctype/NpcTypeLoader";
import type { NpcType } from "./codec/rs/config/npctype/NpcType";
import {
    ArchiveObjTypeLoader,
    PostProcessedObjTypeLoader,
} from "./codec/rs/config/objtype/ObjTypeLoader";
import { CachePipeline } from "./CachePipeline";
import { ObjType } from "./codec/rs/config/objtype/ObjType";
import { DbRowType } from "./codec/rs/config/dbrow/DbRowType";
import { ByteBuffer } from "./codec/rs/io/ByteBuffer";
import { Type } from "./codec/rs/config/Type";

const STRUCT_PARAMS_OPCODE = 249;

export interface ServerCustomItem {
    id: number;
    baseItemId?: number;
    objType: Record<string, unknown>;
    itemDef?: Record<string, unknown>;
    models?: Record<string, string>;
}

export class CacheDefinitions {
    private static readonly SPELL_WIDGET_PARAM_ID = 596;
    private static readonly SPELL_NAME_PARAM_ID = 601;
    private static spellNamesByWidget?: Map<number, string>;
    private static spellsByName?: Map<string, { widgetId: number; itemId: number }>;
    private static state?: {
        npcs: ArchiveNpcTypeLoader;
        varbits: ArchiveVarBitTypeLoader;
        items: PostProcessedObjTypeLoader;
        objects: ArchiveLocTypeLoader;
        info: CacheInfo;
    };
    private static customItems = new Map<number, ServerCustomItem>();
    private static customItemTypes = new Map<number, ObjType>();
    private static customModels?: Array<{ id: number; data: string }>;
    private static dbRows?: { byId: Map<number, DbRowType>; byTable: Map<number, DbRowType[]> };
    private static structParams = new Map<number, ReadonlyMap<number, number | string>>();
    private static enumValues = new Map<number, ReadonlyMap<number, number | string>>();
    /** The struct archive, read once: re-reading it per struct took ~75 ms each. */
    private static structArchive?: ReturnType<ReturnType<typeof CacheIndexDat2.fromStore>["getArchive"]>;
    private static enumArchive?: ReturnType<ReturnType<typeof CacheIndexDat2.fromStore>["getArchive"]>;

    private static getState() {
        if (this.state) return this.state;

        const active = CachePipeline.getActive();
        const info: CacheInfo = {
            name: active.name,
            game: "oldschool",
            environment: "live",
            revision: active.revision,
            timestamp: active.timestamp,
            size: 0,
        };
        const store = CachePipeline.getStore();
        const configs = CacheIndexDat2.fromStore(IndexType.DAT2.configs, store);
        this.state = {
            varbits: new ArchiveVarBitTypeLoader(info, configs.getArchive(ConfigType.DAT2.varbits)),
            npcs: new ArchiveNpcTypeLoader(info, configs.getArchive(ConfigType.DAT2.npcs)),
            items: new PostProcessedObjTypeLoader(
                new ArchiveObjTypeLoader(info, configs.getArchive(ConfigType.DAT2.objs)),
            ),
            objects: new ArchiveLocTypeLoader(info, configs.getArchive(ConfigType.DAT2.locs)),
            info,
        };
        console.debug(
            `[cache] definitions npc=${this.state.npcs.getCount()} item=${this.state.items.getCount()} object=${this.state.objects.getCount()}`,
        );
        return this.state;
    }

    static getNpc(id: number): NpcType {
        return this.getState().npcs.load(id);
    }

    /** Every cache database row, decoded once (the whole archive takes well under a second). */
    private static getDbRows() {
        if (this.dbRows) return this.dbRows;
        const configs = CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore());
        const archive = configs.getArchive(ConfigType.OSRS.dbRow);
        const byId = new Map<number, DbRowType>();
        const byTable = new Map<number, DbRowType[]>();
        for (const id of configs.getFileIds(ConfigType.OSRS.dbRow) ?? []) {
            const file = archive.getFile(id);
            if (!file) continue;
            const row = DbRowType.decode(id, new Int8Array(file.data));
            byId.set(id, row);
            if (!byTable.has(row.tableId)) byTable.set(row.tableId, []);
            byTable.get(row.tableId)!.push(row);
        }
        this.dbRows = { byId, byTable };
        return this.dbRows;
    }

    /** A cache database row by id (the rows cache scripts read with db_getfield). */
    static getDbRow(id: number): DbRowType | undefined {
        return this.getDbRows().byId.get(id);
    }

    /** Every row of a cache database table, in id order. */
    static getDbTableRows(tableId: number): readonly DbRowType[] {
        return this.getDbRows().byTable.get(tableId) ?? [];
    }

    /**
     * A cache struct's params (config archive 34), the key -> value records cache scripts read
     * with struct_param. Empty when the struct does not exist.
     */
    static getStructParams(id: number): ReadonlyMap<number, number | string> {
        const cached = this.structParams.get(id);
        if (cached) return cached;
        const params = new Map<number, number | string>();
        this.structArchive ??= CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore())
            .getArchive(ConfigType.OSRS.struct);
        const file = this.structArchive.getFile(id);
        if (file) {
            const buffer = new ByteBuffer(new Int8Array(file.data));
            for (let opcode = buffer.readUnsignedByte(); opcode !== 0; opcode = buffer.readUnsignedByte()) {
                if (opcode !== STRUCT_PARAMS_OPCODE) break; // the only struct opcode
                Type.readParamsMap(buffer, params);
            }
        }
        this.structParams.set(id, params);
        return params;
    }

    /**
     * A cache enum's key -> value entries (config archive 8), the tables cache scripts read with
     * enum. Empty when the enum does not exist. The default value is not included.
     */
    /** Decodes the enums archive at startup, so no enum's first lookup does it mid-tick. */
    static preloadEnums(): void {
        try {
            this.enumArchive ??= CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore())
                .getArchive(ConfigType.DAT2.enums);
        } catch {
            // No cache (tests, tools): looked up lazily instead.
        }
    }

    static getEnumValues(id: number): ReadonlyMap<number, number | string> {
        const cached = this.enumValues.get(id);
        if (cached) return cached;
        const values = new Map<number, number | string>();
        // The enums archive is decoded once; decompressing it for each new enum caused a hitch.
        this.enumArchive ??= CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore())
            .getArchive(ConfigType.DAT2.enums);
        const file = this.enumArchive.getFile(id);
        if (file) {
            const buffer = new ByteBuffer(new Int8Array(file.data));
            for (let opcode = buffer.readUnsignedByte(); opcode !== 0; opcode = buffer.readUnsignedByte()) {
                if (opcode === 1 || opcode === 2) buffer.readUnsignedByte(); // key / value type
                else if (opcode === 3) buffer.readString(); // default string
                else if (opcode === 4) buffer.readInt(); // default int
                else if (opcode === 5 || opcode === 6) {
                    const size = buffer.readUnsignedShort();
                    for (let i = 0; i < size; i++) {
                        const key = buffer.readInt();
                        values.set(key, opcode === 5 ? buffer.readString() : buffer.readInt());
                    }
                } else if (opcode === 7 || opcode === 8) {
                    buffer.readUnsignedShort(); // the dense table's size
                    const size = buffer.readUnsignedShort();
                    for (let i = 0; i < size; i++) {
                        const key = buffer.readUnsignedShort();
                        values.set(key, opcode === 7 ? buffer.readString() : buffer.readInt());
                    }
                } else break;
            }
        }
        this.enumValues.set(id, values);
        return values;
    }

    static getVarbit(id: number) {
        return this.getState().varbits.load(id);
    }

    static resolveNpc(id: number, vars: Pick<VarManager, "getVarp" | "getVarbit">): NpcType | undefined {
        let npc = this.getNpc(id);
        const seen = new Set<number>();
        while (npc?.transforms) {
            if (seen.has(npc.id)) return undefined;
            seen.add(npc.id);
            npc = npc.transform(vars, this.getState().npcs);
        }
        return npc;
    }

    static getItem(id: number): ObjType {
        const custom = this.customItemTypes.get(id);
        if (custom) return custom;
        return this.getState().items.load(id);
    }

    static hasItem(id: number): boolean {
        if (!Number.isInteger(id) || id <= 0) return false;
        if (this.customItems.has(id)) return true;
        if (id >= this.getCounts().items) return false;
        const item = this.getItem(id);
        return Boolean(item?.name && item.name !== "null");
    }

    static registerCustomItems(rows: unknown[]): void {
        const state = this.getState();
        const items = new Map<number, ServerCustomItem>();
        const types = new Map<number, ObjType>();
        const modelIds = new Set<number>();
        for (const row of rows) {
            if (!row || typeof row !== "object") throw new Error("[custom-items] each row must be an object");
            const raw = row as Record<string, unknown>;
            const id = raw.id as number;
            if (!Number.isInteger(id) || id < 50000 || id < state.items.getCount() || id > 65022) {
                throw new Error(`[custom-items] id must be in 50000..65022: ${String(id)}`);
            }
            if (items.has(id)) throw new Error(`[custom-items] duplicate item id: ${id}`);
            const objProps = raw.objType;
            if (!objProps || typeof objProps !== "object") {
                throw new Error(`[custom-items] ${id} is missing objType`);
            }
            if (typeof (objProps as any).name !== "string" || !(objProps as any).name.trim()) {
                throw new Error(`[custom-items] ${id} is missing objType.name`);
            }
            if (raw.baseItemId !== undefined && !Number.isInteger(raw.baseItemId)) {
                throw new Error(`[custom-items] ${id} has invalid baseItemId`);
            }
            const baseItemId = raw.baseItemId as number | undefined;
            if (baseItemId != null && (baseItemId < 0 || baseItemId >= state.items.getCount() || state.items.load(baseItemId).name === "null")) {
                throw new Error(`[custom-items] ${id} has invalid baseItemId: ${baseItemId}`);
            }
            const item: ServerCustomItem = {
                id,
                baseItemId,
                objType: objProps as Record<string, unknown>,
                itemDef: raw.itemDef && typeof raw.itemDef === "object" ? raw.itemDef as Record<string, unknown> : undefined,
                models: raw.models && typeof raw.models === "object" ? raw.models as Record<string, string> : undefined,
            };
            for (const rawModelId of Object.keys(item.models ?? {})) {
                const modelId = Number(rawModelId);
                if (!Number.isInteger(modelId) || modelId < 1000000 || modelId > 0x7fffffff || modelIds.has(modelId)) {
                    throw new Error(`[custom-items] invalid or duplicate model id: ${rawModelId}`);
                }
                modelIds.add(modelId);
            }
            const base = item.baseItemId != null ? state.items.load(item.baseItemId) : undefined;
            const type = new ObjType(id, state.info);
            if (base) {
                Object.assign(type, base);
                for (const [key, value] of Object.entries(base)) {
                    if (Array.isArray(value)) (type as any)[key] = [...value];
                }
            }
            for (const [key, value] of Object.entries(item.objType)) {
                if (["id", "cacheInfo", "cacheType", "__proto__", "constructor", "prototype"].includes(key) ||
                    typeof (type as any)[key] === "function") {
                    throw new Error(`[custom-items] ${id} has invalid objType property: ${key}`);
                }
                const existing = (type as any)[key];
                if ((typeof existing === "number" || key === "model") && !Number.isFinite(value) ||
                    typeof existing === "boolean" && typeof value !== "boolean" ||
                    ["name", "examine"].includes(key) && typeof value !== "string") {
                    throw new Error(`[custom-items] ${id} has invalid objType.${key}`);
                }
                if (["groundActions", "inventoryActions"].includes(key) &&
                    (!Array.isArray(value) || value.length !== 5 || !value.every((action) => action === null || typeof action === "string"))) {
                    throw new Error(`[custom-items] ${id} requires five ${key} entries`);
                }
                if (["recolorFrom", "recolorTo", "retextureFrom", "retextureTo"].includes(key) &&
                    (!Array.isArray(value) || !value.every(Number.isInteger))) {
                    throw new Error(`[custom-items] ${id} has invalid ${key}`);
                }
            }
            Object.assign(type, item.objType);
            Object.assign(type, { id });
            for (const [from, to] of [[type.recolorFrom, type.recolorTo], [type.retextureFrom, type.retextureTo]]) {
                if ((from?.length ?? 0) !== (to?.length ?? 0)) throw new Error(`[custom-items] ${id} has mismatched recolour/retexture arrays`);
            }
            if (!Array.isArray(type.inventoryActions)) type.inventoryActions = [null, null, null, null, "Drop"];
            items.set(id, item);
            types.set(id, type);
        }
        this.customItems = items;
        this.customItemTypes = types;
        this.customModels = [];
    }

    static getCustomItems(): ServerCustomItem[] {
        return [...this.customItems.values()];
    }

    static setCustomModels(models: Array<{ id: number; data: string }>): void {
        this.customModels = models;
    }

    static getCustomModels(): Array<{ id: number; data: string }> {
        return this.customModels ?? [];
    }

    static getObject(id: number): LocType {
        return this.getState().objects.load(id);
    }

    static getCounts(): { npcs: number; items: number; objects: number } {
        const state = this.getState();
        return {
            npcs: state.npcs.getCount(),
            items: state.items.getCount(),
            objects: state.objects.getCount(),
        };
    }

    static getSpellName(widgetId: number, itemId: number): string | undefined {
        if (itemId > 0 && itemId < this.getState().items.getCount()) {
            const name = this.getItem(itemId).params?.get(this.SPELL_NAME_PARAM_ID);
            if (typeof name === "string") return name;
        }
        if (!this.spellNamesByWidget) {
            this.spellNamesByWidget = new Map();
            for (let id = 0; id < this.getState().items.getCount(); id++) {
                const params = this.getItem(id).params;
                const widget = params?.get(this.SPELL_WIDGET_PARAM_ID);
                const name = params?.get(this.SPELL_NAME_PARAM_ID);
                if (typeof widget === "number" && typeof name === "string") {
                    this.spellNamesByWidget.set(widget, name);
                }
            }
        }
        return this.spellNamesByWidget.get(widgetId);
    }

    /** The spellbook widget and spell item a client sends for the spell with this name. */
    static getSpellByName(name: string): { widgetId: number; itemId: number } | undefined {
        if (!this.spellsByName) {
            this.spellsByName = new Map();
            for (let id = 0; id < this.getState().items.getCount(); id++) {
                const params = this.getItem(id).params;
                const widgetId = params?.get(this.SPELL_WIDGET_PARAM_ID);
                const spellName = params?.get(this.SPELL_NAME_PARAM_ID);
                if (typeof widgetId === "number" && typeof spellName === "string" && !this.spellsByName.has(spellName.toLowerCase())) {
                    this.spellsByName.set(spellName.toLowerCase(), { widgetId, itemId: id });
                }
            }
        }
        return this.spellsByName.get(name.trim().toLowerCase());
    }
}
