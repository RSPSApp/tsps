const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const runtime = require('../plugins/quests/QuestRuntime');
const actualCore = PluginManager.getCoreApi();
const { ItemIdentifiers: I, NpcIdentifiers: N, ObjectIdentifiers: O } = actualCore;
before(async () => require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..')));
let index = 300;

function setup(module) {
  const custom = new Map(), named = new Map(), objects = [], items = [], itemActions = [], logout = [], variants = [], conditions = [], tasks = [], spawned = [], removed = [], worldNpcs = [];
  const core = { ...actualCore,
    CountdownTask: class { constructor(key, ticks, run) { Object.assign(this, { key, ticks, run }); } },
    TaskManager: { submit(task) { tasks.push(task); } }, World: { getNpcs: () => worldNpcs },
    ObjectManager: { deregister() {}, register() {} },
  };
  const api = new Proxy({ core, persistAttribute() {},
    onCustomEvent(name, fn) { const handlers = custom.get(name) ?? []; handlers.push(fn); custom.set(name, handlers); },
    emitCustomEvent(name, event) { for (const fn of custom.get(name) ?? []) fn(event); },
    onNpcDialogueVariant(fn) { variants.push(fn); }, onNpcDialogueCondition(fn) { conditions.push(fn); },
    onNpcInteraction(name, actions) { if (typeof name === 'string') named.set(name, actions); },
    onObjectInteraction(name, actions) { objects.push(typeof name === 'function' ? { fn: name } : { name, actions }); },
    onItemOnNpc(fn) { items.push(fn); }, onItemAction(fn) { itemActions.push(fn); }, onPlayerLogout(fn) { logout.push(fn); },
    spawnNpc(def) {
      let area, location = new core.Location(def.x, def.y, def.z), npcIndex = index++;
      const npc = { def, getId: () => def.id, getIndex: () => npcIndex, getLocation: () => location, moveTo(value) { location = value; },
        getArea: () => area, setArea(value) { area = value; }, getAsNpc() { return npc; }, isPlayer: () => false, isNpc: () => true, isRegistered: () => true,
        getMovementQueue: () => ({ addFirstStep(value) { location = value; } }), performAnimation(value) { npc.animation = value.id; } };
      spawned.push(npc); return npc;
    }, removeNpc(npc) { removed.push(npc); npc.getArea()?.detach(npc); },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/quests/quests/' + module + '.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1), attrs = new Map(), inventory = new Map(), equipment = new Map(), varbits = new Map(), configs = new Map(), xp = [], messages = [], animations = [], graphics = [], packets = [];
  let location = new core.Location(2957, 3510, 0), area = null, current = null, mining = 11, combat = 3, full = false;
  const movement = { reset() { return this; }, setBlockMovement(value) { this.blocked = value; return this; } };
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; }, sendConfig(id, value) { configs.set(id, value); return sender; },
    sendInterfaceRemoval() { current = null; return sender; },
  }, { get: (target, key) => target[key] ?? ((...args) => { packets.push({ key, args }); return sender; }) });
  const player = {
    getAttribute: key => attrs.get(key), setAttribute(key, value) { attrs.set(key, value); }, getPacketSender: () => sender, getFrameUpdater: () => null,
    getInventory: () => ({ getAmount: id => inventory.get(id) ?? 0, isFull: () => full, full() { messages.push('Inventory full'); },
      adds(id, amount) { inventory.set(id, (inventory.get(id) ?? 0) + amount); },
      forceAdd(_player, item) { inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()); },
      deleteNumber(id, amount) { assert.ok((inventory.get(id) ?? 0) >= amount, 'cannot consume missing item ' + id); inventory.set(id, inventory.get(id) - amount); } }),
    getEquipment: () => ({ get: slot => equipment.has(slot) ? { getId: () => equipment.get(slot) } : null }),
    getSkillManager: () => ({ getCurrentLevel: () => mining, getCombatLevel: () => combat, addExperiences(...args) { xp.push(args); } }),
    getLocation: () => location, moveTo(value) { location = value; }, getArea: () => area, getPrivateArea: () => area, setArea(value) { area = value; },
    getIndex: () => index++, isPlayer: () => true, isNpc: () => false, getAsPlayer() { return player; }, isRegistered: () => true,
    getMovementQueue: () => movement, setUntargetable(value) { player.untargetable = value; }, getUsername: () => 'Quest tester',
    getAppearance: () => ({ isMale: () => true }), sendMessage(text) { messages.push(text); }, performAnimation(value) { animations.push(value.id); }, performGraphic(value) { graphics.push(value.id); },
    getDialogueManager: () => ({ startDialogues(chain) { current = chain; }, getCurrent: () => current, reset() { current = null; }, isActive: () => Boolean(current) }),
  };
  const emit = (name, event) => { api.emitCustomEvent(name, { player, ...event }); };
  const action = (npcId, stepId) => { const e = { player, npcId, stepId }; api.emitCustomEvent('npc-dialogue:action', e); return e; };
  const line = (npcId, text, speaker) => { const e = { player, npcId, text, step: { speaker } }; api.emitCustomEvent('npc-dialogue:line', e); return e; };
  function runAt(ticks) { const matched = tasks.filter(task => task.ticks === ticks); for (const task of matched) tasks.splice(tasks.indexOf(task), 1); for (const task of matched) task.run(); }
  return { api, core, quest, player, attrs, inventory, equipment, varbits, configs, xp, messages, animations, graphics, packets, spawned, removed, tasks, named, objects, items, itemActions, worldNpcs,
    emit, action, line, runAt, current: () => current, variant: npcId => variants[0]({ player, npcId }),
    condition: (npcId, text) => conditions[0]({ player, npcId, text }), setMining(value) { mining = value; }, setCombat(value) { combat = value; }, setFull(value) { full = value; },
    logout() { for (const fn of logout) fn({ player }); },
  };
}

