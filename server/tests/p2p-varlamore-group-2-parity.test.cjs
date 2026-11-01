// From server/: node --test tests/p2p-varlamore-group-2-parity.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
let nextIndex = 1;
const noop = () => {};
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, '..')); new NpcDefinitionLoader().load(); });

function harness(name) {
  const hooks = {}, events = {}, tasks = [], areas = [], combatResolvers = [], npcs = [], removed = [], objects = [], ground = [], clicks = new Map(), buttons = new Map(), namedNpcs = new Map(), namedObjects = new Map(), itemActions = new Map();
  const objectManager = {register: object => objects.push(object), deregister: object => { const i=objects.indexOf(object); if(i>=0)objects.splice(i,1); }};
  const taskManager = {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  };
  function attach(map, name, actions) {
    const current = map.get(name) ?? {};
    for (const [action, callback] of Object.entries(actions)) {
      const previous = current[action];
      current[action] = previous ? event => {
        const result = previous(event);
        return result === true || event.handled ? result : callback(event);
      } : callback;
    }
    map.set(name, current);
  }
  const api = new Proxy({ core: { ...core, PathFinder: Object.assign(Object.create(core.PathFinder), { calculateWalkRoute: (npc, x, y) => {
    npc.getMovementQueue().addSteps(new core.Location(x, y, npc.getLocation().getZ()));
  } }), World: { ...core.World, getNpcsNear: () => npcs }, TaskManager: taskManager,
    MultiChatboxPrompt: { getPending: p => p.prompt }, ObjectManager: objectManager },
    getTaskManager: () => taskManager,
    onNpcsInteraction: (names, actions) => names.forEach(name => attach(namedNpcs, name, actions)),
    onItemAction: (name, actions) => { if (typeof name === 'function') (hooks.onItemAction ??= []).push(name); else itemActions.set(name, actions); },
    registerArea: area => areas.push(area),
    registerCombatMethodResolver: resolver => combatResolvers.push(resolver),
    getObjectManager: () => objectManager,
    getItemOnGroundManager: () => ({ registerLocation: (...args) => ground.push(args) }),
    onInterfaceActionButton: (ids, fn) => [].concat(ids).forEach(id => { const callbacks=buttons.get(id) ?? []; callbacks.push(fn); buttons.set(id,callbacks); }),
    onObjectClick: (ids, click, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    onNpcInteraction: (name, actions) => { if (typeof name === 'function') (hooks.onNpcInteraction ??= []).push(name); else attach(namedNpcs, name, actions); },
    onObjectInteraction: (name, actions) => { if (typeof name === 'function') (hooks.onObjectInteraction ??= []).push(name); else attach(namedObjects, name, actions); },
    onObjectFirstClick: (ids, fn) => [].concat(ids).forEach(id => clicks.set(id, fn)),
    persistAttribute: noop,
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
    spawnNpc(definition) {
      let location = new core.Location(definition.x, definition.y, definition.z), area = null;
      const queue = {
        points: [],
        reset() { queue.points.length = 0; return queue; },
        addSteps(to) {
          npc.walkingTo = to;
          let x = location.getX(), y = location.getY();
          const z = to.getZ();
          while (x !== to.getX() || y !== to.getY()) {
            x += Math.sign(to.getX() - x);
            y += Math.sign(to.getY() - y);
            queue.points.push(new core.Location(x, y, z));
          }
          return queue;
        },
        addFirstStep(to) { queue.reset(); return queue.addSteps(to); },
        hasPendingWork: () => queue.points.length > 0,
        size: () => queue.points.length,
        isMovings: () => queue.points.length > 0,
        advance() {
          const next = queue.points.shift();
          if (next) location = next;
        },
      };
      const npc = { ...definition, animations: [], graphics: [], getId: () => definition.id, getIndex: () => npc.index,
        index: nextIndex++, setForceMovement: movement => {p.forceMovement=movement;}, getLocation: () => location, moveTo: to => { location = to; },
        getArea: () => area, setArea: value => { area = value; }, isNpc: () => true, isPlayer: () => false, getAsNpc: () => npc,
        isRegistered: () => !npc.removed, setPositionToFace: noop, forceChat: text => { npc.said = text; },
        setScriptedMovement: value => { npc.scriptedMovement = value; },
        performAnimation: animation => npc.animations.push(animation.getId()), performGraphic: graphic => npc.graphics.push(graphic.id),
        getMovementQueue: () => queue,
        exactMove: (to, options) => { npc.exact = options; location = to; },
        setFollowing: target => { npc.following = target; }, setMobileInteraction: noop, setNpcTransformationId: id => { npc.transformed = id; },
        hitpoints: 100, getHitpoints: () => npc.hitpoints, heal: amount => { npc.hitpoints += amount; },
        setPet: noop, setOwner: noop, getOwner: () => definition.owner,
        setCombatXpMultiplier: value => { npc.multiplier = value; },
        getCombat: () => ({ attack: player => { npc.target = player; }, reset: () => { npc.target = null; } }),
      }; npcs.push(npc); return npc;
    }, removeNpc: npc => { npc.removed = true; removed.push(npc); },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) { const answer = fn(event); if (answer !== null && answer !== undefined) return answer; }
    return null;
  };
  const h = { api, hooks, events, tasks, areas, combatResolvers, npcs, removed, objects, ground, clicks, buttons, namedNpcs, namedObjects, itemActions, quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    line(p, npcId, text) { const event = { player: p, npcId, text, pages: [{ page: h.quest.name }] }; h.emit('npc-dialogue:line', event); return event; },
    action(p, npcId, stepId) { const event = { player: p, npcId, stepId, pages: [{ page: h.quest.name }] }; h.emit('npc-dialogue:action', event); return event; },
    talk(p, npcId) { const choice = (hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player: p, npcId })).find(Boolean); assert.ok(choice); runtime.startTranscript(api, p, npcId, typeof choice === 'string' ? h.quest.name : choice.page, typeof choice === 'string' ? choice : choice.variant); },
    tick(count) { while (count-- > 0) { [...tasks].forEach(task => task.tick()); for (const npc of npcs) if (!npc.removed) npc.getMovementQueue().advance?.(); } },
    choose(p, text) { const prompt = p.prompt; assert.ok(prompt, `no menu for ${text}`); const index = prompt.options.findIndex(label => label === text); assert.ok(index >= 0, `missing ${text} in ${prompt.options}`); p.prompt = null; prompt.pairs[index * 2 + 1](); },
    continueUntil(p, predicate, limit = 80) { while (!predicate()) { assert.ok(limit-- > 0, `dialogue stalled at ${p.text}`); assert.ok(p.manager.getCurrent(), `dialogue ended at ${p.text}`); p.manager.advance(); } },
  }; return h;
}
function player() {
  const attrs = new Map(), items = new Map(), configs = new Map(), varbits = new Map(), log = [], xp = [];
  let location = new core.Location(3210, 3220, 0), area = null;
  const inv = { getAmount: id => items.get(id) ?? 0, isFull: () => Boolean(p.full), getFreeSlots: () => p.full ? 0 : 28, contains: id => (items.get(id)??0)>0,
    adds(id, amount) { items.set(id, (items.get(id) ?? 0) + amount); },
    deleteNumber(id, amount) { assert.ok((items.get(id) ?? 0) >= amount); items.set(id, items.get(id) - amount); },
  };
  const packet = new Proxy({
    sendInterfaceScript(id, args) { require('../dist/net/protocol/ClientProtocol').encodeWidgetRunScript(id, args); log.push(['sendInterfaceScript', id, args]); return packet; },
    sendConfig(id, value) { configs.set(id, value); return packet; }, sendVarbit(id, value) { varbits.set(id, value); return packet; },
    getVarbit: id => varbits.get(id) ?? 0, getVarp: id => configs.get(id) ?? 0,
    sendString(text, uid) { if ([6,3,2].some(child => [217,231,229,193].some(group => uid === (group << 16 | child)))) p.text = text; log.push(['text',uid,text]); return packet; },
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return packet; },
  }, { get: (t, key) => t[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const p = { setEnteredAmountAction: action => { if (action !== null) assert.equal(typeof action.execute, 'function'); p.amountAction = action; }, attrs, items, configs, varbits, log, xp, messages: [], animations: [], prompt: null, text: '', index: nextIndex++,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value), getInventory: () => inv,
    getBanks: () => [{ getAmount: id => p.bank?.get(id) ?? 0 }], getEquipment: () => ({ get: () => p.amulet ? { getId: () => p.amulet } : null, getItems: () => p.equipment ?? [] }),
    setInterfaceId: id => { p.interfaceId = id; }, getInterfaceId: () => p.interfaceId ?? -1,
    getSession: () => ({ sendClientPacket: frame => { log.push(['frame',Buffer.from(frame)]); return true; } }), getPacketSender: () => packet, getDialogueManager: () => p.manager, getUpdateFlag: () => ({ flag: noop }),
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(),amount]), getCombatLevel: () => p.combat ?? 3, getCurrentLevel: () => p.magic ?? 99, getMaxLevel: () => p.level ?? 99 }),
    getMovementQueue: () => ({ handleRegionChange: noop, reset() { return this; }, setBlockMovement(value) { p.blocked = value; return this; }, addSteps(to) { location = to; return this; }, isBlockMovement: () => Boolean(p.blocked) }),
    setUntargetable: value => { p.untargetable = value; }, setForceMovement: movement => {p.forceMovement=movement;}, getLocation: () => location, moveTo: to => { location = to; },
    getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; }, getIndex: () => p.index,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    getCombat: () => ({reset: noop, getHitQueue:()=>({addPendingDamage: damage=>{p.damage=damage;}})}),
    getUsername: () => 'Parity', getAppearance: () => ({ isMale: () => true }), setPositionToFace: noop, forceChat: noop,
    getHitpoints: () => 99, setLocation: to => { location = to; }, setWalkingDirection: noop,
    setSkillAnimation: noop, getForceMovement: () => p.forceMovement,
    performAnimation: a => p.animations.push(a.getId()), sendMessage: text => p.messages.push(text),
  }; p.manager = new DialogueManager(p); return p;
}
const continueToMenu = (h,p) => h.continueUntil(p, () => Boolean(p.prompt));

// ---------------------------------------------------------------------------
// Ethically Acquired Antiquities (RSProx 1695, ticks 7114-7934)
// ---------------------------------------------------------------------------
const EAA_STAGE = 'quest.ethically_acquired_antiquities.stage';
const at = (p, x, y) => p.moveTo(new core.Location(x, y, 0));
function eaa() {
  const h = harness('EthicallyAcquiredAntiquities'), p = player();
  (h.events['quest:is-complete'] ??= []).push(event => { if (['children_of_the_sun', 'shield_of_arrav', 'one_small_favour'].includes(event.key)) event.complete = true; });
  return { h, p };
}
const talkName = (h, p, name, npcId) => h.namedNpcs.get(name)['Talk-to']({ player: p, npcId, npc: null });

