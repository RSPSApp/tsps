/* global globalThis: readonly */
// Pure authoring/runtime rules. Preview and the game sample the same bounded layers.
export const VISUAL_LIMITS={textures:8,particles:8,models:16,particleCount:256,frames:24,keys:64,fps:20};
export const PATTERNS=['flame','water','noise','runes','stripes','checker','gradient','stars'];
export const newGearVisuals=()=>({version:1,textures:[],particles:[],models:[]});
const id=()=>globalThis.crypto.randomUUID();
export function newTexture(partId){return {id:id(),name:'Animated surface',partId,enabled:true,faces:[],source:'pattern',pattern:'flame',sourceId:-1,frames:[],frameRate:8,scroll:[0,-.3],offset:[0,0],scale:[1,1],rotation:0,spin:0,wrap:'repeat',projection:'existing',colours:['#180c38','#e23e18','#ffd778'],tint:'#ffffff',hue:0,saturation:1,brightness:1,opacity:1,contrast:1,seed:1};}
export function newParticles(partId){return {id:id(),name:'Spark emitter',partId,enabled:true,shape:'point',sprite:'spark',origin:[0,0,0],extent:[8,8,8],rate:12,lifetime:1.5,capacity:24,velocity:[0,-18,0],spread:[12,8,12],gravity:[0,-5,0],drag:.2,turbulence:0,orbit:0,startSize:3,endSize:.5,startOpacity:1,endOpacity:0,colours:['#e2c2ff','#9d69e8','#291a54'],seed:1,phase:0};}
export function newModelTrack(partId){return {id:id(),name:'Item motion',partId,enabled:true,vertices:[],type:'transform',duration:2,loop:'repeat',phase:0,pivot:[0,0,0],axis:[0,1,0],amplitude:4,wavelength:40,frequency:1,keys:[{time:0,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],easing:'smooth'},{time:1,position:[0,-4,0],rotation:[0,0,0],scale:[1.05,1.05,1.05],easing:'smooth'},{time:2,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],easing:'smooth'}]};}
const fail=message=>{throw new Error(message);};
const number=(n,min,max,label,integer=false)=>{if(!Number.isFinite(n)||n<min||n>max||integer&&!Number.isInteger(n))fail(`${label} must be ${integer?'a whole number ':''}between ${min} and ${max}.`);return n;};
const choice=(v,values,label)=>values.includes(v)?v:fail(`Choose a valid ${label}.`);
const vector=(v,length,min,max,label)=>{if(!Array.isArray(v)||v.length!==length)fail(`${label} needs ${length} values.`);return v.map(n=>number(n,min,max,label));};
const text=(v,max,label)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f]/.test(v)?v:fail(`Invalid ${label}.`);
const colour=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)?v:fail('Use a six-digit hex colour.');
const indices=(v,label)=>{if(!Array.isArray(v)||v.length>40000||v.some(n=>!Number.isInteger(n)||n<0||n>65534)||new Set(v).size!==v.length)fail(`Invalid ${label} selection.`);return [...v];};
function common(row){if(!row||typeof row!=='object'||typeof row.enabled!=='boolean')fail('Invalid visual layer.');return {id:text(row.id,80,'layer ID'),name:text(row.name,80,'layer name'),partId:text(row.partId,80,'target part'),enabled:row.enabled};}
export function validateGearVisuals(input){
    if(input===undefined)return newGearVisuals();
    if(!input||input.version!==1)fail('Unsupported gear visuals version.');
    const out=newGearVisuals(),seen=new Set();
    for(const type of ['textures','particles','models']){
        if(!Array.isArray(input[type])||input[type].length>VISUAL_LIMITS[type])fail(`Keep at most ${VISUAL_LIMITS[type]} ${type} layers.`);
        out[type]=input[type].map(row=>{
            const r=common(row);if(seen.has(r.id))fail('Visual layer IDs must be unique.');seen.add(r.id);
            if(type==='textures'){
                Object.assign(r,{faces:indices(row.faces,'surface'),source:choice(row.source,['cache','pattern','frames'],'texture source'),pattern:choice(row.pattern,PATTERNS,'pattern'),sourceId:number(row.sourceId,-1,29999,'Source texture',true),frames:[],frameRate:number(row.frameRate,.1,60,'Frame rate'),scroll:vector(row.scroll,2,-8,8,'Scroll speed'),offset:vector(row.offset,2,-32,32,'Texture offset'),scale:vector(row.scale,2,.01,32,'Texture scale'),rotation:number(row.rotation,-360,360,'Texture angle'),spin:number(row.spin,-720,720,'Spin speed'),wrap:choice(row.wrap,['repeat','mirror','clamp'],'texture wrapping'),tint:colour(row.tint),hue:number(row.hue,-180,180,'Hue'),saturation:number(row.saturation,0,4,'Saturation'),brightness:number(row.brightness,0,4,'Brightness'),opacity:number(row.opacity,0,1,'Opacity'),contrast:number(row.contrast,0,4,'Contrast'),seed:number(row.seed,0,2147483647,'Seed',true)});
                r.projection=choice(row.projection??'existing',['existing','xy','xz','yz'],'texture projection');
                if(r.source==='cache'&&r.sourceId<0)fail('Choose a source texture.');
                if(!Array.isArray(row.frames)||row.frames.length>VISUAL_LIMITS.frames)fail(`Use at most ${VISUAL_LIMITS.frames} image frames.`);
                r.frames=row.frames.map(f=>{const size=number(f.size,8,64,'Image size',true);if(typeof f.pixels!=='string'||f.pixels.length!==Math.ceil(size*size*4/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.pixels)||f.pixels.length/4*3-(f.pixels.match(/=*$/)?.[0].length??0)!==size*size*4)fail('Invalid texture image pixels.');return {size,pixels:f.pixels};});
                if(r.source==='frames'&&!r.frames.length)fail('Import at least one image frame.');
            }else if(type==='particles'){
                Object.assign(r,{shape:choice(row.shape,['point','box','sphere','ring'],'emitter shape'),sprite:choice(row.sprite,['spark','diamond','star','cloud'],'particle shape'),origin:vector(row.origin,3,-4000,4000,'Emitter position'),extent:vector(row.extent,3,0,1000,'Emitter size'),rate:number(row.rate,1,60,'Birth rate'),lifetime:number(row.lifetime,.1,8,'Lifetime'),capacity:number(row.capacity,1,128,'Particle budget',true),velocity:vector(row.velocity,3,-500,500,'Velocity'),spread:vector(row.spread,3,0,500,'Velocity spread'),gravity:vector(row.gravity,3,-500,500,'Gravity'),drag:number(row.drag,0,10,'Drag'),turbulence:number(row.turbulence,0,200,'Turbulence'),orbit:number(row.orbit,-10,10,'Orbit speed'),startSize:number(row.startSize,.1,100,'Birth size'),endSize:number(row.endSize,0,100,'End size'),startOpacity:number(row.startOpacity,0,1,'Birth opacity'),endOpacity:number(row.endOpacity,0,1,'End opacity'),seed:number(row.seed,0,2147483647,'Seed',true),phase:number(row.phase,0,8,'Emitter phase')});
            }else{
                Object.assign(r,{vertices:indices(row.vertices,'motion'),type:choice(row.type,['transform','wave'],'motion type'),duration:number(row.duration,.1,30,'Duration'),loop:choice(row.loop,['repeat','pingpong','once'],'loop mode'),phase:number(row.phase,0,30,'Motion phase'),pivot:vector(row.pivot,3,-4000,4000,'Pivot'),axis:vector(row.axis,3,-1,1,'Wave direction'),amplitude:number(row.amplitude,-500,500,'Wave amplitude'),wavelength:number(row.wavelength,.1,2000,'Wavelength'),frequency:number(row.frequency,-10,10,'Wave frequency'),keys:[]});
                if(!Array.isArray(row.keys)||!row.keys.length||row.keys.length>VISUAL_LIMITS.keys)fail(`Use 1 to ${VISUAL_LIMITS.keys} motion keys.`);
                r.keys=row.keys.map(k=>({time:number(k.time,0,r.duration,'Key time'),position:vector(k.position,3,-2000,2000,'Key movement'),rotation:vector(k.rotation,3,-3600,3600,'Key rotation'),scale:vector(k.scale,3,.01,20,'Key scale'),easing:choice(k.easing,['linear','smooth','step'],'key easing')})).sort((a,b)=>a.time-b.time);
                if(new Set(r.keys.map(k=>k.time)).size!==r.keys.length)fail('Motion keys cannot share a time.');
            }
            if(type!=='models'){if(!Array.isArray(row.colours)||row.colours.length<2||row.colours.length>8)fail('Choose two to eight gradient colours.');r.colours=row.colours.map(colour);}
            return r;
        });
    }
    if(out.particles.reduce((n,r)=>n+(r.enabled?r.capacity:0),0)>VISUAL_LIMITS.particleCount)fail(`Keep at most ${VISUAL_LIMITS.particleCount} live particles per item.`);
    if(out.textures.flatMap(r=>r.frames).reduce((n,f)=>n+f.size*f.size*4,0)>1024*1024)fail('Texture images exceed the 1 MB item budget.');
    return out;
}
export const visualLayers=v=>['textures','particles','models'].flatMap(type=>(v?.[type]??[]).map(layer=>({type,layer})));
const mod=(n,d)=>((n%d)+d)%d;
const mix=(a,b,t)=>a+(b-a)*t;
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const trackTime=(track,time)=>{const t=Math.max(0,time+track.phase),d=track.duration;return track.loop==='once'?Math.min(t,d):track.loop==='pingpong'?d-Math.abs(mod(t,d*2)-d):mod(t,d);};
export function gradient(colours,t){const at=Math.max(0,Math.min(.999999,t))*(colours.length-1),i=Math.floor(at);return rgb(colours[i]).map((n,k)=>mix(n,rgb(colours[i+1])[k],at-i));}
function random(seed,index){let n=(seed^Math.imul(index+1,0x45d9f3b))|0;n=Math.imul(n^(n>>>16),0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);return ((n^(n>>>16))>>>0)/4294967296;}
export function rotate(v,angles){let [x,y,z]=v;for(let axis=0;axis<3;axis++){const a=angles[axis]*Math.PI/180,c=Math.cos(a),s=Math.sin(a);if(axis===0)[y,z]=[y*c-z*s,y*s+z*c];if(axis===1)[x,z]=[x*c+z*s,-x*s+z*c];if(axis===2)[x,y]=[x*c-y*s,x*s+y*c];}return [x,y,z];}
export function sampleModelTrack(track,time){
    const t=trackTime(track,time);
    const keys=track.keys;let a=keys[0],b=keys.at(-1);for(let i=1;i<keys.length;i++)if(t<keys[i].time){a=keys[i-1];b=keys[i];break;}else a=keys[i];
    let f=a===b?0:Math.max(0,Math.min(1,(t-a.time)/(b.time-a.time)));if(a.easing==='smooth')f=f*f*(3-2*f);else if(a.easing==='step')f=0;
    return Object.fromEntries(['position','rotation','scale'].map(k=>[k,a[k].map((n,i)=>mix(n,b[k][i],f))]));
}
export function moveVertex(vertex,track,time){
    const pivot=track.pivot;
    if(track.type==='wave'){const phase=((vertex[1]-pivot[1])/track.wavelength-trackTime(track,time)*track.frequency)*Math.PI*2;return vertex.map((n,i)=>n+Math.sin(phase)*track.amplitude*track.axis[i]);}
    const key=sampleModelTrack(track,time),point=rotate(vertex.map((n,i)=>(n-pivot[i])*key.scale[i]),key.rotation);
    return point.map((n,i)=>n+pivot[i]+key.position[i]);
}
export function sampleParticles(row,time){
    const period=8,births=Math.max(1,Math.floor(row.rate*period)),t=mod(time+row.phase,period),result=[];
    const slots=Math.min(row.capacity,Math.ceil(row.rate*row.lifetime));
    for(let slot=0;slot<slots;slot++){
        const birth=Math.floor(t*row.rate)-slot,age=mod(t-mod(birth,births)/row.rate,period);
        if(age>row.lifetime)continue;
        const index=mod(birth,births),rnd=k=>random(row.seed,index*23+k),p=[0,0,0],ratio=age/row.lifetime;
        if(row.shape==='box')for(let i=0;i<3;i++)p[i]=(rnd(i)*2-1)*row.extent[i];
        if(row.shape==='sphere'){const a=rnd(0)*Math.PI*2,z=rnd(1)*2-1,r=Math.cbrt(rnd(2));p[0]=Math.cos(a)*Math.sqrt(1-z*z)*r*row.extent[0];p[1]=z*r*row.extent[1];p[2]=Math.sin(a)*Math.sqrt(1-z*z)*r*row.extent[2];}
        if(row.shape==='ring'){const a=rnd(0)*Math.PI*2;p[0]=Math.cos(a)*row.extent[0];p[2]=Math.sin(a)*row.extent[2];}
        for(let i=0;i<3;i++){const velocity=row.velocity[i]+(rnd(i+3)*2-1)*row.spread[i],travel=row.drag>0?(1-Math.exp(-row.drag*age))/row.drag:age;p[i]+=row.origin[i]+velocity*travel+.5*row.gravity[i]*age*age+Math.sin(age*7+rnd(i+6)*Math.PI*2)*row.turbulence*age*.1;}
        if(row.orbit){const [x,y,z]=p.map((n,i)=>n-row.origin[i]),a=age*row.orbit;p[0]=row.origin[0]+x*Math.cos(a)-z*Math.sin(a);p[2]=row.origin[2]+x*Math.sin(a)+z*Math.cos(a);p[1]=row.origin[1]+y;}
        result.push({slot,position:p,size:mix(row.startSize,row.endSize,ratio),opacity:mix(row.startOpacity,row.endOpacity,ratio),colour:gradient(row.colours,ratio)});
    }
    return result;
}
export function renderTexture(row,size,time,source){
    const pixels=new Uint8Array(size*size*4),angle=(row.rotation+row.spin*time)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),tint=rgb(row.tint);
    const palette=source?null:Array.from({length:256},(_,i)=>gradient(row.colours,i/255));
    const wrap=n=>row.wrap==='clamp'?Math.max(0,Math.min(.99999,n)):row.wrap==='mirror'?1-Math.abs(mod(n,2)-1):mod(n,1);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        let u=(x/size-.5)/row.scale[0],v=(y/size-.5)/row.scale[1];[u,v]=[wrap(u*c-v*s+.5+row.offset[0]+time*row.scroll[0]),wrap(u*s+v*c+.5+row.offset[1]+time*row.scroll[1])];
        let value=0,colour,alpha=255;
        if(source){const at=(Math.floor(v*source.size)*source.size+Math.floor(u*source.size))*4;colour=[source.pixels[at],source.pixels[at+1],source.pixels[at+2]];alpha=source.pixels[at+3];}
        else{
            const noise=(Math.sin(u*29+Math.sin(v*17+time)*3+row.seed)*Math.cos(v*31-u*7)*.25+.5);
            if(row.pattern==='flame')value=Math.max(0,Math.min(1,(1-v)*.7+noise*.6+Math.sin(u*20+v*7+time*3)*.15));
            else if(row.pattern==='water')value=.5+Math.sin(u*17+v*11+time*2)*.2+Math.sin(v*27-u*9-time*3)*.2;
            else if(row.pattern==='stripes')value=mod(u*8,1)>.5?1:0;
            else if(row.pattern==='checker')value=(Math.floor(u*8)+Math.floor(v*8))%2;
            else if(row.pattern==='runes')value=(Math.abs(Math.sin(u*50)*Math.cos(v*50))>.85?1:.1)*(.7+.3*Math.sin(time*2+u*6));
            else if(row.pattern==='gradient')value=v;
            else if(row.pattern==='stars')value=random(row.seed,Math.floor(u*32)+Math.floor(v*32)*32)>.965?.6+.4*Math.sin(time*3+u*9):.03;
            else value=noise;
            colour=palette[Math.max(0,Math.min(255,Math.round(value*255)))];
        }
        const high=Math.max(...colour),low=Math.min(...colour),chroma=high-low;
        if(chroma>0&&row.hue){let h=(high===colour[0]?(colour[1]-colour[2])/chroma:high===colour[1]?(colour[2]-colour[0])/chroma+2:(colour[0]-colour[1])/chroma+4);h=mod(h+row.hue/60,6);const z=chroma*(1-Math.abs(h%2-1));colour=(h<1?[chroma,z,0]:h<2?[z,chroma,0]:h<3?[0,chroma,z]:h<4?[0,z,chroma]:h<5?[z,0,chroma]:[chroma,0,z]).map(n=>n+low);}
        const grey=colour[0]*.299+colour[1]*.587+colour[2]*.114,at=(y*size+x)*4;
        for(let i=0;i<3;i++)pixels[at+i]=Math.max(0,Math.min(255,((mix(grey,colour[i],row.saturation)-128)*row.contrast+128)*row.brightness*tint[i]/255));pixels[at+3]=alpha*row.opacity;
    }
    return pixels;
}
export const PARTICLE_CORNERS=[[-1,0,0],[0,-1,0],[1,0,0],[0,1,0],[0,0,-1],[0,0,1]];
export const PARTICLE_FACES=[[0,1,4],[1,2,4],[2,3,4],[3,0,4],[1,0,5],[2,1,5],[3,2,5],[0,3,5]];
export function basisPoint(point,origin,basis){return origin.map((n,i)=>n+point.reduce((sum,v,j)=>sum+v*basis[j][i],0));}
export function unbasisPoint(point,origin,basis){
    const [a,b,c]=basis,cross=(u,v)=>[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],dot=(u,v)=>u.reduce((n,x,i)=>n+x*v[i],0),det=dot(a,cross(b,c));
    if(Math.abs(det)<1e-9)return [0,0,0];const p=point.map((n,i)=>n-origin[i]);return [dot(p,cross(b,c)),dot(p,cross(c,a)),dot(p,cross(a,b))].map(n=>n/det);
}
export function rgbHsl(colour){let [r,g,b]=colour.map(n=>n/255),max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2,s=0,h=0;if(max!==min){const d=max-min;s=l>.5?d/(2-max-min):d/(max+min);h=max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4;h/=6;}return (Math.min(63,Math.floor(h*64))<<10)|(Math.min(7,Math.floor(s*8))<<7)|Math.min(127,Math.floor(l*128));}
export function sampleVisualGeometry(vertices,alpha,colours,compiled,time){
    for(const track of compiled.models){for(const index of track.vertexIndices){const local=unbasisPoint(vertices[index],track.origin,track.basis);vertices[index]=basisPoint(moveVertex(local,track,time),track.origin,track.basis);}}
    for(const emitter of compiled.particles){
        const active=new Map(sampleParticles(emitter,time).map(p=>[p.slot,p]));
        for(let slot=0;slot<emitter.capacity;slot++){
            const p=active.get(slot),position=p?.position??emitter.origin,point=basisPoint(position,emitter.partOrigin,emitter.basis);
            for(let k=0;k<PARTICLE_CORNERS.length;k++){
                let corner=PARTICLE_CORNERS[k].map((n,i)=>n*(p?.size??0)*(emitter.sprite==='spark'?(i===1?2:.35):1));
                if(emitter.sprite==='star')corner=rotate(corner,[0,time*120+slot*13,time*90]);
                if(emitter.sprite==='cloud')corner=corner.map(n=>n*1.7);
                const target=basisPoint(corner,[0,0,0],emitter.basis);
                let vertex=point.map((n,i)=>n+target[i]);
                for(const track of compiled.models)if(track.vertexIndices.includes(emitter.anchorVertex))vertex=basisPoint(moveVertex(unbasisPoint(vertex,track.origin,track.basis),track,time),track.origin,track.basis);
                vertices[emitter.vertexIndices[slot*PARTICLE_CORNERS.length+k]]=vertex;
            }
            for(let k=0;k<PARTICLE_FACES.length;k++){const at=emitter.faceIndices[slot*PARTICLE_FACES.length+k];alpha[at]=p?Math.round((1-p.opacity)*255):255;colours[at]=p?rgbHsl(p.colour):0;}
        }
    }
}
