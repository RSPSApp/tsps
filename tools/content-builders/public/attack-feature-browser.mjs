import {ATTACK_RULE_HELP} from '../shared/attack-rule-help.mjs';
import {ATTACK_RULES,ruleDefault,checkRuleValue} from '../shared/attack-rules.mjs';
import {ATTACK_FEATURES,featureDefaults} from '../shared/attack-features.mjs';
import {EFFECT_ACTIONS,newAction} from '../shared/effects.mjs';
import {renderRuleInput} from './attack-rules.mjs';

const actionHelp={venom:'Apply venom, which increases its damage over time until cured.',teleblock:'Prevent a player target from teleporting for the configured duration.',heal:'Restore your HP. Choose a percentage of damage, your base HP or your missing HP, or restore a fixed number of points.',prayer:'Restore your Prayer. Choose a percentage of damage, your base Prayer or your missing Prayer, or restore a fixed number of points.',drain:'Reduce the target’s current Defence by a chosen percentage.',freeze:'Stop the enemy from moving for the chosen duration. Targets with freeze immunity are unaffected.',poison:'Poison the enemy. Choose the first poison tick\'s damage; later ticks weaken over time. Poison-immune targets are unaffected.','drain-levels':'Reduce an enemy skill. Choose whether the amount comes from damage dealt or from the enemy\'s current skill level.','drain-stats':'Use damage dealt to reduce enemy skills in your chosen order. Drain the next skill only when the previous one reaches its minimum.'};
const nativeHelp={
 'blood-sacrifice':'Mark an enemy, then deal delayed damage and heal if it remains within the chosen escape distance.',
 'missing-resource-bonus':'Gain damage and accuracy for each point below your base level in the chosen skill. For example, 30 Prayer out of 99 leaves 69 missing points.',
 'skill-boost':'Raise the chosen skill when the special activates. Set a fixed boost and a percentage of its base, unboosted level.',
 'stat-drain':'Reduce the chosen enemy skills. Set separate reductions for demon targets and other enemies.',
 burn:'Apply damage over time as a burn. Set the burn chance and total damage; burn-immune targets are unaffected.',
 'ordered-drain':'Use damage dealt to reduce enemy skills in order. Move to the next skill only when the previous one reaches its minimum.',
 'damage-drain':'Use the attack’s damage to reduce the chosen enemy stat.',
 'burn-rolls':'Apply burn with a different chance for each successful accuracy stage. Choose whether to attempt a burn for each hit or once per attack.',
 'prayer-block':'Prevent the target from using protection prayers for the chosen duration.',
 'defence-drain':'Reduce the enemy\'s current Defence level by a percentage. Choose whether the hit must deal damage and which targets it can affect.',
 recovery:'Restore your HP and Prayer from attack damage. Set how much each resource recovers and its minimum recovery.',
 freeze:'Stop the enemy from moving when the hit passes accuracy. Freeze immunity and resistance can prevent or shorten it.'
};
const num=(label,min,max,value=1,step=1)=>({label,type:'number',min,max,step,value});
const choice=(label,choices,value=choices[0])=>({label,type:'choice',choices,value});
const record=(fields)=>({type:'record',label:'Effect values',fields});
function actionSchema(type){
 const fields={chance:num('Activation chance (%)',0,100,100,.1)};
 if(type==='freeze')Object.assign(fields,{ticks:num('Freeze duration (ticks)',1,32,8),phase:choice('Start at',['impact','launch'],'impact')});
 else if(type==='teleblock')Object.assign(fields,{ticks:num('Teleblock duration (ticks)',1,6000,500),phase:choice('Start at',['impact','launch'],'impact')});
 else if(type==='venom')Object.assign(fields,{phase:choice('Start at',['impact','launch'],'impact')});
 else if(type==='poison')Object.assign(fields,{damage:num('First poison damage',1,20,4),phase:choice('Start at',['impact','launch'],'impact')});
 else if(type==='drain-stats')Object.assign(fields,{percent:num('Damage used (%)',1,100,100),order:{label:'Drain order',type:'list',max:6,item:choice('Stat',['defence','strength','prayer','attack','magic','ranged'])}});
 else if(type==='drain')Object.assign(fields,{percent:num('Defence reduction (%)',1,100,30),trigger:choice('Requires',['damage','accurate'],'damage')});
 else if(type==='drain-levels')Object.assign(fields,{percent:num('Stat reduction (%)',1,100,100),skill:choice('Enemy stat',['defence','strength','prayer','attack','magic','ranged'],'magic'),basis:choice('Amount based on',['dealt','current'],'dealt')});
 else Object.assign(fields,{percent:num('Recovery (%)',1,100,50,.1),minimum:num('Minimum or fixed recovery',0,100,0),basis:choice('Amount based on',['dealt','rolled','max','missing','flat'],'dealt')});
 return record(fields);
}
const defaults=schema=>schema.type==='record'?Object.fromEntries(Object.entries(schema.fields).map(([key,row])=>[key,row.value??ruleDefault(row)])):ruleDefault(schema);
const nativeSchema=group=>record(Object.fromEntries(group.parameters.filter(p=>!/(?:vfx|graphic)/i.test(p.label+' '+p.key)).map(p=>[p.key,p.type==='order'?{...p,type:'list',max:p.choices.length,item:{type:'choice',label:'Stat',choices:p.choices.map(c=>c.value),choiceLabels:Object.fromEntries(p.choices.map(c=>[c.value,c.label]))}}:p.type==='choice'?{...p,choices:p.choices.map(c=>c.value),choiceLabels:Object.fromEntries(p.choices.map(c=>[c.value,c.label]))}:p])));
const categories=['All effects','Hit rules','Gameplay effects','Requirements','Projectiles','Sounds'];
export function attackFeatureChoices(library,{actions=true}={}){
 const rows=[
  ...['damage','accuracy'].map(type=>({key:`modifier:${type}`,name:type==='damage'?'Damage modifier':'Accuracy modifier',category:'Hit rules',description:ATTACK_RULE_HELP[`${type}Multiplier`],schema:record({multiplier:num('Multiplier',.1,5,1.1,.01)}),symbol:type==='damage'?'×':'◎'})),
  ...Object.entries(ATTACK_RULES).filter(([key])=>!['damageMultiplier','accuracyMultiplier','damageMultiplierStages'].includes(key)).map(([key,row])=>({key:`rule:${key}`,name:row.label,category:'Hit rules',description:ATTACK_RULE_HELP[key],schema:row,...(key==='hitDelayTicks'?{initial:[0]}:{}),symbol:'↗'})),
  ...Object.entries(ATTACK_FEATURES).map(([key,row])=>({key:`extra:${key}`,name:row.name,category:key==='projectile'?'Projectiles':key==='sound'?'Sounds':['condition','ammunition'].includes(key)?'Requirements':'Gameplay effects',description:row.description,schema:record(row.fields),initial:featureDefaults(key),symbol:key==='sound'?'♪':key==='projectile'?'➚':'◆'})),
  ...(actions?Object.entries(EFFECT_ACTIONS).map(([key,name])=>({key:`action:${key}`,name,category:'Gameplay effects',description:actionHelp[key],schema:actionSchema(key),initial:newAction(key),symbol:'+'})):[]),
  ...library.rows.map(row=>({key:`${row.source}:${row.group.id}`,name:row.group.name,category:'Gameplay effects',description:nativeHelp[row.group.id]??row.group.trigger,schema:nativeSchema(row.group),source:row.sourceName,trigger:row.group.trigger,example:{name:row.sourceName,id:row.source},symbol:'◆'}))
 ];
 for(const row of rows){row.initial??=defaults(row.schema);if(row.key.startsWith('action:')){delete row.initial.type;row.initial={...defaults(row.schema),...row.initial};}row.example??=library.examples?.[row.key];row.exampleLabel='Used by';row.example??={name:'Custom attacks only',native:false};}
 return rows;
}
/** Configure a private draft. Add applies one edit; closing never changes the project. */
export function browseAttackFeatures(ctx,{library,onChoose,actions=true,category=null,onlyActions=false,withoutDamage=false,title='Add an attack feature'}){
 const {element:el,button}=ctx,origin=document.activeElement,choices=attackFeatureChoices(library,{actions}).filter(row=>(!category||row.category===category)&&(!onlyActions||row.key.startsWith('action:'))&&(!onlyActions||!withoutDamage||row.key!=='action:drain-stats')),dialog=el('dialog',{class:'combat-reference-dialog combat-feature-dialog','aria-label':title}),search=el('input',{type:'search',placeholder:'Search effects, behavior or example weapon…','aria-label':'Search attack features'}),filter=el('select',{'aria-label':'Feature category'},...categories.map(name=>el('option',{value:name,text:name}))),count=el('output',{'aria-live':'polite'}),scroll=el('div',{class:'combat-feature-scroll',tabIndex:0,'aria-label':'Attack feature tiles'}),list=el('div',{class:'combat-feature-window'}),detail=el('section',{class:'combat-reference-detail combat-feature-detail'});
 if(onlyActions)for(const row of choices){const fields=row.schema.fields;if(fields.phase){fields.phase.choices=['impact'];row.initial.phase='impact';}if(withoutDamage&&fields.basis){fields.basis.choices=fields.basis.choices.filter(value=>!['dealt','rolled'].includes(value));row.initial.basis=fields.basis.choices[0];}}
 let rows=choices,selected=null,columns=3,closed=false;const stride=190,drafts=new Map();
 const toolbar=el('div',{class:'combat-browser-toolbar'},search,...(category?[]:[filter]),count);
 dialog.append(el('header',{},el('div',{},el('h2',{text:title}),el('p',{text:'Choose an effect, configure its values, then add it.'})),button('Close',()=>dialog.close(),{'aria-label':'Close attack features'})),toolbar,el('div',{class:'combat-reference-body'},scroll,detail));scroll.append(list);document.body.append(dialog);dialog.showModal();
 function combatTerms(){
  return el('details',{class:'combat-effect-terms'},el('summary',{text:'Combat terms explained'}),
   el('p',{text:'Current level includes boosts and drains. Base level is the normal skill level without either.'}),
   el('p',{text:'Accuracy decides whether a hit lands. It does not set the damage. An accuracy multiplier scales the attack score, not the final hit chance.'}),
   el('p',{text:'Damage dealt is the HP the enemy actually loses. Damage rolled is the result before the enemy’s remaining HP limits it.'}),
   el('p',{text:'A minimum or floor is the lowest allowed value. A cap is the highest allowed value. One game tick is 0.6 seconds.'}));
 }
 function show(row){
  selected=row;if(!drafts.has(row.key))drafts.set(row.key,structuredClone(row.initial));
  const form=el('div',{class:'combat-feature-form'}),error=el('p',{class:'combat-error',role:'alert'});
  const renderForm=()=>{form.replaceChildren();renderRuleInput({...ctx,fixedRuleFields:true,onRuleStructureChange:renderForm},form,row.schema,drafts.get(row.key),value=>{checkRuleValue(row.schema,value);drafts.set(row.key,value);},row.name);};
  detail.replaceChildren(el('small',{text:row.category}),el('h3',{text:row.name}),el('p',{text:row.description}),el('p',{class:'combat-feature-example',text:`${row.exampleLabel}: ${row.example.name}`}),...(row.example.native===false?[el('p',{text:'No registered native weapon currently uses this standalone option.'})]:[]),...(row.trigger?[el('p',{text:`Trigger: ${row.trigger}`})]:[]),combatTerms(),form,error,button('Add effect',async()=>{try{const value=checkRuleValue(row.schema,drafts.get(row.key));await onChoose(row.key,value);dialog.close();}catch(e){error.textContent=e.message;}},{class:'primary'}));renderForm();draw();
 }
 function draw(){
  if(closed)return;const focused=list.contains(document.activeElement)?document.activeElement.dataset.featureKey:null;
  columns=scroll.clientWidth>=650?3:scroll.clientWidth>=350?2:1;list.style.height=`${Math.ceil(rows.length/columns)*stride}px`;
  const first=Math.max(0,Math.floor(scroll.scrollTop/stride)-1),last=Math.min(Math.ceil(rows.length/columns),first+Math.ceil(scroll.clientHeight/stride)+2),cards=[];
  for(let index=first*columns;index<last*columns&&index<rows.length;index++){const row=rows[index],card=button('',()=>show(row),{class:'combat-feature-tile','aria-pressed':selected?.key===row.key,'data-feature-key':row.key});Object.assign(card.style,{top:`${Math.floor(index/columns)*stride}px`,left:`${index%columns*100/columns}%`,width:`calc(${100/columns}% - 10px)`});card.append(el('span',{class:'combat-feature-symbol','aria-hidden':true,text:row.symbol}),el('small',{text:row.category}),el('strong',{text:row.name}),el('span',{class:'combat-feature-explanation',text:row.description}),el('small',{text:`${row.exampleLabel}: ${row.example.name}`}));cards.push(card);}
  list.replaceChildren(...cards);if(focused){const replacement=cards.find(card=>card.dataset.featureKey===focused);(replacement??scroll).focus({preventScroll:true});}
 }
 function applyFilter(){const q=search.value.trim().toLowerCase();rows=choices.filter(row=>(category||filter.value==='All effects'||row.category===filter.value)&&[row.name,row.description,row.example.name].join(' ').toLowerCase().includes(q));scroll.scrollTop=0;count.textContent=`${rows.length} ${rows.length===1?'effect':'effects'}`;draw();}
 detail.append(el('h3',{text:'Select an effect'}),el('p',{text:'Configure its values here before adding. Closing this browser leaves your attack unchanged.'}));
 search.oninput=filter.onchange=applyFilter;scroll.addEventListener('scroll',draw,{passive:true});const resize=new ResizeObserver(draw);resize.observe(scroll);dialog.addEventListener('close',()=>{closed=true;resize.disconnect();dialog.remove();origin?.isConnected&&origin.focus();},{once:true});applyFilter();search.focus();return dialog;
}
