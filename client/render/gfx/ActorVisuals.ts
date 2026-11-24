import type { PluginMessagePayload } from '../../common/network/PluginMessage';
import type { GfxManager } from './GfxManager';

/** Authenticated server presentation messages, shared by both renderers. */
export function receiveActorVisual(message:PluginMessagePayload,manager:GfxManager|undefined):void {
    if(message.channel!=='actor-visuals'||!manager)return;
    const d=message.data as any;
    if(typeof d.token!=='string'||!/^v\d{1,16}$/.test(d.token))return;
    if(d.type==='clear'){manager.clearVisualToken(d.token);return;}
    const c=d.clip,a=d.actor,number=(v:any,min:number,max:number)=>Number.isFinite(v)&&v>=min&&v<=max;
    if(d.type!=='play'||!a||!['player','npc'].includes(a.kind)||!Number.isInteger(a.index)||!number(a.index,0,65534)||!c||c.kind!=='graphic'||!Number.isInteger(c.id)||!number(c.id,0,65534)||!number(c.speed,.1,4)||!number(c.delayMs??0,0,119999)||!number(c.durationMs,0,120000)||(c.delayMs??0)+c.durationMs>120000||!number(c.height,-256,512)||c.hueShift!==undefined&&!number(c.hueShift,-180,180)||typeof c.loop!=='boolean'||c.loop&&!c.durationMs)return;
    manager.playVisual(a.kind,a.index,c,d.token);
}
