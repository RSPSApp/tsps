import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchContent, getContentApiBase } from "../../network/serverConnection/contentApi";
import type { OsrsClient } from "../../game/OsrsClient";
import { createPreviewRenderer, previewSpec, sequenceFrameCount, type PreviewRenderer } from "./CacheEditorPreview";
import { LocModelType } from "../../rs/config/loctype/LocModelType";
import "./CacheEditor.css";
import {
    type AssetKind, type AssetListing, type AssetRow,
    type CacheDefinition, type CacheField, type CacheKind, type CacheLink,
    formatFieldValue, parseFieldValue, initialOverrides, assetsPath, authoringBase, draftProblems, fieldsPath, inspectPath, kindsPath, labelRef, linksByField, searchPath,
    hexToPackedHsl, packedHslToHex, supportsModelRecolor,
} from "./CacheEditorModel";

/**
 * The cache editor page, opened at `?cache=1`.
 *
 * Reads go through the world's content API; writes go only to the loopback authoring service.
 * A cache element can be inspected as it is, or a **new** element can be created from a definition
 * type and an optional matching base, then edited cell by cell and saved as an overlay row.
 */

type Tab = "values" | "recolors" | "preview" | "links" | "used" | "transforms";
type CacheSearchHit = { kind: string; id: number; name: string | null; custom?: boolean };

type Editing = {
    kind: string;
    id: number;
    baseId: number | null;
    base: CacheDefinition | null;
    name: string;
    /** Only what differs from the base; an empty map means "identical to the base". */
    overrides: Record<string, unknown>;
    revision?: string;
};

const styles = {
    page: { position: "fixed", inset: 0, zIndex: 4000, background: "#16171a", color: "#e4dfd3", display: "grid", gridTemplateColumns: "minmax(260px, 300px) minmax(0, 1fr)", gridTemplateRows: "60px minmax(0, 1fr)", font: '14px/1.45 "IBM Plex Sans", "Segoe UI", sans-serif' } as const,
    side: { background: "#121315", borderRight: "1px solid #caa95e29", display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 } as const,
    main: { background: "#17181b", display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 } as const,
    bar: { display: "flex", gap: 8, alignItems: "center", padding: 12, borderBottom: "1px solid #caa95e24", flexWrap: "wrap" as const } as const,
    input: { background: "#1c1d21", color: "#eee9dd", border: "1px solid #caa95e42", borderRadius: 5, padding: "0 10px", minHeight: 36, minWidth: 0 } as const,
    list: { overflowY: "auto", flex: 1, minHeight: 0 } as const,
    row: (active: boolean) => ({ padding: "9px 12px", cursor: "pointer", background: active ? "#292820" : "transparent", borderBottom: "1px solid #caa95e18" }) as const,
    tabs: { display: "flex", gap: 6, padding: "10px 14px", borderBottom: "1px solid #caa95e29", flexWrap: "wrap" as const } as const,
    tab: (active: boolean) => ({ padding: "7px 12px", cursor: "pointer", background: active ? "#302b20" : "#1c1d21", color: active ? "#e4dfd3" : "#999589", border: `1px solid ${active ? "#caa95e80" : "#caa95e29"}`, borderRadius: 5 }) as const,
    body: { overflowY: "auto", flex: 1, minHeight: 0, padding: 18 } as const,
    table: { borderCollapse: "collapse" as const, width: "100%" },
    cell: { borderBottom: "1px solid #caa95e24", padding: "9px 10px", verticalAlign: "top" as const },
    tone: (state: string) => ({ color: state === "known" ? "#caa95e" : state === "missing" ? "#e08a8a" : "#999589" }) as const,
    footer: { borderTop: "1px solid #caa95e29", background: "#121315", padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const } as const,
};

