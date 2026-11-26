import {visualStart,visualDuration} from './visuals.mjs';

/** Read-only sequence display. Native feature cues have already resolved in previewClips. */
export function presentationSequence(clips,{previewClips=[],impactMs=600,naturalDuration=()=>1000}={}){
 const rows=clips.map((clip,index)=>{const resolved=previewClips.find(row=>row.previewIndex===index)??clip,start=visualStart(resolved,impactMs),length=visualDuration(clip,naturalDuration(clip));return {clip,index,start,length,end:start+length,overlaps:[],duplicates:[]};});
 const intersects=(a,b)=>a==='both'||b==='both'||a===b;
 const sameAppearance=(a,b)=>['id','recipient','heightMode'].every(key=>a[key]===b[key])&&['hueShift','height'].every(key=>(a[key]??0)===(b[key]??0))&&(a.speed??1)===(b.speed??1)&&!!a.loop===!!b.loop;
 for(const a of rows)for(const b of rows){if(a===b||a.clip.kind!==b.clip.kind||!intersects(a.clip.recipient,b.clip.recipient)||a.start>=b.end||b.start>=a.end)continue;a.overlaps.push(b.index);if(a.start===b.start&&a.length===b.length&&sameAppearance(a.clip,b.clip))a.duplicates.push(b.index);}
 return rows.sort((a,b)=>a.start-b.start||a.index-b.index);
}

/** The next clip keeps its trigger and placement, so it follows the original even on a delayed hit. */
export function nextVisualOptions(clip,naturalMs){
 const delayMs=Math.round(clip.delayMs+visualDuration(clip,naturalMs));
 if(delayMs>=120000)throw new Error('This sequence already reaches the 120-second limit. Shorten this clip before adding another after it.');
 return {recipient:clip.recipient,phase:clip.phase,delayMs,height:clip.height,...Object.fromEntries(['nativeFeature','nativeGraphic','nativeRecipient','heightMode'].filter(key=>clip[key]!==undefined).map(key=>[key,clip[key]]))};
}
