import {mechanicHeader} from './combat-cards.mjs';
import {resolveMechanics,describeMechanic} from '../shared/native-mechanics.mjs';

/** Template-owned mechanics use the same controls for every weapon. Reading never edits a project. */
export function renderNativeMechanics(ctx,parent,reference,rule,update,{parameterFilter=()=>true}={}){
    const {element:el,button}=ctx,groups=reference.mechanics??[],values=resolveMechanics(groups,rule.nativeMechanics);
    for(const group of groups){
        const current=values[group.id],card=el('section',{class:'combat-mechanic','data-mechanic-id':group.id}),header=mechanicHeader(ctx,group.name,group.phase??'Additional effect');card.append(header);parent.append(card);
        card.append(el('p',{class:'combat-mechanic-trigger',text:group.trigger}),el('p',{class:'combat-mechanic-description',text:current.enabled===false?'Disabled. The initial hit and your added effects still apply.':describeMechanic(group,current)}));
        const fields=el('div',{class:'combat-mechanic-fields'});card.append(fields);let advanced;
        for(const [index,parameter] of group.parameters.entries()){
            if(!parameterFilter(parameter,group))continue;
            if(parameter.type==='order'){
                const area=el('div',{class:'combat-mechanic-order','aria-label':parameter.label},el('strong',{text:parameter.label}));fields.append(area);const order=current[parameter.key],set=value=>update(rule=>{const all=rule.nativeMechanics??={};(all[group.id]??={})[parameter.key]=value;});
                order.forEach((value,index)=>{const line=el('div',{class:'combat-actions'},el('span',{text:parameter.choices.find(choice=>choice.value===value).label}));area.append(line);for(const [direction,label] of [[-1,'Up'],[1,'Down']])line.append(button(label,()=>{const next=[...order];[next[index],next[index+direction]]=[next[index+direction],next[index]];set(next);},{disabled:index+direction<0||index+direction>=order.length,'aria-label':`Move ${value} ${label.toLowerCase()}`}));line.append(button('Remove',()=>set(order.filter(item=>item!==value)),{disabled:order.length===1,'aria-label':`Remove ${value} from drain order`}));});
                const available=parameter.choices.filter(choice=>!order.includes(choice.value));if(available.length){const add=el('select',{'aria-label':'Add a drained stat'},el('option',{value:'',text:'Add a stat…'}),...available.map(choice=>el('option',{value:choice.value,text:choice.label})));add.onchange=()=>{if(add.value)set([...order,add.value]);};area.append(add);}continue;
            }
            const custom=rule.nativeMechanics?.[group.id]?.[parameter.key]!==undefined,value=current[parameter.key],input=parameter.type==='choice'?el('select',{'aria-label':parameter.label},...parameter.choices.map(choice=>el('option',{value:choice.value,text:choice.label,selected:value===choice.value}))):el('input',{'aria-label':parameter.label,type:parameter.type==='boolean'?'checkbox':'number',...(parameter.type==='boolean'?{checked:value}:{value,min:parameter.min,max:parameter.max,step:parameter.step??1})});
            input.onchange=()=>{
                const next=parameter.type==='boolean'?input.checked:parameter.type==='choice'?input.value:input.value.trim()?Number(input.value):NaN;
                try{resolveMechanics(groups,{...rule.nativeMechanics,[group.id]:{...rule.nativeMechanics?.[group.id],[parameter.key]:next}});input.setCustomValidity('');update(r=>{const all=r.nativeMechanics??={};(all[group.id]??={})[parameter.key]=next;});}
                catch(error){input.setCustomValidity(error.message);input.reportValidity();}
            };
            const label=el('label',{class:parameter.type==='boolean'?'combat-mechanic-switch':''},el('span',{text:parameter.label}),input);
            if(parameter.label.includes('VFX')&&ctx.chooseNativeGraphic)label.append(button('Browse visual effects',()=>ctx.chooseNativeGraphic(value,id=>{input.value=id;input.onchange();})));
            if(parameter.help)label.append(el('small',{class:'combat-field-help',text:parameter.help}));
            if(parameter.key.toLowerCase().includes('ticks'))label.append(el('small',{text:`${(value*.6).toFixed(1)} seconds`}));
            if(custom)label.append(button('Use native value',()=>update(r=>{delete r.nativeMechanics[group.id][parameter.key];if(!Object.keys(r.nativeMechanics[group.id]).length)delete r.nativeMechanics[group.id];if(!Object.keys(r.nativeMechanics).length)delete r.nativeMechanics;}),{class:'combat-reset-value','aria-label':`Reset ${parameter.label} to native value`}));
            if(group.advancedFrom!==undefined&&index>=group.advancedFrom){if(!advanced){advanced=el('details',{class:'combat-mechanic-advanced'},el('summary',{text:group.detailsLabel??'Conditions and recovery'}));advanced.dataset.workspaceSection=`feature:${ctx.featureId??group.id}:advanced`;card.append(advanced);}advanced.append(label);}else fields.append(label);
        }
    }
    if(!groups.length)parent.append(el('p',{class:'effects-note',text:'This reference keeps its native utility behavior. Its gameplay plugin does not yet expose additional mechanic parameters.'}));
}
