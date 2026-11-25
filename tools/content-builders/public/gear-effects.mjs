import {mechanicHeader} from './combat-cards.mjs';
import { newAction, EFFECT_ACTIONS, EFFECT_ANIMATIONS, EFFECT_PRESETS, EFFECT_STATS, RECOVERY_BASES, POLLED_TRIGGERS, effectPreset, newPassive, newSpecial, newNativeSpecial, materializeSpecial, previewPassive, previewSpecial, validateEffects } from '../shared/effects.mjs';
import {renderEffectTriggers} from './effect-triggers.mjs';
import { assemble, bounds } from '../shared/mesh.mjs';
import { fullSetRequirement, itemReference, referencedItem, equipmentSlot, equippedParts, equippedItems } from '../shared/gear-set.mjs';
import { referencePicker, referencePicture } from './picker.mjs';

const SLOTS = [[0,'Head'],[1,'Cape'],[2,'Neck'],[3,'Weapon'],[4,'Body'],[5,'Shield'],[7,'Legs'],[9,'Hands'],[10,'Feet'],[12,'Ring'],[13,'Ammunition']];
const SLOT_BY_TYPE = {HAT:0,FULL_HELMET:0,MED_HELMET:0,MASK:0,COIF:0,CAPE:1,HOODED_CAPE:1,AMULET:2,WEAPON:3,BODY:4,PLATEBODY:4,SHIELD:5,LEGS:7,GLOVES:9,BOOTS:10,RING:12,ARROWS:13};
const actionDefault = newAction;
const statChoices=EFFECT_STATS.map(s=>[s,s[0].toUpperCase()+s.slice(1)]);
function referenceView(mesh) {
    const box=bounds(mesh),size=box.max.map((n,i)=>n-box.min[i]),axis=size.indexOf(Math.max(...size));
    // Inventory blades often lie along Z. Stand the longest axis upright in
    // their card so the real mesh is readable at this size. No asset is edited.
    if(axis===1)return mesh;
    return {...mesh,vertices:mesh.vertices.map(([x,y,z])=>axis===2?[x,-z,y]:[y,-x,z])};
}

/** Gear-only editor. Mount renderInline inside Game data, or renderProperties
 * in a dedicated panel. ctx uses the existing workbench's element/button/change,
 * api/status and optional viewport/stop/render callbacks. No project ownership.
 */
