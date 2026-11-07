const test = require("node:test");
const assert = require("node:assert/strict");

const register = require("../plugins/quests/dt2/Prison.DesertTreasureII");
require("../plugins/quests/QuestRuntime").startTranscript = () => true;

function setup() {
  const handlers = { custom: {}, npc: [], object: null, itemObject: null, item: [], dialogueAction: null };
  const emitted = [];
  const messages = [];
  const graphics = [];
  const varbits = new Map();
  const freezes = [];
  const pendingDamage = [];
  let stashRestored = false;
  const prompts = [];
  const createdNpcs = [];
  const openedObjects = [];
  let cycle = 100;
  const npc = (id, location) => ({
    id, location, maxHitpoints: 1500, hitpoints: 1500,
    getId() { return this.id; },
    moveTo(value) { this.location = value; },
    getLocation() { return { getX: () => this.location.x, getY: () => this.location.y }; },
    isRegistered: () => true,
    setOwner(value) { this.owner = value; }, setOwnerOnly(value) { this.ownerOnly = value; }, getCombat() { return { attack: (target) => { this.target = target; this.attacks = (this.attacks ?? 0) + 1; } }; },
    setScriptedMovement(value) { this.scriptedMovement = value; },
    setHitpointsLocked(value) { this.hitpointsLocked = value; },
    setMaxHitpoints(value) { this.maxHitpoints = value; return this; },
    setHitpoints(value) { this.hitpoints = value; return this; },
    getHitpoints() { return this.hitpoints; },
  });
  const area = {
    entities: [],
    templateObjects: [],
    tile: (x, y, z) => ({ x: 10000 + x, y: 20000 + y, z }),
    getBaseX: () => 10000,
    getBaseY: () => 20000,
    getObjects() { return []; },
    getTemplateObjects() { return this.templateObjects; },
    contains() { return true; },
    add(value) { this.entities.push(value); },
    remove(value) { this.entities = this.entities.filter((entry) => entry !== value); },
  };
  const inventory = {
    contents: new Map(),
    getAmount(id) { return this.contents.get(id) ?? 0; },
    adds(id, amount) { this.contents.set(id, this.getAmount(id) + amount); return this; },
    deleteNumber(id, amount) { this.contents.set(id, Math.max(0, this.getAmount(id) - amount)); return true; },
  };
  const player = {
    attrs: new Map([["desert-treasure-ii:sucellus-cell-escaped", true]]),
    location: { x: 10000, y: 20000, z: 2 },
    getAttribute(key) { return this.attrs.get(key); },
    setAttribute(key, value) { this.attrs.set(key, value); },
    getInventory: () => inventory,
    getPrivateArea() { return this.area; },
    setArea(value) { this.area = value; },
    moveTo(value) { this.location = value; },
    getLocation() { return { getX: () => this.location.x, getY: () => this.location.y, getZ: () => this.location.z }; },
    getCombat() { return { getHitQueue: () => ({ addPendingDamage(hits) { pendingDamage.push(...hits); } }) }; },
    getPacketSender() { return { sendGraphic: (graphic, location) => graphics.push({ graphic, location }), sendVarbit: (id, value) => varbits.set(id, value) }; },
    getPrayerActive() { return []; },
    getSkillManager() { return { getMaxLevel: () => 99 }; },
    setHitpoints(value) { this.hitpoints = value; },
    getDialogueManager: () => ({ isActive: () => false }),
    sendMessage(message) { messages.push(message); },
  };
  player.area = area;
  const api = {
    core: {
      Skill: { HITPOINTS: 3 },
      ItemIdentifiers: { PRISONERS_LETTER: 28412, KNIFE_5: 28413, CHISEL_5: 28414, LOCKPICK_4: 28415,
        SAPPHIRE_KEY_3: 28416, EMERALD_KEY_3: 28417, RUBY_KEY_3: 28418, DIAMOND_KEY: 28419, WARNING_LETTER: 28429,
        REQUISITION_NOTE: 28423, GRID_NOTE: 28424, CODE_CONVERTER: 28425, MAGIC_LANTERN: 28426, STRANGE_SLIDER: 28427, LIBRARY_NOTE: 28428, RATIONS: 28422 },
      NpcIdentifiers: { ASSASSIN_7: 12348, ASSASSIN_8: 12349, JHALLAN_3: 12353, JHALLAN_4: 12354, JHALLAN_5: 12355 },
      ObjectDefinition: { forPlayer: (id) => ({ id }) },
      NPC: { create(id, location) { const value = npc(id, location); createdNpcs.push(value); return value; } },
      World: { getAddNPCQueue: () => [], getRemoveNPCQueue: () => [], getProcessCycle: () => cycle },
      ObjectManager: { deregister(object) { object.removed = true; openedObjects.push(object); } },
      Location: class Location {
        constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
        getX() { return this.x; }
        getY() { return this.y; }
        getZ() { return this.z; }
      },
      Graphic: class Graphic { constructor(id) { this.id = id; } },
      RegionManager: { blocked: () => false },
      CombatFactory: { freeze: (target, seconds, message) => freezes.push({ target, seconds, message }) },
      HitDamage: class HitDamage { constructor(amount, mask) { this.amount = amount; this.mask = mask; } },
      HitMask: { RED: 1 },
    },
    persistAttribute() {},
    onCustomEvent(name, handler) {
      if (/^[^:\s]+:[^:\s]+$/.test(name)) handlers.custom[name] = handler;
    },
    emitCustomEvent(name, payload) {
      if (/^[^:\s]+:[^:\s]+$/.test(name)) {
        emitted.push({ name, payload });
        if (name === "dt2:sucellus-prison-return-stash") payload.restored = stashRestored;
      }
    },
    onNpcInteraction(...args) { handlers.npc.push(args); },
    onPlayerBeforeDeath(handler) { handlers.beforeDeath = handler; },
    onObjectInteraction(handler) { handlers.object = handler; },
    onItemOnObject(handler) { handlers.itemObject = handler; },
    onItemAction(...args) { handlers.item.push(args); },
    sendMultiChatboxPrompt(_player, title, ...pairs) { prompts.push({ title, pairs }); return true; },
  };
  player.setAttribute("desert-treasure-ii:sucellus-area", area);
  register(api);
  const instanceLocation = (x, y, z) => ({ x: x + 10000 - 2872, y: y + 20000 - 6336, z });
  const moveToSource = (x, y, z = 2) => { player.location = { x: x + 10000 - 2872, y: y + 20000 - 6336, z }; };
  return { api, handlers, emitted, messages, prompts, graphics, varbits, freezes, pendingDamage, player, area, inventory, createdNpcs, openedObjects, instanceLocation, moveToSource, setCycle: (v) => { cycle = v; }, setStashRestored: (value) => { stashRestored = value; } };
}

