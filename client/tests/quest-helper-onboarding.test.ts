import { strict as assert } from "node:assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestHelperSession } from "../game/plugins/questhelper/QuestHelperSession";
import { QuestHelperPanel } from "../game/plugins/questhelper/QuestHelperPanel";

const quests: any[] = [
    {questKey:"learning_the_ropes",name:"Tutorial Island",supported:true,status:"IN_PROGRESS"},
    {questKey:"cooks_assistant",name:"Cook's Assistant",supported:true,status:"NOT_STARTED"},
    {questKey:"sheep_shearer",name:"Sheep Shearer",supported:true,status:"FINISHED"},
    {questKey:"rune_mysteries",name:"Rune Mysteries",supported:true,status:"NOT_STARTED"},
    {questKey:"other",name:"Existing adventure",supported:true,status:"IN_PROGRESS"},
];
for(const quest of quests)quest.eligibility={known:true,eligible:true,missing:[],recommendedMissing:[],difficulty:0,length:1};
const sent: any[]=[];let generation=0;
const session=new QuestHelperSession(data=>sent.push(data),()=>`new-${++generation}`);
session.update("NewPlayer");
const catalog=()=>({protocol:1,session:sent.filter(m=>m.type==="catalog").at(-1).session,sourceCommit:"abc",quests,diagnostics:[]});
assert.ok(session.acceptCatalog(catalog()));
assert.equal(session.getState().selected,"learning_the_ropes","new account immediately receives tutorial guidance");
session.update("NewPlayer");
assert.ok(sent.some(m=>m.type==="select"&&m.questKey==="learning_the_ropes"));
session.select("");session.update("NewPlayer");session.acceptCatalog(catalog());
assert.equal(session.getState().selected,"","Stop helping is respected when the catalog refreshes");
session.select("cooks_assistant");session.update("NewPlayer");session.acceptCatalog(catalog());
assert.equal(session.getState().selected,"cooks_assistant","manual selection is respected");
const state:any={selected:"",status:"Choose a quest.",catalog:{quests,sourceCommit:"abc"},result:null};
const plugin:any={getState:()=>state,subscribe:()=>()=>{},selectQuest(){},retry(){}};
let html=renderToStaticMarkup(createElement(QuestHelperPanel,{plugin}));
assert.match(html,/Recommended next/);
assert.match(html,/Continue guide/);
assert.match(html,/Finish Tutorial Island/);
state.catalog.quests=quests.map(q=>q.questKey==="learning_the_ropes"?{...q,status:"FINISHED"}:q);
html=renderToStaticMarkup(createElement(QuestHelperPanel,{plugin}));
const recommendations=html.split('aria-label="Recommended quests"')[1]?.split('</section>')[0]??"";
assert.match(recommendations,/Existing adventure/);
assert.match(recommendations,/Start guide/);
assert.match(recommendations,/Rune Mysteries/);
assert.ok(!recommendations.includes("Sheep Shearer"),"completed starter is excluded");
assert.ok(!recommendations.includes("Tutorial Island"),"completed tutorial is excluded");
const completedMessages:any[]=[];
const completed=new QuestHelperSession(data=>completedMessages.push(data),()=>"finished-session");
completed.select("cooks_assistant");completed.update("Experienced");
completed.acceptCatalog({protocol:1,session:"finished-session",sourceCommit:"abc",quests:state.catalog.quests,diagnostics:[]});
completed.update("Experienced",{tick:1} as any);
const evaluation=completedMessages.find(m=>m.type==="evaluate");
assert.ok(completed.accept({protocol:1,session:evaluation.session,sequence:evaluation.sequence,questKey:"cooks_assistant",sourceCommit:"abc",status:"complete",activeStep:null,panels:[],diagnostics:[]}));
assert.equal(completed.getState().catalog?.quests.find(q=>q.questKey==="cooks_assistant")?.status,"FINISHED","suggestions update immediately after completion");
const freshMessages:any[]=[];
const fresh=new QuestHelperSession(data=>freshMessages.push(data),()=>"fresh-session");
fresh.update("AfterTutorial");fresh.acceptCatalog({protocol:1,session:"fresh-session",sourceCommit:"abc",quests:state.catalog.quests,diagnostics:[]});
assert.equal(fresh.getState().selected,"","completed tutorial is never automatically restarted");
console.log("Quest Helper first-login guidance and recommendations passed");
