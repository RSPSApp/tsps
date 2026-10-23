// From server/: node --test tests/qh728-q102.test.cjs (after yarn build).
// Focused Sea Slug contracts: the mandatory helper stage graph on the registered
// handlers, the canonical varp 159 completion value, post-quest page selection
// and the torch recovery / early-interaction boundaries.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
// The server resolves its data directories from the working directory, so run from server/.
// It also makes `node --test server/tests/qh728-q102.test.cjs` work from the repository root.
process.chdir(path.resolve(__dirname, '..'));
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const runtime = require('../plugins/quests/QuestRuntime');
const dialogues = require('../data/definitions/npc-dialogues.json');
const dialogueIndex = require('../data/definitions/npc-dialogue-index.json');
const groundItemDefinitions = require('../data/definitions/ground-items.json');
const { pickVariant, flatten } = require('../plugins/npcs/NpcDialogues.plugin');
const core = PluginManager.getCoreApi();
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function makePlayer(username = 'sea-slug-test') {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const moves = [];
  const log = [];
  const drops = [];
  const xp = [];
  let full = false;
  let firemaking = 30;
  let location = new core.Location(2717, 3303, 0);
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        inventory.full();
        return false;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    forceAdd: (_player, item) => {
      const id = item.getId();
      const amount = item.getAmount();
      if (full) {
        drops.push([id, amount]);
        return;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
    },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28 - [...items.values()].filter(amount => amount > 0).length),
    isFull: () => full || inventory.getFreeSlots() <= 0,
    full: () => messages.push('Not enough space in your inventory.'),
    getItems: () => [],
  };
  const sender = new Proxy({}, { get: (_target, prop) => (...args) => { log.push([String(prop), ...args]); return sender; } });
  return {
    attrs, items, messages, moves, log, drops, xp,
    setFull(value) { full = value; },
    setFiremaking(value) { firemaking = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null }),
    getSkillManager: () => ({
      getCurrentLevel: () => firemaking,
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    getUsername: () => username,
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    moveTo: next => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    performAnimation: noop,
    sendMessage: text => messages.push(text),
    isRegistered: () => true,
  };
}

function harness() {
  const events = {};
  const variants = [];
  const conditions = [];
  const objectInteraction = [];
  const itemOnItem = [];
  const itemActions = [];
  const npcInteractions = [];
  const submittedTasks = [];
  const transcriptCalls = [];
  const groundItems = [];
  const spawnedNpcs = [];
  const removedNpcs = [];
  const playerLogin = [];
  const playerLogout = [];
  const dampSticksSpawn = groundItemDefinitions.find(entry =>
    entry.id === core.ItemIdentifiers.DAMP_STICKS && entry.location?.x === 2784 && entry.location?.y === 3289);
  assert.ok(dampSticksSpawn, 'the canonical public damp-sticks spawn is configured');
  // The real static spawn loader handles its short respawn; this fixture is shared by all players.
  const worldGroundItems = [{
    item: new core.Item(dampSticksSpawn.id, dampSticksSpawn.amt),
    position: new core.Location(dampSticksSpawn.location.x, dampSticksSpawn.location.y, dampSticksSpawn.location.z),
    owner: null,
    respawn: dampSticksSpawn.respawn,
  }];
  const testCore = { ...core, TaskManager: { submit: task => submittedTasks.push(task) } };
  const api = new Proxy({
    core: testCore,
    persistAttribute: noop,
    onNpcDialogueVariant: handler => variants.push(handler),
    onNpcDialogueCondition: handler => conditions.push(handler),
    onObjectInteraction: handler => objectInteraction.push(handler),
    onObjectRoute: noop,
    onItemOnItem: (nameOrHandler, otherName, namedHandler) => {
      if (typeof nameOrHandler === 'function') itemOnItem.push(nameOrHandler);
      else if (typeof namedHandler === 'function') itemOnItem.push(namedHandler);
    },
    onItemAction: (name, actions) => itemActions.push({ name, actions }),
    onNpcInteraction: (name, actions) => npcInteractions.push({ name, actions }),
    onPlayerLogin: handler => playerLogin.push(handler),
    onPlayerLogout: handler => playerLogout.push(handler),
    onInterfaceActionButton: noop,
    spawnNpc: definition => {
      const npc = {
        id: definition.id,
        x: definition.x,
        y: definition.y,
        z: definition.z ?? 0,
        owner: definition.owner,
        ownerOnly: !!definition.ownerOnly,
      };
      spawnedNpcs.push(npc);
      return npc;
    },
    removeNpc: npc => removedNpcs.push(npc),
    getItemOnGroundManager: () => ({
      registerLocation: (player, item, position) => {
        const entry = { player, owner: player.getUsername(), item, position };
        groundItems.push(entry);
        return { item };
      },
      // The real manager: an owner-scoped item is only found by its owner, a public one
      // by everybody.
      getGroundItem: (owner, id, position) => {
        const sameTile = entry => entry.position.getX() === position.getX() &&
          entry.position.getY() === position.getY() &&
          entry.position.getZ() === position.getZ();
        const own = groundItems.find(entry => entry.owner === owner &&
          entry.item.getId() === id && sameTile(entry));
        if (own) return own;
        return worldGroundItems.find(entry => entry.item.getId() === id && sameTile(entry)) ?? null;
      },
    }),
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (events[key] ??= []).forEach(handler => handler(event)),
  }, { get: (target, key) => target[key] ?? noop });

  const original = runtime.startTranscript;
  runtime.startTranscript = (_api, _player, npcId, page, variant) => {
    transcriptCalls.push({ npcId, page, variant });
    return true;
  };
  try {
    require('../plugins/quests/quests/SeaSlug.Quest')(api);
  } finally {
    runtime.startTranscript = original;
  }

  return { events, variants, conditions, objectInteraction, itemOnItem, itemActions, npcInteractions,
    submittedTasks, transcriptCalls, groundItems, worldGroundItems, spawnedNpcs, removedNpcs,
    playerLogin, playerLogout, quest: runtime.getRegisteredQuests().at(-1) };
}

