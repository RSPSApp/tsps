// From server/: node --test tests/remaining-desert-parity.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
// Quest stage updates render cache-backed quest-list metadata. Keep one live store
// for the whole file so cached definitions and RegionManager share its lifetime.
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const noop = () => {};

function harness(questFile) {
  let clock = 1000;
  const hooks = {}, events = {}, tasks = [], transcripts = [], objects = [], npcs = [];
  class PrivateArea {
    constructor() { this.entities = []; this.destroyed = false; }
    add(actor) { this.entities.push(actor); actor.setArea(this); }
    enter(actor) { this.add(actor); }
    leave(actor, logout) { this.postLeave(actor, logout); }
    postLeave(actor) { this.entities = this.entities.filter(value => value !== actor); actor.setArea(null); this.destroy(); }
    destroy() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
  }
  const api = new Proxy({
    core: { ...core, PrivateArea, World: { getProcessCycle: () => clock },
      TaskManager: {
        submit: task => { task.setRunning(true); tasks.push(task); },
        cancelTasks: key => tasks.filter(task => task.key === key).forEach(task => task.stop()),
      },
      MapObjects: { get: () => null },
      ObjectManager: { register: object => objects.push(object), deregister: noop },
    },
    persistAttribute: noop,
    onCustomEvent: (name, handler) => (events[name] ??= []).push(handler),
    emitCustomEvent: (name, event) => (events[name] ?? []).forEach(handler => handler(event)),
    onInterfaceActionButton: (ids, handler) => (hooks.onInterfaceActionButton ??= []).push(handler),
    spawnNpc: definition => {
      let area, at = new core.Location(definition.x, definition.y, definition.z);
      const npc = { ...definition, getId: () => definition.id, getArea: () => area, setArea: value => { area = value; },
        isRegistered: () => true, getOwner: () => definition.owner, getLocation: () => at,
        getSpawnLocation: () => at, moveTo: value => { at = value; },
        getHitpoints: () => 100, getCombat: () => ({ reset: noop }), getDefinition: () => ({ getRespawn: () => 36 }),
        setCombatXpMultiplier: noop, setPositionToFace: noop, performAnimation: noop, performGraphic: noop };
      npcs.push(npc); return npc;
    },
    removeNpc: npc => { npc.removed = true; },
    getItemOnGroundManager: () => ({ registerLocation: noop }),
    getWorld: () => ({ getNpcs: () => [] }),
  }, { get: (target, key) => target[key] ?? ((handler) => (hooks[key] ??= []).push(handler)) });
  const original = runtime.startTranscript;
  runtime.startTranscript = (...args) => { transcripts.push(args); return true; };
  try { require(questFile)(api); }
  finally { runtime.startTranscript = original; }
  return { api, hooks, tasks, transcripts, objects, npcs, quest: runtime.getRegisteredQuests().at(-1),
    emit: (name, event) => (events[name] ?? []).forEach(handler => handler(event)),
    variant: context => hooks.onNpcDialogueVariant[0](context),
    action: (player, npcId, stepId) => { const event = { player, npcId, stepId }; (events['npc-dialogue:action'] ?? []).forEach(handler => handler(event)); return event; },
    itemAction: (player, itemId, option, slot) => { const event = { player, itemId, option, slot }; (hooks.onItemAction ?? []).forEach(handler => handler(event)); return event; },
    object: (player, objectId, clickType = 1, definition = null, location = null) => { const event = { player, objectId, clickType, definition, location, handled: false }; (hooks.onObjectInteraction ?? []).forEach(handler => handler(event)); return event; },
    button: (player, buttonId) => { const event = { player, buttonId, handled: false }; (hooks.onInterfaceActionButton ?? []).forEach(handler => handler(event)); return event; },
    tick(count) { while (count-- > 0) [...tasks].forEach(task => task.tick()); },
    advanceClock(count) { clock += count; },
  };
}

function player() {
  const attributes = new Map(), items = new Map(), varbits = new Map(), messages = [], slots = [], xpBySkill = new Map();
  let lastBuilder = null, blockXp = false;
  let location = new core.Location(3254, 3274, 0), area = null;
  const interfaces = [], scripts = [], camera = [], strings = new Map();
  const packet = new Proxy({
    sendVarbit: (id, value) => { varbits.set(id, value); return packet; },
    getVarbit: id => varbits.get(id) ?? 0,
    getVarp: () => 0,
    sendConfig: () => packet,
    sendInterface: id => { interfaces.push(id); return packet; },
    sendInterfaceScript: (id, args) => { scripts.push([id, args]); return packet; },
    sendInterfaceRemoval: () => packet,
    sendSubInterface: () => packet,
    closeSubInterface: () => packet,
    sendEnterAmountPrompt: text => { p.amountPrompt = text; return packet; },
    sendString: (text, id) => { strings.set(id, text); return packet; },
    sendCameraMoveTo: (x, y, height) => { camera.push(['move', x, y, height]); return packet; },
    sendCameraLookAt: (x, y, height) => { camera.push(['look', x, y, height]); return packet; },
    sendCameraReset: () => { camera.push(['reset']); return packet; },
    sendCameraShake: (axis, random) => { camera.push(['shake', axis, random]); return packet; },
    sendSoundEffect: () => packet,
  }, { get: (target, key) => target[key] ?? (() => packet) });
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    getFreeSlots: () => p.full ? 0 : 28,
    isFull: () => Boolean(p.full),
    get: slot => slots[slot],
    adds: (id, amount = 1) => items.set(id, (items.get(id) ?? 0) + amount),
    deleteNumber: (id, amount = 1) => { assert.ok((items.get(id) ?? 0) >= amount); items.set(id, items.get(id) - amount); },
    deleteAtSlot: (slot, amount = 1) => { const item = slots[slot]; if (!item) return false; const id = item.getId(); slots[slot] = undefined;
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); return true; },
  };
  const p = {
    attributes, items, varbits, messages, interfaces, scripts, camera, strings, slots, xpBySkill,
    get lastBuilder() { return lastBuilder; }, set lastBuilder(value) { lastBuilder = value; },
    get blockXp() { return blockXp; }, set blockXp(value) { blockXp = value; },
    getUsername: () => 'Q6desert1',
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    setEnteredAmountAction: action => { p.amountAction = action; },
    getInventory: () => inventory,
    getPacketSender: () => packet,
    getDialogueManager: () => ({ startDialogues: builder => { lastBuilder = builder; }, reset: noop, isActive: () => false }),
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement(value) { p.movementBlocked = value === true; return this; } }),
    getLocation: () => location,
    moveTo: value => { location = value; },
    getArea: () => area,
    setUntargetable: noop,
    performGraphic: noop,
    setArea: value => { area = value; },
    getHitpoints: () => 100,
    isRegistered: () => true,
    getCombat: () => ({ reset: noop }),
    sendMessage: text => messages.push(text),
    getSkillManager: () => ({
      getMaxLevel: () => 99,
      getCombatLevel: () => 126,
      getExperience: skill => xpBySkill.get(skill) ?? 0,
      addExperiences: (skill, amount) => { p.xp = (p.xp ?? 0) + amount; },
      addExperience: (skill, amount) => { if (blockXp) return; xpBySkill.set(skill, (xpBySkill.get(skill) ?? 0) + amount); p.xp = (p.xp ?? 0) + amount; },
    }),
  };
  return p;
}

test('Contact: the High Priest refuses to start without both quest prerequisites', () => {
  const h = harness('../plugins/quests/quests/Contact.Quest');
  const p = player();
  assert.equal(h.variant({ player: p, npcId: 4206, npc: {} }), null);
  const condition = { player: p, stepId: 'eHzg2g' };
  (h.hooks.onNpcDialogueCondition[0])(condition);
  // The condition hook returns the answer rather than mutating the event.
  assert.equal(h.hooks.onNpcDialogueCondition[0](condition), true);
});

