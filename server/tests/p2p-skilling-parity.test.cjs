// Run after yarn build: node --test tests/p2p-skilling-parity.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { PacketSender } = require('../dist/net/packet/PacketSender');
const { encodeSound, encodeWidgetOpenSub, encodeWidgetCloseSub } = require('../dist/net/protocol/ClientProtocol');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
// Packet-order fixtures from the complete recorded cinematics; no account data.
const PORCINE_CAMERA = [["sendCameraMoveTo",3168,9672,500,{"rate":10,"rate2":10}],["sendCameraLookAt",3165,9676,50,{"rate":232,"rate2":232}],["sendCameraMoveTo",3162,9676,200,{"rate":232,"rate2":232}],["sendCameraMoveTo",3162,9676,400,{"rate":1,"rate2":2}],["sendCameraLookAt",3167,9676,100,{"rate":1,"rate2":1}],["sendCameraMoveTo",3166,9681,500,{"rate":10,"rate2":10}],["sendCameraLookAt",3166,9676,100,{"rate":10,"rate2":10}],["sendCameraMoveTo",3162,9698,300,{"rate":232,"rate2":232}],["sendCameraLookAt",3163,9699,0,{"rate":232,"rate2":232}],["sendCameraMoveTo",3162,9698,700,{"rate":1,"rate2":1}],["sendCameraMoveTo",3158,9705,800,{"rate":232,"rate2":232}],["sendCameraLookAt",3166,9700,50,{"rate":232,"rate2":232}],["sendCameraMoveTo",3167,9693,375,{"rate":232,"rate2":232}],["sendCameraLookAt",3163,9699,200,{"rate":232,"rate2":232}],["sendCameraMoveTo",3167,9693,900,{"rate":5,"rate2":10}],["sendCameraLookAt",3163,9699,1,{"rate":5,"rate2":1}],["sendCameraMoveTo",3159,9714,600,{"rate":232,"rate2":232}],["sendCameraLookAt",3157,9705,50,{"rate":232,"rate2":232}],["sendCameraMoveTo",3156,9694,800,{"rate":232,"rate2":232}],["sendCameraLookAt",3158,9701,50,{"rate":232,"rate2":232}],["sendCameraLookAt",3162,9699,50,{"rate":2,"rate2":1}],["sendCameraReset"]];
const SLEEPING_CAMERA = [["sendCameraMoveTo",3367,11487,500,{"rate":232,"rate2":232}],["sendCameraLookAt",3367,11479,300,{"rate":232,"rate2":232}],["sendCameraMoveTo",3367,11492,500,{"rate":4,"rate2":4}],["sendCameraLookAt",3367,11484,280,{"rate":3,"rate2":3}],["sendCameraMoveTo",3369,11477,700,{"rate":4,"rate2":4}],["sendCameraLookAt",3364,11493,300,{"rate":4,"rate2":4}],["sendCameraMoveTo",3384,11490,700,{"rate":4,"rate2":4}],["sendCameraLookAt",3364,11491,400,{"rate":4,"rate2":4}],["sendCameraMoveTo",3380,11504,900,{"rate":4,"rate2":4}],["sendCameraLookAt",3366,11489,400,{"rate":2,"rate2":2}],["sendCameraMoveTo",3371,11493,700,{"rate":232,"rate2":232}],["sendCameraLookAt",3368,11486,400,{"rate":232,"rate2":232}],["sendCameraReset"]];
const cameras = p => p.packets.filter(([method]) => ['sendCameraMoveTo','sendCameraLookAt','sendCameraReset'].includes(method));
let index = 1;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
});
function register(name, key, overrides = {}) {
  const hooks = new Map(), events = new Map(), tasks = [], spawned = [], objects = [], removed = [], ground = [], namedObjects = new Map(), buttons = new Map(), providers = [];
  const api = new Proxy({
    core: { ...core, ...overrides, ObjectManager: { register: object => objects.push(object), deregister() {} }, TaskManager: {
      submit: task => { task.setRunning(true); tasks.push(task); }, cancelTasks: key => tasks.filter(task => task.key === key).forEach(task => task.stop()),
    } }, persistAttribute() {},
    getWorld: () => ({ getNpcs: () => [] }), getBonusManager: () => ({ update() {} }),
    onObjectInteraction: (target, actions) => {
      if (typeof target === 'function') { if (!hooks.has('onObjectInteraction')) hooks.set('onObjectInteraction', []); hooks.get('onObjectInteraction').push(target); }
      else for (const [option, fn] of Object.entries(actions)) namedObjects.set(`${target}:${option}`, fn);
    },
    onInterfaceActionButton: (ids, fn) => { for (const id of [].concat(ids)) buttons.set(id, fn); },
    registerNpcCombatMethodProvider: (ids, ctor, options) => providers.push({ ids, ctor, options }),
    onCustomEvent: (name, fn) => { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); },
    emitCustomEvent: (name, payload) => { for (const fn of events.get(name) || []) fn(payload); },
    spawnNpc: spec => {
      let area = null, location = new core.Location(spec.x, spec.y, spec.z); const id = index++;
      const npc = { spec, getId: () => spec.id, getOwner: () => spec.owner, getIndex: () => id, getLocation: () => location,
        getMovementQueue: () => ({ addSteps: to => { location = to; }, reset() {} }), getArea: () => area, setArea: a => { area = a; },
        isPlayer: () => false, isNpc: () => true, getAsNpc: () => npc, isRegistered: () => false,
        moveTo: to => { location = to; }, performAnimation() {}, setPositionToFace() {}, setNpcTransformationId() {},
      }; spawned.push(npc); return npc;
    }, removeNpc: npc => removed.push(npc),
    getItemOnGroundManager: () => ({ getGroundItem: () => null, registerLocation: (...args) => ground.push(args) }),
  }, { get: (target, prop) => prop in target ? target[prop] : (...args) => {
    const fn = args.findLast(value => typeof value === 'function');
    if (fn) { if (!hooks.has(prop)) hooks.set(prop, []); hooks.get(prop).push(fn); }
  } });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  return { api, spawned, objects, removed, ground, events, namedObjects, buttons, providers,
    quest: getRegisteredQuests().findLast(quest => quest.key === key),
    call: (name, value) => { for (const fn of hooks.get(name) || []) fn(value); },
    emit: (name, value) => api.emitCustomEvent(name, value),
    resolve: (name, value) => hooks.get(name)[0](value),
    tick: count => { while (count-- > 0) for (const task of [...tasks]) task.tick(); },
  };
}
function player() {
  const attributes = new Map(), items = new Map(), bank = new Map(), vars = new Map(), packets = [], messages = [], equipment = new Map(), xp = [];
  let location = new core.Location(3158, 9713, 0), area = null, current = null, blocked = false, force = null, interfaceId = -1, chatboxGroupId = -1;
  const id = index++;
  const inventory = { getAmount: id => items.get(id) || 0, contains: id => (items.get(id) || 0) > 0,
    adds: (id, amount) => items.set(id, (items.get(id) || 0) + amount),
    deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) || 0) - amount)),
    getItems: () => [...items].map(([id, amount]) => new core.Item(id, amount)),
    getFreeSlots: () => 28 - [...items].reduce((sum, [id, amount]) => sum + (id === 995 ? Number(amount > 0) : amount), 0),
    refreshItems() {}, isFull: () => inventory.getFreeSlots() <= 0,
  };
  let packet; packet = new Proxy({}, { get: (_, method) => method === 'getVarbit' ? id => vars.get(id) || 0 : method === 'getChatboxGroupId' ? () => chatboxGroupId : (...args) => {
    if (method === 'sendChatboxInterface') chatboxGroupId = args[0];
    if (method === 'closeInterface' && args[0] === chatboxGroupId) chatboxGroupId = -1;
    if (method === 'sendVarbit') vars.set(args[0], args[1]); if (method === 'sendInterface') interfaceId = args[0]; if (method === 'sendInterfaceRemoval') interfaceId = -1; packets.push([method, ...args]); return packet;
  } });
  const p = { attributes, items, bank, equipment, packets, messages, vars, xp,
    getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory, getBank: () => ({ getAmount: id => bank.get(id) || 0 }), getBanks: () => [{ getAmount: id => bank.get(id) || 0 }],
    getEquipment: () => ({ get: id => equipment.has(id) ? new core.Item(equipment.get(id), 1) : null, setItem: (slot, item) => { if (item.getId() >= 0) equipment.set(slot, item.getId()); else equipment.delete(slot); }, refreshItems() {} }),
    getUpdateFlag: () => ({ flag() {} }), getInterfaceId: () => interfaceId,
    getLocation: () => location, moveTo: to => { location = to; }, getArea: () => area, setArea: a => { area = a; },
    getPrivateArea: () => area instanceof core.PrivateArea ? area : null, getIndex: () => id,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, getUsername: () => 'ParityTester', getPacketSender: () => packet,
    getFrameUpdater: () => ({ clear() {} }), getDialogueManager: () => ({ reset: () => { current = null; }, getCurrent: () => current, isActive: () => !!current, startDialogues: chain => { current = chain; } }),
    getMovementQueue: () => ({ setBlockMovement: value => { blocked = value; }, reset() {} }), isBlocked: () => blocked,
    getSkillManager: () => ({ getMaxLevel: () => 50, getCurrentLevel: () => 50, addExperiences: (skill, amount) => xp.push([skill, amount]) }),
    sendMessage: text => messages.push(text), setUntargetable() {}, performAnimation() {}, performGraphic() {},
    getCombat: () => ({ reset() {} }), setForceMovement: value => { force = value; }, getForceMovement: () => force,
  }; return p;
}
const action = (q, p, npcId, stepId, kind) => q.emit('npc-dialogue:action', { player: p, npcId, stepId, kind });
const sceneAction = (q, p, stepId) => action(q, p, 10437, stepId);
const sleepingAction = (q, p, stepId, kind) => action(q, p, 11468, stepId, kind);

