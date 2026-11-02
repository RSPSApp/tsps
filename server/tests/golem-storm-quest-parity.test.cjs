const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

// The two quests only need the transcript hooks to be observed, not animated.
const transcripts = [];
const realStartTranscript = runtime.startTranscript;
runtime.startTranscript = (api, player, npcId, page, variant, select) => {
  transcripts.push({ player, npcId, page, variant, select });
  return true;
};

function setup(register, options = {}) {
  const hooks = { custom: new Map(), variants: [], conditions: [], login: [], logout: [], zoneEnter: [], objects: [], itemActions: [], itemOnNpc: [], itemOnObject: [], itemOnItem: [], npcs: [] };
  const tasks = [];
  const spawned = [], removed = [], ground = [], cameras = [], shakes = [], statements = [], sceneObjects = [], overheads = [];
  let tick = 0;
  const executed = new Set();
  const core = {
    ...PluginManager.getCoreApi(),
    CountdownTask: class { constructor(key, ticks, run) { Object.assign(this, { key, ticks, run }); } },
    TaskManager: { submit(task) { task.due = tick + task.ticks; tasks.push(task); }, cancelTasks() {} },
    Boundary: class { constructor(...bounds) { this.bounds = bounds; } },
    PrivateArea: class {
      constructor(bounds) { this.bounds = bounds; this.members = []; }
      enter(player) { player.__area = this; this.members.push(player); }
      leave(player) { this.members = this.members.filter((member) => member !== player); if (player.__area === this) player.__area = null; }
      add(member) { this.members.push(member); member.setArea?.(this); }
      detach(member) { this.members = this.members.filter(candidate => candidate !== member); }
      remove(member) { this.detach(member); member.setArea?.(null); }
    },
    GameObject: class { constructor(id, location, type, rotation, area) { Object.assign(this, { id, location, type, rotation, area }); } },
    ObjectManager: { register(object) { sceneObjects.push(object); }, deregister(object) { sceneObjects.splice(sceneObjects.indexOf(object), 1); } },
    MultiChatboxPrompt: { getPending: () => null },
    ActionDialogue: class { constructor(index, options) { Object.assign(this, { index, ...options }); } },
    DialogueChainBuilder: class { add(part) { this.part = part; return this; } },
    StatementDialogue: class { static send(player, text) { statements.push(text); } },
  };
  if (options.realDialogue) {
    const realCore = PluginManager.getCoreApi();
    for (const key of ['ActionDialogue', 'DialogueChainBuilder', 'StatementDialogue']) core[key] = realCore[key];
  }
  const api = new Proxy({
    core,
    persistAttribute() {},
    onNpcDialogueVariant(fn) { hooks.variants.push(fn); },
    onNpcDialogueCondition(fn) { hooks.conditions.push(fn); },
    onNpcInteraction(fn) { hooks.npcs.push(fn); },
    onObjectInteraction(fn) { hooks.objects.push(fn); },
    onItemAction(fn) { hooks.itemActions.push(fn); },
    onItemOnNpc(fn) { hooks.itemOnNpc.push(fn); },
    onItemOnObject(fn) { hooks.itemOnObject.push(fn); },
    onItemOnItem(fn) { hooks.itemOnItem.push(fn); },
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onPlayerLogout(fn) { hooks.logout.push(fn); },
    onZoneEnter(zone, fn) { hooks.zoneEnter.push(fn); },
    onZoneExit() {},
    onNpcBeforeDeath() {},
    onNpcDeath() {},
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete' && options.prereqs !== false && ['the_golem', 'demon_slayer'].includes(event?.key)) event.complete = true;
      for (const fn of hooks.custom.get(name) ?? []) fn(event);
    },
    spawnNpc(def) {
      let location = new core.Location(def.x, def.y, def.z), area = null;
      const npc = { def, getId: () => def.id, getOwner: () => def.owner, getLocation: () => location,
        moveTo: to => { location = to; }, getPrivateArea: () => area, getArea: () => area, setArea: value => { area = value; },
        getCurrentDefinition: () => core.NpcDefinition.forId(def.id), isVisible: () => true,
        isOwnerOnly: () => def.ownerOnly === true, forceChat: text => overheads.push({ actor: npc, text, tick }),
        setPositionToFace() {}, isRegistered: () => !npc.removed };
      spawned.push(npc); return npc;
    },
    removeNpc(npc) { npc.removed = true; removed.push(npc); },
    getItemOnGroundManager: () => ({
      getGroundItem: (owner, id, location) => ground.find((item) => item.id === id && item.location.x === location.x && item.location.y === location.y),
      registerLocation: (player, item, location, privateArea = player.getPrivateArea()) => ground.push({ id: item.getId(), location, privateArea }),
      onRegionChange() {},
    }),
    getWorld: () => ({ getNpcs: () => [] }),
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  register(api);
  const quest = runtime.getRegisteredQuests().at(-1);

  const attrs = new Map(), inventory = new Map(), varbits = new Map(), messages = [];
  let location = new core.Location(0, 0, 0), dialogue = null, npcViewDistance = 15;
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
    sendCameraMoveTo(x, y, height, motion) { cameras.push({ kind: 'move', x, y, height, motion }); return sender; },
    sendCameraLookAt(x, y, height, motion) { cameras.push({ kind: 'look', x, y, height, motion }); return sender; },
    sendCameraReset() { cameras.push({ kind: 'reset' }); return sender; },
    sendCameraShake(slot, random) { shakes.push({ slot, random }); return sender; },
    sendInterfaceRemoval() { if (options.realDialogue) player.getDialogueManager().reset(); return sender; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const player = {
    getUsername: () => 'parity-test',
    getAppearance: () => ({ isMale: () => true }),
    getAttribute: (key) => attrs.get(key),
    setAttribute(key, value) { attrs.set(key, value); },
    getPacketSender: () => sender,
    sendMessage(message) { messages.push(message); },
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      isFull: () => false,
      getFreeSlots: () => 28,
      deleteNumber(id, count) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count)); },
      adds(id, count) { inventory.set(id, (inventory.get(id) ?? 0) + count); },
    }),
    getEquipment: () => ({ getItems: () => [] }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, addExperiences() {} }),
    getLocation: () => location,
    moveTo(value) { location = value; },
    getPrivateArea: () => player?.__area ?? null,
    getArea: () => player.__area,
    getNpcViewDistance: () => npcViewDistance,
    setNpcViewDistance(distance) { npcViewDistance = distance == null ? 15 : Math.max(1, Math.min(127, Math.trunc(distance))); },
    getLocalNpcs: () => spawned.filter(npc => !npc.removed
      && location.isViewableFromWithin(npc.getLocation(), npcViewDistance)
      && npc.getPrivateArea() === player.getPrivateArea()),
    forceChat: text => overheads.push({ actor: player, text, tick }),
    setUntargetable() {},
    getMovementQueue: () => ({ reset() { return this; }, setBlockMovement() { return this; } }),
    getDialogueManager: () => ({
      startDialogues(chain) { dialogue = chain; },
      isActive: () => dialogue !== null,
      getCurrent: () => dialogue,
      reset() { dialogue = null; },
    }),
    isRegistered: () => true,
    isPlayer: () => true,
  };
  if (options.realDialogue) {
    const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
    const manager = new DialogueManager(player);
    player.getDialogueManager = () => manager;
  }
  const emit = (name, event) => api.emitCustomEvent(name, { player, ...event });
  const advance = () => {
    tick++;
    for (const task of [...tasks]) {
      if (!executed.has(task) && task.due <= tick) { executed.add(task); task.run(); }
    }
  };
  return { api, core, quest, attrs, inventory, varbits, messages, player, tasks, spawned, removed, ground, transcripts, hooks, emit, advance,
    cameras, shakes, statements, sceneObjects, overheads,
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); } };
}