/** Reuse the registered quest/player but drive the real NpcDialogues transcript runner. */
function playGeneralTranscript(h, npcId) {
  const manager = new DialogueManager(h.player);
  h.player.getDialogueManager = () => manager;
  const choice = h.variant(npcId);
  assert.ok(choice);
  runtime.startTranscript(h.api, h.player, npcId, choice.page, choice.variant);
  const lines = [];
  for (let step = 0; step < 80; step++) {
    const current = manager.getCurrent();
    if (!current) break;
    if (current instanceof h.core.NpcDialogue) {
      lines.push({ speaker: h.core.NpcDefinition.forId(current.getNpcId())?.getName?.(), text: current.getText() });
    }
    manager.advance();
  }
  return { choice, lines };
}

function goblinState(h) {
  return {
    stage: h.quest.getStage(h.player), qp: h.attrs.get('quest.points'),
    gold: h.inventory.get(I.GOLD_BAR) ?? 0, xp: JSON.stringify(h.xp),
    messages: JSON.stringify(h.messages), items: JSON.stringify([...h.inventory]),
  };
}

test('post-quest generals 669/670 play the real again/start conversation without rewards', () => {
  for (const npcId of [N.GENERAL_BENTNOZE, N.GENERAL_WARTFACE]) {
    const h = setup('GoblinDiplomacy');
    h.quest.setStage(h.player, 6);
    h.attrs.set('quest.points', 5);
    h.inventory.set(I.GOLD_BAR, 1);
    const before = goblinState(h);
    const { choice, lines } = playGeneralTranscript(h, npcId);
    assert.equal(choice.variant, 'starting-off-talking-to-general-wartface-or-general-bentnoze');
    assert.ok(lines.length > 0, 'dialogue must not be silent for ' + npcId);
    assert.ok(lines.some(line => /^General (Bentnoze|Wartface)$/.test(line.speaker ?? '') && line.text.length > 0),
      'canonical general speaker/text for ' + npcId + ': ' + JSON.stringify(lines));
    assert.deepEqual(goblinState(h), before, 'post-quest talk changes no stage/reward ' + npcId);
  }
});

test('Goblin general variants before completion are unchanged', () => {
  const h = setup('GoblinDiplomacy');
  for (const [stage, expected] of [
    [0, 'starting-off-talking-to-general-wartface-or-general-bentnoze'],
    [1, 'showing-the-generals-different-goblin-armours-orange-painted-goblin-armour'],
    [3, 'showing-the-generals-different-goblin-armours-blue-painted-goblin-armour'],
    [4, 'showing-the-generals-different-goblin-armours-brown-painted-goblin-armour'],
  ]) {
    h.quest.setStage(h.player, stage);
    assert.equal(h.variant(N.GENERAL_BENTNOZE).variant, expected, 'Bentnoze stage ' + stage);
    assert.equal(h.variant(N.GENERAL_WARTFACE).variant, expected, 'Wartface stage ' + stage);
  }
});