test('Porcine uses captured quest stages and the cache morphs to remove the trail', () => {
  const q = register('PorcineOfInterest', 'a_porcine_of_interest'), p = player();
  assert.deepEqual(Array.from({length: 10}, (_, stage) => q.quest.varbitValue(stage, p)), [0,5,10,15,20,25,30,30,35,40]);
  q.call('onPlayerLogin', { player: p }); assert.equal(q.objects.length, 0, 'cache scenery must not be replaced by global concrete variants');
  assert.equal(q.spawned.length, 0, 'canonical Spria and Rosie spawns need no plugin replacement');
});

test('Porcine note opens native interface before the private camera scene; logout clears control locks', () => {
  const q = register('PorcineOfInterest', 'a_porcine_of_interest'), p = player(); q.quest.setStage(p, 3);
  sceneAction(q, p, 'K_pMcL'); assert.ok(p.packets.some(([m, id]) => m === 'sendInterface' && id === 222));
  assert.ok(p.packets.some(([m, text, id]) => m === 'sendString' && id === ((222<<16)|3) && text.includes('uncharted caves')));
  q.emit('interface:closed', { player: p, interfaceId: 222 }); assert.equal(p.isBlocked(), true);
  assert.ok(p.getPrivateArea()); assert.deepEqual(p.packets.find(([m]) => m === 'sendCameraMoveTo').slice(1), [3168,9672,500,{rate:10,rate2:10}]);
  sceneAction(q, p, 'eShaqt'); q.tick(6);
  assert.ok(q.spawned.some(npc => npc.getId() === 10437 && npc.getPrivateArea?.() !== null));
  assert.ok(p.packets.some(([m,x,y,h,r]) => m === 'sendCameraLookAt' && x === 3167 && y === 9676 && h === 100 && r.rate === 1));
  q.call('onPlayerLogout', { player: p }); q.tick(20); assert.equal(p.getPrivateArea(), null); assert.equal(p.isBlocked(), false);
  assert.equal(q.quest.getStage(p), 3); assert.ok(p.packets.some(([m]) => m === 'sendCameraReset'));
});