const N = core.NpcIdentifiers;
const I = core.ItemIdentifiers;
const VAR_SEA_SLUG = 159;
// The platform Holgart (cache id 5070) has no world spawn; the mainland Holgart is the
// spawn parent 5071, which the server resolves per player to 7324 or 7789.
const PLATFORM_HOLGART = core.NpcIdentifiers.HOLGART_3;
const MAINLAND_HOLGART = core.NpcIdentifiers.HOLGART_7;

function variant(h, player, npcId) {
  return h.variants.at(-1)({ player, npcId });
}

function condition(h, player, text, npcId = N.CAROLINE) {
  return h.conditions.at(-1)({ player, npcId, text });
}

function action(h, player, npcId, stepId) {
  const event = { player, npcId, stepId, handled: false };
  h.events['npc-dialogue:action'].forEach(handler => handler(event));
  return event;
}

function chosenCondition(h, player, npcId, stepId) {
  const event = { player, npcId, stepId, handled: false };
  h.events['npc-dialogue:condition'].forEach(handler => handler(event));
  return event;
}

function wireValue(player) {
  return player.log.filter(row => row[0] === 'sendConfig' && row[1] === VAR_SEA_SLUG).at(-1)?.[2];
}

function takeGroundItem(h, player, itemId) {
  const index = h.groundItems.findIndex(entry =>
    entry.owner === player.getUsername() && entry.item.getId() === itemId);
  assert.notEqual(index, -1, `ground item ${itemId} owned by ${player.getUsername()}`);
  const [entry] = h.groundItems.splice(index, 1);
  player.items.set(itemId, (player.items.get(itemId) ?? 0) + entry.item.getAmount());
  return entry;
}

/** The damp sticks source is the public world fixture until it is picked up. */
function takeDampSticks(h, player) {
  const own = h.groundItems.findIndex(entry =>
    entry.owner === player.getUsername() && entry.item.getId() === I.DAMP_STICKS);
  if (own !== -1) return takeGroundItem(h, player, I.DAMP_STICKS);
  const index = h.worldGroundItems.findIndex(entry => entry.item.getId() === I.DAMP_STICKS);
  assert.notEqual(index, -1, 'a damp sticks source is on the canonical tile');
  const [entry] = h.worldGroundItems.splice(index, 1);
  player.items.set(I.DAMP_STICKS, (player.items.get(I.DAMP_STICKS) ?? 0) + entry.item.getAmount());
  return entry;
}

function findDialogueStep(steps, id) {
  for (const step of steps || []) {
    if (step?.id === id) return step;
    const nested = findDialogueStep(step?.steps, id);
    if (nested) return nested;
  }
  return null;
}

// The transcript runner: the id index picks the pages, the plugin's variant selector picks
// the variant, and the runner's own flatten/chooseCondition picks the branch.
function resolveTranscript(h, player, npcId) {
  const pages = (dialogueIndex[String(npcId)] ?? [])
    .map(entry => ({
      page: String(entry.page ?? '').replace(/^Transcript:/, ''),
      variants: Array.isArray(entry.variants) ? entry.variants : [],
    }))
    .filter(entry => Object.hasOwn(dialogues, entry.page));
  const choice = h.variants.at(-1)({ player, npcId });
  const wanted = typeof choice === 'string' ? choice : choice?.variant;
  const wantedPage = typeof choice === 'object' ? choice?.page : undefined;
  if (wanted || wantedPage) {
    const page = wantedPage
      ? pages.find(entry => entry.page === wantedPage)
      : pages.find(entry => entry.variants.includes(wanted)) ??
        pages.find(entry => Object.hasOwn(dialogues[entry.page]?.variants ?? {}, wanted));
    if (page) {
      const record = dialogues[page.page];
      const steps = wanted && record?.variants ? record.variants[wanted] : pickVariant(record);
      if (Array.isArray(steps)) return { page: page.page, steps };
    }
  }
  const first = pages.find(entry => pickVariant(dialogues[entry.page]));
  return first ? { page: first.page, steps: pickVariant(dialogues[first.page]) } : { page: null, steps: undefined };
}

