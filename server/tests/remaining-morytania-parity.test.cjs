// From server/: node --test tests/remaining-morytania-parity.test.cjs (after yarn build).
// Focused Sins of the Father / Children of the Sun parity checks against the
// RSProx capture 1637.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager: CacheRegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers, N = core.NpcIdentifiers;
const TOME_OF_EXPERIENCE = 24690; // myq5 "Tome of Experience"
let nextIndex = 1;
const noop = () => {};
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  CacheRegionManager.init();
});

function harness(name, page = null, options = {}) {
  const hooks = {}, events = {}, tasks = [], npcs = [], removed = [], objects = [], deregistered = [], worldPlayers = [], areas = [], namedNpcs = new Map(), namedObjects = new Map();
  const api = new Proxy({
    core: {
      ...core,
      World: { ...core.World, getNpcs: () => npcs, getNpcsNear: () => npcs, getPlayers: () => worldPlayers },
      TaskManager: {
        submit(task) { task.setRunning(true); tasks.push(task); },
        cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
      },
      MapObjects: options.realObjects ? core.MapObjects : { get: () => null },
      ObjectManager: options.realObjects ? core.ObjectManager : {
        register(object) { if (!objects.includes(object)) objects.push(object); },
        deregister(object) { deregistered.push(object); const index = objects.indexOf(object); if (index >= 0) objects.splice(index, 1); },
      },
    },
    persistAttribute: noop,
    registerArea: area => areas.push(area),
    onNpcInteraction: (target, actions) => namedNpcs.set(target, actions),
    onObjectInteraction: (target, actions) => { if (typeof target === 'function') (hooks.onObjectInteraction ??= []).push(target); else namedObjects.set(target, actions); },
    onCustomEvent: (key, fn) => (events[key] ??= []).push(fn),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(fn => fn(event)),
    sendMultiChatboxPrompt(p, title, ...pairs) { p.prompt = { title, options: pairs.filter((_, i) => i % 2 === 0), pairs }; return true; },
    spawnNpc(definition) {
      let location = new core.Location(definition.x, definition.y, definition.z), area = null;
      const npc = {
        ...definition, animations: [], graphics: [], getId: () => definition.id, getIndex: () => npc.index,
        index: nextIndex++, getLocation: () => location, moveTo: to => { location = to; },
        getCurrentDefinition: () => core.NpcDefinition.forId(definition.id),
        getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; },
        isVisible: () => true, isOwnerOnly: () => definition.ownerOnly === true,
        isNpc: () => true, isPlayer: () => false,
        getAsNpc: () => npc, isRegistered: () => !npc.removed, getOwner: () => definition.owner,
        setPositionToFace: noop, forceChat: noop, performAnimation: noop, performGraphic: noop,
        getMovementQueue: () => ({ reset() { return this; }, hasPendingWork: () => false, addFirstStep: to => { location = to; } }),
        setNpcTransformationId: id => { npc.transformedId = id; }, setCombatXpMultiplier: noop,
        setHitpoints: hp => { npc.hitpoints = hp; return npc; }, getHitpoints: () => npc.hitpoints ?? 2000,
        getCombat: () => ({ reset: noop }),
      };
      npcs.push(npc);
      return npc;
    },
    removeNpc: npc => { npc.removed = true; removed.push(npc); },
  }, { get: (target, key) => target[key] ?? ((...args) => (hooks[key] ??= []).push(args.find(x => typeof x === 'function'))) });
  require(`../plugins/quests/quests/${name}.Quest`)(api);
  PluginManager.emitNpcDialogueCondition = event => {
    for (const fn of hooks.onNpcDialogueCondition ?? []) {
      const answer = fn(event);
      if (answer !== null && answer !== undefined) return answer;
    }
    return null;
  };
  if (page) {
    (events['npc-dialogue:start'] ??= []).push(request => {
      if (request.handled) return;
      request.handled = runtime.startTranscript(api, request.player, request.npcId, page, request.variant);
    });
  }
  const h = {
    api, hooks, events, tasks, npcs, removed, objects, deregistered, worldPlayers, areas, namedNpcs, namedObjects,
    login(player) { (hooks.onPlayerLogin ?? []).forEach(fn => fn({ player })); },
    logout(player) { (hooks.onPlayerLogout ?? []).forEach(fn => fn({ player })); },
    quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => (events[name] ?? []).forEach(fn => fn(event)),
    action(p, npcId, stepId) {
      const event = { player: p, npcId, stepId };
      h.emit('npc-dialogue:action', event);
      return event;
    },
    talk(p, npcId) {
      const choice = (hooks.onNpcDialogueVariant ?? []).map(fn => fn({ player: p, npcId })).find(Boolean);
      assert.ok(choice, `no variant for ${npcId}`);
      if (h.events['npc-dialogue:start']) {
        const request = { player: p, npcId, variant: typeof choice === 'string' ? choice : choice.variant };
        h.emit('npc-dialogue:start', request);
        assert.ok(request.handled, `variant did not start: ${request.variant}`);
        return;
      }
      runtime.startTranscript(api, p, npcId, h.quest.name, typeof choice === 'string' ? choice : choice.variant);
    },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
    choose(p, text) {
      const prompt = p.prompt;
      assert.ok(prompt, `no menu for ${text}`);
      const index = prompt.options.findIndex(label => label === text);
      assert.ok(index >= 0, `missing ${text} in ${prompt.options}`);
      p.prompt = null;
      prompt.pairs[index * 2 + 1]();
    },
    continueUntil(p, predicate, limit = 200) {
      while (!predicate()) {
        assert.ok(limit-- > 0, `dialogue stalled at ${p.text}`);
        const current = p.manager.getCurrent();
        assert.ok(current, `dialogue ended at ${p.text}`);
        p.manager.advance();
      }
    },
    condition(event) { return PluginManager.emitNpcDialogueCondition(event); },
  };
  return h;
}

function player() {
  const attrs = new Map(), items = new Map(), configs = new Map(), varbits = new Map(), log = [], xp = [];
  let location = new core.Location(3729, 3318, 0), area = null;
  const inv = {
    getAmount: id => items.get(id) ?? 0,
    isFull: () => false,
    getFreeSlots: () => p.free ?? (p.full ? 0 : 28),
    contains: id => (items.get(id) ?? 0) > 0,
    adds(id, amount) { items.set(id, (items.get(id) ?? 0) + amount); if (p.free !== undefined) p.free = Math.max(0, p.free - amount); },
    deleteNumber(id, amount) {
      assert.ok((items.get(id) ?? 0) >= amount, `missing item ${id}`);
      items.set(id, items.get(id) - amount);
      if (p.free !== undefined) p.free += amount;
    },
    get(slot) {
      const entry = [...items.entries()][slot];
      return entry && entry[1] > 0 ? { getId: () => entry[0], getAmount: () => entry[1] } : null;
    },
  };
  const packet = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return packet; },
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendString(text, uid) { if ([6, 3, 2].some(child => [217, 231, 229, 193].some(group => uid === (group << 16 | child)))) p.text = text; log.push(['text', uid, text]); return packet; },
    sendInterfaceRemoval() { p.manager.reset(); p.prompt = null; return packet; },
  }, { get: (t, key) => t[key] ?? ((...args) => { log.push([key, ...args]); return packet; }) });
  const p = {
    attrs, items, configs, varbits, log, xp, messages: [], prompt: null, text: '', index: nextIndex++,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value), getInventory: () => inv,
    getEquipment: () => ({ get: () => p.weapon ? { getId: () => p.weapon } : null, getItems: () => p.equippedItems ?? [] }),
    getBanks: () => p.banks ?? [],
    getBank: () => p.banks?.[0] ?? { getAmount: () => 0 },
    getPacketSender: () => packet, getDialogueManager: () => p.manager, getUpdateFlag: () => ({ flag: noop }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: hits => { p.damage = (p.damage ?? []).concat(hits); } }) }),
    getSkillManager: () => ({
      getMaxLevel: () => p.level ?? 99,
      getCurrentLevel: () => p.level ?? 99,
      addExperience: (skill, amount) => xp.push([skill?.getIndex?.(), amount]),
    }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement: noop }),
    getLocation: () => location, moveTo: to => { location = to; },
    getArea: () => area, getPrivateArea: () => area, setArea: value => { area = value; },
    getIndex: () => p.index, isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p,
    isRegistered: () => true, isPlayerBot: () => false, getUsername: () => 'Parity',
    getAppearance: () => ({ isMale: () => true }), setPositionToFace: noop, forceChat: noop,
    performAnimation: noop, sendMessage: text => p.messages.push(text),
  };
  p.manager = new DialogueManager(p);
  return p;
}

const completeQuests = (h, keys) => (h.events['quest:is-complete'] ??= []).push(event => {
  if (keys.includes(event.key)) event.complete = true;
});

// ---------------------------------------------------------------------------
// Children of the Sun
// ---------------------------------------------------------------------------

test('Children native stages: start, first meeting and 16→18→20→22→24 handoff complete once', () => {
  const h = harness('ChildrenOfTheSun', 'Children of the Sun'), p = player();
  p.moveTo(new core.Location(3225, 3426, 0));
  h.talk(p, N.ALINA);
  h.continueUntil(p, () => Boolean(p.prompt));
  h.choose(p, 'Yes.');
  assert.equal(h.quest.getStage(p), 2, 'accepting Alina starts vmq1 at 2');
  assert.equal(p.varbits.get(9646), 1, 'first Alina meeting sets vmq1_met_alina');

  h.quest.setStage(p, 16);
  h.action(p, N.SERGEANT_TOBYN, 'D5boc3');
  assert.equal(h.quest.getStage(p), 18, 'entering the cell is native stage 18');
  h.action(p, N.SERGEANT_TOBYN, '4aa1xN');
  assert.equal(h.quest.getStage(p), 20, 'leaving the cell is native stage 20');
  p.moveTo(new core.Location(3202, 3473, 2));
  h.action(p, N.SERGEANT_TOBYN, 'VS01WH');
  assert.equal(h.quest.getStage(p), 22, 'Itzla departing is native stage 22');
  const resumed = h.hooks.onNpcDialogueVariant.map(fn => fn({ player: p, npcId: N.SERGEANT_TOBYN })).find(Boolean);
  assert.equal(resumed, 'interrogation-talking-again-after-itzla-departs', 'a relog at 22 resumes the closing roof dialogue');
  h.action(p, N.SERGEANT_TOBYN, '9QLQQG');
  assert.equal(h.quest.getStage(p), 24, 'completion is native stage 24');
  assert.equal(p.varbits.get(9645), 2);
  assert.equal(p.attrs.get('quest.points'), 1);
  const points = p.attrs.get('quest.points');
  h.action(p, N.SERGEANT_TOBYN, '9QLQQG');
  assert.equal(p.attrs.get('quest.points'), points, 'completion rewards are paid once');
});