test('Porcine note opens before closing the real current-cache chatbox and preserves its modal', () => {
  const q = register('PorcineOfInterest', 'a_porcine_of_interest'), p = player(); q.quest.setStage(p, 3);
  const sent = [];
  let interfaceId = -1;
  p.setInterfaceId = value => { interfaceId = value; };
  p.getInterfaceId = () => interfaceId;
  p.isPlayerBot = () => false;
  p.getFrameUpdater = () => ({ clearGroup() {}, shouldUpdate: () => true });
  p.getSession = () => ({ sendClientPacket: packet => { sent.push(packet); return true; } });
  const sender = new PacketSender(p);
  p.getPacketSender = () => sender;
  sender.sendChatboxInterface(217);
  sent.length = 0;
  sceneAction(q, p, 'K_pMcL');
  assert.ok(sent[0].equals(encodeWidgetOpenSub((161 << 16) | 16, 222, 0)));
  assert.ok(sent[1].equals(encodeWidgetCloseSub((162 << 16) | 568)));
  assert.equal(sender.getChatboxGroupId(), -1);
  assert.equal(p.getInterfaceId(), 222);
  sceneAction(q, p, 'K_pMcL'); // Reopening without a chatbox must not close the note itself.
  assert.equal(p.getInterfaceId(), 222);
});