test('EAA starts from the display notice, then Herminius, the tools and the display move it through 2, 4 and 6 as captured', () => {
  const { h, p } = eaa(); at(p, 1720, 3165);
  h.namedObjects.get('Empty display').Inspect({ player: p, definition: { id: core.ObjectIdentifiers.EMPTY_DISPLAY_5 } });
  assert.ok(p.log.some(row => row[0] === 'sendInterface' && row[1] === 873));
  const notice = p.log.find(row => row[0] === 'sendClientScript' && row[1] === 5006);
  assert.equal(notice[2], "Xerna's Diadem"); assert.equal(notice[3], 53130);
  h.tick(3); assert.equal(p.text, '');
  h.tick(1); assert.match(p.text, /somewhat of an expert/);
  continueToMenu(h, p); h.choose(p, 'Yes.'); assert.equal(h.quest.getStage(p), 2);
  assert.ok(p.messages.includes("You've started a new quest: <col=081190>Ethically Acquired Antiquities</col>"));
  p.manager.reset();
  h.talk(p, N.CURATOR_HERMINIUS); continueToMenu(h, p); h.choose(p, 'Could you tell me more about that empty display?');
  h.continueUntil(p, () => p.text.startsWith('I was starting to consider')); assert.equal(h.quest.getStage(p), 2);
  p.manager.advance(); assert.match(p.text, /^Perhaps you'll have better luck/); assert.equal(h.quest.getStage(p), 4);
  h.continueUntil(p, () => !p.manager.getCurrent());
  h.namedObjects.get('Tools').Investigate({ player: p, definition: { id: core.ObjectIdentifiers.TOOLS_13 } });
  assert.equal(p.varbits.get(11195), 1); assert.match(p.text, /specialist tools/);
  assert.ok(p.log.some(row => row.includes(29908)), 'the tools box shows the eaa_tools model');
  p.manager.advance();
  h.namedObjects.get('Empty display').Inspect({ player: p, definition: { id: core.ObjectIdentifiers.EMPTY_DISPLAY_5 } });
  assert.equal(p.varbits.get(11194), 1); assert.match(p.text, /tampered/); assert.equal(h.quest.getStage(p), 4);
  p.manager.advance(); assert.match(p.text, /find much more just lying/); assert.equal(h.quest.getStage(p), 6);
});

test('EAA visitors: any museum Citizen/Tourist/Academic answers by kind; the informant alone moves the quest to 8', () => {
  const { h, p } = eaa(); at(p, 1712, 3162); h.quest.setStage(p, 6); p.attrs.set('quest.ethically_acquired_antiquities.informant', 'citizen');
  talkName(h, p, 'Tourist', N.TOURIST); assert.equal(p.text, 'Hello there.'); p.manager.advance(); assert.equal(p.text, 'Hi! Can I help you?');
  h.continueUntil(p, () => /^(No, I don't think so|Oh\.\.\. Sorry)/.test(p.text));
  assert.equal(p.varbits.get(11197), 1); assert.equal(h.quest.getStage(p), 6);
  h.continueUntil(p, () => !p.manager.getCurrent());
  talkName(h, p, 'Citizen', 13200); p.manager.advance(); assert.equal(p.text, 'Nilsal! Can I help you?');
  h.continueUntil(p, () => p.text.startsWith('You did?')); assert.equal(h.quest.getStage(p), 6);
  p.manager.advance(); assert.match(p.text, /towards the quetzal landing site/); assert.equal(h.quest.getStage(p), 8); assert.equal(p.varbits.get(11196), 1);
  at(p, 1690, 3160); h.quest.setStage(p, 6); p.manager.reset();
  assert.equal(talkName(h, p, 'Citizen', 13200), false, 'outside the Grand Museum visitors are ordinary');
});

test('EAA charter crews and Artima follow the capture: favour flag, sails boxes, timed stitching, Port Sarim Trader Stan', () => {
  const { h, p } = eaa(); h.quest.setStage(p, 8);
  h.talk(p, N.REGULUS_CENTO_3); continueToMenu(h, p); h.choose(p, 'Have you seen anybody suspicious around?');
  h.continueUntil(p, () => p.text.startsWith('He asked if he could')); assert.equal(h.quest.getStage(p), 8);
  p.manager.advance(); assert.match(p.text, /towards the Cothon/); assert.equal(h.quest.getStage(p), 10);
  h.continueUntil(p, () => !p.manager.getCurrent());
  at(p, 1741, 3135);
  assert.equal(talkName(h, p, 'Trader Crewmember', 9371), true); continueToMenu(h, p); h.choose(p, 'Have you seen a man with a case?');
  h.continueUntil(p, () => p.text.startsWith('Although, we could use a hand')); assert.equal(p.varbits.get(11200), 1);
  continueToMenu(h, p); h.choose(p, 'As long as it is just the one favour...');
  h.continueUntil(p, () => /tattered sails/.test(p.text)); assert.equal(h.quest.getStage(p), 12); assert.equal(p.items.get(I.TATTERED_SAILS), 1);
  assert.ok(p.log.some(row => row.includes(I.TATTERED_SAILS)));
  p.manager.reset(); at(p, 1767, 3103);
  const artima = { performAnimation: a => (artima.animations ??= []).push(a.getId()) };
  const choice = (h.hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player: p, npcId: N.ARTIMA })).find(Boolean);
  h.events['npc-dialogue:line'].unshift(event => { event.npc = artima; });
  runtime.startTranscript(h.api, p, N.ARTIMA, h.quest.name, choice);
  continueToMenu(h, p); h.choose(p, 'I was hoping for some help.');
  h.continueUntil(p, () => p.text.startsWith('Oh, in that case')); assert.equal(p.varbits.get(11201), 1);
  continueToMenu(h, p); h.choose(p, 'Go on then.');
  h.continueUntil(p, () => p.text === 'Here you go.'); assert.equal(p.items.get(I.TATTERED_SAILS), 1);
  p.manager.advance(); assert.match(p.text, /^Let's see/); assert.equal(p.items.get(I.TATTERED_SAILS), 0);
  assert.deepEqual(artima.animations, [10794]);
  h.tick(3); assert.match(p.text, /^Let's see/); h.tick(1); assert.match(p.text, /^Grab some of that/);
  h.tick(4); assert.match(p.text, /^Tie off/); assert.equal(p.items.get(I.SAILS) ?? 0, 0);
  h.tick(4); assert.match(p.text, /^There we have it/); assert.equal(p.items.get(I.SAILS), 1); assert.equal(p.varbits.get(11205), 1);
  assert.deepEqual(artima.animations, [10794, 10794, 10794]);
  h.events['npc-dialogue:line'].shift(); p.manager.reset(); at(p, 1738, 3137);
  talkName(h, p, 'Trader Crewmember', 9371); continueToMenu(h, p); h.choose(p, 'So, about that man with the case.');
  h.continueUntil(p, () => /newly fixed sails/.test(p.text)); assert.equal(h.quest.getStage(p), 14); assert.equal(p.items.get(I.SAILS), 0);
  h.continueUntil(p, () => p.text.startsWith('Well, we explained')); assert.equal(h.quest.getStage(p), 16);
  p.manager.reset(); at(p, 3039, 3193);
  talkName(h, p, 'Trader Stan', N.TRADER_STAN); assert.equal(p.text, 'Can I help you?');
  assert.ok(p.log.some(row => row[0] === 'text' && row[2] === 'Trader Stan'), 'Trader Stan keeps his own name and head');
  continueToMenu(h, p); h.choose(p, 'Have you seen a grey-haired man with a case?');
  h.continueUntil(p, () => p.text.startsWith('Wandered up north')); assert.equal(h.quest.getStage(p), 18);
});

test("EAA Betty's notes open interface 291 and the Varrock storeroom runs pickpocket, pass-through door and crate as captured", () => {
  const { h, p } = eaa(); h.quest.setStage(p, 18);
  h.talk(p, N.BETTY); continueToMenu(h, p); h.choose(p, 'Have you seen a grey-haired man with a case?');
  h.continueUntil(p, () => p.text.startsWith('I did take some notes')); assert.equal(h.quest.getStage(p), 18);
  assert.equal(p.items.get(I.BETTYS_NOTES) ?? 0, 0, 'mentioning the notes does not hand them over');
  h.continueUntil(p, () => /Betty hands you the notes/.test(p.text)); assert.equal(p.items.get(I.BETTYS_NOTES), 1);
  assert.equal(h.quest.getStage(p), 20, 'the inventory-checked handoff earns the read-notes stage');
  assert.equal(p.varbits.get(11206), 1); assert.notEqual(p.varbits.get(11202), 1, 'the capture never sets betty_told_about_note');
  p.manager.reset();
  h.itemActions.get("Betty's notes").Read({ player: p, itemId: I.BETTYS_NOTES });
  assert.equal(h.quest.getStage(p), 22);
  assert.ok(p.log.some(row => row[0] === 'sendInterface' && row[1] === 291));
  assert.ok(p.log.some(row => row[0] === 'text' && row[1] === ((291 << 16) | 8) && row[2] === 'One that lets me travel, but not fight.'));
  h.emit('interface:closed', { player: p, interfaceId: 291 }); assert.equal(p.text, 'What could this mean?');
  p.manager.reset(); at(p, 3258, 3449);
  const haig = h.namedNpcs.get('Curator Haig Halen');
  haig['Talk-to']({ player: p, npcId: N.CURATOR_HAIG_HALEN }); continueToMenu(h, p); h.choose(p, "I'm looking for Xerna's Diadem.");
  h.continueUntil(p, () => p.text.startsWith('What awful news')); assert.equal(h.quest.getStage(p), 24);
  h.continueUntil(p, () => !p.manager.getCurrent());
  haig.Pickpocket({ player: p, npcId: N.CURATOR_HAIG_HALEN }); assert.equal(p.items.get(I.STOREROOM_KEY_3), 1);
  assert.deepEqual(p.animations, [881]); assert.match(p.text, /steal a key/); assert.equal(h.quest.getStage(p), 24, 'pickpocketing does not advance the stage');
  p.manager.reset();
  const door = { getLocation: () => new core.Location(3266, 3456, 0), getType: () => 0, getFace: () => 3 };
  at(p, 3266, 3455); h.emit('door:toggle', { player: p, object: door, objectId: core.ObjectIdentifiers.DOOR_746 });
  assert.ok(p.messages.includes('You use the key to unlock the door.'));
  h.namedObjects.get('Crate').Search({ player: p, definition: { id: core.ObjectIdentifiers.CRATE_340 } });
  assert.equal(h.quest.getStage(p), 28); assert.match(p.text, /find Xerna's Diadem/); assert.ok(p.log.some(row => row.includes(29907)));
  assert.notEqual(p.varbits.get(11207), 1, 'the display stays empty until after completion');
});

// The Wiki's "increase shame" options.
const SHAMING = new Set([
  "A real historian would never steal!",
  "Are you even a real historian, or just a petty criminal?",
  "Aren't you embarrassed to have stolen items in your collection?",
  "Did you know Varlamore sends thieves to the Colosseum?",
  "Do you really think you did the right thing?",
  "Do your colleagues know what you've done? What do they think?",
  "Hand that artefact back this instant!",
  "How will Varlamorians learn their history now?",
  "How would you feel if someone came in here and stole all your stuff?",
  "I guess you were just in it for the glory, were you?",
  "I thought archaeology was cool. I didn't realise it was just thieving!",
  "If you're looking for stolen goods, I can get my hands on plenty.",
  "Is everything here stolen from other museums?",
  "Just give it back already!",
  "Look me in the eye and tell me you did the right thing.",
  "Nobody wants to see stolen goods on display!",
  "So can anyone just go around stealing and call it archaeology?",
  "Stealing is against the law!",
  "Stealing is stealing, no matter how you try to justify it.",
  "Think of the Varlamorian children who won't get to see this artefact.",
  "This is stealing! Thieving! Taking what's not yours!",
  "Varlamore might close their lands again after this.",
  "Varlamore might never let you and your colleagues visit again!",
  "You can't justify theft by saying it's for preservation.",
  "You could have damaged the artefact!",
  "You ought to be ashamed.",
  "You should give Varlamore a chance before stealing their stuff.",
  "You're a disgrace to your entire profession!",
  "You're a loose cannon.",
  "You're hoarding artefacts, but you should be sharing them!",
  "You're not above the law! You stole this stuff!",
  "You're setting a terrible example.",
  "You're supposed to protect history, not steal it!",
  "You've betrayed the trust of Varlamore.",
  "You've committed a crime.",
]);
function confront(h, p) {
  at(p, 3256, 3447); h.quest.setStage(p, 28);
  h.namedNpcs.get('Curator Haig Halen')['Talk-to']({ player: p, npcId: N.CURATOR_HAIG_HALEN });
  continueToMenu(h, p); h.choose(p, "I found Xerna's Diadem...");
  h.continueUntil(p, () => p.text === 'Ah...'); p.manager.advance();
}
const shameOf = p => p.varbits.get(11199);
const lastTurn = p => p.log.findLast(row => row[0] === 'sendCameraRotateBy')?.slice(1);

test('EAA interrogation: private museum, Haig actor, meter at 50, captured -4/+4 opening, three-option rounds and speaker turns', () => {
  const { h, p } = eaa(); confront(h, p);
  assert.equal(p.blocked, true); assert.equal(p.varbits.get(542), 1); assert.equal(p.varbits.get(6719), 2);
  h.tick(2); assert.equal(p.getLocation().getX(), 3258); assert.equal(p.getLocation().getY(), 3449); assert.ok(p.getArea());
  const actor = h.npcs.find(npc => npc.id === N.CURATOR_HAIG_HALEN_2); assert.ok(actor); assert.deepEqual([actor.x, actor.y], [3256, 3449]);
  h.tick(1); assert.deepEqual(p.log.findLast(row => row[0] === 'sendCameraLookAt').slice(1), [3256, 3449, 220, { rate: 232, rate2: 100 }]);
  h.tick(3); assert.equal(shameOf(p), 50); assert.match(p.text, /^So you found the diadem/);
  h.continueUntil(p, () => p.text === "I don't know what you're talking about!"); assert.equal(h.quest.getStage(p), 30);
  p.manager.advance(); assert.ok(p.log.some(row => row[0] === 'sendSubInterface' && row[2] === 881));
  p.manager.advance(); assert.match(p.text, /^Steal\?!/); assert.equal(shameOf(p), 46); assert.deepEqual(lastTurn(p), [0, 1024, 5, 'linear']);
  p.manager.advance(); assert.deepEqual(lastTurn(p), [0, -1024, 5, 'linear']);
  p.manager.advance(); assert.match(p.text, /^They'd understand/); assert.equal(shameOf(p), 50); assert.deepEqual(lastTurn(p), [0, 1024, 5, 'linear']);
  p.manager.advance(); assert.ok(p.prompt); assert.deepEqual(lastTurn(p), [0, -1024, 5, 'linear'], 'the menu turns back to the player');
  const seen = new Set();
  for (let round = 0; round < 30 && h.quest.getStage(p) === 30; round++) {
    if (!p.prompt) { p.manager.advance(); continue; }
    assert.equal(p.prompt.options.length, 3);
    const menu = p.prompt.options.join('|'); assert.ok(!seen.has(menu), 'each group of three appears once'); seen.add(menu);
    const before = shameOf(p), pick = p.prompt.options.find(option => SHAMING.has(option));
    assert.ok(pick, `every captured menu offers a shaming option: ${menu}`);
    h.choose(p, pick); p.manager.advance();
    const rise = shameOf(p) - before; assert.ok(rise >= 4 && rise <= 9 || shameOf(p) === 100, `rise ${rise}`);
    p.manager.advance();
  }
  assert.equal(shameOf(p), 100); assert.equal(h.quest.getStage(p), 32);
  assert.match(p.text, /^You can't just keep claiming/); assert.ok(p.log.some(row => row[0] === 'closeSubInterface' && row[1] === ((161 << 16) | 1)));
  p.manager.advance(); assert.match(p.text, /^I didn't steal anything!/);
  assert.deepEqual(p.log.findLast(row => row[0] === 'sendCameraLookAt').slice(1), [3256, 3449, 220, { rate: 232, rate2: 100 }]);
});

test('EAA flashback replays the Grand Museum scene and returns to Haig; the hand-off sets 36 and Herminius completes at 38', () => {
  const { h, p } = eaa(); p.items.set(I.BETTYS_NOTES, 1); confront(h, p); h.tick(6);
  for (let step = 0; step < 200 && h.quest.getStage(p) < 32; step++) {
    if (p.prompt) h.choose(p, p.prompt.options.find(option => SHAMING.has(option))); else p.manager.advance();
  }
  h.continueUntil(p, () => p.text === 'Well...'); p.manager.advance(); h.tick(2);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [1712, 3167]);
  const haig = h.npcs.findLast(npc => npc.id === N.CURATOR_HAIG_HALEN_2 && !npc.removed), thief = h.npcs.find(npc => npc.id === N.THIEF_18);
  assert.deepEqual([haig.x, haig.y, thief.x, thief.y], [1704, 3165, 1720, 3164]);
  assert.ok(h.npcs.filter(npc => npc.id === N.CURATOR_HAIG_HALEN_2).every(npc => npc === haig || npc.removed), 'the confrontation actor is gone');
  h.tick(4); assert.match(p.text, /^Naturally/); assert.deepEqual(haig.animations, [857]);
  p.manager.advance(); p.manager.advance(); assert.match(p.text, /^All of a sudden/); p.manager.advance();
  assert.deepEqual([haig.walkingTo.getX(), thief.walkingTo.getX()], [1710, 1714]);
  h.tick(1); assert.deepEqual(p.log.findLast(row => row[0] === 'sendCameraMoveTo').slice(1), [1712, 3160, 300, { cycles: 210, easing: 'ease_out_sine', ignoreTerrain: true }]);
  h.tick(6); assert.match(p.text, /^It was a thief!/); p.manager.advance(); p.manager.advance();
  h.tick(4); assert.deepEqual(haig.animations, [857, 11736, 11737, 11736]); assert.deepEqual(thief.animations, [11738, 9101]);
  h.tick(1); assert.match(p.text, /^He went down easily/); p.manager.advance(); p.manager.advance();
  assert.deepEqual(haig.animations.at(-1), 827);
  h.tick(4); assert.equal(h.quest.getStage(p), 34); h.tick(2);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3258, 3447]); assert.equal(p.getArea(), null);
  assert.equal(p.blocked, false); assert.equal(p.varbits.get(542), 0); assert.ok(h.npcs.filter(npc => npc.id >= 13816).every(npc => npc.removed));
  h.tick(4); assert.equal(p.text, "Now I don't know what to do...");
  h.continueUntil(p, () => p.text.startsWith('Okay...')); assert.equal(h.quest.getStage(p), 36);
  h.continueUntil(p, () => !p.manager.getCurrent());
  at(p, 1712, 3162); h.talk(p, N.CURATOR_HERMINIUS); continueToMenu(h, p); h.choose(p, 'About that empty display...');
  h.continueUntil(p, () => h.quest.isComplete(p));
  assert.equal(h.quest.getStage(p), 38); assert.deepEqual(p.xp, [[core.Skill.THIEVING.getIndex(), 6000]]);
  assert.equal(p.items.get(I.COINS), 5000); assert.equal(p.items.get(I.BETTYS_NOTES), 0);
  assert.ok(p.messages.includes("Congratulations, you've completed a quest: <col=081190>Ethically Acquired Antiquities</col>"));
  h.tick(63); assert.notEqual(p.varbits.get(11207), 1); h.tick(1); assert.equal(p.varbits.get(11207), 1);
});

test('EAA failed interrogation and logout both return the player to Haig with controls back; talking again starts over', () => {
  const { h, p } = eaa(); confront(h, p); h.tick(6);
  for (let step = 0; step < 200 && shameOf(p) > 0; step++) {
    if (p.prompt) h.choose(p, p.prompt.options.find(option => !SHAMING.has(option)) ?? p.prompt.options[0]); else p.manager.advance();
  }
  h.continueUntil(p, () => p.text.startsWith('Oh, pish posh!')); p.manager.advance(); h.tick(2);
  assert.equal(h.quest.getStage(p), 30); assert.equal(p.getArea(), null); assert.equal(p.blocked, false);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3258, 3447]);
  p.manager.reset(); h.namedNpcs.get('Curator Haig Halen')['Talk-to']({ player: p, npcId: N.CURATOR_HAIG_HALEN });
  continueToMenu(h, p); assert.ok(p.prompt.options.includes("I found Xerna's Diadem..."));
  const q = eaa(); confront(q.h, q.p); q.h.tick(6); q.p.manager.advance();
  q.h.hooks.onPlayerLogout[0]({ player: q.p });
  assert.equal(q.p.blocked, false); assert.equal(q.p.getArea(), null); assert.deepEqual([q.p.getLocation().getX(), q.p.getLocation().getY()], [3258, 3447]);
  const cameras = q.p.log.length; q.h.tick(20); assert.equal(q.p.log.filter(row => String(row[0]).startsWith('sendCamera')).length, q.p.log.slice(0, cameras).filter(row => String(row[0]).startsWith('sendCamera')).length);
});

test('EAA closing the scene dialogue (Escape) brings the line or menu back instead of stranding the player', () => {
  const { h, p } = eaa(); confront(h, p); h.tick(6);
  assert.match(p.text, /^So you found/); p.manager.reset(); p.text = ''; h.tick(1); assert.match(p.text, /^So you found/);
  for (let step = 0; step < 20 && !p.prompt; step++) p.manager.advance();
  const menu = p.prompt.options; p.prompt = null; h.tick(1); assert.deepEqual(p.prompt.options, menu);
});

// ---------------------------------------------------------------------------
// Meat and Greet (RSProx 1695, ticks 7980-8789)
// ---------------------------------------------------------------------------
function mag() {
  const h = harness('MeatAndGreet'), p = player();
  (h.events['quest:is-complete'] ??= []).push(event => { if (event.key === 'children_of_the_sun') event.complete = true; });
  p.attrs.set('meat-and-greet:stage-version', 1);
  return { h, p };
}
const talkMag = (h, p, name, npcId, npc = null) => h.namedNpcs.get(name)['Talk-to']({ player: p, npcId, npc });
const hp = (npc, current, max) => { npc.getHitpoints = () => current; npc.getMaxHitpoints = () => max; };

test('MAG starts at 2, sets the deliveries at 4 and the spice box keypad takes the captured code', () => {
  const { h, p } = mag();
  talkMag(h, p, 'Emelio', N.EMELIO); continueToMenu(h, p); h.choose(p, 'Yes.');
  assert.equal(h.quest.getStage(p), 2); assert.ok(p.messages.includes("You've started a new quest: <col=081190>Meat and Greet</col>"));
  h.continueUntil(p, () => p.text.startsWith("Okay, I guess I can go see")); assert.equal(h.quest.getStage(p), 4);
  assert.equal(p.varbits.get(11183), 1); assert.equal(p.varbits.get(11184), 1);
  h.continueUntil(p, () => !p.manager.getCurrent());
  talkMag(h, p, 'Spice Merchant', N.SPICE_MERCHANT); continueToMenu(h, p); h.choose(p, "I'm here about a missing delivery.");
  h.continueUntil(p, () => p.text === 'Sure thing!'); assert.equal(p.varbits.get(11183), 2);
  p.manager.advance(); h.tick(1);
  assert.ok(p.log.some(row => row[0] === 'sendInterface' && row[1] === 888));
  assert.deepEqual(p.log.find(row => row[0] === 'sendClientScript' && row[1] === 7374).slice(2), [(888 << 16) | 6, (888 << 16) | 5, 2, 5, 4, 6, 2]);
  p.amountAction.execute(1234); assert.equal(p.varbits.get(11183), 2);
  talkMag(h, p, 'Spice Merchant', N.SPICE_MERCHANT); continueToMenu(h, p); h.choose(p, 'Could I have a look at that locked box?');
  h.continueUntil(p, () => p.text === 'Sure thing!'); p.manager.advance(); h.tick(1);
  p.amountAction.execute(2546); assert.equal(p.varbits.get(11183), 3); assert.match(p.text, /You unlock the box/);
  p.manager.advance(); assert.match(p.text, /^Kuani! You did it/); assert.equal(p.varbits.get(11183), 4); assert.equal(h.quest.getStage(p), 4);
});

test('MAG wolf den: private den with the alpha, one pack call, the exit opening on the kill, and Alba sorting the meat (stage 6)', () => {
  const { h, p } = mag(); h.quest.setStage(p, 4); p.attrs.set('meat-and-greet:vars', 4 << 7 | 1 << 11);
  talkMag(h, p, 'Alba', N.ALBA); h.continueUntil(p, () => p.text.startsWith("Okay, I'll head over there")); assert.equal(p.varbits.get(11184), 2);
  h.continueUntil(p, () => !p.manager.getCurrent());
  at(p, 1497, 3130); h.namedObjects.get('Wolf Den').Enter({ player: p });
  assert.deepEqual(p.animations, [11580]); assert.equal(p.blocked, true);
  h.tick(2); assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1486, 9502, 1]);
  const alpha = h.npcs.find(npc => npc.id === N.DIRE_WOLF_ALPHA); assert.deepEqual([alpha.x, alpha.y, alpha.z], [1477, 9501, 1]);
  const exitFrame = () => p.log.filter(row => row[0] === 'sendObject' && row[1].getId() === 54691).at(-1)?.[1];
  assert.equal(exitFrame().getOpFlags(), 0, 'no way out while the alpha lives');
  h.tick(1); assert.equal(p.blocked, false); h.tick(1); assert.equal(alpha.said, 'Grrr!');
  const resolved = target => h.hooks.onCombatHitResolved[0]({ target, attacker: p, hit: {} });
  hp(alpha, 70, 100); resolved(alpha); assert.equal(h.npcs.some(npc => npc.id === 13813), false);
  hp(alpha, 66, 100); resolved(alpha);
  const pack = h.npcs.find(npc => npc.id === 13813); assert.ok(pack); assert.equal(pack.target, p); assert.equal(alpha.said, 'Aarrooooo!');
  assert.ok(p.messages.includes('<col=e00a19>The dire wolf calls to its pack!'));
  hp(alpha, 30, 100); resolved(alpha); assert.equal(h.npcs.filter(npc => npc.id === 13813).length, 1, 'one call');
  h.namedObjects.get('Cave').Exit({ player: p }); assert.equal(p.getLocation().getZ(), 1, 'the exit stays shut');
  hp(alpha, 0, 100); resolved(alpha); assert.equal(p.varbits.get(11184), 3); assert.equal(exitFrame().getOpFlags(), 1);
  assert.equal(pack.said, 'Aarrooooo!'); h.tick(3); assert.equal(pack.removed, true);
  h.namedObjects.get('Cave').Exit({ player: p }); h.tick(2);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1499, 3130, 0]); assert.equal(p.getArea(), null);
  h.tick(1); assert.equal(p.blocked, false);
  talkMag(h, p, 'Alba', N.ALBA); h.continueUntil(p, () => p.text.startsWith('Kuani! Thank you so much'));
  assert.equal(p.varbits.get(11184), 4); assert.equal(h.quest.getStage(p), 6);
});

