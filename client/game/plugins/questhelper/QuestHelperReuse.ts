import type { ReadonlyClientSnapshot } from "./QuestHelperProtocol";
import type { HelperTerrain } from "./QuestHelperGeometry";

/**
 * Snapshot sections that are large and rarely change: the scene's objects and terrain, the
 * loaded widget tree and the cache definitions. The server keeps the last copy it was sent of
 * each (`digests`), echoes what it holds in every result (`cached`), and the client then names
 * an unchanged section by digest (`reuse`) instead of sending it again. The bridge still gets
 * a full snapshot; the saving is the phone's JSON, deflate and radio time every tick.
 */
export const REUSABLE_SECTIONS = ["objects", "widgets", "itemDefinitions", "objectDefinitions", "npcDefinitions", "terrain"] as const;
export type ReusableSection = (typeof REUSABLE_SECTIONS)[number];

export type WireSnapshot = ReadonlyClientSnapshot & {
    /** Digests of the sections this snapshot carries in full, for the server to remember. */
    digests?: Partial<Record<ReusableSection, string>>;
    /** Sections omitted here, by the digest the server already holds. */
    reuse?: Partial<Record<ReusableSection, string>>;
};

/**
 * A 64-bit digest of a JSON-like value (keys in insertion order, undefined members skipped, as
 * JSON.stringify would). Only ever compared with digests this client made, so it needs to be
 * cheap and stable, not canonical.
 */
const keyHashes = new Map<string, number>();

export function digest(value: unknown): string {
    let a = 0x811c9dc5 | 0, b = 0x9e3779b9 | 0;
    const mix = (v: number) => {
        a = Math.imul(a ^ v, 16777619);
        b = (Math.imul(b ^ v, 0x5bd1e995) + (a >>> 13)) | 0;
    };
    const str = (s: string) => {
        mix(s.length);
        for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
    };
    // Property names repeat across thousands of objects; each is folded to one number once.
    const key = (k: string) => {
        let h = keyHashes.get(k);
        if (h === undefined) {
            h = 0x811c9dc5 | 0;
            for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619);
            h = (h ^ k.length) | 0;
            if (keyHashes.size < 4096) keyHashes.set(k, h);
        }
        mix(h);
    };
    const visit = (v: unknown): void => {
        if (v === null) { mix(1); return; }
        if (v === undefined) { mix(2); return; }
        switch (typeof v) {
            case "number":
                mix(3);
                if (Number.isInteger(v) && Math.abs(v) < 0x40000000) mix(v); else str(String(v));
                return;
            case "string": mix(4); str(v); return;
            case "boolean": mix(v ? 5 : 6); return;
            case "object": {
                if (Array.isArray(v)) { mix(7); mix(v.length); for (const e of v) visit(e); mix(8); return; }
                mix(9);
                for (const k in v as Record<string, unknown>) {
                    const e = (v as Record<string, unknown>)[k];
                    if (e === undefined || typeof e === "function") continue;
                    key(k);
                    visit(e);
                }
                mix(10);
                return;
            }
            default: mix(11); str(String(v));
        }
    };
    visit(value);
    return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

export class SnapshotReuse {
    private session = "";
    private readonly held = new Map<ReusableSection, string>();

    /** What the server holds for `session`; another session starts from nothing. */
    private forSession(session: string): Map<ReusableSection, string> {
        if (session !== this.session) { this.session = session; this.held.clear(); }
        return this.held;
    }

    /** The server no longer holds anything usable (an error, a restart). */
    reset(): void { this.session = ""; this.held.clear(); }

    /** A result's `cached`: the digests the server now holds for its session. */
    accept(session: string, cached: unknown): void {
        const held = this.forSession(session);
        if (!cached || typeof cached !== "object") return;
        for (const section of REUSABLE_SECTIONS) {
            const value = (cached as Record<string, unknown>)[section];
            if (typeof value === "string") held.set(section, value);
        }
    }

    /**
     * The snapshot as it goes over the wire: every reusable section the server already holds is
     * replaced by its digest, the rest are sent in full with theirs. `snapshot` is left as is for
     * the overlays, which read the full scene.
     */
    prepare(session: string, snapshot: ReadonlyClientSnapshot, terrain?: HelperTerrain): WireSnapshot {
        const held = this.forSession(session);
        const digests: Partial<Record<ReusableSection, string>> = {};
        const reuse: Partial<Record<ReusableSection, string>> = {};
        const wire: Record<string, unknown> = { ...snapshot };
        for (const section of REUSABLE_SECTIONS) {
            if (section === "terrain") continue;
            const value = wire[section];
            if (value === undefined) continue;
            const d = digest(value);
            if (held.get(section) === d) { delete wire[section]; reuse[section] = d; } else digests[section] = d;
        }
        if (terrain) {
            if (held.get("terrain") === terrain.digest) reuse.terrain = terrain.digest;
            else { wire.geometry = { ...(snapshot.geometry ?? {}), ...terrain.pack() }; digests.terrain = terrain.digest; }
        }
        if (Object.keys(digests).length) wire.digests = digests;
        if (Object.keys(reuse).length) wire.reuse = reuse;
        return wire as WireSnapshot;
    }
}
