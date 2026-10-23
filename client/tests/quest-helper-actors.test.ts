import { strict as assert } from 'node:assert';
import { collectHelperNpc } from '../game/plugins/questhelper/QuestHelperSnapshot';
const client:any={npcTypeLoader:{load:()=>({id:10,name:'Guide',combatLevel:4})},varManager:{},npcEcs:{getNpcTypeId:()=>10,getServerState:()=>({tileX:3200,tileY:3201,plane:0}),isLinked:()=>true,getServerId:()=>42,getSeqId:()=>-1,getRotation:()=>0,getInteractionIndex:()=>32771}};
const npc=collectHelperNpc(client,7);assert.equal(npc.index,42);assert.equal(npc.ecsIndex,7,'native index survives separately from server identity');
assert.equal(npc.interactingIndex,32771);console.log('quest helper NPC server and native identity mapping passed');
