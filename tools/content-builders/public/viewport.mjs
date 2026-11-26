import {shiftHueRgb} from '/shared/visuals.mjs';
import { drawGizmo, pickGizmo, gizmoDelta } from '/gizmo.mjs';
import { clipBackdropTriangle } from '/shared/preview-scenes.mjs';
import { bounds, hslRgb, textureUV } from '/shared/mesh.mjs';
import { inventoryPreviewMesh } from '/shared/item-preview.mjs';
import { isSkinColour, SKIN_PREVIEW_HEX } from '/shared/paint.mjs';
import { MaterialRenderer, textureActivity, texturesReady } from '/materials.mjs';
const materialRenderer=new MaterialRenderer();
export class Viewport {
    constructor(canvas, callbacks = {}) {
        this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.callbacks = callbacks;
        this.yaw = .55; this.pitch = .23; this.distance = 450; this.target = [0, -80, 0]; this.items = []; this.polygons = []; this.dirty = true;
        this.outline = true; this.gizmo = true; this.gizmoMode = 'move'; this.handles = [];
        this.wire = false; this.rig = false; this.reference = false; this.animation = null;
        this.materialRenderer = materialRenderer;
        if (callbacks.passive) { this.width = canvas.width; this.height = canvas.height; this.dpr = 1; this.grid = false; return; }
        this.resizeObserver = new ResizeObserver(() => { const r = canvas.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = r.width * dpr; canvas.height = r.height * dpr; this.width = r.width; this.height = r.height; this.dpr = dpr; this.dirty = true; });
        this.resizeObserver.observe(canvas);
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        canvas.addEventListener('wheel', e => { e.preventDefault(); this.distance = Math.max(15, Math.min(18000, this.distance * Math.exp(e.deltaY * .001))); this.dirty = true; }, { passive: false });
        canvas.addEventListener('pointerdown', e => {
            canvas.setPointerCapture(e.pointerId); const point = this.point(e), hit = this.eventHit(e);
            if(e.button===0&&callbacks.placing?.()){callbacks.place?.(hit??{point:this.unproject(...point)});this.drag=null;return;}
            const interaction = this.toolInteraction?.();
            if (e.button === 0 && interaction) {
                const corners = interaction.points().map(handle=>({...handle,screen:this.project(handle.point)}));
                const corner = corners.filter(h=>Math.hypot(h.screen[0]-point[0],h.screen[1]-point[1])<12).sort((a,b)=>a.screen[2]-b.screen[2])[0];
                const axis = pickGizmo(this.handles, ...point);
                if (corner || axis) {
                    const control=corner??interaction.points().find(h=>h.id===axis.partId);
                    if (control) {
                        interaction.select(control.id); interaction.start(control.id);
                        this.drag={tool:interaction,control,axis:corner?null:axis,startX:e.clientX,startY:e.clientY,button:0,started:true};
                        this.dirty=true; return;
                    }
                }
            }
            const handle = e.button === 0 && !e.shiftKey && this.gizmo && callbacks.editing?.() === 'move' ? pickGizmo(this.handles, ...point) : null;
            if(handle) { this.drag = { handle, startX:e.clientX, startY:e.clientY, button:0, started:false }; return; }
            this.drag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, button: e.button, hit, editing: (!e.shiftKey || callbacks.allowShiftEdit?.(hit,e)) && e.button === 0 && hit && callbacks.editing?.(hit,e) };
            if (this.drag.editing === 'move') callbacks.select?.(hit);
            else if (this.drag.editing) { this.drag.started = true; callbacks.startEdit?.(hit); callbacks.edit?.(hit, [0, 0, 0], 'start'); }
        });
        canvas.addEventListener('pointermove', e => {
            this.hoverPoint=this.point(e);this.hoverHit=this.eventHit(e);this.dirty=true;
            callbacks.hover?.(this.hoverHit);
            if(callbacks.placing?.())callbacks.preview?.(this.hoverHit??{point:this.unproject(...this.hoverPoint)});
            if (!this.drag) return;
            const d = this.drag;
            if(d.tool) {
                const dx=e.clientX-d.startX,dy=e.clientY-d.startY,cy=Math.cos(this.yaw),sy=Math.sin(this.yaw),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch);
                const units=Math.max(.01,(this.distance+this.project(d.control.point)[2])/(this.height*1.25));
                const delta=d.axis?gizmoDelta(d.axis,dx,dy):{movement:[dx*cy+dy*sp*sy,dy*cp,-dx*sy+dy*sp*cy].map(n=>n*units)};
                d.tool.move(d.control.id,delta,{shiftKey:e.shiftKey,ctrlKey:e.ctrlKey,metaKey:e.metaKey,screenPoint:this.point(e)});
                this.dirty=true; return;
            }
            if(d.handle) {
                const dx=e.clientX-d.startX,dy=e.clientY-d.startY;
                if(!d.started && Math.hypot(dx,dy)<3)return;
                if(!d.started){d.started=true;callbacks.startTransform?.(d.handle);}
                callbacks.transform?.(d.handle,gizmoDelta(d.handle,dx,dy));this.dirty=true;return;
            }
            const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY;
            const units = this.distance / Math.max(1, this.height * 1.25), cy=Math.cos(this.yaw),sy=Math.sin(this.yaw),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch);
            const movement=[dx*cy+dy*sp*sy,dy*cp,-dx*sy+dy*sp*cy].map(n=>n*units);
            if (d.editing) {
                if (!d.started && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 3) return;
                if (!d.started) { d.started = true; callbacks.startEdit?.(d.hit); }
                const hit = d.editing === 'move' ? d.hit : this.eventHit(e);
                if(hit && (hit.partId===d.hit.partId && hit.twin===d.hit.twin || this.crossPartEdit?.())) callbacks.edit?.(hit, movement, 'move');
            }
            else if (d.button === 1 || e.shiftKey) { this.target=this.target.map((n,i)=>n-movement[i]); }
            else { this.yaw += dx * .009; this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - dy * .008)); }
            this.dirty = true;
        });
        const finish = e => { if (!this.drag) return; const d = this.drag; this.drag = null; if(d.tool)d.tool.end(e.type==='pointercancel');else if (d.started) callbacks.endEdit?.(); else if (d.button === 0 && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) callbacks.select?.(d.hit); this.dirty = true; };
        canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', finish);
        canvas.addEventListener('pointerleave',()=>{this.hoverPoint=null;this.hoverHit=null;callbacks.hover?.(null);this.dirty=true;});
        canvas.addEventListener('dblclick', () => this.fit());
        const tick = time => { if (this.dirty || this.animation || this.itemVisualsActive?.() || textureActivity(this.items)) { this.draw(time); this.dirty = false; } requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    }
    point(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    eventHit(e) {
        // Undo or topology edits can replace face indices between animation
        // frames. Pick the current mesh even when the next draw has not run yet.
        if(this.dirty){this.draw(performance.now());this.dirty=false;}
        const point=this.point(e),raw=this.pick(...point),hit=this.toolPick?.(raw,point)??raw;
        return hit?{...hit,shiftKey:e.shiftKey,altKey:e.altKey,ctrlKey:e.ctrlKey,metaKey:e.metaKey,pointerType:e.pointerType}:null;
    }
    setItems(items) { this.items = items; this.animation = null; this.dirty = true; }
    setBackdrop(scene) {
        this.backdrop = scene; this.backdropKey = null;
        if (!scene?.items?.length) { this.backdropView = null; this.dirty = true; return; }
        this.backdropView ??= new Viewport(document.createElement('canvas'), {passive:true,backdrop:true});
        this.backdropView.setItems(scene.items); this.backdropView.background = scene.sky;
        // Start outdoor views above the ground instead of looking up from beneath it.
        this.pitch = Math.min(this.pitch, 0);
        this.backdropView.gizmo = false; this.backdropView.outline = false;
        const current = scene;
        Promise.all(scene.items.map(item=>texturesReady(item.mesh))).then(()=>{
            if(this.backdrop===current){this.backdropKey=null;this.dirty=true;}
        });
        this.dirty = true;
    }
    fit() {
        const vertices = (this.previewItems?.()??this.items).flatMap(p => p.mesh.vertices); if (!vertices.length) return;
        const b = bounds({ vertices }); this.target = b.center; this.distance = Math.max(40, Math.max(...b.max.map((n, i) => n - b.min[i])) * 1.8); this.dirty = true;
    }
    project(v) {
        const [x, y, z] = v.map((n, i) => n - this.target[i]), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
        const xx = x * cy - z * sy, zz = x * sy + z * cy, yy = y * cp + zz * sp, depth = zz * cp - y * sp;
        const scale = this.height * 1.25 / Math.max(5, this.distance + depth);
        return [this.width / 2 + xx * scale, this.height / 2 + yy * scale, depth];
    }
    pickSnap(x, y, filter = null) { return this.pick(x, y, filter, { references: true }); }
    pick(x, y, filter = null, options = {}) {
        let picked=null,nearest=Infinity;
        for (let i = this.polygons.length - 1; i >= 0; i--) {
            const p = this.polygons[i]; if(typeof filter==='function'&&!filter(p))continue; if ((p.reference&&!options.references&&(p.alpha??1)<.99)||(p.alpha??1)<=.01) continue;
            const [a, b, c] = p.points;
            const s = (v, w) => (v[0] - x) * (w[1] - y) - (v[1] - y) * (w[0] - x);
            const d = [s(a, b), s(b, c), s(c, a)];
            if (!(d.some(n => n < 0) && d.some(n => n > 0))) {
                const denom = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
                const u = denom ? ((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/denom : 1;
                const v = denom ? ((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/denom : 0;
                const weights=[u,v,1-u-v].map((n,i)=>n/Math.max(5,this.distance+p.points[i][2])),sum=weights.reduce((a,b)=>a+b,0);
                const depth=1/sum-this.distance;if(depth>=nearest-1e-7)continue;nearest=depth;
                picked=p.reference&&!options.references?null:{ ...(p.reference?{reference:true}:{}),partId: p.partId, faceId: p.faceId, sourceFaceId:p.sourceFaceId,twin:p.twin, normal:p.normal,screenPoint:[x,y],point:[0,1,2].map(axis=>weights.reduce((n,weight,i)=>n+p.vertices[i][axis]*weight/sum,0)) };
            }
        }
        return picked;
    }
    unproject(x, y, depth = 0) {
        const scale = this.height * 1.25 / Math.max(5, this.distance + depth), xx = (x-this.width/2)/scale, yy=(y-this.height/2)/scale;
        const cy=Math.cos(this.yaw),sy=Math.sin(this.yaw),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch),y3=yy*cp-depth*sp,z3=yy*sp+depth*cp;
        return [xx*cy+z3*sy,y3,-xx*sy+z3*cy].map((n,i)=>n+this.target[i]);
    }
    play(result) { if(result.mesh.visualTextures){result.mesh.visualTextureFaces=[];for(const row of result.mesh.visualTextures)for(const face of row.faceIndices)result.mesh.visualTextureFaces[face]=row;} this.animation = { ...result, start: performance.now() }; this.dirty = true; }
    pause() { if (!this.animation) return; const a=this.animation; if(a.pausedAt!==undefined){a.start+=performance.now()-a.pausedAt;delete a.pausedAt;}else a.pausedAt=performance.now();this.dirty=true; }
    stop() { this.animation = null; this.dirty = true; }
    draw(time) {
        const ctx = this.ctx, w = this.width, h = this.height; if (!w || !h) return;
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = this.backdrop?.sky ?? this.background ?? '#192c3b'; ctx.fillRect(0, 0, w, h);
        if (this.backdropView) {
            const view = this.backdropView, key = JSON.stringify([w,h,this.dpr,this.yaw,this.pitch,this.distance,this.target]);
            if (key !== this.backdropKey) {
                view.canvas.width = this.canvas.width; view.canvas.height = this.canvas.height;
                Object.assign(view,{width:w,height:h,dpr:this.dpr,yaw:this.yaw,pitch:this.pitch,distance:this.distance,target:this.target});
                view.draw(time); this.backdropKey = key;
            }
            ctx.drawImage(view.canvas,0,0,w,h);
        }
        ctx.lineWidth = 1; ctx.strokeStyle = this.gridColour ?? '#314859';
        const grid = Math.max(16, 2 ** Math.round(Math.log2(this.distance / 18)));
        if (this.grid !== false && !this.backdropView) for (let i = -8; i <= 8; i++) for (const line of [[[i * grid, 0, -8 * grid], [i * grid, 0, 8 * grid]], [[-8 * grid, 0, i * grid], [8 * grid, 0, i * grid]]]) { const a = this.project(line[0]), b = this.project(line[1]); if(a[2] < -this.distance*.5 || b[2] < -this.distance*.5) continue; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
        this.polygons = [];
        let items = this.previewItems?.()??this.items;
        if(this.itemVisuals&&!this.animation)items=this.itemVisuals(items,time);
        if (this.animation) {
            const a = this.animation, total = a.frames.reduce((sum, f) => sum + f.duration, 0); let t = ((a.pausedAt ?? time) - a.start) % total, frame = a.frames[0];
            for (const f of a.frames) { frame = f; t -= f.duration; if (t < 0) break; }
            items = [{ id: 'animation', mesh: { ...a.mesh, vertices: frame.vertices,...(frame.alpha?.length?{alpha:frame.alpha}:{}),...(frame.colours?{faces:a.mesh.faces.map((f,i)=>[...f.slice(0,3),frame.colours[i]])}:{}),...(frame.visualTime!==undefined?{visualTime:frame.visualTime}:{}) } }];
        }
        for (const part of items) {
            const mesh = part.mesh, projected = mesh.vertices.map(v => this.project(v));
            for (let i = 0; i < mesh.faces.length; i++) {
                if(mesh.renderTypes?.[i]===2||mesh.alpha?.[i]===255)continue;
                const f = mesh.faces[i], original = f.slice(0, 3).map(n => mesh.vertices[n]);
                const triangles = this.callbacks.backdrop ? clipBackdropTriangle(original,textureUV(mesh,i),this) : null;
                for(let clipped=0;clipped<(triangles?.length??1);clipped++) {
                    const triangle=triangles?.[clipped],vertices=triangle?.vertices??original,points=this.callbacks.backdrop?vertices.map(v=>this.project(v)):f.slice(0,3).map(n=>projected[n]);
                    if (this.callbacks.backdrop && (
                        points.every(p=>p[0]<0)||points.every(p=>p[0]>w)||points.every(p=>p[1]<0)||points.every(p=>p[1]>h))) continue;
                    // Match the game's front-face winding. Drawing both sides makes the
                    // fire cape's inner lining fight with its textured outer faces.
                    const [a,b,c]=points;
                    if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>=0)continue;
                    const u = vertices[1].map((n, j) => n - vertices[0][j]), v = vertices[2].map((n, j) => n - vertices[0][j]);
                    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], len = Math.hypot(...normal) || 1;
                    const light = .64 + .36 * Math.abs((-normal[0] - normal[1] * 2 - normal[2]) / len / Math.sqrt(6));
                    const label = mesh.bones?.[f[0]]?.[0] ?? mesh.skins?.[f[0]] ?? 0;
                    const rgb = this.rig ? hslRgb(((label * 7 % 64) << 10) | (5 << 7) | 65) : this.skinOverlay && !part.reference && (mesh.textures?.[i] ?? -1) < 0 && isSkinColour(f[3]) ? this.skinPreviewColour ?? hexColour(SKIN_PREVIEW_HEX).slice(0, 3) : hslRgb(f[3]);
                    this.polygons.push({ partId: part.id, faceId: i,sourceFaceId:mesh.faceSources?.[i],twin:mesh.faceTwins?.[i]??false, reference: part.reference, selected: part.selected, vertices, points,normal:normal.map(n=>n/len), depth: points.reduce((n, p) => n + p[2], 0) / 3, visualTexture:mesh.visualTextureFaces?.[i],visualTime:mesh.visualTime,hueShift:part.hueShift??0,colour: `rgb(${shiftHueRgb(rgb,part.hueShift??0).map(n => Math.round(n * light)).join(',')})`,rgb:rgb.map(n=>Math.round(n*light)),light,texture:mesh.textures?.[i]??-1,uv: triangle?.uv ?? textureUV(mesh,i), alpha: (1 - (mesh.alpha?.[i] ?? 0) / 255) * (part.opacity ?? (part.reference ? .3 : 1)) });
                }
            }
        }
        this.polygons.sort((a, b) => b.depth - a.depth);
        for(const p of this.polygons)p.overlay=!p.reference&&this.callbacks.faceOverlay?.(p);
        // Wide GL lines are often clamped to one pixel. Subdivide the original
        // triangle into coloured bands instead. Every band keeps its original
        // depth, UVs and cutout mask, so rear selections remain occluded.
        const guides=this.toolOverlay?.()??[],drawPolygons=this.polygons.flatMap(p=>faceFeedbackPolygons(p,this.distance));
        for(const guide of guides)if(guide.depthTest&&guide.fill&&guide.points.length===3){
            const points=guide.points.map(p=>this.project(p)),[a,b,c]=points;
            if((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>=0)continue;
            const rgba=hexColour(guide.fill);
            drawPolygons.push({points,vertices:guide.points,depth:points.reduce((n,p)=>n+p[2],0)/3,rgb:rgba.slice(0,3),colour:`rgb(${rgba.slice(0,3).join(',')})`,alpha:rgba[3],texture:-1,uv:[[0,0],[1,0],[0,1]],light:1,overlay:null});
        }
        drawPolygons.sort((a,b)=>b.depth-a.depth);
        const nativeMaterials=this.materialRenderer.draw(this,drawPolygons,time??0);
        for (const p of drawPolygons) {
            const [a, b, c] = p.points;
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.closePath(); ctx.globalAlpha = p.alpha; ctx.fillStyle = p.colour; if(!nativeMaterials&&!this.materialRenderer.drawFallbackFace(this,p,time??0))ctx.fill();
            if (this.wire) { ctx.strokeStyle = '#e3c77d66'; ctx.lineWidth = .5; ctx.stroke(); }
            const overlay=!nativeMaterials&&p.overlay;
            if(overlay){
                ctx.save();ctx.globalAlpha=overlay.alpha??1;
                if(overlay.fill){ctx.fillStyle=overlay.fill;ctx.fill();}
                if(overlay.stroke){ctx.strokeStyle=overlay.stroke;ctx.lineWidth=overlay.lineWidth??1.5;ctx.stroke();}
                ctx.restore();
            }
        }
        ctx.globalAlpha = 1;
        // Tool-owned world-space guides and pending triangles. Guides remain
        // separate from selectable geometry and never enter saved/exported meshes.
        for(const guide of guides) {
            if(guide.depthTest){
                // Filled guides already went through the material depth pass.
                // Draw only visible sections of their boundary, never x-ray it.
                if(guide.fill)continue;
                this.drawDepthGuide(guide);continue;
            }
            const points=guide.points.map(p=>this.project(p)); if(!points.length)continue;
            ctx.save();ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);for(const p of points.slice(1))ctx.lineTo(p[0],p[1]);
            if(guide.closed)ctx.closePath();if(guide.fill){ctx.fillStyle=guide.fill;ctx.fill();}
            ctx.strokeStyle=guide.stroke??'#ffdb86';ctx.lineWidth=guide.width??3;ctx.stroke();
            if(guide.corner)for(const p of points){ctx.beginPath();ctx.arc(p[0],p[1],7,0,Math.PI*2);ctx.fillStyle=guide.stroke??'#ffdb86';ctx.fill();ctx.strokeStyle='#101010';ctx.lineWidth=2;ctx.stroke();
                if(guide.label){ctx.font='bold 13px Trebuchet MS';ctx.lineWidth=4;ctx.strokeText(guide.label,p[0]+11,p[1]-8);ctx.fillText(guide.label,p[0]+11,p[1]-8);}}ctx.restore();
        }
        const selectedPoints = this.polygons.filter(p=>p.selected).flatMap(p=>p.points);
        if(this.outline && selectedPoints.length){ const xs=selectedPoints.map(p=>p[0]),ys=selectedPoints.map(p=>p[1]);ctx.strokeStyle='#d9bd7690';ctx.lineWidth=1;ctx.setLineDash([4,5]);ctx.strokeRect(Math.min(...xs)-5,Math.min(...ys)-5,Math.max(...xs)-Math.min(...xs)+10,Math.max(...ys)-Math.min(...ys)+10);ctx.setLineDash([]); }
        const toolGizmo=this.toolInteraction?.()?.gizmo?.();
        this.handles = toolGizmo || this.gizmo || this.scaleAxisPreview ? drawGizmo(this, toolGizmo??this.callbacks.gizmo?.()) : [];
        const brush=this.callbacks.brush?.();if(brush&&this.hoverPoint&&this.hoverHit){const radius=brush.radius*this.height*1.25/Math.max(5,this.distance+this.project(this.hoverHit.point)[2]);ctx.beginPath();ctx.arc(...this.hoverPoint,Math.max(5,radius),0,Math.PI*2);ctx.strokeStyle=brush.underColour??'#101010';ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle=brush.colour??'#f2d989';ctx.lineWidth=2;ctx.stroke();}
        if (this.reference) {
            const foot = this.project([0, 0, 0]), head = this.project([0, -200, 0]);
            ctx.strokeStyle = '#b8cdd785'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(foot[0] - 8, foot[1]); ctx.lineTo(head[0], head[1] + 25); ctx.lineTo(foot[0] + 8, foot[1]); ctx.moveTo(head[0] - 20, head[1] + 40); ctx.lineTo(head[0] + 20, head[1] + 40); ctx.stroke(); ctx.beginPath(); ctx.arc(head[0], head[1] + 10, 10, 0, Math.PI * 2); ctx.stroke(); ctx.font = '11px Trebuchet MS'; ctx.fillStyle = '#b8cdd7'; ctx.fillText('200 units', head[0] + 15, head[1] + 12);
        }
    }
    drawDepthGuide(guide){
        const ctx=this.ctx,points=guide.points.map(p=>this.project(p));
        ctx.save();ctx.strokeStyle=guide.stroke??'#ffffff';ctx.lineWidth=guide.width??3;ctx.setLineDash(guide.dash??[]);ctx.beginPath();
        for(let i=0;i<points.length-(guide.closed?0:1);i++){
            const a=points[i],b=points[(i+1)%points.length],steps=Math.min(2048,Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2)));
            let previous=null;
            for(let k=0;k<=steps;k++){
                const t=k/steps,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;
                const z=1/((1-t)/Math.max(5,this.distance+a[2])+t/Math.max(5,this.distance+b[2]))-this.distance;
                const front=this.depthAt(x,y),visible=front===null||z<=front+1;
                if(visible){if(previous)ctx.lineTo(x,y);else ctx.moveTo(x,y);previous=true;}else previous=null;
            }
        }
        ctx.stroke();
        if(guide.corner)for(const p of points){const front=this.depthAt(p[0],p[1]);if(front!==null&&p[2]>front+1)continue;ctx.setLineDash([]);ctx.beginPath();ctx.arc(p[0],p[1],5,0,Math.PI*2);ctx.fillStyle=guide.stroke??'#ffffff';ctx.fill();ctx.strokeStyle='#101010';ctx.lineWidth=2;ctx.stroke();
            if(guide.label){ctx.font='bold 13px Trebuchet MS';ctx.lineWidth=4;ctx.strokeText(guide.label,p[0]+8,p[1]-7);ctx.fillText(guide.label,p[0]+8,p[1]-7);}}
        ctx.restore();
    }
    depthAt(x,y){
        let nearest=null;
        for(const p of this.polygons){
            if((p.alpha??1)<.99)continue;
            const [a,b,c]=p.points,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(!den)continue;
            const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;
            if(Math.min(u,v,1-u-v)<-1e-6)continue;
            const z=1/([u,v,1-u-v].reduce((n,w,i)=>n+w/Math.max(5,this.distance+p.points[i][2]),0))-this.distance;
            if(nearest===null||z<nearest)nearest=z;
        }
        return nearest;
    }
}