test('The Golem: clay morphs, item sources, gated bookcase and per-alcove varbits', () => {
  const h = setup((api) => require('../plugins/quests/quests/TheGolem.Quest')(api));
  const I = h.core.ItemIdentifiers;
  h.quest.setStage(h.player, 1);
  for (const login of h.hooks.login) login({ player: h.player });
  assert.ok(h.ground.some((item) => item.id === I.LETTER_2), 'letter floor spawn');
  assert.ok(h.ground.some((item) => item.id === I.STRANGE_IMPLEMENT), 'implement floor spawn');

  h.inventory.set(I.SOFT_CLAY, 4);
  for (let clay = 1; clay <= 4; clay++) {
    h.hooks.itemOnNpc[0]({ player: h.player, npcId: 6277, itemId: I.SOFT_CLAY });
    assert.equal(h.varbits.get(348), clay, 'golem_clay drives the NPC transform');
  }
  h.emit('npc-dialogue:action', { npcId: 6277, stepId: 'qjXp0f' });
  assert.equal(h.quest.getStage(h.player), 2);

  h.inventory.set(I.LETTER_2, 1);
  h.hooks.itemActions[0]({ player: h.player, itemId: I.LETTER_2, option: 'Read' });
  assert.equal(h.varbits.get(347), 1);
  h.emit('npc-dialogue:line', { npcId: h.core.NpcIdentifiers.ELISSA, text: 'The notes he made are in the library.' });
  assert.equal(h.varbits.get(347), 2);
  for (const enter of h.hooks.zoneEnter) enter({ player: h.player });
  assert.equal(h.varbits.get(356), 1, 'first ruin entry sets seen_underground');

  h.hooks.objects[0]({ player: h.player, objectId: 6292, location: new h.core.Location(3200, 3200, 0) });
  assert.equal(h.inventory.get(I.VARMENS_NOTES) ?? 0, 0, 'wrong bookcase gives nothing');
  h.hooks.objects[0]({ player: h.player, objectId: 6292, location: new h.core.Location(3366, 3332, 0) });
  assert.equal(h.inventory.get(I.VARMENS_NOTES), 1);
  assert.equal(h.quest.getStage(h.player), 2, 'the bookcase alone does not advance the stage');
  assert.equal(h.varbits.get(347), 2);
  h.hooks.itemActions[0]({ player: h.player, itemId: I.VARMENS_NOTES, option: 'Read' });
  assert.equal(h.varbits.get(347), 3, 'reading the notes sets golem_b 3');
  for (const npc of h.hooks.npcs) {
    npc({ player: h.player, npcId: h.core.NpcIdentifiers.CURATOR_HAIG_HALEN, clickType: 1, definition: { getActions: () => ['Talk-to'] } });
  }
  assert.equal(h.quest.getStage(h.player), 3, 'the curator conversation advances to find-statuette');

  h.inventory.set(I.DISPLAY_CABINET_KEY, 1);
  h.hooks.itemOnObject[0]({ player: h.player, itemId: I.DISPLAY_CABINET_KEY, objectId: 24626 });
  assert.equal(h.inventory.get(I.STATUETTE), 1);
  assert.equal(h.varbits.get(355), 1, 'museum case opens');

  // A standing statuette can be turned before the fourth is placed.
  h.hooks.objects[0]({ player: h.player, objectId: 6303, location: new h.core.Location(2718, 4899, 0) });
  assert.equal(h.varbits.get(349), 1);
  h.hooks.objects[0]({ player: h.player, objectId: 6303, location: new h.core.Location(2718, 4899, 0) });
  assert.equal(h.varbits.get(349), 0, 'an extra turn reverses the facing');
  h.hooks.objects[0]({ player: h.player, objectId: 6303, location: new h.core.Location(2718, 4899, 0) });

  h.hooks.itemOnObject[0]({ player: h.player, itemId: I.STATUETTE, objectId: 6306, location: new h.core.Location(2725, 4896, 0) });
  assert.equal(h.varbits.get(352), 1, 'placed statuette starts facing left');
  assert.equal(h.quest.getStage(h.player), 4);

  h.hooks.objects[0]({ player: h.player, objectId: 6304, location: new h.core.Location(2718, 4896, 0) });
  assert.equal(h.varbits.get(349), 1);
  assert.equal(h.varbits.get(350), 1);
  assert.equal(h.varbits.get(351), 0, 'C is already facing right');
  assert.equal(h.quest.getStage(h.player), 4);
  h.hooks.objects[0]({ player: h.player, objectId: 6306, location: new h.core.Location(2725, 4896, 0) });
  assert.equal(h.varbits.get(352), 2);
  assert.equal(h.quest.getStage(h.player), 5, 'a=1 b=1 c=0 d=2 opens the door');

  h.hooks.objects[0]({ player: h.player, objectId: 6310, location: new h.core.Location(2720, 4912, 0) });
  assert.equal(h.player.getLocation().z, 2, 'portal moves into the throne room');
  assert.equal(h.varbits.get(356), 1);
  assert.equal(h.quest.getStage(h.player), 6);

  // Capture 3333 keeps head_open through the program dialogue and clears it
  // two ticks after completion.
  h.quest.setStage(h.player, 7);
  h.inventory.set(I.STRANGE_IMPLEMENT, 1);
  h.hooks.itemOnNpc[0]({ player: h.player, npcId: 6277, itemId: I.STRANGE_IMPLEMENT });
  assert.equal(h.varbits.get(353), 1);
  h.inventory.set(I.GOLEM_PROGRAM, 1);
  h.hooks.itemOnNpc[0]({ player: h.player, npcId: 6277, itemId: I.GOLEM_PROGRAM });
  h.advance();
  assert.equal(h.quest.getStage(h.player), 10);
  assert.equal(h.varbits.get(353), 1, 'the skull stays open through completion');
  h.advance();
  h.advance();
  assert.equal(h.varbits.get(353), 0);
  assert.ok(h.messages.includes("The golem's skull shuts automatically."));

  h.varbits.clear();
  for (const login of h.hooks.login) login({ player: h.player });
  assert.equal(h.varbits.get(347), 3);
  assert.equal(h.varbits.get(348), 4);
  assert.equal(h.varbits.get(352), 2);
  assert.equal(h.varbits.get(355), 1);
  assert.equal(h.varbits.get(356), 1);
});

