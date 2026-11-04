// Run after `yarn build`: node --test tests/radas-blessing.test.cjs
// Rada's blessing in Fishing.plugin.js `landCatch`. It lives apart from fishing.test.cjs so
// its infernal harpoon case runs in a process of its own.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

test("Rada's blessing: a worn tier gives 2/4/6/8% to land a second fish, with no extra XP", async () => {
  const { core, Fishing, fisher, amount, spot, start, ticks } = await fishingLoop();
  const { ItemIdentifiers: I, NpcIdentifiers: N } = core;
  const { TOOLS, FISH } = Fishing;
  const wear = (p, id) => {
    const worn = id === undefined ? [] : [id];
    p.getEquipment = () => ({ contains: (item) => worn.includes(item), getItems: () => new Array(14).fill(null) });
    return p;
  };
  const lobster = (p) => Fishing.landCatch(p, TOOLS.LOBSTER_POT, Fishing.findTool(p, TOOLS.LOBSTER_POT), [FISH.LOBSTER]);
  const tiers = [[I.RADAS_BLESSING_1, 0.02], [I.RADAS_BLESSING_2, 0.04], [I.RADAS_BLESSING_3, 0.06], [I.RADAS_BLESSING_4, 0.08]];
  for (const [id, chance] of tiers) {
    await withRandom(chance - 0.001, async () => {
      const p = wear(fisher({ items: [[I.LOBSTER_POT]] }), id);
      lobster(p);
      assert.equal(amount(p, I.RAW_LOBSTER), 2, `blessing ${id} just inside ${chance}`);
      assert.equal(p.xp, FISH.LOBSTER.experience, "no experience for the second fish");
    });
    await withRandom(chance + 0.001, async () => {
      const p = wear(fisher({ items: [[I.LOBSTER_POT]] }), id);
      lobster(p);
      assert.equal(amount(p, I.RAW_LOBSTER), 1, `blessing ${id} just outside ${chance}`);
    });
  }
  await withRandom(0.001, async () => {
    const bare = wear(fisher({ items: [[I.LOBSTER_POT]] }));
    lobster(bare);
    assert.equal(amount(bare, I.RAW_LOBSTER), 1, "not worn");
    const carried = wear(fisher({ items: [[I.LOBSTER_POT], [I.RADAS_BLESSING_4]] }));
    lobster(carried);
    assert.equal(amount(carried, I.RAW_LOBSTER), 1, "carried, not worn");
    const junk = wear(fisher({ items: [[I.BIG_FISHING_NET]] }), I.RADAS_BLESSING_4);
    Fishing.landCatch(junk, TOOLS.BIG_NET, Fishing.findTool(junk, TOOLS.BIG_NET), [FISH.SEAWEED]);
    assert.equal(amount(junk, I.SEAWEED), 1, "junk is not a fish");
    // The second fish needs room: a full inventory keeps the one it had a slot for.
    const crowded = wear(fisher({ items: [[I.LOBSTER_POT], ...new Array(26).fill([I.LOGS])] }), I.RADAS_BLESSING_4);
    lobster(crowded);
    assert.equal(amount(crowded, I.RAW_LOBSTER), 1, "no room for the second");
  });
  // Through the fishing loop: the cast lands two and still pays one lobster's XP.
  await withRandom(0.02, async () => {
    const p = wear(fisher({ items: [[I.LOBSTER_POT]] }), I.RADAS_BLESSING_4);
    start(p, spot(N.FISHING_SPOT_10, 3), "Cage");
    ticks(3);
    assert.equal(amount(p, I.RAW_LOBSTER), 2);
    assert.equal(p.xp, FISH.LOBSTER.experience);
  });
});