test("prison start removes the cutscene Assassin until the diamond-key stage", () => {
  const { handlers, player, area, createdNpcs } = setup();
  const existing = {
    id: 12348,
    location: area.tile(48, 39, 2),
    getId() { return this.id; },
    getLocation() { return { getX: () => this.location.x, getY: () => this.location.y }; },
    isRegistered: () => true,
  };
  area.entities.push(existing);

  assert.equal(handlers.custom["dt2:sucellus-prison-start"]({ player, area }), true);
  assert.equal(createdNpcs.length, 0, "module start must not create a duplicate cutscene NPC");
  assert.equal(area.entities.filter((value) => value.getId?.() === 12348).length, 0,
    "the transcript disappearance action leaves the prison clear");
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-assassin") ?? null, null);
});

function enterAnswer(prompts, answer) {
  for (const character of answer) {
    let prompt = prompts.at(-1);
    let index = prompt.pairs.findIndex((value, i) => i % 2 === 0 && value === character);
    for (let page = 0; index < 0 && page < 8; page++) {
      const more = prompt.pairs.findIndex((value, i) => i % 2 === 0 && value === "More options");
      assert.notEqual(more, -1);
      prompt.pairs[more + 1]();
      prompt = prompts.at(-1);
      index = prompt.pairs.findIndex((value, i) => i % 2 === 0 && value === character);
    }
    assert.notEqual(index, -1, `lock prompt provides ${character}`);
    prompt.pairs[index + 1]();
  }
}

function enterPadlock(prompts, heights) {
  for (const height of heights) {
    let prompt = prompts.at(-1);
    let index = prompt.pairs.findIndex((value, i) => i % 2 === 0 && value === `Set to ${height + 1}`);
    if (index < 0) {
      const more = prompt.pairs.findIndex((value, i) => i % 2 === 0 && value === "More options");
      assert.notEqual(more, -1, `padlock prompt must page to height ${height + 1}`);
      prompt.pairs[more + 1]();
      prompt = prompts.at(-1);
      index = prompt.pairs.findIndex((value, i) => i % 2 === 0 && value === `Set to ${height + 1}`);
    }
    assert.notEqual(index, -1, `padlock prompt provides height ${height + 1}`);
    prompt.pairs[index + 1]();
  }
}

test("prison lifecycle hooks use PluginManager's valid single-colon custom event names", () => {
  const { api, handlers, emitted } = setup();
  assert.deepEqual(Object.keys(handlers.custom).sort(), [
    "dt2:sucellus-prison-journal",
    "dt2:sucellus-prison-process",
    "dt2:sucellus-prison-resume",
    "dt2:sucellus-prison-start",
    "food:area",
    "ladders:climb",
    "npc-dialogue:action",
    "npc-dialogue:line",
  ]);
  api.onCustomEvent("dt2:sucellus-prison:process", () => assert.fail("invalid event names must not register"));
  api.emitCustomEvent("dt2:sucellus-prison:complete", {});
  assert.equal(handlers.custom["dt2:sucellus-prison:process"], undefined);
  assert.deepEqual(emitted, [], "invalid event names are ignored like PluginManager does");
});

