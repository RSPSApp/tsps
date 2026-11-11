// Source-contract checks for Mourning's End Part I (Quest Helper q078).
// Run from server/: node --test tests/qh728-q078.test.cjs (after yarn build).
//
// Quest Helper source: pinned /tmp/tsps-600-parallel/quest-helper
// src/main/java/com/questhelper/helpers/quests/mourningsendparti/MourningsEndPartI.java
// at 06da90f982518a093f2fe1c9cfac5547fa7053d3.
//
// The route test starts at fresh stage 0 and fixture-sets ordinary supplies and
// quest items before each registered handler. Every stage change below comes
// from the plugin's real registered handler (variant selector, action, item,
// object, NPC or hook). This proves the handler/stage contract and cache wire,
// not a live playthrough or the visual Quest Helper overlay.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require(root + '/dist/plugins/PluginManager');
const runtime = require(root + '/plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;

const transcripts = [];
const realStartTranscript = runtime.startTranscript;
runtime.startTranscript = (_api, player, npcId, page, variant, select) => {
  transcripts.push({ player, npcId, page, variant, select });
  return true;
};

function makeHarness({ completed = ['roving_elves', 'big_chompy_bird_hunting', 'sheep_herder', 'eadgar_s_ruse'], levels = {}, boostedLevels = {} } = {}) {
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const objectHooks = [];
  const npcDeaths = [];
  const logins = [];
  const namedNpcs = new Map();
  const spawned = [];
  const removed = [];
  const configs = new Map();
  const varbits = new Map();
  const messages = [];
  const xp = [];
  const jingles = [];
  const attributes = new Map();
  const inventory = new Map();
  const equipment = new Map();
  const completedQuests = new Set(completed);
  const skillLevels = new Map(Object.entries(levels).map(([skill, level]) => [skill.toUpperCase(), level]));
  let location = new core.Location(2352, 3170, 0);
  let inventoryFull = false;

  const sender = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendJingle(id) { jingles.push(id); return sender; },
    sendInterfaceRemoval() { return sender; },
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });

  const inventoryApi = {
    getAmount: (id) => inventory.get(id) ?? 0,
    contains: (id) => inventoryApi.getAmount(id) > 0,
    isFull: () => inventoryFull,
    getFreeSlots: () => inventoryFull ? 0 : 28 - [...inventory.values()].filter((amount) => amount > 0).length,
    adds(id, amount = 1) {
      inventory.set(id, (inventory.get(id) ?? 0) + amount);
      return inventoryApi;
    },
    forceAdd(_player, item) {
      inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount());
    },
    deleteNumber(id, amount = 1) {
      const left = (inventory.get(id) ?? 0) - amount;
      if (left > 0) inventory.set(id, left);
      else inventory.delete(id);
      return inventoryApi;
    },
    getItems: () => [...inventory].filter(([, amount]) => amount > 0)
      .map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
  };

  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getInventory: () => inventoryApi,
    getEquipment: () => ({ get: (slot) => equipment.get(slot) ?? null }),
    getSkillManager: () => ({
      addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
      getMaxLevel: (skill) => skillLevels.get(skill.getName?.().toUpperCase()) ?? 99,
      getCurrentLevel: (skill) => boostedLevels[skill.getName?.().toUpperCase()] ?? skillLevels.get(skill.getName?.().toUpperCase()) ?? 99,
    }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, reset: noop, getCurrent: () => null, advance: noop, startDialogues: noop }),
    getLocation: () => location,
    moveTo: (next) => { location = next; },
    sendMessage: (message) => messages.push(message),
    getUsername: () => 'qh728-q078',
    getIndex: () => 1,
    getPrivateArea: () => null,
    isRegistered: () => true,
    isPlayer: () => true,
    isPlayerBot: () => false,
  };

  const api = new Proxy({
    core: {
      ...core,
      TaskManager: { submit: (task) => task.execute(), cancelTasks: noop },
    },
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onNpcInteraction(name, handlers) {
      if (typeof name === 'function') return;
      namedNpcs.set(name, handlers);
    },
    onObjectInteraction(handler) {
      if (typeof handler === 'function') objectHooks.push(handler);
    },
    onItemOnItem: (handler) => { api.__itemOnItem = handler; },
    onItemOnObject: (handler) => { api.__itemOnObject = handler; },
    onItemOnNpc: (handler) => { api.__itemOnNpc = handler; },
    onNpcDeath: (handler) => npcDeaths.push(handler),
    onPlayerLogin: (handler) => logins.push(handler),
    onCustomEvent(name, handler) {
      const list = custom.get(name) ?? [];
      list.push(handler);
      custom.set(name, list);
    },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete') {
        event.complete = completedQuests.has(event.key);
        return;
      }
      for (const handler of custom.get(name) ?? []) handler(event);
    },
    spawnNpc(definition) {
      const npc = {
        ...definition,
        getId: () => definition.id,
        getLocation: () => new core.Location(definition.x, definition.y, definition.z),
        isRegistered: () => true,
        remove: noop,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { if (npc) removed.push(npc); },
  }, { get: (target, key) => (key in target ? target[key] : noop) });

  require(root + '/plugins/quests/quests/MourningsEndPartI.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'mournings_end_part_i');
  assert.ok(quest, 'Mourning\'s End Part I registered');

  const fire = (name, event = {}) => {
    const request = { player, handled: false, ...event };
    for (const handler of custom.get(name) ?? []) handler(request);
    return request;
  };
  const action = (stepId, npcId = N.ELUNED) => fire('npc-dialogue:action', { npcId, stepId });
  const choice = (npcId, option) => fire('npc-dialogue:choice', { npcId, option });
  const hook = (hookName, npcId = 7780) => fire('npc-dialogue:hook', { hook: hookName, npcId });
  const itemOnItem = (usedItemId, usedWithItemId) => {
    const event = { player, usedItemId, usedWithItemId, handled: false };
    api.__itemOnItem(event);
    return event;
  };
  const itemOnObject = (itemId, objectId) => {
    const event = { player, itemId, objectId, location, handled: false };
    api.__itemOnObject(event);
    return event;
  };
  const itemOnNpc = (itemId, npcId) => {
    const event = { player, itemId, npcId, handled: false };
    api.__itemOnNpc(event);
    return event;
  };
  const object = (objectId) => {
    const event = { player, objectId, location, handled: false, clickType: 1 };
    for (const handler of objectHooks) handler(event);
    return event;
  };
  const variant = (npcId) => {
    const picked = variants.map((handler) => handler({ player, npcId })).find(Boolean) ?? null;
    return typeof picked === 'string' ? { variant: picked } : picked;
  };
  const condition = (stepId, npcId = N.ELUNED, extra = {}) => conditions
    .map((handler) => handler({ player, npcId, stepId, ...extra }))
    .find((value) => value !== null && value !== undefined);
  const talk = (name, npcId) => {
    const handlers = namedNpcs.get(name);
    assert.ok(handlers?.['Talk-to'], `missing ${name}.Talk-to`);
    const event = { player, npcId, handled: false };
    handlers['Talk-to'](event);
    return event;
  };
  const die = (npcId, killer = player) => {
    for (const handler of npcDeaths) handler({ killer, npcId });
  };
  const login = () => {
    for (const handler of logins) handler({ player });
  };

  return {
    api, player, quest, attributes, inventory, equipment, configs, varbits, messages, xp, jingles,
    spawned, removed, fire, action, choice, hook, itemOnItem, itemOnObject, itemOnNpc, object,
    variant, condition, talk, die, login,
    setFull(value) { inventoryFull = value; },
    give(id, amount = 1) { inventory.set(id, (inventory.get(id) ?? 0) + amount); },
    take(id, amount = 1) { inventoryApi.deleteNumber(id, amount); },
    wear(slot, itemId) { equipment.set(slot, { getId: () => itemId }); },
    fire,
  };
}