test('Children tail failure returns to Alina and restarts through the captured variant', () => {
  const h = harness('ChildrenOfTheSun', 'Children of the Sun'), p = player();
  h.quest.setStage(p, 4);
  h.action(p, N.ALINA, 'r2Pt3E');
  assert.equal(h.quest.getStage(p), 6);
  const guard = h.npcs.find(npc => npc.getId() === N.GUARD_185);
  assert.ok(guard, 'the primary bag guard spawns when tailing starts');
  assert.ok(!h.npcs.some(npc => npc.getId() === N.GUARD_186), 'the visible sibling is not spawned');
  for (let i = 0; i < 5; i++) {
    p.moveTo(guard.getLocation());
    h.hooks.onPlayerProcess[0]({ player: p });
  }
  assert.equal(h.quest.getStage(p), 2, 'being spotted aborts the tail');
  assert.equal(p.attrs.get('quest.children_of_the_sun.tail-fail'), 1);
  const choice = h.hooks.onNpcDialogueVariant.map(fn => fn({ player: p, npcId: N.ALINA })).find(Boolean);
  assert.equal(choice, 'investigation-talking-to-noah-or-alina-after-starting-to-tail-the-guard');
});

test('Children marking rejects a wrong guard and completes the set of four bandits only', () => {
  const h = harness('ChildrenOfTheSun', 'Children of the Sun'), p = player();
  h.quest.setStage(p, 12);
  h.hooks.onPlayerLogin[0]({ player: p });
  const mark = (id) => h.namedNpcs.get('Guard').Mark({ player: p, npcId: id });
  mark(N.GUARD_199); // fifth post, one of the real guards
  assert.equal(h.quest.getStage(p), 12);
  assert.equal(p.attrs.get('quest.children_of_the_sun.guards'), 1 << 4);
  assert.equal(p.varbits.get(9637), 2, 'the wrongly marked guard is visibly marked');
  h.namedNpcs.get('Guard').Unmark({ player: p, npcId: N.GUARD_200 });
  for (const id of [N.GUARD_187, N.GUARD_190, N.GUARD_193, N.GUARD_196]) mark(id);
  assert.equal(h.quest.getStage(p), 14, 'four correct marks finish the marking stage');
  assert.equal(p.varbits.get(9637), 0, 'unmarking clears the wrong guard varbit');
});

// ---------------------------------------------------------------------------
// Sins of the Father
// ---------------------------------------------------------------------------

test('Sins uses native myq5 values and Kroy table varbits 1 after death, 2 after smashing', () => {
  const h = harness('SinsOfTheFather'), p = player();
  completeQuests(h, ['taste_of_hope', 'vampyre_slayer']);
  p.moveTo(new core.Location(3729, 3318, 0));
  h.emit('npc-dialogue:choice', { player: p, npcId: N.VELIAF_HURTZ_2, option: 'Yes.' });
  assert.equal(h.quest.getStage(p), 2, 'start message sets myq5=2');
  assert.equal(p.varbits.get(7255), 2);

  h.quest.setStage(p, 18);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(10353), 1, 'both tables read 1 when Kroy is dead');
  assert.equal(p.varbits.get(10354), 1);
  const destroy = (x, y) => h.namedObjects.get('Lab table').Destroy({ player: p, objectId: 37983, location: { x, y, z: 1 } });
  destroy(3729, 9760);
  assert.equal(p.varbits.get(10353), 2, 'a smashed table reads 2');
  assert.equal(h.quest.getStage(p), 18, 'one table is not enough');
  destroy(3725, 9759);
  assert.equal(p.varbits.get(10354), 2);
  assert.equal(h.quest.getStage(p), 20, 'both tables advance myq5 to 20');

  h.quest.setStage(p, 138);
  assert.equal(p.varbits.get(7255), 138, 'completion is native myq5=138');
});

test('Sins disguise condition requires the whole noble set and records Trader Sven', () => {
  const h = harness('SinsOfTheFather'), p = player();
  h.quest.setStage(p, 72);
  const hasDisguise = () => h.condition({ player: p, stepId: 'Y7Eh4F', text: 'If the player has the vyre disguise' });
  const lacksDisguise = () => h.condition({ player: p, stepId: 'CIrOJv', text: 'If the player does not have the vyre disguise' });
  p.items.set(I.VYRE_NOBLE_TOP_UNSCENTED_, 1);
  assert.equal(hasDisguise(), false, 'a single piece is not a disguise');
  assert.equal(lacksDisguise(), true);
  p.items.set(I.VYRE_NOBLE_LEGS_UNSCENTED_, 1);
  p.items.set(I.VYRE_NOBLE_SHOES_UNSCENTED_, 1);
  assert.equal(hasDisguise(), true);
  assert.equal(lacksDisguise(), false);

  assert.notEqual(p.varbits.get(10359), 1);
  h.emit('npc-dialogue:line', { player: p, npcId: N.TRADER_SVEN, text: 'I specifically deal in vyrewatch uniforms.' });
  assert.equal(p.varbits.get(10359), 1, 'talking to Trader Sven mirrors myq5_noble_disguise');
});

test('Sins escort → boat → mausoleum advances through native myq5 checkpoints', () => {
  const h = harness('SinsOfTheFather'), p = player();
  h.quest.setStage(p, 34);
  h.action(p, N.IVAN_STROM_10, 'uRyt8i');
  assert.equal(h.quest.getStage(p), 34);
  h.action(p, N.IVAN_STROM_10, '_popnC');
  assert.equal(h.quest.getStage(p), 36, 'escort starts at 36');
  h.action(p, N.IVAN_STROM_10, 'uD7Qcw');
  assert.equal(h.quest.getStage(p), 38, 'Ivan delivered at 38');
  p.moveTo(new core.Location(3529, 3169, 0));
  const boat = h.hooks.onObjectInteraction.at(-1);
  boat({ player: p, objectId: 38089, location: { x: 3523, y: 3169, z: 0 }, handled: false });
  assert.equal(h.quest.getStage(p), 44, 'boat arrival at the Icyene Graveyard is 44');

  h.quest.setStage(p, 48);
  p.moveTo(new core.Location(3704, 3190, 0));
  const unlock = h.namedObjects.get('Mausoleum door').Unlock;
  unlock({ player: p, objectId: 39519 });
  unlock({ player: p, objectId: 39519 });
  assert.equal(h.quest.getStage(p), 50, 'the first unlock only plays the briefing and marks the lock ready');
  const sums = uid => Number(p.log.filter(row => row[0] === 'text' && row[1] === uid).at(-1)?.[2]);
  const rowSums = [26, 27, 28, 29, 30].map(c => sums((665 << 16) | c));
  const colSums = [19, 20, 21, 22, 23].map(c => sums((665 << 16) | c));
  assert.ok(rowSums.every(Number.isInteger) && colSums.every(Number.isInteger), 'the tomb interface receives its sums');
  const click = slot => h.hooks.onInterfaceActionButton[0]({ player: p, buttonId: (665 << 16) | 32, slot, handled: false });
  click(0);
  assert.equal(h.quest.getStage(p), 50, 'an unsolved grid does not unlock the door');
  const rowPatterns = rowSums.map(sum => {
    const patterns = [];
    for (let mask = 0; mask < 32; mask++) {
      const value = [0, 1, 2, 3, 4].filter(c => mask & (1 << c)).reduce((total, c) => total + c + 1, 0);
      if (value === sum) patterns.push(mask);
    }
    return patterns;
  });
  let solution = -1;
  const search = (row, mask) => {
    if (solution >= 0) return;
    if (row === 5) {
      const cols = [0, 1, 2, 3, 4].map(c => [0, 1, 2, 3, 4].filter(r => mask & (1 << (r * 5 + c))).reduce((total, r) => total + r + 1, 0));
      if (cols.every((v, i) => v === colSums[i])) solution = mask;
      return;
    }
    for (const pattern of rowPatterns[row]) search(row + 1, mask | (pattern << (row * 5)));
  };
  search(0, 0);
  assert.ok(solution >= 0, 'the generated Kakurasu puzzle is solvable');
  click(0); // undo the probe click
  for (let i = 0; i < 25; i++) if (solution & (1 << i)) click(i);
  assert.equal(h.quest.getStage(p), 52, 'solving the grid opens the mausoleum at 52');
  h.emit('npc-dialogue:line', { player: p, npcId: N.SAFALAAN_HALLOW_2, text: "Please, inform the others for me." });
  assert.equal(h.quest.getStage(p), 54, 'Safalaan asking for the others starts convincing at 54');
  assert.equal(p.varbits.get(7255), 54);
});

test('Sins finale reaches 138 and grants the experience tome once', () => {
  const h = harness('SinsOfTheFather'), p = player();
  h.quest.setStage(p, 130);
  h.action(p, N.VANSTROM_KLAUSE_15, 'I_cLuQ');
  assert.equal(h.quest.getStage(p), 132);
  h.action(p, N.IVAN_STROM, 'y7Pa27');
  h.action(p, N.IVAN_STROM, 'epguG1');
  assert.equal(h.quest.getStage(p), 138);
  assert.equal(p.varbits.get(7255), 138);
  assert.equal(p.items.get(TOME_OF_EXPERIENCE), 1);
  h.action(p, N.IVAN_STROM, 'epguG1');
  assert.equal(p.items.get(TOME_OF_EXPERIENCE), 1, 'completion cannot pay the tome twice');
});


