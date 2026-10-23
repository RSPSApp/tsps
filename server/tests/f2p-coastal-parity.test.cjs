// Run from server after yarn build: node --test tests/f2p-coastal-parity.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
});
const sharedButtons = new Map();
let actorIndex = 1;
function register(name, key) {
  const hooks = new Map(), custom = new Map(), buttons = sharedButtons, namedNpc = new Map();
  const spawned = [], removed = [], ground = [], prompts = [], areas = [], tasks = [];
  const api = new Proxy({
    core: { ...core, TaskManager: {
      submit: (task) => { task.setRunning(true); tasks.push(task); },
      cancelTasks: (key) => tasks.filter((task) => task.key === key).forEach((task) => task.stop()),
    } }, persistAttribute() {}, registerArea: (area) => areas.push(area),
    onCustomEvent: (event, fn) => { if (!custom.has(event)) custom.set(event, []); custom.get(event).push(fn); },
    emitCustomEvent: (event, payload) => { for (const fn of custom.get(event) || []) fn(payload); },
    onInterfaceActionButton: (ids, fn) => { for (const id of [].concat(ids)) buttons.set(id, fn); },
    onNpcInteraction: (nameOrFn, actions) => {
      if (typeof nameOrFn === 'function') hooks.set('onNpcInteraction', [nameOrFn]);
      else for (const [action, fn] of Object.entries(actions)) namedNpc.set(`${nameOrFn}:${action}`, fn);
    },
    onNpcsInteraction: (names, actions) => {
      for (const name of names) for (const [action, fn] of Object.entries(actions)) namedNpc.set(`${name}:${action}`, fn);
    },
    getItemOnGroundManager: () => ({
      registerLocation: (owner, item, location) => { ground.push({ owner, item, location }); }, getGroundItem: () => null,
    }),
    spawnNpc: (definition) => {
      let area = null, transform = -1, hp = 7;
      const index = actorIndex++;
      const npc = { definition, getId: () => definition.id, getOwner: () => definition.owner,
        getLocation: () => new core.Location(definition.x, definition.y, definition.z),
        moveTo: (tile) => { definition.x = tile.getX(); definition.y = tile.getY(); definition.z = tile.getZ(); },
        getDefinition: () => core.NpcDefinition.forId(definition.id),
        getHitpoints: () => hp, setHitpoints: (value) => { hp = value; },
        getNpcTransformationId: () => transform, setNpcTransformationId: (value) => { transform = value; },
        getArea: () => area, setArea: (value) => { area = value; },
        isPlayer: () => false, isNpc: () => true, getAsNpc: () => npc, getIndex: () => index,
        getCombat: () => ({ reset() {}, attack() {} }), isRegistered: () => true, forceChat() {}, performAnimation() {}, performGraphic() {},
      };
      spawned.push(npc); return npc;
    },
    removeNpc: (npc) => removed.push(npc),
    sendMultiChatboxPrompt: (player, title, ...options) => prompts.push({ player, title, options }),
  }, { get(target, prop) {
    if (prop in target) return target[prop];
    return (...args) => {
      const fn = args.findLast((arg) => typeof arg === 'function')
        || Object.values(args.at(-1) || {}).find((value) => typeof value === 'function');
      if (fn) { if (!hooks.has(prop)) hooks.set(prop, []); hooks.get(prop).push(fn); }
    };
  } });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  return { api, hooks, custom, buttons, namedNpc, spawned, removed, ground, prompts, areas,
    quest: getRegisteredQuests().findLast((quest) => quest.key === key),
    emit: (event, payload) => api.emitCustomEvent(event, payload),
    call: (event, payload) => { for (const fn of hooks.get(event) || []) fn(payload); },
    tick: (count) => { while (count-- > 0) [...tasks].forEach((task) => task.tick()); },
  };
}
function player() {
  const attributes = new Map(), items = new Map(), bank = new Map(), packets = [], messages = [], equipment = [], xp = [];
  let location = new core.Location(3228, 3369, 0), area = null, transform = -1, running = false;
  const index = actorIndex++;
  const inventory = {
    getAmount: (id) => items.get(id) || 0,
    adds: (id, amount) => items.set(id, (items.get(id) || 0) + amount),
    forceAdd: (_player, item) => items.set(item.getId(), (items.get(item.getId()) || 0) + item.getAmount()),
    deleteNumber: (id, amount) => items.set(id, Math.max(0, (items.get(id) || 0) - amount)),
    getFreeSlots: () => 28 - [...items].reduce((sum, [id, amount]) => sum + (id === 995 ? Number(amount > 0) : amount), 0),
    isFull: () => inventory.getFreeSlots() <= 0,
    refreshItems() {},
  };
  let packet;
  packet = new Proxy({}, { get: (_, method) => (...args) => { packets.push([method, ...args]); return packet; } });
  const p = { attributes, items, bank, equipment, packets, messages, xp,
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory, getBanks: () => [{ getAmount: (id) => bank.get(id) || 0 }],
    getEquipment: () => ({ getItems: () => equipment, get: () => null, refreshItems() {} }), getLocation: () => location,
    getSpellbook: () => ({ getInterfaceId: () => 938 }),
    getPrivateArea: () => area instanceof core.PrivateArea ? area : null, getUsername: () => 'QuestTester', getPacketSender: () => packet,
    getFrameUpdater: () => ({ clear() {} }),
    getDialogueManager: () => ({ reset() {}, startDialogues() {}, isActive: () => false }),
    getSkillManager: () => ({ getCombatLevel: () => 20, getCurrentLevel: () => 1, addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]) }),
    sendMessage: (message) => messages.push(message), isPlayer: () => true, isNpc: () => false,
    getAsPlayer: () => p, getIndex: () => index, getArea: () => area, setArea: (value) => { area = value; },
    moveTo: (value) => { location = value; }, getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() {}, addSteps: (value) => { location = value; } }),
    isRunningReturn: () => running, setRunning: (value) => { running = value; },
    setUntargetable() {}, setNpcTransformationId: (value) => { transform = value; },
    getNpcTransformationId: () => transform, performAnimation() {}, performGraphic() {},
    getCombat: () => ({ reset() {} }),
  };
  return p;
}
const choose = (prompt, label) => {
  const index = prompt.options.indexOf(label); assert.ok(index >= 0, `missing choice ${label}`); prompt.options[index + 1]();
};