test('Shadow of the Storm: plane-2 portal, Eric, Tanya cutscene and capture word order', () => {
  const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api));
  const I = h.core.ItemIdentifiers, N = h.core.NpcIdentifiers;
  const STAGE_RITUAL = 80, STAGE_RITUAL_DONE = 90, STAGE_PREPARE = 100;

  h.quest.setStage(h.player, STAGE_RITUAL_DONE);
  for (const enter of h.hooks.zoneEnter) enter({ player: h.player });
  const eric = h.spawned.find((npc) => npc.getId() === N.ERIC);
  assert.ok(eric, 'Eric stays for his post-ritual line');
  assert.equal(eric.def.z, 2, 'the throne-room cast is on plane 2');

  h.quest.setStage(h.player, STAGE_RITUAL);
  h.setLocation(0, 0);
  h.inventory.set(I.DEMONIC_SIGIL, 1);
  h.hooks.itemActions[0]({ player: h.player, itemId: I.DEMONIC_SIGIL, option: 'Chant' });
  assert.ok(h.messages.some((text) => /ritual circle/.test(text)));

  // Capture 3333 stores the tome order (reverse of Denath's spoken order).
  h.attrs.set('quest.shadow_of_the_storm.incantation', 4371);
  h.inventory.set(I.SILVERLIGHT_2, 1);
  h.setLocation(2720, 4903, 2);
  h.transcripts.length = 0;
  h.hooks.itemActions[0]({ player: h.player, itemId: I.DEMONIC_SIGIL, option: 'Chant' });
  assert.equal(h.transcripts.at(-1).variant, 'performing-the-ritual-getting-in-place');
  for (const word of ['Nahudu', 'Caldar', 'Tarren', 'Agrith-Naar', 'Camerinthum']) {
    h.emit('npc-dialogue:choice', { npcId: N.DENATH, option: word });
  }
  h.advance();
  assert.equal(h.quest.getStage(h.player), STAGE_RITUAL_DONE, 'the first ritual says Denath\'s order');
  for (let tick = 0; tick < 16; tick++) h.advance();
  assert.equal(h.player.getLocation().x, 2721, 'the portal cutscene returns the player outside');
  assert.equal(h.player.getLocation().z, 0);

  h.transcripts.length = 0;
  for (let tick = 0; tick < 8; tick++) h.advance();
  assert.equal(h.transcripts.at(-1).variant, 'performing-the-ritual-walking-out-of-the-portal');
  h.emit('npc-dialogue:action', { npcId: N.MATTHEW, stepId: 'iWR7Wz' });
  assert.equal(h.quest.getStage(h.player), STAGE_PREPARE, 'Tanya dies before recruiting');
  assert.ok(h.ground.some((item) => item.id === I.DEMONIC_SIGIL), 'Tanya\'s sigil lands on the floor');

  // Recovery: logging in at 90 without the cutscene resolves Tanya instead of sticking.
  h.quest.setStage(h.player, STAGE_RITUAL_DONE);
  h.attrs.set('quest.shadow_of_the_storm.helpers', 0);
  for (const login of h.hooks.login) login({ player: h.player });
  assert.equal(h.player.getLocation().x, 2721);

  h.transcripts.length = 0;
  h.attrs.set('shadow-of-the-storm:summon-assembled', true);
  h.quest.setStage(h.player, 110);
  h.setLocation(2720, 4903, 2);
  h.hooks.itemActions[0]({ player: h.player, itemId: I.DEMONIC_SIGIL, option: 'Chant' });
  assert.equal(h.transcripts.at(-1).variant, 'summoning-agrith-naar-in-position');
});

