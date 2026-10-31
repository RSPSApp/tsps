import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OsrsClient } from '../../game/OsrsClient';
import { fetchContent, getContentApiBase } from '../../network/serverConnection/contentApi';
import { CustomItemRegistry } from '../../custom/items/CustomItemRegistry';
import { CustomModelRegistry } from '../../custom/items/CustomModelRegistry';
import { ItemPreview, equippedPreviewState, wornModelIds, type ItemRow, type PreviewTab } from './ItemPreview';
import type { CustomItemDefinition } from '../../custom/items/CustomItemTypes';
import { ItemAuthoring } from './ItemAuthoring';
import { ItemAnimations } from './ItemAnimations';
import { animationFrame } from './ItemPlayback';
import './ItemEditor.css';
const tabs: PreviewTab[] = ['Inventory', 'Ground', 'Model A', 'Model B'];
const slots: Record<number, string> = { 0: 'Head', 1: 'Cape', 2: 'Neck', 3: 'Weapon', 4: 'Body', 5: 'Shield', 7: 'Legs', 9: 'Hands', 10: 'Feet', 12: 'Ring', 13: 'Ammunition' };
export function ItemEditor({ client }: {
    client: OsrsClient;
}) {
    const [catalog, setCatalog] = useState<ItemRow[]>([]);
    const [loading, setLoading] = useState('Loading game cache…');
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [selected, setSelected] = useState(1205);
    const [source, setSource] = useState<'cache' | 'custom'>('cache');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(0);
    const [tab, setTab] = useState<PreviewTab>('Inventory');
    const [offhandId, setOffhandId] = useState(-1);
    const [offhandQuery, setOffhandQuery] = useState('');
    const [yaw, setYaw] = useState(256);
    const [pitch, setPitch] = useState(128);
    const [zoom, setZoom] = useState(1);
    const [previewMessage, setPreviewMessage] = useState('');
    const [tick, setTick] = useState(0);
    const [authored, setAuthored] = useState<CustomItemDefinition>();
    const [playback, setPlayback] = useState<{
        id: number;
        nonce: number;
    }>();
    const [playbackStatus, setPlaybackStatus] = useState('');
    const canvasHost = useRef<HTMLDivElement>(null);
    const renderer = useRef<ItemPreview | undefined>(undefined);
    useEffect(() => {
        let cancelled = false;
        let started = false;
        renderer.current = undefined;
        setError('');
        setLoading('Loading game cache…');
        const timer = window.setInterval(async () => {
            if (started || !client.objTypeLoader || !client.idkTypeLoader || !client.objModelLoader || !getContentApiBase())
                return;
            started = true;
            window.clearInterval(timer);
            setLoading('Reading effective item definitions…');
            try {
                const [data, items, models] = await Promise.all([
                    fetchContent('/api/item-editor'), fetchContent('/api/custom-items'), fetchContent('/api/custom-models'),
                ]);
                if (cancelled)
                    return;
                if (data.status !== 'ok' || !Array.isArray(data.items))
                    throw new Error('Item definitions are unavailable. Restart the local server and retry.');
                CustomModelRegistry.clear();
                CustomItemRegistry.clear();
                for (const model of models)
                    CustomModelRegistry.register(model);
                for (const item of items)
                    CustomItemRegistry.register(item, 'item-editor');
                renderer.current = new ItemPreview(client);
                setCatalog(data.items);
                setLoading('');
            }
            catch (e) {
                if (!cancelled) {
                    setLoading('');
                    setError(`${e instanceof Error ? e.message : 'Could not load items'}. Check the local server and retry.`);
                }
            }
        }, 250);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [client, retry]);
    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return catalog.filter(row => row.source === source && (!needle || row.name.toLowerCase().includes(needle) || String(row.id) === needle));
    }, [catalog, source, query]);
    const sourceRow = catalog.find(item => item.id === selected);
    const offhand = catalog.find(item => item.id === offhandId && item.equipable && !item.noted && item.equipmentSlot === 5);
    const offhands = useMemo(() => {
        const needle = offhandQuery.trim().toLowerCase();
        return catalog.filter(item => item.equipable && !item.noted && item.equipmentSlot === 5
            && (!needle || item.name.toLowerCase().includes(needle) || String(item.id) === needle));
    }, [catalog, offhandQuery]);
    const row = useMemo(() => sourceRow && authored ? { ...sourceRow, id: authored.id, name: authored.objType.name, source: 'custom' as const, noted: false } : sourceRow, [sourceRow, authored]);
    const previewDraft = useCallback((item?: CustomItemDefinition) => {
        setPlayback(undefined);
        setPlaybackStatus('');
        if (item)
            CustomItemRegistry.register(item, 'item-editor-draft');
        renderer.current = client.objTypeLoader ? new ItemPreview(client) : undefined;
        setAuthored(item);
    }, [client]);
    const savedDraft = useCallback((item: CustomItemDefinition, original: ItemRow) => {
        CustomItemRegistry.register(item, 'item-editor-saved');
        const savedRow = { ...original, id: item.id, name: item.objType.name, source: 'custom' as const, noted: false };
        setCatalog(values => values.filter(row => row.id !== item.id).concat(savedRow));
    }, []);
    const loadedDrafts = useCallback((items: CustomItemDefinition[]) => {
        for (const item of items)
            CustomItemRegistry.register(item, 'item-editor-saved');
        setCatalog(values => {
            // Preserve cache rows and customs outside the editor-owned range.
            const baseRows = values.filter(row => row.source === 'cache' || row.id < 60000 || row.id > 65022);
            return baseRows.concat(items.flatMap(item => {
                const base = baseRows.find(row => row.id === item.baseItemId);
                return base ? [{ ...base, id: item.id, name: item.objType.name, source: 'custom' as const, noted: false }] : [];
            }));
        });
    }, []);
    const obj = row && renderer.current ? client.objTypeLoader.load(row.id) : undefined;
    useEffect(() => { setPage(0); }, [query, source]);
    useEffect(() => {
        if (!row || !obj)
            return;
        if (!row.equipable && (tab === 'Model A' || tab === 'Model B'))
            setTab('Inventory');
    }, [row, obj, tab]);
    // Sparse cache streaming is asynchronous. Retry only while assets are missing.
    useEffect(() => {
        if (!previewMessage.includes('Waiting for cache assets'))
            return;
        const timer = window.setTimeout(() => setTick(value => value + 1), 700);
        return () => window.clearTimeout(timer);
    }, [previewMessage, tick]);
    useEffect(() => {
        const host = canvasHost.current;
        if (!host)
            return;
        host.replaceChildren();
        setPreviewMessage('');
        if (!row || !renderer.current)
            return;
        try {
            host.append(renderer.current.render(row, tab, yaw, pitch, zoom, undefined, offhand));
        }
        catch (e) {
            setPreviewMessage(e instanceof Error ? e.message : 'Preview unavailable');
        }
    }, [row, tab, yaw, pitch, zoom, tick, client, catalog, playback, offhand]);
    useEffect(() => {
        const preview = renderer.current, host = canvasHost.current;
        if (!playback || !row || !preview || !host || !tab.startsWith('Model'))
            return;
        host.scrollIntoView({ block: 'center' });
        let raf = 0, started: number | undefined, timeline: number[] | undefined, lastFrame = -1;
        const requested = performance.now();
        function step(now: number) {
            try {
                timeline ??= preview!.prepareAnimation(playback!.id);
                const frame = animationFrame(timeline, started === undefined ? 0 : now - started);
                if (frame < 0) {
                    setPlayback(undefined);
                    setPlaybackStatus(`Animation #${playback!.id} finished.`);
                    return;
                }
                if (frame !== lastFrame) {
                    const canvas = preview!.render(row!, tab, yaw, pitch, zoom, { id: playback!.id, frame }, offhand);
                    host!.replaceChildren(canvas);
                    lastFrame = frame;
                    if (started === undefined) {
                        started = now;
                        setPlaybackStatus(`Playing animation #${playback!.id} once…`);
                    }
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'Animation unavailable';
                if (!message.includes('Waiting for cache assets') || now - requested > 15000) {
                    setPlayback(undefined);
                    setPlaybackStatus(`Could not play animation #${playback!.id}: ${message.replace(' Waiting for cache assets…', '')}`);
                    return;
                }
                raf = window.requestAnimationFrame(step);
                return;
            }
            raf = window.requestAnimationFrame(step);
        }
        setPlaybackStatus(`Loading animation #${playback.id}…`);
        raf = window.requestAnimationFrame(step);
        return () => window.cancelAnimationFrame(raf);
    }, [playback, row, tab, yaw, pitch, zoom, offhand]);
    function playAnimation(id: number) {
        setTab(current => current === 'Model B' ? current : 'Model A');
        setPlayback({ id, nonce: performance.now() });
    }
    function pick(item: ItemRow) { setPlayback(undefined); setPlaybackStatus(''); setAuthored(undefined); setSelected(item.id); setYaw(256); setPitch(128); setZoom(1); setPreviewMessage(''); }
    function selectSource(next: 'cache' | 'custom') {
        setSource(next);
        setQuery('');
        setPage(0);
        const first = catalog.find(item => item.source === next);
        if (first)
            pick(first);
        else
            setSelected(-1);
    }
    const equippedStatus = row && obj && (tab === 'Model A' || tab === 'Model B')
        ? equippedPreviewState(row, obj, tab === 'Model B').reason : '';
    return <main className="item-editor" aria-label="Item editor">
        <header className="item-editor-header"><div><span className="item-editor-kicker">TSPS · LOCAL TOOLS</span><h1>Item editor</h1><p>Create custom items from the cache. Recolour and compare every view.</p></div>
            <div className="item-editor-header-end"><span className="item-editor-badge">Stage II · Local authoring</span><a href="/?edit=1">Map editor ↗</a></div></header>
        <div className="item-editor-layout">
            <aside className="item-editor-library" aria-label="Item library">
                <div className="item-editor-source" role="group" aria-label="Item source">
                    <button aria-pressed={source === 'cache'} onClick={() => selectSource('cache')}>Cache items</button>
                    <button aria-pressed={source === 'custom'} onClick={() => selectSource('custom')}>Custom items</button></div>
                <label className="item-editor-search">Search items<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Name or exact ID"/></label>
                <div className="item-editor-count">{filtered.length.toLocaleString()} items</div>
                <div className="item-editor-list" role="list" aria-label="Search results">
                    {filtered.slice(page * 60, page * 60 + 60).map(item => <button role="listitem" key={item.id} onClick={() => pick(item)} aria-current={item.id === selected ? 'true' : undefined}>
                        <span>{item.name}</span><small>#{item.id}{item.noted ? ' · Noted' : item.equipable ? ' · Equipable' : ''}</small></button>)}
                    {!loading && !error && !filtered.length && <p>No items found.</p>}</div>
                <div className="item-editor-pages"><button disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><span>{page + 1} / {Math.max(1, Math.ceil(filtered.length / 60))}</span><button disabled={(page + 1) * 60 >= filtered.length} onClick={() => setPage(value => value + 1)}>Next</button></div>
            </aside>
            <section className="item-editor-preview" aria-label="Item preview">
                <div className="item-editor-title"><h2>{row?.name ?? (loading ? 'Loading items…' : 'Select an item')}</h2><span>{row ? `#${row.id} · ${row.source === 'custom' ? 'Custom item' : 'Cache item'}` : 'Local cache'}</span></div>
                <div className="item-editor-tabs" role="tablist" aria-label="Preview views">{tabs.map(view => <button key={view} role="tab" aria-selected={tab === view} aria-controls="item-preview-panel" aria-disabled={!!row && !row.equipable && view.startsWith('Model')} title={row && !row.equipable && view.startsWith('Model') ? row.reason : view === 'Model A' ? 'Male reference body' : view === 'Model B' ? 'Female reference body' : view} onClick={() => { if (!row || row.equipable || !view.startsWith('Model')) {
            setPlayback(undefined);
            setPlaybackStatus('');
            setTab(view);
        } }}>{view}</button>)}</div>
                {row && !row.equipable && <p className="item-editor-reason">Model A / B: {row.reason}</p>}
                {tab.startsWith('Model') && <div className="item-editor-offhand-controls">
                    <label>Search offhand<input value={offhandQuery} onChange={e => setOffhandQuery(e.target.value)} placeholder="Defender, shield or exact ID"/></label>
                    <label>Offhand<select value={offhand?.id ?? -1} onChange={e => setOffhandId(Number(e.target.value))} disabled={row?.equipmentSlot === 5}>
                        <option value={-1}>None</option>
                        {offhand && !offhands.slice(0, 100).some(item => item.id === offhand.id) && <option value={offhand.id}>{offhand.name} · #{offhand.id}</option>}
                        {offhands.slice(0, 100).map(item => <option key={item.id} value={item.id}>{item.name} · #{item.id}</option>)}
                    </select></label>
                    <p>{row?.equipmentSlot === 5 ? 'The selected item already occupies the offhand slot.' : `${offhands.length} matching offhands${offhands.length > 100 ? ' · showing first 100; refine your search' : ''}. Preview only · item definitions are unchanged.`}</p>
                </div>}
                <div id="item-preview-panel" role="tabpanel" aria-label={`${tab} preview`} className={`item-editor-stage ${tab === 'Inventory' ? 'inventory' : ''}`}>
                    <div ref={canvasHost} className="item-editor-canvas"/>
                    {(loading || error || previewMessage || equippedStatus) && <div className="item-editor-message" role="status">{loading || error || previewMessage || equippedStatus}{error && <button onClick={() => setRetry(value => value + 1)}>Retry</button>}</div>}
                </div>
                <div className="item-editor-caption">{tab === 'Inventory' ? 'Actual game icon · 36 × 32 pixels · nearest-neighbour enlargement' : tab === 'Ground' ? 'Ground model · one-tile display with a reference body at the same scale' : `${tab === 'Model A' ? 'Male' : 'Female'} reference body · ${playback ? 'animation preview' : 'static pose'}`}</div>
                {playbackStatus && <p className="item-editor-caption" role="status">{playbackStatus} {playback && <button onClick={() => { setPlayback(undefined); setPlaybackStatus('Animation stopped.'); }}>Stop</button>}</p>}
                {tab !== 'Inventory' && <div className="item-editor-controls">
                    <label>Rotation<input aria-label="Rotation" type="range" min="0" max="2047" value={yaw} onChange={e => setYaw(Number(e.target.value))}/></label>
                    <label>Tilt<input aria-label="Tilt" type="range" min="0" max="400" value={pitch} onChange={e => setPitch(Number(e.target.value))}/></label>
                    <label>Zoom<input aria-label="Zoom" type="range" min="0.4" max="2" step="0.05" value={zoom} onChange={e => setZoom(Number(e.target.value))}/></label>
                    <button onClick={() => { setYaw(256); setPitch(128); setZoom(1); }}>Reset view</button></div>}
            </section>
            <aside className="item-editor-details" aria-label="Effective item definition">
                {sourceRow && <ItemAnimations key={selected} id={authored?.baseItemId ?? (sourceRow.id >= 60000 ? CustomItemRegistry.get(sourceRow.id)?.definition.baseItemId ?? sourceRow.id : sourceRow.id)} inherited={!!authored || sourceRow.id >= 60000} onPlay={playAnimation} equipable={!!row?.equipable}/>}
                {sourceRow && renderer.current && <ItemAuthoring key={`${getContentApiBase()}:${selected}`} client={client} row={sourceRow} catalog={catalog} onPreview={previewDraft} onSaved={savedDraft} onLoaded={loadedDrafts}/>}
                <details className="item-editor-effective-details"><summary>Effective item details</summary>
                {row && obj ? <><dl><dt>Item ID</dt><dd>{row.id}</dd><dt>Source</dt><dd>{row.source === 'cache' ? 'Game cache' : 'Custom definition + overrides'}</dd>
                    <dt>Equipable</dt><dd>{row.equipable ? 'Yes' : 'No'}</dd><dt>Equipment slot</dt><dd>{row.equipable ? slots[row.equipmentSlot] ?? row.equipmentSlot : '—'}</dd>
                    <dt>Inventory / ground model</dt><dd>{obj.model ?? 'Missing'}</dd><dt>Model A parts</dt><dd>{wornModelIds(obj, false).join(', ') || 'None'}</dd>
                    <dt>Model B parts</dt><dd>{wornModelIds(obj, true).join(', ') || 'None'}</dd><dt>Actions</dt><dd>{obj.inventoryActions?.filter(Boolean).join(' · ') || 'None'}</dd>
                    <dt>Recolour pairs</dt><dd>{obj.recolorFrom?.length ?? 0}</dd><dt>Texture replacements</dt><dd>{obj.retextureFrom?.length ?? 0}</dd></dl>
                    <p className="item-editor-note">The original cache item remains unchanged. Model upload is planned for a later stage.</p></> : <p>Select an item to inspect its definition.</p>}
                </details>
            </aside>
        </div>
    </main>;
}