test("Witch's Potion starts on the ingredient line, consumes at ready, and completes after drinking continues", () => {
  const q = register('WitchsPotion', 'witchs_potion'), p = player();
  q.emit('npc-dialogue:hook', { player: p, npcId: core.NpcIdentifiers.HETTY, hook: 'quest:witch-s-potion:start' });
  assert.equal(q.quest.getStage(p), 0);
  const line = { player: p, npcId: core.NpcIdentifiers.HETTY, text: "You need an eye of newt, a rat's tail, an onion... Oh and a piece of burnt meat." };
  q.emit('npc-dialogue:line', line); line.before(); assert.equal(q.quest.getStage(p), 1);
  for (const id of [221, 300, 1957, 2146]) p.items.set(id, 1);
  const handin = { player: p, npcId: core.NpcIdentifiers.HETTY, stepId: 'Q5Eb7j' };
  q.emit('npc-dialogue:action', handin); assert.equal(handin.box.statement, true); assert.equal(p.items.get(221), 1);
  const ready = { player: p, npcId: core.NpcIdentifiers.HETTY, text: 'Ok, now drink from the cauldron.' };
  q.emit('npc-dialogue:line', ready); ready.before(); assert.equal(q.quest.getStage(p), 2);
  assert.equal(p.items.get(221), 0);
  const drink = { player: p, npcId: core.NpcIdentifiers.HETTY, stepId: 'oLsPKg' };
  q.emit('npc-dialogue:action', drink); assert.equal(drink.box.statement, true); assert.equal(q.quest.getStage(p), 2);
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.HETTY, stepId: 'OpbvIv' });
  assert.equal(q.quest.getStage(p), 3); assert.deepEqual(p.xp, [[core.Skill.MAGIC.getIndex(), 325]]);
});

test("Pirate's Treasure awards a casket after the four-tick dig and only opens its contents once", () => {
  const q = register('PiratesTreasure', 'pirates_treasure'), p = player(); q.quest.setStage(p, 3);
  p.moveTo(new core.Location(2999, 3383, 0)); p.attributes.set('pirates-treasure.dug', 1); p.items.set(952, 1);
  q.call('onCanUseItem', { player: p, itemId: 952, option: 'Dig' });
  assert.equal(q.quest.getStage(p), 3); q.tick(3); assert.equal(q.quest.getStage(p), 3); q.tick(1);
  assert.equal(q.quest.getStage(p), 4); assert.equal(p.items.get(7956), 1); assert.equal(p.items.get(995), undefined);
  q.call('onItemAction', { player: p, itemId: 7956, option: 'Open' });
  assert.equal(p.items.get(7956), 0); assert.equal(p.items.get(995), 450); assert.equal(p.items.get(1635), 1); assert.equal(p.items.get(1605), 1);
  q.call('onItemAction', { player: p, itemId: 7956, option: 'Open' }); assert.equal(p.items.get(995), 450);
});

test("Pirate note renders the captured handwriting and the first dig summons the correct hostile gardener", () => {
  const q = register('PiratesTreasure', 'pirates_treasure'), p = player(); q.quest.setStage(p, 2); p.items.set(433, 1);
  q.call('onItemAction', { player: p, itemId: 433, option: 'Read' });
  assert.equal(q.quest.getStage(p), 3);
  assert.ok(p.packets.some(([method, text, uid]) => method === 'sendString' && uid === ((222 << 16) | 6) && text === 'Saradomin points to the X which marks the spot.'));
  p.moveTo(new core.Location(2999, 3383, 0)); q.call('onCanUseItem', { player: p, itemId: 952, option: 'Dig' });
  assert.equal(q.spawned[0].getId(), 3651); assert.equal(q.spawned[0].getLocation().getX(), 2997);
  q.call('onCanUseItem', { player: p, itemId: 952, option: 'Dig' }); q.tick(5); assert.equal(q.quest.getStage(p), 3);
  q.call('onPlayerLogout', { player: p }); assert.ok(q.removed.includes(q.spawned[0]));
});