test("Sucellus prison gates require the lockpick and sapphire key is earned through each tumbler", () => {
  const { handlers, emitted, prompts, player, area, inventory, instanceLocation, openedObjects } = setup();
  const state = () => player.getAttribute("desert-treasure-ii:sucellus-prison-progress");
  handlers.custom["dt2:sucellus-prison-start"]({ player, area });
  assert.equal(state(), 22);

  const padlock = {
    getPrivateArea: () => area, getId: () => 49120,
    getLocation: () => ({ equals: () => true }),
  };
  area.templateObjects = [padlock];
  handlers.object({ player, object: padlock, objectId: 49120, option: "Open", location: instanceLocation(2945, 6389, 2), handled: false });
  assert.equal(state(), 22, "a missing lockpick cannot open the gate");
  inventory.adds(28415, 1);
  handlers.object({ player, object: padlock, objectId: 49120, option: "Open", location: instanceLocation(2945, 6389, 2), handled: false });
  assert.equal(state(), 22, "the six tumblers must be solved before the gate opens");
  enterPadlock(prompts, [2, 0, 5, 1, 4, 3]);
  assert.equal(state(), 24);
  assert.deepEqual(openedObjects, [padlock], "opening the gate removes the blocking private-instance object");
  const solvedLockPromptCount = prompts.length;
  const solvedPadlockOpen = handlers.object({ player, object: padlock, objectId: 49120, option: "Open", location: instanceLocation(2945, 6389, 2), handled: false });
  assert.equal(solvedPadlockOpen, true, "a solved padlock opens directly after relog");
  assert.equal(prompts.length, solvedLockPromptCount, "the solved lock does not ask for the six tumblers again");

  handlers.object({ player, objectId: 50001, option: "Search", location: instanceLocation(2974, 6347, 2), definition: { name: "Altar" }, handled: false });
  handlers.item.find(([name]) => name === "Warning letter")[1].Read({ player, itemId: 28429, handled: false });
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-clues-read"), 1);

  handlers.object({ player, objectId: 50000, option: "Open", location: instanceLocation(2980, 6346, 2), handled: false });
  assert.match(prompts.at(-1).title, /Choose tumbler 1/, "the six lock tumblers are followed by the sapphire code prompt");
  for (const digit of "214013") {
    let prompt = prompts.at(-1);
    let index = prompt.pairs.findIndex((value, i) => i % 2 === 0 && value === digit);
    for (let page = 0; index < 0 && page < 3; page++) {
      prompt.pairs.at(-1)();
      prompt = prompts.at(-1);
      index = prompt.pairs.findIndex((value, i) => i % 2 === 0 && value === digit);
    }
    assert.notEqual(index, -1, `prompt must offer digit ${digit}`);
    prompt.pairs[index + 1]();
  }
  assert.equal(inventory.getAmount(28416), 1);
  assert.equal(state(), 26);
  assert.ok(emitted.some(({ name }) => name === "dt2:sucellus-prison-journal"));
});

test("a full inventory keeps the sapphire lock shut rather than losing its key", () => {
  const { handlers, prompts, player, area, inventory, instanceLocation } = setup();
  const state = () => player.getAttribute("desert-treasure-ii:sucellus-prison-progress");
  handlers.custom["dt2:sucellus-prison-start"]({ player, area });
  const padlock = { getPrivateArea: () => area, getId: () => 49120, getLocation: () => ({ equals: () => true }) };
  area.templateObjects = [padlock];
  inventory.adds(28415, 1);
  handlers.object({ player, object: padlock, objectId: 49120, option: "Open", location: instanceLocation(2945, 6389, 2), handled: false });
  enterPadlock(prompts, [2, 0, 5, 1, 4, 3]);
  handlers.object({ player, objectId: 50001, option: "Search", location: instanceLocation(2974, 6347, 2), definition: { name: "Altar" }, handled: false });
  handlers.item.find(([name]) => name === "Warning letter")[1].Read({ player, itemId: 28429, handled: false });
  // `adds` never reports failure; the lock must check for room before it opens.
  inventory.getFreeSlots = () => 0;
  handlers.object({ player, objectId: 50000, option: "Open", location: instanceLocation(2980, 6346, 2), handled: false });
  for (const digit of "214013") {
    let prompt = prompts.at(-1);
    let index = prompt.pairs.findIndex((value, i) => i % 2 === 0 && value === digit);
    for (let page = 0; index < 0 && page < 3; page++) {
      prompt.pairs.at(-1)();
      prompt = prompts.at(-1);
      index = prompt.pairs.findIndex((value, i) => i % 2 === 0 && value === digit);
    }
    prompt.pairs[index + 1]();
  }
  assert.equal(inventory.getAmount(28416), 0, "no key added to a full inventory");
  assert.equal(state(), 24, "the lock stays shut, so it can be opened again with room");
});

test("Jhallan defense lasts three minutes (300 area ticks) and asylum transcript owns completion", () => {
  const { handlers, emitted, prompts, player, area, createdNpcs, setCycle, instanceLocation } = setup();
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 52);
  handlers.custom["dt2:sucellus-prison-start"]({ player, area });
  handlers.object({ player, objectId: 50000, option: "Search", location: instanceLocation(2972, 6367, 2), handled: false });
  prompts[0].pairs[1]();
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 54);
  const liveJhallan = createdNpcs.find((value) => value.id === 12353);
  assert.ok(liveJhallan, "the cache-backed combat variant must attack the player");
  assert.equal(liveJhallan.hitpointsLocked, true, "players cannot shorten the scripted three-minute survival encounter by killing Jhallan");
  assert.equal(liveJhallan.scriptedMovement, false, "Jhallan uses ordinary NPC combat while the area only owns encounter timing");
  assert.equal(liveJhallan.target, undefined, "the scripted introduction must finish before combat starts");

  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 100 });
  assert.equal(liveJhallan.target, player, "Jhallan must use the normal NPC combat path after the introduction");
  assert.equal(liveJhallan.attacks, 1);

  setCycle(250);
  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 250 });
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 54);
  assert.deepEqual(createdNpcs.filter((value) => value.id === 12354).map((value) => [value.id, value.hitpoints]), [[12354, 1], [12354, 1]]);
  assert.ok(createdNpcs.filter((value) => value.id === 12354).every((value) => value.target === player && value.scriptedMovement === false),
    "both one-hit copies actively use ordinary combat against their owner");

  setCycle(399);
  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 399 });
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 54);
  assert.equal(emitted.filter(({ name }) => name === "dt2:sucellus-prison-complete").length, 0);

  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 400 });
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 56);
  handlers.custom["npc-dialogue:action"]({ player, npcId: 12348, stepId: "IME-83" });
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 58);
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-complete"), true);
  assert.equal(emitted.filter(({ name }) => name === "dt2:sucellus-prison-complete").length, 1);
});

