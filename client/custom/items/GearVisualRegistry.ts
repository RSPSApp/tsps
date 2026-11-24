import {newGearVisuals,validateGearVisuals,sampleVisualGeometry,renderTexture} from "./GearVisualMath.mjs";
import type { ModelData } from "../../rs/model/ModelData";
import type { TextureLoader } from "../../rs/texture/TextureLoader";

// Reserved atlas entries are present before login, so a dataset never reallocates the
// world's textures or changes the layer indices already baked into map geometry.
export const GEAR_TEXTURE_START = 30000;
export const GEAR_TEXTURE_COUNT = 32;
const models=new Map<number,any>();
const textures=new Map<number,any>();
const owners=new Map<number,number[]>();
const ownerTextures=new Map<number,number[]>();
let time=0,frame=0;
let pixelFrame=-1,pixelRevision=-1,pixelSize=-1;
const pixels=new Map<number,Int32Array>();
const textureCache=new Map<number,{row:any;size:number;frame:number;pixels:Int32Array}>();
let clockId=0,samplingKey:object|undefined;
let clocks=new WeakMap<object,{id:number;items:Map<number,{epoch:number;start:number}>}>();
const objectClocks=new Map<number,object>();
function clock(key:object,owner:number,epoch:number){
    let record=clocks.get(key);if(!record){record={id:++clockId,items:new Map()};clocks.set(key,record);}
    let item=record.items.get(owner);if(!item||item.epoch!==epoch){item={epoch,start:time};record.items.set(owner,item);}
    return {id:record.id,start:item.start};
}