test('Prince Ali key can be made at a furnace without Osman and Leela accepts the prepared player at state20', () => {
  const q = register('PrinceAliRescue', 'prince_ali_rescue'), p = player(); q.quest.setStage(p, 20);
  p.items.set(2423, 1); p.items.set(2349, 1);
  q.call('onItemOnObject', { player: p, itemId: 2423, objectId: 24009, object: { getDefinition: () => ({ getName: () => 'Furnace' }) } });
  assert.equal(q.prompts.at(-1).title, 'Create a key using the key print?'); choose(q.prompts.at(-1), 'No'); assert.equal(p.items.get(2423), 1);
  q.call('onItemOnObject', { player: p, itemId: 2423, objectId: 24009, object: { getDefinition: () => ({ getName: () => 'Furnace' }) } });
  choose(q.prompts.at(-1), 'Yes'); q.tick(1);
  assert.equal(p.items.get(2418), 1); assert.equal(q.quest.getStage(p), 20); assert.deepEqual(p.xp, [[core.Skill.CRAFTING.getIndex(), 2]]);
  for (const id of [2419, 1013, 2424, 954]) p.items.set(id, 1);
  const variant = q.hooks.get('onNpcDialogueVariant')[0]({ player: p, npcId: core.NpcIdentifiers.LEELA });
  assert.equal(variant.variant, 'preparations-for-rescue-talking-to-leela-after-having-all-the-required-items');
  const ready = { player: p, npcId: core.NpcIdentifiers.LEELA, text: "Good work. Now, before breaking the Prince out, you'll need to find a way to deal with his personal guard." };
  q.emit('npc-dialogue:line', ready); assert.equal(q.quest.getStage(p), 20); ready.before(); assert.equal(q.quest.getStage(p), 30);
});

test('Prince Ali three beers progress30→31→40, rescue needs Keli tied and retains the key', () => {
  const q = register('PrinceAliRescue', 'prince_ali_rescue'), p = player(); q.quest.setStage(p, 30); p.items.set(1917, 3);
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.JOE_5, stepId: 'TDhBVe' });
  assert.equal(q.quest.getStage(p), 31); assert.equal(p.items.get(1917), 2);
  assert.equal(q.hooks.get('onNpcDialogueCondition')[0]({ player: p, npcId: core.NpcIdentifiers.JOE_5, text: 'If the player has two more beers:' }), true);
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.JOE_5, stepId: 'KxLvNg' }); assert.equal(q.quest.getStage(p), 40);
  for (const id of [2418, 2419, 1013, 2424, 954]) p.items.set(id, 1);
  const escape = { player: p, npcId: core.NpcIdentifiers.PRINCE_ALI, stepId: 'WQdAq1' };
  q.emit('npc-dialogue:action', escape); q.tick(4); assert.equal(q.quest.getStage(p), 40);
  q.call('onItemOnNpc', { player: p, npcId: core.NpcIdentifiers.LADY_KELI, itemId: 954 });
  assert.equal(q.quest.getStage(p), 40); q.tick(4); assert.equal(q.quest.getStage(p), 50);
  q.emit('npc-dialogue:action', escape); assert.equal(q.quest.getStage(p), 50); q.tick(4);
  assert.equal(q.quest.getStage(p), 100); assert.equal(p.items.get(2418), 1); assert.equal(p.items.get(2419), 0);
  q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.CHANCELLOR_HASSAN, stepId: 'ctDkjC' });
  assert.equal(q.quest.getStage(p), 110); assert.equal(p.items.get(995), 700);
});

const reachLine = (q, p, npcId, text) => {
  const line = { player: p, npcId, text }; q.emit('npc-dialogue:line', line); line.before?.(); return line;
};

test('Corsair captured independent investigations and spoken transitions reach wire60 without premature selection changes', () => {
  const q = register('CorsairCurse', 'the_corsair_curse'), p = player();
  const wire = () => q.quest.varbitValue(q.quest.getStage(p), p);
  reachLine(q, p, 7956, "Sure, I'll try to help with your curse."); assert.equal(wire(), 5);
  q.emit('npc-dialogue:action', { player: p, stepId: '9srM-C' }); assert.equal(wire(), 10);
  q.emit('npc-dialogue:action', { player: p, stepId: 'GnY-u6' }); assert.equal(wire(), 15); q.tick(3);
  reachLine(q, p, 7961, "Okay, it doesn't sound like you know what's behind the curse. Thanks.");
  assert.equal(p.attributes.get('quest.the_corsair_curse.navigator'), 1);
  reachLine(q, p, 7976, "I'd hoped I could use my amazing Thieving skills");
  assert.ok(p.packets.some(([method,id,value])=>method==='sendVarbit'&&id===6074&&value===1));
  reachLine(q, p, 7976, 'Maybe you could get the relic back from the Captain');
  q.emit('npc-dialogue:action', { player: p, stepId: 'yRckkD' }); assert.equal(p.items.get(21837), 1);
  q.emit('npc-dialogue:action', { player: p, stepId: 'wenZvG' }); assert.equal(p.items.get(21837), 0);
  reachLine(q, p, core.NpcIdentifiers.CHIEF_TESS, 'Dis is tooth-pick. Tess got plenty more.');
  q.hooks.get('onNpcDialogueVariant')[0]({ player: p, npcId: 7976 });
  assert.equal(p.attributes.get('quest.the_corsair_curse.thief'), 3, 'opening a report conversation does not finish it');
  reachLine(q, p, 7976, 'Their chief, Tess, says it was her tooth-pick.');
  reachLine(q, p, 7976, "She didn't care - she's got lots of tooth-picks");
  p.attributes.set('quest.the_corsair_curse.cabinboy', 2); p.attributes.set('quest.the_corsair_curse.cook', 2);
  reachLine(q, p, 7970, 'Clockwork? Oh, that would explain it.');
  reachLine(q, p, 7965, 'Oh. Oh, I see. Okay... So the curse is not my fault.'); assert.equal(wire(), 20);
  reachLine(q, p, 7958, "Arrr, I don't rightly know. It began after dinner."); assert.equal(wire(), 25);
  reachLine(q, p, 7970, "Anyway I didn't dare try to fish after that"); assert.equal(wire(), 30);
  reachLine(q, p, 7976, 'My brother, Francois, says the Captain will replace Ithoi.'); assert.equal(wire(), 35);
  reachLine(q, p, 7961, 'Arrr! Too clever ye be...'); assert.equal(wire(), 40);
  reachLine(q, p, 7961, "The Corsairs all think I'm sick too"); assert.equal(wire(), 45);
  q.quest.setStage(p, 7); assert.equal(wire(), 50);
  reachLine(q, p, 7958, 'Arrr! So he was never sick at all!'); assert.equal(wire(), 52);
  q.quest.setStage(p, 9); assert.equal(wire(), 55);
  q.emit('npc-dialogue:action', { player: p, stepId: 'SaQ1Mg' }); assert.equal(wire(), 60); assert.equal(p.attributes.get('quest.points'), 2);
});

