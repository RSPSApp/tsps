import { strict as assert } from 'node:assert';
import { collectQuestHelperDefinitions } from '../game/plugins/questhelper/QuestHelperDefinitions';
const client:any={objTypeLoader:{load:()=>({id:100,name:'Noted item',note:99,noteTemplate:799,placeholder:-1,placeholderTemplate:-1,stackability:1,isMembers:true,price:500,inventoryActions:['Use']})},locTypeLoader:{load:()=>({id:10,name:'Door',sizeX:1,sizeY:2,transforms:[11],transform:()=>({id:11,name:'Open door',sizeX:1,sizeY:2})})},npcTypeLoader:{load:()=>({id:20,name:'Guide',size:1,combatLevel:0,transforms:undefined})},varManager:{}};
const definitions=collectQuestHelperDefinitions(client,{items:new Set([100]),objects:new Set([10]),npcs:new Set([20])});
assert.equal(definitions.itemDefinitions['100'].note,799,'RuneLite note means note template');assert.equal(definitions.itemDefinitions['100'].linkedNoteId,99);assert.equal(definitions.objectDefinitions['10'].impostor?.id,11);assert.equal(definitions.npcDefinitions['20'].configs,null);assert.equal(definitions.itemDefinitions['100'].unknown,undefined);
console.log('quest helper accurate cache definitions passed');
