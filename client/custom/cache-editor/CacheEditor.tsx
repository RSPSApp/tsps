import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchContent, getContentApiBase } from "../../network/serverConnection/contentApi";
import type { OsrsClient } from "../../game/OsrsClient";
import { createPreviewRenderer, previewSpec, sequenceFrameCount, shapeLabel, type PreviewRenderer } from "./CacheEditorPreview";
import { LocModelType } from "../../rs/config/loctype/LocModelType";
import {
    type AssetKind, type AssetListing, type AssetRow,
    type CacheDefinition, type CacheField, type CacheKind, type CacheLink,
    assetFor, assetsPath, authoringBase, draftProblems, fieldsPath, inspectPath, kindsPath, labelRef, linksByField,
} from "./CacheEditorModel";

/**
 * The cache editor page, opened at `?cache=1`.
 *
 * Reads go through the world's content API; writes go only to the loopback authoring service.
 * A cache element can be inspected as it is, or a **new** element can be created from a type and an
 * optional starting definition, then edited cell by cell and saved as an overlay row.
 */

type Tab = "values" | "preview" | "links" | "used" | "transforms";

type Editing = {
    kind: string;
    id: number;
    baseId: number;
    base: CacheDefinition | null;
    name: string;
    /** Only what differs from the base; an empty map means "identical to the base". */
    overrides: Record<string, unknown>;
    revision?: string;
};

const styles = {
    page: { position: "fixed", inset: 0, zIndex: 4000, background: "#12141a", color: "#e6e6e6", display: "grid", gridTemplateColumns: "300px 1fr", font: "13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace" } as const,
    side: { borderRight: "1px solid #262a33", display: "flex", flexDirection: "column", minHeight: 0 } as const,
    main: { display: "flex", flexDirection: "column", minHeight: 0 } as const,
    bar: { display: "flex", gap: 8, alignItems: "center", padding: 8, borderBottom: "1px solid #262a33", flexWrap: "wrap" as const } as const,
    input: { background: "#1b1f27", color: "#e6e6e6", border: "1px solid #303643", padding: "4px 6px", minWidth: 0 } as const,
    list: { overflowY: "auto", flex: 1, minHeight: 0 } as const,
    row: (active: boolean) => ({ padding: "5px 8px", cursor: "pointer", background: active ? "#233047" : "transparent", borderBottom: "1px solid #1c2028" }) as const,
    tabs: { display: "flex", gap: 4, padding: 8, borderBottom: "1px solid #262a33" } as const,
    tab: (active: boolean) => ({ padding: "3px 8px", cursor: "pointer", background: active ? "#233047" : "#1b1f27", border: "1px solid #303643" }) as const,
    body: { overflowY: "auto", flex: 1, minHeight: 0, padding: 10 } as const,
    table: { borderCollapse: "collapse" as const, width: "100%" },
    cell: { borderBottom: "1px solid #1c2028", padding: "3px 6px", verticalAlign: "top" as const },
    tone: (state: string) => ({ color: state === "known" ? "#8fd18f" : state === "missing" ? "#e08a8a" : "#c9b06a" }) as const,
    footer: { borderTop: "1px solid #262a33", padding: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const },
};

const label = (value: unknown) => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));

/** A value from a cell edit, as the field's type expects. */
function parseValue(field: CacheField | null, raw: string): unknown {
    const text = raw.trim();
    if (!field) return text;
    if (field.type === "boolean") return text === "true";
    if (field.type === "int[]" || field.type === "number[]") {
        if (!text) return [];
        return text.split(",").map((part) => Number(part.trim())).filter((entry) => Number.isFinite(entry));
    }
    if (field.type === "int" || field.type === "number") {
        const parsed = Number(text);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : raw;
    }
    return raw;
}

