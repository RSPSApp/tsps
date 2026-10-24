import { useEffect, useRef, useState } from 'react';
import type { OsrsClient } from '../../game/OsrsClient';
import type { CustomItemDefinition } from '../../custom/items/CustomItemTypes';
import { getContentApiBase } from '../../network/serverConnection/contentApi';
import { compileColors, colorHex, effectiveColor, hexHsl, modelColors, recolorSelection, type ColorEntry } from './ItemColors';
import type { ItemRow } from './ItemPreview';
type Snapshot = {
    items: CustomItemDefinition[];
    revision: string;
    warning?: string;
};
type Metadata = {
    bonuses: number[];
    requirements: number[];
    value: number;
    tradeable: boolean;
};
type Draft = {
    item: CustomItemDefinition;
    original: CustomItemDefinition;
    revision: string;
    existing: boolean;
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const bonusNames = ['Attack stab', 'Attack slash', 'Attack crush', 'Attack magic', 'Attack ranged', 'Defence stab', 'Defence slash', 'Defence crush', 'Defence magic', 'Defence ranged', 'Melee strength', 'Ranged strength', 'Magic damage %', 'Prayer'];
const skills = ['Attack', 'Defence', 'Strength', 'Hitpoints', 'Ranged', 'Prayer', 'Magic', 'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking', 'Crafting', 'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving', 'Slayer', 'Farming', 'Runecrafting', 'Hunter', 'Construction', 'Sailing'];
export async function request(suffix = '', body?: unknown): Promise<any> {
    const base = getContentApiBase();
    if (!base)
        throw Error('Local server is unavailable');
    const url = new URL(base);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
        throw Error('Saving is available only on a local server');
    const response = await fetch(`http://127.0.0.1:${Number(url.port) + 1100}/items${suffix}`, {
        method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok)
        throw Error(data.error || `Local saving service: ${response.status}`);
    return data;
}
export function ItemAuthoring({ client, row, catalog, onPreview, onSaved, onLoaded }: {
    client: OsrsClient;
    row: ItemRow;
    catalog: ItemRow[];
    onPreview: (item?: CustomItemDefinition) => void;
    onSaved: (item: CustomItemDefinition, sourceRow: ItemRow) => void;
    onLoaded: (items: CustomItemDefinition[]) => void;
}) {
    const [snapshot, setSnapshot] = useState<Snapshot>();
    const [draft, setDraft] = useState<Draft>();
    const [discarded, setDiscarded] = useState<Draft>();
    const draftRef = useRef<Draft | undefined>(undefined);
    draftRef.current = draft;
    const [history, setHistory] = useState<CustomItemDefinition[]>([]), [redo, setRedo] = useState<CustomItemDefinition[]>([]);
    const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
    const [colors, setColors] = useState<ColorEntry[]>([]), [paletteMessage, setPaletteMessage] = useState('');
    const [selectedColors, setSelectedColors] = useState<number[]>([]);
    const [hex, setHex] = useState('#9147d8'), [preserve, setPreserve] = useState(true), [brightness, setBrightness] = useState(0);
    const [saturation, setSaturation] = useState(hexHsl('#9147d8').sat);
    const [before, setBefore] = useState(false), [highlight, setHighlight] = useState(false), [json, setJson] = useState(false);
    const [paletteName, setPaletteName] = useState('Purple metal'), [presets, setPresets] = useState<Record<string, {
        hex: string;
        preserve: boolean;
        brightness: number;
        saturation?: number;
    }>>({});
    const storageKey = `tsps:item-draft:${getContentApiBase()}:${row.id}`;
    async function reload() {
        setBusy(true);
        try {
            const next: Snapshot = await request();
            setSnapshot(next);
            onLoaded(next.items);
            const current = draftRef.current;
            if (current)
                onPreview(before ? current.original : current.item);
            setMessage(draft ? 'Saved items reloaded. Use Rebase draft to acknowledge the current file before saving.' : 'Local saving ready.');
        }
        catch {
            setMessage('Local saving unavailable. Restart the local server, then Reload saved items. Draft editing and JSON export remain available.');
        }
        finally {
            setBusy(false);
        }
    }
    useEffect(() => {
        void reload();
        try {
            const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
            if (stored?.item?.objType?.name && stored?.original && typeof stored.revision === 'string') {
                setDraft(stored);
                setMessage('Recovered local draft.');
            }
            const archived = JSON.parse(localStorage.getItem(`${storageKey}:discarded`) || 'null');
            if (archived?.item?.objType?.name && archived?.original && typeof archived.revision === 'string')
                setDiscarded(archived);
            setPresets(JSON.parse(localStorage.getItem('tsps:item-palettes') || '{}'));
        }
        catch { /* A broken browser draft never changes the canonical file. */ }
        // The parent keys this component by selected item and connected server.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        if (!draft) {
            onPreview();
            return;
        }
        try {
            localStorage.setItem(storageKey, JSON.stringify(draft));
        }
        catch { /* Export remains available. */ }
        let item = before ? draft.original : draft.item;
        if (highlight && !before && selectedColors.length) {
            const desired = new Map(colors.map(entry => [entry.raw, selectedColors.includes(entry.raw) ? 11200 : effectiveColor(entry.raw, item.objType)]));
            item = { ...item, objType: { ...item.objType, ...compileColors(colors.map(entry => entry.raw), desired) } };
        }
        onPreview(item);
    }, [draft, before, highlight, selectedColors, colors, onPreview, storageKey]);
    useEffect(() => {
        if (!draft)
            return;
        let stopped = false, timer: number | undefined;
        function load() {
            if (stopped)
                return;
            try {
                const obj = client.objTypeLoader.load(draft!.item.id);
                const palette = modelColors(client, obj);
                setColors(palette.colors);
                setPaletteMessage(palette.missing.length ? `Waiting for models: ${palette.missing.join(', ')}` : palette.textured ? `${palette.textured} textured faces keep their texture colors.` : 'Colors shared by multiple parts change together.');
                if (palette.missing.length)
                    timer = window.setTimeout(load, 700);
            }
            catch (error) {
                setPaletteMessage(error instanceof Error ? error.message : 'Palette unavailable');
            }
        }
        // Preview registration runs in the effect above before models are read.
        load();
        return () => { stopped = true; if (timer)
            window.clearTimeout(timer); };
        // Recolor does not alter the raw palette. Reload only when starting another draft.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft?.item.id, client]);
    function change(item: CustomItemDefinition) {
        if (!draft || busy)
            return;
        setHistory(values => [...values.slice(-79), clone(draft.item)]);
        setRedo([]);
        setDraft({ ...draft, item });
        setBefore(false);
        setMessage('Unsaved draft · preview updated');
    }
    async function begin() {
        setBusy(true);
        try {
            let item: CustomItemDefinition;
            const existing = row.source === 'custom' && row.id >= 60000;
            if (existing) {
                const saved = snapshot?.items.find(item => item.id === row.id);
                if (!saved)
                    throw Error('Reload saved items to edit this custom item');
                item = clone(saved);
            }
            else {
                if (row.source !== 'cache')
                    throw Error('Choose an original cache item');
                const obj = client.objTypeLoader.load(row.id);
                if (obj.noteTemplate >= 0 || obj.placeholderTemplate >= 0)
                    throw Error('Choose a normal item, not a note or placeholder');
                const ids = new Set([...catalog.map(row => row.id), ...(snapshot?.items.map(row => row.id) ?? [])]);
                let id = 60000;
                while (ids.has(id) && id <= 65022)
                    id++;
                if (id > 65022)
                    throw Error('No free custom IDs');
                item = { id, baseItemId: row.id, objType: { name: `${row.name} (custom)`,
                        recolorFrom: [...(obj.recolorFrom ?? [])], recolorTo: [...(obj.recolorTo ?? [])],
                        note: -1, noteTemplate: -1, unnotedId: -1, notedId: -1, placeholder: -1, placeholderTemplate: -1 } };
            }
            const base = client.objTypeLoader.load(item.baseItemId!);
            if (item.objType.recolorFrom === undefined) {
                item.objType.recolorFrom = [...(base.recolorFrom ?? [])];
                item.objType.recolorTo = [...(base.recolorTo ?? [])];
            }
            setDraft({ item, original: clone(item), revision: snapshot?.revision ?? '', existing });
            setSelectedColors([]);
            setHistory([]);
            setRedo([]);
            setMessage('Draft created. Special actions and passive effects may need separate game logic.');
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : 'Could not create draft');
        }
        finally {
            setBusy(false);
        }
    }
    function closeDraft() {
        if (!draft)
            return;
        // Keep a recoverable browser draft, but return the preview to the source item.
        setDraft(undefined);
        setColors([]);
        setSelectedColors([]);
        setHighlight(false);
        setBefore(false);
        setHistory([]);
        setRedo([]);
        setMessage('Draft kept in this browser. Reopen this item to recover it, or create a new custom copy.');
    }
    function discardDraft() {
        if (!draft)
            return;
        try {
            localStorage.setItem(`${storageKey}:discarded`, JSON.stringify(draft));
            localStorage.removeItem(storageKey);
        }
        catch {
            setMessage('Could not archive this browser draft. Export it before closing.');
            return;
        }
        setDiscarded(draft);
        closeDraft();
        setMessage('Browser draft discarded. Restore last draft can recover it. Saved custom items are unchanged.');
    }
    async function save() {
        if (!draft)
            return;
        setBusy(true);
        try {
            const next: Snapshot = await request('', { revision: draft.revision, existing: draft.existing, item: draft.item });
            setSnapshot(next);
            setDraft({ ...draft, revision: next.revision, existing: true, original: clone(draft.item) });
            setMessage(next.warning || 'Saved locally. Restart the game server to use this item in game.');
            onSaved(draft.item, row);
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : 'Save failed; draft retained');
            try {
                setSnapshot(await request());
            }
            catch { /* Keep the previous snapshot and draft. */ }
        }
        finally {
            setBusy(false);
        }
    }
    function appearance(key: string, value: unknown) {
        if (draft)
            change({ ...draft.item, objType: { ...draft.item.objType, [key]: value } });
    }
    function rule(key: string, value: unknown) {
        if (draft)
            change({ ...draft.item, itemDef: { ...draft.item.itemDef, [key]: value } });
    }
    async function loadStats() {
        if (!draft)
            return;
        setBusy(true);
        try {
            const meta: Metadata = await request(`/${draft.item.baseItemId}`);
            const bonuses = Array.from({ length: 14 }, (_, i) => draft.item.itemDef?.bonuses?.[i] ?? meta.bonuses[i] ?? 0);
            const requirements = Array.from({ length: 24 }, (_, i) => draft.item.itemDef?.requirements?.[i] ?? meta.requirements[i] ?? 0);
            setHistory(values => [...values.slice(-79), clone(draft.item)]);
            setRedo([]);
            setDraft({ ...draft, item: { ...draft.item, itemDef: { ...draft.item.itemDef, bonuses, requirements } } });
            setMessage('Inherited stats loaded. Edit individual values below.');
        }
        catch {
            setMessage('Could not read inherited stats. Restart the server and retry.');
        }
        finally {
            setBusy(false);
        }
    }
    function exportJson() {
        if (!draft)
            return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(draft.item, null, 2) + '\n'], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `custom-item-${draft.item.id}.json`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    const item = draft?.item;
    const dirty = draft && JSON.stringify(draft.item) !== JSON.stringify(draft.original);
    return <section className="item-editor-authoring" aria-label="Custom item authoring">
        <h2>Create & edit</h2>
        {!draft && <button disabled={busy || (row.source === 'custom' && row.id < 60000) || row.noted} onClick={begin}>{row.source === 'cache' ? 'Add as custom' : 'Edit custom item'}</button>}
        {!draft && discarded && <button disabled={busy} onClick={() => { setDraft(discarded); setMessage('Recovered discarded draft.'); }}>Restore last draft</button>}
        <button disabled={busy} onClick={reload}>Reload saved items</button>
        <p role="status" className="item-editor-author-status">{busy ? 'Working…' : message}</p>
        {draft && item && <>
            <div className="item-editor-author-toolbar"><strong>#{item.id} · {dirty || !draft.existing ? 'Unsaved' : 'Saved'}</strong>
                <button disabled={busy || !snapshot || !draft.revision || (draft.existing && !dirty)} onClick={save}>Save custom item</button>
                <button onClick={exportJson}>Export JSON</button>
                <button aria-pressed={json} onClick={() => setJson(!json)}>{json ? 'Form' : 'JSON'}</button></div>
            {snapshot && draft.revision !== snapshot.revision && <div className="item-editor-author-status">The saved file has changed. Review it before rebasing your draft.
                <details><summary>Current saved item</summary><pre className="item-editor-author-json">{JSON.stringify(snapshot.items.find(row => row.id === item.id) ?? 'No item saved with this ID', null, 2)}</pre></details>
                {!draft.existing && snapshot.items.some(row => row.id === item.id) ? <button onClick={() => {
                        const used = new Set([...catalog.map(row => row.id), ...snapshot.items.map(row => row.id)]);
                        let id = 60000;
                        while (used.has(id) && id <= 65022)
                            id++;
                        if (id > 65022) {
                            setMessage('No free custom IDs');
                            return;
                        }
                        setDraft({ ...draft, revision: snapshot.revision, item: { ...item, id }, original: { ...draft.original, id } });
                        setMessage('Assigned a free ID. Your existing custom item will be preserved.');
                    }}>Use next free ID</button> : <button onClick={() => { setDraft({ ...draft, revision: snapshot.revision, existing: snapshot.items.some(row => row.id === item.id) }); setMessage('Draft rebased. Saving will replace this ID with your draft.'); }}>Rebase draft</button>}</div>}
            <div className="item-editor-author-toolbar"><button disabled={busy || !history.length} onClick={() => { setRedo(values => [...values, clone(item)]); setDraft({ ...draft, item: history[history.length - 1] }); setHistory(values => values.slice(0, -1)); }}>Undo</button>
                <button disabled={busy || !redo.length} onClick={() => { setHistory(values => [...values, clone(item)]); setDraft({ ...draft, item: redo[redo.length - 1] }); setRedo(values => values.slice(0, -1)); }}>Redo</button>
                <button aria-pressed={before} onClick={() => { setBefore(!before); setHighlight(false); }}>{before ? 'Show edited' : 'Show original'}</button>
                <button disabled={busy} onClick={() => { change(clone(draft.original)); setSelectedColors([]); setHighlight(false); }}>Reset draft</button>
                <button disabled={busy} onClick={closeDraft}>Back to viewer</button>
                <button disabled={busy} onClick={discardDraft}>Discard draft</button></div>
            {json ? <pre className="item-editor-author-json">{JSON.stringify(item, null, 2)}</pre> : <>
                <label>Item name<input maxLength={80} value={item.objType.name} onChange={e => appearance('name', e.target.value)}/></label>
                <p className="item-editor-note">Base item: #{item.baseItemId}. Models, equipment slot and combat type are inherited. Notes and placeholders are unlinked.</p>
                <label>Examine text<textarea maxLength={500} value={item.objType.examine ?? ''} placeholder="Inherited" onChange={e => appearance('examine', e.target.value)}/></label>
                <label>Value (gp)<input type="number" min="0" max="2147483647" placeholder="Inherited" value={item.itemDef?.value ?? ''} onChange={e => {
                    const next = clone(item);
                    if (e.target.value === '') {
                        delete next.itemDef?.value;
                        delete next.objType.price;
                    }
                    else {
                        const value = Number(e.target.value);
                        next.objType.price = value;
                        next.itemDef = { ...next.itemDef, value };
                    }
                    change(next);
                }}/></label>
                <label>Tradeable<select value={item.itemDef?.tradeable === undefined ? 'inherited' : String(item.itemDef.tradeable)} onChange={e => {
                    const next = clone(item);
                    if (e.target.value === 'inherited') {
                        delete next.itemDef?.tradeable;
                        delete next.objType.isTradable;
                    }
                    else {
                        const value = e.target.value === 'true';
                        next.objType.isTradable = value;
                        next.itemDef = { ...next.itemDef, tradeable: value };
                    }
                    change(next);
                }}><option value="inherited">Inherited</option><option value="true">Yes</option><option value="false">No</option></select></label>
                <details open><summary>Recolour</summary>
                    <p>Select colors to change. Use Highlight selection to locate them on the model.</p>
                    <div className="item-editor-color-actions"><button onClick={() => setSelectedColors(colors.map(entry => entry.raw))}>Select all</button><button onClick={() => setSelectedColors([])}>Clear selection</button>
                        <button onClick={() => { const chosen = new Set(selectedColors.map(raw => { const c = effectiveColor(raw, item.objType); return `${c >> 10}:${(c >> 7) & 7}`; })); setSelectedColors(colors.filter(entry => { const c = effectiveColor(entry.raw, item.objType); return chosen.has(`${c >> 10}:${(c >> 7) & 7}`); }).map(entry => entry.raw)); }}>Select matching shades</button></div>
                    <div className="item-editor-color-palette">{colors.map(entry => <button key={entry.raw} aria-label={`Color ${entry.raw}`} aria-pressed={selectedColors.includes(entry.raw)} title={`${entry.roles.join(', ')} · ${entry.faces} faces`} style={{ borderColor: selectedColors.includes(entry.raw) ? '#e5bd6a' : undefined }} onClick={() => setSelectedColors(values => values.includes(entry.raw) ? values.filter(raw => raw !== entry.raw) : [...values, entry.raw])}>
                        <span style={{ background: colorHex(effectiveColor(entry.raw, item.objType)) }}/><small>{entry.raw}</small></button>)}</div>
                    <p>{paletteMessage}</p>
                    <label className="item-editor-author-check"><input type="checkbox" checked={highlight} onChange={e => setHighlight(e.target.checked)}/>Highlight selection (preview only)</label>
                    <label>Target color<input aria-label="Target color" type="color" value={hex} onChange={e => { setHex(e.target.value); setSaturation(hexHsl(e.target.value).sat); }}/></label>
                    <label>Saturation: {saturation}<input aria-label="Saturation" type="range" min="0" max="7" value={saturation} onChange={e => setSaturation(Number(e.target.value))}/></label>
                    <label className="item-editor-author-check"><input type="checkbox" checked={preserve} onChange={e => setPreserve(e.target.checked)}/>Preserve shading</label>
                    <label>Brightness adjustment: {brightness}<input type="range" min="-40" max="40" value={brightness} onChange={e => setBrightness(Number(e.target.value))}/></label>
                    <button disabled={busy || !selectedColors.length || paletteMessage.startsWith('Waiting')} onClick={() => { change(recolorSelection(item, colors.map(entry => entry.raw), selectedColors, hex, preserve, brightness, saturation)); setHighlight(false); }}>Apply to selected colors</button>
                    <button disabled={busy} onClick={() => { const next = clone(item); if (draft.original.objType.recolorFrom) {
                next.objType.recolorFrom = clone(draft.original.objType.recolorFrom);
                next.objType.recolorTo = clone(draft.original.objType.recolorTo);
            }
            else {
                delete next.objType.recolorFrom;
                delete next.objType.recolorTo;
            } change(next); }}>Reset recolours</button>
                    <label>Palette name<input value={paletteName} maxLength={60} onChange={e => setPaletteName(e.target.value)}/></label>
                    <button disabled={!paletteName.trim()} onClick={() => { const next = { ...presets, [paletteName.trim()]: { hex, preserve, brightness, saturation } }; setPresets(next); try {
                localStorage.setItem('tsps:item-palettes', JSON.stringify(next));
                setMessage('Palette saved in this browser. Select matching material colors on the next item before applying.');
            }
            catch {
                setMessage('Browser storage unavailable.');
            } }}>Save palette</button>
                    <select aria-label="Saved palette" value="" onChange={e => { const preset = presets[e.target.value]; if (preset) {
                setHex(preset.hex);
                setPreserve(preset.preserve);
                setBrightness(preset.brightness);
                setSaturation(preset.saturation ?? hexHsl(preset.hex).sat);
                setPaletteName(e.target.value);
            } }}><option value="">Load palette…</option>{Object.keys(presets).map(name => <option key={name}>{name}</option>)}</select>
                </details>
                <details><summary>Bonuses & requirements</summary>
                    <button disabled={busy} onClick={loadStats}>Load inherited stats</button>
                    <p>Unchanged fields inherit the base item. Loading stats makes the arrays explicit.</p>
                    {item.itemDef?.bonuses && <div className="item-editor-author-stats">{bonusNames.map((name, i) => <label key={name}>{name}<input type="number" min="-10000" max="10000" value={item.itemDef!.bonuses![i]} onChange={e => { const values = [...item.itemDef!.bonuses!]; values[i] = Number(e.target.value); rule('bonuses', values); }}/></label>)}</div>}
                    {item.itemDef?.requirements && <div className="item-editor-author-stats">{skills.map((name, i) => <label key={name}>{name}<input type="number" min="0" max="99" value={item.itemDef!.requirements![i] ?? 0} onChange={e => { const values = Array.from({ length: 24 }, (_, j) => item.itemDef!.requirements![j] ?? 0); values[i] = Number(e.target.value); rule('requirements', values); }}/></label>)}</div>}
                </details>
                <details><summary>Inventory framing</summary><p>These settings change the saved game icon. Preview rotation above only changes the viewing camera.</p>
                    {(['zoom2d', 'xan2d', 'yan2d', 'zan2d', 'offsetX2d', 'offsetY2d'] as const).map(key => <label key={key}>{({ zoom2d: 'Icon zoom', xan2d: 'Icon tilt', yan2d: 'Icon rotation', zan2d: 'Icon roll', offsetX2d: 'Icon offset X', offsetY2d: 'Icon offset Y' })[key]}<input type="number" placeholder="Inherited" value={item.objType[key] ?? ''} onChange={e => { const next = clone(item); if (e.target.value === '')
                delete next.objType[key];
            else
                next.objType[key] = Number(e.target.value); change(next); }}/></label>)}
                </details>
            </>}
        </>}
    </section>;
}
