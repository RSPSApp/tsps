const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
const runtime = require('../plugins/quests/QuestRuntime');

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

// Horror from the Deep regression checks for issue 728.
//
// The wire contract: cache quest DB row 74 (completion 10) and script 4024 case
// 74 read varbit 34, which is bits 0-10 of varp 351 ("deephorror"). The plugin
// must write the varbit, not the whole varp, so the sibling key/bridge bits
// (varbits 35-38) survive.
//
// Fixtures set stage and inventory only where the check is explicitly a handler
// contract; no fixture sets the expected postcondition or calls plugin helpers.

function setup({ barcrawl = true } = {}) {
  const hooks = {
    custom: new Map(), variants: [], conditions: [], login: [], logout: [], npcDeaths: [],
    objects: [], itemOnObject: [], npcs: [], hits: [], process: [],
  };
  const spawned = [];
  const skills = new Map();
  const attrs = new Map();
  const inventory = new Map();
  const varbits = new Map();
  const configs = new Map();
  const varps = new Map();
  const messages = [];
  const tasks = [];
  const taskManager = {
    submit(task) { task.setRunning(true); tasks.push(task); },
    cancelTasks(key) { tasks.filter(task => task.key === key).forEach(task => task.stop()); },
  };
  let free = 28;
  let location = { x: 2500, y: 3640, z: 0 };

  const inventoryApi = {
    getAmount: (id) => inventory.get(id) ?? 0,
    getFreeSlots: () => free,
    isFull: () => free === 0,
    deleteNumber(id, count) {
      inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count));
    },
    adds(id, count) {
      if (free === 0 && !(inventory.get(id) > 0)) return inventoryApi;
      inventory.set(id, (inventory.get(id) ?? 0) + count);
      return true;
    },
    forceAdd(player, item) {
      const id = item.getId?.() ?? item.id;
      inventory.set(id, (inventory.get(id) ?? 0) + 1);
      return true;
    },
  };

  const sender = new Proxy({
    sendVarbit(id, value) {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      const mask = (2 ** (endBit - startBit + 1) - 1) << startBit;
      varps.set(baseVar, ((varps.get(baseVar) ?? 0) & ~mask) | ((value << startBit) & mask));
      varbits.set(id, value); return sender;
    },
    sendConfig(id, value) { configs.set(id, value); return sender; },
    getVarbit: (id) => varbits.get(id) ?? 0,
    getVarp: (id) => varps.get(id) ?? 0,
  }, { get(target, key) { return target[key] ?? (() => sender); } });

  const player = {
    getUsername: () => 'qh728-q059',
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender,
    sendMessage(message) { messages.push(message); },
    getInventory: () => inventoryApi,
    getEquipment: () => ({ getItems: () => [] }),
    getSkillManager: () => ({
      getMaxLevel: (skill) => skills.get(skill) ?? 99,
      addExperiences(skill, amount) {
        skills.set(skill, (skills.get(skill) ?? 0) + amount);
      },
    }),
    getLocation: () => ({ getX: () => location.x, getY: () => location.y, getZ: () => location.z }),
    moveTo(value) { location = { x: value.getX(), y: value.getY(), z: value.getZ() }; },
    getPrivateArea: () => null,
    isPlayer: () => true,
  };

  const core = {
    ...PluginManager.getCoreApi(),
    TaskManager: taskManager,
    // ItemDefinition isn't usable without a full cache init; the wall dispatch
    // only asks for the item's name, so name the two fixture weapons directly.
    ItemDefinition: {
      forId: (id) => ({ getName: () => ({ 1277: 'Bronze sword', 882: 'Bronze arrow' }[id] ?? '') }),
    },
    World: { getNpcsNear: () => [] },
  };

  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(fn) { hooks.npcs.push(fn); },
    onObjectInteraction(fn) { hooks.objects.push(fn); },
    onItemOnObject(fn) { hooks.itemOnObject.push(fn); },
    onNpcDeath(fn) { hooks.npcDeaths.push(fn); },
    onNpcHitModify(fn) { hooks.hits.push(fn); },
    onPlayerProcess(fn) { hooks.process.push(fn); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onPlayerLogout(fn) { hooks.logout.push(fn); },
    onPlayerDeath() {},
    onCustomEvent(name, fn) {
      const list = hooks.custom.get(name) ?? [];
      list.push(fn);
      hooks.custom.set(name, list);
    },
    emitCustomEvent(name, event) {
      for (const fn of hooks.custom.get(name) ?? []) fn(event);
    },
    spawnNpc(def) {
      const npc = {
        def,
        getId: () => def.id,
        getOwner: () => def.owner,
        getLocation: () => new core.Location(def.x, def.y, def.z),
        setNpcTransformationId(id) { this.transformationId = id; },
        isRegistered: () => true,
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc() {},
  }, { get(target, key) { return target[key] ?? (() => {}); } });

  hooks.custom.set('quest:is-complete', [(request) => {
    if (request?.name === "Alfred Grimhand's Barcrawl") request.complete = barcrawl;
  }]);
  require('../plugins/quests/quests/HorrorFromTheDeep.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);

  const emit = (name, event) => {
    const payload = event.player ? event : { player, ...event };
    api.emitCustomEvent(name, payload);
    return payload;
  };
  return {
    core, quest, player, sender, attrs, inventory, skills, varbits, configs, varps, messages, hooks, spawned, emit,
    setFree(value) { free = value; },
    setLocation(x, y, z = 0) { location = { x, y, z }; },
    variant(npcId) { return hooks.variants[0]({ player, npcId }); },
    condition(npcId, text) { return hooks.conditions[0]({ player, npcId, text }); },
    object(objectId, x = 2515, y = 3627) {
      const event = { player, objectId, location: new core.Location(x, y, 0), handled: false };
      hooks.objects[0](event);
      return event;
    },
    itemOnObject(objectId, itemId) {
      hooks.itemOnObject[0]({ player, objectId, itemId });
    },
    process() { for (const task of tasks) if (task.isRunning()) task.tick(); },
    tasks,
    hit(npc, attacker, combatType, spellId, damage = 12) {
      const hit = {
        damage,
        getAttacker: () => attacker,
        getCombatType: () => combatType,
        getSpell: () => spellId === undefined ? null : { spellId: () => spellId },
        setTotalDamage(value) { this.damage = value; },
      };
      for (const fn of hooks.hits) fn({ npc, hit });
      return hit.damage;
    },
    action(npcId, stepId) { emit('npc-dialogue:action', { npcId, stepId }); },
    death(npcId) { hooks.npcDeaths[0]({ killer: player, npcId, npc: spawned.at(-1) }); },
    deathContent(npc, npcId, killer = player) { hooks.npcDeaths[0]({ killer, npcId, npc }); },
  };
}

test('q059 cache contract: varbit 34 is the wire, not whole varp 351', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;

  h.quest.setStage(h.player, 5);
  assert.equal(h.varbits.get(34), 5, 'setStage writes varbit 34');
  assert.equal(h.configs.has(351), false, 'setStage must not write whole varp 351');

  // Existing durable saves keep their stage and replay through varbit 34 on login.
  h.attrs.set('quest.horror_from_the_deep.stage', 5);
  h.varbits.clear();
  h.configs.clear();
  for (const login of h.hooks.login) login({ player: h.player });
  assert.equal(h.quest.getStage(h.player), 5);
  assert.equal(h.varbits.get(34), 5, 'login replays the saved stage as varbit 34');
  assert.equal(h.configs.has(351), false, 'login must not clobber sibling bits 11-14');

  // The canonical completion is at or above the cache threshold (10).
  h.quest.complete(h.player);
  assert.equal(h.quest.getStage(h.player), 10);
  assert.equal(h.varbits.get(35), 0, 'completion alone does not fabricate wall offerings');
  assert.ok(h.varbits.get(34) >= 10);
  assert.equal(h.inventory.get(I.RUSTY_CASKET), 1, 'completion hands over the casket');
});

