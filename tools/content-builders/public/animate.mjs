import {gearPreviewMesh,gearPreviewSequence} from '/shared/gear-preview.mjs';
import { assemble } from '/shared/mesh.mjs';
import { newMotion } from '/shared/project.mjs';
import { createCreatureAttacks } from '/creature-attacks.mjs';
import { attackRole, attackForRole } from '/shared/creature-attacks.mjs';
import { sourceMovements, motionSequence, motionCompatibility, motionPreset, putPose, retimePoses, copyRoleMotion, pasteRoleMotion } from '/shared/motion.mjs';

const ACTIONS = {
    idle: ['Idle', 'While standing still', 'Repeats'], walk: ['Walk', 'While walking', 'Repeats'],
    run: ['Run', 'While running', 'Repeats'], attack: ['Attack', 'When attacking', 'Plays once in game'],
    block: ['Block', 'When hit', 'Plays once in game'], death: ['Death', 'When defeated', 'Plays once in game']
};
// These are basic player demonstrations, not saved equipment overrides. Weapon
// style and combat decide the actual template movement in game.
const PLAYER_PREVIEW = { idle: 808, walk: 819, run: 824, attack: 422, block: 424 };
const sameSource = (a, b) => a?.kind === b?.kind && a?.id === b?.id && a?.variant === b?.variant;
const seconds = n => `${(n / 1000).toFixed(2)} s`;
const cleanName = name => String(name ?? '').replace(/_/g, ' ');
const hash = text => { let value = 2166136261; for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619); return value >>> 0; };

/** Self-contained authoring tab. No additional persisted metadata is required.
 * Call reset() when leaving Animate or replacing a project. The existing viewport
 * play/pause/setItems methods are sufficient for playback and exact frame seeking.
 */