function runTranscript(h, player, npcId) {
  const resolved = resolveTranscript(h, player, npcId);
  const steps = flatten(resolved.steps ?? [], {
    resolveCondition: step => h.conditions.at(-1)({
      player, npcId, text: step.text, stepId: step.id,
    }),
  });
  return { page: resolved.page, steps };
}

const actionIds = steps => steps.filter(step => step.type === 'action').map(step => step.id);
const messageIds = steps => steps.filter(step => step.type === 'message').map(step => step.id);
const lineTexts = steps => steps.filter(step => step.type === 'line').map(step => step.text);
const spokenLines = steps => steps.filter(step => typeof step.npc === 'string').map(step => step.npc);
const playerLines = steps => steps.filter(step => typeof step.player === 'string').map(step => step.player);

function rubDrySticks(h, player) {
  const random = Math.random;
  Math.random = () => 0;
  try {
    const event = { player, itemId: I.DRY_STICKS, slot: 0, clickType: 1, handled: false };
    h.itemActions.find(entry => entry.name === 'Dry sticks').actions['Rub-together'](event);
    return event;
  } finally {
    Math.random = random;
  }
}

// Natural registered dispatch to stage 6: no fixture stage writes, no free torch.
function reachTorchStage(h, player) {
  player.items.set(I.SWAMP_PASTE, 1);
  h.events['npc-dialogue:hook'].forEach(handler =>
    handler({ player, npcId: N.CAROLINE, hook: 'quest:sea-slug:start' }));
  assert.equal(variant(h, player, N.HOLGART), 'talking-to-holgart');
  assert.equal(h.quest.getStage(player), 2);
  chosenCondition(h, player, N.HOLGART, 'u-qtrY');
  assert.equal(h.quest.getStage(player), 3);
  action(h, player, N.HOLGART, '46f1OE');
  assert.equal(variant(h, player, N.KENNITH), 'at-the-fishing-platform-talking-to-kennith');
  assert.equal(h.quest.getStage(player), 4);
  assert.equal(variant(h, player, PLATFORM_HOLGART), 'talking-to-holgart-after-talking-to-kennith');
  action(h, player, PLATFORM_HOLGART, 'zUdSJX');
  assert.equal(h.quest.getStage(player), 5);
  assert.equal(variant(h, player, N.KENT), 'at-the-shipwreck-island-talking-to-kent');
  action(h, player, N.KENT, 'EkOxin');
  assert.equal(h.quest.getStage(player), 6);
  action(h, player, N.HOLGART, 'Jn71UA');
}