test('Corsair flashbacks and telescope are private and restore the actor and location on return/logout', () => {
  const q = register('CorsairCurse', 'the_corsair_curse'), p = player(); q.quest.setStage(p, 3);
  const original = new core.Location(2557,2858,1); p.moveTo(original);
  q.emit('npc-dialogue:action', { player: p, stepId: 'Gsd1jQ' });
  assert.ok(p.getPrivateArea()); assert.equal(p.getNpcTransformationId(), 7966);
  q.emit('npc-dialogue:action', { player: p, stepId: 'p6ox6g' });
  q.tick(2);
  assert.equal(p.getPrivateArea(), null); assert.equal(p.getNpcTransformationId(), -1); assert.ok(p.getLocation().equals(original));
  q.emit('npc-dialogue:action', { player: p, stepId: '36K07h' });
  assert.ok(p.getPrivateArea()); assert.equal(q.spawned.at(-1).getId(), 7969);
  q.tick(18); assert.equal(p.getPrivateArea(), null); assert.equal(p.attributes.get('quest.the_corsair_curse.cabinboy'), 2);
  q.emit('npc-dialogue:action', { player: p, stepId: 'Cs_rhQ' }); assert.ok(p.getPrivateArea());
  q.call('onPlayerLogout', { player: p }); assert.equal(p.getPrivateArea(), null); assert.equal(p.getNpcTransformationId(), -1);
});

