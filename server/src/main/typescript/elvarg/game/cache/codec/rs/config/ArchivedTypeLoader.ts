import type { CacheInfo } from "../cache/CacheInfo";
import { ByteBuffer } from "../io/ByteBuffer";
import type { Type } from "./Type";
import type { TypeConstructor, TypeLoader } from "./TypeLoader";

const npcSeqFields = ["idleSeqId", "turnLeftSeqId", "turnRightSeqId", "walkSeqId", "walkBackSeqId",
    "walkLeftSeqId", "walkRightSeqId", "runSeqId", "runBackSeqId", "runLeftSeqId", "runRightSeqId",
    "crawlSeqId", "crawlBackSeqId", "crawlLeftSeqId", "crawlRightSeqId"] as const;
const locSeqFields = ["seqId"] as const;
export type ArchivedSeqField = typeof npcSeqFields[number] | typeof locSeqFields[number];
export type ArchivedReferenceField = "transforms" | "countObj" | "note" | "noteTemplate" |
    "notedId" | "unnotedId" | "placeholder" | "placeholderTemplate" | ArchivedSeqField;
const referenceFields: readonly string[] = ["transforms", "countObj", "note", "noteTemplate",
    "notedId", "unnotedId", "placeholder", "placeholderTemplate", ...npcSeqFields, ...locSeqFields];

/** Native animation fields of an archived NPC or loc that may name a bundled sequence. */
export function archivedSeqFields(kind: string): readonly ArchivedSeqField[] {
    return kind === "npc" ? npcSeqFields : kind === "loc" ? locSeqFields : [];
}

/** Complete native definition bytes, supplied by the validated archive registry. */
export interface ArchivedTypeSource {
    readonly cacheInfo: CacheInfo;
    readonly dataBase64: string;
    readonly references?: Readonly<Partial<Record<ArchivedReferenceField, number | readonly number[]>>>;
}

/** Strict decoder shared by registry validation and the rendering/game loader. */
export function decodeArchivedType<T extends Type>(constructor: TypeConstructor<T>, id: number, source: ArchivedTypeSource): T {
    const bytes = Int8Array.from(atob(source.dataBase64), (character) => character.charCodeAt(0));
    const buffer = new ByteBuffer(bytes);
    const value = new constructor(id, { ...source.cacheInfo });
    let terminated = false;
    while (buffer.remaining > 0) {
        const opcode = buffer.readUnsignedByte();
        if (opcode === 0) {
            terminated = true;
            break;
        }
        value.decodeOpcode(opcode, buffer);
    }
    if (!terminated) throw new Error("Archived definition " + id + " is missing its terminator");
    if (buffer.remaining !== 0) throw new Error("Archived definition " + id + " has trailing data");
    for (const [field, reference] of Object.entries(source.references ?? {})) {
        if (!referenceFields.includes(field)) throw new Error("Unsupported archived reference field");
        const native = value as unknown as Record<string, unknown>;
        if (Array.isArray(reference) && Array.isArray(native[field]) && reference.length === native[field].length) {
            native[field] = [...reference];
        } else if (typeof reference === "number" && typeof native[field] === "number") {
            native[field] = reference;
        } else {
            throw new Error("Archived reference mapping has no matching native field");
        }
    }
    value.post();
    return value;
}

/**
 * Decode archived definitions using their own cache revision without mutating the
 * ordinary loader. ID allocation, provenance and reference mappings belong to
 * the registry; this adapter only decodes the exact registered payload.
 */
export class ArchivedTypeLoader<T extends Type> implements TypeLoader<T> {
    private readonly archived = new Map<number, {
        data: string;
        info: string;
        value: T;
    }>();

    constructor(
        private readonly base: TypeLoader<T>,
        private readonly typeConstructor: TypeConstructor<T>,
        private readonly sourceForId: (id: number) => ArchivedTypeSource | undefined,
        private readonly sourceCount: () => number = () => 0,
    ) {}

    load(id: number): T {
        const source = this.sourceForId(id);
        if (!source) {
            this.archived.delete(id);
            return this.base.load(id);
        }
        const infoKey = JSON.stringify([source.cacheInfo, source.references]);
        const cached = this.archived.get(id);
        if (cached?.data === source.dataBase64 && cached.info === infoKey) return cached.value;

        const value = decodeArchivedType(this.typeConstructor, id, source);
        this.archived.set(id, { data: source.dataBase64, info: infoKey, value });
        return value;
    }

    getCount(): number {
        const count = this.sourceCount();
        if (!Number.isInteger(count) || count < 0) throw new Error("Invalid archived definition count");
        return Math.max(this.base.getCount(), count);
    }

    clearCache(): void {
        this.clearArchivedCache();
        this.base.clearCache();
    }

    clearArchivedCache(): void {
        this.archived.clear();
    }
}