test('Contact: Osman only opens the Sophanem cutscene after the Al Kharid send-off', () => {
  const h = harness('../plugins/quests/quests/Contact.Quest');
  const p = player();
  const osman = { getLocation: () => new core.Location(3285, 2812, 0) };

  h.quest.setStage(p, 60); // Osman has not agreed yet
  assert.equal(h.variant({ player: p, npcId: 4286, npc: osman }), null,
    'talking outside Sophanem before Osman agrees must not skip the persuasion');

  h.quest.setStage(p, 70); // Osman agreed to meet outside Sophanem
  assert.equal(
    h.variant({ player: p, npcId: 4286, npc: osman }),
    'i-spy-with-my-little-eye-talking-to-osman-outside-sophanem'
  );
});

test('Contact: the captured Osman stage-70 choice does not reference a sent-bit', () => {
  const h = harness('../plugins/quests/quests/Contact.Quest');
  const p = player();
  h.quest.setStage(p, 70);
  const event = { player: p, npcId: core.NpcIdentifiers.OSMAN_9, option: 'I want to talk to you about Sophanem.' };
  assert.doesNotThrow(() => h.emit('npc-dialogue:choice', event));
  assert.equal(h.quest.getStage(p), 70, 'the choice keeps the captured Osman-agreed stage');
});

test('Contact: dungeon Osman uses the 11568 cache parent and is cleaned up on logout', () => {
  const h = harness('../plugins/quests/quests/Contact.Quest');
  const p = player();
  h.quest.setStage(p, 90);
  h.action(p, core.NpcIdentifiers.GIANT_SCARAB, '_dkntA');
  assert.equal(h.quest.getStage(p), 100);
  const boss = h.npcs.find(n => n.getId() === core.NpcIdentifiers.GIANT_SCARAB);
  assert.ok(boss, 'the scarab is spawned for the fight');
  h.hooks.onNpcDeath[0]({ killer: p, npc: boss, npcId: boss.getId() });
  assert.equal(h.quest.getStage(p), 110);
  const osman = h.npcs.find(n => n.getId() === 11568);
  assert.ok(osman, 'dungeon Osman spawns as the primary cache parent');
  assert.equal(osman.getOwner(), p);
  assert.deepEqual([osman.getLocation().getX(), osman.getLocation().getY(), osman.getLocation().getZ()], [2274, 4315, 0]);
  h.hooks.onPlayerLogout[0]({ player: p });
  assert.equal(osman.removed, true, 'logout removes the parent-id dungeon Osman');
});

test('Contact: Maisa stops replaying the quiz once Osman has been sent for', () => {
  const h = harness('../plugins/quests/quests/Contact.Quest');
  const p = player();
  const maisa = { getLocation: () => new core.Location(2258, 4317, 0) };

  h.quest.setStage(p, 50);
  assert.equal(h.variant({ player: p, npcId: 3876, npc: maisa }), 'kaleef-s-corpse-talking-to-maisa');
  h.quest.setStage(p, 60);
  assert.equal(
    h.variant({ player: p, npcId: 3876, npc: maisa }),
    'kaleef-s-corpse-talking-to-maisa-again-after-correctly-answering-but-before-speaking-to-osman'
  );
  h.quest.setStage(p, 90);
  assert.equal(h.variant({ player: p, npcId: 3876, npc: maisa }), null);
});

test('Contact: the chasm boss ladder is a real route into the Giant Scarab lair', () => {
  const h = harness('../plugins/quests/quests/Contact.Quest');
  const p = player();
  h.quest.setStage(p, 0);
  const locked = { player: p, objectId: 20287, handled: false };
  h.emit('ladders:climb', locked);
  assert.equal(locked.handled, true);
  assert.notEqual(p.getLocation().getY(), 4298, 'the boss ladder is locked before Jex is told');

  h.quest.setStage(p, 40);
  const open = { player: p, objectId: 20287, handled: false };
  h.emit('ladders:climb', open);
  assert.equal(open.handled, true);
  assert.equal(p.getLocation().getX(), 2297);
  assert.equal(p.getLocation().getY(), 4298);
  assert.equal(h.transcripts.length, 0, 'the ordinary chasm descent does not replay cut scene 3');

  h.quest.setStage(p, 90);
  const prepared = { player: p, objectId: 20287, handled: false };
  h.emit('ladders:climb', prepared);
  h.tick(1);
  assert.equal(h.transcripts.at(-1)[4], 'beetle-battle-cut-scene-3-osman-and-maisa-speak-below-sophanem');
});

test('Beneath Cursed Sands: Maisa falls back to her generic dialogue after completion', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  for (const stage of [90, 102, 106, 108]) {
    h.quest.setStage(p, stage);
    assert.equal(
      h.variant({ player: p, npcId: 11474, npc: { getLocation: () => new core.Location(3378, 2794, 0) } }),
      null,
      `stage ${stage} is the High Priest finale, not a Maisa replay`
    );
  }
});

test('Beneath Cursed Sands: the Sophanem High Priest hands in the finale at stages 102-104', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  for (const stage of [102, 104, 106]) {
    h.quest.setStage(p, stage);
    assert.equal(
      h.variant({ player: p, npcId: 4206, npc: {} }),
      'fight-with-the-menaphite-akh-talking-to-maisa-or-the-high-priest',
      `stage ${stage} must be the finish conversation, not the cure hand-in`
    );
  }
});

test('Beneath Cursed Sands: the Quest Helper citizen anchor is the spawned citizen', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 14);
  h.hooks.onPlayerLogin[0]({ player: p });
  const citizen = h.npcs.find(npc => npc.id === 11537);
  assert.ok(citizen, 'bcs_necropolis_citizen_5 should be spawned for the guard-fight step');
  assert.equal(citizen.getLocation().getX(), 3347);
  assert.equal(citizen.getLocation().getY(), 2718);
  assert.equal(h.variant({ player: p, npcId: 11537, npc: citizen }), 'starting-off-talking-to-a-citizen');
});
test('Contact: captured varbit milestones use 10/20 for the opening', () => {
  const h = harness('../plugins/quests/quests/Contact.Quest');
  const p = player();
  h.action(p, 4206, 'DFAYNr');
  assert.equal(h.quest.getStage(p), 10);
  h.action(p, 4206, 'tEWAER');
  assert.equal(h.quest.getStage(p), 20);
});

test('Contact: the recorded temple ladder and trapdoor landings are preserved', () => {
  const h = harness('../plugins/quests/quests/Contact.Quest');
  const p = player();
  h.quest.setStage(p, 40);
  const ladder = { player: p, objectId: 20275, handled: false };
  h.emit('ladders:climb', ladder);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2765, 5131]);
  const trapdoor = { player: p, objectId: 20340, handled: false };
  h.emit('ladders:climb', trapdoor);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [2166, 4409, 2]);
  assert.equal(p.varbits.get(3279), 1);
});

test('Contact: the recorded chasm traps are clickable and the boss ladder gates reentry', () => {
  const h = harness('../plugins/quests/quests/Contact.Quest');
  const p = player();
  const trap = h.object(p, 20271);
  assert.equal(trap.handled, true);
  assert.match(p.messages.at(-1), /trap/i);
});

test('Beneath Cursed Sands: the seven-digit chest code is 1118513', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 32);
  p.items.set(I.CHEST_3, 1);
  h.itemAction(p, I.CHEST_3, 'Open');
  assert.ok(p.amountAction, 'opening the chest must ask for the recorded code');
  p.amountAction.execute(1234567);
  assert.equal(p.items.get(I.CHEST_3), 1);
  assert.equal(p.items.get(I.SCARAB_MOULD) ?? 0, 0);
  p.amountAction.execute(1118513);
  assert.equal(p.items.get(I.CHEST_3), 0);
  assert.equal(p.items.get(I.SCARAB_MOULD), 1);
});