test('Corsair fire proof uses private scenery and actor, finishes50, and one player cannot alter another scene', () => {
  const q = register('CorsairCurse', 'the_corsair_curse'), p = player(), other = player(); q.quest.setStage(p, 6);
  p.attributes.set('corsair-curse:proof-plan', true); p.items.set(590,1); p.moveTo(new core.Location(2532,2837,0));
  const originalOther = other.getLocation().clone();
  q.call('onItemOnObject', { player: p, itemId: 590, objectId: 31724 });
  assert.equal(q.quest.getStage(p), 6); q.tick(2); assert.ok(p.getPrivateArea()); assert.equal(q.quest.varbitValue(6,p),49);
  q.tick(26); assert.equal(q.quest.getStage(p),7); assert.equal(q.quest.varbitValue(7,p),50); assert.equal(p.getPrivateArea(),null);
  assert.ok(other.getLocation().equals(originalOther)); assert.equal(other.getPrivateArea(),null);
});
test('all five Corsair scenes send the complete captured camera track, exact rates and timed cuts',()=>{
  const q=register('CorsairCurse','the_corsair_curse'),p=player();
  const action=stepId=>q.emit('npc-dialogue:action',{player:p,stepId});
  const line=(text,npcId=core.NpcIdentifiers.CABIN_BOY_COLIN)=>{const e={player:p,npcId,text};q.emit('npc-dialogue:line',e);e.before?.();return e;};
  q.quest.setStage(p,1);
  line("Now, I've a ship moored west of Rimmington. Come and meet me on board, and we'll set off to Corsair Cove.",core.NpcIdentifiers.CAPTAIN_TOCK);
  q.tick(1);assert.equal(p.packets.filter(row=>row[0]==='sendCameraMoveTo').length,0);
  q.tick(1);assert.equal(p.packets.filter(row=>row[0]==='sendCameraMoveTo').length,1);
  q.tick(1);assert.deepEqual(p.packets.filter(row=>row[0]==='sendCameraMoveTo').at(-1).slice(1,4),[2926,3224,800]);
  q.tick(9);assert.deepEqual(p.packets.filter(row=>row[0]==='sendCameraLookAt').at(-1).slice(1,4),[2911,3227,100]);q.tick(11);
  q.quest.setStage(p,3);action('Gsd1jQ');q.tick(1);
  action('rqXQdP');q.tick(3);action('Xub2Df');q.tick(3);
  line("... yes, it's a mermaid! She's beautiful!").after();q.tick(2);
  action('gXvRex');q.tick(6);line("I can see you moving your arms, but it's very dark. Are you waving to me?").after();q.tick(6);
  action('8whjhh');q.tick(6);line("I hope she's not angry. Ithoi says mermaids can be dangerous.");action('p6ox6g');q.tick(2);
  action('Cs_rhQ');q.tick(1);
  line("C'mon little lobsters. We don't want to keep the Captain waiting! He'll get angry with me again.",core.NpcIdentifiers.GNOCCI_THE_COOK).after();q.tick(2);
  line("Ooh, what's this? This isn't a lobster.",core.NpcIdentifiers.GNOCCI_THE_COOK).after();q.tick(2);
  line("She's moving! SHE'S POSSESSED! HELP!",core.NpcIdentifiers.GNOCCI_THE_COOK);q.tick(7);
  assert.deepEqual(p.packets.filter(row=>row[0]==='sendCameraMoveTo').at(-1).slice(1,4),[2505,2839,220]);
  q.tick(1);assert.deepEqual(p.packets.filter(row=>row[0]==='sendCameraMoveTo').at(-1).slice(1,4),[2510,2835,350]);q.tick(10);
  action('36K07h');q.tick(18);
  q.quest.setStage(p,6);p.attributes.set('corsair-curse:proof-plan',true);p.items.set(590,1);
  q.call('onItemOnObject',{player:p,itemId:590,objectId:31724});q.tick(5);
  assert.deepEqual(p.packets.filter(row=>row[0]==='sendCameraMoveTo').at(-1).slice(1,4),[2529,2835,200]);
  q.tick(1);assert.deepEqual(p.packets.filter(row=>row[0]==='sendCameraMoveTo').at(-1).slice(1,4),[2529,2837,200]);
  q.tick(6);assert.deepEqual(p.packets.filter(row=>row[0]==='sendCameraMoveTo').at(-1).slice(1,4),[2531,2841,300]);
  q.tick(12);assert.deepEqual(p.packets.filter(row=>row[0]==='sendCameraMoveTo').at(-1).slice(1,4),[2531,2840,300]);q.tick(4);
  const move=p.packets.filter(row=>row[0]==='sendCameraMoveTo').map(row=>[...row.slice(1,4),row[4].rate,row[4].rate2,row[4].heightRelative]);
  assert.deepEqual(move,[
    [2943,3224,800,232,100,false],[2926,3224,800,6,0,false],
    [2527,2824,700,232,100,false],[2527,2828,700,1,1,false],[2523,2831,650,232,100,false],[2523,2830,700,1,1,false],[2523,2831,650,1,1,false],
    [2524,2834,400,232,100,false],[2523,2831,650,232,100,false],[2524,2834,400,232,100,false],[2523,2831,650,232,100,false],[2516,2827,1300,2,2,false],
    [2499,2833,800,232,100,false],[2503,2830,280,3,3,false],[2504,2841,220,232,100,false],[2505,2839,220,1,1,false],[2510,2835,350,232,100,false],
    [2528,2821,400,232,100,false],[2528,2818,400,1,1,false],
    [2529,2835,200,232,100,false],[2529,2837,200,1,1,false],[2531,2841,300,232,100,false],[2531,2840,300,1,1,false],
  ]);
  assert.deepEqual(p.packets.filter(row=>row[0]==='sendCameraLookAt').map(row=>[...row.slice(1,4),row[4].rate,row[4].rate2]),[
    [2928,3224,100,232,100],[2911,3224,100,6,0],[2911,3227,100,1,0],
    [2527,2839,350,232,100],[2540,2844,350,232,100],[2540,2839,350,232,100],[2540,2844,350,232,100],[2540,2839,350,232,100],[2540,2844,350,232,100],
    [2505,2837,200,232,100],[2505,2835,170,232,100],[2504,2840,200,232,100],[2528,2822,300,232,100],[2529,2841,170,232,100],[2531,2835,240,232,100],
  ]);
  assert.equal(p.packets.filter(row=>row[0]==='sendCameraUnlock'&&row[1]===false).length,5);
  assert.equal(p.getPrivateArea(),null);
});
test('accepting Corsair through the native transcript starts Tock’s automatic ship view after the stage changes',()=>{
  const q=register('CorsairCurse','the_corsair_curse'),p=player();
  const {DialogueManager}=require('../dist/game/model/dialogues/DialogueManager'),manager=new DialogueManager(p);
  p.getDialogueManager=()=>manager;
  const nextPrompt=()=>{const count=q.prompts.length;for(let i=0;i<30&&q.prompts.length===count;i++){assert.ok(manager.getCurrent());manager.advance();}assert.ok(q.prompts.length>count);return q.prompts.at(-1);};
  require('../plugins/quests/QuestRuntime').startTranscript(q.api,p,core.NpcIdentifiers.CAPTAIN_TOCK,'The Corsair Curse','the-cursed-crew-talking-to-captain-tock');
  choose(nextPrompt(),'What kind of help do you need?');choose(nextPrompt(),'Yes.');
  assert.equal(q.quest.getStage(p),1);
  for(let i=0;i<10&&!p.getPrivateArea();i++){assert.ok(manager.getCurrent());manager.advance();}
  assert.ok(p.getPrivateArea(),'the callback must test quest state when shown, after the earlier player line starts it');
  assert.ok(manager.getCurrent() instanceof core.ActionDialogue);
  q.tick(23);assert.equal(p.getPrivateArea(),null);
  assert.equal(p.packets.filter(row=>row[0]==='sendCameraMoveTo').length,2);
  assert.ok(p.packets.some(row=>row[0]==='sendString'&&String(row[1]).includes("West of Rimmington, you say?")));
});

test('Corsair Ithoi fight is private, auto-attacks, and unrelated kills cannot advance the player', () => {
  const q = register('CorsairCurse','the_corsair_curse'),p=player(),other=player(); q.quest.setStage(p,8);
  p.moveTo(new core.Location(2529,2835,1)); q.areas[0].process(p);
  assert.ok(p.getPrivateArea()); const npc=q.spawned.at(-1); assert.equal(npc.getId(),7964);
  q.call('onNpcDeath',{killer:other,npc,npcId:7964}); assert.equal(q.quest.getStage(p),8);
  q.call('onNpcDeath',{killer:p,npc:{},npcId:7964}); assert.equal(q.quest.getStage(p),8);
  q.call('onNpcDeath',{killer:p,npc,npcId:7964}); assert.equal(q.quest.getStage(p),9); assert.equal(p.getPrivateArea(),null);
});