test('fresh stage 0 reaches completion through the mandatory Quest Helper legs', () => {
  const h = harness();
  const p = makePlayer();
  // Required item from the helper setup list; everything else is earned or
  // generated by the registered handlers below.
  p.items.set(I.SWAMP_PASTE, 1);
  p.setLocation(2717, 3303, 0);

  assert.equal(h.quest.getStage(p), 0, 'fresh stage 0');
  assert.equal(variant(h, p, N.CAROLINE), 'starting-off');
  assert.equal(variant(h, p, N.HOLGART), null, 'Holgart has no Sea Slug line before stage 1');

  h.events['npc-dialogue:hook'].forEach(handler =>
    handler({ player: p, npcId: N.CAROLINE, hook: 'quest:sea-slug:start' }));
  assert.equal(h.quest.getStage(p), 1, 'Caroline start hook');
  assert.equal(variant(h, p, N.CAROLINE), 'starting-off-talking-to-caroline-again');

  assert.equal(variant(h, p, N.HOLGART), 'talking-to-holgart');
  assert.equal(h.quest.getStage(p), 2, 'first Holgart talk marks the paste request');
  assert.equal(variant(h, p, N.HOLGART), 'talking-to-holgart', 'holding swamp paste offers the hand-in');
  chosenCondition(h, p, N.HOLGART, 'u-qtrY');
  assert.equal(p.items.get(I.SWAMP_PASTE) ?? 0, 0, 'one swamp paste is consumed');
  assert.equal(h.quest.getStage(p), 3, 'boat repaired');

  action(h, p, N.HOLGART, '46f1OE');
  assert.deepEqual(p.moves.at(-1), [2784, 3276, 0], 'sail to the fishing platform');

  assert.equal(variant(h, p, N.KENNITH), 'at-the-fishing-platform-talking-to-kennith');
  assert.equal(h.quest.getStage(p), 4, 'first Kennith talk advances to the Kent search');

  assert.equal(variant(h, p, PLATFORM_HOLGART), 'talking-to-holgart-after-talking-to-kennith');
  action(h, p, PLATFORM_HOLGART, 'zUdSJX');
  assert.equal(h.quest.getStage(p), 5, 'sail to the shipwreck island');
  assert.deepEqual(p.moves.at(-1), [2794, 3320, 0]);

  assert.equal(variant(h, p, N.KENT), 'at-the-shipwreck-island-talking-to-kent');
  action(h, p, N.KENT, 'EkOxin');
  assert.equal(h.quest.getStage(p), 6, 'Kent reveals the sea slugs');

  assert.equal(variant(h, p, N.HOLGART_2),
    'at-the-shipwreck-island-talking-to-holgart-again-before-returning-to-the-fishing-platform');
  action(h, p, N.HOLGART_2, 'Jn71UA');
  assert.deepEqual(p.moves.at(-1), [2784, 3276, 0], 'return to the platform');

  assert.equal(variant(h, p, N.BAILEY), 'rescuing-kennith-talking-to-bailey');
  action(h, p, N.BAILEY, 'G6lOss');
  assert.equal(p.items.get(I.UNLIT_TORCH), 1, 'Bailey hands over the unlit torch');

  p.items.set(I.BROKEN_GLASS_2, 1);
  p.items.set(I.DAMP_STICKS, 1);
  const glass = { player: p, usedItemId: I.BROKEN_GLASS_2, usedWithItemId: I.DAMP_STICKS, handled: false };
  h.itemOnItem.forEach(handler => handler(glass));
  assert.equal(glass.handled, true);
  assert.equal(p.items.get(I.BROKEN_GLASS_2) ?? 0, 0, 'broken glass is consumed');
  assert.equal(p.items.get(I.DAMP_STICKS) ?? 0, 0, 'damp sticks are consumed');
  assert.equal(p.items.get(I.DRY_STICKS), 1, 'dry sticks are made');

  const random = Math.random;
  Math.random = () => 0;
  try {
    const rub = { player: p, itemId: I.DRY_STICKS, slot: 0, clickType: 1, handled: false };
    const dry = h.itemActions.find(entry => entry.name === 'Dry sticks');
    dry.actions['Rub-together'](rub);
    assert.equal(rub.handled, true);
  } finally {
    Math.random = random;
  }
  assert.equal(p.items.get(I.LIT_TORCH), 1, 'the unlit torch becomes lit');
  assert.equal(p.items.get(I.UNLIT_TORCH) ?? 0, 0);
  assert.equal(p.items.get(I.DRY_STICKS) ?? 0, 0);
  assert.equal(h.quest.getStage(p), 7, 'torch lit');
  assert.equal(wireValue(p), 7, 'stage 7 is mirrored to varp 159');

  assert.equal(variant(h, p, N.KENNITH), 'rescuing-kennith-talking-to-kennith');
  assert.equal(h.quest.getStage(p), 8, 'Kennith asks for an escape route');

  assert.equal(condition(h, p, 'If the player kicks the loose panel near Kennith after talking to Bailey:',
    N.BAILEY), true);
  const panel = { player: p, objectId: 18251, location: { x: 2768, y: 3289, z: 1 }, handled: false };
  h.objectInteraction.forEach(handler => handler(panel));
  assert.equal(panel.handled, true, 'the raw multi-loc panel id is claimed');
  assert.deepEqual(h.transcriptCalls.at(-1), { npcId: N.BAILEY, page: 'Sea Slug', variant: 'freeing-kennith' });
  action(h, p, N.BAILEY, 'vJ1GjP');
  assert.equal(h.quest.getStage(p), 9, 'the wall panel opens');

  assert.equal(variant(h, p, N.KENNITH),
    'freeing-kennith-talking-to-kennith-after-making-a-hole-in-the-wall');
  assert.equal(h.quest.getStage(p), 10, 'Kennith is ready for the crane');

  p.setLocation(2800, 3300, 0);
  assert.equal(condition(h, p, 'If the player is too far away from the crane:', N.BAILEY), true);
  assert.equal(condition(h, p, 'If the player is one tile from the crane:', N.BAILEY), false);
  const remoteCrane = { player: p, objectId: 18327, location: { x: 2500, y: 3300, z: 0 }, handled: false };
  h.objectInteraction.forEach(handler => handler(remoteCrane));
  assert.equal(remoteCrane.handled, false, 'an unrelated crane loc does not start Kennith rescue');

  p.setLocation(2774, 3289, 1);
  assert.equal(condition(h, p, 'If the player is too far away from the crane:', N.BAILEY), false);
  assert.equal(condition(h, p, 'If the player is one tile from the crane:', N.BAILEY), true);
  const crane = { player: p, objectId: 18327, location: { x: 2770, y: 3287, z: 1 }, handled: false };
  h.objectInteraction.forEach(handler => handler(crane));
  assert.equal(crane.handled, true);
  assert.deepEqual(h.transcriptCalls.at(-1),
    { npcId: N.BAILEY, page: 'Sea Slug', variant: 'freeing-kennith-using-the-crane' });
  action(h, p, N.BAILEY, 'utnJSh');
  assert.equal(h.quest.getStage(p), 11, 'Kennith is lowered to Holgart');

  assert.equal(variant(h, p, PLATFORM_HOLGART), 'freeing-kennith-talking-to-holgart');
  action(h, p, PLATFORM_HOLGART, 'i9MI4w');
  assert.deepEqual(p.moves.at(-1), [2720, 3305, 0], 'return to Witchaven');

  assert.equal(variant(h, p, N.CAROLINE), 'freeing-kennith-talking-to-caroline');
  action(h, p, N.CAROLINE, 'U0muMo');
  assert.equal(h.quest.getStage(p), 12, 'quest complete');
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(wireValue(p), 12, 'completion is sent on varp 159 at the cache threshold');
  assert.equal(p.items.get(I.OYSTER_PEARLS), 1, 'one oyster pearls reward');
  assert.deepEqual(p.xp, [[core.Skill.FISHING, 7175]], '7175 Fishing XP');

  action(h, p, N.CAROLINE, 'U0muMo');
  assert.equal(p.items.get(I.OYSTER_PEARLS), 1, 'the reward is granted once');
  assert.equal(p.xp.length, 1, 'the XP reward is granted once');
});

