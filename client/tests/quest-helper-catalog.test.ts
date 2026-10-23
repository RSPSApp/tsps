import { strict as assert } from 'node:assert';
import { parseHelperCatalog } from '../game/plugins/questhelper/QuestHelperProtocol';
const catalog:any={protocol:1,sourceCommit:'abc',diagnostics:[],quests:[{questKey:'shield',name:'Shield of Arrav',supported:true,variants:[{helperVariant:'PHOENIX',helperClass:'Phoenix'},{helperVariant:'BLACK_ARM',helperClass:'BlackArm'}]}]};
assert.equal(parseHelperCatalog(catalog)?.quests.length,2,'all branch variants must be selectable');assert.equal(parseHelperCatalog(catalog)?.quests[1].helperVariant,'BLACK_ARM');
console.log('quest helper selectable catalog variants passed');
