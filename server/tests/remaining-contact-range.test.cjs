// From server/: yarn build && node --test tests/remaining-contact-range.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');
const { NPC } = require('../dist/game/entity/impl/npc/NPC');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Location } = require('../dist/game/model/Location');
const { World } = require('../dist/game/World');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { NPCOptionPacketListener } = require('../dist/net/packet/impl/NPCOptionPacketListener');
const { NpcDialogue } = require('../dist/game/model/dialogues/entries/impl/NpcDialogue');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const runtime = require('../plugins/quests/QuestRuntime');
const dialoguePlugin = require('../plugins/npcs/NpcDialogues.plugin');

const ROOT = path.resolve(__dirname, '..');
const BLOCKED = 0x1280120;
let contactQuest;
let dialogueApi;
let waterfallQuest;

before(async () => {
  await CachePipeline.initialize(ROOT);
  RegionManager.init();
  for (const [x, y] of [[2240, 4288], [2304, 4288], [2240, 4352], [2304, 4352], [2560, 3008], [2592, 2944]]) {
    RegionManager.loadMapFiles(x, y, false);
  }
  new NpcDefinitionLoader().load();

  const api = PluginManager.createApi('remaining-contact-range-test');
  dialogueApi = api;
  require('../plugins/npcs/NpcDialogues.plugin').register(api);
  require('../plugins/quests/quests/Contact.Quest')(api);
  const waterfallApi = PluginManager.createApi('remaining-contact-range-waterfall-test');
  require('../plugins/quests/quests/WaterfallQuest.Quest')(waterfallApi);
  const spiritsApi = PluginManager.createApi('remaining-contact-range-spirits-test');
  require('../plugins/quests/quests/SpiritsOfTheElid.Quest')(spiritsApi);
  contactQuest = runtime.getRegisteredQuests().find((quest) => quest.key === 'contact');
  waterfallQuest = runtime.getRegisteredQuests().find((quest) => quest.key === 'waterfall_quest');
  assert.ok(contactQuest, 'Contact quest registered through the real plugin API');
  assert.ok(waterfallQuest, 'Waterfall Quest registered through the real plugin API');
});

function account(x = 2262, y = 4320) {
  const player = new Player(null);
  const sender = new Proxy({}, {
    get: (target, key) => {
      if (key === 'getVarbit') return () => 0;
      if (key === 'isSubInterfaceOpen') return () => false;
      if (key === 'isChatboxInterface') return () => true;
      if (key === 'closeInterruptibleInterfaces') return () => {};
      return () => sender;
    },
  });
  player.getPacketSender = () => sender;
  player.moveTo(new Location(x, y, 0));
  player.setNeedsPlacement(false);
  return player;
}

function maisaNpc() {
  const npc = new NPC(3876, new Location(2258, 4317, 0));
  assert.equal(World.getNpcs().add(npc, true), true, 'real public Maisa registered');
  return npc;
}

function routeEvent(player, npc, range = 1, clickType = 1) {
  return {
    player,
    npc,
    definition: npc.getCurrentDefinition(player),
    npcId: npc.getContentId(player),
    npcIndex: npc.getIndex(),
    clickType,
    location: { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: npc.getLocation().getZ() },
    handled: false,
    range,
  };
}

