import {clearHintArrow,getHintArrowRevision,hintArrow,setHintArrowTile} from '../../HintArrow';
import {resolveTargetTiles} from './QuestHelperHighlights';
import type {HelperStep,ReadonlyClientSnapshot,WorldTile} from './QuestHelperProtocol';
export type QuestDirection={target:WorldTile;text:string;bearing:number;distance:number};
export function questDirection(step:HelperStep|null|undefined,snapshot:ReadonlyClientSnapshot|undefined):QuestDirection|null {
    if(!step||!snapshot)return null;
    const player=snapshot.localPlayer;
    const loaded=resolveTargetTiles(step.targets,snapshot,player.plane);
    const fallback=step.targets.filter(t=>['tile','npc','object'].includes(t.kind)&&Number.isInteger(t.x)&&Number.isInteger(t.y)&&Number.isInteger(t.plane)).map(t=>({x:t.x!,y:t.y!,plane:t.plane!}));
    const candidates=loaded.length?loaded:fallback;
    const target=[...candidates].filter(t=>t.x>=0&&t.x<=16383&&t.y>=0&&t.y<=16383&&t.plane>=0&&t.plane<=3).sort((a,b)=>(a.plane===player.plane?0:100000)+Math.hypot(a.x-player.x,a.y-player.y)-((b.plane===player.plane?0:100000)+Math.hypot(b.x-player.x,b.y-player.y)))[0];
    if(!target)return null;
    const dx=target.x-player.x,dy=target.y-player.y;
    const distance=Math.max(Math.abs(dx),Math.abs(dy));
    const bearing=Math.atan2(dx,dy)*180/Math.PI;
    const compass=['north','north-east','east','south-east','south','south-west','west','north-west'][((Math.round(bearing/45)%8)+8)%8];
    const floor=target.plane===player.plane?'':` on floor ${target.plane} (you are on floor ${player.plane}); follow the quest step to change floors`;
    return {target,bearing,distance,text:distance<=1&&target.plane===player.plane?'Target nearby — follow the quest instruction.':`Target ${compass}, ${distance} tiles away${floor}.`};
}
/** Native world/minimap rendering, with server hints taking priority. */
export class OwnedQuestHintArrow {
    private revision=-1;
    clear():void {if(this.revision===getHintArrowRevision())clearHintArrow();this.revision=-1;}
    update(direction:QuestDirection|null):void {
        this.clear();if(!direction||hintArrow.type!==0)return;
        const t=direction.target;setHintArrowTile(t.x,t.y,100,(2<<2)|t.plane);this.revision=getHintArrowRevision();
    }
}