test('Sins migrates every legacy overlapping stage once and leaves native saves alone', () => {
  const legacy = [
    [20, 6], [100, 36], [130, 54], [300, 138],
  ];
  for (const [oldStage, nativeStage] of legacy) {
    const h = harness('SinsOfTheFather'), p = player();
    p.attrs.set('quest.sins_of_the_father.stage', oldStage);
    h.hooks.onPlayerLogin[0]({ player: p });
    assert.equal(h.quest.getStage(p), nativeStage, `legacy ${oldStage} maps to ${nativeStage}`);
    assert.equal(p.attrs.get('sins-of-the-father:schema'), 2);
  }
  const oldComplete = harness('SinsOfTheFather'), done = player();
  done.attrs.set('quest.sins_of_the_father.stage', 300);
  done.attrs.set('quest.points', 7);
  oldComplete.hooks.onPlayerLogin[0]({ player: done });
  assert.equal(oldComplete.quest.getStage(done), 138);
  assert.equal(done.attrs.get('quest.points'), 7, 'old completion does not pay quest points again');
  assert.equal(done.items.get(24690) ?? 0, 0, 'old completion does not grant a second tome');

  const h = harness('SinsOfTheFather'), fresh = player();
  h.quest.setStage(fresh, 20); // real native transition writes the schema marker
  assert.equal(fresh.attrs.get('sins-of-the-father:schema'), 2);
  h.hooks.onPlayerLogin[0]({ player: fresh });
  assert.equal(h.quest.getStage(fresh), 20, 'native stage 20 is not reinterpreted as Hameln');
});

test('Children migrates old completed 22 to 24 without paying rewards twice', () => {
  const h = harness('ChildrenOfTheSun', 'Children of the Sun'), p = player();
  p.attrs.set('quest.children_of_the_sun.stage', 22);
  p.attrs.set('quest.points', 5);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(h.quest.getStage(p), 24);
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(p.attrs.get('quest.points'), 5, 'migration does not award quest points again');
  assert.equal(p.varbits.get(9645), 2);

  const fresh = player();
  h.quest.setStage(fresh, 22); // native transition writes the schema marker
  assert.equal(fresh.attrs.get('children-of-the-sun:schema'), 2);
  h.hooks.onPlayerLogin[0]({ player: fresh });
  assert.equal(h.quest.getStage(fresh), 22, 'fresh native 22 stays Itzla-left, not complete');
  assert.equal(h.quest.isComplete(fresh), false);
});

test('Children cell scene places captured actors, walks Itzla and recovers on relog', () => {
  const h = harness('ChildrenOfTheSun', 'Children of the Sun'), p = player();
  h.quest.setStage(p, 16);
  h.action(p, N.SERGEANT_TOBYN, 'D5boc3');
  assert.equal(h.quest.getStage(p), 18);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3204, 3473, 2]);
  const bandit = h.npcs.find(npc => npc.getId() === N.BANDIT_20);
  assert.ok(bandit, 'the captured cell bandit is spawned');
  assert.deepEqual([bandit.getLocation().getX(), bandit.getLocation().getY()], [3201, 3470]);
  const itzla = h.npcs.find(npc => npc.getId() === N.PRINCE_ITZLA_ARKAN_2);
  assert.ok(itzla);
  h.tick(2);
  assert.deepEqual([itzla.getLocation().getX(), itzla.getLocation().getY()], [3204, 3470], 'Itzla walks to the bars');

  const relog = player();
  relog.attrs.set('quest.children_of_the_sun.stage', 18);
  relog.attrs.set('children-of-the-sun:schema', 2);
  h.hooks.onPlayerLogin[0]({ player: relog });
  assert.ok(h.npcs.some(npc => npc.getId() === N.BANDIT_20 && !npc.removed), 'relogging in 18 restores the cell scene');

  h.action(p, N.SERGEANT_TOBYN, '4aa1xN');
  assert.equal(h.quest.getStage(p), 20);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [10172, 3399, 2]);
  h.tick(1);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3203, 3473, 2]);
  assert.ok(!h.npcs.some(npc => npc.getId() === N.BANDIT_20 && !npc.removed && npc.getOwner?.() === p));
  h.action(p, N.SERGEANT_TOBYN, 'VS01WH');
  assert.equal(h.quest.getStage(p), 22);
});

test('Sins trek requires the vine, axe, logs, three bridge repairs and crossing before juvinates', () => {
  const h = harness('SinsOfTheFather'), p = player();
  h.quest.setStage(p, 36);
  h.hooks.onPlayerLogin[0]({ player: p });
  const object = (id, x = 3439, y = 3400) => {
    const event = { player: p, objectId: id, location: { x, y, z: 0 }, handled: false };
    h.hooks.onObjectInteraction.at(-1)(event);
    return event;
  };
  object(13872, 3446, 3411);
  assert.equal(p.items.get(946) ?? 0, 1, 'the rucksack supplies a knife');
  for (let i = 0; i < 3; i++) object(13847, 3442, 3408);
  assert.equal(p.items.get(7778), 3);
  h.hooks.onItemOnItem[0]({ player: p, usedItemId: 7778, usedWithItemId: 7778 });
  assert.equal(p.items.get(7777), 1, 'three short vines make the long vine');
  const useBranch = { player: p, itemId: 7777, objectId: 38004, location: { x: 3442, y: 3408, z: 0 }, handled: false };
  h.hooks.onItemOnObject.at(-1)(useBranch);
  assert.equal(useBranch.handled, true, 'the long vine is used on the branch before swinging');
  assert.equal(p.items.get(7777) ?? 0, 0, 'using the branch consumes the long vine');
  object(38005, 3442, 3408);
  assert.equal(h.quest.getStage(p), 36);

  for (const npcId of [9612, 9613]) {
    const npc = h.npcs.find(n => n.getId() === npcId && !n.removed);
    assert.ok(npc, `nail beast ${npcId} spawned`);
    h.hooks.onNpcDeath[0]({ npc, npcId, killer: p });
  }
  assert.ok(h.npcs.some(n => n.getId() === 5647 && !n.removed), 'the bridge zombie spawns after the nail beasts');
  const zombie = h.npcs.find(n => n.getId() === 5647 && !n.removed);
  h.hooks.onNpcDeath[0]({ npc: zombie, npcId: 5647, killer: p });
  assert.equal(p.items.get(1351) ?? 0, 1, 'the zombie gives the axe');
  object(1365, 3441, 3403); object(1365, 3441, 3403); object(1365, 3441, 3403);
  assert.equal(p.items.get(1511), 3);
  assert.equal(object(13834).handled, true);
  assert.equal(p.attrs.get('sins-of-the-father:bridge-repairs'), 1);
  object(13835); object(13836);
  assert.equal(p.attrs.get('sins-of-the-father:bridge-repairs'), 3);
  assert.equal(p.items.get(1511), 0, 'three logs repair all three sections');
  assert.ok(!h.npcs.some(n => [9614, 9615].includes(n.getId()) && !n.removed), 'juvinates wait for the crossing');
  object(13837);
  assert.equal(p.attrs.get('quest.sins_of_the_father.bits') & (1 << 15), 1 << 15);
  assert.ok(h.npcs.some(n => [9614, 9615].includes(n.getId()) && !n.removed), 'crossing spawns the juvinates');
});

test('Sins long vine installs the real Swamp tree branch and normal Swing-from crosses', () => {
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { MapObjects } = core;
  const ObjectManager = core.ObjectManager;
  ObjectDefinition.init();
  CacheRegionManager.loadMapFiles(3442, 3408, true);
  const tile = new core.Location(3442, 3408, 0);
  const ownedIds = p => ObjectManager.objectsAt(tile)
    .filter(object => object.getOwner() === p)
    .map(object => object.getId());
  const swing = (h, p, handled = false) => {
    const event = { player: p, objectId: 38005, location: { x: 3442, y: 3408, z: 0 }, handled };
    h.hooks.onObjectInteraction.at(-1)(event);
    return event;
  };

  // Positive: stage 36 with the long vine already held on login.
  const h = harness('SinsOfTheFather', null, { realObjects: true }), p = player();
  p.moveTo(new core.Location(3444, 3411, 0));
  p.items.set(7777, 1);
  h.quest.setStage(p, 36);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.ok(ownedIds(p).includes(38004), 'stage36 + long vine installs the real 38004 Use branch');
  assert.ok(!ownedIds(p).includes(38005), 'Swing-from 38005 waits until the vine is attached');
  assert.ok(!ownedIds(p).includes(13847), 'the Cut-vine object is replaced, not layered');
  const branchUse = { player: p, itemId: 7777, objectId: 38004, location: { x: 3442, y: 3408, z: 0 }, handled: false };
  h.hooks.onItemOnObject.at(-1)(branchUse);
  assert.equal(branchUse.handled, true, 'long vine Use on 38004 is handled');
  assert.ok(ownedIds(p).includes(38005), 'Use swaps the branch to real 38005 Swing-from');
  assert.ok(!ownedIds(p).includes(38004), 'the Use branch object is replaced, not layered');
  const event = swing(h, p);
  assert.equal(event.handled, true, 'normal Swing-from object interaction handles the branch');
  assert.equal(p.attrs.get('quest.sins_of_the_father.bits') & (1 << 13), 1 << 13, 'Swing-from sets BIT_TREK');
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3437, 3402], 'Swing-from crosses to the captured trek tile');
  assert.equal(p.items.get(7777) ?? 0, 0, 'branch Use consumed exactly one long vine; crossing adds none');
  assert.equal(h.quest.getStage(p), 36, 'the crossing does not grant a target stage');

  // Combining three short vines must sync the tree immediately.
  const c = harness('SinsOfTheFather', null, { realObjects: true }), q = player();
  q.moveTo(new core.Location(3444, 3411, 0));
  q.items.set(7778, 3);
  c.quest.setStage(q, 36);
  c.hooks.onPlayerLogin[0]({ player: q });
  assert.ok(ownedIds(q).includes(13847), 'short-vine stage shows the Cut-vine object first');
  c.hooks.onItemOnItem[0]({ player: q, usedItemId: 7778, usedWithItemId: 7778 });
  assert.equal(q.items.get(7777), 1, 'combine yields exactly one long vine');
  assert.equal(q.items.get(7778), 0, 'combine consumes all three short vines');
  assert.ok(ownedIds(q).includes(38004), 'combine syncs the real 38004 Use branch at once');
  assert.ok(!ownedIds(q).includes(38005), 'combine does not skip the Use step');
  assert.ok(!ownedIds(q).includes(13847), 'combine removes the Cut-vine object');
  const combineUse = { player: q, itemId: 7777, objectId: 38004, location: { x: 3442, y: 3408, z: 0 }, handled: false };
  c.hooks.onItemOnObject.at(-1)(combineUse);
  assert.equal(combineUse.handled, true);
  assert.ok(ownedIds(q).includes(38005), 'Use after combine installs the real Swing-from branch');

  // Negative: no long vine.
  const n = harness('SinsOfTheFather', null, { realObjects: true }), r = player();
  r.moveTo(new core.Location(3444, 3411, 0));
  n.quest.setStage(r, 36);
  n.hooks.onPlayerLogin[0]({ player: r });
  assert.ok(ownedIds(r).includes(13847), 'without the long vine the Cut-vine object stays');
  assert.ok(!ownedIds(r).includes(38005), 'without the long vine there is no Swing-from branch');
  assert.ok(!ownedIds(r).includes(38004), 'without the long vine there is no Use branch');
  const noVine = swing(n, r);
  assert.equal(noVine.handled, true, 'the no-vine branch option is still a normal handled interaction');
  assert.equal(r.attrs.get('quest.sins_of_the_father.bits') & (1 << 13), 0, 'no vine never sets BIT_TREK');
  assert.deepEqual([r.getLocation().getX(), r.getLocation().getY()], [3444, 3411], 'no vine does not cross');

  // Negative: long vine but wrong stage.
  const w = harness('SinsOfTheFather', null, { realObjects: true }), v = player();
  v.moveTo(new core.Location(3444, 3411, 0));
  v.items.set(7777, 1);
  w.quest.setStage(v, 34);
  w.hooks.onPlayerLogin[0]({ player: v });
  assert.ok(!ownedIds(v).includes(38005), 'pre-escort stage does not install the branch');
  assert.ok(!ownedIds(v).includes(38004), 'pre-escort stage does not install the Use branch');
  const wrongStage = swing(w, v);
  assert.equal(wrongStage.handled, false, 'wrong-stage branch is not handled');
  assert.equal(v.attrs.get('quest.sins_of_the_father.bits') & (1 << 13), 0, 'wrong stage never sets BIT_TREK');
});