test('Shadow of the Storm: requirement refusal and shared portal teleports', () => {
  const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api), { prereqs: false });
  h.hooks.npcs[0]({
    player: h.player,
    npcId: h.core.NpcIdentifiers.FATHER_REEN,
    clickType: 1,
    definition: { getActions: () => ['Talk-to'] },
  });
  assert.equal(h.quest.getStage(h.player), 0);
  assert.ok(h.messages.includes('You need to complete The Golem and Demon Slayer before you can start Shadow of the Storm.'));

  h.quest.setStage(h.player, 40);
  h.hooks.objects[0]({ player: h.player, objectId: 6310 });
  assert.deepEqual([h.player.getLocation().x, h.player.getLocation().y, h.player.getLocation().z], [2720, 4884, 2]);
  h.hooks.objects[0]({ player: h.player, objectId: 6282 });
  assert.deepEqual([h.player.getLocation().x, h.player.getLocation().y, h.player.getLocation().z], [2721, 4911, 0]);
});

test('Shadow of the Storm: the golem hides the tome in a random kiln, set in 1378', () => {
  const KILNS = [[10242, 3467, 3123], [10243, 3478, 3082], [10244, 3472, 3092], [10245, 3500, 3084]];
  const random = Math.random;
  try {
    for (let kiln = 0; kiln < KILNS.length; kiln++) {
      const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api));
      const I = h.core.ItemIdentifiers;
      h.quest.setStage(h.player, 50);
      // As captured (572): the golem's answer sets agrith_kiln to the tome's kiln.
      Math.random = () => (kiln + 0.5) / KILNS.length;
      h.emit('npc-dialogue:choice', { npcId: h.core.NpcIdentifiers.CLAY_GOLEM, option: 'Did you see anything happen last night?' });
      assert.equal(h.quest.getStage(h.player), 60);
      assert.equal(h.varbits.get(1378), kiln, 'the hidden kiln is sent in agrith_kiln');

      for (const [index, [objectId, x, y]] of KILNS.entries()) {
        h.setLocation(x, y);
        h.transcripts.length = 0;
        h.hooks.objects[0]({ player: h.player, objectId, location: new h.core.Location(x, y, 0) });
        assert.equal(h.transcripts.at(-1)?.variant, 'infiltrating-the-wizards-searching-kilns');
        assert.equal(h.hooks.conditions[0]({ player: h.player, stepId: '3DMFjV' }), index === kiln,
          `agrith_kiln ${kiln}: kiln ${objectId} ${index === kiln ? 'holds' : 'does not hold'} the tome`);
      }
      assert.equal(h.varbits.get(1378), kiln, 'wrong searches leave agrith_kiln alone');

      const [objectId, x, y] = KILNS[kiln];
      h.hooks.objects[0]({ player: h.player, objectId, location: new h.core.Location(x, y, 0) });
      h.emit('npc-dialogue:condition', { stepId: '3DMFjV' });
      assert.equal(h.inventory.get(I.DEMONIC_TOME), 1, 'the hidden kiln gives the tome');
      assert.equal(h.quest.getStage(h.player), 60, 'searching does not advance the quest stage');
    }
  } finally {
    Math.random = random;
  }
});

test('Shadow of the Storm: first-ritual camera, BOOM, portal loc and Tanya actors', () => {
  const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api));
  const I = h.core.ItemIdentifiers, N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 80);
  h.attrs.set('quest.shadow_of_the_storm.incantation', 4371);
  h.inventory.set(I.DEMONIC_SIGIL, 1);
  h.inventory.set(I.SILVERLIGHT_2, 1);
  h.setLocation(2720, 4903, 2);
  h.hooks.itemActions[0]({ player: h.player, itemId: I.DEMONIC_SIGIL, option: 'Chant' });
  for (const word of ['Nahudu', 'Caldar', 'Tarren', 'Agrith-Naar', 'Camerinthum']) {
    h.emit('npc-dialogue:choice', { npcId: N.DENATH, option: word });
  }
  h.advance();
  h.player.getDialogueManager().startDialogues({});

  for (let tick = 0; tick < 7; tick++) h.advance();
  assert.ok(h.cameras.some((c) => c.kind === 'move' && c.x === 2722 && c.y === 4900 && c.height === 500));
  assert.ok(h.cameras.some((c) => c.kind === 'move' && c.x === 2718 && c.y === 4900 && c.height === 900));
  assert.ok(h.shakes.some((s) => s.random === 15));
  assert.ok(h.statements.includes('<col=800000>BOOM!'));
  assert.ok(h.sceneObjects.some((o) => o.id === 10251), 'closing portal loc appears');

  for (let tick = 0; tick < 6; tick++) h.advance();
  assert.ok(h.cameras.some((c) => c.kind === 'reset'), 'first-ritual camera resets');
  h.player.getDialogueManager().reset();
  for (let tick = 0; tick < 4; tick++) h.advance();
  assert.equal(h.player.getLocation().x, 2721);
  assert.equal(h.player.getLocation().z, 0);
  assert.ok(h.spawned.some((npc) => npc.getId() === 919), 'cutscene Tanya spawns');
  assert.equal(h.spawned.filter((npc) => npc.getId() === 1989).length, 3, 'three ghosts spawn');
  assert.ok(h.cameras.some((c) => c.kind === 'move' && c.x === 2721 && c.y === 4897 && c.height === 350));

  for (let tick = 0; tick < 8; tick++) h.advance();
  assert.equal(h.quest.getStage(h.player), 100);
  const tanyaSigil = h.ground.filter((item) => item.id === I.DEMONIC_SIGIL).at(-1);
  assert.ok(tanyaSigil, 'Tanya drops a sigil');
  assert.equal(tanyaSigil.privateArea, null, 'sigil is world-owned, not scene-owned');
  assert.ok(h.removed.some((npc) => npc.getId() === 919), 'cutscene Tanya is removed');
  assert.equal(h.removed.filter((npc) => npc.getId() === 1989).length, 3, 'ghosts are removed');
  for (let tick = 0; tick < 3; tick++) h.advance();
  assert.equal(h.cameras.at(-1).kind, 'reset', 'Tanya camera resets');
});