test('q059 does not claim unrelated Iron Ladders globally', () => {
  const h = setup();
  const O = h.core.ObjectIdentifiers;
  const unrelated = h.object(O.IRON_LADDER, 3200, 3200);
  assert.equal(unrelated.handled, false);
  assert.deepEqual(h.messages, [], 'an unrelated Iron Ladder should not show quest text');

  h.quest.setStage(h.player, 2);
  const request = {
    player: h.player,
    object: {
      getId: () => O.IRON_LADDER,
      getLocation: () => ({ x: 2508, y: 3645, z: 0 }),
    },
    handled: false,
  };
  h.emit('ladders:climb', request);
  assert.equal(request.handled, true, 'the actual lighthouse ladder remains quest-gated');
  assert.match(h.messages.at(-1), /must fix the lighthouse/i);
});

test('q059 mandatory handler route: start gate, bridge, key, door, light, wall, bosses', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  const N = h.core.NpcIdentifiers;
  const SKILL = h.core.Skill;

  // Fresh stage 0: 35 Agility is required before the start hook advances.
  h.skills.set(SKILL.AGILITY, 34);
  const underLevel = h.emit('npc-dialogue:hook', {
    npcId: N.LARRISSA, hook: 'quest:horror-from-the-deep:start',
  });
  assert.equal(underLevel.end, true, 'refused start stops the transcript');
  assert.equal(h.quest.getStage(h.player), 0, 'under-leveled start stays at stage 0');
  assert.ok(h.messages.some((text) => /Agility level of at least 35/.test(text)));

  h.skills.set(SKILL.AGILITY, 35);
  const noBarcrawl = setup({ barcrawl: false });
  noBarcrawl.skills.set(SKILL.AGILITY, 35);
  const missingBarcrawl = noBarcrawl.emit('npc-dialogue:hook', {
    npcId: N.LARRISSA, hook: 'quest:horror-from-the-deep:start',
  });
  assert.equal(missingBarcrawl.end, true, 'missing Barcrawl stops the transcript');
  assert.equal(noBarcrawl.quest.getStage(noBarcrawl.player), 0, 'missing Barcrawl stays at stage 0');
  assert.ok(noBarcrawl.messages.some((text) => /Alfred Grimhand's Barcrawl/.test(text)));

  h.emit('npc-dialogue:hook', {
    npcId: N.LARRISSA, hook: 'quest:horror-from-the-deep:start',
  });
  assert.equal(h.quest.getStage(h.player), 1);

  // Two bridge halves: one plank + 30 steel nails + a hammer each.
  h.inventory.set(I.PLANK, 2);
  h.inventory.set(I.STEEL_NAILS, 60);
  h.inventory.set(I.HAMMER, 1);
  h.itemOnObject(4615, I.PLANK);
  assert.equal(h.inventory.get(I.PLANK), 1);
  assert.equal(h.inventory.get(I.STEEL_NAILS), 30);
  h.itemOnObject(4616, I.PLANK);
  assert.equal(h.inventory.get(I.PLANK), 0);
  assert.equal(h.inventory.get(I.STEEL_NAILS), 0);
  assert.equal(h.inventory.get(I.HAMMER), 1, 'hammer is not consumed');

  // Gunnjorn's hand-out, then unlock and enter the lighthouse.
  assert.equal(h.variant(N.GUNNJORN), 'getting-the-key');
  h.action(N.GUNNJORN, 'Wh6Z8x');
  assert.equal(h.inventory.get(I.LIGHTHOUSE_KEY), 1);
  h.setLocation(2509, 3635);
  h.object(4577, 2509, 3636);
  assert.equal(h.inventory.get(I.LIGHTHOUSE_KEY), 0, 'the key unlocks the door');
  h.object(4577, 2509, 3636);
  assert.equal(h.quest.getStage(h.player), 2, 'with the bridge fixed the door enters the lighthouse');

  // Lighting mechanism: tar, tinderbox, molten glass.
  h.inventory.set(I.SWAMP_TAR, 1);
  h.inventory.set(I.MOLTEN_GLASS, 1);
  h.inventory.set(I.TINDERBOX, 1);
  h.itemOnObject(4588, I.SWAMP_TAR);
  h.itemOnObject(4588, I.TINDERBOX);
  h.itemOnObject(4588, I.MOLTEN_GLASS);
  assert.equal(h.quest.getStage(h.player), 4);
  assert.equal(h.inventory.get(I.SWAMP_TAR), 0);
  assert.equal(h.inventory.get(I.MOLTEN_GLASS), 0);
  assert.equal(h.inventory.get(I.TINDERBOX), 1, 'tinderbox is not consumed');

  // Strange wall: four runes, an arrow and a sword, each consumed once.
  for (const id of [I.AIR_RUNE, I.WATER_RUNE, I.EARTH_RUNE, I.FIRE_RUNE, 882, 1277]) {
    h.inventory.set(id, 1);
    h.itemOnObject(4544, id);
    assert.equal(h.inventory.get(id), 0, `wall consumes ${id}`);
  }
  h.setLocation(2514, 3627);
  h.object(4545, 2516, 3627);
  assert.equal(h.player.getLocation().getX(), 2517, 'the completed wall is walk-through');

  // Jossik's two spawn actions, then the dagannoth deaths.
  h.action(N.JOSSIK_2, 'fhKQH9');
  const junior = h.spawned.at(-1);
  assert.equal(junior.getId(), 979);
  h.deathContent({ getOwner: () => h.player }, 979);
  assert.equal(h.quest.getStage(h.player), 4, 'an untracked same-ID junior cannot advance the quest');
  h.death(979);
  assert.equal(h.quest.getStage(h.player), 5);
  h.action(N.JOSSIK_2, 'yh8sGI');
  assert.equal(h.spawned.at(-1).getId(), 988);
  h.deathContent({ getOwner: () => h.player }, 988);
  assert.equal(h.quest.getStage(h.player), 5, 'an untracked base-ID mother cannot complete the quest');
  h.death(988);
  assert.equal(h.quest.getStage(h.player), 10);
  for (const id of [35,36,37,38,40,41,42,43,44,45,46,47,48]) assert.equal(h.varbits.get(id), 1, `earned helper flag ${id}`);
  assert.ok(h.varbits.get(34) >= 10);
});

test('q059 post-quest casket exchange and recovery branches', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  const N = h.core.NpcIdentifiers;

  h.quest.setStage(h.player, 10);
  h.inventory.set(I.RUSTY_CASKET, 1);
  assert.equal(h.variant(N.JOSSIK), 'initial-dialogue-after-horror-from-the-deep');
  assert.equal(h.variant(N.JOSSIK_2), 'initial-dialogue-after-horror-from-the-deep');
  assert.equal(h.condition(N.JOSSIK, 'If the player has the rusty casket:'), true);
  assert.equal(h.condition(N.JOSSIK, 'If the player does not have the rusty casket:'), false);

  h.action(N.JOSSIK, 'wZLOyL'); // Saradomin
  assert.equal(h.inventory.get(I.RUSTY_CASKET), 0, 'the casket is handed over');
  assert.equal(h.inventory.get(I.DAMAGED_BOOK), 1);
  assert.equal(h.variant(N.JOSSIK), null, 'after the exchange Jossik uses his default shop page');

  // Second claim is refused, so the reward is once-only.
  h.action(N.JOSSIK, 'UDtF8K');
  assert.equal(h.inventory.get(I.DAMAGED_BOOK_2) ?? 0, 0);
});