test('fresh stage 0 starts through Eluned and the Roving Elves start hook', () => {
  const h = makeHarness();
  assert.equal(h.quest.getStage(h.player), 0);

  // Direct Eluned start (implemented fallback route).
  assert.equal(h.variant(N.ELUNED)?.variant, 'in-need-of-your-skills');
  h.action('qEuEsp', N.ELUNED);
  assert.equal(h.quest.getStage(h.player), 1);
  assert.equal(h.inventory.get(I.TELEPORT_CRYSTAL_4_), 1);
  assert.equal(h.varbits.get(797), 1);

  // Canonical Quest Helper start: Islwyn's Roving Elves post-quest "Yes." hook.
  const hookHarness = makeHarness();
  hookHarness.hook('quest:mourning-s-end-part-i:start');
  assert.equal(hookHarness.quest.getStage(hookHarness.player), 1);
  const start = transcripts.findLast((entry) => entry.player === hookHarness.player);
  assert.equal(start?.variant, 'in-need-of-your-skills');
  assert.equal(start?.npcId, N.ELUNED);
});

test('MEP1 owner start hook checks all prerequisites and exposes its public requirement query', () => {
  const missingQuest = makeHarness({ completed: ['roving_elves', 'sheep_herder'] });
  const noChompy = { player: missingQuest.player };
  const missingQuestRequirements = missingQuest.fire('mournings-end-part-i:start-requirements', noChompy);
  assert.equal(missingQuestRequirements.meetsRequirements, false);
  missingQuest.hook('quest:mourning-s-end-part-i:start');
  assert.equal(missingQuest.quest.getStage(missingQuest.player), 0);
  assert.ok(missingQuest.messages.some((message) => message.includes('requirements to start Mourning')));

  const boosted = makeHarness({ levels: { RANGED: 59 }, boostedLevels: { RANGED: 65 } });
  boosted.hook('quest:mourning-s-end-part-i:start');
  assert.equal(boosted.quest.getStage(boosted.player), 0, 'the helper requires base Ranged, so a boost cannot start the quest');
  const drained = makeHarness({ levels: { RANGED: 60, THIEVING: 50 }, boostedLevels: { RANGED: 20, THIEVING: 20 } });
  drained.hook('quest:mourning-s-end-part-i:start');
  assert.equal(drained.quest.getStage(drained.player), 1, 'temporary drains do not remove base-level eligibility');

  const lowRanged = makeHarness({ levels: { RANGED: 59 } });
  const missingLevel = { player: lowRanged.player };
  const lowRangedRequirements = lowRanged.fire('mournings-end-part-i:start-requirements', missingLevel);
  assert.equal(lowRangedRequirements.meetsRequirements, false);
  lowRanged.hook('quest:mourning-s-end-part-i:start');
  assert.equal(lowRanged.quest.getStage(lowRanged.player), 0);
});