test('Shadow of the Storm: second-ritual per-word camera/shake and Agrith-Naar spawn reset', () => {
  const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api));
  const I = h.core.ItemIdentifiers, N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 110);
  h.attrs.set('shadow-of-the-storm:summon-assembled', true);
  h.inventory.set(I.DEMONIC_SIGIL, 1);
  h.inventory.set(I.SILVERLIGHT_2, 1);
  h.setLocation(2720, 4903, 2);
  h.hooks.itemActions[0]({ player: h.player, itemId: I.DEMONIC_SIGIL, option: 'Chant' });
  assert.ok(h.cameras.some((c) => c.kind === 'move' && c.x === 2720 && c.y === 4894 && c.height === 550));
  h.player.getDialogueManager().startDialogues({});

  const words = ['Camerinthum', 'Agrith-Naar', 'Tarren', 'Caldar', 'Nahudu'];
  const heights = [600, 650, 700, 750, 800];
  for (let index = 0; index < words.length; index++) {
    h.emit('npc-dialogue:choice', { npcId: N.MATTHEW, option: words[index] });
    h.advance();
    assert.ok(h.cameras.some((c) => c.kind === 'move' && c.x === 2719 - index && c.height === heights[index]));
    assert.ok(h.shakes.some((s) => s.random === index + 1));
  }

  h.emit('npc-dialogue:action', { npcId: N.MATTHEW, stepId: 'YKZEof' });
  const demon = h.spawned.find((npc) => npc.getId() === N.AGRITH_NAAR);
  assert.ok(demon, 'Agrith-Naar spawns');
  assert.deepEqual([demon.def.x, demon.def.y, demon.def.z], [2719, 4899, 2]);
  for (let tick = 0; tick < 14; tick++) h.advance();
  assert.equal(h.cameras.at(-1).kind, 'reset', 'summoning camera resets');
});

test('Shadow of the Storm: logout closes an active cutscene and restores the camera', () => {
  const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api));
  const I = h.core.ItemIdentifiers, N = h.core.NpcIdentifiers;
  h.quest.setStage(h.player, 110);
  h.attrs.set('shadow-of-the-storm:summon-assembled', true);
  h.inventory.set(I.DEMONIC_SIGIL, 1);
  h.inventory.set(I.SILVERLIGHT_2, 1);
  h.setLocation(2720, 4903, 2);
  h.hooks.itemActions[0]({ player: h.player, itemId: I.DEMONIC_SIGIL, option: 'Chant' });
  h.emit('npc-dialogue:action', { npcId: N.MATTHEW, stepId: 'YKZEof' });
  const demon = h.spawned.find((npc) => npc.getId() === N.AGRITH_NAAR);
  h.hooks.logout[0]({ player: h.player });
  assert.ok(h.removed.includes(demon), 'demon is removed on logout');
  assert.equal(h.cameras.at(-1).kind, 'reset', 'camera resets on logout');
});