test('MAG recipe: Emelio sends the player to the connoisseurs (8), native portion menus, test kebab, Renata loves 4/2/1/3 (10)', () => {
  const { h, p } = mag(); h.quest.setStage(p, 6); p.attrs.set('meat-and-greet:vars', 4 << 7 | 4 << 11);
  talkMag(h, p, 'Emelio', N.EMELIO); h.continueUntil(p, () => p.text.startsWith('Head on out there')); assert.equal(h.quest.getStage(p), 8);
  h.continueUntil(p, () => !p.manager.getCurrent());
  talkMag(h, p, 'Emelio', N.EMELIO); continueToMenu(h, p); h.choose(p, 'I think so.');
  assert.equal(p.text, 'I think so.'); p.manager.advance();
  assert.match(p.text, /one portion each of meat/); for (const id of [11185, 11186, 11187, 11188]) assert.equal(p.varbits.get(id), 1);
  continueToMenu(h, p);
  assert.deepEqual(p.prompt.options, ['Adjust meat (currently at one portion).', 'Adjust salad (currently at one portion).',
    'Adjust spice (currently at one portion).', 'Adjust sauce (currently at one portion).', "I think that's perfect!"]);
  const pick = (ingredient, count) => {
    h.choose(p, p.prompt.options.find(option => option.startsWith(`Adjust ${ingredient}`)));
    assert.equal(p.prompt.title, `Adjust number of ${ingredient} portions to:`);
    h.choose(p, p.prompt.options.find(option => option.startsWith(count)));
    p.manager.advance(); continueToMenu(h, p);
  };
  pick('meat', 'Four'); assert.equal(p.varbits.get(11185), 4);
  assert.equal(p.prompt.options[0], 'Adjust meat (currently at four portions).');
  h.choose(p, 'Adjust meat (currently at four portions).'); assert.deepEqual(p.prompt.options, ['One.', 'Two.', 'Three.', 'Four (current).', 'Cancel.']);
  h.choose(p, 'Cancel.'); continueToMenu(h, p);
  pick('salad', 'Two'); pick('sauce', 'Three');
  h.choose(p, "I think that's perfect!"); p.manager.advance();
  assert.equal(p.text.replace(/<br>/g, '').replace(/\s+/g, ' '), 'Kuani! That gives us four portions of meat, two portions of salad, one portion of spice and three portions of sauce. Definitely happy with that?');
  continueToMenu(h, p); h.choose(p, 'Sounds good to me.');
  h.continueUntil(p, () => /Emelio gives you a kebab/.test(p.text)); assert.equal(p.items.get(I.TEST_KEBAB), 1); assert.equal(p.varbits.get(11189), 1);
  assert.ok(p.log.some(row => row.includes(I.TEST_KEBAB)));
  p.manager.reset();
  const renata = { performAnimation: a => { renata.animation = a.getId(); } };
  talkMag(h, p, 'Renata', N.RENATA, renata); assert.equal(p.text, 'What do you make of this?');
  p.manager.advance(); assert.equal(h.quest.getStage(p), 10); assert.equal(p.items.get(I.TEST_KEBAB), 0); assert.equal(renata.animation, 829);
  assert.equal(p.text, 'This is brilliant! Amazing stuff!');
});

test('MAG a wrong recipe fails the taste test and Emelio reopens the portion menu with the current portions', () => {
  const { h, p } = mag(); h.quest.setStage(p, 8); p.attrs.set('meat-and-greet:vars', (4 << 7 | 4 << 11 | 1 << 15 | 1 << 18 | 1 << 21 | 1 << 24) >>> 0);
  p.items.set(I.TEST_KEBAB, 1);
  talkMag(h, p, 'Lucas', N.LUCAS); p.manager.advance(); assert.equal(p.text, 'Eww! This is awful.'); assert.equal(h.quest.getStage(p), 8);
  h.continueUntil(p, () => !p.manager.getCurrent());
  talkMag(h, p, 'Emelio', N.EMELIO); h.continueUntil(p, () => p.text.startsWith('Tatamo!'));
  assert.match(p.text.replace(/\s*<br>\s*/g, ' '), /one portion of meat/); continueToMenu(h, p); assert.equal(p.prompt.options[0], 'Adjust meat (currently at one portion).');
});