test('Doric starts with the request line and completes only after the native copper box', () => {
  const h = setup('DoricsQuest');
  h.emit('npc-dialogue:hook', { npcId: N.DORIC, hook: 'quest:doric-s-quest:start' }); assert.equal(h.quest.getStage(h.player), 0);
  h.line(N.DORIC, 'Clay is what I use more than anything, to make casts.').before();
  assert.equal(h.quest.getStage(h.player), 10); assert.equal(h.inventory.get(I.BRONZE_PICKAXE), 1);
  for (const [id, amount] of [[I.CLAY, 7], [I.COPPER_ORE, 5], [I.IRON_ORE, 3]]) h.inventory.set(id, amount);
  const box = h.action(N.DORIC, 'n6fQmN'); assert.deepEqual(box.box, { items: [I.COPPER_ORE] }); assert.equal(h.animations.at(-1), 3071);
  assert.equal(h.inventory.get(I.CLAY), 7); assert.equal(h.quest.getStage(h.player), 10);
  h.action(N.DORIC, 'M4gVPX'); assert.equal(h.quest.getStage(h.player), 100); assert.equal(h.inventory.get(I.CLAY), 1);
  assert.equal(h.inventory.get(I.COINS), 180); assert.deepEqual(h.xp, [[h.core.Skill.MINING, 1300]]); assert.equal(h.quest.completionJingleId, 154);
  h.action(N.DORIC, 'M4gVPX'); assert.equal(h.inventory.get(I.CLAY), 1); assert.equal(h.inventory.get(I.COINS), 180);
});

test('Doric protects his anvils and whetstone before completion without blocking other anvils', () => {
  const h = setup('DoricsQuest');
  const denied = { player: h.player, object: { getId: () => 2031 }, denied: false };
  h.api.emitCustomEvent('smithing:anvil-access', denied); assert.equal(denied.denied, true); assert.ok(h.current());
  const ordinary = { player: h.player, object: { getId: () => 2783 }, denied: false };
  h.api.emitCustomEvent('smithing:anvil-access', ordinary); assert.equal(ordinary.denied, false);
  assert.equal(h.objects.find(o => o.name === "Doric's Whetstone").actions.Use({ player: h.player, objectId: 10641 }), true);
  assert.deepEqual(h.action(N.DORIC, 'UgCEfK').box, { statement: true });
  const warning = { player: h.player, npcId: N.DORIC, prompt: "Start Doric's Quest?" }; h.api.emitCustomEvent('npc-dialogue:menu', warning); assert.match(warning.warning, /lower than recommended/);
  h.quest.setStage(h.player, 100); denied.denied = false; h.api.emitCustomEvent('smithing:anvil-access', denied); assert.equal(denied.denied, false);
});

test('Knight sword progress waits for Reldo, pie and picture lines, with the captured timed pie box', () => {
  const h = setup('KnightsSword'); h.quest.setStage(h.player, 1);
  h.emit('npc-dialogue:choice', { npcId: N.RELDO, option: 'What do you know about the Imcando dwarves?' }); assert.equal(h.quest.getStage(h.player), 1);
  h.line(N.RELDO, 'Well, not totally random. Apparently some of the surviving Imcando made a home for themselves near the cliffs on the Asgarnian southern peninsula. That would be a good place to start.').before();
  h.inventory.set(I.REDBERRY_PIE, 1); h.action(N.THURGO, '1U_fgy'); assert.equal(h.quest.getStage(h.player), 3); assert.equal(h.inventory.get(I.REDBERRY_PIE), 0);
  assert.deepEqual(h.tasks.map(t => t.ticks), [3, 9]); h.runAt(3); h.runAt(9);
  assert.match(h.current().getDialogues().get(0).getText(), /Thurgo pats his stomach/);
  h.line(N.THURGO, 'All the Faladian knights used to have swords with unique designs according to their position. Could you bring me a picture or something?').before(); assert.equal(h.quest.getStage(h.player), 4);
  h.variant(N.SQUIRE_14); assert.equal(h.quest.getStage(h.player), 4);
  h.line(N.SQUIRE_14, "Ok, I'll try and get that then.").before(); assert.equal(h.quest.getStage(h.player), 5);
  const warning = { player: h.player, npcId: N.SQUIRE_14, prompt: "Start The Knight's Sword quest?" }; h.api.emitCustomEvent('npc-dialogue:menu', warning); assert.match(warning.warning, /combat level.*20/); assert.ok(!warning.warning.includes('skill levels'));
});