test('Shadow: real NpcDialogues Matthew Yes assembles only through the resolved branch', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');
  const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api));
  const I = h.core.ItemIdentifiers, N = h.core.NpcIdentifiers;
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/definitions/npc-dialogues.json'), 'utf8'));
  const record = data['Shadow of the Storm'];

  h.quest.setStage(h.player, 110);
  h.attrs.set('quest.shadow_of_the_storm.helpers', 15);
  h.attrs.set('shadow-of-the-storm:summon-assembled', false);
  h.inventory.set(I.DEMONIC_SIGIL, 1);
  h.player.getEquipment = () => ({ getItems: () => [{ getId: () => I.SILVERLIGHT_2 }] });
  h.setLocation(2720, 4903, 2);

  const said = [], seenConditions = [], actions = [];
  h.player.getDialogueManager = () => ({
    reset() {},
    startDialogues(chain) {
      for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
        if (entry.text) said.push(String(entry.text));
        try { entry.send(h.player); } catch {}
      }
    },
  });
  const sender = new Proxy({ sendInterfaceRemoval() {} }, { get: (t, k) => t[k] ?? (() => sender) });
  h.player.getPacketSender = () => sender;
  h.hooks.custom.get('npc-dialogue:condition').push((event) => seenConditions.push(event.stepId));
  h.hooks.custom.get('npc-dialogue:action').push((event) => actions.push(event.stepId));
  h.api.sendMultiChatboxPrompt = (player, title, ...pairs) => {
    for (let i = 0; i < pairs.length; i += 2) {
      if (pairs[i] === 'Yes.') { pairs[i + 1](); return true; }
    }
    return false;
  };

  const conditionHook = { pluginName: 'shadow-parity', handler: (event) => h.hooks.conditions[0](event) };
  const { PluginManager } = require('../dist/plugins/PluginManager');
  PluginManager.npcDialogueConditionHooks.unshift(conditionHook);
  const event = { player: h.player, npc: { getId: () => N.MATTHEW }, npcId: N.MATTHEW,
    definition: { getName: () => 'Matthew', getId: () => N.MATTHEW } };
  const runMatthew = () => startDialogue(h.api, event, record.variants['summoning-agrith-naar'], record.branches,
    { player: h.player, npc: event.npc, npcId: N.MATTHEW, definition: event.definition, pages: [] });
  try {
    runMatthew();
    assert.equal(h.attrs.get('shadow-of-the-storm:summon-assembled'), true, 'assembly flag set from the real branch');
    assert.ok(said.some((line) => /here we go/i.test(line)), 'Matthew acceptance line played');
    assert.ok(seenConditions.includes('pblmt4') || actions.includes('pblmt4'), 'the pblmt4 branch was resolved by the real builder');

    const before = h.transcripts.length;
    h.hooks.itemActions[0]({ player: h.player, itemId: I.DEMONIC_SIGIL, option: 'Chant' });
    assert.equal(h.transcripts.at(-1)?.variant, 'summoning-agrith-naar-in-position');
    assert.ok(h.transcripts.length > before);

    // Early Chant is blocked, and a cancelled/cleared assembly recovers by rerunning Matthew.
    h.attrs.set('shadow-of-the-storm:summon-assembled', false);
    const blocked = h.transcripts.length;
    h.hooks.itemActions[0]({ player: h.player, itemId: I.DEMONIC_SIGIL, option: 'Chant' });
    assert.equal(h.transcripts.length, blocked);
    assert.ok(h.messages.some((text) => /speak to Matthew/i.test(text)));
    runMatthew();
    assert.equal(h.attrs.get('shadow-of-the-storm:summon-assembled'), true);
    h.hooks.itemActions[0]({ player: h.player, itemId: I.DEMONIC_SIGIL, option: 'Chant' });
    assert.equal(h.transcripts.at(-1)?.variant, 'summoning-agrith-naar-in-position');
  } finally {
    PluginManager.npcDialogueConditionHooks.splice(PluginManager.npcDialogueConditionHooks.indexOf(conditionHook), 1);
  }
});