test('Sins trek nail spawns and broken bridge use real walkable cache hooks', () => {
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { MapObjects } = core;
  const ObjectManager = core.ObjectManager;
  ObjectDefinition.init();
  CacheRegionManager.loadMapFiles(3439, 3400, true);
  const h = harness('SinsOfTheFather', null, { realObjects: true }), p = player();
  p.moveTo(new core.Location(3444, 3411, 0));
  p.items.set(7777, 1);
  h.quest.setStage(p, 36);
  h.hooks.onPlayerLogin[0]({ player: p });
  const useBranch = { player: p, itemId: 7777, objectId: 38004, location: { x: 3442, y: 3408, z: 0 }, handled: false };
  h.hooks.onItemOnObject.at(-1)(useBranch);
  assert.equal(useBranch.handled, true, 'long vine Use precedes the swing');
  const swing = { player: p, objectId: 38005, location: { x: 3442, y: 3408, z: 0 }, handled: false };
  h.hooks.onObjectInteraction.at(-1)(swing);
  assert.equal(swing.handled, true);

  // Capture 1637 adds: 9612 at player(-2,+3), 9613 at (-6,+5), both melee land tiles.
  const nails = [9612, 9613].map(id => h.npcs.find(npc => npc.getId() === id && !npc.removed));
  assert.ok(nails.every(Boolean), 'both nail beasts spawn');
  assert.deepEqual(nails.map(npc => [npc.getLocation().getX(), npc.getLocation().getY()]),
    [[3436, 3401], [3432, 3403]], 'nail spawns use the capture-relative walkable tiles');
  const walk = (x, y) => !CacheRegionManager.blocked(new core.Location(x, y, 0), null)
    && !CacheRegionManager.isWater(new core.Location(x, y, 0));
  const can = (from, to) => CacheRegionManager.canMove(from[0], from[1], to[0], to[1], 0, 1, 1, null) !== false;
  for (const npc of nails) {
    const tile = [npc.getLocation().getX(), npc.getLocation().getY()];
    assert.equal(walk(...tile), true, `nail tile ${tile} is dry walkable land`);
    const queue = [[3437, 3402]], seen = new Set(['3437,3402']);
    let reachable = false;
    for (let i = 0; i < queue.length && !reachable; i++) {
      const current = queue[i];
      if (Math.max(Math.abs(current[0] - tile[0]), Math.abs(current[1] - tile[1])) <= 1) { reachable = true; break; }
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
        const next = [current[0] + dx, current[1] + dy], key = next.join(',');
        if (seen.has(key) || !walk(...next) || !can(current, next)) continue;
        seen.add(key); queue.push(next);
      }
    }
    assert.equal(reachable, true, `melee route reaches nail ${tile} from the post-vine landing`);
  }

  for (const npc of nails) h.hooks.onNpcDeath[0]({ npc, npcId: npc.getId(), killer: p });
  assert.equal((p.attrs.get('quest.sins_of_the_father.bits') >> 16) & 3, 2, 'both real nail kills reach NAIL_SHIFT 2');
  const bridgeIds = () => ObjectManager.objectsAt(new core.Location(3439, 3400, 0))
    .filter(object => object.getOwner() === p).map(object => object.getId());
  assert.deepEqual(bridgeIds(), [13834], 'zero-repair bridge installs real Broken bridge 13834');

  p.items.set(1351, 1); p.items.set(1511, 3);
  const useBridge = id => {
    const event = { player: p, objectId: id, location: { x: 3439, y: 3400, z: 0 }, handled: false };
    h.hooks.onObjectInteraction.at(-1)(event);
    return event;
  };
  assert.equal(useBridge(13834).handled, true);
  assert.equal(p.attrs.get('sins-of-the-father:bridge-repairs'), 1);
  assert.deepEqual(bridgeIds(), [13835], 'first log swaps to the next real bridge id');
  assert.equal(useBridge(13835).handled, true);
  assert.deepEqual(bridgeIds(), [13836]);
  assert.equal(useBridge(13836).handled, true);
  assert.deepEqual(bridgeIds(), [13837]);
  assert.equal(p.items.get(1511), 0, 'three repairs consume exactly three logs');
  assert.equal(useBridge(13837).handled, true);
  assert.equal(p.attrs.get('quest.sins_of_the_father.bits') & (1 << 15), 1 << 15, 'normal Cross sets BIT_BRIDGE');
  assert.ok(h.npcs.some(npc => [9614, 9615].includes(npc.getId()) && !npc.removed), 'crossing spawns the juvinates');
});

test('Sins hideout silver-sickle crate uses the real cache 32575 Search handler', () => {
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const { MapObjects } = core;
  ObjectDefinition.init();
  CacheRegionManager.loadMapFiles(3597, 9615, true);
  const crateTile = new core.Location(3597, 9615, 0);
  assert.equal(MapObjects.get(32575, crateTile, null)?.getId(), 32575, 'real cache places Crate 32575 at 3597,9615');
  assert.equal(MapObjects.get(17987, crateTile, null), null, 'wrong crate 17987 is not at the hideout tile');
  assert.ok((ObjectDefinition.forId(32575)?.getInteractions?.() || []).includes('Search'), '32575 exposes normal Search');

  const h = harness('SinsOfTheFather'), p = player();
  h.quest.setStage(p, 114);
  h.hooks.onPlayerLogin[0]({ player: p });
  const search = { player: p, objectId: 32575, location: { x: 3597, y: 9615, z: 0 }, handled: false };
  h.hooks.onObjectInteraction.at(-1)(search);
  assert.equal(search.handled, true);
  assert.equal(p.items.get(2963), 1, 'normal Search gives exactly one silver sickle (b)');
  assert.ok(p.messages.some(text => text.includes('silver sickle (b)')), 'capture-style Search message');
  const again = { player: p, objectId: 32575, location: { x: 3597, y: 9615, z: 0 }, handled: false };
  h.hooks.onObjectInteraction.at(-1)(again);
  assert.equal(p.items.get(2963), 1, 'searching again never duplicates the sickle');

  const low = harness('SinsOfTheFather'), q = player();
  low.quest.setStage(q, 113);
  low.hooks.onPlayerLogin[0]({ player: q });
  const early = { player: q, objectId: 32575, location: { x: 3597, y: 9615, z: 0 }, handled: false };
  low.hooks.onObjectInteraction.at(-1)(early);
  assert.equal(early.handled, false, 'pre-logs crate is not handled');
  assert.equal(q.items.get(2963) ?? 0, 0, 'pre-logs crate grants nothing');
});

test('Sins Vanstrom enrages at zero hp, heals to 200, uses lightning, then dies once', () => {
  const h = harness('SinsOfTheFather'), p = player();
  h.quest.setStage(p, 130);
  h.action(p, N.VANSTROM_KLAUSE_15, '2PLAE9');
  const vanstrom = h.npcs.find(n => n.getId() === N.VANSTROM_KLAUSE_15 && !n.removed);
  assert.ok(vanstrom);
  const before = { npc: vanstrom, preventDeath: false };
  h.hooks.onNpcBeforeDeath[0](before);
  assert.equal(before.preventDeath, true);
  assert.equal(vanstrom.transformedId, N.VANSTROM_KLAUSE_17);
  assert.equal(vanstrom.hitpoints, 200);
  const arena = h.areas.find(area => area.constructor.name === 'VanstromArena');
  assert.ok(arena, 'Vanstrom specials run from their arena');
  for (let i = 0; i < 5; i++) arena.process(p);
  h.tick(1);
  assert.ok((p.damage ?? []).length >= 1, 'phase two lightning can hit the player');
  h.hooks.onNpcDeath[0]({ npc: vanstrom, npcId: N.VANSTROM_KLAUSE_17, killer: p });
  assert.equal(h.quest.getStage(p), 130, 'the death cutscene still drives the final stage');
});