test('Contact: real cache keeps Maisa on the west bank across the blocked chasm', () => {
  assert.equal(RegionManager.getClipping(2258, 4317, 0, null) & BLOCKED, 0, 'Maisa spawn tile is walkable');
  assert.equal(RegionManager.getClipping(2263, 4318, 0, null) & BLOCKED, 0, 'east landing is walkable');
  assert.notEqual(RegionManager.getClipping(2260, 4318, 0, null) & BLOCKED, 0, 'the chasm blocks the direct line');

  assert.equal(NpcDefinition.forId(3876).getName(), 'Maisa');
  assert.ok(NpcDefinition.forId(3876).getActions().includes('Talk-to'), 'real cache definition has Talk-to');

  const spawns = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/definitions/npc-spawns.json'), 'utf8'));
  const spawn = spawns.find((entry) => entry.id === 6164);
  assert.deepEqual({ name: spawn?.name, x: spawn?.x, y: spawn?.y }, { name: 'Maisa', x: 2258, y: 4317 });

  const dialogues = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/definitions/npc-dialogues.json'), 'utf8'));
  const variant = dialogues['Contact!'].variants['kaleef-s-corpse-talking-to-maisa'];
  const options = variant.filter((step) => step.type === 'choice').flatMap((step) => step.options.map((option) => option.text));
  assert.ok(options.includes('Draynor Village.') && options.includes('Leela.'), 'shipped quiz answers are intact');

  const lastChoice = variant.map((step, index) => ({ step, index })).filter((entry) => entry.step.type === 'choice').at(-1);
  assert.deepEqual(
    variant.slice(lastChoice.index + 1).filter((step) => step.type === 'condition').map((step) => step.id),
    ['IjxRNT', 'PeJYOi', 'qEP0VV'],
    'the three shared quiz guards sit after the second question, not inside its options'
  );
  for (const option of lastChoice.step.options) {
    assert.deepEqual(
      (option.steps ?? []).filter((step) => step.type === 'condition'),
      [],
      `the "${option.text}" branch does not copy the shared guards`
    );
  }
});

test('Contact: the route hook widens only real Maisa on stages 40-60', () => {
  const player = account();
  const npc = maisaNpc();
  const unrelated = new NPC(3875, new Location(2258, 4317, 0));
  const owned = new NPC(3876, new Location(2258, 4317, 0));
  owned.setOwner(player);

  try {
    for (const [stage, range] of [[39, 1], [40, 10], [50, 10], [60, 10], [61, 1]]) {
      contactQuest.setStage(player, stage);
      const event = routeEvent(player, npc);
      PluginManager.emitNpcRoute(event);
      assert.equal(event.range, range, `stage ${stage} route range`);
    }

    contactQuest.setStage(player, 50);
    const otherEvent = routeEvent(player, unrelated);
    PluginManager.emitNpcRoute(otherEvent);
    assert.equal(otherEvent.range, 1, 'unrelated NPCs keep the default range');

    const ownerEvent = routeEvent(player, owned);
    PluginManager.emitNpcRoute(ownerEvent);
    assert.equal(ownerEvent.range, 1, 'owner-only NPCs do not inherit Maisa far-talk');
  } finally {
    World.getNpcs().remove(npc);
  }
});

test('item-on-NPC route events do not inherit legacy menu-only reach extensions', () => {
  const player = account();
  const { NpcIdentifiers } = require('../dist/util/NpcIdentifiers');
  contactQuest.setStage(player, 50);
  waterfallQuest.setStage(player, 1);

  const makeNpc = (id) => ({
    getContentId: () => id,
    getIndex: () => -1,
    getOwner: () => null,
    getLocation: () => new Location(2258, 4317, 0),
    getCurrentDefinition: () => ({ getActions: () => ['Talk-to'] }),
  });
  const assertRoute = (id, clickType, expected, label) => {
    const event = routeEvent(player, makeNpc(id), 1, clickType);
    PluginManager.emitNpcRoute(event);
    assert.equal(event.range, expected, label);
  };

  assertRoute(3876, 0, 1, 'item use on Maisa keeps ordinary reach');
  assertRoute(3876, 1, 10, 'Maisa menu option retains quiz reach');
  assertRoute(NpcIdentifiers.HUDON, 0, 1, 'item use on Hudon keeps ordinary reach');
  assertRoute(NpcIdentifiers.HUDON, 1, 4, 'Hudon menu option retains route reach');
  assertRoute(4763, 0, 1, 'item use on Elid ranging target keeps ordinary reach');
  assertRoute(4763, 1, 10, 'ranging target menu action retains channel reach');
});

