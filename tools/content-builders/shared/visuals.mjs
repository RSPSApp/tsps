// Times are milliseconds. Zero duration uses the native graphic's natural length.
export const VISUAL_LIMIT = 24;
export function newVisual(id, patch = {}) {
    return {kind:'graphic',id,recipient:'target',phase:'impact',delayMs:0,speed:1,durationMs:0,loop:false,height:0,...patch};
}
export function validateVisuals(input) {
    if(input===undefined)return undefined;
    if(!Array.isArray(input)||input.length>VISUAL_LIMIT)throw new Error(`Use at most ${VISUAL_LIMIT} visual clips per effect.`);
    return input.map(c=>{
        const fail=()=>{throw new Error('Invalid visual clip. Choose a native ID, recipient and timing within 120 seconds.');};
        if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['kind','id','recipient','phase','delayMs','speed','durationMs','loop','height','nativeGraphic','nativeRecipient','nativeFeature','heightMode','hueShift'].includes(k)))fail();
        const num=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
        if(!['graphic','animation'].includes(c.kind)||!Number.isInteger(c.id)||!num(c.id,0,65534)||!['player','target','both'].includes(c.recipient)||!['launch','impact'].includes(c.phase)||!num(c.delayMs,0,119999)||!num(c.speed,.1,4)||!num(c.durationMs,0,120000)||c.delayMs+c.durationMs>120000||typeof c.loop!=='boolean'||!num(c.height,-256,512))fail();
        if(c.hueShift!==undefined&&(!num(c.hueShift,-180,180)||c.kind!=='graphic'))fail();
        if(c.nativeGraphic!==undefined&&(!Number.isInteger(c.nativeGraphic)||!num(c.nativeGraphic,0,65534)||!['player','target'].includes(c.nativeRecipient)))fail();
        if(c.nativeGraphic===undefined&&(c.nativeRecipient!==undefined||c.heightMode!==undefined))fail();
        if(c.nativeFeature!==undefined&&(c.nativeGraphic===undefined||typeof c.nativeFeature!=='string'||! /^[a-z][a-zA-Z0-9-]{0,47}$/.test(c.nativeFeature)))fail();
        if(c.heightMode!==undefined&&!['native','custom'].includes(c.heightMode))fail();
        if(c.kind==='animation'&&(c.speed!==1||c.durationMs!==0||c.loop||c.height!==0))throw new Error('Character animations use native speed and length. Speed, duration and looping apply to VFX.');
        if(c.loop&&c.durationMs===0)throw new Error('Give a looping VFX a duration.');
        return {...c};
    });
}
export function visualStart(clip, impactMs = 600) { return clip.delayMs+(clip.phase==='impact'?impactMs:0); }
export function visualDuration(clip, naturalMs = 1000) { return Math.min(120000-clip.delayMs,clip.durationMs || naturalMs/clip.speed); }
export function visualFrame(asset, clip, elapsedMs) {
    const frames=asset?.frames;if(!frames?.length)return null;
    const total=frames.reduce((n,f)=>n+f.duration,0),age=Math.max(0,elapsedMs)*clip.speed;
    let time=clip.loop?age%total:Math.min(age,Math.max(0,total-.001));
    for(const frame of frames){if(time<frame.duration)return frame;time-=frame.duration;}
    return frames.at(-1);
}
export const VISUAL_RECIPES = Object.freeze([
    {name:'Guthan’s leech',clips:[newVisual(398)]},
    {name:'Saradomin sweep',animation:7640,clips:[newVisual(1209,{recipient:'player',phase:'launch'})]},
    {name:'Armadyl sweep',animation:7644,clips:[newVisual(1211,{recipient:'player',phase:'launch'})]},
    {name:'Bandos sweep',animation:7642,clips:[newVisual(1212,{recipient:'player',phase:'launch'})]},
    {name:'Zamorak sweep + ice',animation:7638,clips:[newVisual(1210,{recipient:'player',phase:'launch'}),newVisual(369)]}
]);

/** Relative hue rotation. Preserves neutral colours, chroma, brightness and input ownership. */
export function shiftHueRgb(rgb,degrees=0){
    if(!degrees)return [...rgb];
    const high=Math.max(...rgb),low=Math.min(...rgb),chroma=high-low;if(chroma<1e-8)return [...rgb];
    let hue=high===rgb[0]?(rgb[1]-rgb[2])/chroma:high===rgb[1]?(rgb[2]-rgb[0])/chroma+2:(rgb[0]-rgb[1])/chroma+4;
    hue=((hue+degrees/60)%6+6)%6;const x=chroma*(1-Math.abs(hue%2-1));
    const out=hue<1?[chroma,x,0]:hue<2?[x,chroma,0]:hue<3?[0,chroma,x]:hue<4?[0,x,chroma]:hue<5?[x,0,chroma]:[chroma,0,x];
    return out.map(value=>value+low);
}