test('the stage-8 wall multiloc exposes and dispatches its real Kick action', () => {
  const h = harness();
  const p = makePlayer('sea-slug-panel-cache');
  h.quest.setStage(p, 8);
  const sender = new Proxy({
    getVarp: id => id === VAR_SEA_SLUG ? 8 : 0,
    getVarbit: () => 0,
  }, { get: (target, key) => target[key] ?? ((...args) => { p.log.push([String(key), ...args]); }) });
  p.getPacketSender = () => sender;

  const tile = new core.Location(2768, 3289, 1);
  const visible = ObjectDefinition.forPlayer(18251, p);
  assert.equal(visible.id, 18381, 'varp 159 stage 8 transforms the placed base loc to Badly repaired wall');
  assert.equal(visible.getInteractions()[0], 'Kick');
  const object = MapObjects.getPrivateArea(p, visible.id, tile);
  assert.ok(object, 'the client-visible transformed id resolves to its placed base map loc');
  assert.equal(object.getId(), 18251, 'the plugin callback receives the raw map loc id');

  const event = { player: p, object, objectId: object.getId(), location: { x: 2768, y: 3289, z: 1 }, handled: false };
  h.objectInteraction.forEach(handler => handler(event));
  assert.equal(event.handled, true);
  assert.deepEqual(h.transcriptCalls.at(-1),
    { npcId: N.BAILEY, page: 'Sea Slug', variant: 'freeing-kennith' });
  action(h, p, N.BAILEY, 'vJ1GjP');
  assert.equal(h.quest.getStage(p), 9, 'the canonical Kick dialogue completes the wall transition');
});

test('helper loadSteps keys map onto durable stages 1-12 and varp 159, including login replay', () => {
  const h = harness();
  const p = makePlayer();

  assert.equal(h.quest.varpId, VAR_SEA_SLUG);
  assert.equal(h.quest.varbitId, undefined, 'Sea Slug is a full varp, not a varbit');
  assert.equal(h.quest.completionValue, 12);

  // Helper loadSteps keys are 0..11; the durable stages omit 0 and run 1..12.
  const helperToDurable = stage => stage + 1;
  for (let helper = 0; helper <= 11; helper++) {
    const stage = helperToDurable(helper);
    h.quest.setStage(p, stage);
    assert.equal(wireValue(p), stage, `helper ${helper} -> durable stage ${stage} -> varp 159`);
  }

  h.quest.setStage(p, 12);
  assert.equal(wireValue(p), 12);
  assert.equal(h.quest.isComplete(p), true);

  // Existing saves are already in the durable numbering; replay must not renumber them.
  h.quest.setStage(p, 11);
  p.log.length = 0;
  runtime.sendQuestVarps({ player: p });
  assert.equal(wireValue(p), 11, 'stage 11 replays on login');
  h.quest.setStage(p, 12);
  p.log.length = 0;
  runtime.sendQuestVarps({ player: p });
  assert.equal(wireValue(p), 12, 'completed stage 12 replays on login');
});