test('q059 lost-casket recovery offers the book once without consuming one', () => {
  const h = setup();
  const I = h.core.ItemIdentifiers;
  const N = h.core.NpcIdentifiers;

  h.quest.setStage(h.player, 10);
  assert.equal(h.condition(N.JOSSIK, 'If the player has the rusty casket:'), false);
  assert.equal(h.condition(N.JOSSIK, 'If the player does not have the rusty casket:'), true);
  assert.equal(h.condition(N.JOSSIK, 'If the player dropped it after obtaining it:'), true);
  assert.equal(h.condition(N.JOSSIK, 'If the player has a full inventory:'), false);

  h.action(N.JOSSIK, 'frpSFr'); // Guthix
  assert.equal(h.inventory.get(I.DAMAGED_BOOK_3), 1);
  assert.equal(h.variant(N.JOSSIK), null);

  // With no casket and no free slot the dialogue's full-inventory guard wins.
  const full = setup();
  full.quest.setStage(full.player, 10);
  full.setFree(0);
  assert.equal(full.condition(N.JOSSIK, 'If the player has a full inventory:'), true);
});

test('q059 mother cycles canonical weaknesses and blocks damage from the wrong style', () => {
  const h = setup();
  const N = h.core.NpcIdentifiers;
  const C = h.core.CombatType;
  h.quest.setStage(h.player, 5);
  h.action(N.JOSSIK_2, 'yh8sGI');
  const mother = h.spawned.at(-1);
  assert.equal(h.tasks.filter((task) => task.isRunning()).length, 1, 'mother encounter owns one active phase task');

  const phases = [
    { name: 'white', id: N.DAGANNOTH_MOTHER_4, type: C.MAGIC, spells: ['WIND_STRIKE', 'WIND_BOLT', 'WIND_BLAST', 'WIND_WAVE', 'WIND_SURGE'] },
    { name: 'blue', id: N.DAGANNOTH_MOTHER_5, type: C.MAGIC, spells: ['WATER_STRIKE', 'WATER_BOLT', 'WATER_BLAST', 'WATER_WAVE', 'WATER_SURGE'] },
    { name: 'orange', id: N.DAGANNOTH_MOTHER_7, type: C.MELEE },
    { name: 'brown', id: N.DAGANNOTH_MOTHER_9, type: C.MAGIC, spells: ['EARTH_STRIKE', 'EARTH_BOLT', 'EARTH_BLAST', 'EARTH_WAVE', 'EARTH_SURGE'] },
    { name: 'red', id: N.DAGANNOTH_MOTHER_6, type: C.MAGIC, spells: ['FIRE_STRIKE', 'FIRE_BOLT', 'FIRE_BLAST', 'FIRE_WAVE', 'FIRE_SURGE'] },
    { name: 'green', id: N.DAGANNOTH_MOTHER_8, type: C.RANGED },
  ];
  assert.equal(mother.transformationId, N.DAGANNOTH_MOTHER_4, 'cache palette starts on white form 983');
  assert.equal(h.hit(mother, h.player, C.MAGIC, CombatSpells.WIND_BOLT.spellId()), 12, 'canonical air bolt is accepted');
  assert.equal(h.hit(mother, h.player, C.MAGIC, CombatSpells.CURSE.spellId()), 0, 'non-elemental Curse is not misclassified as air');
  for (let index = 0; index < phases.length; index++) {
    const phase = phases[index];
    assert.equal(mother.transformationId, phase.id, `${phase.name} phase uses its cache form`);
    for (const spellName of phase.spells ?? []) {
      assert.equal(h.hit(mother, h.player, phase.type, CombatSpells[spellName].spellId()), 12,
        `${phase.name} phase accepts ${spellName}`);
    }
    if (!phase.spells) assert.equal(h.hit(mother, h.player, phase.type), 12, `${phase.name} phase accepts its weakness`);
    assert.equal(h.hit(mother, h.player, phase.type === C.MELEE ? C.RANGED : C.MELEE), 0, `${phase.name} phase blocks a wrong style`);
    if (index === phases.length - 1) break;
    for (let tick = 0; tick < 29; tick++) h.process();
    assert.equal(h.messages.includes(`The Dagannoth changes to ${phases[index + 1].name}...`), false);
    h.process();
    assert.ok(h.messages.includes(`The Dagannoth changes to ${phases[index + 1].name}...`));
    assert.equal(mother.transformationId, phases[index + 1].id, `${phases[index + 1].name} transition changes cache form`);
  }

  assert.equal(CombatSpells.WIND_BOLT.spellId(), 1160, 'air bolt is the canonical spell ID, not Curse 1161');

  // Logging out removes the encounter; a new one starts at the initial phase.
  for (const logout of h.hooks.logout) logout({ player: h.player });
  assert.equal(h.tasks.some((task) => task.isRunning()), false, 'logout stops the owner-attached phase task');
  h.action(N.JOSSIK_2, 'yh8sGI');
  assert.equal(h.tasks.filter((task) => task.isRunning()).length, 1, 'a new encounter starts its own phase task');
  assert.equal(h.hit(h.spawned.at(-1), h.player, C.MELEE), 0, 'a fresh mother starts in white');
});