test('Knight portrait is collected on Continue; smithing and hand-in revalidate all actual items', () => {
  const h = setup('KnightsSword'); h.quest.setStage(h.player, 5); h.player.moveTo(new h.core.Location(2985, 3336, 2));
  const cupboard = h.objects.find(o => o.name === 'Cupboard');
  cupboard.actions.Search({ player: h.player, objectId: O.CUPBOARD_9 }); assert.equal(h.inventory.get(I.PORTRAIT), undefined);
  h.current().getDialogues().get(1).send(h.player); assert.equal(h.inventory.get(I.PORTRAIT), 1);
  assert.deepEqual(h.action(N.THURGO, 'KYiD0w').box, { items: [I.PORTRAIT] }); h.action(N.THURGO, '3_D_pF'); assert.equal(h.quest.getStage(h.player), 6);
  assert.equal(h.action(N.THURGO, '7zBX9C').end, true); assert.equal(h.inventory.get(I.BLURITE_SWORD), undefined);
  h.inventory.set(I.BLURITE_ORE, 1); h.inventory.set(I.IRON_BAR, 2); assert.deepEqual(h.action(N.THURGO, '7zBX9C').box, { items: [I.BLURITE_SWORD] });
  assert.equal(h.inventory.get(I.BLURITE_SWORD), 1); assert.equal(h.inventory.get(I.IRON_BAR), 0);
  assert.deepEqual(h.action(N.SQUIRE_14, '40MG6g').box, { statement: true }); h.action(N.SQUIRE_14, '7-huYO');
  assert.equal(h.quest.getStage(h.player), 7); assert.equal(h.inventory.get(I.BLURITE_SWORD), 0); assert.deepEqual(h.xp, [[h.core.Skill.SMITHING, 12725]]);
  h.action(N.SQUIRE_14, '7-huYO'); assert.equal(h.xp.length, 1); assert.equal(h.quest.completionJingleId, 153);
  assert.equal(h.objects.some(o => o.name === 'Blurite rocks'), false, 'canonical Mining owns blurite depletion and rolls');
});

test('Sir Vyvin stops a watched cupboard search; prior Giant Dwarf contact skips Reldo', () => {
  const h = setup('KnightsSword'); h.attrs.set('quest.giant_dwarf.pie', 1);
  h.emit('npc-dialogue:hook', { npcId: N.SQUIRE_14, hook: 'quest:the-knight-s-sword:start' }); assert.equal(h.quest.getStage(h.player), 2);
  h.quest.setStage(h.player, 5); h.player.moveTo(new h.core.Location(2985, 3336, 2));
  h.worldNpcs.push({ getId: () => N.SIR_VYVIN, getLocation: () => new h.core.Location(2984, 3336, 2), getPositionToFace: () => h.player.getLocation() });
  h.objects.find(o => o.name === 'Cupboard').actions.Search({ player: h.player, objectId: O.CUPBOARD_9 });
  assert.equal(h.inventory.get(I.PORTRAIT), undefined); assert.match(h.messages.at(-1), /Sir Vyvin is watching/);
});

test('Black Knights dossier runs its eight-cycle native countdown without starting or advancing early', () => {
  const h = setup('BlackKnightsFortress'); h.attrs.set('quest.points', 11);
  assert.equal(h.named.get('Sir Amik Varze')['Talk-to']({ player: h.player }), true); assert.equal(h.quest.getStage(h.player), 0);
  h.attrs.set('quest.points', 12); h.line(N.SIR_AMIK_VARZE_4, "Good luck! Let me know how you get on. Here's the dossier for the case, I've already given you the details.").before();
  assert.equal(h.quest.getStage(h.player), 1); assert.equal(h.inventory.get(I.DOSSIER), 1);
  h.itemActions[0]({ player: h.player, itemId: I.DOSSIER, option: 'Read' });
  assert.equal(h.inventory.get(I.DOSSIER), 1); h.runAt(2); h.runAt(4); h.runAt(6); assert.equal(h.inventory.get(I.DOSSIER), 1);
  h.runAt(8); assert.equal(h.inventory.get(I.DOSSIER), 0); assert.equal(h.graphics.at(-1), 770); assert.equal(h.quest.getStage(h.player), 1);
});

