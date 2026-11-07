import type { Type } from "../../rs/config/Type";
import type { TypeLoader } from "../../rs/config/TypeLoader";
import { crc32 } from "../../rs/util/Crc32";

export type CustomDefinitionKind = "npc" | "loc" | "item";
export type CustomDefinitionRow = { kind: CustomDefinitionKind; id: number; baseId: number; fields: Record<string, unknown> };
let rows: CustomDefinitionRow[] = [];
let revision = 0;
let key = "";
const forbidden = new Set(["id", "cacheInfo", "cacheType", "__proto__", "constructor", "prototype"]);

export function parseCustomDefinitions(input: unknown): CustomDefinitionRow[] {
    if (!Array.isArray(input)) throw new Error("Custom definitions must be a list");
    const copy: CustomDefinitionRow[] = JSON.parse(JSON.stringify(input));
    const seen = new Set<string>();
    for (const row of copy) {
        if (!row || !["npc", "loc", "item"].includes(row.kind) || !Number.isInteger(row.id) || row.id < 50000 || row.id >= 65535 ||
            !Number.isInteger(row.baseId) || row.baseId < 0 || row.baseId >= 65535 || row.id === row.baseId ||
            !row.fields || typeof row.fields !== "object" || Array.isArray(row.fields) || Object.keys(row.fields).some(name => forbidden.has(name))) {
            throw new Error("Invalid custom definition");
        }
        const identity = `${row.kind}:${row.id}`;
        if (seen.has(identity)) throw new Error("Duplicate custom definition");
        seen.add(identity);
    }
    return copy;
}

/** Each world replaces its complete overlay; no previous world's definitions survive a connection. */
export function replaceCustomDefinitions(input: unknown): void {
    rows = parseCustomDefinitions(input);
    key = rows.length ? crc32(new TextEncoder().encode(JSON.stringify(rows))).toString(36) : "";
    revision++;
}
export const getCustomDefinitions = (): CustomDefinitionRow[] => JSON.parse(JSON.stringify(rows));
export const getCustomDefinitionKey = (): string => key;

/** Apply decoded fields over the same base definition in the main client and rendering workers. */
export class CustomDefinitionLoader<T extends Type> implements TypeLoader<T> {
    private seenRevision = -1;
    private custom = new Map<number, CustomDefinitionRow>();
    private cache = new Map<number, T>();
    private count = 0;
    constructor(private readonly base: TypeLoader<T>, private readonly kind: CustomDefinitionKind) {}
    private sync(): void {
        if (this.seenRevision === revision) return;
        this.custom = new Map(rows.filter(row => row.kind === this.kind).map(row => [row.id, row]));
        this.count = Math.max(0, ...[...this.custom.keys()].map(id => id + 1));
        this.cache.clear();
        this.seenRevision = revision;
    }
    load(id: number): T {
        this.sync();
        const row = this.custom.get(id);
        if (!row) return this.base.load(id);
        const cached = this.cache.get(id);
        if (cached) return cached;
        if (row.baseId >= this.base.getCount()) throw new Error("Custom definition base is missing");
        const base = this.base.load(row.baseId);
        const clone = Object.assign(Object.create(Object.getPrototypeOf(base)), base) as T;
        for (const [field, value] of Object.entries(base)) {
            if (Array.isArray(value) || value instanceof Map) (clone as any)[field] = structuredClone(value);
        }
        for (const [field, value] of Object.entries(row.fields)) {
            if (forbidden.has(field) || typeof (base as any)[field] === "function") throw new Error("Invalid custom field");
            (clone as any)[field] = field === "params" && value && !Array.isArray(value)
                ? new Map(Object.entries(value).map(([id, entry]) => [Number(id), entry])) : structuredClone(value);
        }
        if (Object.prototype.hasOwnProperty.call(row.fields, "actions") && !Object.prototype.hasOwnProperty.call(row.fields, "isInteractive") && "isInteractive" in clone) {
            (clone as any).isInteractive = ((clone as any).actions ?? []).some(Boolean) ? 1 : 0;
        }
        if (this.kind === "item") delete (clone as any).__postProcessed;
        (clone as { id: number }).id = id;
        this.cache.set(id, clone);
        return clone;
    }
    getCount(): number { this.sync(); return Math.max(this.base.getCount(), this.count); }
    clearCache(): void { this.cache.clear(); this.base.clearCache(); }
}