test('q059 completes from each transformed mother content ID and rejects a non-owner killer', () => {
  const N = PluginManager.getCoreApi().NpcIdentifiers;
  const phases = [
    N.DAGANNOTH_MOTHER_4, N.DAGANNOTH_MOTHER_5, N.DAGANNOTH_MOTHER_7,
    N.DAGANNOTH_MOTHER_9, N.DAGANNOTH_MOTHER_6, N.DAGANNOTH_MOTHER_8,
  ];
  for (let index = 0; index < phases.length; index++) {
    const h = setup();
    h.quest.setStage(h.player, 5);
    h.action(N.JOSSIK_2, 'yh8sGI');
    const mother = h.spawned.at(-1);
    for (let tick = 0; tick < index * 30; tick++) h.process();
    assert.equal(mother.transformationId, phases[index]);

    const otherPlayer = { isPlayer: () => true };
    h.deathContent(mother, phases[index], otherPlayer);
    assert.equal(h.quest.getStage(h.player), 5, 'a non-owner kill cannot finish this encounter');

    h.deathContent(mother, phases[index]);
    assert.equal(h.quest.getStage(h.player), 10, `transformed content ${phases[index]} completes the quest`);
  }
});


test('q059 auxiliary flags are earned individually and replay after bootstrap with sibling preservation', () => {
  const h = setup(), I = h.core.ItemIdentifiers, N = h.core.NpcIdentifiers;
  const names = { horrorbridgeleft:36, horrorbridgeright:37, horroragilitykey:38, horrordoor:35,
    horrortar:46, horrorglass:47, horrorlight:48, horrorair:43, horrorwater:41,
    horrorearth:42, horrorfire:40, horrorsword:44, horrorarrow:45 };
  for (const [name,id] of Object.entries(names)) assert.equal(CacheDefinitions.getVarbitId(name), id);
  h.quest.setStage(h.player, 1);
  h.setFree(0); h.action(N.GUNNJORN, 'Wh6Z8x');
  assert.equal(h.varbits.get(38) ?? 0, 0, 'failed handout cannot earn the key flag');
  h.setFree(1); h.action(N.GUNNJORN, 'Wh6Z8x');
  assert.equal(h.varbits.get(38), 1);
  h.inventory.set(I.PLANK,1); h.inventory.set(I.STEEL_NAILS,30); h.inventory.set(I.HAMMER,1);
  h.itemOnObject(4615,I.PLANK);
  // Persisted partial state is authoritative, regardless of later item loss/completion.
  const flags = h.attrs.get('quest.horror_from_the_deep.flags');
  assert.ok(flags > 0);
  assert.equal(h.varbits.get(36),1);
  assert.equal(h.varbits.get(37),0);
  const parent = CacheDefinitions.getVarbit(38).baseVar;
  const owned = [34,...Object.values(names)].filter(id=>CacheDefinitions.getVarbit(id).baseVar===parent)
    .reduce((mask,id)=>{ const d=CacheDefinitions.getVarbit(id); return mask | ((2**(d.endBit-d.startBit+1)-1)<<d.startBit); },0);
  const siblings=0x5a5a5a5a & ~owned;
  h.varps.set(parent,siblings); h.varbits.clear();
  const stage=h.quest.getStage(h.player), beforeItems=[...h.inventory];
  h.emit('player:bootstrap-complete',{});
  assert.equal(h.varbits.get(38),1);
  assert.equal(h.varbits.get(35),0, 'exterior key is not basement puzzle completion');
  assert.equal(h.varbits.get(40),0, 'unoffered fire rune stays unearned');
  assert.equal(h.varps.get(parent)&~owned,siblings);
  assert.equal(h.quest.getStage(h.player),stage);
  assert.deepEqual([...h.inventory],beforeItems);
});