// Wire values (88f915abd, docs/quests/native-quest-state-a.md): varp 517 carries Quest Helper's native
// mourning_quest phases, not the saved stage. nativeProgress maps saved 0..14 to
// 0,2,3,3,3,4,5,5,5,6,6,6,7,8,9, so the native list stays in progress (8) until the real reward call at
// saved 14, which sends the native complete value 9. The test used to expect the saved 14.
const NATIVE_COMPLETE = 9;
const NATIVE_BEFORE_REWARD = 8;

test('mandatory handler route reaches completion and transmits varp 517 as the native phase, complete only at the reward', () => {
  const h = makeHarness();
  h.action('qEuEsp', N.ELUNED);
  h.give(I.BLOODY_MOURNER_TOP, 1);
  h.give(I.RIPPED_MOURNER_TROUSERS, 1);

  h.die(9013);
  assert.equal(h.quest.getStage(h.player), 2);

  h.give(I.TEGIDS_SOAP, 1);
  h.give(I.BUCKET_OF_WATER, 1);
  assert.equal(h.itemOnItem(I.TEGIDS_SOAP, I.BLOODY_MOURNER_TOP).handled, true);
  assert.equal(h.quest.getStage(h.player), 3);
  assert.equal(h.inventory.get(I.MOURNER_TOP), 1);

  h.give(I.SILK, 2);
  h.give(I.BEAR_FUR, 1);
  h.action('OVpPAl', N.ORONWEN);
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.inventory.get(I.MOURNER_TROUSERS), 1);

  h.talk('Arianwyn', N.ARIANWYN);
  assert.equal(h.quest.getStage(h.player), 5);

  h.give(I.MOURNER_LETTER, 1);
  h.action('HUqB2R', N.ESSYLLT);
  assert.equal(h.inventory.get(I.MOURNER_LETTER) ?? 0, 0);
  h.action('HpLBIl', N.ESSYLLT);
  assert.equal(h.quest.getStage(h.player), 6);
  assert.equal(h.inventory.get(I.TARNISHED_KEY), 1);
  assert.equal(h.inventory.get(I.BROKEN_DEVICE), 1);

  // Full mourner disguise opens the trapdoor only when worn.
  const noGear = h.object(8783);
  assert.equal(noGear.handled, true);
  assert.ok(h.messages.some((message) => message.includes('full mourner disguise')));
  for (const [slot, itemId] of [
    [core.Equipment.HEAD_SLOT, I.GAS_MASK],
    [core.Equipment.CAPE_SLOT, I.MOURNER_CLOAK],
    [core.Equipment.BODY_SLOT, I.MOURNER_TOP],
    [core.Equipment.LEG_SLOT, I.MOURNER_TROUSERS],
    [core.Equipment.HANDS_SLOT, I.MOURNER_GLOVES],
    [core.Equipment.FEET_SLOT, I.MOURNER_BOOTS],
  ]) h.wear(slot, itemId);
  h.object(8783);
  assert.deepEqual([h.player.getLocation().getX(), h.player.getLocation().getY()], [2044, 4649]);

  h.give(I.MAGIC_LOGS, 1);
  h.give(I.LEATHER, 1);
  h.give(2243, 1); // premade toad crunchies are a Quest Helper alternate
  h.choice(N.GNOME_5, 'You said about toad crunchies and being tickled.');
  assert.equal(h.attributes.get('quest.mournings_end_part_i.gnome'), 1);
  assert.equal(h.itemOnNpc(I.BROKEN_DEVICE, N.GNOME_5).handled, true);
  const release = transcripts.findLast((entry) => entry.variant === 'earning-their-trust-it-s-a-deal-releasing-the-gnome');
  assert.ok(release, 'release transcript');
  h.action('t1l8Is', N.GNOME_5);
  assert.equal(h.quest.getStage(h.player), 7);
  assert.equal(h.inventory.get(I.FIXED_DEVICE), 1);
  assert.equal(h.inventory.get(I.BROKEN_DEVICE) ?? 0, 0);
  assert.equal(h.inventory.get(2243) ?? 0, 0);

  const sheep = [
    [I.RED_TOAD, 3986, 801],
    [I.GREEN_TOAD, 3987, 803],
    [I.BLUE_TOAD, 3988, 800],
    [I.YELLOW_TOAD, 3989, 802],
  ];
  for (const [toad, npcId, varbit] of sheep) {
    h.give(toad, 1);
    assert.equal(h.itemOnItem(toad, I.FIXED_DEVICE).handled, true);
    assert.equal(h.itemOnNpc(I.FIXED_DEVICE, npcId).handled, true);
    assert.equal(h.varbits.get(varbit), 1);
  }
  assert.equal(h.quest.getStage(h.player), 8);

  h.talk('Essyllt', N.ESSYLLT);
  assert.equal(h.quest.getStage(h.player), 9);
  assert.equal(transcripts.findLast((entry) => entry.player === h.player)?.variant,
    'earning-their-trust-for-the-greater-good-new-orders');

  h.talk('Elena', N.ELENA);
  assert.equal(h.quest.getStage(h.player), 10);
  assert.equal(transcripts.findLast((entry) => entry.player === h.player)?.variant,
    'earning-their-trust-for-the-greater-good-an-old-friend');

  h.give(I.BARREL_OF_NAPHTHA, 1);
  h.give(I.APPLE_BARREL, 1);
  assert.equal(h.itemOnItem(I.BARREL_OF_NAPHTHA, I.APPLE_BARREL).handled, true);
  h.give(I.SIEVE, 1);
  assert.equal(h.itemOnItem(I.SIEVE, I.NAPHTHA_APPLE_MIX).handled, true);
  assert.equal(h.itemOnObject(I.TOXIC_NAPHTHA, 26181).handled, true);
  assert.equal(h.quest.getStage(h.player), 11);
  assert.equal(h.inventory.get(I.TOXIC_POWDER), 2);

  // Generic Sacks 365 scenery is not a West Ardougne quest food store.
  assert.equal(h.itemOnObject(I.TOXIC_POWDER, 365).handled, false);
  assert.equal(h.quest.getStage(h.player), 11);
  // The first store counts once even if clicked on another tile; the second base
  // loc completes the two-store objective.
  assert.equal(h.itemOnObject(I.TOXIC_POWDER, 37330).handled, true);
  assert.equal(h.itemOnObject(I.TOXIC_POWDER, 37330).handled, true);
  assert.equal(h.quest.getStage(h.player), 11);
  assert.equal(h.itemOnObject(I.TOXIC_POWDER, 37331).handled, true);
  assert.equal(h.quest.getStage(h.player), 12);

  h.talk('Essyllt', N.ESSYLLT);
  assert.equal(h.quest.getStage(h.player), 13);
  assert.equal(transcripts.findLast((entry) => entry.player === h.player)?.variant, 'the-mourners-plan');

  assert.equal(h.configs.get(517), NATIVE_BEFORE_REWARD, 'saved 13 is still in progress natively');
  h.talk('Arianwyn', N.ARIANWYN);
  const beforeXp = h.xp.length;
  h.action('GT5Pn9', N.ARIANWYN);
  assert.equal(h.quest.getStage(h.player), 14);
  assert.equal(h.configs.get(517), NATIVE_COMPLETE);
  assert.equal(h.quest.isComplete(h.player), true);
  assert.deepEqual(h.xp.slice(beforeXp).sort(), [[core.Skill.HITPOINTS.getIndex(), 25000], [core.Skill.THIEVING.getIndex(), 40000]].sort());
  assert.equal(h.jingles.length, 1);

  // Repeating the completion action does not reward twice.
  const afterCompletion = h.xp.length;
  const points = h.attributes.get('quest.points');
  h.action('GT5Pn9', N.ARIANWYN);
  assert.equal(h.xp.length, afterCompletion);
  assert.equal(h.attributes.get('quest.points'), points);

  // Login replay sends the same native completion wire value.
  h.configs.clear();
  h.login();
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.configs.get(517), NATIVE_COMPLETE);
});

