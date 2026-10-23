const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createEligibility}=require('../plugins/quests/questhelper/Recommendations.QuestHelper');
const rows=[
 {id:1,displayname:['First'],difficulty:[0],length:[1]},
 {id:2,displayname:['Next'],requirement_stats:[7,10],requirement_quests:[1],requirement_questpoints:[2],requirement_combat:[5],recommended_stats:[7,20],recommended_combat:[10],difficulty:[2],length:[3]},
];
const columns=[...new Set(rows.flatMap(Object.keys).filter(k=>k!=='id'))];
const cache={getDbColumns:()=>columns,getDbColumn:(_t,k)=>k,getDbTableRows:()=>rows.map(r=>({...r,column:k=>r[k]??[]}))};
let cooking=1,combat=3,points=0,done=false;
const skill={getClientId:()=>7,getName:()=> 'Cooking'};
const player={getSkillManager:()=>({getMaxLevel:()=>cooking,getCombatLevel:()=>combat}),getAttribute:()=>points};
const quests=[{key:'first',name:'First',isComplete:()=>done},{key:'next',name:'Next',isComplete:()=>false},{key:'unknown',name:'Missing metadata',isComplete:()=>false}];
const eligibility=createEligibility({cache,Skill:{values:()=>[skill]},getQuests:()=>quests});
test('base levels, quest completion, quest points and combat gate eligibility; recommendations stay distinct',()=>{
 let value=eligibility(player).get('next');assert.equal(value.eligible,false);assert.equal(value.missing.length,4);assert.ok(value.missing.some(s=>s.includes('Cooking 10')));assert.ok(value.missing.includes('Complete First'));
 cooking=10;combat=5;points=2;done=true;
 value=eligibility(player).get('next');assert.equal(value.eligible,true);assert.deepEqual(value.missing,[]);assert.equal(value.recommendedMissing.length,2);
 cooking=20;combat=10;assert.deepEqual(eligibility(player).get('next').recommendedMissing,[]);
 done=false;assert.equal(eligibility(player).get('next').eligible,false,'completion changes are read afresh');
});
test('missing metadata is unknown, never silently eligible',()=>{const v=eligibility(player).get('unknown');assert.equal(v.known,false);assert.equal(v.eligible,false);});
