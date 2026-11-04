// Run after `yarn build`: node --test tests/enter-the-abyss.test.cjs
//
// Drives the real plugin through the real QuestRuntime with a small player
// fixture: the Wilderness/Varrock meetings, the three essence-mine readings,
// the hand-in rewards, relog restore, lost-orb recovery and the pending-reward
// claim. Dialogue is captured rather than rendered, then walked with the
// choices the Quest Helper route uses.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { contractFor } = require("../plugins/quests/questhelper/Contract.QuestHelper");
const runtime = require("../plugins/quests/QuestRuntime");

const VARROCK_MAGE = 3229;
const WILDERNESS_MAGE = 3228;
const ORB_EMPTY = 5519;
const ORB_FULL = 5518;
const ABYSSAL_BOOK = 5520;
const SMALL_POUCH = 5509;
const VARBITS = { wizardstower: 2314, aubury: 2315, cromperty: 2316, brimstail: 2317, wizardsguild: 2318 };

let core;
let quest;
let hooks;
let lastDialogue;
let lastBook;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

/** A minimal inventory container whose items look like the core Item class. */
class TestInventory {
  constructor(Item) {
    this.Item = Item;
    this.slots = new Map();
  }

  getItems() {
    const items = new Array(28).fill(null);
    for (const [slot, item] of this.slots) items[slot] = item;
    return items;
  }

  getAmount(itemId) {
    let total = 0;
    for (const item of this.slots.values()) if (item.getId() === itemId) total += item.getAmount();
    return total;
  }

  contains(itemId) {
    return this.getAmount(itemId) > 0;
  }

  getFreeSlots() {
    return 28 - this.slots.size;
  }

  isFull() {
    return this.getFreeSlots() < 1;
  }

  adds(itemId, amount) {
    for (const item of this.slots.values()) {
      if (item.getId() === itemId) {
        item.amount += amount;
        return this;
      }
    }
    for (let slot = 0; slot < 28; slot++) {
      if (this.slots.has(slot)) continue;
      this.slots.set(slot, this.Item(itemId, amount));
      return this;
    }
    return this;
  }

  addItem(item) {
    return this.adds(item.getId(), item.getAmount());
  }

  deleteNumber(itemId, amount) {
    let left = amount;
    for (const [slot, item] of [...this.slots]) {
      if (item.getId() !== itemId || left < 1) continue;
      const take = Math.min(left, item.getAmount());
      item.amount -= take;
      left -= take;
      if (item.getAmount() < 1) this.slots.delete(slot);
    }
    return this;
  }

  deleteAtSlot(slot, amount = 1) {
    const item = this.slots.get(slot);
    if (!item) return this;
    item.amount -= amount;
    if (item.getAmount() < 1) this.slots.delete(slot);
    return this;
  }

  setItem(slot, item) {
    this.slots.set(slot, item);
    return this;
  }

  get(slot) {
    return this.slots.get(slot) ?? null;
  }

  full() {
    return this;
  }

  /** Fills every slot except `keep` with a placeholder stack. */
  fill(keep = 0) {
    for (let slot = 0; slot < 28; slot++) {
      if (slot === keep || this.slots.has(slot)) continue;
      this.slots.set(slot, coreItem(995, 1));
    }
  }
}

function coreItem(id, amount) {
  return {
    id,
    amount,
    getId() {
      return this.id;
    },
    getAmount() {
      return this.amount;
    },
  };
}