test('lost device and key recovery actions restore the mandatory HQ items', () => {
  const h = makeHarness();
  h.quest.setStage(h.player, 6);
  h.action('Rdmsd6', N.ESSYLLT);
  assert.equal(h.inventory.get(I.BROKEN_DEVICE), 1);
  assert.equal(h.inventory.get(I.TARNISHED_KEY), 1);

  h.take(I.BROKEN_DEVICE, 1);
  h.take(I.TARNISHED_KEY, 1);
  h.action('_c6TLF', N.ESSYLLT);
  assert.equal(h.inventory.get(I.BROKEN_DEVICE), 1);
  assert.equal(h.inventory.get(I.TARNISHED_KEY) ?? 0, 0);
  h.action('OOPznE', N.ESSYLLT);
  assert.equal(h.inventory.get(I.TARNISHED_KEY), 1);
  assert.equal(h.quest.getStage(h.player), 6);
});

// Oronwen takes the silk and bear fur item by item (Wiki "Mourning's End Part I", "Using necessary items on Oronwen").
// Handler-level, like the route above: the real registered item-on-NPC handler and condition answers, the transcript
// start recorded. What the transcript leaves out (the fur's own message, refusals, the trousers coming back at the last
// item) is this plugin's own, as its header says.
const ORONWEN_VARIANT = 'the-mourner-s-disguise-trousers-talking-to-oronwen-before-giving-the-items-using-necessary-items-on-oronwen';
const SILK_ATTR = 'quest.mournings_end_part_i.oronwen-silk';
const FUR_ATTR = 'quest.mournings_end_part_i.oronwen-fur';

