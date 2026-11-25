import {visualStart,visualDuration} from './visuals.mjs';
import {ruleTraits} from './attack-rules.mjs';
const natural=asset=>asset?.frames?.reduce((n,f)=>n+f.duration,0)??1000;
/** One successful exchange. Explicit sound effects and cache frame cues share the stage clock. */
export function combatSoundTimeline(rule,scene,{impactMs=600,retaliate=true,retaliationMs=1600,retaliationImpactMs=2200,durationMs=6000,random=Math.random}={}){
 const selfCast=scene.preview?.selfCast??(rule.activation==='self');
 const events=[],add=(row,timeMs,recipient='player',rate=1,origin='frame')=>{if(Number.isInteger(row.id)&&row.id>=0&&timeMs>=0&&timeMs<durationMs)events.push({id:row.id,loops:row.loops??1,timeMs,recipient:selfCast?'player':recipient,rate,origin});};
 const frameSounds=(asset,start,recipient,rate=1,visible=natural(asset)/rate,repeat=false)=>{
  const groups=new Map();for(const row of asset?.soundEvents??[]){if(!groups.has(row.timeMs))groups.set(row.timeMs,[]);groups.get(row.timeMs).push(row);}
  const step=natural(asset)/rate;
  for(let loop=0;loop===0||repeat&&loop*step<visible;loop++){
   for(const [time,rows] of groups){let row=rows[0];if(rows.length>1){const roll=1+Math.floor(random()*100);let cursor=0;row=rows.find(candidate=>{const first=cursor;cursor+=candidate.weight??1;return first<=roll&&roll<cursor;});}if(!row||recipient==='target'&&row.location===0)continue;const offset=loop*step+time/rate;if(offset<visible)add(row,start+offset,recipient,rate);}
   if(step<=0)break;
  }
 };
 const hitSound=(rows,at,recipient)=>{if(rows?.length){const [id,delay]=rows[Math.min(rows.length-1,Math.floor(random()*rows.length))];add({id,loops:1},at+delay*20,recipient,1,'combat');}};
 const hasPlayerMovement=scene.clips.some(clip=>clip.kind==='animation'&&clip.recipient!=='target'&&visualStart(clip,impactMs)===0);
 if(!hasPlayerMovement)frameSounds(scene.player,0,'player');
 for(const row of rule.extraFeatures??[])if(row.type==='sound')add(row.values,(row.values.event==='launch'?0:impactMs)+row.values.delayCycles*20,row.values.recipient,1,'effect');
 for(const clip of scene.clips){for(const who of clip.recipient==='both'?['player','target']:[clip.recipient]){const asset=scene.assets.get(`${clip.kind}:${clip.id}:${clip.kind==='graphic'?clip.recipient:who}`);if(asset)frameSounds(asset,visualStart(clip,impactMs),who,clip.speed,visualDuration(clip,natural(asset)),clip.loop);}}
 if(scene.preview){for(const hit of scene.preview.hits)if(hit.recipient==='target'&&hit.source!=='first-dot'){hitSound(scene.audioInfo?.npc?.hit,hit.timeMs,'target');frameSounds(scene.targetBlock,hit.timeMs,'target');}}
 else {const traits=rule.recipe?ruleTraits(rule.ruleFeatures??[]):rule,offsets=traits.hitDelayTicks??rule.hitDelayTicks??[0],count=traits.hitCount??rule.hitCount??1;
 if(!selfCast&&!traits.skipAttack)for(let i=0;i<count;i++){const at=impactMs+(offsets[i]??0)*600;hitSound(scene.audioInfo?.npc?.hit,at,'target');frameSounds(scene.targetBlock,at,'target');}
 for(const event of scene.events??[])if(!selfCast&&event.damage!==undefined)hitSound(scene.audioInfo?.npc?.hit,impactMs+event.delayMs,'target');}
 if(retaliate&&!selfCast&&scene.enemy.id!=='dummy'){
  const npc=scene.audioInfo?.npc,player=scene.audioInfo?.player;if(npc?.attackBase)add({id:npc.attackBase},retaliationMs,'target',1,'combat');hitSound(npc?.attack,retaliationMs,'target');frameSounds(scene.targetAttack,retaliationMs,'target');frameSounds(scene.playerBlock,retaliationImpactMs,'player');if(player?.hit)add({id:player.hit},retaliationImpactMs,'player',1,'combat');
 }
 const seen=new Set();return events.filter(event=>{const key=`${event.id}:${event.recipient}:${Math.round(event.timeMs/20)}`;if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>a.timeMs-b.timeMs).slice(0,512);
}