test('MAG marketing and the Colosseum: kebabs (12/14), Lelia eats one (16/18), the advert, the minotaur fight (20) and the reward at 26', () => {
  const { h, p } = mag(); h.quest.setStage(p, 10); p.attrs.set('meat-and-greet:vars', 4 << 7 | 4 << 11);
  talkMag(h, p, 'Emelio', N.EMELIO); h.continueUntil(p, () => p.text.startsWith('You must visit Lelia')); assert.equal(h.quest.getStage(p), 12);
  p.manager.advance(); assert.match(p.text, /some kebabs/); assert.equal(h.quest.getStage(p), 14); assert.equal(p.items.get(I.TEST_KEBAB_2), 2);
  p.manager.reset(); at(p, 1820, 9485);
  const lelia = { performAnimation: a => { lelia.animation = a.getId(); } };
  talkMag(h, p, 'Lelia', N.LELIA, lelia); h.continueUntil(p, () => /Lelia eats the kebab/.test(p.text));
  assert.equal(h.quest.getStage(p), 16); assert.equal(p.items.get(I.TEST_KEBAB_2), 1); assert.equal(lelia.animation, 829);
  h.continueUntil(p, () => p.text.startsWith('Yup.')); assert.equal(h.quest.getStage(p), 18);
  continueToMenu(h, p); assert.deepEqual(p.prompt.options, ['I think so.', 'I need to prepare first.']);
  h.choose(p, 'I think so.'); h.continueUntil(p, () => p.text === 'Right, get to it then.');
  p.manager.advance(); h.tick(2);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [1824, 3098]); assert.equal(p.varbits.get(542), 1);
  const cutscene = h.npcs.find(npc => npc.id === N.MINOTAUR_6); assert.deepEqual([cutscene.x, cutscene.y], [1824, 3111]);
  h.tick(1); assert.deepEqual(p.log.findLast(row => row[0] === 'sendCameraMoveTo').slice(1), [1819, 3099, 600, { rate: 232, rate2: 100 }]);
  h.tick(3); assert.match(p.text, /^Welcome, one and all/);
  h.continueUntil(p, () => p.text.startsWith('Indeed, observe')); p.manager.advance(); assert.ok(p.animations.includes(829));
  assert.equal(p.text, 'Huh? Human... eat... friend?');
  h.continueUntil(p, () => p.text === 'Oh boy...'); p.manager.advance();
  assert.equal(h.quest.getStage(p), 20); assert.equal(p.items.get(I.TEST_KEBAB_2), 0);
  h.tick(2); assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [1824, 3105]);
  const minotaur = h.npcs.find(npc => npc.id === N.MINOTAUR_7); assert.deepEqual([minotaur.x, minotaur.y], [1824, 3113]); assert.equal(cutscene.removed, true);
  assert.ok(p.log.some(row => row[0] === 'sendObject' && row[1].getId() === 54689));
  h.tick(2); assert.equal(p.blocked, false);
  h.hooks.onNpcDeath[0]({ npc: minotaur, npcId: N.MINOTAUR_7, killer: p });
  h.tick(1); assert.equal(h.quest.getStage(p), 22); h.tick(2);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [1820, 9484]); assert.equal(p.getArea(), null);
  h.tick(4); assert.match(p.text, /^You put on a good performance in there/);
  h.continueUntil(p, () => p.text.startsWith('Now, I need to get things ready')); assert.equal(h.quest.getStage(p), 24);
  h.continueUntil(p, () => !p.manager.getCurrent());
  talkMag(h, p, 'Emelio', N.EMELIO); h.continueUntil(p, () => p.text === 'Right...'); assert.equal(h.quest.isComplete(p), false);
  p.manager.advance(); assert.equal(h.quest.getStage(p), 26); assert.deepEqual(p.xp, [[core.Skill.COOKING.getIndex(), 8000]]);
});

test("MAG minotaur: three melee swings then the Moo! magic, and each threshold's Moooooo! shout makes it a tick faster", () => {
  const { h } = mag();
  const Method = h.hooks.registerNpcCombatMethodProvider[0];
  const minotaur = { animations: [], graphics: [], performAnimation: a => minotaur.animations.push(a.getId()), performGraphic: g => minotaur.graphics.push(g.id), forceChat: text => { minotaur.said = text; }, isPlayer: () => false };
  const target = player();
  // A fresh method per swing, as the provider builds them: the fight state stays on the NPC.
  const swing = () => { const method = new Method(minotaur); const speed = method.attackSpeed(minotaur); method.start(minotaur, target); return speed; };
  assert.deepEqual([swing(), swing(), swing()], [5, 5, 5]); assert.deepEqual(minotaur.animations, [11584, 11584, 11584]);
  h.tick(2); assert.equal(minotaur.said, undefined); h.tick(1); assert.equal(minotaur.said, 'Moo!', 'the warning half a cycle before the magic swing');
  assert.equal(swing(), 5); assert.equal(minotaur.animations.at(-1), 11585); assert.deepEqual(minotaur.graphics, [2950]);
  minotaur.__minotaurFight.shouts++; assert.equal(swing(), 3); assert.equal(minotaur.animations.at(-1), 11586); assert.equal(minotaur.said, 'Moooooo!');
  assert.equal(target.log.filter(row => row[0] === 'sendCameraShake').length, 3);
  assert.equal(swing(), 4, 'a tick faster after the shout');
});

test('MAG migrates the old 0-7 stage saves onto the captured stages once', () => {
  const { h } = mag();
  const old = (stage, bits = 0) => { const p = player(); p.attrs.set('quest.meat_and_greet.stage', stage); p.attrs.set('quest.meat_and_greet.bits', bits); h.emit('player:bootstrap-complete', { player: p }); return p; };
  assert.equal(h.quest.getStage(old(1, 1 << 1)), 4);
  const delivering = old(1, (1 << 1) | (1 << 3)); assert.equal(delivering.varbits.get(11183), 4); assert.equal(delivering.varbits.get(11184), 3);
  assert.equal(h.quest.getStage(old(2)), 6); assert.equal(h.quest.getStage(old(5, 1 << 5)), 18); assert.equal(h.quest.getStage(old(5, 1 << 6)), 20);
  const done = old(7); assert.equal(h.quest.getStage(done), 26);
  h.emit('player:bootstrap-complete', { player: done }); assert.equal(h.quest.getStage(done), 26, 'only once');
});

// ---------------------------------------------------------------------------
// At First Light (RSProx 1695, ticks 5134-5763)
// ---------------------------------------------------------------------------
function afl() {
  const h = harness('AtFirstLight'), p = player();
  (h.events['quest:is-complete'] ??= []).push(event => { if (['children_of_the_sun', 'eagles_peak'].includes(event.key)) event.complete = true; });
  p.attrs.set('at-first-light:stage-version', 1);
  return { h, p };
}
const talkAfl = (h, p, name, npcId) => h.namedNpcs.get(name)['Talk-to']({ player: p, npcId, npc: null });
const objectClick = (h, p, id, clickType = 1) => (h.hooks.onObjectInteraction ?? []).forEach(fn => fn({ player: p, objectId: id, clickType,
  definition: { id, getActions: () => ({ 53020: ['Pick'], 53022: ['Pick'], 53011: ['Check'], 50880: ['Set-up'] })[id] ?? [] } }));

test('AFL stages 1-4 as captured: Verity names Wolf (2), the mouse (3), Kiko distracted, the bed checked, the pyre fox hint (4)', () => {
  const { h, p } = afl();
  h.talk(p, N.GUILDMASTER_APATURA); continueToMenu(h, p); h.choose(p, 'Can I help you with anything?');
  continueToMenu(h, p); h.choose(p, 'Yes.'); assert.equal(h.quest.getStage(p), 1); assert.equal(p.varbits.get(9841), 1);
  assert.ok(p.messages.includes("You've started a new quest: <col=081190>At First Light</col>"));
  p.manager.reset();
  talkAfl(h, p, 'Guild Scribe Verity', N.GUILD_SCRIBE_VERITY); h.continueUntil(p, () => p.text.startsWith('If anyone did'));
  assert.equal(h.quest.getStage(p), 2); h.continueUntil(p, () => !p.manager.getCurrent());
  talkAfl(h, p, 'Guild Hunter Wolf (Master)', N.GUILD_HUNTER_WOLF_MASTER_); h.continueUntil(p, () => p.text.startsWith("He's very easy to distract"));
  assert.equal(h.quest.getStage(p), 3);
  h.continueUntil(p, () => /small toy mouse/.test(p.text)); assert.equal(p.items.get(I.TOY_MOUSE), 1); assert.equal(p.varbits.get(9843), 1);
  p.manager.reset();
  h.itemActions.get('Toy mouse').Wind({ player: p, itemId: I.TOY_MOUSE }); assert.equal(p.items.get(I.TOY_MOUSE_WOUND_), 1);
  assert.ok(p.messages.includes('You wind up the mouse.'));
  h.hooks.onItemOnNpc[0]({ player: p, itemId: I.TOY_MOUSE_WOUND_, npcId: N.GUILD_HUNTER_KIKO });
  assert.equal(p.items.get(I.TOY_MOUSE_WOUND_), 0); assert.equal(p.varbits.get(9839), 1); assert.equal(p.text, 'Here you go, little guy.');
  p.manager.advance(); assert.equal(p.text, 'A mouse? Fantastic!'); p.manager.reset();
  objectClick(h, p, 53011); assert.match(p.text, /You check the cat's bed/); assert.equal(p.varbits.get(9837), 1); assert.equal(h.quest.getStage(p), 3);
  p.manager.reset();
  talkAfl(h, p, 'Guild Hunter Wolf (Master)', N.GUILD_HUNTER_WOLF_MASTER_); h.continueUntil(p, () => p.text.startsWith('Why not?'));
  assert.equal(h.quest.getStage(p), 3); p.manager.advance(); assert.equal(h.quest.getStage(p), 4);
  assert.ok(h.npcs.some(npc => npc.id === N.GUILD_HUNTER_FOX && !npc.removed), 'the injured Fox waits in the savannah');
});

test('AFL Fox: found at 5 (bushes pickable then), poultice 6, sample 7, Atza 8 with the pile, trimmed fur 9, report 10', () => {
  const { h, p } = afl(); h.quest.setStage(p, 4); p.items.set(I.JERBOA_TAIL, 2); p.items.set(I.HAMMER, 1);
  talkAfl(h, p, 'Guild Hunter Fox', N.GUILD_HUNTER_FOX); h.continueUntil(p, () => p.text.startsWith("Don't forget"));
  assert.equal(h.quest.getStage(p), 5); p.manager.reset();
  objectClick(h, p, 53020); assert.ok(p.animations.includes(10094)); assert.equal(p.items.get(I.SMOOTH_LEAF) ?? 0, 0);
  h.tick(2); assert.equal(p.items.get(I.SMOOTH_LEAF), 1); assert.match(p.text, /smooth leaf/); p.manager.reset();
  objectClick(h, p, 53022); h.tick(2); assert.equal(p.items.get(I.STICKY_LEAF), 1); p.manager.reset();
  h.hooks.onItemOnItem[0]({ player: p, usedItemId: I.SMOOTH_LEAF, usedWithItemId: I.JERBOA_TAIL });
  assert.equal(p.items.get(I.MAKESHIFT_POULTICE), 1); assert.equal(p.items.get(I.JERBOA_TAIL), 1); assert.ok(p.animations.includes(10097));
  assert.match(p.text, /makeshift poultice/); p.manager.reset();
  talkAfl(h, p, 'Guild Hunter Fox', N.GUILD_HUNTER_FOX); h.continueUntil(p, () => /give the poultice/.test(p.text));
  assert.equal(h.quest.getStage(p), 6); assert.equal(p.items.get(I.MAKESHIFT_POULTICE), 0);
  h.continueUntil(p, () => p.text.startsWith("Well it's your lucky day! Take")); assert.equal(h.quest.getStage(p), 7);
  h.continueUntil(p, () => /fur sample/.test(p.text)); assert.equal(p.items.get(I.FUR_SAMPLE), 1); assert.equal(p.varbits.get(9842), 1);
  p.manager.reset();
  h.namedNpcs.get('Atza')['Talk-to']({ player: p, npcId: N.ATZA }); h.continueUntil(p, () => /give the fur sample/.test(p.text));
  assert.equal(h.quest.getStage(p), 8); h.continueUntil(p, () => p.text.startsWith("It's all in that pile")); assert.equal(p.varbits.get(9840), 1);
  p.manager.reset();
  objectClick(h, p, 50880); assert.ok(p.animations.includes(3676)); h.tick(2); assert.match(p.text, /^So anyway/);
  h.continueUntil(p, () => p.text === 'All done!'); assert.equal(p.varbits.get(9840), 2);
  h.continueUntil(p, () => /trimmed fur/.test(p.text)); assert.equal(h.quest.getStage(p), 9); assert.equal(p.items.get(I.TRIMMED_FUR), 1);
  p.manager.reset();
  talkAfl(h, p, 'Guild Hunter Fox', N.GUILD_HUNTER_FOX); h.continueUntil(p, () => /gives you a report/.test(p.text));
  assert.equal(h.quest.getStage(p), 10); assert.equal(p.items.get(I.FOXS_REPORT), 1);
});

test('AFL report to Verity keeps 10, the tail on the bed repairs it (11) and Apatura completes at 12 after her last line', () => {
  const { h, p } = afl(); h.quest.setStage(p, 10); p.items.set(I.FOXS_REPORT, 1); p.items.set(I.TRIMMED_FUR, 1); p.items.set(I.JERBOA_TAIL, 1); p.items.set(I.NEEDLE, 1);
  talkAfl(h, p, 'Guild Scribe Verity', N.GUILD_SCRIBE_VERITY); assert.match(p.text, /give Fox's report/);
  assert.equal(p.varbits.get(9836), 1); assert.equal(h.quest.getStage(p), 10); assert.equal(p.items.get(I.FOXS_REPORT), 0);
  p.manager.reset();
  h.hooks.onItemOnObject[0]({ player: p, itemId: I.JERBOA_TAIL, objectId: 53011 });
  assert.match(p.text, /carefully fix up/); assert.equal(h.quest.getStage(p), 11); assert.equal(p.varbits.get(9838), 1);
  assert.ok(p.animations.includes(10794)); assert.deepEqual(p.xp, [[core.Skill.CRAFTING.getIndex(), 10]]);
  assert.equal(p.items.get(I.JERBOA_TAIL), 0); assert.equal(p.items.get(I.TRIMMED_FUR), 0);
  p.manager.reset();
  h.talk(p, N.GUILDMASTER_APATURA); h.continueUntil(p, () => p.text.startsWith('Actually...')); assert.equal(h.quest.isComplete(p), false);
  p.manager.advance(); assert.equal(h.quest.getStage(p), 12);
});

test('AFL migrates the old stage model once (bed check, poultice and report steps)', () => {
  const { h } = afl();
  const old = (stage, flags = 0, items = {}) => { const p = player(); p.attrs.set('quest.at_first_light.stage', stage); p.attrs.set('quest.at_first_light.flags', flags);
    for (const [id, n] of Object.entries(items)) p.items.set(Number(id), n); h.emit('player:bootstrap-complete', { player: p }); return p; };
  const bed = old(4); assert.equal(h.quest.getStage(bed), 3); assert.equal(bed.varbits.get(9837), 1);
  assert.equal(h.quest.getStage(old(5)), 4); assert.equal(h.quest.getStage(old(6)), 5);
  assert.equal(h.quest.getStage(old(7)), 6); assert.equal(h.quest.getStage(old(7, 0, { [I.FUR_SAMPLE]: 1 })), 7);
  const delivered = old(11); assert.equal(h.quest.getStage(delivered), 10); assert.equal(delivered.varbits.get(9836), 1);
  assert.equal(h.quest.getStage(old(11, 1)), 11);
});

test('EAA favour menu offers the acceptance beside "Not right now." with or without One Small Favour', () => {
  for (const osf of [true, false]) {
    const h = harness('EthicallyAcquiredAntiquities'), p = player();
    (h.events['quest:is-complete'] ??= []).push(event => { if (event.key === 'one_small_favour') event.complete = osf; });
    h.quest.setStage(p, 10); at(p, 1741, 3135);
    h.namedNpcs.get('Trader Crewmember')['Talk-to']({ player: p, npcId: 9371 }); continueToMenu(h, p); h.choose(p, 'Have you seen a man with a case?');
    continueToMenu(h, p);
    const accept = osf ? 'As long as it is just the one favour...' : 'Sure. What do you need?';
    assert.deepEqual(p.prompt.options, [accept, 'Not right now.']);
    h.choose(p, accept); h.continueUntil(p, () => /tattered sails/.test(p.text)); assert.equal(h.quest.getStage(p), 12);
  }
});

test("AFL keeps its line hooks when The Corsair Curse's line handler runs after it", () => {
  const { h, p } = afl();
  require('../plugins/quests/quests/CorsairCurse.Quest')(h.api);
  const quest = runtime.getRegisteredQuests().find(q => q.key === 'at_first_light');
  quest.setStage(p, 1);
  const line = h.line(p, N.GUILD_SCRIBE_VERITY, "If anyone did, it would've been Wolf. She's always getting Fox into some kind of trouble.");
  line.before(); assert.equal(quest.getStage(p), 2);
});

// ---------------------------------------------------------------------------
// Twilight's Promise (RSProx 1695, ticks 400-2423)
// ---------------------------------------------------------------------------
function tp() {
  const h = harness('TwilightPromise'), p = player();
  (h.events['quest:is-complete'] ??= []).push(event => { if (event.key === 'children_of_the_sun') event.complete = true; });
  (h.events['quest:is-started'] ??= []).push(event => { if (event.key === 'the_heart_of_darkness') event.started = false; });
  return { h, p };
}
const mockNpc = (id, x, y) => ({ getId: () => id, getLocation: () => new core.Location(x, y, 0), isRegistered: () => true, performAnimation: noop, forceChat: noop });
function tpTalk(h, p, npcId, npc = null) {
  const variant = (h.hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player: p, npcId, npc })).find(Boolean);
  assert.ok(variant, `no variant for ${npcId}`);
  runtime.startTranscript(h.api, p, npcId, h.quest.name, variant, null, npc);
  return variant;
}
const finish = (h, p) => { h.continueUntil(p, () => !p.manager.getCurrent() && !p.prompt); };
const lastBox = (p) => p.log.filter(row => row[0] === 'sendItemOnInterfaces').at(-1);