function atTrousers() {
  const h = makeHarness();
  h.action('qEuEsp', N.ELUNED);
  h.give(I.BLOODY_MOURNER_TOP, 1);
  h.give(I.RIPPED_MOURNER_TROUSERS, 1);
  h.die(9013);
  assert.equal(h.quest.getStage(h.player), 2);
  transcripts.length = 0;
  return h;
}
const needs = (h) => ['FwAIoK', 'c_p6AK', 'TCt6hQ', 'bkuvDV'].filter((id) => h.condition(id, N.ORONWEN) === true);

test('Oronwen takes one silk and says what she still needs: bear fur and one more piece of silk', () => {
  const h = atTrousers();
  h.give(I.SILK, 2);
  const event = h.itemOnNpc(I.SILK, N.ORONWEN);
  assert.equal(event.handled, true);
  assert.equal(h.inventory.get(I.SILK), 1, 'one piece taken');
  assert.equal(h.player.getAttribute(SILK_ATTR), 1);
  const played = transcripts.filter((entry) => entry.variant === ORONWEN_VARIANT);
  assert.equal(played.length, 1, "the transcript's item-on-Oronwen variant starts");
  assert.equal(played[0].npcId, N.ORONWEN);
  assert.deepEqual(needs(h), ['FwAIoK'], '"I need bear fur and one piece of silk"');
  assert.equal(h.quest.getStage(h.player), 2, 'the stage does not move yet');
  assert.equal(h.inventory.get(I.RIPPED_MOURNER_TROUSERS), 1);
});

