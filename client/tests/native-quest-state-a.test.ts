/** Run with client/node_modules/.bin/tsx --tsconfig client/tsconfig.json --test this-file after server build. */
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import { createCacheVm } from '../scripts/cache/cs2-sweep';

const server = path.resolve(__dirname, '../../server');
process.chdir(server);
const { Server } = require(path.join(server, 'dist/Server'));
Server.installProductionPathResolver();
const { PluginManager } = require(path.join(server, 'dist/plugins/PluginManager'));
const { Player } = require(path.join(server, 'dist/game/entity/impl/player/Player'));
const { PlayerSession } = require(path.join(server, 'dist/net/PlayerSession'));
const exported: any[] = [];
const Q = require(path.join(server, 'plugins/quests/QuestRuntime'));
const { questMetadata } = require(path.join(server, 'plugins/quests/QuestList.QuestRuntime'));
const { CacheDefinitions } = require(path.join(server, 'dist/game/cache/CacheDefinitions'));
const logins: Function[] = [];
const custom = new Map<string, Function[]>();
const emitted: any[] = [];
let vm: any;

// Independent QH 06da90 phase keys and native cache completion thresholds, not mapper output.
const cases = [
    ['BetweenARock', 'between_a_rock', [0,10,20,30,40,50,60,70,80,90,100], [0,10,20,30,40,50,60,70,80,90,110]],
    ['CurseOfArrav', 'curse_of_arrav', [0,2,4,6,8,10,12,14,16,18,20,30,32,34,38,42,44,46,48,50,52,58], [0,2,4,6,8,10,12,14,16,18,20,30,32,34,38,42,44,46,48,50,52,60]],
    ['EaglesPeak', 'eagles_peak', [0,1,2,3,4,5,6,7,8], [0,5,10,15,15,20,25,35,40]],
    ['EnlightenedJourney', 'enlightened_journey', [0,1,2,3,4,5,6,7,8], [0,20,40,60,70,80,90,100,200]],
    ['EyesOfGlouphrie', 'the_eyes_of_glouphrie', [0,1,2,3,4,5,6,7,8,9,10,11,12], [0,1,5,15,20,20,20,25,27,35,36,50,60]],
    ['ForgettableTale', 'forgettable_tale', [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18], [0,10,20,30,30,40,40,50,50,60,70,70,100,100,105,118,120,130,140]],
    ['FremennikTrials', 'fremennik_trials', [0,1,2,3,4,5,6,7,8], [0,1,2,3,4,5,6,7,10]],
    ['MourningsEndPartI', 'mournings_end_part_i', [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14], [0,2,3,3,3,4,5,5,5,6,6,6,7,8,9]],
    ['DreamMentor', 'dream_mentor', [0,2,6,16,18,20,22,24,26,28,30], [0,4,6,16,18,20,22,24,24,26,28]],
] as const;

before(async () => {
    process.chdir(server);
    await require(path.join(server, 'dist/game/cache/CachePipeline')).CachePipeline.initialize(server);
    const base = PluginManager.createApi('NativeQuestStateA');
    const api: any = new Proxy(base, { get(target, key) {
        if (key === 'withProfileLabel') return () => api;
        if (key === 'onPlayerLogin') return (fn: Function) => logins.push(fn);
        if (key === 'onCustomEvent') return (name: string, fn: Function) => custom.set(name, [...(custom.get(name) ?? []), fn]);
        if (key === 'emitCustomEvent') return (name: string, event: any) => {
            emitted.push({name,event});
            if(name==='quest:is-complete') for(const fn of custom.get(name)??[]) fn(event);
        };
        if (typeof key === 'string' && (/^on[A-Z]/.test(key) || ['persistAttribute','registerArea','registerCommand','log'].includes(key))) return () => {};
        return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
    }});
    for (const [file] of cases) require(path.join(server, 'plugins/quests/quests', file + '.Quest'))(api);
    require(path.join(server,'plugins/quests/quests/FairytaleIGrowingPains.Quest'))(api);
    require(path.join(server,'plugins/quests/quests/FairytaleIICureAQueen.Quest'))(api);
    vm = createCacheVm(path.join(server,'caches',fs.readFileSync(path.join(server,'target.txt'),'utf8').trim())).vm;
});