test('Porcine Pig Thing attack and Spria rescue retain recorded camera paths and advance only after waking', () => {
  const q = register('PorcineOfInterest', 'a_porcine_of_interest'), p = player(); q.quest.setStage(p, 3);
  sceneAction(q,p,'K_pMcL'); q.emit('interface:closed',{player:p,interfaceId:222}); q.tick(1);
  sceneAction(q,p,'eShaqt'); q.tick(13); sceneAction(q,p,'GiFHeZ'); q.tick(56);
  assert.ok(p.packets.some(([m,,,,,id]) => m === 'sendProjectile' && id === 1817));
  assert.ok(p.packets.some(([m,x,y,h,r]) => m === 'sendCameraMoveTo' && x === 3167 && y === 9693 && h === 900 && r.rate2 === 10));
  sceneAction(q,p,'32r40G'); q.tick(16); sceneAction(q,p,'Rb2zDN'); q.tick(6);
  assert.ok(q.spawned.some(npc => npc.getId() === 10433));
  assert.ok(p.packets.some(([m,x,y,h,r]) => m === 'sendCameraLookAt' && x === 3162 && y === 9699 && h === 50 && r.rate2 === 1));
  assert.equal(q.quest.getStage(p),3); sceneAction(q,p,'EaeUfj'); q.tick(4);
  assert.equal(q.quest.getStage(p),4); assert.equal(p.vars.get(10582),20); assert.equal(p.getLocation().getX(),3095); assert.equal(p.getLocation().getY(),3267); assert.equal(p.isBlocked(),false);
  assert.deepEqual(cameras(p), PORCINE_CAMERA);
  const sounds = [], sender = new PacketSender({ getSession: () => ({ sendClientPacket: packet => { sounds.push(packet); return true; } }) });
  for (const [method, ...args] of p.packets) if (['sendSound', 'sendSoundEffect'].includes(method)) sender[method](...args);
  assert.deepEqual(sounds, [[2313,77],[3308,86],[694,0],[2453,40]].map(([id,delay]) => encodeSound(id, { loops: 1, delay })));
});

test('Porcine sourhog death creates a private corpse and restores it after relog before cutting the foot', () => {
  const q = register('PorcineOfInterest', 'a_porcine_of_interest'), p = player(); q.quest.setStage(p,5);
  q.call('onPlayerLogin',{player:p}); const boss=q.spawned.at(-1);
  assert.equal(boss.getLocation().getX(),3162); assert.equal(boss.getLocation().getY(),9699);
  q.call('onNpcDeath',{npcId:10436,npc:boss,killer:p,location:new core.Location(3162,9699,0)});
  assert.equal(q.quest.getStage(p),6); assert.ok(q.objects.at(-1).getPrivateArea());
  q.call('onPlayerLogout',{player:p}); q.call('onPlayerLogin',{player:p}); assert.equal(q.objects.at(-1).getId(),40349);
  assert.ok(q.objects.at(-1).getPrivateArea()); action(q,p,501,'Um0TAs','message');
  assert.equal(p.items.get(24944),1); assert.equal(p.vars.get(10583),1); assert.equal(p.vars.get(10582),30);
  action(q,p,501,'fvC8GN','message'); assert.equal(p.items.get(24944),0); assert.equal(p.items.get(995),5000); assert.equal(p.vars.get(10582),35);
  action(q,p,501,'fvC8GN','message'); assert.equal(p.items.get(995),5000);
});

