// Vale Totems miniquest and minigame gate. Run after `yarn build`:
//   node --test tests/vale-totems-quest.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const runtime = require("../plugins/quests/QuestRuntime");

// The cutscenes need a real instance and ticks (tests/vale-totems-scenes.test.cjs covers them):
// here a scene runs its checkpoints and its end at once, and records its name.
const scenesPlayed = [];
require.cache[require.resolve("../plugins/quests/valetotems/Scenes.ValeTotems")] = {
  exports: () => ({
    active: () => false,
    end() {},
    play(player, name, { actions = {}, done } = {}) {
      scenesPlayed.push({ player, name });
      for (const action of Object.values(actions)) action(player);
      done?.(player);
      return true;
    },
  }),
};
const ValeTotems = require("../plugins/minigames/ValeTotems.plugin");
const Shared = require("../plugins/minigames/valetotems/Shared.ValeTotems");
const State = require("../plugins/minigames/valetotems/State.ValeTotems");

const SITE = 1;
const OTHER_SITE = 3;
const SITE_BASE = 57016;
const STAGE_VARBIT = 17227;

const hooks = {
  objects: {},
  items: {},
  npcs: {},
  custom: new Map(),
  login: [],
  prompts: [],
  events: [],
};
let quest;

function fakeApi() {
  return {
    core: PluginManager.getCoreApi(),
    persistAttribute() {},
    onPlayerLogin: (handler) => hooks.login.push(handler),
    onPlayerLogout() {},
    onPlayerMapSquareChange() {},
    onServerStartup() {},
    onInterfaceActionButton() {},
    onCustomEvent: (name, handler) => {
      const list = hooks.custom.get(name) ?? [];
      list.push(handler);
      hooks.custom.set(name, list);
    },
    emitCustomEvent: (name, payload) => {
      for (const handler of hooks.custom.get(name) ?? []) handler(payload);
      hooks.events.push({ name, ...payload });
    },
    sendMultiChatboxPrompt: (player, title, ...pairs) => {
      hooks.prompts.push({ player, title, pairs });
    },
    registerCommand() {},
    spawnNpc() {},
    onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
    onObjectInteraction: (name, actions) => { hooks.objects[name] = actions; },
    onItemAction: (name, actions) => { hooks.items[name] = actions; },
  };
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ValeTotems.register(fakeApi());
  require("../plugins/quests/quests/ValeTotems.Quest")(fakeApi());
  quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === "vale_totems");
  assert.ok(quest, "Vale Totems quest registered");
});

const obj = (name) => CacheDefinitions.getObjId(name);
const varbit = (name) => CacheDefinitions.getVarbitId(name);