test('TP: the twins start it (2) and point to the temple (4); Metzli moves it to 6 and 8; the crypt to 10 and 12', () => {
  const { h, p } = tp();
  tpTalk(h, p, N.ENNIUS_TULLUS_2); continueToMenu(h, p); assert.equal(p.prompt.title, "Start the Twilight's Promise quest?");
  h.choose(p, 'Yes.'); assert.equal(h.quest.getStage(p), 2);
  assert.ok(p.messages.includes("You've started a new quest: <col=081190>Twilight's Promise</col>"));
  h.continueUntil(p, () => p.text === 'Where do I find this temple?'); assert.equal(h.quest.getStage(p), 2);
  p.manager.advance(); assert.equal(p.text, 'On the other side of the bazaar, south of here.'); assert.equal(h.quest.getStage(p), 4);
  finish(h, p);
  const metzli = mockNpc(13376, 1698, 3088);
  tpTalk(h, p, N.METZLI_TEOKAN_OF_RANUL, metzli);
  h.continueUntil(p, () => p.text.startsWith('Yes. As Teokan of Ranul')); assert.equal(h.quest.getStage(p), 6);
  continueToMenu(h, p); h.choose(p, "I'm meant to be meeting Prince Itzla here.");
  h.continueUntil(p, () => p.text.startsWith('Yes you are.')); assert.equal(h.quest.getStage(p), 8);
  p.manager.reset(); p.prompt = null;
  const prince = mockNpc(13378, 1683, 9515);
  tpTalk(h, p, N.PRINCE_ITZLA_ARKAN_3, prince);
  h.continueUntil(p, () => p.text.startsWith("You're quite right, of course.")); assert.equal(h.quest.getStage(p), 10);
  h.continueUntil(p, () => p.text.startsWith('Then it sounds like we')); assert.equal(h.quest.getStage(p), 12);
});

test('TP: Furia hands over the crest in its item box (14), showing the crest box to each group of knights', () => {
  const { h, p } = tp(); h.quest.setStage(p, 12);
  tpTalk(h, p, N.FURIA_TULLUS_2);
  h.continueUntil(p, () => p.text === 'Furia gives you a crest.');
  assert.equal(lastBox(p)[2], I.VARLAMORE_CREST); assert.equal(p.items.get(I.VARLAMORE_CREST), 1);
  assert.equal(h.quest.getStage(p), 14); assert.equal(p.varbits.get(9833), 1); assert.equal(p.varbits.get(9834), 1);
  p.manager.reset(); p.prompt = null;
  tpTalk(h, p, N.KNIGHT_OF_VARLAMORE_9);
  h.continueUntil(p, () => p.text === 'You show the crest to the knights.'); assert.equal(lastBox(p)[2], I.VARLAMORE_CREST);
  h.continueUntil(p, () => p.text.startsWith('Well this doesn')); assert.equal(p.varbits.get(9829), 1);
});

test('TP bazaar: the man in blue gives up the amulet a tick after the attempt (2); handing it in makes 3 and 16', () => {
  const { h, p } = tp(); h.quest.setStage(p, 14); p.attrs.set('quest.twilights_promise.recruits', 1);
  const event = { player: p, npcId: N.CITIZEN_27, npc: mockNpc(13399, 1686, 3108) };
  assert.equal(h.namedNpcs.get('Citizen').Pickpocket(event), true);
  assert.deepEqual(p.messages, ["You attempt to pick the man's pocket."]);
  h.tick(1); assert.equal(p.messages.at(-1), "You pick the man's pocket and find the stolen amulet.");
  assert.equal(p.text, "You pick the man's pocket and find the stolen amulet."); assert.equal(lastBox(p)[2], I.STOLEN_AMULET);
  assert.equal(p.items.get(I.STOLEN_AMULET), 1); assert.equal(p.varbits.get(9829), 2);
  p.manager.reset();
  tpTalk(h, p, N.KNIGHT_OF_VARLAMORE_9);
  h.continueUntil(p, () => p.text === 'You give the amulet to the knights.');
  assert.equal(p.items.get(I.STOLEN_AMULET), 0); assert.equal(p.varbits.get(9829), 3); assert.equal(h.quest.getStage(p), 16);
});

test("TP cothon: only the crate at 1778,3149 holds the weapons, in the capture's two-item box", () => {
  const { h, p } = tp(); h.quest.setStage(p, 14); p.attrs.set('quest.twilights_promise.recruits', 1 << 2);
  const search = (x, y, id = 50870) => { p.manager.reset(); h.namedObjects.get(id === 50870 ? 'Crate' : 'Crates').Search({ player: p, definition: { id }, objectId: id, location: { x, y, z: 0 } }); };
  search(1738, 3130); assert.equal(p.messages.at(-1), "You search the crate, but you don't find the weapons you're looking for.");
  search(1778, 3149); assert.ok(p.log.some(row => row[0] === 'text' && /full of weapons/.test(row[2])));
  const box = p.log.filter(row => row[0] === 'sendItemOnInterfaces').slice(-2).map(row => row[2]);
  assert.deepEqual(box, [1279, 1311]); assert.equal(p.varbits.get(9830), 2);
  p.manager.reset(); tpTalk(h, p, N.KNIGHT_OF_VARLAMORE_13);
  h.continueUntil(p, () => p.text === 'Great!'); assert.equal(p.varbits.get(9830), 3); assert.equal(h.quest.getStage(p), 16);
});

test('TP pub: Azali follows (9834=2) and the fountain scene sobers her (pub 2, 9834=3); her answer makes 3', () => {
  const { h, p } = tp(); h.quest.setStage(p, 14); p.items.set(I.VARLAMORE_CREST, 1);
  tpTalk(h, p, N.KNIGHT_OF_VARLAMORE_15);
  h.continueUntil(p, () => p.text.startsWith('Ohh...'));
  assert.equal(p.varbits.get(9831), 1); assert.equal(p.varbits.get(9834), 2);
  const azali = h.npcs.find(npc => npc.id === 13393); assert.ok(azali); assert.equal(azali.following, p);
  assert.deepEqual([azali.x, azali.y], [1721, 3075]);
  finish(h, p);
  at(p, 1756, 3070); azali.moveTo(new core.Location(1755, 3069, 0));
  h.hooks.onPlayerProcess.forEach(fn => fn({ player: p }));
  assert.ok(azali.removed); h.tick(2);
  const actors = h.npcs.filter(npc => !npc.removed).map(npc => npc.id);
  assert.ok(actors.includes(12913) && actors.includes(12930));
  h.tick(1); assert.ok(p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === 1760 && row[2] === 3060 && row[3] === 650));
  h.tick(6); assert.ok(h.npcs.find(npc => npc.id === 12930).animations.includes(10942));
  h.tick(8); assert.equal(p.varbits.get(9831), 2); assert.equal(p.varbits.get(9834), 3);
  h.tick(6); assert.equal(p.text, 'Oh boy...');
  h.continueUntil(p, () => p.text.startsWith('This day is the worst')); assert.equal(p.varbits.get(9831), 3); assert.equal(h.quest.getStage(p), 16);
});

test('TP Mezan prays against a style used four times, falls without dying and answers in the lobby', () => {
  const { h, p } = tp(); h.quest.setStage(p, 14); p.attrs.set('quest.twilights_promise.recruits', 1 << 6);
  tpTalk(h, p, N.KNIGHT_OF_VARLAMORE_21); continueToMenu(h, p); h.choose(p, "I'm ready. Let's do this.");
  h.continueUntil(p, () => p.text === 'Kuani!'); p.manager.advance(); h.tick(2);
  const mezan = h.npcs.find(npc => npc.id === 12916 && !npc.removed); assert.ok(mezan);
  const prayers = []; Object.assign(mezan, { getPrayerActive: () => prayers, setPrayerActive: (id, on) => { prayers[id] = on; }, getHeadIcon: () => mezan.icon ?? -1, setHeadIcon: icon => { mezan.icon = icon; } });
  const hit = (type) => { const parts = [{ damage: 5, setDamage(v) { this.damage = v; } }]; return { getCombatType: () => type, getHits: () => parts, updateTotalDamage: noop, parts }; };
  for (let i = 0; i < 4; i++) h.hooks.onPlayerDealtDamage.forEach(fn => fn({ player: p, target: mezan, hit: hit(core.CombatType.MELEE) }));
  h.tick(1); assert.equal(mezan.__tpProtecting, 'melee'); assert.ok(['Ralos will defend me!', "Ralos' light protects me!", 'Shield me, Ralos!'].includes(mezan.said));
  const blocked = hit(core.CombatType.MELEE); h.hooks.onNpcHitModify.forEach(fn => fn({ npc: mezan, hit: blocked })); assert.equal(blocked.parts[0].damage, 0);
  const event = { npc: mezan, preventDeath: false }; h.hooks.onNpcBeforeDeath.forEach(fn => fn(event)); assert.equal(event.preventDeath, true);
  h.tick(2); assert.equal(p.varbits.get(9832), 2);
  h.tick(6); assert.match(p.text, /^You fought well in there/);
  h.continueUntil(p, () => p.text === 'Perfect! Thanks.'); assert.equal(p.varbits.get(9832), 3); assert.equal(h.quest.getStage(p), 16);
});

test('TP judgement: the crest goes back (24), the letter (26) and its paper (28), then the verdict (30, 32) and Regulus (34)', () => {
  const { h, p } = tp(); h.quest.setStage(p, 22); p.items.set(I.VARLAMORE_CREST, 1);
  tpTalk(h, p, N.FURIA_TULLUS_2); h.continueUntil(p, () => p.text === "We'll keep the knights busy until you're done.");
  assert.equal(h.quest.getStage(p), 24); assert.equal(p.items.get(I.VARLAMORE_CREST), 0); assert.equal(p.varbits.get(11123), 1); assert.equal(p.varbits.get(9834), 0);
  finish(h, p); p.attrs.set('quest.twilights_promise.letter-chest', 50866);
  const chest = (id) => ({ getLocation: () => new core.Location(1648, 3142, 2), getType: () => 10, getFace: () => 0, getId: () => id });
  h.namedObjects.get('Chest').Open({ player: p, definition: { id: 50865 }, objectId: 50865, object: chest(50865) });
  assert.equal(p.messages.at(-1), 'You search the chest, but find nothing of interest.');
  h.namedObjects.get('Chest').Open({ player: p, definition: { id: 50866 }, objectId: 50866, object: chest(50866) });
  assert.equal(p.text, 'You search the chest and find a letter inside.'); assert.equal(lastBox(p)[2], I.INCRIMINATING_LETTER);
  assert.equal(h.quest.getStage(p), 26); assert.ok(p.log.some(row => row[0] === 'sendObject' && row[1].getId() === 50869));
  finish(h, p);
  h.itemActions.get('Incriminating letter').Read({ player: p });
  assert.ok(p.log.some(row => row[0] === 'text' && row[2] === 'Velam,')); assert.equal(h.quest.getStage(p), 28);
  tpTalk(h, p, N.ENNIUS_TULLUS_2); h.continueUntil(p, () => p.text.startsWith('Then it sounds like Velam')); assert.equal(h.quest.getStage(p), 30);
  p.manager.advance(); h.tick(2);
  const live = () => h.npcs.filter(npc => !npc.removed).map(npc => npc.id);
  for (const id of [12903, 12905, 12907, 12909, 12911, 12915, 12891, 12893]) assert.ok(live().includes(id), `actor ${id}`);
  h.tick(6); assert.equal(p.text, ''); h.tick(1); assert.equal(p.text, 'Velam, step forward.');
  p.manager.advance(); h.tick(3); assert.match(p.text, /found to be a traitor/);
  h.continueUntil(p, () => p.text === "For you, this is the only thing that's right."); p.manager.advance();
  h.tick(1); assert.ok(h.npcs.find(npc => npc.id === 12909).animations.includes(836));
  h.tick(6); assert.equal(p.text, 'The rest of you are dismissed.');
  p.manager.advance(); h.tick(3); assert.equal(h.quest.getStage(p), 32); assert.equal(p.items.get(I.INCRIMINATING_LETTER), 0);
  h.tick(6); assert.equal(p.text, 'You killed him!'); assert.ok(!live().includes(12893));
  h.continueUntil(p, () => p.text.startsWith('You should not waste time')); assert.equal(h.quest.getStage(p), 34);
});