function makePlayer() {
  const attributes = new Map();
  const varbits = new Map();
  const messages = [];
  const lines = [];
  const experience = new Map();
  const inventory = new TestInventory(coreItem);
  const bank = new Map();
  const equipment = [];
  const dialogueManager = {
    reset() {},
    startDialogues(chain) {
      lastDialogue = chain;
    },
    isActive: () => false,
  };
  const sender = new Proxy({
    getVarbit(id) {
      return varbits.get(id) ?? 0;
    },
    sendVarbit(id, value) {
      varbits.set(id, value);
      return sender;
    },
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return () => sender;
    },
  });
  const player = {
    __attributes: attributes,
    __varbits: varbits,
    __messages: messages,
    __lines: lines,
    __experience: experience,
    __inventory: inventory,
    __bank: bank,
    __equipment: equipment,
    getAttribute(key) {
      return attributes.get(key);
    },
    setAttribute(key, value) {
      attributes.set(key, value);
    },
    getInventory() {
      return inventory;
    },
    getBanks() {
      return [{ getAmount: (id) => bank.get(id) ?? 0 }];
    },
    getBank() {
      return { getAmount: (id) => bank.get(id) ?? 0 };
    },
    getEquipment() {
      return { getItems: () => equipment, get: () => null };
    },
    getSkillManager() {
      return {
        addExperiences(skill, amount) {
          const key = skill?.getName?.() ?? String(skill);
          experience.set(key, (experience.get(key) ?? 0) + amount);
        },
        addExperience(skill, amount) {
          this.addExperiences(skill, amount);
        },
        getExperience() {
          return 0;
        },
        getCurrentLevel() {
          return 99;
        },
        setCurrentLevels() {},
        getMaxLevel() {
          return 99;
        },
        getCombatLevel() {
          return 126;
        },
      };
    },
    getPacketSender() {
      return sender;
    },
    getDialogueManager() {
      return dialogueManager;
    },
    getFrameUpdater() {
      return { clear() {} };
    },
    getLocation() {
      return { getX: () => 0, getY: () => 0, getZ: () => 0 };
    },
    isPlayerBot() {
      return false;
    },
    isRegistered() {
      return true;
    },
    sendMessage(message) {
      messages.push(String(message));
    },
  };
  return player;
}

function createApi() {
  const custom = new Map();
  const npc = new Map();
  const itemActions = new Map();
  const login = [];
  const apiCore = {
    ...core,
    TaskManager: { submit() {} },
    CountdownTask: class {
      constructor(...args) {
        Object.assign(this, args);
      }
    },
  };
  const base = {
    core: apiCore,
    persistAttribute() {},
    onNpcInteraction(target, actions) {
      npc.set(target, actions);
    },
    onItemAction(target, actions) {
      itemActions.set(target, actions);
    },
    onPlayerLogin(handler) {
      login.push(handler);
    },
    onCustomEvent(name, handler) {
      const list = custom.get(name) ?? [];
      list.push(handler);
      custom.set(name, list);
    },
    emitCustomEvent(name, event) {
      if (name === "quest:is-complete" && event) {
        if (event.key === "rune_mysteries") event.complete = true;
        if (event.key === "enter_the_abyss" && quest) event.complete = quest.isComplete(event.player);
      }
      for (const handler of custom.get(name) ?? []) handler(event);
    },
  };
  const api = new Proxy(base, {
    get(target, property) {
      if (property in target) return target[property];
      return () => undefined;
    },
  });
  return { api, custom, npc, itemActions, login };
}

/** Walks captured QuestRuntime steps, taking the named option at each menu. */
function play(player, steps, choices = []) {
  let remaining = [...steps];
  while (remaining.length > 0) {
    const [step, ...rest] = remaining;
    if (typeof step.exec === "function") {
      step.exec(player);
      remaining = rest;
      continue;
    }
    if (Array.isArray(step.options)) {
      const wanted = choices.shift();
      const option = step.options.find((candidate) => candidate.text === wanted) ?? step.options[0];
      remaining = [...(option.next ?? []), ...rest];
      continue;
    }
    if (Array.isArray(step.npc)) player.__lines.push(...step.npc);
    if (Array.isArray(step.player)) player.__lines.push(...step.player);
    remaining = rest;
  }
}

function talk(player, npcId, npc = null) {
  const actions = hooks.npc.get("Mage of Zamorak");
  assert.ok(actions && typeof actions["Talk-to"] === "function", "the quest owns Mage of Zamorak Talk-to");
  const before = lastDialogue;
  const handled = actions["Talk-to"]({ player, npcId, npc });
  return { handled, steps: lastDialogue !== before ? lastDialogue.steps : null };
}

function teleport(player, from) {
  const handlers = hooks.custom.get("teleport:landed") ?? [];
  assert.ok(handlers.length > 0, "the quest listens for teleport landings");
  for (const handler of handlers) handler({ player, from, to: { x: 2913, y: 4832, z: 0 } });
}