test('Beneath Cursed Sands: entry inspection publishes native 13844 and login restores it', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 14);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(13844), 0, 'an uninspected entry stays zero');
  const entry = h.object(p, 44008);
  assert.equal(entry.handled, true);
  assert.equal(h.quest.getStage(p), 16);
  assert.equal(p.varbits.get(13844), 1, 'inspecting the blocked entry publishes 1');
  p.varbits.delete(13844);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(13844), 1, 'login restores the persisted inspection');
  const pristine = player();
  h.quest.setStage(pristine, 14);
  h.hooks.onPlayerLogin[0]({ player: pristine });
  assert.equal(pristine.varbits.get(13844), 0);
});

test('Beneath Cursed Sands: tablet and mould progress publishes 13847 without advancing', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 32);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(13847), 0, 'unfinished tablet events stay zero');
  p.varbits.set(13844, 1);

  h.action(p, 11474, 'PCiLey');
  assert.equal(h.quest.getStage(p), 32, 'finding the tablet does not advance the quest');
  assert.equal(p.varbits.get(13847), 1, 'found tablet is native 1');

  h.itemAction(p, I.STONE_TABLET_5, 'Read');
  assert.equal(h.quest.getStage(p), 32, 'reading the tablet does not advance the quest');
  assert.equal(p.varbits.get(13847), 2, 'read tablet is native 2, which Quest Helper requires');
  assert.equal(p.varbits.get(13844), 1, 'the sibling 13844 bit survives');

  p.varbits.delete(13847);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(13847), 2, 'login restores the read tablet');

  p.items.set(I.CHEST_3, 1);
  h.itemAction(p, I.CHEST_3, 'Open');
  p.amountAction.execute(1118513);
  assert.equal(h.quest.getStage(p), 32, 'opening the chest does not advance the quest');
  assert.equal(p.varbits.get(13847), 4, 'recovering the mould is native 4');
  p.varbits.delete(13847);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(13847), 4, 'login restores the found mould');
});

test('Beneath Cursed Sands: the recorded chemistry valves reach 12/39/45', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 82);
  const table = h.object(p, 43991);
  assert.equal(table.handled, true);
  assert.ok(p.interfaces.includes(751));
  for (let i = 0; i < 15; i++) h.button(p, (751 << 16) | 25);
  for (let i = 0; i < 15; i++) h.button(p, (751 << 16) | 27);
  h.button(p, (751 << 16) | 28);
  h.button(p, (751 << 16) | 26);
  h.button(p, (751 << 16) | 28);
  h.button(p, (751 << 16) | 26);
  assert.equal(p.varbits.get(13863), 12);
  assert.equal(p.varbits.get(13864), 39);
  assert.equal(p.varbits.get(13865), 45);
  assert.equal(h.quest.getStage(p), 84);
  assert.equal(h.transcripts.at(-1)[4], 'cure-me-pox-warming-up-the-equipment');
});

test('Contact: actual transcript choice and condition events credit both Maisa answers', () => {
  for (const npcId of [3876, 6164]) {
    const h = harness('../plugins/quests/quests/Contact.Quest');
    const p = player();
    h.quest.setStage(p, 50);
    const choices = ['Draynor Village.', 'Leela.'];
    const previousConditions = [...PluginManager.npcDialogueConditionHooks];
    for (const handler of h.hooks.onNpcDialogueCondition ?? []) PluginManager.npcDialogueConditionHooks.push({ pluginName: 'Contact.Quest', handler });
    h.api.sendMultiChatboxPrompt = (player, title, ...pairs) => {
      const wanted = choices.shift();
      const index = pairs.indexOf(wanted);
      assert.ok(index >= 0, `missing option ${wanted} in ${pairs.filter(x => typeof x === 'string')}`);
      pairs[index + 1]();
      return true;
    };
    let current;
    const manager = {
      reset() {}, advance() {}, getCurrent: () => current,
      startDialogues(chain) {
        current = chain;
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          if (current !== chain) break;
          if (entry.constructor.name === 'ActionDialogue') entry.send(p);
          else entry.send?.(p);
        }
      },
    };
    p.getDialogueManager = () => manager;
    const { loadTranscripts } = require('../plugins/quests/QuestRuntime');
    const record = loadTranscripts(h.api)['Contact!'];
    const { startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');
    const definition = { getName: () => 'Maisa', getId: () => npcId };
    const event = { player: p, npcId, definition };
    startDialogue(h.api, event, record.variants['kaleef-s-corpse-talking-to-maisa'], record.branches, {
      player: p, npc: event.npc, npcId, definition, pages: [{ page: 'Contact!', variants: ['kaleef-s-corpse-talking-to-maisa'] }],
    });
    try {
      assert.equal(h.quest.getStage(p), 60, `both correct answers must advance 50 -> 60 for npc ${npcId}`);
    } finally {
      PluginManager.npcDialogueConditionHooks.splice(0, PluginManager.npcDialogueConditionHooks.length, ...previousConditions);
    }
  }
});
test('Beneath Cursed Sands: pillar interface 750 requires three clicks and advances to 38', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 36);
  h.action(p, 11474, 'aCMKC-');
  assert.ok(p.interfaces.includes(750));
  assert.equal(p.varbits.get(13849), 18);
  for (let i = 0; i < 3; i++) h.button(p, (750 << 16) | 8);
  assert.equal(p.varbits.get(13849), 15);
  assert.equal(h.quest.getStage(p), 36);
  h.button(p, (750 << 16) | 9);
  assert.equal(h.quest.getStage(p), 38);
  p.interfaces.length = 0;
  h.quest.setStage(p, 36);
  h.object(p, 43900);
  assert.ok(p.interfaces.includes(750), 're-entering the pillar at stage 36 must reopen 750');
  assert.match(p.messages.at(-1), /click from the nearby entry/);
});

test('Beneath Cursed Sands: closing and reopening the pillar keeps rotation progress', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 36);
  h.object(p, 43900);
  h.button(p, (750 << 16) | 8);
  assert.equal(p.varbits.get(13849), 17);
  p.interfaces.length = 0;
  h.object(p, 43900);
  assert.ok(p.interfaces.includes(750));
  assert.equal(p.varbits.get(13849), 17, 'reopening must not reset the rotation');
});

test('Beneath Cursed Sands: tomb entry uses the captured camera heights and holds for 12 ticks', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 36);
  h.object(p, 43954);
  assert.deepEqual(p.camera.find((entry) => entry[0] === 'move'), ['move', 3420, 9241, 580]);
  assert.deepEqual(p.camera.find((entry) => entry[0] === 'look'), ['look', 3410, 9252, 380]);
  assert.equal(h.quest.getStage(p), 40);
  h.tick(12);
  assert.equal(p.camera.at(-1)[0], 'reset', 'camera must reset after the captured hold');
});

test('Beneath Cursed Sands: recorded lore panels 748 and 749 use their widget text', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 32);
  h.itemAction(p, I.STONE_TABLET_5, 'Read');
  assert.ok(p.interfaces.includes(748));
  assert.match(p.strings.get(((748) << 16) | 4), /Zamorakians are coming/);
  h.object(p, 43971);
  assert.ok(p.interfaces.includes(749));
  assert.match(p.strings.get(((749) << 16) | 3), /great sacrifice/);
});

test('Beneath Cursed Sands: the necropolis arrival sends the captured camera pair', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.action(p, 11474, 'xBeK96');
  assert.deepEqual(p.camera.find((entry) => entry[0] === 'move'), ['move', 3322, 2743, 480]);
  assert.deepEqual(p.camera.find((entry) => entry[0] === 'look'), ['look', 3332, 2735, 290]);
});
test('Contact: cut scene 1 sends the captured camera pair and resets', () => {
  const h = harness('../plugins/quests/quests/Contact.Quest');
  const p = player();
  h.action(p, 4206, 'DFAYNr');
  h.tick(2);
  assert.ok(p.camera.some((entry) => entry[0] === 'move' && entry[1] === 3278 && entry[2] === 2786 && entry[3] === 480));
  assert.ok(p.camera.some((entry) => entry[0] === 'look' && entry[1] === 3261 && entry[2] === 2783 && entry[3] === 320));
});

function lampMenu(p) {
  assert.ok(p.lastBuilder, 'lamp Rub should open a dialogue menu');
  return [...p.lastBuilder.getDialogues().values()].find(entry => typeof entry.getOptions === 'function');
}

