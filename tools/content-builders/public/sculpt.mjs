import { assemble, validateMesh, localPoint, reflectPoint, worldPoint, linkedPoint } from '/shared/mesh.mjs';
import { applyVertexUpdates, brushFaces, changeFaceSelection, connectedFaces, faceNormal, meshTopology,
    mirrorConnectionPlan, mirroredVertexUpdates, mirroredFaces, planFlatten, planRegionOffset, planSculpt, planSeamConnection, regionVertices, safeVertexUpdates, visibleFaceIds,
    pickBoundary, pickFaceEdge, faceEdges, planBridge, pickConnectionSurface, planSurfaceConnection, planPlacedConnection, pickConnectionGuide, connectionOpenings, planGuidedConnection, planConnectionCleanup, addFace, buildFace, startFace, fillOpening, deleteFaces } from '/shared/sculpt.mjs';

const defaults = () => ({ tool: 'select', selectionTool: 'face', selectionMode: 'replace', faces: {},
    radius: 22, strength: 4, scope: 'selection', visibleOnly: true, lockBoundary: false,
    mirror: false, falloff: 'soft', angle: 75, seamTolerance: 3, seamTarget: 'self', flattenAxis: 'surface', instanceTwin: false, opening: true,
    connectionMode: 'surface', connectionSteps: 0, connectionPlacement: 'keep', connectionTwist: 0, deleteSize: 'face',
    placedSource: '', placedTarget: '', placedCoverage: 100, placedComplexity: 0, placedRamp: 0, placedBend: 0, placedRecess: 0, placedLanding: 0, placedFaces: true, placedInspect: false,
    faceMode: 'edge', faceShape: 'triangle', snapCorners: true, placedGuides: [], placedGuidePick: null, placedRepairCrossings: true, placedRemoveEnclosed: false, placedRemoveLoose: false, placedCleanupReview: false, open: {} });
const tools = [['select', 'Select faces'], ['pull', 'Pull'], ['push', 'Push'], ['smooth', 'Smooth'], ['flatten', 'Flatten']];
const normalise = v => { const size = Math.hypot(...v); return size > 1e-8 ? v.map(n => n / size) : [0, 0, 0]; };
const distance = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]));

/**
 * All selection, previews and restore snapshots are transient. Only existing
 * Geometry edits use the normal undo/dirty path. Call edit(..., 'end') or endEdit() on pointerup
 * and pointercancel; this module owns its stroke checkpoint and dirty state.
 */
