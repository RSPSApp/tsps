import {visibleHitsplats,visibleStatuses} from '../shared/combat-preview.mjs';
const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const image=part=>{if(!part)return null;const canvas=document.createElement('canvas');canvas.width=part.width;canvas.height=part.height;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes(part.rgba)),part.width,part.height),0,0);return canvas;};
/** Native cache sprites and glyphs, with a small bounded cache for damage numbers. */
export function createCombatHitsplats(host,rows){
 const themes=new Map(rows.map(row=>[row.id,{...row,parts:Object.fromEntries(['left','left2','middle','right'].map(key=>[key,image(row[key])]))}])),numbers=new Map();
 function sprite(theme,damage){
  const key=`${theme.id}:${damage}`;if(numbers.has(key))return numbers.get(key);
  const glyphs=String(damage).split('').map(c=>theme.font.digits[Number(c)]),width=glyphs.reduce((n,g)=>n+g.advance,0),part=theme.parts;
  const tiled=part.left&&part.middle&&part.right,middle=tiled?Math.max(part.middle.width,Math.ceil((width+4)/part.middle.width)*part.middle.width):part.middle?.width??0;
  const w=tiled?part.left.width+middle+part.right.width:Math.max(width+8,...Object.values(part).filter(Boolean).map(p=>p.width)),h=Math.max(24,...Object.values(part).filter(Boolean).map(p=>p.height));
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  if(tiled){ctx.drawImage(part.left,0,0);for(let x=part.left.width;x<part.left.width+middle;x+=part.middle.width)ctx.drawImage(part.middle,x,0);ctx.drawImage(part.right,part.left.width+middle,0);}
  else {const bg=part.middle??part.left??part.right;if(bg)ctx.drawImage(bg,Math.floor((w-bg.width)/2),0);}
  if(part.left2)ctx.drawImage(part.left2,0,0);
  const colour=theme.textColor;let x=Math.floor((w-width)/2);const baseline=Math.floor(h/2)+theme.textOffsetY+4;
  for(const g of glyphs){const mask=bytes(g.mask),glyph=new ImageData(g.width,g.height);for(let i=0;i<mask.length;i++)if(mask[i]){glyph.data[i*4]=colour>>>16&255;glyph.data[i*4+1]=colour>>>8&255;glyph.data[i*4+2]=colour&255;glyph.data[i*4+3]=255;}const tile=document.createElement('canvas');tile.width=g.width;tile.height=g.height;tile.getContext('2d').putImageData(glyph,0,0);const y=baseline-theme.font.ascent+g.top;const shadow=document.createElement('canvas');shadow.width=g.width;shadow.height=g.height;const shadowCtx=shadow.getContext('2d');shadowCtx.drawImage(tile,0,0);shadowCtx.globalCompositeOperation='source-in';shadowCtx.fillStyle='#000';shadowCtx.fillRect(0,0,g.width,g.height);ctx.drawImage(shadow,x+g.left+1,y+1);ctx.drawImage(tile,x+g.left,y);x+=g.advance;}
  numbers.set(key,canvas);if(numbers.size>128)numbers.delete(numbers.keys().next().value);return canvas;
 }
 return {draw(preview,time,anchors){
  const nodes=[],scale=1.5;
  for(const who of ['player','target']){
   const anchor=anchors[who];if(!anchor)continue;
   for(const hit of visibleHitsplats(preview.hits.filter(h=>h.recipient===who),time,h=>themes.get(h.typeId)??{durationMs:1400,compareType:-1})){
    const theme=themes.get(hit.typeId);if(!theme?.font)continue;const asset=sprite(theme,hit.damage),canvas=document.createElement('canvas');canvas.width=asset.width;canvas.height=asset.height;canvas.getContext('2d').drawImage(asset,0,0);canvas.className='combat-hitsplat';canvas.dataset.damage=hit.damage;canvas.dataset.type=hit.type;canvas.dataset.slot=hit.slot;canvas.dataset.source=hit.source;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${hit.damage} ${hit.type==='max'?'maximum':hit.type} damage`);
    const progress=(time-hit.timeMs)/hit.lifetime;canvas.style.width=`${asset.width*scale}px`;canvas.style.height=`${asset.height*scale}px`;canvas.style.left=`${anchor.hit[0]+([0,0,-15,15][hit.slot]+theme.xOffset*progress)*scale}px`;canvas.style.top=`${anchor.hit[1]+([0,-20,-10,-10][hit.slot]-theme.yOffset*(1-progress))*scale}px`;
    if(theme.fadeStartMs>=0)canvas.style.opacity=Math.min(1,(hit.lifetime-(time-hit.timeMs))/(hit.lifetime-theme.fadeStartMs));nodes.push(canvas);
   }
   const statuses=visibleStatuses(preview.statuses.filter(s=>s.recipient===who),time);if(statuses.length){const group=document.createElement('div');group.className='combat-statuses';group.style.left=`${anchor.head[0]}px`;group.style.top=`${anchor.head[1]-14}px`;for(const status of statuses){const label=document.createElement('output');label.className='combat-status';label.dataset.status=status.label;label.textContent=`${status.label} · ${status.remainingMs===null?'until restored':`${(status.remainingMs/1000).toFixed(1)}s`}`;if(status.label==='Venomed')label.textContent='Venomed · until cured';if(status.previewOnly){label.title='Player-only effect. Shown here to preview its duration; it does not affect NPCs in game.';label.textContent+=' · players only';}group.append(label);}nodes.push(group);}
  }
  host.replaceChildren(...nodes);
 }};
}
