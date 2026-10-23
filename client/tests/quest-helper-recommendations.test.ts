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