export function createSculptTab(ctx) {
    const { state, element: el, button } = ctx;
    const baselines = new Map(), selections = new Map(), signatures = new WeakMap(), edgeCache = new WeakMap();
    const openEdges=mesh=>{if(!edgeCache.has(mesh))edgeCache.set(mesh,faceEdges(mesh));return edgeCache.get(mesh);};
    const bindings = { tools: [], properties: [] };
    let projectKey = null, stroke = null, hovered = null, preview = null, lastEdit = '';
    let boundary=null,boundaryHover=null,faceCorners=[],topologyPreview=null,topologyStamp=null,hoverHit=null,hoverFootprint=new Set();
    let faceDraft=null,facePatch=null,cornerEdit=null,cornerDrag=null;
    let connectionReason='',connectionDrag=null,guideStamp=null,savingCopy=false;
    const guideName=index=>{let name='';for(let n=index+1;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};
    const topologyTool=()=>['connect','bridge','add-face','delete-face','vertex'].includes(options().tool);
    const options = () => state.sculpt ??= defaults();
    const currentPart = () => ctx.selected?.() ?? state.project?.parts.find(p => p.id === state.selected);
    const active = () => (ctx.activeParts?.() ?? state.project?.parts.filter(p => p.visible !== false && (p.variant === 'all' || p.variant === state.variant)) ?? [])
        .filter(p => !state.isolate || p.id === state.selected);
    const isActive = part => part && active().some(p => p.id === part.id);
    const report = (text, error = false) => ctx.status?.(text, error);
    const invalidate = () => { preview = null; };
    const redraw = () => { if (ctx.viewport) ctx.viewport.dirty = true; };
    function clearTopology(){faceDraft=null;facePatch=null;cornerEdit=null;cornerDrag=null;boundary=null;boundaryHover=null;faceCorners=[];topologyPreview=null;topologyStamp=null;connectionReason='';redraw();}
    if(ctx.viewport){ctx.viewport.crossPartEdit=()=>state.mode==='sculpt'&&['connect','bridge'].includes(options().tool);
        ctx.viewport.previewItems=()=>{
            if(state.mode!=='sculpt')return null;
            if(topologyPreview?.mesh){
                const id=topologyPreview.partId,parts=state.project.parts.map(p=>p.id===id?{...p,mesh:topologyPreview.mesh}:p);
                return [...(ctx.viewport.items??[]).filter(p=>p.id!==id),{id,mesh:assemble(parts,state.variant,new Set([id])),selected:true}];
            }
            if(!topologyPreview?.part)return null;
            if(options().placedCleanupReview)return topologyPreview.cleanup?.removedItems??[];
            const parts=[...(topologyPreview.prepared??state.project.parts),topologyPreview.part];
            return [...(ctx.viewport.items??[]).filter(p=>p.reference),...parts.filter(p=>p.visible!==false&&(p.variant===state.variant||p.variant==='all')).map(part=>{
                const mesh=assemble(parts,state.variant,new Set([part.id])),side=[boundary,boundaryHover].find(s=>s?.partId===part.id);
                if(side?.removeFaces?.length){const removed=new Set(side.removeFaces),old=state.project.parts.find(p=>p.id===part.id),kept=old.mesh.faces.flatMap((_,i)=>removed.has(i)?[]:[i]);mesh.faceSources=mesh.faceSources.map(i=>kept[i]);}
                return {id:part.id,mesh,selected:part.id===state.selected};
            })];
        };
        ctx.viewport.toolOverlay=()=>{
        if(state.mode!=='sculpt')return [];
        if(options().placedCleanupReview)return [];
        const guides=[];
        const parts=topologyPreview?.prepared??state.project.parts;
        for(const [side,colour] of [[boundary,'#ffb75e'],[topologyPreview?.guides?null:boundaryHover,'#63e6ff']])if(side)guides.push({points:side.vertices.map(vertex=>linkedPoint({partId:side.partId,vertex,twin:side.twin},parts)),closed:side.closed,stroke:colour,depthTest:true});
        if(options().tool==='connect'){
            const pairs=options().placedGuides,pick=options().placedGuidePick;
            for(const [index,pair]of pairs.entries()){
                const points=[pair.source,pair.target].map(ref=>linkedPoint(ref,state.project.parts));
                guides.push({points:topologyPreview?.guidePaths?.[index]?.map(i=>topologyPreview.part.mesh.vertices[i])??points,stroke:'#d9bd76',dash:[4,3],depthTest:true});
                for(const [i,colour]of ['#ffb75e','#63e6ff'].entries())guides.push({points:[points[i]],corner:true,label:guideName(index),stroke:colour,depthTest:true});
            }
            if(pick?.source)guides.push({points:[linkedPoint(pick.source,state.project.parts)],corner:true,label:guideName(pairs.length),stroke:'#ffb75e',depthTest:true});
            if(pick&&hoverHit){
                const side=pick.side??(pick.source?'target':'source'),partId=options()[side==='source'?'placedSource':'placedTarget'];
                if(hoverHit.partId===partId)try{const ref=pickConnectionGuide(state.project.parts,hoverHit,{opening:side==='source'});
                    guides.push({points:[linkedPoint(ref,state.project.parts)],corner:true,stroke:'#ffffff',depthTest:true});}catch{}
            }
        }
        if(faceDraft||cornerEdit){
            const points=faceControlPoints();
            for(const p of points)guides.push({points:[p.point],corner:true,label:p.label,stroke:p.id===activeCornerId()?'#ffffff':p.locked?'#ffb75e':'#63e6ff',depthTest:false});
            if(faceDraft)guides.push({points:points.map(p=>p.point),closed:true,stroke:topologyPreview?'#63e6ff':'#ff8c81',width:2});
            const part=state.project.parts.find(p=>p.id===(faceDraft??cornerEdit).partId),settings=mirrorSettings(part);
            if(settings.mirror)for(const p of points){const local=localHit({point:p.point,twin:(faceDraft??cornerEdit).twin},part),other=cornerPoint(part,{point:[2*settings.pivot-local[0],local[1],local[2]]},(faceDraft??cornerEdit).twin);if(distance(p.point,other)>.002)guides.push({points:[other],corner:true,label:p.label+'′',stroke:'#bc9cff',depthTest:false});}
        }
        if(options().tool==='add-face'&&options().faceMode==='edge'&&!faceDraft&&hoverHit){
            const edge=pickFaceEdge(state.project.parts,hoverHit);
            if(edge)guides.push({points:edge.vertices.map(vertex=>linkedPoint({partId:edge.partId,vertex,twin:edge.twin},state.project.parts)),stroke:'#63e6ff',width:5,depthTest:true});
        }
        if(options().tool==='add-face'&&options().faceMode==='fill'&&boundaryHover&&!topologyPreview)guides.push({points:boundaryHover.vertices.map(vertex=>linkedPoint({partId:boundaryHover.partId,vertex,twin:boundaryHover.twin},state.project.parts)),closed:true,stroke:'#63e6ff',width:4,depthTest:true});
        if(faceCorners.length)guides.push({points:faceCorners.map(r=>linkedPoint(r,state.project.parts)),corner:true,stroke:'#ffdb86',depthTest:true});
        if((options().tool==='vertex'||options().tool==='add-face'&&options().faceMode==='corners')&&hoverHit){
            const part=state.project.parts.find(p=>p.id===hoverHit.partId),faceId=part&&hitFace(hoverHit,part);
            if(part&&faceId!==null){const p=localHit(hoverHit,part),vertex=[...part.mesh.faces[faceId].slice(0,3)].sort((a,b)=>distance(part.mesh.vertices[a],p)-distance(part.mesh.vertices[b],p))[0];
                guides.push({points:[linkedPoint({partId:part.id,vertex,twin:!!hoverHit.twin},state.project.parts)],corner:true,stroke:'#ffffff',depthTest:true});}
        }
        if(topologyPreview?.triangles&&!topologyPreview.part)for(const points of topologyPreview.triangles)guides.push({points,closed:true,fill:'#63e6ff77',stroke:'#ffffff',width:1,depthTest:true});
        return guides;
    };}

    function signature(mesh) {
        if (!signatures.has(mesh)) {
            // Topology and donor identity must still match the session snapshot.
            let hash = 2166136261;
            for (const face of mesh.faces) for (const n of face.slice(0, 3)) hash = Math.imul(hash ^ n, 16777619);
            for (const n of mesh.sourceVertices ?? []) hash = Math.imul(hash ^ n, 16777619);
            signatures.set(mesh, `${mesh.vertices.length}/${mesh.faces.length}/${hash >>> 0}`);
        }
        return signatures.get(mesh);
    }

    function ensureProject() {
        const key = state.project ? `${state.project.id}/${state.project.kind}/${state.project.cache ?? ''}` : null;
        if (key !== projectKey) {
            projectKey = key; baselines.clear(); selections.clear(); stroke = null; hovered = null; preview = null; lastEdit = '';
            state.sculpt = defaults();guideStamp=null;
            clearTopology();
        }
        const config = options();
        for (const [key, value] of Object.entries(defaults())) if (config[key] === undefined) config[key] = value;
        return config;
    }

    function selectedFaces(part = currentPart()) {
        if (!part) return new Set();
        const array = options().faces[part.id] ?? [], cached = selections.get(part.id);
        if (cached?.array === array && cached.count === part.mesh.faces.length) return cached.set;
        const set = new Set(array.filter(i => Number.isInteger(i) && part.mesh.faces[i]));
        selections.set(part.id, { array, count: part.mesh.faces.length, set }); return set;
    }

    function saveSelection(part, set) {
        options().faces[part.id] = [...set]; selections.delete(part.id); invalidate(); syncValues(); redraw();
    }

    function geometryStamp() {
        const ids = new Set(active().map(p => p.id));
        return JSON.stringify(state.project.parts.map(p => [p.id, p.parentId, p.position, p.rotation, p.scale, p.pivot, p.mirror, p.pair, p.visible,
            ids.has(p.id) ? [signature(p.mesh), p.mesh.vertices] : null]));
    }

    async function saveSeparateCopy(){
        if(savingCopy||!state.project||!ctx.api)return;
        endEdit();
        if(state.gearSet&&ctx.saveSeparateSetCopy){await ctx.saveSeparateSetCopy();return;}
        const original=state.project,snapshot=structuredClone(original),stamp=JSON.stringify(original);
        savingCopy=true;syncValues();
        try{
            const result=await ctx.api('import',{project:snapshot});
            if(state.project!==original||JSON.stringify(state.project)!==stamp){
                report(`Saved a separate copy of ${snapshot.name}. Find it in Open. Your newer edits are still here.`);
                return;
            }
            state.project=result.project;state.revision=result.revision;state.dirty=false;state.checked=null;
            for(const key of ['history','future'])state[key]=(state[key]??[]).map(snapshot=>{
                const entry=JSON.parse(snapshot);entry.id=result.project.id;entry.ids=structuredClone(result.project.ids);return JSON.stringify(entry);
            });
            // Import keeps part IDs and geometry. Keep this session's guides,
            // preview and face selections while changing only project identity.
            projectKey=`${result.project.id}/${result.project.kind}/${result.project.cache??''}`;
            ctx.draft?.();ctx.render?.();redraw();
            report(`Saved a separate copy of ${result.project.name}. Your guides are still open.`);
        }catch(error){report(error.message,true);}
        finally{savingCopy=false;syncValues();}
    }

    function remember(part) {
        const previous = baselines.get(part.id), shape = signature(part.mesh);
        if (!previous || previous.signature !== shape) baselines.set(part.id, { signature: shape, vertices: part.mesh.vertices.map(v => [...v]) });
    }

    function hasBaseline(part) { return part && baselines.get(part.id)?.signature === signature(part.mesh); }

    function apply(part, plan, label, inStroke = false) {
        if (!plan.updates.size) {
            if (!inStroke) report(plan.reason ?? (plan.skipped ? 'This move would collapse or turn a face inside out. Try a smaller change.' : 'No vertices to move. Select more faces or increase the brush size.'));
            return false;
        }
        remember(part);
        if (!inStroke || !stroke?.checkpointed) {
            ctx.checkpoint(); if (inStroke && stroke) stroke.checkpointed = true;
        }
        applyVertexUpdates(part.mesh, plan.updates); invalidate();
        lastEdit = `${label}: ${plan.updates.size.toLocaleString()} vertices${plan.skipped ? `, ${plan.skipped} protected` : ''}.`;
        ctx.changed(false); syncValues();
        if (!inStroke) { report(lastEdit); ctx.render?.(); }
        return true;
    }

    function setOption(key, value, refresh = true) {
        if(stroke)endEdit();
        if(key==='tool'&&value==='connect'){beginConnection();return;}
        const previous=options()[key],lastPreview=topologyPreview,lastBoundary=boundary,lastTarget=boundaryHover,lastStamp=topologyStamp;
        options()[key] = value; invalidate();
        if(['tool','faceMode','faceShape','opening','connectionMode','connectionSteps','connectionPlacement','connectionTwist'].includes(key))clearTopology();
        if(key.startsWith('placed')&&!['placedInspect','placedCleanupReview'].includes(key)){
            options().placedCleanupReview=false;
            if(key==='placedSource'&&options().placedTarget===value)options().placedTarget=connectionPieces().find(p=>p.id!==value)?.id??'';
            if(['placedSource','placedTarget'].includes(key)){options().placedGuides=[];options().placedGuidePick=null;guideStamp=null;preparePlacedConnection();}
            else if(!['placedGuidePick','placedGuides'].includes(key))rebuildPlacedConnection();
            if(!topologyPreview&&lastPreview&&['placedCoverage','placedRamp','placedBend','placedRecess','placedLanding','placedComplexity'].includes(key)){
                // A slider stops at the last safe shape instead of losing the
                // preview or inviting the user to apply a folded connection.
                let safe=previous,blocked=value;
                for(let i=0;i<4;i++){
                    const step=key==='placedComplexity'?1:5,middle=Math.round((safe+blocked)/(2*step))*step;if(middle===safe||middle===blocked)break;
                    options()[key]=middle;rebuildPlacedConnection();
                    if(topologyPreview)safe=middle;else blocked=middle;
                }
                options()[key]=safe;
                if(safe===previous){topologyPreview=lastPreview;boundary=lastBoundary;boundaryHover=lastTarget;topologyStamp=lastStamp;}
                else rebuildPlacedConnection();
                connectionReason=key==='placedComplexity'?'Complexity limit reached. Try less Lift or move a guide.':options().placedGuides.length?'Fill limit reached. Move a guide or lower Lift.':key==='placedLanding'?'Landing limit reached. Try less Coverage or Ramp, or choose another target area in Advanced modelling.':'Shape limit reached. The slider stopped before faces could fold. Try less Ramp for more room to bend.';
                report(connectionReason);
            }
        }
        if (key === 'mirror' && value) for (const part of state.project?.parts ?? []) {
            if (selectedFaces(part).size) options().faces[part.id] = [...mirroredFaces(part.mesh, selectedFaces(part), part.pivot?.[0] ?? 0)];
        }
        if(key==='mirror'){if(faceDraft||facePatch)refreshFace();if(preview)findSeams();if(options().tool==='connect')rebuildPlacedConnection();else if(options().tool==='bridge'&&boundary&&boundaryHover)previewBridge(boundaryHover);}
        if (key === 'tool' || key === 'selectionTool') stroke = null;
        if(hoverHit&&['mirror','deleteSize','radius'].includes(key))onHover(hoverHit);
        if (refresh) ctx.render?.(); else syncValues();
        redraw();
    }

    function connectionPieces(){return active().filter(p=>!p.mesh.vertexLinks);}
    function beginConnection(sourceId, targetId) {
        ensureProject();ctx.stop?.();clearTopology();
        state.isolate=false;
        const pieces=connectionPieces(),selected=currentPart();
        const source=pieces.find(p=>p.id===sourceId)??(selected?.parentId?pieces.find(p=>p.id===selected.id):pieces.at(-1));
        const target=pieces.find(p=>p.id===targetId&&p!==source)??pieces.find(p=>p.id===source?.parentId)??pieces.find(p=>p!==source);
        Object.assign(options(),{tool:'connect',placedSource:source?.id??'',placedTarget:target?.id??'',placedGuides:[],placedGuidePick:null,placedCleanupReview:false});guideStamp=null;
        preparePlacedConnection();ctx.render?.();redraw();
    }
    function preparePlacedConnection(){
        rebuildPlacedConnection();
        if(!topologyPreview&&options().placedFaces&&!options().placedGuides.length){
            Object.assign(options(),{placedCoverage:100,placedRamp:0,placedBend:0,placedRecess:0});rebuildPlacedConnection();
        }
    }
    function rebuildPlacedConnection() {
        clearTopology();
        if(options().tool!=='connect'||!options().placedFaces)return;
        const config=options();
        if(config.placedGuidePick){showGuideOpening();return;}
        try{
            const planner=config.placedGuides.length?planGuidedConnection:planPlacedConnection;
            topologyPreview=planner(state.project.parts,config.placedSource,config.placedTarget,{variant:state.variant,guides:config.placedGuides,
                coverage:config.placedCoverage,complexity:config.placedComplexity??0,ramp:config.placedRamp,bend:config.placedBend,recess:config.placedRecess,landing:config.placedLanding,repairCrossings:config.placedRepairCrossings});
            if(config.mirror)topologyPreview=mirrorConnectionPlan(state.project.parts,topologyPreview);
            topologyPreview=planConnectionCleanup(state.project.parts,topologyPreview,{removeEnclosed:config.placedRemoveEnclosed,removeLoose:config.placedRemoveLoose});
            boundary=topologyPreview.first;boundaryHover=topologyPreview.second;topologyStamp=geometryStamp();
            connectionReason=topologyPreview.blockedReason??'';
            report(connectionReason||'Connection preview. Turn the view to check the back, then Apply connection.',!!connectionReason);
        }catch(error){topologyPreview=null;connectionReason=error.message;report(connectionReason,true);}
        redraw();
    }

    function showGuideOpening(){
        boundary=connectionOpenings(state.project.parts,options().placedSource)[0]??null;
        topologyStamp=geometryStamp();redraw();
    }
    function startGuidePair(pick={source:null}){
        clearTopology();options().placedGuidePick=pick;guideStamp=geometryStamp();showGuideOpening();ctx.render?.();redraw();
    }
    function editGuide(hit,phase){
        if(phase!=='start')return true;
        const config=options(),pick=config.placedGuidePick,side=pick.side??(pick.source?'target':'source');
        if(hit.partId!==config[side==='source'?'placedSource':'placedTarget']){report(`Choose ${side==='source'?'the orange opening on the attached piece':'the landing on the target piece'}.`);return true;}
        try{
            const ref=pickConnectionGuide(state.project.parts,hit,{opening:side==='source'}),index=pick.index??config.placedGuides.length;
            if(config.placedGuides.some((g,i)=>i!==index&&g[side].vertex===ref.vertex))throw new Error('Another guide uses this corner. Choose a different spot.');
            if(pick.index!==undefined){config.placedGuides[pick.index][side]=ref;config.placedGuidePick={source:null};}
            else if(side==='source')config.placedGuidePick={source:ref};
            else{config.placedGuides.push({source:pick.source,target:ref});config.placedGuidePick={source:null};}
            guideStamp=geometryStamp();ctx.render?.();redraw();
        }catch(error){report(error.message,true);}
        return true;
    }

    function selectOperation(operation) {
        const part = currentPart(); if (!isActive(part)) return;
        let next = changeFaceSelection(part.mesh, selectedFaces(part), operation);
        if (options().mirror) next = mirroredFaces(part.mesh, next, part.pivot?.[0] ?? 0);
        saveSelection(part, next); options().scope = 'selection'; syncValues();
    }

    function visibility(part, candidates, twin = null) {
        if (!options().visibleOnly) return candidates;
        const view = ctx.viewport;
        // Fail closed until the viewport has drawn; never silently edit hidden faces.
        if (!view?.polygons?.length) return new Set();
        return visibleFaceIds(view.polygons, part.id, { candidates, faceCount: part.mesh.faces.length,
            twin, width: view.width, height: view.height, distance: view.distance });
    }

    function localHit(hit, part) {
        const parts = state.project.parts, parent = parts.find(p => p.id === part.parentId);
        return localPoint(hit.twin ? reflectPoint(hit.point, parent, parts) : hit.point, part, parts);
    }

    function hitFace(hit, part) {
        const id = hit.sourceFaceId ?? hit.faceId % part.mesh.faces.length;
        return Number.isInteger(id) && part.mesh.faces[id] ? id : null;
    }

    function selectHit(hit, part, faceId, center) {
        const config = options(); let faces;
        if (config.selectionTool === 'brush') {
            const byId = new Map(state.project.parts.map(p => [p.id, p]));
            faces = brushFaces(part.mesh, center, config.radius, { metric: p => worldPoint(p, part, state.project.parts, byId) });
            faces = visibility(part, faces, !!hit.twin);
        } else if (config.selectionTool === 'connected') {
            if (stroke.visited.has(faceId)) return;
            faces = connectedFaces(part.mesh, [faceId], { angle: config.angle });
            // Connected selection deliberately follows a whole surface, including
            // the back. Its name and hint make that scope explicit in the UI.
        } else faces = new Set([faceId]);
        if (config.mirror) faces = mirroredFaces(part.mesh, faces, part.pivot?.[0] ?? 0);
        if (config.selectionTool === 'connected') for (const id of faces) stroke.visited.add(id);
        else stroke.visited.add(faceId);
        const selected = new Set(selectedFaces(part));
        for (const id of faces) stroke.selectionMode === 'remove' ? selected.delete(id) : selected.add(id);
        config.scope = 'selection'; saveSelection(part, selected);
    }

    function endEdit() {
        connectionDrag=null;
        if (!stroke) return false;
        const changed = stroke.checkpointed; stroke = null;
        if (changed) { ctx.draft?.(); report(lastEdit); }
        ctx.render?.(); return true;
    }

    function edit(hit, delta = [0, 0, 0], phase = 'move') {
        ensureProject();
        if (phase === 'end' || phase === 'cancel') return endEdit();
        if (state.mode !== 'sculpt' || !state.project || !hit?.point?.every(Number.isFinite)) return false;
        const part = state.project.parts.find(p => p.id === hit.partId);
        if (!isActive(part)) return false;
        const faceId = hitFace(hit, part); if (faceId === null) return false;
        const config = options(), center = localHit(hit, part);
        if(config.tool==='connect'){
            if(config.placedGuidePick)return editGuide(hit,phase);
            if(part.mesh.vertexLinks)return true;
            if(phase==='start')connectionDrag=part.id;
            if(phase==='move'&&connectionDrag&&part.id!==connectionDrag&&(config.placedSource!==connectionDrag||config.placedTarget!==part.id)){
                config.placedSource=connectionDrag;config.placedTarget=part.id;preparePlacedConnection();ctx.render?.();
            }else if(phase==='start'&&part.id!==config.placedSource&&part.id!==config.placedTarget){config.placedTarget=part.id;preparePlacedConnection();ctx.render?.();}
            return true;
        }
        if(part.mesh.vertexLinks&&config.tool!=='select'){report('This connection follows its endpoints. Shape the original parts, or remove the connection in Build.');return true;}
        if(topologyTool())return editTopology(hit,part,phase);
        if (phase === 'start' || !stroke) {
            ctx.stop?.();
            const changedPart = state.selected !== part.id;
            state.selected = part.id; config.instanceTwin = !!hit.twin;
            stroke = { partId: part.id, twin: !!hit.twin, visited: new Set(), checkpointed: false, topology: meshTopology(part.mesh),
                selectionMode: hit.altKey ? 'remove' : hit.shiftKey || hit.ctrlKey || hit.metaKey ? 'add' : config.selectionMode,
                plane: center, normal: normalise(faceNormal(part.mesh, faceId)) };
            if (config.tool === 'select' && stroke.selectionMode === 'replace') saveSelection(part, new Set());
            if (changedPart) { ctx.renderProperties?.(); ctx.renderParts?.(); ctx.renderView?.(); }
        }
        if (stroke.partId !== part.id || stroke.twin !== !!hit.twin) return false;
        if (config.tool === 'select') { selectHit(hit, part, faceId, center); return true; }
        const faces = config.scope === 'selection' ? selectedFaces(part) : null;
        if (faces && !faces.size) { report('Select faces first, or set Edit area to Whole part.'); return true; }
        const normal = config.tool === 'flatten' ? stroke.normal : normalise(faceNormal(part.mesh, faceId));
        const byId = new Map(state.project.parts.map(p => [p.id, p])), metric = p => worldPoint(p, part, state.project.parts, byId);
        let shown = config.visibleOnly ? visibility(part, brushFaces(part.mesh, center, config.radius, { mirror: config.mirror, pivot: part.pivot?.[0] ?? 0, metric }), !!hit.twin) : null;
        if (config.mirror && shown) shown = mirroredFaces(part.mesh, shown, part.pivot?.[0] ?? 0);
        const scale = distance(metric(center), metric(center.map((n, i) => n + normal[i]))) || 1;
        const plan = planSculpt(part.mesh, { center, radius: config.radius, amount: ['pull', 'push'].includes(config.tool) ? config.strength / scale : config.strength,
            tool: config.tool, normal, plane: stroke.plane, faces, visibleFaces: config.visibleOnly ? shown : null,
            lockBoundary: config.lockBoundary, mirror: config.mirror, pivot: part.pivot?.[0] ?? 0, falloff: config.falloff,
            metric, topology: stroke.topology });
        apply(part, plan, tools.find(([id]) => id === config.tool)[1], true); return true;
    }

    const cornerPoint=(part,corner,twin=false)=>{
        const point=worldPoint(corner.point??part.mesh.vertices[corner.vertex],part,state.project.parts);
        return twin?reflectPoint(point,state.project.parts.find(p=>p.id===part.parentId),state.project.parts):point;
    };
    const activeCornerId=()=>faceDraft?`face-${faceDraft.selected}`:cornerEdit?'vertex':null;
    function faceControlPoints(){
        const draft=faceDraft??cornerEdit,part=state.project?.parts.find(p=>p.id===draft?.partId);
        if(!part)return [];
        const corners=faceDraft?faceDraft.corners:[{vertex:cornerEdit.vertex}];
        return corners.map((c,i)=>({id:faceDraft?`face-${i}`:'vertex',point:cornerPoint(part,c,draft.twin),locked:!!faceDraft&&(c.vertex!==undefined||c.joined!==undefined),label:String.fromCharCode(65+i)}));
    }
    function mirrorSettings(part){
        let ancestor=part;const seen=new Set();
        while(ancestor&&!seen.has(ancestor.id)){seen.add(ancestor.id);if(ancestor.pair)return {mirror:false,pivot:part.pivot?.[0]??0};ancestor=state.project.parts.find(p=>p.id===ancestor.parentId);}
        return {mirror:!!options().mirror,pivot:part.pivot?.[0]??0};
    }
    function refreshFace(){
        const draft=faceDraft??facePatch;if(!draft)return;
        const part=state.project.parts.find(p=>p.id===draft.partId);
        try{
            const settings=mirrorSettings(part),mesh=faceDraft?
                buildFace(part.mesh,draft.corners,{materialFace:draft.materialFace,flip:draft.flip,...settings}):
                (draft.mode==='fill'?fillOpening:addFace)(part.mesh,draft.vertices,draft.materialFace,settings);
            const shown={...part,mesh},parts=state.project.parts.map(p=>p.id===part.id?shown:p);
            topologyPreview={partId:part.id,mesh,added:mesh.faces.length-part.mesh.faces.length,
                triangles:mesh.faces.slice(part.mesh.faces.length).map(f=>f.slice(0,3).map(vertex=>linkedPoint({partId:part.id,vertex,twin:draft.twin},parts)))};
            draft.reason='';
        }catch(error){topologyPreview=null;draft.reason=error.message;report(error.message,true);}
        syncValues();redraw();
    }
    function nearestSnap(world,part,twin,modifiers){
        if(!options().snapCorners||modifiers.shiftKey||modifiers.ctrlKey||modifiers.metaKey||!ctx.viewport?.project)return null;
        const view=ctx.viewport,screen=view.project(world),candidates=[];
        // Preview items are already in world coordinates. References participate
        // only in positioning, never in vertex welding, mesh edits or export.
        const references=(view.items??[]).filter(item=>item.reference&&item.visible!==false&&(item.opacity??1)>.01&&item.mesh?.faces?.length);
        const referenceIds=new Set(references.map(item=>item.id));
        const snapFace=p=>p.reference?referenceIds.has(p.partId):state.project.parts.some(part=>part.id===p.partId&&part.mesh.faces[p.sourceFaceId??p.faceId]);
        const pick=(x,y)=> (view.pickSnap??view.pick)?.call(view,x,y,snapFace);
        const add=(point,kind,ref={})=>{
            const p=view.project(point),d=Math.hypot(p[0]-screen[0],p[1]-screen[1]);if(d>=10)return;
            const front=pick(p[0],p[1]);if(front&&view.project(front.point)[2]<p[2]-2)return;
            candidates.push({point,kind,d,...ref});
        };
        const targets=active().filter(p=>!p.mesh.vertexLinks).map(target=>{
            let vertices=target.mesh.vertices.map(v=>worldPoint(v,target,state.project.parts));
            if(target.id===part.id&&twin)vertices=vertices.map(p=>reflectPoint(p,state.project.parts.find(p=>p.id===part.parentId),state.project.parts));
            return {id:target.id,mesh:target.mesh,vertices};
        }).concat(references.map(item=>({id:item.id,mesh:item.mesh,vertices:item.mesh.vertices,reference:item.id})));
        for(const target of targets){
            const worldVertices=target.vertices,editable=!target.reference&&target.id===part.id;
            const faces=target.mesh.faces.filter((_,i)=>target.mesh.alpha?.[i]!==255&&target.mesh.renderTypes?.[i]!==2);
            const used=new Set(faces.flatMap(f=>f.slice(0,3)));
            for(const i of used)if(!cornerEdit||!editable||!cornerEdit.vertices.includes(i))add(worldVertices[i],'corner',editable?{vertex:i}:target.reference?{reference:target.reference}:{});
            const seen=new Set();
            for(const f of faces)for(let j=0;j<3;j++){
                const a=f[j],b=f[(j+1)%3],key=[a,b].sort((a,b)=>a-b).join(':');if(seen.has(key))continue;seen.add(key);
                const pa=view.project(worldVertices[a]),pb=view.project(worldVertices[b]),dx=pb[0]-pa[0],dy=pb[1]-pa[1];
                const t=Math.max(0,Math.min(1,((screen[0]-pa[0])*dx+(screen[1]-pa[1])*dy)/(dx*dx+dy*dy||1)));
                const za=Math.max(5,view.distance+pa[2]),zb=Math.max(5,view.distance+pb[2]),perspective=(t/zb)/((1-t)/za+t/zb);
                add(worldVertices[a].map((n,i)=>n+(worldVertices[b][i]-n)*perspective),'edge',editable?{edge:[a,b]}:target.reference?{reference:target.reference}:{});
            }
        }
        candidates.sort((a,b)=>(a.kind==='corner'?0:1)-(b.kind==='corner'?0:1)||a.d-b.d);
        if(candidates.length)return candidates[0];
        const hit=pick(screen[0],screen[1]);
        if(hit&&snapFace(hit))return {point:hit.point,kind:'surface',...(hit.reference?{reference:hit.partId}:{})};
        return null;
    }
    function startCorner(id){
        const draft=faceDraft??cornerEdit,part=state.project.parts.find(p=>p.id===draft?.partId);if(!part)return;
        const index=faceDraft?Number(id.slice(5)):0,corner=faceDraft?faceDraft.corners[index]:{vertex:cornerEdit.vertex};
        cornerDrag={id,index,mesh:part.mesh,origin:cornerPoint(part,corner,draft.twin),checkpointed:false};
    }
    function moveCorner(id,delta,modifiers={}){
        if(!cornerDrag||cornerDrag.id!==id||!delta.movement)return;
        const draft=faceDraft??cornerEdit,part=state.project.parts.find(p=>p.id===draft?.partId);if(!part)return;
        const corner=faceDraft?.corners[cornerDrag.index];
        if(corner&&(corner.vertex!==undefined||corner.joined!==undefined)){report('This corner stays joined to the piece. Drag a cyan corner, or use Move corners to reshape the piece.');return;}
        let world=cornerDrag.origin.map((n,i)=>n+delta.movement[i]);
        const snap=nearestSnap(world,part,draft.twin,modifiers);if(snap)world=snap.point;
        const point=localHit({point:world,twin:draft.twin},part);
        if(faceDraft){corner.point=point;delete corner.snap;delete corner.edge;if(snap?.vertex!==undefined)corner.snap=snap.vertex;else if(snap?.edge)corner.edge=snap.edge;faceDraft.snap=snap?`${snap.kind}${snap.reference?' on '+(snap.reference==='reference'?'body reference':'preview gear'):''}`:'';refreshFace();}
        else{
            let updates=new Map(cornerEdit.vertices.map(vertex=>[vertex,point]));
            try{const settings=mirrorSettings(part);if(settings.mirror)updates=mirroredVertexUpdates(cornerDrag.mesh,updates,settings.pivot);}catch(error){report(error.message,true);return;}
            const plan=safeVertexUpdates(cornerDrag.mesh,updates);
            if(!plan.skipped&&!plan.updates.size){
                if(cornerDrag.checkpointed){part.mesh=cornerDrag.mesh;ctx.changed(false);ctx.renderView?.();redraw();}return;
            }
            if(plan.skipped){report('That move would collapse or reverse a face. Move the corner a little less.',true);return;}
            const mesh=structuredClone(cornerDrag.mesh);applyVertexUpdates(mesh,plan.updates);
            try{validateMesh(mesh);}catch(error){report(error.message,true);return;}
            if(!cornerDrag.checkpointed){remember(part);ctx.checkpoint();cornerDrag.checkpointed=true;}
            part.mesh=mesh;ctx.changed(false);ctx.renderView?.();redraw();
        }
    }
    function endCorner(){
        if(cornerDrag?.checkpointed){
            // The normal undo stack owns committed moves. Pointer cancellation
            // ends the stroke rather than making a second invisible edit.
            ctx.draft?.();report('Moved corner. Undo restores this drag.');
        }
        cornerDrag=null;ctx.render?.();
    }
    if(ctx.viewport)ctx.viewport.toolInteraction=()=>{
        if(state.mode!=='sculpt'||state.playing||!['add-face','vertex'].includes(options().tool)||!faceDraft&&!cornerEdit)return null;
        return {points:faceControlPoints,select:id=>{if(faceDraft)faceDraft.selected=Number(id.slice(5));ctx.render?.();redraw();},start:startCorner,move:moveCorner,end:endCorner,
            gizmo:()=>{const selected=faceControlPoints().find(p=>p.id===activeCornerId());return selected&&!selected.locked?{origin:selected.point,directions:[[1,0,0],[0,1,0],[0,0,1]],partId:selected.id,mode:'move'}:null;}};
    };
    if(ctx.viewport)ctx.viewport.toolPick=(hit,screen)=>{
        if(state.mode!=='sculpt')return hit;
        const view=ctx.viewport;if(!view.project||!view.polygons?.length)return hit;
        if(options().tool==='vertex'&&!hit){
            let chosen=null,closest=12;
            for(const p of view.polygons)if(!p.reference&&isActive(state.project.parts.find(part=>part.id===p.partId)))for(const point of p.vertices){
                const s=view.project(point),d=Math.hypot(s[0]-screen[0],s[1]-screen[1]);
                if(d<closest){closest=d;chosen={partId:p.partId,faceId:p.faceId,sourceFaceId:p.sourceFaceId,twin:p.twin,point,screenPoint:screen};}
            }
            return chosen??hit;
        }
        if(options().tool!=='add-face'||options().faceMode!=='edge'||faceDraft)return hit;
        let best=null,closest=12;
        const shown=new Set(view.polygons.filter(p=>!p.reference).map(p=>`${p.partId}/${p.sourceFaceId??p.faceId}/${!!p.twin}`));
        for(const part of active())if(!part.mesh.vertexLinks)for(const edge of openEdges(part.mesh)){
            for(const twin of part.pair?[false,true]:[false]){
                if(!shown.has(`${part.id}/${edge.faceId}/${twin}`))continue;
                const a=cornerPoint(part,{vertex:edge.a},twin),b=cornerPoint(part,{vertex:edge.b},twin),pa=view.project(a),pb=view.project(b);
                const dx=pb[0]-pa[0],dy=pb[1]-pa[1],t=Math.max(0,Math.min(1,((screen[0]-pa[0])*dx+(screen[1]-pa[1])*dy)/(dx*dx+dy*dy||1)));
                const d=Math.hypot(pa[0]+dx*t-screen[0],pa[1]+dy*t-screen[1]);if(d>=closest)continue;
                const za=Math.max(5,view.distance+pa[2]),zb=Math.max(5,view.distance+pb[2]),fraction=(t/zb)/((1-t)/za+t/zb),point=a.map((n,i)=>n+(b[i]-n)*fraction);
                if(hit&&view.project(hit.point)[2]<view.project(point)[2]-2)continue;
                closest=d;best={partId:part.id,faceId:edge.faceId,sourceFaceId:edge.faceId,twin,point,edge:[edge.a,edge.b],screenPoint:screen};
            }
        }
        return best??hit;
    };
    function beginFace(hit,part){
        const faceId=hitFace(hit,part);
        try{
            const corners=startFace(part.mesh,faceId,localHit(hit,part),{mode:options().faceMode,shape:options().faceShape,edge:hit.edge});
            faceDraft={partId:part.id,twin:!!hit.twin,corners,materialFace:faceId,selected:corners.findIndex(c=>c.vertex===undefined&&c.joined===undefined),flip:false};
            topologyStamp=geometryStamp();refreshFace();report('Drag a cyan corner, or use its arrows. Hold Shift or Ctrl to avoid snapping. Apply when the face looks right.');
        }catch(error){report(error.message,true);}
    }
    function previewBridge(next){
        try{
            topologyPreview=options().connectionMode==='surface'&&options().opening!==false?
                planSurfaceConnection(state.project.parts,boundary,next,{variant:state.variant,placement:options().connectionPlacement,twist:Number(options().connectionTwist)}):
                planBridge(state.project.parts,boundary,next,{variant:state.variant,twist:Number(options().connectionTwist)});
            if(options().mirror)topologyPreview=mirrorConnectionPlan(state.project.parts,topologyPreview);
            report(`${topologyPreview.part.mesh.faces.length} new connection faces. Review both sides, then Apply connection or Cancel.`);
        }catch(error){topologyPreview=null;report(error.message,true);}
    }
    function editTopology(hit,part,phase){
        ctx.stop?.();state.selected=part.id;
        if(part.mesh.vertexLinks){report('Edit the original parts. Remove a connection in Build.',true);return true;}
        if(options().tool==='bridge'){
            if(topologyPreview){report('Review the connection. Apply connection or Cancel before choosing another area.');return true;}
            let next;
            try{next=pickConnectionSurface(state.project.parts,hit,{mode:options().opening===false?'edge':options().connectionMode,steps:Number(options().connectionSteps)});}
            catch(error){if(phase==='start')report(error.message,true);return true;}
            if(!next){if(phase==='start')report('Point at an open edge, or choose Surface areas in Advanced to prepare a closed face.',true);return true;}
            if(!boundary){if(phase==='start'){boundary=next;topologyStamp=geometryStamp();report(`Source: ${part.name}. Drag to the target area, or click it next.`);ctx.render?.();redraw();}return true;}
            if(JSON.stringify(next.vertices)===JSON.stringify(boundary.vertices)&&next.partId===boundary.partId&&next.twin===boundary.twin)return true;
            boundaryHover=next;previewBridge(next);
        }else if(options().tool==='delete-face')return deleteStroke(hit,part,phase);
        else if(options().tool==='vertex'){
            if(phase==='start'){
                const faceId=hitFace(hit,part),vertex=part.mesh.faces[faceId].slice(0,3).sort((a,b)=>distance(part.mesh.vertices[a],localHit(hit,part))-distance(part.mesh.vertices[b],localHit(hit,part)))[0];
                cornerEdit={partId:part.id,vertex,vertices:part.mesh.vertices.flatMap((v,i)=>distance(v,part.mesh.vertices[vertex])<1e-5?[i]:[]),twin:!!hit.twin};report('Drag the selected corner or its arrows. Hold Shift or Ctrl to avoid snapping.');
            }
        }else if(options().faceMode==='edge'||options().faceMode==='free'){
            if(phase==='start'&&!faceDraft)beginFace(hit,part);
        }else if(options().faceMode==='fill'){
            if(phase==='start')try{
                const side=pickBoundary(state.project.parts,hit);
                if(!side)throw new Error('Click beside a highlighted opening. Use Extend edge for a partial repair.');
                facePatch={mode:'fill',partId:part.id,twin:!!hit.twin,vertices:side.edges.map(edge=>edge[0]),materialFace:hitFace(hit,part)};
                boundary=side;topologyStamp=geometryStamp();refreshFace();
                if(topologyPreview)report(`Previewing ${topologyPreview.added} faces. Apply face or Cancel.`);
            }catch(error){report(error.message,true);}
        }
        else if(phase==='start'){
            const faceId=hitFace(hit,part);
                if(faceCorners.length&&(faceCorners[0].partId!==part.id||faceCorners[0].twin!==!!hit.twin)){clearTopology();report('Choose three corners on the same part.');}
                if(faceCorners.length===3){faceCorners=[];facePatch=null;topologyPreview=null;}
                const vertex=part.mesh.faces[faceId].slice(0,3).sort((a,b)=>distance(part.mesh.vertices[a],localHit(hit,part))-distance(part.mesh.vertices[b],localHit(hit,part)))[0];
                if(!faceCorners.some(r=>r.vertex===vertex))faceCorners.push({partId:part.id,vertex,twin:!!hit.twin});
                topologyStamp=geometryStamp();
                if(faceCorners.length===3){facePatch={mode:'corners',partId:part.id,twin:!!hit.twin,vertices:faceCorners.map(r=>r.vertex),materialFace:faceId};refreshFace();if(topologyPreview)report('Review the new faces, then Apply face.');}
                else report(`Choose ${3-faceCorners.length} more corners.`);
        }
        syncValues();ctx.render?.();redraw();return true;
    }

    function applyTopology(){
        if(topologyPreview?.blockedReason){report(topologyPreview.blockedReason,true);return;}
        if(options().tool==='connect'&&options().placedCleanupReview){report('Switch to Preview result before applying.');return;}
        if(!topologyPreview||topologyStamp!==geometryStamp()){clearTopology();report('The shape changed. Choose the boundaries or corners again.',true);return;}
        const connection=!!topologyPreview.part,added=topologyPreview.added??1;
        ctx.checkpoint();
        if(topologyPreview.part){
            for(const [id,replacement] of topologyPreview.replacements??[]){Object.assign(state.project.parts.find(p=>p.id===id),replacement);options().faces[id]=[];selections.delete(id);}
            state.project.parts.push(topologyPreview.part);state.selected=topologyPreview.part.id;
        }
        else{const part=state.project.parts.find(p=>p.id===topologyPreview.partId);part.mesh=topologyPreview.mesh;saveSelection(part,new Set(Array.from({length:added},(_,i)=>part.mesh.faces.length-added+i)));}
        const placed=options().tool==='connect';
        clearTopology();if(placed)options().tool='select';ctx.changed(false);ctx.render?.();ctx.draft?.();report(connection?'Connected pieces. Undo restores the whole join.':`Added ${added===1?'face':added+' faces'}. Undo restores the whole addition.`);
    }
    function removeSelectedFaces(){
        const part=currentPart();if(!part)return;
        try{
            const selected=options().mirror?mirroredFaces(part.mesh,selectedFaces(part),part.pivot?.[0]??0,{unique:true}):selectedFaces(part), linked=state.project.parts.filter(p=>p.mesh.vertexLinks?.some(r=>r.partId===part.id));
            if(linked.some(p=>p.connectionEdges?.some(edge=>part.mesh.faces.some((f,i)=>selected.has(i)&&edge.every(r=>r.partId===part.id&&f.slice(0,3).includes(r.vertex))))))throw new Error('Remove the attached connection in Build before deleting its boundary faces.');
            const mesh=deleteFaces(part.mesh,selected);ctx.checkpoint();part.mesh=mesh;clearTopology();saveSelection(part,new Set());ctx.changed(false);ctx.render?.();ctx.draft?.();report(`Deleted ${selected.size} faces from ${part.name}.`);
        }catch(error){report(error.message,true);}
    }

    function deleteFootprint(hit, part, mesh = part.mesh, polygons = ctx.viewport?.polygons) {
        const id=hit.sourceFaceId??hit.faceId%mesh.faces.length;
        if(!mesh.faces[id])return new Set();
        let faces=new Set([id]);
        if(options().deleteSize!=='face'){
            const center=localHit(hit,part),near=brushFaces(mesh,center,options().radius,{metric:p=>worldPoint(p,part,state.project.parts)});
            const joined=connectedFaces(mesh,[id],{angle:75,topology:meshTopology(mesh,{coincident:false})}),view=ctx.viewport;
            faces=polygons?.length?visibleFaceIds(polygons,part.id,{candidates:new Set([...near].filter(i=>joined.has(i))),faceCount:mesh.faces.length,twin:!!hit.twin,width:view.width,height:view.height,distance:view.distance}):new Set();
        }
        // Mirroring is an explicit edit of the exact reflected triangle, never
        // a nearest-face guess. Ambiguous coincident shells remain untouched.
        if(options().mirror)faces=mirroredFaces(mesh,faces,part.pivot?.[0]??0,{unique:true});
        const protectedVertices=new Set(state.project.parts.flatMap(p=>(p.connectionEdges??[]).flat().filter(r=>r.partId===part.id).map(r=>r.vertex)));
        return new Set([...faces].filter(i=>mesh.alpha?.[i]!==255&&mesh.renderTypes?.[i]!==2&&!mesh.faces[i].slice(0,3).some(v=>protectedVertices.has(v))));
    }

    function deleteStroke(hit,part,phase) {
        if(phase==='start'||!stroke)stroke={partId:part.id,twin:!!hit.twin,checkpointed:false,originalMesh:part.mesh,
            polygons:[...(ctx.viewport?.polygons??[])],removed:new Set(),indices:part.mesh.faces.map((_,i)=>i)};
        if(stroke.partId!==part.id||stroke.twin!==!!hit.twin)return true;
        if(hit.screenPoint){
            // Keep the stroke's first visible shell. Deleting it must not turn
            // the same gesture into a ray that drills through the rear shell.
            const [x,y]=hit.screenPoint;
            const p=frontPolygon(stroke.polygons,x,y);
            if(!p||p.partId!==part.id||!!p.twin!==!!hit.twin)return true;
            const original=p.sourceFaceId??p.faceId%stroke.originalMesh.faces.length;
            if(stroke.removed.has(original))return true;
            hit={...hit,sourceFaceId:original};
        }else{
            const current=hit.sourceFaceId??hit.faceId%part.mesh.faces.length;
            hit={...hit,sourceFaceId:stroke.indices[current]};
        }
        const selected=deleteFootprint(hit,part,stroke.originalMesh,stroke.polygons);
        const safe=new Set(stroke.indices.flatMap((original,i)=>selected.has(original)?[i]:[]));
        if(!safe.size){report('This face supports a connection. Remove that connection in Build first.');return true;}
        try{
            const mesh=deleteFaces(part.mesh,safe);
            if(!stroke.checkpointed){ctx.checkpoint();stroke.checkpointed=true;}
            for(const i of safe)stroke.removed.add(stroke.indices[i]);
            stroke.indices=stroke.indices.filter((_,i)=>!safe.has(i));part.mesh=mesh;
            hovered=null;hoverHit=null;options().faces[part.id]=[];selections.delete(part.id);invalidate();
            lastEdit=`Deleted ${stroke.removed.size} faces from ${part.name}. Undo restores this stroke.`;
            ctx.changed(false);syncValues();ctx.renderProperties?.();redraw();report(lastEdit);
        }catch(error){report(error.message,true);}
        return true;
    }

    function pointInTriangle(points,x,y){
        const sign=(a,b)=>(a[0]-x)*(b[1]-y)-(a[1]-y)*(b[0]-x),s=[sign(points[0],points[1]),sign(points[1],points[2]),sign(points[2],points[0])];
        return !(s.some(n=>n<0)&&s.some(n=>n>0));
    }
    function frontPolygon(polygons,x,y){
        let front=null,nearest=Infinity;
        for(const p of [...polygons].reverse())if(!p.reference&&(p.alpha??1)>.01&&p.points?.length===3&&pointInTriangle(p.points,x,y)){
            const [a,b,c]=p.points,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
            if(!Number.isFinite(ctx.viewport.distance)||!a.every(Number.isFinite)||a.length<3){return p;}
            const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;
            const depth=1/[u,v,1-u-v].reduce((n,w,i)=>n+w/Math.max(5,ctx.viewport.distance+p.points[i][2]),0);
            if(depth<nearest-1e-7){nearest=depth;front=p;}
        }
        return front;
    }

    function applyRegion(tool) {
        const part = currentPart(), config = options();
        if (!isActive(part) || !selectedFaces(part).size) return;
        const faces = selectedFaces(part), vertices = regionVertices(part.mesh, faces);
        const center = [0, 1, 2].map(a => [...vertices].reduce((sum, i) => sum + part.mesh.vertices[i][a], 0) / vertices.size);
        const normal = normalise([...faces].reduce((sum, id) => { const n = faceNormal(part.mesh, id); return sum.map((v, a) => v + n[a]); }, [0, 0, 0]));
        const plan = tool === 'flatten' ? planFlatten(part.mesh, faces, { axis: config.flattenAxis, amount: config.strength, lockBoundary: config.lockBoundary }) :
            tool === 'smooth' ? planSculpt(part.mesh, { center, radius: Infinity, amount: config.strength, tool, normal, faces, lockBoundary: config.lockBoundary }) :
                planRegionOffset(part.mesh, faces, { amount: config.strength * (tool === 'push' ? -1 : 1), lockBoundary: config.lockBoundary });
        apply(part, plan, `${tool === 'pull' ? 'Inflated' : tool === 'push' ? 'Deflated' : tools.find(([id]) => id === tool)[1]} selected faces`);
    }

    function findSeams() {
        const part = currentPart(); if (!isActive(part) || !selectedFaces(part).size) return;
        const config = options(), parts = active();
        // Keep ancestor transforms even when their meshes are hidden or isolated.
        const targets = state.project.parts.map(p => parts.some(a => a.id === p.id) ? p : { ...p, visible: false });
        let plan = planSeamConnection(targets, part.id, { faces: selectedFaces(part), tolerance: config.seamTolerance,
            target: config.seamTarget, variant: state.variant, sourceTwin: config.instanceTwin, lockBoundary: config.lockBoundary });
        try{const settings=mirrorSettings(part);if(settings.mirror){const updates=mirroredVertexUpdates(part.mesh,plan.updates,settings.pivot),safe=safeVertexUpdates(part.mesh,updates);if(safe.skipped)throw new Error('The mirrored seam would collapse a face. Lower Max gap.');plan={...plan,...safe};}}catch(error){invalidate();syncValues();report(error.message,true);return;}
        const key = edge => `${edge.partId}/${edge.twin}/${edge.faceId}`;
        preview = { ...plan, partId: part.id, stamp: geometryStamp(), sourceFaces: new Set(plan.pairs.map(p => key(p.source))), targetFaces: new Set(plan.pairs.map(p => key(p.target))) };
        report(plan.pairs.length ? `${plan.pairs.length} edge pairs found. Orange faces will snap to green faces.` : 'No safe matching edges nearby. Select an open edge or increase Max gap.');
        syncValues(); redraw();
    }

    function connectSeams() {
        const part = currentPart();
        if (!preview || preview.partId !== part?.id || preview.stamp !== geometryStamp()) { invalidate(); syncValues(); report('The shape changed. Find nearby seams again.'); return; }
        const count = preview.pairs.length; apply(part, preview, `Connected ${count} edge pairs`);
    }

    function restoreShape(onlySelection) {
        const part = currentPart(); if (!isActive(part) || !hasBaseline(part)) return;
        const baseline = baselines.get(part.id), faces = onlySelection ? selectedFaces(part) : null;
        const ids = regionVertices(part.mesh, faces, { lockBoundary: onlySelection && options().lockBoundary });
        const updates = new Map([...ids].filter(i => distance(part.mesh.vertices[i], baseline.vertices[i]) > 1e-7).map(i => [i, baseline.vertices[i]]));
        // A whole-part snapshot is already a known valid shape. Comparing its
        // normals to a heavily bent current shape could wrongly block a reset.
        apply(part, onlySelection ? safeVertexUpdates(part.mesh, updates) : { updates, skipped: 0 }, 'Restored session shape');
    }

    function bind(pane, node, update) { bindings[pane].push(() => update(node)); update(node); return node; }
    function note(text) { return el('p', { class: 'sculpt-note', text }); }
    function heading(parent, title) { const node = el('section', { class: 'sculpt-section' }, el('h3', { text: title })); parent.append(node); return node; }
    function action(pane, title, fn, disabled = () => false, attrs = {}) {
        return bind(pane, button(title, fn, attrs), node => node.disabled = disabled());
    }
    function row(...children) { return el('div', { class: 'sculpt-actions' }, ...children); }
    function choice(parent, label, key, values) {
        const input = el('select', { 'aria-label': label }, ...values.map(([value, text]) => el('option', { value, text, selected: String(options()[key]) === String(value) })));
        input.addEventListener('change', () => setOption(key, input.value)); parent.append(el('label', { class: 'sculpt-field' }, label, input)); return input;
    }
    function toggle(parent, label, key, title = '') {
        const input = el('input', { type: 'checkbox', checked: options()[key], 'aria-label':label, onChange: e => setOption(key, e.target.checked), title });
        parent.append(el('label', { class: 'sculpt-check' }, input, label)); return input;
    }
    function range(parent, label, key, min, max, step = 1, pane = 'tools', format = String) {
        const output = el('output', { text: format(options()[key]) });
        const input = el('input', { type: 'range', min, max, step, value: options()[key], 'aria-label': label,
            onInput: e => { const n = Number(e.target.value); if (Number.isFinite(n)) { setOption(key, Math.max(min, Math.min(max, n)), false); output.value = format(options()[key]); } } });
        bind(pane, input, node => { node.value = String(options()[key]);node.ariaValueText=format(options()[key]);output.value = format(options()[key]); });
        parent.append(el('label', { class: 'sculpt-range' }, el('span', {}, label, output), input)); return input;
    }
    function disclosure(parent, title) {
        const node = el('details', { class: 'sculpt-section', open: options().open[title] ?? false,
            onToggle: event => { if (event.target.isConnected !== false) options().open[title] = event.target.open; } }, el('summary', { text: title }));
        parent.append(node); return node;
    }

    function renderTools(target) {
        ensureProject(); bindings.tools = [];
        const root = el('div', { class: 'sculpt-panel sculpt-tools' }, el('h2', { text: 'Sculpt' })); target.replaceChildren(root);
        if (!state.project) { root.append(note('Add a creature or item in Build first.')); return; }
        const config = options();
        root.append(button('Connect placed pieces',()=>beginConnection(),{'data-sculpt-tool':'connect','aria-pressed':config.tool==='connect',class:'sculpt-connect-primary'}));
        if(config.tool==='connect'){
            toggle(root,'Mirror across part X','mirror','Join the matching opposite side too. Centered joins and linked pairs are not doubled.');
            const pieces=connectionPieces();
            if(pieces.length<2){clearTopology();connectionReason='Add or show another piece in this view.';}
            else if(!pieces.some(p=>p.id===config.placedSource)||!pieces.some(p=>p.id===config.placedTarget)){
                config.placedSource=pieces.at(-1).id;config.placedTarget=pieces.find(p=>p.id!==config.placedSource).id;config.placedGuides=[];config.placedGuidePick=null;guideStamp=null;preparePlacedConnection();
            }
            choice(root,'Attach','placedSource',pieces.map(p=>[p.id,p.name]));
            choice(root,'Connect to','placedTarget',pieces.filter(p=>p.id!==config.placedSource).map(p=>[p.id,p.name]));
            root.append(note('Pieces stay where you placed them. Drag from a piece to another, or choose their names.'));
            toggle(root,'Add connection faces','placedFaces');
            const guided=el('section',{class:'sculpt-guides'}),pairs=config.placedGuides,pick=config.placedGuidePick;
            guided.append(button('Add guide pair',()=>startGuidePair(),{'aria-pressed':!!pick}));
            for(const [index,pair]of pairs.entries()){
                const name=guideName(index),line=el('div',{class:'sculpt-guide-row'},el('b',{text:name}));
                for(const [side,key]of [['source','placedSource'],['target','placedTarget']])line.append(button(state.project.parts.find(p=>p.id===config[key])?.name??side,
                    ()=>startGuidePair({index,side}),{'aria-label':`Move guide ${name} ${side}`,class:`sculpt-guide-${side}`}));
                line.append(button('×',()=>{pairs.splice(index,1);startGuidePair();},{'aria-label':`Remove guide ${name}`}));guided.append(line);
            }
            if(pick){const side=pick.side??(pick.source?'target':'source'),name=guideName(pick.index??pairs.length);
                guided.append(note(pairs.length&&!pick.source&&pick.index===undefined?`Fill connection now, or click the opening to add guide ${name}.`:
                    `Guide ${name}: click ${side==='source'?'the orange opening':'where it should land on the other piece'}.`));}
            else guided.append(note(pairs.length?'Move a lettered point or add more pairs, then fill again.':'Pair spots on the opening with spots on the target. One pair is enough. Add more to control the route.'));
            guided.append(row(action('tools','Fill connection',()=>{config.placedGuidePick=null;rebuildPlacedConnection();ctx.render?.();},()=>!pairs.length||!!pick?.source||pick?.index!==undefined),
                action('tools','Undo last guide',()=>{if(config.placedGuidePick?.source)startGuidePair();else{pairs.pop();startGuidePair();}},()=>!pairs.length&&!pick?.source)));
            if(pairs.length)guided.append(button('Clear guides',()=>{config.placedGuides=[];config.placedGuidePick=null;guideStamp=null;preparePlacedConnection();ctx.render?.();}));
            root.append(guided);
            const shape=el('div',{class:'sculpt-join-shape'});
            if(!pairs.length&&!pick){range(shape,'Landing distance','placedLanding',0,100,5,'tools',value=>value?`${value}% farther`:'Nearest');
                shape.append(note('For a specific side or route, add guide pairs.'));}
            if(!pairs.length&&!pick)range(shape,'Coverage','placedCoverage',50,150,5);
            range(shape,'Complexity','placedComplexity',0,3,1,'tools',value=>['Low','Medium','High','Maximum'][value]??'Low');
            range(shape,pairs.length||pick?'Lift':'Ramp','placedRamp',0,100,5);
            const cleanup=disclosure(shape,'Cleanup');
            if(pairs.length||pick)toggle(cleanup,'Fit around crossings','placedRepairCrossings');
            toggle(cleanup,'Remove enclosed faces','placedRemoveEnclosed');
            toggle(cleanup,'Remove loose join scraps','placedRemoveLoose');
            cleanup.append(bind('tools',note(''),node=>{
                const summary=topologyPreview?.cleanup;
                node.textContent=summary?`${topologyPreview.repairedFaces??0} crossing faces fitted. ${summary.enclosed} enclosed faces removed. ${summary.loose} loose join faces removed.`:'Fill to preview cleanup.';
            }));
            cleanup.append(action('tools','Review removed faces',()=>setOption('placedCleanupReview',true),()=>!topologyPreview?.cleanup?.removedItems.length||config.placedCleanupReview));
            cleanup.append(action('tools','Preview result',()=>setOption('placedCleanupReview',false),()=>!config.placedCleanupReview));
            cleanup.append(note('Enclosed faces need a closed, opaque, untextured surrounding surface. Loose cleanup only removes unattached join scraps. Guides and existing attachments are protected.'));
            const advanced=disclosure(shape,'More shape controls');
            if(!pairs.length&&!pick){range(advanced,'Bend','placedBend',-100,100,5);range(advanced,'Recess','placedRecess',-100,100,5);}
            toggle(advanced,'Show contact surfaces','placedInspect');
            advanced.append(button('Reset shape',()=>{
                Object.assign(options(),{placedCoverage:100,placedComplexity:0,placedRamp:0,placedBend:0,placedRecess:0,placedLanding:0});rebuildPlacedConnection();
                if(!topologyPreview){options().placedRamp=0;rebuildPlacedConnection();}
                syncValues();redraw();
            }));
            advanced.append(note(pairs.length||pick?'Guided fill closes the opening over the target skin. Lift raises the fill between your fixed guide points. Existing overlaps at the opening remain; turn on Show contact surfaces to inspect them.':'Bend curves the join. Positive Recess tucks it into the head or limb. Zero Ramp makes straight edges.'));
            bind('tools',shape,node=>node.hidden=!options().placedFaces);root.append(shape);
            root.append(bind('tools',el('output',{class:'sculpt-connection-state','aria-live':'polite'}),node=>{
                node.textContent=config.placedCleanupReview?'Reviewing removed faces only. Choose Preview result before applying.':!options().placedFaces?'No faces will be added. Any open backs stay open.':connectionReason||
                    (topologyPreview?`${topologyPreview.part.mesh.faces.length} connection faces. Preview ready.${options().placedInspect&&topologyPreview.overlapFaces?.length?' Pink shows contact with existing surfaces.':''}`:pairs.length?'Add more guide pairs or Fill connection.':'Choose two pieces in this view.');
            }));
            root.append(row(action('tools','Apply connection',applyTopology,()=>!topologyPreview||!!topologyPreview.blockedReason||!options().placedFaces||config.placedCleanupReview,{class:'primary'}),
                action('tools',config.placedFaces?'Cancel':'Keep pieces without faces',()=>{clearTopology();config.placedGuides=[];config.placedGuidePick=null;guideStamp=null;options().tool='select';ctx.render?.();})));
            if(ctx.api){
                const recovery=disclosure(root,'Save options');
                recovery.append(action('tools','Save a separate copy',saveSeparateCopy,()=>savingCopy));
                recovery.append(note('Use if Save reports a change in another tab. Keeps your edits and guides in a new project.'));
            }
            const manual=disclosure(root,'Advanced modelling');
            manual.append(button('Pick connection areas',()=>setOption('tool','bridge'),{'data-sculpt-tool':'bridge'}));
            manual.append(note('Choose exact surfaces or openings instead of finding the join automatically.'));
            syncValues();return;
        }
        const group = el('div', { class: 'sculpt-tool-grid', role: 'group', 'aria-label': 'Sculpt tool' });
        for (const [id, title] of tools) group.append(button(title, () => setOption('tool', id), { 'aria-pressed': config.tool === id, 'data-sculpt-tool': id }));
        root.append(group);
        const topology=el('div',{class:'sculpt-topology',role:'group','aria-label':'Edit faces'});
        for(const [id,label] of [['add-face','Add face'],['delete-face','Delete faces brush'],['vertex','Move corners']])topology.append(button(label,()=>setOption('tool',id),{'aria-pressed':config.tool===id,'data-sculpt-tool':id}));
        root.append(topology);
        const modelling=disclosure(root,'Advanced modelling');
        modelling.append(button('Pick connection areas',()=>setOption('tool','bridge'),{'aria-pressed':config.tool==='bridge','data-sculpt-tool':'bridge'}));
        if(topologyTool()){
            if(['add-face','vertex','bridge'].includes(config.tool))toggle(root,'Mirror across part X','mirror','Apply to matching opposite corners too. Linked pairs share one edit.');
            if(config.tool==='bridge'){
                root.append(note(boundary?'Choose the target area. Cyan previews the connection.':'Click an area on the part to attach, then an area on the body. You can also drag between them.'));
                root.append(bind('tools',el('output',{class:'sculpt-connection-state','aria-live':'polite'}),node=>{
                    const name=side=>state.project.parts.find(p=>p.id===side?.partId)?.name;
                    node.textContent=topologyPreview?`${name(boundary)} to ${name(boundaryHover)}. ${topologyPreview.removed??0} faces open on Apply.${topologyPreview.overlapFaces?.length?' Pink faces touch the join. Choose a smaller area or move the source in Build if the join looks buried.':''}`:boundary?`Source: ${name(boundary)}. Choose target.`:'Choose source area';
                }));
                const advanced=disclosure(root,'Advanced connection');
                choice(advanced,'Choose with','connectionMode',[['surface','Surface areas'],['opening','Existing openings'],['edge','Existing edge']]);
                choice(advanced,'Placement','connectionPlacement',[['align','Fit and align source'],['move','Move source, keep rotation'],['keep','Keep placement']]);
                choice(advanced,'Area size','connectionSteps',[['0','One face'],['1','Small patch'],['2','Larger patch']]);
                range(advanced,'Rotate rim','connectionTwist',-12,12);
                advanced.append(note('Fit moves the source and its children. Existing openings and edges keep their placement. For a sharp join, use a small area.'));
            }else if(config.tool==='delete-face'){
                root.append(note('Click or drag to erase the highlighted faces. Undo restores the whole stroke.'));
                choice(root,'Delete with','deleteSize',[['face','One face at a time'],['area','Visible brush patch']]);
                if(config.deleteSize==='area')range(root,'Brush size','radius',1,150);
                toggle(root,'Mirror across part X','mirror','Also erases exact matching faces on the opposite side. Paired instances share their shape.');
                if(config.mirror)root.append(note('Only matching opposite faces are mirrored. Uneven or overlapping faces may have no safe match.'));
                root.append(action('tools','Delete selected faces',removeSelectedFaces,()=>!selectedFaces().size));
            }else if(config.tool==='vertex'){
                root.append(note('Click a corner on the piece. Drag its handle or arrows to reshape it. Shift or Ctrl temporarily turns snapping off.'));
                toggle(root,'Snap to corners, edges and surfaces','snapCorners');
                if((ctx.viewport?.items??[]).some(item=>item.reference))root.append(note('Visible body references and preview gear are also snap targets.'));
            }else if(config.faceMode==='corners'){
                choice(root,'Create with','faceMode',[['edge','Extend edge'],['free','New shape'],['fill','Fill opening'],['corners','Pick three corners']]);
                root.append(note('Click three corners around a gap. Review the highlighted triangle, then Apply face.'));
                root.append(el('output',{class:'sculpt-connection-state',text:`${faceCorners.length} of 3 corners chosen`,'aria-live':'polite'}));
                root.append(action('tools','Back one corner',()=>{faceCorners.pop();facePatch=null;topologyPreview=null;ctx.render?.();redraw();},()=>!faceCorners.length));
            }else{
                choice(root,'Create with','faceMode',[['edge','Extend edge'],['free','New shape'],['fill','Fill opening'],['corners','Pick three corners']]);
                if(config.faceMode==='fill')root.append(note('Click beside an opening to preview its fill. For a few faces, choose Extend edge instead.'));
                else{
                    choice(root,'Shape','faceShape',[['triangle','Triangle'],['quad','Four corners']]);
                    root.append(note(faceDraft?'Drag the lettered cyan corners or use their arrows. Orange corners stay joined. Shift or Ctrl turns snapping off.':config.faceMode==='edge'?'Click a highlighted edge. A starter face appears with corners you can drag.':'Click a surface to place a new face. Drag any corner to make your shape.'));
                    toggle(root,'Snap to corners, edges and surfaces','snapCorners');
                    if((ctx.viewport?.items??[]).some(item=>item.reference))root.append(note('Visible body references and preview gear are also snap targets.'));
                    if(faceDraft){
                        const choices=el('div',{class:'sculpt-corners',role:'group','aria-label':'Face corners'});
                        faceDraft.corners.forEach((corner,i)=>choices.append(button(`${String.fromCharCode(65+i)}${corner.vertex!==undefined||corner.joined!==undefined?' · joined':''}`,()=>{faceDraft.selected=i;ctx.render?.();redraw();},{'aria-pressed':faceDraft.selected===i,'data-face-corner':i})));
                        root.append(choices);
                        const selected=faceDraft.corners[faceDraft.selected],part=state.project.parts.find(p=>p.id===faceDraft.partId);
                        if(selected?.vertex===undefined&&selected?.joined===undefined){
                            const position=el('div',{class:'sculpt-corner-position'}),world=cornerPoint(part,selected,faceDraft.twin);
                            for(const [axis,label]of ['X','Y','Z'].entries())position.append(el('label',{text:label},el('input',{type:'number',step:1,value:Math.round(world[axis]*100)/100,'aria-label':`Corner ${label}`,onChange:event=>{
                                const value=Number(event.target.value);if(!Number.isFinite(value))return;
                                const next=cornerPoint(part,selected,faceDraft.twin);next[axis]=value;
                                selected.point=localHit({point:next,twin:faceDraft.twin},part);delete selected.snap;delete selected.edge;refreshFace();ctx.render?.();
                            }})));
                            root.append(position);
                        }
                        if(config.faceMode==='free')root.append(action('tools','Flip facing side',()=>{faceDraft.flip=!faceDraft.flip;refreshFace();ctx.render?.();}));
                    }
                    root.append(bind('tools',el('output',{class:'sculpt-connection-state','aria-live':'polite'}),node=>{node.textContent=faceDraft?(faceDraft.reason||`Ready to apply${faceDraft.snap?' · snapped to '+faceDraft.snap:''}.`):'Choose where to start';}));
                }
            }
            if(!['delete-face','vertex'].includes(config.tool))root.append(row(action('tools',config.tool==='add-face'?'Apply face':'Apply connection',applyTopology,()=>!topologyPreview,{class:'primary'}),action('tools','Cancel',()=>{clearTopology();ctx.render?.();},()=>!boundary&&!faceCorners.length&&!faceDraft&&!topologyPreview)));
            syncValues();return;
        }
        if (config.tool === 'select') {
            choice(root, 'Select with', 'selectionTool', [['face', 'Face'], ['connected', 'Connected surface'], ['brush', 'Brush']]);
            const modes = el('div', { class: 'sculpt-segment', role: 'group', 'aria-label': 'Selection mode' });
            for (const [id, title] of [['replace', 'Replace'], ['add', 'Add to selection'], ['remove', 'Remove from selection']]) modes.append(button(title, () => setOption('selectionMode', id), { 'aria-pressed': config.selectionMode === id }));
            root.append(modes);
            if (config.selectionTool === 'connected') {
                range(root, 'Stop at sharp bends', 'angle', 5, 180, 5);
                root.append(note('Click to follow joined edges, including the back. A smaller angle stops at sharper bends. 180 selects the whole connected piece.'));
            } else root.append(note(config.selectionTool === 'brush' ? 'Drag over faces to select a patch.' : 'Click a face, or drag to select several.'));
        } else {
            choice(root, 'Edit area', 'scope', [['selection', 'Selected faces'], ['part', 'Whole part']]);
            root.append(note(config.tool === 'flatten' ? 'Drag to flatten toward the first face you touch.' : 'Drag on the model to shape it.'));
        }
        if (config.tool !== 'select' || config.selectionTool === 'brush') range(root, 'Brush size', 'radius', 1, 150);
        if (config.tool !== 'select') range(root, 'Strength', 'strength', 1, 10);
        if (config.tool !== 'select' || config.selectionTool === 'brush') toggle(root, 'Visible surface only', 'visibleOnly');
        toggle(root, 'Mirror across part X', 'mirror', 'Copies the selection and brush to the opposite side of this part. Paired instances already share their shape.');
        if (config.tool !== 'select') {
            const extra = disclosure(root, 'Brush options');
            choice(extra, 'Brush edge', 'falloff', [['soft', 'Soft'], ['constant', 'Hard']]);
            toggle(extra, 'Fix selection border', 'lockBoundary', 'Keeps vertices shared with unselected faces still.');
        }
        root.append(bind('tools', note(''), node => node.textContent = selectionText()));
        const help = disclosure(root, 'Keys and camera');
        help.append(note('1 Select, 2 Pull, 3 Push, 4 Smooth, 5 Flatten. [ and ] resize the brush. Ctrl+A selects this part. Escape clears selection. Shift adds faces; Alt removes. Middle drag pans; right drag turns.'));
        syncValues();
    }

    function selectionText() {
        const part = currentPart();
        return part ? `${selectedFaces(part).size.toLocaleString()} of ${part.mesh.faces.length.toLocaleString()} faces selected` : 'Click a part to begin.';
    }

    function renderProperties(target) {
        ensureProject(); bindings.properties = [];
        const root = el('div', { class: 'sculpt-panel sculpt-properties' }); target.replaceChildren(root);
        if (!state.project) return;
        if(['connect','bridge'].includes(options().tool)){
            root.append(el('h3',{text:'Connection preview'}),note('Orange is the open back. Cyan is the new join. Turn the view to check every side.'));
            root.append(note('Apply creates one undo step. Existing materials and movement stay attached to their pieces.'));
            return;
        }
        const part = currentPart(); if (!part) { root.append(note('Click a part to select its faces.')); return; }
        root.append(el('h3', { text: part.name }), bind('properties', el('output', { class: 'sculpt-count', 'aria-live': 'polite' }), node => node.textContent = selectionText()));
        if(part.mesh.vertexLinks){root.append(note('This connection follows its endpoints. Shape the original parts, or remove the connection in Build.'));syncValues();return;}
        const noPart = () => !isActive(currentPart()), noSelection = () => noPart() || !selectedFaces().size;
        const selection = heading(root, 'Face selection');
        selection.append(action('properties','Delete selected faces',removeSelectedFaces,noSelection,{'data-sculpt-delete':''}));
        selection.append(row(...[['all', 'All'], ['clear', 'Clear'], ['invert', 'Invert'], ['connected', 'Connected'], ['grow', 'Grow'], ['shrink', 'Shrink']]
            .map(([id, title]) => action('properties', title, () => selectOperation(id), id === 'all' || id === 'invert' ? noPart : noSelection, { 'data-sculpt-selection': id }))));
        selection.append(button(state.isolate ? 'Show all parts' : 'Show only this part', () => { state.isolate = !state.isolate; invalidate(); ctx.render?.(); }));
        const region = heading(root, 'Shape selected faces');
        region.append(row(...[['pull', 'Inflate once'], ['push', 'Deflate once'], ['smooth', 'Smooth once']].map(([tool, label]) => action('properties', label, () => applyRegion(tool), noSelection))));
        range(region, 'Amount', 'strength', 1, 10, 1, 'properties');
        choice(region, 'Flatten plane', 'flattenAxis', [['surface', 'Average surface'], ['0', 'Local X'], ['1', 'Local Y'], ['2', 'Local Z']]);
        region.append(action('properties', 'Flatten selected faces', () => applyRegion('flatten'), noSelection));
        toggle(region, 'Fix selection border', 'lockBoundary');
        const seams = disclosure(root, 'Connect nearby edges');
        choice(seams, 'Connect to', 'seamTarget', [['self', 'Edges in this part'], ['parts', 'Other visible parts']]);
        range(seams, 'Max gap', 'seamTolerance', .25, 20, .25, 'properties');
        seams.append(note('Select faces along an open edge. Find a matching edge, then apply the preview. Existing vertices snap into place. Parts keep their own movement, so check seams while playing an animation.'));
        seams.append(action('properties', 'Find nearby seams', findSeams, noSelection));
        seams.append(bind('properties', el('output', { class: 'sculpt-count', 'aria-live': 'polite' }), node => node.textContent = preview ?
            `${preview.pairs.length} edge pairs, ${preview.updates.size} vertices will move${preview.skipped ? `, ${preview.skipped} protected` : ''}.` : 'Orange moves to green.'));
        seams.append(row(action('properties', 'Apply connection', connectSeams, () => noSelection() || !preview?.pairs.length, { class: 'primary' }),
            action('properties', 'Cancel preview', () => { invalidate(); syncValues(); redraw(); }, () => !preview)));
        const restore = disclosure(root, 'Restore shape');
        restore.append(note('Restore the shape from before your first Sculpt edit in this session. Undo can bring your edits back.'));
        restore.append(row(action('properties', 'Restore selected', () => restoreShape(true), () => noSelection() || !hasBaseline(currentPart())),
            action('properties', 'Restore whole part', () => restoreShape(false), () => noPart() || !hasBaseline(currentPart()))));
        root.append(bind('properties', note(''), node => { node.textContent = lastEdit; node.hidden = !lastEdit; }));
        syncValues();
    }

    function syncValues() {
        ensureProject();
        if(guideStamp&&guideStamp!==geometryStamp()){options().placedGuides=[];options().placedGuidePick=null;guideStamp=null;clearTopology();report('The pieces changed. Pick the guide points again.');}
        if(topologyStamp && topologyStamp!==geometryStamp())clearTopology();
        if (preview && preview.stamp !== geometryStamp()) invalidate();
        for (const update of [...bindings.tools, ...bindings.properties]) update();
    }

    function onHover(hit) {
        if (state.mode !== 'sculpt') { if (hovered) { hovered = null; redraw(); } return; }
        const part = state.project?.parts.find(p => p.id === hit?.partId);
        const faceId = part && isActive(part) ? hitFace(hit, part) : null;
        const next = faceId === null ? null : { partId: part.id, faceId, twin: !!hit.twin };
        hoverHit=hit;
        hoverFootprint=new Set();
        if(part&&faceId!==null&&options().tool==='delete-face'){
            if(stroke?.originalMesh){
                let original;
                if(hit.screenPoint){
                    const p=frontPolygon(stroke.polygons,...hit.screenPoint);
                    if(p?.partId===part.id&&!!p.twin===!!hit.twin)original=p.sourceFaceId??p.faceId%stroke.originalMesh.faces.length;
                }else original=stroke.indices[faceId];
                if(stroke.partId===part.id&&stroke.twin===!!hit.twin&&original!==undefined&&!stroke.removed.has(original)){
                    const ids=deleteFootprint({...hit,sourceFaceId:original},part,stroke.originalMesh,stroke.polygons);
                    hoverFootprint=new Set(stroke.indices.flatMap((id,i)=>ids.has(id)?[i]:[]));
                }
            }else hoverFootprint=deleteFootprint(hit,part);
        }
        if((options().tool==='bridge'||options().tool==='add-face'&&options().faceMode==='fill')&&!topologyPreview){try{boundaryHover=hit?pickConnectionSurface(state.project.parts,hit,{mode:options().opening===false?'edge':options().connectionMode,steps:Number(options().connectionSteps)}):null;}catch{boundaryHover=null;}}
        if (JSON.stringify(next) !== JSON.stringify(hovered)) { hovered = next; redraw(); }
    }

    function faceOverlay(polygon) {
        if (state.mode !== 'sculpt' || polygon.reference) return null;
        const part = state.project?.parts.find(p => p.id === polygon.partId)??(topologyPreview?.part?.id===polygon.partId?topologyPreview.part:null); if (!part) return null;
        if(faceDraft&&polygon.partId===faceDraft.partId&&(polygon.sourceFaceId??polygon.faceId)>=part.mesh.faces.length)return {fill:'#63e6ff66',stroke:'#ffffff',underStroke:'#101010',lineWidth:2,underWidth:5};
        const id = hitFace(polygon, part); if (id === null) return null;
        const feedback=(fill,stroke='#ffffff',lineWidth=1.5)=>({fill,stroke,lineWidth,underStroke:'#101010',underWidth:lineWidth+3});
        if(topologyPreview?.part?.id===part.id)return options().tool==='connect'?{fill:'#63e6ff55'}:feedback('#63e6ff80','#ffffff',1);
        if((options().tool!=='connect'||options().placedInspect)&&topologyPreview?.overlapFaces?.some(f=>f.partId===part.id&&f.faceId===id&&f.twin===!!polygon.twin))return feedback('#ff4fd080','#ffd2f1',2);
        if(['bridge','connect'].includes(options().tool)){
            for(const [side,fill,stroke] of [[boundary,'#ffb75e70','#ffcf82'],[boundaryHover,'#63e6ff70','#9df2ff']])
                if(side?.partId===part.id&&side.twin===!!polygon.twin&&(topologyPreview?side.faceIds:(side.surfaceFaces??side.faceIds)).includes(id))return feedback(fill,stroke,2);
        }
        if(options().tool==='delete-face'&&hoverHit?.partId===part.id&&!!hoverHit.twin===!!polygon.twin&&hoverFootprint.has(id))return feedback('#ff4fd080','#ffffff',2);
        if (preview) {
            const key = `${part.id}/${!!polygon.twin}/${id}`;
            if (preview.sourceFaces.has(key)) return feedback('#ec9d3960','#ffb75e',2);
            if (preview.targetFaces.has(key)) return feedback('#63e6ff60','#b7da8e',2);
        }
        if (options().tool!=='delete-face'&&hovered?.partId === part.id && hovered.faceId === id && hovered.twin === !!polygon.twin) return feedback('#ffbe3280','#fff2c0',2);
        return selectedFaces(part).has(id) ? feedback('#00c8ff65') : null;
    }

    function getBrush() {
        const config = ensureProject();
        if(state.mode==='sculpt'&&config.tool==='delete-face')return {radius:config.deleteSize==='face'?0:config.radius,colour:'#ffffff',underColour:'#101010'};
        return state.mode === 'sculpt' && !topologyTool() && (config.tool !== 'select' || config.selectionTool === 'brush') ?
            { radius: config.radius, colour: config.tool === 'select' ? '#f2d989' : config.tool === 'push' ? '#e4a778' : '#d9bd76' } : null;
    }

    function onKeyDown(event) {
        if (state.mode !== 'sculpt' || !state.project || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? '') || event.target?.isContentEditable) return false;
        ensureProject(); let handled = true;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') selectOperation('all');
        else if (event.ctrlKey || event.metaKey || event.altKey) return false;
        else if (/^[1-5]$/.test(event.key)) setOption('tool', tools[Number(event.key) - 1][0]);
        else if (event.key === '[' || event.key === ']') setOption('radius', Math.max(1, Math.min(150, options().radius + (event.key === '[' ? -2 : 2))));
        else if (event.key === 'Escape') { if(options().tool==='connect'){clearTopology();options().placedGuides=[];options().placedGuidePick=null;guideStamp=null;options().tool='select';ctx.render?.();}else if(boundary||faceCorners.length||faceDraft||cornerEdit||topologyPreview){clearTopology();ctx.render?.();}else if (preview) { invalidate(); syncValues(); redraw(); } else selectOperation('clear'); }
        else handled = false;
        if (handled) event.preventDefault?.(); return handled;
    }

    function reset() {
        baselines.clear(); selections.clear(); stroke = null; connectionDrag=null; hovered = null; hoverHit=null; preview = null; lastEdit = '';
        state.sculpt = defaults(); bindings.tools = []; bindings.properties = []; redraw();
        clearTopology();
    }

    return { renderTools, renderProperties, edit, endEdit, getBrush, onHover, faceOverlay, onKeyDown, syncValues, reset, beginConnection };
}