test('Shadow: real five-word menus use reverse for first and direct tome order for second', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { startDialogue } = require('../plugins/npcs/NpcDialogues.plugin');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/definitions/npc-dialogues.json'), 'utf8'));
  const record = data['Shadow of the Storm'];
  const BOOK_ORDER = ['Camerinthum', 'Agrith-Naar', 'Tarren', 'Caldar', 'Nahudu'];
  const SPOKEN_ORDER = ['Nahudu', 'Caldar', 'Tarren', 'Agrith-Naar', 'Camerinthum'];

  const driveRitual = (h, transcript, words, npcId, { cancelFirstEcho = false } = {}) => {
    assert.equal(transcript.select instanceof Function, true, 'plugin supplied the five-menu expansion');
    const steps = transcript.select(record.variants[transcript.variant]);
    let next = 0;
    let prompt = null;
    h.core.MultiChatboxPrompt.getPending = player => player === h.player ? prompt : null;
    h.api.sendMultiChatboxPrompt = (player, title, ...pairs) => {
      prompt = pairs;
      return true;
    };
    const manager = h.player.getDialogueManager();
    const { ActionDialogue } = require('../dist/game/model/dialogues/entries/impl/ActionDialogue');
    const cast = h.spawned.filter(npc => npc.isRegistered());
    assert.equal(cast.length, 7, 'the ritual has its seven actual quest actors');
    for (const actor of cast) {
      assert.equal(actor.getOwner(), h.player);
      assert.equal(actor.getPrivateArea(), h.player.getPrivateArea(), 'the ritual actors share the player scene');
    }
    const initialStage = h.quest.getStage(h.player);
    if (initialStage === 80) assert.ok(h.player.getNpcViewDistance() >= 20, 'the full captured first cast is in view');
    const conditionHook = { pluginName: 'ritual-parity', handler: (event) => h.hooks.conditions[0](event) };
    PluginManager.npcDialogueConditionHooks.unshift(conditionHook);
    try {
      const npc = h.spawned.find(actor => actor.getId() === npcId && actor.isRegistered());
      assert.ok(npc, 'the current ritual speaker is a real quest spawn');
      const event = { player: h.player, npc, npcId, definition: npc.getCurrentDefinition() };
      startDialogue(h.api, event, steps, record.branches,
        { player: h.player, npc: event.npc, npcId, definition: event.definition, pages: [] });
      let remaining = 200;
      while ((manager.isActive() || prompt) && remaining-- > 0) {
        if (prompt) {
          const pairs = prompt;
          prompt = null;
          const index = pairs.findIndex((value, i) => i % 2 === 0 && String(value).toLowerCase() === words[next]?.toLowerCase());
          assert.ok(index >= 0, `missing ritual word ${words[next]}`);
          next++;
          pairs[index + 1]();
        } else if (manager.getCurrent() instanceof ActionDialogue) {
          if (cancelFirstEcho && next === 1 && h.overheads.length === 8) {
            const spoken = [...h.overheads];
            manager.reset();
            for (let i = 0; i < 4; i++) h.advance();
            assert.deepEqual(h.overheads, spoken, 'cancelling the timed chorus cannot speak or open the next word');
            assert.equal(next, 1);
            assert.equal(h.quest.getStage(h.player), initialStage, 'an interrupted ritual cannot advance the quest');
            assert.equal(h.player.getNpcViewDistance(), 15, 'the interrupted ritual restores normal NPC range');
            return;
          }
          h.advance(); // automatic overhead owns the next two game ticks
        } else {
          manager.advance();
        }
      }
      assert.ok(remaining > 0, 'the ritual dialogue finishes without skipping timed actions');
    } finally {
      PluginManager.npcDialogueConditionHooks.splice(PluginManager.npcDialogueConditionHooks.indexOf(conditionHook), 1);
    }
    assert.equal(cancelFirstEcho, false, 'the requested first-echo cancellation must be reached');
    assert.equal(next, 5, 'all five menus were answered');
    const echoes = h.overheads.filter(({ text }) => words.some(word => text === `${word}...` || text === `${word}!`));
    assert.equal(echoes.length, 35, 'all seven ritual actors speak each of the five echoes');
    for (const actor of cast) assert.equal(echoes.filter(echo => echo.actor === actor).length, 5);
    assert.equal(h.overheads.some(({ text }) => text.includes('[Word ')), false, 'every spoken word placeholder is filled');
  };

  const prepare = (stage) => {
    const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api), { realDialogue: true });
    h.quest.setStage(h.player, stage);
    h.attrs.set('quest.shadow_of_the_storm.incantation', 4371);
    h.attrs.set('quest.shadow_of_the_storm.helpers', 15);
    h.attrs.set('shadow-of-the-storm:summon-assembled', true);
    h.inventory.set(h.core.ItemIdentifiers.DEMONIC_SIGIL, 1);
    h.player.getEquipment = () => ({ getItems: () => [{ getId: () => h.core.ItemIdentifiers.SILVERLIGHT_2 }] });
    h.setLocation(2720, 4903, 2);
    for (const login of h.hooks.login) login({ player: h.player });
    assert.deepEqual([1373, 1374, 1375, 1376, 1377].map((id) => h.varbits.get(id)), [3, 2, 4, 0, 1]);
    return h;
  };

  const first = prepare(80);
  first.hooks.itemActions[0]({ player: first.player, itemId: first.core.ItemIdentifiers.DEMONIC_SIGIL, option: 'Chant' });
  driveRitual(first, first.transcripts.at(-1), SPOKEN_ORDER, first.core.NpcIdentifiers.DENATH);
  for (let i = 0; i < 3; i++) first.advance();
  assert.equal(first.quest.getStage(first.player), 90, 'first ritual is Denath order reversed');
  assert.equal(first.player.getNpcViewDistance(), 15, 'the resolved ritual restores normal NPC range');

  const firstWrong = prepare(80);
  firstWrong.hooks.itemActions[0]({ player: firstWrong.player, itemId: firstWrong.core.ItemIdentifiers.DEMONIC_SIGIL, option: 'Chant' });
  driveRitual(firstWrong, firstWrong.transcripts.at(-1), BOOK_ORDER, firstWrong.core.NpcIdentifiers.DENATH);
  for (let i = 0; i < 3; i++) firstWrong.advance();
  assert.equal(firstWrong.quest.getStage(firstWrong.player), 80, 'direct tome order fails the first ritual');
  assert.equal(firstWrong.player.getNpcViewDistance(), 15);

  const second = prepare(110);
  second.hooks.itemActions[0]({ player: second.player, itemId: second.core.ItemIdentifiers.DEMONIC_SIGIL, option: 'Chant' });
  driveRitual(second, second.transcripts.at(-1), BOOK_ORDER, second.core.NpcIdentifiers.MATTHEW);
  for (let i = 0; i < 3; i++) second.advance();
  assert.equal(second.quest.getStage(second.player), 120, 'second ritual uses direct tome order');
  assert.equal(second.player.getNpcViewDistance(), 15);

  const secondWrong = prepare(110);
  secondWrong.hooks.itemActions[0]({ player: secondWrong.player, itemId: secondWrong.core.ItemIdentifiers.DEMONIC_SIGIL, option: 'Chant' });
  driveRitual(secondWrong, secondWrong.transcripts.at(-1), SPOKEN_ORDER, secondWrong.core.NpcIdentifiers.MATTHEW);
  for (let i = 0; i < 3; i++) secondWrong.advance();
  assert.equal(secondWrong.quest.getStage(secondWrong.player), 110, 'reversed order fails the second ritual');
  assert.equal(secondWrong.player.getNpcViewDistance(), 15);

  const cancelled = prepare(80);
  cancelled.hooks.itemActions[0]({ player: cancelled.player, itemId: cancelled.core.ItemIdentifiers.DEMONIC_SIGIL, option: 'Chant' });
  driveRitual(cancelled, cancelled.transcripts.at(-1), SPOKEN_ORDER, cancelled.core.NpcIdentifiers.DENATH, { cancelFirstEcho: true });

  const loggedOut = prepare(80);
  loggedOut.hooks.itemActions[0]({ player: loggedOut.player, itemId: loggedOut.core.ItemIdentifiers.DEMONIC_SIGIL, option: 'Chant' });
  assert.ok(loggedOut.player.getNpcViewDistance() >= 20);
  for (const logout of loggedOut.hooks.logout) logout({ player: loggedOut.player });
  assert.equal(loggedOut.player.getNpcViewDistance(), 15, 'logout restores normal NPC range');
});

test('Shadow: server completion 130 mirrors the native 7-bit varbit as 125 on login', () => {
  const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api));
  const quest = h.quest;
  assert.equal(quest.completionValue, 130, 'legacy server completion stage is preserved');
  assert.equal(quest.varbitValue(124, h.player), 124);
  assert.equal(quest.varbitValue(130, h.player), 125, 'capture 3333 finished agrith_quest value');
  for (const stage of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 124, 130]) {
    assert.ok(quest.varbitValue(stage, h.player) <= 127, `stage ${stage} fits the 7-bit varbit`);
  }

  h.quest.setStage(h.player, 130);
  assert.equal(h.quest.getStage(h.player), 130, 'server stage remains 130');
  assert.equal(h.varbits.get(1372), 125, 'setStage mirrors the native finished value');

  h.varbits.clear();
  // Same production function the login hook runs (registerQuestWidgets is
  // registered once per process, so later test setups do not own that hook).
  runtime.sendQuestVarps({ player: h.player });
  assert.equal(h.varbits.get(1372), 125, 'login replays 125, not wrapped 0');
  assert.equal(h.quest.getStage(h.player), 130);
});