test('Sins replay sends the captured Castle Drakan, escape and hideout cameras and resets after interrupt', () => {
  const h = harness('SinsOfTheFather'), p = player();
  const moves = () => p.log.filter(row => row[0] === 'sendCameraMoveTo');
  const resets = () => p.log.filter(row => row[0] === 'sendCameraReset').length;
  h.quest.setStage(p, 128);
  h.action(p, N.SAFALAAN_HALLOW_2, 'HgxSdS');
  h.tick(11);
  assert.ok(moves().some(row => row[1] === 3589 && row[2] === 3358 && row[3] === 500), 'castle camera move');
  assert.ok(p.log.some(row => row[0] === 'sendCameraLookAt' && row[1] === 3574 && row[2] === 3358), 'castle camera look-at');

  h.action(p, N.SAFALAAN_HALLOW_2, 'I_cLuQ');
  h.tick(4);
  assert.ok(moves().some(row => row[1] === 3570 && row[2] === 3365 && row[3] === 500), 'escape camera move');

  h.action(p, N.IVAN_STROM, 'y7Pa27');
  const resetsBefore = resets();
  h.tick(12);
  assert.ok(moves().some(row => row[1] === 3594 && row[2] === 9613), 'hideout camera after the escape');
  h.tick(40);
  assert.ok(resets() > resetsBefore, 'hideout camera resets after the scene');

  const h2 = harness('SinsOfTheFather'), p2 = player();
  h2.quest.setStage(p2, 128);
  h2.action(p2, N.SAFALAAN_HALLOW_2, 'HgxSdS');
  h2.tick(11);
  const count = p2.log.filter(row => row[0] === 'sendCameraMoveTo').length;
  h2.hooks.onPlayerLogout[0]({ player: p2 });
  assert.ok(p2.log.some(row => row[0] === 'sendCameraReset'), 'logout resets the camera');
  h2.tick(30);
  assert.equal(p2.log.filter(row => row[0] === 'sendCameraMoveTo').length, count, 'queued shots do not survive logout');
});

test('Sins stage-dependent route objects are per-player, not global', () => {
  const h = harness('SinsOfTheFather');
  const late = player();
  const early = player();
  const doorOverlay = (p, id) => h.objects.filter((object) =>
    object.getOwner() === p && object.getId() === id && object.getLocation().getX() === 3704);

  h.quest.setStage(late, 120); // mausoleum opened for the late player
  h.login(late);
  assert.equal(doorOverlay(late, 38071).length, 1, 'late player sees their open door');

  h.quest.setStage(early, 50); // actionable closed door for the early player
  h.login(early);
  assert.equal(doorOverlay(early, 38070).length, 1, 'early player gets their own Unlock door');
  assert.equal(doorOverlay(late, 38071).length, 1, 'early login must not remove the late player\'s overlay');
  assert.equal(h.objects.filter((object) => object.getOwner() === null && [38070, 38071].includes(object.getId())).length, 0,
    'no global mausoleum door may be installed by a single player');

  h.quest.setStage(early, 120);
  h.login(early);
  assert.equal(doorOverlay(early, 38071).length, 1, 'the second player gets their own open door');
  assert.equal(doorOverlay(early, 38070).length, 0);
  assert.equal(doorOverlay(late, 38071).length, 1, 'the first player keeps theirs');

  h.logout(late);
  assert.equal(doorOverlay(late, 38071).length, 0, 'logout removes the owner overlay');
  assert.equal(doorOverlay(early, 38071).length, 1, 'the other player keeps their overlay');
});

test('Children replay sends the captured delegation, eavesdrop and roof cameras with resets', () => {
  const h = harness('ChildrenOfTheSun', 'Children of the Sun'), p = player();
  const moves = () => p.log.filter(row => row[0] === 'sendCameraMoveTo');
  const resets = () => p.log.filter(row => row[0] === 'sendCameraReset').length;
  h.quest.setStage(p, 4);
  h.action(p, N.ALINA, 'wltzqo');
  h.tick(3);
  assert.ok(moves().some(row => row[1] === 3213 && row[2] === 3433 && row[3] === 460), 'delegation camera');
  const delegationResets = resets();
  h.tick(43);
  assert.ok(resets() > delegationResets, 'delegation camera resets');

  h.quest.setStage(p, 8);
  h.action(p, N.GUARD_185, 'V-D092');
  h.tick(3);
  assert.ok(moves().some(row => row[1] === 3252 && row[2] === 3396), 'eavesdrop camera');
  const eavesdropResets = resets();
  h.tick(18);
  assert.ok(resets() > eavesdropResets, 'eavesdrop camera resets');

  h.quest.setStage(p, 14);
  h.action(p, N.SERGEANT_TOBYN, 'PiLgte');
  h.tick(15);
  assert.ok(moves().some(row => row[1] === 3207 && row[2] === 3471 && row[3] === 311), 'roof camera');
  const roofResets = resets();
  h.tick(25);
  assert.ok(resets() > roofResets, 'roof camera resets');
});

test('Children camera timeline is cancelled and reset on logout', () => {
  const h = harness('ChildrenOfTheSun', 'Children of the Sun'), p = player();
  h.quest.setStage(p, 4);
  h.action(p, N.ALINA, 'wltzqo');
  h.tick(3);
  const count = p.log.filter(row => row[0] === 'sendCameraMoveTo').length;
  h.hooks.onPlayerLogout[0]({ player: p });
  assert.ok(p.log.some(row => row[0] === 'sendCameraReset'));
  h.tick(60);
  assert.equal(p.log.filter(row => row[0] === 'sendCameraMoveTo').length, count);
});


test('Sins recorded camera clusters cover Carl, crypt/Kroy, Paterdomus, graveyard, lab, Damien and prison', () => {
  const hasMove = (p, x, y) => p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === x && row[2] === y);

  {
    const h = harness('SinsOfTheFather'), p = player();
    h.quest.setStage(p, 6);
    h.namedObjects.get('Barrel').Inspect({ player: p, objectId: 37980 });
    h.tick(8);
    assert.ok(hasMove(p, 3758, 3289), 'Carl barrel camera');
    const before = p.log.filter(row => row[0] === 'sendCameraReset').length;
    h.tick(43);
    assert.ok(p.log.filter(row => row[0] === 'sendCameraReset').length > before, 'Carl camera resets');
  }
  {
    const h = harness('SinsOfTheFather'), p = player();
    h.quest.setStage(p, 14);
    p.attrs.set('quest.sins_of_the_father.bits', 1 << 9);
    h.emit('ladders:climb', { player: p, objectId: 32637, clickType: 1, object: { getLocation: () => new core.Location(3738, 3316, 0) }, handled: false });
    h.tick(1);
    assert.ok(hasMove(p, 3728, 3300), 'crypt descent camera');
    h.tick(153);
    assert.ok(p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === 3730 && row[2] === 9764), 'Kroy fight camera');
    assert.ok(p.log.some(row => row[0] === 'sendCameraMoveTo' && row[1] === 3728 && row[2] === 9751), 'Kroy transition camera');
    h.tick(25);
    assert.ok(p.log.some(row => row[0] === 'sendCameraReset'), 'Kroy camera resets');
  }
  {
    const h = harness('SinsOfTheFather'), p = player();
    h.quest.setStage(p, 24);
    h.namedNpcs.get('Ivan Strom')['Talk-to']({ player: p, npcId: N.IVAN_STROM });
    h.tick(5);
    assert.ok(hasMove(p, 3541, 3514), 'Paterdomus meeting camera');
  }
  {
    const h = harness('SinsOfTheFather'), p = player();
    h.quest.setStage(p, 44);
    h.namedNpcs.get('Veliaf Hurtz')['Talk-to']({ player: p, npcId: N.VELIAF_HURTZ_2 });
    h.tick(1);
    assert.ok(hasMove(p, 3690, 3185), 'Icyene graveyard camera');
  }
  {
    const h = harness('SinsOfTheFather'), p = player();
    h.quest.setStage(p, 58);
    h.action(p, N.SAFALAAN_HALLOW_2, '2Ond7l');
    h.tick(9);
    assert.ok(hasMove(p, 3610, 9730), 'laboratory camera');
  }
  {
    const h = harness('SinsOfTheFather'), p = player();
    h.quest.setStage(p, 80);
    h.action(p, N.VELIAF_HURTZ_2, 'OieoC2');
    h.tick(5);
    assert.ok(hasMove(p, 3725, 3357), 'Damien manor camera');
  }
  {
    const h = harness('SinsOfTheFather'), p = player();
    h.quest.setStage(p, 94);
    h.namedNpcs.get('Maria Gadderanks')['Talk-to']({ player: p, npcId: N.MARIA_GADDERANKS });
    h.tick(5);
    assert.ok(hasMove(p, 3622, 3379), 'Darkmeyer prison camera');
  }
});


test('Sins anchors are per-player personal overlays, resynced after region load and removed only for their owner', () => {
  const h = harness('SinsOfTheFather');
  const a = player(), b = player();
  h.quest.setStage(a, 6);
  h.quest.setStage(b, 6);
  h.worldPlayers.push(a, b);
  h.hooks.onPlayerLogin[0]({ player: a });
  h.hooks.onPlayerLogin[0]({ player: b });
  const barrels = () => h.objects.filter(object => object.getId() === 37980);
  assert.equal(barrels().length, 2, 'each player gets their own barrel overlay');
  assert.deepEqual(new Set(barrels().map(object => object.getOwner())), new Set([a, b]));
  assert.ok(barrels().every(object => object.getOwner()), 'anchors are owner-only, not global');

  assert.ok(h.hooks.onRegionLoaded?.length, 'quest listens for real region loads');
  h.hooks.onRegionLoaded[0]({ regionId: 12345, absX: 3749, absY: 3290 });
  assert.equal(barrels().length, 2, 'region load resync does not duplicate owner objects');
  assert.deepEqual(new Set(barrels().map(object => object.getOwner())), new Set([a, b]));

  h.hooks.onPlayerLogout[0]({ player: a });
  assert.equal(barrels().length, 1, 'logout removes only that player anchor');
  assert.equal(barrels()[0].getOwner(), b);
});

