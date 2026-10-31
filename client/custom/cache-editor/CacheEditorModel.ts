/**
 * Pure helpers for the cache editor page, kept out of the component so they can be tested without a
 * renderer. Everything here is a path or a plain object: the page does the fetching and drawing.
 */

export type CacheKind = {
    kind: string;
    label: string;
    archive: string;
    decoded: boolean;
    /** A decoder or a name map exists, so the browser can open it. */
    usable?: boolean;
    /** A picker may offer this kind: there is a gameval name map to filter by. */
    searchable?: boolean;
    count?: number;
    named?: number;
};

export type CacheField = { name: string; type: string; ref?: string; many?: boolean; note?: string };

export type AssetKind = "model" | "sprite" | "texture";

export type AssetRow = { kind: AssetKind; id: number; name: string; file: string; hash: string; size: number };

export type AssetListing = {
    kind: AssetKind;
    index: number;
    total: number;
    offset: number;
    limit: number;
    /** Cache group ids in this index page. */
    cache: number[];
    /** Everything uploaded here, with the name a human gave it. */
    mine: AssetRow[];
};

export type CacheLink = {
    field: string;
    kind: string;
    id: number;
    name: string | null;
    exists: "known" | "missing" | "unverified";
    note?: string;
};

export type CacheDefinition = {
    kind: string;
    id: number;
    exists: boolean;
    name: string | null;
    label: string;
    values?: Record<string, unknown>;
    links?: CacheLink[];
    transforms?: {
        gatedBy: { kind: string; id: number; name: string | null } | null;
        children: Array<{ id: number; name: string | null; exists: string; fallback?: boolean }>;
        resolvedForPlayer?: number | null;
        note: string;
    };
    note?: string;
};

/** One overlay row: a base definition from the cache plus the fields this project overrides. */
export type OverlayRow = { kind: string; id: number; baseId: number; fields: Record<string, unknown> };

const query = (entries: Record<string, string | number | undefined>) => {
    const parts = new URLSearchParams();
    for (const [key, value] of Object.entries(entries)) {
        if (value !== undefined && value !== "") parts.set(key, String(value));
    }
    return parts.toString();
};

export const kindsPath = () => "/api/cache-kinds";
export const fieldsPath = (kind: string, all = false) => `/api/cache-fields?${query({ kind, all: all ? "1" : undefined })}`;
export const assetsPath = (kind: AssetKind, offset = 0, limit = 100, q = "") =>
    `/api/cache-assets?${query({ kind, offset, limit, q })}`;

/** `model 1000000` -> `model 1000000 (my_loc)`, so a reference reads as something recognisable. */
export function labelRef(kind: string, id: number, name: string | null | undefined): string {
    const label = name && name !== "null" ? name : null;
    return label ? `${kind} ${id} (${label})` : `${kind} ${id}`;
}

/** The uploaded asset behind a reference, when that id is one of ours. */
export function assetFor(mine: readonly AssetRow[], kind: string, id: number): AssetRow | undefined {
    return mine.find((asset) => asset.kind === kind && asset.id === id);
}

/** Kinds the browser may list: a decoder or a name map, never a bare archive with neither. */
export const usableKinds = (kinds: readonly CacheKind[]) => kinds.filter((entry) => entry.usable !== false);

/**
 * Reference fields a picker may offer, with the kinds that can be searched by name. A field pointing
 * at models or sprites stays inspectable but is not offered, because there is nothing to search.
 */
export function pickableFields(fields: readonly CacheField[], kinds: readonly CacheKind[]): CacheField[] {
    const searchable = new Set(kinds.filter((entry) => entry.searchable).map((entry) => entry.kind));
    return fields.filter((field) => field.ref !== undefined && searchable.has(field.ref));
}

/** Sets a picked id on a draft: appends for a list field, replaces otherwise. */
export function withPickedId(row: OverlayRow, field: CacheField, id: number): OverlayRow {
    if (!field.many) return withField(row, field.name, id);
    const current = row.fields[field.name];
    const list = Array.isArray(current) ? current as number[] : [];
    return withField(row, field.name, list.includes(id) ? list : [...list, id]);
}
export const searchPath = (text: string, kind?: string | null, limit = 20) => `/api/cache-search?${query({ text, kind: kind ?? undefined, limit })}`;
export const inspectPath = (kind: string, id: number) => `/api/cache-inspect?${query({ kind, id })}`;
export const usedByPath = (kind: string, id: number, limit = 50) => `/api/cache-used-by?${query({ kind, id, limit })}`;

/**
 * The authoring service listens one above the game's websocket port - the same offset the server
 * applies (`WEBSOCKET_PORT + 1101`). Deriving it from the content base keeps one source of truth.
 */
export function authoringBase(contentBase: string | undefined): string | undefined {
    if (!contentBase) return undefined;
    try {
        const url = new URL(contentBase);
        // Only a local http world can have a loopback authoring service next to it.
        if (url.protocol !== "http:") return undefined;
        const port = Number(url.port || 80);
        if (!Number.isInteger(port) || port <= 0) return undefined;
        return `${url.protocol}//${url.hostname}:${port + 1101}`;
    } catch {
        return undefined;
    }
}

/** A new overlay row from an inspected base definition: only the fields this project owns. */
export function draftRow(definition: CacheDefinition, baseId: number, id: number): OverlayRow {
    return {
        kind: definition.kind,
        id,
        baseId,
        fields: {},
    };
}

/** Sets one field on a draft, removing it when the value is cleared. */
export function withField(row: OverlayRow, field: string, value: unknown | undefined): OverlayRow {
    const fields = { ...row.fields };
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) delete fields[field];
    else fields[field] = value;
    return { ...row, fields };
}

/**
 * Problems the page can see before asking the server, so an obvious mistake never becomes a 400.
 * The authoritative checks (cache existence, transport budget) live in the server's document audit.
 */
export function draftProblems(row: OverlayRow, base: CacheDefinition, overlayIdStart: number): string[] {
    const problems: string[] = [];
    if (!Number.isInteger(row.id) || row.id < overlayIdStart) problems.push(`id must be ${overlayIdStart} or above (above the cache's own count)`);
    if (!Number.isInteger(row.baseId) || !base.exists) problems.push("base must be a definition that exists in the cache");
    if (Object.keys(row.fields).length === 0) problems.push("nothing is overridden yet");
    return problems;
}

/** Groups links by field, so a list field shows once with all of its targets. */
export function linksByField(links: readonly CacheLink[] | undefined): Array<{ field: string; entries: CacheLink[] }> {
    const out = new Map<string, CacheLink[]>();
    for (const link of links ?? []) out.set(link.field, [...(out.get(link.field) ?? []), link]);
    return [...out.entries()].map(([field, entries]) => ({ field, entries }));
}

export const linkTone = (link: CacheLink): "known" | "missing" | "unverified" => link.exists;