test('Black Knights listening and private sabotage commit only when the captured scene finishes', () => {
  const h = setup('BlackKnightsFortress'); h.quest.setStage(h.player, 1);
  h.objects.find(o => o.fn).fn({ player: h.player, objectId: O.GRILL, location: { x: 3026, y: 3507, z: 0 }, clickType: 1, definition: { getInteractions: () => ['Listen-at'] } });
  assert.equal(h.quest.getStage(h.player), 1); h.runAt(2); assert.equal(h.quest.getStage(h.player), 1);
  h.line(N.WITCH_5, 'Yeth, Mithreth.').after(); assert.equal(h.quest.getStage(h.player), 2);
  h.player.moveTo(new h.core.Location(3031, 3506, 1)); h.inventory.set(I.CABBAGE, 1); h.action(N.WITCH_5, 'lUsX9u');
  assert.equal(h.inventory.get(I.CABBAGE), 0); assert.equal(h.quest.getStage(h.player), 2); h.runAt(8); assert.equal(h.spawned.length, 3);
  assert.equal(h.player.getPrivateArea().getName(), "Black Knights' secret weapon");
  h.action(N.WITCH_5, 'Ug7RZ1'); h.runAt(7); assert.equal(h.varbits.get(2494), 1); assert.equal(h.quest.getStage(h.player), 2);
  h.line(N.WITCH_5, 'Meow!No special dialogue with catspeak amulet equipped').after(); h.runAt(6); h.runAt(9);
  assert.equal(h.quest.getStage(h.player), 3); assert.equal(h.player.getPrivateArea(), null); assert.equal(h.player.untargetable, false);
  assert.deepEqual(h.action(N.SIR_AMIK_VARZE_4, 'jnrgsN').box, { statement: true }); h.action(N.SIR_AMIK_VARZE_4, 'uMmzNj');
  assert.equal(h.inventory.get(I.COINS), 2500); assert.equal(h.quest.getStage(h.player), 4); assert.equal(h.quest.completionJingleId, 152);
  h.action(N.SIR_AMIK_VARZE_4, 'uMmzNj'); assert.equal(h.inventory.get(I.COINS), 2500);
});

test('Goblin crates are individually exhausted even before the quest, and legacy stages map to OSRS varbits', () => {
  const h = setup('GoblinDiplomacy'), search = h.objects.find(o => o.fn).fn;
  const click = id => search({ player: h.player, objectId: id, clickType: 1, definition: { getInteractions: () => ['Search'] } });
  click(O.CRATE_140); click(O.CRATE_140); assert.equal(h.inventory.get(I.GOBLIN_MAIL), 1); assert.equal(h.varbits.get(2380), 1);
  click(O.CRATE_139); click(O.CRATE_141); assert.equal(h.inventory.get(I.GOBLIN_MAIL), 3);
  for (const [stage, wire] of [[0, 0], [1, 3], [3, 4], [4, 5], [6, 6]]) assert.equal(h.quest.varbitValue(stage, h.player), wire);
  assert.equal(h.quest.varbitId, 2378); assert.equal(h.quest.varpId, undefined);
});

