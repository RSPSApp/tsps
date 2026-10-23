const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();
const core = require(root + '/dist/plugins/PluginManager').PluginManager.getCoreApi();
const transcripts = require(root + '/data/definitions/npc-dialogues.json');
const npcIndex = require(root + '/data/definitions/npc-dialogue-index.json');
const hooks = [], variants = [], custom = new Map();
let registering = 'TutorialIsland';
const noop = () => {};
const api = new Proxy({ core,
  onNpcDialogueCondition(fn) { hooks.push({ quest: registering, fn }); },
  onNpcDialogueVariant(fn) { variants.push({ quest: registering, fn }); },
  onCustomEvent(name, fn) { const handlers = custom.get(name) ?? []; handlers.push(fn); custom.set(name, handlers); },
  emitCustomEvent(name, event) { for (const fn of custom.get(name) ?? []) fn(event); },
  getWorld: () => core.World,
}, { get: (target, key) => target[key] ?? noop });
const Tutorial = require(root + '/plugins/areas/tutorialisland/Common.TutorialIsland');
before(async () => {
  await require(root + '/dist/game/cache/CachePipeline').CachePipeline.initialize(root);
  new (require(root + '/dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  Tutorial.init(api);
  require(root + '/plugins/areas/tutorialisland/Instructors.TutorialIsland')(api);
  for (const quest of require(root + '/plugins/quests/Quests.plugin').QUESTS) {
    registering = quest;
    require(root + '/plugins/quests/quests/' + quest + '.Quest')(api);
  }
});

function player() {
  const attrs = new Map(), items = new Map(), worn = new Map();
  const p = { attrs, items, worn, slots: 28,
    getAttribute: key => attrs.get(key), setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => ({ getAmount: id => items.get(id) ?? 0, contains: id => items.has(id), isFull: () => p.slots === 0, getFreeSlots: () => p.slots,
      getItems: () => Array.from({ length: 28 }, (_, index) => index < 28 - p.slots ? { getId: () => 1 } : null), getValidItems: () => [] }),
    getEquipment: () => ({ get: () => null, getAmount: id => worn.get(id) ?? 0 }),
    getSkillManager: () => ({ getCurrentLevel: () => 1, getMaxLevel: () => 1, getCombatLevel: () => 3 }),
    getLocation: () => new core.Location(3210, 3220), getBanks: () => [], getUsername: () => 'Condition test',
  };
  return p;
}
function condition(page, stepId) {
  let result;
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.id === stepId && value.type === 'condition') result = value.text;
    Object.values(value).forEach(visit);
  }
  visit(transcripts[page]); assert.ok(result, page + ' condition ' + stepId); return result;
}
function event(player, npcId, page, stepId) {
  const pages = (npcIndex[npcId] ?? []).map(entry => ({ ...entry, page: entry.page.replace(/^Transcript:/, '') }));
  if (!pages.some(entry => entry.page === page)) pages.push({ page, variants: [] });
  return { player, npcId, definition: core.NpcDefinition.forId(npcId), pages, stepId, text: condition(page, stepId) };
}
function resolve(request) {
  for (const hook of hooks) {
    const answer = hook.fn(request);
    if (typeof answer === 'boolean') return { quest: hook.quest, answer };
  }
  return { quest: null, answer: null };
}

test('the complete quest registry keeps Rune Mysteries notes separate from Nulodion notes', () => {
  const p = player(); p.attrs.set('quest.rune_mysteries.stage', 5);
  const request = event(p, core.NpcIdentifiers.AUBURY_2, 'Rune Mysteries', 'vNnSRN');
  p.items.set(core.ItemIdentifiers.RESEARCH_NOTES_4, 1);
  assert.deepEqual(resolve(request), { quest: 'RuneMysteries', answer: false });
  p.items.clear(); assert.deepEqual(resolve(request), { quest: 'RuneMysteries', answer: true });
});

