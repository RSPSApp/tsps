import {EFFECT_TRIGGERS,POLLED_TRIGGERS} from '../shared/effects.mjs';

export function changeEffectTrigger(rule,trigger){
    rule.trigger=trigger;delete rule.intervalTicks;delete rule.thresholdPercent;
    if(trigger==='interval')rule.intervalTicks=10;
    if(['hp-below','prayer-below'].includes(trigger))rule.thresholdPercent=25;
    if(trigger!=='accurate')rule.bonusDamage=0;
    if(POLLED_TRIGGERS.includes(trigger))rule.style='any';
    if([...POLLED_TRIGGERS,'attack'].includes(trigger))rule.actions=rule.actions.map(action=>{
        if(['heal','prayer'].includes(action.type)&&['dealt','rolled'].includes(action.basis))return {...action,basis:'max',percent:10};
        if(action.type==='drain-stats')return {type:'drain-levels',skill:'defence',percent:10,basis:'current'};
        if(action.type==='drain-levels'&&action.basis==='dealt')return {...action,basis:'current',percent:10};
        return action;
    });
}
export function activationSummary(rule){
    const event=rule.trigger==='interval'?`Every ${rule.intervalTicks} ticks (${(rule.intervalTicks*.6).toFixed(1)} s)`:['hp-below','prayer-below'].includes(rule.trigger)?`${rule.trigger==='hp-below'?'HP':'Prayer'} crosses to ${rule.thresholdPercent}% or below`:EFFECT_TRIGGERS[rule.trigger];
    return `${event}. ${rule.chance}% activation chance${rule.cooldownTicks?`, ${rule.cooldownTicks} tick cooldown (${(rule.cooldownTicks*.6).toFixed(1)} s)`:''}.`;
}
export function renderEffectTriggers(ctx,parent,rule,update){
    const {element:el}=ctx;
    function field(label,value,fn,{min=0,max=100,step=1,options}={}){
        const input=options?el('select',{'aria-label':label},...options.map(([id,name])=>el('option',{value:id,text:name,selected:String(id)===String(value)}))):el('input',{type:'number',value,min,max,step,'aria-label':label});
        input.onchange=()=>{const value=options?input.value:Number(input.value);if(!options&&(!input.value.trim()||!Number.isFinite(value)||value<min||value>max||step===1&&!Number.isInteger(value))){input.setCustomValidity(`Enter ${step===1?'a whole number':'a number'} from ${min} to ${max}.`);input.reportValidity();return;}input.setCustomValidity('');update(r=>fn(r,value));};
        return el('label',{},label,input);
    }
    const box=el('section',{class:'combat-activation'},el('h3',{text:'Activation'}));parent.append(box);
    box.append(field('Activation trigger',rule.trigger,(r,v)=>changeEffectTrigger(r,v),{options:Object.entries(EFFECT_TRIGGERS)}));
    const explanations={damage:'Uses health actually lost by the enemy, including staggered hits.',accurate:'Activates when your hit passes its accuracy check, even if it deals zero damage.',attack:'Activates once when you start an attack, before the hit lands.',taken:'Uses health actually lost by you. The enemy recipient is your attacker.','hit-received':'Activates when an enemy hit passes its accuracy check, even if it deals zero damage.',kill:'Activates when your hit kills the enemy. A boss changing phases does not count as a kill.',equip:'Activates when this item and the required set first become equipped.'};
    if(explanations[rule.trigger])box.append(el('small',{text:explanations[rule.trigger]}));
    if(!POLLED_TRIGGERS.includes(rule.trigger))box.append(field(['taken','hit-received'].includes(rule.trigger)?'Incoming combat style':'Combat style',rule.style,(r,v)=>r.style=v,{options:[['any','All combat styles'],['melee','Melee'],['ranged','Ranged'],['magic','Magic']]}));
    if(rule.trigger==='interval')box.append(field('Interval (ticks)',rule.intervalTicks,(r,v)=>r.intervalTicks=v,{min:1,max:6000}),el('small',{text:`${(rule.intervalTicks*.6).toFixed(1)} seconds between attempts while equipped.`}));
    if(['hp-below','prayer-below'].includes(rule.trigger))box.append(field('Threshold (%)',rule.thresholdPercent,(r,v)=>r.thresholdPercent=v,{min:1,step:.1}),el('small',{text:'Activates when the resource falls to this threshold. It must rise above the threshold before it can trigger again. To repeat while low, use Every X ticks with an activation condition.'}));
    const grid=el('div',{class:'combat-fields'});box.append(grid);
    grid.append(field('Activation chance (%)',rule.chance,(r,v)=>r.chance=v,{step:.1}),field('Cooldown (ticks)',rule.cooldownTicks??0,(r,v)=>r.cooldownTicks=v,{max:6000}));
    box.append(el('small',{text:'One tick = 0.6 seconds. Cooldown starts on successful activation and continues while unequipped.'}));
    if(POLLED_TRIGGERS.includes(rule.trigger)&&(rule.actions.some(a=>!['heal','prayer'].includes(a.type))||rule.visuals?.some(c=>c.recipient!=='player')))box.append(el('small',{text:'Enemy actions and target VFX use your current combat target. Outside combat they are skipped. Choose Player for a self effect.'}));
    const details=el('details',{class:'combat-conditions'},el('summary',{text:'Activation conditions'}));box.append(details);
    details.append(field('Combat condition',rule.conditions?.inCombat===undefined?'any':rule.conditions.inCombat?'in':'out',(r,v)=>{r.conditions??={};if(v==='any')delete r.conditions.inCombat;else r.conditions.inCombat=v==='in';},{options:[['any','Any time'],['in','In combat only'],['out','Outside combat only']]}));
    for(const [key,label] of [['hpBelowPercent','Your HP at or below (%)'],['prayerBelowPercent','Your Prayer at or below (%)'],['targetHpBelowPercent','Enemy HP at or below (%)']]){
        const enabled=rule.conditions?.[key]!==undefined,check=el('input',{type:'checkbox',checked:enabled,'aria-label':`Enable ${label}`});check.onchange=()=>update(r=>{r.conditions??={};if(check.checked)r.conditions[key]=50;else delete r.conditions[key];});
        details.append(el('label',{class:'combat-condition-toggle'},check,label));if(enabled)details.append(field(label,rule.conditions[key],(r,v)=>r.conditions[key]=v,{step:.1}));
    }
    box.append(el('output',{class:'combat-activation-summary',text:activationSummary(rule)}));
}