function fixture(t: any, initial: Record<string, any> = {}) {
    const channel = {kind:'test',remoteAddress:'127.0.0.1',isOpen:()=>true,send:()=>true,close(){},onData(){},onError(){},onClose(){}};
    const player = new Player(new PlayerSession(channel));
    player.setUsername('nativestatea');
    for (const [key,value] of Object.entries(initial)) player.setAttribute(key,value);
    const sender = player.getPacketSender(), sent = new Map<string,number>();
    const config=sender.sendConfig.bind(sender),bit=sender.sendVarbit.bind(sender);
    t.mock.method(sender,'sendConfig',(id:number,value:number)=>{
        const result=config(id,value);sent.set('p'+id,value);
        vm.context.varManager.setVarp(id,sender.getVarp(id));return result;
    });
    t.mock.method(sender,'sendVarbit',(id:number,value:number)=>{
        const result=bit(id,value);sent.set('b'+id,value);
        const def=CacheDefinitions.getVarbit(id);
        vm.context.varManager.setVarp(def.baseVar,sender.getVarp(def.baseVar));return result;
    });
    const attributes={get:(key:string)=>player.getAttribute(key),set:(key:string,value:any)=>player.setAttribute(key,value)};
    return {player,attributes,sender,sent};
}
function quest(key: string) { return Q.getRegisteredQuests().find((q: any) => q.key === key); }
function wire(q: any, sent: Map<string,number>) { return sent.get(q.varbitId === undefined ? 'p'+q.varpId : 'b'+q.varbitId); }
function nativeStatus(q: any) {
    vm.runScriptEvent({ args: [4029, questMetadata(q, CacheDefinitions).rowId] });
    assert.equal(vm.lastError,null);
    return vm.intStack[0];
}

for (const [,key,stages,expected] of cases) {
    test(key + ': native phases and statuses preserve internal stages and stage-change callbacks', t => {
        const q = quest(key), f = fixture(t);
        for (let i=0;i<stages.length;i++) {
            const stage=stages[i];
            q.setStage(f.player,stage);
            assert.equal(q.getStage(f.player),stage);
            assert.equal(wire(q,f.sent),expected[i],`${key} saved ${stage}`);
            const parent=q.varbitId===undefined?q.varpId:CacheDefinitions.getVarbit(q.varbitId).baseVar;
            exported.push({key,rowId:questMetadata(q,CacheDefinitions).rowId,stage,complete:q.completionValue,varpId:q.varpId,varbitId:q.varbitId,value:expected[i],parentVarp:parent,parentValue:f.sender.getVarp(parent),expectedStatus:stage===0?1:stage>=q.completionValue?2:0});
            assert.equal(nativeStatus(q),stage===0?1:stage>=q.completionValue?2:0,`${key} native status at ${stage}`);
            assert.equal(emitted.at(-1).name,'quest:stage-changed');
            assert.equal(emitted.at(-1).event.stage,stage);
        }
    });
    test(key + ': legacy completed save replays on login and after bootstrap without awarding rewards', t => {
        const q=quest(key), f=fixture(t,{ ['quest.'+key+'.stage']: String(q.completionValue), 'quest.points': 17 });
        // Bootstrap may overwrite the same parent varp. Both replay paths must restore native state.
        const loginReplay = logins.find(fn=>fn===Q.sendQuestVarps);
        assert.equal(typeof loginReplay,'function');
        for (const replay of [loginReplay!, (event: any) => { for (const fn of custom.get('player:bootstrap-complete') ?? []) fn(event); }]) {
            assert.equal(typeof replay,'function');
            vm.context.varManager.setVarp(q.varpId,0);
            replay!({player:f.player});
            assert.equal(wire(q,f.sent),expected.at(-1));
            assert.equal(nativeStatus(q),2);
            assert.equal(q.getStage(f.player),q.completionValue);
            assert.equal(f.attributes.get('quest.points'),17);
        }
    });
}