test('TP Regulus hands over the feed (36); Renu eats for nine ticks (38), then the quetzal map opens', () => {
  const { h, p } = tp(); h.quest.setStage(p, 34);
  const quetzal = []; for (const name of ['quetzal:introduce', 'quetzal:unlock', 'quetzal:open']) (h.events[name] ??= []).push(() => quetzal.push(name));
  tpTalk(h, p, N.REGULUS_CENTO_3); continueToMenu(h, p); h.choose(p, 'I was told to ask you about getting to the Teomat.');
  h.continueUntil(p, () => p.text === 'Renu perks up at the sound of her name.');
  h.continueUntil(p, () => p.text === 'Regulus gives you some quetzal feed.'); assert.equal(lastBox(p)[2], I.QUETZAL_FEED);
  assert.equal(h.quest.getStage(p), 36); assert.equal(p.items.get(I.QUETZAL_FEED), 1); assert.deepEqual(quetzal, ['quetzal:introduce']);
  finish(h, p);
  const renu = mockNpc(13355, 1696, 3141);
  h.namedNpcs.get('Renu').Feed({ player: p, npcId: N.RENU_2, npc: renu });
  assert.equal(p.text, 'Hello, Renu. I have something for you here.'); p.manager.advance();
  assert.ok(p.animations.includes(10939)); h.tick(8); assert.equal(h.quest.getStage(p), 36);
  h.tick(1); assert.equal(h.quest.getStage(p), 38); assert.equal(p.items.get(I.QUETZAL_FEED), 0);
  assert.equal(p.text, 'Renu eagerly takes the feed from you.'); assert.deepEqual(quetzal, ['quetzal:introduce', 'quetzal:unlock']);
  h.continueUntil(p, () => p.text === "Kuani! I reckon she'll let you ride her now."); p.manager.advance();
  assert.deepEqual(quetzal.at(-1), 'quetzal:open');
});

test('TP Teomat: Itzla (40, 42), Metzli and the attack (44), eight cultists (46), the guard (48) and completion', () => {
  const { h, p } = tp(); h.quest.setStage(p, 38);
  h.events['npc-dialogue:line'].unshift(event => { event.text = event.text.replaceAll('[player name]', p.getUsername()); });
  const itzla = mockNpc(13379, 1454, 3173);
  tpTalk(h, p, N.PRINCE_ITZLA_ARKAN_3, itzla);
  h.continueUntil(p, () => /^Now, Parity, did your/.test(p.text)); assert.equal(h.quest.getStage(p), 40);
  h.continueUntil(p, () => p.text === "Right, I'll go and see if she can help me."); assert.equal(h.quest.getStage(p), 42);
  finish(h, p);
  tpTalk(h, p, N.METZLI_TEOKAN_OF_RANUL, mockNpc(13377, 1451, 3194));
  h.continueUntil(p, () => p.text === "I guess I'd better..."); assert.equal(h.quest.getStage(p), 44);
  h.continueUntil(p, () => /I need you outside, now!/.test(p.text)); p.manager.advance(); h.tick(2);
  const cultists = h.npcs.filter(npc => !npc.removed && npc.id >= 12918 && npc.id <= 12923);
  assert.equal(cultists.length, 8); h.tick(1); assert.equal(cultists.find(npc => npc.id === 12918).target, p);
  for (const npc of cultists) h.hooks.onNpcDeath.forEach(fn => fn({ npc, npcId: npc.id, killer: p }));
  assert.equal(p.messages.at(-1), 'Enemies Defeated: 8/8');
  h.tick(3); assert.equal(h.quest.getStage(p), 46); assert.equal(p.varbits.get(11123), 2);
  h.tick(8); assert.equal(p.text, 'What happened?!');
  h.continueUntil(p, () => p.text === "Of course, my Prince. We'll go at once."); p.manager.advance();
  assert.equal(h.quest.getStage(p), 48); assert.equal(p.varbits.get(11123), 1);
  h.tick(6); assert.equal(p.text, 'Well... this has been a bit of a mess.');
  h.continueUntil(p, () => p.text.startsWith("However, let's not worry")); assert.equal(h.quest.getStage(p), 50);
  assert.ok(p.messages.includes("Congratulations, you've completed a quest: <col=081190>Twilight's Promise</col>"));
  assert.deepEqual(p.xp, [[core.Skill.THIEVING.getIndex(), 3000]]);
});

test('TP old saves map once to the captured stages', () => {
  const h = harness('TwilightPromise');
  const old = (stage, flags = 0) => { const p = player(); p.attrs.set('quest.twilights_promise.stage', stage); p.attrs.set('quest.twilights_promise.flags', flags); h.emit('player:bootstrap-complete', { player: p }); return h.quest.getStage(p); };
  assert.equal(old(4), 6); assert.equal(old(10), 12); assert.equal(old(26), 26); assert.equal(old(26, 1), 28);
  assert.equal(old(28), 30); assert.equal(old(30), 32); assert.equal(old(32), 34); assert.equal(old(40), 38); assert.equal(old(44), 44);
});

// The Heart of Darkness: actual transcript choices, lock input and recoverable encounters.
function hod() {
  const h = harness('TheHeartOfDarkness'), p = player();
  require('../plugins/skills/agility/ObstacleRunner.Agility').init(h.api);
  (h.events['quest:is-complete'] ??= []).push(event => { if (event.key === 'twilights_promise') event.complete = true; });
  const action = (name, option, id, extra = {}) => h.namedObjects.get(name)[option]({ player: p, objectId: id, definition: { id }, ...extra });
  const talk = id => tpTalk(h, p, id);
  const enterTower = value => { h.quest.setStage(p, value); const event = { player: p, objectId: 54369 }; h.emit('ladders:climb', event); assert.equal(event.handled, true); h.tick(4); };
  return { h, p, action, talk, enterTower };
}

test('HOD start, Queen, room payment and sleep follow the captured checkpoints and cannot rent without coins', () => {
  const { h, p, talk, action } = hod();
  talk(12896); continueToMenu(h, p); h.choose(p, 'Yes.');
  assert.equal(h.quest.getStage(p), 2);
  h.continueUntil(p, () => p.text === 'Ah... This should be fun.'); assert.equal(h.quest.getStage(p), 4);
  p.manager.advance(); h.tick(12); assert.equal(p.text, 'Mother.');
  h.continueUntil(p, () => p.text === 'Yes, my Queen. May the sun light your way.'); p.manager.advance();
  assert.equal(h.quest.getStage(p), 6); h.tick(7);
  h.continueUntil(p, () => p.text.startsWith('One of the only people')); assert.equal(h.quest.getStage(p), 8);
  finish(h, p); talk(14020); continueToMenu(h, p); h.choose(p, "I'd like to rent the basement room.");
  finish(h, p); assert.equal(h.quest.getStage(p), 10); assert.equal(p.items.get(I.COINS), undefined);
  p.items.set(I.COINS, 30); talk(14020); continueToMenu(h, p); h.choose(p, "I'd like to rent the basement room."); continueToMenu(h, p); h.choose(p, "I'll take it.");
  h.continueUntil(p, () => h.quest.getStage(p) === 12);
  assert.equal(h.quest.getStage(p), 12); assert.equal(p.items.get(I.COINS), 0);
  finish(h, p); action('Bed', 'Rest', 55374); h.continueUntil(p, () => /quickly fall asleep/.test(p.text));
  h.tick(4); assert.equal(h.quest.getStage(p), 14); h.tick(2);
  h.continueUntil(p, () => p.text.startsWith('Exactly! Return to me')); assert.equal(h.quest.getStage(p), 16);
  p.manager.advance(); assert.equal(h.quest.getStage(p), 18);
});

test('HOD reclaims only missing robes when other pieces are equipped', () => {
  const { h, p, action } = hod(); h.quest.setStage(p, 50);
  p.equipment = [29868,29870,29872].map(id => new core.Item(id));
  action('Chest', 'Open', 54515); h.tick(1); finish(h, p);
  assert.equal(p.items.get(29874), 1);
  for (const id of [29868,29870,29872]) assert.equal(p.items.get(id), undefined);
});

test('HOD first trial uses the cache letter wheels and ordered direction lock, handles a full bag and recovers the saved puzzle', () => {
  const { h, p, action, enterTower } = hod(); enterTower(30); finish(h, p);
  h.namedNpcs.get('Emissary Ascended').Pickpocket({ player: p, npcId: 13767 }); h.tick(1);
  assert.equal(p.items.get(29877), 1);
  h.hooks.onItemOnObject.forEach(fn => fn({ player: p, itemId: 29877, objectId: 55354 }));
  assert.equal(p.varbits.get(11165), 1); assert.equal(p.items.get(29877), 0);
  const gate = new core.GameObject(55354, new core.Location(1644,3220,1), 0, 1);
  p.moveTo(new core.Location(1644,3221,1));
  h.emit('door:toggle', { player: p, objectId: 55354, object: gate }); h.tick(8);
  assert.equal(p.getLocation().getY(), 3220);
  p.full = true; action('Chest', 'Open', 54372); assert.equal(p.items.get(29878), undefined);
  p.full = false; action('Chest', 'Open', 54372); assert.equal(p.items.get(29878), 1);
  const data = p.attrs.get('the-heart-of-darkness:tower');
  action('Chest', 'Open', 54376); const wrong = p.amountAction; wrong.execute(-1); assert.equal(p.varbits.get(11166), 0);
  action('Chest', 'Open', 54376);
  const code = Number(data.letters.split('').map((letter, i) => core.CacheDefinitions.getDbRow(3698 + i).columns.get(0).indexOf(letter)).join('') + '00');
  p.amountAction.execute(code); assert.equal(p.items.get(29879), 1); assert.equal(p.varbits.get(11166), 1);
  action('Chest', 'Open', 54374); p.amountAction.execute(data.directions.reduce((sum, dir, i) => sum + dir * 4 ** i, 0) * 10 + 4);
  assert.equal(p.items.get(29882), 1);
  h.itemActions.get('Scrap of paper').Inspect({ player: p, itemId: 29880 }); assert.equal(p.items.get(29883), 1);
  for (const id of [29880, 29881, 29882]) assert.equal(p.items.get(id), 0);
  p.manager.reset(); p.prompt = null;
  h.namedNpcs.get('Forebearer Janus')['Talk-to']({ player: p, npcId: 13766 }); continueToMenu(h, p); h.choose(p, 'About that passphrase...'); continueToMenu(h, p);
  for (const word of data.phrase) h.choose(p, word + '.');
  assert.equal(h.quest.getStage(p), 34);
  p.manager.reset(); p.prompt = null;
  h.namedNpcs.get('Forebearer Janus')['Talk-to']({ player: p, npcId: 13766 }); continueToMenu(h, p); h.choose(p, 'Yes.');
  h.continueUntil(p, () => p.text.startsWith('Welcome to your next trial.')); p.manager.advance(); h.tick(4);
  assert.equal(h.quest.getStage(p), 36);
  h.hooks.onPlayerLogout.forEach(fn => fn({ player: p }));
  assert.equal(p.getLocation().getZ(), 0); assert.deepEqual(p.attrs.get('the-heart-of-darkness:tower').phrase, data.phrase);
});

test('HOD second trial has four waves, finite medical boxes, companion healing and failure recovery', () => {
  const { h, p, action, enterTower } = hod(); enterTower(36); p.manager.reset();
  const itzla = h.npcs.find(npc => npc.id === 13771 && !npc.removed);
  const medical = { getId: () => 54378, getLocation: () => new core.Location(1645, 3218, 2) };
  for (let i = 0; i < 6; i++) action('Medical box', 'Take-from', 54378, { object: medical });
  assert.equal(p.items.get(29884), 5);
  h.hooks.onItemOnNpc.forEach(fn => fn({ player: p, itemId: 29884, target: itzla }));
  assert.equal(itzla.hitpoints, 118); assert.equal(p.items.get(29884), 4);
  p.heal = amount => { p.healed = amount; };
  h.itemActions.get('Bandages').Heal({ player: p, itemId: 29884 });
  assert.equal(p.healed, 12); assert.equal(p.items.get(29884), 3);
  const otherBox = { getId: () => 54378, getLocation: () => new core.Location(1645, 3219, 2) };
  action('Medical box', 'Take-many', 54378, { object: otherBox }); p.amountAction.execute(-1);
  assert.equal(p.items.get(29884), 3); p.amountAction.execute(99);
  assert.equal(p.items.get(29884), 8);
  h.namedNpcs.get('Prince Itzla Arkan').Heal({ player: p, npc: itzla });
  assert.equal(itzla.hitpoints, 136); assert.equal(p.items.get(29884), 7);

  const line = h.line(p, 13766, 'Then let the trial commence.'); line.after(); h.tick(3);
  let defeated = 0;
  for (let wave = 0; wave < 4; wave++) {
    for (let pair = 0; pair < (wave === 3 ? 1 : 2); pair++) {
      const fighters = h.npcs.filter(npc => npc.__hodTrial && !npc.__hodDefeated);
      assert.equal(fighters.length, wave === 3 ? 4 : 2);
      if (wave === 3) assert.deepEqual(fighters.map(npc => [npc.x,npc.y]), [[1637,3217],[1636,3218],[1636,3225],[1637,3226]]);
      for (const npc of fighters) { const event = { npc }; h.hooks.onNpcBeforeDeath.forEach(fn => fn(event)); assert.equal(event.preventDeath, true); defeated++; }
    }
    h.tick(6);
  }
  assert.equal(defeated, 16); assert.equal(h.quest.getStage(p), 38);
  h.hooks.onPlayerLogout.forEach(fn => fn({ player: p })); enterTower(36); p.manager.reset();
  h.line(p, 13766, 'Then let the trial commence.').after();
  const companion = h.npcs.find(npc => npc.__hodCompanion && !npc.removed);
  const event = { npc: companion }; h.hooks.onNpcBeforeDeath.forEach(fn => fn(event));
  assert.equal(event.preventDeath, true); assert.equal(p.varbits.get(11133), 1); assert.equal(p.getLocation().getZ(), 0);
  assert.equal(h.quest.getStage(p), 36);
});

