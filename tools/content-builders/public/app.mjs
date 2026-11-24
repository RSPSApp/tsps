import {createGearVisualsTab} from '/gear-visuals.mjs';
import {gearPreviewMesh,gearPreviewSequence,PLAYER_PREVIEW} from '/shared/gear-preview.mjs';
import {createSaveConflictRecovery} from '/save-conflicts.mjs';
import { createCombatEffectsEditor } from '/combat-effects.mjs';
import { assemble, bounds, extract, isConnection, connectionDependents, localPoint, reflectPoint, worldPoint, partScaleAxes, hslRgb } from '/shared/mesh.mjs';
import { PREVIEW_SCENES, NEUTRAL_SKIN_HSL } from '/shared/preview-scenes.mjs';
import { makePart } from '/shared/project.mjs';
import { validateDocument, isGearSet, documentItems, equipmentSlot, equippedItems, equippedParts, setPreviewItems } from '/shared/gear-set.mjs';
import { createGearSetEditor } from '/gear-set.mjs';
import { hasOwnMotion } from '/shared/motion.mjs';
import { Viewport, thumbnail } from '/viewport.mjs';
import { createLibrary } from '/library.mjs';
import { createGameDataTab } from '/data.mjs';
import { createBuildTab } from '/build.mjs';
import { createPartClipboard } from '/part-clipboard.mjs';
import { createGearViews } from '/gear-views.mjs';
import { createPaintTab } from '/paint.mjs';
import { createSculptTab } from '/sculpt.mjs';
import { createAnimateTab } from '/animate.mjs';
const $ = id => document.getElementById(id);
const requestedView = new URLSearchParams(location.search).get('view');
let workspace = ['npc', 'gear'].includes(requestedView) ? requestedView : null;
const legacyEntry = !workspace;
let switchingWorkspace = false;
let initialized = false;
const roles = ['idle', 'walk', 'run', 'attack', 'block', 'death'];
const views = [['inventory', 'Inventory'], ['male', 'Male worn'], ['female', 'Female worn'], ['maleHead', 'Male head'], ['femaleHead', 'Female head']];
let bodyReferencePreference = null;
const state = { gearSet:null, previewSet:true, setEquipment:{}, project: null, revision: null, selected: null, source: null, mode: 'build', variant: 'body', history: [], future: [], dirty: false, colour: '#b99558', paintTool: 'face', radius: 22, amount: 4, playing: false, info: null, reference: null, sections: {}, checked: null, sculptTool: 'pull', isolate: false };
let draftTimer, animationToken = 0, creating = false, transformSession = null;
let tabs = {};
const activeTab = () => tabs[state.mode];
function resetTabs() { for (const tab of Object.values(tabs)) tab.reset?.(); combatEffects?.reset(); }
function element(tag, attrs = {}, ...children) { const e = document.createElement(tag); for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on'))
        e.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class')
        e.className = value;
    else if (key === 'text')
        e.textContent = value;
    else if (key in e)
        e[key] = value;
    else
        e.setAttribute(key, value);
} e.append(...children.filter(v => v !== null && v !== undefined && v !== false).map(c => typeof c === 'string' ? document.createTextNode(c) : c)); return e; }
function safe(fn) { return async (...args) => { try {
    return await fn(...args);
}
catch (error) {
    status(error.message, true);
} }; }
const button = (text, fn, attrs = {}) => element('button', { text, onClick: safe(fn), ...attrs });
function status(message, error = false) { $('status').textContent = message; $('status').dataset.error = error; }
async function request(route,data){const response=await fetch(`/api/${route}`,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error??'Request failed.'),{status:response.status,conflict:result.conflict});return result;}
async function api(route,data){try{const result=await request(route,data===undefined?undefined:{...data,editor:conflicts.metadata()});if(data!==undefined)conflicts.saved(result);return result;}catch(error){if(error.status===409)void conflicts.show(error,{route,data}).catch(e=>status(e.message,true));throw error;}}
const conflicts=createSaveConflictRecovery({state,element,button,document:currentDocument,label:()=>`${state.project?.name??'Creator'} · ${document.querySelector(`[data-mode="${state.mode}"]`)?.textContent??state.mode} · ${views.find(([id])=>id===state.variant)?.[1]??state.variant}`,request,download,status,load:(result,context)=>{useProject({...result,activeItemId:context.activeItemId,variant:context.variant});setMode(context.mode);},accept:(result)=>{state.revision=result.revision;mergeIdentities(currentDocument(),result.project);state.dirty=JSON.stringify(currentDocument())!==JSON.stringify(result.project);draft();render();}});
function download(data, name, type = 'application/json') { const url = URL.createObjectURL(new Blob([data], { type })); const a = element('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
const selected = () => state.project?.parts.find(p => p.id === state.selected);
const activeParts = () => state.project?.parts.filter(p => p.visible && (p.variant === state.variant || p.variant === 'all')) ?? [];
function currentDocument() {
    if(!state.gearSet)return state.project;
    const index=state.gearSet.items.findIndex(item=>item.id===state.project.id);
    if(index>=0)state.gearSet.items[index]=state.project;
    return state.gearSet;
}
function restoreDocument(value,activeId=state.project?.id) {
    state.gearSet=isGearSet(value)?value:null;
    state.project=state.gearSet?(value.items.find(item=>item.id===activeId)??value.items[0]):value;
}
function mergeIdentities(target,source) {
    for(const item of documentItems(target)){const saved=documentItems(source).find(row=>row.id===item.id);if(saved)Object.assign(item.ids,saved.ids);}
}
async function refreshSetPreview(){stop();await updateReference();render();viewport.fit();draft();}
function rememberSetEquipment(item){
    const slot=equipmentSlot(item);if(slot<0)return;
    const weapon=equippedItems(state.gearSet,state.setEquipment).find(item=>equipmentSlot(item)===3);
    state.setEquipment[slot]=item.id;
    if(slot===3&&item.settings.doubleHanded)state.setEquipment[5]=null;
    if(slot===5&&weapon?.settings.doubleHanded)state.setEquipment[3]=null;
}
async function switchSetItem(id,force=false){
    if(!state.gearSet||(!force&&id===state.project.id))return;
    activeTab()?.edit?.(null,null,'end');stop();currentDocument();resetTabs();
    state.project=state.gearSet.items.find(item=>item.id===id)??state.gearSet.items[0];
    rememberSetEquipment(state.project);state.selected=activeParts()[0]?.id;state.isolate=false;state.placement=null;state.ghost=null;state.poseIndex=null;
    await refreshSetPreview();
}
function adoptSet(result,activeId){restoreDocument(validateDocument(result.project),activeId);state.revision=result.revision;state.dirty=false;state.checked=null;resetTabs();rememberSetEquipment(state.project);state.selected=activeParts()[0]?.id;draft();safe(refreshSetPreview)();}
async function openSetBonus(){
    const owner=state.gearSet.items.find(item=>item.effects?.passives.some(effect=>effect.set))??(equipmentSlot(state.project)>=0?state.project:state.gearSet.items.find(item=>equipmentSlot(item)>=0));
    if(owner&&owner.id!==state.project.id)await switchSetItem(owner.id);
    setMode('set-effects');
}
async function reassignExportIds(){
    const snapshot=structuredClone(currentDocument()),stamp=JSON.stringify(snapshot);
    const result=await api('reassign',{project:snapshot});
    if(JSON.stringify(currentDocument())!==stamp){status('The project changed while IDs were being assigned. Try again.',true);return;}
    change(()=>mergeIdentities(currentDocument(),result.project));status(`Assigned fresh IDs to ${state.gearSet?'the gear set':'this creation'}. Export a new package to use them.`);
}
async function saveSeparateSetCopy(){
    const snapshot=structuredClone(currentDocument()),stamp=JSON.stringify(snapshot),activeId=state.project.id;
    const result=await api('import',{project:snapshot});
    if(JSON.stringify(currentDocument())!==stamp){status(`Saved a separate copy of ${snapshot.name}. Find it in Open. Your newer edits are still here.`);return;}
    const value=validateDocument(result.project);
    // Import retains member and part identities; only the envelope and game IDs change.
    restoreDocument(value,activeId);state.revision=result.revision;state.dirty=false;state.checked=null;
    for(const key of ['history','future'])state[key]=state[key].map(raw=>{const entry=JSON.parse(raw);entry.id=value.id;mergeIdentities(entry,value);return JSON.stringify(entry);});
    await writeDraft();render();status(`Saved a separate copy of ${value.name}. Your guides are still open.`);
}
function checkpoint() { if (!state.project)
    return; const snapshot = JSON.stringify(currentDocument()); if (state.history.at(-1) !== snapshot)
    state.history.push(snapshot); while (state.history.length > 18 || state.history.length > 1 && state.history.reduce((n, t) => n + t.length, 0) > 28 * 1024 * 1024)
    state.history.shift(); state.future = []; }
function stop() { animationToken++; state.playing = false; viewport.stop(); if ($('pause'))
    $('pause').textContent = 'Pause'; }
function changed(refresh = true) { state.dirty = true; state.checked = null; stop(); draft(); if (refresh)
    render();
else {
    renderView();
    $('save-state').textContent = 'Unsaved';
} }
function change(fn, refresh = true) { if (!state.project)
    return; document.querySelectorAll('#properties details').forEach(d => state.sections[d.querySelector('summary').textContent] = d.open); checkpoint(); fn(); changed(refresh); }
function undo(redo = false) { const from = redo ? state.future : state.history, to = redo ? state.history : state.future; if (!from.length || !state.project)
    return; to.push(JSON.stringify(currentDocument())); const previousId=state.project.id;restoreDocument(JSON.parse(from.pop()));if(state.project.id!==previousId)resetTabs(); if (!selected())
    state.selected = activeParts()[0]?.id; changed(); if(state.gearSet)safe(refreshSetPreview)(); }
const draftDb = new Promise((resolve, reject) => { const r = indexedDB.open('tsps-content-forge', 1); r.onupgradeneeded = () => r.result.createObjectStore('drafts'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
async function writeDraft() {
    clearTimeout(draftTimer);
    // Capture this workspace before waiting for IndexedDB, including an empty draft.
    const kind = workspace ?? $('project-kind').value;
    const value = structuredClone({ project: currentDocument(), activeItemId:state.project?.id, variant:state.variant, previewSet:state.previewSet, setEquipment:state.setEquipment, revision: state.revision, dirty: state.dirty });
    const db = await draftDb; await new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts');
    if (legacyEntry) store.put(value, 'active');
    store.put(value, `workspace:${kind}`);
    tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Browser draft unavailable. Save the project.'));
}); }
function draft() { clearTimeout(draftTimer); draftTimer = setTimeout(safe(writeDraft), 300); }
async function restoreDraft() {
    const db = await draftDb;
    const read = key => new Promise((resolve, reject) => { const r = db.transaction('drafts').objectStore('drafts').get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    if (!workspace) return read('active');
    const saved = await read(`workspace:${workspace}`);
    if (saved) return saved;
    const legacy = await read('active');
    return legacy?.project?.kind === workspace ? legacy : null;
}
function mayReplace() { return !state.dirty || confirm('Replace this project? Save it first to keep unsaved changes.'); }
function useProject(result) { stop(); resetTabs(); restoreDocument(validateDocument(result.project),result.activeItemId); workspace ??= state.project.kind; state.revision = result.revision ?? null; state.variant = result.variant??(state.project.kind === 'npc' ? 'body' : state.gearSet?'male':'inventory');state.previewSet=result.previewSet??true;state.setEquipment=result.setEquipment??{};if(state.gearSet)rememberSetEquipment(state.project); state.selected = activeParts()[0]?.id; state.history = []; state.future = []; state.dirty = result.dirty ?? false; state.reference = null; state.mode = 'build'; state.isolate=false;state.placement=null;state.ghost=null; state.checked = null; $('project-kind').value = state.project.kind;if(state.gearSet&&bodyReferencePreference===null)$('mannequin').checked=true; draft(); render(); viewport.fit();if(state.gearSet)safe(refreshSetPreview)();else if(state.project.kind==='gear')safe(async()=>{await updateReference();renderView();})(); }
async function save() { if (!state.project)return;
    const project=structuredClone(currentDocument()),id=project.id;
    const result=await api('save',{project,revision:state.revision});
    if(currentDocument()?.id!==id)return;
    state.revision=result.revision;mergeIdentities(currentDocument(),result.project);mergeIdentities(project,result.project);
    state.dirty=JSON.stringify(project)!==JSON.stringify(currentDocument());await writeDraft();render();status(`Saved ${project.name}`);
}
function setMode(mode) { if(mode===state.mode)return; stop(); activeTab()?.edit?.(null,null,'end'); if(['animate','paint'].includes(state.mode))activeTab()?.reset?.(); state.placement=null; state.ghost=null; state.mode = mode; state.poseIndex=null; render(); document.querySelector('.inspector').scrollTop=0; }
function renderView() { viewport.skinOverlay = state.project?.kind === 'gear'; viewport.skinPreviewColour = $('reference-style').value === 'character' && $('mannequin').checked && ['male','female'].includes(state.variant) && state.mode !== 'paint' ? hslRgb(NEUTRAL_SKIN_HSL) : null; const parts = activeParts().filter(p => !state.isolate || p.id === state.selected), posed=state.project?.parts.map(p=>{const key=p.id===state.selected&&state.mode==='animate'&&state.poseIndex!==null?p.motion?.keys?.[state.motionRole??'attack']?.[state.poseIndex]:null;return key?{...p,position:p.position.map((n,i)=>n+key.position[i]),rotation:p.rotation.map((n,i)=>n+key.rotation[i]),scale:p.scale.map((n,i)=>n*key.scale[i])}:p;})??[], items = parts.map(p => ({ id: p.id, selected: p.id === state.selected, mesh: assemble(posed, state.variant, new Set([p.id])) })); if(state.gearSet&&state.previewSet&&!state.isolate)items.unshift(...setPreviewItems(currentDocument(),state.variant,state.setEquipment,state.project.id)); if ($('mannequin').checked && state.reference && ['male', 'female'].includes(state.variant))
    items.unshift({ id: 'reference', mesh: state.reference, reference: true, opacity: $('reference-style').value === 'character' ? 1 : .4 }); if(state.ghost&&state.project)items.push({id:'placement-preview',reference:true,mesh:assemble([...state.project.parts,state.ghost],state.variant,new Set([state.ghost.id]))});viewport.setItems(items); tabs.visuals?.invalidate(); const faces = items.filter(p => !p.reference).reduce((n, p) => n + p.mesh.faces.length, 0); $('mesh-count').textContent = faces ? `${parts.length} parts · ${faces.toLocaleString()} faces` : ''; $('empty').hidden = !!faces; }
function renderContext() {
    const kind = state.project?.kind ?? workspace ?? 'npc', gear = kind === 'gear';
    if(!gear&&state.mode==='visuals')state.mode='build';
    document.title = `${gear ? 'Gear' : 'NPC'} Creator | TSPS`;
    document.body.dataset.workspace = kind;
    document.querySelectorAll('[data-mode="special"],[data-mode="set-effects"],[data-mode="visuals"]').forEach(b=>b.hidden=!gear);
    document.querySelectorAll('[data-workspace]').forEach(link => {
        if (link.dataset.workspace === kind) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
    $('name').placeholder = gear ? 'Untitled gear' : 'Untitled NPC';
    document.querySelector('.library').setAttribute('aria-label', gear ? 'Gear tools' : 'NPC tools');
    $('empty').textContent = gear ? 'Add an item to start' : 'Add a creature body to start';
    $('view').setAttribute('aria-label', `${gear ? 'Gear' : 'NPC'} preview. Drag parts to move. Right drag to orbit. Shift drag to pan. Scroll to zoom.`);
    document.querySelector('#projects-dialog h2').textContent = gear ? 'Open gear project' : 'Open NPC project';
}
function render() { conflicts.update(); renderContext(); gearSetEditor.render(); const p = state.project; const inspector=document.querySelector('.inspector'),assembly=document.querySelector('.assembly');inspector.dataset.job=state.mode;assembly.hidden=state.mode==='data';if(['paint','sculpt','animate'].includes(state.mode))$('properties').before(assembly);else inspector.append(assembly); for (const id of ['save', 'download', 'export'])
    $(id).disabled = !p; $('name').disabled = !p; $('name').value = p?.name ?? ''; $('save-state').textContent = p ? (state.dirty ? 'Unsaved' : 'Saved') : ''; $('undo').disabled = !state.history.length; $('redo').disabled = !state.future.length; document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === state.mode)); $('reference-label').hidden = p?.kind !== 'gear'; $('reference-style-label').hidden = p?.kind !== 'gear'; $('reference-style').disabled = !$('mannequin').checked || !['male','female'].includes(state.variant); $('variant').hidden = p?.kind !== 'gear'; const variants = p?.kind === 'gear' ? views : [['body', 'Creature body']]; $('variant').replaceChildren(...variants.map(([value, text]) => element('option', { value, text, selected: value === state.variant }))); document.querySelectorAll('[data-animation]').forEach(b => b.disabled = !p || (p.kind==='gear'?(!['male','female'].includes(state.variant)||!(b.dataset.animation in PLAYER_PREVIEW)):(p.animations[b.dataset.animation] < 0 && !p.parts.some(part=>(part.motion?.sequences?.[b.dataset.animation]??-1)>=0 || (part.motion?.keys?.[b.dataset.animation]?.length??0)>1)))); const attackOptions=tabs.animate.attackOptions();$('attack-preview').hidden=!attackOptions.length;$('attack-preview').replaceChildren(element('option',{value:'',text:'Preview attack…'}),...attackOptions.map(option=>element('option',{value:option.value,text:option.name}))); $('pause').disabled = !p; $('rest').disabled = !p; $('export-download').disabled = !state.checked; renderView(); renderProperties(); renderParts(); renderTools(); combatEffects.render(); }
function descendants(id) { const ids = new Set([id]); for (const key of ids)
    for (const part of state.project.parts)
        if (part.parentId === key)
            ids.add(part.id); return ids; }
function renderParts() { const target = $('parts'); target.replaceChildren(); document.querySelector('.assembly h3').textContent = (state.project?.kind ?? workspace) === 'gear' ? 'Item parts' : 'Creature parts'; if (!state.project)
    return; const parts = state.project.parts.filter(p => p.variant === state.variant || p.variant === 'all'); const append = (part, depth = 0) => { const check = element('input', { type: 'checkbox', checked: part.visible, 'aria-label': `Show ${part.name}`, onChange: () => change(() => {
            part.visible = check.checked;
            if (!part.visible) { const ids=connectionDependents(state.project.parts,new Set([part.id])); for (const dependent of state.project.parts) if (ids.has(dependent.id)) dependent.visible=false; }
            else if (isConnection(part)) for (const ref of part.mesh.vertexLinks) state.project.parts.find(p=>p.id===ref.partId).visible=true;
        }) }); const row = element('div', { class: 'part', style: `padding-left:${Math.min(depth, 8) * 12}px` }, check, button(part.name, () => { state.selected = part.id; state.poseIndex=null; stop(); render(); }, { class: state.selected === part.id ? 'selected' : '', title: part.name })); target.append(row); parts.filter(p => p.parentId === part.id).forEach(p => append(p, depth + 1)); }; parts.filter(p => !p.parentId).forEach(p => append(p)); }
function field(parent, label, value, fn, options = {}) { const input = options.values ? element('select', { 'aria-label': label }, ...options.values.map(v => element('option', { value: Array.isArray(v) ? v[0] : v, text: Array.isArray(v) ? v[1] : v, selected: String(Array.isArray(v) ? v[0] : v) === String(value) }))) : element(options.multiline ? 'textarea' : 'input', { value, 'aria-label': label, ...(!options.multiline && { type: options.type ?? 'number' }), ...(options.min !== undefined && { min: options.min }), ...(options.max !== undefined && { max: options.max }), step: options.step ?? 1 }); input.addEventListener('change', safe(() => change(() => fn(options.numeric ? Number(input.value) : options.values || options.type === 'text' || options.multiline ? input.value : Number(input.value))))); parent.append(element('label', { class: options.wide ? 'wide' : '' }, label, input)); return input; }
function disclosure(parent, title, open = false) { const e = element('details', { class: 'property-section', open: state.sections[title] ?? open, onToggle: event => { if (event.target.isConnected)
        state.sections[title] = event.target.open; } }, element('summary', { text: title })); parent.append(e); return e; }
function section(parent, title) { if (state.mode === 'data')
    return disclosure(parent, title, ['About this creation', 'Combat basics', 'Equipment and value'].includes(title)); const e = element('section', { class: 'property-section' }, element('h3', { text: title })); parent.append(e); return e; }
function check(parent, title, value, fn) { const input = element('input', { type: 'checkbox', checked: value, onChange: () => change(() => fn(input.checked)) }); parent.append(element('label', { class: 'check' }, input, title)); }
function slider(parent, label, value, set, { min = -250, max = 250, step = 1 } = {}) { const range = element('input', { type: 'range', min: Math.min(min, value), max: Math.max(max, value), step, value, 'aria-label': label }); const number = element('input', { type: 'number', step, value, 'aria-label': `${label} value` }); let editing = false; const begin = () => { if (!editing) {
    checkpoint();
    editing = true;
} }; range.onpointerdown = begin; range.oninput = () => { begin(); const n = Number(range.value); number.value = n; set(n); changed(false); }; range.onchange = () => { editing = false; draft(); renderProperties(); }; range.onkeydown = begin; range.onkeyup = () => editing = false; number.onchange = safe(() => { const n = Number(number.value); if (!Number.isFinite(n) || n < min || n > max)
    throw new Error(`${label} must be ${min} to ${max}.`); change(() => set(n)); }); parent.append(element('label', { class: 'slider-row' }, element('span', { text: label }), range, number)); }
function renderProperties() {
    const target = $('properties'), part = selected();
    target.replaceChildren();
    $('inspector-title').textContent = ({data:'Game data',animate:'Movement',paint:'Paint',sculpt:'Sculpt',visuals:'Item visuals'})[state.mode] ?? (state.project?.kind === 'gear' ? state.project.name : part?.name) ?? 'Selected part';
    if (state.project) activeTab()?.renderProperties?.(target);
}
async function play(id) {
    if(!Number.isInteger(id)||id<0)throw new Error('Choose an animation first.');
    const token=++animationToken,project=state.project,variant=state.variant;let mesh;
    status('Loading animation…');
    if(project.kind==='gear'){
        if(!['male','female'].includes(variant))throw new Error('Choose Male worn or Female worn to preview a player animation.');
        const together=context.gearPreview(project,variant),style=$('reference-style').value,visible=$('mannequin').checked;
        const body=await api(`mannequin?gender=${variant}&slots=${encodeURIComponent(together?.slots??project.settings.equipmentType)}&style=${style}`);
        if(token!==animationToken||state.project!==project||state.variant!==variant)return;
        if(visible)state.reference=body.mesh;
        mesh=gearPreviewMesh(project,variant,body.mesh,{parts:together?.parts??project.parts,visible,style});
    }else mesh=assemble(project.parts,variant);
    if(!mesh.faces.length)throw new Error('This view is empty.');
    const result=(project.kind==='gear'?await previewGearAnimation(project,variant,id):null)??await api('animate',{mesh,sequence:id,samples:Math.max(2,Math.min(32,Math.floor(260000/mesh.vertices.length)))});
    if(token!==animationToken||state.project!==project||state.variant!==variant)return;
    viewport.play(result);tabs.visuals?.animationStarted();$('pause').textContent='Pause';state.playing=true;status(`Animation ${id} · ${result.frames.length} native frames`);
}
async function previewGearAnimation(project,variant,sequence){
    const together=context.gearPreview(project,variant),raw=together?.projects??[project],projects=tabs.visuals.prepareProjects(raw);
    if(!projects.some(p=>['textures','particles','models'].some(type=>p.visuals?.[type]?.some(layer=>layer.enabled))))return null;
    return api('animate-gear',{projects,variant,sequence,...context.bodyReference()});
}
function renderTools() {
    const target = $('job-tools'); target.replaceChildren();
    target.hidden = state.mode === 'build';
    $('build-library').hidden = state.mode !== 'build';
    $('tools').hidden = true; $('gizmo-tools').hidden = state.mode !== 'build';
    document.querySelector('.quick-animations').hidden = state.mode === 'animate';
    if (state.mode === 'build') return;
    if (!state.project) { target.append(element('p', { class: 'note', text: workspace === 'gear' ? 'Add an item in Build first.' : 'Add a body in Build first.' })); return; }
    activeTab()?.renderTools?.(target);
}
function toolSlider(target,label,value,set,min,max) { const output=element('output',{text:String(value)}),range=element('input',{type:'range',min,max,value,'aria-label':label,onInput:e=>{const n=Number(e.target.value);set(n);output.value=n;}});target.append(element('label',{},element('span',{class:'row spread'},label,output),range)); }
async function playRole(role){if(!state.project)return;if(state.mode==='animate')return tabs.animate.playRole(role);if(state.project.kind==='gear')return play(gearPreviewSequence(state.project,role,context.gearPreview(state.project,state.variant)?.weapon));if(!hasOwnMotion(state.project))return play(state.project.animations[role]);const token=++animationToken;state.poseIndex=null;status('Building combined movement…');const result=await api('animate-project',{project:state.project,role});if(token!==animationToken)return;if(!result)throw new Error('Choose a borrowed animation or add at least two poses.');viewport.play(result);state.playing=true;$('pause').textContent='Pause';status(`${role[0].toUpperCase()+role.slice(1)} · ${result.frames.length} combined frames`);}
function rigAt(point, parent) { if (!parent)
    return { label: -1, bone: -1 }; const mesh = assemble(state.project.parts, state.variant, new Set([parent.id])); let closest = 0, distance = Infinity; mesh.vertices.forEach((v, i) => { const d = v.reduce((n, c, a) => n + (c - point[a]) ** 2, 0); if (d < distance) {
    closest = i;
    distance = d;
} }); const weights = mesh.weights[closest] ?? []; return { label: mesh.skins[closest] ?? -1, bone: mesh.bones[closest]?.[weights.indexOf(Math.max(...weights))] ?? -1 }; }
function preparePart(source,offer,drop=null){
    const p = state.project, parent = p.parts.find(part => part.id === drop?.partId) ?? (drop ? null : selected() ?? activeParts()[0]);
    const part = makePart(source, state.variant, offer.key);
    part.mesh = extract(source.mesh, offer.faces);
    part.name = `${offer.name} (${source.name})`;
    part.role = offer.role;
    part.parentId = parent?.id ?? null;
    part.rigMode = parent ? 'parent' : 'source';
    part.pair = ['arm', 'leg', 'wing'].includes(offer.role);
    part.donorPivot=[...offer.pivot];
    part.mesh.vertices.forEach(v => v.forEach((n, i) => v[i] = n - offer.pivot[i]));
    let point = drop?.point;
    if (!point) {
        const mesh = parent ? assemble(p.parts, state.variant, new Set([parent.id])) : source.mesh, box = bounds(mesh);
        point = [...box.center];
        if (offer.role === 'head')
            point = [box.center[0], box.min[1], box.min[2]];
        else if (['arm', 'leg', 'wing'].includes(offer.role))
            point = [box.max[0], offer.role === 'leg' ? box.max[1] - 10 : box.center[1], box.center[2]];
    }
    part.position = localPoint(point, parent, p.parts);
    const rig = rigAt(point, parent), opposite = rigAt(reflectPoint(point,parent,p.parts), parent);
    part.bindLabel = rig.label;
    part.bindBone = rig.bone;
    part.twinBindLabel = opposite.label;
    part.twinBindBone = opposite.bone;
    return part;
}
async function addPart(source, offer, drop = null) {
    if (creating || switchingWorkspace)
        return;
    if (!state.project) {
        const kind = workspace ?? $('project-kind').value;
        if (source.kind !== (kind === 'gear' ? 'item' : 'npc'))
            throw new Error(kind === 'gear' ? 'Start with an item. Then add creature parts.' : 'Start with a creature body. Then add gear parts.');
        creating = true;
        try {
            useProject(await api('create', { kind, baseId: source.id, partKey: offer.key, variant: source.variant }));
            status(`Added ${offer.name}`);
        }
        finally {
            creating = false;
        }
        return;
    }
    const p=state.project,part=preparePart(source,offer,drop);
    assemble([...p.parts, part], state.variant);
    change(() => { p.parts.push(part); p.warnings = [...new Set([...p.warnings, ...source.warnings])]; state.selected = part.id; });
    status(`Added ${part.name}`);
}
const viewport = new Viewport($('view'), { placing:()=>!!state.placement,place:safe(async drop=>{const pending=state.placement;state.placement=null;state.ghost=null;if(pending)await addPart(pending.source,pending.offer,drop);}),preview:drop=>{if(!state.placement||!state.project)return;state.ghost=preparePart(state.placement.source,state.placement.offer,drop);renderView();}, gizmo: () => {
    const part = selected(); if (state.placement || state.mode !== 'build' || !part || isConnection(part) || !part.visible || state.playing) return null;
    const origin = worldPoint(part.pivot,part,state.project.parts);
    const axes = partScaleAxes(part, state.project.parts), directions = axes.map(info => info.direction);
    const preview = viewport.scaleAxisPreview?.partId === part.id ? viewport.scaleAxisPreview : null;
    return {origin,directions,partId:part.id,scaleLabels:axes.map(info => info.label),...(preview && {mode:'scale',previewAxis:preview.axis})};
}, startTransform: handle => { const part=selected(); if(!part||isConnection(part)||part.id!==handle.partId)return;checkpoint();transformSession={position:[...part.position],rotation:[...part.rotation],scale:[...part.scale]};
}, transform: (handle,delta) => {const part=selected();if(!part||isConnection(part)||!transformSession)return;
    if(delta.movement){const parent=state.project.parts.find(p=>p.id===part.parentId),a=localPoint(delta.movement,parent,state.project.parts),b=localPoint([0,0,0],parent,state.project.parts),snap=Number($('snap').value);part.position=transformSession.position.map((n,i)=>{const v=n+a[i]-b[i];return snap?Math.round(v/snap)*snap:v;});}
    if(delta.angle!==undefined){const snap=Number($('snap').value),angle=transformSession.rotation[handle.axis]+delta.angle;part.rotation[handle.axis]=snap?Math.round(angle/snap)*snap:angle;}
    if(delta.factor!==undefined)tabs.build.scaleFromGizmo(transformSession.scale,handle.axis,delta.factor);
    state.dirty=true;state.checked=null;$('save-state').textContent='Unsaved';renderView();tabs.build.syncValues();
}, editing: () => state.project && !state.playing ? (state.mode === 'build' ? 'move' : ['paint', 'sculpt'].includes(state.mode) ? 'brush' : false) : false,
    allowShiftEdit: () => state.mode === 'sculpt' && state.sculpt?.tool === 'select',
    hover: hit => activeTab()?.onHover?.(hit),
    faceOverlay: polygon => activeTab()?.faceOverlay?.(polygon),
    select: hit => { if(state.mode==='visuals'&&tabs.visuals.pick(hit))return; if (!hit || hit.partId === 'animation') return; state.selected=hit.partId;state.poseIndex=null;render(); },
    startEdit: hit => { if(state.mode==='build'){checkpoint();state.selected=hit.partId;} },
    edit: (hit, delta, phase) => {
        if(state.mode!=='build')return activeTab()?.edit?.(hit,delta,phase);
        const part=state.project?.parts.find(p=>p.id===hit?.partId);if(!part||isConnection(part))return;
        const parent=state.project.parts.find(p=>p.id===part.parentId);
        if(hit.twin){const a=reflectPoint(delta,parent,state.project.parts),b=reflectPoint([0,0,0],parent,state.project.parts);delta=a.map((n,i)=>n-b[i]);}
        const origin=localPoint([0,0,0],parent,state.project.parts),at=localPoint(delta,parent,state.project.parts);
        part.position=part.position.map((n,i)=>n+at[i]-origin[i]);
        state.dirty=true;state.checked=null;$('save-state').textContent='Unsaved';renderView();tabs.build.syncValues();
    },
    brush: () => activeTab()?.getBrush?.(),
    endEdit: () => {transformSession=null;activeTab()?.edit?.(null,null,'end');draft();render();}
});
viewport.background = PREVIEW_SCENES[0].sky;
viewport.gridColour = '#2b261d';
const library = createLibrary({ place:(source,offer)=>{stop();state.placement={source,offer};document.body.classList.remove('show-tools');status('Click where this part should attach. Escape cancels.');},cancelPlace:()=>{state.placement=null;state.ghost=null;renderView();}, api, report: status, add: addPart, choose: source => { state.source = source; library.renderParts(source); }, sequence: row => { const target = $('part-cards'); $('source-name').textContent = row.name; $('source-variant').hidden = true; target.replaceChildren(); const area = element('div', { class: 'sequence-card' }, element('strong', { text: row.name })); if (state.project) {
        area.append(element('div', { class: 'actions' }, button('Preview', () => play(row.id))));
        for (const role of roles)
            area.append(button(`Use for ${role}`, () => change(() => state.project.animations[role] = row.id)));
    }
    else
        area.append(element('p', { class: 'note', text: workspace === 'gear' ? 'Add an item before choosing an animation.' : 'Add a creature before choosing an animation.' })); target.append(area); } });
const context = {state,api,currentDocument,switchSetItem,setMode,saveSeparateSetCopy,reassignExportIds,previewGearAnimation,
    gearPreview:(project,variant)=>{if(!state.gearSet||!state.previewSet)return null;const set={...currentDocument(),items:state.gearSet.items.map(item=>item.id===project.id?project:item)};return {parts:equippedParts(set,state.setEquipment,project.id),projects:equippedItems(set,state.setEquipment,project.id),slots:equippedItems(set,state.setEquipment,project.id).map(item=>item.settings.equipmentType).join(','),weapon:equippedItems(set,state.setEquipment,project.id).find(item=>item.settings.equipmentType==='WEAPON')};},
    bodyReference:()=>({visible:$('mannequin').checked,style:$('reference-style').value}),
    previewContextKey:()=>JSON.stringify([state.gearSet&&state.previewSet?currentDocument():null,$('mannequin').checked,$('reference-style').value]),element,button,field,check,section,disclosure,slider,toolSlider,change,changed,checkpoint,status,safe,selected,activeParts,descendants,render,renderView,renderProperties,renderParts,stop,play,playRole,viewport,library,views,roles,updateReference,draft,thumbnail,
    onEquipmentChange:safe(async()=>{await updateReference();renderView();})};
const gearSetEditor=createGearSetEditor({...context,busy:()=>creating||switchingWorkspace,editSetBonus:openSetBonus,document:currentDocument,open:useProject,adopt:adoptSet,switchItem:switchSetItem,refresh:refreshSetPreview});
const gearViews=createGearViews(context);
context.renderGearViews=target=>gearViews.render(target);
const partClipboard=createPartClipboard({...context,beforePaste:()=>{activeTab()?.edit?.(null,null,'end');resetTabs();}});
window.addEventListener('copy',partClipboard.copy);window.addEventListener('paste',partClipboard.paste);
const combatEffects=createCombatEffectsEditor(context);
tabs={build:createBuildTab(context),paint:createPaintTab(context),sculpt:createSculptTab(context),animate:createAnimateTab(context),data:createGameDataTab(context),visuals:createGearVisualsTab(context)};
viewport.itemVisuals=(items,time)=>tabs.visuals.preview(items,time);
viewport.itemVisualsActive=()=>tabs.visuals.active();
$('view').ondragover = e => { if (e.dataTransfer.types.includes('application/x-tsps-part')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';if(state.placement){const point=viewport.point(e);viewport.callbacks.preview(viewport.pick(...point)??{point:viewport.unproject(...point)});}
} };
$('view').ondrop = safe(async (e) => { e.preventDefault(); state.placement=null;state.ghost=null;const data = JSON.parse(e.dataTransfer.getData('application/x-tsps-part')); if (!['npc', 'item'].includes(data.kind) || !Number.isInteger(data.id))
    throw new Error('Choose a part from the library.'); const point = viewport.point(e), hit = viewport.pick(...point), drop = hit ?? { point: viewport.unproject(...point) }; const source = await library.request(data.kind, data.id, data.variant), offer = source.parts.find(p => p.key === data.key); if (!offer)
    throw new Error('This part is unavailable.'); await addPart(source, offer, drop); });
function resetProject(kind) {
    stop(); resetTabs();
    Object.assign(state, { gearSet:null, setEquipment:{}, project: null, selected: null, revision: null, history: [], future: [], dirty: false, checked: null, reference: null, source: null, mode: 'build', isolate: false, placement: null, ghost: null, sections: {}, variant: kind === 'gear' ? 'inventory' : 'body' });
    $('project-kind').value = kind;
    $('source-kind').value = kind === 'gear' ? 'item' : 'npc';
    $('search').value = kind === 'gear' ? 'scimitar' : 'spider';
    $('search').placeholder = kind === 'gear' ? 'Search items…' : 'Search creatures…';
}
async function clearProject() {
    if (!mayReplace()) return;
    resetProject(workspace ?? 'npc'); render(); await writeDraft(); await library.search(true, true);
    status('Drag a part into the centre, or click Add.');
}
async function switchWorkspace(kind) {
    if (!['npc', 'gear'].includes(kind) || switchingWorkspace || kind === workspace) return;
    if (creating) { status('Wait for this part to finish loading.'); return; }
    switchingWorkspace = true;
    try {
        await writeDraft();
        workspace = kind;
        resetProject(kind);
        const saved = await restoreDraft();
        if (saved?.project) useProject(saved);
        else render();
        const url = new URL(location.href); url.searchParams.set('view', kind); history.replaceState(history.state, '', url);
        await library.search(true, true);
        status(state.dirty ? 'Restored unsaved project.' : 'Drag a part into the centre, or click Add.');
    } finally { switchingWorkspace = false; }
}
$('new').onclick = safe(clearProject);
document.querySelectorAll('[data-workspace]').forEach(link => link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); safe(() => switchWorkspace(link.dataset.workspace))();
}));
$('save').onclick = safe(save);
$('name').onchange = () => change(() => state.project.name = $('name').value);
$('undo').onclick = () => undo();
$('redo').onclick = () => undo(true);
$('download').onclick = () => state.project && download(JSON.stringify(currentDocument(), null, 2), `${currentDocument().id}.json`);
$('backup').onclick = () => $('download').click();
$('variant').onchange = safe(async () => { stop(); state.variant = $('variant').value;if(state.gearSet&&state.variant==='inventory')state.previewSet=false; state.selected = activeParts()[0]?.id; state.reference = null; await updateReference(); render(); viewport.fit(); });
let referenceTicket=0;
async function updateReference() { const ticket=++referenceTicket;state.reference=null;if ($('mannequin').checked && state.project?.kind === 'gear' && ['male', 'female'].includes(state.variant)) {
    const slots=state.gearSet&&state.previewSet?equippedItems(currentDocument(),state.setEquipment,state.project.id).map(item=>item.settings.equipmentType).join(','):state.project.settings.equipmentType;
    const result = await api(`mannequin?gender=${state.variant}&slots=${encodeURIComponent(slots)}&style=${$('reference-style').value}`);
    if(ticket===referenceTicket)state.reference = result.mesh;
} }
$('mannequin').onchange = safe(async () => { stop(); await updateReference(); render(); viewport.fit(); saveViewPreferences(); });
$('reference-style').onchange = safe(async () => { stop(); await updateReference(); renderView(); saveViewPreferences(); });
$('fit').onclick = () => viewport.fit();
$('wire').onchange = e => { viewport.wire = e.target.checked; viewport.dirty = true; };
$('rig').onchange = e => { viewport.rig = e.target.checked; viewport.dirty = true; };
for(const id of ['outline','grid','gizmo']) $(id).onchange=e=>{viewport[id]=e.target.checked;viewport.dirty=true;saveViewPreferences();};
$('gizmo-mode').onchange=e=>{viewport.gizmoMode=e.target.value;viewport.dirty=true;saveViewPreferences();};
function saveViewPreferences(){bodyReferencePreference=$('mannequin').checked;try{localStorage.setItem('creator:view',JSON.stringify({outline:viewport.outline,grid:viewport.grid,gizmo:viewport.gizmo,gizmoMode:viewport.gizmoMode,referenceStyle:$('reference-style').value,bodyReference:$('mannequin').checked,scene:$('preview-scene').value}));}catch{}}
let backdropTicket = 0;
const backdropCache = new Map();
async function updateBackdrop(persist = true) {
    const id = $('preview-scene').value, ticket = ++backdropTicket;
    const preset = PREVIEW_SCENES.find(scene => scene.id === id);
    if (!preset) return;
    $('scene-status').textContent = preset.studio ? '' : 'Loading scenery…';
    try {
        const scene = preset.studio ? {...preset,items:[]} : backdropCache.get(id) ?? await api(`preview-scene?id=${id}`);
        if (!preset.studio) backdropCache.set(id, scene);
        if (ticket !== backdropTicket) return;
        viewport.setBackdrop(scene); viewport.background = preset.sky; viewport.gridColour = preset.grid ?? '#463b28';
        $('scene-status').textContent = ''; if(persist)saveViewPreferences();
    } catch (error) {
        if (ticket !== backdropTicket) return;
        $('preview-scene').value = viewport.backdrop?.id ?? 'studio';
        $('scene-status').textContent = 'Scenery unavailable. Choose another background or try again.';
    }
}
$('preview-scene').onchange = () => updateBackdrop();
try{const prefs=JSON.parse(localStorage.getItem('creator:view')??'{}');for(const id of ['outline','grid','gizmo'])if(typeof prefs[id]==='boolean'){viewport[id]=prefs[id];$(id).checked=prefs[id];}if(['move','rotate','scale'].includes(prefs.gizmoMode)){viewport.gizmoMode=prefs.gizmoMode;$('gizmo-mode').value=prefs.gizmoMode;}if(['dummy','character'].includes(prefs.referenceStyle))$('reference-style').value=prefs.referenceStyle;if(typeof prefs.bodyReference==='boolean'){$('mannequin').checked=prefs.bodyReference;bodyReferencePreference=prefs.bodyReference;}if(PREVIEW_SCENES.some(scene=>scene.id===prefs.scene))$('preview-scene').value=prefs.scene;}catch{}
void updateBackdrop(false);
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
for(const [id,cls,other] of [['toggle-tools','show-tools','show-properties'],['toggle-properties','show-properties','show-tools']]) $(id).onclick=()=>{document.body.classList.remove(other);document.body.classList.toggle(cls);$('toggle-tools').setAttribute('aria-expanded',document.body.classList.contains('show-tools'));$('toggle-properties').setAttribute('aria-expanded',document.body.classList.contains('show-properties'));};
$('attack-preview').onchange=safe(e=>{if(e.target.value)return playRole(e.target.value);});
document.querySelectorAll('[data-animation]').forEach(b => b.onclick = safe(() => playRole(b.dataset.animation)));
$('rest').onclick = () => { stop(); renderView(); };
$('pause').onclick = () => { viewport.pause();tabs.visuals?.syncPlayback(); $('pause').textContent = viewport.animation?.pausedAt !== undefined ? 'Resume' : 'Pause'; state.playing = !!viewport.animation; };
document.querySelectorAll('[data-camera]').forEach(b => b.onclick = () => { const angles = { front: [0, 0], side: [Math.PI / 2, 0], back: [Math.PI, 0], top: [0, Math.PI / 2 - .01] }; [viewport.yaw, viewport.pitch] = angles[b.dataset.camera]; viewport.dirty = true; });
async function verify() { const snapshot = JSON.stringify(currentDocument()); state.checked = null; $('export-download').disabled = true; $('check-result').textContent = 'Checking…'; try {
    const result = await api('verify', { project: JSON.parse(snapshot) });
    if (snapshot !== JSON.stringify(currentDocument()))
        throw new Error('Project changed. Check it again.');
    state.checked = result;
    $('check-result').textContent = state.gearSet?`${state.gearSet.name} · ${result.items.length} custom items · ${result.models.length} models checked. One plugin contains ${result.items.map(item=>item.name).join(', ')}.`:`${state.project.name} · Game ID ${result.id} · ${result.models.length} model(s) checked`;
    $('export-download').disabled = false;
    status('Export checked');
}
catch (error) {
    $('check-result').textContent = error.message;
    throw error;
} }
$('export').onclick = safe(async () => { if (!state.project)
    return; const warnings=documentItems(currentDocument()).flatMap(item=>item.warnings);$('export-warnings').hidden = !warnings.length; $('export-warnings').textContent = warnings.join(' '); $('export-dialog').showModal(); await save(); await verify(); });
$('verify').onclick = safe(verify);
$('export-download').onclick = safe(async () => { if (!state.checked)
    throw new Error('Check this creation first.'); const response = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: currentDocument() }) }); if (!response.ok)
    throw new Error((await response.json()).error); download(await response.arrayBuffer(), `builder-${currentDocument().id}.zip`, 'application/zip'); status('Plugin downloaded. Import it in the admin panel, then restart the world.'); });