test('The Golem: the curator is released after quest completion', () => {
  const h = setup((api) => require('../plugins/quests/quests/TheGolem.Quest')(api));
  const curator = h.core.NpcIdentifiers.CURATOR_HAIG_HALEN;
  h.quest.setStage(h.player, 3);
  assert.ok(h.hooks.variants[0]({ player: h.player, npcId: curator, npc: { getId: () => curator } }));
  h.quest.setStage(h.player, 10);
  assert.equal(h.hooks.variants[0]({ player: h.player, npcId: curator, npc: { getId: () => curator } }), null);
});

test('Shadow: real PrivateArea destruction removes scene items but keeps the world-owned sigil', async () => {
  const path = require('node:path');
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.join(__dirname, '..'));
  const { PrivateArea } = require('../dist/game/model/areas/impl/PrivateArea');
  const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
  const { ItemOnGround, State } = require('../dist/game/entity/impl/grounditem/ItemOnGround');
  const { Item } = require('../dist/game/model/Item');
  const { Location } = require('../dist/game/model/Location');
  class SceneArea extends PrivateArea { constructor() { super([]); } }
  const area = new SceneArea();
  const sceneSigil = new ItemOnGround(State.SEEN_BY_EVERYONE, 'shadow-audit', new Location(3100, 3100, 0), new Item(6748, 1), false, -1, area);
  const worldSigil = new ItemOnGround(State.SEEN_BY_EVERYONE, 'shadow-audit', new Location(3100, 3101, 0), new Item(6748, 1), false, -1, null);
  ItemOnGroundManager.register(sceneSigil);
  ItemOnGroundManager.register(worldSigil);
  assert.ok(ItemOnGroundManager.getGroundItem('shadow-audit', 6748, new Location(3100, 3100, 0), area));
  area.destroy();
  assert.equal(ItemOnGroundManager.getGroundItem('shadow-audit', 6748, new Location(3100, 3100, 0), null), null, 'scene-owned item is cleaned up');
  assert.ok(ItemOnGroundManager.getGroundItem('shadow-audit', 6748, new Location(3100, 3101, 0), null), 'world-owned item survives');
  ItemOnGroundManager.deregister(worldSigil);
});

test('Shadow of the Storm: black mushroom ink dyes desert clothing and every Silverlight carried', () => {
  const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api));
  const I = h.core.ItemIdentifiers;
  h.inventory.set(I.BLACK_DYE, 2);
  h.inventory.set(I.DESERT_SHIRT, 1);
  h.inventory.set(I.DESERT_ROBE, 1);
  h.hooks.itemOnItem[0]({ player: h.player, usedItemId: I.BLACK_DYE, usedWithItemId: I.DESERT_SHIRT });
  h.hooks.itemOnItem[0]({ player: h.player, usedItemId: I.DESERT_ROBE, usedWithItemId: I.BLACK_DYE });
  assert.equal(h.inventory.get(I.BLACK_DESERT_SHIRT), 1);
  assert.equal(h.inventory.get(I.BLACK_DESERT_ROBE), 1);
  assert.equal(h.inventory.get(I.DESERT_SHIRT), 0);
  assert.equal(h.inventory.get(I.DESERT_ROBE), 0);
  assert.equal(h.inventory.get(I.BLACK_DYE), 0, 'each dye uses one ink');
  assert.deepEqual(h.messages.slice(-2), ['You dye the desert shirt black.', 'You dye the desert robe black.']);

  // Wiki: dyeing takes every Silverlight carried and leaves a single dyed sword.
  h.quest.setStage(h.player, 30);
  h.inventory.set(I.SILVERLIGHT, 2);
  h.inventory.set(I.BLACK_MUSHROOM, 1);
  h.hooks.itemOnItem[0]({ player: h.player, usedItemId: I.BLACK_MUSHROOM, usedWithItemId: I.SILVERLIGHT });
  assert.equal(h.inventory.get(I.SILVERLIGHT), 0);
  assert.equal(h.inventory.get(I.SILVERLIGHT_2), 1);
});

test('Shadow of the Storm: Reen only replaces Silverlight the player owns in no form', () => {
  const h = setup((api) => require('../plugins/quests/quests/ShadowOfTheStorm.Quest')(api));
  const I = h.core.ItemIdentifiers;
  const banked = new Map();
  h.player.getBanks = () => [{ getAmount: (id) => banked.get(id) ?? 0 }];
  h.quest.setStage(h.player, 30);
  for (const form of [I.SILVERLIGHT, I.SILVERLIGHT_2, I.DARKLIGHT]) {
    banked.clear();
    banked.set(form, 1);
    h.emit('npc-dialogue:action', { npcId: h.core.NpcIdentifiers.FATHER_REEN, stepId: 'Kh2EP0' });
    assert.equal(h.inventory.get(I.SILVERLIGHT) ?? 0, 0, `a banked ${form} is not replaced`);
    assert.equal(h.hooks.conditions[0]({ player: h.player, stepId: 'fllvV0' }), false, 'a banked sword is not lost');
  }
  banked.clear();
  assert.equal(h.hooks.conditions[0]({ player: h.player, stepId: 'fllvV0' }), true);
  h.emit('npc-dialogue:action', { npcId: h.core.NpcIdentifiers.FATHER_REEN, stepId: 'Kh2EP0' });
  assert.equal(h.inventory.get(I.SILVERLIGHT), 1, 'a lost sword is handed back');
});
