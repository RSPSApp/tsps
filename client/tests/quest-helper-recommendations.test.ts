import {strict as assert} from 'node:assert';
import {recommendedQuests} from '../game/plugins/questhelper/QuestHelperRecommendations';
import {QuestHelperSession} from '../game/plugins/questhelper/QuestHelperSession';
const ready={known:true,eligible:true,missing:[],recommendedMissing:[],difficulty:1,length:1};
const quests:any[]=[
 {questKey:'done',name:'Done',supported:true,status:'FINISHED',eligibility:ready},
 {questKey:'locked',name:'Locked',supported:true,status:'NOT_STARTED',eligibility:{...ready,eligible:false,missing:['Cooking 50']}},
 {questKey:'unknown',name:'Unknown',supported:true,status:'NOT_STARTED'},
 {questKey:'progress',name:'Progress',supported:true,status:'IN_PROGRESS',eligibility:{...ready,difficulty:3}},
 {questKey:'ready',name:'Ready',supported:true,status:'NOT_STARTED',eligibility:ready},
 {questKey:'ready',name:'Ready branch',helperVariant:'BRANCH',supported:true,status:'NOT_STARTED',eligibility:ready},
];
assert.deepEqual(recommendedQuests(quests).map(q=>q.questKey),['progress','ready']);
assert.deepEqual(recommendedQuests(quests,'progress').map(q=>q.questKey),['ready']);
const sent:any[]=[];const session=new QuestHelperSession(d=>sent.push(d),()=> 's');
session.select('progress');session.update('A');session.acceptCatalog({protocol:1,session:'s',sourceCommit:'abc',quests,diagnostics:[]});session.update('A',{tick:1} as any);
assert.ok(session.accept({protocol:1,session:'s',sequence:1,questKey:'progress',sourceCommit:'abc',status:'complete',activeStep:null,panels:[],diagnostics:[],questProgress:[{questKey:'progress',status:'FINISHED',stage:100,eligibility:ready},{questKey:'locked',status:'NOT_STARTED',stage:0,eligibility:ready}]}));
assert.deepEqual(recommendedQuests(session.getState().catalog!.quests).map(q=>q.questKey),['locked','ready'],'completion refresh unlocks another quest immediately');
session.select('');session.update('A',{tick:2} as any);const count=sent.filter(d=>d.type==='catalog').length;session.update('A',{tick:12} as any);assert.ok(sent.filter(d=>d.type==='catalog').length>count,'idle recommendations refresh as levels and quests change');
console.log('Quest Helper eligibility ranking and completion refresh passed');

const tutorial:any={questKey:'learning_the_ropes',name:'Learning the Ropes',supported:true,status:'NOT_STARTED',eligibility:{...ready,eligible:false,missing:['Tutorial Island is disabled on this world.']}};
assert.deepEqual(recommendedQuests([tutorial,...quests]).map(q=>q.questKey),['progress','ready'],'disabled tutorial cannot pin recommendations');
assert.deepEqual(recommendedQuests([{...tutorial,eligibility:ready},...quests]).map(q=>q.questKey),['learning_the_ropes'],'enabled tutorial keeps priority');
for(const enabled of [false,true]){
 const s=new QuestHelperSession(()=>{},()=>`toggle-${enabled}`);s.update('new-character');
 assert.equal(s.acceptCatalog({protocol:1,session:`toggle-${enabled}`,sourceCommit:'abc',quests:[{...tutorial,eligibility:enabled?ready:tutorial.eligibility},...quests],diagnostics:[]}),true);
 assert.equal(s.getState().selected,enabled?'learning_the_ropes':'','automatic tutorial selection respects world availability');
 if(!enabled){s.select('ready');assert.equal(s.getState().selected,'ready','manual selection remains available');}
}
const switched=new QuestHelperSession(()=>{},()=> 'world-switch');switched.update('same-character');
switched.acceptCatalog({protocol:1,session:'world-switch',sourceCommit:'abc',quests:[{...tutorial,eligibility:ready},...quests],diagnostics:[]});
assert.equal(switched.getState().selected,'learning_the_ropes');
switched.update(null);switched.update('same-character');
switched.acceptCatalog({protocol:1,session:'world-switch',sourceCommit:'abc',quests:[tutorial,...quests],diagnostics:[]});
assert.equal(switched.getState().selected,'','relogin to a tutorial-off world releases an old tutorial selection');