const label = (value: unknown) => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));

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
    const [hits, setHits] = useState<CacheSearchHit[]>([]);
    const searchGeneration = useRef(0);
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
    const [creating, setCreating] = useState<{ kind: string; name: string; id: number; revision?: string; base: CacheDefinition | null } | null>(null);
    const [createIdPending, setCreateIdPending] = useState(false);
    const [baseText, setBaseText] = useState("");
    const [baseHits, setBaseHits] = useState<CacheSearchHit[]>([]);
    const [baseError, setBaseError] = useState<string | null>(null);
    const [baseSearching, setBaseSearching] = useState(false);
    const [baseSearchComplete, setBaseSearchComplete] = useState(false);
    const baseSearchGeneration = useRef(0);
    const createKindGeneration = useRef(0);
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

    const load = useCallback(async (path: string, isCurrent: () => boolean = () => true) => {
        try {
            const body = await fetchContent(path);
            if (body?.error) throw new Error(body.error);
            return body;
        } catch (failure) {
            if (isCurrent()) setError(String((failure as Error).message ?? failure));
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
        if (assetKind !== "model") { setError("Only model uploads are supported; sprites and textures can be browsed"); return; }
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
        const generation = ++searchGeneration.current;
        const isCurrent = () => generation === searchGeneration.current;
        setError(null);
        const body = await load(`/api/cache-search?${new URLSearchParams({ text: needle, kind: within, limit: "20" })}`, isCurrent);
        if (isCurrent() && body?.hits) setHits(body.hits);
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
        if (!authoring) return { id: next };
        let revision: string | undefined;
        try {
            const response = await fetch(`${authoring}/definitions`);
            if (!response.ok) throw new Error(`Could not read authoring document: ${response.status}`);
            const document = await response.json();
            revision = document?.revision;
            for (const row of document?.rows ?? []) {
                if (row.kind === forKind && Number.isInteger(row.id)) next = Math.max(next, row.id + 1);
            }
        } catch {
            // No authoring service: the id is still unique against the cache.
        }
        return { id: next, revision };
    }, [authoring, kinds]);

    const changeCreatingKind = useCallback((nextKind: string) => {
        if (!creating || creating.kind === nextKind) return;
        const generation = ++createKindGeneration.current;
        const fallbackId = Math.max(50000, kinds.find((entry) => entry.kind === nextKind)?.count ?? 0);
        baseSearchGeneration.current++;
        setBaseText("");
        setBaseHits([]);
        setBaseError(null);
        setBaseSearching(false);
        setBaseSearchComplete(false);
        setCreateIdPending(true);
        setCreating((current) => {
            if (!current) return current;
            const generatedName = current.base ? `${current.base.name ?? "element"} (copy)` : "";
            return {
                ...current,
                kind: nextKind,
                id: fallbackId,
                revision: undefined,
                base: null,
                name: current.name === generatedName ? "" : current.name,
            };
        });
        void nextId(nextKind).then((next) => {
            if (generation !== createKindGeneration.current) return;
            setCreating((current) => current?.kind === nextKind ? { ...current, ...next, kind: nextKind } : current);
            setCreateIdPending(false);
        });
    }, [creating, kinds, nextId]);

    const searchBase = useCallback(async (needle = baseText) => {
        if (!creating) return;
        if (!needle.trim()) {
            baseSearchGeneration.current++;
            setBaseSearching(false);
            setBaseError("Enter a gameval name or ID to search.");
            setBaseHits([]);
            setBaseSearchComplete(false);
            return;
        }
        const generation = ++baseSearchGeneration.current;
        const searchKind = creating.kind;
        setBaseSearching(true);
        setBaseSearchComplete(false);
        setBaseError(null);
        try {
            const body = await fetchContent(searchPath(needle, searchKind));
            if (body?.error) throw new Error(body.error);
            if (generation !== baseSearchGeneration.current) return;
            const matchingHits = Array.isArray(body?.hits) ? body.hits.filter((hit: CacheSearchHit) => hit.kind === searchKind) : [];
            setBaseHits(matchingHits);
            setBaseSearchComplete(true);
        } catch (failure) {
            if (generation === baseSearchGeneration.current) {
                setBaseError(String((failure as Error).message ?? failure));
                setBaseHits([]);
            }
        } finally {
            if (generation === baseSearchGeneration.current) setBaseSearching(false);
        }
    }, [baseText, creating]);

    const selectBase = useCallback(async (hit: CacheSearchHit) => {
        const expectedKind = creating?.kind;
        if (!expectedKind) return;
        if (hit.kind !== expectedKind) {
            setBaseError("Choose a base definition with the selected type.");
            setBaseHits([]);
            return;
        }
        const generation = ++baseSearchGeneration.current;
        setBaseSearching(true);
        setBaseError(null);
        try {
            const body = await fetchContent(inspectPath(expectedKind, hit.id));
            if (body?.error) throw new Error(body.error);
            if (!body?.exists) throw new Error(`${expectedKind} ${hit.id} is not present in the cache`);
            if (body?.kind !== expectedKind) throw new Error("The selected definition type changed; search again.");
            if (generation !== baseSearchGeneration.current) return;
            const base = body as CacheDefinition;
            setCreating((current) => current?.kind === expectedKind ? {
                ...current,
                base,
                name: current.name || `${base.name ?? "element"} (copy)`,
            } : current);
            setBaseHits([]);
            setBaseSearchComplete(false);
        } catch (failure) {
            if (generation === baseSearchGeneration.current) setBaseError(String((failure as Error).message ?? failure));
        } finally {
            if (generation === baseSearchGeneration.current) setBaseSearching(false);
        }
    }, [creating]);

    const cancelCreate = useCallback(() => {
        createKindGeneration.current++;
        baseSearchGeneration.current++;
        setCreating(null);
        setCreateIdPending(false);
        setBaseHits([]);
        setBaseError(null);
        setBaseSearching(false);
        setError(null);
        setStatus("ready");
    }, []);

    const openCreate = useCallback((withBase: CacheDefinition | null) => {
        const forKind = withBase?.kind ?? kind;
        const generation = ++createKindGeneration.current;
        const fallbackId = Math.max(50000, kinds.find((entry) => entry.kind === forKind)?.count ?? 0);
        baseSearchGeneration.current++;
        setBaseText("");
        setBaseHits([]);
        setBaseError(null);
        setBaseSearching(false);
        setBaseSearchComplete(false);
        setCreateIdPending(true);
        setError(null);
        setStatus("ready");
        setCreating({
            kind: forKind,
            name: withBase ? `${withBase.name ?? "element"} (copy)` : "",
            id: fallbackId,
            base: withBase,
        });
        void nextId(forKind).then((next) => {
            if (generation !== createKindGeneration.current) return;
            setCreating((current) => current ? { ...current, ...next, kind: forKind } : current);
            setCreateIdPending(false);
        });
    }, [kind, kinds, nextId]);

    const create = useCallback(async () => {
        if (!creating) return;
        if (createIdPending || baseSearching) { setBaseError("Wait for the current lookup to finish."); return; }
        if (!Number.isInteger(creating.id) || creating.id < 0) { setError("Give a numeric id"); return; }
        const fields = await load(fieldsPath(creating.kind, true));
        setEditableFields((fields?.fields ?? []) as CacheField[]);
        setEditing({
            kind: creating.kind,
            id: creating.id,
            baseId: creating.base?.id ?? null,
            revision: creating.revision,
            base: creating.base,
            name: creating.name,
            overrides: initialOverrides((fields?.fields ?? []) as CacheField[], creating.name),
        });
        setDefinition(null);
        setCreating(null);
        setTab("values");
        setStatus(`editing new ${creating.kind} ${creating.id}${creating.base ? ` based on ${creating.base.id}` : " from blank defaults"}`);
    }, [baseSearching, createIdPending, creating, load]);

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
        const row = { kind: editing.kind, id: editing.id, baseId: editing.baseId, fields: editing.overrides };
        if (editing.baseId !== null && !Number.isInteger(editing.baseId)) { setError("The selected base definition is invalid"); return; }
        const problems = draftProblems(row, editing.base, 0);
        if (problems.length) { setError(problems.join("; ")); return; }
        try {
            if (!editing.revision) throw new Error("Reopen this draft after connecting to the local authoring service");
            const response = await fetch(`${authoring}/definitions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ row, revision: editing.revision }),
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
    const rawRecolorFrom = editing?.overrides.recolorFrom ?? editing?.base?.values?.recolorFrom;
    const rawRecolorTo = editing?.overrides.recolorTo ?? editing?.base?.values?.recolorTo;
    const recolorFrom = Array.isArray(rawRecolorFrom) ? rawRecolorFrom.map((value) => Number(value) || 0) : [];
    const recolorTo = Array.isArray(rawRecolorTo) ? rawRecolorTo.map((value) => Number(value) || 0) : [];
    const recolorCount = Math.max(recolorFrom.length, recolorTo.length);
    const detailTabs: Tab[] = editing && supportsModelRecolor(editing.kind)
        ? ["values", "recolors", "preview", "links", "used", "transforms"]
        : ["values", "preview", "links", "used", "transforms"];
    const updateRecolorPair = (index: number, side: "from" | "to", value: number) => {
        if (!Number.isInteger(value) || value < 0 || value > 65535) { setError("Packed HSL colors must be whole numbers from 0 to 65535"); return; }
        const count = Math.max(recolorCount, index + 1);
        const nextFrom = Array.from({ length: count }, (_, entry) => recolorFrom[entry] ?? 0);
        const nextTo = Array.from({ length: count }, (_, entry) => recolorTo[entry] ?? 0);
        if (side === "from") nextFrom[index] = value;
        else nextTo[index] = value;
        setValue("recolorFrom", nextFrom);
        setValue("recolorTo", nextTo);
        setError(null);
    };
    const addRecolorPair = () => {
        setValue("recolorFrom", [...Array.from({ length: recolorCount }, (_, index) => recolorFrom[index] ?? 0), 0]);
        setValue("recolorTo", [...Array.from({ length: recolorCount }, (_, index) => recolorTo[index] ?? 0), 0]);
        setError(null);
    };
    const removeRecolorPair = (index: number) => {
        setValue("recolorFrom", Array.from({ length: recolorCount }, (_, entry) => recolorFrom[entry] ?? 0).filter((_, entry) => entry !== index));
        setValue("recolorTo", Array.from({ length: recolorCount }, (_, entry) => recolorTo[entry] ?? 0).filter((_, entry) => entry !== index));
        setError(null);
    };
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
    const commitCell = (field: CacheField, text: string) => {
        try { setValue(field.name, parseFieldValue(field, text)); setCell(null); setError(null); }
        catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    };
    const renderValueCell = (field: CacheField) => {
        if (!editing) return label(shown?.values?.[field.name] ?? "");
        const value = editing.overrides[field.name] ?? editing.base?.values?.[field.name];
        const changed = field.name in editing.overrides;
        if (cell?.field === field.name) {
            return (
                <span className="cache-editor-cell-editing">
                    <input
                        autoFocus
                        style={{ ...styles.input, flex: 1 }}
                        aria-label={`Edit ${field.name}`}
                        value={cell.text}
                        onChange={(event) => setCell({ field: field.name, text: event.target.value })}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") setCell(null);
                            if (event.key === "Enter") { commitCell(field, cell.text); }
                        }}
                    />
                    <button type="button" className="cache-editor-secondary-button" style={styles.input} onClick={() => { commitCell(field, cell.text); }}>Apply</button>
                    <button type="button" className="cache-editor-secondary-button" style={styles.input} aria-label="Cancel field edit" onClick={() => setCell(null)}>Cancel</button>
                </span>
            );
        }
        return (
            <button
                type="button"
                className={`cache-editor-editable-value ${changed ? "is-changed" : ""}`}
                title={field.note ?? `Click to edit ${field.name}`}
                aria-label={`Edit ${field.name}`}
                onClick={() => setCell({ field: field.name, text: formatFieldValue(value) })}
            >
                {value === undefined ? <em>Unset</em> : label(value)}
            </button>
        );
    };

    return (
        <div className="cache-editor" style={styles.page}>
            <header className="cache-editor-header">
                <div className="cache-editor-mark" aria-hidden="true">✦</div>
                <div className="cache-editor-brand">
                    <span className="cache-editor-eyebrow">LOCAL TOOLS</span>
                    <strong>Cache editor</strong>
                </div>
                <p className="cache-editor-header-copy">Inspect, preview, and author cache definitions.</p>
                <div className={`cache-editor-connection ${contentBase ? "is-configured" : "is-waiting"}`} aria-live="polite">
                    <span className="cache-editor-connection-dot" />
                    {contentBase ? "Client endpoint configured" : "Waiting for client"}
                </div>
            </header>
            <div className="cache-editor-sidebar" style={styles.side}>
                <div className="cache-editor-mode-tabs" role="tablist" aria-label="Cache editor sections" style={styles.bar}>
                    <button type="button" role="tab" aria-selected={mode === "definitions"} style={styles.tab(mode === "definitions")} onClick={() => setMode("definitions")}>Definitions</button>
                    <button type="button" role="tab" aria-selected={mode === "assets"} style={styles.tab(mode === "assets")} onClick={() => { setMode("assets"); void loadAssets(); }}>Assets</button>
                </div>
                {mode === "assets" ? (
                    <>
                        <div className="cache-editor-section-heading">
                            <span className="cache-editor-eyebrow">BROWSE</span>
                            <strong>Cache assets</strong>
                            <span>Models, sprites, and textures in this cache.</span>
                        </div>
                        <div className="cache-editor-control-group">
                            <label htmlFor="cache-editor-asset-kind">Asset type</label>
                            <div className="cache-editor-inline-control">
                                <select id="cache-editor-asset-kind" style={{ ...styles.input, flex: 1 }} value={assetKind} onChange={(event) => { const next = event.target.value as AssetKind; setAssetKind(next); void loadAssets(next); }}>
                                    <option value="model">Models (index 7)</option>
                                    <option value="sprite">Sprites (index 8)</option>
                                    <option value="texture">Textures (index 9)</option>
                                </select>
                                {assets ? <span className="cache-editor-count">{assets.total} items</span> : null}
                            </div>
                        </div>
                        <div className="cache-editor-control-group cache-editor-upload">
                            <label htmlFor="cache-editor-upload-name">Upload a model</label>
                            <div className="cache-editor-inline-control">
                                <input
                                    id="cache-editor-upload-name"
                                    style={{ ...styles.input, flex: 1 }}
                                    placeholder="e.g. my_loc.dat"
                                    value={uploadName}
                                    onChange={(event) => setUploadName(event.target.value)}
                                />
                            </div>
                            <div className="cache-editor-import-actions">
                                <button type="button" className="cache-editor-secondary-button" style={styles.input} disabled={assetKind !== "model"} title={assetKind === "model" ? "Import a local DAT model" : "Only model uploads are supported"} onClick={() => fileRef.current?.click()}>Import local</button>
                                <button type="button" className="cache-editor-library-button" style={styles.input} disabled title="The asset library is not implemented yet.">Import from asset library</button>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    style={{ display: "none" }}
                                    aria-label="Choose a local DAT model"
                                    onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }}
                                />
                            </div>
                            <span className="cache-editor-help">Only DAT model uploads are supported. Asset library import will be available in a future update.</span>
                        </div>
                        <div className="cache-editor-assets-list" style={styles.list}>
                            {(assets?.mine?.length ?? 0) > 0 ? <div className="cache-editor-list-heading">Your uploads <span>{assets!.mine.length}</span></div> : null}
                            {(assets?.mine ?? []).map((asset) => (
                                <div key={`${asset.kind}:${asset.id}`} className="cache-editor-asset-row" style={styles.row(false)}>
                                    <div>
                                        <span className="cache-editor-asset-badge">Uploaded</span> <span className="cache-editor-mono">{asset.kind} {asset.id}</span> <strong>{asset.name}</strong>
                                    </div>
                                    <div className="cache-editor-asset-meta" style={{ color: "#5d6675", fontSize: 11 }}>
                                        {asset.size} B · {asset.hash.slice(0, 8)}
                                        <button type="button" className="cache-editor-rename-button" style={{ ...styles.input, marginLeft: 6, padding: "0 8px" }} onClick={() => {
                                            const next = window.prompt("Rename asset", asset.name);
                                            if (next) void rename(asset, next);
                                        }}>Rename</button>
                                    </div>
                                </div>
                            ))}
                            {(assets?.cache?.length ?? 0) > 0 ? <div className="cache-editor-list-heading">Cache archive <span>{assets!.cache.length}</span></div> : null}
                            {(assets?.cache ?? []).map((id) => (
                                <div key={id} className="cache-editor-asset-row" style={styles.row(false)}>
                                    <span className="cache-editor-mono">{assetKind} {id}</span> <span className="cache-editor-source-badge">Cache</span>
                                </div>
                            ))}
                            {assets && assets.total === 0 ? <div className="cache-editor-empty-list">No assets found for this type.</div> : null}
                            {assets && assets.total > assets.offset + assets.limit ? (
                                <div className="cache-editor-next-page">
                                    <button type="button" className="cache-editor-secondary-button" style={styles.input} onClick={() => void loadAssets(assetKind, assets.offset + assets.limit)}>Load next {assets.limit}</button>
                                </div>
                            ) : null}
                        </div>
                    </>
                ) : null}
                {mode === "definitions" ? (
                    <>
                        <div className="cache-editor-section-heading cache-editor-definitions-heading">
                            <div>
                                <span className="cache-editor-eyebrow">BROWSE</span>
                                <strong>Definitions</strong>
                            </div>
                            <button type="button" className="cache-editor-create-button" style={{ ...styles.input, color: "#caa95e" }} onClick={() => void openCreate(shown?.exists && !editing ? shown : null)}>+ New</button>
                        </div>
                        <div className="cache-editor-control-group">
                            <label htmlFor="cache-editor-kind">Definition type</label>
                            <select id="cache-editor-kind" style={{ ...styles.input, width: "100%" }} value={kind} onChange={(event) => { setKind(event.target.value); setHits([]); }}>
                                {kinds.map((entry) => (
                                    <option key={entry.kind} value={entry.kind}>
                                        {entry.label} {entry.count ? `(${entry.count})` : entry.decoded ? "" : "(names only)"}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="cache-editor-control-group cache-editor-search-group">
                            <label htmlFor="cache-editor-search">Search by name or ID</label>
                            <div className="cache-editor-inline-control">
                                <input
                                    id="cache-editor-search"
                                    style={{ ...styles.input, flex: 1 }}
                                    placeholder="name or id, e.g. crate"
                                    value={text}
                                    onChange={(event) => setText(event.target.value)}
                                    onKeyDown={(event) => { if (event.key === "Enter") void runSearch(); }}
                                />
                                <button type="button" className="cache-editor-secondary-button" style={styles.input} onClick={() => void runSearch()}>Find</button>
                            </div>
                            <span className="cache-editor-help">Search the selected definition type by its name or ID.</span>
                        </div>
                        <div className="cache-editor-list-heading cache-editor-results-heading">Search results <span>{hits.length}</span></div>
                    </>
                ) : null}
                {mode === "definitions" ? <div className="cache-editor-results-list" style={styles.list} aria-label="Definition search results">
                    {hits.map((hit) => (
                        <button type="button" key={`${hit.kind}:${hit.id}`} className={`cache-editor-result ${shown?.kind === hit.kind && shown?.id === hit.id ? "is-selected" : ""}`} style={styles.row(shown?.kind === hit.kind && shown?.id === hit.id)} onClick={() => void inspect(hit.kind, hit.id)}>
                            <span className="cache-editor-result-type">{hit.kind}</span>
                            <span className="cache-editor-result-id">{hit.id}</span>
                            <span className="cache-editor-result-name">{hit.name ?? <em>Unnamed</em>}</span>
                            {hit.custom ? <span className="cache-editor-source-badge">Custom</span> : null}
                        </button>
                    ))}
                    {hits.length === 0 ? <div className="cache-editor-empty-list">Search a definition type to see matching cache entries here.</div> : null}
                </div> : null}
            </div>

            <main className="cache-editor-main" style={styles.main}>
                <div className="cache-editor-detail-header" style={styles.bar}>
                    <button type="button" className="cache-editor-back-button" style={styles.input} aria-label="Go back to the previous definition" title="Go back" disabled={history.length === 0} onClick={() => { const previous = history.at(-1); if (previous) { setHistory((entries) => entries.slice(0, -1)); void inspect(previous.kind, previous.id, false); } }}>←</button>
                    <div className="cache-editor-current-definition">
                        <span className="cache-editor-eyebrow">{shown ? shown.label : "CACHE INSPECTOR"}</span>
                        <strong>{shown?.name ?? (shown ? "Unnamed definition" : "Choose a definition")}</strong>
                        <span className="cache-editor-definition-meta">{shown ? `${shown.kind} · ID ${shown.id}` : "Search the cache or select an entry from the browser."}</span>
                    </div>
                    {editing ? <span className="cache-editor-editing-badge">{editing.baseId !== null ? `Draft · based on ${editing.baseId}` : "New blank draft"}</span> : null}
                    {shown && !editing ? <button type="button" className="cache-editor-create-button" style={{ ...styles.input, color: "#caa95e" }} onClick={() => void openCreate(shown.exists ? shown : null)}>+ New based on this</button> : null}
                </div>
                {error ? <div className="cache-editor-alert" role="alert">{error}</div> : null}
                {status !== "ready" ? <div className="cache-editor-status-message" aria-live="polite">{status}</div> : null}

                {creating ? (
                    <div className="cache-editor-create-backdrop">
                        <section
                            className="cache-editor-create-dialog"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="cache-editor-create-title"
                            onKeyDown={(event) => {
                                if (event.key === "Escape") { event.preventDefault(); cancelCreate(); }
                            }}
                        >
                            <header className="cache-editor-create-dialog-header">
                                <div>
                                    <span className="cache-editor-eyebrow">NEW OVERLAY</span>
                                    <h2 id="cache-editor-create-title">Create a custom definition</h2>
                                    <p>Choose a custom name and ID. Starting from an existing definition is optional.</p>
                                </div>
                                <button type="button" className="cache-editor-create-close" aria-label="Cancel new definition" onClick={cancelCreate}>×</button>
                            </header>
                            <div className="cache-editor-create-scroll">
                                <div className="cache-editor-create-field cache-editor-create-type">
                                    <label htmlFor="cache-editor-create-kind">Definition type</label>
                                    <select id="cache-editor-create-kind" autoFocus style={styles.input} value={creating.kind} onChange={(event) => void changeCreatingKind(event.target.value)}>
                                        {kinds.filter((entry) => entry.decoded).map((entry) => <option key={entry.kind} value={entry.kind}>{entry.label}</option>)}
                                    </select>
                                </div>
                                <section className="cache-editor-base-section" aria-labelledby="cache-editor-base-title">
                                    <div className="cache-editor-base-heading">
                                        <div>
                                            <h3 id="cache-editor-base-title">Based on <span>Optional</span></h3>
                                            <p>Search by gameval name or ID to inherit fields from an existing definition. Leave this blank to start from the selected type’s defaults.</p>
                                        </div>
                                    </div>
                                    <div className="cache-editor-base-search">
                                        <div className="cache-editor-create-field">
                                            <label htmlFor="cache-editor-base-query">Gameval name or ID</label>
                                            <div className="cache-editor-inline-control">
                                                <input
                                                    id="cache-editor-base-query"
                                                    style={{ ...styles.input, flex: 1 }}
                                                    placeholder="e.g. crate or 1"
                                                    value={baseText}
                                                    onChange={(event) => { baseSearchGeneration.current++; setBaseSearching(false); setBaseText(event.target.value); setBaseHits([]); setBaseError(null); setBaseSearchComplete(false); }}
                                                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchBase(); } }}
                                                />
                                                <button type="button" className="cache-editor-secondary-button" style={styles.input} disabled={baseSearching || !baseText.trim()} onClick={() => void searchBase()}>{baseSearching ? "Searching…" : "Find"}</button>
                                            </div>
                                        </div>
                                    </div>
                                    {baseError ? <div className="cache-editor-create-error" role="alert">{baseError}</div> : null}
                                    {creating.base ? (
                                        <div className="cache-editor-selected-base">
                                            <div>
                                                <span className="cache-editor-source-badge">Selected base</span>
                                                <strong>{creating.base.kind} {creating.base.id}</strong>
                                                <span>{creating.base.name ?? "Unnamed definition"}</span>
                                            </div>
                                            <button type="button" className="cache-editor-secondary-button" style={styles.input} onClick={() => { setCreating((current) => current ? { ...current, base: null } : current); setBaseError(null); }}>Clear</button>
                                        </div>
                                    ) : null}
                                    {baseSearching ? <div className="cache-editor-empty-list">Searching cache definitions…</div> : null}
                                    {!baseSearching && baseHits.length > 0 ? (
                                        <div className="cache-editor-base-results" role="group" aria-label="Matching base definitions">
                                            {baseHits.map((hit) => (
                                                <button type="button" key={`${hit.kind}:${hit.id}`} className="cache-editor-base-result" onClick={() => void selectBase(hit)}>
                                                    <span className="cache-editor-result-type">{hit.kind}</span>
                                                    <span className="cache-editor-result-id">{hit.id}</span>
                                                    <span className="cache-editor-result-name">{hit.name ?? "Unnamed definition"}</span>
                                                    <span className="cache-editor-base-result-action">Use this</span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : null}
                                    {!baseSearching && baseSearchComplete && baseHits.length === 0 ? <div className="cache-editor-empty-list">No definitions matched that gameval name or ID.</div> : null}
                                    {!creating.base && !baseSearching && !baseSearchComplete && baseHits.length === 0 ? <p className="cache-editor-base-help">Search for an existing definition to inherit its fields, or leave this empty to create a blank definition.</p> : null}
                                </section>
                                <div className="cache-editor-create-fields">
                                    <div className="cache-editor-create-field">
                                        <label htmlFor="cache-editor-new-name">Name</label>
                                        <input id="cache-editor-new-name" style={styles.input} value={creating.name} placeholder="e.g. Custom trapdoor" onChange={(event) => setCreating((current) => current ? { ...current, name: event.target.value } : current)} />
                                    </div>
                                    <div className="cache-editor-create-field">
                                        <label htmlFor="cache-editor-new-id">Custom ID</label>
                                        <input id="cache-editor-new-id" style={styles.input} type="number" value={creating.id} onChange={(event) => setCreating((current) => current ? { ...current, id: Number(event.target.value) } : current)} />
                                        {createIdPending ? <span className="cache-editor-help">Checking the next available ID…</span> : null}
                                    </div>
                                </div>
                            </div>
                            <footer className="cache-editor-create-actions">
                                <span className="cache-editor-create-footer-help">A base is optional; without one, fields start from the definition type’s defaults.</span>
                                <div>
                                    <button type="button" className="cache-editor-create-button" style={styles.input} disabled={createIdPending || baseSearching} onClick={() => void create()}>Create definition</button>
                                    <button type="button" className="cache-editor-secondary-button" style={styles.input} onClick={cancelCreate}>Cancel</button>
                                </div>
                            </footer>
                        </section>
                    </div>
                ) : null}

                <div className="cache-editor-detail-tabs" role="tablist" aria-label="Definition details" style={styles.tabs}>
                    {detailTabs.map((entry) => (
                        <button type="button" role="tab" aria-selected={tab === entry} aria-controls="cache-editor-tab-panel" key={entry} className="cache-editor-detail-tab" style={styles.tab(tab === entry)} onClick={() => { setTab(entry); if (entry === "used") void loadUsedBy(); }}>
                            {entry === "used" ? "Used by" : entry === "values" ? "Values" : entry === "recolors" ? "Model recolors" : entry === "transforms" ? "Transforms" : entry[0].toUpperCase() + entry.slice(1)}
                        </button>
                    ))}
                </div>

                <div id="cache-editor-tab-panel" role="tabpanel" className="cache-editor-detail-body" style={styles.body}>
                    {!shown && !creating ? <div className="cache-editor-welcome">
                        <div className="cache-editor-welcome-icon" aria-hidden="true">⌕</div>
                        <h2>Explore the cache</h2>
                        <p>Search by name or ID to inspect a definition. Follow its references, check where it is used, or preview supported models.</p>
                        <p className="cache-editor-welcome-note">To create an overlay, choose a definition first or use <strong>+ New</strong> in the browser.</p>
                    </div> : null}

                    {shown && tab === "recolors" && editing && supportsModelRecolor(editing.kind) ? (
                        <section className="cache-editor-recolor-panel" aria-labelledby="cache-editor-recolor-title">
                            <div className="cache-editor-recolor-heading">
                                <div>
                                    <h3 id="cache-editor-recolor-title">Model recolors</h3>
                                    <p>Replace model colors in pairs. The color picker stores the nearest packed OSRS HSL value; use the number fields for exact values.</p>
                                </div>
                                <button type="button" className="cache-editor-secondary-button" style={styles.input} onClick={addRecolorPair}>+ Add color pair</button>
                            </div>
                            <div className="cache-editor-recolor-note">Packed HSL: hue 0–63 · saturation 0–7 · lightness 0–127 · total 0–65535</div>
                            {recolorCount === 0 ? <div className="cache-editor-recolor-empty">No recolor pairs yet. Add a pair to change the model’s colors.</div> : null}
                            <div className="cache-editor-recolor-list">
                                {Array.from({ length: recolorCount }, (_, index) => {
                                    const from = recolorFrom[index] ?? 0;
                                    const to = recolorTo[index] ?? 0;
                                    return (
                                        <div className="cache-editor-recolor-row" key={index}>
                                            <div className="cache-editor-recolor-color-field">
                                                <label htmlFor={`cache-editor-recolor-from-${index}`}>Original color {index + 1}</label>
                                                <div className="cache-editor-recolor-value-control">
                                                    <span className="cache-editor-recolor-swatch" style={{ backgroundColor: packedHslToHex(from) }} aria-hidden="true" />
                                                    <input id={`cache-editor-recolor-from-${index}`} type="number" min="0" max="65535" step="1" style={styles.input} value={from} aria-label={`Original packed HSL color ${index + 1}`} onChange={(event) => updateRecolorPair(index, "from", Number(event.target.value))} />
                                                </div>
                                            </div>
                                            <span className="cache-editor-recolor-arrow" aria-hidden="true">→</span>
                                            <div className="cache-editor-recolor-color-field">
                                                <label htmlFor={`cache-editor-recolor-to-${index}`}>Replace with {index + 1}</label>
                                                <div className="cache-editor-recolor-value-control">
                                                    <input className="cache-editor-recolor-picker" type="color" value={packedHslToHex(to)} aria-label={`Choose replacement color ${index + 1}`} onChange={(event) => updateRecolorPair(index, "to", hexToPackedHsl(event.target.value))} />
                                                    <input id={`cache-editor-recolor-to-${index}`} type="number" min="0" max="65535" step="1" style={styles.input} value={to} aria-label={`Replacement packed HSL color ${index + 1}`} onChange={(event) => updateRecolorPair(index, "to", Number(event.target.value))} />
                                                </div>
                                            </div>
                                            <button type="button" className="cache-editor-recolor-remove" aria-label={`Remove recolor pair ${index + 1}`} title="Remove pair" onClick={() => removeRecolorPair(index)}>×</button>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    ) : null}

                    {shown && tab === "values" ? (
                        <table className="cache-editor-table" style={styles.table}>
                            <tbody>
                                {(editing ? editableFields.filter((field) => !(supportsModelRecolor(editing.kind) && (field.name === "recolorFrom" || field.name === "recolorTo"))) : Object.keys(shown.values ?? {}).map((name) => ({ name, type: "" } as CacheField))).map((field) => (
                                    <tr key={field.name}>
                                        <td className="cache-editor-field-cell" style={{ ...styles.cell, color: "#9aa3b2", width: 220 }}>
                                            {field.name}
                                            {field.ref ? <span className="cache-editor-field-reference" style={{ color: "#5d6675" }}> → {field.ref}</span> : null}
                                        </td>
                                        <td className="cache-editor-value-cell" style={styles.cell}>
                                            {editing ? renderValueCell(field) : label(shown.values?.[field.name] ?? "")}
                                            {field.note ? <div className="cache-editor-field-note" style={{ color: "#5d6675" }}>{field.note}</div> : null}
                                        </td>
                                    </tr>
                                ))}
                                {!editing && Object.keys(shown.values ?? {}).length === 0 ? <tr><td className="cache-editor-empty-list" colSpan={2}>This definition has no decoded values.</td></tr> : null}
                            </tbody>
                        </table>
                    ) : null}

                    {shown && tab === "preview" ? (
                        <div className="cache-editor-preview">
                            {previewError ? <p className="cache-editor-preview-warning" style={{ color: "#c9b06a" }}>{previewError}</p> : null}
                            <canvas
                                className="cache-editor-preview-canvas"
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
                        <table className="cache-editor-table" style={styles.table}>
                            <tbody>
                                {grouped.map((group) => (
                                    <tr key={group.field}>
                                        <td className="cache-editor-field-cell" style={{ ...styles.cell, color: "#9aa3b2", width: 220 }}>{group.field}</td>
                                        <td style={styles.cell}>
                                            {group.entries.map((entry: CacheLink) => (
                                                <div className="cache-editor-reference-row" key={`${entry.kind}:${entry.id}`}>
                                                    <button type="button" className="cache-editor-inline-link" style={styles.tone(entry.exists)} onClick={() => void inspect(entry.kind, entry.id)}>
                                                        {entry.kind} {entry.id}
                                                    </button>{" "}
                                                    <span className="cache-editor-reference-name" style={{ color: "#9aa3b2" }}>{labelRef(entry.kind, entry.id, entry.name) === `${entry.kind} ${entry.id}` ? "" : entry.name ?? ""}</span>{" "}
                                                    <span className="cache-editor-reference-state" style={styles.tone(entry.exists)}>{entry.exists}</span>
                                                    {entry.note ? <div className="cache-editor-field-note" style={{ color: "#6f7788" }}>{entry.note}</div> : null}
                                                </div>
                                            ))}
                                        </td>
                                    </tr>
                                ))}
                                {grouped.length === 0 ? <tr><td className="cache-editor-empty-list" colSpan={2}>No references from this definition.</td></tr> : null}
                            </tbody>
                        </table>
                    ) : null}

                    {shown && tab === "used" ? (
                        used ? (
                            <div>
                                <p style={{ color: "#9aa3b2" }}>{used.count} references</p>
                                {used.sources.map((entry) => (
                                    <button type="button" className="cache-editor-usage-row" key={`${entry.kind}:${entry.id}:${entry.field}`} style={styles.row(false)} onClick={() => void inspect(entry.kind, entry.id)}>
                                        <span className="cache-editor-result-type">{entry.kind}</span> <span className="cache-editor-mono">{entry.id}</span> {entry.name ?? ""} <span className="cache-editor-field-note">via {entry.field}</span>
                                    </button>
                                ))}
                            </div>
                        ) : <p style={{ color: "#7f8899" }}>Reading the reverse index…</p>
                    ) : null}

                    {shown && tab === "transforms" ? (
                        shown.transforms ? (
                            <div>
                                <p>{shown.transforms.note}</p>
                                {shown.transforms.gatedBy ? (
                                    <p className="cache-editor-transform-gate">
                                        gated by{" "}
                                        <button type="button" className="cache-editor-inline-link" style={{ cursor: "pointer", color: "#caa95e" }} onClick={() => void inspect(shown.transforms!.gatedBy!.kind, shown.transforms!.gatedBy!.id)}>
                                            {shown.transforms.gatedBy.kind} {shown.transforms.gatedBy.id}
                                        </button>{" "}
                                        {shown.transforms.gatedBy.name ?? ""}
                                    </p>
                                ) : null}
                                <table style={styles.table}>
                                    <tbody>
                                        {shown.transforms.children.map((child) => (
                                            <tr key={child.id}>
                                                <td style={styles.cell}>
                                                    <button type="button" className="cache-editor-inline-link" style={{ cursor: "pointer", color: "#caa95e" }} onClick={() => void inspect(shown.kind, child.id)}>{child.id}</button>
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

                {editing ? (
                    <footer className="cache-editor-draft-footer" style={styles.footer}>
                        <div className="cache-editor-draft-summary">
                            <strong>{Object.keys(editing.overrides).length} fields overridden</strong>
                            <span>Changes are saved as a local custom overlay.</span>
                            <details className="cache-editor-draft-data">
                                <summary>View draft data</summary>
                                <code>{JSON.stringify({ kind: editing.kind, id: editing.id, baseId: editing.baseId, fields: editing.overrides })}</code>
                            </details>
                        </div>
                        <div className="cache-editor-draft-actions">
                            <button type="button" className="cache-editor-secondary-button" style={styles.input} onClick={() => { setEditing(null); setCell(null); setTab("values"); setStatus("discarded"); }}>Discard</button>
                            <button type="button" className="cache-editor-create-button" style={styles.input} onClick={() => void save()}>Save changes</button>
                        </div>
                    </footer>
                ) : null}
            </main>
        </div>
    );
}