function putLamp(p, slot) {
  const item = new core.Item(I.COMBAT_LAMP, 1);
  p.slots[slot] = item;
  p.items.set(I.COMBAT_LAMP, 1);
  return item;
}

test('Contact: Combat lamp Rub grants two 7000 XP wishes and deletes after the second', () => {
  const h = harness('../plugins/quests/quests/Contact.Quest');
  const p = player();
  putLamp(p, 5);

  const rub = h.itemAction(p, I.COMBAT_LAMP, 'Rub', 5);
  assert.equal(rub.handled, true);
  let menu = lampMenu(p);
  assert.equal(menu.getTitle(), '<col=000080>Which stat do you wish for?');
  assert.deepEqual(menu.getOptions(), ['Attack.', 'Strength.', 'Defence.', 'Hitpoints.', 'Another wish.']);

  menu.execute(2); // Strength.
  assert.equal(p.xpBySkill.get(core.Skill.STRENGTH), 7000);
  assert.equal(p.varbits.get(3287), 1);
  assert.equal(p.slots[5]?.getId(), I.COMBAT_LAMP, 'first wish keeps the lamp');
  menu.execute(2); // repeated confirm on the consumed menu
  assert.equal(p.xpBySkill.get(core.Skill.STRENGTH), 7000, 'repeated Rub choice cannot double-pay');

  h.itemAction(p, I.COMBAT_LAMP, 'Rub', 5);
  lampMenu(p).execute(5); // Another wish.
  menu = lampMenu(p);
  assert.equal(menu.getTitle(), '<col=000080>Which stat do you wish for?');
  assert.deepEqual(menu.getOptions(), ['Ranged.', 'Magic.', 'Nothing at the moment.', 'Previous wishes.']);
  menu.execute(1); // Ranged.
  assert.equal(p.xpBySkill.get(core.Skill.RANGED), 7000);
  assert.equal(p.varbits.get(3287), 2);
  assert.equal(p.slots[5], undefined, 'second wish deletes the lamp');
  assert.ok(p.messages.includes('The lamp dissipates into smoke that drifts away.'));

  p.lastBuilder = null;
  h.itemAction(p, I.COMBAT_LAMP, 'Rub', 5);
  assert.equal(p.lastBuilder, null, 'third wish cannot open a reward menu');
});

test('Contact: Combat lamp menus keep the lamp without XP (nothing, relog, moved/gone, XP blocked)', () => {
  const h = harness('../plugins/quests/quests/Contact.Quest');

  // Nothing at the moment / Previous wishes.
  let p = player();
  putLamp(p, 5);
  h.itemAction(p, I.COMBAT_LAMP, 'Rub', 5);
  lampMenu(p).execute(5);
  lampMenu(p).execute(3); // Nothing at the moment.
  assert.equal(p.varbits.get(3287) ?? 0, 0);
  assert.equal(p.slots[5]?.getId(), I.COMBAT_LAMP);
  h.itemAction(p, I.COMBAT_LAMP, 'Rub', 5);
  lampMenu(p).execute(5);
  lampMenu(p).execute(4); // Previous wishes.
  assert.deepEqual(lampMenu(p).getOptions(), ['Attack.', 'Strength.', 'Defence.', 'Hitpoints.', 'Another wish.']);

  // Relog syncs the persisted wish count to varbit 3287.
  p.attributes.set('contact:lamp-wishes', 1);
  p.varbits.delete(3287);
  h.hooks.onPlayerLogin[0]({ player: p });
  assert.equal(p.varbits.get(3287), 1);

  // Moved after the menu opened: no XP, nothing consumed.
  p = player();
  putLamp(p, 5);
  h.itemAction(p, I.COMBAT_LAMP, 'Rub', 5);
  const movedMenu = lampMenu(p);
  p.slots[6] = p.slots[5]; p.slots[5] = undefined;
  movedMenu.execute(1);
  assert.equal(p.xpBySkill.get(core.Skill.ATTACK), undefined);
  assert.equal(p.varbits.get(3287) ?? 0, 0);
  assert.equal(p.slots[6]?.getId(), I.COMBAT_LAMP);

  // Replaced by a different Item instance with the same id: stale menu rejects.
  p = player();
  putLamp(p, 5);
  h.itemAction(p, I.COMBAT_LAMP, 'Rub', 5);
  const replacedMenu = lampMenu(p);
  p.slots[5] = new core.Item(I.COMBAT_LAMP, 1);
  replacedMenu.execute(1);
  assert.equal(p.xpBySkill.get(core.Skill.ATTACK), undefined);
  assert.equal(p.varbits.get(3287) ?? 0, 0);
  assert.equal(p.slots[5]?.getId(), I.COMBAT_LAMP);

  // Item gone before confirmation: no XP and no varbit change.
  p = player();
  putLamp(p, 5);
  h.itemAction(p, I.COMBAT_LAMP, 'Rub', 5);
  const goneMenu = lampMenu(p);
  p.slots[5] = undefined; p.items.set(I.COMBAT_LAMP, 0);
  goneMenu.execute(1);
  assert.equal(p.xpBySkill.get(core.Skill.ATTACK), undefined);
  assert.equal(p.varbits.get(3287) ?? 0, 0);

  // XP blocked: keep the lamp and let the player retry.
  p = player();
  putLamp(p, 5);
  p.blockXp = true;
  h.itemAction(p, I.COMBAT_LAMP, 'Rub', 5);
  lampMenu(p).execute(1);
  assert.equal(p.varbits.get(3287) ?? 0, 0);
  assert.equal(p.slots[5]?.getId(), I.COMBAT_LAMP);
  assert.ok(p.messages.includes('You cannot gain experience in that skill right now.'));
});

test('Beneath Cursed Sands: the finale starts on the captured necropolis camera', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 92);
  h.action(p, 11474, 'PZPIrV');
  assert.deepEqual(p.camera.find((entry) => entry[0] === 'move'), ['move', 3331, 2731, 630]);
  assert.deepEqual(p.camera.find((entry) => entry[0] === 'look'), ['look', 3349, 2724, 310]);
});
test('Beneath Cursed Sands: logout resets a running camera', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.action(p, 11474, 'xBeK96');
  h.hooks.onPlayerLogout[0]({ player: p });
  assert.equal(p.camera.at(-1)[0], 'reset');
});
test('Beneath Cursed Sands: real cache entry -> citizen -> guard -> ruins keeps stage order', async () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 14);
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const cachedEntry = CacheDefinitions.getObject(44008);
  assert.equal(cachedEntry?.name, 'Blocked Entry');
  const entryDefinition = { ...cachedEntry, getId: () => cachedEntry.id, getName: () => cachedEntry.name, getInteractions: () => cachedEntry.actions };
  const entry = h.object(p, 44008, 1, entryDefinition);
  assert.equal(entry.handled, true);
  assert.equal(h.quest.getStage(p), 16);
  assert.equal(h.transcripts.at(-1)[4], 'starting-off-inspecting-the-blocked-entry-after-finishing-the-cutscene');
  for (const npcId of [11537, 11540]) {
    const definition = core.NpcDefinition.forId(npcId);
    assert.equal(definition.getActions()[0].toLowerCase(), 'talk-to');
    const citizenEvent = { player: p, npcId, clickType: 1, definition, handled: false };
    h.hooks.onNpcInteraction[0](citizenEvent);
    assert.equal(citizenEvent.handled, true, `citizen ${npcId} Talk-to must dispatch`);
    assert.equal(h.transcripts.at(-1)[4], 'starting-off-talking-to-a-citizen');
  }
  h.action(p, 11537, 'fyqclq');
  assert.equal(p.movementBlocked, true, 'the guard cut scene blocks movement');
  h.action(p, 11537, 'V9HUjH');
  assert.equal(p.movementBlocked, false, 'the guard fight must clear the cut-scene movement lock');
  assert.equal(h.quest.getStage(p), 18);
  const guard = h.npcs.find(npc => npc.id === 11529);
  assert.ok(guard, 'the Head Menaphite Guard must spawn for the triggered fight');
  h.hooks.onNpcDeath[0]({ killer: p, npc: guard, npcId: 11529 });
  assert.equal(h.quest.getStage(p), 20);
  h.emit('npc-dialogue:line', { player: p, npcId: 11474, text: 'Will do.' });
  assert.equal(h.quest.getStage(p), 22);
  h.action(p, 11474, 'Jpi6NF');
  assert.equal(h.quest.getStage(p), 26);
});

