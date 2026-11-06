const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const TRANSCRIPTS = require('../data/definitions/npc-dialogues.json');

const VARBIT_PROGRESS = 13713;
const VARBIT_SEQUENCE = 815;
const VARBIT_BACKSTORY = 816;
const VISIBILITY = 15152;
// Spawned secret_ghost ids (cache) and the Wiki NPC ids they resolve to.
const VALDEZ = 6104;
const RENNARD = [6105, 6106, 6107];
const DHALAK = [6108, 6109, 6110];
const KHARRIM = [6111, 6112, 6113];
const LENNISSA = [6114, 6115, 6116];
const VIGGORA = [6117, 6122, 6123];
const CONTENT = { Valdez: 3452, Rennard: 3450, Kharrim: 3453, Lennissa: 3454, Dhalak: 3451, Viggora: 3455 };

function setup() {
  const core = PluginManager.getCoreApi();
  const I = core.ItemIdentifiers;
  const hooks = { custom: new Map(), conditions: [], npcs: new Map() };
  const transcripts = [];
  const real = runtime.startTranscript;
  runtime.startTranscript = (api, player, npcId, page, variant) => { transcripts.push({ npcId, page, variant }); return true; };
  const api = new Proxy({
    core: { ...core, TaskManager: { submit(task) { task.execute(); } } },
    persistAttribute() {},
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(name, actions) { hooks.npcs.set(name, actions); },
    onCustomEvent(name, fn) { hooks.custom.set(name, [...(hooks.custom.get(name) ?? []), fn]); },
    emitCustomEvent(name, event) { for (const fn of hooks.custom.get(name) ?? []) fn(event); },
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  try {
    require('../plugins/quests/quests/CurseOfTheEmptyLord.Quest')(api);
  } finally {
    runtime.startTranscript = real;
  }
  const quest = runtime.getRegisteredQuests().filter((entry) => entry.key === 'curse_of_the_empty_lord').at(-1);

  const attrs = new Map(), varbits = new Map(), items = [], worn = new Map(), prompts = [];
  let magic = 1;
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    sendEnterAmountPrompt(text) { prompts.push(text); return sender; },
    sendCreationMenu(menu) { prompts.push(menu); return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const player = {
    getUsername: () => 'cotel-test',
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getPacketSender: () => sender,
    sendMessage() {},
    isRegistered: () => true,
    getSkillManager: () => ({ getMaxLevel: () => magic }),
    getEquipment: () => ({ get: (slot) => (worn.has(slot) ? { getId: () => worn.get(slot) } : undefined), getAmount: () => 0 }),
    getInventory: () => ({
      getFreeSlots: () => 28 - items.length,
      adds(id) { items.push(id); },
      forceAdd(p, item) { items.push(item.getId()); },
      full() {},
    }),
    setEnteredAmountAction(action) { player.amountAction = action; },
    getDialogueManager: () => ({ startDialogues() {}, getCurrent: () => null }),
    getFrameUpdater: () => undefined,
  };
  const talk = (spawn) => {
    transcripts.length = 0;
    hooks.npcs.get('Mysterious ghost')['Talk-To']({ player, npc: { getId: () => spawn } });
    return transcripts[0];
  };
  const answer = (name, text) => {
    for (const fn of hooks.conditions) {
      const value = fn({ player, npcId: CONTENT[name], text });
      if (value !== null && value !== undefined) return value;
    }
    return null;
  };
  /** Plays the location branches of a first talk as the dialogue runtime would: the true one is chosen. */
  const tellStory = (name, variant) => {
    const steps = TRANSCRIPTS['Curse of the Empty Lord'].variants[variant];
    const conditions = [];
    (function walk(list) { for (const step of list ?? []) { if (step.type === 'condition') conditions.push(step); walk(step.steps); for (const o of step.options ?? []) walk(o.steps); } })(steps);
    const located = conditions.filter((step) => /^If \w+ is /.test(step.text));
    const chosen = located.filter((step) => answer(name, step.text) === true);
    assert.equal(chosen.length, 1, `${variant}: exactly one location branch is true`);
    api.emitCustomEvent('npc-dialogue:condition', { player, npcId: CONTENT[name], text: chosen[0].text, stepId: chosen[0].id });
  };
  const wear = (slot, id) => { worn.set(slot, id); };
  return { api, core, I, quest, player, attrs, varbits, items, worn, wear, prompts, talk, answer, tellStory, setMagic: (v) => { magic = v; } };
}

function readyToSee(f) {
  f.wear(f.core.Equipment.RING_SLOT, f.I.RING_OF_VISIBILITY);
  f.wear(f.core.Equipment.AMULET_SLOT, f.I.GHOSTSPEAK_AMULET);
}

test('without ghostspeak the ghosts only woo; Morytania legs 2+ do, except for Lennissa at Entrana', () => {
  const f = setup();
  assert.deepEqual(f.talk(VALDEZ), { npcId: CONTENT.Valdez, page: 'Valdez', variant: 'without-a-ghostspeak-amulet' });
  f.wear(f.core.Equipment.LEG_SLOT, f.I.MORYTANIA_LEGS_2);
  assert.equal(f.talk(VALDEZ).variant, 'talking-to-valdez');
  f.attrs.set('quest.curse_of_the_empty_lord.stage', 3);
  f.attrs.set('curse-of-the-empty-lord:sequence', 1);
  assert.equal(f.talk(LENNISSA[0]).variant, 'without-a-ghostspeak-amulet');
  f.attrs.set('curse-of-the-empty-lord:sequence', 2);
  assert.equal(f.talk(LENNISSA[1]).variant, 'talking-to-lennissa');
});

test('the whole miniquest in one sequence: robes, stages, backstory varbits, wrong spots and completion', () => {
  for (const sequence of [1, 2, 3]) {
    const f = setup();
    readyToSee(f);
    assert.equal(f.talk(KHARRIM[sequence - 1]).variant, 'talking-to-any-mysterious-ghost-in-the-wrong-location', 'not sent there yet');
    const realRandom = Math.random;
    Math.random = () => (sequence - 1) / 3 + 0.01;
    try {
      assert.equal(f.talk(VALDEZ).variant, 'talking-to-valdez');
    } finally {
      Math.random = realRandom;
    }
    assert.equal(f.varbits.get(VARBIT_SEQUENCE), sequence);
    f.tellStory('Valdez', 'talking-to-valdez');
    assert.equal(f.quest.getStage(f.player), 1);
    assert.equal(f.varbits.get(VARBIT_PROGRESS), 1);
    assert.equal(f.varbits.get(VARBIT_BACKSTORY), 1);
    assert.deepEqual(f.items, [f.I.GHOSTLY_ROBE]);
    assert.equal(f.talk(VALDEZ).variant, 'talking-to-valdez-talking-to-valdez-again');

    const order = [['Rennard', RENNARD, f.I.GHOSTLY_GLOVES], ['Kharrim', KHARRIM, f.I.GHOSTLY_BOOTS],
      ['Lennissa', LENNISSA, f.I.GHOSTLY_ROBE_2], ['Dhalak', DHALAK, f.I.GHOSTLY_HOOD]];
    order.forEach(([name, spawns, robe], index) => {
      const wrong = spawns[sequence % 3];
      assert.equal(f.talk(wrong).variant, `speaking-to-the-wrong-${name.toLowerCase()}`);
      const route = f.talk(spawns[sequence - 1]);
      assert.deepEqual(route, { npcId: CONTENT[name], page: 'Curse of the Empty Lord', variant: `talking-to-${name.toLowerCase()}` });
      f.tellStory(name, route.variant);
      assert.equal(f.quest.getStage(f.player), index + 2, name);
      assert.equal(f.items.at(-1), robe, name);
      assert.equal(f.varbits.get(VARBIT_BACKSTORY + index + 1), 1, name);
    });

    const viggora = { ready: false, here: false, npc: { getId: () => VIGGORA[sequence - 1] }, player: f.player };
    f.api.emitCustomEvent('curse-of-the-empty-lord:viggora', viggora);
    assert.deepEqual([viggora.ready, viggora.here], [true, true], 'Viggora\'s clue part can now be handed over at his spot');
    const elsewhere = { player: f.player, npc: { getId: () => VIGGORA[sequence % 3] } };
    f.api.emitCustomEvent('curse-of-the-empty-lord:viggora', elsewhere);
    assert.equal(elsewhere.here, false);

    assert.equal(f.talk(VIGGORA[sequence - 1]).variant, 'talking-to-viggora');
    const line = { player: f.player, npcId: CONTENT.Viggora, text: 'Not yet.' };
    f.api.emitCustomEvent('npc-dialogue:line', line);
    assert.equal(line.after, undefined);
    const last = { player: f.player, npcId: CONTENT.Viggora, text: 'He was Zaros.' };
    f.api.emitCustomEvent('npc-dialogue:line', last);
    last.after();
    assert.equal(f.quest.isComplete(f.player), true);
    assert.equal(f.varbits.get(VARBIT_PROGRESS), 6);
    assert.equal(f.varbits.get(VARBIT_BACKSTORY + 5), 1);
    assert.equal(f.items.at(-1), f.I.GHOSTLY_CLOAK);
    assert.equal(f.items.length, 6, 'one robe piece per ghost');
    assert.deepEqual(f.talk(VIGGORA[sequence - 1]), { npcId: CONTENT.Viggora, page: 'Viggora', variant: 'after-curse-of-the-empty-lord' });
    assert.equal(f.talk(RENNARD[sequence % 3]).variant, 'speaking-to-the-wrong-rennard');
  }
});

test('Dhalak hears about 99 Magic; robes are reclaimed after the miniquest', () => {
  const f = setup();
  readyToSee(f);
  assert.equal(f.answer('Dhalak', 'If the player has level 99 Magic:'), false);
  assert.equal(f.answer('Dhalak', 'If the player does not have level 99 Magic:'), true);
  f.setMagic(99);
  assert.equal(f.answer('Dhalak', 'If the player has level 99 Magic:'), true);

  f.attrs.set('quest.curse_of_the_empty_lord.stage', 6);
  const chooser = { player: f.player, npcId: CONTENT.Rennard, action: 'open_interface', target: 'Ghostly robes reclaim interface' };
  f.api.emitCustomEvent('npc-dialogue:action', chooser);
  assert.equal(chooser.handled, true);
  const menu = f.prompts.at(-1);
  menu.getAction().execute(f.I.GHOSTLY_HOOD, 2);
  assert.deepEqual(f.items, [f.I.GHOSTLY_HOOD, f.I.GHOSTLY_HOOD]);
  const tops = { player: f.player, npcId: CONTENT.Valdez, action: 'receive', text: 'requested amount of Ghostly robe (top)' };
  f.api.emitCustomEvent('npc-dialogue:action', tops);
  assert.equal(f.prompts.at(-1), 'How many robe tops do you want?');
  f.player.amountAction.execute(3);
  assert.equal(f.items.filter((id) => id === f.I.GHOSTLY_ROBE).length, 3);
});

test('the ring of visibility shows the shadow realm at 1, the ring of shadows at 2', () => {
  const ring = require('../plugins/items/RingOfVisibility.plugin');
  const core = PluginManager.getCoreApi();
  ring.register({ core, onCustomEvent() {} });
  const varbits = new Map();
  let worn = null;
  const player = {
    getEquipment: () => ({ get: (slot) => (slot === core.Equipment.RING_SLOT && worn ? { getId: () => worn } : undefined) }),
    getPacketSender: () => ({ getVarbit: (id) => varbits.get(id) ?? 0, sendVarbit: (id, value) => varbits.set(id, value) }),
  };
  for (const [id, value] of [[core.ItemIdentifiers.RING_OF_VISIBILITY, 1], [core.ItemIdentifiers.RING_OF_SHADOWS, 2],
    [core.ItemIdentifiers.RING_OF_SHADOWS_UNCHARGED_, 2], [null, 0]]) {
    worn = id;
    ring._test.sync({ player });
    assert.equal(varbits.get(VISIBILITY) ?? 0, value, String(id));
  }
});