test("Enter the Abyss follows the helper route and its recovery paths", () => {
  // Patch before the plugin captures the runtime functions.
  const realStartDialogue = runtime.startDialogue;
  const realOpenBook = runtime.openBook;
  runtime.startDialogue = (api, player, context, steps) => {
    lastDialogue = { player, context, steps };
    return true;
  };
  runtime.openBook = (player, title, pages) => {
    lastBook = { player, title, pages };
  };

  try {
    const api = createApi();
    hooks = api;
    require("../plugins/quests/quests/EnterTheAbyss.Quest.js")(api.api);
    quest = runtime.getRegisteredQuests().find((entry) => entry.key === "enter_the_abyss");
    assert.ok(quest, "the miniquest registers");

    // The cache's completion contract is the independent anchor (PR #1524).
    const contract = contractFor(CacheDefinitions, "Enter the Abyss");
    assert.deepEqual({ rowId: contract?.rowId, endstate: contract?.endstate }, { rowId: 43, endstate: 4 });
    assert.equal(quest.completionValue, contract.endstate, "the saved stage completes at the cache's endstate");
    assert.equal(CacheDefinitions.getVarbit(VARBITS.aubury).baseVar, 491, "essence readings live in abyssal_warp");
    assert.equal(CacheDefinitions.getVarbit(VARBITS.wizardstower).baseVar, 491);

    // ---- Main route -------------------------------------------------------
    const player = makePlayer();
    assert.equal(quest.getStage(player), 0);

    const wilderness = talk(player, WILDERNESS_MAGE);
    assert.equal(wilderness.handled, true, "the Wilderness mage is claimed");
    assert.equal(quest.getStage(player), 1, "meeting the Wilderness mage starts the miniquest");

    const varrock = talk(player, VARROCK_MAGE);
    assert.equal(varrock.handled, true, "the Chaos Temple mage is claimed");
    play(player, varrock.steps, [
      "Where do you get your runes from?",
      "Care to share?",
      "Maybe I could make it worth your while?",
      "Yes, but I can still help you as well.",
      "Deal.",
    ]);
    assert.equal(quest.getStage(player), 2, "accepting the offer starts the orb hunt");
    assert.equal(player.__inventory.getAmount(ORB_EMPTY), 1, "the mage hands over the empty scrying orb");

    // The other agreement branch and the decline branch follow the same helper menu.
    const steal = makePlayer();
    quest.setStage(steal, 1);
    play(steal, talk(steal, VARROCK_MAGE).steps, [
      "Where do you get your runes from?",
      "Care to share?",
      "Maybe I could make it worth your while?",
      "I did it so that I could then steal their secrets.",
      "Deal.",
    ]);
    assert.equal(quest.getStage(steal), 2, "the steal-their-secrets branch also accepts");
    assert.equal(steal.__inventory.getAmount(ORB_EMPTY), 1);

    const noDeal = makePlayer();
    quest.setStage(noDeal, 1);
    play(noDeal, talk(noDeal, VARROCK_MAGE).steps, [
      "Where do you get your runes from?",
      "Care to share?",
      "Maybe I could make it worth your while?",
      "Yes, but I can still help you as well.",
      "No deal.",
    ]);
    assert.equal(quest.getStage(noDeal), 1, "No deal leaves the offer open");
    assert.equal(noDeal.__inventory.getAmount(ORB_EMPTY), 0);

    const loyal = makePlayer();
    quest.setStage(loyal, 1);
    play(loyal, talk(loyal, VARROCK_MAGE).steps, [
      "Where do you get your runes from?",
      "Care to share?",
      "But I'm a loyal servant of Zamorak as well!",
      "Okay, fine. I don't really serve Zamorak.",
      "Because I can still help you.",
      "Deal.",
    ]);
    assert.equal(quest.getStage(loyal), 2, "the loyal-Zamorakian branch reaches the same deal");
    assert.equal(loyal.__inventory.getAmount(ORB_EMPTY), 1);

    const noSpace = makePlayer();
    quest.setStage(noSpace, 1);
    noSpace.__inventory.fill(-1);
    play(noSpace, talk(noSpace, VARROCK_MAGE).steps, [
      "Where do you get your runes from?",
      "Care to share?",
      "Maybe I could make it worth your while?",
      "Yes, but I can still help you as well.",
      "Deal.",
    ]);
    assert.equal(quest.getStage(noSpace), 1, "a full bag does not start the orb hunt");
    assert.equal(noSpace.__inventory.getAmount(ORB_EMPTY), 0);
    noSpace.__inventory.deleteAtSlot(0);
    play(noSpace, talk(noSpace, VARROCK_MAGE).steps, ["Deal."]);
    assert.equal(quest.getStage(noSpace), 2, "freeing a slot lets the offer finish");
    assert.equal(noSpace.__inventory.getAmount(ORB_EMPTY), 1);

    teleport(player, { x: 3253, y: 3402, z: 0 }); // Aubury
    teleport(player, { x: 3103, y: 9571, z: 0 }); // Sedridor
    assert.equal(quest.getStage(player), 2, "two readings are not enough");
    assert.equal(player.__varbits.get(VARBITS.aubury), 1);
    assert.equal(player.__varbits.get(VARBITS.wizardstower), 1);

    teleport(player, { x: 2683, y: 3326, z: 0 }); // Cromperty
    assert.equal(quest.getStage(player), 3, "the third reading readies the hand-in");
    assert.equal(player.__varbits.get(VARBITS.cromperty), 1);
    assert.equal(player.__inventory.getAmount(ORB_EMPTY), 0, "the empty orb is consumed");
    assert.equal(player.__inventory.getAmount(ORB_FULL), 1, "the orb is now charged");

    // Repeated teleports from the same place do not advance the count.
    teleport(player, { x: 3253, y: 3402, z: 0 });
    assert.equal(quest.getStage(player), 3);

    const handIn = talk(player, VARROCK_MAGE);
    assert.equal(handIn.handled, true);
    play(player, handIn.steps);
    assert.equal(quest.getStage(player), 4, "the charged orb completes the miniquest");
    assert.equal(player.__inventory.getAmount(ORB_FULL), 0);
    assert.equal(player.__inventory.getAmount(ABYSSAL_BOOK), 1, "the abyssal book is rewarded");
    assert.equal(player.__inventory.getAmount(SMALL_POUCH), 1, "the small pouch is rewarded");
    assert.equal(player.__experience.get("Runecrafting"), 1000, "1,000 Runecraft experience");
    assert.ok(player.__messages.some((message) => message.includes("Enter the Abyss")));

    // Post-quest talk defers to the transcript, and completion is idempotent.
    assert.equal(talk(player, VARROCK_MAGE).handled, false);
    assert.equal(quest.complete(player), false, "a second completion is refused");
    assert.equal(player.__inventory.getAmount(ABYSSAL_BOOK), 1);
    assert.equal(player.__inventory.getAmount(SMALL_POUCH), 1);

    // Relog restores the reading bits.
    player.__varbits.clear();
    for (const handler of api.login) handler({ player });
    for (const key of ["aubury", "wizardstower", "cromperty"]) {
      assert.equal(player.__varbits.get(VARBITS[key]), 1, `${key} reading survives relog`);
    }
    for (const key of ["brimstail", "wizardsguild"]) {
      assert.equal(player.__varbits.get(VARBITS[key]), 0, `${key} was never visited`);
    }

    // ---- The offer can be reconsidered -----------------------------------
    const thinking = makePlayer();
    quest.setStage(thinking, 1);
    play(thinking, talk(thinking, VARROCK_MAGE).steps, ["Interesting. Thanks for the information."]);
    assert.equal(quest.getStage(thinking), 1, "walking away leaves the offer open");
    assert.equal(thinking.getAttribute("enter-the-abyss:offer-made"), undefined, "no offer was made yet");
    const secondIntro = talk(thinking, VARROCK_MAGE).steps;
    assert.match(JSON.stringify(secondIntro), /Ah, you again\. The Wilderness/, "an early exit repeats the full intro");
    play(thinking, secondIntro, [
      "Where do you get your runes from?",
      "Care to share?",
      "Maybe I could make it worth your while?",
      "Yes, but I can still help you as well.",
      "I need to think about it.",
    ]);
    assert.equal(quest.getStage(thinking), 1, "thinking about it leaves the offer open");
    assert.equal(thinking.getAttribute("enter-the-abyss:offer-made"), 1, "the agreement marks the offer as made");
    play(thinking, talk(thinking, VARROCK_MAGE).steps, ["Deal."]);
    assert.equal(quest.getStage(thinking), 2, "accepting on a later visit starts the orb hunt");
    assert.equal(thinking.__inventory.getAmount(ORB_EMPTY), 1);

    // ---- Lost orb recovery ------------------------------------------------
    const lost = makePlayer();
    quest.setStage(lost, 2);
    const lostTalk = talk(lost, VARROCK_MAGE);
    play(lost, lostTalk.steps, ["I lost it. Could I have another?"]);
    assert.equal(lost.__inventory.getAmount(ORB_EMPTY), 1, "a lost empty orb is replaced");

    const lostCharged = makePlayer();
    quest.setStage(lostCharged, 3);
    lostCharged.setAttribute("enter-the-abyss:readings", ["aubury", "wizardstower", "cromperty"]);
    const chargedTalk = talk(lostCharged, VARROCK_MAGE);
    play(lostCharged, chargedTalk.steps, ["I lost it. Could I have another?"]);
    assert.equal(lostCharged.__inventory.getAmount(ORB_FULL), 1, "a lost charged orb comes back charged");

    // ---- Banked orb blocks the hand-in ------------------------------------
    const banked = makePlayer();
    quest.setStage(banked, 3);
    banked.__bank.set(ORB_FULL, 1);
    const bankedTalk = talk(banked, VARROCK_MAGE);
    play(banked, bankedTalk.steps);
    assert.equal(quest.getStage(banked), 3, "the orb must be brought, not banked");
    assert.ok(banked.__lines.some((line) => line.includes("no use there")));

    // ---- The hand-in cannot complete without the orb -----------------------
    const orbGone = makePlayer();
    quest.setStage(orbGone, 3);
    orbGone.__inventory.adds(ORB_FULL, 1);
    const orbGoneSteps = talk(orbGone, VARROCK_MAGE).steps;
    orbGone.__inventory.deleteNumber(ORB_FULL, 1);
    play(orbGone, orbGoneSteps);
    assert.equal(quest.getStage(orbGone), 3, "losing the orb before the last line does not complete the quest");
    assert.equal(orbGone.__experience.get("Runecrafting"), undefined);

    // ---- Full inventory keeps the second reward for later -----------------
    const full = makePlayer();
    quest.setStage(full, 3);
    full.__inventory.adds(ORB_FULL, 1);
    full.__inventory.fill(0);
    const fullTalk = talk(full, VARROCK_MAGE);
    play(full, fullTalk.steps);
    assert.equal(quest.getStage(full), 4);
    assert.equal(full.__inventory.getAmount(ABYSSAL_BOOK), 1, "the first reward fits the freed slot");
    assert.equal(full.__inventory.getAmount(SMALL_POUCH), 0, "the pouch is held back");
    full.__inventory.deleteAtSlot(1);
    const claim = talk(full, VARROCK_MAGE);
    assert.equal(claim.handled, true, "the pending reward is offered after completion");
    play(full, claim.steps);
    assert.equal(full.__inventory.getAmount(SMALL_POUCH), 1, "the pouch is claimed on the next visit");

    // ---- Worn god items stop the conversation -----------------------------
    const godly = makePlayer();
    godly.__equipment.push(coreItem(2412, 1)); // Saradomin cape
    const refusal = talk(godly, VARROCK_MAGE);
    assert.equal(refusal.handled, true);
    assert.equal(quest.getStage(godly), 0, "a Saradomin item does not start the miniquest");
    play(godly, refusal.steps);
    assert.ok(godly.__lines.some((line) => line.includes("disrespectful attire")));

    // ---- The chapel copy of the Wilderness mage id is routed by tile ------
    const chapelMage = makePlayer();
    chapelMage.__equipment.push(coreItem(2412, 1)); // Saradomin cape
    const chapelTalk = talk(chapelMage, 2580, { getLocation: () => ({ x: 3259, y: 3383 }) });
    assert.equal(chapelTalk.handled, true);
    play(chapelMage, chapelTalk.steps);
    assert.ok(
      chapelMage.__lines.some((line) => line.includes("disrespectful attire")),
      "the chapel 2580 uses the Varrock refusal"
    );

    const wildMage = makePlayer();
    wildMage.__equipment.push(coreItem(2412, 1));
    const wildTalk = talk(wildMage, 2580, { getLocation: () => ({ x: 3106, y: 3558 }) });
    play(wildMage, wildTalk.steps);
    assert.ok(
      wildMage.__lines.some((line) => line.includes("Saradominist filth")),
      "the Wilderness 2580 uses the Wilderness refusal"
    );

    // The Ourania mage is unrelated.
    assert.equal(talk(makePlayer(), 7425).handled, false, "the Ourania mage is not claimed");

    // ---- Reading the rewarded book ---------------------------------------
    const reader = makePlayer();
    const read = hooks.itemActions.get("Abyssal book")?.Read;
    assert.equal(typeof read, "function");
    assert.equal(read({ player: reader, itemId: ABYSSAL_BOOK }), true);
    assert.equal(lastBook.title, "Abyssal Research Notes");
    assert.ok(lastBook.pages.length > 0);

    // ---- The Abyss teleport stays locked until the miniquest is done ------
    const runecrafting = createApi();
    runecrafting.api.core.TeleportHandler = { checkReqs: () => true };
    runecrafting.api.core.CombatFactory = { skull() {} };
    runecrafting.api.core.SkullType = { WHITE_SKULL: 0 };
    const teleports = [];
    runecrafting.api.onCustomEvent("lever:teleport", (event) => teleports.push(event));
    const diaryTasks = [];
    runecrafting.api.onCustomEvent("diary:task", (event) => diaryTasks.push(`${event.diary}:${event.task}`));
    require("../plugins/skills/Runecrafting.plugin").register(runecrafting.api);
    const abyssActions = runecrafting.custom.get("npc-dialogue:action") ?? [];
    const abyssTeleport = (who) => {
      const event = { player: who, action: "teleport", stepId: "o8m7y6", handled: false, end: false };
      for (const handler of abyssActions) handler(event);
      return event;
    };

    const locked = makePlayer();
    const lockedEvent = abyssTeleport(locked);
    assert.equal(lockedEvent.handled, true, "the Mage of Zamorak's Abyss option is claimed");
    assert.ok(locked.__messages.some((message) => message.includes("complete Enter the Abyss")));
    assert.equal(teleports.length, 0, "no Abyss teleport before the miniquest");
    assert.deepEqual(diaryTasks, [], "a refused teleport is not the Wilderness Diary's Abyss task");

    const unlocked = makePlayer();
    quest.setStage(unlocked, 4);
    abyssTeleport(unlocked);
    assert.equal(teleports.length, 1, "the completed miniquest unlocks the Abyss teleport");
    assert.deepEqual(diaryTasks, [], "the Wilderness Diary's Abyss task waits for the landing");
    assert.equal(typeof teleports[0].onArrival, "function", "the teleport reports its landing");
    teleports[0].onArrival();
    assert.deepEqual(diaryTasks, ["wilderness:have-the-mage-of-zamorak-teleport-you-to-the-aby"], "and completes the easy Wilderness Diary task on landing");
  } finally {
    runtime.startDialogue = realStartDialogue;
    runtime.openBook = realOpenBook;
  }
});