test("Jhallan pursues through prison corridors, leaves the safe rooms clear, and stops before the refugee defense", () => {
  const { handlers, player, area, createdNpcs, moveToSource } = setup();
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 30);

  moveToSource(2902, 6445); // inside the north-west chest room
  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 100 });
  assert.equal(createdNpcs.filter((value) => value.id === 12353).length, 0,
    "Jhallan does not enter the room where the Emerald key was found");

  moveToSource(2912, 6423); // corridor along the west wall, north of the chest room
  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 101 });
  let pursuer = player.getAttribute("desert-treasure-ii:sucellus-prison-jhallan-pursuer");
  assert.equal(pursuer.id, 12353, "the attacking cache variant is used, not the conversation-only 12355");
  assert.equal(pursuer.maxHitpoints, 1500, "the Wiki combat profile is retained");
  assert.equal(pursuer.owner, player);
  assert.equal(pursuer.ownerOnly, true, "the pursuer belongs only to this prison instance's player");
  assert.equal(pursuer.scriptedMovement, false, "ordinary NPC pathing and magic combat remain active");
  assert.equal(pursuer.target, player, "Jhallan actively follows and attacks the player");

  moveToSource(2968, 6417); // inside the seven-bed room
  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 102 });
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-jhallan-pursuer"), null);
  assert.equal(area.entities.includes(pursuer), false, "entering a room breaks the pursuit");

  moveToSource(2978, 6427); // back into the corridor, after the beds room
  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 103 });
  pursuer = player.getAttribute("desert-treasure-ii:sucellus-prison-jhallan-pursuer");
  assert.equal(pursuer.id, 12353, "leaving the safe room lets Jhallan reappear");
  pursuer.hitpoints = 0;
  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 104 });
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-jhallan-pursuer"), null);
  assert.equal(createdNpcs.filter((value) => value.id === 12353).length, 2,
    "defeating the pursuer does not respawn him in the same corridor every tick");
  moveToSource(2902, 6445);
  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 105 });
  moveToSource(2920, 6445);
  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 106 });
  pursuer = player.getAttribute("desert-treasure-ii:sucellus-prison-jhallan-pursuer");
  assert.equal(createdNpcs.filter((value) => value.id === 12353).length, 3,
    "leaving the safe room lets the pursuit restart");
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 52);
  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 107 });
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-jhallan-pursuer"), null,
    "the corridor pursuit ends before the firecracker survival encounter");
  assert.equal(area.entities.includes(pursuer), false);
});

test("Jhallan loses sight of the player inside enclosed prison rooms, including the crevice and library", () => {
  const rooms = [
    [2902, 6445], // Emerald chest room
    [2968, 6417], // seven-bed room
    [2890, 6375], // western cells / Diamond chest room
    [2972, 6367], // refugee camp
    [2959, 6428], // blocked-crevice room
    [2968, 6428], // room beyond the crevice
    [2931, 6430], // library
    [2918, 6427], // records office and its ration crate
  ];
  const corridors = [
    [2912, 6423], // west corridor north of the Emerald room
    [2978, 6427], // corridor east of the seven-bed room
    [2920, 6375], // western passage outside the Diamond room
    [2972, 6358], // south passage outside the refugee camp
  ];

  for (const [x, y] of rooms) {
    const { handlers, player, area, createdNpcs, moveToSource } = setup();
    player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 30);
    moveToSource(x, y);
    handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 100 });
    assert.equal(createdNpcs.filter((npc) => npc.id === 12353).length, 0,
      `Jhallan should teleport away inside the room at ${x},${y}`);
  }

  for (const [x, y] of corridors) {
    const { handlers, player, area, createdNpcs, moveToSource } = setup();
    player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 30);
    moveToSource(x, y);
    handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 100 });
    assert.equal(createdNpcs.filter((npc) => npc.id === 12353).length, 1,
      `Jhallan should pursue through the corridor at ${x},${y}`);
  }
});