test('Dragon Slayer payments and repair conditions cannot be answered by unrelated quests', () => {
  const p = player(), I = core.ItemIdentifiers, N = core.NpcIdentifiers;
  for (const [npc, id, cost] of [[N.KLARENSE, 'UpETpW', 2000], [N.WORMBRAIN, 'f11Ll8', 10000]]) {
    const request = event(p, npc, 'Dragon Slayer I', id);
    p.items.set(I.COINS, cost - 1); assert.deepEqual(resolve(request), { quest: 'DragonSlayer', answer: true });
    p.items.set(I.COINS, cost); assert.deepEqual(resolve(request), { quest: 'DragonSlayer', answer: false });
  }
  const repair = event(p, N.NED, 'Dragon Slayer I', 'boWnNH');
  const wood = event(p, N.KLARENSE, 'Dragon Slayer I', 'HGYUV5');
  for (const name of ['DwarfCannon', 'MonksFriend', 'TouristTrap']) {
    for (const hook of hooks.filter(hook => hook.quest === name)) {
      assert.equal(hook.fn(repair), null, name + ' must not answer the ship hammer predicate');
      assert.equal(hook.fn(wood), null, name + ' must not answer the ship plank/payment predicate');
    }
  }
});

test('Shield of Arrav full-bag loc conditions are owned by Shield of Arrav', () => {
  const p = player();
  for (const id of ['Vl3BPs', 'JaT1Z6']) {
    const request = event(p, core.NpcIdentifiers.STRAVEN, 'Shield of Arrav', id);
    p.slots = 0; assert.deepEqual(resolve(request), { quest: 'ShieldOfArrav', answer: true });
    p.slots = 1; assert.deepEqual(resolve(request), { quest: 'ShieldOfArrav', answer: false });
  }
});

test('Learning the Ropes keeps zero/one/two-slot and equipment conditions in its instructor', () => {
  const p = player(), I = core.ItemIdentifiers;
  p.attrs.set(Tutorial.PROGRESS_ATTRIBUTE, Tutorial.STEP.COMBAT_TALK);
  const combatId = Tutorial.IDS.COMBAT_INSTRUCTOR[0], miningId = Tutorial.IDS.MINING_INSTRUCTOR[0];
  for (const [id, npc, slots, sword, expected] of [['iR4sw7',combatId,1,false,true],['iR4sw7',combatId,2,false,false],['eVetF4',combatId,1,true,true],['t-xzeX',combatId,1,true,false],['nSFRLj',miningId,0,false,true],['nSFRLj',miningId,1,false,false],['hwm9-N',miningId,1,false,true]]) {
    p.slots = slots; p.items.clear(); if (sword) p.items.set(I.BRONZE_SWORD, 1);
    const request = event(p, npc, 'Learning the Ropes', id);
    assert.deepEqual(resolve(request), { quest: 'TutorialIsland', answer: expected }, id + '/' + slots + '/' + sword);
    for (const hook of hooks.filter(hook => ['DwarfCannon','NatureSpirit','PlagueCity','TouristTrap','WaterfallQuest'].includes(hook.quest))) assert.equal(hook.fn(request), null, hook.quest + ' must defer tutorial conditions');
  }
});

test('Recipe for Disaster does not interpret the public Lumbridge Guide completion-routing prose', () => {
  const request = event(player(), core.NpcIdentifiers.LUMBRIDGE_GUIDE, 'Lumbridge Guide', 'jY0t0N');
  assert.equal(hooks.find(hook => hook.quest === 'RecipeForDisaster').fn(request), null);
});


test('audited foreign handlers defer the F2P conditions even when they register after the owner', () => {
  const p = player();
  const requests = [event(p, core.NpcIdentifiers.AUBURY_2, 'Rune Mysteries', 'vNnSRN'),
    event(p, core.NpcIdentifiers.STRAVEN, 'Shield of Arrav', 'Vl3BPs'),
    event(p, core.NpcIdentifiers.NED, 'Dragon Slayer I', 'boWnNH')];
  const guarded = new Set(['DwarfCannon','FishingContest','GrandTree','HazeelCult','LegendsQuest','MonksFriend','MurderMystery','NatureSpirit','PlagueCity','ScorpionCatcher','TempleOfIkov','TouristTrap','UndergroundPass','Watchtower','WaterfallQuest','ZogreFleshEaters']);
  for (const hook of hooks.filter(hook => guarded.has(hook.quest))) {
    for (const request of requests) assert.equal(hook.fn(request), null, hook.quest + ': ' + request.text);
  }
});

test('the Fishing Contest guard still accepts the two dwarves who start their quest', () => {
  const p = player(), hook = hooks.find(hook => hook.quest === 'FishingContest');
  for (const npcId of [core.NpcIdentifiers.AUSTRI, core.NpcIdentifiers.VESTRI]) {
    assert.equal(hook.fn({player:p,npcId,text:'If the player does not meet the requirements to begin Fishing Contest:'}), true);
  }
});


