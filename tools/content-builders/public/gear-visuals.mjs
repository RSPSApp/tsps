import {newGearVisuals,newTexture,newParticles,newModelTrack,validateGearVisuals,visualLayers,PATTERNS,VISUAL_LIMITS,sampleVisualGeometry} from '/shared/gear-visuals.mjs';
import {compileGearVisualMesh} from '/shared/gear-visual-compile.mjs';
import {localPoint,reflectPoint,bounds} from '/shared/mesh.mjs';

const TYPES=[['textures','Textures'],['particles','Particles'],['models','Model motion']];
const PRESETS={textures:['Flowing lava','Icy water','Runic shimmer','Moving stripes','Native texture','Image sequence'],particles:['Arcane sparks','Rising embers','Falling snow','Orbiting motes'],models:['Floating','Pulsing','Spinning','Swaying','Rippling']};
const title=value=>value[0].toUpperCase()+value.slice(1);
export function createGearVisualsTab(ctx){
    const {state,element:el,button}=ctx;
    const s={type:'textures',selected:null,preset:0,preview:true,playing:true,cursor:0,start:performance.now(),pick:null,solo:false,query:'',textureRows:[],offset:0,total:0,key:0,importSize:64};
    let tools,properties,projectId,serial=0,previewError=null,cache=new Map(),nativeThumbnails=new Map();
    const visuals=()=>state.project?.visuals??newGearVisuals();
    const selected=()=>visuals()[s.type].find(row=>row.id===s.selected);
    const partFor=row=>state.project?.parts.find(p=>p.id===row?.partId);
    const refresh=()=>{cache.clear();if(tools?.isConnected)renderTools(tools);if(properties?.isConnected)renderProperties(properties);ctx.viewport.dirty=true;};
    const safe=fn=>ctx.safe?ctx.safe(fn):async(...args)=>{try{return await fn(...args);}catch(e){ctx.status(e.message,true);}};
    const note=(target,text)=>target.append(el('p',{class:'visual-note',text}));
    const section=(target,label)=>{const block=el('section',{class:'visual-section'},el('h3',{text:label}));target.append(block);return block;};
    function sync(){if(projectId!==state.project?.id){projectId=state.project?.id;serial++;s.selected=null;s.pick=null;s.solo=false;s.cursor=0;s.start=performance.now();s.playing=true;cache.clear();}if(!selected())s.selected=visuals()[s.type][0]?.id??null;}
    function mutate(fn){
        const input=structuredClone(visuals());fn(input);const clean=validateGearVisuals(input);
        ctx.change(()=>{state.project.visuals=clean;});cache.clear();refresh();
    }
    const edit=(key,value)=>mutate(v=>{v[s.type].find(r=>r.id===s.selected)[key]=value;});
    function field(target,label,value,fn,{min,max,step=1,options,type='number'}={}){
        const input=options?el('select',{'aria-label':label},...options.map(option=>{const [v,name]=Array.isArray(option)?option:[option,title(String(option))];return el('option',{value:v,text:name,selected:String(value)===String(v)});})):el('input',{'aria-label':label,type,value,...(min!==undefined?{min}:{}),...(max!==undefined?{max}:{}),step});
        input.addEventListener('change',safe(async()=>{const val=options||type==='text'||type==='color'?input.value:Number(input.value);try{await fn(val);}catch(e){input.value=String(value);throw e;}}));
        target.append(el('label',{class:'visual-field'},el('span',{text:target.classList?.contains('visual-vector')?label.split(' ').at(-1):label}),input));return input;
    }
    const numeric=(target,label,key,min,max,step=1)=>field(target,label,selected()[key],value=>edit(key,value),{min,max,step});
    const select=(target,label,key,options)=>field(target,label,selected()[key],value=>edit(key,value),{options});
    function vector(target,label,key,{length=3,min=-1000,max=1000,step=1,axes=length===2?['U','V']:['X','Y','Z']}={}){
        const group=el('fieldset',{class:'visual-vector'},el('legend',{text:label}));target.append(group);
        for(let i=0;i<length;i++)field(group,`${label} ${axes[i]}`,selected()[key][i],value=>{const vector=[...selected()[key]];vector[i]=value;edit(key,vector);},{min,max,step});
    }
    function gradient(target){
        const group=section(target,'Colour over lifetime');
        selected().colours.forEach((colour,index)=>{
            const row=el('div',{class:'visual-colour-row'});field(row,`Gradient colour ${index+1}`,colour,value=>{const c=[...selected().colours];c[index]=value;edit('colours',c);},{type:'color'});
            row.append(button('Remove',()=>edit('colours',selected().colours.filter((_,i)=>i!==index)),{disabled:selected().colours.length<=2,'aria-label':`Remove gradient colour ${index+1}`}));group.append(row);
        });
        group.append(button('Add colour',()=>edit('colours',[...selected().colours,selected().colours.at(-1)]),{disabled:selected().colours.length>=8}));
    }
    function preset(type,name,partId){
        const row=type==='textures'?newTexture(partId):type==='particles'?newParticles(partId):newModelTrack(partId);row.name=name;
        if(type==='textures'){
            if(name==='Icy water')Object.assign(row,{pattern:'water',colours:['#07192b','#1687b5','#d0f7ff'],scroll:[.08,.04]});
            if(name==='Runic shimmer')Object.assign(row,{pattern:'runes',colours:['#18082c','#7645b2','#e2c5ff'],scroll:[0,0]});
            if(name==='Moving stripes')Object.assign(row,{pattern:'stripes',colours:['#0b2030','#4da9c5','#e5fbff'],scroll:[.12,0]});
            if(name==='Native texture'){row.source='cache';row.sourceId=partFor({partId})?.mesh.textures?.find(id=>id>=0)??0;}
            if(name==='Image sequence'){row.source='pattern';row.pattern='checker';row.scroll=[0,0];}
        }else if(type==='particles'){
            const b=bounds(partFor({partId}).mesh);row.origin=b.center;
            if(name==='Rising embers')Object.assign(row,{shape:'box',sprite:'spark',extent:[8,2,8],velocity:[0,-28,0],gravity:[0,-4,0],colours:['#fff0a0','#ef5d1b','#521306']});
            if(name==='Falling snow')Object.assign(row,{shape:'box',sprite:'cloud',extent:[18,3,18],velocity:[0,12,0],gravity:[0,3,0],startSize:1.5,endSize:1,colours:['#ffffff','#b9e7f7','#4a7593']});
            if(name==='Orbiting motes')Object.assign(row,{shape:'ring',extent:[15,0,15],velocity:[0,-2,0],spread:[1,1,1],orbit:2,lifetime:3,rate:8,capacity:24,startSize:2,endSize:2,sprite:'star'});
        }else{
            row.pivot=bounds(partFor({partId}).mesh).center;
            if(name==='Pulsing')row.keys[1]={...row.keys[1],position:[0,0,0],scale:[1.12,1.12,1.12]};
            if(name==='Spinning'){row.keys=[row.keys[0],{...structuredClone(row.keys[2]),rotation:[0,360,0],easing:'linear'}];row.keys[0].easing='linear';}
            if(name==='Swaying')row.keys[1]={...row.keys[1],position:[0,0,0],rotation:[0,0,8],scale:[1,1,1]};
            if(name==='Rippling')row.type='wave';
        }
        return row;
    }
    function add(){
        const part=ctx.selected?.()??state.project.parts.find(p=>p.variant===state.variant&&p.visible!==false);
        if(!part)throw new Error('Choose a part in this model view first.');
        const row=preset(s.type,PRESETS[s.type][s.preset]??PRESETS[s.type][0],part.id);s.selected=row.id;s.pick=null;s.key=0;
        mutate(v=>v[s.type].push(row));
    }
    function duplicate(targetPart){
        const current=selected();if(!current)return;
        const copy=structuredClone(current);copy.id=crypto.randomUUID();copy.name=`${copy.name.slice(0,70)} copy`;copy.partId=targetPart??current.partId;
        if(targetPart&&targetPart!==current.partId){if('faces'in copy)copy.faces=[];if('vertices'in copy)copy.vertices=[];}
        mutate(v=>v[s.type].push(copy));s.selected=copy.id;refresh();if(targetPart)return followPart(targetPart);
    }
    async function followPart(partId){
        const part=partFor({partId});if(!part)return;state.selected=partId;
        if(part.variant!=='all'&&part.variant!==state.variant){state.variant=part.variant;await ctx.updateReference?.();ctx.render?.();}else ctx.renderView?.();refresh();
    }
    function renderTools(target){
        tools=target;if(!target)return;sync();target.replaceChildren();
        target.append(el('h2',{text:'Item visuals'}));note(target,'Layer moving surfaces, particles and model motion on any item part. Each model view can have its own layers.');
        const switcher=el('div',{class:'visual-types',role:'tablist','aria-label':'Visual editor'});
        for(const [type,label]of TYPES)switcher.append(button(label,()=>{s.type=type;s.selected=null;s.preset=0;s.pick=null;refresh();},{role:'tab','aria-selected':s.type===type}));target.append(switcher);
        if(!state.project){note(target,'Create or open a gear project first.');return;}
        const starters=section(target,'Start a layer');field(starters,'Layer preset',s.preset,value=>{s.preset=Number(value);},{options:PRESETS[s.type].map((name,i)=>[i,name])});starters.append(button('Add layer',safe(add),{class:'primary',disabled:visuals()[s.type].length>=VISUAL_LIMITS[s.type]}));
        const list=el('div',{class:'visual-layer-list',role:'list','aria-label':'Visual layers'});
        for(const row of visuals()[s.type]){
            const check=el('input',{type:'checkbox',checked:row.enabled,'aria-label':`Enable ${row.name}`,onChange:safe(()=>mutate(v=>{v[s.type].find(r=>r.id===row.id).enabled=check.checked;}))});
            const part=partFor(row),entry=el('div',{class:'visual-layer',role:'listitem'},check,button(row.name,()=>{s.selected=row.id;s.pick=null;s.key=0;if(part)return followPart(part.id);refresh();},{'aria-pressed':row.id===s.selected}),el('small',{text:part?`${part.variant} / ${part.name}`:'Choose a target part'}));list.append(entry);
        }target.append(list);
        if(!visuals()[s.type].length)note(target,`No ${TYPES.find(([t])=>t===s.type)[1].toLowerCase()} layers yet. Choose a preset and add it to the selected part.`);
        const playback=section(target,'Preview');
        playback.append(button(s.playing?'Pause visuals':'Play visuals',()=>{s.cursor=currentTime();s.start=performance.now();if(ctx.viewport.animation){ctx.viewport.pause();s.playing=ctx.viewport.animation.pausedAt===undefined;}else s.playing=!s.playing;refresh();}),button('Restart',()=>{s.cursor=0;s.start=performance.now();s.playing=true;if(ctx.viewport.animation){ctx.viewport.animation.start=performance.now();delete ctx.viewport.animation.pausedAt;}refresh();}));
        field(playback,'Preview time (seconds)',s.cursor,value=>{if(!Number.isFinite(value)||value<0||value>3600)throw new Error('Preview time must be between 0 and 3600 seconds.');seek(value);refresh();},{min:0,max:3600,step:.05});
        for(const [key,label]of [['preview','Show item visuals'],['solo','Solo selected layer']]){const input=el('input',{type:'checkbox',checked:s[key],onChange:()=>{s[key]=input.checked;ctx.stop?.();cache.clear();refresh();}});playback.append(el('label',{class:'check'},input,label));}
        const budget=visuals().particles.reduce((n,r)=>n+(r.enabled?r.capacity:0),0);note(playback,`${visuals().textures.length}/${VISUAL_LIMITS.textures} surfaces, ${budget}/${VISUAL_LIMITS.particleCount} particles, ${visuals().models.length}/${VISUAL_LIMITS.models} motion tracks. Live geometry is sampled at 20 frames per second.`);
        if(s.type==='textures')textureLibrary(target);
    }
    function renderProperties(target){
        properties=target;if(!target)return;sync();target.replaceChildren();const row=selected();
        if(!row){note(target,'Add or select a visual layer to edit it.');return;}
        const about=section(target,'Layer');field(about,'Layer name',row.name,value=>edit('name',value),{type:'text'});
        field(about,'Target part',row.partId,value=>{const patch={partId:value};if('faces'in row)patch.faces=[];if('vertices'in row)patch.vertices=[];mutate(v=>Object.assign(v[s.type].find(r=>r.id===s.selected),patch));return followPart(value);},{options:state.project.parts.map(p=>[p.id,`${p.variant} / ${p.name}`])});
        const layerIndex=visuals()[s.type].findIndex(r=>r.id===s.selected);
        for(const [delta,label] of [[-1,'Move layer earlier'],[1,'Move layer later']])about.append(button(label,()=>mutate(v=>v[s.type]=move(v[s.type],layerIndex,delta)),{disabled:layerIndex+delta<0||layerIndex+delta>=visuals()[s.type].length}));
        about.append(button('Duplicate layer',safe(()=>duplicate())),button('Remove layer',()=>{mutate(v=>v[s.type]=v[s.type].filter(r=>r.id!==s.selected));s.selected=null;refresh();}));
        const copies=state.project.parts.filter(p=>p.id!==row.partId&&p.variant!==partFor(row)?.variant&&p.mesh.faces.length);
        if(copies.length)field(about,'Copy to another model view','',value=>{if(value)duplicate(value);},{options:[['','Choose a part…'],...copies.map(p=>[p.id,`${p.variant} / ${p.name}`])]});
        if(s.type==='textures')textureProperties(target,row);else if(s.type==='particles')particleProperties(target,row);else modelProperties(target,row);
    }
    function beginPick(key){ctx.stop?.();s.pick=s.pick===key?null:key;s.playing=false;s.cursor=0;refresh();}
    function selection(target,key){
        const row=selected(),block=section(target,key==='faces'?'Surface selection':'Moving vertices');
        note(block,row[key].length?`${row[key].length} selected ${key}.`:`The entire target part is selected.`);
        block.append(button(s.pick===key?'Finish selection':`Select ${key} on model`,()=>{beginPick(key);},{'aria-pressed':s.pick===key}),button('Use entire part',()=>edit(key,[])));
        note(block,key==='faces'?'Click faces on the target part to toggle them. Selection uses the part\'s rest geometry.':'Click a triangle to toggle its vertices in the part\'s rest geometry. Select just an orb, blade edge or cloth section to leave the rest still.');
    }
    function textureProperties(target,row){
        selection(target,'faces');note(target,'Later surface layers replace earlier layers where their face selections overlap.');const source=section(target,'Texture source');field(source,'Texture source',row.source,value=>mutate(v=>{const r=v.textures.find(r=>r.id===s.selected);r.source=value;if(value==='cache'&&r.sourceId<0)r.sourceId=partFor(r)?.mesh.textures?.find(id=>id>=0)??0;}),{options:[['pattern','Create a procedural texture'],['cache','Use a native texture'],['frames','Imported image frames']]});
        if(row.source==='pattern'){select(source,'Procedural pattern','pattern',PATTERNS);numeric(source,'Pattern seed','seed',0,2147483647);gradient(target);}
        if(row.source==='cache'){field(source,'Native texture ID',row.sourceId,async value=>{if(!Number.isInteger(value)||value<0||value>29999)throw new Error('Choose a valid native texture ID.');const request=++serial,project=state.project,layer=s.selected;await ctx.api(`texture?id=${value}`);if(request!==serial||state.project!==project||s.selected!==layer||s.type!=='textures')return;edit('sourceId',value);},{min:0,max:29999});note(source,'Browse the native texture library on the left. Source animation frames are preserved.');}
        if(row.source==='frames'||row.frames.length){numeric(source,'Image frame rate','frameRate',.1,60,.1);frameEditor(source,row);}
        field(source,'Import resolution',s.importSize,value=>{s.importSize=Number(value);},{options:[[16,'16 × 16'],[32,'32 × 32'],[64,'64 × 64']]});
        const importButton=button('Import image frames',()=>input.click());const input=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp',multiple:true,hidden:true,onChange:safe(()=>importFrames(input.files))});source.append(importButton,input);
        note(source,'Import up to 24 PNG, JPEG or WebP images. Frames are fitted to the chosen resolution with transparency.');
        const motion=section(target,'Surface movement');vector(motion,'Scroll per second','scroll',{length:2,min:-8,max:8,step:.01});vector(motion,'Texture offset','offset',{length:2,min:-32,max:32,step:.01});vector(motion,'Texture scale','scale',{length:2,min:.01,max:32,step:.05});numeric(motion,'Texture angle','rotation',-360,360);numeric(motion,'Spin degrees per second','spin',-720,720);select(motion,'Wrapping','wrap',['repeat','mirror','clamp']);select(motion,'Projection','projection',[['existing','Original UV mapping'],['xy','Planar X / Y'],['xz','Planar X / Z'],['yz','Planar Y / Z']]);
        if(row.source==='cache')numeric(motion,'Native frame rate','frameRate',.1,60,.1);
        const colour=section(target,'Surface colour');field(colour,'Texture tint',row.tint,value=>edit('tint',value),{type:'color'});for(const [label,key,min,max,step]of [['Hue shift','hue',-180,180,1],['Saturation','saturation',0,4,.05],['Brightness','brightness',0,4,.05],['Contrast','contrast',0,4,.05],['Surface opacity','opacity',0,1,.05]])numeric(colour,label,key,min,max,step);
    }
    function frameEditor(target,row){
        const strip=el('div',{class:'visual-frames','aria-label':'Image frames'});
        row.frames.forEach((frame,index)=>{const tile=el('div',{class:'visual-frame'},el('span',{text:`Frame ${index+1}`}),button('Preview',()=>{ctx.stop?.();seek(index/row.frameRate);refresh();},{'aria-label':`Preview frame ${index+1}`}),button('Earlier',()=>edit('frames',move(row.frames,index,-1)),{disabled:!index,'aria-label':`Move frame ${index+1} earlier`}),button('Later',()=>edit('frames',move(row.frames,index,1)),{disabled:index===row.frames.length-1,'aria-label':`Move frame ${index+1} later`}),button('Remove',()=>mutate(v=>{const r=v.textures.find(r=>r.id===s.selected);r.frames.splice(index,1);if(!r.frames.length)r.source='pattern';}),{'aria-label':`Remove frame ${index+1}`}));strip.append(tile);});target.append(strip);
        row.frames.forEach((frame,index)=>{const canvas=el('canvas',{width:frame.size,height:frame.size,'aria-label':`Frame ${index+1} preview`});strip.children[index].prepend(canvas);const bytes=Uint8Array.from(atob(frame.pixels),c=>c.charCodeAt(0)),c=canvas.getContext('2d'),image=c.createImageData(frame.size,frame.size);image.data.set(bytes);c.putImageData(image,0,0);});
    }
    const move=(rows,index,delta)=>{const copy=structuredClone(rows);[copy[index],copy[index+delta]]=[copy[index+delta],copy[index]];return copy;};
    async function importFrames(files){
        if(!files?.length)return;if(files.length+(selected()?.frames.length??0)>VISUAL_LIMITS.frames)throw new Error(`Keep at most ${VISUAL_LIMITS.frames} image frames.`);
        const token=++serial,project=state.project,layer=s.selected,frames=[],size=s.importSize;
        for(const file of files){
            if(file.size>10*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose PNG, JPEG or WebP images smaller than 10 MB.');
            const bitmap=await createImageBitmap(file);try{if(bitmap.width*bitmap.height>16000000)throw new Error('Image exceeds 16 million pixels. Resize it before importing.');const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const c=canvas.getContext('2d',{willReadFrequently:true}),scale=Math.min(size/bitmap.width,size/bitmap.height),w=bitmap.width*scale,h=bitmap.height*scale;c.drawImage(bitmap,(size-w)/2,(size-h)/2,w,h);const bytes=c.getImageData(0,0,size,size).data;let text='';for(const byte of bytes)text+=String.fromCharCode(byte);frames.push({size,pixels:btoa(text)});}finally{bitmap.close();}
        }
        if(token!==serial||state.project!==project||s.selected!==layer)return;
        mutate(v=>{const row=v.textures.find(r=>r.id===layer);row.frames.push(...frames);row.source='frames';});ctx.status(`Imported ${frames.length} image frames.`);
    }
    function particleProperties(target,row){
        const emission=section(target,'Emitter placement');select(emission,'Emitter shape','shape',['point','box','sphere','ring']);select(emission,'Particle shape','sprite',['spark','diamond','star','cloud']);vector(emission,'Emitter position','origin',{min:-4000,max:4000});vector(emission,'Emitter size','extent',{min:0,max:1000});emission.append(button(s.pick==='origin'?'Cancel placement':'Place emitter on model',()=>{beginPick('origin');},{'aria-pressed':s.pick==='origin'}));note(emission,'Placement uses the target part\'s rest geometry and local coordinates. Particles inherit its nearest joint or bone, so they follow the equipped item. Negative Y moves upwards.');
        const life=section(target,'Emission and lifetime');for(const [label,key,min,max,step]of [['Particles per second','rate',1,60,1],['Lifetime in seconds','lifetime',.1,8,.1],['Maximum live particles','capacity',1,128,1],['Emitter phase','phase',0,8,.05],['Random seed','seed',0,2147483647,1]])numeric(life,label,key,min,max,step);note(life,`Up to ${Math.min(row.capacity,Math.ceil(row.rate*row.lifetime))} particles are visible. The emitter repeats deterministically every eight seconds.`);
        const motion=section(target,'Particle movement');vector(motion,'Launch velocity','velocity',{min:-500,max:500});vector(motion,'Velocity spread','spread',{min:0,max:500});vector(motion,'Gravity','gravity',{min:-500,max:500});numeric(motion,'Air drag','drag',0,10,.05);numeric(motion,'Turbulence','turbulence',0,200,.1);numeric(motion,'Orbit radians per second','orbit',-10,10,.1);
        const appearance=section(target,'Size and fade');numeric(appearance,'Birth size','startSize',.1,100,.1);numeric(appearance,'End size','endSize',0,100,.1);numeric(appearance,'Birth opacity','startOpacity',0,1,.05);numeric(appearance,'End opacity','endOpacity',0,1,.05);gradient(target);
    }
    function modelProperties(target,row){
        selection(target,'vertices');const motion=section(target,'Independent item motion');select(motion,'Motion type','type',[['transform','Keyframed transform'],['wave','Wave deformation']]);field(motion,'Loop duration in seconds',row.duration,value=>mutate(v=>{const r=v.models.find(r=>r.id===s.selected);for(const key of r.keys)key.time=key.time*value/r.duration;r.duration=value;}),{min:.1,max:30,step:.05});select(motion,'Loop behaviour','loop',['repeat','pingpong','once']);numeric(motion,'Motion phase','phase',0,30,.05);vector(motion,'Motion pivot','pivot',{min:-4000,max:4000});motion.append(button(s.pick==='pivot'?'Cancel pivot placement':'Place pivot on model',()=>{beginPick('pivot');},{'aria-pressed':s.pick==='pivot'}));
        if(row.type==='wave'){vector(motion,'Wave direction','axis',{min:-1,max:1,step:.05});numeric(motion,'Wave amplitude','amplitude',-500,500,.1);numeric(motion,'Wavelength','wavelength',.1,2000,.1);numeric(motion,'Wave cycles per second','frequency',-10,10,.05);return;}
        const keys=section(target,'Motion timeline'),timeline=el('div',{class:'visual-timeline',role:'list','aria-label':'Motion keyframes'});
        row.keys.forEach((key,index)=>timeline.append(button(`${key.time.toFixed(2)} s`,()=>{s.key=index;seek(key.time);refresh();},{'aria-pressed':s.key===index,role:'listitem'})));keys.append(timeline);
        const range=el('input',{type:'range',min:0,max:row.duration,step:.01,value:Math.min(s.cursor,row.duration),'aria-label':'Scrub motion timeline',onInput:event=>{seek(Number(event.target.value));}});keys.append(range);
        keys.append(button('Add key at cursor',()=>{const t=Math.max(0,Math.min(row.duration,Math.round(s.cursor*100)/100));if(row.keys.some(k=>k.time===t))throw new Error('A key already exists at this time.');const key=structuredClone(row.keys[Math.min(s.key,row.keys.length-1)]);key.time=t;edit('keys',[...row.keys,key]);s.key=selected().keys.findIndex(k=>k.time===t);refresh();},{disabled:row.keys.length>=VISUAL_LIMITS.keys}),button('Remove key',()=>{edit('keys',row.keys.filter((_,i)=>i!==s.key));s.key=0;refresh();},{disabled:row.keys.length<=1}));
        s.key=Math.min(s.key,row.keys.length-1);const key=row.keys[s.key];
        const keyField=(label,value,fn,options={})=>field(keys,label,value,next=>{const k=structuredClone(selected().keys);fn(k[s.key],next);edit('keys',k);},options);
        keyField('Selected key time',key.time,(k,v)=>k.time=v,{min:0,max:row.duration,step:.01});keyField('Interpolation',key.easing,(k,v)=>k.easing=v,{options:['linear','smooth','step']});
        for(const [property,label,min,max,step]of [['position','Key movement',-2000,2000,.1],['rotation','Key rotation',-3600,3600,1],['scale','Key scale',.01,20,.01]]){const group=el('fieldset',{class:'visual-vector'},el('legend',{text:label}));keys.append(group);for(let i=0;i<3;i++)field(group,`${label} ${['X','Y','Z'][i]}`,key[property][i],value=>{const k=structuredClone(selected().keys);k[s.key][property][i]=value;edit('keys',k);},{min,max,step});}
        note(keys,'Motion is applied in the part\'s local coordinates before the player animation. Overlapping tracks combine in layer order.');
    }
    async function searchTextures(offset=0){
        const token=++serial,query=s.query;const result=await ctx.api(`gear-textures?q=${encodeURIComponent(query)}&offset=${offset}`);if(token!==serial||s.query!==query)return;s.textureRows=result.rows;s.offset=offset;s.total=result.total;refresh();
    }
    function textureLibrary(target){
        const block=section(target,'Native texture library'),input=el('input',{type:'search',value:s.query,placeholder:'Search texture ID or motion…','aria-label':'Search native textures',onChange:event=>s.query=event.target.value});block.append(input,button('Search textures',safe(()=>searchTextures())));
        for(const texture of s.textureRows){
            const choose=button(texture.name,()=>{if(!selected())throw new Error('Add a surface layer first.');mutate(v=>Object.assign(v.textures.find(r=>r.id===s.selected),{source:'cache',sourceId:texture.id,scroll:[texture.animU/64,texture.animV/64],frameRate:texture.frameRate||8}));},{title:texture.description,class:'visual-texture-choice'});const canvas=el('canvas',{width:128,height:128,'aria-hidden':'true'});choose.append(canvas);block.append(choose);
            if(!nativeThumbnails.has(texture.id))nativeThumbnails.set(texture.id,ctx.api(`texture?id=${texture.id}`));
            while(nativeThumbnails.size>24)nativeThumbnails.delete(nativeThumbnails.keys().next().value);
            nativeThumbnails.get(texture.id)?.then(data=>{if(!canvas.isConnected)return;const bytes=Uint8Array.from(atob(data.frames[0]),c=>c.charCodeAt(0)),c=canvas.getContext('2d'),image=c.createImageData(data.size,data.size);image.data.set(bytes);c.putImageData(image,0,0);}).catch(()=>{});
        }
        if(s.total){note(block,`${s.offset+1}–${Math.min(s.offset+s.textureRows.length,s.total)} of ${s.total}`);block.append(button('Previous',safe(()=>searchTextures(Math.max(0,s.offset-20))),{disabled:!s.offset}),button('Next',safe(()=>searchTextures(s.offset+20)),{disabled:s.offset+s.textureRows.length>=s.total}));}
    }
    function seek(value){s.cursor=value;s.playing=false;if(ctx.viewport.animation)ctx.viewport.animation.pausedAt=ctx.viewport.animation.start+value*1000;ctx.viewport.dirty=true;}
    function currentTime(){const a=ctx.viewport.animation;if(a)return ((a.pausedAt??performance.now())-a.start)/1000;return s.playing?s.cursor+(performance.now()-s.start)/1000:s.cursor;}
    const active=()=>state.project?.kind==='gear'&&s.preview&&[state.project,...(state.gearSet&&state.previewSet?state.gearSet.items:[])].some(p=>visualLayers(p.visuals).some(({layer})=>layer.enabled));
    function preview(items,time){
        if(!active()||state.mode==='visuals'&&s.pick)return items;
        const at=state.mode==='visuals'?currentTime():time/1000,frame=Math.floor(at*20);
        return items.map(item=>{
            const project=item.visualProject??state.project;
            if(item.reference&&!item.visualProject||!item.visualProject&&!project.parts.some(p=>p.id===item.id)||!visualLayers(project.visuals).some(({layer})=>layer.enabled))return item;
            let result=cache.get(item.id);
            if(result?.error)return item;
            try{if(!result){const v=project.visuals??newGearVisuals(),p={...project,visuals:s.solo&&state.mode==='visuals'?Object.fromEntries(Object.entries(v).map(([type,rows])=>[type,Array.isArray(rows)?rows.filter(r=>project.id===state.project.id&&r.id===s.selected):rows])):v};result=compileGearVisualMesh(p,state.variant,{remap:false,only:item.visualProject?null:new Set([item.id])});result.textureFaces=[];for(const row of result.compiled.textures){row.previewId=`${project.id}/${row.id}`;for(const face of row.faceIndices)result.textureFaces[face]=row;}cache.set(item.id,result);}}catch(error){cache.set(item.id,{error});if(previewError!==error.message){previewError=error.message;ctx.status(error.message,true);}return item;}
            if(result.frame!==frame){const base=result.mesh,vertices=base.vertices.map(v=>[...v]),alpha=[...base.alpha],colours=base.faces.map(f=>f[3]);sampleVisualGeometry(vertices,alpha,colours,result.compiled,frame/20);result.sample={...base,vertices,alpha,faces:base.faces.map((f,i)=>[...f.slice(0,3),colours[i]]),visualTextureFaces:result.textureFaces,visualTime:frame/20};result.frame=frame;}
            return {...item,mesh:result.sample};
        });
    }
    function pick(hit){
        const row=selected();if(!row||!s.pick||!hit||hit.reference)return false;
        if(hit.partId!==row.partId){ctx.status('Click the layer\'s target part.',true);return true;}
        const part=partFor(row);
        if(['origin','pivot'].includes(s.pick)){const point=localPoint(hit.twin?reflectPoint(hit.point,state.project.parts.find(p=>p.id===part.parentId),state.project.parts):hit.point,part,state.project.parts);edit(s.pick,point.map(n=>Math.round(n*10)/10));s.pick=null;refresh();return true;}
        const face=hit.sourceFaceId??hit.faceId;
        if(face>=part.mesh.faces.length)return true;
        if(s.pick==='faces'){const faces=new Set(row.faces);faces.has(face)?faces.delete(face):faces.add(face);edit('faces',[...faces].sort((a,b)=>a-b));}
        else{const vertices=new Set(row.vertices),corners=part.mesh.faces[face].slice(0,3),remove=corners.every(i=>vertices.has(i));for(const i of corners)remove?vertices.delete(i):vertices.add(i);edit('vertices',[...vertices].sort((a,b)=>a-b));}
        return true;
    }
    return {renderTools,renderProperties,preview,pick,animationStarted(){s.cursor=0;s.start=performance.now();s.playing=true;if(state.mode==='visuals')refresh();},syncPlayback(){if(ctx.viewport.animation){s.cursor=currentTime();s.playing=ctx.viewport.animation.pausedAt===undefined;}if(state.mode==='visuals')refresh();},prepareProjects(projects){return projects.map(project=>({...project,visuals:!s.preview?newGearVisuals():s.solo&&state.mode==='visuals'?Object.fromEntries(Object.entries(project.visuals??newGearVisuals()).map(([type,rows])=>[type,Array.isArray(rows)?rows.filter(row=>project.id===state.project.id&&row.id===s.selected):rows])):project.visuals}));},invalidate(){cache.clear();previewError=null;},active,reset(){serial++;s.pick=null;s.solo=false;cache.clear();},faceOverlay(polygon){const row=selected();if(!row||polygon.partId!==row.partId||!s.pick)return null;const part=partFor(row),face=polygon.sourceFaceId??polygon.faceId,chosen=s.pick==='faces'?row.faces.includes(face):s.pick==='vertices'?part?.mesh.faces[face]?.slice(0,3).some(i=>row.vertices.includes(i)):false;return chosen?{fill:'#bda4ed',alpha:.3,stroke:'#dfcfff',lineWidth:1}:null;}};
}
