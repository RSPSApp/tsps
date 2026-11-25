export const ATTACK_LIMIT = 8;
export const attackRole = id => `attack:${id}`;
export function attackForRole(project, role) { return project.attacks?.find(a=>attackRole(a.id)===role); }
export function newAttack(project, name = 'New attack') {
    if((project.attacks?.length??0)>=ATTACK_LIMIT) throw new Error('Keep at most eight attacks.');
    const s=project.settings;
    return {id:crypto.randomUUID(),name,style:s.attackType,weight:1,range:s.attackType==='MELEE'?1:10,speed:s.attackSpeed,delay:s.attackType==='MELEE'?0:2,maxHit:s.maxHit,projectileId:s.projectileId,launchGraphicId:s.launchGraphicId,parts:{}};
}
export function validateAttacks(input, parts, settings) {
    const rows=input??[];
    if(!Array.isArray(rows)||rows.length>ATTACK_LIMIT)throw new Error('Keep at most eight attacks.');
    const ids=new Set(),number=(v,min,max,label)=>{if(!Number.isInteger(v)||v<min||v>max)throw new Error(`Invalid attack ${label}.`);return v;};
    return rows.map(row=>{
        if(typeof row.id!=='string'||! /^[a-zA-Z0-9-]{1,80}$/.test(row.id)||ids.has(row.id))throw new Error('Invalid or duplicate attack.');ids.add(row.id);
        if(typeof row.name!=='string'||!row.name.trim()||row.name.length>60||/[\x00-\x1f]/.test(row.name))throw new Error('Give each attack a name.');
        if(!['MELEE','RANGED','MAGIC'].includes(row.style))throw new Error('Choose an attack style.');
        const out={id:row.id,name:row.name.trim(),style:row.style,weight:number(row.weight??1,1,100,'chance'),range:number(row.range??(row.style==='MELEE'?1:10),1,30,'reach'),speed:number(row.speed??settings.attackSpeed,1,100,'speed'),delay:number(row.delay??0,0,20,'hit delay'),maxHit:number(row.maxHit??settings.maxHit,0,10000,'damage cap'),projectileId:number(row.projectileId??-1,-1,65534,'projectile'),launchGraphicId:number(row.launchGraphicId??-1,-1,65534,'launch effect'),parts:{}};
        if(out.maxHit>settings.maxHit)throw new Error('An attack damage cap cannot exceed the creature max hit. Raise Max hit in Game data first.');
        if(row.style==='MELEE'&&out.range!==1)throw new Error('Melee attacks use a reach of one tile.');
        if(!row.parts||typeof row.parts!=='object'||Array.isArray(row.parts)||Object.keys(row.parts).length>128)throw new Error('Invalid attack movements.');
        for(const [id,move] of Object.entries(row.parts)){
            const part=parts.find(p=>p.id===id);if(!part||part.mesh.vertexLinks)throw new Error('An attack movement refers to a missing part.');
            out.parts[id]={sequence:number(move.sequence,-1,65534,'movement'),speed:move.speed??1,strength:move.strength??1};
            if(!Number.isFinite(out.parts[id].speed)||out.parts[id].speed<.1||out.parts[id].speed>4||!Number.isFinite(out.parts[id].strength)||out.parts[id].strength<0||out.parts[id].strength>2)throw new Error('Invalid attack movement speed or strength.');
        }
        return out;
    });
}

// A visual choice always belongs to the selected part's source. Try preflights
// the actual donor rig on the server before anything is persisted.
export function withPartAttack(project, attackId, partId, choice) {
    const out=structuredClone(project),row=out.attacks?.find(a=>a.id===attackId),part=out.parts.find(p=>p.id===partId);
    if(!row||!part||part.mesh.vertexLinks)throw new Error('Choose an attack and an original part.');
    if(part.source.kind!=='npc'||choice.sourceId!==part.source.id||choice.sourceKind!=='npc')throw new Error('Choose a movement from this part\'s original creature.');
    row.parts[partId]={sequence:choice.sequence,speed:1,strength:1};return out;
}