test('HOD the third trial exposes the random traitor and the final duel yields without killing Itzla', () => {
  const { h, p, enterTower } = hod(); enterTower(38); p.manager.reset();
  h.namedNpcs.get('Forebearer Janus')['Talk-to']({ player: p, npcId: 13766 }); continueToMenu(h, p); h.choose(p, 'Yes.');
  h.continueUntil(p, () => p.text.startsWith('Welcome to your third trial.')); p.manager.advance(); h.tick(4);
  assert.equal(h.quest.getStage(p), 40);
  assert.equal(h.npcs.filter(npc => npc.id >= 13780 && npc.id <= 13783 && !npc.removed).length, 4);
  finish(h, p);
  const data = p.attrs.get('the-heart-of-darkness:tower');
  const names = ['Tenoch','Silia','Adrius','Eleuia'];
  h.namedNpcs.get(names[data.traitor]).Choose({ player: p, npcId: 13780 + data.traitor });
  h.choose(p, 'Yes.'); h.continueUntil(p, () => h.quest.getStage(p) === 42); finish(h, p);
  h.namedNpcs.get('Forebearer Janus')['Talk-to']({ player: p, npcId: 13766 }); continueToMenu(h, p); h.choose(p, 'Yes.');
  h.continueUntil(p, () => p.text === 'Ready yourselves! May the best warrior win!'); p.manager.advance();
  assert.equal(h.quest.getStage(p), 44);
  const opponent = h.npcs.find(npc => npc.id === 13784 && !npc.removed); assert.ok(opponent); assert.equal(opponent.target, p);
  const event = { npc: opponent }; h.hooks.onNpcBeforeDeath.forEach(fn => fn(event));
  assert.equal(event.preventDeath, true); assert.equal(opponent.transformed, 13785); assert.equal(h.quest.getStage(p), 46);
  h.tick(2); finish(h, p); assert.equal(p.getLocation().getZ(), 0);
});

test('HOD the strong brawler warns on every third swing and its slam can be dodged', () => {
  const { h, p, enterTower } = hod(); enterTower(36); p.manager.reset();
  h.line(p, 13766, 'Then let the trial commence.').after(); h.tick(3);
  const npc = h.npcs.find(npc => npc.__hodTrial), scene = npc.__hodTrial;
  const Brawler = h.hooks.registerNpcCombatMethodProvider.find(ctor => ctor.name === 'BrawlerCombat');
  npc.__hodSwings = 2; scene.itzla.isRegistered = () => false;
  p.moveTo(new core.Location(npc.getLocation().getX(), npc.getLocation().getY() + 1, 2));
  assert.deepEqual(new Brawler().hits(npc, p), []); assert.ok(npc.animations.includes(11556));
  assert.ok(p.log.some(row => row[0] === 'sendGraphic'));
  p.moveTo(new core.Location(npc.getLocation().getX(), npc.getLocation().getY() + 3, 2));
  h.tick(3); assert.equal(p.damage, undefined);
});

test('HOD ruins require all levers and icons in the random mural order, then award Servius rewards once', () => {
  const { h, p, action } = hod(); h.quest.setStage(p, 62);
  for (const id of [55365, 55366, 55367]) action('Lever', 'Pull', id);
  assert.equal(h.quest.getStage(p), 62); action('Lever', 'Pull', 55368); assert.equal(h.quest.getStage(p), 64);
  const data = p.attrs.get('the-heart-of-darkness:ruins');
  action('Markings', 'Inspect', 55361);
  assert.equal(p.text, `The mural depicts fire. The word '${['Zema', 'Oma', 'Yeya', 'Naui'][data.order.indexOf(0)]}' is carved into it.`);
  p.manager.reset();
  action('Broken statue', 'Inspect', 54459);
  assert.ok(p.text.startsWith('The statue has a fire symbol at the base.'));
  p.manager.reset();
  for (const [i, id] of [55356, 55357, 55358, 55359].entries()) {
    if (i === data.intact) continue;
    action('Urn', 'Search', id);
    const icon = [29885, 29888, 29887, 29886][i];
    h.hooks.onItemOnObject.forEach(fn => fn({ player: p, itemId: icon, objectId: [54459, 54465, 54471, 54477][i] }));
    assert.equal(p.items.get(icon), 0);
  }
  for (const i of [...data.order].reverse()) action('Statue', 'Touch', [54459, 54465, 54471, 54477][i]);
  assert.equal(h.quest.getStage(p), 64); assert.ok(p.damage);
  for (const i of data.order) action('Statue', 'Touch', [54459, 54465, 54471, 54477][i]);
  assert.equal(h.quest.getStage(p), 68);
  h.quest.setStage(p, 74); p.manager.reset();
  h.namedNpcs.get('Servius, Teokan of Ralos')['Talk-to']({ player: p, npcId: 13694 });
  h.continueUntil(p, () => p.text === 'Timoiva, my child, and may the sun light your way.'); assert.equal(h.quest.getStage(p), 74);
  p.manager.advance(); assert.equal(h.quest.getStage(p), 76); assert.equal(p.xp.length, 4);
  assert.ok(p.xp.every(([, xp]) => xp === 8000));
  h.quest.complete(p); assert.equal(p.xp.length, 4);
});

test('HOD the private ruins restore their mining blockage and damaging traps on relog', () => {
  const { h, p } = hod(); p.attrs.set('the-heart-of-darkness:stage-version', 1);
  h.quest.setStage(p, 58); p.moveTo(new core.Location(1693, 9633, 2));
  h.emit('player:bootstrap-complete', { player: p });
  assert.ok(h.objects.some(object => object.getId() === 54501 && object.getPrivateArea() === p.getArea()));
  h.namedObjects.get('Barrel')['Take-pickaxe']({ player: p, objectId: 54517 });
  assert.equal(p.items.get(1265), 1);
  h.hooks.onPlayerLogout.forEach(fn => fn({ player: p }));
  h.quest.setStage(p, 62); p.moveTo(new core.Location(1682, 9604, 2));
  p.attrs.get('the-heart-of-darkness:ruins').intact = 1;
  const stunned = []; p.getTimers = () => ({ register: (...args) => stunned.push(args) });
  h.emit('player:bootstrap-complete', { player: p });
  const area = p.getArea(); assert.equal(area.canTeleport(), true);
  for (const id of [54459,54465,54471,54477]) assert.ok(h.objects.some(object => object.getId() === id && object.getType() === 11));
  assert.deepEqual([11124,11127,11125,11126].map(id => p.varbits.get(id)), [0,1,0,0]);
  assert.ok(h.npcs.some(npc => !npc.removed && npc.id === N.FROST_NAGUA_3));
  assert.ok(h.npcs.some(npc => !npc.removed && npc.id === N.FROST_CRAB_2));
  for (let i = 0; i < 3; i++) area.process(p);
  assert.ok(p.damage[0].getDamage() >= 6 && p.damage[0].getDamage() <= 12);
  assert.equal(stunned[0][1], 2);
  h.hooks.onPlayerLogout.forEach(fn => fn({ player: p }));
  assert.equal(p.getArea(), null);
});

test('HOD platforms land on the clicked tile and pulling the shortcut leaves the player downstairs', () => {
  const { h, p, action } = hod(); h.quest.setStage(p, 62);
  p.attrs.set('the-heart-of-darkness:stage-version', 1);
  p.moveTo(new core.Location(1698,9655,1)); h.emit('player:bootstrap-complete', { player: p });
  const route = { player: p, objectId: 54539, object: new core.GameObject(54539,new core.Location(1696,9655,1),10,0), sourceLocation: { x:1698,y:9655,z:1 } };
  h.hooks.onObjectRoute.forEach(fn => fn(route)); assert.deepEqual(route.destination, { x:1698,y:9655,z:1 });
  action('Frozen platform','Jump-to',54539,{ object: new core.GameObject(54539,new core.Location(1696,9655,1),10,0) }); h.tick(4);
  assert.deepEqual([p.getLocation().getX(),p.getLocation().getY()], [1696,9655]);
  p.moveTo(new core.Location(1670,9632,0));
  action('Chain','Pull',55375,{ object: new core.GameObject(55375,new core.Location(1670,9631,0),10,0) }); h.tick(3);
  assert.equal(p.varbits.get(11174), 1); assert.equal(p.getLocation().getZ(), 0);
  action('Chain','Climb-up',55375,{ object: new core.GameObject(55375,new core.Location(1670,9631,0),10,0) }); h.tick(4);
  assert.equal(p.getLocation().getZ(), 2);
});

function doti() {
  const h = harness('DeathOnTheIsle'), p = player();
  p.attrs.set('death-on-the-isle:stage-version', 1);
  (h.events['quest:is-complete'] ??= []).push(event => { if (event.key === 'children_of_the_sun') event.complete = true; });
  const npc = (id, option = 'Talk-to', extra = {}) => {
    const event = { player: p, npcId: id, clickType: 1, definition: { getActions: () => [option] }, ...extra };
    h.hooks.onNpcInteraction.forEach(fn => fn(event)); return event;
  };
  const object = id => {
    const event = { player: p, objectId: id, definition: { id } };
    h.hooks.onObjectInteraction.forEach(fn => fn(event)); return event;
  };
  return { h, p, npc, object };
}

test('DOTI starts at 2, gives the uniform instructions at 4, enters the window at 6 and rejects a full bag', () => {
  const { h, p, npc, object } = doti();
  npc(13818); continueToMenu(h, p); h.choose(p, 'Yes.'); assert.equal(h.quest.getStage(p), 2);
  finish(h, p); assert.equal(h.quest.getStage(p), 4);
  object(54701); assert.equal(h.quest.getStage(p), 6);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [1401, 2967]);
  p.full = true; object(54723); assert.equal(p.items.get(29916), undefined);
  p.full = false; object(54723); assert.equal(p.items.get(29916), 1); assert.equal(p.items.get(29918), 1);
  finish(h, p); npc(13818);
  h.continueUntil(p, () => p.text.startsWith('Just good fortune.')); p.manager.advance();
  assert.equal(h.quest.getStage(p), 6); h.tick(3); assert.equal(h.quest.getStage(p), 8); h.tick(1);
  finish(h, p); assert.equal(h.quest.getStage(p), 10);
});

test('DOTI reports every cellar clue without an incorrect missing-evidence warning', () => {
  const { h, p, npc } = doti(); h.quest.setStage(p, 22);
  for (const key of ['clue.jug','clue.pottery','clue.storage','clue.box','clue.stool','body']) p.attrs.set('quest.death_on_the_isle.' + key, true);
  npc(13834); continueToMenu(h, p); h.choose(p, "I think I've found everything there is to find so far. What now?");
  finish(h, p); assert.equal(h.quest.getStage(p), 26);
  assert.ok(!p.log.some(row => row[0] === 'text' && row[2].includes('Are you sure')));
});

test('DOTI holds and returns the original inventory and equipment with metadata, across login and repeat visits', () => {
  const { h, p } = doti();
  const container = size => {
    let items = Array.from({ length: size }, () => new core.Item(-1, 0));
    return { getItems: () => items, setItems: next => { items = next; }, refreshItems: noop,
      getAmount: id => items.filter(item => item.getId() === id).reduce((n, item) => n + item.getAmount(), 0),
      getFreeSlots: () => items.filter(item => item.getId() < 0).length,
      adds(id, amount) { const i = items.findIndex(item => item.getId() < 0); assert.ok(i >= 0); items[i] = new core.Item(id, amount); },
      deleteNumber(id, amount) { const i = items.findIndex(item => item.getId() === id); assert.ok(i >= 0); items[i] = new core.Item(-1, 0); },
    };
  };
  const inventory = container(28), equipment = container(14);
  inventory.getItems()[8] = new core.Item(995, 12345);
  equipment.getItems()[3] = new core.Item(12926, 1, { charges: 6789 });
  p.getInventory = () => inventory; p.getEquipment = () => equipment;
  h.quest.setStage(p, 12); h.action(p, 13833, '9kVMFj'); h.tick(4);
  assert.equal(h.quest.getStage(p), 14); assert.equal(inventory.getAmount(995), 0);
  assert.ok(p.attrs.get('death-on-the-isle:held-gear'));
  assert.equal(equipment.getItems()[core.Equipment.WEAPON_SLOT].getId(), I.BUTLERS_TRAY_3, 'villa entry equips the captured party tray');
  inventory.adds(29922, 1);
  h.hooks.onPlayerLogout.forEach(fn => fn({ player: p })); h.hooks.onPlayerLogin.forEach(fn => fn({ player: p }));
  h.action(p, 13833, 'GMJFxO'); h.tick(4);
  assert.equal(inventory.getItems()[8].getAmount(), 12345);
  assert.deepEqual(equipment.getItems()[3].meta, { charges: 6789 });
  h.action(p, 13833, '9kVMFj'); h.tick(4); assert.equal(inventory.getAmount(29922), 1);
  h.action(p, 13833, 'GMJFxO'); h.tick(4); assert.equal(inventory.getAmount(995), 12345);
});

test('DOTI backstage requires searching the real bookshelf and discussing every clue', () => {
  const { h, p, npc, object } = doti(); h.quest.setStage(p, 38);
  const key = flag => 'quest.death_on_the_isle.' + flag;
  for (const flag of ['backstage.poison','backstage.clothing','chat.actors','chat.poison','chat.clothing','chat.bookshelf']) p.attrs.set(key(flag), true);
  h.emit('npc-dialogue:choice', { player: p, npcId: 13837, stepId: '4N708L', option: 'Did you know there was a hidden passage in here?' });
  assert.notEqual(p.attrs.get(key('backstage.bookshelf')), true); assert.equal(h.quest.getStage(p), 38);
  object(54726); assert.equal(p.attrs.get(key('backstage.bookshelf')), true); assert.equal(h.quest.getStage(p), 40);
});