test('Sleeping Giants intro pans with the captured rate pairs in a private workshop', () => {
  const q = register('SleepingGiants','sleeping_giants'),p=player();
  q.emit('npc-dialogue:hook',{player:p,hook:'quest:sleeping-giants:start'}); assert.equal(p.vars.get(13902),5);
  sleepingAction(q,p,'Y4oYGg'); assert.equal(p.vars.get(13902),10); assert.ok(p.getPrivateArea());
  q.tick(23); assert.equal(p.isBlocked(),true);
  const moves=p.packets.filter(([m])=>m==='sendCameraMoveTo'); assert.equal(moves.length,5);
  assert.deepEqual(moves.at(-1).slice(1),[3380,11504,900,{rate:4,rate2:4}]);
  q.tick(8); const line={player:p,npcId:11468,text:'Woah... What is this place?'};q.emit('npc-dialogue:line',line);line.after(); q.tick(2);
  assert.ok(p.packets.some(([m,x,y,h])=>m==='sendCameraMoveTo'&&x===3371&&y===11493&&h===700));
  const end={player:p,npcId:11468,text:'We fix tools...'};q.emit('npc-dialogue:line',end);end.after();
  assert.equal(p.vars.get(13902),15); assert.equal(p.isBlocked(),false); assert.deepEqual(cameras(p), SLEEPING_CAMERA); q.call('onPlayerLogout',{player:p}); assert.equal(p.getPrivateArea(),null);
});

test('Sleeping Giants grindstone repair retains the chisel and commits after the captured work ticks', () => {
  const q=register('SleepingGiants','sleeping_giants'),p=player();q.quest.setStage(p,1);p.items.set(1755,1);
  q.call('onObjectInteraction',{player:p,objectId:43860,clickType:1});
  q.emit('npc-dialogue:choice',{player:p,npcId:11468,option:'Yes.'});
  const line={player:p,npcId:11468,text:'Well that required a bit of elbow grease. It should be good to go now.'};q.emit('npc-dialogue:line',line);line.before();
  q.tick(11); assert.equal(p.vars.get(13905),1);q.tick(1);assert.equal(p.vars.get(13905),2);assert.equal(p.items.get(1755),1);
});

test('Sleeping Giants repair cancellation does not consume resources and relog rebuilds only unrepaired machines', () => {
  const q=register('SleepingGiants','sleeping_giants'),p=player();q.quest.setStage(p,1);p.items.set(1521,1);p.items.set(1539,5);p.items.set(2347,1);
  q.call('onObjectInteraction',{player:p,objectId:43857,clickType:1});q.emit('npc-dialogue:choice',{player:p,npcId:11468,option:'Yes.'});
  const line={player:p,npcId:11468,text:"That looks like it'll do the trick. What do you think?"};q.emit('npc-dialogue:line',line);line.before();q.tick(2);
  q.call('onPlayerLogout',{player:p});q.tick(10);assert.equal(p.items.get(1521),1);assert.equal(p.items.get(1539),5);
  q.call('onPlayerLogin',{player:p});assert.equal(p.vars.get(13904),0);
});


test('Porcine preserves the recorded eye-protection warning and checks goggles across bank tabs', () => {
  const q = register('PorcineOfInterest', 'a_porcine_of_interest'), p = player(); q.quest.setStage(p, 5);
  const unequip = { player: p, item: new core.Item(24942, 1), slot: core.Equipment.HEAD_SLOT, allow: null };
  q.call('onCanUnequip', unequip); assert.equal(unequip.allow, false); assert.ok(p.messages.at(-1).includes('leave your eye protection on'));
  p.bank.set(24942, 1); assert.equal(q.resolve('onNpcDialogueCondition', { player: p, npcId: 10432, stepId: 'aIPCCD' }), true);
  q.quest.setStage(p, 6); unequip.allow = null; q.call('onCanUnequip', unequip); assert.equal(unequip.allow, null);
});

test('Sleeping Giants leaves its repair instance before the captured public sword tutorial', () => {
  const q = register('SleepingGiants', 'sleeping_giants'), p = player(); p.moveTo(new core.Location(3366,11483,0)); q.quest.setStage(p,2);
  q.call('onPlayerLogin',{player:p}); assert.ok(p.getPrivateArea());
  const ready={player:p,npcId:11468,text:'Kovac agree. Ready to make sword?'};q.emit('npc-dialogue:line',ready);ready.before();assert.equal(p.vars.get(13902),20);
  const next={player:p,npcId:11468,text:'then we can start.'};q.emit('npc-dialogue:line',next);next.after();assert.equal(p.vars.get(13902),25);q.tick(2);
  assert.equal(p.getPrivateArea(),null);assert.equal(p.getLocation().getX(),3366);assert.equal(p.getLocation().getY(),11495);
  let commission;q.api.onCustomEvent('giants-foundry:start-commission',event=>{commission=event;});
  const style={player:p,npcId:11470,text:'Kovac need a Flat Broad sword.'};q.emit('npc-dialogue:line',style);style.before();
  assert.deepEqual(commission.words,[3,4]);assert.equal(commission.tutorial,true);assert.equal(p.vars.get(13903),5);
  const fill={player:p,npcId:11470,text:'Load metals into crucible until it looks full.'};q.emit('npc-dialogue:line',fill);fill.before();assert.equal(p.vars.get(13903),10);
});

