// A picker always stores the native numeric ID. Thumbnails are native models,
// not the exact inventory sprites. The animation tab uses the same API.
let audition, auditionUrl;
const previews = new Map(), queue = [];
let running = 0, drawThumbnail;
let pictureObserver;
let pickerSequence = 0;
const observed = new Set();
function preview(ctx, canvas, kind, id) {
    for (let i = queue.length - 1; i >= 0; i--) if (!queue[i].canvas.isConnected) queue.splice(i, 1);
    if (queue.length >= 80) return;
    queue.push({ ctx, canvas, kind, id });
    pump();
}
function pump() {
    while (running < 2 && queue.length) {
        const job = queue.shift();
        if (!job.canvas.isConnected) continue;
        running++;
        const key = `${job.kind}/${job.id}`;
        if (!previews.has(key)) {
            const request = job.ctx.api(job.kind==='effect'?`visual-effect?id=${job.id}`:`source?kind=${job.kind}&id=${job.id}&variant=${job.kind === 'npc' ? 'body' : 'inventory'}`)
                .then(source => ({ mesh: source.mesh, kind: source.kind, variant: source.variant, fields: source.fields })).catch(error => { previews.delete(key); throw error; });
            previews.set(key, request);
            if (previews.size > 16) previews.delete(previews.keys().next().value);
        }
        previews.get(key).then(async source => {
            if (!job.canvas.isConnected) return;
            const draw = job.ctx.thumbnail ?? (drawThumbnail ??= (await import('/viewport.mjs')).thumbnail);
            if (job.canvas.isConnected) draw(job.canvas, source.mesh, source);
        }).catch(() => {
            if (job.canvas.isConnected) { job.canvas.hidden = true; job.canvas.parentElement?.classList.add('picker-no-model'); }
        }).finally(() => { running--; pump(); });
    }
}
export function referencePicture(ctx, parent, kind, id, label = 'Native model preview') {
    const canvas = ctx.element('canvas', { width: 100, height: 76, class: 'picker-picture', role: 'img', 'aria-label': label, title: 'Native model thumbnail, not an inventory sprite' });
    parent.append(canvas);
    // Call after the parent is attached; discarded panels never fetch models.
    queueMicrotask(() => {
        for (const previous of observed) if (!previous.isConnected) { pictureObserver?.unobserve(previous); observed.delete(previous); }
        if (!canvas.isConnected) return;
        if (typeof IntersectionObserver === 'undefined') { preview(ctx, canvas, kind, id); return; }
        pictureObserver ??= new IntersectionObserver(entries => {
            for (const entry of entries) if (entry.isIntersecting) {
                pictureObserver.unobserve(entry.target); observed.delete(entry.target);
                entry.target._referencePreview?.(); delete entry.target._referencePreview;
            }
        }, { rootMargin: '60px' });
        canvas._referencePreview = () => preview(ctx, canvas, kind, id);
        observed.add(canvas); pictureObserver.observe(canvas);
    });
    return canvas;
}
export function referencePicker(ctx, parent, label, kind, value, set, options = {}) {
    const { element, button, api, change, status } = ctx;
    const { none = -1, noneLabel = 'None', query = '', required = false, visual = kind === 'item' || kind === 'npc', references = false, creaturesOnly = false, searchRoute, onPick } = options;
    const route = (text, offset = 0) => `${searchRoute ?? `search?kind=${kind}`}&q=${encodeURIComponent(text)}&offset=${offset}${references ? '&references=1' : ''}${creaturesOnly ? '&creaturesOnly=1' : ''}`;
    const input = element('input', { type: 'search', placeholder: `Search ${label.toLowerCase()}…`, 'aria-label': label, autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list' });
    const name = element('strong', { text: value === none ? required ? `Choose ${label.toLowerCase()}` : noneLabel : `Loading ${label.toLowerCase()}…` });
    const current = element('div', { class: 'picker-value' }, name);
    const results = element('div', { id: `reference-results-${++pickerSequence}`, class: 'picker-results', hidden: true, role: 'listbox', 'aria-label': `${label} results` });
    input.setAttribute('aria-controls', results.id);
    const wrapper = element('div', { class: `picker${visual ? ' picker-visual' : ''}` }, element('label', {}, label, input), current, results);
    parent.append(wrapper);
    let timer, serial = 0, selectedId = value, lastRows = [], offset = 0, suppressFocus = false;
    function close() { results.hidden = true; input.setAttribute('aria-expanded', 'false'); }
    function describe(row) {
        current.replaceChildren(name);
        name.textContent = (row?.name ?? (!required && selectedId === none ? noneLabel : `Unresolved ${kind} ${selectedId}`)).replace(/_/g, ' ');
        current.title = selectedId === none ? noneLabel : `Native ${kind} ID ${selectedId}`;
        if (visual && selectedId !== none) referencePicture(ctx, current, kind, selectedId, `${name.textContent} native model`);
        if (row?.noted) current.append(element('small', { text: 'Noted item' }));
        if (row?.specialName) current.append(element('small', { text: `${row.specialName.replace(/_/g, ' ')}${row.energy === undefined ? '' : `, native cost ${row.energy}%`}` }));
    }
    if (kind === 'sound' && value > 0) wrapper.append(button('Listen', async () => {
        audition?.pause(); if (auditionUrl) URL.revokeObjectURL(auditionUrl);
        const response = await fetch(`/api/sound?id=${selectedId}`);
        if (!response.ok) { status((await response.json()).error, true); return; }
        const url = URL.createObjectURL(await response.blob()); auditionUrl = url; audition = new Audio(url);
        const release = () => { URL.revokeObjectURL(url); if (auditionUrl === url) auditionUrl = null; };
        audition.onended = release; audition.onerror = release;
        try { await audition.play(); } catch { release(); }
    }));
    const choose = (id, row) => {
        // Invalidate a search already in flight before change() rebuilds the panel.
        serial++; clearTimeout(timer); selectedId = id;
        change(() => { set(id); onPick?.(row); });
        describe(row); close(); input.value = '';
    };
    const search = async (reset = true) => {
        if (reset) { offset = 0; lastRows = []; }
        const token = ++serial;
        try {
            const result = await api(route(input.value || query, offset));
            if (token !== serial || !wrapper.isConnected) return;
            lastRows = reset ? result.rows : [...lastRows, ...result.rows];
            // Keep each open picker bounded even for very broad searches.
            lastRows = lastRows.slice(0, 150);
            const cards = lastRows.map(row => {
                const card = button('', () => choose(row.id, row), { role: 'option', 'aria-selected': row.id === selectedId, title: `Native ${kind} ID ${row.id}` });
                if (visual) referencePicture(ctx, card, kind, row.id, `${row.name} native model`);
                card.append(element('span', { class: 'picker-result-name', text: row.name.replace(/_/g, ' ') }));
                if (row.specialName) card.append(element('small', { text: `${row.specialName.replace(/_/g, ' ')}${row.energy === undefined ? '' : `, ${row.energy}%`}` }));
                else if (row.noted) card.append(element('small', { text: 'Noted item' }));
                return card;
            });
            results.replaceChildren(...(required ? [] : [button(noneLabel, () => choose(none, null), { role: 'option', 'aria-selected': selectedId === none })]), ...cards);
            if (!lastRows.length) results.append(element('span', { class: 'note', text: 'No matches. Try a name or native ID.' }));
            if (lastRows.length < Math.min(result.total, 150)) results.append(button('More results', () => { offset += 50; return search(false); }));
            results.hidden = false; input.setAttribute('aria-expanded', 'true');
        } catch (error) {
            if (token !== serial || !wrapper.isConnected) return;
            status(error.message, true);
            results.replaceChildren(element('span', { class: 'note', text: error.message }), button('Try again', () => search()));
            results.hidden = false; input.setAttribute('aria-expanded', 'true');
        }
    };
    input.oninput = () => { serial++; lastRows = []; close(); clearTimeout(timer); timer = setTimeout(search, 180); };
    input.onfocus = () => { if (suppressFocus) { suppressFocus = false; return; } return search(); };
    input.onkeydown = e => {
        if (e.key === 'Escape') { serial++; close(); input.blur(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); results.querySelector('button')?.focus(); }
        if (e.key === 'Enter') { e.preventDefault(); if (lastRows.length === 1) choose(lastRows[0].id, lastRows[0]); }
    };
    wrapper.addEventListener('focusout', () => setTimeout(() => { if (wrapper.isConnected && !wrapper.contains(document.activeElement)) { serial++; clearTimeout(timer); close(); } }, 0));
    results.onkeydown = e => {
        const rows = [...results.querySelectorAll('button')], index = rows.indexOf(document.activeElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            rows[e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
        }
        if (e.key === 'Escape') { serial++; clearTimeout(timer); close(); suppressFocus = true; input.focus(); }
    };
    if (value !== none) api(route(String(value))).then(result => {
        if (wrapper.isConnected && selectedId === value) describe(result.rows.find(row => row.id === value));
    }).catch(() => { if (wrapper.isConnected && selectedId === value) describe(null); });
    return wrapper;
}
