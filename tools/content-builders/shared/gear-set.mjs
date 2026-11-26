import { validateProject, validId, SLOTS } from './project.mjs';
import { assemble } from './mesh.mjs';

export const SET_FORMAT = 'tsps-content-builder-set/1';
export const SET_ITEM_LIMIT = 24;
export const EQUIPMENT_SLOTS = [[0,'Head'],[1,'Cape'],[2,'Neck'],[3,'Weapon'],[4,'Body'],[5,'Shield'],[7,'Legs'],[9,'Hands'],[10,'Feet'],[12,'Ring'],[13,'Ammunition']];
export const isGearSet = value => value?.format === SET_FORMAT;
export const documentItems = value => isGearSet(value) ? value.items : [value];
export const itemReference = id => `item:${validId(id)}`;
export const referencedItem = value => typeof value === 'string' && value.startsWith('item:') ? value.slice(5) : null;
export const equipmentSlot = item => SLOTS[item.settings.equipmentType];

export function validateGearSet(input) {
    if(!isGearSet(input)||input.kind!=='gear')throw new Error('Not a supported gear set.');
    const id=validId(input.id),name=input.name;
    if(typeof name!=='string'||!name.trim()||name.length>80||/[\x00-\x1f]/.test(name))throw new Error('Give the gear set a name of up to 80 characters.');
    if(!Array.isArray(input.items)||!input.items.length||input.items.length>SET_ITEM_LIMIT)throw new Error(`A gear set needs 1 to ${SET_ITEM_LIMIT} custom items.`);
    const items=input.items.map(validateProject),byId=new Map(),definitions=new Set(),models=new Set();
    for(const item of items){
        if(item.kind!=='gear')throw new Error('A gear set can contain only gear items.');
        if(byId.has(item.id)||definitions.has(item.ids.definition))throw new Error('Each item in a gear set needs its own identity. Reassign the set IDs.');
        byId.set(item.id,item);definitions.add(item.ids.definition);
        for(let i=0;i<5;i++){const model=item.ids.modelBase+i;if(models.has(model))throw new Error('Gear set model IDs overlap. Reassign the set IDs.');models.add(model);}
    }
    // Older projects may use literal custom IDs. Turn known siblings into stable
    // references before import/reassignment can allocate different game IDs.
    const byDefinition=new Map(items.map(item=>[item.ids.definition,item.id]));
    for(const item of items)for(const passive of item.effects.passives)for(const piece of passive.set?.pieces??[]){
        piece.itemIds=piece.itemIds.map(value=>byDefinition.has(value)?itemReference(byDefinition.get(value)):value);
        for(const value of piece.itemIds){
            const id=referencedItem(value);if(!id)continue;
            const target=byId.get(id);if(!target)throw new Error(`${item.name}: a set effect refers to a missing item. Choose its replacement before saving.`);
            if(equipmentSlot(target)!==piece.slot)throw new Error(`${target.name} does not fit the ${EQUIPMENT_SLOTS.find(([slot])=>slot===piece.slot)?.[1].toLowerCase()} slot. Choose the matching item.`);
        }
        if(new Set(piece.itemIds).size!==piece.itemIds.length)throw new Error(`${item.name}: remove duplicate alternatives from the set effect.`);
    }
    return {format:SET_FORMAT,id,kind:'gear',name:name.trim(),items};
}
export const validateDocument = input => isGearSet(input) ? validateGearSet(input) : validateProject(input);

export function fullSetRequirement(set,ownerId) {
    const pieces=new Map();
    for(const item of set.items){
        const slot=equipmentSlot(item);if(slot<0)continue;
        if(!pieces.has(slot))pieces.set(slot,{slot,itemIds:[]});
        pieces.get(slot).itemIds.push(item.id===ownerId?'self':itemReference(item.id));
    }
    if([...pieces.values()].some(piece=>piece.itemIds.length>16))throw new Error('A set bonus can use at most 16 alternatives in each slot. Choose the alternatives individually.');
    const weapons=set.items.filter(item=>equipmentSlot(item)===3);
    if(pieces.has(5)&&weapons.length&&weapons.every(item=>item.settings.doubleHanded))throw new Error('A two-handed weapon cannot be worn with a shield. Create the effect without the shield requirement, or use a one-handed weapon.');
    if(!pieces.size)throw new Error('Give an item an equipment slot before adding a set effect.');
    return {required:pieces.size,pieces:[...pieces.values()]};
}

export function removeSetItem(set,id) {
    if(set.items.length===1)throw new Error('Keep one item in the set.');
    const item=set.items.find(item=>item.id===id);if(!item)return;
    for(const other of set.items)if(other!==item)for(const effect of other.effects?.passives??[])if(effect.set?.pieces.some(piece=>piece.itemIds.includes(itemReference(id))))
        throw new Error(`${other.name} uses ${item.name} in ${effect.name}. Remove that effect requirement first.`);
    set.items.splice(set.items.indexOf(item),1);
}

// Preview choices are transient. One item occupies each slot; a two-handed
// weapon and shield cannot silently appear equipped together.
export function equippedItems(set,choices={},activeId=null) {
    const slots=new Map();
    for(const item of set.items){const slot=equipmentSlot(item);if(slot>=0&&!slots.has(slot))slots.set(slot,item);}
    for(const [slot,id]of Object.entries(choices)){
        if(id===null){slots.delete(Number(slot));continue;}
        const item=set.items.find(item=>item.id===id&&equipmentSlot(item)===Number(slot));if(item)slots.set(Number(slot),item);
    }
    const active=set.items.find(item=>item.id===activeId);if(active&&equipmentSlot(active)>=0)slots.set(equipmentSlot(active),active);
    if(slots.get(3)?.settings.doubleHanded){if(active&&equipmentSlot(active)===5)slots.delete(3);else slots.delete(5);}
    return [...slots.values()];
}

export function equippedParts(set,choices={},activeId=null) {
    return equippedItems(set,choices,activeId).flatMap(item=>{
        const prefix=id=>`${item.id}/${id}`;
        return item.parts.map(part=>({...part,id:prefix(part.id),parentId:part.parentId?prefix(part.parentId):null,
            mesh:part.mesh.vertexLinks?{...part.mesh,vertexLinks:part.mesh.vertexLinks.map(ref=>({...ref,partId:prefix(ref.partId)}))}:part.mesh}));
    });
}

export function setPreviewItems(set,variant,choices={},activeId=null) {
    if(!['male','female','maleHead','femaleHead'].includes(variant))return [];
    return equippedItems(set,choices,activeId).filter(item=>item.id!==activeId).map(item=>({
        id:`set:${item.id}`,name:item.name,reference:true,opacity:1,visualProject:item,mesh:assemble(item.parts,variant)
    })).filter(item=>item.mesh.faces.length);
}