function createPlayer({ fletching = 20, items = [] } = {}) {
  const varps = new Map();
  const inventory = Array.from({ length: 28 }, (_, slot) => items[slot] ?? null);
  const stacks = (id) => PluginManager.getCoreApi().ItemDefinition.forId(id)?.isStackable?.() === true;
  const said = [];
  const messages = [];
  const spam = [];
  const attributes = new Map();
  const dialogues = [];
  let creationMenu = null;
  let energy = 50;
  const location = { getX: () => 1366, getY: () => 3367, getZ: () => 0, equals: () => true, clone: () => location };

  const sender = new Proxy({
    getVarp: (id) => varps.get(id) ?? 0,
    sendConfig: (id, value) => { varps.set(id, value); return sender; },
    getVarbit: (id) => {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      const width = endBit - startBit + 1;
      return ((varps.get(baseVar) ?? 0) >>> startBit) & ((1 << width) - 1);
    },
    sendVarbit: (id, value) => {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      const mask = ((1 << (endBit - startBit + 1)) - 1) << startBit;
      varps.set(baseVar, ((varps.get(baseVar) ?? 0) & ~mask) | ((value << startBit) & mask));
      return sender;
    },
    sendCreationMenu: (menu) => { creationMenu = menu; return sender; },
    sendTypedMessage: (type, text) => {
      if (type === PluginManager.getCoreApi().ChatType.SPAM) spam.push(text);
      else messages.push(text);
      return sender;
    },
  }, { get: (target, key) => key in target ? target[key] : () => sender });

  const inventoryApi = {
    contains: (id) => inventory.some((item) => item?.id === id),
    getAmount: (id) => inventory.filter((item) => item?.id === id).reduce((sum, item) => sum + item.amount, 0),
    getFreeSlots: () => inventory.filter((item) => !item).length,
    isFull: () => inventory.every(Boolean),
    refreshItems() {},
    full() { messages.push("Not enough space in your inventory."); },
    forceAdd(_player, item) { inventoryApi.adds(item.getId(), item.getAmount()); },
    delete: (id, amount) => {
      let left = amount;
      for (let slot = 0; slot < 28 && left > 0; slot++) {
        const item = inventory[slot];
        if (item?.id !== id) continue;
        const take = Math.min(left, item.amount);
        item.amount -= take;
        left -= take;
        if (item.amount === 0) inventory[slot] = null;
      }
    },
    adds: (id, amount) => {
      const stack = stacks(id) && inventory.find((item) => item?.id === id);
      if (stack) stack.amount += amount;
      else if (stacks(id)) inventory[inventory.indexOf(null)] = { id, amount };
      else for (let i = 0; i < amount; i++) inventory[inventory.indexOf(null)] = { id, amount: 1 };
    },
  };

  const player = {
    inventory, messages, spam, attributes, dialogues, isPlayerBot: () => false,
    getDisplayName: () => "Tester", getUsername: () => "tester",
    get creationMenu() { return creationMenu; },
    getLocation: () => location,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    sendMessage: (text) => messages.push(text),
    performAnimation() {},
    setPositionToFace() {},
    getRunEnergy: () => energy,
    setRunEnergy: (value) => { energy = value; },
    getEquipment: () => ({ contains: () => false }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill.getName?.() ?? String(skill)).toLowerCase().includes("fletch") ? fletching : 1,
      getMaxLevel: (skill) => (skill.getName?.() ?? String(skill)).toLowerCase().includes("fletch") ? fletching : 1,
      addExperiences() {},
    }),
    getInventory: () => inventoryApi,
    getDialogueManager: () => ({
      startDialogues: (builder) => {
        const entries = [...builder.getDialogues().values()];
        dialogues.push(entries);
        // Clicks straight through: each line is sent in turn, so its actions run in order.
        for (const entry of entries) entry.send(player);
      },
    }),
  };
  return player;
}

const item = (name, amount = 1) => ({ id: obj(name), amount });

function talk(player, npc = PluginManager.getCoreApi().NpcIdentifiers.RANULPH) {
  const handler = hooks.npcs.Ranulph;
  return handler["Talk-to"]({ player, npcId: npc });
}

