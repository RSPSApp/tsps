import { ActorPresentation } from './ActorPresentation';
import { World } from '../World';
import { Animation } from './Animation';
import { encodePluginMessage } from '../../net/protocol/ClientProtocol';

export type ActorVisualClip = {kind:'graphic'|'animation';id:number;delayMs:number;speed:number;durationMs:number;loop:boolean;height:number;hueShift?:number};
/** Generic, cancellable actor presentation. It never schedules combat damage. */
export class ActorVisuals {
    static readonly VERSION = 1;
    static readonly PRESENTATION_VERSION = 1;
    static readonly CUE_VERSION = 1;
    static readonly COLOUR_VERSION = 1;
    static readonly TIMING_VERSION = 2;
    static withPresentation<T>(actors: {entity:object;animation?:number;suppressGraphics?:boolean;onGraphic?:(graphic:any,slot:number)=>boolean}[],valid:()=>boolean,fn:()=>T):T {return ActorPresentation.with(actors,valid,fn);}
    private static serial = 0;
    static play(entity:any, clips:ActorVisualClip[], valid:()=>boolean = ()=>true): {cancel:()=>void;finished:Promise<void>} {
        if(!Array.isArray(clips)||clips.length>24)throw new Error('At most 24 actor visual clips.');
        const number=(v:number,a:number,b:number)=>Number.isFinite(v)&&v>=a&&v<=b;
        for(const c of clips)if(!c||!['graphic','animation'].includes(c.kind)||!Number.isInteger(c.id)||!number(c.id,0,65534)||!number(c.delayMs,0,119999)||!number(c.speed,.1,4)||!number(c.durationMs,0,120000)||c.delayMs+c.durationMs>120000||!number(c.height,-256,512)||c.hueShift!==undefined&&(!number(c.hueShift,-180,180)||c.kind!=='graphic')||typeof c.loop!=='boolean'||c.loop&&!c.durationMs||c.kind==='animation'&&(c.speed!==1||c.durationMs!==0||c.loop||c.height!==0))throw new Error('Invalid actor visual clip.');
        const token=`v${++this.serial}`,kind=entity.isPlayer()?'player':'npc',index=entity.getIndex(),timers=new Set<ReturnType<typeof setTimeout>>(),viewers=new Set<any>();
        let cancelled=false,complete:()=>void;
        const finished=new Promise<void>(resolve=>complete=resolve);
        const registered=()=>!cancelled&&valid()&&(kind==='player'?World.getPlayers():World.getNpcs()).get(index)===entity;
        const send=(viewer:any,data:any)=>{try{viewer.getSession().sendClientPacket(encodePluginMessage('actor-visuals',data));}catch{/* Disconnected viewer. */}};
        const cancel=()=>{if(cancelled)return;cancelled=true;for(const timer of timers)clearTimeout(timer);timers.clear();for(const viewer of viewers)send(viewer,{type:'clear',token});viewers.clear();complete();};
        const later=(fn:()=>void,ms:number)=>{const timer=setTimeout(()=>{timers.delete(timer);if(!registered()){cancel();return;}fn();},ms);timer.unref?.();timers.add(timer);};
        for(const clip of clips){const play=()=>{
            if(!registered()){cancel();return;}
            if(clip.kind==='animation'){entity.performAnimation(new Animation(clip.id));return;}
            for(const viewer of World.getPlayers()){
                if(!viewer)continue;
                const visible=kind==='player'?(viewer===entity||viewer.getLocalPlayers().includes(entity)):viewer.getLocalNpcs().includes(entity);
                if(!visible)continue;
                viewers.add(viewer);send(viewer,{type:'play',token,actor:{kind,index},clip});
            }
        };if(clip.delayMs===0)play();else later(play,clip.delayMs);}
        // Natural clips are bounded too. This also releases disconnected viewers.
        later(cancel,Math.max(0,...clips.map(c=>c.delayMs+(c.durationMs||120000-c.delayMs)))+50);
        return {cancel,finished};
    }
}
