// The native cache owns texture pixels and animation metadata. This renderer keeps
// perspective-correct UVs, repeat wrapping and depth, with Canvas2D as a fallback.
import {renderTexture} from '/shared/gear-visuals.mjs';
const assets = new Map();
function asset(id) {
    if (!assets.has(id)) {
        const row = { ready: false, frames: [] };
        assets.set(id, row);
        row.promise = fetch(`/api/texture?id=${id}`).then(r => { if (!r.ok)
            throw new Error('Texture unavailable'); return r.json(); }).then(data => {
            row.material = data.material;
            row.size = data.size;
            row.frames = data.frames.map(encoded => Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
            row.ready = true;
        }).catch(() => { row.failed = true; });
    }
    return assets.get(id);
}
const vertex = `attribute vec4 position;attribute vec2 uv;attribute vec4 colour;varying vec2 vUV;varying vec4 vColour;void main(){gl_Position=position;vUV=uv;vColour=colour;}`;
const hueShader = `// Relative RGB hue rotation, including texture pixels. Neutral colours stay neutral.
vec3 shiftVisualHue(vec3 rgb, float turns) {
    if (turns == 0.0) return rgb;
    float high = max(rgb.r, max(rgb.g, rgb.b));
    float low = min(rgb.r, min(rgb.g, rgb.b));
    float chroma = high - low;
    if (chroma < 0.000001) return rgb;
    float hue = high == rgb.r ? (rgb.g - rgb.b) / chroma : high == rgb.g ? (rgb.b - rgb.r) / chroma + 2.0 : (rgb.r - rgb.g) / chroma + 4.0;
    hue = mod(hue + turns * 6.0, 6.0);
    float x = chroma * (1.0 - abs(mod(hue, 2.0) - 1.0));
    vec3 shifted = hue < 1.0 ? vec3(chroma,x,0.0) : hue < 2.0 ? vec3(x,chroma,0.0) : hue < 3.0 ? vec3(0.0,chroma,x) : hue < 4.0 ? vec3(0.0,x,chroma) : hue < 5.0 ? vec3(x,0.0,chroma) : vec3(chroma,0.0,x);
    return shifted + low;
}
`;
const fragment = `precision mediump float;uniform sampler2D pixels;uniform float hueShift;${hueShader}uniform vec2 scroll;uniform float cutOff;uniform vec4 highlight;uniform float highlightMode;varying vec2 vUV;varying vec4 vColour;void main(){vec4 tex=texture2D(pixels,vUV+scroll);if(tex.a<cutOff)discard;vec4 base=tex*vColour;gl_FragColor=highlightMode>.5?vec4(highlight.rgb,highlight.a*tex.a*vColour.a):vec4(shiftVisualHue(base.rgb,hueShift),base.a);}`;
export class MaterialRenderer {
    constructor() {
        this.fallbackMaterials=new Map();
        this.canvas = document.createElement('canvas');
        this.textures = new Map();
        const gl = this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
        if (!gl)
            return;
        const shader = (type, code) => { const s = gl.createShader(type); gl.shaderSource(s, code); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
            throw new Error(gl.getShaderInfoLog(s)); return s; };
        const program = this.program = gl.createProgram();
        gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            this.gl = null;
            return;
        }
        gl.useProgram(program);
        this.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        for (const [name, count, offset] of [['position', 4, 0], ['uv', 2, 16], ['colour', 4, 24]]) {
            const at = gl.getAttribLocation(program, name);
            gl.enableVertexAttribArray(at);
            gl.vertexAttribPointer(at, count, gl.FLOAT, false, 40, offset);
        }
        this.scroll = gl.getUniformLocation(program, 'scroll');
        this.cutOff = gl.getUniformLocation(program, 'cutOff');
        this.highlight = gl.getUniformLocation(program, 'highlight');
        this.highlightMode = gl.getUniformLocation(program, 'highlightMode');
        this.hueShift = gl.getUniformLocation(program, 'hueShift');
        this.colourCache = new Map();
        this.visualMaterials=new Map();
        this.white = this.upload(new Uint8Array([255, 255, 255, 255]), 1);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    drawFallbackFace(view,p,time){
        const row=p.visualTexture;if(!row)return false;
        const seconds=p.visualTime??time/1000,frame=Math.floor(seconds*20);let cached=this.fallbackMaterials.get(row.previewId??row.id);
        if(!cached){const canvas=document.createElement('canvas');canvas.width=canvas.height=128;cached={canvas,frame:-1,row};this.fallbackMaterials.set(row.previewId??row.id,cached);}
        if(cached.row!==row){cached.row=row;cached.frame=-1;}
        if(cached.frame!==frame){
            let source;
            if(row.source==='cache'){const native=asset(row.sourceId);if(!native.ready)return false;source={size:native.size,pixels:native.frames[Math.floor(seconds*row.frameRate)%native.frames.length]};}
            else if(row.source==='frames'){const f=row.frames[Math.floor(seconds*row.frameRate)%row.frames.length];source={size:f.size,pixels:Uint8Array.from(atob(f.pixels),c=>c.charCodeAt(0))};}
            const c=cached.canvas.getContext('2d'),data=c.createImageData(128,128);data.data.set(renderTexture(row,128,seconds,source));c.putImageData(data,0,0);cached.frame=frame;
        }
        while(this.fallbackMaterials.size>32)this.fallbackMaterials.delete(this.fallbackMaterials.keys().next().value);
        const [a,b,c]=p.points,uv=p.uv.map(v=>v.map(n=>n*128)),[u,v]=uv[0],du=uv[1][0]-u,dv=uv[1][1]-v,eu=uv[2][0]-u,ev=uv[2][1]-v,det=du*ev-eu*dv;
        if(Math.abs(det)<1e-8)return false;
        const aa=((b[0]-a[0])*ev-(c[0]-a[0])*dv)/det,bb=((b[1]-a[1])*ev-(c[1]-a[1])*dv)/det,cc=((c[0]-a[0])*du-(b[0]-a[0])*eu)/det,dd=((c[1]-a[1])*du-(b[1]-a[1])*eu)/det,ctx=view.ctx;
        ctx.save();ctx.clip();ctx.transform(aa,bb,cc,dd,a[0]-aa*u-cc*v,a[1]-bb*u-dd*v);ctx.fillStyle=ctx.createPattern(cached.canvas,'repeat');
        const min=uv.reduce((p,v)=>p.map((n,i)=>Math.min(n,v[i])),[Infinity,Infinity]),max=uv.reduce((p,v)=>p.map((n,i)=>Math.max(n,v[i])),[-Infinity,-Infinity]);ctx.fillRect(min[0]-1,min[1]-1,max[0]-min[0]+2,max[1]-min[1]+2);ctx.restore();return true;
    }
    upload(pixels, size) { const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); return t; }
    parseColour(css) {
        if(!this.colourCache.has(css)){
            this.colourProbe??=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
            const ctx=this.colourProbe;ctx.clearRect(0,0,1,1);ctx.fillStyle='#000';ctx.fillStyle=css;ctx.fillRect(0,0,1,1);
            this.colourCache.set(css,Array.from(ctx.getImageData(0,0,1,1).data,n=>n/255));
            if(this.colourCache.size>256)this.colourCache.delete(this.colourCache.keys().next().value);
        }
        return this.colourCache.get(css);
    }
    draw(view, polygons, time) {
        const gl = this.gl;
        if (!gl)
            return false;
        const width = view.canvas.width, height = view.canvas.height;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(this.program);
        const materials = new Map();
        for (const p of polygons) {
            let material = null;
            if(p.visualTexture&&!view.rig){
                const row=p.visualTexture,seconds=p.visualTime??time/1000,frame=Math.floor(seconds*20);let cached=this.visualMaterials.get(row.previewId??row.id);
                if(!cached){cached={texture:null,frame:-1,row};this.visualMaterials.set(row.previewId??row.id,cached);}
                if(cached.row!==row){cached.row=row;cached.frame=-1;}
                while(this.visualMaterials.size>32){const oldest=this.visualMaterials.keys().next().value;gl.deleteTexture(this.visualMaterials.get(oldest).texture);this.visualMaterials.delete(oldest);}
                if(cached.frame!==frame){
                    let source,ready=true;
                    if(row.source==='cache'){const native=asset(row.sourceId);ready=native.ready;if(ready)source={size:native.size,pixels:native.frames[Math.floor(seconds*row.frameRate)%native.frames.length]};}
                    else if(row.source==='frames'){const f=row.frames[Math.floor(seconds*row.frameRate)%row.frames.length];source={size:f.size,pixels:Uint8Array.from(atob(f.pixels),c=>c.charCodeAt(0))};}
                    if(ready){const rgba=renderTexture(row,128,seconds,source);if(cached.texture){gl.bindTexture(gl.TEXTURE_2D,cached.texture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,rgba);}else cached.texture=this.upload(rgba,128);cached.frame=frame;}
                }
                if(cached.texture)material={texture:cached.texture,scroll:[0,0],cutOff:.01};
            }else if (p.texture >= 0 && !view.rig) {
                const source = asset(p.texture);
                if (source.ready) {
                    if (!this.textures.has(p.texture)) this.textures.set(p.texture, source.frames.map(pixels => this.upload(pixels, source.size)));
                    const frames=this.textures.get(p.texture),m=source.material,seconds=time/1000;
                    material={texture:frames[Math.floor(seconds*Math.max(1,m.animSpeed))%frames.length],scroll:[seconds*(m.animU??0)/64,seconds*(m.animV??0)/64],cutOff:m.alphaCutOff??.1};
                }
            }
            materials.set(p,material);
        }
        const pass = kind => {
            let batch=[],textureKey,current,colourKey='',colour=[0,0,0,0],lineWidth=1,hue=0;
            const flush=()=>{
                if(!batch.length)return;
                gl.bindTexture(gl.TEXTURE_2D,current?.texture??this.white);
                gl.uniform2f(this.scroll,...(current?.scroll??[0,0]));gl.uniform1f(this.cutOff,current?.cutOff??.001);
                gl.uniform1f(this.hueShift,hue/360);gl.uniform1f(this.highlightMode,kind?1:0);gl.uniform4f(this.highlight,...colour);
                if(kind==='stroke')gl.lineWidth(lineWidth);
                gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(batch),gl.STREAM_DRAW);
                gl.drawArrays(kind==='stroke'?gl.LINES:gl.TRIANGLES,0,batch.length/10);batch=[];
            };
            for(const p of polygons){
                const overlay=p.overlay,css=kind&&overlay?.[kind];if(kind&&!css)continue;
                const material=materials.get(p),texture=material?.texture??this.white;
                const nextColour=kind?`${css}/${overlay.alpha??1}/${overlay.lineWidth??1}`:'';
                if(texture!==textureKey||nextColour!==colourKey||hue!==(p.hueShift??0)){
                    flush();textureKey=texture;current=material;colourKey=nextColour;hue=p.hueShift??0;
                    if(kind){colour=this.parseColour(css);colour=[...colour.slice(0,3),colour[3]*(overlay.alpha??1)];lineWidth=(overlay.lineWidth??1)*(view.dpr??1);}
                }
                const rgb=material?[p.light,p.light,p.light]:p.rgb.map(n=>n/255);
                for(const i of kind==='stroke'?[0,1,1,2,2,0]:[0,1,2]){
                    const point=p.points[i],w=Math.max(5,view.distance+point[2]);
                    batch.push((point[0]/view.width*2-1)*w,(1-point[1]/view.height*2)*w,w-10,w,...(material?p.uv[i]:[0,0]),...rgb,p.alpha);
                }
            }
            flush();
        };
        gl.depthMask(true);pass(null);
        // Keep the geometry's depth buffer and texture cutouts for highlights.
        // A selected rear face must never paint over an opaque face in front.
        if(polygons.some(p=>p.overlay)){
            gl.depthMask(false);pass('fill');pass('stroke');gl.depthMask(true);
        }
        view.ctx.drawImage(this.canvas, 0, 0, view.width, view.height);
        return true;
    }
}
export function textureActivity(items) { let active = false; for (const item of items)
    for (const id of new Set(item.mesh.textures ?? []))
        if (id >= 0) {
            const row = asset(id);
            active ||= !row.ready && !row.failed || row.ready && (row.frames.length > 1 || row.material.animU || row.material.animV);
        } return active; }
export const texturesReady = mesh => Promise.all([...new Set(mesh.textures ?? [])].filter(id => id >= 0).map(id => asset(id).promise));