test('all three Goblin fittings keep mail until the scene ends, change Grubfoot and reward once', () => {
  const h = setup('GoblinDiplomacy'); h.line(N.GENERAL_WARTFACE, 'Yep, bring us orange armour.').before();
  assert.equal(h.quest.getStage(h.player), 1);
  for (const [mail, start, change, end, stage, morph] of [
    [I.ORANGE_GOBLIN_MAIL, 'tpOU6M', '7xpvaw', 'C7D_Q0', 3, 1],
    [I.BLUE_GOBLIN_MAIL, 'W3sSt5', 'UNwweE', '0v3cKx', 4, 2],
    [I.GOBLIN_MAIL, 'qn3xcl', null, 'QqWnqy', 6, 0],
  ]) {
    h.packets.length = 0;
    h.inventory.set(mail, 1); h.action(N.GENERAL_WARTFACE, start); assert.equal(h.inventory.get(mail), 1);
    h.runAt(1);
    assert.deepEqual(h.packets.filter(row => row.key === 'sendCameraShake').map(row => row.args), [0, 1, 2, 3, 4].map(axis => [axis, 0]));
    assert.equal(h.packets.filter(row => /sendCamera(MoveTo|LookAt)/.test(row.key)).length, 0);
    h.runAt(2); h.runAt(3); assert.equal(h.player.getPrivateArea().getName(), 'Goblin armour fitting');
    const camera = h.player.getPrivateArea().sourceTile(2961, 3514), target = h.player.getPrivateArea().sourceTile(2957, 3512);
    assert.deepEqual(h.packets.filter(row => /sendCamera(MoveTo|LookAt)/.test(row.key)), [
      { key: 'sendCameraMoveTo', args: [camera.getX(), camera.getY(), 450, { rate: 232, rate2: 232, heightRelative: false }] },
      { key: 'sendCameraLookAt', args: [target.getX(), target.getY(), 150, { rate: 232, rate2: 232, heightRelative: false }] },
    ]);
    if (change) h.action(N.GENERAL_WARTFACE, change); else h.line(N.GENERAL_WARTFACE, 'Put on this armour!').after();
    h.runAt(9); h.runAt(12); assert.ok(h.spawned.length >= 4);
    h.action(N.GENERAL_WARTFACE, end); assert.equal(h.inventory.get(mail), 0); h.runAt(1); h.runAt(2); h.runAt(3);
    assert.equal(h.quest.getStage(h.player), stage); assert.equal(h.varbits.get(13594), morph); assert.equal(h.player.getPrivateArea(), null);
    assert.deepEqual(h.packets.filter(row => /sendCamera(Unlock|Reset)/.test(row.key)), [{ key: 'sendCameraUnlock', args: [false] }, { key: 'sendCameraReset', args: [] }]);
  }
  assert.equal(h.inventory.get(I.GOLD_BAR), 1); assert.deepEqual(h.xp, [[h.core.Skill.CRAFTING, 200]]); assert.equal(h.attrs.get('quest.points'), 5);
  h.action(N.GENERAL_WARTFACE, 'QqWnqy'); assert.equal(h.inventory.get(I.GOLD_BAR), 1);
});

test('interrupting a Goblin fitting restores controls and retains the undelivered mail', () => {
  const h = setup('GoblinDiplomacy'); h.quest.setStage(h.player, 1); h.inventory.set(I.ORANGE_GOBLIN_MAIL, 1);
  h.action(N.GENERAL_WARTFACE, 'tpOU6M'); h.runAt(1); h.logout();
  assert.equal(h.player.getPrivateArea(), null); assert.equal(h.inventory.get(I.ORANGE_GOBLIN_MAIL), 1); assert.equal(h.player.untargetable, false); assert.equal(h.varbits.get(6719), 0);
});


test('Black Knights sabotage sends the recorded tick-ten camera and restores it at the two captured return boundaries', () => {
  const h = setup('BlackKnightsFortress'); h.quest.setStage(h.player, 2); h.inventory.set(I.CABBAGE, 1);
  h.action(N.WITCH_5, 'lUsX9u');
  assert.deepEqual(h.packets.filter(row => row.key === 'sendCameraShake').map(row => row.args), [0, 1, 2, 3, 4].map(axis => [axis, 0]));
  h.runAt(8); assert.equal(h.packets.filter(row => /sendCamera(MoveTo|LookAt)/.test(row.key)).length, 0);
  h.runAt(10);
  const area = h.player.getPrivateArea(), camera = area.sourceTile(3035, 3499), target = area.sourceTile(3032, 3505);
  assert.deepEqual(h.packets.filter(row => /sendCamera(MoveTo|LookAt)/.test(row.key)), [
    { key: 'sendCameraMoveTo', args: [camera.getX(), camera.getY(), 1500, { rate: 100, rate2: 100, heightRelative: false }] },
    { key: 'sendCameraLookAt', args: [target.getX(), target.getY(), 300, { rate: 100, rate2: 100, heightRelative: false }] },
  ]);
  h.line(N.WITCH_5, 'Meow!').after(); h.runAt(4);
  assert.equal(h.packets.filter(row => row.key === 'sendCameraReset').length, 0);
  h.runAt(6); assert.equal(h.packets.filter(row => row.key === 'sendCameraReset').length, 1);
  h.runAt(9); assert.deepEqual(h.packets.filter(row => /sendCamera(Unlock|Reset)/.test(row.key)), [
    { key: 'sendCameraReset', args: [] }, { key: 'sendCameraUnlock', args: [false] }, { key: 'sendCameraReset', args: [] },
  ]);
});