const Foundry = require('../plugins/minigames/giantsfoundry/Shared.GiantsFoundry');
function foundryQuest() {
  const q = register('SleepingGiants','sleeping_giants',{ WeaponInterfaceManager: { assign() {} } });
  Foundry.bind(q.api);
  require('../plugins/minigames/giantsfoundry/Kovac.GiantsFoundry')(q.api);
  require('../plugins/minigames/giantsfoundry/Crucible.GiantsFoundry')(q.api);
  require('../plugins/minigames/giantsfoundry/Mould.GiantsFoundry')(q.api);
  return q;
}

test('Sleeping Giants pours the captured difficulty-five tutorial alloy and keeps ordinary alloy scoring', () => {
  const q = foundryQuest(), p = player(); q.quest.setStage(p,3);
  q.emit('giants-foundry:start-commission',{player:p,words:[3,4],tutorial:true});
  const prepare = who => {
    Foundry.set(who,13931,16); Foundry.set(who,13932,12); Foundry.set(who,13937,2); Foundry.set(who,13914,1);
  };
  prepare(p); q.namedObjects.get('Crucible (full):Pour')({player:p,object:{}}); q.tick(1);
  assert.equal(p.vars.get(13913),5); q.tick(5); assert.equal(p.vars.get(13914),2); assert.equal(p.vars.get(13931),0); assert.equal(p.vars.get(13932),0);
  const ordinary=player();q.quest.setStage(ordinary,13);prepare(ordinary);
  q.namedObjects.get('Crucible (full):Pour')({player:ordinary,object:{}});q.tick(1);assert.equal(ordinary.vars.get(13913),19);
});

test('Sleeping Giants removes the tutorial sword at55, preserves its quality branch, then clears quality at60', () => {
  const q=foundryQuest(),p=player();q.quest.setStage(p,12);q.emit('giants-foundry:start-commission',{player:p,words:[3,4],tutorial:true});
  p.equipment.set(core.Equipment.WEAPON_SLOT,27010);
  for(const [id,value] of [[13938,5],[13939,41],[13950,41],[13949,1000]]) Foundry.set(p,id,value);
  sleepingAction(q,p,'RydkiD','message');
  assert.equal(p.vars.get(13903),55);assert.equal(p.equipment.has(core.Equipment.WEAPON_SLOT),false);
  assert.equal(p.vars.get(13938),0);assert.equal(p.vars.get(13949),0);assert.equal(p.vars.get(13907),0);
  assert.equal(p.vars.get(13939),41);assert.equal(p.vars.get(13950),41);
  assert.equal(q.resolve('onNpcDialogueCondition',{player:p,npcId:11468,stepId:'z6vfKd'}),true);
  const care={player:p,npcId:11468,text:'Kovac take care of it.'};q.emit('npc-dialogue:line',care);care.before();
  assert.equal(p.vars.get(13903),60);assert.equal(p.vars.get(13939),0);assert.equal(p.vars.get(13950),0);
  sleepingAction(q,p,'Y7bMs-');assert.equal(p.vars.get(13903),65);assert.equal(p.vars.get(13902),30);
  assert.equal(p.xp.at(-1)[1],6000);assert.equal(p.attributes.get('quest.points'),1);
});

test('Sleeping Giants mould jig refuses setup and forged Set before Kovac has given its briefing', () => {
  const q=foundryQuest(),p=player();q.quest.setStage(p,5);q.emit('giants-foundry:start-commission',{player:p,words:[3,4],tutorial:true});
  q.namedObjects.get('Mould jig (Empty):Setup')({player:p}); assert.equal(p.packets.some(([m,id])=>m==='sendInterface'&&id===718),false);
  p.getPacketSender().sendInterface(718);for(const[id,value]of[[13910,8],[13911,8],[13912,6]])Foundry.set(p,id,value);
  q.buttons.get((718<<16)|6)({player:p});assert.equal(Foundry.get(p,13914),0);
  const brief={player:p,npcId:11470,text:'a forte, a blade and a tip.'};q.emit('npc-dialogue:line',brief);brief.before();
  q.namedObjects.get('Mould jig (Empty):Setup')({player:p});assert.equal(p.getInterfaceId(),718);
  q.buttons.get((718<<16)|6)({player:p});assert.equal(Foundry.get(p,13914),1);assert.equal(p.vars.get(13903),35);
});