test('real Doors-first dispatch crosses the keyed lighthouse threshold without changing shared clipping', () => {
  const core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2509, 3636, false);
  const anchor = new core.Location(2509, 3636, 0);
  const door = core.MapObjects.get(4577, anchor, null);
  assert.ok(door);
  assert.deepEqual([door.getType(), door.getFace(), door.getDefinition().getInteractions()[0]], [0, 3, 'Walk-through']);
  const crossing = () => core.RegionManager.canMove(2509, 3635, 2509, 3636, 0, 1, 1, null);
  assert.equal(crossing(), false);
  const h = setup();
  const saved = {
    objectInteractionHooks: PluginManager.objectInteractionHooks,
    objectHooksByName: PluginManager.objectHooksByName,
    nextObjectHookOrder: PluginManager.nextObjectHookOrder,
    customEventHooks: PluginManager.customEventHooks,
    objectRouteHooks: PluginManager.objectRouteHooks,
  };
  PluginManager.objectInteractionHooks = [];
  PluginManager.objectHooksByName = new Map();
  PluginManager.nextObjectHookOrder = 0;
  PluginManager.customEventHooks = new Map();
  PluginManager.objectRouteHooks = [];
  try {
    const api = PluginManager.createApi('q059-lighthouse-dispatch');
    delete require.cache[require.resolve('../plugins/objects/Doors.plugin')];
    require('../plugins/objects/Doors.plugin').register({ ...api, onRegionLoaded() {}, onServerStartup(handler) { handler(); } });
    for (const [name, handlers] of h.hooks.custom) for (const handler of handlers) api.onCustomEvent(name, handler);
    for (const handler of h.hooks.objects) api.onObjectInteraction(handler);
    const click = (location = { x: 2509, y: 3636, z: 0 }) => {
      const event = { player: h.player, object: door, objectId: 4577, definition: door.getDefinition(),
        location, option: 'walk-through', clickType: 1, handled: false };
      PluginManager.emitObjectInteraction(event);
      return event;
    };
    const position = () => {
      const l = h.player.getLocation(); return [l.getX(), l.getY(), l.getZ()];
    };
    h.setLocation(2509, 3635);
    click();
    assert.deepEqual(position(), [2509, 3635, 0], 'a locked doorway never crosses');
    assert.ok(h.messages.includes('This door is locked securely shut.'));
    h.quest.setStage(h.player, 1);
    h.action(h.core.NpcIdentifiers.GUNNJORN, 'Wh6Z8x');
    click();
    assert.equal(h.inventory.get(h.core.ItemIdentifiers.LIGHTHOUSE_KEY), 0);
    assert.deepEqual(position(), [2509, 3635, 0], 'unlocking alone does not skip the bridge gate');
    click();
    assert.equal(h.quest.getStage(h.player), 1);
    assert.deepEqual(position(), [2509, 3635, 0]);
    h.inventory.set(h.core.ItemIdentifiers.PLANK, 2);
    h.inventory.set(h.core.ItemIdentifiers.STEEL_NAILS, 60);
    h.inventory.set(h.core.ItemIdentifiers.HAMMER, 1);
    h.itemOnObject(4615, h.core.ItemIdentifiers.PLANK);
    h.itemOnObject(4616, h.core.ItemIdentifiers.PLANK);
    click();
    assert.equal(h.quest.getStage(h.player), 2);
    assert.deepEqual(position(), [2509, 3636, 0], 'earned entry crosses to the actual inside tile');
    // The actual wall route brings a naturally north-adjacent click to the
    // inside threshold before the object callback executes.
    h.setLocation(2509, 3637);
    const routeEvent = { player: h.player, object: door, objectId: 4577,
      definition: door.getDefinition(), clickType: 1,
      sourceLocation: { x: 2509, y: 3637, z: 0 }, destination: null };
    PluginManager.emitObjectRoute(routeEvent);
    assert.equal(routeEvent.destination, null, 'normal collision routing needs no quest override');
    const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
    const route = new RsmodRouteFinding().findRoute({
      level: 0, srcX: 2509, srcY: 3637, srcSize: 1,
      destX: 2509, destY: 3636, locAngle: door.getFace(), locShape: door.getType(),
      blockAccessFlags: routeEvent.blockAccessFlags, privateArea: null, moveNear: false,
    });
    assert.equal(route.success, true);
    assert.deepEqual([route.endX, route.endY], [2509, 3636], 'the production route selects the accepted inside approach');
    assert.equal(core.RegionManager.canMove(2509, 3637, route.endX, route.endY, 0, 1, 1, null), true);
    h.setLocation(route.endX, route.endY);
    click();
    assert.deepEqual(position(), [2509, 3635, 0], 'repeat exit crosses back outside after natural approach');
    click();
    assert.deepEqual(position(), [2509, 3636, 0], 'repeat entry stays available');
    h.setLocation(2508, 3635);
    click();
    assert.deepEqual(position(), [2508, 3635, 0], 'the wall endpoint is not an approved doorway approach');
    h.setLocation(2509, 3635, 1);
    click();
    assert.deepEqual(position(), [2509, 3635, 1], 'another floor cannot trigger the crossing');
    h.setLocation(2509, 3635);
    click({ x: 2509, y: 3637, z: 0 });
    assert.deepEqual(position(), [2509, 3635, 0], 'another location cannot borrow this doorway');
    assert.equal(crossing(), false, 'global collision remains intact for every other player');
    assert.equal(core.MapObjects.get(4577, anchor, null), door, 'no shared object is replaced');
  } finally { Object.assign(PluginManager, saved); }
});
