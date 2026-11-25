import { ArchiveVarBitTypeLoader } from "./codec/rs/config/vartype/bit/VarBitTypeLoader";
import { ArchiveIdkTypeLoader } from "./codec/rs/config/idktype/IdkTypeLoader";
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
import { ArchivedTypeLoader, decodeArchivedType } from "./codec/rs/config/ArchivedTypeLoader";
import { ArchiveTypeLoader } from "./codec/rs/config/TypeLoader";
import { SeqType } from "./codec/rs/config/seqtype/SeqType";
import { ArchivedDefinitionRegistry, ArchivedDefinitionBundle, ArchivedDefinitionKind, ArchivedDefinitionContext } from "./codec/rs/config/ArchivedDefinitionRegistry";
import { MAX_GAME_MESSAGE_BYTES } from "../../net/BinaryChannel";
import { encodeContentData } from "../../net/protocol/ClientProtocol";
import { customAnimation, customAnimationRows, registerSampledAnimations, sampledAnimationPackets, type SampledAnimationRow } from "./CustomAnimations";

const STRUCT_PARAMS_OPCODE = 249;
const CACHE_EDITOR_SOURCE = "cache-editor";
type CustomDefinitionFields = { baseId: number | null; fields: Record<string, unknown> };

function customDefinitionRows(definitions: ReadonlyMap<string, CustomDefinitionFields>) {
    return [...definitions].map(([key, row]) => {
        const [kind, id] = key.split(":");
        return { kind, id: Number(id), baseId: row.baseId, fields: structuredClone(row.fields) };
    });
}

function customDefinitionDataset(source: string, definitions: ReadonlyMap<string, CustomDefinitionFields>) {
    return {
        key: source === CACHE_EDITOR_SOURCE ? "customDefinitions" : "customDefinitionsAppend",
        rows: customDefinitionRows(definitions),
    };
}

export interface ServerCustomItem {
    id: number;
    baseItemId?: number;
    objType: Record<string, unknown>;
    itemDef?: Record<string, unknown>;
    models?: Record<string, string>;
    /** A special attack bar: `from`, another item whose special it uses; `energy`, its cost in percent. */
    specialAttack?: { from?: number; energy?: number };
    /** Keep this item's worn model for these poses, while respecting empty-hand cues. */
    retainWornModelForAnimations?: number[];
    /** Item-owned client visuals. Source models and selections are checked by the client registry. */
    visuals?: {version:1;models:unknown[]};
}

type CustomItemDataset = { key: "customItems" | "customItemsBatch"; rows: unknown[] };

function customItemPacketFits(dataset: CustomItemDataset): boolean {
    try {
        return encodeContentData("server", [dataset]).length <= MAX_GAME_MESSAGE_BYTES;
    } catch (error) {
        if (error instanceof Error && error.message.endsWith("exceeds short length")) return false;
        throw error;
    }
}

function customItemPackets(rows: ServerCustomItem[]): CustomItemDataset[] {
    const complete: CustomItemDataset = { key: "customItems", rows };
    if (customItemPacketFits(complete)) return [complete];

    // An initial count lets the client validate and install the complete registry once.
    const packets: CustomItemDataset[] = [{ key: "customItemsBatch", rows: [rows.length] }];
    function split(batch: ServerCustomItem[]): void {
        const dataset: CustomItemDataset = { key: "customItemsBatch", rows: batch };
        if (customItemPacketFits(dataset)) {
            packets.push(dataset);
        } else if (batch.length === 1) {
            throw new Error(`[custom-items] item ${batch[0].id} exceeds the compressed login packet limit. Reduce its visual data.`);
        } else {
            const middle = Math.floor(batch.length / 2);
            split(batch.slice(0, middle));
            split(batch.slice(middle));
        }
    }
    split(rows);
    return packets;
}

/** A custom animation or graphic definition: base64 bytes in this cache's encoding. */
export interface CustomDefinitionBytes {
    id: number;
    name: string;
    data: string;
}