test('quest sourhog uses captured five-tick melee and ranged spit without sharing attack state', () => {
  const shots=[];let roll=0;
  class Hit { constructor(attacker,target,method,delay){Object.assign(this,{attacker,target,method,delay});}isAccurate(){return true;} }
  const q=register('PorcineOfInterest','a_porcine_of_interest',{
    Misc:{randomInclusive:()=>roll}, PendingHit:Hit,
    Projectile:{centreOf:core.Projectile.centreOf,ticksToLand:core.Projectile.ticksToLand,createProjectile(...args){const shot={args,withAngle(angle){this.angle=angle;return this;},withProgress(progress){this.progress=progress;return this;},sendProjectile(){shots.push(this);}};return shot;}},
  }),p=player();const animations=[],graphics=[];p.performGraphic=value=>graphics.push(value);
  let distance=4;const npc={calculateDistance:()=>distance,getSize:()=>3,getLocation:()=>new core.Location(3162,9699,0),performAnimation:value=>animations.push(value)};
  p.getSize=()=>1;p.getLocation=()=>new core.Location(3163+distance+1,9700,0);
  const provider=q.providers.find(provider=>provider.ids.includes(10436)),spit=new provider.ctor();spit.start(npc,p);
  assert.equal(spit.type(),core.CombatType.RANGED);assert.equal(spit.attackSpeed(),5);assert.equal(spit.hits(npc,p)[0].delay,3,'lands at 86 cycles: the 3rd tick');
  assert.equal(animations.at(-1).getId(),8770);assert.deepEqual(shots[0].args.slice(2),[1817,57,86,43,45]);assert.equal(shots[0].progress,128);assert.equal(shots[0].angle,16);
  assert.deepEqual([graphics[0].getId(),graphics[0].getDelay(),graphics[0].getHeight()],[1818,86,20]);
  distance=1;roll=1;const melee=new provider.ctor();melee.start(npc,p);assert.equal(melee.type(),core.CombatType.MELEE);assert.equal(melee.hits(npc,p)[0].delay,0);assert.equal(animations.at(-1).getId(),8769);
  assert.equal(spit.type(),core.CombatType.RANGED);assert.equal(shots.length,1);
  // Adjacent, the captured 58 ends by launch + 1, so PacketSender sends 57 + 5 + 5 a tile (2 tiles centre to centre).
  roll=0;const near=new provider.ctor();near.start(npc,p);assert.equal(near.hits(npc,p)[0].delay,3,'lands at 72 cycles');assert.equal(shots.at(-1).args[4],58);
  distance=6;const far=new provider.ctor();far.start(npc,p);assert.equal(shots.at(-1).args[4],106);assert.equal(far.hits(npc,p)[0].delay,4,'lands at 106 cycles');
});

test('Sleeping Giants tutorial pickup gives the captured three-stage preform quality and temperature', () => {
  const q=foundryQuest(),p=player();q.quest.setStage(p,7);q.emit('giants-foundry:start-commission',{player:p,words:[3,4],tutorial:true});
  require('../plugins/minigames/giantsfoundry/Preform.GiantsFoundry')(q.api);
  p.equipment.set(core.Equipment.HANDS_SLOT,1580);
  for(const[id,value]of[[13913,5],[13914,2],[13910,8],[13911,8],[13912,6]])Foundry.set(p,id,value);
  Foundry.setField(p,'pouredAt',Foundry.tick()-19);
  q.namedObjects.get('Mould jig (Poured metal):Pick-up')({player:p});
  assert.equal(p.equipment.get(core.Equipment.WEAPON_SLOT),27010);
  assert.equal(p.vars.get(13938),5);assert.equal(p.vars.get(13939),41);assert.equal(p.vars.get(13950),41);assert.equal(p.vars.get(13948),981);
  assert.deepEqual(Array.from({length:6},(_,index)=>Foundry.get(p,13940+index)),[1,2,0,0,0,0]);
  assert.equal(p.vars.get(13903),50);assert.equal(p.vars.get(13914),0);
});
