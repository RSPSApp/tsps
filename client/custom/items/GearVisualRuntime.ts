import { GearTextureLoader } from "./GearTextureLoader";
import { GearVisualRegistry } from "./GearVisualRegistry";
const uploaded=new WeakMap<object,string>();
const uploadedPixels=new WeakMap<object,Map<number,Int32Array>>();
const uploadedRevision=new WeakMap<object,number>();
const transparent=new Int32Array(128*128);
/** Sample item-owned geometry and update only the reserved item texture slots. */
export function updateGearVisuals(renderer:any,milliseconds:number):void {
    GearVisualRegistry.setTime(milliseconds);
    const loader=renderer.osrsClient?.textureLoader;
    if(!(loader instanceof GearTextureLoader))return;
    const target=renderer.world??renderer;
    if(!target.loadedTextureIds)return;
    const key=`${GearVisualRegistry.revision}/${GearVisualRegistry.frame}`;
    if(uploaded.get(target)===key)return;
    const textures=GearVisualRegistry.texturePixels(loader.base);
    const previous=uploadedPixels.get(target)??new Map(),changed=new Map<number,Int32Array>();
    if(uploadedRevision.get(target)!==GearVisualRegistry.revision){for(const id of previous.keys())if(!textures.has(id))changed.set(id,transparent);previous.clear();}
    for(const [id,pixels]of textures)if(previous.get(id)!==pixels||!target.loadedTextureIds.has(id)){changed.set(id,pixels);previous.set(id,pixels);}
    if(changed.size){for(const id of changed.keys())target.loadedTextureIds.delete(id);if(target.uploadMapTextures)target.uploadMapTextures(changed);else if(renderer.textureArray)renderer.updateTextureArray(changed);}
    uploadedPixels.set(target,previous);uploadedRevision.set(target,GearVisualRegistry.revision);
    uploaded.set(target,key);
}