test('completed players get the named-NPC post-quest pages, not the in-quest lines', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 12);

  assert.deepEqual(variant(h, p, N.CAROLINE), { page: 'Caroline', variant: 'after-sea-slug' });
  assert.ok(dialogues.Caroline.variants['after-sea-slug']?.length);
  assert.ok(dialogueIndex['5067'].some(entry => entry.page === 'Transcript:Caroline' &&
    entry.variants.includes('after-sea-slug')));

  for (const [npcId, page, variantName] of [
    [N.KENNITH, 'Kennith', 'standard-dialogue-after-completion-of-sea-slug'],
    [N.KENT, 'Kent', 'standard-dialogue-after-completion-of-sea-slug'],
    [N.BAILEY, 'Bailey', 'standard-dialogue-after-sea-slug-quest'],
  ]) {
    assert.equal(variant(h, p, npcId), null, `${page} falls back to its named page after completion`);
    assert.ok(dialogues[page].variants[variantName]?.length, `${page} has the canonical post-quest variant`);
    assert.ok(dialogueIndex[String(npcId)].some(entry => entry.page === `Transcript:${page}` &&
      entry.variants.includes(variantName)));
  }
  assert.equal(variant(h, p, N.HOLGART), null, 'Holgart is released for the shared Slug Menace conversations');
});

test('early and out-of-order interactions do not reach late stage effects', () => {
  const h = harness();
  const p = makePlayer();

  assert.equal(variant(h, p, N.HOLGART), null, 'stage 0 Holgart stays on the generic pre-quest page');
  assert.equal(condition(h, p, 'If the player is one tile from the crane:', N.BAILEY), false,
    'the crane is inert before the crane stage');

  h.quest.setStage(p, 6);
  assert.equal(condition(h, p, 'If the player is one tile from the crane:', N.BAILEY), false);
  const crane = { player: p, objectId: 18327, location: { x: 2770, y: 3287, z: 1 }, handled: false };
  h.objectInteraction.forEach(handler => handler(crane));
  action(h, p, N.BAILEY, 'utnJSh');
  assert.equal(h.quest.getStage(p), 6, 'an early crane rotation does not save Kennith');

  h.quest.setStage(p, 7);
  assert.equal(condition(h, p, 'If the player kicks the loose panel near Kennith after talking to Bailey:',
    N.BAILEY), false, 'the panel stays shut before Kennith asks for an escape route');
});

test('a lost torch after the torch stage is replaced through Bailey', () => {
  const h = harness();
  const p = makePlayer();
  h.quest.setStage(p, 7);

  assert.equal(variant(h, p, N.BAILEY), 'rescuing-kennith-talking-to-bailey');
  assert.equal(condition(h, p, 'If the player loses their unlit torch:', N.BAILEY), true);

  // The transcript runner picks the lost-torch branch, not the hand-out.
  const { page, steps } = runTranscript(h, p, N.BAILEY);
  assert.equal(page, 'Sea Slug');
  assert.ok(playerLines(steps).includes("I've managed to lose my torch."));
  assert.deepEqual(actionIds(steps), ['o9pnQL'], 'the lost-torch branch is chosen');
  assert.ok(!actionIds(steps).includes('G6lOss'));

  action(h, p, N.BAILEY, 'o9pnQL');
  assert.equal(p.items.get(I.UNLIT_TORCH), 1, 'Bailey gives a replacement torch');
  assert.equal(h.quest.getStage(p), 7, 'recovery does not change stage');
});

test('Bailey hands the torch over on the free-space branch, not the lost-torch branch', () => {
  const h = harness();
  const p = makePlayer('sea-slug-handout');
  reachTorchStage(h, p);

  const { page, steps } = runTranscript(h, p, N.BAILEY);
  assert.equal(page, 'Sea Slug');
  assert.deepEqual(actionIds(steps), ['G6lOss'], 'the one-free-space branch is chosen');
  assert.ok(lineTexts(steps).includes(
    'I doubt the fishermen will come near you if you can get this torch lit.'));
  assert.ok(!playerLines(steps).includes("I've managed to lose my torch."));
  assert.ok(!lineTexts(steps).includes('That was silly, fortunately I have another. Here, take it.'));

  action(h, p, N.BAILEY, 'G6lOss');
  assert.equal(p.items.get(I.UNLIT_TORCH), 1, 'the hand-out grants the torch');

  // Talking to him again with the torch in hand is the "find a way to light it" line.
  assert.equal(variant(h, p, N.BAILEY), 'rescuing-kennith-talking-to-bailey-again-with-the-unlit-torch');
});

test('Bailey drops the torch on the floor when the bag is full', () => {
  const h = harness();
  const p = makePlayer('sea-slug-fullbag');
  reachTorchStage(h, p);
  p.setFull(true);

  const { steps } = runTranscript(h, p, N.BAILEY);
  assert.ok(messageIds(steps).includes('wKrin9'), 'the full-bag branch is chosen');
  assert.deepEqual(actionIds(steps), ['ab-u4V']);
  assert.ok(!actionIds(steps).includes('G6lOss'), 'the hand-out branch is not taken');
});

