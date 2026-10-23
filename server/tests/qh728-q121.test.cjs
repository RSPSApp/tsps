// From server/: node --test tests/qh728-q121.test.cjs (after the baseline build).
// Scoped Twilight's Promise (q121) contracts against Quest Helper 06da90f:
// the stage-0 -> 50 durable/wire map, the cache completion contract (varbit 9649 = 50),
// item hand-outs/consumption, recovery branches, login replay/migration, and the
// quest's own NPC Talk-to routing where npc-dialogue-index.json has no entry for the
// resolved content ids (crypt/Teomat Itzla and the knight groups).
//
// Fixtures: two scene-earned sub-stages are set directly (the Mezan fight result and
// the pub escort's fountain result); the actual registered line/action at that stage
// is still the thing under test. The stage-32 and stage-46 starts are labelled fixture
// points too. This is not a playthrough proof of the private scenes.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const runtime = require('../plugins/quests/QuestRuntime');
const { QUESTS } = require('../plugins/quests/Quests.plugin');
const core = PluginManager.getCoreApi();
const noop = () => {};

const PAGE = "Twilight's Promise";
const STAGE_VARBIT = 9649;
const STAGE_ATTRIBUTE = 'quest.twilights_promise.stage';
const RECRUITS_ATTRIBUTE = 'quest.twilights_promise.recruits';
const STAGE_VERSION_ATTRIBUTE = 'twilights-promise:stage-version';
const CHILDREN_OF_THE_SUN = 'children_of_the_sun';

const I = core.ItemIdentifiers;

let transcriptCalls = [];
runtime.startTranscript = (_api, _player, npcId, page, variant) => {
  transcriptCalls.push({ npcId, page, variant });
  return true;
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const messages = [];
  const varbits = new Map();
  const configs = new Map();
  const xp = [];
  const tasks = [];
  let inventoryFull = false;
  let location = new core.Location(1687, 3141, 0);
  let dialogue = null;
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { configs.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    getVarp(id) { return configs.get(id) ?? 0; },
  }, { get: (target, key) => target[key] ?? ((..._args) => sender) });
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    isFull: () => inventoryFull,
    adds(id, amount = 1) {
      if (inventoryFull) return false;
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    deleteNumber(id, amount = 1) { items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); return true; },
    forceAdd(_owner, item) { inventory.adds(item.getId(), item.getAmount()); },
  };
  const player = {
    attrs, items, messages, varbits, configs, xp, tasks,
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => sender,
    getUsername: () => 'q121-test',
    getLocation: () => location,
    moveTo: next => { location = next; },
    setPositionToFace: noop,
    performAnimation: noop,
    sendMessage: text => messages.push(text),
    isRegistered: () => true,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push({ skill, amount }) }),
    getDialogueManager: () => ({
      isActive: () => Boolean(dialogue),
      getCurrent: () => dialogue,
      startDialogues: chain => { dialogue = chain; },
      reset: () => { dialogue = null; },
    }),
    setInventoryFull(value) { inventoryFull = value; },
  };
  return player;
}