export class CacheDefinitions {
    static readonly ITEM_VISUALS_VERSION=1;
    private static readonly SPELL_WIDGET_PARAM_ID = 596;
    private static readonly SPELL_NAME_PARAM_ID = 601;
    private static readonly SPELL_LEVEL_PARAM_ID = 604;
    /** A spell obj's runes as (obj, count) param pairs: 365/366, 367/368, 369/370, 371/372. */
    private static readonly SPELL_RUNE_PARAM_IDS = [[365, 366], [367, 368], [369, 370], [371, 372]] as const;
    private static spellNamesByWidget?: Map<number, string>;
    private static spellsByName?: Map<string, { widgetId: number; itemId: number }>;
    private static spellWidgetGroups?: Set<number>;
    private static state?: {
        npcs: ArchivedTypeLoader<NpcType>;
        varbits: ArchiveVarBitTypeLoader;
        identKits: ArchiveIdkTypeLoader;
        items: PostProcessedObjTypeLoader;
        objects: ArchivedTypeLoader<LocType>;
        sequences: ArchivedTypeLoader<SeqType>;
        spotAnims: ArchiveSpotAnimTypeLoader;
        objArchives: ArchivedTypeLoader<ObjType>;
        archives: ArchivedDefinitionRegistry;
        archiveContext: ArchivedDefinitionContext;
        info: CacheInfo;
    };
    private static customItems = new Map<number, ServerCustomItem>();
    private static customItemLoginPackets: CustomItemDataset[] = [{ key: "customItems", rows: [] }];
    /**
     * Decoded definition overlays: a base definition from the cache plus the fields this project
     * overrides. Kept apart from `customItems`, which is the item loader's own JSON pipeline, so a
     * loc or npc overlay needs no encoder and no cache repack.
     */
    private static customDefinitions = new Map<string, CustomDefinitionFields>();
    /** Each source's rows (the cache editor's document, the custom pets); customDefinitions is all of them. */
    private static customDefinitionSources = new Map<string, Map<string, CustomDefinitionFields>>();
    private static customDefinitionCache = new Map<string, unknown>();
    private static customItemTypes = new Map<number, ObjType>();
    private static customModels?: Array<{ id: number; data: string }>;
    /** Animations and graphics added on top of the cache (the cache editor's assets), by id. */
    private static customSequences = new Map<number, { name: string; value: SeqType }>();
    private static customSpotanims = new Map<number, { name: string; value: SpotAnimType }>();
    /** Each custom animation's definition bytes, for decoders that read the raw seq config. */
    private static customSequenceData = new Map<number, Int8Array>();
    private static dbArchive?: Archive;
    private static dbRowIdsByTable?: Map<number, number[]>;
    private static readonly dbRows = new Map<number, DbRowType>();
    private static readonly dbTables = new Map<number, readonly DbRowType[]>();
    private static structParams = new Map<number, ReadonlyMap<number, number | string>>();
    private static enumValues = new Map<number, ReadonlyMap<number, number | string>>();
    /** The struct archive, read once: re-reading it per struct took ~75 ms each. */
    private static structArchive?: ReturnType<ReturnType<typeof CacheIndexDat2.fromStore>["getArchive"]>;
    private static enumArchive?: ReturnType<ReturnType<typeof CacheIndexDat2.fromStore>["getArchive"]>;
    /** The sprite index's reference table, read once: decoding it per name lookup took ~3 ms each. */
    private static spriteIndex?: CacheIndexDat2;

    private static getState() {
        return this.state ?? this.loadState();
    }