test("Jhallan's shadow attack teleports and freezes briefly, then a marked tile can be dodged", () => {
  const { handlers, prompts, player, area, graphics, freezes, pendingDamage, messages } = setup();
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 52);
  handlers.custom["dt2:sucellus-prison-start"]({ player, area });
  handlers.object({ player, objectId: 50000, option: "Search", location: { x: 10000 + 2972 - 2872, y: 20000 + 6367 - 6336, z: 2 }, handled: false });
  prompts[0].pairs[1]();

  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 100 });
  const before = { ...player.location };
  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 135 });
  assert.notDeepEqual(player.location, before, "the magical assault relocates the player beside Jhallan");
  assert.deepEqual(freezes.map(({ seconds }) => seconds), [1.2], "the relocation briefly freezes movement");
  assert.equal(graphics.at(-1).graphic.id, 1447, "the convergence tile receives a visible warning graphic");
  assert.ok(messages.includes("Shadows converge on your position. Move away!"));

  player.moveTo(area.tile(80, 80, 2));
  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 139 });
  assert.equal(pendingDamage.length, 0, "leaving the marked tile avoids the shadow impact");

  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 180 });
  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 184 });
  assert.equal(pendingDamage.length, 1, "remaining on the marked tile takes a real hit");
  assert.ok(pendingDamage[0].amount >= 12 && pendingDamage[0].amount <= 24);
});

test("earned frozen-Jhallan progress restores the Assassin after relog without replaying the defence", () => {
  const { handlers, player, area, createdNpcs } = setup();
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 56);
  player.setAttribute("desert-treasure-ii:sucellus-prison-fireworks", true);
  assert.equal(handlers.custom["dt2:sucellus-prison-resume"]({ player, area }), true);
  assert.ok(createdNpcs.some((value) => value.id === 12348), "the Assassin is recreated at the saved frozen-Jhallan stage");
  const assassin = createdNpcs.find(value => value.id === 12348);
  assert.deepEqual(assassin.location, area.tile(2978 - 2872, 6371 - 6336, 2), 'relog restores the camp speaker beside the frozen Jhallan');
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 56);
  assert.equal(handlers.custom["dt2:sucellus-prison-resume"]({ player, area: { ...area } }), false, "resume ignores a different instance");
});

test("paired prison crevices land on adjacent clear tiles, and asylum stairs exit to the Duke", () => {
  const { handlers, emitted, player, area, instanceLocation } = setup();
  const state = () => player.getAttribute("desert-treasure-ii:sucellus-prison-progress");
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 38);
  player.setAttribute("desert-treasure-ii:sucellus-area", area);

  const exit = { player, objectId: 49108, option: "Enter", location: instanceLocation(2983, 6399, 2), handled: false };
  assert.equal(handlers.object(exit), true);
  assert.equal(exit.handled, true);
  assert.deepEqual(player.location, { x: 10000 + 27, y: 20000 + 25, z: 2 },
    "the real crevice action lands on clear floor beside the paired 1x3 cache object");
  assert.equal(state(), 38, "using a shortcut cannot grant the diamond key or advance progress");
  assert.equal(player.getPrivateArea(), area);
  const reverse = { player, objectId: 49107, option: "Enter", location: instanceLocation(2898, 6360, 2), handled: false };
  assert.equal(handlers.object(reverse), true);
  assert.deepEqual(player.location, { x: 10000 + 112, y: 20000 + 64, z: 2 },
    "returning through the paired crevice lands beside the 1x3 cache footprint");

  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 56);
  const neighbor = { player, objectId: 49100, option: "Climb", location: instanceLocation(2973, 6439, 2), handled: false };
  assert.notEqual(handlers.object(neighbor), true, "adjacent tiles do not impersonate the cache loc anchor");

  const blocked = { player, objectId: 49100, option: "Climb", location: instanceLocation(2973, 6440, 2), handled: false };
  assert.equal(handlers.object(blocked), true);
  assert.equal(player.location.z, 2, "the asylum stays closed before the Assassin's final dialogue");

  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 58);
  player.setAttribute("desert-treasure-ii:sucellus-prison-complete", true);
  const asylum = { player, objectId: 49100, object: { getId: () => 49100, getLocation: () => instanceLocation(2973, 6440, 2) }, handled: false };
  const beforeClimb = { ...player.location };
  assert.equal(handlers.custom["ladders:climb"](asylum), true);
  assert.equal(asylum.handled, true);
  const transfer = emitted.find(({ name }) => name === "ladders:climbDown");
  assert.deepEqual([transfer.payload.destination.x, transfer.payload.destination.y, transfer.payload.destination.z], [10167, 20095, 0],
    "the landing is translated into the owner's copied Duke chamber");
  assert.deepEqual([player.location.x, player.location.y, player.location.z], [beforeClimb.x, beforeClimb.y, 2],
    "the canonical Ladders plugin performs the animated transfer after the quest claims its exact anchor");
  assert.equal(player.getPrivateArea(), area, "the Duke chamber is reached inside the same private instance");
});

test("the Assassin stays gone after the cell escape and returns only for the diamond-key plan", () => {
  const { handlers, player, area, createdNpcs } = setup();
  assert.equal(handlers.custom["dt2:sucellus-prison-start"]({ player, area }), true);
  assert.equal(createdNpcs.length, 0, "the transcript disappearance action leaves the cell area clear");
  assert.equal(handlers.custom["dt2:sucellus-prison-resume"]({ player, area }), true);
  assert.equal(createdNpcs.length, 0, "relogging at stage22 must not restore the disappeared Assassin");
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 40);
  assert.equal(handlers.custom["dt2:sucellus-prison-resume"]({ player, area }), true);
  assert.equal(createdNpcs.filter((value) => value.id === 12348).length, 1, "the diamond-key stage restores the Assassin");
});

