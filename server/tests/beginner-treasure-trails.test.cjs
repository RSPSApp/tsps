const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();
const { PluginManager } = require("../dist/plugins/PluginManager");
const Data = require("../plugins/treasuretrails/Data.BeginnerTreasureTrails");
const plugin = require("../plugins/treasuretrails/BeginnerTreasureTrails.plugin");
const core = PluginManager.getCoreApi();
const Runtime = require("../plugins/treasuretrails/Runtime.BeginnerTreasureTrails");
const Rewards = require("../plugins/treasuretrails/Rewards.BeginnerTreasureTrails");
const Capacity = require("../plugins/treasuretrails/Capacity.ClueCapacity");

function fixture() {
  const actions = new Map(), events = new Map(), attributes = new Map(), sent = [], ground = [], spawned = [];
  let position = new core.Location(3222, 3218, 0), chain;
  const items = Array(28).fill(null), worn = [];
  const inventory = {
    getItems: () => items, refreshItems() {}, getFreeSlots: () => items.filter(i => !i || i.getId() < 1).length,
    isFull() { return this.getFreeSlots() === 0; },
    contains: id => items.some(i => i?.getId() === id && i.getAmount() > 0),
    deleteAtSlot(slot, amount) { const item = items[slot]; if (!item) return; if (item.getAmount() <= amount) items[slot] = null; else item.setAmount(item.getAmount() - amount); },
    deleteNumber(id, amount) { const slot = items.findIndex(i => i?.getId() === id); if (slot >= 0) this.deleteAtSlot(slot, amount); },
    adds(id, amount) { this.forceAdd(null, new core.Item(id, amount)); },
    forceAdd(player, item) { const slot = items.findIndex(i => !i || i.getId() < 1); if (slot < 0) ground.push(item); else items[slot] = item; },
  };
  const sender = new Proxy({}, {get: (_, name) => (...args) => sent.push([name, ...args])});
  const player = { getInventory: () => inventory, getEquipment: () => ({getItems: () => worn}), getBanks: () => [], getBank: () => ({getItems: () => []}),
    getPacketSender: () => sender, getLocation: () => position, getPrivateArea: () => null,
    getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: message => sent.push(["message", message]), performAnimation: value => sent.push(["animation", value]),
    getDialogueManager: () => ({startDialogues: value => { chain = value; }}) };
  const api = { core, persistAttribute() {}, onItemAction: (name, handlers) => actions.set(name, {...actions.get(name), ...handlers}),
    onBeforeNpcInteraction() {}, onCanUseItem() {}, onCustomEvent: (name, fn) => { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    emitCustomEvent: (name, request) => { for (const fn of events.get(name) ?? []) fn(request); },
    onPlayerLogout() {}, onPlayerDisconnect() {}, onPlayerLogin() {}, onInterfaceActionButton() {},
    spawnNpc: def => { const npc = {getLocation: () => new core.Location(def.x, def.y, def.z), def}; spawned.push(npc); return npc; },
    removeNpc: npc => { npc.removed = true; }, getRegionManager: () => ({blocked: () => false, canMovestart: () => true}) };
  api.onCustomEvent("quest:is-complete", request => { if (request.key === "x_marks_the_spot") request.complete = true; });
  plugin.register(api);
  require("../plugins/treasuretrails/ClueCapacity.plugin").register(api);
  function place(step, trailLength = 1, slot = 0) {
    const item = items[slot] = new core.Item(23182, 1);
    const state = { ...Runtime.stateOf(item), row: step.row, length: trailLength, completed: 0, task: null, hotcold: Runtime.data().hotcold[0].row };
    item.setMetaValue(Runtime.TRAIL_META, state);
    position = new core.Location(step.location.x, step.location.y, step.location.z);
    return { item, slot, state: item.getMetaValue(Runtime.TRAIL_META), step };
  }
  function talk(trail, npcId = trail.step.npcIds[0], npc = {getLocation: () => position}) {
    const event = { player, npcId, npc, clickType: 1, handled: false, definition: {getActions: () => ["Talk-to"]} };
    Runtime.talk(event); return event;
  }
  return { player, items, worn, inventory, attributes, actions, events, api, sent, ground, spawned, place, talk,
    event: (slot = 0) => ({player, slot, item: items[slot], itemId: items[slot]?.getId()}),
    move: target => { position = new core.Location(target.x, target.y, target.z); },
    finish: () => { for (const d of chain.getDialogues().values()) if (d instanceof core.ActionDialogue) d.send(player); },
  };
}

test("conditional NPC interceptors run before earlier quest handlers and can fall through", () => {
  const api = PluginManager.createApi("BeginnerHookContract");
  const calls = [];
  api.onNpcInteraction(event => { calls.push("ordinary"); event.handled = true; });
  api.onBeforeNpcInteraction(event => { calls.push("before"); if (event.player.match) event.handled = true; });
  const npc = { getCurrentDefinition: () => ({}) };
  assert.equal(PluginManager.emitNpcInteraction({ player: {match: true}, npc, handled: false }), true);
  assert.deepEqual(calls, ["before"]);
  calls.length = 0;
  PluginManager.emitNpcInteraction({ player: {}, npc, handled: false });
  assert.deepEqual(calls, ["before", "ordinary"]);
});

test("all beginner step families come from the installed cache", () => {
  const data = Data.load(core);
  assert.equal(data.steps.length, 26);
  for (const [kind, count] of [["anagram", 9], ["npc", 4], ["charlie", 1], ["hotcold", 1], ["emote", 6], ["map", 5]]) {
    assert.equal(data.steps.filter(s => s.kind === kind).length, count, kind);
  }
  assert.equal(data.tasks.length, 8);
  assert.equal(data.hotcold.length, 5);
  assert.equal(data.scroll, 23182);
  assert.equal(data.device, 23183);
  assert.equal(data.casket, 23245);
});

test("Read keeps the existing generic beginner clue and stable real clue state", () => {
  const actions = new Map();
  plugin.register({ core, persistAttribute() {}, onItemAction(name, handlers) { actions.set(name, handlers); },
    onBeforeNpcInteraction() {}, onCanUseItem() {}, onCustomEvent() {}, onPlayerLogout() {}, onPlayerDisconnect() {}, onPlayerLogin() {},
    onInterfaceActionButton() {}, onItemOnNpc() {}, onServerStartup() {} });
  const item = new core.Item(23182, 1);
  const sent = [];
  const inventory = { getItems: () => [item], refreshItems() {} };
  const player = { getInventory: () => inventory, getPacketSender: () => ({sendInterface: id => sent.push(id), sendString: text => sent.push(text)}),
    sendMessage: text => sent.push(text), setAttribute() {}, getAttribute() {} };
  const event = { player, itemId: 23182, item, slot: 0 };
  actions.get("Clue scroll (beginner)").Read(event);
  const state = JSON.stringify(item.meta);
  assert.ok(state.includes("treasure-trails:beginner"));
  actions.get("Clue scroll (beginner)").Read(event);
  assert.equal(JSON.stringify(item.meta), state);
  assert.equal(item.getId(), 23182);
  assert.equal(inventory.getItems()[0], item);
  assert.ok(sent.length >= 2);
});

test("beginner length boundaries are 10% one, 45% two and 45% three", () => {
  for (const [random, expected] of [[0,1],[0.099999,1],[0.1,2],[0.549999,2],[0.55,3],[0.99999,3]]) assert.equal(Runtime.trailLength(() => random), expected);
});

test("every anagram and ordinary NPC completes only after the dialogue, once", () => {
  const f = fixture();
  for (const step of Runtime.data().steps.filter(s => ["anagram","npc"].includes(s.kind))) {
    f.items.fill(null);
    const trail = f.place(step);
    assert.equal(f.talk(trail, core.ItemIdentifiers.COINS).handled, false);
    assert.equal(f.talk(trail).handled, true, step.key);
    assert.equal(f.items[0].getId(), 23182);
    f.finish();
    assert.equal(f.items[0].getId(), 23245, step.key);
    f.finish();
    assert.equal(f.items.filter(i => i?.getId() === 23245).length, 1);
  }
});

test("NPC clue targets include live cache transforms such as Archmage Sedridor",()=>{
  const f=fixture(),step=Runtime.data().steps.find(s=>s.key.endsWith("_sedridor"));
  const npcId=core.CacheDefinitions.getNpc(step.npcIds[0]).transforms.find(id=>id>=0);
  const trail=f.place(step);assert.equal(f.talk(trail,npcId).handled,true);f.finish();
  assert.equal(f.items[0].getId(),23245);
});

test("interrupted or stale NPC dialogue cannot advance a banked/dropped clue", () => {
  const f = fixture();
  const trail = f.place(Runtime.data().steps.find(s => s.kind === "anagram"));
  f.talk(trail);
  const dropped = f.items[0].clone();
  f.items[0] = null;
  f.finish();
  assert.equal(dropped.getId(), 23182);
  f.items[0] = new core.Item(dropped.getId(), 1, JSON.parse(JSON.stringify(dropped.meta)));
  assert.deepEqual(Runtime.stateOf(f.items[0]), dropped.getMetaValue(Runtime.TRAIL_META));
  f.talk(Runtime.trails(f.player)[0]);
  f.finish();
  assert.equal(f.items[0].getId(), 23245);
});

test("all five maps show their cache map and require the exact tile and plane", () => {
  const f = fixture();
  f.items[27] = new core.Item(core.ItemIdentifiers.SPADE, 1);
  for (const step of Runtime.data().steps.filter(s => s.kind === "map")) {
    const trail = f.place(step);
    Runtime.read(f.event());
    assert.deepEqual(f.sent.at(-1), ["sendInterface", step.interfaceId]);
    f.move({...step.location, x: step.location.x + 1});
    let event = {player:f.player,itemId:core.ItemIdentifiers.SPADE, option:"Dig", allow:true};
    Runtime.dig(event); assert.equal(event.allow, true);
    f.move({...step.location,z:1}); Runtime.dig(event); assert.equal(event.allow,true);
    f.move(step.location); Runtime.dig(event); assert.equal(event.allow,false);
    assert.equal(f.items[0].getId(),23245,step.key);
    assert.equal(Runtime.advance(f.player,trail),false);
  }
});

test("all eight Charlie tasks accept the exact unnoted item and consume it once", () => {
  const f = fixture(), step = Runtime.data().steps.find(s => s.kind === "charlie");
  for (const task of Runtime.data().tasks) {
    f.items.fill(null);
    let trail = f.place(step);
    f.talk(trail); // The initial request is stable and does not complete the step.
    assert.equal(f.items[0].getId(),23182);
    f.items[0].setMetaValue(Runtime.TRAIL_META,{...Runtime.stateOf(f.items[0]),task:task.row});
    trail = Runtime.trails(f.player)[0];
    const note = core.CacheDefinitions.getItem(task.itemId).note;
    if (note > 0) { f.items[1]=new core.Item(note,1); f.talk(trail); assert.equal(f.items[0].getId(),23182); }
    f.items[1] = new core.Item(task.itemId,1);
    f.talk(trail); f.finish();
    assert.equal(f.items[0].getId(),23245,task.text);
    assert.equal(f.items[1],null);
    f.finish(); assert.equal(f.items[0].getId(),23245);
  }
});

test("Reldo supplies only beginner devices and all five hot/cold targets dig within 9x9", () => {
  const f=fixture(),step=Runtime.data().steps.find(s=>s.kind==="hotcold");
  for(const target of Runtime.data().hotcold){
    f.items.fill(null);
    const trail=f.place(step);
    f.items[0].setMetaValue(Runtime.TRAIL_META,{...trail.state,hotcold:target.row});
    f.talk(Runtime.trails(f.player)[0]);
    assert.ok(f.items.some(i=>i?.getId()===23183));
    f.items[27]=new core.Item(core.ItemIdentifiers.SPADE,1);
    f.move(target.location);
    const deviceSlot=f.items.findIndex(i=>i?.getId()===23183);
    Runtime.feel(f.event(deviceSlot));
    assert.match(f.sent.at(-1)[1],/visibly shaking/);
    f.move({...target.location,x:target.location.x+5});
    let e={player:f.player,itemId:core.ItemIdentifiers.SPADE,option:"Dig",allow:true};
    Runtime.dig(e);assert.equal(e.allow,true);
    f.move({...target.location,x:target.location.x+4,y:target.location.y+4});
    Runtime.dig(e);assert.equal(e.allow,false);
    assert.equal(f.items[0].getId(),23245,target.key);
    assert.ok(f.items.some(i=>i?.getId()===23183));
  }
  for(const [d,t]of [[0,"visibly shaking"],[3,"visibly shaking"],[4,"incredibly hot"],[29,"incredibly hot"],[30,"very hot"],[69,"very hot"],[70,"hot"],[99,"hot"],[100,"warm"],[149,"warm"],[150,"cold"],[199,"cold"],[200,"very cold"],[499,"very cold"],[500,"ice cold"]])assert.equal(Runtime.temperature(d),t);
});

test("all six emote clues require location, actual equipment and talking to personal Uri",()=>{
  const f=fixture();
  for(const step of Runtime.data().steps.filter(s=>s.kind==="emote")){
    f.items.fill(null);f.worn.length=0;
    const trail=f.place(step),before=f.spawned.length;
    Runtime.emote({player:f.player,slot:(step.emote+1)%20});assert.equal(f.spawned.length,before);
    f.move({...step.location,z:1});Runtime.emote({player:f.player,slot:step.emote});assert.equal(f.spawned.length,before);
    f.move(step.location);
    for(const id of step.equipment)f.worn.push(new core.Item(id,1));
    Runtime.emote({player:f.player,slot:step.emote});assert.equal(f.spawned.length,before+1,step.key);
    const uri=f.spawned.at(-1);assert.equal(uri.def.owner,f.player);assert.equal(uri.def.ownerOnly,true);
    assert.equal(f.talk(trail,Runtime.data().uri,{}).handled,false);
    assert.equal(f.talk(trail,Runtime.data().uri,uri).handled,true);f.finish();
    assert.equal(f.items[0].getId(),23245);assert.equal(uri.removed,true);
  }
});

test("canonical rewards cover all items with an exact full weighted probability table",()=>{
  assert.equal(Rewards.TABLE.entries.length,74);
  assert.equal(Rewards.TABLE.entries.reduce((sum,e)=>sum+e.weight,0),Rewards.TABLE.out_of);
  for(const e of Rewards.TABLE.entries){assert.equal(core.CacheDefinitions.getItem(e.item_id).name,e.name);if(e.noted)assert.ok(core.CacheDefinitions.getItem(e.item_id).note>0);}
  const values=[0,0,0];
  assert.equal(Rewards.roll(()=>values.shift()??0).length,1);
  assert.equal(Rewards.roll(()=>0.99999).length,3);
});

test("casket opens once, grants full-inventory overflow, increments completion and displays actual rewards",()=>{
  const f=fixture();
  f.items[0]=new core.Item(23245,1);for(let i=1;i<28;i++)f.items[i]=new core.Item(995,1);
  const e=f.event();assert.equal(Rewards.open(e),true);
  assert.equal(f.attributes.get(Runtime.COMPLETED_ATTRIBUTE),1);
  assert.ok(f.sent.some(([name,group])=>name==="sendInterface"&&group===73));
  assert.equal(Rewards.open(e),false);
  assert.equal(f.attributes.get(Runtime.COMPLETED_ATTRIBUTE),1);
  const request={player:f.player,category:"Treasure Trails (Beginner)",count:null};
  f.api.emitCustomEvent("collection-log:category-count",request);assert.equal(request.count,1);
});

test("Entrana blocks beginner caskets without consuming them",()=>{
  const f=fixture();f.items[0]=new core.Item(23245,1);f.move({x:2835,y:3335,z:0});
  assert.equal(Rewards.open(f.event()),true);assert.equal(f.items[0].getId(),23245);assert.equal(f.attributes.get(Runtime.COMPLETED_ATTRIBUTE),undefined);
});

test("shared capacity counts all forms and banked boxes across tiers",()=>{
  const f=fixture();f.items[0]=new core.Item(23182,1);
  let request={player:f.player,tier:"beginner",allowed:null};Capacity.canReceive(request);assert.equal(request.allowed,true);
  f.items[1]=new core.Item(24361,1);Capacity.canReceive(request);assert.equal(request.allowed,false);
  request={player:f.player,tier:"easy",allowed:null};Capacity.canReceive(request);assert.equal(request.allowed,true);
  f.items[2]=new core.Item(core.ItemIdentifiers.MINOR_BEGINNER_SCROLL_CASE,1);Capacity.openCase(f.event(2));assert.equal(Capacity.capacity(f.player),3);
  f.items[2]=new core.Item(core.ItemIdentifiers.MINOR_BEGINNER_SCROLL_CASE,1);Capacity.openCase(f.event(2));assert.equal(Capacity.capacity(f.player),3);assert.equal(f.items[2].getId(),30902);
  f.items[2]=new core.Item(core.ItemIdentifiers.MAJOR_BEGINNER_SCROLL_CASE,1);Capacity.openCase(f.event(2));assert.equal(Capacity.capacity(f.player),4);
  f.player.getBank=()=>({getItems:()=>[new core.Item(24361,2)]});
  assert.equal(Capacity.count(f.player),2+core.Bank.TOTAL_BANK_TABS*2);
});

test("scroll boxes open without losing a full stack and NPC drops respect beginner capacity",()=>{
  const f=fixture();f.items[0]=new core.Item(24361,2);for(let i=1;i<28;i++)f.items[i]=new core.Item(995,1);
  Capacity.openBox(f.event());assert.equal(f.items[0].getAmount(),2);
  f.items[1]=null;Capacity.openBox(f.event());assert.equal(f.items[0].getAmount(),1);assert.equal(f.items[1].getId(),23182);
  const request={player:f.player,drops:[{itemId:23182,amount:1},{itemId:core.ItemIdentifiers.CLUE_SCROLL_EASY_,amount:1},{itemId:995,amount:10}]};
  Capacity.filterDrops(request);assert.deepEqual(request.drops.map(d=>d.itemId),[core.ItemIdentifiers.SCROLL_BOX_EASY_,995]);
});

test("Explore unlocks at 600 without gating any other emote",()=>{
  const f=fixture();let request={player:f.player,sequence:core.CacheDefinitions.getSeqId("emote_explore"),allow:true};
  Runtime.canEmote(request);assert.equal(request.allow,false);
  f.attributes.set(Runtime.COMPLETED_ATTRIBUTE,600);request.allow=true;Runtime.canEmote(request);assert.equal(request.allow,true);
  request={player:f.player,sequence:855,allow:true};Runtime.canEmote(request);assert.equal(request.allow,true);
});

test("milestone cases recover when lost but do not duplicate held, banked or consumed cases",()=>{
  const f=fixture(),milestones=Rewards.TABLE.milestones;
  assert.deepEqual(Capacity.milestoneRewards(f.player,49,milestones),[]);
  assert.deepEqual(Capacity.milestoneRewards(f.player,50,milestones),[{itemId:30902,amount:1,noted:false}]);
  f.items[0]=new core.Item(30902,1);assert.deepEqual(Capacity.milestoneRewards(f.player,51,milestones),[]);
  f.items[0]=null;assert.equal(Capacity.milestoneRewards(f.player,52,milestones).length,1);
  f.attributes.set(Capacity.MINOR_ATTRIBUTE,true);assert.deepEqual(Capacity.milestoneRewards(f.player,53,milestones),[]);
  f.player.getBank=()=>({getItems:()=>[new core.Item(30904,1)]});
  assert.deepEqual(Capacity.milestoneRewards(f.player,100,milestones),[]);
});

test("real woodcutting and mining source paths use shared capacity",()=>{
  const f=fixture(),drops=[];
  f.player.getSkillManager=()=>({getCurrentLevel:()=>99});
  const sourceCore={...core,ItemOnGroundManager:{registers:(_player,item)=>drops.push(item)}};
  const api={core:sourceCore,onItemAction(){},onCustomEvent(){},emitCustomEvent:f.api.emitCustomEvent};
  const nests=require("../plugins/skills/woodcutting/ClueNests.Woodcutting");
  const geodes=require("../plugins/skills/mining/ClueGeodes.Mining");
  nests.attach(api);geodes.attach(api);
  f.items[0]=new core.Item(23182,1);
  const previous=Math.random;
  try{
    Math.random=()=>0;
    nests.rollClueNests(f.player,{petBase:10000});
    assert.ok(f.items.some(i=>i?.getId()===core.ItemIdentifiers.SCROLL_BOX_BEGINNER_));
    assert.ok(drops.some(i=>i.getId()===core.ItemIdentifiers.BIRD_NEST_6));
    drops.length=0;
    geodes.rollClueGeodes({player:f.player,skill:core.Skill.MINING,petBase:10000},()=>0);
    assert.equal(f.items.some(i=>i?.getId()===core.ItemIdentifiers.CLUE_GEODE_BEGINNER_),false);
    nests.rollClueNests(f.player,{petBase:10000});
    assert.equal(drops.some(i=>i.getId()===core.ItemIdentifiers.CLUE_NEST_BEGINNER_),false);
  }finally{Math.random=previous;}
});

test("impling clue ownership uses shared capacity for beginner and easy clues",()=>{
  const f=fixture();
  const C=require("../plugins/skills/hunter/Context.Hunter");
  const previous={api:C.H.api,core:C.H.core};C.H.api=f.api;C.H.core=core;
  try{
    f.items[0]=new core.Item(23182,1);assert.equal(C.ownsClue(f.player,"BEGINNER"),false);
    f.items[1]=new core.Item(24361,1);assert.equal(C.ownsClue(f.player,"BEGINNER"),true);
    f.items[2]=new core.Item(core.ItemIdentifiers.CLUE_SCROLL_EASY_,1);assert.equal(C.ownsClue(f.player,"EASY"),false);
    f.items[3]=new core.Item(core.ItemIdentifiers.SCROLL_BOX_EASY_,1);assert.equal(C.ownsClue(f.player,"EASY"),true);
  }finally{Object.assign(C.H,previous);}
});