function chooseYes(player) {
  const prompt = [...hooks.prompts].reverse().find((entry) => entry.player === player);
  assert.ok(prompt, "a prompt was shown");
  return prompt.pairs[1](player, 1, "Yes.");
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

test("registers the miniquest exactly at the helper's varbit and completion", () => {
  assert.equal(quest.name, "Vale Totems");
  assert.equal(quest.varbitId, STAGE_VARBIT);
  assert.equal(quest.getStage(createPlayer()), 0);
  assert.equal(quest.completionValue, 70);
  assert.equal(quest.questPoints, 0);
  assert.ok(require("../plugins/quests/Quests.plugin").QUESTS.includes("ValeTotems"));
});

test("the access gate opens site 1 only during the quest and every site after it", () => {
  const player = createPlayer();
  const request = (site) => {
    const payload = { player, site, allowed: true };
    for (const handler of hooks.custom.get("vale-totems:access") ?? []) handler(payload);
    return payload.allowed;
  };
  assert.equal(request(SITE), false, "not started");
  quest.setStage(player, 30);
  assert.equal(request(SITE), true, "the quest's own site");
  assert.equal(request(OTHER_SITE), false, "other sites wait for completion");
  quest.setStage(player, 70);
  assert.equal(request(SITE), true);
  assert.equal(request(OTHER_SITE), true);
});

test("Ranulph refuses the start without Children of the Sun and level 20 Fletching", () => {
  const complete = (payload) => { if (payload.key === "children_of_the_sun") payload.complete = true; };
  hooks.custom.get("quest:is-complete").unshift(complete);
  try {
    const low = createPlayer({ fletching: 19 });
    talk(low);
    assert.equal(quest.getStage(low), 0);
    assert.match(low.dialogues.at(-1)[0].getText(), /Fletching level of 20/);

    const noPrerequisite = createPlayer();
    hooks.custom.get("quest:is-complete").shift();
    talk(noPrerequisite);
    assert.equal(quest.getStage(noPrerequisite), 0);
    assert.match(noPrerequisite.dialogues.at(-1)[0].getText(), /Alina/);
  } finally {
    if (hooks.custom.get("quest:is-complete")[0] === complete) hooks.custom.get("quest:is-complete").shift();
  }
});

test("a stage 10 or 20 checkpoint replays the intro from there, to the build step", () => {
  for (const [stage, scenes] of [[10, ["worship", "break"]], [20, ["break"]]]) {
    const player = createPlayer();
    quest.setStage(player, stage);
    talk(player);
    assert.deepEqual(scenesPlayed.filter((scene) => scene.player === player).map((scene) => scene.name), scenes);
    assert.equal(quest.getStage(player), 30, `stage ${stage} continues the intro`);
    assert.equal(player.getPacketSender().getVarbit(varbit("ent_totems_broken_chat")), 1);
  }
});

test("as captured: Ranulph starts the miniquest; the ent's scene, the break and Isadora's talk reach the build step", () => {
  const player = createPlayer();
  const complete = (payload) => { if (payload.key === "children_of_the_sun") payload.complete = true; };
  hooks.custom.get("quest:is-complete").unshift(complete);
  try {
    assert.equal(talk(player), true);
    const opening = player.dialogues.at(-1);
    assert.deepEqual(opening.slice(0, 2).map((entry) => entry.getText()), ["Hello.", "Oh, sorry! I was lost in thought. You gave me quite the start!"]);
    assert.equal(hooks.prompts.at(-1).title, "Start the Vale Totems miniquest?");
    chooseYes(player);
    assert.deepEqual(scenesPlayed.filter((scene) => scene.player === player).map((scene) => scene.name), ["worship", "break"]);
    assert.equal(quest.getStage(player), 30, "the intro ends ready to build");
    assert.equal(player.getPacketSender().getVarbit(varbit("ent_totems_broken_chat")), 1);
    assert.equal(player.messages.length, 0, "live sends no 'new miniquest' line");
    const talkAfter = player.dialogues.find((entries) => entries[0]?.getText?.() === "Uh oh! The funny man broke the totem!");
    assert.ok(talkAfter, "Isadora opens the talk after the break");
    const last = talkAfter.at(-1);
    assert.equal(last.constructor.name, "PlayerDialogue", "live gives the last line to the player");
    assert.match(last.getText(), /^Well, I guess you can consult with Isadora/);
  } finally {
    hooks.custom.get("quest:is-complete").shift();
  }
});

test("before the miniquest site 1 shows the old totem; Ranulph's break clears it", () => {
  const player = createPlayer();
  for (const handler of hooks.login) handler({ player });
  assert.deepEqual(State.totem(player, SITE), { wood: 1, carvings: [1, 2, 3], carved: true, decorations: 0, decay: 2, points: 0 });
  assert.deepEqual(State.animals(player, SITE), [1, 2, 3]);
  const complete = (payload) => { if (payload.key === "children_of_the_sun") payload.complete = true; };
  hooks.custom.get("quest:is-complete").unshift(complete);
  try {
    talk(player);
    chooseYes(player);
    assert.equal(State.totem(player, SITE).wood, 0);
    assert.equal(State.totem(player, SITE).carved, false);
  } finally {
    hooks.custom.get("quest:is-complete").shift();
  }
});

test("as captured: before the miniquest the old totem can't be decorated", () => {
  const player = createPlayer({ items: [item("oak_shield")] });
  for (const handler of hooks.login) handler({ player });
  hooks.objects["Oak totem"].Decorate({ player, objectId: SITE_BASE });
  assert.equal(player.dialogues.at(-1)[0].getText(), "You're not really sure what to do with that, but maybe there's someone in the valley who does.");
  assert.equal(State.totem(player, SITE).decorations, 0);
});

test("a wrong carving during the quest gets the captured warning", () => {
  const player = createPlayer({ items: [item("oak_logs"), item("knife")] });
  quest.setStage(player, 30);
  State.set(player, SITE, { animal_1: 1, animal_2: 2, animal_3: 3 });
  State.erect(player, SITE, 1);
  player.getPacketSender().sendVarbit(varbit("ent_totems_carve_chat"), 1);
  hooks.objects["Oak totem"].Carve({ player, objectId: SITE_BASE });
  player.creationMenu.execute(obj("ent_totems_animal_icon_e"));
  assert.deepEqual(player.dialogues.at(-1).map((entry) => entry.getText()), [
    "That's not right!",
    "Remember, you need to make carvings of the animal spirits that are currently in this area.",
  ]);
});

test("the minigame snapshot leaves the quest's ent_totems bits alone", () => {
  const player = createPlayer();
  State.erect(player, SITE, 1);
  const snapshot = player.getAttribute("vale-totems:varps");
  assert.ok(snapshot);
  assert.equal(Object.hasOwn(snapshot, "ent_totems"), false);
});

test("the minigame withholds carving and decorating until each lesson, then advances the quest", () => {
  const player = createPlayer({ items: [item("oak_logs"), item("knife")] });
  quest.setStage(player, 30);
  player.setAttribute("quest.vale_totems.broken-chat", 1);
  State.set(player, SITE, { animal_1: 1, animal_2: 2, animal_3: 3 });

  hooks.objects["Totem site"].Build({ player, objectId: SITE_BASE });
  tick();
  assert.equal(State.totem(player, SITE).wood, 1);
  assert.match(player.dialogues.at(-1)[0].getText(), /Ranulph and Isadora might be able to tell you how/);
  assert.equal(player.dialogues.at(-1)[0].getText().includes("You erect an oak totem. It's now ready"), true);

  player.inventory[0] = item("oak_logs");
  hooks.objects["Oak totem"].Carve({ player, objectId: SITE_BASE });
  assert.equal(player.dialogues.at(-1)[0].getText(), "You're not quite sure how to carve the totem. Ranulph and Isadora might be able to help.");

  // Talking to Isadora teaches carving and hands over the knife when it is missing.
  player.inventory[0] = item("oak_logs");
  player.inventory[1] = null;
  const isadora = PluginManager.getCoreApi().NpcIdentifiers.ISADORA;
  hooks.npcs.Isadora["Talk-to"]({ player, npcId: isadora });
  assert.equal(player.getPacketSender().getVarbit(varbit("ent_totems_carve_chat")), 1);
  assert.equal(player.getInventory().contains(obj("knife")), true);

  // Carve the three spirits.
  for (const animal of ["a", "b", "c"]) {
    hooks.objects["Oak totem"].Carve({ player, objectId: SITE_BASE });
    const creation = player.creationMenu;
    assert.ok(creation, "carve menu");
    creation.execute(obj(`ent_totems_animal_icon_${animal}`));
  }
  assert.equal(State.totem(player, SITE).carved, true);
  // During the miniquest all three carvings name the animal, as spam.
  assert.deepEqual(player.spam, ["You carve a buffalo into the totem.", "You carve a jaguar into the totem.", "You carve an eagle into the totem."]);
  tick();
  assert.equal(player.dialogues.at(-1)[0].getText(), "You finish carving the totem, but it still seems to be missing something. Ranulph and Isadora might know what to do next.");

  // Talk again to learn decorating, then add four oak decorations.
  hooks.npcs.Isadora["Talk-to"]({ player, npcId: isadora });
  assert.equal(player.getPacketSender().getVarbit(varbit("ent_totems_decorate_chat")), 1);
  for (let i = 0; i < 4; i++) player.inventory[i] = item("oak_shield");
  hooks.objects["Oak totem"].Decorate({ player, objectId: SITE_BASE });
  tick(8);
  assert.equal(State.totem(player, SITE).decorations, 4);
  const final = player.dialogues.at(-1);
  assert.equal(final[0].getText(), "You add the final decoration to the totem.");
  assert.equal(final[1].getText(), "There we go! I's say that's the totem finished!");
  assert.equal(quest.getStage(player), 30, "the fourth decoration stays at 30");

  // Talking to either NPC is what moves 30 to 40, then the scene sets the 100-offering pile.
  hooks.npcs.Isadora["Talk-to"]({ player, npcId: isadora });
  assert.equal(scenesPlayed.at(-1).name, "offering");
  assert.equal(quest.getStage(player), 50);
  assert.equal(State.totem(player, SITE).points, 100);
  assert.equal(State.totem(player, SITE).decay, 1, "the scene's visit takes a point of durability");
});

test("the offering is 100, claiming it advances the quest, and the final talk completes it", () => {
  const player = createPlayer();
  quest.setStage(player, 40);
  State.erect(player, SITE, 1);
  for (const animal of [1, 2, 3]) State.carve(player, SITE, animal, 2);
  State.set(player, SITE, { decorations: 4 });

  hooks.npcs.Isadora["Talk-to"]({ player, npcId: PluginManager.getCoreApi().NpcIdentifiers.ISADORA });
  assert.equal(quest.getStage(player), 50);
  assert.equal(State.totem(player, SITE).points, 100);

  hooks.objects.Offerings.Claim({ player, objectId: CacheDefinitions.getLocId("ent_totems_site_1_offerings") });
  tick();
  assert.equal(quest.getStage(player), 60);

  assert.equal(player.dialogues.at(-1)[0].getText(), "You collect 100 offerings.", "the quest's claim is an objectbox");

  hooks.npcs.Isadora["Talk-to"]({ player, npcId: PluginManager.getCoreApi().NpcIdentifiers.ISADORA });
  assert.equal(quest.getStage(player), 70);
  assert.equal(player.getPacketSender().getVarbit(STAGE_VARBIT), 100, "the client reads 100");
  assert.equal(player.getInventory().contains(PluginManager.getCoreApi().ItemIdentifiers.SACRAMENTS_OF_ENT_FOLK), true);
  const ending = player.dialogues.at(-1);
  const notebook = ending.find((entry) => entry.constructor.name === "ItemStatementDialogue");
  assert.match(ending[ending.indexOf(notebook) - 1].getText(), /^Speaking of which, here, take a notebook/);
  assert.equal(notebook.getText(), "Ranulph gives you a notebook.");
  assert.equal(player.messages.some((text) => /Congratulations/.test(text)), false, "no completion line for this miniquest");
});

test("as captured: ents pass the quest's totem by until the miniquest is complete", () => {
  const Ents = require("../plugins/minigames/valetotems/Ents.ValeTotems");
  const player = createPlayer();
  for (const handler of hooks.login) handler({ player });
  Ents.visitAll(player);
  assert.equal(State.totem(player, SITE).decay, 2, "the old totem is never visited");
  quest.setStage(player, 30);
  State.set(player, SITE, { base: 0, base_carved: 0, base_multiloc: 0, low: 0, mid: 0, top: 0, decay: 0 });
  State.erect(player, SITE, 3);
  for (const animal of [1, 2, 3]) State.carve(player, SITE, animal, 4);
  State.set(player, SITE, { decorations: 4 });
  Ents.visitAll(player);
  assert.deepEqual([State.totem(player, SITE).decay, State.totem(player, SITE).points], [4, 0], "the rebuilt one waits for the scripted visit");
  quest.setStage(player, 70);
  Ents.visitAll(player);
  assert.equal(State.totem(player, SITE).decay, 3, "after the miniquest it is an ordinary site");
});

test("a stage-0 save's own site 1 totem and unclaimed pile survive login", () => {
  const player = createPlayer();
  State.erect(player, SITE, 3);
  State.set(player, SITE, { points: 12 });
  for (const handler of hooks.login) handler({ player });
  assert.equal(State.totem(player, SITE).wood, 3, "the player's maple totem stays");
  assert.equal(State.totem(player, SITE).points, 12, "and so does the pile");

  const piled = createPlayer();
  State.set(piled, SITE, { points: 7 });
  for (const handler of hooks.login) handler({ player: piled });
  assert.deepEqual([State.totem(piled, SITE).wood, State.totem(piled, SITE).points], [0, 7], "a pile alone isn't covered by the old totem");
});