test("Rada's blessing doubles a stackable catch, says so, and cooks the extra fish on an infernal harpoon", async () => {
  const { core, Fishing, fisher, amount } = await fishingLoop();
  const { ItemIdentifiers: I, Item, Skill, Equipment } = core;
  const { TOOLS, FISH } = Fishing;
  const MESSAGE = "Rada's blessing enabled you to catch an extra fish.";
  const wear = (p, id) => {
    p.getEquipment = () => ({ contains: (item) => item === id, getItems: () => new Array(14).fill(null) });
    return p;
  };

  // Wiki (Minnow, Raw karambwanji): the blessing doubles the amount, 14 become 28.
  await withRandom(0.001, async () => {
    const netter = wear(fisher({ level: 65, items: [[I.SMALL_FISHING_NET]] }), I.RADAS_BLESSING_4);
    Fishing.landCatch(netter, TOOLS.KARAMBWANJI_NET, Fishing.findTool(netter, TOOLS.KARAMBWANJI_NET), [FISH.KARAMBWANJI]);
    assert.equal(amount(netter, I.RAW_KARAMBWANJI), 28);
    assert.equal(netter.messages.filter((m) => m === MESSAGE).length, 1);
    assert.equal(netter.xp, 5, "XP for the one catch");
  });
  await withRandom(0.5, async () => {
    const netter = wear(fisher({ level: 65, items: [[I.SMALL_FISHING_NET]] }), I.RADAS_BLESSING_4);
    Fishing.landCatch(netter, TOOLS.KARAMBWANJI_NET, Fishing.findTool(netter, TOOLS.KARAMBWANJI_NET), [FISH.KARAMBWANJI]);
    assert.equal(amount(netter, I.RAW_KARAMBWANJI), 14);
    assert.ok(!netter.messages.includes(MESSAGE), "no message without the extra");
  });

  // A big net's second fish doesn't take the slot the next fish needs.
  await withRandom(0.001, async () => {
    const full = wear(fisher({ items: [[I.BIG_FISHING_NET], ...new Array(25).fill([I.LOGS])] }), I.RADAS_BLESSING_4);
    Fishing.landCatch(full, TOOLS.BIG_NET, Fishing.findTool(full, TOOLS.BIG_NET), [FISH.COD, FISH.BASS]);
    assert.equal(amount(full, I.RAW_COD), 1);
    assert.equal(amount(full, I.RAW_BASS), 1, "the bass still has its slot");
  });

  // Infernal harpoon (Wiki): the extra fish has its own independent chance to be cooked.
  const events = new Map();
  const api = new Proxy({
    core,
    getTaskManager: () => ({ submit() {} }),
    getWorld: () => ({}),
    onCustomEvent: (name, handler) => events.set(name, handler),
    emitCustomEvent: (name, payload) => events.get(name)?.(payload),
  }, { get: (target, name) => target[name] ?? (() => {}) });
  require("../plugins/skills/Cooking.plugin").register(api);
  Fishing.register(api);
  function harpooner() {
    const p = wear(fisher({ items: [] }), I.RADAS_BLESSING_4);
    const cooking = { xp: 0 };
    const weapon = new Item(I.INFERNAL_HARPOON, 1);
    const items = new Array(14).fill(null);
    items[Equipment.WEAPON_SLOT] = weapon;
    p.getEquipment = () => ({ contains: (id) => id === I.RADAS_BLESSING_4 || id === I.INFERNAL_HARPOON, getItems: () => items, refreshItems() {} });
    const skills = p.getSkillManager();
    p.getSkillManager = () => ({ ...skills, addExperiences: (skill, xp) => { if (skill === Skill.COOKING) cooking.xp += xp; else skills.addExperiences(skill, xp); } });
    p.cooking = cooking;
    p.weapon = weapon;
    return p;
  }
  // Rolls in order: the first shark's cook roll, the blessing roll, the extra shark's cook roll.
  const sequence = (values) => () => values.shift();
  await withRandom(sequence([0.9, 0.001, 0.1]), async () => {
    const p = harpooner();
    Fishing.landCatch(p, TOOLS.SHARK_HARPOON, Fishing.findTool(p, TOOLS.SHARK_HARPOON), [FISH.SHARK]);
    assert.equal(amount(p, I.RAW_SHARK), 1, "the first shark is kept, the extra one is cooked");
    assert.equal(p.cooking.xp, 105);
    assert.equal(p.xp, FISH.SHARK.experience);
    assert.ok(p.messages.includes(MESSAGE));
  });
  await withRandom(sequence([0.1, 0.001, 0.9]), async () => {
    const p = harpooner();
    Fishing.landCatch(p, TOOLS.SHARK_HARPOON, Fishing.findTool(p, TOOLS.SHARK_HARPOON), [FISH.SHARK]);
    assert.equal(amount(p, I.RAW_SHARK), 1, "a cooked first fish still rolls the blessing");
    assert.equal(p.cooking.xp, 105);
    assert.ok(p.messages.includes(MESSAGE));
  });
});

test("a saved worn Rada's blessing gives nothing on a free world", async () => {
  const { core, Fishing, fisher, amount } = await fishingLoop();
  const { ItemIdentifiers: I, Item, WorldDefinition } = core;
  const { TOOLS, FISH } = Fishing;
  const MESSAGE = "Rada's blessing enabled you to catch an extra fish.";
  const worn = (p) => {
    p.getEquipment = () => ({ contains: (id) => id === I.RADAS_BLESSING_4, getItems: () => new Array(14).fill(null) });
    return p;
  };
  const lobster = (p) => Fishing.landCatch(p, TOOLS.LOBSTER_POT, Fishing.findTool(p, TOOLS.LOBSTER_POT), [FISH.LOBSTER]);

  const membersWorld = WorldDefinition.isMembersWorld;
  WorldDefinition.isMembersWorld = () => false;
  try {
    // The real FreeToPlay plugin refuses to equip a members item but leaves a saved worn one.
    const equipHooks = [];
    require("../plugins/modes/FreeToPlay.plugin").register(new Proxy({
      core,
      onCanEquip: (handler) => equipHooks.push(handler),
    }, { get: (target, name) => target[name] ?? (() => {}) }));
    const equip = { player: { sendMessage() {} }, item: new Item(I.RADAS_BLESSING_4, 1), allow: true };
    equipHooks.forEach((hook) => hook(equip));
    assert.equal(equip.allow, false, "FreeToPlay treats the blessing as a members item");

    await withRandom(0.001, async () => {
      const p = worn(fisher({ items: [[I.LOBSTER_POT]] }));
      lobster(p);
      assert.equal(amount(p, I.RAW_LOBSTER), 1, "no extra fish on a free world");
      assert.ok(!p.messages.includes(MESSAGE));
    });
  } finally {
    WorldDefinition.isMembersWorld = membersWorld;
  }

  await withRandom(0.001, async () => {
    const p = worn(fisher({ items: [[I.LOBSTER_POT]] }));
    lobster(p);
    assert.equal(amount(p, I.RAW_LOBSTER), 2, "the same blessing works on a members world");
  });
});