test('the platform Holgart is spawned for the player and sails to the island', () => {
  const h = harness();
  const p = makePlayer('sea-slug-platform');
  p.items.set(I.SWAMP_PASTE, 1);

  h.events['npc-dialogue:hook'].forEach(handler =>
    handler({ player: p, npcId: N.CAROLINE, hook: 'quest:sea-slug:start' }));
  assert.equal(variant(h, p, N.HOLGART), 'talking-to-holgart');
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(h.spawnedNpcs.length, 0, 'no platform Holgart before the platform leg');

  chosenCondition(h, p, N.HOLGART, 'u-qtrY');
  assert.equal(h.quest.getStage(p), 3);
  action(h, p, N.HOLGART, '46f1OE');
  assert.deepEqual(p.moves.at(-1), [2784, 3276, 0], 'the boat lands on the platform');

  // Kennith's talk on the platform is stage 4: the platform Holgart appears for the player.
  assert.equal(variant(h, p, N.KENNITH), 'at-the-fishing-platform-talking-to-kennith');
  assert.equal(h.quest.getStage(p), 4);
  const spawned = h.spawnedNpcs.filter(npc => npc.id === PLATFORM_HOLGART);
  assert.equal(spawned.length, 1, 'the platform Holgart is spawned once');
  assert.deepEqual([spawned[0].x, spawned[0].y, spawned[0].z], [2781, 3274, 0]);
  assert.equal(spawned[0].ownerOnly, true, 'he belongs to the player scene');
  assert.equal(spawned[0].owner, p);

  // The transcript runner plays the island leg for him.
  const { page, steps } = runTranscript(h, p, PLATFORM_HOLGART);
  assert.equal(page, 'Sea Slug');
  assert.ok(messageIds(steps).includes('zUdSJX'), 'the island arrival is in the transcript');
  action(h, p, PLATFORM_HOLGART, 'zUdSJX');
  assert.equal(h.quest.getStage(p), 5, 'the island leg advances the quest');
  assert.deepEqual(p.moves.at(-1), [2794, 3320, 0], 'the player lands on the shipwreck island');

  h.quest.setStage(p, 8);
  assert.equal(h.spawnedNpcs.filter(npc => npc.id === PLATFORM_HOLGART).length, 1,
    'he is not spawned twice');

  // The quest is over: he leaves the platform again.
  h.quest.setStage(p, 12);
  assert.equal(h.removedNpcs.length, 1, 'the platform Holgart is removed');
  assert.equal(h.removedNpcs[0], spawned[0]);
});

test('the platform Holgart leaves with the player', () => {
  const h = harness();
  const p = makePlayer('sea-slug-logout');
  h.quest.setStage(p, 5);
  const spawned = h.spawnedNpcs.filter(npc => npc.id === PLATFORM_HOLGART);
  assert.equal(spawned.length, 1, 'the platform Holgart is spawned for the quest');
  h.playerLogout.forEach(handler => handler({ player: p, username: p.getUsername() }));
  assert.equal(h.removedNpcs.length, 1, 'the platform Holgart is removed on logout');
  assert.equal(h.removedNpcs[0], spawned[0]);
});

test('a completed player gets the canonical Holgart page, not the Sea Slug lines', () => {
  const h = harness();
  const p = makePlayer('sea-slug-post');

  // Before the completion the Sea Slug page owns the return home.
  h.quest.setStage(p, 11);
  const before = runTranscript(h, p, MAINLAND_HOLGART);
  assert.equal(before.page, 'Sea Slug');
  assert.equal(variant(h, p, MAINLAND_HOLGART), 'freeing-kennith-talking-to-holgart');

  // After it the plugin releases him and the named page plays its standard dialogue.
  h.quest.setStage(p, 12);
  assert.equal(variant(h, p, MAINLAND_HOLGART), null, 'Holgart is released to his named page');
  const after = runTranscript(h, p, MAINLAND_HOLGART);
  assert.equal(after.page, 'Holgart');
  assert.ok(spokenLines(after.steps).includes("Well hello. Beautiful day isn't it."));
  assert.ok(!playerLines(after.steps).includes('Did you get the kid back to shore?'),
    'the Sea Slug return line is not replayed');
});

test('natural torch route uses the damp sticks at the canonical tile and never consumes dry sticks without a torch', () => {
  const h = harness();
  const p = makePlayer('sea-slug-normal');
  reachTorchStage(h, p);

  // The public world fixture is the source while it lasts: the quest adds no second one.
  const copies = h.groundItems.filter(entry => entry.item.getId() === I.DAMP_STICKS);
  assert.equal(copies.length, 0, 'no player copy while the public fixture is there');
  const fixture = h.worldGroundItems.find(entry => entry.item.getId() === I.DAMP_STICKS);
  assert.ok(fixture, 'the damp sticks fixture is on the canonical tile');
  assert.deepEqual(
    [fixture.position.getX(), fixture.position.getY(), fixture.position.getZ()],
    [2784, 3289, 0]
  );

  takeDampSticks(h, p);
  p.items.set(I.BROKEN_GLASS_2, 1);
  const glass = { player: p, usedItemId: I.BROKEN_GLASS_2, usedWithItemId: I.DAMP_STICKS, handled: false };
  h.itemOnItem.forEach(handler => handler(glass));
  assert.equal(p.items.get(I.DRY_STICKS), 1, 'glass turns the player-owned sticks into dry sticks');

  const noTorch = rubDrySticks(h, p);
  assert.equal(noTorch.handled, true);
  assert.equal(p.items.get(I.DRY_STICKS), 1, 'dry sticks survive the no-torch outcome');
  assert.equal(p.items.get(I.LIT_TORCH) ?? 0, 0);
  assert.equal(h.quest.getStage(p), 6, 'no-torch rub cannot advance the torch stage');

  action(h, p, N.BAILEY, 'G6lOss');
  assert.equal(p.items.get(I.UNLIT_TORCH), 1, 'normal Bailey handout still works');
  rubDrySticks(h, p);
  assert.equal(p.items.get(I.LIT_TORCH), 1);
  assert.equal(p.items.get(I.DRY_STICKS) ?? 0, 0, 'sticks are consumed only after the torch lights');
  assert.equal(h.quest.getStage(p), 7);
});