test('existing durable substage flags retain native checkpoint meanings', t => {
    const rock=quest('between_a_rock'), f=fixture(t,{'quest.between_a_rock.avatar-killed':true});
    rock.setStage(f.player,90);
    assert.equal(wire(rock,f.sent),100,'Avatar beaten waits for Dondakan; it is not completed');
    assert.equal(nativeStatus(rock),0);
    const viking=quest('fremennik_trials');
    let trials=0;
    for(let i=0;i<7;i++) trials |= 2 << (i*3);
    f.attributes.set('quest.fremennik_trials.trials',trials);
    viking.setStage(f.player,7);
    assert.equal(wire(viking,f.sent),8,'all seven votes await Brundt; saved stage remains capped at7');
    assert.equal(nativeStatus(viking),0);
});

test('native flag-sensitive checkpoints accept legacy string stages and preserve sibling bits', t => {
    const f=fixture(t);
    for (const [key,stage,attribute,flag,value] of [
        ['between_a_rock','90','quest.between_a_rock.avatar-killed',true,100],
        ['the_eyes_of_glouphrie','10','quest.the_eyes_of_glouphrie.bits',1<<5,40],
        ['forgettable_tale','11','quest.forgettable_tale.conductor',true,80],
    ] as const) {
        const q=quest(key);f.attributes.set(attribute,flag);
        assert.equal(q.varbitValue(stage,f.player),value,'direct legacy mapping contract');
        f.attributes.set('quest.'+key+'.stage',stage);
        const def=CacheDefinitions.getVarbit(q.varbitId),sentinel=1<<30;
        f.sender.sendConfig(def.baseVar,sentinel);
        Q.sendQuestVarps({player:f.player});
        assert.equal(wire(q,f.sent),value);
        assert.equal(f.sender.getVarp(def.baseVar)&sentinel,sentinel);
        assert.equal(f.attributes.get('quest.'+key+'.stage'),stage);
        assert.equal(nativeStatus(q),0);
    }
});
test('dialogue flag changes publish their new native checkpoint immediately', t => {
    const f=fixture(t), eyes=quest('the_eyes_of_glouphrie'), tale=quest('forgettable_tale');
    eyes.setStage(f.player,10);
    for(const fn of custom.get('npc-dialogue:choice')??[]) fn({player:f.player,npcId:4913,option:"Phew! I've got that machine working now. What do I need to do now?"});
    assert.equal(wire(eyes,f.sent),40);assert.equal(eyes.getStage(f.player),10);
    tale.setStage(f.player,11);
    for(const fn of custom.get('npc-dialogue:choice')??[]) fn({player:f.player,npcId:2385,option:'Ask about closed off tunnel.'});
    assert.equal(wire(tale,f.sent),80);assert.equal(tale.getStage(f.player),11);
});
test('native progress also restores the cache NPC morphs rather than only list colors', t => {
    const f=fixture(t),rock=quest('between_a_rock'),eagles=quest('eagles_peak');
    rock.setStage(f.player,90);
    assert.equal(CacheDefinitions.resolveNpc(6262,f.sender)?.id,4890,'Dondakan before reward');
    rock.setStage(f.player,100);
    assert.equal(CacheDefinitions.resolveNpc(6262,f.sender)?.id,4891,'Dondakan post-quest');
    eagles.setStage(f.player,3);
    assert.equal(CacheDefinitions.resolveNpc(2023,f.sender)?.id,1484,'Nickolaus stranded in the nest');
    eagles.setStage(f.player,8);
    assert.equal(CacheDefinitions.resolveNpc(2023,f.sender),undefined,'Nickolaus leaves the nest');
    assert.equal(CacheDefinitions.resolveNpc(2024,f.sender)?.id,1485,'Nickolaus is at camp');
    const dream=quest('dream_mentor');
    for(const stage of [16,26,28,30]) {
        dream.setStage(f.player,stage);
        assert.equal(CacheDefinitions.resolveNpc(6126,f.sender)?.id,3472,
            'native Jack remains available at armour, dream, return and completed phases');
    }
});
test('Fairytale II starts at acceptance, after the native inclusive unstarted threshold', t => {
    const q=quest('fairytale_ii_cure_a_queen'), f=fixture(t);
    assert.equal(questMetadata(q,CacheDefinitions).unstartedstate[0],10);
    assert.equal(q.startedValue,20);
    for(const saved of [0,5,10,'10']) {
        f.attributes.set('quest.'+q.key+'.stage',saved);
        Q.sendQuestVarps({player:f.player});
        assert.equal(wire(q,f.sent),Number(saved),'wire phases remain canonical');
        assert.equal(q.isStarted(f.player),false,'waiting/ready precedes acceptance');
        assert.equal(nativeStatus(q),1);
    }
    assert.match(q.buildJournal(f.player,q).join(' '),/crops/);
    const ft1=quest('fairytale_i_growing_pains');
    f.attributes.set('quest.'+ft1.key+'.stage',ft1.completionValue);
    for(const fn of custom.get('npc-dialogue:hook')??[]) fn({player:f.player,npcId:5832,hook:'quest:fairytale-ii-cure-a-queen:start'});
    assert.equal(q.getStage(f.player),20,'actual acceptance hook advances to investigation');
    assert.equal(q.isStarted(f.player),true);
    assert.equal(wire(q,f.sent),20);
    assert.equal(nativeStatus(q),0);
    assert.match(q.buildJournal(f.player,q).join(' '),/Martin asked me to find out/);
});
test('late Dream Mentor and Mourning checkpoints stay unfinished until their existing reward call', t => {
    for(const [key,stage,nativeValue] of [['mournings_end_part_i',13,8],['dream_mentor',28,26]] as const) {
        const q=quest(key), f=fixture(t,{['quest.'+key+'.stage']:String(stage),'quest.points':17});
        const skills=PluginManager.getCoreApi().Skill.values();
        const initialXp=skills.map((skill:any)=>f.player.getSkillManager().getExperience(skill));
        for(const replay of [logins.find(fn=>fn===Q.sendQuestVarps), (event:any)=>{for(const fn of custom.get('player:bootstrap-complete')??[])fn(event);}]) {
            replay!({player:f.player});
            assert.equal(wire(q,f.sent),nativeValue);
            assert.equal(nativeStatus(q),0,'native cache must not show green before reward');
            assert.equal(q.isComplete(f.player),false);
            assert.equal(q.getStage(f.player),stage);
            assert.equal(f.player.getAttribute('quest.points'),17);
            assert.deepEqual(skills.map((skill:any)=>f.player.getSkillManager().getExperience(skill)),initialXp);
        }
        assert.equal(q.complete(f.player,{scroll:false,announce:false}),true);
        assert.equal(q.getStage(f.player),q.completionValue);
        assert.equal(nativeStatus(q),2);
        assert.equal(f.player.getAttribute('quest.points'),17+q.questPoints);
        const items=f.player.getInventory().getItems().map((item:any)=>item.clone());
        const xp=skills.map((skill:any)=>f.player.getSkillManager().getExperience(skill));
        assert.ok(xp.some((value:number,i:number)=>value>initialXp[i]),'existing XP reward is paid');
        assert.equal(q.complete(f.player,{scroll:false,announce:false}),false);
        assert.equal(f.player.getAttribute('quest.points'),17+q.questPoints);
        assert.deepEqual(f.player.getInventory().getItems(),items);
        assert.deepEqual(skills.map((skill:any)=>f.player.getSkillManager().getExperience(skill)),xp);
    }
});
test('optional external evidence export contains only native state',()=>{
    if(process.env.NATIVE_STATE_CASES_OUT) fs.writeFileSync(process.env.NATIVE_STATE_CASES_OUT,JSON.stringify(exported,null,2));
});