test("Temple of the Eye yields the shared mage to an incomplete Enter the Abyss", () => {
  const realStartTranscript = runtime.startTranscript;
  let transcript = null;
  runtime.startTranscript = (api, player, npcId, page, variant) => {
    transcript = { player, npcId, page, variant };
    return true;
  };
  try {
    if (!quest) quest = runtime.getRegisteredQuests().find((entry) => entry.key === "enter_the_abyss");
    assert.ok(quest, "Enter the Abyss is registered");
    const toteApi = createApi();
    require("../plugins/quests/quests/TempleOfTheEye.Quest.js")(toteApi.api);
    const handler = toteApi.npc.get("Mage of Zamorak")?.["Talk-to"];
    assert.equal(typeof handler, "function", "Temple of the Eye owns a Mage of Zamorak Talk-to");

    const legacy = makePlayer();
    legacy.setAttribute("quest.temple_of_the_eye.stage", 5);
    assert.equal(
      handler({ player: legacy, npcId: 2580, npc: { getLocation: () => ({ x: 3259, y: 3383 }) } }),
      false,
      "a legacy Temple of the Eye save leaves the mage to Enter the Abyss"
    );

    const unlocked = makePlayer();
    quest.setStage(unlocked, 4);
    unlocked.setAttribute("quest.temple_of_the_eye.stage", 5);
    assert.notEqual(
      handler({ player: unlocked, npcId: 2580, npc: { getLocation: () => ({ x: 3259, y: 3383 }) } }),
      false,
      "Temple of the Eye keeps the mage after Enter the Abyss is complete"
    );
    assert.equal(transcript?.page, "Temple of the Eye");
    assert.match(String(transcript?.variant), /mage-of-zamorak/);
  } finally {
    runtime.startTranscript = realStartTranscript;
  }
});