    /**
     * Kept out of getState: this body makes closures, so V8 gives it a context object on every
     * entry, before any early return. Inside getState that was 48 bytes of garbage per definition
     * lookup, several per NPC per tick (issue 6036).
     */
    private static loadState(): NonNullable<typeof CacheDefinitions.state> {
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
            // Only archived animations are decoded here (validation); playback is client-side.
            seq: new ArchiveTypeLoader(SeqType, info, configs.getArchive(ConfigType.DAT2.seqs)),
        };
        const archiveContext: ArchivedDefinitionContext = {
            cacheInfo: info,
            counts: {
                npc: native.npc.getCount(), loc: native.loc.getCount(), obj: native.obj.getCount(),
                seq: native.seq.getCount(),
            },
            currentDefinition: (kind, id) => ({
                // Sequences have no name; only retired items are ever replaced in place.
                name: kind === "seq" ? "" : native[kind].load(id).name,
                data: native[kind].archive.getFile(id)?.data,
            }),
        };
        const archives = new ArchivedDefinitionRegistry(archiveContext);
        const objArchives = new ArchivedTypeLoader(native.obj, ObjType,
            id => archives.getSource("obj", id), () => archives.getCount("obj"));
        this.state = {
            varbits: new ArchiveVarBitTypeLoader(info, configs.getArchive(ConfigType.DAT2.varbits)),
            sequences: new ArchivedTypeLoader(native.seq, SeqType,
                id => archives.getSource("seq", id), () => archives.getCount("seq")),
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
        const candidate = new ArchivedDefinitionRegistry(state.archiveContext);
        candidate.replace(bundles);
        this.checkArchivedSampledAnimationIds(candidate);
        for (const kind of ["npc", "loc", "obj"] as const) {
            for (const id of candidate.ids(kind)) {
                if (this.hasCustomDefinition(kind === "obj" ? "item" : kind, id) || kind === "obj" && this.customItems.has(id)) {
                    throw new Error(`Archived ${kind} ${id} collides with custom content`);
                }
            }
        }
        const before = { npc: registry.ids("npc"), loc: registry.ids("loc"), obj: registry.ids("obj"), seq: registry.ids("seq") };
        registry.replace(bundles);
        this.customDefinitionCache.clear();
        if (before.obj.length > 0 || registry.ids("obj").length > 0) {
            this.spellNamesByWidget = undefined;
            this.spellsByName = undefined;
            this.spellWidgetGroups = undefined;
        }
        state.sequences.clearArchivedCache();
        state.npcs.clearArchivedCache();
        state.objects.clearArchivedCache();
        state.objArchives.clearArchivedCache();
        const changed = {
            npc: [...new Set([...before.npc, ...registry.ids("npc")])],
            loc: [...new Set([...before.loc, ...registry.ids("loc")])],
            obj: [...new Set([...before.obj, ...registry.ids("obj")])],
            seq: [...new Set([...before.seq, ...registry.ids("seq")])],
        };
        this.includeDependentCustomDefinitions(changed);
        return changed;
    }

    static getDefinitionArchiveBundles(): readonly ArchivedDefinitionBundle[] {
        return this.getState().archives.getBundles();
    }

    /** Validate a candidate and report semantic source changes without publishing it. */
    static getDefinitionArchiveChanges(bundles: readonly ArchivedDefinitionBundle[]): Record<ArchivedDefinitionKind, number[]> {
        const state = this.getState();
        const candidate = new ArchivedDefinitionRegistry(state.archiveContext);
        candidate.replace(bundles);
        this.checkArchivedSampledAnimationIds(candidate);
        const changed = (kind: ArchivedDefinitionKind) =>
            [...new Set([...state.archives.ids(kind), ...candidate.ids(kind)])].filter(id =>
                JSON.stringify(state.archives.getSource(kind, id)) !== JSON.stringify(candidate.getSource(kind, id)));
        const result = { npc: changed("npc"), loc: changed("loc"), obj: changed("obj"), seq: changed("seq") };
        this.includeDependentCustomDefinitions(result);
        return result;
    }

    private static checkArchivedSampledAnimationIds(candidate: ArchivedDefinitionRegistry): void {
        for (const id of candidate.ids("seq")) {
            if (customAnimation(id)) throw new Error(`Archived sequence ${id} is already a sampled animation`);
        }
    }

    /** Hydrated gameplay definitions derived from an archive must be invalidated with their base. */
    private static includeDependentCustomDefinitions(changed: Record<ArchivedDefinitionKind, number[]>): void {
        for (const [key, row] of this.customDefinitions) {
            const [kind, id] = key.split(":");
            const archiveKind = (kind === "item" ? "obj" : kind) as ArchivedDefinitionKind;
            if (row.baseId !== null && changed[archiveKind].includes(row.baseId)) changed[archiveKind].push(Number(id));
        }
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
        return this.idByName(GamevalKind.SEQ).get(name) ?? this.customIdByName(this.customSequences, name);
    }

    /** An animation's gameval name (`human_pickupfloor`), or null when the cache has none for it. */
    static getSeqName(id: number): string | null {
        return this.customSequences.get(id)?.name ?? this.getGamevals().namesOf(GamevalKind.SEQ).get(id) ?? null;
    }

    /** A custom graphic's id by its name (a cache editor graphic asset), or null. */
    static getCustomSpotanimId(name: string): number | null {
        return this.customIdByName(this.customSpotanims, name);
    }