test('Children tail follows the collision-valid captured route to the door and only then finishes', () => {
  const h = harness('ChildrenOfTheSun', 'Children of the Sun'), p = player();
  h.quest.setStage(p, 4);
  h.action(p, N.ALINA, 'r2Pt3E');
  assert.equal(h.quest.getStage(p), 6);
  const guard = () => h.npcs.find(npc => npc.getId() === N.GUARD_185 && !npc.removed);
  assert.ok(guard());
  let finishedEarly = false;
  for (let tick = 0; tick < 700; tick++) {
    const before = guard();
    if (!before) break;
    p.moveTo(new core.Location(before.getLocation().getX(), before.getLocation().getY() - 10, 0));
    h.hooks.onPlayerProcess[0]({ player: p });
    const after = guard();
    if (!after) break;
    if (h.quest.getStage(p) === 8 && (after.getLocation().getX() !== 3258 || after.getLocation().getY() !== 3400)) finishedEarly = true;
    if (h.quest.getStage(p) === 8) break;
  }
  assert.equal(h.quest.getStage(p), 8, 'tail completed (not stuck at 3248,3391)');
  assert.equal(finishedEarly, false, 'tail does not finish at an early tile');
  assert.deepEqual([guard().getLocation().getX(), guard().getLocation().getY()], [3258, 3400], 'guard reaches the door approach');

  const door = { player: p, objectId: 50048, location: { x: 3259, y: 3400 }, handled: false };
  h.emit('door:toggle', door);
  assert.equal(door.handled, true, 'the bandit door cutscene is claimed after the real tail');
});


test('Sins barrel owner overlay resolves through runtime MapObjects for its owner only', () => {
  const { GameObject, Location, MapObjects, ObjectManager, ObjectDefinition, PlayerRights, RegionManager } = core;
  ObjectDefinition.init();
  const owner = { getPrivateArea: () => null, getRights: () => PlayerRights.NONE, getPacketSender: () => ({ getVarbit: () => 0 }) };
  const other = { getPrivateArea: () => null, getRights: () => PlayerRights.NONE, getPacketSender: () => ({ getVarbit: () => 0 }) };
  const tile = new Location(3749, 3291, 0);
  RegionManager.loadMapFiles(tile.getX(), tile.getY());
  const definition = ObjectDefinition.forPlayer(37980, owner);
  assert.equal(definition?.id, 37980, 'the current definition keeps the actionable barrel id');
  const object = new GameObject(37980, tile, 10, 0, null).setOwner(owner);
  ObjectManager.register(object, true);
  try {
    assert.equal(MapObjects.getPrivateArea(owner, 37980, tile), object, 'owner click validation finds the personal overlay');
    assert.notEqual(MapObjects.getPrivateArea(other, 37980, tile), object, 'another player cannot resolve the personal overlay');
  } finally {
    ObjectManager.deregister(object, true);
  }
});


test('Sins canonical crypt landing is walkable and reaches Kroy through real collision', () => {
  const { Location, RegionManager } = core;
  RegionManager.init();
  const landing = new Location(3738, 9703, 1);
  assert.equal(RegionManager.blocked(landing, null), false, 'canonical 32637 destination is walkable');
  const arrival = [3728, 9742];
  assert.equal(RegionManager.blocked(new Location(arrival[0], arrival[1], 1), null), false, 'captured Kroy cutscene arrival is walkable');
  const { MapObjects, ObjectDefinition, ObjectManager } = core;
  ObjectDefinition.init();
  RegionManager.loadMapFiles(3728, 9752);
  const gate = MapObjects.get(39512, new Location(3728, 9752, 1), null);
  assert.ok(gate, 'the crypt gate exists');
  RegionManager.removeObjectClipping(gate);
  const goal = [3727, 9759];
  const queue = [arrival];
  const seen = new Set([queue[0].join(',')]);
  let reached = false;
  for (let index = 0; index < queue.length && !reached; index++) {
    const [x, y] = queue[index];
    if (x === goal[0] && y === goal[1]) { reached = true; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (seen.has(key) || Math.abs(nx - 3728) > 40 || Math.abs(ny - 9742) > 70) continue;
      if (RegionManager.blocked(new Location(nx, ny, 1), null)) continue;
      if (RegionManager.canMove(x, y, nx, ny, 1, 1, 1, null) === false) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  assert.equal(reached, true, 'crypt landing has a real route to the Kroy lab tile');
});

test('Sins mandatory player landings and cache entry objects are valid', () => {
  const { Location, MapObjects, ObjectDefinition, RegionManager } = core;
  ObjectDefinition.init();
  RegionManager.init();
  const landings = [
    [3738, 9703, 1, 'crypt ladder'], [3704, 3191, 0, 'mausoleum inside'],
    [3529, 3169, 0, 'Burgh boat'], [3696, 3199, 0, 'Icyene boat'],
    [3627, 3332, 0, 'Darkmeyer crack exit'], [3627, 3328, 0, 'Meiyerditch crack'],
    [3565, 3362, 0, 'Castle Drakan'], [3494, 9628, 0, 'hideout arrival'],
    [3666, 3279, 0, 'Slepe rowboat shore'], [3600, 9740, 0, 'laboratory'],
  ];
  for (const [x, y, z, label] of landings) {
    assert.equal(RegionManager.blocked(new Location(x, y, z), null), false, `${label} landing is walkable`);
  }
  RegionManager.loadMapFiles(3727, 3300);
  RegionManager.loadMapFiles(3704, 3190);
  const stairs = MapObjects.get(32637, new Location(3727, 3300, 0), null);
  assert.ok(stairs, 'church crypt stairs object exists');
  assert.ok((ObjectDefinition.forId(32637).getInteractions() || []).includes('Climb-down'), 'stairs offer Climb-down');
  const door = MapObjects.get(39519, new Location(3704, 3190, 0), null);
  assert.ok(door, 'mausoleum door map object exists');
  assert.ok((ObjectDefinition.forId(38070).getInteractions() || []).includes('Unlock'), 'personal closed door offers Unlock');
  assert.ok((ObjectDefinition.forId(38071).getInteractions() || []).includes('Open'), 'personal open door offers Open');
});

test('Sins Carl follow walks the captured route, fails/retries, then starts the crypt eavesdrop at 14', () => {
  const h = harness('SinsOfTheFather'), p = player();
  p.moveTo(new core.Location(3750, 3296, 0));
  h.quest.setStage(p, 12);
  h.hooks.onPlayerLogin[0]({ player: p });
  const carl = () => h.npcs.find(npc => npc.getId() === 9558 && !npc.removed);
  assert.ok(carl(), 'Carl follow NPC spawns at stage 12');
  const followArea = h.areas.find(area => area.constructor.name === 'CarlFollowArea');
  assert.ok(followArea, 'Carl follow runs from a Slepe area, not a global process hook');
  let finishedAt = null;
  for (let tick = 0; tick < 900; tick++) {
    const before = carl();
    if (!before) break;
    p.moveTo(new core.Location(before.getLocation().getX() - 12, before.getLocation().getY(), 0));
    followArea.process(p);
    if ((p.attrs.get('quest.sins_of_the_father.bits') || 0) & (1 << 9)) { finishedAt = tick; break; }
    assert.equal(h.quest.getStage(p), 12, 'follow does not advance to the crypt early');
  }
  assert.notEqual(finishedAt, null, 'Carl reaches the crypt and finishes the follow');
  assert.equal(h.quest.getStage(p), 12, 'Carl finishing unlocks the normal crypt stairs at stage 12');
  h.emit('ladders:climb', { player: p, objectId: 32637, clickType: 1, object: { getLocation: () => new core.Location(3727, 3300, 0) }, handled: false });
  assert.equal(h.quest.getStage(p), 12);
  assert.ok(p.prompt, 'the stairs ask the QH Continue choice');
  h.choose(p, 'Continue the Sins of the Father quest.');
  h.continueUntil(p, () => !p.manager.getCurrent());
  h.tick(3);
  assert.equal(h.quest.getStage(p), 14, 'the Continue choice advances to the crypt scene at 14');
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3728, 9742, 1], 'the crypt scene uses the captured Kroy arrival');

  const f = harness('SinsOfTheFather'), q = player();
  q.moveTo(new core.Location(3750, 3296, 0));
  f.quest.setStage(q, 12);
  f.hooks.onPlayerLogin[0]({ player: q });
  q.moveTo(new core.Location(3780, 3320, 0));
  const failArea = f.areas.find(area => area.constructor.name === 'CarlFollowArea');
  for (let tick = 0; tick < 4; tick++) failArea.process(q);
  assert.equal(f.quest.getStage(q), 6, 'falling too far resets to Hameln for a real retry');
  assert.ok(f.quest.getStage(q) < 12);
});


test('Sins Carl too-close/seen fails with the captured retry feedback', () => {
  const h = harness('SinsOfTheFather'), p = player();
  p.getLocalNpcs = () => h.npcs;
  p.moveTo(new core.Location(3750, 3296, 0));
  h.quest.setStage(p, 12);
  h.hooks.onPlayerLogin[0]({ player: p });
  const carl = () => h.npcs.find(npc => npc.getId() === 9558 && !npc.removed);
  const area = h.areas.find(entry => entry.constructor.name === 'CarlFollowArea');
  for (let tick = 0; tick < 5; tick++) {
    const npc = carl();
    if (!npc) break;
    p.moveTo(new core.Location(npc.getLocation().getX() - 12, npc.getLocation().getY(), 0));
    area.process(p);
  }
  const npc = carl();
  assert.ok(npc);
  p.moveTo(npc.getLocation());
  for (let tick = 0; tick < 3 && h.quest.getStage(p) === 12; tick++) area.process(p);
  assert.equal(h.quest.getStage(p), 6, 'being seen/too close resets for the captured retry');
  h.tick(2); // resolve Carl's captured overhead line before checking its feedback message
  assert.ok(p.messages.some(text => text.includes('failed to stay hidden from Carl')) || /see you there|failed to stay hidden/i.test(p.text), 'captured caught-if-seen feedback');
});

