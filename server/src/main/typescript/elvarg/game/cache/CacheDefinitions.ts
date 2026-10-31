import { ArchiveVarBitTypeLoader } from "./codec/rs/config/vartype/bit/VarBitTypeLoader";
import { ArchiveIdkTypeLoader } from "./codec/rs/config/idktype/IdkTypeLoader";
import { ArchiveSequenceTypeLoader } from "./codec/rs/config/seqtype/SequenceTypeLoader";
import { SequenceType } from "./codec/rs/config/seqtype/SequenceType";
import { ArchiveSpotAnimTypeLoader } from "./codec/rs/config/spotanimtype/SpotAnimTypeLoader";
import { SpotAnimType } from "./codec/rs/config/spotanimtype/SpotAnimType";
import type { IdkType } from "./codec/rs/config/idktype/IdkType";
import type { VarManager } from "./codec/rs/config/vartype/VarManager";
import type { Archive } from "./codec/rs/cache/Archive";
import { CacheIndexDat2 } from "./codec/rs/cache/CacheIndex";
import type { CacheInfo } from "./codec/rs/cache/CacheInfo";
import { ConfigType } from "./codec/rs/cache/ConfigType";
import { IndexType } from "./codec/rs/cache/IndexType";
import { ArchiveLocTypeLoader } from "./codec/rs/config/loctype/LocTypeLoader";
import { LocType } from "./codec/rs/config/loctype/LocType";
import { ArchiveNpcTypeLoader } from "./codec/rs/config/npctype/NpcTypeLoader";
import { NpcType } from "./codec/rs/config/npctype/NpcType";
import {
    ArchiveObjTypeLoader,
    PostProcessedObjTypeLoader,
} from "./codec/rs/config/objtype/ObjTypeLoader";
import { CachePipeline } from "./CachePipeline";
import { ObjType } from "./codec/rs/config/objtype/ObjType";
import { DbRowType } from "./codec/rs/config/dbrow/DbRowType";
import { Gamevals, GamevalKind } from "./Gamevals";
import { ByteBuffer } from "./codec/rs/io/ByteBuffer";
import { Type } from "./codec/rs/config/Type";
import { ArchivedTypeLoader } from "./codec/rs/config/ArchivedTypeLoader";
import { ArchivedDefinitionRegistry, ArchivedDefinitionBundle, ArchivedDefinitionKind, ArchivedDefinitionContext } from "./codec/rs/config/ArchivedDefinitionRegistry";

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
        npcs: ArchivedTypeLoader<NpcType>;
        varbits: ArchiveVarBitTypeLoader;
        identKits: ArchiveIdkTypeLoader;
        items: PostProcessedObjTypeLoader;
        objects: ArchivedTypeLoader<LocType>;
        sequences: ArchiveSequenceTypeLoader;
        spotAnims: ArchiveSpotAnimTypeLoader;
        objArchives: ArchivedTypeLoader<ObjType>;
        archives: ArchivedDefinitionRegistry;
        archiveContext: ArchivedDefinitionContext;
        info: CacheInfo;
    };
    private static customItems = new Map<number, ServerCustomItem>();
    /**
     * Decoded definition overlays: a base definition from the cache plus the fields this project
     * overrides. Kept apart from `customItems`, which is the item loader's own JSON pipeline, so a
     * loc or npc overlay needs no encoder and no cache repack.
     */
    private static customDefinitions = new Map<string, { baseId: number; fields: Record<string, unknown> }>();
    private static customDefinitionCache = new Map<string, unknown>();
    private static customItemTypes = new Map<number, ObjType>();
    private static customModels?: Array<{ id: number; data: string }>;
    private static dbArchive?: Archive;
    private static dbRowIdsByTable?: Map<number, number[]>;
    private static readonly dbRows = new Map<number, DbRowType>();
    private static readonly dbTables = new Map<number, readonly DbRowType[]>();
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
        const native = {
            npc: new ArchiveNpcTypeLoader(info, configs.getArchive(ConfigType.DAT2.npcs)),
            loc: new ArchiveLocTypeLoader(info, configs.getArchive(ConfigType.DAT2.locs)),
            obj: new ArchiveObjTypeLoader(info, configs.getArchive(ConfigType.DAT2.objs)),
        };
        const archiveContext: ArchivedDefinitionContext = {
            cacheInfo: info,
            counts: { npc: native.npc.getCount(), loc: native.loc.getCount(), obj: native.obj.getCount() },
            currentDefinition: (kind, id) => ({
                name: native[kind].load(id).name,
                data: native[kind].archive.getFile(id)?.data,
            }),
        };
        const archives = new ArchivedDefinitionRegistry(archiveContext);
        const objArchives = new ArchivedTypeLoader(native.obj, ObjType,
            id => archives.getSource("obj", id), () => archives.getCount("obj"));
        this.state = {
            varbits: new ArchiveVarBitTypeLoader(info, configs.getArchive(ConfigType.DAT2.varbits)),
            sequences: new ArchiveSequenceTypeLoader(info, configs.getArchive(ConfigType.DAT2.seqs)),
            spotAnims: new ArchiveSpotAnimTypeLoader(info, configs.getArchive(ConfigType.DAT2.spotAnims)),
            identKits: new ArchiveIdkTypeLoader(info, configs.getArchive(ConfigType.DAT2.identkits)),
            npcs: new ArchivedTypeLoader(native.npc, NpcType,
                id => archives.getSource("npc", id), () => archives.getCount("npc")),
            items: new PostProcessedObjTypeLoader(objArchives),
            objects: new ArchivedTypeLoader(native.loc, LocType,
                id => archives.getSource("loc", id), () => archives.getCount("loc")),
            objArchives,
            archives,
            archiveContext,
            info,
        };
        console.debug(
            `[cache] definitions npc=${this.state.npcs.getCount()} item=${this.state.items.getCount()} object=${this.state.objects.getCount()}`,
        );
        return this.state;
    }

    static getNpc(id: number): NpcType {
        return this.applyCustomDefinition("npc", id, (baseId) => this.getState().npcs.load(baseId))
            ?? this.getState().npcs.load(id);
    }

    static registerDefinitionArchives(bundles: readonly ArchivedDefinitionBundle[]): Record<ArchivedDefinitionKind, number[]> {
        const state = this.getState(), registry = state.archives;
        const before = { npc: registry.ids("npc"), loc: registry.ids("loc"), obj: registry.ids("obj") };
        registry.replace(bundles);
        state.npcs.clearArchivedCache();
        state.objects.clearArchivedCache();
        state.objArchives.clearArchivedCache();
        return {
            npc: [...new Set([...before.npc, ...registry.ids("npc")])],
            loc: [...new Set([...before.loc, ...registry.ids("loc")])],
            obj: [...new Set([...before.obj, ...registry.ids("obj")])],
        };
    }

    static getDefinitionArchiveBundles(): readonly ArchivedDefinitionBundle[] {
        return this.getState().archives.getBundles();
    }

    /** Validate a candidate and report semantic source changes without publishing it. */
    static getDefinitionArchiveChanges(bundles: readonly ArchivedDefinitionBundle[]): Record<ArchivedDefinitionKind, number[]> {
        const state = this.getState();
        const candidate = new ArchivedDefinitionRegistry(state.archiveContext);
        candidate.replace(bundles);
        const changed = (kind: ArchivedDefinitionKind) =>
            [...new Set([...state.archives.ids(kind), ...candidate.ids(kind)])].filter(id =>
                JSON.stringify(state.archives.getSource(kind, id)) !== JSON.stringify(candidate.getSource(kind, id)));
        return { npc: changed("npc"), loc: changed("loc"), obj: changed("obj") };
    }

    static getArchivedId(bundle: string, kind: ArchivedDefinitionKind, symbol: string): number | null {
        return this.getState().archives.resolve(bundle, kind, symbol);
    }

    private static getDbArchive(): Archive {
        if (!this.dbArchive) {
            const configs = CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore());
            this.dbArchive = configs.getArchive(ConfigType.OSRS.dbRow);
        }
        return this.dbArchive;
    }

    /** Only table membership is indexed; unused rows retain no decoded column data. */
    private static getDbRowIdsByTable(): Map<number, number[]> {
        if (this.dbRowIdsByTable) return this.dbRowIdsByTable;
        const archive = this.getDbArchive();
        const byTable = new Map<number, number[]>();
        for (const id of archive.fileIds) {
            const file = archive.getFile(id);
            if (!file) continue;
            const tableId = DbRowType.readTableId(file.data);
            let ids = byTable.get(tableId);
            if (!ids) byTable.set(tableId, ids = []);
            ids.push(id);
        }
        this.dbRowIdsByTable = byTable;
        return byTable;
    }

    /** A cache database row by id, decoded and retained only when requested. */
    static getDbRow(id: number): DbRowType | undefined {
        const cached = this.dbRows.get(id);
        if (cached) return cached;
        const file = this.getDbArchive().getFile(id);
        if (!file) return undefined;
        const row = DbRowType.decode(id, file.data);
        this.dbRows.set(id, row);
        return row;
    }

    /** Every row of a requested table, in id order, sharing the individual row cache. */
    static getDbTableRows(tableId: number): readonly DbRowType[] {
        const cached = this.dbTables.get(tableId);
        if (cached) return cached;
        const ids = this.getDbRowIdsByTable().get(tableId);
        if (!ids) return [];
        const rows = ids.map((id) => this.getDbRow(id)!);
        this.dbTables.set(tableId, rows);
        return rows;
    }

    /** A cache database table's id by its gameval name (`slayer_task`), or null. */
    static getDbTableId(name: string): number | null {
        for (const [id, table] of this.getGamevals().allTables()) {
            if (table.name === name) return id;
        }
        return null;
    }

    /** A database table column's id by its gameval name, or null; columns can move between revisions. */
    static getDbColumn(tableId: number, column: string): number | null {
        return this.getGamevals().tableColumn(tableId, column);
    }

    /** A database table's column names by column id (empty when the cache has no names for it). */
    static getDbColumns(tableId: number): readonly string[] {
        return this.getGamevals().allTables().get(tableId)?.columns ?? [];
    }

    /** A varbit's id by its gameval name (`slayer_points`), or null. */
    static getVarbitId(name: string): number | null {
        return this.idByName(GamevalKind.VARBIT).get(name) ?? null;
    }

    /** A varp's id by its gameval name (`slayer_count`), or null. */
    static getVarpId(name: string): number | null {
        return this.idByName(GamevalKind.VARP).get(name) ?? null;
    }

    /** An inventory's id by its gameval name (`trail_puzzleinv`), or null. */
    static getInventoryId(name: string): number | null {
        return this.idByName(GamevalKind.INV).get(name) ?? null;
    }

    /** A loc's id by its gameval name (`ent_totems_site_1_base`), or null. */
    static getLocId(name: string): number | null {
        return this.idByName(GamevalKind.LOC).get(name) ?? null;
    }

    /** An NPC's id by its gameval name (`ent_totems_ent`), or null. */
    static getNpcId(name: string): number | null {
        return this.idByName(GamevalKind.NPC).get(name) ?? null;
    }

    /** An obj's id by its gameval name (`oak_logs`), or null. */
    static getObjId(name: string): number | null {
        return this.idByName(GamevalKind.OBJ).get(name) ?? null;
    }

    /** An animation's id by its gameval name (`human_pickupfloor`), or null. */
    static getSeqId(name: string): number | null {
        return this.idByName(GamevalKind.SEQ).get(name) ?? null;
    }

    /** An animation's gameval name (`human_pickupfloor`), or null when the cache has none for it. */
    static getSeqName(id: number): string | null {
        return this.getGamevals().namesOf(GamevalKind.SEQ).get(id) ?? null;
    }

    /** Every named animation: id -> gameval name. */
    static getSeqNames(): ReadonlyMap<number, string> {
        return this.getGamevals().namesOf(GamevalKind.SEQ);
    }

    /** Every named loc: id -> gameval name. */
    static getLocNames(): ReadonlyMap<number, string> {
        return this.getGamevals().namesOf(GamevalKind.LOC);
    }

    /** Every named obj: id -> gameval name. */
    static getObjNames(): ReadonlyMap<number, string> {
        return this.getGamevals().namesOf(GamevalKind.OBJ);
    }

    /** Every named graphic: id -> gameval name. */
    static getSpotanimNames(): ReadonlyMap<number, string> {
        return this.getGamevals().namesOf(GamevalKind.SPOTANIM);
    }

    /** Every named varbit: id -> gameval name. */
    static getVarbitNames(): ReadonlyMap<number, string> {
        return this.getGamevals().namesOf(GamevalKind.VARBIT);
    }

    /** Every named db row: id -> gameval name. */
    static getDbRowNames(): ReadonlyMap<number, string> {
        return this.getGamevals().namesOf(GamevalKind.DBROW);
    }

    /** Every named db table: id -> gameval name. */
    static getDbTableNames(): ReadonlyMap<number, string> {
        return this.getGamevals().namesOf(GamevalKind.DBTABLE);
    }

    /** Every named varp: id -> gameval name. */
    static getVarpNames(): ReadonlyMap<number, string> {
        return this.getGamevals().namesOf(GamevalKind.VARP);
    }

    /** Every named inventory: id -> gameval name. */
    static getInventoryNames(): ReadonlyMap<number, string> {
        return this.getGamevals().namesOf(GamevalKind.INV);
    }

    /** Every named NPC: id -> gameval name. */
    static getNpcNames(): ReadonlyMap<number, string> {
        return this.getGamevals().namesOf(GamevalKind.NPC);
    }

    /** A database row's id by its gameval name (`mixology_rewards`), or null. */
    static getDbRowId(name: string): number | null {
        return this.idByName(GamevalKind.DBROW).get(name) ?? null;
    }

    /** A database row's gameval name, or null when the cache has none for it. */
    static getDbRowName(id: number): string | null {
        return this.getGamevals().namesOf(GamevalKind.DBROW).get(id) ?? null;
    }

    /** A graphic's id by its gameval name, or null. */
    static getSpotanimId(name: string): number | null {
        return this.idByName(GamevalKind.SPOTANIM).get(name) ?? null;
    }

    /** An interface component's packed id by its gameval name (`bankside:runepouch_top`), or null. */
    static getComponentId(name: string): number | null {
        return this.getGamevals().componentId(name);
    }

    /** An interface's group id by its gameval name (`poh_jewellery_box`), or null. */
    static getInterfaceId(name: string): number | null {
        for (const [group, iface] of this.getGamevals().allInterfaces()) if (iface.name === name) return group;
        return null;
    }

    private static idsByName = new Map<GamevalKind, Map<string, number>>();

    private static idByName(kind: GamevalKind): Map<string, number> {
        let ids = this.idsByName.get(kind);
        if (!ids) {
            ids = new Map();
            for (const [id, name] of this.getGamevals().namesOf(kind)) ids.set(name, id);
            this.idsByName.set(kind, ids);
        }
        return ids;
    }

    private static gamevals?: Gamevals;

    private static getGamevals(): Gamevals {
        this.gamevals ??= new Gamevals(CachePipeline.getStore());
        return this.gamevals;
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

    /** Every identity kit (player body part), in id order. */
    static getIdentKits(): IdkType[] {
        const loader = this.getState().identKits;
        return Array.from({ length: loader.getCount() }, (_, id) => loader.load(id));
    }

    static getVarbit(id: number) {
        return this.getState().varbits.load(id);
    }

    static getSeq(id: number): SequenceType {
        return this.getState().sequences.load(id);
    }

    static getSeqCount(): number {
        return this.getState().sequences.getCount();
    }

    static getSpotanimCount(): number {
        return this.getState().spotAnims.getCount();
    }

    /**
     * Whether a definition id exists, by asking the archive or the registry rather than by decoding:
     * a loader answers an unknown id with a default object, which is indistinguishable from a real
     * definition that happens to hold default values.
     */
    static hasDefinition(kind: string, id: number): boolean | undefined {
        if (!Number.isInteger(id) || id < 0) return false;
        const state = this.getState();
        const counts = this.getCounts();
        switch (kind) {
            case "loc":
                return this.hasCustomDefinition("loc", id) || id < counts.objects || state.archives.ids("loc").includes(id);
            case "npc":
                return this.hasCustomDefinition("npc", id) || id < counts.npcs || state.archives.ids("npc").includes(id);
            case "item":
                return this.hasCustomDefinition("item", id) || id < counts.items || this.customItems.has(id) || state.archives.ids("obj").includes(id);
            case "varbit":
                return state.varbits.archive.getFile(id) !== undefined;
            case "seq":
                return state.sequences.archive.getFile(id) !== undefined;
            case "spotanim":
                return state.spotAnims.archive.getFile(id) !== undefined;
            case "dbro":
                return this.getDbRow(id) !== undefined;
            default:
                // Structs, enums, db tables, varps, inventories, sprites, sounds and params cannot be
                // proven absent from an empty result, so they answer "unknown" rather than a guess.
                return undefined;
        }
    }

    static getSpotanim(id: number): SpotAnimType {
        return this.getState().spotAnims.load(id);
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
        return this.applyCustomDefinition("item", id, (baseId) => this.getState().items.load(baseId))
            ?? this.getState().items.load(id);
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

    /** Registers overlay rows (`{ kind, id, baseId, fields }`); replaces any previous set. */
    static registerCustomDefinitions(rows: readonly { kind: string; id: number; baseId: number; fields?: Record<string, unknown> }[]): number {
        this.customDefinitions = new Map();
        this.customDefinitionCache = new Map();
        for (const row of rows) {
            if (!row || !Number.isInteger(row.id) || !Number.isInteger(row.baseId)) continue;
            if (!["loc", "npc", "item"].includes(row.kind)) continue;
            this.customDefinitions.set(`${row.kind}:${row.id}`, { baseId: row.baseId, fields: { ...(row.fields ?? {}) } });
        }
        return this.customDefinitions.size;
    }

    static getCustomDefinitions(): Array<{ kind: string; id: number; baseId: number; fields: Record<string, unknown> }> {
        return [...this.customDefinitions.entries()].map(([key, row]) => {
            const [kind, id] = key.split(":");
            return { kind, id: Number(id), baseId: row.baseId, fields: { ...row.fields } };
        });
    }

    /** True when this id is authored here rather than read from the cache. */
    static hasCustomDefinition(kind: string, id: number): boolean {
        return this.customDefinitions.has(`${kind}:${id}`);
    }

    /**
     * The overlay applied: the base definition cloned with its overridden fields. A shallow clone is
     * enough because every overridable field is a scalar or a whole array.
     */
    private static applyCustomDefinition<T extends object>(kind: string, id: number, loadBase: (baseId: number) => T): T | undefined {
        const row = this.customDefinitions.get(`${kind}:${id}`);
        if (!row) return undefined;
        const key = `${kind}:${id}`;
        const cached = this.customDefinitionCache.get(key) as T | undefined;
        if (cached) return cached;
        const base = loadBase(row.baseId);
        if (!base) return undefined;
        const clone = Object.assign(Object.create(Object.getPrototypeOf(base)), base, row.fields) as T;
        this.customDefinitionCache.set(key, clone);
        return clone;
    }

    static getObject(id: number): LocType {
        return this.applyCustomDefinition("loc", id, (baseId) => this.getState().objects.load(baseId))
            ?? this.getState().objects.load(id);
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