const hexColour=css=>{const s=css.replace('#','');return [0,2,4].map(i=>parseInt(s.slice(i,i+2),16)).concat(s.length===8?parseInt(s.slice(6),16)/255:1);};

export function faceFeedbackPolygons(p,distance){
    const overlay=p.overlay;if(!overlay?.underStroke)return [p];
    const points=p.points,opposite=points.map((_,i)=>Math.hypot(points[(i+1)%3][0]-points[(i+2)%3][0],points[(i+1)%3][1]-points[(i+2)%3][1]));
    const perimeter=opposite.reduce((a,b)=>a+b,0),area=Math.abs((points[1][0]-points[0][0])*(points[2][1]-points[0][1])-(points[1][1]-points[0][1])*(points[2][0]-points[0][0]));
    if(!perimeter||area/perimeter<.6)return [{...p,overlay:{...overlay,stroke:overlay.stroke,lineWidth:1}}];
    const center=opposite.map(n=>n/perimeter),radius=area/perimeter,total=Math.min(overlay.underWidth??4.5,radius*.85);
    const widths=[0,total*.25,total*.75,total],rings=widths.map(width=>points.map((_,i)=>center.map((c,j)=>c*width/radius+(i===j?1-width/radius:0))));
    const result=[];
    const triangle=(weights,fill)=>{
        const perspective=weights.map(row=>{const w=row.map((n,i)=>n/Math.max(5,distance+points[i][2])),sum=w.reduce((a,b)=>a+b,0);return w.map(n=>n/sum);});
        const mix=(rows,values)=>rows.map(row=>values[0].map((_,a)=>row.reduce((n,w,i)=>n+w*values[i][a],0)));
        const projected=mix(weights,points);
        for(let i=0;i<3;i++)projected[i][2]=perspective[i].reduce((n,w,j)=>n+w*points[j][2],0);
        result.push({...p,points:projected,vertices:mix(perspective,p.vertices),uv:mix(perspective,p.uv??[[0,0],[1,0],[0,1]]),overlay:fill?{fill,alpha:overlay.alpha}:null});
    };
    for(let ring=0;ring<3;ring++)for(let i=0;i<3;i++){
        const next=(i+1)%3,a=rings[ring],b=rings[ring+1],fill=ring===1?overlay.stroke:overlay.underStroke;
        triangle([a[i],a[next],b[next]],fill);triangle([a[i],b[next],b[i]],fill);
    }
    triangle(rings[3],overlay.fill);return result;
}
export function thumbnail(canvas, mesh, source = {}) {
    const view = new Viewport(canvas, { passive: true }); view.background = '#14130f';
    if (source.kind === 'item' && source.variant === 'inventory' && source.fields) {
        mesh = inventoryPreviewMesh(mesh, source.fields); view.yaw = view.pitch = 0;
    }
    view.skinOverlay = !!source.skinOverlay;
    view.setItems([{ id: 'preview', mesh }]); view.fit();
    // Fit projected geometry on BOTH axes. A height-only fit crops narrow cards.
    for (let pass = 0; pass < 5; pass++) {
        let ratio = .01;
        for (const point of mesh.vertices) {
            const [x,y] = view.project(point);
            ratio = Math.max(ratio, Math.abs(x-view.width/2)/(view.width*.43), Math.abs(y-view.height/2)/(view.height*.43));
        }
        if (Math.abs(ratio-1) < .01) break;
        view.distance = Math.max(15, view.distance * ratio);
    }
    view.draw(0);
    texturesReady(mesh).then(()=>{if(canvas.isConnected)view.draw(0);});
    return view;
}