function advanceToPromptOrEnd(player, seen) {
  for (let i = 0; i < 200; i++) {
    const pending = MultiChatboxPrompt.getPending(player);
    if (pending) return pending;
    const current = player.getDialogueManager().getCurrent();
    if (!current) return null;
    const text = current.getText?.();
    if (text) seen.push(text);
    if (!player.getDialogueManager().handleResume(231 << 16 | 5, 1)) return null;
  }
  throw new Error('dialogue did not finish');
}

function answerQuiz(player, answers) {
  const seen = [];
  for (;;) {
    const pending = advanceToPromptOrEnd(player, seen);
    if (!pending) break;
    const answer = answers.shift();
    assert.ok(answer, `unexpected prompt: ${pending.options.join(' | ')}`);
    const index = pending.options.indexOf(answer);
    assert.ok(index >= 0, `missing "${answer}" in ${pending.options.join(' | ')}`);
    const handled = MultiChatboxPrompt.handleInterfaceActionClick({
      player,
      buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID,
      groupId: 219,
      slot: index + 1,
      action: index + 1,
    });
    assert.equal(handled, true, `selected "${answer}" through the real prompt dispatch`);
  }
  assert.equal(answers.length, 0, 'all quiz answers were offered');
  return seen;
}

function startMaisaTalk(player) {
  const npc = maisaNpc();
  new NPCOptionPacketListener().executeOption(player, npc.getIndex(), 1);
  return npc;
}

// The Wiki/AutoWiki shape: both questions are answered first, then one shared run
// of guards decides the outcome from the answers recorded by the choice events.
const canonicalMaisaQuiz = [
  { type: 'choice', prompt: 'Where was the Prince kept?', options: [
    { text: 'Draynor Village.', steps: [{ player: 'Draynor Village.' }] },
    { text: 'Pollnivneach.', steps: [{ player: 'Pollnivneach.' }] },
  ] },
  { type: 'line', speaker: 'Maisa', text: 'Interesting. And who helped you free the Prince?' },
  { type: 'choice', prompt: 'Who helped you?', options: [
    { text: 'Leela.', steps: [{ player: 'Leela.' }] },
    { text: 'Hassan.', steps: [{ player: 'Hassan.' }] },
  ] },
  { type: 'condition', text: 'If zero answers are right:', id: 'IjxRNT',
    steps: [{ npc: "You're obviously an imposter." }, { type: 'end' }] },
  { type: 'condition', text: 'If one answer is right:', id: 'PeJYOi',
    steps: [{ npc: "You'll have to do better than that." }, { type: 'end' }] },
  { type: 'condition', text: 'If both answers are right:', id: 'qEP0VV',
    steps: [{ npc: 'Fair enough.' }, { type: 'end' }] },
];

function playCanonicalQuiz(answers) {
  const player = account(2262, 4320);
  contactQuest.setStage(player, 50);
  const npc = maisaNpc();
  const definition = npc.getCurrentDefinition(player);
  const npcId = npc.getContentId(player);
  let chosen = 0;
  const quizApi = Object.create(dialogueApi);
  quizApi.emitCustomEvent = (name, payload) => {
    if (name === 'npc-dialogue:condition' && payload.stepId === 'qEP0VV') chosen++;
    dialogueApi.emitCustomEvent(name, payload);
  };
  try {
    dialoguePlugin.startDialogue(
      quizApi,
      { player, npc, npcId, definition },
      canonicalMaisaQuiz,
      {},
      { player, npc, npcId, definition, pages: [] }
    );
    answerQuiz(player, answers);
    const stage = contactQuest.getStage(player);
    assert.equal(chosen, stage === 60 ? 1 : 0, 'the chosen-guard event fires once, only for the passing guard');
    return stage;
  } finally {
    World.getNpcs().remove(npc);
  }
}

