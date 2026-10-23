import { strict as assert } from 'node:assert';
import { QuestHelperEvents } from '../game/plugins/questhelper/QuestHelperEvents';
const queue=new QuestHelperEvents(2); queue.push({type:'chatMessage',tick:1,message:'A'}); queue.push({type:'widgetLoaded',tick:1,groupId:2});
assert.deepEqual(queue.drain().map(x=>x.type),['chatMessage','widgetLoaded']); assert.equal(queue.drain().length,0);
queue.push({type:'a',tick:2});queue.push({type:'b',tick:2});assert.throws(()=>queue.push({type:'c',tick:2}),/overflow/i);queue.clear();assert.equal(queue.drain().length,0);
console.log('quest helper ordered bounded events passed');