test('Contact: the canonical Maisa spawn is the captured chasm tile', () => {
  const spawns = require('../data/definitions/npc-spawns.json');
  const maisa = spawns.filter(entry => entry.id === 6164);
  assert.deepEqual(maisa.map(({ x, y }) => [x, y]), [[2258, 4317]]);
});
test('Beneath Cursed Sands: urn riddle requires the exact map and lever opens only at 48', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const urnDef = CacheDefinitions.getObject(43979);
  const urnObject = { ...urnDef, getId: () => urnDef.id, getName: () => urnDef.name, getInteractions: () => urnDef.actions };
  const place = (y, emblemId, action) => {
    p.items.set(emblemId, 1);
    h.object(p, 43979, 1, urnObject, new core.Location(3394, y, 0));
    h.action(p, 11474, action);
  };
  h.quest.setStage(p, 46);
  place(9247, 26953, 's3vs8q'); // wrong: scarab in centre-south
  h.action(p, 11474, 'vRtBKz');
  assert.equal(h.quest.getStage(p), 46, 'wrong map must not advance');
  assert.match(p.messages.at(-1), /doesn't budge/);

  p.items.set(26953, 0);
  p.attributes.set('beneath-cursed-sands:urns', 0);
  place(9251, 26953, 's3vs8q'); // northern scarab
  place(9249, 26957, '1VnAt1'); // centre-north human
  place(9247, 26958, 'Gu8Ien'); // centre-south baboon
  place(9245, 26959, 'itrHbI'); // southern crocodile
  h.action(p, 11474, 'vRtBKz');
  assert.equal(h.quest.getStage(p), 48);
});

test('Beneath Cursed Sands: tomb levers reset after 100 ticks and open only when fast', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const leverDef = CacheDefinitions.getObject(43967);
  const leverObject = { ...leverDef, getId: () => leverDef.id, getName: () => leverDef.name, getInteractions: () => leverDef.actions };
  const lever = (y) => h.object(p, 43967, 1, leverObject, new core.Location(3439, y, 0));
  h.quest.setStage(p, 42);
  lever(9225);
  assert.equal(h.quest.getStage(p), 44);
  h.advanceClock(101);
  lever(9271);
  assert.equal(h.quest.getStage(p), 44, 'late second lever must reset');
  lever(9225);
  h.advanceClock(1);
  lever(9271);
  assert.equal(h.quest.getStage(p), 46);
});