test('the complete registry lets Varrock Aris start Demon Slayer and keeps banquet Aris in RFD', () => {
  const p = player(), N = core.NpcIdentifiers;
  p.getLocation = () => new core.Location(3203, 3423, 0);
  const request = npcId => ({ player: p, npcId, definition: core.NpcDefinition.forId(npcId),
    pages: (npcIndex[npcId] ?? []).map(entry => ({ ...entry, page: entry.page.replace(/^Transcript:/, '') })) });
  const first = input => {
    for (const hook of variants) { const answer = hook.fn(input); if (answer) return { quest: hook.quest, answer }; }
    return null;
  };
  assert.deepEqual(first(request(N.ARIS)), { quest: 'DemonSlayer', answer: { page: 'Demon Slayer', variant: 'starting-demon-slayer' } });
  const rfd = variants.find(hook => hook.quest === 'RecipeForDisaster').fn;
  for (const stage of [0, 1, 4, 5]) {
    p.attrs.set('quest.recipe_for_disaster.stage', stage);
    assert.equal(rfd(request(N.ARIS)), null, `Varrock Aris must defer at RFD stage ${stage}`);
  }
  p.attrs.set('quest.recipe_for_disaster.stage', 0);
  p.getLocation = () => new core.Location(3240, 3220, 0);
  for (const npcId of [N.ARIS_2, N.ARIS_3]) {
    assert.deepEqual(rfd(request(npcId)), { page: "Recipe for Disaster/Another Cook's Quest", variant: 'chef-surprise-talking-to-aris' });
  }
});

test('completed One Small Favour releases Fred to Sheep Shearer while its own chicken step remains owned', () => {
  const N = core.NpcIdentifiers;
  const variantFor = (p, npcId) => {
    for (const hook of variants) {
      const answer = hook.fn({ player: p, npcId });
      if (answer) return { quest: hook.quest, answer };
    }
    return null;
  };
  const p = player();
  p.attrs.set('quest.one_small_favour.stage', 285);
  p.attrs.set('quest.sheep_shearer.stage', 0);
  assert.deepEqual(variantFor(p, N.FRED_THE_FARMER), {
    quest: 'SheepShearer',
    answer: { page: 'Sheep Shearer', variant: 'starting-off' },
  }, 'completed OSF must not keep Fred');
  assert.equal(variants.find(hook => hook.quest === 'OneSmallFavour').fn({ player: p, npcId: N.FRED_THE_FARMER }), null);

  p.attrs.set('quest.one_small_favour.stage', 5);
  p.attrs.set('quest.sheep_shearer.stage', 0);
  assert.deepEqual(variantFor(p, N.FRED_THE_FARMER), {
    quest: 'OneSmallFavour',
    answer: 'the-various-favours-are-asked-asking-fred-for-chickens',
  }, 'active OSF chicken step still owns Fred');
});

test('One Small Favour only claims Aggie at its ask/return steps, leaving Prince Ali paste reachable', () => {
  const N = core.NpcIdentifiers;
  const variantFor = (p, npcId) => {
    for (const hook of variants) {
      const answer = hook.fn({ player: p, npcId });
      if (answer) return { quest: hook.quest, answer };
    }
    return null;
  };
  const p = player();
  p.attrs.set('quest.prince_ali_rescue.stage', 20);
  p.attrs.set('quest.one_small_favour.stage', 4);
  assert.deepEqual(variantFor(p, N.AGGIE), {
    quest: 'PrinceAliRescue',
    answer: { page: 'Prince Ali Rescue', variant: 'preparations-for-rescue-talking-to-aggie' },
  }, 'OSF between its Aggie steps must not swallow the active paste dialogue');

  p.attrs.set('quest.one_small_favour.stage', 3);
  assert.deepEqual(variantFor(p, N.AGGIE), {
    quest: 'OneSmallFavour',
    answer: 'the-various-favours-are-asked-asking-aggie-to-be-a-character-witness',
  }, 'OSF ask-Aggie step still owns her');
  p.attrs.set('quest.one_small_favour.stage', 39);
  assert.deepEqual(variantFor(p, N.AGGIE), {
    quest: 'OneSmallFavour',
    answer: 'heading-back-to-complete-the-favours-aggie',
  }, 'OSF return-to-Aggie turn-in still owns her');
});
