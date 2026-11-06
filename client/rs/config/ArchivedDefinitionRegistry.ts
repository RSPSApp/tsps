import type { CacheInfo } from "../cache/CacheInfo";
import { crc32 } from "../util/Crc32";
import { decodeArchivedType } from "./ArchivedTypeLoader";
import { archivedSeqFields } from "./ArchivedTypeLoader";
import type { ArchivedReferenceField, ArchivedTypeSource } from "./ArchivedTypeLoader";
import { LocType } from "./loctype/LocType";
import { NpcType } from "./npctype/NpcType";
import { ObjType } from "./objtype/ObjType";
import { SeqType } from "./seqtype/SeqType";
import type { Type } from "./Type";
import type { TypeConstructor } from "./TypeLoader";

export type ArchivedDefinitionKind = "npc" | "loc" | "obj" | "seq";
export interface ArchivedDefinitionRow {
    kind: ArchivedDefinitionKind;
    symbol: string;
    sourceId: number;
    id: number;
    dataBase64: string;
    crc: number;
    expectedCurrentCrc?: number;
}
export interface ArchivedDefinitionBundle {
    id: string;
    targetCache: Pick<CacheInfo, "name" | "game" | "revision">;
    sourceCache: CacheInfo;
    definitions: ArchivedDefinitionRow[];
}
export interface ArchivedDefinitionContext {
    cacheInfo: CacheInfo;
    /** Sequences are optional: a context without their native count rejects archived sequences. */
    counts: Record<Exclude<ArchivedDefinitionKind, "seq">, number> & { seq?: number };
    currentDefinition(kind: ArchivedDefinitionKind, id: number): {
        name: string;
        data?: Int8Array;
    };
}

const constructors: Record<ArchivedDefinitionKind, TypeConstructor<Type>> = {
    npc: NpcType, loc: LocType, obj: ObjType, seq: SeqType,
};
const kinds: readonly ArchivedDefinitionKind[] = ["npc", "loc", "obj", "seq"];
const targetKey = (kind: ArchivedDefinitionKind, id: number) => kind + ":" + id;
const sourceKey = (bundle: string, kind: ArchivedDefinitionKind, id: number) => bundle + ":" + kind + ":" + id;
const nameKey = (bundle: string, kind: ArchivedDefinitionKind, symbol: string) => bundle + ":" + kind + ":" + symbol;
const validCrc = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const validId = (value: number) => Number.isInteger(value) && value >= 0 && value < 0xffff;

/**
 * Validates complete bundles before replacing a cache-bound view. It never
 * changes a native type or publishes part of a rejected update.
 */
export class ArchivedDefinitionRegistry {
    private sources = new Map<string, ArchivedTypeSource>();
    private names = new Map<string, number>();
    private bundles: readonly ArchivedDefinitionBundle[] = [];
    private counts: Record<ArchivedDefinitionKind, number>;
    private readonly nativeCounts: Record<ArchivedDefinitionKind, number>;
    private readonly sequencesSupported: boolean;
    private readonly target: Pick<CacheInfo, "name" | "game" | "revision">;

    constructor(private readonly context: ArchivedDefinitionContext) {
        this.sequencesSupported = context.counts.seq !== undefined;
        this.nativeCounts = { ...context.counts, seq: context.counts.seq ?? 0 };
        for (const kind of kinds) {
            if (!Number.isInteger(this.nativeCounts[kind]) || this.nativeCounts[kind] < 0) {
                throw new Error("Invalid native definition count");
            }
        }
        this.counts = { ...this.nativeCounts };
        this.target = { name: context.cacheInfo.name, game: context.cacheInfo.game, revision: context.cacheInfo.revision };
    }