$('open').onclick = safe(async () => { const result = await api('projects'), projects = result.projects.filter(project => project.error || project.kind === workspace); $('projects').replaceChildren(...projects.map(p => button(p.error ? `${p.id}: ${p.error}` : `${p.name} (${p.kind === 'npc' ? 'Creature' : p.set?`Gear set · ${p.itemCount} items`:'Gear'})`, async () => { if (p.error || !mayReplace())
    return; useProject(await api(`projects/${p.id}`)); $('projects-dialog').close(); }))); if (!projects.length)
    $('projects').textContent = 'No saved projects.'; $('projects-dialog').showModal(); });
$('import').onclick = () => $('import-file').click();
$('import-file').onchange = safe(async (e) => { const file = e.target.files[0]; if (!file || !mayReplace())
    return; if (file.size > 24 * 1024 * 1024)
    throw new Error('Project exceeds 24 MB.'); const project = JSON.parse(await file.text());
    if (project.kind !== workspace) throw new Error(`Open ${project.kind === 'gear' ? 'Gear' : 'NPC'} Creator to import this project.`);
    useProject(await api('import', { project })); e.target.value = ''; status('Imported as a separate project.'); });
window.addEventListener('keydown', e => { if(activeTab()?.onKeyDown?.(e))return; if(e.key==='Escape'&&state.placement){state.placement=null;state.ghost=null;renderView();status('Placement cancelled.');} if ((e.ctrlKey || e.metaKey) && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
    if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo(e.shiftKey);
    }
    if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        undo(true);
    }
} if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    safe(save)();
} });
window.addEventListener('beforeunload', e => { if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';
} });
if (location.pathname === '/embedded') {
    document.body.classList.add('embedded');
    window.addEventListener('message', safe(async (event) => {
        if (event.source === window.parent && event.data?.type === 'cache-editor-tool:ping' && initialized) {
            const origin = new URL(event.origin);
            if (origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)) window.parent.postMessage({ type: 'cache-editor-tool:ready' }, event.origin);
            return;
        }
        if (event.source !== window.parent || event.data?.type !== 'cache-editor-tool:source')
        return; const origin = new URL(event.origin); if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(origin.hostname))
        return; const source = event.data.source; if (!source || !Number.isInteger(source.id) || source.id < 0 || source.id >= 50000)
        return; if (['npc', 'item'].includes(source.kind))
        await library.select(source.kind, source.id);
    else if (source.kind === 'seq') {
        const result = await api(`search?kind=seq&q=${source.id}`);
        if (result.rows[0])
            library.sequence(result.rows[0]);
    } }));
}
await safe(async () => { state.info = await api('info');
for(const [id,key]of [['cache-editor-link','cacheEditor'],['web-panel-link','webPanel']]){const href=state.info.navigation?.[key];if(href){$(id).href=href;$(id).hidden=false;}}
try {
    const draft = await restoreDraft();
    if (draft?.project)
        useProject(draft);
}
catch {
    status('Browser drafts unavailable. Use Save to keep edits.', true);
}
workspace ??= 'npc';
if (!state.project) {
    $('project-kind').value = workspace; state.variant = workspace === 'gear' ? 'inventory' : 'body';
    $('search').placeholder = workspace === 'gear' ? 'Search items…' : 'Search creatures…';
}
render(); if (state.project?.kind === 'gear' || (!state.project && workspace === 'gear')) {
    $('source-kind').value = 'item';
    $('search').value = 'scimitar';
} await library.search(true, true); initialized = true; if (window.parent !== window)
    window.parent.postMessage({ type: 'cache-editor-tool:ready' }, '*'); })();