    private static customIdByName(map: ReadonlyMap<number, { name: string }>, name: string): number | null {
        for (const [id, row] of map) if (row.name === name) return id;
        return null;
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

    /** A sprite archive by its cache name, including multi-frame overhead icons. */
    static getSpriteId(name: string): number | null {
        this.spriteIndex ??= CacheIndexDat2.fromStore(IndexType.DAT2.sprites, CachePipeline.getStore());
        const id = this.spriteIndex.getArchiveId(name);
        return id < 0 ? null : id;
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
        this.gamevals ??= new Gamevals();
        return this.gamevals;
    }

    /**
     * A cache struct's params (config archive 34), the key -> value records cache scripts read
     * with struct_param. Empty when the struct does not exist.
     */
    static getStructParams(id: number): ReadonlyMap<number, number | string> {
        const cached = this.structParams.get(id);
        if (cached) return cached;
        this.structArchive ??= CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore())
            .getArchive(ConfigType.OSRS.struct);
        const file = this.structArchive.getFile(id);
        const params = file ? this.decodeStructParams(new Int8Array(file.data)) : new Map<number, number | string>();
        this.structParams.set(id, params);
        return params;
    }

    /** A struct file's params; also read from an older cache by scripts/league-era-cache.ts. */
    static decodeStructParams(data: Int8Array): Map<number, number | string> {
        const params = new Map<number, number | string>();
        const buffer = new ByteBuffer(data);
        for (let opcode = buffer.readUnsignedByte(); opcode !== 0; opcode = buffer.readUnsignedByte()) {
            if (opcode !== STRUCT_PARAMS_OPCODE) break; // the only struct opcode
            Type.readParamsMap(buffer, params);
        }
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
        // The enums archive is decoded once; decompressing it for each new enum caused a hitch.
        this.enumArchive ??= CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore())
            .getArchive(ConfigType.DAT2.enums);
        const file = this.enumArchive.getFile(id);
        const values = file ? this.decodeEnumValues(new Int8Array(file.data)) : new Map<number, number | string>();
        this.enumValues.set(id, values);
        return values;
    }

    /** An enum file's key -> value entries; also read from an older cache by scripts/league-era-cache.ts. */
    static decodeEnumValues(data: Int8Array): Map<number, number | string> {
        const values = new Map<number, number | string>();
        const buffer = new ByteBuffer(data);
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

    static getSeq(id: number): SeqType {
        const row = customAnimation(id);
        if (row) {
            const type = new SeqType(id, this.getState().info);
            type.frameLengths = [...row.frameLengths];
            type.frameIds = row.frameLengths.map(() => 0);
            type.frameStep = row.loop ? row.frameLengths.length : -1;
            type.maxLoops = row.loop ? 99 : 1;
            type.looping = row.loop;
            type.priority = 0;
            type.precedenceAnimating = 0;
            return type;
        }
        return this.customSequences.get(id)?.value ?? this.getState().sequences.load(id);
    }

    static registerSampledAnimations(rows: SampledAnimationRow[], source: string): void {
        const nativeCount = this.getState().archiveContext.counts.seq ?? 0;
        registerSampledAnimations(rows, source, nativeCount, id => this.customSequences.has(id) || this.isCacheSeq(id));
    }

    static hasSampledAnimation(id: number): boolean {
        return customAnimation(id) !== undefined;
    }

    static getCustomAnimations(): SampledAnimationRow[] {
        return customAnimationRows();
    }

    static getSampledAnimationPackets(): ReturnType<typeof sampledAnimationPackets> {
        return sampledAnimationPackets();
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
        const counts = state.archiveContext.counts;
        switch (kind) {
            case "loc":
                return this.hasCustomDefinition("loc", id) || id < counts.loc || state.archives.ids("loc").includes(id);
            case "npc":
                return this.hasCustomDefinition("npc", id) || id < counts.npc || state.archives.ids("npc").includes(id);
            case "item":
                return this.hasCustomDefinition("item", id) || id < counts.obj || this.customItems.has(id) || state.archives.ids("obj").includes(id);
            case "varbit":
                return state.varbits.archive.getFile(id) !== undefined;
            case "seq":
                return this.customSequences.has(id) || this.isCacheSeq(id);
            case "spotanim":
                return this.customSpotanims.has(id) || this.isCacheSpotanim(id);
            case "dbro":
                return this.getDbRow(id) !== undefined;
            default:
                // Structs, enums, db tables, varps, inventories, sprites, sounds and params cannot be
                // proven absent from an empty result, so they answer "unknown" rather than a guess.
                return undefined;
        }
    }

    static getSpotanim(id: number): SpotAnimType {
        return this.customSpotanims.get(id)?.value ?? this.getState().spotAnims.load(id);
    }

    private static isCacheSeq(id: number): boolean {
        const state = this.getState();
        return state.archives.ids("seq").includes(id) || state.archiveContext.currentDefinition("seq", id).data !== undefined;
    }

    private static isCacheSpotanim(id: number): boolean {
        return this.getState().spotAnims.archive.getFile(id) !== undefined;
    }

    /**
     * Registers custom animations and graphics, replacing any previous set. Each is decoded here,
     * so a broken definition fails at startup; ids must be free in the cache and fit a packet (u16).
     */
    static registerCustomAnimations(sequences: readonly CustomDefinitionBytes[], spotanims: readonly CustomDefinitionBytes[]): void {
        const info = this.getState().info;
        const decode = <T extends Type>(
            kind: string,
            rows: readonly CustomDefinitionBytes[],
            constructor: new (id: number, cacheInfo: CacheInfo) => T,
            inCache: (id: number) => boolean,
            names: GamevalKind,
        ): Map<number, { name: string; value: T }> => {
            const out = new Map<number, { name: string; value: T }>();
            for (const row of rows) {
                if (!Number.isInteger(row.id) || row.id < 0 || row.id > 0xfffe) throw new Error(`Custom ${kind} id ${row.id} must be 0..65534`);
                if (out.has(row.id)) throw new Error(`Custom ${kind} ${row.id} is listed twice`);
                if (inCache(row.id)) throw new Error(`Custom ${kind} ${row.id} is already a cache ${kind}`);
                if (typeof row.name !== "string" || !row.name) throw new Error(`Custom ${kind} ${row.id} needs a name`);
                if (this.idByName(names).has(row.name)) throw new Error(`Custom ${kind} name ${row.name} is already a cache ${kind}'s name`);
                out.set(row.id, { name: row.name, value: decodeArchivedType(constructor, row.id, { cacheInfo: info, dataBase64: row.data }) });
            }
            return out;
        };
        const sequenceMap = decode("animation", sequences, SeqType, (id) => {
            if (customAnimation(id)) throw new Error(`Custom animation ${id} is already a sampled animation`);
            return this.isCacheSeq(id);
        }, GamevalKind.SEQ);
        const spotanimMap = decode("graphic", spotanims, SpotAnimType, (id) => this.isCacheSpotanim(id), GamevalKind.SPOTANIM);
        this.customSequences = sequenceMap;
        this.customSpotanims = spotanimMap;
        this.customSequenceData = new Map(sequences.map((row) => {
            const bytes = Buffer.from(row.data, "base64");
            return [row.id, new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length)];
        }));
    }

    /**
     * A custom animation's seq config bytes (as the cache's file data), or undefined for a cache
     * animation. NpcAnimationScanner reads its length and priorities from them.
     */
    static getCustomSeqData(id: number): Int8Array | undefined {
        return this.customSequenceData.get(id);
    }

    /** A frame map (an animation's skeleton: index 1, file 0 of its group) as bytes, or undefined. */
    static getFrameMapData(id: number): Uint8Array | undefined {
        try {
            const file = CacheIndexDat2.fromStore(IndexType.DAT2.skeletons, CachePipeline.getStore()).getFile(id, 0);
            return file ? Uint8Array.from(file.data, (byte) => byte & 0xff) : undefined;
        } catch {
            return undefined;
        }
    }

    static resolveNpc(id: number, vars: Pick<VarManager, "getVarp" | "getVarbit">): NpcType | undefined {
        let npc = this.getNpc(id);
        const seen = new Set<number>();
        while (npc?.transforms) {
            if (seen.has(npc.id)) return undefined;
            seen.add(npc.id);
            npc = npc.transform(vars, { load: (target) => this.getNpc(target), getCount: () => this.getCounts().npcs, clearCache() {} });
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
        if (this.customItems.has(id) || this.hasCustomDefinition("item", id)) return true;
        if (id >= this.getCounts().items) return false;
        const item = this.getItem(id);
        return Boolean(item?.name && item.name !== "null");
    }

    static validateItemVisualBudget(rows: unknown[]): void {
        let slots=0;
        for(const raw of rows as any[]){
            if(raw?.visuals===undefined)continue;
            const visuals=raw.visuals;
            if(!visuals||visuals.version!==1||!Array.isArray(visuals.models)||visuals.models.length>5||Buffer.byteLength(JSON.stringify(visuals))>2*1024*1024)throw new Error(`[custom-items] ${raw.id} has invalid visuals`);
            const materials=new Set<string>();
            for(const model of visuals.models){
                if(!model||!Array.isArray(model.textures)||model.textures.length>16)throw new Error(`[custom-items] ${raw.id} has invalid surface layers`);
                for(const layer of model.textures){if(typeof layer?.id!=='string'||layer.id.length>80)throw new Error(`[custom-items] ${raw.id} has invalid surface identity`);materials.add(layer.id);}
            }
            slots+=materials.size;
        }
        if(slots>32)throw new Error('[custom-items] Loaded gear exceeds the 32 custom texture atlas slots. Reduce surface layers before enabling these packages together.');
    }

    static registerCustomItems(rows: unknown[]): void {
        this.validateItemVisualBudget(rows);
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
            if (this.hasCustomDefinition("item", id)) throw new Error(`[custom-items] item id ${id} already belongs to a custom definition`);
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
            // Validated by the item loader; kept so the server and the client (sent this row) see it.
            if (raw.specialAttack && typeof raw.specialAttack === "object") {
                item.specialAttack = raw.specialAttack as ServerCustomItem["specialAttack"];
            }
            if (raw.retainWornModelForAnimations !== undefined) {
                const animations = raw.retainWornModelForAnimations;
                if (!Array.isArray(animations) || animations.length > 1024 || animations.some(id => !Number.isInteger(id) || id < 0 || id > 65534)) {
                    throw new Error(`[custom-items] ${id} has invalid retainWornModelForAnimations`);
                }
                item.retainWornModelForAnimations = [...new Set<number>(animations)];
            }
            if(raw.visuals!==undefined){
                const visuals=raw.visuals as ServerCustomItem['visuals'];
                if(!visuals||visuals.version!==1||!Array.isArray(visuals.models)||visuals.models.length>5||Buffer.byteLength(JSON.stringify(visuals))>2*1024*1024)throw new Error(`[custom-items] ${id} has invalid visuals`);
                item.visuals=structuredClone(visuals);
            }
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
        const packets = customItemPackets([...items.values()]);
        this.customItems = items;
        this.customItemLoginPackets = packets;
        this.customItemTypes = types;
        this.customModels = [];
    }

    static getCustomItems(): ServerCustomItem[] {
        return [...this.customItems.values()];
    }

    static getCustomItemPackets(): readonly CustomItemDataset[] {
        return this.customItemLoginPackets;
    }

    static setCustomModels(models: Array<{ id: number; data: string }>): void {
        this.customModels = models;
    }

    static getCustomModels(): Array<{ id: number; data: string }> {
        return this.customModels ?? [];
    }

    /**
     * Registers overlay rows (`{ kind, id, baseId, fields }`) for one source, replacing that
     * source's previous rows only: the cache editor's document (the default) and generated rows
     * such as the custom pets' followers live side by side. An id another source already has is
     * refused.
     */
    static registerCustomDefinitions(
        rows: readonly { kind: string; id: number; baseId: number | null; fields?: Record<string, unknown> }[],
        source = CACHE_EDITOR_SOURCE,
    ): number {
        const next = new Map<string, CustomDefinitionFields>();
        const counts = this.getBaseCounts();
        for (const row of rows) {
            const count = row?.kind === "loc" ? counts.objects : row?.kind === "npc" ? counts.npcs : counts.items;
            const validBase = row?.baseId === null || (!!row && Number.isInteger(row.baseId) && row.baseId >= 0 && row.baseId < count);
            if (!row || !["loc", "npc", "item"].includes(row.kind) || !Number.isInteger(row.id) || row.id < Math.max(50000, count) || row.id >= 65535 ||
                !validBase || next.has(`${row.kind}:${row.id}`)) throw new Error("Invalid custom definition identity");
            if (row.kind === "item" && this.customItems.has(row.id)) throw new Error("Item ID already belongs to custom-items");
            const owner = this.getCustomDefinitionOwner(row.kind, row.id);
            if (owner !== undefined && owner !== source) throw new Error(`Custom ${row.kind} ${row.id} already belongs to ${owner}`);
            const fields = structuredClone(row.fields ?? {});
            if (Object.keys(fields).some(key => ["id", "cacheInfo", "cacheType", "__proto__", "constructor", "prototype"].includes(key))) throw new Error("Invalid custom definition field");
            next.set(`${row.kind}:${row.id}`, { baseId: row.baseId, fields });
        }
        if (next.size) {
            try {
                encodeContentData("server", [customDefinitionDataset(source, next)]);
            } catch (error) {
                throw new Error(`Cannot encode custom definitions from ${source}: ${(error as Error).message}`);
            }
        }
        this.customDefinitionSources.set(source, next);
        this.customDefinitions = new Map([...this.customDefinitionSources.values()].flatMap((defined) => [...defined]));
        this.customCountFloor = null;
        this.customDefinitionCache = new Map();
        return next.size;
    }

    static getCustomDefinitionOwner(kind: string, id: number): string | undefined {
        const key = `${kind}:${id}`;
        for (const [source, rows] of this.customDefinitionSources) {
            if (rows.has(key)) return source;
        }
        return undefined;
    }

    static getCustomDefinitions(): Array<{ kind: string; id: number; baseId: number | null; fields: Record<string, unknown> }> {
        return customDefinitionRows(this.customDefinitions);
    }

    static getCustomDefinitionDatasets() {
        // Start with a replacement, even on an empty world. Subsequent packets add plugin rows.
        const editor = this.customDefinitionSources.get(CACHE_EDITOR_SOURCE);
        const datasets = [customDefinitionDataset(CACHE_EDITOR_SOURCE, editor ?? new Map())];
        for (const [source, definitions] of this.customDefinitionSources) {
            if (source !== CACHE_EDITOR_SOURCE && definitions.size) {
                datasets.push(customDefinitionDataset(source, definitions));
            }
        }
        return datasets;
    }

    /** True when this id is authored here rather than read from the cache. */
    static hasCustomDefinition(kind: string, id: number): boolean {
        return this.customDefinitions.has(`${kind}:${id}`);
    }

    /**
     * The overlay applied: the base definition cloned with its overridden fields. A shallow clone is
     * enough because every overridable field is a scalar or a whole array.
     */
    private static createBlankCustomDefinition(kind: string, id: number): object {
        const info = this.getState().info;
        if (kind === "loc") return new LocType(id, info);
        if (kind === "npc") return new NpcType(id, info);
        if (kind === "item") return new ObjType(id, info);
        throw new Error(`Cannot create a blank ${kind} definition`);
    }

    private static applyCustomDefinition<T extends object>(kind: string, id: number, loadBase: (baseId: number) => T): T | undefined {
        const row = this.customDefinitions.get(`${kind}:${id}`);
        if (!row) return undefined;
        const key = `${kind}:${id}`;
        const cached = this.customDefinitionCache.get(key) as T | undefined;
        if (cached) return cached;
        const base = row.baseId === null ? this.createBlankCustomDefinition(kind, id) as T : loadBase(row.baseId);
        if (!base) return undefined;
        const clone = Object.assign(Object.create(Object.getPrototypeOf(base)), base) as T;
        for (const [field, value] of Object.entries(base)) {
            if (Array.isArray(value) || value instanceof Map) (clone as any)[field] = structuredClone(value);
        }
        for (const [field, value] of Object.entries(row.fields)) {
            (clone as any)[field] = field === "params" && value && !Array.isArray(value)
                ? new Map(Object.entries(value).map(([id, entry]) => [Number(id), entry])) : structuredClone(value);
        }
        if (row.baseId !== null && Object.prototype.hasOwnProperty.call(row.fields, "actions") && !Object.prototype.hasOwnProperty.call(row.fields, "isInteractive") && "isInteractive" in clone) {
            (clone as any).isInteractive = ((clone as any).actions ?? []).some(Boolean) ? 1 : 0;
        }
        if (kind === "item") delete (clone as any).__postProcessed;
        (clone as { id: number }).id = id;
        if (row.baseId === null) {
            // Fresh definitions bypass the native loader, so finalize derived defaults only after
            // authored fields have been applied (for example, loc model/action interactivity).
            (clone as Type).post();
        }
        this.customDefinitionCache.set(key, clone);
        return clone;
    }

    static getObject(id: number): LocType {
        return this.applyCustomDefinition("loc", id, (baseId) => this.getState().objects.load(baseId))
            ?? this.getState().objects.load(id);
    }

    /**
     * Definition counts, custom definitions included. Every NPC asks several times a tick (through
     * NpcDefinition.forId and NPC.getSize), so the custom definitions' share is worked out once per
     * change of them, and the same frozen object comes back until a count changes (issue 6036: a
     * fresh object and a split of every custom key per call were ~14% of the server's garbage).
     */
    static getCounts(): Readonly<{ npcs: number; items: number; objects: number; seqs: number }> {
        const state = this.getState();
        const floor = this.customCountFloor ??= this.customDefinitionCounts();
        const npcs = Math.max(state.npcs.getCount(), floor.npcs);
        const items = Math.max(state.items.getCount(), floor.items);
        const objects = Math.max(state.objects.getCount(), floor.objects);
        const seqs = state.archives.getCount("seq");
        const cached = this.countsCache;
        if (cached && cached.npcs === npcs && cached.items === items && cached.objects === objects && cached.seqs === seqs) {
            return cached;
        }
        return this.countsCache = Object.freeze({ npcs, items, objects, seqs });
    }

    private static customCountFloor: { npcs: number; items: number; objects: number } | null = null;
    private static countsCache: Readonly<{ npcs: number; items: number; objects: number; seqs: number }> | null = null;

    /** Highest custom id + 1 per kind: the floor custom definitions put under each count. */
    private static customDefinitionCounts(): { npcs: number; items: number; objects: number } {
        const floor = { npcs: 0, items: 0, objects: 0 };
        for (const key of this.customDefinitions.keys()) {
            const [kind, id] = key.split(":");
            const field = kind === "npc" ? "npcs" : kind === "loc" ? "objects" : "items";
            floor[field] = Math.max(floor[field], Number(id) + 1);
        }
        return floor;
    }

    static getBaseCounts(): { npcs: number; items: number; objects: number; seqs: number } {
        const state = this.getState();
        return {
            npcs: state.npcs.getCount(),
            items: state.items.getCount(),
            objects: state.objects.getCount(),
            // Native sequences plus appended archived ones (the next free archived id).
            seqs: state.archives.getCount("seq"),
        };
    }

    private static ensureSpellMetadata(): void {
        if (this.spellNamesByWidget && this.spellsByName && this.spellWidgetGroups) return;

        const spellNamesByWidget = new Map<number, string>();
        const spellsByName = new Map<string, { widgetId: number; itemId: number }>();
        const spellWidgetGroups = new Set<number>();
        for (let id = 0; id < this.getState().items.getCount(); id++) {
            const params = this.getItem(id).params;
            const widgetId = params?.get(this.SPELL_WIDGET_PARAM_ID);
            const spellName = params?.get(this.SPELL_NAME_PARAM_ID);
            if (typeof widgetId !== "number" || typeof spellName !== "string") continue;

            spellNamesByWidget.set(widgetId, spellName);
            spellWidgetGroups.add(widgetId >>> 16);
            const normalizedName = spellName.toLowerCase();
            if (!spellsByName.has(normalizedName)) {
                spellsByName.set(normalizedName, { widgetId, itemId: id });
            }
        }
        this.spellNamesByWidget = spellNamesByWidget;
        this.spellsByName = spellsByName;
        this.spellWidgetGroups = spellWidgetGroups;
    }

    static getSpellName(widgetId: number, itemId: number): string | undefined {
        if (itemId > 0 && itemId < this.getState().items.getCount()) {
            const name = this.getItem(itemId).params?.get(this.SPELL_NAME_PARAM_ID);
            if (typeof name === "string") return name;
        }
        this.ensureSpellMetadata();
        return this.spellNamesByWidget!.get(widgetId);
    }

    static isSpellWidgetGroup(groupId: number): boolean {
        this.ensureSpellMetadata();
        return this.spellWidgetGroups!.has(groupId);
    }

    /** The spellbook widget and spell item a client sends for the spell with this name. */
    static getSpellByName(name: string): { widgetId: number; itemId: number } | undefined {
        this.ensureSpellMetadata();
        return this.spellsByName!.get(name.trim().toLowerCase());
    }

    /** Every spell name the cache's spell objs carry (lower case). */
    static getSpellNames(): string[] {
        this.ensureSpellMetadata();
        return [...this.spellsByName!.keys()];
    }

    /** The Magic level and runes the cache's spell obj lists for the spell with this name. */
    static getSpellRequirements(name: string): { level: number; runes: { id: number; amount: number }[] } | undefined {
        const spell = this.getSpellByName(name);
        if (!spell) return undefined;
        const params = this.getItem(spell.itemId).params;
        const runes: { id: number; amount: number }[] = [];
        for (const [objParam, countParam] of this.SPELL_RUNE_PARAM_IDS) {
            const id = params?.get(objParam), amount = params?.get(countParam);
            if (typeof id === "number" && id > 0 && typeof amount === "number" && amount > 0) runes.push({ id, amount });
        }
        const level = params?.get(this.SPELL_LEVEL_PARAM_ID);
        return { level: typeof level === "number" ? level : 0, runes };
    }
}