test("private-instance gate coordinates normalize to cache tiles and preserve the earned key", () => {
  const { handlers, player, area, inventory, openedObjects, instanceLocation } = setup();
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 26);
  inventory.adds(28416, 1);
  const gate = {
    getPrivateArea: () => area,
    getId: () => 49122,
    getLocation: () => ({ equals: () => true }),
  };
  const event = { player, object: gate, definition: { id: 49122 }, option: "Open", location: instanceLocation(2912, 6418, 2), handled: false };
  handlers.object(event);
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 28);
  assert.equal(inventory.getAmount(28416), 1);
  assert.deepEqual(openedObjects, [gate]);

  const secondSapphireGate = { getPrivateArea: () => area, getId: () => 49122, getLocation: () => ({ equals: () => true }) };
  area.templateObjects = [secondSapphireGate];
  handlers.object({ player, object: secondSapphireGate, definition: { id: 49122 }, option: "Open", location: instanceLocation(2954, 6406, 2), handled: false });
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 28, "the earned sapphire key opens later gates too");
  assert.deepEqual(openedObjects, [gate, secondSapphireGate]);

  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 46);
  inventory.adds(28419, 1);
  const diamondGate = { getPrivateArea: () => area, getId: () => 49128, getLocation: () => ({ equals: () => true }) };
  area.templateObjects = [diamondGate];
  handlers.object({ player, object: diamondGate, definition: { id: 49128 }, option: "Open", location: instanceLocation(2903, 6375, 2), handled: false });
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 48, "the diamond key opens the equipment-cell gate after the Assassin's answers");
  assert.equal(inventory.getAmount(28419), 1);
  assert.equal(handlers.object({ ...event, player: { getAttribute: () => null } }), false, "outside the quest instance, gate handling falls through");
});

test("ordinary Ghorrock prison doors open without consuming a quest key", () => {
  const { handlers, player, area, inventory, openedObjects, instanceLocation } = setup();
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 22);
  inventory.adds(28416, 1);
  const door = {
    getPrivateArea: () => area,
    getId: () => 49118,
    getLocation: () => ({ equals: () => true }),
  };
  const event = { player, object: door, definition: { id: 49118 }, option: "Open", location: instanceLocation(2935, 6354, 2), handled: false };
  handlers.object(event);
  assert.equal(event.handled, true);
  assert.deepEqual(openedObjects, [door]);
  assert.equal(inventory.getAmount(28416), 1);
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 22);
});

test("the asylum Dragonstone Gate opens before the final stair climb", () => {
  const { handlers, player, area, openedObjects, instanceLocation } = setup();
  player.setAttribute("desert-treasure-ii:sucellus-cell-escaped", true);
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 58);
  player.setAttribute("desert-treasure-ii:sucellus-area", area);
  const gate = { getPrivateArea: () => null };
  const event = { player, object: gate, definition: { id: 49130 }, option: "Open", location: instanceLocation(2974, 6435, 2), handled: false };
  assert.equal(handlers.object(event), true);
  assert.equal(event.handled, true);
  assert.deepEqual(openedObjects, [gate]);
});

test("an earned key reopens its restored cache gate after the quest has advanced", () => {
  const { handlers, player, area, inventory, openedObjects, instanceLocation } = setup();
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 30);
  inventory.adds(28416, 1);
  const gate = { getPrivateArea: () => area };
  const event = { player, object: gate, definition: { id: 49122 }, option: "Open", location: instanceLocation(2954, 6406, 2), handled: false };
  handlers.object(event);
  assert.equal(event.handled, true);
  assert.deepEqual(openedObjects, [gate]);
  assert.equal(inventory.getAmount(28416), 1, "reopening a restored gate preserves the earned key");
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 30);
});

test("the equipment chest advances only after confirmed stash recovery and retries safely", () => {
  const { handlers, emitted, player, inventory, instanceLocation, setStashRestored } = setup();
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 46);
  inventory.adds(28419, 1);
  const chest = { player, definition: { id: 49130, name: "Chest" }, option: "Open", location: instanceLocation(2899, 6376, 2), handled: false };
  handlers.object(chest);
  assert.equal(chest.handled, true);
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 46, "failed recovery keeps the chest retryable");
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-gear-returned"), undefined);
  assert.equal(emitted.filter(({ name }) => name === "dt2:sucellus-prison-return-stash").length, 1);

  setStashRestored(true);
  handlers.object({ ...chest, handled: false });
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 50);
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-gear-returned"), true);
  assert.equal(emitted.filter(({ name }) => name === "dt2:sucellus-prison-return-stash").length, 2);
  handlers.object({ ...chest, handled: false });
  assert.equal(emitted.filter(({ name }) => name === "dt2:sucellus-prison-return-stash").length, 2, "reopen does not duplicate stash recovery");
});