test('Beneath Cursed Sands: inner lever door is denied before the solved urn riddle', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 46);
  const denied = { player: p, objectId: 43962, location: new core.Location(3389, 9248, 0), handled: false };
  h.emit('door:toggle', denied);
  assert.equal(denied.handled, true);
  h.quest.setStage(p, 48);
  p.attributes.set('beneath-cursed-sands:urns', (4) | (2 << 4) | (1 << 8) | (3 << 12));
  const allowed = { player: p, objectId: 43962, location: new core.Location(3389, 9248, 0), handled: false };
  h.emit('door:toggle', allowed);
  assert.equal(allowed.handled, false, 'Doors.plugin owns the allowed open leaf');
});
test('Beneath Cursed Sands: shipped guard transcript clears scene controls and spawns the fight', async () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 16);
  h.action(p, 11537, 'fyqclq');
  assert.equal(p.movementBlocked, true);
  let current;
  const manager = {
    reset() {}, advance() {}, getCurrent: () => current,
    startDialogues(chain) {
      current = chain;
      for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
        if (current !== chain) break;
        if (entry.constructor.name === 'ActionDialogue') entry.send(p);
        else entry.send?.(p);
      }
    },
  };
  p.getDialogueManager = () => manager;
  const { loadTranscripts } = require('../plugins/quests/QuestRuntime');
  const { startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');
  const record = loadTranscripts(h.api)['Beneath Cursed Sands'];
  const definition = core.NpcDefinition.forId(11537);
  const event = { player: p, npcId: 11537, definition };
  startDialogue(h.api, event, record.variants['starting-off-guard-cutscene'], record.branches, {
    player: p, npc: event.npc, npcId: 11537, definition, pages: [{ page: 'Beneath Cursed Sands', variants: ['starting-off-guard-cutscene'] }],
  });
  assert.equal(h.quest.getStage(p), 18);
  assert.equal(p.movementBlocked, false);
  assert.ok(h.npcs.some(npc => npc.id === 11529));
});
test('Beneath Cursed Sands: tomb entry uses the captured z2 instance landing and actors', async () => {
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 38);
  p.moveTo(new core.Location(3412, 2848, 0));
  const entryRaw = CacheDefinitions.getObject(43954);
  const entry = { ...entryRaw, getId: () => entryRaw.id, getName: () => entryRaw.name, getInteractions: () => entryRaw.actions };
  h.object(p, 43954, 1, entry, new core.Location(3408, 2847, 0));
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3445, 9248, 2]);
  assert.equal(h.quest.getStage(p), 40);
  assert.equal(h.transcripts.at(-1)[4], 'the-ruins-of-ullek-entering-the-ruins');
  const mage1 = h.npcs.find(npc => npc.id === 11508 && npc.x === 3438 && npc.y === 9247);
  const mage2 = h.npcs.find(npc => npc.id === 11508 && npc.x === 3438 && npc.y === 9249);
  assert.equal(mage1?.z, 2);
  assert.equal(mage2?.z, 2);
  assert.ok(h.npcs.some(npc => npc.id === 11481 && npc.x === 3410 && npc.y === 9248 && npc.z === 2));
  assert.ok(h.npcs.some(npc => npc.id === 11482 && npc.x === 3411 && npc.y === 9251 && npc.z === 2));
  RegionManager.loadMapFiles(3445, 9248, true);
  assert.equal(RegionManager.blocked(new core.Location(3445, 9248, 2), null), false);
  assert.equal(RegionManager.blocked(new core.Location(3438, 9247, 2), null), false);
  assert.equal(RegionManager.blocked(new core.Location(3438, 9249, 2), null), false);
});
test('Beneath Cursed Sands: allowed inner/outer doors fall through to the normal Doors path', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 56);
  p.attributes.set('beneath-cursed-sands:urns', (4) | (2 << 4) | (1 << 8) | (3 << 12));
  for (const objectId of [43961, 43962]) {
    const request = { player: p, objectId, location: new core.Location(3389, 9248, 0), handled: false };
    h.emit('door:toggle', request);
    assert.equal(request.handled, false, `allowed ${objectId} must be opened by Doors.plugin`);
  }
  h.quest.setStage(p, 46);
  p.attributes.set('beneath-cursed-sands:urns', 0);
  const denied = { player: p, objectId: 43962, location: new core.Location(3389, 9248, 0), handled: false };
  h.emit('door:toggle', denied);
  assert.equal(denied.handled, true, 'unsolved inner door stays claimed/denied');
  assert.equal(h.transcripts.at(-1)[4], 'the-ruins-of-ullek-opening-the-downstairs-locked-door');
});
test('Beneath Cursed Sands: the key urn can replace a lost rusty key after stage 56', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 56);
  h.action(p, 11474, 'ppIMnm');
  assert.equal(p.items.get(I.RUSTY_KEY), 1);
});
test('Beneath Cursed Sands: 43960 is the keyed upper door, applying 56 -> 58 once', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 56);
  p.items.set(I.RUSTY_KEY, 1);
  p.moveTo(new core.Location(3433, 9248, 2));
  const door = h.object(p, 43960, 1, null, new core.Location(3432, 9248, 2));
  assert.equal(door.handled, true);
  assert.equal(h.transcripts.at(-1)[4], 'the-ruins-of-ullek-opening-the-upstairs-locked-door');
  h.action(p, 11474, 'MQFYdD');
  assert.equal(p.items.get(I.RUSTY_KEY), 0);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3420, 9248, 2]);
  assert.equal(h.quest.getStage(p), 58);
  h.action(p, 11474, 'MQFYdD');
  assert.equal(h.quest.getStage(p), 58, 'stage 58 must be applied once');
});
test('Beneath Cursed Sands: 43963 is the normal champion door after the keyed door', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 58);
  p.moveTo(new core.Location(3420, 9248, 2));
  const door = h.object(p, 43963, 1, null, new core.Location(3421, 9248, 2));
  assert.equal(door.handled, true);
  assert.equal(h.quest.getStage(p), 58);
  h.quest.setStage(p, 62);
  h.object(p, 43963, 1, null, new core.Location(3421, 9248, 2));
  assert.equal(h.quest.getStage(p), 62);
});
test('Beneath Cursed Sands: 43960 starts the west Champion intro and reaches stage 60', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 56);
  p.items.set(I.RUSTY_KEY, 1);
  p.moveTo(new core.Location(3433, 9248, 2));
  h.object(p, 43960, 1, null, new core.Location(3432, 9248, 2));
  assert.equal(h.transcripts.at(-1)[4], 'the-ruins-of-ullek-opening-the-upstairs-locked-door');
  h.action(p, 11474, 'MQFYdD');
  assert.equal(p.items.get(I.RUSTY_KEY), 0);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3420, 9248, 2]);
  assert.equal(h.quest.getStage(p), 58);
  const keyedDoor = { player: p, objectId: 43960, location: new core.Location(3432, 9248, 2), handled: false };
  h.emit('door:toggle', keyedDoor);
  assert.equal(keyedDoor.handled, true, 'keyed phase still owns 43960');
  h.tick(2);
  assert.ok(h.transcripts.some(t => t[4] === 'the-ruins-of-ullek-the-champion-of-scabaras'), 'captured intro starts');
  assert.ok(h.npcs.some(n => n.id === 11481 && n.x === 3410 && n.y === 9248 && n.z === 2));
  assert.ok(h.npcs.some(n => n.id === 11482 && n.x === 3411 && n.y === 9251 && n.z === 2));
  h.emit('npc-dialogue:line', { player: p, npcId: 11481, text: "Fine. We'll do it your way." });
  assert.equal(h.quest.getStage(p), 60);
  assert.ok(h.npcs.some(n => n.id === 11483 && n.x === 3411 && n.y === 9251 && n.z === 2), 'combat champion spawns west');
  const champion = h.npcs.find(n => n.id === 11483 && !n.removed);
  h.hooks.onNpcDeath[0]({ killer: p, npc: champion });
  assert.equal(h.quest.getStage(p), 62);
  assert.ok(h.npcs.some(n => n.id === 11480 && n.x === 3407 && n.y === 9248 && n.z === 2), 'High Priest reachable west tile');
  const afterDoor = { player: p, objectId: 43960, location: new core.Location(3432, 9248, 2), handled: false };
  h.emit('door:toggle', afterDoor);
  assert.equal(afterDoor.handled, false, 'post-fight 43960 falls through to Doors.plugin');
  const afterObject = h.object(p, 43960, 1, null, new core.Location(3432, 9248, 2));
  assert.equal(afterObject.handled, false, 'post-fight Open uses the normal Doors path');
  const championDoor = { player: p, objectId: 43963, location: new core.Location(3421, 9248, 2), handled: false };
  h.emit('door:toggle', championDoor);
  assert.equal(championDoor.handled, true, '43963 remains the quest champion door');
  h.emit('npc-dialogue:line', { player: p, npcId: 11480, text: 'Good luck in your fight, adventurer. May Scabaras guide you.' });
  assert.equal(h.quest.getStage(p), 68);
});
test('Beneath Cursed Sands: captured boss-area tiles are walkable and connected on the real map', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  RegionManager.loadMapFiles(3420, 9248, true);
  const at = (x, y) => new core.Location(x, y, 2);
  assert.equal(RegionManager.blocked(at(3420, 9248), null), false, 'keyed landing walkable');
  assert.equal(RegionManager.blocked(at(3411, 9251), null), false, 'champion tile walkable');
  assert.equal(RegionManager.blocked(at(3407, 9248), null), false, 'High Priest tile walkable');
  const seen = new Set(['3420,9248']);
  const queue = [[3420, 9248]];
  const goals = new Set(['3411,9251', '3407,9248']);
  const reached = new Set();
  while (queue.length) {
    const [x, y] = queue.shift();
    if (goals.has(`${x},${y}`)) reached.add(`${x},${y}`);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (seen.has(key) || nx < 3380 || nx > 3450 || ny < 9230 || ny > 9270) continue;
      if (RegionManager.blocked(at(nx, ny), null)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  assert.ok(reached.has('3411,9251'), 'champion reachable from the landing');
  assert.ok(reached.has('3407,9248'), 'High Priest reachable from the landing');
  const closed = CacheDefinitions.getObject(43960);
  const open = CacheDefinitions.getObject(43964);
  assert.ok(closed.actions.includes('Open'));
  assert.deepEqual(open.models, closed.models);
  assert.ok(!open.actions?.some(Boolean), '43964 is the actionless open leaf');
  assert.equal(CacheDefinitions.getNpc(11483).name, 'Champion of Scabaras');
});
test('Beneath Cursed Sands: saved 58 outside re-enters 43960 without a key and starts the intro', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 58);
  p.moveTo(new core.Location(3432, 9248, 2));
  let resets = 0;
  p.getMovementQueue = () => ({ reset() { resets++; return this; }, setBlockMovement() { return this; } });
  h.hooks.onPlayerLogin[0]({ player: p });
  h.tick(2);
  assert.ok(!h.transcripts.some(t => t[4] === 'the-ruins-of-ullek-the-champion-of-scabaras'), 'login outside the arena must not auto-start');
  const ev = h.object(p, 43960, 1, null, new core.Location(3432, 9248, 2));
  assert.equal(ev.handled, true);
  assert.equal(p.items.get(I.RUSTY_KEY) ?? 0, 0, 'unlocked re-entry grants no key');
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3420, 9248, 2]);
  assert.equal(h.quest.getStage(p), 58);
  assert.ok(resets > 0, 'queued movement reset before the captured move');
  h.tick(2);
  assert.ok(h.transcripts.some(t => t[4] === 'the-ruins-of-ullek-the-champion-of-scabaras'), 'intro starts after re-entry');
  h.emit('npc-dialogue:line', { player: p, npcId: 11481, text: "Fine. We'll do it your way." });
  assert.equal(h.quest.getStage(p), 60);
  assert.ok(h.npcs.some(n => n.id === 11483 && n.x === 3411 && n.y === 9251 && n.z === 2));

  const h2 = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p2 = player();
  h2.quest.setStage(p2, 58);
  p2.moveTo(new core.Location(3432, 9248, 2));
  const req = { player: p2, objectId: 43960, location: new core.Location(3432, 9248, 2), handled: false };
  h2.emit('door:toggle', req);
  assert.equal(req.handled, true, 'Doors-first claim also re-enters');
  assert.deepEqual([p2.getLocation().getX(), p2.getLocation().getY(), p2.getLocation().getZ()], [3420, 9248, 2]);
  h2.tick(2);
  assert.ok(h2.transcripts.some(t => t[4] === 'the-ruins-of-ullek-the-champion-of-scabaras'));
});
test('Beneath Cursed Sands: login inside the west arena resumes the unfinished 58 intro', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 58);
  p.moveTo(new core.Location(3420, 9248, 2));
  h.hooks.onPlayerLogin[0]({ player: p });
  h.tick(2);
  assert.ok(h.transcripts.some(t => t[4] === 'the-ruins-of-ullek-the-champion-of-scabaras'), 'inside-room login resumes the intro');
  assert.equal(h.quest.getStage(p), 58);
});
test('Beneath Cursed Sands: captured Akh and finale Osman complete 96 -> 102', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 96);
  h.emit('npc-dialogue:action', { player: p, stepId: '31LmTQ' });
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3368, 2788, 0]);
  const fight = { player: p, stepId: 'VNowdJ', handled: false };
  h.emit('npc-dialogue:action', fight);
  assert.equal(fight.handled, true);
  assert.equal(h.quest.getStage(p), 98);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3369, 2803, 0]);
  assert.ok(h.npcs.some(n => n.id === 11492 && n.x === 3369 && n.y === 2805 && n.z === 0), 'Akh combat at captured tile');
  const akh = h.npcs.find(n => n.id === 11492 && !n.removed);
  h.hooks.onNpcDeath[0]({ killer: p, npc: akh });
  assert.equal(h.quest.getStage(p), 100);
  assert.ok(h.npcs.some(n => n.id === 11486 && n.x === 3371 && n.y === 2801 && n.z === 0), 'raw/content Osman at captured tile');
  assert.ok(!h.npcs.some(n => n.id === 1809), 'no town Osman spawn');
  const talk = { player: p, npcId: 11486, clickType: 1, definition: { getActions: () => ['Talk-to'] }, handled: false };
  for (const hook of h.hooks.onNpcInteraction) hook(talk);
  assert.equal(talk.handled, true, 'Talk-to dispatches the BCS Osman family');
  const transcript = h.transcripts.at(-1);
  assert.equal(transcript[2], 11486, 'correct non-town head id');
  assert.equal(transcript[3], 'Beneath Cursed Sands');
  assert.equal(transcript[4], 'fight-with-the-menaphite-akh-defeating-the-menaphite-akh');
  h.emit('npc-dialogue:action', { player: p, stepId: '1WDBi3' });
  assert.equal(h.quest.getStage(p), 102);
});
test('Beneath Cursed Sands: captured Akh/Osman tiles are walkable and connected', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  RegionManager.loadMapFiles(3369, 2803, true);
  const at = (x, y) => new core.Location(x, y, 0);
  for (const [x, y] of [[3368, 2788], [3369, 2803], [3369, 2805], [3371, 2801]]) {
    assert.equal(RegionManager.blocked(at(x, y), null), false, `${x},${y} walkable`);
  }
  const seen = new Set(['3369,2803']);
  const queue = [[3369, 2803]];
  const goals = new Set(['3369,2805', '3371,2801']);
  const reached = new Set();
  while (queue.length) {
    const [x, y] = queue.shift();
    if (goals.has(`${x},${y}`)) reached.add(`${x},${y}`);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (seen.has(key) || nx < 3350 || nx > 3390 || ny < 2770 || ny > 2820) continue;
      if (RegionManager.blocked(at(nx, ny), null)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  assert.ok(reached.has('3369,2805'), 'player can reach the Akh');
  assert.ok(reached.has('3371,2801'), 'player can reach Osman');
});
test('Beneath Cursed Sands: 43988 Cross is allowed from the captured bank, then Roger 76 and lily 78', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 72);
  p.moveTo(new core.Location(3353, 2921, 0));
  p.items.set(2132, 1); // raw beef
  const stoneObject = { getLocation: () => new core.Location(3353, 2923, 0) };
  const cross = { getInteractions: () => ['Cross'] };
  const route = { player: p, object: stoneObject, definition: cross, objectId: 43988, clickType: 1, sourceLocation: { x: 3353, y: 2921, z: 0 }, destination: null };
  h.hooks.onObjectRoute[0](route);
  assert.deepEqual(route.destination, { x: 3353, y: 2921, z: 0 }, 'Cross runs from the captured bank tile');
  h.quest.setStage(p, 70);
  const wrongStage = { player: p, object: stoneObject, definition: cross, objectId: 43988, clickType: 1, sourceLocation: { x: 3353, y: 2921, z: 0 }, destination: null };
  h.hooks.onObjectRoute[0](wrongStage);
  assert.equal(wrongStage.destination, null, 'no route before 72');
  h.quest.setStage(p, 72);
  const wrongObject = { player: p, object: stoneObject, definition: cross, objectId: 43990, clickType: 1, sourceLocation: { x: 3353, y: 2921, z: 0 }, destination: null };
  h.hooks.onObjectRoute[0](wrongObject);
  assert.equal(wrongObject.destination, null, 'other water objects unchanged');
  const wrongOption = { player: p, object: stoneObject, definition: { getInteractions: () => ['Examine'] }, objectId: 43988, clickType: 1, sourceLocation: { x: 3353, y: 2921, z: 0 }, destination: null };
  h.hooks.onObjectRoute[0](wrongOption);
  assert.equal(wrongOption.destination, null, 'non-Cross option unchanged');
  const farStone = { getLocation: () => new core.Location(3354, 2923, 0) };
  const otherPlaced = { player: p, object: farStone, definition: cross, objectId: 43988, clickType: 1, sourceLocation: { x: 3353, y: 2921, z: 0 }, destination: null };
  h.hooks.onObjectRoute[0](otherPlaced);
  assert.equal(otherPlaced.destination, null, '43988 at another tile unchanged');
  p.moveTo(new core.Location(3356, 2919, 0));
  const farPlayer = { player: p, object: stoneObject, definition: cross, objectId: 43988, clickType: 1, sourceLocation: { x: 3356, y: 2919, z: 0 }, destination: null };
  h.hooks.onObjectRoute[0](farPlayer);
  assert.equal(farPlayer.destination, null, 'player more than 2 tiles away unchanged');
  p.moveTo(new core.Location(3353, 2921, 1));
  const wrongPlane = { player: p, object: stoneObject, definition: cross, objectId: 43988, clickType: 1, sourceLocation: { x: 3353, y: 2921, z: 1 }, destination: null };
  h.hooks.onObjectRoute[0](wrongPlane);
  assert.equal(wrongPlane.destination, null, 'wrong plane unchanged');
  p.moveTo(new core.Location(3353, 2921, 0));
  const stone = h.object(p, 43988, 1, null, new core.Location(3353, 2923, 0));
  assert.equal(stone.handled, true);
  assert.equal(h.quest.getStage(p), 74);
  assert.equal(h.transcripts.at(-1)[4], 'cure-me-pox-crossing-the-river-to-the-island-crossing-river-while-holding-meat');
  h.emit('npc-dialogue:action', { player: p, stepId: 'V1ApkO' });
  assert.equal(h.quest.getStage(p), 76);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()], [3353, 2926, 0]);
  assert.equal(p.items.get(2132) ?? 0, 0, 'meat consumed for Roger');
  const lilyObject = { getLocation: () => new core.Location(3353, 2927, 0) };
  const pick = { getInteractions: () => ['Pick'] };
  const islandRoute = { player: p, object: lilyObject, definition: pick, objectId: 44593, clickType: 1, sourceLocation: { x: 3353, y: 2926, z: 0 }, destination: null };
  h.hooks.onObjectRoute[0](islandRoute);
  assert.deepEqual(islandRoute.destination, { x: 3353, y: 2926, z: 0 }, 'lily click allowed from the scripted island landing');
  p.moveTo(new core.Location(3353, 2925, 0));
  const farLily = { player: p, object: lilyObject, definition: pick, objectId: 44593, clickType: 1, sourceLocation: { x: 3353, y: 2925, z: 0 }, destination: null };
  h.hooks.onObjectRoute[0](farLily);
  assert.equal(farLily.destination, null, 'lily more than 1 tile away unchanged');
  p.moveTo(new core.Location(3353, 2926, 0));
  const lily = h.object(p, 44593, 1, null, new core.Location(3353, 2927, 0));
  assert.equal(lily.handled, true);
  assert.equal(h.transcripts.at(-1)[4], 'cure-me-pox-crossing-the-river-to-the-island-picking-the-lily');
  h.emit('npc-dialogue:action', { player: p, stepId: 'L2Rz7X' });
  assert.equal(h.quest.getStage(p), 78);
  assert.equal(p.items.get(26961) ?? 0, 1, 'lily picked');
});
test('Beneath Cursed Sands: stepping stone/lily cache and map support the captured cross', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const stone = CacheDefinitions.getObject(43988);
  assert.equal(stone.name, 'Stepping stone');
  assert.ok(stone.actions.includes('Cross'));
  const lily = CacheDefinitions.getObject(43984);
  assert.equal(lily.name, 'Lily');
  assert.ok(lily.actions.includes('Pick'));
  const placed = CacheDefinitions.getObject(44593);
  assert.ok(!placed.actions?.some(Boolean), '44593 is the actionless placed lily loc');
  RegionManager.loadMapFiles(3353, 2923, true);
  for (const [x, y] of [[3353, 2921], [3353, 2926]]) {
    assert.equal(RegionManager.blocked(new core.Location(x, y, 0), null), false, `${x},${y} walkable`);
  }
});
test('Beneath Cursed Sands: placed 44594 resolves to the Use chemistry table at stage 82', () => {
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 82);
  p.varbits.set(13841, 82);
  ObjectDefinition.init();
  const resolved = ObjectDefinition.forPlayer(44594, p);
  assert.equal(resolved?.id, 43991, 'cache transform 44594[82] -> 43991');
  assert.ok(resolved.getInteractions().includes('Use'), 'real current menu offers Use');
  const table = h.object(p, 44594, 1, resolved, new core.Location(3423, 2905, 0));
  assert.equal(table.handled, true);
  assert.ok(p.interfaces.includes(751), 'real 44594 click opens 751');

  const h2 = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p2 = player();
  h2.quest.setStage(p2, 82);
  const base = h2.object(p2, 44594, 1, { id: 44594, getInteractions: () => ['Use'] }, new core.Location(3423, 2905, 0));
  assert.equal(base.handled, true, 'placed base id alias handled');
  assert.ok(p2.interfaces.includes(751));
  for (let i = 0; i < 15; i++) h2.button(p2, (751 << 16) | 25);
  for (let i = 0; i < 15; i++) h2.button(p2, (751 << 16) | 27);
  h2.button(p2, (751 << 16) | 28);
  h2.button(p2, (751 << 16) | 26);
  h2.button(p2, (751 << 16) | 28);
  h2.button(p2, (751 << 16) | 26);
  assert.equal(h2.quest.getStage(p2), 84);
  assert.equal(h2.transcripts.filter(t => t[4] === 'cure-me-pox-warming-up-the-equipment').length, 1, 'puzzle completes once');
  h2.button(p2, (751 << 16) | 25);
  assert.equal(h2.quest.getStage(p2), 84, 'no second completion');
});
test('Beneath Cursed Sands: VNowdJ releases the camera before the Akh, then 100 -> 102 -> 108 once', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  h.quest.setStage(p, 96);
  const ev = { player: p, stepId: 'VNowdJ', handled: false };
  h.emit('npc-dialogue:action', ev);
  assert.equal(ev.handled, true);
  assert.equal(h.quest.getStage(p), 98);
  assert.equal(p.movementBlocked, true, 'fight camera locks controls first');
  h.tick(1);
  assert.equal(p.movementBlocked, false, 'controls released on the captured next tick');
  assert.ok(p.camera.some(entry => entry[0] === 'reset'), 'camera reset sent before the fight');
  const akh = h.npcs.find(n => n.id === 11492 && n.x === 3369 && n.y === 2805);
  assert.ok(akh, 'combat Akh at the captured tile');
  h.hooks.onNpcDeath[0]({ killer: p, npc: akh });
  assert.equal(h.quest.getStage(p), 100);
  const osman = h.npcs.find(n => n.id === 11486 && n.x === 3371 && n.y === 2801);
  assert.ok(osman, 'finish Osman at the captured tile');
  const talk = { player: p, npcId: 11486, clickType: 1, definition: { getActions: () => ['Talk-to'] }, handled: false };
  for (const hook of h.hooks.onNpcInteraction) hook(talk);
  assert.equal(talk.handled, true);
  h.emit('npc-dialogue:action', { player: p, stepId: '1WDBi3' });
  assert.equal(h.quest.getStage(p), 102);
  h.emit('npc-dialogue:action', { player: p, stepId: 'oyt_LF' });
  assert.equal(h.quest.getStage(p), 108);
  assert.equal(p.xp ?? 0, 50000, 'reward once');
  h.emit('npc-dialogue:action', { player: p, stepId: 'oyt_LF' });
  assert.equal(p.xp ?? 0, 50000, 'no duplicate reward');
});
test('Beneath Cursed Sands: full urn Remove and Swap apply real state and recovery', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const raw = CacheDefinitions.getObject(43979);
  const urn = { ...raw, getId: () => raw.id, getName: () => raw.name, getInteractions: () => raw.actions };
  h.quest.setStage(p, 46);
  p.attributes.set('beneath-cursed-sands:urns', 4 << 8); // wrong scarab in centre-south slot 3
  h.object(p, 43979, 1, urn, new core.Location(3394, 9247, 0));
  h.action(p, 11474, 'T-XWqk');
  assert.equal(p.items.get(I.SCARAB_EMBLEM), 1);
  assert.equal(p.attributes.get('beneath-cursed-sands:urns'), 0);

  p.attributes.set('beneath-cursed-sands:urns', 2 << 4); // human in centre-north slot 2
  p.items.set(I.CROCODILE_EMBLEM, 1);
  h.object(p, 43979, 1, urn, new core.Location(3394, 9249, 0));
  h.action(p, 11474, 'PvgO3l');
  assert.equal(p.attributes.get('beneath-cursed-sands:urns') & (0xf << 4), 3 << 4);
  assert.equal(p.items.get(I.CROCODILE_EMBLEM) ?? 0, 0);
  assert.equal(p.items.get(I.HUMAN_EMBLEM), 1);
});

