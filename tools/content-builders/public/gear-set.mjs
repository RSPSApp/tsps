import { assemble } from '/shared/mesh.mjs';
import { EQUIPMENT_SLOTS, equipmentSlot, equippedItems, removeSetItem, SET_ITEM_LIMIT } from '/shared/gear-set.mjs';
import { referencePicker } from '/picker.mjs';

// The host owns document/history state. This module only presents set members.
export function createGearSetEditor(ctx) {
    const {state,element:el,button,api,status,thumbnail}=ctx;
    const strip=document.getElementById('gear-set'),dialog=document.getElementById('set-item-dialog');
    let pending=false;
    const slotName=item=>EQUIPMENT_SLOTS.find(([slot])=>slot===equipmentSlot(item))?.[1]??'Not equipped';
    async function add(input,starting=false) {
        if(pending)return;pending=true;
        const snapshot=structuredClone(ctx.document()),stamp=JSON.stringify(snapshot);
        try {
            let start=input.item?{project:input.item}:{baseId:input.baseId};
            // An already-running Creator can serve updated browser assets while
            // retaining its earlier create endpoint until its normal lifecycle reload.
            if(starting&&!input.item&&!state.info?.features?.gearSetStart){const source=await api('create',{kind:'gear',baseId:input.baseId});start={project:source.project};}
            const result=starting?await api('gear-set',{...start,name:'My gear set'}):await api('gear-set/item',{project:snapshot,revision:state.revision,...input});
            if(JSON.stringify(ctx.document())!==stamp){status(`Added the item to the saved set. Open ${result.project.name} to use it. Your newer edits are still here.`);dialog.close();return;}
            if(starting)ctx.open(result);else{ctx.checkpoint();ctx.adopt(result,result.project.items.at(-1).id);}dialog.close();status(starting?'Gear set created. Add another item to build the set.':'Item added to the set.');
        } finally {pending=false;}
    }
    async function showAdd(starting=false) {
        dialog.querySelector('h2').textContent=starting?'Start a gear set':'Add a set item';
        const body=document.getElementById('set-item-options');body.replaceChildren();
        let baseId=-1;
        const addButton=button(starting?'Create gear set':'Add custom item',()=>add({baseId},starting),{class:'primary',disabled:true});
        referencePicker({...ctx,change:fn=>fn()},body,'Start from an item','item',-1,id=>{baseId=id;addButton.disabled=id<0;},{required:true});
        body.append(addButton);
        const saved=el('details',{},el('summary',{text:'Copy a saved custom item'}));body.append(saved);
        const rows=await api('projects');
        for(const row of rows.projects.filter(row=>row.kind==='gear'&&!row.error))saved.append(button(row.name,async()=>{
            const result=await api(`projects/${row.id}`);
            if(result.project.items){
                saved.replaceChildren(el('summary',{text:row.name}));
                for(const item of result.project.items)saved.append(button(item.name,()=>add({item},starting)));
            }else await add({item:result.project},starting);
        }));
        if(!saved.querySelector('button'))saved.append(el('p',{class:'note',text:'No saved gear items.'}));
        dialog.showModal();
    }
    async function create() {
        if(ctx.busy?.()){status('Wait for this item to finish loading.');return;}
        if(!state.project)return showAdd(true);
        if(pending)return;
        pending=true;
        try {
            const snapshot=structuredClone(state.project),stamp=JSON.stringify(snapshot);
            const result=await api('gear-set',{project:snapshot,name:`${snapshot.name} set`.slice(0,80)});
            if(JSON.stringify(state.project)!==stamp){status(`Created ${result.project.name}. Find it in Open. Your newer edits are still here.`);return;}
            ctx.open(result);status('Gear set created. Add another item to build the set.');
        } finally {pending=false;}
    }

    function render() {
        const gear=(state.project?.kind??document.body.dataset.workspace)==='gear';
        const createButton=document.getElementById('create-set');createButton.hidden=!gear||!!state.gearSet;createButton.disabled=false;
        strip.hidden=!state.gearSet;strip.replaceChildren();if(!state.gearSet)return;
        const name=el('input',{value:state.gearSet.name,maxLength:80,'aria-label':'Set name',onChange:e=>ctx.change(()=>{state.gearSet.name=e.target.value;})});
        const preview=el('input',{type:'checkbox',checked:state.previewSet,'aria-label':'Preview together',onChange:ctx.safe(async e=>{
            state.previewSet=e.target.checked;if(state.previewSet&&!['male','female'].includes(state.variant))state.variant='male';
            await ctx.refresh();
        })});
        const controls=el('div',{class:'set-controls'},el('label',{},'Gear set',name),el('label',{class:'check'},preview,'Preview together'),button('Set bonus',()=>ctx.editSetBonus(),{title:'Optional effect while this set is worn'}),button('Add item',()=>showAdd(),{disabled:state.gearSet.items.length>=SET_ITEM_LIMIT}),button('Remove item',()=>{
            // Validate before checkpointing so a refused removal does not dirty history.
            removeSetItem(structuredClone(ctx.document()),state.project.id);
            ctx.change(()=>{removeSetItem(state.gearSet,state.project.id);state.project=state.gearSet.items[0];});return ctx.switchItem(state.project.id,true);
        },{disabled:state.gearSet.items.length<2}));
        strip.append(controls);
        const equipped=new Set(equippedItems(state.gearSet,state.setEquipment,state.project.id).map(item=>item.id));
        const items=el('div',{class:'set-items','aria-label':'Set items'});strip.append(items);
        for(const item of state.gearSet.items){
            const canvas=el('canvas',{width:52,height:48,'aria-hidden':'true'});
            thumbnail(canvas,assemble(item.parts,'inventory'),{kind:'item',variant:'inventory',fields:item.settings});
            const card=button('',()=>ctx.switchItem(item.id),{'aria-pressed':item.id===state.project.id,'aria-label':`Edit ${item.name}`,class:'set-item'});
            card.append(canvas,el('span',{},el('strong',{text:item.name}),el('small',{text:`${slotName(item)}${equipped.has(item.id)?' · Equipped':''}`})));items.append(card);
        }
    }
    document.getElementById('create-set').onclick=ctx.safe(create);
    return {render};
}