test("the visible Unblock action clears the blocked crevice without the cell's consumed chisel", () => {
  const { handlers, prompts, player, openedObjects, area, instanceLocation, varbits } = setup();
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 30);
  const crevice = { getPrivateArea: () => area };
  area.templateObjects = [crevice];
  const event = { player, object: crevice, definition: { id: 49110 }, option: "Unblock", location: instanceLocation(2960, 6427, 2), handled: false };
  handlers.object(event);
  assert.equal(event.handled, true);
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 30, "the player confirms the rubble before it clears");
  prompts[0].pairs[1]();
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-crevice-cleared"), true);
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 32);
  assert.deepEqual(openedObjects, [], "the loc remains present for its new Enter action");
  assert.equal(varbits.get(15178), 1, "the cache morph changes Unblock into Enter");
  const restored = { getId: () => 49110, getPrivateArea: () => area,
    getLocation: () => ({ equals: (location) => location.x === 10000 + 2960 - 2872 && location.y === 20000 + 6427 - 6336 }) };
  area.templateObjects = [restored];
  handlers.custom["dt2:sucellus-prison-resume"]({ player, area });
  assert.equal(varbits.get(15178), 1, "an earned unblock survives rebuilding the copied map on login");
  handlers.object({ player, definition: { id: 49109 }, option: "Enter", location: instanceLocation(2960, 6427, 2), handled: false });
  assert.deepEqual(player.location, area.tile(2966 - 2872, 6428 - 6336, 2));
  handlers.object({ player, definition: { id: 49106 }, option: "Enter", location: instanceLocation(2965, 6427, 2), handled: false });
  assert.deepEqual(player.location, area.tile(2959 - 2872, 6428 - 6336, 2));
});

test("Jhallan death returns the owner to the emerald room and preserves the earned prison inventory", () => {
  const { handlers, player, area, inventory, moveToSource, createdNpcs } = setup();
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 34);
  inventory.adds(28417, 1);
  inventory.adds(28425, 1);
  moveToSource(2923, 6442);
  handlers.custom["dt2:sucellus-prison-process"]({ player, area, cycle: 100 });
  assert.equal(createdNpcs.length, 1);
  const event = { player, preventDeath: false };
  handlers.beforeDeath(event);
  assert.equal(event.preventDeath, true);
  assert.equal(player.hitpoints, 99);
  assert.deepEqual(player.location, area.tile(2907 - 2872, 6444 - 6336, 2));
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 34);
  assert.equal(inventory.getAmount(28417), 1);
  assert.equal(inventory.getAmount(28425), 1);
  assert.equal(area.entities.length, 0);
  player.area = null;
  const unrelated = { player, preventDeath: false };
  handlers.beforeDeath(unrelated);
  assert.equal(unrelated.preventDeath, false, "deaths outside the owned prison follow their normal rules");
});

test("Ruby key chain requires the seven chest names, converter clue, and translated bed-room route", () => {
  const { handlers, prompts, player, inventory, instanceLocation, moveToSource } = setup();
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 32);
  player.setAttribute("desert-treasure-ii:sucellus-prison-crevice-cleared", true);
  moveToSource(2960, 6416);
  handlers.custom["dt2:sucellus-prison-process"]({ player, area: player.getPrivateArea(), cycle: 100 });
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 34);

  handlers.object({ player, definition: { id: 49153, name: "Crate" }, option: "Search", location: instanceLocation(2969, 6415, 2), handled: false });
  assert.equal(inventory.getAmount(28425), 1, "the converter is obtainable before searching the named chests");
  assert.equal(inventory.getAmount(28426), 1, "the lantern is obtainable in the Wiki's normal crate-first order");
  const locations = [[2959, 6414], [2959, 6419], [2962, 6414], [2962, 6419], [2965, 6414], [2965, 6419], [2968, 6419]];
  for (const [index, [x, y]] of locations.entries()) {
    const event = { player, definition: { id: 49152, name: "Chest" }, option: "Open", location: instanceLocation(x, y, 2), handled: false };
    handlers.object(event);
    assert.equal(event.handled, true, `marked chest ${index + 1} is searched`);
  }
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-ruby-chests"), 127);

  assert.equal(inventory.getAmount(28425), 1);
  assert.equal(inventory.getAmount(28426), 1);
  const converterAction = handlers.item.find(([name]) => name === "Code converter")[1].Read;
  converterAction({ player, itemId: 28425, handled: false });
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-clues-read") & 4, 4);
  inventory.deleteNumber(28426, 1);
  player.getEquipment = () => ({ getAmount: (id) => id === 28426 ? 1 : 0 });

  handlers.object({ player, definition: { id: 49113, name: "Chest" }, option: "Open", location: instanceLocation(2968, 6414, 2), handled: false });
  for (const letter of "URLDRU") {
    const prompt = prompts.at(-1);
    const option = prompt.pairs.findIndex((value, i) => i % 2 === 0 && value === letter);
    assert.notEqual(option, -1);
    prompt.pairs[option + 1]();
  }
  assert.equal(inventory.getAmount(28418), 1);
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 36);
});

