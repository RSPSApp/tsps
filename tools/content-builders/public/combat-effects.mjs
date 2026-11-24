import {presentationSequence,nextVisualOptions} from '../shared/presentation.mjs';
import {combatPreview,DAMAGE_PRESETS} from '../shared/combat-preview.mjs';
import {specialActivation,SPECIAL_ACTIVATIONS} from '../shared/special-activation.mjs';
import {createCombatHitsplats} from './combat-hitsplats.mjs';
import {createCombatAudio} from './combat-audio.mjs';
import {combatSoundTimeline} from '../shared/combat-audio.mjs';
import {mechanicHeader} from './combat-cards.mjs';
import {browseAttackFeatures} from './attack-feature-browser.mjs';
import {renderRecipeEffects,addRecipeEffect} from './attack-rules.mjs';
import {ATTACK_RULES} from '../shared/attack-rules.mjs';
import {ATTACK_FEATURES} from '../shared/attack-features.mjs';
import {gearPreviewSequence} from '/shared/gear-preview.mjs';
import {renderNativeMechanics} from './native-mechanics.mjs';
import {attackFeaturePreview,referenceFeatures,attackModifiers,mechanicPreview,materializeFeatureVisuals} from '../shared/native-mechanics.mjs';
import {EFFECT_ACTIONS,POLLED_TRIGGERS} from '../shared/effects.mjs';
import { NEUTRAL_SKIN_HSL } from '../shared/preview-scenes.mjs';
import { ATTACK_IDEAS, SET_IDEAS } from './effect-ideas.mjs';
import { newNativeSpecial, newSpecial, newPassive, materializeSpecial } from '../shared/effects.mjs';
import { effectReferenceLibrary } from './effect-reference-library.mjs';
import { createGearEffectsTab } from './gear-effects.mjs';
import {browseVisuals} from './visual-browser.mjs';
import {renderEffectTriggers,activationSummary} from './effect-triggers.mjs';
import { referencePicker } from './picker.mjs';
import { Viewport } from './viewport.mjs';
import { assemble, hslRgb } from '../shared/mesh.mjs';
import { fullSetRequirement, equippedItems, equippedParts } from '../shared/gear-set.mjs';
import { newVisual, VISUAL_LIMIT, visualStart, visualDuration, visualFrame } from '../shared/visuals.mjs';