test('bear fur first, then each silk: the remaining-need lines follow and the last item brings the trousers back', () => {
  const h = atTrousers();
  h.give(I.SILK, 2);
  h.give(I.BEAR_FUR, 1);
  assert.equal(h.itemOnNpc(I.BEAR_FUR, N.ORONWEN).handled, true);
  assert.equal(h.inventory.get(I.BEAR_FUR) ?? 0, 0);
  assert.ok(h.messages.includes('You give the bear fur to Oronwen.'));
  assert.deepEqual(needs(h), ['TCt6hQ'], '"I need two pieces of silk"');
  const fur = transcripts.at(-1);
  assert.equal(fur.variant, ORONWEN_VARIANT);
  assert.equal(typeof fur.select, 'function', "the transcript's silk box is skipped for the fur");
  assert.equal(h.itemOnNpc(I.SILK, N.ORONWEN).handled, true);
  assert.deepEqual(needs(h), ['bkuvDV'], '"I only need one piece of silk"');
  assert.equal(h.itemOnNpc(I.SILK, N.ORONWEN).handled, true);
  assert.equal(h.inventory.get(I.SILK) ?? 0, 0);
  assert.equal(h.inventory.get(I.MOURNER_TROUSERS), 1, 'the repaired trousers');
  assert.equal(h.inventory.get(I.RIPPED_MOURNER_TROUSERS) ?? 0, 0);
  assert.equal(h.quest.getStage(h.player), 4);
  assert.ok(h.messages.includes('Oronwen hands you the mourner trousers, they look as good as new.'));
  assert.equal(h.player.getAttribute(SILK_ATTR), 0, 'hand-in state cleared');
  assert.equal(h.player.getAttribute(FUR_ATTR), 0);
});