test("Emerald and Diamond clues gate their real cache chests", () => {
  const { handlers, messages, prompts, player, inventory, instanceLocation, createdNpcs } = setup();
  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 28);
  handlers.object({ player, definition: { id: 49151, name: "Crate" }, option: "Search", location: instanceLocation(2912, 6450, 2), handled: false });
  assert.equal(inventory.getAmount(28423), 1);
  assert.equal(inventory.getAmount(28424), 1);
  for (const [name, itemId] of [["Requisition note", 28423], ["Grid note", 28424]]) {
    handlers.item.find(([registered]) => registered === name)[1].Read({ player, itemId, handled: false });
  }
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-clues-read") & 18, 18);
  handlers.object({ player, definition: { id: 49112, name: "Chest" }, option: "Open", location: instanceLocation(2902, 6445, 2), handled: false });
  enterAnswer(prompts, "LIES");
  assert.equal(inventory.getAmount(28417), 1);
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 30);

  player.setAttribute("desert-treasure-ii:sucellus-prison-progress", 36);
  inventory.adds(28418, 1);
  const rubyGate = { getPrivateArea: () => player.getPrivateArea() };
  handlers.object({ player, object: rubyGate, definition: { id: 49126 }, option: "Open", location: instanceLocation(2968, 6384, 2), handled: false });
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 38);

  handlers.object({ player, definition: { id: 49160, name: "Bed" }, option: "Search", location: instanceLocation(2889, 6373, 2), handled: false });
  assert.equal(inventory.getAmount(28428), 1);
  assert.equal(inventory.getAmount(28427), 1);
  handlers.item.find(([registered]) => registered === "Library note")[1].Read({ player, itemId: 28428, handled: false });
  assert.match(messages.at(-1), /Various people emerged near us/);
  assert.doesNotMatch(messages.at(-1), /WRATH/);
  handlers.item.find(([registered]) => registered === "Strange slider")[1].Inspect({ player, itemId: 28427, handled: false });
  assert.match(messages.at(-1), /I below, evenly between H and L/);
  for (const [x, y] of [[2931, 6430], [2931, 6432], [2932, 6430]]) {
    handlers.object({ player, definition: { id: 49161, name: "Bookcase" }, option: "Search", location: instanceLocation(x, y, 2), handled: false });
  }
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-library-books"), 7);
  handlers.object({ player, definition: { id: 49114, name: "Chest" }, option: "Open", location: instanceLocation(2890, 6375, 2), handled: false });
  enterAnswer(prompts, "WRATH");
  assert.equal(inventory.getAmount(28419), 1);
  assert.equal(player.getAttribute("desert-treasure-ii:sucellus-prison-progress"), 40);
  const assassin = createdNpcs.find(npc => npc.id === 12348);
  assert.ok(assassin, "earning the Diamond key returns the Assassin immediately without a relog");
  const expected = instanceLocation(2920, 6375, 2);
  assert.deepEqual([assassin.getLocation().getX(), assassin.getLocation().getY()], [expected.x, expected.y]);
});

test('ration crates replenish for their owner, respect the twelve-item limit and stay prison-scoped', () => {
  const { handlers, player, inventory, instanceLocation, messages, setCycle } = setup();
  player.setAttribute('desert-treasure-ii:sucellus-prison-progress', 40);
  const event = { player, definition: { id: 49141, name: 'Crate' }, option: 'Search', location: instanceLocation(2918, 6427, 2), handled: false };
  handlers.object(event);
  assert.equal(inventory.getAmount(28422), 1);
  handlers.object(event);
  assert.equal(inventory.getAmount(28422), 1, 'a crate cannot be emptied repeatedly in one tick');
  setCycle(200);
  handlers.object(event);
  assert.equal(inventory.getAmount(28422), 2, 'the Wiki replenishing crate becomes usable again');
  inventory.contents.set(28422, 12);
  setCycle(300);
  handlers.object(event);
  assert.equal(inventory.getAmount(28422), 12);
  assert.match(messages.at(-1), /twelve/);
  const area = { player, area: 'ghorrock-prison', inside: false };
  handlers.custom['food:area'](area);
  assert.equal(area.inside, true);
  player.setAttribute('desert-treasure-ii:sucellus-prison-progress', 50);
  area.inside = false;
  handlers.custom['food:area'](area);
  assert.equal(area.inside, false, 'ration eating ends when the equipment chest is recovered');
  handlers.object({ ...event, handled: false });
  assert.equal(inventory.getAmount(28422), 12, 'the equipment stage cannot obtain new prison-only rations');
});


test('recovering equipment reuses and moves the existing Assassin to the next dialogue location', () => {
  const { handlers, player, area, createdNpcs } = setup();
  player.setAttribute('desert-treasure-ii:sucellus-prison-progress', 40);
  handlers.custom['dt2:sucellus-prison-resume']({ player, area });
  const assassin = createdNpcs.find(value => value.id === 12348);
  player.setAttribute('desert-treasure-ii:sucellus-prison-progress', 50);
  handlers.custom['dt2:sucellus-prison-resume']({ player, area });
  assert.equal(createdNpcs.filter(value => value.id === 12348).length, 1, 'no duplicate queued or registered speaker');
  assert.deepEqual(assassin.location, area.tile(2903 - 2872, 6383 - 6336, 2));
});


test('prison resume reuses the parent quest speaker even when his earlier spawn is at another stage location', () => {
  const { handlers, player, area, api, createdNpcs } = setup();
  const parentSpeaker = api.core.NPC.create(12348, area.tile(48, 39, 2));
  area.add(parentSpeaker);
  player.setAttribute('desert-treasure-ii:sucellus-prison-progress', 50);
  handlers.custom['dt2:sucellus-prison-resume']({ player, area });
  assert.equal(createdNpcs.length, 1, 'the parent and prison modules share one NPC');
  assert.equal(player.getAttribute('desert-treasure-ii:sucellus-prison-assassin'), parentSpeaker);
  assert.deepEqual(parentSpeaker.location, area.tile(2903 - 2872, 6383 - 6336, 2));
});