function harness({ registerFinalDawn = false } = {}) {
  const events = new Map();
  const variants = [];
  const conditions = [];
  const namedNpcs = new Map();
  const objects = new Map();
  const itemActions = new Map();
  const itemOnNpc = [];
  const tasks = [];
  const spawned = [];
  const removed = [];
  const coreApi = {
    ...core,
    CountdownTask: class { constructor(key, ticks, run) { Object.assign(this, { key, ticks, run }); } },
    TaskManager: {
      submit(task) { tasks.push(task); },
      cancelTasks() {},
    },
  };
  const api = new Proxy({
    core: coreApi,
    persistAttribute: noop,
    onNpcDialogueVariant: handler => variants.push(handler),
    onNpcDialogueCondition: handler => conditions.push(handler),
    onNpcInteraction(name, actions) {
      if (typeof name !== 'string') return;
      const prior = namedNpcs.get(name) ?? {};
      const combined = { ...prior };
      for (const [option, callback] of Object.entries(actions ?? {})) {
        const previous = prior[option];
        combined[option] = (event) => {
          if (previous) {
            const result = previous(event);
            if (result !== false || event.handled) return result;
          }
          return callback(event);
        };
      }
      namedNpcs.set(name, combined);
    },
    onObjectInteraction(name, actions) { if (typeof name === 'string') objects.set(name, actions); },
    onItemAction(name, actions) { itemActions.set(name, actions); },
    onItemOnNpc: handler => itemOnNpc.push(handler),
    onCustomEvent(name, handler) { const list = events.get(name) ?? []; list.push(handler); events.set(name, list); },
    emitCustomEvent(name, event) { for (const handler of [...(events.get(name) ?? [])]) handler(event); },
    spawnNpc(def) {
      const npc = {
        def,
        getId: () => def.id,
        getContentId: () => def.id,
        getLocation: () => new core.Location(def.x, def.y, def.z ?? 0),
        isRegistered: () => true,
        setFollowing: noop,
        setMobileInteraction: noop,
        getMovementQueue: () => ({ reset: noop, addSteps: noop }),
        forceChat: noop,
        performAnimation: noop,
        moveTo: noop,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { removed.push(npc); },
  }, { get: (target, key) => target[key] ?? noop });
  if (registerFinalDawn) require('../plugins/quests/quests/TheFinalDawn.Quest')(api);
  require('../plugins/quests/quests/TwilightPromise.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);

  // The start hook asks whether Children of the Sun is complete; answer it for this fixture.
  const isComplete = events.get('quest:is-complete') ?? [];
  isComplete.push(event => {
    if (event.key === CHILDREN_OF_THE_SUN || (registerFinalDawn && event.key === 'the_heart_of_darkness')) {
      event.complete = true;
    }
  });
  events.set('quest:is-complete', isComplete);
  const isStarted = events.get('quest:is-started') ?? [];
  isStarted.push(event => {
    if (event.key === 'twilights_promise') event.started = quest.isStarted(event.player);
  });
  events.set('quest:is-started', isStarted);
  const getStage = events.get('quest:get-stage') ?? [];
  getStage.push(event => {
    if (event.key === quest.key) event.stage = quest.getStage(event.player);
  });
  events.set('quest:get-stage', getStage);

  const line = (player, text, npcId) => {
    const event = { player, npcId, text, handled: false };
    for (const handler of events.get('npc-dialogue:line') ?? []) handler(event);
    return event;
  };
  const action = (player, stepId) => {
    const event = { player, stepId, pages: [{ page: PAGE }], handled: false };
    for (const handler of events.get('npc-dialogue:action') ?? []) handler(event);
    return event;
  };
  const runTask = (ticks) => {
    const task = ticks === undefined ? tasks.at(-1) : tasks.find(entry => entry.ticks === ticks);
    assert.ok(task, `expected a ${ticks ?? 'pending'}-tick task`);
    task.run();
  };
  const runLastTask = () => runTask();
  return { player: null, api, quest, variants, conditions, namedNpcs, objects, itemActions, itemOnNpc,
    events, tasks, spawned, removed, line, action, runTask, runLastTask };
}

function knightTalk(h, player, npcId, npc = {}) {
  const handler = h.namedNpcs.get('Knight of Varlamore')?.['Talk-to'];
  assert.equal(typeof handler, 'function');
  const event = { player, npcId, npc: { getContentId: () => npcId, getId: () => npcId, getLocation: () => new core.Location(1682, 3104, 0), ...npc }, handled: false };
  return { handled: handler(event), event };
}

function twinsTalk(h, player, npcId) {
  const handler = h.namedNpcs.get(npcId === 12890 ? 'Furia Tullus' : 'Ennius Tullus')?.['Talk-to'];
  assert.equal(typeof handler, 'function');
  const event = { player, npcId, npc: { getContentId: () => npcId, getId: () => npcId, getLocation: () => new core.Location(1684, 3156, 0) }, handled: false };
  return { handled: handler(event), event };
}

function princeTalk(h, player, npcId, x, y) {
  const handler = h.namedNpcs.get('Prince Itzla Arkan')?.['Talk-to'];
  assert.equal(typeof handler, 'function');
  const event = { player, npcId, npc: { getContentId: () => npcId, getId: () => npcId, getLocation: () => new core.Location(x, y, 0) }, handled: false };
  return { handled: handler(event), event };
}

function packedRecruits(bazaar, cothon, pub, colosseum) {
  return bazaar | (cothon << 2) | (pub << 4) | (colosseum << 6);
}

test('unindexed knight and Itzla content ids dispatch their canonical Twilight variants', () => {
  const h = harness();
  const p = h.player = makePlayer();
  const crypt = { x: 1683, y: 9515 };
  const teomat = { x: 1454, y: 3173 };

  h.quest.setStage(p, 6);
  transcriptCalls = [];
  assert.equal(twinsTalk(h, p, 12892).handled, true);
  assert.equal(transcriptCalls.at(-1).variant, 'with-friends-like-these-talking-to-either-ennius-or-furia-tullus-talking-to-either-again');
  h.quest.setStage(p, 24);
  assert.equal(twinsTalk(h, p, 12890).handled, true);
  assert.equal(transcriptCalls.at(-1).variant, 'oh-brother-judgement-talking-to-the-twins-again');

  h.quest.setStage(p, 14);
  transcriptCalls = [];
  assert.equal(knightTalk(h, p, 12902).handled, true);
  assert.equal(transcriptCalls.at(-1).variant, 'oh-brother-arrun-and-claudia');
  assert.equal(knightTalk(h, p, 12906).handled, true);
  assert.equal(transcriptCalls.at(-1).variant, 'oh-brother-nel');
  assert.equal(knightTalk(h, p, 12914).handled, true);
  assert.equal(transcriptCalls.at(-1).variant, 'oh-brother-mezan');
  assert.equal(knightTalk(h, p, 12908).handled, true);
  assert.equal(transcriptCalls.at(-1).variant, 'oh-brother-velam-and-azali');

  h.quest.setStage(p, 8);
  transcriptCalls = [];
  assert.equal(princeTalk(h, p, 12896, crypt.x, crypt.y).handled, true);
  assert.equal(transcriptCalls.at(-1).variant, 'with-friends-like-these-talking-to-prince-itzla-or-servius');
  h.quest.setStage(p, 10);
  assert.equal(princeTalk(h, p, 12896, crypt.x, crypt.y).handled, true);
  assert.equal(transcriptCalls.at(-1).variant, 'with-friends-like-these-talking-to-prince-itzla-or-servius-talking-to-either-after-hearing-about-the-assassination-attempt');
  // Servius shares the crypt conversation and is also routed from the plugin.
  h.quest.setStage(p, 8);
  assert.equal(princeTalk(h, p, 12899, crypt.x, crypt.y).handled, true);
  assert.equal(transcriptCalls.at(-1).variant, 'with-friends-like-these-talking-to-prince-itzla-or-servius');

  h.quest.setStage(p, 50);
  assert.equal(princeTalk(h, p, 12896, teomat.x, teomat.y).handled, true);
  assert.equal(transcriptCalls.at(-1).variant, 'post-quest-dialogue-talking-to-prince-itzla-arkan');
});

test('the shared crypt Servius hook yields from The Final Dawn to Twilight in registered order', () => {
  assert.ok(QUESTS.indexOf('TheFinalDawn') < QUESTS.indexOf('TwilightPromise'),
    'the integration fixture follows production quest registration order');
  const h = harness({ registerFinalDawn: true });
  const p = makePlayer();
  h.quest.setStage(p, 8);
  const talk = h.namedNpcs.get('Servius, Teokan of Ralos')?.['Talk-to'];
  assert.equal(typeof talk, 'function');
  const event = {
    player: p,
    npcId: 12899,
    npc: { getId: () => 12899, getContentId: () => 12899, getLocation: () => new core.Location(1684, 9516, 0) },
    handled: false,
  };
  assert.equal(talk(event), true);
  assert.equal(event.handled, true);
  assert.equal(transcriptCalls.at(-1).variant, 'with-friends-like-these-talking-to-prince-itzla-or-servius');
  h.quest.setStage(p, 50);
  p.setAttribute('quest.the_final_dawn.stage', 1000);
  const postQuest = { ...event, handled: false };
  assert.equal(talk(postQuest), true);
  assert.equal(transcriptCalls.at(-1).variant, 'post-quest-dialogue-talking-to-servius',
    'completed Twilight does not capture Final Dawn post-quest dialogue');
});

test('Ennius keeps the canonical Regulus repeat through Twilight stages 34 to 38', () => {
  const h = harness();
  const p = makePlayer();
  for (const value of [34, 36, 38]) {
    h.quest.setStage(p, value);
    const result = twinsTalk(h, p, 12892);
    assert.equal(result.handled, true, `Ennius remains owned at stage ${value}`);
    assert.equal(transcriptCalls.at(-1).variant, 'oh-brother-judgement-talking-to-either-again');
  }
});

test('fresh stage 0 follows the registered mandatory edges to the completion wire', () => {
  const h = harness();
  const p = h.player = makePlayer();
  const ARRUN = 12902, CLAUDIA = 12904, NEL = 12906, VELAM = 12908, MEZAN = 12914;
  const ITZLA = 12896;
  assert.equal(h.quest.getStage(p), 0, 'fresh stage 0');

  // 0 -> 2: the twins' start hook (Children of the Sun fixture above).
  for (const handler of h.events.get('npc-dialogue:hook') ?? []) {
    handler({ player: p, npcId: 12892, hook: 'quest:twilight-s-promise:start' });
  }
  assert.equal(h.quest.getStage(p), 2);
  assert.equal(p.varbits.get(STAGE_VARBIT), 2);
  assert.ok(p.messages.some(message => message.includes("You've started a new quest")));
  assert.equal(h.variants[0]({ player: p, npcId: 12892 }), 'with-friends-like-these-talking-to-either-ennius-or-furia-tullus-talking-to-either-again-after-starting-the-quest');

  // 2 -> 4 -> 6 -> 8 -> 10 -> 12: the temple, Metzli, crypt and Prince lines.
  h.line(p, 'On the other side of the bazaar, south of here.', 12892).before();
  assert.equal(h.quest.getStage(p), 4);
  assert.equal(h.variants[0]({ player: p, npcId: 12894, npc: { getLocation: () => new core.Location(1698, 3088, 0) } }), 'with-friends-like-these-talking-to-metzli-teokan-of-ranul');
  h.line(p, 'Yes. As Teokan of Ranul, I lead the Sect of Ranul. My counterpart, Servius, leads the Church of Ralos.', 12894).before();
  assert.equal(h.quest.getStage(p), 6);
  assert.equal(h.variants[0]({ player: p, npcId: 12894, npc: { getLocation: () => new core.Location(1698, 3088, 0) } }), 'with-friends-like-these-talking-to-metzli-teokan-of-ranul-talking-to-metzli-before-asking-about-prince-itzla');
  h.line(p, "Yes you are. He is speaking with Servius, down in the crypt. Not a place you'd normally find the Teokan of Ralos, but the Prince desired the privacy only Ranul can offer.", 12894).before();
  assert.equal(h.quest.getStage(p), 8);
  h.line(p, "You're quite right, of course. But anyway, shall we get down to business?", ITZLA).before();
  assert.equal(h.quest.getStage(p), 10);
  h.line(p, "Then it sounds like we're all set. Timoiva, and may the sun light your way!", 12890).before();
  assert.equal(h.quest.getStage(p), 12);
  assert.equal(h.variants[0]({ player: p, npcId: 12890 }), 'oh-brother-talking-to-the-tullus-twins');

  // 12 -> 14: the crest.
  h.action(p, 'Ev2lHZ');
  assert.equal(h.quest.getStage(p), 14);
  assert.equal(p.items.get(I.VARLAMORE_CREST), 1);

  // 14 -> 16: bazaar amulet errand (registered Talk-to after the citizen pickpocket).
  h.line(p, "Well this doesn't sound totally orthodox, but fair enough. I'll be back soon.", ARRUN).before();
  const pickpocket = h.namedNpcs.get('Citizen')?.Pickpocket;
  assert.equal(typeof pickpocket, 'function');
  assert.equal(pickpocket({ player: p, npcId: 12929, npc: { getId: () => 12929, getContentId: () => 12929 } }), true);
  assert.match(p.messages.at(-1), /You attempt to pick the man's pocket/);
  h.runLastTask();
  assert.equal(transcriptCalls.at(-1).variant, 'oh-brother-arrun-and-claudia-pickpocketing-the-citizen');
  h.action(p, 'D0l_R6');
  assert.equal(p.items.get(I.STOLEN_AMULET), 1);
  h.action(p, 'VgHiDe');
  assert.equal(p.items.get(I.STOLEN_AMULET), 0, 'the amulet is handed in');
  assert.equal(h.quest.getStage(p), 16);

  // 16 -> 18: cothon crate errand.
  h.line(p, "Good to know. I'll get to it and let you know what I find.", NEL).before();
  const search = h.objects.get('Crate')?.Search;
  assert.equal(typeof search, 'function');
  assert.equal(search({ player: p, objectId: 50870, definition: { id: 50870 }, location: { x: 1778, y: 3149 } }), true);
  assert.equal(transcriptCalls.at(-1).variant, 'oh-brother-nel-searching-the-correct-crate');
  h.action(p, 'ibPuw6');
  h.line(p, 'Great!', NEL).before();
  assert.equal(h.quest.getStage(p), 18);

  // Fixture: Mezan's spar result (scene fight not run here). Then the registered line.
  h.line(p, 'Oh, and bring two attack styles in with you. I want some variety, and it will help me test my faith in Ralos.', MEZAN).before();
  assert.equal(h.quest.getStage(p), 18, 'asking Mezan does not advance the stage');
  p.attrs.set(RECRUITS_ATTRIBUTE, packedRecruits(3, 3, 0, 2));
  h.line(p, 'Perfect! Thanks.', MEZAN).before();
  assert.equal(h.quest.getStage(p), 20);

  // Fixture: the pub escort's fountain result (scene not run here). Start and finish lines are real.
  h.line(p, "Well there's nothing like a little dunk to sober you up a bit. Azali, come with me.", VELAM).before();
  assert.equal(h.quest.getStage(p), 20, 'starting the escort does not advance the stage');
  h.line(p, 'Ohh... We\'re going somewhere new? How exciting!', 12912).before();
  assert.equal(h.spawned.at(-1).def.id, 13393, 'Azali follows from the pub');
  p.attrs.set(RECRUITS_ATTRIBUTE, packedRecruits(3, 3, 2, 3));
  h.line(p, "This day is the worst. Fine, I'll head over there soon.", 12910).before();
  assert.equal(h.quest.getStage(p), 22, 'all four groups agreed');

  // 22 -> 24: the crest is taken back in the palace.
  h.line(p, "We'll keep the knights busy until you're done.", 12890).before();
  assert.equal(h.quest.getStage(p), 24);
  assert.equal(p.items.get(I.VARLAMORE_CREST) ?? 0, 0);

  // 24 -> 26 -> 28: the correct chest's letter, then reading it.
  const chests = [50865, 50866];
  const openChest = h.objects.get('Chest')?.Open;
  assert.equal(typeof openChest, 'function');
  const object = { getId: () => chests[0], getLocation: () => new core.Location(1648, 3142, 0), getType: () => 10, getFace: () => 0 };
  assert.equal(openChest({ player: p, objectId: chests[0], definition: { id: chests[0] }, object }), true);
  const correctChest = p.attrs.get('quest.twilights_promise.letter-chest');
  assert.ok(chests.includes(correctChest));
  transcriptCalls = [];
  assert.equal(openChest({ player: p, objectId: correctChest, definition: { id: correctChest }, object }), true);
  assert.equal(transcriptCalls.at(-1).variant, 'oh-brother-judgement-searching-the-correct-chest');
  h.action(p, 'nUVL01');
  assert.equal(h.quest.getStage(p), 26);
  assert.equal(p.items.get(I.INCRIMINATING_LETTER), 1);
  const read = h.itemActions.get('Incriminating letter')?.Read;
  assert.equal(typeof read, 'function');
  assert.equal(read({ player: p }), true);
  assert.equal(h.quest.getStage(p), 28);
  assert.equal(h.variants[0]({ player: p, npcId: 12890 }), 'oh-brother-judgement-talking-to-the-tullus-twins');

  // 28 -> 30: the verdict line; fixture past the private palace cutscene, then 32 -> 34.
  h.line(p, 'Then it sounds like Velam has some explaining to do. This should be fun.', 12890).before();
  assert.equal(h.quest.getStage(p), 30);
  h.quest.setStage(p, 32); // fixture: the cutscene's knight exit
  h.line(p, 'You should not waste time. The Prince will be eager to hear what you\'ve discovered.', 12890).before();
  assert.equal(h.quest.getStage(p), 34);
  assert.equal(h.variants[0]({ player: p, npcId: 12885 }), 'the-twilight-emissaries-talking-to-regulus');

  // 34 -> 36: Regulus hands over the feed; losing it is recoverable from his repeat branch.
  h.action(p, 'V6x6Qr');
  assert.equal(h.quest.getStage(p), 36);
  assert.equal(p.items.get(I.QUETZAL_FEED), 1);
  assert.equal(h.variants[0]({ player: p, npcId: 12885 }), 'the-twilight-emissaries-talking-to-regulus-talking-to-regulus-again');
  p.items.delete(I.QUETZAL_FEED);
  h.action(p, '2fRkv2');
  assert.equal(p.items.get(I.QUETZAL_FEED), 1, 'Regulus replaces a lost feed');

  // 36 -> 38: feeding Renu consumes the feed and unlocks the quetzal network.
  const feed = h.namedNpcs.get('Renu')?.Feed;
  assert.equal(typeof feed, 'function');
  assert.equal(feed({ player: p, npcId: 13349, npc: { getId: () => 13349 } }), true);
  assert.equal(transcriptCalls.at(-1).variant, 'the-twilight-emissaries-talking-to-regulus-talking-to-regulus-again');
  h.action(p, 'OlyLnC');
  h.runTask(9);
  assert.equal(h.quest.getStage(p), 38);
  assert.equal(p.items.get(I.QUETZAL_FEED) ?? 0, 0, 'the feed is consumed');

  // 38 -> 40 -> 42 -> 44: the Teomat conversation and Metzli's library.
  h.line(p, 'Now, [player name], did your investigation uncover anything else?', ITZLA).before();
  assert.equal(h.quest.getStage(p), 40);
  h.line(p, "Right, I'll go and see if she can help me.", ITZLA).before();
  assert.equal(h.quest.getStage(p), 42);
  h.line(p, "I guess I'd better...", 12894).before();
  assert.equal(h.quest.getStage(p), 44);
  assert.equal(h.variants[0]({ player: p, npcId: 12894, npc: { getLocation: () => new core.Location(1451, 3194, 0) } }), 'the-twilight-emissaries-talking-to-metzli');

  // Fixture: the aftermath has played to the guard's departure. The registered action and final line are real.
  h.quest.setStage(p, 46);
  h.action(p, 'rp2e-K');
  assert.equal(h.quest.getStage(p), 48);
  h.line(p, "However, let's not worry about that just now. Instead, I wanted to thank you for all that you've done. You may be an outsider, but you've already proven yourself to be a true friend to Varlamore. Thank you, iknami.", ITZLA).before();
  assert.equal(h.quest.getStage(p), 50, 'the final transcript line completes the quest');
  assert.equal(p.varbits.get(STAGE_VARBIT), 50, 'the canonical completion wire is varbit 9649 = 50');
  assert.equal(h.quest.isComplete(p), true);
  assert.equal(p.attrs.get('quest.points'), 1);
  assert.deepEqual(p.xp, [{ skill: core.Skill.THIEVING, amount: 3000 }]);
  assert.ok(p.messages.some(message => message.includes("Congratulations, you've completed a quest")));

  // Replaying the final line must not pay twice.
  h.line(p, "However, let's not worry about that just now. Instead, I wanted to thank you for all that you've done. You may be an outsider, but you've already proven yourself to be a true friend to Varlamore. Thank you, iknami.", ITZLA).before();
  assert.equal(p.attrs.get('quest.points'), 1);
  assert.deepEqual(p.xp, [{ skill: core.Skill.THIEVING, amount: 3000 }]);

  // Login/bootstrap replays the saved wire value (the quest list bootstrap clobbers shared varps).
  p.varbits.delete(STAGE_VARBIT);
  runtime.sendQuestVarps({ player: p });
  assert.equal(p.varbits.get(STAGE_VARBIT), 50);
});

test('the bazaar amulet handout stays retryable when full or after the item is destroyed', () => {
  const h = harness();
  const p = makePlayer();
  const bazaarState = () => (Number(p.attrs.get(RECRUITS_ATTRIBUTE)) || 0) & 3;
  h.quest.setStage(p, 14);
  h.line(p, "Well this doesn't sound totally orthodox, but fair enough. I'll be back soon.", 12902).before();
  assert.equal(bazaarState(), 1);
  const pickpocket = h.namedNpcs.get('Citizen').Pickpocket;
  p.setInventoryFull(true);
  const refused = { player: p, npcId: 12929, npc: { getId: () => 12929, getContentId: () => 12929 }, handled: false };
  assert.equal(pickpocket(refused), true);
  assert.equal(bazaarState(), 1, 'a full inventory leaves the citizen lead available');
  assert.equal(p.items.get(I.STOLEN_AMULET) ?? 0, 0);

  p.setInventoryFull(false);
  const retry = { player: p, npcId: 12929, npc: { getId: () => 12929, getContentId: () => 12929 }, handled: false };
  assert.equal(pickpocket(retry), true);
  h.runLastTask();
  h.action(p, 'D0l_R6');
  assert.equal(bazaarState(), 2);
  assert.equal(p.items.get(I.STOLEN_AMULET), 1);

  p.items.delete(I.STOLEN_AMULET); // The cache item advertises Destroy.
  const reclaim = { player: p, npcId: 12929, npc: { getId: () => 12929, getContentId: () => 12929 }, handled: false };
  assert.equal(pickpocket(reclaim), true, 'the completed pickpocket state can recover a destroyed amulet');
  h.runLastTask();
  h.action(p, 'D0l_R6');
  assert.equal(bazaarState(), 2);
  assert.equal(p.items.get(I.STOLEN_AMULET), 1);
});

test('crest and letter recovery branches hand the item back without renumbering the save', () => {
  const h = harness();
  const p = h.player = makePlayer();

  // Lost crest during the knight errands: the twins' repeat branch restores it.
  h.quest.setStage(p, 14);
  assert.equal(h.variants[0]({ player: p, npcId: 12890 }), 'oh-brother-talking-to-the-tullus-twins-talking-to-either-again');
  assert.equal(h.conditions[0]({ player: p, stepId: 'e6vbnR', pages: [{ page: PAGE }] }), true);
  h.action(p, 'xxd9qj');
  assert.equal(p.items.get(I.VARLAMORE_CREST), 1);
  assert.equal(h.quest.getStage(p), 14);

  // Lost letter after searching or reading: the correct chest gives it again.
  h.quest.setStage(p, 28);
  h.action(p, 'nUVL01');
  assert.equal(p.items.get(I.INCRIMINATING_LETTER), 1);
  assert.equal(h.quest.getStage(p), 28, 'recovering the letter never rewinds the stage');
});

test('login migration maps old saves and bootstrap resends the durable stage', () => {
  const h = harness();
  const p = h.player = makePlayer();

  // Old plugin stage 26 with the message-read flag maps to the read letter stage.
  p.attrs.set(STAGE_ATTRIBUTE, 26);
  p.attrs.set('quest.twilights_promise.flags', 1);
  assert.equal(p.attrs.get(STAGE_VERSION_ATTRIBUTE), undefined);
  h.api.emitCustomEvent('player:bootstrap-complete', { player: p });
  assert.equal(h.quest.getStage(p), 28);
  assert.equal(p.attrs.get(STAGE_VERSION_ATTRIBUTE), 1);
  assert.equal(p.attrs.get('quest.twilights_promise.flags'), null);
  assert.equal(p.varbits.get(STAGE_VARBIT), 28);

  // Fresh harness-style old stage 40 maps to the fed stage once, preserving the durable save.
  p.attrs.set(STAGE_ATTRIBUTE, 40);
  p.attrs.set(STAGE_VERSION_ATTRIBUTE, undefined);
  h.api.emitCustomEvent('player:bootstrap-complete', { player: p });
  assert.equal(h.quest.getStage(p), 38);
  assert.equal(p.varbits.get(STAGE_VARBIT), 38);
  h.api.emitCustomEvent('player:bootstrap-complete', { player: p });
  assert.equal(h.quest.getStage(p), 38, 'a second bootstrap is idempotent');

  // Fresh stage 0 is resent as 0, not left on the bootstrap's shared varp value.
  const fresh = makePlayer();
  runtime.sendQuestVarps({ player: fresh });
  assert.equal(fresh.varbits.get(STAGE_VARBIT), 0);
});