test('two silk first leaves only bear fur needed', () => {
  const h = atTrousers();
  h.give(I.SILK, 2);
  h.itemOnNpc(I.SILK, N.ORONWEN);
  h.itemOnNpc(I.SILK, N.ORONWEN);
  assert.deepEqual(needs(h), ['c_p6AK'], '"I only need bear fur now"');
  assert.equal(h.quest.getStage(h.player), 2);
});

test('Oronwen keeps no more than she asked for: a third silk and a second fur are refused and kept', () => {
  const h = atTrousers();
  h.give(I.SILK, 3);
  h.give(I.BEAR_FUR, 2);
  h.itemOnNpc(I.SILK, N.ORONWEN);
  h.itemOnNpc(I.SILK, N.ORONWEN);
  h.itemOnNpc(I.BEAR_FUR, N.ORONWEN); // the last item: the trousers come back, state cleared
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.inventory.get(I.SILK), 1);
  assert.equal(h.inventory.get(I.BEAR_FUR), 1);
  const again = atTrousers();
  again.give(I.BEAR_FUR, 2);
  again.itemOnNpc(I.BEAR_FUR, N.ORONWEN);
  const second = again.itemOnNpc(I.BEAR_FUR, N.ORONWEN);
  assert.equal(second.handled, true, 'answered, not left to the generic "nothing interesting happens"');
  assert.equal(again.inventory.get(I.BEAR_FUR), 1, 'the second fur is kept');
  assert.ok(again.messages.includes('Oronwen already has the bear fur.'));
  const third = atTrousers();
  third.give(I.SILK, 3);
  third.itemOnNpc(I.SILK, N.ORONWEN);
  third.itemOnNpc(I.SILK, N.ORONWEN);
  const refused = third.itemOnNpc(I.SILK, N.ORONWEN);
  assert.equal(refused.handled, true);
  assert.equal(third.inventory.get(I.SILK), 1, 'the third silk is kept');
  assert.ok(third.messages.includes('Oronwen has all the silk she needs.'));
  assert.equal(third.quest.getStage(third.player), 2);
});

test('controls: no ripped trousers, before the disguise stage, another item or another NPC are not Oronwen\'s hand-in', () => {
  const none = makeHarness();
  none.give(I.SILK, 1);
  assert.equal(none.itemOnNpc(I.SILK, N.ORONWEN).handled, false, 'stage 0');
  const h = atTrousers();
  h.give(I.SILK, 1);
  h.give(I.BEAR_FUR, 1);
  h.take(I.RIPPED_MOURNER_TROUSERS, 1);
  assert.equal(h.itemOnNpc(I.SILK, N.ORONWEN).handled, false, 'no ripped trousers to mend');
  h.give(I.RIPPED_MOURNER_TROUSERS, 1);
  assert.equal(h.itemOnNpc(I.LEATHER, N.ORONWEN).handled, false, 'another item');
  assert.equal(h.itemOnNpc(I.SILK, N.ARIANWYN).handled, false, 'another NPC');
  assert.equal(h.inventory.get(I.SILK), 1, 'nothing was taken by the controls');
  assert.equal(h.player.getAttribute(SILK_ATTR) ?? 0, 0, 'no hand-in state changed');
  assert.equal(h.player.getAttribute(FUR_ATTR) ?? 0, 0);
});