test('damp sticks use the canonical shared spawn with the smallest supported respawn delay', () => {
  const spawn = groundItemDefinitions.find(entry =>
    entry.id === I.DAMP_STICKS && entry.location?.x === 2784 && entry.location?.y === 3289);
  assert.deepEqual(spawn?.location, { x: 2784, y: 3289, z: 0 });
  // OSRS lists 0 ticks; the loader reserves 0 for a permanent fixture, so one tick
  // is the shortest repeatable source this server can represent.
  assert.equal(spawn.respawn, 1);

  const h = harness();
  const p1 = makePlayer('sea-slug-sticks-a');
  const p2 = makePlayer('sea-slug-sticks-b');
  reachTorchStage(h, p1);
  reachTorchStage(h, p2);
  assert.equal(h.worldGroundItems.length, 1, 'both players share one world spawn');
  assert.equal(h.worldGroundItems[0].respawn, 1, 'the core item manager owns replenishment');
  takeDampSticks(h, p1);
  assert.equal(h.worldGroundItems.length, 0, 'pickup removes the current shared copy');
  assert.equal(h.groundItems.some(entry => entry.item.getId() === I.DAMP_STICKS), false,
    'the quest does not create per-player replacements');

  h.quest.setStage(p1, 7);
  h.playerLogin.forEach(handler => handler({ player: p2 }));
  assert.equal(h.groundItems.some(entry => entry.item.getId() === I.DAMP_STICKS), false,
    'stage changes and login do not duplicate the static source');
});

test('Bailey full-bag action ab-u4V drops one recoverable torch and retry hands one over', () => {
  const h = harness();
  const p = makePlayer('sea-slug-full');
  reachTorchStage(h, p);
  p.setFull(true);

  assert.equal(condition(h, p, 'If the player has no space in their inventory:', N.BAILEY), true);
  action(h, p, N.BAILEY, 'ab-u4V');
  const dropped = () => h.groundItems.filter(entry =>
    entry.owner === p.getUsername() && entry.item.getId() === I.UNLIT_TORCH);
  assert.equal(dropped().length, 1, 'the unlit torch is dropped on the floor');
  assert.deepEqual(
    [dropped()[0].position.getX(), dropped()[0].position.getY(), dropped()[0].position.getZ()],
    [2784, 3276, 0],
    'the drop is at the player tile'
  );
  assert.equal(p.items.get(I.UNLIT_TORCH) ?? 0, 0);

  action(h, p, N.BAILEY, 'ab-u4V');
  assert.equal(dropped().length, 1, 'repeating the action does not duplicate the drop');

  p.setFull(false);
  assert.equal(condition(h, p, 'If the player has no space in their inventory:', N.BAILEY), false);
  action(h, p, N.BAILEY, 'G6lOss');
  assert.equal(p.items.get(I.UNLIT_TORCH), 1, 'freeing a slot lets the retry deliver a torch');
});

test('Holgart swamp tar keeps the canonical unavailable marker and cannot repair the boat', () => {
  const h = harness();
  const p = makePlayer('sea-slug-tar');
  p.items.set(I.SWAMP_TAR, 1);

  h.events['npc-dialogue:hook'].forEach(handler =>
    handler({ player: p, npcId: N.CAROLINE, hook: 'quest:sea-slug:start' }));
  assert.equal(variant(h, p, N.HOLGART), 'talking-to-holgart');
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(variant(h, p, N.HOLGART), 'talking-to-holgart-talking-to-holgart-again');
  assert.equal(condition(h, p, 'If the player has swamp tar:', N.HOLGART), true);

  const unavailable = findDialogueStep(
    dialogues['Sea Slug'].variants['talking-to-holgart-talking-to-holgart-again'],
    'Gq26Ow'
  );
  assert.equal(unavailable?.type, 'unavailable', 'the generated branch still carries Gq26Ow');
  action(h, p, N.HOLGART, 'Gq26Ow');
  assert.equal(h.quest.getStage(p), 2, 'the unavailable marker does not repair the boat');
});