test('Corsair Ithoi uses captured spells on five ticks and Curse deals no direct damage', () => {
  const q=register('CorsairCurse','the_corsair_curse'),Provider=q.hooks.get('registerNpcCombatMethodProvider')[0], method=new Provider();
  const start=core.MagicCombatMethod.prototype.start,hits=core.MagicCombatMethod.prototype.hits,random=Math.random;
  let selected,damage;
  const npc={getCombat:()=>({setCastSpell:value=>{selected=value},getSelectedSpell:()=>selected}),forceChat(){}};
  core.MagicCombatMethod.prototype.start=()=>{}; core.MagicCombatMethod.prototype.hits=()=>[{setTotalDamage:value=>{damage=value}}];
  try {
    assert.equal(method.attackSpeed(),5);
    for(let i=0;i<5;i++){
      Math.random=()=>i/5;method.start(npc,{});
      assert.equal(selected.castAnimation().getId(),i===4?11428:9144);
      if(i<4)assert.ok(selected.maximumHit()<=6);
      damage=undefined;method.hits(npc,{});if(i===4)assert.equal(damage,0);
      method.finished(npc);assert.equal(selected,null);
    }
  } finally { core.MagicCombatMethod.prototype.start=start;core.MagicCombatMethod.prototype.hits=hits;Math.random=random; }
});

test('Ned sells captured quest rope for 15 coins or four wool, refusing missing payment and full inventory', () => {
  const q = register('PrinceAliRescue', 'prince_ali_rescue'), p = player(); q.quest.setStage(p, 20);
  const page = require('../data/definitions/npc-dialogues.json')['Prince Ali Rescue'];
  const branch = page.variants['preparations-for-rescue-talking-to-ned'][1].options.find((option) => option.text === 'Yes, I would like some rope.');
  assert.ok(JSON.stringify(branch).includes('T0Ll6J'), 'quest rope choice must have a reachable exchange');
  const event = () => ({ player: p, npcId: core.NpcIdentifiers.NED, stepId: 'T0Ll6J' });
  q.emit('npc-dialogue:action', event()); assert.equal(p.items.get(954), undefined);
  p.items.set(995, 30); for (let i = 0; i < 27; i++) p.items.set(20000 + i, 1);
  q.emit('npc-dialogue:action', event()); assert.equal(p.items.get(995), 30);
  p.items.delete(20000); q.emit('npc-dialogue:action', event()); assert.equal(p.items.get(995), 15); assert.equal(p.items.get(954), 1);
  for (let i = 1; i < 27; i++) p.items.delete(20000 + i);
  p.items.set(1759, 4); q.emit('npc-dialogue:action', { player: p, npcId: core.NpcIdentifiers.NED, stepId: 'pCcGIe' });
  assert.equal(p.items.get(1759), 0); assert.equal(p.items.get(954), 2);
});

test('as captured: Port Sarim and Karamja boats charge once, sail under ship_journey, and land on the deck nine ticks later', () => {
  const q = register('PiratesTreasure', 'pirates_treasure'), p = player(); p.items.set(995, 60);
  const travel = q.namedNpc.get('Seaman Thresnor:Travel'); travel({ player: p }); travel({ player: p });
  assert.equal(p.items.get(995), 30, 'a second click while sailing is not charged');
  assert.deepEqual(p.messages, ['You pay 30 coins and board the ship.']);
  assert.ok(p.getPrivateArea(), 'at sea on the ship instance');
  assert.ok(p.packets.some((row) => row[0] === 'sendInterface' && row[1] === 299));
  assert.ok(p.packets.some((row) => row[0] === 'sendClientScript' && row[1] === 1131 && row[2] === 4));
  assert.ok(p.packets.some((row) => row[0] === 'closeSubInterface' && row[1] === ((161 << 16) | 79)), 'the inventory tab closes');
  q.tick(8); assert.ok(p.getPrivateArea(), 'still sailing after eight ticks');
  q.tick(1);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [2956, 3143, 1]);
  assert.equal(p.getPrivateArea(), null);
  assert.ok(p.packets.some((row) => row[0] === 'sendTabInterface' && row[1] === 79 && row[2] === 149), 'the inventory tab is back');
  p.packets.length = 0;
  q.namedNpc.get('Customs officer:Travel')({ player: p });
  assert.ok(p.packets.some((row) => row[0] === 'sendClientScript' && row[1] === 1131 && row[2] === 5));
  q.tick(9);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3032, 3217, 1]);
  // After Pandemonium the boats name their stops instead of offering Travel.
  p.items.set(995, 30); q.namedNpc.get('Captain Tobias:The Pandemonium')({ player: p }); q.tick(5);
  assert.equal(p.items.get(995), 0); assert.equal(p.getLocation().getX(), 3069); assert.equal(p.getLocation().getY(), 2987);
});

test('Corsair vine ladder preserves the side used on its one-tick climb', () => {
  const q = register('CorsairCurse', 'the_corsair_curse'), p = player();
  for (const [outside, inside] of [[2862, 9006], [2860, 9004]]) {
    p.moveTo(new core.Location(2523, outside, 0));
    q.call('onObjectInteraction', { player: p, objectId: 31791 }); q.tick(1);
    assert.equal(p.getLocation().getX(), 2012); assert.equal(p.getLocation().getY(), inside); assert.equal(p.getLocation().getZ(), 1);
    q.emit('ladders:climb', { player: p, objectId: 31790 }); q.tick(1);
    assert.equal(p.getLocation().getX(), 2523); assert.equal(p.getLocation().getY(), outside); assert.equal(p.getLocation().getZ(), 0);
  }
});