function validateCompiled(input:any):any {
    if(!input||input.version!==1||!Array.isArray(input.models)||input.models.length>5)throw new Error("Invalid item visuals");
    const used=new Set<number>();
    for(const model of input.models){
        if(!Number.isInteger(model.modelId)||model.modelId<1000000||used.has(model.modelId)||!Number.isInteger(model.vertexCount)||model.vertexCount<1||model.vertexCount>40000||!Number.isInteger(model.faceCount)||model.faceCount<1||model.faceCount>40000)throw new Error("Invalid item visual geometry");
        used.add(model.modelId);
        for(const type of ['textures','particles','models']){
            if(!Array.isArray(model[type])||model[type].length>32)throw new Error("Too many compiled visual layers");
            for(const row of model[type]){
                const check=newGearVisuals();check[type]=[{...row,enabled:true,partId:'compiled',faces:[],vertices:[]}];validateGearVisuals(check);
                for(const [key,count] of [['vertexIndices',model.vertexCount],['faceIndices',model.faceCount]] as const){
                    if(row[key]!==undefined&&(!Array.isArray(row[key])||row[key].length>40000||row[key].some((n:number)=>!Number.isInteger(n)||n<0||n>=count)||new Set(row[key]).size!==row[key].length))throw new Error("Invalid visual geometry selection");
                }
                if(type==='textures'&&!row.faceIndices?.length||type==='models'&&!row.vertexIndices?.length)throw new Error("Empty visual geometry selection");
                if(type==='particles'&&(row.vertexIndices?.length!==row.capacity*6||row.faceIndices?.length!==row.capacity*8||!Number.isInteger(row.anchorVertex)||row.anchorVertex<0||row.anchorVertex>=model.vertexCount))throw new Error("Invalid particle geometry");
                if(type!=='textures'){
                    const origin=type==='particles'?row.partOrigin:row.origin;
                    if(!Array.isArray(origin)||origin.length!==3||origin.some((n:number)=>!Number.isFinite(n)||Math.abs(n)>32767)||!Array.isArray(row.basis)||row.basis.length!==3||row.basis.some((v:number[])=>!Array.isArray(v)||v.length!==3||v.some(n=>!Number.isFinite(n)||Math.abs(n)>1000)))throw new Error("Invalid visual coordinate basis");
                }
            }
        }
    }
    return structuredClone(input);
}
export const GearVisualRegistry={
    revision:0,
    validateBatch(rows:any[]):void {
        const ids=new Set<number>();let slots=0;
        for(const row of rows){
            if(row.visuals===undefined)continue;
            const visuals=validateCompiled(row.visuals),materials=new Set<string>();
            for(const model of visuals.models){if(ids.has(model.modelId))throw new Error('Visual model ID is already registered');ids.add(model.modelId);for(const layer of model.textures)materials.add(layer.id);}
            slots+=materials.size;
        }
        if(slots>GEAR_TEXTURE_COUNT)throw new Error(`Loaded gear exceeds the ${GEAR_TEXTURE_COUNT} custom texture atlas slots`);
    },
    setTime(milliseconds:number):void {frame=Math.max(0,Math.floor(milliseconds/50));time=frame/20;},
    get time():number{return time;},
    get frame():number{return frame;},
    register(owner:number,input:any):void {
        const previous=new Set(owners.get(owner)??[]),oldTextures=new Set(ownerTextures.get(owner)??[]);
        const remove=()=>{for(const id of previous){models.delete(id);objectClocks.delete(id);}for(const id of oldTextures)textures.delete(id);owners.delete(owner);ownerTextures.delete(owner);};
        if(input===undefined){if(previous.size){remove();this.revision++;}return;}
        const validated=validateCompiled(input),aliases=new Map<string,number>(),available=GEAR_TEXTURE_COUNT-textures.size+oldTextures.size;
        const unique=new Set(validated.models.flatMap((m:any)=>m.textures.map((r:any)=>r.id)));
        if(unique.size>available)throw new Error(`Item visuals exceed the ${GEAR_TEXTURE_COUNT} custom texture atlas slots. Reduce surface layers on loaded gear.`);
        for(const row of validated.models)if(models.has(row.modelId)&&!previous.has(row.modelId))throw new Error("Visual model ID is already registered");
        remove();
        for(const model of validated.models){
            model.owner=owner;model.epoch=this.revision+1;model.oneShot=model.models.some((row:any)=>row.loop==='once');
            for(const row of model.textures){
                let alias=aliases.get(row.id);
                if(alias===undefined){alias=GEAR_TEXTURE_START;while(textures.has(alias))alias++;aliases.set(row.id,alias);textures.set(alias,row);}
                row.textureId=alias;
            }
            models.set(model.modelId,model);
        }
        owners.set(owner,validated.models.map((r:any)=>r.modelId));this.revision++;
        ownerTextures.set(owner,[...aliases.values()]);
    },
    clear():void {models.clear();textures.clear();owners.clear();ownerTextures.clear();pixels.clear();textureCache.clear();objectClocks.clear();clocks=new WeakMap();samplingKey=undefined;pixelFrame=-1;this.revision++;},
    model(id:number):any {return models.get(id);},
    dynamic(owner:number):boolean {return (owners.get(owner)??[]).some(id=>{const m=models.get(id);return m.models.length||m.particles.length;});},
    appearanceKey(equipment:number[],key?:object):string {
        let active=false,dynamic=false,once=0;
        for(const owner of equipment)for(const id of owners.get(owner)??[]){
            const model=models.get(id);active=true;dynamic ||= !!model.particles.length||model.models.some((row:any)=>row.loop!=='once');
            if(model.oneShot){if(key){const record=clock(key,owner,model.epoch);if(model.models.some((row:any)=>row.loop==='once'&&time-record.start+row.phase<row.duration)){dynamic=true;once=record.id;}}else dynamic=true;}
        }
        return active?`~gear${this.revision}${dynamic?`.${frame}`:''}${once?`.clock${once}`:''}`:'';
    },
    withAppearance<T>(key:object,fn:()=>T):T {const previous=samplingKey;samplingKey=key;try{return fn();}finally{samplingKey=previous;}},
    apply(id:number,data:ModelData):ModelData {
        const model=models.get(id);if(!model)return data;
        if(data.verticesCount!==model.vertexCount||data.faceCount!==model.faceCount)throw new Error("Item visual geometry does not match its model");
        if(model.models.length||model.particles.length){
            const vertices=Array.from({length:data.verticesCount},(_,i)=>[data.verticesX[i],data.verticesY[i],data.verticesZ[i]]);
            data.faceAlphas??=new Int8Array(data.faceCount);
            let sampled=model;
            if(model.oneShot){let key=samplingKey;if(!key){key=objectClocks.get(id);if(!key){key={};objectClocks.set(id,key);}}const start=clock(key,model.owner,model.epoch).start;sampled={...model,models:model.models.map((row:any)=>row.loop==='once'?{...row,phase:row.phase-start}:row)};}
            sampleVisualGeometry(vertices,data.faceAlphas,data.faceColors,sampled,time);
            vertices.forEach((v,i)=>{data.verticesX[i]=Math.round(v[0]);data.verticesY[i]=Math.round(v[1]);data.verticesZ[i]=Math.round(v[2]);});
        }
        if(model.textures.length){data.faceTextures??=new Int16Array(data.faceCount).fill(-1);for(const row of model.textures)for(const index of row.faceIndices)data.faceTextures[index]=row.textureId;}
        return data;
    },
    texturePixels(base:TextureLoader,size=128):Map<number,Int32Array> {
        if(pixelFrame===frame&&pixelRevision===this.revision&&pixelSize===size)return pixels;
        pixels.clear();
        for(const [id,row] of textures){
            try{
                const animated=row.scroll.some((n:number)=>n!==0)||row.spin!==0||row.source==='frames'&&row.frames.length>1||row.source==='cache'&&base.getFrameCount(row.sourceId)>1||row.source==='pattern'&&['flame','water','noise','runes','stars'].includes(row.pattern);
                const cached=textureCache.get(id);
                if(cached&&cached.row===row&&cached.size===size&&(!animated||cached.frame===frame)){pixels.set(id,cached.pixels);continue;}
                let source;
                if(row.source==='cache'){
                    const count=Math.max(1,base.getFrameCount(row.sourceId)),native=base.getPixelsArgb(row.sourceId,size,false,1,Math.floor(time*row.frameRate)%count),rgba=new Uint8Array(size*size*4);
                    for(let i=0;i<native.length;i++){const v=native[i];rgba[i*4]=(v>>>16)&255;rgba[i*4+1]=(v>>>8)&255;rgba[i*4+2]=v&255;rgba[i*4+3]=v>>>24;}
                    source={size,pixels:rgba};
                }else if(row.source==='frames'){
                    const f=row.frames[Math.floor(time*row.frameRate)%row.frames.length];source={size:f.size,pixels:Uint8Array.from(atob(f.pixels),(c:string)=>c.charCodeAt(0))};
                }
                const rgba=renderTexture(row,size,time,source),result=new Int32Array(size*size);
                // World atlases upload the words' BGRA bytes; both shaders sample .bgra.
                // The authoring canvas consumes RGBA bytes directly instead.
                for(let i=0;i<result.length;i++)result[i]=(rgba[i*4+3]<<24)|(rgba[i*4]<<16)|(rgba[i*4+1]<<8)|rgba[i*4+2];
                pixels.set(id,result);textureCache.set(id,{row,size,frame,pixels:result});
            }catch{/* A sparse cache source can still be streaming. Retry next visual frame. */}
        }
        pixelFrame=frame;pixelRevision=this.revision;pixelSize=size;return pixels;
    },
};