test('Beneath Cursed Sands: full inventory refuses urn removal without state loss', () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const raw = CacheDefinitions.getObject(43979);
  const urn = { ...raw, getId: () => raw.id, getName: () => raw.name, getInteractions: () => raw.actions };
  h.quest.setStage(p, 46);
  p.attributes.set('beneath-cursed-sands:urns', 4 << 8);
  p.full = true;
  h.object(p, 43979, 1, urn, new core.Location(3394, 9247, 0));
  h.action(p, 11474, 'T-XWqk');
  assert.equal(p.attributes.get('beneath-cursed-sands:urns'), 4 << 8);
  assert.equal(p.items.get(I.SCARAB_EMBLEM) ?? 0, 0);
});

test('Contact: completed Jex uses his canonical standard dialogue', () => {
  const h = harness('../plugins/quests/quests/Contact.Quest');
  const p = player();
  h.quest.setStage(p, 130);
  assert.equal(h.variant({ player: p, npcId: 3875, npc: {} }), 'standard-dialogue');
});
test('Beneath Cursed Sands: real Inventory full bag preserves the urn on Remove', async () => {
  const h = harness('../plugins/quests/quests/BeneathCursedSands.Quest');
  const p = player();
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const { Item } = require('../dist/game/model/Item');
  const inv = new Inventory(p);
  for (let slot = 0; slot < 28; slot++) inv.setItem(slot, new Item(1000 + slot, 1));
  p.getInventory = () => inv;
  const raw = CacheDefinitions.getObject(43979);
  const urn = { ...raw, getId: () => raw.id, getName: () => raw.name, getInteractions: () => raw.actions };
  h.quest.setStage(p, 46);
  p.attributes.set('beneath-cursed-sands:urns', 4 << 8);
  h.object(p, 43979, 1, urn, new core.Location(3394, 9247, 0));
  h.action(p, 11474, 'T-XWqk');
  assert.equal(p.attributes.get('beneath-cursed-sands:urns'), 4 << 8);
  assert.equal(inv.getAmount(I.SCARAB_EMBLEM), 0);
});