test('Contact: canonical shared guards see the answers from earlier menu choices', () => {
  assert.equal(playCanonicalQuiz(['Draynor Village.', 'Leela.']), 60, 'both right answers convince Maisa');
  assert.equal(playCanonicalQuiz(['Pollnivneach.', 'Hassan.']), 50, 'wrong answers do not convince Maisa');
});

test('NpcDialogues: a condition after an action is judged when reached, not when the queue is built', () => {
  const player = account();
  const npc = maisaNpc();
  const definition = npc.getCurrentDefinition(player);
  const npcId = npc.getContentId(player);
  let acted = false;
  const actionApi = Object.create(dialogueApi);
  actionApi.emitCustomEvent = (name, payload) => {
    if (name === 'npc-dialogue:action' && payload.stepId === 'set-flag') acted = true;
    dialogueApi.emitCustomEvent(name, payload);
  };
  const condition = {
    pluginName: 'lazy-condition-action-test',
    handler: ({ text }) => (text === 'If acted:' ? acted : text === 'If not acted:' ? !acted : null),
  };
  PluginManager.npcDialogueConditionHooks.unshift(condition);
  const tree = [
    { type: 'choice', prompt: 'Act?', options: [
      { text: 'Do it', steps: [{ type: 'message', id: 'set-flag', text: 'You do it.' }] },
    ] },
    { type: 'condition', text: 'If acted:', id: 'acted', steps: [{ npc: 'The action was seen.' }, { type: 'end' }] },
    { type: 'condition', text: 'If not acted:', id: 'not-acted', steps: [{ npc: 'The action was missed.' }, { type: 'end' }] },
  ];
  try {
    dialoguePlugin.startDialogue(
      actionApi,
      { player, npc, npcId, definition },
      tree,
      {},
      { player, npc, npcId, definition, pages: [] }
    );
    const seen = answerQuiz(player, ['Do it']);
    assert.ok(seen.includes('The action was seen.'), 'the later guard observed the earlier action');
    assert.ok(!seen.includes('The action was missed.'));
  } finally {
    PluginManager.npcDialogueConditionHooks.splice(PluginManager.npcDialogueConditionHooks.indexOf(condition), 1);
    World.getNpcs().remove(npc);
  }
});

