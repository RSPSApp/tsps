import { newAttack, attackRole, withPartAttack } from '/shared/creature-attacks.mjs';
import { referencePicker } from '/picker.mjs';

/** Modular attack selector, donor preview and mechanics editor. All mutations use
 * the host's normal change/undo path. Also usable in the Game data panel. */
export function createCreatureAttacks(ctx) {
    const {state,element:el,button,api}=ctx, catalogs=new Map();let serial=0;
    const rows=()=>state.project?.attacks??[];
    const selected=()=>rows().find(a=>attackRole(a.id)===state.motionRole);
    const choose=id=>{ctx.stop?.();state.motionRole=id?attackRole(id):'attack';state.poseIndex=null;ctx.render?.();};
    const change=fn=>ctx.change(fn);
    const section=(target,title)=>{const node=el('section',{class:'creature-attacks'},el('h3',{text:title}));target.append(node);return node;};
    const note=(target,text)=>target.append(el('p',{class:'animate-note',text}));
    async function choices(part){
        if(!catalogs.has(part.source.id))catalogs.set(part.source.id,api(`creature-attacks?id=${part.source.id}`).catch(e=>{catalogs.delete(part.source.id);throw e;}));
        if(catalogs.size>12)catalogs.delete(catalogs.keys().next().value);return catalogs.get(part.source.id);
    }
    async function useChoice(choice,keep){
        const original=state.project,part=ctx.selected(),stamp=JSON.stringify(original),originalRole=state.motionRole,mode=state.mode,token=++serial;
        if(!part||part.mesh.vertexLinks)throw new Error('Choose the original head, limb or body.');
        let candidate=structuredClone(original),attack=selected();
        if(!attack){attack=newAttack(candidate,choice.name);candidate.attacks??=[];candidate.attacks.push(attack);attack.style=choice.style;attack.range=choice.style==='MELEE'?1:10;}
        candidate=withPartAttack(candidate,attack.id,part.id,choice);
        ctx.status?.(`Trying ${choice.name} on ${part.name}...`);
        const clip=await api('animate-project',{project:candidate,role:attackRole(attack.id)});
        if(token!==serial||state.project!==original||JSON.stringify(original)!==stamp||ctx.selected()?.id!==part.id||state.motionRole!==originalRole||state.mode!==mode)return;
        if(!clip?.frames?.length)throw new Error('This movement has no usable frames on the source rig. Choose another attack.');
        if(keep){change(()=>{original.attacks=candidate.attacks;state.motionRole=attackRole(attack.id);});ctx.status?.(`Kept ${choice.name} on ${part.name}. Other body movements stay as authored.`);}
        ctx.stop?.();ctx.viewport.play(clip);state.playing=true;
        if(!keep)ctx.status?.(`Trying ${choice.name}. Use keeps this part's movement.`);
    }
    function renderSelector(target){
        if(state.project?.kind!=='npc')return;
        const root=section(target,'Attacks'),select=el('select',{'aria-label':'Attack to edit'},el('option',{value:'',text:'Primary attack',selected:!selected()}),...rows().map(a=>el('option',{value:a.id,text:`${a.name} (${a.style[0]+a.style.slice(1).toLowerCase()})`,selected:selected()?.id===a.id})));
        select.addEventListener('change',()=>choose(select.value));root.append(select);
        const actions=el('div',{class:'animate-actions'});root.append(actions);
        actions.append(button('Add attack',()=>change(()=>{const a=newAttack(state.project,`Attack ${rows().length+1}`);state.project.attacks??=[];state.project.attacks.push(a);state.motionRole=attackRole(a.id);}),{disabled:rows().length>=8}),button('Remove attack',()=>change(()=>{const a=selected();if(!a)return;state.project.attacks=rows().filter(r=>r!==a);for(const p of state.project.parts){delete p.motion?.keys?.[attackRole(a.id)];delete p.motion?.sequences?.[attackRole(a.id)];}state.motionRole='attack';}),{disabled:!selected()}));
        const part=ctx.selected();if(!part||part.source.kind!=='npc'||part.mesh.vertexLinks)return;
        const donors=el('div',{class:'creature-attack-choices'});root.append(donors);
        const project=state.project,partId=part.id;
        choices(part).then(result=>{
            if(!donors.isConnected||state.project!==project||ctx.selected()?.id!==partId)return;
            if(!result.rows.length){note(donors,'No named attacks are recorded for this source. Make poses below, or choose another part.');return;}
            for(const choice of result.rows){const row=el('div',{class:'creature-attack-choice'},el('strong',{text:choice.name}),button('Try',()=>useChoice(choice,false),{'aria-label':`Try ${choice.name} on ${part.name}`}),button('Use',()=>useChoice(choice,true),{'aria-label':`Use ${choice.name} on ${part.name}`}));donors.append(row);}
        }).catch(error=>{if(donors.isConnected)note(donors,error.message);});
        note(root,`Source attacks move ${part.name}. The other parts keep their attack movement.`);
    }
    function renderProperties(target){
        const attack=selected();if(!attack)return;
        const root=section(target,'Attack rules');
        function field(label,value,set,type='number',attrs={}){const input=el('input',{type,value,...attrs,'aria-label':label});input.addEventListener('change',()=>{const value=type==='number'?Number(input.value):input.value;if(type==='number'&&(!Number.isInteger(value)||value<Number(attrs.min)||value>Number(attrs.max))){input.value=String(attack[attrs.key]??'');ctx.status?.(`Choose ${label.toLowerCase()} between ${attrs.min} and ${attrs.max}.`,true);return;}change(()=>set(value));});root.append(el('label',{class:'creature-attack-field'},label,input));}
        field('Attack name',attack.name,value=>attack.name=value,'text',{maxlength:60});
        const style=el('select',{'aria-label':'Attack style'},...['MELEE','RANGED','MAGIC'].map(value=>el('option',{value,text:value[0]+value.slice(1).toLowerCase(),selected:attack.style===value})));
        style.addEventListener('change',()=>change(()=>{attack.style=style.value;attack.range=style.value==='MELEE'?1:10;}));root.append(el('label',{class:'creature-attack-field'},'Style',style));
        for(const [label,key,min,max] of [['Damage cap','maxHit',0,state.project.settings.maxHit],['Attack speed (ticks)','speed',1,100],['Hit delay (ticks)','delay',0,20],['Reach (tiles)','range',1,attack.style==='MELEE'?1:30]])field(label,attack[key],v=>attack[key]=v,'number',{min,max,key});
        const mode=el('select',{'aria-label':'Choose attacks'},el('option',{value:'cycle',text:'Take turns',selected:state.project.attackMode!=='random'}),el('option',{value:'random',text:'Random',selected:state.project.attackMode==='random'}));
        mode.addEventListener('change',()=>change(()=>state.project.attackMode=mode.value));root.append(el('label',{class:'creature-attack-field'},'Choose attacks',mode));
        if(state.project.attackMode==='random')field('Chance weight',attack.weight,v=>attack.weight=v,'number',{min:1,max:100,key:'weight'});
        referencePicker(ctx,root,'Attack projectile','effect',attack.projectileId,v=>attack.projectileId=v,{noneLabel:'No projectile',visual:false});
        referencePicker(ctx,root,'Attack launch effect','effect',attack.launchGraphicId,v=>attack.launchGraphicId=v,{noneLabel:'No launch effect',visual:false});
        const movement=attack.parts[ctx.selected()?.id];if(movement){field('Movement speed',Math.round(movement.speed*100),v=>movement.speed=v/100,'number',{min:10,max:400});}
        const row=el('div',{class:'animate-actions'},button('Play this attack',async()=>{
            const project=state.project,role=attackRole(attack.id),token=++serial,clip=await api('animate-project',{project,role});if(token!==serial||state.project!==project||state.motionRole!==role)return;if(!clip?.frames?.length)throw new Error('Choose source movement or add poses first.');ctx.stop?.();ctx.viewport.play(clip);state.playing=true;
        }));root.append(row);
        note(root,'The primary attack joins this rotation when it has movement. Damage uses creature stats and protection prayers. The cap can lower its max hit. Boss AI, summons, prayer reading and arena hazards need a separate gameplay plugin.');
    }
    return {renderSelector,renderProperties,selected,choose,choices,useChoice,reset(){serial++;catalogs.clear();}};
}