test('Sins Carl can retry before the caught overhead cleanup without losing the new follower', () => {
  const h = harness('SinsOfTheFather'), p = player();
  p.getLocalNpcs = () => h.npcs;
  p.moveTo(new core.Location(3750, 3296, 0));
  h.quest.setStage(p, 12);
  h.hooks.onPlayerLogin[0]({ player: p });
  const area = h.areas.find(entry => entry.constructor.name === 'CarlFollowArea');
  for (let tick = 0; tick < 5; tick++) {
    const npc = h.npcs.find(entry => entry.getId() === 9558 && !entry.removed);
    p.moveTo(new core.Location(npc.getLocation().getX() - 12, npc.getLocation().getY(), 0));
    area.process(p);
  }
  const oldCarl = h.npcs.find(entry => entry.getId() === 9558 && !entry.removed);
  p.moveTo(oldCarl.getLocation());
  area.process(p);
  assert.equal(h.quest.getStage(p), 6);
  h.tick(2); // let the caught feedback speak before the player begins the retry

  h.quest.setStage(p, 12);
  h.hooks.onPlayerLogin[0]({ player: p });
  const retryCarl = h.npcs.find(entry => entry.getId() === 9558 && entry !== oldCarl && !entry.removed);
  assert.ok(retryCarl, 'the new follow attempt starts while the old overhead actor is retained');
  h.tick(1);
  assert.ok(oldCarl.removed, 'the old actor is cleaned up after its captured overhead continuation');
  assert.equal(retryCarl.isRegistered(), true, 'delayed cleanup leaves the new attempt intact');
});

test('Sins Carl progress never follows player proximity: relog near the end restarts at the canonical start', () => {
  const h = harness('SinsOfTheFather'), p = player();
  p.moveTo(new core.Location(3731, 3307, 0)); // near the crypt end, no earned progress
  h.quest.setStage(p, 12);
  h.hooks.onPlayerLogin[0]({ player: p });
  const carl = h.npcs.find(npc => npc.getId() === 9558 && !npc.removed);
  assert.ok(carl);
  assert.deepEqual([carl.getLocation().getX(), carl.getLocation().getY()], [3748, 3310], 'follow always starts at the captured NPC spawn for a fresh attempt');
  const area = h.areas.find(entry => entry.constructor.name === 'CarlFollowArea');
  for (let tick = 0; tick < 4; tick++) area.process(p);
  assert.equal(h.quest.getStage(p), 6, 'teleporting near the end does not grant the tail; proximity starts a retry');
  assert.equal((p.attrs.get('quest.sins_of_the_father.bits') || 0) & (1 << 9), 0, 'no BIT_TRAIL without walking the route');
  assert.ok(area.getBoundaries().every(boundary => !boundary.inside(new core.Location(3750, 3308, 1))), 'follow area is the surface Slepe street');
});

test('Sins Carl logout removes the actor, keeps no trail bit, and resumes a fresh canonical attempt', () => {
  const h = harness('SinsOfTheFather'), p = player();
  p.moveTo(new core.Location(3750, 3296, 0));
  h.quest.setStage(p, 12);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.ok(h.npcs.some(npc => npc.getId() === 9558 && !npc.removed));
  h.hooks.onPlayerLogout[0]({ player: p });
  assert.ok(!h.npcs.some(npc => npc.getId() === 9558 && !npc.removed), 'logout cleans the Carl actor');
  assert.equal((p.attrs.get('quest.sins_of_the_father.bits') || 0) & (1 << 9), 0);
  h.hooks.onPlayerLogin[0]({ player: p });
  const carl = h.npcs.find(npc => npc.getId() === 9558 && !npc.removed);
  assert.ok(carl);
  assert.deepEqual([carl.getLocation().getX(), carl.getLocation().getY()], [3748, 3310]);
});


test('Sins Carl captured checkpoints form a fully walkable cache route start to crypt end', () => {
  const { Location, MapObjects, RegionManager } = core;
  RegionManager.init();
  assert.ok(RegionManager.getRegion(3748, 3318), 'real cache region is loaded for the LOS test');
  assert.ok(MapObjects.mapObjects.size > 0, 'real map objects are loaded, not an empty mock');
  const points = [[3748,3310],[3748,3311],[3748,3312],[3748,3313],[3748,3314],[3748,3315],[3748,3316],[3748,3317],[3748,3318],[3748,3319],[3747,3320],[3747,3321],[3747,3322],[3746,3323],[3746,3324],[3745,3325],[3744,3326],[3743,3327],[3742,3328],[3741,3328],[3740,3328],[3739,3328],[3738,3328],[3737,3328],[3736,3328],[3735,3328],[3734,3328],[3733,3328],[3732,3327],[3731,3326],[3730,3326],[3729,3325],[3728,3325],[3727,3324],[3726,3324],[3725,3324],[3724,3324],[3723,3324],[3722,3324],[3721,3325],[3720,3326],[3719,3327],[3718,3327],[3717,3328],[3716,3328],[3715,3328],[3714,3328],[3713,3328],[3712,3328],[3711,3328],[3710,3327],[3709,3326],[3708,3325],[3707,3324],[3706,3324],[3705,3324],[3704,3324],[3703,3323],[3702,3322],[3702,3321],[3702,3320],[3702,3319],[3702,3318],[3703,3317],[3703,3316],[3703,3315],[3703,3314],[3703,3313],[3703,3312],[3704,3311],[3705,3311],[3706,3311],[3707,3311],[3708,3311],[3709,3311],[3710,3312],[3711,3313],[3712,3313],[3713,3313],[3714,3313],[3715,3314],[3716,3315],[3717,3316],[3718,3317],[3719,3317],[3720,3317],[3721,3317],[3722,3317],[3723,3317],[3724,3317],[3725,3317],[3726,3317],[3727,3317],[3728,3317],[3729,3317],[3730,3317],[3731,3316],[3732,3315],[3732,3314],[3732,3313],[3733,3312],[3733,3311],[3733,3310],[3733,3309],[3732,3308],[3731,3308],[3730,3308],[3729,3308],[3728,3307],[3728,3306],[3728,3305],[3728,3304]];

  const walkable = (x, y) => !RegionManager.blocked(new Location(x, y, 0), null);
  const segment = (from, to) => {
    const startKey = `${from[0]},${from[1]}`, goalKey = `${to[0]},${to[1]}`;
    const queue = [from], parent = new Map([[startKey, null]]);
    for (let index = 0; index < queue.length; index++) {
      const [x, y] = queue[index];
      if (`${x},${y}` === goalKey) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
        if (parent.has(key) || !walkable(nx, ny)) continue;
        if (RegionManager.canMove(x, y, nx, ny, 0, 1, 1, null) === false) continue;
        parent.set(key, `${x},${y}`);
        queue.push([nx, ny]);
      }
    }
    if (!parent.has(goalKey)) return null;
    const path = [];
    for (let key = goalKey; key && key !== startKey; key = parent.get(key)) {
      const [x, y] = key.split(',').map(Number);
      path.push([x, y]);
    }
    return path.reverse();
  };
  let steps = 0;
  for (let index = 1; index < points.length; index++) {
    const path = segment(points[index - 1], points[index]);
    assert.ok(path, `Carl segment ${points[index - 1]} → ${points[index]} connects`);
    for (const [x, y] of path) {
      assert.equal(walkable(x, y), true, `Carl step (${x},${y}) is walkable`);
      steps++;
    }
  }
  assert.ok(steps > 100, 'the expanded Carl route covers the full captured walk');
  assert.deepEqual(points[points.length - 1], [3728, 3304], 'route ends at the captured crypt approach, not a teleport/blocked stairs tile');
});


test('Sins Carl first look-back respects the captured wall hiding obstruction', () => {
  const h = harness('SinsOfTheFather'), p = player();
  p.moveTo(new core.Location(3754, 3307, 0));
  h.quest.setStage(p, 12);
  h.hooks.onPlayerLogin[0]({ player: p });
  const area = h.areas.find(entry => entry.constructor.name === 'CarlFollowArea');
  const carl = () => h.npcs.find(npc => npc.getId() === 9558 && !npc.removed);
  const captured = [[3752, 3308], [3751, 3310], [3751, 3312], [3751, 3314], [3751, 3315]];
  let atLookback = false;
  for (let tick = 0; tick < 40 && !atLookback; tick++) {
    const target = captured[Math.min(tick, captured.length - 1)];
    p.moveTo(new core.Location(target[0], target[1], 0));
    area.process(p);
    assert.equal(h.quest.getStage(p), 12, 'captured hiding path survives the first look-back');
    const npc = carl();
    if (npc?.getLocation().getX() === 3748 && npc.getLocation().getY() === 3318) atLookback = true;
  }
  assert.equal(atLookback, true, 'Carl reaches the captured first look-back');
  for (let tick = 0; tick < 5; tick++) {
    p.moveTo(new core.Location(3751, 3315, 0)); // captured hiding position behind the cache wall
    area.process(p);
    assert.equal(h.quest.getStage(p), 12, 'captured hide spot stays hidden through the pause');
  }
});


