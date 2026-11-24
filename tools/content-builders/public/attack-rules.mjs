import {ATTACK_RULE_HELP} from '../shared/attack-rule-help.mjs';
import {mechanicHeader} from './combat-cards.mjs';
import {materializeSpecial} from '../shared/effects.mjs';
import {ATTACK_RULES,ruleDefault} from '../shared/attack-rules.mjs';
import {ATTACK_FEATURES,featureDefaults} from '../shared/attack-features.mjs';

export function renderRuleInput(ctx,parent,schema,value,set,path){
 const {element:el,button}=ctx;
  if(schema.type==='record'){
   const group=el('div',{class:'combat-rule-record'});parent.append(group);
   for(const [key,item] of Object.entries(value)){const field=schema.fields[key],line=el('div',{class:'combat-rule-field'});group.append(line);renderRuleInput(ctx,line,field,item,next=>{value={...value,[key]:next};set(value);},`${path}: ${field.label}`);if(!ctx.fixedRuleFields)line.append(button('Remove option',()=>{const next={...value};delete next[key];value=next;set(next);ctx.onRuleStructureChange?.();},{disabled:Object.keys(value).length===1,'aria-label':`Remove ${path}: ${field.label}`}));}
   const unused=Object.entries(schema.fields).filter(([key])=>value[key]===undefined);if(unused.length){const add=el('select',{'aria-label':`Add ${path} option`},el('option',{value:'',text:'Add an option…'}),...unused.map(([key,field])=>el('option',{value:key,text:field.label})));add.onchange=()=>{if(add.value){value={...value,[add.value]:ruleDefault(schema.fields[add.value])};set(value);ctx.onRuleStructureChange?.();}};group.append(add);}return;
  }
  if(schema.type==='list'){
   const group=el('div',{class:'combat-rule-list'},el('strong',{text:schema.label}));parent.append(group);
   value.forEach((entry,index)=>{const row=el('section',{class:'combat-rule-list-row'});group.append(row);renderRuleInput(ctx,row,schema.item,entry,next=>{value=value.map((old,i)=>i===index?next:old);set(value);},`${path} ${index+1}`);row.append(button('Remove row',()=>{value=value.filter((_,i)=>i!==index);set(value);ctx.onRuleStructureChange?.();},{disabled:value.length===1,'aria-label':`Remove ${path} ${index+1}`}));});group.append(button('Add row',()=>{value=[...value,ruleDefault(schema.item)];set(value);ctx.onRuleStructureChange?.();},{disabled:value.length>=schema.max}));return;
  }
  const name=path??schema.label,label=el('label',{class:schema.type==='boolean'?'combat-mechanic-switch':''},el('span',{text:schema.label}));parent.append(label);
  const control=schema.type==='choice'?el('select',{'aria-label':name},...schema.choices.map(value=>el('option',{value,text:schema.choiceLabels?.[value]??(typeof value==='number'?['Stab','Slash','Crush'][value]??String(value):value.replaceAll('_',' ').replaceAll('-',' '))}))):el('input',{'aria-label':name,type:schema.type==='boolean'?'checkbox':'number',min:schema.min,max:schema.max,step:schema.step??1});
  if(schema.type==='boolean')control.checked=value;else control.value=value;
  control.onchange=()=>{const next=schema.type==='boolean'?control.checked:schema.type==='choice'?(typeof schema.choices[0]==='number'?Number(control.value):control.value):control.value.trim()?Number(control.value):NaN;try{set(next);control.setCustomValidity('');}catch(error){control.setCustomValidity(error.message);control.reportValidity();}};label.append(control);
  const unit=schema.label.includes('(ticks)')?.6:schema.label.includes('(client cycles)')?.02:null;
  if(schema.help)label.append(el('small',{class:'combat-field-help',text:schema.help}));
  if(unit!==null){const timing=el('small',{class:'combat-field-help'}),updateTime=()=>timing.textContent=Number.isFinite(Number(control.value))?`${Number((Number(control.value)*unit).toFixed(2))} seconds. ${unit===.6?'One game tick is 0.6 seconds.':'One client cycle is 0.02 seconds.'}`:'';updateTime();control.addEventListener('input',updateTime);label.append(timing);}
  else if(!schema.help&&schema.type==='number'&&/multiplier|×/i.test(schema.label))label.append(el('small',{class:'combat-field-help',text:'1 leaves the value unchanged; 1.5 increases it by 50%; 0.5 halves it.'}));if(schema.label.includes('VFX')&&ctx.chooseGraphic)label.append(button('Browse visual effects',()=>ctx.chooseGraphic(value,set)));
 }