export function createGearEffectsTab(ctx) {
    const {state,element:el,button} = ctx;
    const names=new Map();
    let root,toolsRoot,identity,serial=0,ui={};
    const project=()=>state.project;
    const config=()=>validateEffects(project()?.effects);
    function context() {
        if(identity!==project()?.id) {identity=project()?.id;serial++;ui={index:0,mode:null,reference:'',sections:{},preview:{maxHit:30,attackRoll:10000,defenceRoll:10000},passivePreview:{rolledDamage:20,targetHp:100,enemyDefence:100,enemyLevels:{}}};}
    }
    const note=(parent,text,error=false)=>parent.append(el('p',{class:`effects-note${error?' effects-error':''}`,text}));
    const run=fn=>{try{return fn();}catch(error){ctx.status(error.message,true);}};
    const rerender=()=>{if(ctx.render)ctx.render();else {if(root?.isConnected){const parent=root.parentNode;root.remove();renderInline(parent);}if(toolsRoot?.isConnected)renderTools(toolsRoot);}};
    function commit(fn,settings) {
        root?.querySelectorAll('details[data-effect-section]').forEach(section=>ui.sections[section.dataset.effectSection]=section.open);
        const p=project(),draft=config();fn(draft);
        const checked=validateEffects(draft);
        serial++;
        ctx.change(()=>{p.effects=checked;if(settings)settings(p.settings);});
        if(!ctx.render)rerender();
    }
    function section(parent,title,open=true) {
        const details=el('details',{class:'effects-section',open:ui.sections[title]??open},el('summary',{text:title}));details.dataset.effectSection=title;
        details.addEventListener('toggle',()=>{if(details.isConnected)ui.sections[title]=details.open;});parent.append(details);return details;
    }
    function select(parent,label,value,choices,change) {
        const input=el('select',{'aria-label':label},...choices.map(([id,name])=>el('option',{value:id,text:name,selected:String(id)===String(value)})));
        input.onchange=()=>run(()=>change(input.value));parent.append(el('label',{},label,input));return input;
    }
    function number(parent,label,value,min,max,change,step=1) {
        const input=el('input',{type:'number',value:Number(value.toFixed(6)),min,max,step,'aria-label':label});
        input.onchange=()=>run(()=>{
            const next=input.value.trim()===''?NaN:Number(input.value);
            if(!Number.isFinite(next)||next<min||next>max||(step===1&&!Number.isInteger(next))) {
                input.setCustomValidity(`Enter ${step===1?'a whole number':'a number'} from ${min} to ${max}.`);input.reportValidity?.();throw new Error(`${label}: ${input.validationMessage}`);
            }
            input.setCustomValidity('');change(next);
        });input.oninput=()=>input.setCustomValidity('');
        parent.append(el('label',{},label,input));return input;
    }
    function text(parent,label,value,change) {
        const input=el('input',{type:'text',value,maxLength:80,'aria-label':label});input.onchange=()=>run(()=>change(input.value));parent.append(el('label',{},label,input));
    }
    const fields=parent=>{const grid=el('div',{class:'effects-fields'});parent.append(grid);return grid;};
    const row=parent=>{const controls=el('div',{class:'effects-actions'});parent.append(controls);return controls;};
    function references(parent,kind,use) {
        if(ctx.compactEffects)return;
        if(ctx.compactEffects)parent=section(parent,'Starting points',kind==='special'?!config().special:!config().passives.length);
        const rows=EFFECT_PRESETS.filter(p=>kind==='special'?p.kind==='special':p.kind!=='special');
        const label=kind==='special'?'special attack':'passive or set effect',filters=ui[`${kind}Filters`]??={query:'',goal:'',limit:6};
        const browse=el('div',{class:'effects-reference-browser'}),grid=el('div',{class:'effects-reference-grid'}),controls=fields(browse);
        const search=el('input',{type:'search',value:filters.query,placeholder:'Search weapons or effects…','aria-label':`Find a ${label} reference`});
        controls.append(el('label',{},'Find a reference',search));
        select(controls,'Reference goal',filters.goal,[['','All effects'],...['Damage','Recovery','Weaken','Control'].filter(goal=>rows.some(p=>p.goal===goal)).map(goal=>[goal,goal])],goal=>{filters.goal=goal;filters.limit=6;draw();});
        const more=button('More references',()=>{filters.limit+=6;draw();}),count=el('output',{'aria-live':'polite',class:'effects-note'});
        function draw(){
            const query=filters.query.trim().toLowerCase(),hits=rows.filter(p=>(!filters.goal||p.goal===filters.goal)&&`${p.name} ${p.goal} ${p.note}`.toLowerCase().includes(query));
            grid.replaceChildren();
            for(const p of hits.slice(0,filters.limit)){
                const card=button('',()=>{ui.reference=p.id;use(p.id);},{class:'effects-reference-card','aria-label':`Use ${p.name}`,'aria-pressed':ui.reference===p.id});
                referencePicture(ctx.thumbnail?{...ctx,thumbnail:(canvas,mesh,source)=>ctx.thumbnail(canvas,source?.fields?mesh:referenceView(mesh),source)}:ctx,card,'item',p.itemId,`${p.name} native model`);
                card.append(el('strong',{text:p.name.replace(' · ','\n')}),el('small',{text:p.goal}));grid.append(card);
            }
            count.textContent=hits.length?`${Math.min(filters.limit,hits.length)} of ${hits.length} references`:'No matching effects.';more.hidden=filters.limit>=hits.length;
        }
        search.oninput=()=>{filters.query=search.value;filters.limit=6;draw();};
        browse.append(grid,count,more);parent.append(browse);draw();
        const list=section(parent,'Reference list',false);
        select(list,kind==='special'?'Start with a special attack':'Start with a passive or set effect','', [['','Choose a reference…'],...rows.map(p=>[p.id,p.name])],id=>{
            if(!id)return;ui.reference=id;use(id);
        });
        const chosen=EFFECT_PRESETS.find(p=>p.id===ui.reference&&rows.includes(p));
        if(chosen) {
            const detail=section(parent,'Reference source',false);
            note(detail,chosen.note);
            detail.append(el('a',{href:chosen.url,target:'_blank',rel:'noopener noreferrer',text:chosen.name}));
            detail.append(el('code',{text:chosen.source}));
        }
    }
    function actionEditor(parent,value,update,isSpecial=false,allowAdd=true) {
        value.actions.forEach((action,index)=>{
            const group=el('div',{class:ctx.compactEffects?'effects-action combat-mechanic':'effects-action'});parent.append(group);
            const remove=button('Remove',()=>run(()=>update(v=>v.actions.splice(index,1))),{'aria-label':`Remove ${EFFECT_ACTIONS[action.type]}`});
            if(ctx.compactEffects)group.append(mechanicHeader(ctx,EFFECT_ACTIONS[action.type],'Recovery or control',[remove]));else row(group).append(el('strong',{text:EFFECT_ACTIONS[action.type]}),remove);
            const grid=fields(group),edit=fn=>update(v=>fn(v.actions[index]));
            if(action.type==='freeze')number(grid,'Bind duration (seconds)',action.ticks*.6,.6,19.2,v=>edit(a=>a.ticks=Math.round(v/.6)),.6);
            else if(action.type==='teleblock')number(grid,'Teleblock duration (seconds)',action.ticks*.6,.6,3600,v=>edit(a=>a.ticks=Math.round(v/.6)),.6);
            else if(action.type==='venom')note(group,'Venom starts at 6 damage after 30 ticks, increasing to 20 until cured.');
            else if(action.type==='poison')number(grid,'First poison damage',action.damage,1,20,v=>edit(a=>a.damage=v));
            else if(action.type==='drain-stats'){
                number(grid,'Damage used for stat drain (%)',action.percent??100,1,100,v=>edit(a=>a.percent=v));
                note(group,`Drain order: ${(action.order??EFFECT_STATS).map(s=>s[0].toUpperCase()+s.slice(1)).join(', ')}. NPCs skip Prayer.`);
                const order=section(group,'Choose stat order',false);
                (action.order??EFFECT_STATS).forEach((skill,i)=>{
                    const line=row(order);line.append(el('span',{text:statChoices.find(([id])=>id===skill)[1]}));
                    line.append(button('Earlier',()=>edit(a=>{a.order=[...(a.order??EFFECT_STATS)];[a.order[i-1],a.order[i]]=[a.order[i],a.order[i-1]];}),{disabled:i===0,'aria-label':`Move ${skill} earlier`}));
                    line.append(button('Remove stat',()=>edit(a=>a.order=(a.order??EFFECT_STATS).filter(s=>s!==skill)),{disabled:(action.order??EFFECT_STATS).length===1,'aria-label':`Remove ${skill} from drain order`}));
                });
                const unused=statChoices.filter(([id])=>!(action.order??EFFECT_STATS).includes(id));
                if(unused.length)select(order,'Add drained stat','',[['','Choose a stat…'],...unused],v=>{if(v)edit(a=>a.order=[...(a.order??EFFECT_STATS),v]);});
            }
            else if(action.type==='drain-levels'){
                select(grid,'Enemy stat',action.skill,statChoices,v=>edit(a=>a.skill=v));
                select(grid,'Drain based on',action.basis,[[...POLLED_TRIGGERS,'attack'].includes(value.trigger)?null:['dealt','Damage dealt'],['current','Current enemy level']].filter(Boolean),v=>edit(a=>a.basis=v));
                number(grid,'Stat reduction (%)',action.percent,1,100,v=>edit(a=>a.percent=v));
            }
            else {
                if(action.type==='drain'||action.basis!=='flat')number(grid,action.type==='drain'?'Current Defence removed (%)':`${action.type==='heal'?'HP':'Prayer'} recovery (%)`,action.percent,1,100,v=>edit(a=>a.percent=v),.1);
                if(action.type!=='drain') {
                    select(grid,'Recovery based on',action.basis,Object.entries(RECOVERY_BASES).filter(([id])=>![...POLLED_TRIGGERS,'attack'].includes(value.trigger)||!['dealt','rolled'].includes(id)),v=>edit(a=>{a.basis=v;if(v==='flat'&&!a.minimum)a.minimum=10;}));
                    number(grid,action.basis==='flat'?'Points restored':'Minimum recovery',action.minimum,0,100,v=>edit(a=>a.minimum=v));
                }
            }
            const fine=section(group,'Effect details',false);
            number(fine,'Individual effect chance (%)',action.chance??100,0,100,v=>edit(a=>a.chance=v));
            if(action.type==='drain')select(fine,'Defence drain requires',action.trigger??'damage',[['damage','Positive damage'],['accurate','Successful accuracy, including zero']],v=>edit(a=>a.trigger=v));
            if(isSpecial&&['freeze','poison','venom','teleblock'].includes(action.type))select(fine,'Apply effect',action.phase??'impact',[['impact',action.type==='poison'?'At impact after dealing damage':'At impact after an accurate hit'],['launch','On launch, even on a miss']],v=>edit(a=>a.phase=v));
        });
        const withoutDamage=[...POLLED_TRIGGERS,'attack'].includes(value.trigger);
        if(allowAdd&&value.actions.length<4)select(parent,'Add an effect','',[['','Choose an effect…'],...Object.entries(EFFECT_ACTIONS).filter(([type])=>!withoutDamage||type!=='drain-stats')],type=>{if(type)update(v=>{const action=actionDefault(type);if(withoutDamage){if(['heal','prayer'].includes(type)){action.basis='max';action.percent=10;}if(type==='drain-levels')action.basis='current';}v.actions.push(action);});});
    }
    function chooseMode(mode) {
        ui.mode=mode;ui.reference='';
        commit(c=>c.special=mode==='original'?newSpecial():null,s=>{s.specialFrom=-1;});
    }
    function special(parent,c) {
        if(ctx.compactEffects)return combatRules(parent,c.special);
        const area=section(parent,'Special attack'),p=project();
        const mode=c.special?'original':p.settings.specialFrom>=0?'borrow':ui.mode??'none';
        const modes=row(area);
        for(const [id,name] of [['none','None'],['original','Create an attack'],['borrow','Use an existing attack']])modes.append(button(name,()=>run(()=>chooseMode(id)),{'aria-pressed':mode===id}));
        if(mode==='none')return;
        if(mode==='borrow') {
            let selectedId=p.settings.specialFrom,selectedRow;
            referencePicker({...ctx,change:fn=>run(()=>{fn();commit(c=>c.special=selectedRow?newNativeSpecial(selectedRow):null,s=>{s.specialFrom=-1;});})},area,'Special attack weapon','item',p.settings.specialFrom,id=>selectedId=id,{noneLabel:'No borrowed attack',searchRoute:'special-donors?kind=item',onPick:reference=>selectedRow=reference});
            // Keep legacy donor energy and projects compatible. Donor-specific
            // ammunition, powered spells and charging remain native item systems.
            if(p.settings.specialFrom>=0)number(area,'Special energy (%)',p.settings.specialEnergy,1,100,v=>ctx.change(()=>p.settings.specialEnergy=v));
            note(area,'Copies a registered special. Loaded ammunition and powered-spell item systems are separate; a donor does not copy those systems.');
            return;
        }
        if(p.settings.equipmentType!=='WEAPON')note(area,'Choose the Weapon equipment slot before exporting an original special.',true);
        references(area,'special',id=>commit(c=>c.special=effectPreset(id),s=>s.specialFrom=-1));
        area.append(button('Browse native specials',()=>run(()=>chooseMode('borrow'))));
        const s=c.special,update=fn=>run(()=>commit(c=>fn(c.special))),grid=fields(area);
        if(s.nativeFrom!==undefined&&!s.recipe){
            const info=el('p',{class:'effects-note',text:'Uses the complete native attack behavior. Energy and added effects are editable; choose which native settings to replace below.'});grid.before(info);
            const custom=section(area,'Customize native behavior',false);
            for(const [key,label] of [['accuracy','Change accuracy'],['damage','Change damage'],['hits','Change hit count and timing'],['defence','Change defence roll'],['speed','Change attack speed'],['animation','Change player movement']]){
                const input=el('input',{type:'checkbox',checked:s.nativeOverrides.includes(key),'aria-label':label});input.onchange=()=>update(s=>{s.nativeOverrides=input.checked?[...s.nativeOverrides,key]:s.nativeOverrides.filter(v=>v!==key);if(key==='animation'&&input.checked&&s.animation<0)s.animation=1062;});custom.append(el('label',{class:'check'},input,label));
            }
        }

        text(grid,'Attack name',s.name,v=>update(s=>s.name=v));
        select(grid,'Attack style',s.style,[['melee','Melee strike'],['ranged','Ranged shot'],...(s.nativeFrom===undefined?[]:[['magic','Magic attack']])],v=>update(s=>{s.style=v;if(v==='ranged')s.defence='style';}));
        if(s.style==='ranged'&&s.nativeFrom===undefined)note(area,'Choose a ranged weapon style in Equipment. Original ranged specials require a single-projectile profile. Loaded blowpipes and powered spells need their own native item systems.');
        if(s.style==='ranged'&&s.nativeFrom===undefined&&s.hitCount>1)note(area,'Multiple damage hits share one paid projectile.');
        number(grid,'Special energy (%)',s.energy,s.nativeFrom===undefined?1:0,100,v=>update(s=>s.energy=v));
        number(grid,'Number of hits',s.hitCount,1,4,v=>update(s=>{s.hitCount=v;s.hitDelayTicks=Array.from({length:v},(_,i)=>s.hitDelayTicks[i]??s.hitDelayTicks.at(-1)??0);}));
        const movement=section(area,'Movement');
        if(!ctx.compactEffects)select(movement,'Named attack movement',s.animation,[...(!EFFECT_ANIMATIONS.some(([id])=>id===s.animation)?[[s.animation,s.animation<0?'Keep native movement':`Chosen cache movement ${s.animation}`]]:[]),...EFFECT_ANIMATIONS],v=>update(s=>s.animation=Number(v)));
        else note(movement,EFFECT_ANIMATIONS.find(([id])=>id===s.animation)?.[1]??`Current movement: ${s.animation<0?'native':s.animation}`);
        if(ctx.chooseMovement)movement.append(button('Browse player movements',()=>ctx.chooseMovement(s.animation,id=>update(s=>s.animation=id)),{disabled:s.nativeFrom!==undefined&&!s.nativeOverrides.includes('animation')}));
        else referencePicker({...ctx,change:fn=>run(fn)},movement,'Other character animation','seq',s.animation,id=>update(s=>s.animation=id),{required:true,visual:false,searchRoute:'character-animations?actor=player'});
        const previewRow=row(movement);
        previewRow.append(button('Play animation',()=>playAnimation(),{disabled:!ctx.viewport?.play}),button('Stop animation',()=>{if(ctx.stopEffectPreview)return ctx.stopEffectPreview();serial++;ctx.stop?.();state.playing=false;ctx.renderView?.();}));
        const advanced=section(area,'Advanced',false);
        number(advanced,'Damage (%)',s.damageMultiplier*100,10,500,v=>update(s=>{s.damageMultiplier=v/100;delete s.damageStages;}),.1);
        number(advanced,'Accuracy (%)',s.accuracyMultiplier*100,10,500,v=>update(s=>s.accuracyMultiplier=v/100),.1);
        select(advanced,'Accuracy rolls',s.sharedAccuracy?'shared':'independent',[['independent','One roll for each hit'],['shared','One shared roll for every hit']],v=>update(s=>s.sharedAccuracy=v==='shared'));
        number(advanced,'Minimum successful damage (%)',(s.minimumDamageMultiplier??0)*100,0,300,v=>update(s=>s.minimumDamageMultiplier=v/100));
        number(advanced,'Maximum successful damage (%)',(s.maximumDamageMultiplier??1)*100,0,300,v=>update(s=>s.maximumDamageMultiplier=v/100));
        number(advanced,'Enemy defence roll (%)',(s.defenceRollMultiplier??1)*100,10,200,v=>update(s=>s.defenceRollMultiplier=v/100));
        select(advanced,'Attack duration',s.attackSpeedTicks??'weapon',[['weapon','Use weapon speed'],...Array.from({length:20},(_,i)=>[i+1,`${((i+1)*.6).toFixed(1)} seconds`])],v=>update(s=>{if(v==='weapon')delete s.attackSpeedTicks;else s.attackSpeedTicks=Number(v);}));
        const hits=section(advanced,'Hit timing',false);
        s.hitDelayTicks.forEach((tick,i)=>number(hits,`Hit ${i+1} delay (ticks)`,tick,0,8,v=>update(s=>s.hitDelayTicks[i]=v)));
        note(hits,'One tick is 0.6 seconds. These native delays stagger hitsplats after the first impact. Added recovery and enemy effects wait for the attack’s actual damage.');
        if(!ctx.compactEffects){const effects=section(area,'Enemy and recovery effects',s.actions.length>0);if(s.actions.length)number(effects,'Effect chance (%)',s.chance,0,100,v=>update(s=>s.chance=v),.1);actionEditor(effects,s,update,true);}
        if(s.style==='melee')select(advanced,'Enemy defence',s.defence,[['style','Current melee style'],['stab','Stab'],['slash','Slash'],['crush','Crush']],v=>update(s=>s.defence=v));
        if(ctx.chooseGraphic)advanced.append(button('Browse attack VFX',()=>ctx.chooseGraphic(s.graphic,id=>update(s=>s.graphic=id))),button('Remove base attack VFX',()=>update(s=>s.graphic=-1),{disabled:s.graphic<0}));
        else referencePicker({...ctx,change:fn=>run(fn)},advanced,'Attack graphic','effect',s.graphic,id=>update(s=>s.graphic=id),{visual:false});
        if(s.damageStages) {
            note(advanced,'Damage rounds down after each stage. Changing Damage (%) replaces these stages.');
            s.damageStages.forEach((v,i)=>number(advanced,`Damage stage ${i+1} (%)`,v*100,10,300,v=>update(s=>s.damageStages[i]=v/100),.1));
            advanced.append(button('Use one damage multiplier',()=>update(s=>delete s.damageStages)));
        } else advanced.append(button('Use two damage stages',()=>update(s=>s.damageStages=[s.damageMultiplier,1])));
        area.append(advanced);damagePreview(area,s);
        if(s.nativeFrom!==undefined&&!s.recipe){
            area.querySelector('[aria-label="Attack style"]').disabled=true;
            if(!s.nativeOverrides.includes('hits'))area.querySelectorAll('[aria-label]').forEach(input=>{if(/^Hit \d+ delay/.test(input.getAttribute('aria-label')))input.disabled=true;});
            const groups={accuracy:['Accuracy (%)'],damage:['Damage (%)','Minimum successful damage (%)','Maximum successful damage (%)'],hits:['Number of hits','Accuracy rolls'],defence:['Enemy defence','Enemy defence roll (%)'],speed:['Attack duration'],animation:['Named attack movement','Other character animation']};
            for(const [key,labels] of Object.entries(groups))if(!s.nativeOverrides.includes(key))for(const label of labels)area.querySelectorAll('[aria-label]').forEach(input=>{if(input.getAttribute('aria-label')===label)input.disabled=true;});
        }
    }
    function combatRules(parent,s){
        if(!s)return;
        if(s.recipe){const movement=section(parent,'Attack movement',false);movement.append(button('Browse player movements',()=>ctx.chooseMovement(s.animation,id=>run(()=>commit(c=>c.special.animation=id)))));parent.append(button('Remove special attack',()=>run(()=>commit(c=>c.special=null))));return;}
        const area=el('div',{class:'effects-combat-rules'});parent.append(area);
        const update=(key,fn)=>run(()=>commit(c=>{fn(c.special);if(c.special.nativeFrom!==undefined&&!c.special.nativeOverrides.includes(key))c.special.nativeOverrides.push(key);}));
        const pattern=section(area,'Hit pattern',true),hits=fields(pattern);
        number(hits,'Number of hits',s.hitCount,1,4,v=>update('hits',r=>{r.hitCount=v;r.hitDelayTicks=Array.from({length:v},(_,i)=>r.hitDelayTicks[i]??r.hitDelayTicks.at(-1)??0);}));
        s.hitDelayTicks.forEach((tick,i)=>number(hits,`Hit ${i+1} delay (ticks)`,tick,0,8,v=>update('hits',r=>r.hitDelayTicks[i]=v)));
        select(hits,'Accuracy rolls',s.sharedAccuracy?'shared':'independent',[['independent','One roll for each hit'],['shared','One shared roll for every hit']],v=>update('hits',r=>r.sharedAccuracy=v==='shared'));
        note(pattern,'Hit delays follow the first impact. One tick is 0.6 seconds. Native split-damage rules remain active.');
        const bounds=section(area,'Damage bounds and defence',false);
        number(bounds,'Minimum successful damage (%)',(s.minimumDamageMultiplier??0)*100,0,300,v=>update('damage',r=>r.minimumDamageMultiplier=v/100));
        number(bounds,'Maximum successful damage (%)',(s.maximumDamageMultiplier??1)*100,0,300,v=>update('damage',r=>r.maximumDamageMultiplier=v/100));
        number(bounds,'Enemy defence roll (%)',(s.defenceRollMultiplier??1)*100,10,200,v=>update('defence',r=>r.defenceRollMultiplier=v/100));
        if(s.style==='melee')select(bounds,'Enemy defence',s.defence,[['style','Weapon style'],['stab','Stab'],['slash','Slash'],['crush','Crush']],v=>update('defence',r=>r.defence=v));
        const speed=section(area,'Attack speed',false);
        select(speed,'Attack duration',s.attackSpeedTicks??'weapon',[['weapon','Use weapon speed'],...Array.from({length:20},(_,i)=>[i+1,`${i+1} ticks · ${((i+1)*.6).toFixed(1)} s`])],v=>update('speed',r=>{if(v==='weapon')delete r.attackSpeedTicks;else r.attackSpeedTicks=Number(v);}));
        const movement=section(area,'Player movement',false);note(movement,EFFECT_ANIMATIONS.find(([id])=>id===s.animation)?.[1]??`Movement ${s.animation}`);
        movement.append(button('Browse player movements',()=>ctx.chooseMovement(s.animation,id=>update('animation',r=>r.animation=id))));
        if(s.nativeFrom!==undefined)area.append(button('Restore native combat values',async()=>{const original=project(),result=await ctx.api(`special-donors?q=${s.nativeFrom}`),reference=result.rows.find(row=>row.id===s.nativeFrom);if(project()!==original||!reference)return;const initial=newNativeSpecial(reference);commit(c=>{for(const key of ['modifiers','damageMultiplier','accuracyMultiplier','damageStages','hitCount','hitDelayTicks','defence','animation','sharedAccuracy','minimumDamageMultiplier','maximumDamageMultiplier','defenceRollMultiplier','attackSpeedTicks']){if(initial[key]===undefined)delete c.special[key];else c.special[key]=structuredClone(initial[key]);}c.special.nativeOverrides=[];});}));
        area.append(button('Remove special attack',()=>run(()=>commit(c=>c.special=null))));
    }
    function damagePreview(parent,s) {
        if(s.nativeFrom!==undefined&&!s.recipe){note(parent,'The native attack keeps its hit distribution, targeting, projectiles, utility actions and delayed behavior. The stage previews its presentation; combat resolves through the native engine.');return;}
        const area=section(parent,'Damage preview'),result=previewSpecial(s,ui.preview),summary=el('output',{'aria-live':'polite',class:'effects-preview-summary',text:`0–${result.maximumTotal} damage · ${(result.accuracy*100).toFixed(1)}% hit chance · ${result.energyUses} uses per full bar`});area.append(summary);
        const timeline=el('ol',{class:'effects-hit-preview','aria-label':'Damage hit preview'});area.append(timeline);
        result.hits.forEach((hit,i)=>timeline.append(el('li',{},el('strong',{text:`${i+1}`}),el('span',{text:`0–${hit.maximum}`}),el('small',{text:hit.tick?`+${hit.seconds.toFixed(1)} s`:'At impact'}))));
        note(area,`Average ${result.expected.toFixed(1)} damage for this example target, before protection and HP caps. ${result.sharedAccuracy?'All hits share one accuracy roll.':'Each hit rolls its own accuracy.'}`);
        const target=section(area,'Try a target',false),grid=fields(target);
        number(grid,'Your normal max hit',ui.preview.maxHit,0,10000,v=>{ui.preview.maxHit=v;rerender();});
        number(grid,'Your final attack roll',ui.preview.attackRoll,0,100000000,v=>{ui.preview.attackRoll=v;rerender();});
        number(grid,'Enemy final defence roll',ui.preview.defenceRoll,0,100000000,v=>{ui.preview.defenceRoll=v;rerender();});
        note(target,'Rolls are the final native combat rolls after levels and equipment bonuses. This preview uses those supplied values, not a live player.');
    }
    function passive(parent,c) {
        if(ctx.compactEffects){
            if(!c.passives.length)return;
            const index=Math.max(0,Math.min(ui.index,c.passives.length-1)),p=c.passives[index],update=fn=>run(()=>commit(c=>fn(c.passives[index]))),area=section(parent,'Equipment requirements');
            const check=el('input',{type:'checkbox',checked:!!p.set,'aria-label':'Require an equipment set'});check.onchange=()=>update(p=>p.set=check.checked?(state.gearSet?fullSetRequirement(state.gearSet,project().id):{required:1,pieces:[{slot:SLOT_BY_TYPE[project().settings.equipmentType]??3,itemIds:['self']}] }):null);area.append(el('label',{class:'check'},check,'Require an equipment set'));if(p.set)setEditor(area,p,update);
            passivePreview(parent,p);parent.append(button('Delete effect',()=>run(()=>commit(c=>c.passives.splice(index,1)))));return;
        }
        const area=section(parent,'Passive and set effects');
        if(state.gearSet){note(area,'These items belong together. A set bonus is optional and only needs to be added to one item.');area.append(button('Create a set bonus',()=>run(()=>addPassive({...newPassive(),name:`${state.gearSet.name} bonus`.slice(0,60),set:fullSetRequirement(state.gearSet,project().id)})),{disabled:c.passives.length>=8||project().settings.equipmentType==='NONE',title:project().settings.equipmentType==='NONE'?'Select an equippable item to hold the set bonus.':''}));}
        if(project().settings.equipmentType==='NONE'&&c.passives.length)note(area,'Choose an equipment slot before exporting passive effects.',true);
        references(area,'passive',id=>{
            const value=effectPreset(id),ownSlot=SLOT_BY_TYPE[project().settings.equipmentType];
            const ownPiece=value.set?.pieces.find(p=>p.slot===ownSlot);
            if(ownPiece)ownPiece.itemIds=['self'];
            if(state.gearSet)value.set=fullSetRequirement(state.gearSet,project().id);
            addPassive(value);
        });
        area.append(button('Create an effect',()=>run(()=>addPassive(newPassive())),{disabled:c.passives.length>=8}));
        if(!c.passives.length)return;
        note(area,'Effects apply to the actual attack, including hits split across several damage numbers or delayed hits. Recovery uses HP actually lost when the hits land.');
        const index=Math.max(0,Math.min(ui.index,c.passives.length-1));ui.index=index;
        select(area,'Edit effect',index,c.passives.map((p,i)=>[i,p.name]),v=>{ui.index=Number(v);ui.reference='';rerender();});
        const p=c.passives[index],update=fn=>run(()=>commit(c=>fn(c.passives[index]))),grid=fields(area);
        text(grid,'Effect name',p.name,v=>update(p=>p.name=v));
        select(grid,'Which attacks?',p.style,[['any','All combat styles'],['melee','Melee'],['ranged','Ranged'],['magic','Magic']],v=>update(p=>p.style=v));
        if(!ctx.compactEffects)renderEffectTriggers(ctx,area,p,update);
        if(p.trigger==='accurate')number(grid,'Add damage to the existing hit',p.bonusDamage,0,100,v=>update(p=>p.bonusDamage=v));
        actionEditor(area,p,update);
        const setBox=el('input',{type:'checkbox',checked:!!p.set,'aria-label':'Require an equipment set'});
        setBox.onchange=()=>update(p=>p.set=setBox.checked?(state.gearSet?fullSetRequirement(state.gearSet,project().id):{required:1,pieces:[{slot:SLOT_BY_TYPE[project().settings.equipmentType]??3,itemIds:['self']}] }):null);
        area.append(el('label',{class:'check'},setBox,'Require an equipment set'));
        if(p.set)setEditor(area,p,update);
        passivePreview(area,p);
        area.append(button('Delete effect',()=>run(()=>commit(c=>c.passives.splice(index,1)))));
    }
    function passivePreview(parent,p) {
        const area=section(parent,'Effect preview'),r=previewPassive(p,ui.passivePreview),outcomes=[...POLLED_TRIGGERS,'attack'].includes(p.trigger)?[]:[`${r.dealt} damage${['taken','hit-received'].includes(p.trigger)?' taken':''}`];
        if(r.extraDamage)outcomes.push(`${r.extraDamage} added to the existing hit`);
        if(r.heal)outcomes.push(`heal ${r.heal}`);
        if(r.prayer)outcomes.push(`restore ${r.prayer} prayer`);
        if(r.defenceRemoved)outcomes.push(`remove ${r.defenceRemoved} Defence`);
        if(r.statDrain)outcomes.push(`drain ${r.statDrain} stat levels`);
        if(r.freezeTicks)outcomes.push(`freeze for ${(r.freezeTicks*.6).toFixed(1)} seconds`);
        if(r.poisonDamage)outcomes.push(`poison starting at ${r.poisonDamage} damage`);
        area.append(el('output',{class:'effects-preview-summary','aria-live':'polite',text:`${(r.chance*100).toFixed(1)}% activation chance. When it activates: ${outcomes.join(', ')}.`}));
        for(const action of p.actions)if((action.chance??100)<100)note(area,`${EFFECT_ACTIONS[action.type]} rolls its own ${action.chance}% chance. The amount above shows a successful activation.`);
        const inputs=section(area,'Example values',false),grid=fields(inputs);
        if(![...POLLED_TRIGGERS,'attack'].includes(p.trigger)){number(grid,'Example damage before the enemy HP limit',ui.passivePreview.rolledDamage,0,10000,v=>{ui.passivePreview.rolledDamage=v;rerender();});number(grid,'Enemy hitpoints',ui.passivePreview.targetHp,0,1000000,v=>{ui.passivePreview.targetHp=v;rerender();});}
        for(const [key,label,defaultValue] of [['maxHp','Maximum HP',99],['currentHp','Current HP',50],['maxPrayer','Maximum Prayer',99],['currentPrayer','Current Prayer',50]])number(grid,label,ui.passivePreview[key]??defaultValue,0,10000,v=>{ui.passivePreview[key]=v;rerender();});
        const previewStats=new Set(p.actions.flatMap(a=>a.type==='drain'?['defence']:a.type==='drain-levels'?[a.skill]:a.type==='drain-stats'?(a.order??EFFECT_STATS):[]));
        for(const skill of previewStats)number(grid,`Enemy current ${statChoices.find(([id])=>id===skill)[1]}`,ui.passivePreview.enemyLevels[skill]??(skill==='defence'?ui.passivePreview.enemyDefence:100),0,10000,v=>{ui.passivePreview.enemyLevels[skill]=v;rerender();});
        note(inputs,'Example assumes the trigger, conditions and equipment requirements are met. Actual recovery stops at your maximum levels.');
    }
    function addPassive(value) {
        const ids=new Set(config().passives.map(p=>p.id));let n=1;
        while(ids.has(`effect-${n}`))n++;
        value.id=`effect-${n}`;ui.index=config().passives.length;
        commit(c=>c.passives.push(value));
    }
    function setEditor(parent,p,update) {
        const area=section(parent,'Set pieces');
        if(state.gearSet)area.append(button('Use all items in this set',()=>update(p=>p.set=fullSetRequirement(state.gearSet,project().id))));
        number(area,'Required pieces',p.set.required,1,p.set.pieces.length,v=>update(p=>p.set.required=v));
        note(area,'Wear this creation and the required pieces. Any pictured alternative can fill its slot.');
        p.set.pieces.forEach((piece,index)=>{
            const part=el('div',{class:'effects-piece'});area.append(part);
            const title=row(part);title.append(el('strong',{text:SLOTS.find(([slot])=>slot===piece.slot)?.[1]}),button('Remove slot',()=>update(p=>{if(p.set.pieces.length===1){p.set=null;return;}p.set.pieces.splice(index,1);p.set.required=Math.min(p.set.required,p.set.pieces.length);})));
            const idInput=el('input',{type:'text',value:piece.itemIds.filter(id=>typeof id==='number'||id==='self').join(', '),'aria-label':`${SLOTS.find(([slot])=>slot===piece.slot)?.[1]} item IDs`});
            idInput.onchange=()=>update(p=>{
                const raw=idInput.value.trim().split(/[\s,]+/).filter(Boolean);
                if(raw.some(id=>id!=='self'&&!/^\d{1,5}$/.test(id)))throw new Error('Enter item IDs separated by commas, or self for this creation.');
                p.set.pieces[index].itemIds=[...piece.itemIds.filter(id=>referencedItem(id)),...raw.filter(Boolean).map(id=>id==='self'?id:Number(id))];
            });const identifiers=section(part,'Native item IDs',false);identifiers.append(el('label',{},'Alternative item IDs',idInput));
            const items=el('div',{class:'effects-pieces'});part.append(items);
            for(const id of piece.itemIds) {
                const label=el('span',{text:id==='self'?project().name:referencedItem(id)?state.gearSet?.items.find(item=>item.id===referencedItem(id))?.name??'Missing set item':'Loading item…'}),chip=el('span',{class:'effects-piece-choice'},label);items.append(chip);
                if(piece.itemIds.length>1)chip.append(button('Remove',()=>update(p=>p.set.pieces[index].itemIds=piece.itemIds.filter(value=>value!==id)),{'aria-label':`Remove ${id==='self'?'this creation':'alternative'} from ${SLOTS.find(([slot])=>slot===piece.slot)?.[1]}`}));
                if(id==='self'||referencedItem(id)){
                    const item=id==='self'?project():state.gearSet?.items.find(item=>item.id===referencedItem(id));
                    if(item&&ctx.thumbnail){const canvas=el('canvas',{width:52,height:48,class:'effects-custom-picture','aria-hidden':'true'});chip.prepend(canvas);ctx.thumbnail(canvas,assemble(item.parts,'inventory'),{kind:'item',variant:'inventory',fields:item.settings});}
                }else {
                    referencePicture(ctx,chip,'item',id,`Set item ${id}`);
                    if(!names.has(id)) {
                        names.set(id,ctx.api(`search?kind=item&q=${id}&references=1`).then(result=>result.rows.find(row=>row.id===id)?.name??`Custom item ${id}`).catch(()=>`Item ${id}`));
                        if(names.size>128)names.delete(names.keys().next().value);
                    }
                    names.get(id).then(name=>{if(label.isConnected)label.textContent=name.replace(/_/g,' ');});
                }
            }
            const controls=row(part);
            if(!state.gearSet&&!piece.itemIds.includes('self'))controls.append(button('Use this creation',()=>update(p=>p.set.pieces[index].itemIds=['self'])));
            if(state.gearSet){
                const choices=state.gearSet.items.filter(item=>equipmentSlot(item)===piece.slot&&!piece.itemIds.includes(item.id===project().id?'self':itemReference(item.id)));
                if(choices.length)select(part,'Add a custom alternative','',[['','Choose an item…'],...choices.map(item=>[item.id,item.name])],id=>{if(id)update(p=>p.set.pieces[index].itemIds.push(id===project().id?'self':itemReference(id)));});
            }
            const native=state.gearSet?section(part,'Native alternatives',false):part;
            referencePicker({...ctx,change:fn=>run(fn)},native,`Add ${SLOTS.find(([slot])=>slot===piece.slot)?.[1].toLowerCase()} alternative`,'item',-1,id=>update(p=>p.set.pieces[index].itemIds.push(id)),{required:true,references:true});
        });
        const available=SLOTS.filter(([slot])=>!p.set.pieces.some(p=>p.slot===slot)&&(!state.gearSet||state.gearSet.items.some(item=>equipmentSlot(item)===slot)));
        if(available.length)select(area,'Add a set slot','',[['','Choose a slot…'],...available],slot=>{if(slot!=='')update(p=>p.set.pieces.push({slot:Number(slot),itemIds:[state.gearSet?.items.find(item=>equipmentSlot(item)===Number(slot))].filter(Boolean).map(item=>item.id===project().id?'self':itemReference(item.id)).concat(!state.gearSet?['self']:[])}));});
    }
    async function playAnimation() {
        if(ctx.previewEffect)return ctx.previewEffect();
        const p=project(),animation=config().special?.animation;if(animation===undefined)return;
        const ticket=++serial,snapshot=JSON.stringify(p),variant=['male','female'].includes(state.variant)?state.variant:'male';
        try {
            ctx.stop?.();ctx.status('Loading attack animation…');
            const members=state.gearSet&&state.previewSet?equippedItems(ctx.currentDocument(),state.setEquipment,p.id):[p];
            const mannequin=await ctx.api(`mannequin?gender=${variant}&slots=${encodeURIComponent(members.map(item=>item.settings.equipmentType).join(','))}`);
            const parts=state.gearSet&&state.previewSet?equippedParts(ctx.currentDocument(),state.setEquipment,p.id):p.parts;
            const mesh=assemble([...parts,{id:'effects-player',variant,visible:true,mesh:mannequin.mesh}],variant);
            if(!mesh.vertices.length)throw new Error('Add a worn model before previewing this attack.');
            const clip=await ctx.api('animate',{mesh,sequence:animation,samples:Math.max(2,Math.min(32,Math.floor(260000/mesh.vertices.length)))});
            if(ticket!==serial||project()!==p||JSON.stringify(p)!==snapshot||!root?.isConnected)return;
            if(!clip?.frames?.length)throw new Error('This cache animation has no playable frames.');
            state.poseIndex=null;ctx.viewport.play(clip);state.playing=true;ctx.status('Playing the attack on the player rig.');
        } catch(error) {if(ticket===serial)ctx.status(error.message,true);}
    }
    function renderInline(parent) {
        context();if(project()?.kind!=='gear')return;
        root=el('div',{class:'gear-effects'});parent.append(root);
        try {const c=config();special(root,c);passive(root,c);}catch(error){note(root,error.message,true);}
    }
    function renderProperties(parent) {parent.replaceChildren();renderInline(parent);}
    function renderTools(parent) {
        context();toolsRoot=parent;parent.replaceChildren();if(project()?.kind!=='gear')return;
        parent.append(el('h2',{text:'Gear effects'}));
        try {const c=config();note(parent,c.special?`${c.special.name}: ${c.special.hitCount} ${c.special.hitCount===1?'hit':'hits'}, ${c.special.energy}% energy.`:'Choose an original special or keep a native borrowed attack.');note(parent,`${c.passives.length} passive or set ${c.passives.length===1?'effect':'effects'}.`);}catch(error){note(parent,error.message,true);}
    }
    function reset() {serial++;identity=undefined;root=undefined;toolsRoot=undefined;names.clear();ctx.stop?.();}
    function renderSection(parent,kind) {
        context();if(project()?.kind!=='gear')return;
        root=el('div',{class:'gear-effects'});parent.append(root);
        try{const c=config();if(kind==='special')special(root,c);else passive(root,c);}catch(error){note(root,error.message,true);}
    }
    function selectedRule(kind){context();const c=config();return kind==='special'?c.special:c.passives[Math.max(0,Math.min(ui.index,c.passives.length-1))];}
    function updateVisuals(kind,fn){commit(c=>{const rule=kind==='special'?c.special:c.passives[Math.max(0,Math.min(ui.index,c.passives.length-1))];if(!rule)throw new Error('Create an effect first.');fn(rule);});}
    function renderActions(parent,kind){context();const value=selectedRule(kind);if(!value)return;const area=el('div',{class:'gear-effects combat-rule-actions'});parent.append(area);const update=fn=>updateVisuals(kind,fn);if(ctx.compactEffects&&kind==='special'&&value.actions.length){const group=el('section',{class:'combat-action-group'},el('h3',{text:'Recovery & control'}));area.append(group);number(group,'Shared activation chance (%)',value.chance,0,100,v=>update(s=>s.chance=v),.1);note(group,'One roll per attack gates the effects in this group. Each effect also has its own activation chance.');actionEditor(group,value,update,true,false);}else actionEditor(area,value,update,kind==='special',!ctx.compactEffects);}
    return {removeSpecial(){commit(c=>c.special=null);},renderInline,renderProperties,renderTools,renderSection,renderActions,selectedRule,updateVisuals,reset,playAnimation,createPassive:addPassive,addAction(kind,type,values={}){if(!EFFECT_ACTIONS[type])throw new Error('Choose an effect.');updateVisuals(kind,rule=>rule.actions.push({...actionDefault(type),...values,type}));},selectPassive(index){context();ui.index=index;rerender();},useSpecial(value){commit(c=>c.special=value.nativeFrom===undefined?materializeSpecial(value):value,s=>s.specialFrom=-1);}};
}