export function CacheEditor({ client }: { client?: OsrsClient }) {
    const [kinds, setKinds] = useState<CacheKind[]>([]);
    // Two axes: definitions (config archives) and assets (cache indices: models, sprites, textures).
    const [mode, setMode] = useState<"definitions" | "assets">("definitions");
    const [assetKind, setAssetKind] = useState<AssetKind>("model");
    const [assets, setAssets] = useState<AssetListing | null>(null);
    const [uploadName, setUploadName] = useState("");
    const fileRef = useRef<HTMLInputElement | null>(null);
    const [kind, setKind] = useState("loc");
    const [text, setText] = useState("");
    const [hits, setHits] = useState<Array<{ kind: string; id: number; name: string | null; custom?: boolean }>>([]);
    const [definition, setDefinition] = useState<CacheDefinition | null>(null);
    const [history, setHistory] = useState<Array<{ kind: string; id: number }>>([]);
    const [tab, setTab] = useState<Tab>("values");
    const [used, setUsed] = useState<{ count: number; sources: Array<{ kind: string; id: number; name: string | null; field: string }> } | null>(null);
    const [status, setStatus] = useState("ready");
    const [error, setError] = useState<string | null>(null);

    const [clientReady, setClientReady] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [frame, setFrame] = useState(0);
    const [shape, setShape] = useState<LocModelType>(LocModelType.NORMAL);
    const [rotation, setRotation] = useState(0);
    const [shapes, setShapes] = useState<Array<{ type: LocModelType; label: string }>>([]);
    const [view, setView] = useState({ yaw: 0, pitch: 0, zoom: 1 });
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<PreviewRenderer | null>(null);
    const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);

    // New element flow, and the element being edited.
    const [creating, setCreating] = useState<{ kind: string; name: string; id: number; base: CacheDefinition | null } | null>(null);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [editableFields, setEditableFields] = useState<CacheField[]>([]);
    const [cell, setCell] = useState<{ field: string; text: string } | null>(null);

    const [contentBase, setContentBase] = useState<string | undefined>(() => getContentApiBase());
    useEffect(() => {
        if (contentBase) return;
        const timer = window.setInterval(() => {
            const base = getContentApiBase();
            if (base) {
                setContentBase(base);
                window.clearInterval(timer);
            }
        }, 500);
        return () => window.clearInterval(timer);
    }, [contentBase]);
    const authoring = useMemo(() => authoringBase(contentBase), [contentBase]);

    const load = useCallback(async (path: string) => {
        try {
            const body = await fetchContent(path);
            if (body?.error) throw new Error(body.error);
            return body;
        } catch (failure) {
            setError(String((failure as Error).message ?? failure));
            return null;
        }
    }, []);

    useEffect(() => {
        if (!contentBase) return;
        void (async () => {
            const body = await load(kindsPath());
            if (body?.kinds) {
                const usable = body.kinds.filter((entry: CacheKind) => entry.usable !== false);
                setKinds(usable);
                const first = usable.find((entry: CacheKind) => entry.kind === "loc");
                if (first) setKind(first.kind);
            }
        })();
    }, [contentBase, load]);

    useEffect(() => {
        if (clientReady) return;
        const loadersReady = () => !!client?.modelLoader && !!client?.objTypeLoader
            && !!client?.npcTypeLoader && !!client?.locTypeLoader;
        if (loadersReady()) { setClientReady(true); return; }
        const timer = window.setInterval(() => {
            if (!loadersReady()) return;
            window.clearInterval(timer);
            setClientReady(true);
        }, 400);
        return () => window.clearInterval(timer);
    }, [client, clientReady]);

    /** The element on screen: a cache definition, or the one being edited with its overrides applied. */
    const shown = useMemo<CacheDefinition | null>(() => {
        if (!editing) return definition;
        return {
            kind: editing.kind,
            id: editing.id,
            exists: true,
            name: editing.name || editing.base?.name || null,
            label: editing.base?.label ?? editing.kind,
            values: { ...(editing.base?.values ?? {}), ...editing.overrides },
            links: editing.base?.links,
            transforms: editing.base?.transforms,
        };
    }, [definition, editing]);

    const inspect = useCallback(async (nextKind: string, id: number, push = true) => {
        setError(null);
        setUsed(null);
        setTab("values");
        setEditing(null);
        const body = await load(inspectPath(nextKind, id));
        if (!body) return;
        if (push && definition) setHistory((entries) => [...entries, { kind: definition.kind, id: definition.id }].slice(-20));
        setDefinition(body as CacheDefinition);
        setView({ yaw: 0, pitch: 0, zoom: 1 });
    }, [definition, load]);

    const loadAssets = useCallback(async (forKind: AssetKind = assetKind, offset = 0) => {
        if (!contentBase) return;
        const body = await load(assetsPath(forKind, offset));
        if (body) setAssets(body as AssetListing);
    }, [assetKind, contentBase, load]);

    /** Upload lives here, with the assets, because an asset is what an upload creates. */
    const upload = useCallback(async (file: File) => {
        if (!authoring) { setError("Uploading needs the local authoring service; start the server with CACHE_EDITOR_ENABLED=1"); return; }
        const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
            reader.onerror = () => reject(new Error("Could not read the file"));
            reader.readAsDataURL(file);
        });
        try {
            const response = await fetch(`${authoring}/assets`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind: assetKind, name: uploadName || file.name, data }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body?.error ?? `upload failed: ${response.status}`);
            setStatus(`${body.reused ? "already stored" : "uploaded"} ${body.asset.kind} ${body.asset.id} — ${body.asset.name}`);
            setUploadName("");
            await loadAssets();
            await load(`/api/cache-kinds`).then((kindsBody) => kindsBody?.kinds && setKinds(kindsBody.kinds.filter((entry: CacheKind) => entry.usable !== false)));
        } catch (failure) {
            setError(String((failure as Error).message ?? failure));
        }
    }, [assetKind, authoring, load, loadAssets, uploadName]);

    const rename = useCallback(async (asset: AssetRow, name: string) => {
        if (!authoring) { setError("Renaming needs the local authoring service"); return; }
        const response = await fetch(`${authoring}/assets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rename: true, kind: asset.kind, id: asset.id, name }),
        });
        if (!response.ok) { setError((await response.json())?.error ?? "rename failed"); return; }
        await loadAssets();
    }, [authoring, loadAssets]);

    const runSearch = useCallback(async (needle = text, within = kind) => {
        if (!needle.trim()) return;
        if (!contentBase) { setError("Waiting for the client to connect before searching"); return; }
        setError(null);
        const body = await load(`/api/cache-search?${new URLSearchParams({ text: needle, kind: within, limit: "20" })}`);
        if (body?.hits) setHits(body.hits);
    }, [contentBase, kind, load, text]);

    const loadUsedBy = useCallback(async () => {
        if (!shown) return;
        const body = await load(`/api/cache-used-by?${new URLSearchParams({ kind: shown.kind, id: String(shown.id) })}`);
        if (body) setUsed(body);
    }, [load, shown]);

    /** Next free overlay id for a kind, read from the authoring document when it is reachable. */
    const nextId = useCallback(async (forKind: string) => {
        const total = kinds.find((entry) => entry.kind === forKind)?.count ?? 0;
        let next = Math.max(50000, total);
        if (!authoring) return next;
        try {
            const document = await fetch(`${authoring}/definitions`).then((response) => response.json());
            for (const row of document?.rows ?? []) {
                if (row.kind === forKind && Number.isInteger(row.id)) next = Math.max(next, row.id + 1);
            }
        } catch {
            // No authoring service: the id is still unique against the cache.
        }
        return next;
    }, [authoring, kinds]);

    const openCreate = useCallback(async (withBase: CacheDefinition | null) => {
        const forKind = withBase?.kind ?? kind;
        setError(null);
        setCreating({ kind: forKind, name: withBase ? `${withBase.name ?? "element"} (copy)` : "", id: await nextId(forKind), base: withBase });
    }, [kind, nextId]);

    const create = useCallback(async () => {
        if (!creating) return;
        if (!Number.isInteger(creating.id) || creating.id < 0) { setError("Give a numeric id"); return; }
        const fields = await load(fieldsPath(creating.kind, true));
        setEditableFields((fields?.fields ?? []) as CacheField[]);
        setEditing({
            kind: creating.kind,
            id: creating.id,
            baseId: creating.base?.id ?? -1,
            base: creating.base,
            name: creating.name,
            overrides: {},
        });
        setDefinition(null);
        setCreating(null);
        setTab("values");
        setStatus(`editing new ${creating.kind} ${creating.id}${creating.base ? ` based on ${creating.base.id}` : ""}`);
    }, [creating, load]);

    const setValue = useCallback((field: string, value: unknown) => {
        setEditing((current) => {
            if (!current) return current;
            const overrides = { ...current.overrides };
            if (value === undefined || value === "") delete overrides[field];
            else overrides[field] = value;
            return { ...current, overrides };
        });
    }, []);

    const save = useCallback(async () => {
        if (!editing) return;
        if (!authoring) { setError("Saving needs the local authoring service; start the server with CACHE_EDITOR_ENABLED=1"); return; }
        const row = { kind: editing.kind, id: editing.id, baseId: editing.baseId >= 0 ? editing.baseId : 0, fields: editing.overrides };
        if (editing.baseId < 0) { setError("Pick a starting definition; an overlay row needs one to override"); return; }
        const problems = draftProblems(row, editing.base ?? { kind: editing.kind, id: editing.id, exists: true, name: "", label: "" }, 0);
        if (problems.length) { setError(problems.join("; ")); return; }
        try {
            const current = await fetch(`${authoring}/definitions`).then((response) => response.json());
            const response = await fetch(`${authoring}/definitions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ row, revision: current?.revision }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body?.error ?? `save failed: ${response.status}`);
            setEditing({ ...editing, revision: body?.revision });
            setStatus(`saved ${row.kind} ${row.id} — restart the server to apply it`);
            setError(null);
        } catch (failure) {
            setError(String((failure as Error).message ?? failure));
        }
    }, [authoring, editing]);

    const grouped = useMemo(() => linksByField(shown?.links), [shown]);
    const spec = useMemo(() => shown ? previewSpec(shown, shown.kind, frame) : null, [shown, frame]);
    const frames = useMemo(() => sequenceFrameCount(client as OsrsClient, spec?.sequenceId), [client, spec?.sequenceId]);

    useEffect(() => {
        if (tab !== "preview" || !canvasRef.current) return;
        if (!client) { setPreviewError("No client attached, so the model renderer is unavailable"); return; }
        if (!clientReady) { setPreviewError("Waiting for the cache to load…"); return; }
        rendererRef.current ??= createPreviewRenderer(client);
        if (shown?.kind === "loc") {
            const available = rendererRef.current.locShapes(shown.id);
            setShapes(available);
            if (available.length && !available.some((entry) => entry.type === shape)) setShape(available[0].type);
        } else setShapes([]);
        setPreviewError(rendererRef.current.draw(canvasRef.current, {
            kind: shown?.kind ?? "", id: shown?.id ?? 0, spec, shape, rotation,
            yaw: view.yaw, pitch: view.pitch, zoom: view.zoom,
        }));
    }, [client, clientReady, rotation, shape, shown, spec, tab, view]);

    useEffect(() => {
        if (tab !== "preview" || frames <= 1) return;
        const timer = window.setInterval(() => setFrame((current) => (current + 1) % frames), 120);
        return () => window.clearInterval(timer);
    }, [frames, tab]);

    /** One editable row of the values table. */
    const renderValueCell = (field: CacheField) => {
        if (!editing) return label(shown?.values?.[field.name] ?? "");
        const value = editing.overrides[field.name] ?? editing.base?.values?.[field.name];
        const changed = field.name in editing.overrides;
        if (cell?.field === field.name) {
            return (
                <span style={{ display: "flex", gap: 4 }}>
                    <input
                        autoFocus
                        style={{ ...styles.input, flex: 1 }}
                        value={cell.text}
                        onChange={(event) => setCell({ field: field.name, text: event.target.value })}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") setCell(null);
                            if (event.key === "Enter") { setValue(field.name, parseValue(field, cell.text)); setCell(null); }
                        }}
                    />
                    <button style={styles.input} onClick={() => { setValue(field.name, parseValue(field, cell.text)); setCell(null); }}>ok</button>
                    <button style={styles.input} onClick={() => setCell(null)}>×</button>
                </span>
            );
        }
        return (
            <span
                style={{ cursor: "text", borderBottom: "1px dotted #3a4150", color: changed ? "#8fd18f" : undefined }}
                title={field.note ?? `click to edit ${field.name}`}
                onClick={() => setCell({ field: field.name, text: value === undefined ? "" : Array.isArray(value) ? value.join(", ") : String(value) })}
            >
                {value === undefined ? <em style={{ color: "#5d6675" }}>unset</em> : label(value)}
            </span>
        );
    };

    return (
        <div style={styles.page}>
            <div style={styles.side}>
                <div style={styles.bar}>
                    <button style={styles.tab(mode === "definitions")} onClick={() => setMode("definitions")}>definitions</button>
                    <button style={styles.tab(mode === "assets")} onClick={() => { setMode("assets"); void loadAssets(); }}>assets</button>
                </div>
                {mode === "assets" ? (
                    <>
                        <div style={styles.bar}>
                            <select style={{ ...styles.input, flex: 1 }} value={assetKind} onChange={(event) => { const next = event.target.value as AssetKind; setAssetKind(next); void loadAssets(next); }}>
                                <option value="model">models (index 7)</option>
                                <option value="sprite">sprites (index 8)</option>
                                <option value="texture">textures (index 9)</option>
                            </select>
                            {assets ? <span style={{ color: "#7f8899" }}>{assets.total}</span> : null}
                        </div>
                        <div style={styles.bar}>
                            <input
                                style={{ ...styles.input, flex: 1 }}
                                placeholder="name for the upload (e.g. my_loc.dat)"
                                value={uploadName}
                                onChange={(event) => setUploadName(event.target.value)}
                            />
                            <button style={styles.input} onClick={() => fileRef.current?.click()}>upload…</button>
                            <input
                                ref={fileRef}
                                type="file"
                                style={{ display: "none" }}
                                onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }}
                            />
                        </div>
                        <div style={styles.list}>
                            {(assets?.mine ?? []).map((asset) => (
                                <div key={`${asset.kind}:${asset.id}`} style={styles.row(false)}>
                                    <div>
                                        <span style={{ color: "#8fd18f" }}>mine</span> {asset.kind} {asset.id} <strong>{asset.name}</strong>
                                    </div>
                                    <div style={{ color: "#5d6675", fontSize: 11 }}>
                                        {asset.size} B · {asset.hash.slice(0, 8)}
                                        <button style={{ ...styles.input, marginLeft: 6, padding: "0 4px" }} onClick={() => {
                                            const next = window.prompt("Rename asset", asset.name);
                                            if (next) void rename(asset, next);
                                        }}>rename</button>
                                    </div>
                                </div>
                            ))}
                            {(assets?.cache ?? []).map((id) => (
                                <div key={id} style={styles.row(false)}>
                                    <span style={{ color: "#7f8899" }}>{assetKind}</span> {id} <span style={{ color: "#3f4653" }}>cache</span>
                                </div>
                            ))}
                            {assets && assets.total > assets.offset + assets.limit ? (
                                <div style={{ padding: 8 }}>
                                    <button style={styles.input} onClick={() => void loadAssets(assetKind, assets.offset + assets.limit)}>next {assets.limit}</button>
                                </div>
                            ) : null}
                        </div>
                    </>
                ) : null}
                {mode === "definitions" ? (
                    <>
                        <div style={styles.bar}>
                            <button style={{ ...styles.input, color: "#8fd18f" }} onClick={() => void openCreate(shown?.exists && !editing ? shown : null)}>+ New</button>
                            <select style={{ ...styles.input, flex: 1 }} value={kind} onChange={(event) => { setKind(event.target.value); setHits([]); }}>
                                {kinds.map((entry) => (
                                    <option key={entry.kind} value={entry.kind}>
                                        {entry.label} {entry.count ? `(${entry.count})` : entry.decoded ? "" : "(names only)"}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div style={styles.bar}>
                            <input
                                style={{ ...styles.input, flex: 1 }}
                                placeholder="name or id, e.g. crate"
                                value={text}
                                onChange={(event) => setText(event.target.value)}
                                onKeyDown={(event) => { if (event.key === "Enter") void runSearch(); }}
                            />
                            <button style={styles.input} onClick={() => void runSearch()}>Find</button>
                        </div>
                    </>
                ) : null}
                {mode === "definitions" ? <div style={styles.list}>
                    {hits.map((hit) => (
                        <div key={`${hit.kind}:${hit.id}`} style={styles.row(shown?.kind === hit.kind && shown?.id === hit.id)} onClick={() => void inspect(hit.kind, hit.id)}>
                            <span style={{ color: "#7f8899" }}>{hit.kind}</span> {hit.id} {hit.name ?? <em style={{ color: "#7f8899" }}>unnamed</em>}
                        </div>
                    ))}
                    {hits.length === 0 ? <div style={{ padding: 8, color: "#7f8899" }}>Search a kind, or press Find with the current kind to list matches.</div> : null}
                </div> : null}
            </div>

            <div style={styles.main}>
                <div style={styles.bar}>
                    <button style={styles.input} onClick={() => { const previous = history.at(-1); if (previous) { setHistory((entries) => entries.slice(0, -1)); void inspect(previous.kind, previous.id, false); } }}>←</button>
                    <strong>{shown ? `${shown.kind} ${shown.id}` : "nothing selected"}</strong>
                    <span style={{ color: "#9aa3b2" }}>{shown?.name ?? (shown ? "unnamed" : "")}</span>
                    {editing ? <span style={{ color: "#8fd18f" }}>{editing.baseId >= 0 ? `new, based on ${editing.baseId}` : "new"}</span> : null}
                    {!contentBase ? <span style={{ color: "#c9b06a" }}>waiting for the client to connect…</span> : null}
                    {error ? <span style={{ color: "#e08a8a" }}>{error}</span> : null}
                </div>

                {creating ? (
                    <div style={{ ...styles.body, flex: "none" }}>
                        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "140px 1fr", alignItems: "center", maxWidth: 620 }}>
                            <span>type</span>
                            <select style={styles.input} value={creating.kind} onChange={(event) => {
                                const nextKind = event.target.value;
                                setCreating({ ...creating, kind: nextKind, base: null });
                            }}>
                                {kinds.filter((entry) => entry.decoded).map((entry) => <option key={entry.kind} value={entry.kind}>{entry.label}</option>)}
                            </select>
                            <span>starts from</span>
                            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <span style={{ color: creating.base ? "#8fd18f" : "#7f8899" }}>
                                    {creating.base ? `${creating.base.kind} ${creating.base.id} ${creating.base.name ?? ""}` : "nothing (blank)"}
                                </span>
                                {creating.base ? <button style={styles.input} onClick={() => setCreating({ ...creating, base: null })}>clear</button> : null}
                                <span style={{ color: "#5d6675" }}>choose one in the browser, then press + New again</span>
                            </span>
                            <span>name</span>
                            <input style={styles.input} value={creating.name} placeholder="e.g. Custom trapdoor" onChange={(event) => setCreating({ ...creating, name: event.target.value })} />
                            <span>id</span>
                            <input style={styles.input} value={creating.id} onChange={(event) => setCreating({ ...creating, id: Number(event.target.value) })} />
                        </div>
                        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                            <button style={styles.input} onClick={() => void create()}>Create</button>
                            <button style={styles.input} onClick={() => setCreating(null)}>Cancel</button>
                        </div>
                    </div>
                ) : null}

                <div style={styles.tabs}>
                    {(["values", "preview", "links", "used", "transforms"] as Tab[]).map((entry) => (
                        <div key={entry} style={styles.tab(tab === entry)} onClick={() => { setTab(entry); if (entry === "used") void loadUsedBy(); }}>
                            {entry === "used" ? "used by" : entry}
                        </div>
                    ))}
                </div>

                <div style={styles.body}>
                    {!shown && !creating ? <p style={{ color: "#7f8899" }}>Pick something on the left, or press + New. Links are clickable: every reference is another entry.</p> : null}

                    {shown && tab === "values" ? (
                        <table style={styles.table}>
                            <tbody>
                                {(editing ? editableFields : Object.keys(shown.values ?? {}).map((name) => ({ name, type: "" } as CacheField))).map((field) => (
                                    <tr key={field.name}>
                                        <td style={{ ...styles.cell, color: "#9aa3b2", width: 220 }}>
                                            {field.name}
                                            {field.ref ? <span style={{ color: "#5d6675" }}> → {field.ref}</span> : null}
                                        </td>
                                        <td style={styles.cell}>
                                            {editing ? renderValueCell(field) : label(shown.values?.[field.name] ?? "")}
                                            {field.note ? <div style={{ color: "#5d6675" }}>{field.note}</div> : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : null}

                    {shown && tab === "preview" ? (
                        <div>
                            {previewError ? <p style={{ color: "#c9b06a" }}>{previewError}</p> : null}
                            <canvas
                                ref={canvasRef}
                                width={320}
                                height={320}
                                style={{ width: 320, height: 320, background: "#0b0d11", border: "1px solid #262a33", cursor: "grab", touchAction: "none" }}
                                onPointerDown={(event) => { dragRef.current = { x: event.clientX, y: event.clientY, yaw: view.yaw, pitch: view.pitch }; event.currentTarget.setPointerCapture(event.pointerId); }}
                                onPointerMove={(event) => {
                                    const drag = dragRef.current;
                                    if (!drag) return;
                                    setView((current) => ({
                                        ...current,
                                        yaw: drag.yaw + (event.clientX - drag.x) * 0.6,
                                        pitch: Math.max(-80, Math.min(80, drag.pitch + (event.clientY - drag.y) * 0.6)),
                                    }));
                                }}
                                onPointerUp={(event) => { dragRef.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId); }}
                                onPointerCancel={() => { dragRef.current = null; }}
                                onWheel={(event) => {
                                    event.preventDefault();
                                    const factor = event.deltaY > 0 ? 0.9 : 1.1;
                                    setView((current) => ({ ...current, zoom: Math.max(0.25, Math.min(6, current.zoom * factor)) }));
                                }}
                                onDoubleClick={() => setView({ yaw: 0, pitch: 0, zoom: 1 })}
                            />
                            {shown.kind === "loc" && shapes.length > 0 ? (
                                <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
                                    <select style={styles.input} value={shape} onChange={(event) => setShape(Number(event.target.value) as LocModelType)}>
                                        {shapes.map((entry) => <option key={entry.type} value={entry.type}>{entry.label}</option>)}
                                    </select>
                                    <button style={styles.input} onClick={() => setRotation((current) => (current + 3) % 4)}>⟲</button>
                                    <button style={styles.input} onClick={() => setRotation((current) => (current + 1) % 4)}>⟳</button>
                                    <span style={{ color: "#7f8899" }}>{rotation * 90}°</span>
                                </div>
                            ) : null}
                            <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", color: "#7f8899" }}>
                                <span>drag to orbit · wheel to zoom · double-click to reset</span>
                                <button style={styles.input} onClick={() => setView({ yaw: 0, pitch: 0, zoom: 1 })}>reset view</button>
                                <span>{Math.round(view.yaw)}° / {Math.round(view.pitch)}° · {view.zoom.toFixed(2)}×</span>
                            </div>
                            <div style={{ marginTop: 8, color: "#9aa3b2" }}>
                                {spec ? <>models {spec.modelIds.join(", ")}{spec.sequenceId !== undefined ? ` · sequence ${spec.sequenceId}${frames > 1 ? ` (${frames} frames)` : ""}` : ""}</> : "Nothing to draw for this kind."}
                            </div>
                        </div>
                    ) : null}

                    {shown && tab === "links" ? (
                        <table style={styles.table}>
                            <tbody>
                                {grouped.map((group) => (
                                    <tr key={group.field}>
                                        <td style={{ ...styles.cell, color: "#9aa3b2", width: 220 }}>{group.field}</td>
                                        <td style={styles.cell}>
                                            {group.entries.map((entry: CacheLink) => (
                                                <div key={`${entry.kind}:${entry.id}`}>
                                                    <a style={{ ...styles.tone(entry.exists), cursor: "pointer" }} onClick={() => void inspect(entry.kind, entry.id)}>
                                                        {entry.kind} {entry.id}
                                                    </a>{" "}
                                                    <span style={{ color: "#9aa3b2" }}>{labelRef(entry.kind, entry.id, entry.name) === `${entry.kind} ${entry.id}` ? "" : entry.name ?? ""}</span>{" "}
                                                    <span style={styles.tone(entry.exists)}>{entry.exists}</span>
                                                    {entry.note ? <div style={{ color: "#6f7788" }}>{entry.note}</div> : null}
                                                </div>
                                            ))}
                                        </td>
                                    </tr>
                                ))}
                                {grouped.length === 0 ? <tr><td style={styles.cell} colSpan={2}>No references.</td></tr> : null}
                            </tbody>
                        </table>
                    ) : null}

                    {shown && tab === "used" ? (
                        used ? (
                            <div>
                                <p style={{ color: "#9aa3b2" }}>{used.count} references</p>
                                {used.sources.map((entry) => (
                                    <div key={`${entry.kind}:${entry.id}:${entry.field}`} style={styles.row(false)} onClick={() => void inspect(entry.kind, entry.id)}>
                                        <span style={{ color: "#7f8899" }}>{entry.kind}</span> {entry.id} {entry.name ?? ""} <span style={{ color: "#6f7788" }}>via {entry.field}</span>
                                    </div>
                                ))}
                            </div>
                        ) : <p style={{ color: "#7f8899" }}>Reading the reverse index…</p>
                    ) : null}

                    {shown && tab === "transforms" ? (
                        shown.transforms ? (
                            <div>
                                <p>{shown.transforms.note}</p>
                                {shown.transforms.gatedBy ? (
                                    <p>
                                        gated by{" "}
                                        <a style={{ cursor: "pointer", color: "#8ab4f8" }} onClick={() => void inspect(shown.transforms!.gatedBy!.kind, shown.transforms!.gatedBy!.id)}>
                                            {shown.transforms.gatedBy.kind} {shown.transforms.gatedBy.id}
                                        </a>{" "}
                                        {shown.transforms.gatedBy.name ?? ""}
                                    </p>
                                ) : null}
                                <table style={styles.table}>
                                    <tbody>
                                        {shown.transforms.children.map((child) => (
                                            <tr key={child.id}>
                                                <td style={styles.cell}>
                                                    <a style={{ cursor: "pointer", color: "#8ab4f8" }} onClick={() => void inspect(shown.kind, child.id)}>{child.id}</a>
                                                </td>
                                                <td style={styles.cell}>{child.name ?? ""}</td>
                                                <td style={styles.cell}>{child.fallback ? "fallback" : ""}</td>
                                                <td style={styles.cell}>{child.exists}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : <p style={{ color: "#7f8899" }}>This definition is not a multi-def.</p>
                    ) : null}
                </div>

                <div style={styles.footer}>
                    <span style={{ color: "#9aa3b2" }}>{status}</span>
                    {editing ? (
                        <>
                            <code>{JSON.stringify({ kind: editing.kind, id: editing.id, baseId: editing.baseId, fields: editing.overrides })}</code>
                            <button style={styles.input} onClick={() => void save()}>Save</button>
                            <button style={styles.input} onClick={() => { setEditing(null); setCell(null); setStatus("discarded"); }}>Discard</button>
                            <span style={{ color: "#7f8899" }}>{Object.keys(editing.overrides).length} overridden</span>
                        </>
                    ) : null}
                    <span style={{ flex: 1 }} />
                    {shown && !editing ? (
                        <button style={{ ...styles.input, color: "#8fd18f" }} onClick={() => void openCreate(shown.exists ? shown : null)}>+ New based on this</button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