/** All native roll fields, including nested split tables, have ordinary editable controls. */
export function renderRecipeEffects(ctx,parent,rule,edit,{section='all',types}={}){
 const {element:el,button}=ctx;

 const purposeOf=(collection,type)=>collection==='ruleFeatures'?'rolls':['projectile','sound'].includes(type)?'presentation':['condition','ammunition'].includes(type)?'requirements':'gameplay';
 const visualField=(type,key)=>type==='next-flames'&&key==='graphic';
 for(const [collection,definitions] of [['ruleFeatures',ATTACK_RULES],['extraFeatures',ATTACK_FEATURES]])(rule[collection]??[]).forEach((row,index)=>{
  if(types&&!types.includes(row.type))return;
  const purpose=purposeOf(collection,row.type);
  if(section!=='all'&&purpose!==section)return;
  const definition=definitions[row.type],title=definition.name??definition.label,card=el('section',{class:'combat-mechanic combat-rule','data-rule-type':row.type});parent.append(card);
  const tools=[];
  {
   const siblings=rule[collection].flatMap((other,i)=>(!types||types.includes(other.type))&&(section==='all'||purposeOf(collection,other.type)===section)?[i]:[]),position=siblings.indexOf(index);
   for(const direction of [-1,1]){const target=siblings[position+direction];tools.push(button(direction<0?'↑':'↓',()=>edit(rule=>{const rows=rule[collection];[rows[index],rows[target]]=[rows[target],rows[index]];}),{disabled:target===undefined,'aria-label':`Move ${title} ${direction<0?'earlier':'later'}`}));}
   tools.push(button('Remove',()=>edit(rule=>{const [removed]=rule[collection].splice(index,1);for(const clip of rule.visuals??[])if(clip.nativeFeature===removed.id){delete clip.nativeFeature;delete clip.nativeGraphic;delete clip.nativeRecipient;delete clip.heightMode;clip.phase='impact';}}),{'aria-label':`Remove ${title}`}));
  }
  card.append(mechanicHeader(ctx,title,purpose==='rolls'?'Hit rule':purpose==='presentation'?'Presentation':'Additional effect',tools));
  const description=definition.description??ATTACK_RULE_HELP[row.type];if(description)card.append(el('p',{class:'combat-mechanic-description',text:description}));
  const content=el('div',{class:'combat-mechanic-fields'});card.append(content);
  if(collection==='ruleFeatures'){const complex=['record','list'].includes(definition.type),host=complex?el('details',{'data-workspace-section':`rule:${row.id}`},el('summary',{text:'Edit values'})):content;if(complex)card.append(host);renderRuleInput(ctx,host,definition,row.value,value=>edit(rule=>rule[collection][index].value=value),title);if(!complex)content.querySelector('label>span').hidden=true;}
  else for(const [key,schema] of Object.entries(definition.fields)){if(section!=='all'&&(section!=='presentation'&&visualField(row.type,key)))continue;renderRuleInput(ctx,content,schema,row.values[key],value=>edit(rule=>rule[collection][index].values[key]=value),`${title}: ${schema.label}`);}
 });
}
export function addRecipeEffect(rule,collection,type,value){
 if(!rule.recipe){if(rule.nativeFrom!==undefined)throw new Error('Convert the starting point to a recipe first.');Object.assign(rule,materializeSpecial(rule));}
 let id=1,prefix=collection==='ruleFeatures'?'rule':'extra';while(rule[collection].some(row=>row.id===`${prefix}-${id}`))id++;
 rule[collection].push(collection==='ruleFeatures'?{id:`${prefix}-${id}`,type,value:structuredClone(value??ruleDefault(ATTACK_RULES[type]))}:{id:`${prefix}-${id}`,type,values:{...featureDefaults(type),...value}});
}