/** Dedicated authoring stage. Test enemies and camera/playback state stay out of exports. */
export function createCombatEffectsEditor(ctx) {
    const {state,element:el,button}=ctx,mechanics=createGearEffectsTab({...ctx,compactEffects:true,chooseMovement:(value,set)=>chooseAsset('animation','player',value,set),chooseGraphic:(value,set)=>chooseAsset('graphic','player',value,set),previewEffect:()=>prepare(true),stopEffectPreview:()=>{serial++;ui.loading=false;ui.playAfterLoad=false;ui.playing=false;audio.stop();ui.time=0;preparedKey='';if(playButton){playButton.disabled=false;playButton.textContent='Play preview';}draw();}});
    const root=el('section',{class:'combat-workspace','aria-label':'Combat effects workspace',hidden:true});
    document.querySelector('main').append(root);
    const canvas=el('canvas',{'aria-label':'Combat preview. Drag to orbit, shift-drag to pan, scroll to zoom.',tabIndex:0});
    const view=new Viewport(canvas);view.skinOverlay=true;view.skinPreviewColour=hslRgb(NEUTRAL_SKIN_HSL);view.gizmo=false;view.outline=false;view.background='#34383e';view.gridColour='#484d54';
    const ui={presentation:'effects',autoPlay:false,playAfterLoad:false,gender:null,names:new Map(),enemy:null,recommended:[],clip:0,sounds:true,volume:65,damagePreset:'true',retaliate:true,loop:true,playing:false,time:0,impactMs:600,rate:1,loading:false};
    let identity='',serial=0,scene=null,last=0,clock,seek,playButton,preparedKey='',errorBox,hitsplatView;
    const widths={left:330,right:350},disclosures=new Map();try{const saved=JSON.parse(localStorage.getItem('content-builders:combat-panels'));for(const key of ['left','right'])if(Number.isFinite(saved?.[key]))widths[key]=Math.max(260,Math.min(600,saved[key]));}catch{}
    const cache=new Map(),featureCues=new Map(),audioIssues=new Set();
    const audio=createCombatAudio({load:async(id,loops)=>{const response=await fetch(`/api/sound?id=${id}&loops=${loops}`);if(!response.ok)throw new Error('Sample unavailable');return response.arrayBuffer();},onError:error=>{audioIssues.add(error.message);const status=root.querySelector('.combat-audio-status');if(status){status.textContent=`${audioIssues.size} unavailable sound${audioIssues.size===1?'':'s'}`;status.title=[...audioIssues].join('\n');}}});
    root.addEventListener('click',()=>{if(ui.sounds)void audio.unlock();},{capture:true});
    const mode=()=>state.mode==='special'?'special':'passive';
    const rule=()=>mechanics.selectedRule(mode());
    const isSelf=()=>mode()==='special'&&rule()&&specialActivation(rule())==='self';
    const impact=()=>isSelf()?0:ui.impactMs;
    const active=()=>['special','set-effects'].includes(state.mode)&&state.project?.kind==='gear';
    const note=(parent,text)=>parent.append(el('p',{class:'effects-note',text}));
    function report(message){if(errorBox)errorBox.textContent=message;ctx.status(message,true);}
    const run=fn=>async()=>{try{await fn();}catch(error){report(error.message);}};
    function field(parent,label,value,fn,{min=0,max=30000,step=1,type='number',options}={}){
        const input=options?el('select',{'aria-label':label},...options.map(([id,name])=>el('option',{value:id,text:name,selected:String(id)===String(value)}))):el('input',{type,value,min,max,step,maxLength:80,'aria-label':label});
        input.onchange=run(()=>{let v=options?input.value:type==='checkbox'?input.checked:type==='text'?input.value.trim():Number(input.value);if(!options&&type==='number'&&(!input.value.trim()||!Number.isFinite(v)||v<min||v>max)){input.setCustomValidity(`Enter a value from ${min} to ${max}.`);input.reportValidity();return;}input.setCustomValidity('');fn(v);});
        if(type==='checkbox')input.checked=value;
        parent.append(el('label',{},label,input));return input;
    }
    function edit(fn){ui.autoPlay=ui.autoPlay||ui.playing||ui.loading&&ui.playAfterLoad;ui.playing=false;audio.stop();mechanics.updateVisuals(mode(),fn);}
    function patch(fn){const index=ui.clip;edit(rule=>fn(rule.visuals[index]));}
    function add(clip){const length=rule()?.visuals?.length??0;if(length>=VISUAL_LIMIT)throw new Error(`Use at most ${VISUAL_LIMIT} clips.`);ui.clip=length;edit(rule=>(rule.visuals??=[]).push(clip));}
    function chooseAsset(kind,recipient,value,set,options={}){
        const project=state.project,selected=rule()?.id??'special',enemy=ui.enemy,actor=isSelf()||recipient==='player'||enemy==='dummy'?'player':'npc',wasPlaying=ui.playing;let applied=false;ui.playing=false;audio.stop();ui.playAfterLoad=false;if(playButton)playButton.textContent='Resume';
        return browseVisuals(ctx,{kind,actor,npcId:typeof enemy==='number'?enemy:-1,gender:ui.gender??(state.variant==='female'?'female':'male'),value,...options,onClose:()=>{if(!applied&&state.project===project&&active()){ui.playing=wasPlaying;last=performance.now();if(playButton)playButton.textContent=wasPlaying?'Pause':'Play preview';if(wasPlaying)syncAudio();}},onChoose:(id,row,settings)=>{if(ui.sounds)void audio.unlock();applied=true;if(state.project!==project||(rule()?.id??'special')!==selected)return;ui.names.set(`${kind}:${id}`,row.name);ui.autoPlay=true;set(id,row,settings);}});
    }
    function resizeHandle(side,layout){
        const handle=el('div',{class:'combat-resizer',role:'separator',tabIndex:0,'aria-label':`Resize ${side==='left'?'behaviour':'visual sequence'} panel`,'aria-orientation':'vertical','aria-valuemin':260,'aria-valuemax':600,'aria-valuenow':widths[side]});
        function apply(value){const other=layout.querySelector(side==='left'?'.combat-visuals':'.combat-behaviour').getBoundingClientRect().width,max=Math.min(600,Math.max(260,layout.clientWidth-other-316));widths[side]=Math.max(260,Math.min(max,Math.round(value)));layout.style.setProperty(`--${side}-width`,`${widths[side]}px`);handle.setAttribute('aria-valuenow',widths[side]);try{localStorage.setItem('content-builders:combat-panels',JSON.stringify(widths));}catch{}}
        handle.onpointerdown=event=>{event.preventDefault();handle.setPointerCapture(event.pointerId);const start=event.clientX,value=widths[side];handle.onpointermove=e=>apply(value+(e.clientX-start)*(side==='left'?1:-1));handle.onpointerup=handle.onpointercancel=()=>handle.onpointermove=null;};
        handle.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home'].includes(event.key)){event.preventDefault();apply(event.key==='Home'?(side==='left'?330:350):widths[side]+(event.key==='ArrowRight'?20:-20)*(side==='left'?1:-1));}};handle.ondblclick=()=>apply(side==='left'?330:350);return handle;
    }
    function fetchAsset(key,fn){if(!cache.has(key)){cache.set(key,Promise.resolve().then(fn).catch(error=>{cache.delete(key);throw error;}));while(cache.size>20)cache.delete(cache.keys().next().value);}return cache.get(key);}
    async function bounded(jobs){const results=new Array(jobs.length);let next=0;await Promise.all([0,1].map(async()=>{while(next<jobs.length){const index=next++;results[index]=await jobs[index]();}}));return results;}
    const friendlyName=(id,name)=>({398:'Healing leech',369:'Ice burst',1209:'Saradomin light sweep',1210:'Zamorak red sweep',1211:'Armadyl golden sweep',1212:'Bandos green sweep',1292:'Twin-strike flash'}[id]??name);
    const natural=asset=>asset?.frames?.reduce((n,f)=>n+f.duration,0)??1000;
    const meshAt=(asset,clip,age)=>{const f=visualFrame(asset,clip,age);return f?{...asset.mesh,vertices:f.vertices,...(f.alpha?.length?{alpha:f.alpha}:{})}:asset.mesh;};
    function positioned(mesh,who,height=0){const x=scene?.preview?.selfCast?0:who==='player'?-160:160,sign=who==='player'?-1:1;return {...mesh,vertices:mesh.vertices.map(([a,b,c])=>[x+c*sign,b-height,-a*sign])};}
    const assetLength=c=>Math.max(...(c.recipient==='both'?['player','target']:[c.recipient]).map(who=>natural(scene?.assets.get(`${c.kind}:${c.id}:${c.kind==='graphic'?c.recipient:who}`))));
    function projectileMesh(mesh,clip,age){const travel=clip.previewTravel,t=Math.max(0,Math.min(1,age/clip.durationMs)),height=4*(travel.startHeight+(travel.endHeight-travel.startHeight)*t)+Math.sin(t*Math.PI)*travel.angle/255*120,placed=positioned(mesh,'player',height);return {...placed,vertices:placed.vertices.map(([x,y,z])=>[x+(scene.preview?.selfCast?0:320*t),y,z])};}
    function updateDamage(){
        if(!scene||!rule())return;
        scene.preview=combatPreview(scene.weapon??state.project,rule(),{preset:ui.damagePreset,impactMs:impact(),special:mode()==='special',references:scene.references,targetIsPlayer:scene.enemy.id==='dummy',ammoStrength:scene.ammunition?.strength??0,ammoName:scene.ammunition?.name??''});
        const summary=root.querySelector('.combat-damage-summary');if(summary){const p=scene.preview,values=p.primaryMaxima;summary.textContent=p.selfCast?'Self-cast · no attack roll':`${DAMAGE_PRESETS[ui.damagePreset].name} · ${values.length?values.join(' + ')+' = '+values.reduce((a,b)=>a+b,0)+' primary damage':'No primary hit'} · level ${p.stats.level}${scene.ammunition&&rule().style==='ranged'?' · '+scene.ammunition.name+' (+'+scene.ammunition.strength+' Ranged Strength)':''}`;summary.title=p.assumptions.join('\n');}
        if(seek)seek.max=duration();
    }
    function drawHitsplats(){
        if(!scene?.preview||!hitsplatView)return;
        const anchors={};for(const item of view.items){if(!['player','target'].includes(item.id))continue;const v=item.mesh.vertices,lo=Math.min(...v.map(p=>p[1])),hi=Math.max(...v.map(p=>p[1])),x=v.reduce((n,p)=>n+p[0],0)/v.length,z=v.reduce((n,p)=>n+p[2],0)/v.length;anchors[item.id]={hit:view.project([x,lo+(hi-lo)*.38,z]),head:view.project([x,lo,z])};}
        hitsplatView.draw(scene.preview,ui.time,anchors);
    }
    const nativeDraw=view.draw.bind(view);view.draw=(...args)=>{nativeDraw(...args);drawHitsplats();};
    function duration(){return scene?Math.max(2000,scene.preview?.endMs??0,mode()==='special'?natural(scene.player):0,...(scene.events??[]).filter(event=>event.damage===undefined).map(event=>impact()+event.delayMs+900),...(scene.responses??[]).map(row=>row.start+natural(row.asset)),...scene.clips.map(c=>visualStart(c,impact())+visualDuration(c,assetLength(c))))+400:3000;}
    function syncAudio(){
        if(!scene)return;
        scene.soundEvents=combatSoundTimeline(rule(),scene,{impactMs:impact(),retaliate:ui.retaliate&&!isSelf(),retaliationMs:ui.impactMs+1000,retaliationImpactMs:ui.impactMs+1600,durationMs:duration()});
        if(ui.playing&&ui.sounds)void audio.start(scene.soundEvents,ui.time,ui.rate);else audio.stop();
    }
    function draw(){
        if(!scene)return;
        const t=ui.time,clips=scene.clips,items=[];
        for(const who of scene.preview?.selfCast?['player']:['player','target']){
            let asset=scene[who],age=t,play={speed:1,loop:who==='target'||mode()==='passive'||scene.idlePlayer};
            const response=(scene.responses??[]).filter(row=>row.recipient===who&&t>=row.start&&t<row.start+natural(row.asset)).at(-1);if(response){asset=response.asset;age=t-response.start;play={speed:1,loop:false};}
            const overrides=clips.filter(c=>c.kind==='animation'&&(scene.preview?.selfCast||c.recipient===who||c.recipient==='both')&&t>=visualStart(c,impact())).sort((a,b)=>visualStart(b,impact())-visualStart(a,impact()));
            for(const c of overrides){const candidate=scene.assets.get(`animation:${c.id}:${who}`)??(scene.preview?.selfCast?scene.assets.get(`animation:${c.id}:target`):null);if(candidate&&t-visualStart(c,impact())<natural(candidate)){asset=candidate;age=t-visualStart(c,impact());play=c;break;}}
            items.push({id:who,mesh:positioned(meshAt(asset,play,age),who),...(who==='target'&&scene.enemy.id==='dummy'?{reference:true,opacity:.4}:{})});
        }
        clips.forEach((c,index)=>{if(c.kind!=='graphic')return;const asset=scene.assets.get(`graphic:${c.id}:${c.recipient}`);if(!asset)return;const age=t-visualStart(c,impact());if(age<0||age>=visualDuration(c,asset.duration))return;for(const who of scene.preview?.selfCast?['player']:c.recipient==='both'?['player','target']:[c.recipient])items.push({id:`vfx-${index}-${who}`,hueShift:c.hueShift??0,mesh:c.previewTravel?projectileMesh(meshAt(asset,c,age),c,age):positioned(meshAt(asset,c,age),who,c.height)});});
        view.setItems(items);if(clock)clock.textContent=`${(t/1000).toFixed(2)} / ${(duration()/1000).toFixed(2)} s`;if(seek)seek.value=t;
        drawHitsplats();
    }
    async function prepare(play=false){
        if(!rule()||ui.enemy===null)return;
        audio.stop();audioIssues.clear();
        const ticket=++serial,p=state.project,snapshot=JSON.stringify(ctx.currentDocument()),selectedRule=structuredClone(rule()),kind=mode(),gender=ui.gender??(state.variant==='female'?'female':'male');
        ui.loading=true;ui.playAfterLoad=play;ui.playing=false;if(playButton){playButton.disabled=true;playButton.textContent='Loading…';}if(errorBox)errorBox.textContent='';
        try{
            const members=state.gearSet?equippedItems(ctx.currentDocument(),state.setEquipment,p.id):[p],parts=state.gearSet?equippedParts(ctx.currentDocument(),state.setEquipment,p.id):p.parts;
            const selfCast=isSelf(),previewWeapon=members.find(item=>item.settings.equipmentType==='WEAPON')??p;
            const [body,enemy,themes,ammo]=await Promise.all([ctx.api(`mannequin?gender=${gender}&style=character&slots=${encodeURIComponent(members.map(item=>item.settings.equipmentType).join(','))}`),(selfCast||ui.enemy==='dummy')?ctx.api(`mannequin?gender=${gender}&style=dummy&slot=NONE`).then(row=>({...row,mesh:{...row.mesh,faces:row.mesh.faces.map(f=>[f[0],f[1],f[2],110])},id:'dummy',fields:{idleSeqId:-1},combat:{anims:{attack:422}}})):fetchAsset(`npc:${ui.enemy}`,()=>ctx.api(`source?kind=npc&id=${ui.enemy}&variant=body`)),fetchAsset('hitsplat-themes',()=>ctx.api('hitsplat-themes')),fetchAsset(`preview-ammo:${previewWeapon.baseId}`,()=>ctx.api(`preview-ammunition?weaponId=${previewWeapon.baseId}`))]);
            if(ticket!==serial||!active())return;
            const player=assemble([...parts,{id:'combat-body',variant:gender,visible:true,mesh:body.mesh}],gender);
            const sourceIds=[...new Set([selectedRule.nativeFrom,...(selectedRule.nativeFeatures??[]).map(feature=>feature.source)].filter(id=>id!==undefined))];
            const references=kind==='special'?await Promise.all(sourceIds.map(id=>fetchAsset(`native:${id}`,()=>ctx.api(`special-donors?q=${id}`)).then(result=>result.rows.find(row=>row.id===id)))):[];
            if(references.some(reference=>!reference))throw new Error('An attack feature source is unavailable.');
            const {clips,events}=kind==='special'?attackFeaturePreview(selectedRule,references):{clips:(selectedRule.visuals??[]).map((clip,previewIndex)=>({...structuredClone(clip),previewIndex})),events:[]};
            if(kind==='special'&&selectedRule.graphic>=0)clips.unshift(newVisual(selectedRule.graphic,{recipient:'player',phase:'launch'}));
            const weapon=members.find(item=>item.settings.equipmentType==='WEAPON'),sequence=kind==='special'?(selectedRule.animation>=0?selectedRule.animation:gearPreviewSequence(p,'idle',weapon)):gearPreviewSequence(p,!['damage','accurate','attack','kill'].includes(selectedRule.trigger)?'idle':'attack',weapon);
            if(sequence>=0){const choices=await fetchAsset(`player-sequence:${sequence}`,()=>ctx.api(`character-animations?actor=player&q=${sequence}`));if(!choices.rows.some(row=>row.id===sequence))throw new Error(`Movement ${sequence} is not a compatible player animation. Replace it with Browse player movements.`);ui.names.set(`animation:${sequence}`,choices.rows.find(row=>row.id===sequence).name);}
            const animate=async(mesh,id)=>id>=0?ctx.api('animate',{mesh,sequence:id,samples:Math.max(1,Math.min(48,Math.floor(260000/mesh.vertices.length)))}):{mesh,frames:[{duration:1000,vertices:mesh.vertices}]};
            const weaponId=weapon?.baseId??p.baseId;
            const [actor,target,audioInfo]=await Promise.all([animate(player,sequence),animate(enemy.mesh,enemy.fields.idleSeqId),fetchAsset(`combat-audio:${enemy.id}:${weaponId}`,()=>ctx.api(`combat-audio?npcId=${enemy.id==='dummy'?-1:enemy.id}&weaponId=${weaponId}`))]);
            const [targetBlock,targetAttack,playerBlock]=await Promise.all([enemy.id==='dummy'?animate(enemy.mesh,424):!(enemy.combat.anims?.block>=0)?null:animate(enemy.mesh,enemy.combat.anims.block),enemy.id==='dummy'||!(enemy.combat.anims?.attack>=0)?null:animate(enemy.mesh,enemy.combat.anims.attack),ui.retaliate&&enemy.id!=='dummy'?animate(player,gearPreviewSequence(p,'block',weapon)):null]);
            if(ticket!==serial||!active())return;if(enemy.id==='dummy')audioInfo.npc.hit=[[audioInfo.player.hit,0]];
            const assets=new Map(),jobs=[];
            for(const c of clips){
                if(c.kind==='graphic'){const key=`graphic:${c.id}:${c.recipient}`;if(assets.has(key))continue;assets.set(key,null);jobs.push(async()=>assets.set(key,await fetchAsset(`effect:${c.id}`,()=>ctx.api(`visual-effect?id=${c.id}`))));}
                else for(const who of c.recipient==='both'?['player','target']:[c.recipient]){const key=`animation:${c.id}:${who}`;if(assets.has(key))continue;assets.set(key,null);jobs.push(async()=>{const actor=who==='player'||selfCast||enemy.id==='dummy'?'player':'npc',choices=await fetchAsset(`movement:${actor}:${enemy.id}:${c.id}`,()=>ctx.api(`character-animations?actor=${actor}&npcId=${enemy.id==='dummy'?-1:enemy.id}&q=${c.id}`));if(!choices.rows.some(row=>row.id===c.id))throw new Error(`Movement ${c.id} is incompatible with ${who==='player'?'the player':'this opponent'}. Use Browse movements to replace it.`);ui.names.set(`animation:${c.id}`,choices.rows[0].name);assets.set(key,await animate(who==='player'||selfCast?player:enemy.mesh,c.id));});}
            }
            await bounded(jobs);
            if(ticket!==serial||!active()||state.project!==p||JSON.stringify(ctx.currentDocument())!==snapshot)return;
            const values=[actor,target,targetBlock,targetAttack,playerBlock,...assets.values()].filter(Boolean);if(values.reduce((n,a)=>n+a.frames.reduce((n,f)=>n+f.vertices.length,0),0)>3500000)throw new Error('This preview is too large. Use fewer distinct clips or a smaller test enemy.');
            const refit=!scene||scene.enemy.id!==enemy.id||scene.gender!==gender||scene.preview?.selfCast!==selfCast;scene={idlePlayer:kind==='special'&&selectedRule.animation<0,player:actor,target,clips,assets,enemy,gender,events,references,weapon:previewWeapon,ammunition:ammo.ammunition,themes:themes.rows,audioInfo:structuredClone(audioInfo),targetBlock,targetAttack,playerBlock,responses:[]};if(targetBlock&&!selfCast)for(const delay of selectedRule.hitDelayTicks??[0])scene.responses.push({recipient:'target',asset:targetBlock,start:ui.impactMs+delay*600});if(ui.retaliate&&!selfCast&&enemy.id!=='dummy'){if(targetAttack)scene.responses.push({recipient:'target',asset:targetAttack,start:ui.impactMs+1000});if(playerBlock)scene.responses.push({recipient:'player',asset:playerBlock,start:ui.impactMs+1600});}scene.responses.sort((a,b)=>a.start-b.start);updateDamage();scene.soundEvents=combatSoundTimeline(selectedRule,scene,{impactMs:impact(),retaliate:ui.retaliate&&!isSelf(),retaliationMs:ui.impactMs+1000,retaliationImpactMs:ui.impactMs+1600,durationMs:duration()});if(ui.playAfterLoad&&ui.sounds)await audio.prepare(scene.soundEvents);if(ticket!==serial||!active())return;const overlay=root.querySelector('.combat-damage-overlay');if(overlay)hitsplatView=createCombatHitsplats(overlay,themes.rows);updateDamage();root.querySelector('.combat-stage-empty')?.setAttribute('hidden','');for(const [key,asset] of assets)if(key.startsWith('graphic:')&&asset.name)ui.names.set(`graphic:${asset.id}`,friendlyName(asset.id,asset.name));root.querySelectorAll('[data-clip-index]').forEach(li=>{const c=rule()?.visuals?.[Number(li.dataset.clipIndex)],name=c&&ui.names.get(`${c.kind}:${c.id}`);if(name)li.querySelector('strong').textContent=c.nativeFeature&&featureCues.has(c.nativeFeature)?`${featureCues.get(c.nativeFeature).name} VFX`:name;});ui.time=0;ui.playing=ui.playAfterLoad;last=performance.now();if(ui.playing&&ui.sounds)void audio.start(scene.soundEvents,0,ui.rate);draw();if(refit)view.fit();if(seek)seek.max=duration();
            refreshSequence();const timing=root.querySelector('.combat-vfx-timing'),selected=rule()?.visuals?.[ui.clip];if(timing&&selected)timing.textContent=timingDescription(selected);
            if(play)ctx.status('Preview ready. Drag to orbit; scrub to inspect each effect. Set effects preview a successful activation.');
        }catch(error){if(ticket===serial)report(error.message);}
        finally{if(ticket===serial){ui.loading=false;if(playButton){playButton.disabled=false;playButton.textContent=ui.playing?'Pause':'Play preview';}}}
    }
    let queueThumbnails=[],lastThumbnailPaint=0,thumbnailCursor=0;
    function paintQueueThumbnails(now){
        if(!scene||now-lastThumbnailPaint<120)return;lastThumbnailPaint=now;
        const panel=root.querySelector('.combat-visuals')?.getBoundingClientRect();if(!panel)return;
        const visible=queueThumbnails.filter(row=>{if(!row.canvas.isConnected)return false;const box=row.canvas.getBoundingClientRect();return box.bottom>=panel.top&&box.top<=panel.bottom;});
        const deadline=performance.now()+6;
        for(let n=0;n<Math.min(3,visible.length);n++){const row=visible[thumbnailCursor++%visible.length],c=row.clip,asset=scene.assets.get(`${c.kind}:${c.id}:${c.recipient}`);if(!asset)continue;
            if(!row.view){row.view=new Viewport(row.canvas,{passive:true});row.view.background='#30363c';row.view.grid=false;row.view.outline=false;row.view.gizmo=false;row.view.setItems([{id:'reference',mesh:c.kind==='graphic'?scene.player.mesh:asset.mesh}]);row.view.fit();}
            row.view.setItems(c.kind==='graphic'?[{id:'reference',mesh:scene.player.mesh,reference:true,opacity:.4},{id:'effect',mesh:meshAt(asset,{speed:c.speed,loop:true},now),hueShift:c.hueShift??0}]:[{id:'movement',mesh:meshAt(asset,{speed:1,loop:true},now)}]);row.view.draw(now);if(performance.now()>deadline)break;
        }
    }
    function tick(now){const delta=Math.min(100,Math.max(0,now-last));last=now;if(active()&&root.isConnected&&ui.playing&&scene){ui.time+=delta*ui.rate;if(ui.time>=duration()){if(ui.loop){ui.time%=duration();syncAudio();}else{ui.time=duration();ui.playing=false;audio.stop();if(playButton)playButton.textContent='Play preview';}}draw();}if(active())paintQueueThumbnails(now);requestAnimationFrame(tick);}
    requestAnimationFrame(tick);
    canvas.addEventListener('keydown',event=>{if(!active())return;if(event.code==='Space'){event.preventDefault();playButton?.click();}else if(['ArrowLeft','ArrowRight','Home'].includes(event.key)&&scene){event.preventDefault();ui.playing=false;audio.stop();ui.time=event.key==='Home'?0:Math.max(0,Math.min(duration(),ui.time+(event.key==='ArrowRight'?50:-50)));playButton.textContent='Resume';draw();}});

    function addSetIdea(value){
        const chooser=root.querySelector('.combat-idea-chooser');if(chooser)chooser.open=false;
        if(state.gearSet)value.set=fullSetRequirement(state.gearSet,state.project.id);
        mechanics.createPassive(value);
    }
    async function chooseIdea(idea){
        const chooser=root.querySelector('.combat-idea-chooser');if(chooser)chooser.open=false;
        const project=state.project,selectedMode=mode(),ticket=++serial;ui.autoPlay=true;ui.clip=0;
        if(idea.native){const result=await ctx.api(`special-donors?q=${encodeURIComponent(idea.native)}`),row=result.rows.find(row=>row.specialName===idea.native);if(ticket!==serial||state.project!==project||mode()!==selectedMode)return;if(!row)throw new Error('This game attack is not available in this cache. Choose another reference.');mechanics.useSpecial(newNativeSpecial(row));}
        else if(mode()==='special')mechanics.useSpecial(idea.make());else addSetIdea(idea.make());
    }
    function renderSimpleBehaviour(parent){
        const current=rule();
        if(mode()==='special'){
            const starting=el('section',{class:'combat-starting-weapon'},el('h3',{text:'Starting weapon'}));parent.append(starting);
            note(starting,'Choose a weapon to copy its special attack into editable effects, movement and VFX.');
            starting.append(button('Create an attack',()=>{ui.presentation='effects';mechanics.useSpecial(newSpecial());}));
        }else{
            const chooser=el('details',{class:'combat-idea-chooser',open:!current},el('summary',{text:current?'Add another effect':'Choose a starting point'})),cards=el('div',{class:'combat-ideas'});parent.append(chooser);chooser.append(cards);
            for(const idea of SET_IDEAS)cards.append(button('',()=>chooseIdea(idea),{class:'combat-idea',title:idea.description}));
            [...cards.children].forEach((card,index)=>card.append(el('strong',{text:SET_IDEAS[index].name}),el('small',{text:SET_IDEAS[index].description})));
        }
        if(!current){if(mode()!=='special')parent.append(button('Create a set bonus',()=>addSetIdea(newPassive())));return;}
        const quick=el('div',{class:'combat-simple-settings'});parent.append(quick);
        if(mode()!=='special'&&state.project.effects.passives.length>1)field(quick,'Your set effects',current.id,id=>mechanics.selectPassive(state.project.effects.passives.findIndex(p=>p.id===id)),{options:state.project.effects.passives.map(p=>[p.id,p.name])});
        field(quick,mode()==='special'?'Attack name':'Effect name',current.name,v=>edit(r=>r.name=v),{type:'text'});
        if(mode()==='special'){
            const native=current.nativeFrom!==undefined;
            const activation=field(quick,'Activation type',specialActivation(current),v=>edit(r=>r.activation=v),{options:Object.entries(SPECIAL_ACTIVATIONS)});activation.required=true;
            note(quick,'Activation controls reach and targeting. Damage calculation below controls the combat formula.');
            field(quick,'Damage calculation',current.style,v=>edit(r=>{if(v==='magic'&&!r.recipe){r.recipe=true;r.ruleFeatures=[{id:'rule-hits',type:'hitCount',value:r.hitCount},{id:'rule-delays',type:'hitDelayTicks',value:r.hitDelayTicks}];r.extraFeatures=[];}r.style=v;if(v!=='melee')r.defence='style';}),{options:[['melee','Melee'],['ranged','Ranged'],['magic','Magic']]});
            field(quick,'Energy cost (%)',current.energy,v=>edit(r=>r.energy=v),{min:native||current.recipe?0:1,max:100});
            const sequence=el('section',{class:'combat-attack-sequence'});parent.append(sequence);
            const hitRules=el('details',{class:'combat-rule-section',open:true,'data-workspace-section':'special:hit-rules'},el('summary',{text:'Hit rules'})),gameplay=el('details',{class:'combat-rule-section',open:true,'data-workspace-section':'special:gameplay'},el('summary',{text:'Additional effects'})),requirements=el('details',{class:'combat-rule-section','data-workspace-section':'special:requirements'},el('summary',{text:'Requirements'}));sequence.append(hitRules,gameplay,requirements);for(const [host,category,title] of [[hitRules,'Hit rules','Add hit rule'],[gameplay,'Gameplay effects','Add gameplay effect'],[requirements,'Requirements','Add requirement']])host.append(button(title,run(()=>openFeatures(current,category,title)),{class:'combat-section-add'}));
            const modifiers=attackModifiers(current),editModifiers=(type,fn)=>edit(r=>{r.modifiers??=structuredClone(modifiers);fn(r.modifiers);if(native&&!r.nativeOverrides.includes(type))r.nativeOverrides.push(type);});
            modifiers.forEach((modifier,index)=>{const card=el('section',{class:'combat-mechanic combat-modifier'}),title=modifier.type==='damage'?'Damage modifier':'Accuracy modifier';hitRules.append(card);card.append(mechanicHeader(ctx,title,'Initial hit',[button('Remove',()=>editModifiers(modifier.type,rows=>rows.splice(index,1)),{'aria-label':`Remove ${title}`})]));field(card,modifier.type==='damage'?'Damage multiplier':'Accuracy multiplier',modifier.multiplier,v=>editModifiers(modifier.type,rows=>rows[index].multiplier=v),{min:.1,max:5,step:.05});note(card,modifier.type==='damage'?`${modifier.multiplier>=1?'+':''}${Math.round((modifier.multiplier-1)*100)}% damage. Stages apply in order; hit rules control rounding.`:`${modifier.multiplier>=1?'+':''}${Math.round((modifier.multiplier-1)*100)}% accuracy.`);});
            if(native){
                const source=el('p',{class:'combat-template-source',text:'Loading reference…'});quick.prepend(source);
                fetchAsset(`native:${current.nativeFrom}`,()=>ctx.api(`special-donors?q=${current.nativeFrom}`)).then(result=>{if(!source.isConnected)return;const reference=result.rows.find(row=>row.id===current.nativeFrom);if(!reference)throw new Error('The native attack reference is unavailable.');if(!current.recipe&&reference.recipe&&rule()?.nativeFrom===current.nativeFrom&&!rule()?.recipe){mechanics.useSpecial(materializeSpecial(current,reference));return;}source.textContent=`${current.recipe?'Recipe copied from':'Based on'} ${reference.name}`;}).catch(error=>{if(source.isConnected)source.textContent=error.message;});
            }
            const featureHost=el('div',{class:'combat-feature-blocks'});gameplay.append(featureHost);renderAttackFeatures(featureHost,current);
            if(current.recipe)for(const [host,section] of [[hitRules,'rolls'],[gameplay,'gameplay'],[requirements,'requirements']])renderRecipeEffects(ctx,host,current,edit,{section});
            mechanics.renderActions(gameplay,'special');
            if(!current.actions.length&&!current.nativeFeatures?.length&&!current.extraFeatures?.some(row=>!['condition','ammunition','projectile','sound'].includes(row.type)))note(gameplay,'Add recovery, stat changes, follow-up damage or other gameplay effects.');
            if(!current.extraFeatures?.some(row=>['condition','ammunition'].includes(row.type)))note(requirements,'No additional activation requirements.');
        }else{
            renderEffectTriggers(ctx,quick,current,fn=>edit(fn));
            const members=current.set?.pieces.length??0;
            note(quick,members?`Requires ${current.set.required} of ${members} equipment slots.`:'Active while this item is equipped.');
            if(state.gearSet&&current.set)field(quick,'Required set pieces',current.set.required,v=>edit(r=>r.set.required=v),{min:1,max:current.set.pieces.length});
        }
    }
    function renderAttackFeatures(parent,current){
        const host=el('div',{class:'combat-native-mechanics'});parent.append(host);
        const getReference=id=>fetchAsset(`native:${id}`,()=>ctx.api(`special-donors?q=${id}`)).then(result=>result.rows.find(row=>row.id===id));
        (async()=>{
            const base=current.nativeFrom===undefined?null:await getReference(current.nativeFrom);
            const features=current.nativeFeatures??referenceFeatures(base??{}).map(feature=>({...feature,values:current.nativeMechanics?.[feature.mechanic]??{}}));
            const references=await Promise.all(features.map(feature=>getReference(feature.source)));
            if(!host.isConnected)return;
            featureCues.clear();features.forEach((feature,i)=>{const group=references[i]?.mechanics?.find(g=>g.id===feature.mechanic);if(group?.preview)featureCues.set(feature.id,{...group.preview,name:group.name});});for(const extra of current.extraFeatures??[])if(extra.type==='next-flames')featureCues.set(extra.id,{graphic:extra.values.graphic,recipient:'target',name:ATTACK_FEATURES[extra.type].name});
            if(current.recipe&&!current.explicitVisuals){mechanics.useSpecial(materializeFeatureVisuals(current,[base,...references].filter(Boolean)));return;}
            const save=fn=>edit(r=>{r.nativeFeatures??=structuredClone(features);delete r.nativeMechanics;fn(r.nativeFeatures);const ids=new Set([...r.nativeFeatures.map(row=>row.id),...(r.extraFeatures??[]).map(row=>row.id)]);r.visuals=(r.visuals??[]).filter(clip=>{
                if(clip.nativeFeature){if(ids.has(clip.nativeFeature))return true;const i=features.findIndex(row=>row.id===clip.nativeFeature),f=features[i],g=references[i]?.mechanics?.find(g=>g.id===f?.mechanic),event=g&&mechanicPreview([g],{[g.id]:f.values})[0];clip.delayMs=Math.min(119999,120000-clip.durationMs,clip.delayMs+(event?.delayMs??0));clip.phase='impact';delete clip.nativeFeature;delete clip.nativeGraphic;delete clip.nativeRecipient;delete clip.heightMode;return true;}
                const uses=(feature,index)=>{const group=references[index]?.mechanics?.find(group=>group.id===feature.mechanic);return group?.preview?.graphic===clip.nativeGraphic&&(group.preview.recipient??'target')===clip.nativeRecipient;};
                return !features.some(uses)||features.some((feature,index)=>ids.has(feature.id)&&uses(feature,index));
            });if(r.disabledFeatureVisuals)r.disabledFeatureVisuals=r.disabledFeatureVisuals.filter(id=>ids.has(id));});
            features.forEach((feature,index)=>{
                const reference=references[index],group=reference?.mechanics?.find(group=>group.id===feature.mechanic);if(!group){host.append(el('p',{class:'combat-error',text:'A source gameplay feature is unavailable.'}));return;}
                const slot=el('div',{'data-feature-id':feature.id});host.append(slot);
                renderNativeMechanics({...ctx,featureId:feature.id},slot,{mechanics:[group]},{nativeMechanics:{[group.id]:feature.values}},fn=>{const draft={nativeMechanics:{[group.id]:structuredClone(feature.values)}};fn(draft);save(rows=>rows[index].values=draft.nativeMechanics?.[group.id]??{});},{parameterFilter:parameter=>!isVisualParameter(parameter)});
                slot.querySelectorAll('details[data-workspace-section]').forEach(details=>{if(disclosures.has(details.dataset.workspaceSection))details.open=disclosures.get(details.dataset.workspaceSection);});
                slot.querySelector('.combat-card-tools').append(button('Remove feature',()=>save(rows=>{rows.splice(index,1);}),{class:'combat-remove-feature','aria-label':`Remove ${group.name}`}));
            });
        })().catch(error=>{if(host.isConnected)host.append(el('p',{class:'combat-error',text:error.message}));});
    }
    const isVisualParameter=parameter=>/vfx|graphic/i.test(parameter.label)||/graphic/i.test(parameter.key);
    async function openFeatures(current,category,title){
        const project=state.project,selected=current.id,library=await fetchAsset('native-feature-library',()=>ctx.api('special-features'));
        if(state.project!==project||rule()?.id!==selected||document.querySelector('.combat-feature-dialog[open]'))return;
        browseAttackFeatures(ctx,{library,category,title,onlyActions:mode()==='passive',withoutDamage:mode()==='passive'&&[...POLLED_TRIGGERS,'attack'].includes(current.trigger),actions:current.actions.length<4,onChoose:(key,value)=>{
            if(state.project!==project||rule()?.id!==selected)return;
            if(key.startsWith('rule:')||key.startsWith('extra:')){const [kind,type]=key.split(':');edit(r=>{addRecipeEffect(r,kind==='rule'?'ruleFeatures':'extraFeatures',type,value);if(type==='next-flames'&&value.graphic>=0){const row=r.extraFeatures.at(-1);(r.visuals??=[]).push(newVisual(value.graphic,{nativeFeature:row.id,nativeGraphic:value.graphic,nativeRecipient:'target',recipient:'target',phase:value.event==='launch'?'launch':'impact'}));}});return;}
            if(key.startsWith('action:')){mechanics.addAction(mode(),key.slice(7),value);return;}
            if(key.startsWith('modifier:')){const type=key.slice(9);edit(r=>{r.modifiers??=structuredClone(attackModifiers(r));let id=1;while(r.modifiers.some(row=>row.id===`${type}-${id}`))id++;r.modifiers.push({id:`${type}-${id}`,type,multiplier:value.multiplier});if(r.nativeFrom!==undefined&&!r.nativeOverrides.includes(type))r.nativeOverrides.push(type);});return;}
            const row=library.rows.find(row=>`${row.source}:${row.group.id}`===key);if(!row)return;edit(r=>{const rows=r.nativeFeatures??=[];let id=1;while(rows.some(row=>row.id===`feature-${id}`))id++;rows.push({id:`feature-${id}`,source:row.source,mechanic:row.group.id,values:{...Object.fromEntries(row.group.parameters.map(parameter=>[parameter.key,structuredClone(parameter.value)])),...value}});const feature=rows.at(-1),event=mechanicPreview([row.group],{[row.group.id]:feature.values})[0];if(event?.graphic>=0){if((r.visuals?.length??0)>=VISUAL_LIMIT)throw new Error(`Use at most ${VISUAL_LIMIT} clips.`);(r.visuals??=[]).push(newVisual(event.graphic,{nativeFeature:feature.id,nativeGraphic:row.group.preview.graphic,nativeRecipient:event.recipient,recipient:event.recipient,phase:'impact'}));}});
        }});
    }
    function recipients(parent,c){field(parent,'Plays on',c.recipient,v=>c.kind==='graphic'?patch(c=>c.recipient=v):chooseAsset('animation',v,-1,id=>patch(c=>{c.recipient=v;c.id=id;})),{options:c.kind==='graphic'?[['player','Player'],['target','Target'],['both','Player and target']]:[['player','Player'],['target','Target'],...(c.recipient==='both'?[['both','Both (choose a compatible movement for each actor)']]:[])]});}
    function timingDescription(c){
        if(!scene?.assets.has(`graphic:${c.id}:${c.recipient}`))return 'Loading effect duration…';
        const normal=assetLength(c),played=normal/c.speed,visible=visualDuration(c,normal),seconds=n=>(n/1000).toFixed(2)+' s';
        let text=`Plays for ${seconds(played)} at ${Math.round(c.speed*100)}% speed.`;if(c.durationMs||Math.abs(played-visible)>1)text+=` Visible for ${seconds(visible)}.`;
        if(visible+1<played)text+=' The effect is cut short.';
        else if(visible>played+1)text+=c.loop?' The animation repeats for the selected visible time.':' The final frame is held after playback ends.';
        return text;
    }
    const clipName=c=>ui.names.get(`${c.kind}:${c.id}`)??(c.kind==='graphic'?friendlyName(c.id,`Visual effect ${c.id}`):`Movement ${c.id}`);
    const clipTrigger=c=>c.nativeFeature?`${featureCues.get(c.nativeFeature)?.name??'Gameplay effect'} resolves`:c.nativeGraphic!==undefined?'Original effect cue':mode()==='passive'?'Set effect activates':c.phase==='launch'?'Attack starts':'First hit lands';
    function removeClip(index){edit(r=>{const [clip]=r.visuals.splice(index,1);if(clip.nativeFeature&&!r.explicitVisuals&&r.nativeFeatures?.some(row=>row.id===clip.nativeFeature)&&!r.visuals.some(row=>row.nativeFeature===clip.nativeFeature))r.disabledFeatureVisuals=[...new Set([...(r.disabledFeatureVisuals??[]),clip.nativeFeature])];if(ui.clip>index)ui.clip--;});}
    function chooseEffect({replace=false,after=false}={}){
        const current=rule()?.visuals?.[ui.clip],index=ui.clip,options=after?nextVisualOptions(current,assetLength(current)):replace?structuredClone(current):newVisual(398,{phase:mode()==='special'?'launch':'impact',recipient:mode()==='special'?'player':'target'}),draft=replace?options:newVisual(398,options);
        return chooseAsset('graphic',draft.recipient,replace?current.id:398,(_id,_row,clip)=>{ui.presentation='effects';if(replace)edit(r=>r.visuals[index]=clip);else add(clip);},{settings:draft,actionLabel:replace?'Replace effect':'Add effect to sequence'});
    }
    let refreshSequence=()=>{};
    function renderQueue(parent){
        const r=rule();parent.append(el('h2',{text:'Visuals & sound'}));if(!r){note(parent,'Create an attack or set effect in Behaviour, then add its presentation here.');return;}
        const clips=r.visuals??[],tabs=el('div',{class:'combat-presentation-tabs',role:'tablist','aria-label':'Presentation sections','data-total-clips':clips.length}),sections=[['effects','Effects',clips.filter(c=>c.kind==='graphic').length],['movements','Movements',clips.filter(c=>c.kind==='animation').length+(mode()==='special'&&r.animation>=0?1:0)],...(mode()==='special'?[['projectiles','Projectiles',r.extraFeatures?.filter(c=>c.type==='projectile').length??0],['sounds','Sounds',r.extraFeatures?.filter(c=>c.type==='sound').length??0]]:[])];
        if(!sections.some(([id])=>id===ui.presentation))ui.presentation='effects';
        parent.append(tabs);for(const [id,title,count] of sections){const tab=button('',()=>{ui.presentation=id;ctx.render();},{role:'tab','aria-selected':ui.presentation===id,tabIndex:ui.presentation===id?0:-1,'aria-label':`${title} (${count})`,'data-presentation':id});tab.append(el('span',{text:title}),el('small',{text:count}));tab.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const i=sections.findIndex(([key])=>key===id),next=event.key==='Home'?0:event.key==='End'?sections.length-1:(i+(event.key==='ArrowRight'?1:-1)+sections.length)%sections.length;ui.presentation=sections[next][0];ctx.render();root.querySelector('.combat-presentation-tabs [aria-selected=true]')?.focus();}};tabs.append(tab);}
        const tab=ui.presentation;
        if(tab==='projectiles'||tab==='sounds'){
            const type=tab==='sounds'?'sound':'projectile',title=tab==='sounds'?'Sounds':'Projectiles',section=el('section',{class:'combat-presentation-section'});parent.append(section);
            note(section,type==='sound'?'Choose sounds and when they play. Animation and VFX frame sounds also play automatically.':'Choose the visual that travels from you to the enemy, then set its flight timing and arc. Effects that stay on an actor belong in Effects.');
            section.append(button(`Add ${type}`,type==='projectile'?()=>chooseAsset('graphic','target',-1,id=>edit(r=>addRecipeEffect(r,'extraFeatures','projectile',{id}))):run(()=>openFeatures(r,title,'Add sound')),{class:'primary combat-section-add'}));
            if(r.recipe)renderRecipeEffects({...ctx,chooseGraphic:(value,set)=>chooseAsset('graphic','target',value,set)},section,r,edit,{section:'presentation',types:[type]});
            if(type==='sound')for(const row of r.extraFeatures?.filter(row=>row.type==='sound')??[]){const card=[...section.querySelectorAll('[data-rule-type=sound]')][r.extraFeatures.filter(row=>row.type==='sound').indexOf(row)];card?.append(button('Listen to this sound',run(async()=>{ui.playing=false;if(playButton)playButton.textContent='Resume';ui.sounds=true;audio.setMuted(false);const toggle=root.querySelector('[aria-label="Preview sounds"]');if(toggle)toggle.checked=true;await audio.unlock();await audio.start([{id:row.values.id,loops:row.values.loops,timeMs:0,rate:1}],0,1);})));}
            return;
        }
        if(tab==='movements'){
            note(parent,'Movements pose the character. Visual effects add magic, flashes and other graphics without changing that pose.');
            if(mode()==='special'){const movement=el('section',{class:'combat-base-movement'});parent.append(movement);movement.append(el('h3',{text:'Main attack movement'}));note(movement,r.animation>=0?ui.names.get(`animation:${r.animation}`)??`Player movement ${r.animation}`:'No attack movement. The player stays in its idle pose.');movement.append(button(r.animation>=0?'Change attack movement':'Choose attack movement',()=>chooseAsset('animation','player',r.animation,id=>edit(r=>r.animation=id))),button('Remove movement',()=>edit(r=>r.animation=-1),{disabled:r.animation<0}));}
            note(parent,'Additional player movements override the main movement while they play. New player clips start after the main attack movement by default.');
            const actions=el('div',{class:'combat-actions'});parent.append(actions);actions.append(button('Add player movement',()=>chooseAsset('animation','player',-1,id=>add(newVisual(id,{kind:'animation',recipient:'player',phase:mode()==='special'?'launch':'impact',delayMs:mode()==='special'&&r.animation>=0?Math.round(natural(scene?.player)):0})))),button('Add target movement',()=>chooseAsset('animation','target',-1,id=>add(newVisual(id,{kind:'animation',recipient:'target',phase:'impact'}))),{disabled:ui.enemy===null||isSelf()}));
        }else{
            parent.append(button('Add visual effect',()=>chooseEffect(),{class:'primary combat-add-vfx',disabled:clips.length>=VISUAL_LIMIT}));
            note(parent,'Browse animated tiles, choose who receives the effect, then set its timing.');
            if(mode()==='special'&&r.nativeFrom!==undefined&&!r.recipe){
                const source=el('section',{class:'combat-imported-visuals'});parent.append(source);note(source,r.replaceGraphics?'Source visuals are replaced by the editable clips below.':'This reference also plays its original visuals. Import them here to edit or replace them.');
                if(!r.replaceGraphics)source.append(button('Import source visuals',run(async()=>{const project=state.project,result=await ctx.api(`special-donors?q=${r.nativeFrom}`),reference=result.rows.find(row=>row.id===r.nativeFrom);if(state.project!==project||rule()?.nativeFrom!==r.nativeFrom)return;const originals=reference?.visualClips??[];if((r.visuals?.length??0)+originals.length>VISUAL_LIMIT)throw new Error(`Use at most ${VISUAL_LIMIT} clips.`);edit(r=>{r.replaceGraphics=true;(r.visuals??=[]).push(...originals.map(clip=>newVisual(clip.id,{...clip,nativeGraphic:clip.id,nativeRecipient:clip.recipient})));});})));
            }
            if(mode()==='special'&&r.graphic>=0){const legacy=el('section',{class:'combat-base-movement'});parent.append(legacy);note(legacy,`An imported launch effect (ID ${r.graphic}) plays on the player.`);legacy.append(button('Edit imported launch effect',()=>edit(r=>{(r.visuals??=[]).unshift(newVisual(r.graphic,{recipient:'player',phase:'launch'}));r.graphic=-1;ui.clip=0;}),{disabled:clips.length>=VISUAL_LIMIT}),button('Remove imported launch effect',()=>edit(r=>r.graphic=-1)));}
        }
        const matching=clips.map((clip,index)=>({clip,index})).filter(({clip})=>clip.kind===(tab==='effects'?'graphic':'animation'));
        if(!matching.length){note(parent,tab==='effects'?'No visual effects yet. Add an effect from the library, or copy a special attack in Behaviour.':'No additional movement clips. The main attack movement above plays once when the attack starts.');return;}
        if(!matching.some(({index})=>index===ui.clip))ui.clip=matching[0].index;
        const list=el('ol',{class:'combat-queue','aria-label':tab==='effects'?'Visual effect sequence':'Additional movement sequence'});parent.append(list);
        const entries=new Map();
        for(const {clip:c,index} of matching){
            const entry=el('li',{class:index===ui.clip?'selected':'','data-clip-index':index,'data-visual-feature':c.nativeFeature??''}),thumb=el('canvas',{width:150,height:120,'aria-label':`${clipName(c)} thumbnail`}),summary=el('span',{class:'combat-clip-summary'}),select=button('',()=>{ui.clip=index;ctx.render();},{class:'combat-clip-select','aria-label':`Edit ${clipName(c)}`,'aria-pressed':index===ui.clip});
            summary.append(el('strong',{text:clipName(c)}),el('small',{class:`combat-recipient combat-recipient-${c.recipient}`,text:c.recipient==='target'?'Target':c.recipient==='both'?'Player + target':'Player'}),el('span',{class:'combat-clip-start'}),el('span',{class:'combat-clip-bar'}),el('small',{class:'combat-clip-overlap',hidden:true}));select.append(thumb,summary);entry.append(select,button('×',()=>removeClip(index),{class:'combat-clip-remove','aria-label':`Remove ${clipName(c)} from sequence`,title:'Remove clip'}));list.append(entry);entries.set(index,entry);queueThumbnails.push({canvas:thumb,clip:c,view:null});
        }
        refreshSequence=()=>{
            const rows=presentationSequence(clips,{previewClips:scene?.clips??[],impactMs:impact(),naturalDuration:assetLength}),visible=rows.filter(row=>entries.has(row.index)),span=Math.max(1000,...visible.map(row=>row.end));
            for(const row of visible){const entry=entries.get(row.index),c=row.clip;entry.dataset.startMs=row.start;entry.dataset.endMs=row.end;entry.querySelector('strong').textContent=clipName(c);entry.querySelector('.combat-clip-start').textContent=`${clipTrigger(c)}${c.delayMs?` + ${(c.delayMs/1000).toFixed(2)}s`:''} · ${(row.length/1000).toFixed(2)}s`;
                const bar=entry.querySelector('.combat-clip-bar');bar.style.marginLeft=`${row.start/span*100}%`;bar.style.width=`${Math.max(3,row.length/span*100)}%`;const overlap=entry.querySelector('.combat-clip-overlap'),others=row.overlaps.filter(i=>entries.has(i));overlap.hidden=!others.length;overlap.title=others.map(index=>clipName(clips[index])).join(', ');overlap.textContent=row.duplicates.length?'Same effect is also scheduled here':others.length?'Plays alongside another clip':'';list.append(entry);}
        };refreshSequence();note(parent,'Clips are listed by playback time. Overlapping clips play together.');
        const c=clips[ui.clip],editor=el('section',{class:'combat-clip-editor','aria-label':'Selected clip settings'});parent.append(editor);editor.append(el('h3',{text:clipName(c)}),el('small',{class:'combat-clip-id',text:`${c.kind==='graphic'?'VFX':'Movement'} ID ${c.id}`}));
        editor.append(button(c.kind==='graphic'?'Change visual effect':'Change movement',()=>c.kind==='graphic'?chooseEffect({replace:true}):chooseAsset('animation',c.recipient,c.id,id=>patch(c=>c.id=id)),{class:'combat-change-asset'}));
        const group=(title,description)=>{const section=el('section',{class:'combat-clip-settings-group'},el('h4',{text:title}));editor.append(section);if(description)note(section,description);const fields=el('div',{class:'combat-fields'});section.append(fields);return {section,fields};};
        const placement=group('Placement');recipients(placement.fields,c);
        if(c.kind==='graphic'){
            const position=el('details',{class:'combat-position-options','data-workspace-section':'visual-height'},el('summary',{text:'Height and placement'}));placement.section.append(position);const heightFields=el('div',{class:'combat-fields'});position.append(heightFields);
            if(c.nativeGraphic!==undefined)field(heightFields,'Height mode',c.heightMode==='custom'?'custom':'native',v=>patch(c=>c.heightMode=v),{options:[['native','Use original effect height'],['custom','Set a custom height']]});
            const height=field(heightFields,'Height (model units)',c.height,v=>patch(c=>{c.height=v;if(c.nativeGraphic!==undefined)c.heightMode='custom';}),{min:-256,max:512});height.disabled=c.nativeGraphic!==undefined&&c.heightMode!=='custom';note(position,'Higher values raise the effect; negative values lower it. Imported effects can keep their original height.');
        }
        const timing=group('Timing');
        if(mode()==='special')field(timing.fields,'Starts when',c.nativeFeature?`effect:${c.nativeFeature}`:c.nativeGraphic!==undefined?'source':c.phase,v=>{if(v==='source')return;edit(r=>{
            const clip=r.visuals[ui.clip];if(v.startsWith('effect:')){const id=v.slice(7),cue=featureCues.get(id),feature=r.nativeFeatures?.find(row=>row.id===id);if(feature&&cue.graphicParameter&&(feature.values[cue.graphicParameter]??cue.graphic)<0)feature.values[cue.graphicParameter]=cue.graphic;clip.nativeFeature=id;if(cue.graphic<0){const row=r.extraFeatures.find(row=>row.id===id);row.values.graphic=clip.id;cue.graphic=clip.id;}clip.nativeGraphic=cue.graphic;clip.nativeRecipient=cue.recipient??'target';clip.phase='impact';r.disabledFeatureVisuals=(r.disabledFeatureVisuals??[]).filter(value=>value!==id);}else{delete clip.nativeGraphic;delete clip.nativeRecipient;delete clip.nativeFeature;delete clip.heightMode;clip.phase=v;}
        });},{options:[['launch','Attack starts'],['impact','First hit lands'],...(c.nativeGraphic!==undefined&&!c.nativeFeature?[['source','Original effect cue']]:[]),...[...featureCues].map(([id,cue])=>[`effect:${id}`,`${cue.name} resolves`])]});else note(timing.section,'Starts when this set effect activates.');
        field(timing.fields,'Delay after trigger (seconds)',c.delayMs/1000,v=>patch(c=>c.delayMs=Math.round(v*1000)),{max:Math.min(119.95,(120000-c.durationMs)/1000),step:.05});
        if(c.kind==='graphic'){
            field(timing.fields,'Playback speed (%)',c.speed*100,v=>patch(c=>c.speed=v/100),{min:10,max:400,step:1});
            field(timing.fields,'Duration',c.durationMs?'fixed':'natural',v=>patch(c=>{c.durationMs=v==='natural'?0:Math.min(120000-c.delayMs,Math.round(assetLength(c)/c.speed));if(!c.durationMs)c.loop=false;}),{options:[['natural','Play once at chosen speed'],['fixed','Set duration in seconds']]});
            if(c.durationMs){field(timing.fields,'Duration (seconds)',c.durationMs/1000,v=>patch(c=>c.durationMs=Math.round(v*1000)),{min:.05,max:(120000-c.delayMs)/1000,step:.05});field(timing.fields,'When playback finishes',c.loop?'repeat':'hold',v=>patch(c=>c.loop=v==='repeat'),{options:[['hold','Hold the last frame'],['repeat','Repeat until duration ends']]});}
            const summary=el('output',{class:'combat-vfx-timing',text:timingDescription(c)});timing.section.append(summary);note(timing.section,'100% is normal speed. 50% plays twice as slowly and lasts twice as long when Duration is set to play once.');
            const appearance=group('Colour');const hue=field(appearance.fields,'Hue shift (degrees)',c.hueShift??0,v=>patch(c=>c.hueShift=v),{min:-180,max:180,step:1}),slider=el('input',{type:'range',min:-180,max:180,step:1,value:c.hueShift??0,'aria-label':'Hue shift slider'});
            slider.oninput=()=>{hue.value=slider.value;for(const preview of scene?.clips??[])if(preview.previewIndex===ui.clip)preview.hueShift=Number(slider.value);draw();};slider.onchange=()=>patch(c=>c.hueShift=Number(slider.value));appearance.section.append(slider,button('Reset hue',()=>patch(c=>c.hueShift=0),{disabled:!(c.hueShift??0)}));note(appearance.section,'Shifts the effect’s colours while preserving neutral whites and greys.');
        }else note(editor,'Character movements keep their original speed and length. Use the preview library to find a movement for the selected actor.');
        const tools=el('div',{class:'combat-actions combat-clip-tools'});editor.append(tools);if(c.kind==='graphic')tools.append(button('Add next effect',()=>chooseEffect({after:true}),{disabled:clips.length>=VISUAL_LIMIT}));
        tools.append(button('Duplicate',()=>add(structuredClone(c)),{disabled:clips.length>=VISUAL_LIMIT}),button('Duplicate after clip',()=>add({...structuredClone(c),...nextVisualOptions(c,assetLength(c))}),{disabled:clips.length>=VISUAL_LIMIT}),button('Remove clip',()=>removeClip(ui.clip)));
        if(ui.focusClip){ui.focusClip=false;queueMicrotask(()=>editor.isConnected&&editor.scrollIntoView({block:'nearest'}));}
    }
    function render(){
        const visible=active();document.body.classList.toggle('combat-mode',!!visible);root.hidden=!visible;
        if(!visible){queueThumbnails=[];refreshSequence=()=>{};ui.playAfterLoad=false;ui.playing=false;audio.stop();serial++;preparedKey='';if(scene||view.items.length){scene=null;cache.clear();view.setItems([]);}return;}
        const key=`${state.project.id}:${mode()}`;if(identity!==key){identity=key;ui.clip=0;scene=null;view.setItems([]);preparedKey='';}
        if(!rule()){scene=null;view.setItems([]);preparedKey='';}
        if(ui.loading)preparedKey='';
        const resumePlaying=ui.playing||ui.loading&&ui.playAfterLoad;
        const offsets=[...root.querySelectorAll('.combat-behaviour,.combat-stage-panel,.combat-visuals')].map(panel=>panel.scrollTop);root.querySelectorAll('details[data-workspace-section]').forEach(details=>disclosures.set(details.dataset.workspaceSection,details.open));
        serial++;ui.playing=false;ui.loading=false;audio.stop();root.replaceChildren();
        const header=el('header',{class:'combat-header'},el('div',{},el('h1',{text:mode()==='special'?'Special Attacks':'Set Effects'}),el('p',{text:mode()==='special'?'Configure behavior, animation and visual timing.':'Configure activation, equipment requirements and visuals.'})));root.append(header);
        field(header,'Preview body',ui.gender??(state.variant==='female'?'female':'male'),v=>{ui.gender=v;preparedKey='';ctx.render();},{options:[['male','Male'],['female','Female']]});
        if(state.gearSet)field(header,'Editing item',state.project.id,id=>ctx.switchSetItem(id),{options:state.gearSet.items.map(item=>[item.id,item.name])});
        const layout=el('div',{class:'combat-layout'}),behaviour=el('section',{class:'combat-behaviour','aria-label':'Effect behaviour'}),stage=el('section',{class:'combat-stage-panel'}),queue=el('section',{class:'combat-visuals'});root.append(layout);for(const side of ['left','right'])layout.style.setProperty(`--${side}-width`,`${widths[side]}px`);layout.append(behaviour,resizeHandle('left',layout),stage,resizeHandle('right',layout),queue);
        behaviour.append(el('h2',{text:'Behaviour'}));
        renderSimpleBehaviour(behaviour);
        if(rule()&&mode()==='passive'){const actions=el('details',{class:'combat-rule-section',open:true},el('summary',{text:'Actions'}));actions.dataset.workspaceSection=mode()+':actions';if(disclosures.has(mode()+':actions'))actions.open=disclosures.get(mode()+':actions');behaviour.append(actions);actions.append(button('Add recovery/control effect',run(()=>openFeatures(rule(),'Gameplay effects','Add recovery/control effect')),{class:'combat-section-add'}));mechanics.renderActions(actions,mode());}
        const library=effectReferenceLibrary(ctx,behaviour,{kind:mode()==='special'?'special':'set',onGraphic:(row,id)=>{if(!rule()){ctx.status('Create an attack or set effect first, then add this VFX.');return;}add(newVisual(id,{recipient:mode()==='special'?'player':'target',phase:mode()==='special'?'launch':'impact'}));},onChoose:row=>{
            if(ui.sounds)void audio.unlock();
            if(mode()==='special'){ui.autoPlay=true;ui.presentation='effects';mechanics.useSpecial(newNativeSpecial(row));}
            else {if(!rule()){ctx.status('Create a set bonus or passive effect, then add this reference’s visuals.');return;}edit(r=>{r.visuals=[...(r.visuals??[]),...row.graphics.map(id=>newVisual(id))].slice(0,VISUAL_LIMIT);});}
        }});
        if(mode()==='special')behaviour.querySelector('.combat-starting-weapon').append(library);else behaviour.querySelector('.combat-idea-chooser').after(library);
        if(mode()==='special'){if(rule())behaviour.append(button('Remove special attack',()=>mechanics.removeSpecial(),{class:'combat-remove-attack'}));}else{const more=el('details',{class:'combat-more-behaviour'},el('summary',{text:'Equipment and example values'}));behaviour.append(more);mechanics.renderSection(more,mode());}
        const enemy=el('div',{class:'combat-enemies',hidden:isSelf()});stage.append(enemy);enemy.append(el('h2',{text:'Test opponent'}));
        const recommended=el('div',{class:'combat-recommended'});enemy.append(recommended);
        for(const row of ui.recommended)recommended.append(button('',()=>{ui.autoPlay=ui.playing;ui.enemy=row.id;preparedKey='';ctx.render();},{'aria-label':`Test ${row.name}`,class:ui.enemy===row.id?'selected':''}),);
        [...recommended.children].forEach((b,index)=>b.append(el('strong',{text:ui.recommended[index].name}),el('small',{text:ui.recommended[index].sizeLabel})));
        if(ui.enemy!=='dummy')referencePicker({...ctx,change:fn=>fn()},enemy,'Combat NPC','npc',ui.enemy??-1,id=>{ui.enemy=id;preparedKey='';ctx.render();},{required:true,creaturesOnly:true,visual:true});
        else enemy.append(button('Search combat NPCs',()=>{ui.enemy=ui.recommended.find(row=>typeof row.id==='number')?.id??100;preparedKey='';ctx.render();}));
        const stageCanvas=el('div',{class:'combat-stage'},canvas,el('p',{class:'combat-stage-empty',hidden:!!scene,text:rule()?'Loading preview…':'Choose a starting point or a game reference.'}));stage.append(stageCanvas);stageCanvas.append(el('span',{class:'combat-player-label',text:isSelf()?'Player · self-cast':'Player'}),el('span',{class:'combat-target-label',text:'Enemy',hidden:isSelf()}),el('div',{class:'combat-damage-overlay','aria-label':'Preview hitsplats and status effects'}));
        stage.append(el('output',{class:'combat-damage-summary','aria-live':'polite'}));
        if(scene?.themes)hitsplatView=createCombatHitsplats(stageCanvas.querySelector('.combat-damage-overlay'),scene.themes);
        const transport=el('div',{class:'combat-transport'});stage.append(transport);
        playButton=button('Play preview',()=>{if(ui.sounds)void audio.unlock();if(ui.playing){ui.playing=false;audio.stop();playButton.textContent='Resume';}else if(scene&&ui.time>0&&ui.time<duration()){ui.playing=true;playButton.textContent='Pause';last=performance.now();syncAudio();}else return prepare(true);},{class:'primary',disabled:!rule()||ui.enemy===null});
        transport.append(playButton,button('Restart',()=>{if(ui.sounds)void audio.unlock();return prepare(true);},{disabled:!rule()||ui.enemy===null}),button('Fit view',()=>view.fit()));clock=el('output',{text:'0.00 s','aria-live':'off'});transport.append(clock);
        seek=el('input',{type:'range',min:0,max:duration(),step:10,value:ui.time,'aria-label':'Scrub visual preview'});seek.oninput=()=>{ui.playAfterLoad=false;ui.playing=false;audio.stop();playButton.textContent='Resume';ui.time=Number(seek.value);draw();};stage.append(seek);
        const controls=el('div',{class:'combat-fields combat-preview-options'});stage.append(controls);field(controls,'Preview damage preset',ui.damagePreset,v=>{ui.damagePreset=v;updateDamage();ui.time=0;draw();syncAudio();},{options:Object.entries(DAMAGE_PRESETS).map(([id,row])=>[id,row.name])});field(controls,'Loop preview',ui.loop,v=>ui.loop=v,{type:'checkbox'});field(controls,'Preview speed',ui.rate,v=>{ui.rate=Number(v);syncAudio();},{options:[[.25,'¼×'],[.5,'½×'],[1,'1×'],[2,'2×']]});if(!isSelf())field(controls,'Preview impact (seconds)',ui.impactMs/1000,v=>{ui.impactMs=v*1000;preparedKey='';ctx.render();},{max:30,step:.05});
        field(controls,'Preview sounds',ui.sounds,v=>{ui.sounds=v;audio.setMuted(!v);if(v){void audio.unlock();syncAudio();}},{type:'checkbox'});field(controls,'Sound volume (%)',ui.volume,v=>{ui.volume=v;audio.setVolume(v/100);},{min:0,max:100});if(!isSelf())field(controls,'Enemy retaliates',ui.retaliate,v=>{ui.retaliate=v;preparedKey='';ctx.render();},{type:'checkbox'});stage.append(el('output',{class:'combat-audio-status','aria-live':'polite',text:audioIssues.size?`${audioIssues.size} unavailable sounds`:''}));
        note(stage,'Damage presets affect this preview only. They include the edited weapon’s bonuses and the selected external bonuses, with an aggressive or accurate stance. Accuracy and effect procs succeed; damage-over-time shows its first natural tick. Ranged damage includes the strongest compatible ammunition. Thrown weapons and self-ammo weapons do not receive a second ammunition bonus.');
        note(stage,mode()==='special'?'Preview impact is a test setting. In game, effects follow the real hit and projectile timing.':rule()?`Test activation: ${activationSummary(rule())} The preview shows one successful activation.`:'Choose an effect to preview its activation.');errorBox=el('p',{class:'combat-error',role:'alert'});stage.append(errorBox);
        queueThumbnails=[];refreshSequence=()=>{};renderQueue(queue);
        for(const [selector,key] of [['.combat-idea-chooser','ideas'],['.combat-more-behaviour','combat-settings'],['.combat-recipes','recipes'],['.combat-precise','precise'],['.combat-conditions','conditions']]){const details=root.querySelector(selector);if(details){const sectionKey=mode()+':'+key;details.dataset.workspaceSection=sectionKey;if(disclosures.has(sectionKey))details.open=disclosures.get(sectionKey);}}
        root.querySelectorAll('details[data-workspace-section]').forEach(details=>{if(disclosures.has(details.dataset.workspaceSection))details.open=disclosures.get(details.dataset.workspaceSection);});
        [behaviour,stage,queue].forEach((panel,index)=>panel.scrollTop=offsets[index]??0);
        const nextKey=JSON.stringify([key,state.variant,ui.gender,state.project.effects,ui.enemy,ctx.previewContextKey?.()]);
        if(rule()&&ui.enemy!==null&&preparedKey!==nextKey){preparedKey=nextKey;const autoPlay=ui.autoPlay||resumePlaying;ui.autoPlay=false;queueMicrotask(()=>prepare(autoPlay));}else if(scene){updateDamage();ui.playing=resumePlaying;playButton.textContent=ui.playing?'Pause':'Play preview';syncAudio();draw();}
        if(!ui.recommended.length)ctx.api('combat-enemies').then(result=>{if(!result.rows.length)return;ui.recommended=[{id:'dummy',name:'Human dummy',sizeLabel:'Player scale'},...result.rows];ui.enemy??=result.rows[0].id;if(active())ctx.render();}).catch(error=>report(error.message));
    }
    return {render,reset(){serial++;ui.playing=false;audio.clear();scene=null;view.setItems([]);preparedKey='';cache.clear();mechanics.reset();},root,prepare};
}