test('X Marks preserves old saved stages, native clue/map interfaces, and captured dig radius through the casket', () => {
  const q = register('XMarksTheSpot', 'x_marks_the_spot'), p = player();
  q.call('onPlayerLogin', { player: p }); assert.equal(q.spawned.length, 0);
  assert.ok(p.packets.some(([m,id,v]) => m === 'sendVarbit' && id === 12151 && v === 2));
  const accepted = { player: p, npcId: 8484, text: 'Sounds good, what should I do?' }; q.emit('npc-dialogue:line', accepted); accepted.before(); assert.equal(q.quest.varpValue(0,p), 1);
  const handout = { player: p, npcId: 8484, text: 'Take this scroll. It should lead you to the treasure I seek.' }; q.emit('npc-dialogue:line', handout); handout.before();
  assert.equal(q.quest.getStage(p),1); assert.equal(q.quest.varpValue(1,p),2); assert.equal(p.items.get(23067),1);
  q.call('onItemAction', { player: p, itemId: 23067, option: 'Read' });
  assert.ok(p.packets.some(([m,id])=>m==='sendInterface'&&id===203));
  for (const [x,y,stage,item] of [[3230,3209,2,23068],[3203,3212,3,23069],[3109,3264,4,23070],[3078,3259,5,23071]]) {
    p.moveTo(new core.Location(x,y,0)); const e={player:p,itemId:952,option:'Dig'};q.call('onCanUseItem',e);
    assert.equal(e.allow,false);assert.equal(q.quest.getStage(p),stage);assert.equal(p.items.get(item),1);
    if(item===23068){q.call('onItemAction',{player:p,itemId:item,option:'Read'});assert.ok(p.packets.some(([m,id])=>m==='sendInterface'&&id===267));}
  }
  assert.equal(q.quest.varpValue(5,p),6);assert.ok(p.packets.some(([m,id,v])=>m==='sendVarbit'&&id===12151&&v===0));
  const handin={player:p,npcId:8484,stepId:'HSuTNF'};q.emit('npc-dialogue:action',handin);assert.equal(p.items.get(23071),0);assert.equal(q.quest.varpValue(5,p),7);assert.deepEqual(handin.box.items,[23071]);
  q.emit('npc-dialogue:action',{player:p,npcId:8484,stepId:'03vD77'});assert.equal(q.quest.varpValue(6,p),8);assert.equal(p.items.get(995),200);assert.equal(p.items.get(23072),1);assert.equal(p.items.get(24361),1);
  q.emit('npc-dialogue:action',{player:p,npcId:8484,stepId:'03vD77'});assert.equal(p.items.get(995),200);
});

test('X Marks orb reproduces captured distances, temperatures, comparisons and helper packets', () => {
  const q=register('XMarksTheSpot','x_marks_the_spot'),p=player();q.quest.setStage(p,3);p.items.set(23069,1);
  for(const [x,y,distance,text] of [[3203,3212,95,'The orb is cold.'],[3194,3216,86,'The orb is warm, and warmer than last time.'],[3184,3219,76,'The orb is warm, and warmer than last time.'],[3181,3222,73,'The orb is warm, and warmer than last time.'],[3184,3221,76,'The orb is warm, but colder than last time.'],[3155,3237,47,'The orb is hot, and warmer than last time.'],[3130,3265,22,'The orb is very hot, and warmer than last time.']]){
    p.moveTo(new core.Location(x,y,0));q.call('onItemAction',{player:p,itemId:23069,option:'Feel'});assert.equal(p.messages.at(-1),text);assert.ok(p.packets.some(([m,id,v])=>m==='sendVarbit'&&id===8064&&v===distance));
  }
  assert.ok(p.packets.some(([m,id])=>m==='sendClientScript'&&id===6473));
});

