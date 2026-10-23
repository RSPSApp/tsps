"use strict";
const {metadata}=require('../QuestList.QuestRuntime');
const normalize=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
/** Cache DB requirements, checked against authoritative unboosted player state. */
function createEligibility({cache,Skill,getQuests}) {
 return player=>{
  const all=metadata(cache),quests=getQuests(),manager=player.getSkillManager?.();
  const skills=Skill?.values()||[];
  const completed=new Set(quests.filter(q=>q.isComplete(player)).map(q=>all.get(normalize(q.name))?.rowId).filter(id=>id!==undefined));
  const names=new Map([...all.values()].map(row=>[row.rowId,String(row.displayname?.[0]||'Required quest')]));
  const combat=manager?.getCombatLevel?.(),points=Number(player.getAttribute('quest.points'))||0;
  const result=new Map();
  for(const quest of quests){
   const row=all.get(normalize(quest.name));
   if(!row&&quest.key!=='learning_the_ropes'){result.set(quest.key,{known:false,eligible:false,missing:['Quest requirements unavailable'],recommendedMissing:[],difficulty:99,length:99});continue;}
   const missing=[],recommendedMissing=[];
   const checkStats=(values,out)=>{
    if(!Array.isArray(values))return;
    if(values.length%2){out.push('Skill requirements unavailable');return;}
    for(let i=0;i<values.length;i+=2){
     const id=Number(values[i]),level=Number(values[i+1]);
     const skill=skills.find(s=>s.getClientId()===id),actual=skill?manager?.getMaxLevel?.(skill):undefined;
     if(!Number.isFinite(level)||!Number.isFinite(actual)||actual<level)out.push(`${skill?.getName?.()||'Skill'} ${level} (you: ${actual??'unknown'})`);
    }
   };
   checkStats(row?.requirement_stats,missing);checkStats(row?.recommended_stats,recommendedMissing);
   for(const id of row?.requirement_quests||[])if(!completed.has(id))missing.push(`Complete ${names.get(id)||'required quest'}`);
   const number=key=>Number(row?.[key]?.[0]||0);
   if(points<number('requirement_questpoints'))missing.push(`${number('requirement_questpoints')} quest points (you: ${points})`);
   if(number('requirement_combat')>0&&(!Number.isFinite(combat)||combat<number('requirement_combat')))missing.push(`Combat ${number('requirement_combat')} (you: ${combat??'unknown'})`);
   if(number('recommended_combat')>0&&(!Number.isFinite(combat)||combat<number('recommended_combat')))recommendedMissing.push(`Combat ${number('recommended_combat')} recommended (you: ${combat??'unknown'})`);
   result.set(quest.key,{known:true,eligible:missing.length===0,missing,recommendedMissing,difficulty:number('difficulty'),length:number('length')});
  }
  return result;
 };
}
module.exports={createEligibility};