    replace(input: readonly ArchivedDefinitionBundle[]): void {
        if (!Array.isArray(input)) throw new Error("Archived bundles must be an array");
        // Own the input: packet/store callers may reuse or mutate their objects.
        const bundles: ArchivedDefinitionBundle[] = JSON.parse(JSON.stringify(input));
        const sources = new Map<string, ArchivedTypeSource>();
        const names = new Map<string, number>();
        const sourceIds = new Map<string, number>();
        const counts = { ...this.nativeCounts };
        const bundleIds = new Set<string>();
        const decoded = new Map<string, { type: Type; bundle: string; row: ArchivedDefinitionRow }>();

        for (const bundle of bundles) {
            if (!bundle || typeof bundle.id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(bundle.id) || bundleIds.has(bundle.id)) {
                throw new Error("Invalid or duplicate archive bundle id");
            }
            bundleIds.add(bundle.id);
            const target = bundle.targetCache;
            if (!target || target.name !== this.target.name || target.game !== this.target.game ||
                target.revision !== this.target.revision) throw new Error("Archived bundle targets a different cache");
            const info = bundle.sourceCache;
            if (!info || typeof info.name !== "string" || !info.name.length || info.game !== this.target.game ||
                !Number.isInteger(info.revision) || info.revision <= 0 || info.revision > this.target.revision ||
                typeof info.environment !== "string" || typeof info.timestamp !== "string" ||
                !Number.isFinite(Date.parse(info.timestamp)) || !Number.isFinite(info.size) || info.size < 0) {
                throw new Error("Invalid archived source cache provenance");
            }
            if (!Array.isArray(bundle.definitions) || !bundle.definitions.length) {
                throw new Error("Archive bundle has no definitions");
            }
            const sourceInfo = Object.freeze({ ...info });
            for (const row of bundle.definitions) {
                if (!row || !kinds.includes(row.kind) || !validId(row.id) || row.id === 0 || !validId(row.sourceId)) {
                    throw new Error("Invalid archived definition kind or wire id range");
                }
                if (row.kind === "seq" && !this.sequencesSupported) {
                    throw new Error("Archived sequences need the native sequence count");
                }
                if (typeof row.symbol !== "string" || !/^[a-zA-Z0-9_]+$/.test(row.symbol)) {
                    throw new Error("Invalid archived definition symbol");
                }
                const key = targetKey(row.kind, row.id);
                const original = sourceKey(bundle.id, row.kind, row.sourceId);
                const name = nameKey(bundle.id, row.kind, row.symbol);
                if (sources.has(key) || sourceIds.has(original) || names.has(name)) {
                    throw new Error("Duplicate archived definition target, source or symbol");
                }
                if (typeof row.dataBase64 !== "string" || row.dataBase64.length > 87384 ||
                    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.dataBase64)) {
                    throw new Error("Invalid archived definition payload");
                }
                const data = Uint8Array.from(atob(row.dataBase64), character => character.charCodeAt(0));
                if (!validCrc(row.crc) || crc32(data) !== row.crc) throw new Error("Archived source CRC checksum mismatch");
                if (row.id < this.nativeCounts[row.kind]) {
                    if (row.kind !== "obj") throw new Error("Archived definition collides with an existing native type");
                    const current = this.context.currentDefinition(row.kind, row.id);
                    if (current.name.toLowerCase() !== "null" || !current.data ||
                        !validCrc(row.expectedCurrentCrc) || crc32(new Uint8Array(current.data)) !== row.expectedCurrentCrc) {
                        throw new Error("Archived replacement does not match the retired current definition checksum");
                    }
                } else if (row.expectedCurrentCrc !== undefined) {
                    throw new Error("Appended archived type cannot replace a current definition");
                }
                const source = Object.freeze({ cacheInfo: sourceInfo, dataBase64: row.dataBase64 });
                const type = decodeArchivedType(constructors[row.kind], row.id, source);
                sources.set(key, source);
                names.set(name, row.id);
                sourceIds.set(original, row.id);
                counts[row.kind] = Math.max(counts[row.kind], row.id + 1);
                decoded.set(key, { type, bundle: bundle.id, row });
            }
        }

        // All definition references are bound inside their source bundle. This
        // includes item/placeholder/template cycles, not only NPC/loc morphs.
        for (const [key, entry] of decoded) {
            const reference = (id: number) => {
                if (id === -1) return id;
                const target = sourceIds.get(sourceKey(entry.bundle, entry.row.kind, id));
                if (target === undefined) throw new Error("Unresolved archived definition reference " + id);
                return target;
            };
            const references: Partial<Record<ArchivedReferenceField, number | readonly number[]>> = {};
            if (entry.row.kind === "npc" || entry.row.kind === "loc") {
                const transforms = (entry.type as NpcType | LocType).transforms;
                if (transforms) references.transforms = Object.freeze(transforms.map(reference));
                // Animations are optional bundle members: an id the bundle does not
                // archive is a current native sequence, while a recycled one must be
                // carried by the same bundle and is rebound to its appended id.
                const native = entry.type as unknown as Record<string, number>;
                for (const field of archivedSeqFields(entry.row.kind)) {
                    const id = native[field];
                    const target = id >= 0 ? sourceIds.get(sourceKey(entry.bundle, "seq", id)) : undefined;
                    if (target !== undefined && target !== id) references[field] = target;
                }
            } else if (entry.row.kind === "obj") {
                const item = entry.type as ObjType;
                const fields = ["note", "noteTemplate", "notedId", "unnotedId", "placeholder", "placeholderTemplate"] as const;
                for (const field of fields) {
                    if (item[field] >= 0) references[field] = reference(item[field]);
                }
                if (item.countObj) references.countObj = Object.freeze(item.countObj.map((id, index) =>
                    item.countCo?.[index] > 0 ? reference(id) : id));
            }
            if (Object.keys(references).length) {
                const source = sources.get(key);
                if (!source) throw new Error("Missing archived source for references");
                sources.set(key, Object.freeze({ ...source, references: Object.freeze(references) }));
            }
        }
        for (const bundle of bundles) {
            Object.freeze(bundle.sourceCache);
            Object.freeze(bundle.targetCache);
            bundle.definitions.forEach(Object.freeze);
            Object.freeze(bundle.definitions);
            Object.freeze(bundle);
        }
        this.bundles = Object.freeze(bundles);
        this.sources = sources;
        this.names = names;
        this.counts = counts;
    }

    getSource(kind: ArchivedDefinitionKind, id: number): ArchivedTypeSource | undefined {
        return this.sources.get(targetKey(kind, id));
    }

    getCount(kind: ArchivedDefinitionKind): number {
        return this.counts[kind];
    }

    resolve(bundle: string, kind: ArchivedDefinitionKind, symbol: string): number | null {
        return this.names.get(nameKey(bundle, kind, symbol)) ?? null;
    }

    ids(kind: ArchivedDefinitionKind): number[] {
        const prefix = kind + ":";
        return [...this.sources.keys()].filter(key => key.startsWith(prefix)).map(key => Number(key.slice(prefix.length)));
    }

    getBundles(): readonly ArchivedDefinitionBundle[] {
        return this.bundles;
    }
}
