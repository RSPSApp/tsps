import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchContent } from '../../network/serverConnection/contentApi';
import type { CacheDefinition } from './CacheEditorModel';

type Tool = { id: string; label: string; url: string; aliases?: { id: string; view?: string }[] };
const localUrl = (value: string) => {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && !url.username && !url.password ? url : null;
    } catch { return null; }
};
function requestedTool(tools: Tool[]) {
    const query = new URLSearchParams(window.location.search), id = query.get('tool'), view = query.get('tool-view') ?? undefined;
    return tools.find(tool => tool.id === id) ?? tools.find(tool => tool.aliases?.some(alias => alias.id === id && alias.view === view));
}
const tabStyle = (selected = false) => ({ color: selected ? '#e4dfd3' : '#999589', background: selected ? '#302b20' : '#1c1d21', border: `1px solid ${selected ? '#caa95e80' : '#caa95e29'}`, padding: '7px 12px', borderRadius: 5, minHeight: 36, cursor: 'pointer' });
function tabKeys(event: { currentTarget: EventTarget | null; target: EventTarget | null; key: string; preventDefault: () => void }) {
    if (!(event.currentTarget instanceof HTMLElement)) return;
    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLButtonElement) {
        event.preventDefault(); event.target.click(); return;
    }
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : -1;
    if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
}

