import { assemble, localPoint, reflectPoint, worldPoint } from '/shared/mesh.mjs';
import {
    NATIVE_SKIN_COLOUR, SKIN_PREVIEW_HEX, isSkinColour, PAINT_PRESETS, colourHex, parsePaintColour, paintScope, collectPaintPalette, paletteFromParts,
    createPalettePlan, createColourReplacePlan, paintPlanRows, editPaintPlanRow, validatePaintPlan,
    applyPaintPlan, paintTopology, paintHitFaces, createBrushPlan, sourceMaterialPlan, restoreSourceMaterials,
    parsePaintPalette, exportPaintPalette,
} from '/shared/paint.mjs';

/**
 * Paint owns its undo checkpoints. Forward edit(hit, delta, 'start'|'move')
 * and edit(null, null, 'end') without the app's legacy Paint checkpoint/edit.
 * faceOverlay returns { fill, stroke, lineWidth } for the viewport to draw.
 * Include /paint.css beside the main stylesheet. No saved schema additions.
 */
export function createPaintTab(ctx) {
    const { state, element: el, button, api } = ctx;
    const s = state.paintTab ??= {
        scope: 'view', chosenIds: [], tool: 'face', colour: parsePaintColour(state.colour ?? '#b99558'),
        radius: 22, mirror: true, mirrorPlane: 0, protectBack: true, connected: true,
        textureMode: 'keep', keepShading: true, channel: 'all', recent: [], favourites: [],
        palette: PAINT_PRESETS[0], searchKind: 'npc', query: '', searchRows: [], searchTotal: 0,
        searchOffset: 0, searchPage: 0, searchMessage: '', searching: false,
    };
    let toolsTarget, propertiesTarget, resultsTarget, preview = null, stroke = null, hover = null;
    let observedProject = state.project, observedVariant = state.variant, topologyCache = new WeakMap();
    let searchToken = 0, pictureToken = 0, restoreToken = 0;
    const sources = new Map();
    const parts = () => state.project?.parts ?? [];
    const scopeParts = () => paintScope(parts(), { ...s, selectedId: state.selected, variant: state.variant });
    const scopeKey = () => `${s.scope}/${state.variant}/${scopeParts().map(p => p.id).join('/')}`;
    const note = (target, text) => target.append(el('p', { class: 'paint-note', text }));
    const act = fn => async (...args) => { try { return await fn(...args); } catch (error) { ctx.status(error.message, true); } };
    const refresh = () => { if (toolsTarget?.isConnected !== false) renderTools(toolsTarget); if (propertiesTarget?.isConnected !== false) renderProperties(propertiesTarget); ctx.viewport && (ctx.viewport.dirty = true); };
    const block = (target, title) => { const area = el('section', { class: 'paint-section' }, el('h3', { text: title })); target.append(area); return area; };
    const details = (target, title, open = false) => ctx.disclosure ? ctx.disclosure(target, title, open) : (() => {
        const d = el('details', { class: 'paint-section', open }, el('summary', { text: title })); target.append(d); return d;
    })();
    const choose = (target, label, value, options, fn) => {
        const input = el('select', { 'aria-label': label, onChange: event => fn(event.target.value) },
            ...options.map(([v, text]) => el('option', { value: v, text, selected: String(v) === String(value) })));
        target.append(el('label', { class: 'paint-field' }, label, input)); return input;
    };
    const toggle = (target, label, key, help) => {
        const input = el('input', { type: 'checkbox', checked: s[key], onChange: event => { s[key] = event.target.checked; if (key === 'keepShading') preview = null; hover = null; refresh(); } });
        target.append(el('label', { class: 'paint-check', title: help ?? label }, input, label));
    };
    const swatch = (colour, fn, title = colourHex(colour), attrs = {}) => button('', fn, {
        class: 'paint-swatch', style: `--paint-colour:${colourHex(colour)}`, title, 'aria-label': title,
        'aria-pressed': s.colour === colour, ...attrs,
    });
    const remember = colour => { s.recent = [colour, ...s.recent.filter(c => c !== colour)].slice(0, 12); };
    const setColour = (value, redraw = true) => {
        s.colour = parsePaintColour(value); s.material = isSkinColour(s.colour) ? 'skin' : 'colour'; state.colour = colourHex(s.colour);
        if (redraw) { remember(s.colour); refresh(); }
        else if (toolsTarget) {
            const hex = toolsTarget.querySelector?.('[data-paint-hex]'); if (hex) hex.value = state.colour;
        }
    };
    const topology = mesh => {
        let cached = topologyCache.get(mesh);
        if (!cached || cached.faces !== mesh.faces || cached.vertices !== mesh.vertices || cached.count !== mesh.faces.length) {
            cached = { faces: mesh.faces, vertices: mesh.vertices, count: mesh.faces.length, value: paintTopology(mesh) };
            topologyCache.set(mesh, cached);
        }
        return cached.value;
    };
    function syncValues() {
        if (state.project !== observedProject || state.variant !== observedVariant) {
            stroke = null; hover = null; preview = null; topologyCache = new WeakMap();
            if (state.project !== observedProject) { searchToken++; pictureToken++; restoreToken++; sources.clear(); s.searching = false; }
            observedProject = state.project; observedVariant = state.variant;
        }
        const ids = new Set(parts().map(p => p.id)); s.chosenIds = s.chosenIds.filter(id => ids.has(id));
        if (preview && preview.scopeKey !== scopeKey()) preview = null;
        state.paintTool = s.tool;
    }
    function reset() {
        searchToken++; pictureToken++; restoreToken++; sources.clear();
        preview = null; stroke = null; hover = null; topologyCache = new WeakMap(); s.searching = false;
        observedProject = state.project; observedVariant = state.variant;
    }
    function previewValid() {
        if (!preview || preview.project !== state.project || preview.scopeKey !== scopeKey()) return false;
        try { validatePaintPlan(parts(), preview.plan); return true; } catch { return false; }
    }
    function showPlan(plan, label) {
        if (!scopeParts().length) throw new Error('Choose at least one part to paint.');
        preview = { project: state.project, scopeKey: scopeKey(), plan, label };
        hover = null; refresh();
        ctx.status(plan.changes.length ? `${plan.changes.length.toLocaleString()} faces in the preview. Apply colours when ready.` : 'No faces would change. Native textures stay protected unless you choose Replace.');
    }
    function previewPalette(palette = s.palette) {
        s.palette = palette;
        showPlan(createPalettePlan(scopeParts(), palette.colours, s), palette.name);
    }
    function applyPreview() {
        if (!previewValid()) throw new Error('The model or scope changed. Preview the colours again.');
        const { plan, label } = preview;
        if (!plan.changes.length) { ctx.status('No colours to change.'); return; }
        validatePaintPlan(parts(), plan);
        preview = null; hover = null;
        ctx.change(() => applyPaintPlan(parts(), plan));
        ctx.status(`Applied ${label} to ${plan.changes.length.toLocaleString()} faces. Undo restores the previous colours.`);
    }

    function renderTools(target) {
        if (!target) return;
        toolsTarget = target; syncValues(); target.replaceChildren();
        const root = el('div', { class: 'paint-tab' }); target.append(root);
        root.append(el('h2', { text: 'Paint' }));
        if (!state.project) { note(root, 'Add a creature or item in Build first.'); return; }
        const scope = block(root, 'Paint which parts?');
        choose(scope, 'Apply to', s.scope, [
            ['view', 'Visible parts in this view'], ['selected', 'Selected part'], ['branch', 'Selected part + attachments'],
            ['chosen', 'Choose several parts'], ['all', state.project.kind === 'gear' ? 'Entire item, all views' : 'Entire creature'],
        ], value => { s.scope = value; preview = null; hover = null; refresh(); });
        if (s.scope === 'chosen') {
            const list = el('div', { class: 'paint-part-choices' });
            for (const part of parts()) list.append(el('label', { class: 'paint-check' }, el('input', {
                type: 'checkbox', checked: s.chosenIds.includes(part.id), onChange: event => {
                    s.chosenIds = event.target.checked ? [...new Set([...s.chosenIds, part.id])] : s.chosenIds.filter(id => id !== part.id);
                    preview = null; hover = null; refresh();
                },
            }), `${part.name}${state.project.kind === 'gear' ? ` (${part.variant})` : ''}`));
            scope.append(list);
        }
        note(scope, `${scopeParts().length} of ${parts().length} parts. ${s.scope === 'all' ? 'Includes hidden parts.' : s.scope === 'selected' || s.scope === 'branch' ? 'Select a part in the parts list.' : 'Brush strokes stay within this scope.'}`);

        const brush = block(root, 'Brush');
        const toolButtons = el('div', { class: 'paint-tool-grid' });
        for (const [tool, label, hint] of [
            ['face', 'Face', 'Paint one triangle (F)'], ['brush', 'Brush', 'Paint beneath a round brush (B)'],
            ['fill', 'Fill', 'Fill connected faces of the same colour (G)'], ['piece', 'Piece', 'Paint the connected piece (P)'],
            ['colour', 'Replace colour', 'Replace the clicked colour throughout the chosen scope (C)'], ['picker', 'Pick colour', 'Sample an exact game colour (I)'],
        ]) toolButtons.append(button(label, () => { s.tool = tool; hover = null; refresh(); }, { 'aria-pressed': s.tool === tool, title: hint }));
        brush.append(toolButtons);
        const help = { face: 'Click a face to paint it. Drag to paint more faces.', brush: 'Drag to paint. [ and ] change brush size.', fill: 'Click a colour patch to fill it. Shared edges connect the patch.', piece: 'Click to paint one connected piece.', colour: 'Click a colour on the model to replace it across your scope.', picker: 'Click the model to sample a colour, then return to Face.' };
        note(brush, help[s.tool]);
        if (s.tool === 'brush') ctx.toolSlider(brush, 'Brush size', s.radius, value => { s.radius = value; hover = null; }, 1, 150);
        const colourRow = el('div', { class: 'paint-colour-row' });
        colourRow.append(el('input', { type: 'color', value: colourHex(s.colour), 'aria-label': 'Paint colour', onInput: event => setColour(event.target.value, false), onChange: () => { remember(s.colour); refresh(); } }));
        colourRow.append(el('input', { type: 'text', value: colourHex(s.colour), maxLength: 7, 'data-paint-hex': '', 'aria-label': 'Hex colour', onChange: act(event => setColour(event.target.value)) }));
        const favourite = s.favourites.includes(s.colour);
        colourRow.append(button(favourite ? 'Saved' : 'Save colour', () => {
            s.favourites = favourite ? s.favourites.filter(c => c !== s.colour) : [...s.favourites, s.colour].slice(-24); refresh();
        }, { 'aria-pressed': favourite, title: favourite ? 'Remove from saved colours' : 'Keep this colour for this editing session' }));
        if (state.project.kind === 'gear') colourRow.append(button('Skin', () => {
            s.material = s.material === 'skin' ? 'colour' : 'skin'; hover = null; refresh();
        }, { class: 'paint-skin', 'aria-pressed': s.material === 'skin', title: 'Paint exposed skin that follows the wearer’s skin tone', style: `--paint-colour:${SKIN_PREVIEW_HEX}` }));
        brush.append(colourRow);
        if (state.project.kind === 'gear') note(brush, s.material === 'skin'
            ? 'Skin brush: magenta faces match the wearer’s skin tone in game. Choose Face, Brush, Fill or Piece above.'
            : 'Magenta marks exposed skin. Use Skin to paint more, or a colour to turn it into fabric or armour.');
        for (const [title, colours] of [['Recent', s.recent], ['Saved colours', s.favourites]]) if (colours.length) {
            const row = el('div', { class: 'paint-swatches', 'aria-label': title }, el('span', { class: 'paint-small-label', text: title }));
            colours.forEach(c => row.append(swatch(c, () => setColour(c)))); brush.append(row);
        }
        toggle(brush, 'Mirror strokes', 'mirror', 'Also paint matching triangles across the local X mirror plane (M).');
        const selected = ctx.selected?.();
        if (hasLinkedTwin(selected)) note(brush, 'This part has linked twins. Both instances always share paint, even with Mirror strokes off.');
        const options = details(root, 'Brush and material options');
        choose(options, 'Native textures', s.textureMode, [['keep', 'Keep textures; paint plain faces'], ['replace', 'Replace textures where I paint']], value => { s.textureMode = value; preview = null; hover = null; refresh(); });
        toggle(options, 'Keep original shading', 'keepShading', 'Palette and piece painting keep the light and dark variations within each colour area.');
        toggle(options, 'Protect back faces', 'protectBack', 'The round brush skips triangles facing away from the clicked face.');
        toggle(options, 'Brush stays on connected piece', 'connected', 'Stop the round brush crossing gaps to another disconnected piece.');
        options.append(el('label', { class: 'paint-field' }, 'Mirror plane X (part coordinates)', el('input', {
            type: 'number', value: s.mirrorPlane, min: -16000, max: 16000, step: 1, 'aria-label': 'Mirror plane X',
            onChange: act(event => { const value = Number(event.target.value); if (!Number.isFinite(value) || Math.abs(value) > 16000) throw new Error('Mirror plane must be between -16000 and 16000.'); s.mirrorPlane = value; hover = null; }),
        })));
        note(options, 'Mirror strokes need matching triangles. Uneven sculpted sides may have no match.');

        const palettes = block(root, 'Palettes');
        const presetGrid = el('div', { class: 'paint-presets' });
        for (const preset of PAINT_PRESETS) presetGrid.append(button('', act(() => previewPalette(preset)), {
            class: 'paint-preset', title: `Preview ${preset.name}`, 'aria-label': `Preview ${preset.name} palette`,
        }));
        [...presetGrid.children].forEach((b, i) => {
            const preset = PAINT_PRESETS[i];
            b.append(el('span', { text: preset.name }), el('span', { class: 'paint-palette-strip', 'aria-hidden': 'true' }, ...preset.colours.map(c => el('i', { style: `background:${colourHex(c)}` }))));
        });
        palettes.append(presetGrid);
        choose(palettes, 'Colour area', s.channel, [['all', 'Main + accent + detail'], ['main', 'Main colour only'], ['accent', 'Accent only'], ['detail', 'Details only']], value => { s.channel = value; preview = null; refresh(); });
        palettes.append(button('Preview this colour on the scope', act(() => showPlan(createPalettePlan(scopeParts(), [s.colour], s), 'brush colour')), { class: 'paint-wide' }));
        const copy = details(root, 'Copy a creature or item palette');
        choose(copy, 'Look in', s.searchKind, [['npc', 'Creatures'], ['item', 'Items']], value => { s.searchKind = value; s.searchRows = []; s.searchTotal = 0; s.searchMessage = ''; s.searching = false; searchToken++; refresh(); });
        const form = el('form', { class: 'paint-search', onSubmit: event => { event.preventDefault(); act(() => searchSources())(); } });
        form.append(el('input', { type: 'search', value: s.query, placeholder: s.searchKind === 'npc' ? 'Goblin, dragon, spider...' : 'Rune armour, cape, sword...', 'aria-label': 'Find palette source', onInput: event => { s.query = event.target.value; } }), button('Find', () => {}, { type: 'submit' }));
        copy.append(form); resultsTarget = el('div', { class: 'paint-source-results', 'aria-live': 'polite' }); copy.append(resultsTarget); renderSourceResults();
        renderPaletteFiles(details(root, 'Keep a palette'));
    }

    function renderPaletteFiles(target) {
        const copy = button('Copy colours from this scope', act(() => {
            const colours = paletteFromParts(scopeParts(), s.textureMode);
            if (!colours.length) throw new Error('This scope has no plain colours. Choose Replace textures to use their underlying colours.');
            s.palette = { name: 'Scope palette', colours }; previewPalette();
        }), { class: 'paint-wide' });
        const input = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Import palette JSON', onChange: act(async event => {
            const file = event.target.files?.[0]; if (!file) return;
            if (file.size > 32768) throw new Error('Palette files must be smaller than 32 KB.');
            const palette = parsePaintPalette(await file.text()); previewPalette(palette); event.target.value = '';
        }) });
        target.append(copy, button('Export scope palette', act(() => {
            const colours = paletteFromParts(scopeParts(), s.textureMode);
            if (!colours.length) throw new Error('This scope has no plain colours to export.');
            const url = URL.createObjectURL(new Blob([exportPaintPalette(state.project.name, colours)], { type: 'application/json' }));
            const link = el('a', { href: url, download: 'tsps-palette.json' });
            try { link.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
        }), { class: 'paint-wide' }), el('label', { class: 'paint-field' }, 'Import palette', input));
        note(target, 'Saved and recent colours last for this session. Export a palette to keep it.');
    }

    function renderProperties(target) {
        if (!target) return;
        propertiesTarget = target; syncValues(); if (!stroke) topologyCache = new WeakMap(); target.replaceChildren();
        const root = el('div', { class: 'paint-tab' }); target.append(root);
        if (!state.project) return;
        const scoped = scopeParts(), palette = collectPaintPalette(scoped, s), total = scoped.reduce((n, p) => n + p.mesh.faces.length, 0);
        const colours = block(root, 'Colours in this scope');
        const grid = el('div', { class: 'paint-swatches' });
        palette.slice(0, 72).forEach(row => grid.append(swatch(row.colour, () => {
            showPlan(createColourReplacePlan(scopeParts(), row.colour, s.colour, s), `${row.hex} replacement`);
        }, `Replace ${row.hex} on ${row.count} faces with the brush colour`)));
        colours.append(grid);
        note(colours, `${scoped.length} parts, ${total.toLocaleString()} faces. Click a swatch to preview its replacement.`);
        if (palette.length > 72) note(colours, 'Showing the 72 most used colours. Pick colour on the model samples any face.');
        if (!palette.length) note(colours, scoped.length ? 'Textures are protected. Choose Replace textures to paint over them.' : 'Choose parts on the left.');

        if (preview) renderPreview(root);
        else {
            const help = block(root, 'Palette preview');
            note(help, 'Choose a palette on the left. Review the model and colour swaps here, then apply them together.');
        }
        if (s.palette?.colours?.length) {
            const active = block(root, s.palette.name), row = el('div', { class: 'paint-swatches' });
            s.palette.colours.forEach(c => row.append(swatch(c, () => setColour(c), `Use ${colourHex(c)} as the brush colour`)));
            active.append(row, button('Preview palette', act(() => previewPalette()), { class: 'paint-wide' }));
        }
        const restore = details(root, 'Restore source colours and textures');
        note(restore, 'Restore materials for the chosen scope without changing shape, placement, attachments or movement. Undo brings your paint back.');
        restore.append(button('Restore source materials', act(restoreScope), { class: 'paint-wide', disabled: !scoped.length }));
    }

    function renderPreview(root) {
        const area = block(root, `Preview: ${preview.label}`), valid = previewValid();
        if (!valid) note(area, 'The model changed. Choose a palette or colour again to refresh this preview.');
        const plan = preview.plan, scopedIds = new Set(scopeParts().map(p => p.id));
        const currentParts = parts(), changedParts = currentParts.map(p => scopedIds.has(p.id) ? { ...p, mesh: {
            ...p.mesh, faces: p.mesh.faces.map(f => [...f]), ...(p.mesh.textures && { textures: [...p.mesh.textures] }),
        } } : p);
        if (valid) applyPaintPlan(changedParts, plan);
        const pictures = el('div', { class: 'paint-comparison' });
        // Other gear views are still included in the apply operation; show only
        // this view in the thumbnail instead of superimposing inventory and worn.
        for (const [label, model] of [['Before', currentParts], ['After', changedParts]]) {
            const canvas = el('canvas', { width: 130, height: 116, 'aria-label': `${label} palette preview, current view` });
            const mesh = assemble(model, state.variant, scopedIds);
            if (mesh.faces.length) ctx.thumbnail?.(canvas, mesh);
            pictures.append(el('figure', {}, canvas, el('figcaption', { text: label })));
        }
        area.append(pictures);
        if (state.project.kind === 'gear' && s.scope === 'all') note(area, 'Pictures show this view. Applying also paints every other item view.');
        const rows = paintPlanRows(plan), list = el('div', { class: 'paint-remaps' });
        rows.slice(0, 64).forEach(row => {
            const target = el('input', { type: 'color', value: colourHex(row.to), 'aria-label': `Replacement for ${colourHex(row.from)}, ${row.count} faces`, onChange: event => {
                preview.plan = editPaintPlanRow(preview.plan, row.key, event.target.value); renderProperties(propertiesTarget);
            } });
            list.append(el('div', { class: 'paint-remap' },
                el('span', { class: 'paint-swatch paint-static', style: `--paint-colour:${colourHex(row.from)}`, title: colourHex(row.from) }),
                el('span', { text: 'to' }), target, el('span', { class: 'paint-count', text: `${row.count.toLocaleString()} faces${row.textures ? ' + texture' : ''}` })));
        });
        area.append(list);
        if (rows.length > 64) note(area, `Showing 64 of ${rows.length} swaps. Apply includes every swap.`);
        if (plan.skippedTextures) note(area, `${plan.skippedTextures.toLocaleString()} textured faces keep their native materials.`);
        const actions = el('div', { class: 'paint-actions' }, button('Apply colours', act(applyPreview), { class: 'primary', disabled: !valid || !plan.changes.length }), button('Cancel', () => { preview = null; refresh(); }));
        area.append(actions);
    }

    async function requestSource(kind, id, variant = kind === 'npc' ? 'body' : 'inventory') {
        const key = `${kind}/${id}/${variant}`;
        if (!sources.has(key)) {
            const request = api(`source?kind=${kind}&id=${id}&variant=${encodeURIComponent(variant)}`).catch(error => { if (sources.get(key) === request) sources.delete(key); throw error; });
            sources.set(key, request);
            if (sources.size > 8) sources.delete(sources.keys().next().value);
        }
        return sources.get(key);
    }
    async function searchSources(offset = 0, page = 0) {
        const token = ++searchToken, kind = s.searchKind;
        s.searching = true; s.searchMessage = ''; renderSourceResults();
        try {
            const result = await api(`search?kind=${kind}&q=${encodeURIComponent(s.query)}&offset=${offset}&unique=1`);
            if (token !== searchToken) return;
            s.searchRows = result.rows; s.searchTotal = result.total; s.searchOffset = offset;
            s.searchPage = Math.min(page, Math.max(0, Math.floor((result.rows.length - 1) / 6) * 6));
        } catch (error) { if (token !== searchToken) return; s.searchMessage = error.message; s.searchRows = []; }
        finally { if (token === searchToken) { s.searching = false; renderSourceResults(); } }
    }
    function renderSourceResults() {
        if (!resultsTarget) return;
        const target = resultsTarget, token = ++pictureToken;
        target.replaceChildren();
        if (s.searching) { note(target, 'Finding palettes...'); return; }
        if (s.searchMessage) { note(target, s.searchMessage); return; }
        const rows = s.searchRows.slice(s.searchPage, s.searchPage + 6);
        if (!rows.length) { note(target, s.searchTotal ? 'No matches on this page.' : 'Find a creature or item, then click its picture to preview its palette.'); return; }
        const grid = el('div', { class: 'paint-source-grid' }), jobs = [];
        rows.forEach(row => {
            const canvas = el('canvas', { width: 128, height: 90, 'aria-label': `${row.name} preview` });
            const card = button('', act(async () => {
                const project = state.project, kind = s.searchKind, key = scopeKey();
                const source = await requestSource(kind, row.id);
                if (project !== state.project || key !== scopeKey()) return;
                const colours = paletteFromParts([{ mesh: source.mesh }]);
                if (!colours.length) throw new Error('This source uses textures only. Choose a source with plain colours.');
                previewPalette({ name: source.name, colours });
            }), { class: 'paint-source', title: `Preview colours from ${row.name}` });
            card.append(canvas, el('span', { text: row.name })); grid.append(card);
            jobs.push({ canvas, id: row.id, kind: s.searchKind });
        });
        target.append(grid);
        const start = s.searchOffset + s.searchPage;
        const nav = el('div', { class: 'paint-actions' });
        nav.append(button('Previous', act(async () => {
            if (s.searchPage >= 6) { s.searchPage -= 6; renderSourceResults(); }
            else await searchSources(Math.max(0, s.searchOffset - 50), 48);
        }), { disabled: start === 0 }), el('span', { class: 'paint-count', text: `${start + 1}-${start + rows.length} of ${s.searchTotal}` }), button('Next', act(async () => {
            if (s.searchPage + 6 < s.searchRows.length) { s.searchPage += 6; renderSourceResults(); }
            else await searchSources(s.searchOffset + s.searchRows.length);
        }), { disabled: start + rows.length >= s.searchTotal })); target.append(nav);
        // Two requests at a time, six pictures per page, eight retained sources.
        const worker = async () => {
            while (jobs.length && token === pictureToken) {
                const job = jobs.shift();
                try { const source = await requestSource(job.kind, job.id); if (token === pictureToken && job.canvas.isConnected !== false) ctx.thumbnail?.(job.canvas, source.mesh, source); }
                catch (error) { if (token === pictureToken) job.canvas.title = error.message; }
            }
        };
        void Promise.all([worker(), worker()]);
    }

    async function restoreScope() {
        const project = state.project, token = ++restoreToken;
        const stamp = mesh => JSON.stringify([mesh.faces, mesh.textures, mesh.textureCoords, mesh.textureMappings]);
        const targets = scopeParts().map(p => ({ p, mesh: p.mesh, stamp: stamp(p.mesh) }));
        if (!targets.length) throw new Error('Choose parts to restore.');
        const replacements = []; let restored = 0, skipped = 0;
        ctx.status('Loading source materials...');
        // Process a donor immediately. Retaining all full donor models can be
        // much larger than the small cut pieces in the actual creation.
        for (const target of targets) {
            const p = target.p;
            if (!p || !['npc', 'item'].includes(p.source?.kind)) throw new Error('A part has no cache source to restore.');
            const source = await requestSource(p.source.kind, p.source.id, p.source.variant);
            if (token !== restoreToken || state.project !== project) return;
            if (p.mesh !== target.mesh || stamp(p.mesh) !== target.stamp) throw new Error('The model changed while sources loaded. Restore materials again.');
            const plan = sourceMaterialPlan(p.mesh, source.mesh);
            const mesh = { ...p.mesh, faces: p.mesh.faces.map(f => [...f]), ...(p.mesh.textures && { textures: [...p.mesh.textures] }),
                ...(p.mesh.textureCoords && { textureCoords: [...p.mesh.textureCoords] }), ...(p.mesh.textureMappings && { textureMappings: p.mesh.textureMappings.map(m => [...m]) }) };
            const count = restoreSourceMaterials(mesh, plan); restored += count; skipped += plan.skipped.length;
            if (count) replacements.push([p, mesh]);
        }
        for (const target of targets) if (!parts().includes(target.p) || target.p.mesh !== target.mesh || stamp(target.p.mesh) !== target.stamp)
            throw new Error('The model changed while sources loaded. Restore materials again.');
        preview = null; hover = null;
        if (restored) ctx.change(() => { for (const [p, mesh] of replacements) p.mesh = mesh; });
        else refresh();
        ctx.status(`${restored.toLocaleString()} faces restored.${skipped ? ` ${skipped} changed or ambiguous faces have no safe source match.` : ''}`);
    }

    function hasLinkedTwin(part) {
        const seen = new Set();
        while (part && !seen.has(part.id)) { if (part.pair) return true; seen.add(part.id); part = parts().find(p => p.id === part.parentId); }
        return false;
    }
    function resolveHit(hit, options = s) {
        const part = parts().find(p => p.id === hit?.partId);
        if (!part) return null;
        const id = hit.sourceFaceId ?? hit.faceId % part.mesh.faces.length;
        if (!part.mesh.faces[id]) return null;
        const point = hit.point ?? part.mesh.vertices[part.mesh.faces[id][0]];
        const parent = parts().find(p => p.id === part.parentId);
        const center = localPoint(hit.twin ? reflectPoint(point, parent, parts()) : point, part, parts());
        const selection = options.tool === 'picker' ? { ids: [id], missing: [] }
            : paintHitFaces(part.mesh, id, center, { ...options, topology: topology(part.mesh) });
        return { part, id, ...selection };
    }
    function onHover(hit) {
        syncValues();
        if (state.mode !== 'paint' || !state.project || !hit) { hover = null; return; }
        const resolved = resolveHit(hit);
        if (!resolved || s.tool !== 'picker' && !scopeParts().some(p => p.id === resolved.part.id)) { hover = null; return; }
        const selected = new Map([[resolved.part.id, new Set(resolved.ids)]]);
        if (s.tool === 'colour') {
            const colour = resolved.part.mesh.faces[resolved.id][3];
            for (const p of scopeParts()) selected.set(p.id, new Set(p.mesh.faces.flatMap((f, i) => f[3] === colour && (s.textureMode === 'replace' || (p.mesh.textures?.[i] ?? -1) < 0) ? [i] : [])));
        }
        hover = { selected, missing: resolved.missing.length };
        return hover;
    }
    function faceOverlay(polygon) {
        if (state.mode !== 'paint' || !hover) return null;
        const p = parts().find(p => p.id === polygon.partId); if (!p) return null;
        const id = polygon.sourceFaceId ?? polygon.faceId % p.mesh.faces.length;
        if (!hover.selected.get(p.id)?.has(id)) return null;
        return { fill: 'rgba(239,205,119,.24)', stroke: '#f0d58d', lineWidth: 1.5 };
    }

    function finishStroke() {
        const finished = stroke; stroke = null;
        if (finished?.dirty) {
            ctx.draft?.(); ctx.render();
            ctx.status(`Painted ${finished.painted.toLocaleString()} faces.${finished.linked ? ' Linked twins share these colours.' : ''}${finished.missing ? ' Some strokes have no matching mirror face.' : ''}`);
        }
    }
    function edit(hit, delta, phase = 'move') {
        if (['end', 'cancel'].includes(phase)) { finishStroke(); return; }
        syncValues();
        if (state.mode !== 'paint' || !state.project || !hit) return;
        if (phase === 'start' || !stroke) {
            finishStroke();
            stroke = { project: state.project, dirty: false, painted: 0, touched: new Set(), missing: false, linked: false, options: { ...s, colour: s.material === 'skin' ? NATIVE_SKIN_COLOUR : s.colour }, actionDone: false };
        }
        if (stroke.project !== state.project || stroke.actionDone) return;
        const resolved = resolveHit(hit, stroke.options); if (!resolved) return;
        const { part, id } = resolved, options = stroke.options;
        if (options.tool === 'picker') {
            stroke.actionDone = true; setColour(part.mesh.faces[id][3], false); remember(s.colour); s.tool = 'face'; refresh();
            ctx.status((part.mesh.textures?.[id] ?? -1) >= 0 ? 'Picked the native base colour. Texture pixels are separate.' : 'Picked the exact game colour.'); return;
        }
        if (!scopeParts().some(p => p.id === part.id)) { ctx.status('This part is outside your paint scope. Choose it on the left.'); return; }
        let plan;
        if (options.tool === 'colour') plan = createColourReplacePlan(scopeParts(), part.mesh.faces[id][3], options.colour, options);
        else {
            const ids = resolved.ids.filter(i => !stroke.touched.has(`${part.id}/${i}`));
            // Keep shading on fills/pieces; individual face/round brushes use the
            // chosen exact colour, so repeated dragging cannot drift the colour.
            plan = createBrushPlan(part, ids, options.colour, { ...options, keepShading: options.keepShading && ['fill', 'piece'].includes(options.tool) });
        }
        if (['colour', 'fill', 'piece'].includes(options.tool)) stroke.actionDone = true;
        stroke.missing ||= resolved.missing.length > 0; stroke.linked ||= hasLinkedTwin(part);
        if (!plan.changes.length) { if (phase === 'start' && (part.mesh.textures?.[id] ?? -1) >= 0 && options.textureMode === 'keep') ctx.status('This face has a native texture. Choose Replace textures to paint over it.'); return; }
        if (!stroke.dirty) { ctx.checkpoint(); ctx.stop?.(); }
        applyPaintPlan(parts(), plan);
        for (const c of plan.changes) stroke.touched.add(`${c.partId}/${c.faceId}`);
        stroke.dirty = true; stroke.painted += plan.changes.length; preview = null;
        state.selected = part.id; remember(options.colour); ctx.changed(false);
    }
    function getBrush() {
        if (state.mode !== 'paint' || s.tool !== 'brush') return null;
        const part = parts().find(p => p.id === ctx.viewport?.hoverHit?.partId) ?? ctx.selected?.();
        if (!part) return null;
        const origin = worldPoint([0, 0, 0], part, parts());
        const scale = Math.max(...[0, 1, 2].map(axis => Math.hypot(...worldPoint([0, 0, 0].map((n, i) => i === axis ? 1 : n), part, parts()).map((n, i) => n - origin[i]))));
        return { radius: s.radius * scale, colour: s.material === 'skin' ? SKIN_PREVIEW_HEX : colourHex(s.colour) };
    }
    function onKeyDown(event) {
        if (state.mode !== 'paint' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
            || event.target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target?.tagName ?? '')) return false;
        const key = event.key.toLowerCase(), tools = { f: 'face', b: 'brush', g: 'fill', p: 'piece', c: 'colour', i: 'picker' };
        if (tools[key]) s.tool = tools[key];
        else if (key === 'm') s.mirror = !s.mirror;
        else if (key === '[' || key === ']') s.radius = Math.max(1, Math.min(150, s.radius + (key === '[' ? -2 : 2)));
        else return false;
        event.preventDefault(); hover = null; refresh(); return true;
    }
    return { renderTools, renderProperties, edit, getBrush, onHover, faceOverlay, onKeyDown, syncValues, reset };
}