test('DOTI backstage bookshelf is a player-scoped stage spawn, not a global object spawn', () => {
  assert.deepEqual(require('../data/definitions/object-spawns.json'), []);
  const { h, p } = doti(); h.quest.setStage(p, 36);
  const shelf = h.objects.find(object => object.getId() === 54734);
  assert.ok(shelf, 'the searchable changing bookshelf appears for this player');
  assert.equal(shelf.getOwner(), p);
  assert.deepEqual([shelf.getLocation().getX(), shelf.getLocation().getY(), shelf.getLocation().getZ()], [1461, 9331, 0]);
  h.quest.setStage(p, 40);
  assert.equal(h.objects.some(object => object.getId() === 54734), false);
  const base = h.objects.find(object => object.getId() === 54735);
  assert.ok(base, 'the cache bookshelf returns once the backstage clue is done');
  assert.equal(base.getOwner(), p);
});

test('DOTI Attack uses the staged combat method and preserves actors through their scripted moves', () => {
  const { h, p } = doti(); h.quest.setStage(p, 40); h.action(p, 13834, 'lPk2UZ');
  const method = h.combatResolvers[0].resolve(p); assert.ok(method);
  for (let i = 0; i < 4; i++) {
    const npc = h.npcs.find(npc => npc.id === 13838 && !npc.removed); assert.ok(npc);
    method.start(p, npc); assert.deepEqual(method.hits(), []); finish(h, p);
    if (i < 3) assert.equal(npc.removed, undefined);
  }
  assert.equal(h.quest.getStage(p), 50);
});

test('DOTI interruption cannot win Adala, and the finale rewards wait for the guards\' final line', () => {
  const { h, p, npc } = doti(); h.quest.setStage(p, 30); p.attrs.set('quest.death_on_the_isle.fight.active', true);
  h.hooks.onPlayerLogin.forEach(fn => fn({ player: p }));
  assert.equal(h.quest.getStage(p), 30); assert.equal(p.attrs.get('quest.death_on_the_isle.fight.outcome'), 0);
  h.quest.setStage(p, 49);
  runtime.startTranscript(h.api, p, 13838, 'Death on the Isle', 'the-stage-attacking-naiatli-again', steps => steps.slice(steps.findIndex(step => step.id === 'wdaiPu') + 1));
  h.continueUntil(p, () => p.text.startsWith('You win some and you lose some I guess.'));
  assert.equal(h.quest.getStage(p), 49); assert.equal(p.xp.length, 0);
  p.manager.advance(); assert.equal(h.quest.getStage(p), 50);
  assert.deepEqual(p.xp.map(([, amount]) => amount), [10000, 7500, 5000]);
  h.quest.complete(p); assert.equal(p.xp.length, 3);
});

test('Quetzals use cache destinations, reject closed or locked map clicks, and finish the captured flight once', () => {
  const h = harness('TwilightPromise'), p = player();
  const plugin = require('../plugins/world/Quetzals.plugin'); plugin.register(h.api);
  h.emit('quetzal:unlock', { player: p });
  const sites = plugin._test.landingSites(), slot = sites.findIndex(site => site.id !== 1 && site.autoUnlocked);
  assert.ok(slot >= 0); const site = sites[slot];
  const click = chosen => plugin._test.chooseSite({ player: p, groupId: 874, childId: 12, slot: chosen });
  click(slot); assert.notEqual(p.blocked, true);
  p.setInterfaceId(874); click(sites.findIndex(site => !site.autoUnlocked)); assert.notEqual(p.blocked, true);
  click(slot); assert.equal(p.blocked, true); click(slot); assert.equal(h.tasks.length, 1);
  h.tick(3); assert.notEqual(p.getLocation().getX(), site.x);
  h.tick(1); assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [site.x, site.y, site.z]);
  h.tick(3); assert.equal(p.blocked, false); assert.equal(p.varbits.get(6719), 0);
  assert.ok(p.log.some(row => row[0] === 'closeSubInterface' && row[1] === ((161 << 16) | 1)));
});

test('Primio opens the canonical first-trip menu and flies both ways only after Children of the Sun', t => {
  // Trusted transcript presentation needs the actual sender/manager owners;
  // the legacy catch-all sender above would silently swallow its callback.
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const frames = [], channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: frame => { frames.push(Buffer.from(frame)); return true; }, close() {}, onData() {}, onError() {}, onClose() {} };
  const h = harness('ChildrenOfTheSun'), p = new Player(new PlayerSession(channel));
  p.setIndex(2900); p.setUsername('PrimioParity'); p.setRegistered(true); p.setLocation(new core.Location(3210, 3220));
  p.manager = p.getDialogueManager(); p.messages = [];
  const sendMessage = p.sendMessage.bind(p);
  p.sendMessage = text => { p.messages.push(text); return sendMessage(text); };
  p.varbits = { get: id => p.getPacketSender().getVarbit(id) };
  Object.defineProperty(p, 'text', { get: () => p.manager.getCurrent()?.getText?.() ?? '' });
  t.after(() => { p.closeInterruptibleInterfaces(); p.setRegistered(false); h.tasks.forEach(task => task.stop()); });
  // This large parity file intentionally registers many copies of each quest
  // in one process; make the public completion query resolve against this
  // test's current Children of the Sun player rather than an older fixture.
  (h.events['quest:is-complete'] ??= []).push(request => {
    if (request.key === 'children_of_the_sun') request.complete = h.quest.isComplete(request.player);
  });
  require('../plugins/world/Quetzals.plugin').register(h.api);
  const starts = [];
  h.events['npc-dialogue:start'] = [event => starts.push(event)];
  const primio = h.namedNpcs.get('Primio').Travel;
  const keeper = h.namedNpcs.get('Regulus Cento').Travel;

  assert.equal(primio({ player: p, npcId: N.PRIMIO_2 }), true);
  assert.equal(h.tasks.length, 0, 'an uncompleted quest cannot start the flight');
  assert.match(p.messages.at(-1), /complete Children of the Sun/i);

  h.quest.complete(p);
  const baselineTasks = h.tasks.length;
  primio({ player: p, npcId: N.PRIMIO_2 });
  assert.equal(p.varbits.get(9652), 2, 'opening the first-journey conversation advances the captured menu state');
  assert.equal(starts.at(-1).npcId, N.REGULUS_CENTO_2);
  assert.equal(starts.at(-1).variant, 'talking-in-varrock-talking-to-take-the-first-trip');
  assert.equal(p.getLocation().getX(), 3210, 'opening the menu does not move the player');

  // Closing/reopening before accepting uses the source's shorter retry menu.
  keeper({ player: p, npcId: N.REGULUS_CENTO_2 });
  assert.equal(starts.at(-1).variant, 'talking-in-varrock-talking-again-before-taking-the-first-trip');
  assert.equal(h.tasks.length, baselineTasks, 'the cancel/reopen path does not launch a flight');

  // Exercise the real resolver on arrival using Fortis's cache ID and the
  // selected tail of the canonical first-trip transcript.
  require('../plugins/npcs/NpcDialogues.plugin').register(h.api);
  h.action(p, N.REGULUS_CENTO_2, 'Kectpl');
  assert.equal(h.tasks.length, baselineTasks + 1, 'the canonical accepted menu action starts the flight');
  h.tick(4);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1697, 3140, 0]);
  assert.equal(p.varbits.get(9650), 1, 'the first arrival records Varlamore visited');
  assert.equal(p.varbits.get(9652), 3, 'the captured first-trip state advances on landing');
  assert.equal(starts.at(-1).npcId, N.REGULUS_CENTO_3);
  assert.equal(starts.at(-1).variant, 'talking-in-varrock-talking-to-take-the-first-trip');
  assert.equal(typeof starts.at(-1).select, 'function', 'arrival resumes from the source transcript after Kectpl');
  h.continueUntil(p, () => p.text.includes('Well, here we are!'), 20);
  assert.match(p.text, /Well, here we are! Welcome to Fortis!/,
    'the registered runner resolves the arrival to the canonical Varrock transcript tail');
  assert.ok(p.manager.getOwner(), 'the trusted arrival uses an actual dialogue owner');
  assert.equal(p.getSession().flushPackets(), true, 'flush the actual session queue to the captured transport');
  assert.ok(frames.some(frame => frame.includes(Buffer.from('Well, here we are! Welcome to Fortis!'))),
    'the actual sender encoded the welcome, rather than a catch-all test double skipping presentation');

  h.tick(3);
  h.continueUntil(p, () => p.varbits.get(9652) === 4, 30);
  assert.equal(p.varbits.get(9652), 4, 'finishing the captured welcome reaches the final first-trip state');

  h.namedNpcs.get('Primio').Travel({ player: p, npcId: N.PRIMIO_3 });
  h.tick(4);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3281, 3413, 0]);
  h.tick(3);
  h.namedNpcs.get('Primio').Travel({ player: p, npcId: N.PRIMIO_2 });
  h.tick(4);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [1697, 3140, 0]);
  assert.equal(p.varbits.get(9652), 4, 'later Fortis trips keep the completed first-trip state');
  assert.equal(starts.length, 3, 'repeat flights do not replay the initial menu or arrival dialogue');
});

// ---------------------------------------------------------------------------
// Children of the Sun - live scene spawns (RSProx 1637)
// ---------------------------------------------------------------------------
function childrenOfTheSun() {
  const h = harness('ChildrenOfTheSun'), p = player();
  return { h, p };
}

test('COTS delegation walks into the square and stops in the captured formation', () => {
  const { h, p } = childrenOfTheSun();
  h.quest.setStage(p, 2);
  const before = h.npcs.length;
  h.action(p, N.ALINA_2, 'wltzqo');
  const spawned = h.npcs.slice(before);
  assert.equal(spawned.length, 10, 'the delegation is ten NPCs, not just a camera move');
  const byId = new Map(spawned.map(npc => [npc.getId(), npc]));
  const origins = [
    [N.PRINCE_ITZLA_ARKAN_2, 3233, 3430],
    [N.SERVIUS_TEOKAN_OF_RALOS, 3233, 3429],
    [N.FURIA_TULLUS, 3234, 3430],
    [N.ENNIUS_TULLUS, 3234, 3429],
    [N.KNIGHT_OF_VARLAMORE_3, 3232, 3430],
    [N.KNIGHT_OF_VARLAMORE_4, 3232, 3429],
    [N.KNIGHT_OF_VARLAMORE_5, 3234, 3430],
    [N.KNIGHT_OF_VARLAMORE_6, 3234, 3429],
    [N.KNIGHT_OF_VARLAMORE_7, 3236, 3430],
    [N.KNIGHT_OF_VARLAMORE_8, 3236, 3429],
  ];
  const stops = [
    [N.PRINCE_ITZLA_ARKAN_2, 3219, 3430],
    [N.SERVIUS_TEOKAN_OF_RALOS, 3219, 3429],
    [N.FURIA_TULLUS, 3220, 3430],
    [N.ENNIUS_TULLUS, 3220, 3429],
    [N.KNIGHT_OF_VARLAMORE_3, 3219, 3431],
    [N.KNIGHT_OF_VARLAMORE_4, 3219, 3428],
    [N.KNIGHT_OF_VARLAMORE_5, 3220, 3431],
    [N.KNIGHT_OF_VARLAMORE_6, 3220, 3428],
    [N.KNIGHT_OF_VARLAMORE_7, 3221, 3430],
    [N.KNIGHT_OF_VARLAMORE_8, 3221, 3429],
  ];
  for (const [id, x, y] of origins) {
    const npc = byId.get(id);
    assert.ok(npc, `delegation member ${id} spawned`);
    assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], [x, y], `delegation ${id} starts at the captured origin`);
    assert.ok(npc.getMovementQueue().hasPendingWork(), `delegation ${id} queues its walk instead of teleporting`);
    assert.equal(npc.scriptedMovement, true, `delegation ${id} keeps the wander coordinator off its route`);
  }
  h.tick(1);
  const itzla = byId.get(N.PRINCE_ITZLA_ARKAN_2);
  assert.deepEqual([itzla.getLocation().getX(), itzla.getLocation().getY()], [3232, 3430], 'the delegation advances one tile per tick');
  h.tick(20);
  for (const [id, x, y] of stops) {
    const npc = byId.get(id);
    assert.ok(npc, `delegation member ${id} spawned`);
    assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], [x, y], `delegation ${id} stop`);
    assert.equal(npc.getMovementQueue().hasPendingWork(), false, `delegation ${id} finished its walk`);
  }
});

test('COTS guards use the captured posts, facings and wander paths', () => {
  const { h, p } = childrenOfTheSun();
  h.quest.setStage(p, 10);
  p.moveTo(new core.Location(3211, 3437, 0));
  h.line(p, N.SERGEANT_TOBYN, 'Right, we can work with that. Now get to it.');
  const guards = h.npcs.filter(npc => [N.GUARD_187, N.GUARD_190, N.GUARD_193, N.GUARD_196,
    N.GUARD_199, N.GUARD_202, N.GUARD_205, N.GUARD_208, N.GUARD_211, N.GUARD_214].includes(npc.getId()));
  assert.equal(guards.length, 10);
  const posts = new Map(guards.map(npc => [npc.getId(), npc]));
  const leaning = posts.get(N.GUARD_196); // 12677, the guard on Lowe's north wall
  assert.deepEqual([leaning.getLocation().getX(), leaning.getLocation().getY()], [3237, 3427]);
  assert.equal(leaning.face, 6, 'leaning guard faces south, away from the wall');
  assert.equal(leaning.wanderRadius, 0, 'the leaning guard stays put');
  const patrol = posts.get(N.GUARD_199);
  assert.ok(patrol.wanderRadius >= 3, 'real guards have a path to walk');
  assert.equal(posts.get(N.GUARD_187).face, 4, 'bandit outside the tent faces east');
  assert.equal(posts.get(N.GUARD_190).face, 7, 'bandit by the news stand faces south-east');
});

test('COTS door scene spawns the waiting bandits inside the house', () => {
  const { h, p } = childrenOfTheSun();
  h.quest.setStage(p, 8);
  const before = h.npcs.length;
  const event = { player: p, objectId: core.ObjectIdentifiers.DOOR_695, location: { x: 3259, y: 3400 }, handled: false };
  h.emit('door:toggle', event);
  assert.equal(event.handled, true);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3263, 3401]);
  const spawned = h.npcs.slice(before);
  assert.equal(spawned.length, 5, 'bag guard and four bandits appear for the eavesdrop');
  assert.deepEqual(spawned.map(npc => npc.getId()).sort(), [N.GUARD_186, N.BANDIT_16, N.BANDIT_17, N.BANDIT_18, N.BANDIT_19].sort());
  assert.deepEqual(spawned.map(npc => [npc.getLocation().getX(), npc.getLocation().getY()]).sort(),
    [[3265, 3403], [3266, 3401], [3266, 3405], [3268, 3402], [3268, 3404]].sort());
});
