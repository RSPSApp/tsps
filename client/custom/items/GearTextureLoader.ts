import type { TextureLoader } from "../../rs/texture/TextureLoader";
import {GEAR_TEXTURE_COUNT,GEAR_TEXTURE_START,GearVisualRegistry} from "./GearVisualRegistry";

export class GearTextureLoader implements TextureLoader {
    constructor(readonly base:TextureLoader){}
    private custom(id:number):boolean{return id>=GEAR_TEXTURE_START&&id<GEAR_TEXTURE_START+GEAR_TEXTURE_COUNT;}
    getTextureIds():number[]{return [...this.base.getTextureIds(),...Array.from({length:GEAR_TEXTURE_COUNT},(_,i)=>GEAR_TEXTURE_START+i)];}
    getTextureIndex(id:number):number{return this.custom(id)?this.getTextureIds().indexOf(id):this.base.getTextureIndex(id);}
    isSmall(id:number):boolean{return this.custom(id)?false:this.base.isSmall(id);}
    isSd(id:number):boolean{return this.custom(id)||this.base.isSd(id);}
    isTransparent(id:number):boolean{return this.custom(id)||this.base.isTransparent(id);}
    getAverageHsl(id:number):number{return this.custom(id)?127:this.base.getAverageHsl(id);}
    getAnimationUv(id:number):[number,number]{return this.custom(id)?[0,0]:this.base.getAnimationUv(id);}
    getMaterial(id:number){return this.custom(id)?{animU:0,animV:0,frameCount:1,animSpeed:0,alphaCutOff:.01}:this.base.getMaterial(id);}
    getFrameCount(id:number):number{return this.custom(id)?1:this.base.getFrameCount(id);}
    getPixelsArgb(id:number,size:number,flipH:boolean,brightness:number,frame=0):Int32Array{
        if(!this.custom(id))return this.base.getPixelsArgb(id,size,flipH,brightness,frame);
        const pixels=GearVisualRegistry.texturePixels(this.base,size).get(id);
        return pixels?.slice()??new Int32Array(size*size);
    }
    getPixelsRgb(id:number,size:number,flipH:boolean,brightness:number,frame=0):Int32Array{return this.custom(id)?this.getPixelsArgb(id,size,flipH,brightness,frame):this.base.getPixelsRgb(id,size,flipH,brightness,frame);}
}