export function createAnimateTab(ctx) {
    const { state, element: el, button, api } = ctx;
    const attacks = createCreatureAttacks(ctx);
    const action = role => { const a=attackForRole(state.project,role); return a?[a.name,'When this attack is chosen','Plays once in game']:ACTIONS[role]; };
    let toolsRoot, propertiesRoot, contextKey, preview, pending, serial = 0, searchSerial = 0, seekSerial = 0;
    let clipboard, sourceJobs = 0, projectId, ticker;
    const sources = new Map(), sourceQueue = [], sequenceNames = new Map();
    const ui = () => state.animateTab ??= { role: state.motionRole ?? 'attack', cursor: 0, donor: null, query: '', sequenceQuery: '', results: [], offset: 0, total: 0, searched: false };
    const roles = () => [...Object.keys(ACTIONS).filter(role => state.project?.kind !== 'gear' || role !== 'death'),...(state.project?.attacks??[]).map(a=>attackRole(a.id))];
    const part = () => {
        const chosen = ctx.selected();
        return chosen && ['all', state.variant].includes(chosen.variant) ? chosen : ctx.activeParts()[0];
    };
    const role = () => roles().includes(state.motionRole) ? state.motionRole : roles().includes(ui().role) ? ui().role : 'attack';
    const motion = p => p.motion ?? newMotion();
    const invalidate = () => { serial++; pending = null; preview = null; };
    function ensureContext() {
        if (projectId !== state.project?.id) {
            projectId = state.project?.id;
            delete state.animateTab; sources.clear(); sourceQueue.length = 0;
            searchSerial++;
        }
        const selected = part();
        if (selected && state.selected !== selected.id) state.selected = selected.id;
        const key = `${state.project?.id}/${part()?.id}/${state.variant}/${role()}`;
        if (contextKey !== key) {
            invalidate(); contextKey = key; ui().cursor = 0; ui().trial = null; state.poseIndex = null;
        }
        state.motionRole = role(); ui().role = role();
    }
    const note = (target, text, warning = false) => target.append(el('p', { class: `animate-note${warning ? ' animate-warning' : ''}`, text }));
    const group = (target, title) => { const area = el('section', { class: 'animate-section' }, el('h3', { text: title })); target.append(area); return area; };
    const actions = target => { const row = el('div', { class: 'animate-actions' }); target.append(row); return row; };
    const run = fn => ctx.safe(fn);
    function mutate(fn) {
        invalidate(); ui().trial = null;
        ctx.change(fn);
    }
    function redraw() { ctx.render(); }
    function requestSource(ref) {
        const variant = ref.variant || (ref.kind === 'npc' ? 'body' : 'inventory'), key = `${ref.kind}/${ref.id}/${variant}`;
        if (!sources.has(key)) {
            const promise = api(`source?kind=${encodeURIComponent(ref.kind)}&id=${ref.id}&variant=${encodeURIComponent(variant)}`)
                .catch(error => { sources.delete(key); throw error; });
            sources.set(key, promise);
            if (sources.size > 16) sources.delete(sources.keys().next().value);
        }
        return sources.get(key);
    }
    function pumpSources() {
        while (sourceJobs < 2 && sourceQueue.length) {
            const job = sourceQueue.shift();
            if (!job.canvas.isConnected) continue;
            sourceJobs++;
            requestSource(job.ref).then(source => {
                if (!job.canvas.isConnected) return;
                ctx.thumbnail(job.canvas, source.mesh);
                job.ready?.(source);
            }).catch(error => {
                if (job.canvas.isConnected) { job.canvas.title = error.message; job.canvas.setAttribute('aria-label', `Preview unavailable. ${error.message}`); }
            }).finally(() => { sourceJobs--; pumpSources(); });
        }
    }
    function picture(target, ref, label, mesh, ready) {
        const canvas = el('canvas', { width: 132, height: 90, 'aria-label': `${label} preview` });
        target.append(canvas);
        if (mesh) ctx.thumbnail(canvas, mesh);
        else { sourceQueue.push({ canvas, ref, ready }); queueMicrotask(pumpSources); }
        return canvas;
    }
    function previewKey(project = state.project) {
        return `${project?.id}/${state.variant}/${role()}/${hash(JSON.stringify(project))}/${hash(ctx.previewContextKey?.()??'')}`;
    }
    async function buildClip(project, action, variant) {
        if (project.kind === 'npc') return api('animate-project', { project, role: action });
        if (!['male', 'female'].includes(variant)) throw new Error('Choose Male worn or Female worn to preview movement on the player rig.');
        const worn = project.parts.filter(p => ['all', variant].includes(p.variant));
        if (!worn.some(p => p.visible)) throw new Error('This worn view has no visible gear. Add a worn model in Build.');
        const together=ctx.gearPreview?.(project,variant);
        const reference=ctx.bodyReference?.()??{visible:true,style:'dummy'};
        const mannequin=await api(`mannequin?gender=${variant}&slots=${encodeURIComponent(together?.slots??project.settings.equipmentType)}&style=${reference.style}`);
        const mesh=gearPreviewMesh(project,variant,mannequin.mesh,{parts:together?.parts??project.parts,...reference});
        const sequence=gearPreviewSequence(project,action,together?.weapon);
        const visualClip=await ctx.previewGearAnimation?.(project,variant,sequence);if(visualClip)return visualClip;
        return api('animate', { mesh, sequence, samples: Math.max(2, Math.min(32, Math.floor(260000 / mesh.vertices.length))) });
    }
    function normalizeClip(clip) {
        if (!clip?.frames?.length) throw new Error('No movement for this action. Borrow a source movement or add two custom poses.');
        const duration = clip.frames.reduce((sum, frame) => sum + frame.duration, 0);
        if (!(duration > 0) || clip.frames.some(frame => !(frame.duration > 0))) throw new Error('This movement has invalid frame timing. Choose another source.');
        return { ...clip, duration };
    }
    async function loadPreview(project = state.project, trialLabel = null) {
        ensureContext();
        const key = previewKey(project);
        if (preview?.key === key && preview.trialLabel === trialLabel) return preview;
        if (pending?.key === key && pending.trialLabel === trialLabel) return pending.promise;
        const token = ++serial, originalKey = previewKey(), originalProject = state.project, selection = part()?.id, mode = state.mode;
        ctx.status('Loading movement...');
        const promise = buildClip(structuredClone(project), role(), state.variant).then(normalizeClip).then(clip => {
            if (token !== serial || state.project !== originalProject || originalKey !== previewKey() || part()?.id !== selection || state.mode !== mode) return null;
            preview = { key, clip, trialLabel }; pending = null;
            ui().cursor = Math.min(ui().cursor, clip.duration); ui().trial = trialLabel;
            return preview;
        }).catch(error => { if (token !== serial || state.project !== originalProject || state.mode !== mode) return null; pending = null; throw error; });
        pending = { key, trialLabel, promise };
        return promise;
    }
    function playbackControls() {
        const animation = ctx.viewport.animation;
        if (animation?.pausedAt === undefined && state.playing) return 'Pause';
        return animation?.pausedAt !== undefined ? 'Resume' : 'Pause';
    }
    function refreshPanels() {
        if (propertiesRoot?.isConnected) renderProperties(propertiesRoot);
    }
    function currentTime() {
        const a = ctx.viewport.animation;
        return a && preview && a.frames === preview.clip.frames ? ((a.pausedAt ?? performance.now()) - a.start) % preview.clip.duration : ui().cursor;
    }
    function startTicker() {
        if (ticker !== undefined) globalThis.cancelAnimationFrame?.(ticker);
        const tick = () => {
            ticker = undefined;
            const a = ctx.viewport.animation;
            if (!preview || !a || a.frames !== preview.clip.frames || state.mode !== 'animate') return;
            ui().cursor = currentTime();
            const range = propertiesRoot?.querySelector('[data-animate-scrub]'), output = propertiesRoot?.querySelector('[data-animate-time]');
            if (range) range.value = String(ui().cursor);
            if (output) output.textContent = `${seconds(ui().cursor)} / ${seconds(preview.clip.duration)}. ${preview.clip.frames.length} frames`;
            if (a.pausedAt === undefined) ticker = globalThis.requestAnimationFrame?.(tick);
        };
        ticker = globalThis.requestAnimationFrame?.(tick);
    }
    async function playPreview(project = state.project, trialLabel = null) {
        ctx.stop(); state.poseIndex = null;
        const result = await loadPreview(project, trialLabel);
        if (!result) return;
        ctx.viewport.play(result.clip); state.playing = true;
        ctx.status(trialLabel ? `Trying ${trialLabel}. Use it to keep this movement.` : `${action(role())[0]} preview. ${action(role())[2]}.`);
        refreshPanels(); startTicker();
    }
    function showFrame(loaded, time) {
        const clip = loaded.clip, cursor = Math.max(0, Math.min(clip.duration, time));
        let elapsed = 0, index = clip.frames.length - 1;
        for (let i = 0; i < clip.frames.length; i++) { elapsed += clip.frames[i].duration; if (cursor < elapsed) { index = i; break; } }
        ctx.stop(); state.poseIndex = null; ui().cursor = cursor; ui().frame = index;
        ctx.viewport.setItems([{ id: 'animation', mesh: { ...clip.mesh, vertices: clip.frames[index].vertices } }]);
        if (propertiesRoot?.isConnected) {
            const range = propertiesRoot.querySelector('[data-animate-scrub]'), output = propertiesRoot.querySelector('[data-animate-time]');
            if (range) { range.max = String(clip.duration); range.value = String(cursor); }
            if (output) output.textContent = `${seconds(cursor)} / ${seconds(clip.duration)}. Frame ${index + 1} of ${clip.frames.length}`;
        }
    }
    async function seek(time) {
        const ticket = ++seekSerial;
        const loaded = ui().trial && preview ? preview : await loadPreview();
        if (loaded && ticket === seekSerial) showFrame(loaded, time);
    }
    async function stepFrame(direction) {
        const loaded = ui().trial && preview ? preview : await loadPreview();
        if (!loaded) return;
        let index = ui().frame ?? 0;
        const a = ctx.viewport.animation;
        if (a) {
            let time = ((a.pausedAt ?? performance.now()) - a.start) % loaded.clip.duration; index = 0;
            while (index < loaded.clip.frames.length - 1 && (time -= loaded.clip.frames[index].duration) >= 0) index++;
        }
        index = Math.max(0, Math.min(loaded.clip.frames.length - 1, index + direction));
        showFrame(loaded, loaded.clip.frames.slice(0, index).reduce((sum, frame) => sum + frame.duration, 0));
    }
    function selectRole(next) {
        ctx.stop(); state.motionRole = next; ui().role = next; state.poseIndex = null;
        ensureContext(); redraw();
    }
    async function chooseSequence(id, name, keep) {
        const target = part();
        if (!target) return;
        const originalProject = state.project, chosenAction = role(), originalContext = contextKey, originalKey = previewKey();
        const candidate = structuredClone(state.project), selected = candidate.parts.find(p => p.id === target.id);
        if (candidate.kind === 'npc') {
            const original = await requestSource(target.source), compatibility = motionCompatibility(target, original, id);
            if (state.mode !== 'animate' || state.project !== originalProject || previewKey() !== originalKey || contextKey !== originalContext || part()?.id !== target.id || role() !== chosenAction) return;
            if (!compatibility.usable) throw new Error(compatibility.text);
            selected.motion ??= newMotion();
            // Own mode ensures that a source sequence also works on a root that
            // previously used poses only. Other parts' settings remain unchanged.
            if(!attackForRole(candidate,chosenAction))selected.motion.mode = 'own'; if(attackForRole(candidate,chosenAction))attackForRole(candidate,chosenAction).parts[selected.id]={sequence:id,speed:1,strength:1};else selected.motion.sequences[chosenAction] = id;
        } else candidate.animations[chosenAction] = id;
        const loaded = await loadPreview(candidate, cleanName(name));
        if (!loaded) return;
        if (keep) {
            mutate(() => {
                if (state.project.kind === 'gear') state.project.animations[role()] = id;
                else if(attacks.selected())attacks.selected().parts[target.id]={sequence:id,speed:1,strength:1};
                else { target.motion ??= newMotion(); target.motion.mode = 'own'; target.motion.sequences[role()] = id; }
            });
            await playPreview();
        } else {
            ctx.stop(); state.poseIndex = null; ctx.viewport.play(loaded.clip); state.playing = true;
            ctx.status(`Trying ${cleanName(name)} on ${target.name}. Click Use to keep it.`); refreshPanels(); startTicker();
        }
    }
    function sequenceChoice(target, id, name, detail = '') {
        const row = el('div', { class: 'animate-sequence' }, el('span', {}, el('strong', { text: cleanName(name) }), detail ? el('small', { text: detail }) : null));
        const controls = actions(row);
        controls.append(button('Try', () => chooseSequence(id, name, false), { 'aria-label': `Try ${cleanName(name)}`, title: 'Preview without changing the saved movement' }),
            button('Use', () => chooseSequence(id, name, true), { 'aria-label': `Use ${cleanName(name)}`, title: `Use for ${action(role())[0].toLowerCase()}`, class: motionSequence(state.project, part(), role()) === id ? 'selected' : '' }));
        target.append(row);
    }
    function sequenceName(target, id) {
        if (id < 0) { target.textContent = state.project.kind === 'gear' ? 'Player / weapon style default' : 'No borrowed movement for this action'; return; }
        if (sequenceNames.has(id)) { target.textContent = sequenceNames.get(id); return; }
        target.textContent = 'Loading movement name...';
        api(`search?kind=seq&q=${id}`).then(result => {
            const name = cleanName(result.rows.find(row => row.id === id)?.name ?? `Cache movement ${id}`);
            sequenceNames.set(id, name); if (sequenceNames.size > 48) sequenceNames.delete(sequenceNames.keys().next().value);
            if (target.isConnected) target.textContent = name;
        }).catch(() => { if (target.isConnected) target.textContent = `Cache movement ${id}`; });
    }
    function donorCard(target, ref, label) {
        const card = button('', () => {
            ui().donor = { kind: ref.kind, id: ref.id, variant: ref.variant || (ref.kind === 'npc' ? 'body' : 'inventory'), name: label };
            ui().sequenceQuery = ''; renderTools(toolsRoot);
        }, { class: 'animate-donor', 'aria-label': `Browse ${label} movements`, 'aria-pressed': sameSource(ui().donor, ref) });
        picture(card, ref, label); card.append(el('span', { text: label })); target.append(card);
    }
    async function searchDonors(target) {
        const token = ++searchSerial, query = ui().query.trim(), kind = state.project.kind === 'gear' ? 'item' : 'npc';
        const result = await api(`search?kind=${kind}&q=${encodeURIComponent(query)}&offset=${ui().offset}&unique=1`);
        if (token !== searchSerial || !target.isConnected) return;
        ui().results = result.rows.slice(0, 12); ui().total = result.total; ui().searched = true;
        // Keep paging at the endpoint's page size, but draw only a small thumbnail
        // batch at a time. All rows remain accessible through the next button.
        ui().pageRows = result.rows; ui().pageStart = 0;
        renderDonorResults(target);
    }
    function renderDonorResults(target) {
        target.replaceChildren();
        const grid = el('div', { class: 'animate-donors' }); target.append(grid);
        const rows = ui().pageRows ?? ui().results;
        rows.slice(ui().pageStart ?? 0, (ui().pageStart ?? 0) + 12).forEach(row => donorCard(grid, { kind: state.project.kind === 'gear' ? 'item' : 'npc', id: row.id, variant: state.project.kind === 'gear' ? 'inventory' : 'body' }, row.name));
        if (!rows.length) note(target, 'No matches. Try another creature or item name.');
        const start = ui().offset + (ui().pageStart ?? 0), paging = actions(target);
        paging.append(button('Previous', () => {
            if (ui().pageStart > 0) { ui().pageStart = Math.max(0, ui().pageStart - 12); renderDonorResults(target); }
            else { ui().offset = Math.max(0, ui().offset - 50); return searchDonors(target).then(() => { ui().pageStart = 48; renderDonorResults(target); }); }
        }, { disabled: start === 0 }), el('span', { class: 'animate-note', text: `${rows.length ? start + 1 : 0}-${Math.min(start + 12, ui().offset + rows.length)} of ${ui().total}` }),
        button('Next', () => {
            if ((ui().pageStart ?? 0) + 12 < rows.length) { ui().pageStart = (ui().pageStart ?? 0) + 12; renderDonorResults(target); }
            else { ui().offset += 50; return searchDonors(target); }
        }, { disabled: start + 12 >= ui().total }));
    }
    function renderDonorMovements(target) {
        const donor = ui().donor;
        if (!donor) return;
        const area = group(target, `${donor.name} movements`), selectedId = part()?.id, chosenRole = role();
        note(area, state.project.kind === 'gear' ? 'These movements play on the player rig. Try the worn gear before using one.' : sameSource(donor, part().source) ? 'This part\'s original movement source.' : 'A different creature may use different joints. Try it on the selected part first.');
        const offered = el('div'); area.append(offered);
        requestSource(donor).then(source => {
            if (!area.isConnected || selectedId !== part()?.id || chosenRole !== role()) return;
            const id = sourceMovements(source)[chosenRole];
            if (id >= 0) sequenceChoice(offered, id, `${source.name} ${action(chosenRole)[0].toLowerCase()}`, 'Source movement');
            else note(offered, `No ${action(chosenRole)[0].toLowerCase()} is listed for this source. Browse its cache movements below.`);
        }).catch(error => { if (area.isConnected) note(offered, error.message, true); });
        const input = el('input', { type: 'search', placeholder: 'Search named movements', 'aria-label': 'Search cache movements', value: ui().sequenceQuery, autocomplete: 'off' });
        const list = el('div', { class: 'animate-sequence-results' });
        let ticket = 0;
        const search = async () => {
            const current = ++ticket, query = input.value.trim() || donor.name.toLowerCase().replace(/\s+/g, '_');
            const result = await api(`search?kind=seq&q=${encodeURIComponent(query)}`);
            if (current !== ticket || !list.isConnected) return;
            list.replaceChildren();
            const matches = result.rows.filter(row => row.frames > 0), preferred = matches.filter(row => cleanName(row.name).toLowerCase().includes(chosenRole));
            const rows = input.value.trim() ? matches : [...preferred, ...matches.filter(row => !preferred.includes(row))];
            rows.slice(0, 16).forEach(row => sequenceChoice(list, row.id, row.name, `${row.frames} frames${row.skeletal ? '. Weighted rig required' : ''}`));
            if (!rows.length) note(list, 'No named movements. Search a creature name, or use a custom pose.');
            if (rows.length > 16 || result.total > 50) note(list, 'Showing the first 16. Add a movement name to narrow the search.');
        };
        input.onkeydown = run(event => { if (event.key === 'Enter') { ui().sequenceQuery = input.value; return search(); } });
        area.append(el('label', { class: 'animate-search' }, 'More movements', input, button('Search', () => { ui().sequenceQuery = input.value; return search(); })), list);
        run(search)();
    }

    function renderTools(target) {
        toolsRoot = target; ensureContext(); target.replaceChildren();
        const root = el('div', { class: 'animate-tab animate-tools' }); target.append(root);
        if (!state.project) { note(root, 'Add a body or item in Build first.'); return; }
        const roleArea = group(root, state.project.kind === 'gear' ? 'Player actions' : 'When it moves');
        const tabs = el('div', { class: 'animate-roles', role: 'group', 'aria-label': 'Movement action' });
        roles().filter(name=>ACTIONS[name]).forEach(name => tabs.append(button(ACTIONS[name][0], () => selectRole(name), { 'aria-pressed': name === role(), title: ACTIONS[name][1] })));
        roleArea.append(tabs); note(roleArea, `${action(role())[1]}. ${action(role())[2]}.`);
        if (state.project.kind === 'gear') note(roleArea, 'Movement belongs to the player wearing this item. Inventory and head previews are static.');
        attacks.renderSelector(root);
        const selected = part();
        if (!selected) { note(root, 'Choose a visible part in this view.'); return; }
        const sourceArea = group(root, 'Movement sources'), grid = el('div', { class: 'animate-donors' }), refs = new Map(); sourceArea.append(grid);
        for (const p of [selected, ...state.project.parts]) {
            if (p.source.kind !== (state.project.kind === 'gear' ? 'item' : 'npc')) continue;
            const ref = { ...p.source, variant: state.project.kind === 'gear' ? 'inventory' : 'body' }, key = `${ref.kind}/${ref.id}`;
            if (!refs.has(key)) refs.set(key, { ref, name: p.name.replace(/.*\(([^()]+)\)$/, '$1') });
        }
        [...refs.values()].slice(0, 6).forEach(({ ref, name }) => donorCard(grid, ref, name));
        const input = el('input', { type: 'search', value: ui().query, placeholder: state.project.kind === 'gear' ? 'Find weapon movements' : 'Find creature movements', 'aria-label': 'Search movement sources', autocomplete: 'off' });
        const results = el('div');
        const search = () => { ui().query = input.value; ui().offset = 0; return searchDonors(results); };
        input.onkeydown = run(event => { if (event.key === 'Enter') return search(); });
        sourceArea.append(el('label', { class: 'animate-search' }, 'Other sources', input, button('Search', search)), results);
        if (ui().searched) renderDonorResults(results);
        renderDonorMovements(root);
        if (state.project.kind === 'npc') {
            const quick = group(root, 'Make a movement'), row = actions(quick);
            for (const name of ['swing', 'flap', 'bob', 'recoil']) row.append(button(name[0].toUpperCase() + name.slice(1), async () => {
                mutate(() => { selected.motion ??= newMotion(); selected.motion.keys[role()] = motionPreset(name); state.poseIndex = 1; ui().cursor = selected.motion.keys[role()][1].time; });
                await playPreview();
            }));
            note(quick, 'Adds four editable poses to this action. Borrowed movement still plays unless you choose Poses only.');
        }
    }

    function currentPicture(target, selected) {
        const figure = el('div', { class: 'animate-selected' }); picture(figure, selected.source, selected.name, selected.mesh);
        const text = el('div', {}, el('strong', { text: selected.name }), el('span', { text: state.project.kind === 'gear' ? 'Worn by the player' : selected.parentId ? `Attached to ${state.project.parts.find(p => p.id === selected.parentId)?.name ?? 'body'}` : 'Creature body' }));
        figure.append(text); target.append(figure);
        if (!selected.visible) note(target, 'This part is hidden. Show it in the parts list to see its movement.', true);
        if (selected.pair) note(target, 'Both mirrored instances use this movement.');
    }
    function numberField(target, label, value, set, { min, max, step = 1 } = {}) {
        const input = el('input', { type: 'number', value, min, max, step, 'aria-label': label });
        input.onchange = run(() => {
            const n = Number(input.value);
            if (!Number.isFinite(n) || n < min || n > max) { input.value = value; throw new Error(`${label} must be between ${min} and ${max}.`); }
            mutate(() => set(n));
        });
        target.append(el('label', { class: 'animate-number' }, label, input)); return input;
    }
    function renderTransport(root) {
        const area = group(root, `${action(role())[0]} preview (repeats)`), row = actions(area), hasClip = !!preview;
        row.append(button('Play', () => playPreview(), { class: 'primary', 'aria-label': `Play ${action(role())[0].toLowerCase()}` }),
            button(playbackControls(), () => { ctx.viewport.pause(); state.playing = ctx.viewport.animation?.pausedAt === undefined; refreshPanels(); startTicker(); }, { disabled: !ctx.viewport.animation }),
            button('Rest pose', () => { invalidate(); ctx.stop(); ui().cursor = 0; ui().frame = 0; ui().trial = null; state.poseIndex = null; ctx.renderView(); refreshPanels(); }));
        if (ui().trial) note(area, `Trying ${ui().trial}. The saved movement has not changed.`);
        const range = el('input', { type: 'range', min: 0, max: preview?.clip.duration ?? 1, step: 1, value: ui().cursor, disabled: !hasClip, 'aria-label': 'Preview position', 'data-animate-scrub': '' });
        range.oninput = run(() => seek(Number(range.value)));
        const output = el('output', { 'data-animate-time': '', text: hasClip ? `${seconds(ui().cursor)} / ${seconds(preview.clip.duration)}. ${preview.clip.frames.length} frames` : 'Play to load frames, then drag to inspect the movement.' });
        area.append(el('label', { class: 'animate-scrub' }, 'Scrub movement', range, output));
        const steps = actions(area);
        steps.append(button('Previous frame', () => stepFrame(-1), { disabled: !hasClip }), button('Next frame', () => stepFrame(1), { disabled: !hasClip }));
    }
    function renderGear(root, selected) {
        const area = group(root, 'Player rig'), row = actions(area);
        for (const [variant, label] of [['male', 'Male worn'], ['female', 'Female worn']]) row.append(button(label, async () => {
            ctx.stop(); state.variant = variant; state.selected = ctx.activeParts()[0]?.id; state.reference = null; state.poseIndex = null; ensureContext(); await ctx.updateReference(); redraw();
        }, { 'aria-pressed': state.variant === variant }));
        if (!['male', 'female'].includes(state.variant)) { note(area, 'Choose a worn view to inspect your item on a moving player. Inventory and head models do not have independent animations.'); return; }
        note(area, `${action(role())[1]}. The player and the visible worn gear move together.`);
        const current = el('p', { class: 'animate-source-name' }); sequenceName(current, state.project.animations[role()]); area.append(current);
        if (state.project.animations[role()] < 0) note(area, 'Preview uses a basic player movement. The weapon style can choose a different default in game.');
        const controls = actions(area);
        controls.append(button('Use player default', () => mutate(() => state.project.animations[role()] = -1), { disabled: state.project.animations[role()] < 0 }));
        if (state.project.parts.some(p => ['own', 'still'].includes(p.motion?.mode) || Object.values(p.motion?.keys ?? {}).some(keys => keys.length))) {
            note(area, 'This project contains creature-only part movement. Gear export needs the player rig.', true);
            controls.append(button('Use player rig for all gear parts', () => mutate(() => { state.project.parts.forEach(p => p.motion = newMotion()); })));
        }
        renderTransport(root);
        const source = group(root, 'Item source');
        note(source, 'Choose a pictured weapon on the left, then Try or Use its player movement. Custom creature poses do not export on gear.');
        source.append(button('Restore item source movements', async () => {
            const project = state.project, original = await requestSource({ kind: 'item', id: project.baseId, variant: 'inventory' });
            if (state.project !== project) return;
            mutate(() => { const moves = sourceMovements(original); for (const action of roles()) project.animations[action] = moves[action]; });
        }));
    }
    function renderPoses(root, selected) {
        const area = group(root, `${action(role())[0]} poses`), keys = motion(selected).keys?.[role()] ?? [], strip = el('div', { class: 'animate-pose-strip', role: 'group', 'aria-label': `${action(role())[0]} poses` });
        keys.forEach((key, index) => strip.append(button(seconds(key.time), () => {
            ctx.stop(); state.poseIndex = index; ui().cursor = key.time; ctx.renderView(); refreshPanels();
        }, { 'aria-pressed': state.poseIndex === index, title: `Edit pose ${index + 1}` })));
        area.append(strip);
        if (!keys.length) note(area, 'Use Swing, Flap, Bob or Recoil to start, or add a pose and rotate the part.');
        const row = actions(area);
        row.append(button('Add / edit pose here', () => {
            const time = Math.min(8000, currentTime());
            mutate(() => {
                selected.motion ??= newMotion(); selected.motion.keys[role()] = putPose(keys, time);
                state.poseIndex = selected.motion.keys[role()].findIndex(key => key.time === Math.round(time / 20) * 20); ui().cursor = time;
            });
        }, { disabled: ui().cursor > 8000 || keys.length >= 32 && !keys.some(key => key.time === Math.round(ui().cursor / 20) * 20) }),
        button('Add next pose', () => mutate(() => {
            const time = keys.length ? keys.at(-1).time + 200 : 0;
            selected.motion ??= newMotion(); selected.motion.keys[role()] = putPose(keys, time); state.poseIndex = selected.motion.keys[role()].length - 1; ui().cursor = time;
        }), { disabled: keys.length >= 32 || (keys.at(-1)?.time ?? 0) + 200 > 8000 }));
        const key = keys[state.poseIndex];
        if (!key) return;
        note(area, `Editing pose ${state.poseIndex + 1} at ${seconds(key.time)}. These offsets move only ${selected.name}.`);
        numberField(area, 'Pose time (seconds)', key.time / 1000, value => {
            const time = Math.round(value * 50) * 20;
            if (keys.some(other => other !== key && other.time === time)) throw new Error('A pose already uses that time.');
            key.time = time; keys.sort((a, b) => a.time - b.time); state.poseIndex = keys.indexOf(key); ui().cursor = time;
        }, { min: 0, max: 8, step: .02 });
        for (const [label, axis] of [['Swing', 0], ['Twist', 1], ['Tilt', 2]]) ctx.slider(area, label, key.rotation[axis], value => { invalidate(); key.rotation[axis] = value; }, { min: -180, max: 180, step: 1 });
        const detail = ctx.disclosure(area, 'Move and stretch this pose');
        for (const [label, axis] of [['Side', 0], ['Up / down', 1], ['Forward', 2]]) ctx.slider(detail, label, key.position[axis], value => { invalidate(); key.position[axis] = value; }, { min: -250, max: 250, step: 1 });
        for (const [label, axis] of [['Width', 0], ['Height', 1], ['Length', 2]]) ctx.slider(detail, label, key.scale[axis], value => { invalidate(); key.scale[axis] = value; }, { min: .1, max: 3, step: .01 });
        const edit = actions(area);
        edit.append(button('Reset pose', () => mutate(() => { key.position = [0, 0, 0]; key.rotation = [0, 0, 0]; key.scale = [1, 1, 1]; })),
            button('Remove pose', () => mutate(() => { keys.splice(state.poseIndex, 1); state.poseIndex = null; }), { class: 'danger' }));
    }
    function renderProperties(target) {
        propertiesRoot = target; ensureContext(); target.replaceChildren();
        const root = el('div', { class: 'animate-tab animate-properties' }); target.append(root);
        if (!state.project) return;
        const selected = part();
        if (selected) currentPicture(root, selected);
        if (state.project.kind === 'gear') { renderGear(root, selected); return; }
        if (!selected) { note(root, 'Choose a part in this view.'); return; }
        attacks.renderProperties(root);
        if(selected.mesh.vertexLinks){note(root,'This connection follows both endpoints. Edit the original parts to change movement.');renderTransport(root);return;}
        const area = group(root, 'Movement for all actions'), m = motion(selected), choose = el('div', { class: 'animate-mode', role: 'group', 'aria-label': 'Part movement mode for all actions' });
        for (const [mode, label] of [['follow', selected.parentId ? 'Follow body' : 'Body movement'], ['own', 'Source + poses'], ['still', 'Poses only']]) choose.append(button(label, () => mutate(() => { selected.motion ??= newMotion(); selected.motion.mode = mode; state.poseIndex = null; }), { 'aria-pressed': m.mode === mode }));
        area.append(choose);
        note(area, m.mode === 'follow' ? selected.parentId ? 'Follows its parent attachment. Add poses for extra movement.' : 'Uses the body movement for each action. Add poses to adjust it.' : m.mode === 'own' ? 'Plays its own source movement while following the parent attachment. Add poses to adjust it.' : 'Uses your poses and follows its parent attachment. Borrowed sequences are turned off for this part.');
        const current = el('p', { class: 'animate-source-name' });
        if (m.mode === 'follow' && selected.parentId) current.textContent = `Follows ${state.project.parts.find(p => p.id === selected.parentId)?.name ?? 'body'}`;
        else if (m.mode === 'still') current.textContent = 'Your custom poses';
        else sequenceName(current, motionSequence(state.project, selected, role()));
        area.append(current);
        const sourceButton = button("Use this part's source movements", async () => {
            const project = state.project, id = selected.id, source = await requestSource(selected.source);
            if (state.mode !== 'animate' || state.project !== project || part()?.id !== id) return;
            const moves = sourceMovements(source);
            if (!Object.values(moves).some(value => value >= 0)) throw new Error('This source has no listed movements. Choose a pictured source or make a custom movement.');
            mutate(() => {
                selected.motion ??= newMotion(); selected.motion.mode = 'own'; selected.motion.sequences = moves;
                selected.motion.speed = 1; selected.motion.phase = 0; selected.motion.strength = 1;
            });
            if (moves[role()] >= 0 || (selected.motion.keys[role()]?.length ?? 0) > 1) await playPreview();
            else ctx.status(`Source movements restored. No ${action(role())[0].toLowerCase()} is listed. Choose another action or make poses.`);
        }, { disabled: selected.source.kind !== 'npc' });
        area.append(sourceButton);
        if (m.mode === 'own') {
            const compatibility = el('p', { class: 'animate-note', text: 'Checking source joints...' }); area.append(compatibility);
            requestSource(selected.source).then(source => { if (compatibility.isConnected) {
                const result = motionCompatibility(selected, source, motionSequence(state.project, selected, role())); compatibility.textContent = result.text; compatibility.classList.toggle('animate-warning', !result.usable);
            } }).catch(error => { if (compatibility.isConnected) { compatibility.textContent = error.message; compatibility.classList.add('animate-warning'); } });
        }
        renderTransport(root); renderPoses(root, selected);
        const edit = group(root, 'Reuse movement'), row = actions(edit);
        row.append(button('Copy movement', () => {
            clipboard = copyRoleMotion(selected, role());
            // Root follow mode stores its sequence in project.animations.
            if (!selected.parentId && clipboard.mode === 'follow') { clipboard.mode = 'own'; clipboard.sequence = state.project.animations[role()]; }
            ui().copied = `${selected.name} ${action(role())[0].toLowerCase()}`; refreshPanels(); ctx.status(`Copied ${ui().copied}.`);
        }), button('Copy poses only', () => {
            clipboard = { ...copyRoleMotion(selected, role()), mode: 'still', sequence: -1, speed: 1, phase: 0, strength: 1 };
            ui().copied = `${selected.name} ${action(role())[0].toLowerCase()} poses`; refreshPanels(); ctx.status(`Copied ${ui().copied}.`);
        }, { disabled: !m.keys?.[role()]?.length }),
        button('Paste movement', () => mutate(() => { selected.motion = pasteRoleMotion(motion(selected), role(), clipboard, sameSource(selected.source, clipboard?.source)); state.poseIndex = null; }), { disabled: !clipboard }),
        button('Clear these poses', () => mutate(() => { selected.motion ??= newMotion(); selected.motion.keys[role()] = []; state.poseIndex = null; }), { disabled: !m.keys?.[role()]?.length }));
        if (clipboard) note(edit, `Copied ${ui().copied}. Paste replaces this action and this part's movement mode.`);
        const timing = ctx.disclosure(root, 'Timing and strength');
        note(timing, 'Source controls affect every borrowed action on this part. Pose length affects only the selected action.');
        if (m.mode !== 'still' && (m.mode === 'own' || !selected.parentId)) {
            ctx.slider(timing, 'Source speed', m.speed, value => { invalidate(); selected.motion ??= newMotion(); selected.motion.speed = value; }, { min: .1, max: 4, step: .05 });
            ctx.slider(timing, 'Source offset', m.phase, value => { invalidate(); selected.motion ??= newMotion(); selected.motion.phase = value; }, { min: 0, max: 1, step: .01 });
            ctx.slider(timing, 'Source strength', m.strength, value => { invalidate(); selected.motion ??= newMotion(); selected.motion.strength = value; }, { min: 0, max: 2, step: .05 });
        }
        const keys = m.keys?.[role()] ?? [];
        if (keys.length > 1) {
            numberField(timing, 'Pose length (seconds)', keys.at(-1).time / 1000, value => { selected.motion.keys[role()] = retimePoses(keys, value * 1000); state.poseIndex = null; }, { min: .02, max: 8, step: .02 });
            actions(timing).append(button('Close pose loop', () => mutate(() => {
                const first = keys[0], last = keys.at(-1); for (const name of ['position', 'rotation', 'scale']) last[name] = [...first[name]];
            })));
        }
        actions(timing).append(button('Reset source timing', () => mutate(() => { selected.motion ??= newMotion(); Object.assign(selected.motion, { speed: 1, phase: 0, strength: 1 }); })));
    }
    function onKeyDown(event) {
        if (state.mode !== 'animate' || !state.project || event.ctrlKey || event.metaKey || event.altKey || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY'].includes(event.target?.tagName) || event.target?.isContentEditable) return false;
        if (event.code === 'Space') { event.preventDefault(); run(() => {
            if (ctx.viewport.animation) { ctx.viewport.pause(); state.playing = ctx.viewport.animation.pausedAt === undefined; refreshPanels(); startTicker(); }
            else return playPreview();
        })(); return true; }
        if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); run(() => stepFrame(event.key === 'ArrowRight' ? 1 : -1))(); return true; }
        return false;
    }
    function reset() {
        if (ticker !== undefined) globalThis.cancelAnimationFrame?.(ticker);
        ticker = undefined; attacks.reset(); invalidate(); searchSerial++; seekSerial++; contextKey = null;
        sourceQueue.length = 0; sources.clear(); state.poseIndex = null;
        if (state.animateTab) { state.animateTab.cursor = 0; state.animateTab.trial = null; }
    }
    return { renderTools, renderProperties, onKeyDown, syncValues: () => { ensureContext(); refreshPanels(); }, reset,
        renderAttackSelector: attacks.renderSelector, renderAttackProperties: attacks.renderProperties,
        attackOptions: () => (state.project?.attacks??[]).map(a=>({value:attackRole(a.id),name:a.name,style:a.style})),
        playRole: action => { if (!roles().includes(action)) throw new Error('Choose a supported movement action.'); selectRole(action); return playPreview(); } };
}