test('Sins Carl five look-backs use the same captured 15-tick pause and hide4 approach', () => {
  const h = harness('SinsOfTheFather'), p = player();
  p.moveTo(new core.Location(3750, 3296, 0));
  h.quest.setStage(p, 12);
  h.hooks.onPlayerLogin[0]({ player: p });
  const area = h.areas.find(entry => entry.constructor.name === 'CarlFollowArea');
  const carl = () => h.npcs.find(npc => npc.getId() === 9558 && !npc.removed);
  const pauseAt = new Map([[`3748,3318`, 0], [`3734,3328`, 0], [`3714,3328`, 0], [`3702,3319`, 0], [`3722,3317`, 0]]);
  let previous = null, run = 0, finished = false;
  for (let tick = 0; tick < 400; tick++) {
    const npc = carl();
    if (!npc) { finished = true; break; }
    p.moveTo(new core.Location(npc.getLocation().getX() - 12, npc.getLocation().getY(), 0));
    area.process(p);
    assert.equal(h.quest.getStage(p), 12, 'trailing at the 14-tile fail boundary never resets Carl');
    const key = `${npc.getLocation().getX()},${npc.getLocation().getY()}`;
    if (key === previous) run++;
    else {
      if (previous && pauseAt.has(previous)) pauseAt.set(previous, Math.max(pauseAt.get(previous), run));
      previous = key;
      run = 1;
    }
  }
  if (previous && pauseAt.has(previous)) pauseAt.set(previous, Math.max(pauseAt.get(previous), run));
  assert.equal(finished || !carl(), true, 'Carl reaches the crypt and leaves');
  assert.equal(p.attrs.get('quest.sins_of_the_father.bits') & (1 << 9), 1 << 9, 'the tail sets the trail bit');
  assert.deepEqual([...pauseAt.values()], [17, 17, 17, 17, 17], 'all five look-backs hold the same captured window, including pause5');

  const h4 = harness('SinsOfTheFather'), q = player();
  q.moveTo(new core.Location(3750, 3296, 0));
  h4.quest.setStage(q, 12);
  h4.hooks.onPlayerLogin[0]({ player: q });
  const area4 = h4.areas.find(entry => entry.constructor.name === 'CarlFollowArea');
  const carl4 = () => h4.npcs.find(npc => npc.getId() === 9558 && !npc.removed);
  let hide4 = false, hide5 = false;
  for (let tick = 0; tick < 400; tick++) {
    const npc = carl4();
    if (!npc) break;
    const x = npc.getLocation().getX(), y = npc.getLocation().getY();
    if (hide4 !== true) {
      q.moveTo(new core.Location(x - 12, y, 0));
      if (x === 3703 && y === 3323) { q.moveTo(new core.Location(3703, 3325, 0)); hide4 = 'crossing'; }
      else if (hide4 === 'crossing' && x === 3702 && y === 3322) q.moveTo(new core.Location(3701, 3324, 0));
      else if (hide4 === 'crossing' && x === 3702 && y === 3321) { q.moveTo(new core.Location(3700, 3323, 0)); hide4 = true; }
    } else if (!hide5) {
      q.moveTo(new core.Location(3700, 3323, 0));
      if (y <= 3318 && x >= 3708) { q.moveTo(new core.Location(3719, 3312, 0)); hide5 = true; }
    } else {
      q.moveTo(new core.Location(3719, 3312, 0));
    }
    area4.process(q);
    assert.equal(h4.quest.getStage(q), 12, `captured hide pose survives Carl at ${x},${y}, tick ${tick}`);
  }
  assert.equal(hide4, true, 'captured hide4 pose 3700,3323 is reached through the real 3703,3325 crossing');
  assert.equal(hide5, true, 'captured hide5 pose 3719,3312 is reached after pause4');
  assert.equal(h4.quest.getStage(q), 12, 'hide4/hide5 never reset the tail');
  assert.equal((q.attrs.get('quest.sins_of_the_father.bits') || 0) & (1 << 9), 1 << 9, 'the hide4/hide5 continuation reaches the crypt');
});

test('Sins all captured Carl look-backs hide their captured player pose by edge LOS', () => {
  const { RegionManager } = core;
  RegionManager.init();
  const blocked = (from, to) => {
    const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
    let previous = { x: from[0], y: from[1] };
    for (let step = 1; step <= steps; step++) {
      const x = Math.round(from[0] + (to[0] - from[0]) * step / steps);
      const y = Math.round(from[1] + (to[1] - from[1]) * step / steps);
      if (RegionManager.canMove(previous.x, previous.y, x, y, 0, 1, 1, null) === false) return true;
      previous = { x, y };
    }
    return false;
  };
  const windows = [
    { npc: [3748, 3318], player: [3751, 3315], facing: [0, -1] },
    { npc: [3734, 3328], player: [3740, 3324], facing: [1, 0] },
    { npc: [3714, 3328], player: [3718, 3325], facing: [1, 0] },
    { npc: [3702, 3319], player: [3700, 3323], facing: [0, 1] },
    { npc: [3722, 3317], player: [3719, 3312], facing: [-1, 0] },
  ];
  for (const window of windows) {
    const dx = window.player[0] - window.npc[0], dy = window.player[1] - window.npc[1];
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    assert.ok(distance > 1 && distance <= 10, `captured hide ${window.player} is inside Carl range`);
    assert.ok(window.facing[0] * dx + window.facing[1] * dy > 0, 'captured hide is in the look-back cone');
    assert.equal(blocked(window.npc, window.player), true, `cache wall/edge hides ${window.player}`);
  }
});


test('Sins disguise chest returns only missing noble pieces with capacity and ownership checks', () => {
  const { ObjectDefinition, MapObjects, Location } = core;
  ObjectDefinition.init();
  assert.ok((ObjectDefinition.forId(37986).getInteractions() || []).includes('Open'), 'cache closed chest has Open');
  assert.ok((ObjectDefinition.forId(37987).getInteractions() || []).includes('Search'), 'cache open chest has Search');
  assert.ok(MapObjects.get(37986, new Location(3600, 9617, 0), null), 'hideout closed chest is a real map object');
  const h = harness('SinsOfTheFather'), p = player();
  h.quest.setStage(p, 86);
  assert.ok(h.namedObjects.get('Closed Chest'), 'the hideout chest has a real Open handler');
  const open = h.namedObjects.get('Closed Chest').Open;
  const search = h.namedObjects.get('Open Chest').Search;
  const shut = h.namedObjects.get('Open Chest').Shut;
  const openEvent = { player: p, objectId: 37986, location: { x: 3600, y: 9617, z: 0 }, handled: false };
  open(openEvent);
  assert.equal(openEvent.handled, true);
  assert.ok(h.objects.some(object => object.getId() === 37987 && object.getOwner() === p), 'opening installs the player open-chest variant');

  p.full = true;
  search({ player: p, objectId: 37987, location: { x: 3600, y: 9617, z: 0 }, handled: false });
  assert.equal(p.items.get(I.VYRE_NOBLE_TOP), undefined, 'full inventory does not lose a spare');

  p.full = false;
  p.free = 1;
  search({ player: p, objectId: 37987, location: { x: 3600, y: 9617, z: 0 }, handled: false });
  assert.equal(p.items.get(I.VYRE_NOBLE_TOP), 1, 'one free slot gets one piece');
  assert.equal(p.items.get(I.VYRE_NOBLE_LEGS), undefined);
  p.free = 28;
  search({ player: p, objectId: 37987, location: { x: 3600, y: 9617, z: 0 }, handled: false });
  assert.equal(p.items.get(I.VYRE_NOBLE_LEGS), 1);
  assert.equal(p.items.get(I.VYRE_NOBLE_SHOES), 1);
  search({ player: p, objectId: 37987, location: { x: 3600, y: 9617, z: 0 }, handled: false });
  assert.equal(p.items.get(I.VYRE_NOBLE_TOP), 1, 'repeat search never duplicates a held piece');

  p.items.delete(I.VYRE_NOBLE_TOP);
  p.banks = [{ getAmount: id => id === I.VYRE_NOBLE_TOP ? 1 : 0 }];
  search({ player: p, objectId: 37987, location: { x: 3600, y: 9617, z: 0 }, handled: false });
  assert.equal(p.items.get(I.VYRE_NOBLE_TOP), undefined, 'a banked piece is not duplicated');
  p.banks = [];
  p.equippedItems = [{ getId: () => I.VYRE_NOBLE_TOP }];
  search({ player: p, objectId: 37987, location: { x: 3600, y: 9617, z: 0 }, handled: false });
  assert.equal(p.items.get(I.VYRE_NOBLE_TOP), undefined, 'an equipped piece is not duplicated');

  shut({ player: p, objectId: 37987, location: { x: 3600, y: 9617, z: 0 }, handled: false });
  assert.ok(!h.objects.some(object => object.getId() === 37987 && object.getOwner() === p), 'Shut restores the closed chest');

  const u = player();
  h.quest.setStage(u, 78);
  h.namedObjects.get('Closed Chest').Open({ player: u, objectId: 37986, location: { x: 3600, y: 9617, z: 0 }, handled: false });
  h.namedObjects.get('Open Chest').Search({ player: u, objectId: 37987, location: { x: 3600, y: 9617, z: 0 }, handled: false });
  assert.equal(u.items.get(I.VYRE_NOBLE_TOP_UNSCENTED_), 1, 'pre-scent stage gets unscented spares');
  assert.equal(u.items.get(I.VYRE_NOBLE_TOP), undefined);
});


test('Sins disguise chest handlers only claim the exact cache object, tile, plane and stage', () => {
  const h = harness('SinsOfTheFather'), p = player();
  h.quest.setStage(p, 78);
  const open = h.namedObjects.get('Closed Chest').Open;
  const search = h.namedObjects.get('Open Chest').Search;
  const shut = h.namedObjects.get('Open Chest').Shut;
  const at = (objectId, x = 3600, y = 9617, z = 0) => ({ player: p, objectId, location: { x, y, z }, handled: false });

  for (const event of [at(37986, 3601, 9617), at(37986, 3600, 9616), at(37986, 3600, 9617, 1), at(37985)]) {
    assert.equal(open(event), false, 'Open refuses a non-canonical chest target');
    assert.equal(event.handled, false);
  }
  assert.ok(!h.objects.some(object => object.getOwner() === p && object.getId() === 37987), 'no chest overlay from wrong object/location');

  const wrongSearch = at(37987, 3601, 9617);
  assert.equal(search(wrongSearch), false, 'Search refuses an open chest elsewhere');
  assert.equal(wrongSearch.handled, false);
  assert.equal(p.items.get(I.VYRE_NOBLE_TOP_UNSCENTED_), undefined);

  const notOpened = at(37987);
  assert.equal(search(notOpened), false, 'Search requires the player to have opened the real chest');
  assert.equal(shut(at(37987, 3600, 9617, 1)), false, 'Shut refuses wrong plane');

  const early = player();
  h.quest.setStage(early, 72);
  const earlyOpen = { player: early, objectId: 37986, location: { x: 3600, y: 9617, z: 0 }, handled: false };
  assert.equal(open(earlyOpen), false, 'Open is inactive before the disguise is made');
  assert.equal(earlyOpen.handled, false);
  const earlyShut = { player: early, objectId: 37987, location: { x: 3600, y: 9617, z: 0 }, handled: false };
  assert.equal(shut(earlyShut), false, 'Shut is inactive before the disguise is made');
  assert.equal(earlyShut.handled, false);
});