/** One lazy frame per declared entry. Native/tool switching never unloads unsaved work. */
function ToolFrame({ tool, visible, selection }: { tool: Tool; visible: boolean; selection: CacheDefinition | null }) {
    const frame = useRef<HTMLIFrameElement>(null);
    const [ready, setReady] = useState(false), [loadError, setLoadError] = useState(false), [attempt, setAttempt] = useState(0);
    const origin = new URL(tool.url).origin;
    useEffect(() => {
        const receive = (event: MessageEvent) => {
            if (event.source !== frame.current?.contentWindow || event.origin !== origin || event.data?.type !== 'cache-editor-tool:ready') return;
            setReady(true); setLoadError(false);
        };
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
    }, [origin]);
    useEffect(() => {
        if (!visible || ready) return;
        const timer = window.setTimeout(() => setLoadError(true), 12000);
        return () => window.clearTimeout(timer);
    }, [visible, ready, attempt]);
    const retry = useCallback(() => { setReady(false); setLoadError(false); setAttempt(value => value + 1); }, []);
    useEffect(() => {
        if (!loadError || !visible) return;
        const timer = window.setTimeout(retry, 5000);
        return () => window.clearTimeout(timer);
    }, [loadError, visible, retry]);
    const kind = selection?.exists && ['npc', 'item', 'seq'].includes(selection.kind) && selection.id >= 0 && selection.id < 50000 ? selection.kind : undefined;
    const id = selection?.id;
    useEffect(() => {
        if (visible && ready && kind !== undefined && id !== undefined) frame.current?.contentWindow?.postMessage({ type: 'cache-editor-tool:source', source: { kind, id } }, origin);
    }, [visible, ready, kind, id, origin]);
    return <section id={`cache-tool-panel-${tool.id}`} role="tabpanel" aria-label={tool.label} hidden={!visible} inert={!visible} style={{ display: visible ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
        {!ready ? <div role={loadError ? 'alert' : 'status'} style={{ padding: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <span>{loadError ? `${tool.label} is not responding. Retrying automatically. Keep this world's local server running.` : `Loading ${tool.label}…`}</span>
            {loadError ? <button type="button" onClick={retry} style={tabStyle()}>Retry now</button> : null}
        </div> : null}
        <iframe key={attempt} ref={frame} title={tool.label} src={tool.url} onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'cache-editor-tool:ping' }, origin)} style={{ flex: 1, width: '100%', minHeight: 0, border: 0 }} />
    </section>;
}

/** Optional plugin entries join the native section tabs. All feature metadata comes from the plugin. */
export function CacheEditorTools({ contentBase, selection, onReturn }: { contentBase?: string; selection: CacheDefinition | null; onReturn?: (mode: 'definitions' | 'assets') => void }) {
    const [tools, setTools] = useState<Tool[]>([]), [active, setActive] = useState<string | null>(null), [visited, setVisited] = useState<string[]>([]);
    const [container, setContainer] = useState<HTMLElement | null>(null), [nativeTabs, setNativeTabs] = useState<HTMLElement | null>(null), [top, setTop] = useState(60);
    const anchor = useRef<HTMLSpanElement>(null), toolbar = useRef<HTMLDivElement>(null);
    const choose = useCallback((tool?: Tool) => {
        setActive(tool?.id ?? null);
        if (tool) setVisited(value => value.includes(tool.id) ? value : [...value, tool.id]);
    }, []);
    useEffect(() => {
        setTools([]); setActive(null); setVisited([]);
        if (!contentBase || !localUrl(contentBase)) return;
        let current = true;
        void fetchContent('/api/cache-editor-tools').then(body => {
            if (!current) return;
            const seen = new Set<string>();
            const available: Tool[] = (Array.isArray(body?.tools) ? body.tools : []).filter((tool: Tool) => tool && /^[a-z][a-z0-9-]{0,63}$/.test(tool.id) && typeof tool.label === 'string' && tool.label.trim().length > 0 && tool.label.length <= 60 && localUrl(tool.url) && !seen.has(tool.id) && seen.add(tool.id)).slice(0, 20).map((tool: Tool) => ({ ...tool, aliases: Array.isArray(tool.aliases) ? tool.aliases.filter(alias => alias && typeof alias.id === 'string' && (alias.view === undefined || typeof alias.view === 'string')) : [] }));
            setTools(available); choose(requestedTool(available));
        }).catch(() => {});
        return () => { current = false; };
    }, [contentBase, choose]);
    useEffect(() => {
        const root = anchor.current?.closest<HTMLElement>('.cache-editor');
        if (!root) return;
        setContainer(root); setNativeTabs(root.querySelector('.cache-editor-mode-tabs'));
        const header = root.querySelector<HTMLElement>('.cache-editor-header');
        const resize = () => setTop(header?.offsetHeight ?? 0);
        resize(); const observer = new ResizeObserver(resize); if (header) observer.observe(header);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        if (!nativeTabs || !tools.length) return;
        nativeTabs.addEventListener('keydown', tabKeys);
        return () => nativeTabs.removeEventListener('keydown', tabKeys);
    }, [nativeTabs, tools]);
    useEffect(() => {
        const navigate = () => choose(requestedTool(tools));
        window.addEventListener('popstate', navigate);
        return () => window.removeEventListener('popstate', navigate);
    }, [tools, choose]);
    useEffect(() => {
        if (!active || !container) return;
        // The native editor remains mounted, but its covered controls leave the focus order.
        const covered = Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement && !child.matches('.cache-editor-header, [data-cache-tool-overlay]'));
        const previous = covered.map(child => child.inert);
        covered.forEach(child => child.inert = true);
        toolbar.current?.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus();
        return () => covered.forEach((child, index) => child.inert = previous[index]);
    }, [active, container]);
    const open = (tool: Tool) => {
        choose(tool);
        const url = new URL(window.location.href); url.searchParams.set('tool', tool.id); url.searchParams.delete('tool-view');
        window.history.replaceState(window.history.state, '', url);
    };
    const back = (mode: 'definitions' | 'assets') => {
        setActive(null); onReturn?.(mode);
        const url = new URL(window.location.href); url.searchParams.delete('tool'); url.searchParams.delete('tool-view');
        window.history.replaceState(window.history.state, '', url);
        requestAnimationFrame(() => nativeTabs?.querySelectorAll<HTMLButtonElement>('button')[mode === 'assets' ? 1 : 0]?.focus());
    };
    const buttons = tools.map(tool => <button type="button" role="tab" aria-selected={active === tool.id} aria-controls={`cache-tool-panel-${tool.id}`} key={tool.id} onClick={() => open(tool)} style={tabStyle(active === tool.id)}>{tool.label}</button>);
    return <>
        <span ref={anchor} hidden />
        {tools.length > 0 && nativeTabs ? createPortal(buttons, nativeTabs) : null}
        {tools.length > 0 && container && visited.length > 0 ? createPortal(<section data-cache-tool-overlay hidden={!active} aria-label="Cache editor tools" style={{ position: 'absolute', top, right: 0, bottom: 0, left: 0, display: active ? 'flex' : 'none', flexDirection: 'column', background: '#17181b', zIndex: 5 }}>
            <div ref={toolbar} role="tablist" aria-label="Cache editor sections" onKeyDown={tabKeys} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 10px', borderBottom: '1px solid #caa95e42', background: '#121315' }}>
                <button type="button" role="tab" aria-selected={false} onClick={() => back('definitions')} style={tabStyle()}>Definitions</button>
                <button type="button" role="tab" aria-selected={false} onClick={() => back('assets')} style={tabStyle()}>Assets</button>
                {buttons}
            </div>
            {tools.filter(tool => visited.includes(tool.id)).map(tool => <ToolFrame key={tool.id} tool={tool} visible={active === tool.id} selection={selection} />)}
        </section>, container) : null}
    </>;
}