test('all registered quests leave Ned’s 15-coin purchase to Prince Ali and the full dialogue exchanges rope', () => {
  const { startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');
  const conditions = [], handlers = new Map(), said = [], picks = ['Yes, I would like some rope.', 'Okay, please sell me some rope.'];
  const api = new Proxy({ core, persistAttribute() {},
    onNpcDialogueCondition: (handler) => conditions.push({ pluginName: 'quest-registry', handler }),
    onCustomEvent: (event, handler) => { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(handler); },
    emitCustomEvent: (event, payload) => { for (const handler of handlers.get(event) || []) handler(payload); },
    sendMultiChatboxPrompt(_player, title, ...pairs) {
      const wanted = picks.shift(); assert.ok(wanted, `unexpected menu ${title}`);
      const index = pairs.indexOf(wanted); assert.ok(index >= 0, `missing ${wanted}`); pairs[index + 1](); return true;
    },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  require('../plugins/quests/Quests.plugin').register(api);
  const p = player(); p.attributes.set('quest.prince_ali_rescue.stage', 20); p.items.set(995, 15);
  const skills = p.getSkillManager(); skills.getMaxLevel = () => 1; skills.getExperience = () => 0; p.getSkillManager = () => skills;
  let current;
  const manager = { reset() {}, advance() {}, getCurrent: () => current,
    startDialogues(chain) {
      current = chain;
      for (const entry of [...chain.getDialogues().values()].sort((a,b) => a.getIndex() - b.getIndex())) {
        if (current !== chain) break;
        if (entry.getText) said.push(entry.getText());
        if (entry.constructor.name === 'ActionDialogue') entry.send(p);
      }
    },
  };
  p.getDialogueManager = () => manager;
  const previous = [...PluginManager.npcDialogueConditionHooks]; PluginManager.npcDialogueConditionHooks.splice(0, previous.length, ...conditions);
  try {
    assert.equal(PluginManager.emitNpcDialogueCondition({ player:p,npcId:4280,text:'If the player has 15 coins:',stepId:'c-c-Yc' }), true);
    const definition = core.NpcDefinition.forId(4280), event = {player:p,npcId:4280,definition};
    const page = require('../data/definitions/npc-dialogues.json')['Prince Ali Rescue'];
    startDialogue(api,event,page.variants['preparations-for-rescue-talking-to-ned'],page.branches,{...event,pages:[{page:'Prince Ali Rescue'}]});
    assert.equal(picks.length,0); assert.equal(p.items.get(995),0); assert.equal(p.items.get(954),1);
    assert.ok(said.includes('You hand Ned 15 coins. Ned gives you a coil of rope.'));
    assert.ok(!said.some(text=>String(text).includes('yaks')), 'Fremennik-only tail must not leak into the exchange');
  } finally { PluginManager.npcDialogueConditionHooks.splice(0, PluginManager.npcDialogueConditionHooks.length, ...previous); }
});

test('X Marks lamp uses the shared native picker and grants 300 XP once while checking the selected inventory item', () => {
  const q=register('XMarksTheSpot','x_marks_the_spot'),p=player();q.quest.setStage(p,6);p.items.set(23072,1);
  const lamp={getId:()=>23072},inventory=p.getInventory();let selected=lamp,experience=0,request;
  inventory.get=()=>selected;inventory.deleteAtSlot=()=>{inventory.deleteNumber(23072,1);selected=null;};
  const skills={getExperience:()=>experience,addExperience:(_skill,amount)=>{experience+=amount;}};p.getSkillManager=()=>skills;
  q.custom.set('xpreward:open',[(event)=>{request=event;}]);
  q.call('onItemAction',{player:p,itemId:23072,item:lamp,slot:0,option:'Rub'});
  assert.equal(request.title,'Choose the stat you wish to be advanced!');
  selected={getId:()=>23072};assert.equal(request.onConfirm(core.Skill.SMITHING,'Smithing'),null);assert.equal(experience,0);
  selected=lamp;q.call('onItemAction',{player:p,itemId:23072,item:lamp,slot:0,option:'Rub'});
  assert.equal(request.onConfirm(core.Skill.SMITHING,'Smithing'),'<col=0000ff>Your wish has been granted!</col> You have been awarded 300 Smithing experience!');
  assert.equal(experience,300);assert.equal(p.items.get(23072),0);assert.ok(p.packets.some(([m,id,v])=>m==='sendVarbit'&&id===8066&&v===1));
  assert.equal(request.onConfirm(core.Skill.SMITHING,'Smithing'),null);assert.equal(experience,300);
});

test('Pirate chest remains open for four ticks, exchanges the key at closing, and cleans up on logout', () => {
  const q=register('PiratesTreasure','pirates_treasure'),p=player();q.quest.setStage(p,2);p.items.set(432,1);
  const use=()=>q.call('onItemOnObject',{player:p,objectId:2079,itemId:432});use();use();
  assert.equal(p.items.get(432),1);assert.equal(p.items.get(433),undefined);
  assert.ok(p.packets.some(([m,obj])=>m==='sendObject'&&obj.getId()===2080));
  q.tick(3);assert.equal(p.items.get(433),undefined);q.tick(1);assert.equal(p.items.get(432),0);assert.equal(p.items.get(433),1);
  assert.equal(p.messages.filter(m=>m==='You take the message from the chest.').length,1);
  assert.ok(p.packets.some(([m,obj])=>m==='sendObject'&&obj.getId()===2079));
  p.items.set(432,1);p.items.delete(433);use();q.call('onPlayerLogout',{player:p});q.tick(4);
  assert.equal(p.items.get(432),1);assert.equal(p.items.get(433),undefined);
});

test('Corsair dug-up clockwork doll follows its captured owner-only path and disappears on logout', () => {
  const q=register('CorsairCurse','the_corsair_curse'),p=player();q.quest.setStage(p,3);p.attributes.set('quest.the_corsair_curse.cook',1);
  q.emit('npc-dialogue:choice',{player:p,npcId:7970,option:'Search for the possessed doll and face the consequences.'});
  assert.equal(p.attributes.get('quest.the_corsair_curse.cook'),1);q.tick(1);assert.equal(p.attributes.get('quest.the_corsair_curse.cook'),2);
  const doll=q.spawned.at(-1);assert.equal(doll.getId(),7975);assert.equal(doll.definition.owner,p);assert.equal(doll.definition.ownerOnly,true);
  q.tick(3);assert.equal(doll.getLocation().getX(),2507);assert.equal(doll.getLocation().getY(),2842);
  q.call('onPlayerLogout',{player:p});assert.ok(q.removed.includes(doll));
});

test('X Marks ending waits for its completion scroll close and resumes only once', () => {
  const q=register('XMarksTheSpot','x_marks_the_spot'),p=player();q.quest.setStage(p,5);p.items.set(23071,1);
  q.emit('npc-dialogue:action',{player:p,npcId:8484,stepId:'HSuTNF'});
  let chains=[];p.getDialogueManager=()=>({reset(){},startDialogues(chain){chains.push(chain);}});
  const finish={player:p,npcId:8484,stepId:'03vD77'};q.emit('npc-dialogue:action',finish);assert.equal(finish.end,true);assert.equal(chains.length,0);
  q.emit('interface:closed',{player:p,interfaceId:203});assert.equal(chains.length,0);
  q.emit('interface:closed',{player:p,interfaceId:153});assert.equal(chains.length,1);
  const lines=[...chains[0].getDialogues().values()].filter(e=>e.getText).map(e=>e.getText()).join(' ');
  assert.ok(lines.includes("Anyway, I'd best be getting back to Great Kourend."));
  q.emit('interface:closed',{player:p,interfaceId:153});assert.equal(chains.length,1);
});