/**
 * The cache loads once per file: a second initialize closes the store that the Gamevals built by
 * the first still read (EBADF), so every test shares this one load.
 */
let cacheReady = null;
function initializeCache() {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  cacheReady ??= CachePipeline.initialize(path.resolve(__dirname, ".."));
  return cacheReady;
}

async function fishingLoop() {
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await initializeCache();
  const core = PluginManager.getCoreApi();
  const { NpcDefinition, Skill, Item, Location } = core;
  const Fishing = require("../plugins/skills/Fishing.plugin");

  const npcs = new Map();
  const tasks = [];
  const handlers = new Map();
  const api = new Proxy({
    core,
    getTaskManager: () => ({ submit: (task) => tasks.push(task) }),
    getWorld: () => ({ getNpcs: () => npcs }),
    onNpcInteraction: (name, actions) => handlers.set(name, actions),
  }, { get: (target, name) => target[name] ?? (() => {}) });
  Fishing.register(api);
  const task = tasks.find((submitted) => submitted.constructor.name === "FishingTask");

  function fisher({ level = 99, items = [] } = {}) {
    const slots = items.map(([id, amount = 1]) => new Item(id, amount));
    const stackable = (id) => core.ItemDefinition.forId(id).isStackable();
    const p = {
      slots, messages: [], statements: [], animations: [], xp: 0, at: new Location(2900, 3119, 0),
      isRegistered: () => true,
      getHitpoints: () => 10,
      getMovementQueue: () => ({ size: () => 0 }),
      getForceMovement: () => null,
      getLocation: () => p.at,
      performAnimation: (animation) => p.animations.push(animation.getId()),
      sendMessage: (message) => p.messages.push(message),
      getPacketSender: () => ({ sendTypedMessage: (type, message) => p.messages.push(message), sendSoundEffect() {} }),
      getDialogueManager: () => ({ startDialogues: (chain) => p.statements.push(chain) }),
      getEquipment: () => ({ contains: () => false, getItems: () => new Array(14).fill(null) }),
      getSkillManager: () => ({
        getCurrentLevel: () => level,
        getMaxLevel: () => level,
        addExperiences: (skill, amount) => { if (skill === Skill.FISHING) p.xp += amount; },
      }),
      getInventory: () => ({
        contains: (id) => slots.some((item) => item.getId() === id && item.getAmount() > 0),
        getAmount: (id) => slots.filter((item) => item.getId() === id).reduce((sum, item) => sum + item.getAmount(), 0),
        getFreeSlots: () => 28 - slots.length,
        isFull: () => slots.length >= 28,
        full() {},
        refreshItems() {},
        getSlotForItemId: (id) => slots.findIndex((item) => item.getId() === id),
        setItem: (slot, item) => { slots[slot] = item; },
        addItem: (item) => {
          const stack = stackable(item.getId()) && slots.find((held) => held.getId() === item.getId());
          if (stack) stack.setAmount(stack.getAmount() + item.getAmount());
          else if (slots.length < 28) slots.push(item);
        },
        deleteNumber: (id, amount) => {
          const index = slots.findIndex((held) => held.getId() === id);
          const left = slots[index].getAmount() - amount;
          if (left > 0 && stackable(id)) slots[index].setAmount(left); else slots.splice(index, 1);
        },
      }),
    };
    return p;
  }
  const amount = (p, id) => p.getInventory().getAmount(id);
  function spot(id, index) {
    const npc = { getId: () => id, getIndex: () => index, getLocation: () => new Location(2900, 3120, 0) };
    npcs.set(index, npc);
    return npc;
  }
  function start(p, npc, option) {
    const definition = NpcDefinition.forId(npc.getId());
    const event = { player: p, npc, npcId: npc.getId(), definition, clickType: definition.getActions().indexOf(option) + 1 };
    return handlers.get("Fishing spot")[option]?.(event);
  }
  const ticks = (count) => { for (let i = 0; i < count; i++) task.execute(); };
  ticks(1);
  return { core, Fishing, fisher, amount, spot, start, ticks };
}

/** Runs `body` with Math.random fixed, restoring it after. */
async function withRandom(value, body) {
  const random = Math.random;
  Math.random = typeof value === "function" ? value : () => value;
  try {
    await body((next) => { Math.random = typeof next === "function" ? next : () => next; });
  } finally {
    Math.random = random;
  }
}