test('Contact: a normal Talk-to reaches the real Maisa dialogue across the chasm', () => {
  const player = account(2262, 4320);
  contactQuest.setStage(player, 50);
  const npc = maisaNpc();

  try {
    new NPCOptionPacketListener().executeOption(player, npc.getIndex(), 1);

    assert.equal(player.getLocation().getX(), 2262);
    assert.equal(player.getLocation().getY(), 4320);
    assert.equal(player.getDialogueManager().isActive(), true, 'Talk-to opened a dialogue');
    const dialogue = player.getDialogueManager().getCurrent();
    assert.ok(dialogue instanceof NpcDialogue);
    assert.match(dialogue.getText(), /You're not Kaleef!/);
  } finally {
    World.getNpcs().remove(npc);
  }
});

test('Contact: the MovementQueue route uses range 10 and completes without the radius-2 fallback', () => {
  const player = account(2262, 4320);
  contactQuest.setStage(player, 50);
  const npc = maisaNpc();

  try {
    const event = routeEvent(player, npc);
    PluginManager.emitNpcRoute(event);
    assert.equal(event.range, 10);

    let opened = 0;
    player.getMovementQueue().walkToEntity(npc, () => opened++, event.range);
    assert.equal(opened, 1, 'the ranged interaction resolves on the initial route');
    assert.equal(player.getMovementQueue().points.length, 0, 'no walk was queued across the chasm');
  } finally {
    World.getNpcs().remove(npc);
  }
});

test('item-on-NPC dispatch allows overlap and keeps route and target validity checks', () => {
  const { Item } = require('../dist/game/model/Item');
  const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const { UseItemPacketListener } = require('../dist/net/packet/impl/UseItemPacketListener');
  const hook = {
    pluginName: 'remaining-contact-range-item-route-test',
    handler(event) { event.handled = true; this.calls.push(event); },
    calls: [],
  };
  PluginManager.itemOnNpcHooks.push(hook);

  const run = (playerLocation, npcLocation, configureNpc) => {
    const player = account(playerLocation[0], playerLocation[1]);
    player.getInventory().getItems()[0] = new Item(ItemIdentifiers.OGRE_BELLOWS_3_, 1);
    const npc = new NPC(1473, new Location(npcLocation[0], npcLocation[1], npcLocation[2] ?? 0));
    configureNpc?.(npc, player);
    assert.equal(World.getNpcs().add(npc, true), true);
    try {
      const before = hook.calls.length;
      UseItemPacketListener.itemOnNpc(player, 3214, npc.getIndex(), ItemIdentifiers.OGRE_BELLOWS_3_, 0);
      return { player, npc, calls: hook.calls.slice(before) };
    } catch (error) {
      World.getNpcs().remove(npc);
      throw error;
    }
  };

  const registered = [];
  const check = (args, assertion, configureNpc) => {
    const result = run(...args, configureNpc);
    registered.push(result.npc);
    assertion(result);
    return result;
  };

  try {
    check([[2598, 2969], [2598, 2969]], ({ calls }) => {
      assert.equal(calls.length, 1, 'same-tile item use reaches the NPC handler');
    });
    check([[2597, 2969], [2598, 2969]], ({ calls }) => {
      assert.equal(calls.length, 1, 'a normal adjacent route still reaches the handler');
    });
    check([[2559, 3019], [2560, 3019]], ({ calls }) => {
      assert.equal(PathFinder.reachedEntity(
        { getLocation: () => new Location(2559, 3019, 0), getSize: () => 1, getPrivateArea: () => null, isPlayer: () => true },
        { getLocation: () => new Location(2560, 3019, 0), getSize: () => 1, getPrivateArea: () => null, isNpc: () => true }
      ), false, 'cache clipping blocks this adjacent edge');
      assert.equal(calls.length, 0, 'overlap allowance does not bypass an adjacent clipped edge immediately');
    });
    check([[2596, 2969], [2598, 2969]], ({ calls }) => {
      assert.equal(calls.length, 0, 'a distance-two use is not treated as overlap');
    });
    check([[2598, 2969], [2598, 2969]], ({ calls }) => {
      assert.equal(calls.length, 0, 'a foreign-owned NPC is rejected before the same-tile fast path');
    }, (npc) => npc.setOwner(account(2500, 2500)));
    check([[2598, 2969], [2598, 2969, 1]], ({ calls }) => {
      assert.equal(calls.length, 0, 'a different-plane NPC is rejected before the same-tile fast path');
    });
  } finally {
    PluginManager.itemOnNpcHooks.splice(PluginManager.itemOnNpcHooks.indexOf(hook), 1);
    for (const npc of registered) World.getNpcs().remove(npc);
  }
});

test('Contact: real shipped NpcDialogues accepts both correct Maisa answers', () => {
  const player = account(2262, 4320);
  contactQuest.setStage(player, 50);
  const npc = startMaisaTalk(player);
  try {
    answerQuiz(player, ['Draynor Village.', 'Leela.']);
    assert.equal(contactQuest.getStage(player), 60, 'both right answers advance 50 -> 60');
  } finally {
    World.getNpcs().remove(npc);
  }
});

test('Contact: real shipped NpcDialogues rejects wrong Maisa answers without advancing', () => {
  const player = account(2262, 4320);
  contactQuest.setStage(player, 50);
  const npc = startMaisaTalk(player);
  try {
    answerQuiz(player, ['Pollnivneach.', 'Hassan.']);
    assert.equal(contactQuest.getStage(player), 50, 'wrong answers do not convince Maisa');
  } finally {
    World.getNpcs().remove(npc);
  }
});

test('Contact: Osman world rows and dungeon actor use the primary cache parents', () => {
  const spawns = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/definitions/npc-spawns.json'), 'utf8'));
  const at = (x, y) => spawns.find((entry) => entry.name === 'Osman' && entry.x === x && entry.y === y);
  assert.equal(at(3286, 3180)?.id, 6165, 'Al Kharid Osman uses contact_osman_multi');
  assert.equal(at(3289, 2818)?.id, 6166, 'Sophanem Osman uses contact_osman_desert_multi');

  const resolve = (id, varbitId, value) => CacheDefinitions.resolveNpc(id, {
    getVarbit: (queried) => (queried === varbitId ? value : 0),
    getVarp: () => 0,
  });
  assert.equal(resolve(6165, 13841, 0)?.id, 4286, 'Al Kharid parent resolves to Osman before BCS');
  assert.equal(resolve(6166, 3274, 70)?.id, 4286, 'Sophanem parent resolves at Contact stage 70');
  assert.equal(resolve(6166, 3274, 60), undefined, 'Sophanem parent stays hidden before stage 70');
  assert.equal(resolve(11568, 3274, 110)?.id, 4286, 'dungeon parent resolves when the scarab is dead');
});

test('Native18 primary spawn rows: Zembo, docks Korel and Sarim Will/Anne', () => {
  const spawns = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/definitions/npc-spawns.json'), 'utf8'));
  const row = (x, y, name) => spawns.find((entry) => entry.name === name && entry.x === x && entry.y === y);

  assert.deepEqual(row(2927, 3143, 'Zembo'), { level: 0, name: 'Zembo', x: 2927, y: 3143, id: 13655 });
  assert.equal(spawns.some((entry) => entry.id === 3205 && entry.x === 2925 && entry.y === 3143), false,
    'the stale Surok transition row is gone');
  assert.equal(CacheDefinitions.getNpc(13655)?.name, 'Zembo');

  assert.equal(row(3185, 2371, 'Elder Korel')?.id, 14995, 'docks Korel uses the Tortugans transform parent');
  assert.equal(spawns.some((entry) => entry.id === 14998 && entry.x === 3185 && entry.y === 2371), false);
  assert.equal(CacheDefinitions.getNpc(14995)?.transformVarbit, 18321);

  assert.deepEqual(row(3024, 3208, 'Will'), { level: 0, name: 'Will', x: 3024, y: 3208, id: 14957, direction: 4, wanderRadius: 0 });
  assert.deepEqual(row(3025, 3209, 'Anne'), { level: 0, name: 'Anne', x: 3025, y: 3209, id: 14962, direction: 6, wanderRadius: 0 });
});

test('Native18 Junior Jim world row uses parent 14972 and keeps both cache children', () => {
  const spawns = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/definitions/npc-spawns.json'), 'utf8'));
  const jimRows = spawns.filter((entry) => entry.name === 'Junior Jim');
  assert.equal(jimRows.length, 1, 'exactly one Junior Jim world row');
  assert.deepEqual(jimRows[0], {
    level: 0,
    name: 'Junior Jim',
    x: 3058,
    y: 2979,
    id: 14972,
    direction: 6,
    wanderRadius: 0,
  });

  const resolve = (value) => CacheDefinitions.resolveNpc(14972, {
    getVarbit: (id) => (id === 18314 ? value : 0),
    getVarp: () => 0,
  });
  assert.equal(resolve(0)?.id, 14974, 'pre-quest Jim uses the Talk-to child');
  assert.equal(resolve(48)?.id, 14974, 'stage 48 still uses the Talk-to child');
  assert.equal(resolve(49)?.id, 14975, 'stage 49 switches to the post-quest child');
  assert.equal(resolve(50)?.id, 14975, 'completed Pandemonium keeps the post-quest child');
  assert.ok(CacheDefinitions.getNpc(14975)?.actions.includes('Buy-boat'),
    'post-quest Jim keeps his shipwright actions');
});
