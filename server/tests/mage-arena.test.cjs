// Run after `yarn build`: node --test tests/mage-arena.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");

const MageArena = require("../plugins/minigames/MageArena.plugin");

const core = PluginManager.getCoreApi();
const { battleMages, levers, spells, statues } = MageArena._test;

const SARADOMIN = spells.GODS.find((god) => god.spellId === 1190);
const ZAMORAK = spells.GODS.find((god) => god.spellId === 1192);

function player({ x = 3100, y = 3930, z = 0, cape = -1, spellId = null, attributes = {}, localNpcs } = {}) {
  const attrs = new Map(Object.entries(attributes));
  const messages = [];
  const moved = [];
  return {
    messages,
    moved,
    isPlayer: () => true,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getLocation: () => ({ getX: () => x, getY: () => y, getZ: () => z }),
    getEquipment: () => ({ get: (slot) => (slot === core.Equipment.CAPE_SLOT ? { getId: () => cape } : null) }),
    getCombat: () => ({
      getSelectedSpell: () => (spellId == null ? null : { spellId: () => spellId }),
      getPreviousCast: () => null,
    }),
    getLocalNpcs: () => localNpcs ?? [],
    sendMessage: (message) => messages.push(message),
    moveTo: (location) => moved.push([location.getX(), location.getY()]),
  };
}

function battleMage(id) {
  return { isNpc: () => true, getId: () => id };
}

test("god spell casts count only inside the arena, on a battle mage, with the god spell", () => {
  const caster = player({ spellId: 1192 });
  spells.hitResolved({ attacker: caster, target: battleMage(1610) });
  spells.hitResolved({ attacker: caster, target: battleMage(1611) });
  assert.equal(caster.getAttribute(ZAMORAK.counter), 2, "any battle mage charges the spell");

  const outside = player({ x: 3090, y: 3956, spellId: 1192 });
  spells.hitResolved({ attacker: outside, target: battleMage(1610) });
  assert.equal(outside.getAttribute(ZAMORAK.counter), undefined);

  const wrongTarget = player({ spellId: 1192 });
  spells.hitResolved({ attacker: wrongTarget, target: battleMage(1614) });
  assert.equal(wrongTarget.getAttribute(ZAMORAK.counter), undefined);

  const wrongSpell = player({ spellId: 1181 });
  spells.hitResolved({ attacker: wrongSpell, target: battleMage(1610) });
  assert.equal(wrongSpell.getAttribute(ZAMORAK.counter), undefined);

  const npcCaster = { isPlayer: () => false };
  spells.hitResolved({ attacker: npcCaster, target: battleMage(1610) });
});

test("the 100th cast unlocks the spell, announces it once and caps the counter", () => {
  const caster = player();
  for (let cast = 0; cast < 99; cast++) {
    assert.equal(spells.awardCast(caster, ZAMORAK), true);
  }
  assert.equal(caster.getAttribute(ZAMORAK.counter), 99);
  assert.equal(caster.messages.length, 0, "nothing is announced before 100");

  assert.equal(spells.awardCast(caster, ZAMORAK), true);
  assert.equal(caster.getAttribute(ZAMORAK.counter), 100);
  assert.equal(caster.messages.length, 1);
  assert.match(caster.messages[0], /Flames of Zamorak/);

  assert.equal(spells.awardCast(caster, ZAMORAK), false, "the counter stops at 100");
  assert.equal(caster.messages.length, 1, "the unlock is announced once");
});

test("a locked god spell is cancelled outside the arena; inside or unlocked it is not", () => {
  const outside = player({ x: 3090, y: 3956 });
  const locked = { player: outside, spellId: 1190, disabled: null };
  spells.spellDisabled(locked);
  assert.equal(locked.disabled, true);
  assert.equal(outside.messages.length, 1);
  spells.spellDisabled(locked);
  assert.equal(outside.messages.length, 1, "the refusal message is throttled");

  const inside = player();
  const charging = { player: inside, spellId: 1190, disabled: null };
  spells.spellDisabled(charging);
  assert.equal(charging.disabled, null, "charging inside the arena is how the spell unlocks");

  const unlocked = player({ x: 3090, y: 3956, attributes: { [SARADOMIN.counter]: 100 } });
  const unlockedEvent = { player: unlocked, spellId: 1190, disabled: null };
  spells.spellDisabled(unlockedEvent);
  assert.equal(unlockedEvent.disabled, null, "an unlocked spell stays castable after relog");

  const otherSpell = { player: player({ x: 3090, y: 3956 }), spellId: 1181, disabled: null };
  spells.spellDisabled(otherSpell);
  assert.equal(otherSpell.disabled, null, "non god spells are not touched");
});

/** Records every packet-sender call; each returns the sender, so chains keep working. */
function recordingSender(calls = []) {
  const sender = new Proxy({}, {
    get: (_target, name) => (...args) => {
      calls.push([name, ...args]);
      return sender;
    },
  });
  return { sender, calls };
}

test("register persists one counter per god and the first cape, and wires the hooks", () => {
  const persisted = [];
  const hooks = [];
  const api = {
    core,
    persistAttribute: (key) => persisted.push(key),
    getTaskManager: () => ({ submit() {} }),
    onSpellDisabled: () => hooks.push("onSpellDisabled"),
    onCombatHitResolved: () => hooks.push("onCombatHitResolved"),
    onObjectInteraction: (name) => hooks.push(`onObjectInteraction:${name}`),
    onServerStartup: () => hooks.push("onServerStartup"),
    onPlayerProcess: () => hooks.push("onPlayerProcess"),
    registerNpcCombatMethodProvider: (ids) => hooks.push(`combatMethod:${ids}`),
  };
  MageArena.register(api);

  assert.deepEqual(
    persisted.sort(),
    ["mage-arena:cape-received", "mage-arena:charge:guthix", "mage-arena:charge:saradomin", "mage-arena:charge:zamorak"]
  );
  assert.ok(hooks.includes("onSpellDisabled"));
  assert.ok(hooks.includes("onCombatHitResolved"));
  assert.ok(hooks.includes("onObjectInteraction:Lever"));
  assert.ok(hooks.includes("onObjectInteraction:Sparkling pool"));
  assert.ok(hooks.includes("onObjectInteraction:Statue of Saradomin"));
});

test("the arena levers play the captured pull and cast, landing on the captured tiles", () => {
  const steps = levers.leverSteps(levers.LEVERS[9706], [3105, 3953]);
  const waits = steps.filter((step) => step.wait != null).map((step) => step.wait);
  assert.deepEqual(waits, [1, 1, 3], "pull a tick after arrival, cast a tick later, land three after that");
  assert.ok(steps.some((step) => step.anim === 2710));
  assert.ok(steps.some((step) => step.objAnim === 2711));
  assert.ok(steps.some((step) => step.anim === 714));
  assert.ok(steps.some((step) => step.gfx === 111 && step.height === 92));
  assert.ok(steps.some((step) => step.sound === 200));
  assert.deepEqual(steps.find((step) => step.tele).tele, [3105, 3951, 0]);
  assert.deepEqual(
    steps.filter((step) => step.msg).map((step) => step.msg),
    ["You pull the lever...", "... and get teleported into the arena!"]
  );
  const out = levers.leverSteps(levers.LEVERS[9707], [3105, 3953]);
  assert.deepEqual(out.find((step) => step.tele).tele, [3105, 3956, 0]);
  assert.equal(out.at(-1).msg, "... and get teleported out of the arena!");

  const caster = player();
  assert.equal(levers.pullLever({ objectId: 5959, player: caster, location: { x: 3090, y: 3956, z: 0 } }), false);
  assert.equal(levers.pullLever({ objectId: 5960, player: caster, location: { x: 2539, y: 4712, z: 0 } }), false);
});

test("the sparkling pools jump onto the pool's centre and land beside the other pool", () => {
  // Captured: from 2878 at (2541, 4719) the jump lands on (2542, 4720), then (2509, 4689);
  // from 2879 at (2508, 4686) on (2509, 4687), then (2542, 4718).
  const bank = levers.poolSteps(2878, [2541, 4719]);
  assert.deepEqual(bank.find((step) => step.move).move, [2542, 4720]);
  assert.deepEqual(bank.find((step) => step.tele).tele, [2509, 4689, 0]);
  const chamber = levers.poolSteps(2879, [2508, 4686]);
  assert.deepEqual(chamber.find((step) => step.move).move, [2509, 4687]);
  assert.deepEqual(chamber.find((step) => step.tele).tele, [2542, 4718, 0]);
  assert.ok(bank.some((step) => step.gfx === 68) && bank.some((step) => step.anim === 804));

  const caster = player();
  assert.equal(levers.stepIntoPool({ objectId: 1000, player: caster, location: { x: 0, y: 0, z: 0 } }), false);
});

function statuePlayer({ received = false, freeSlots = 28 } = {}) {
  const base = player({ attributes: received ? { [statues.CAPE_RECEIVED_ATTRIBUTE]: true } : {} });
  const { sender, calls } = recordingSender();
  const added = [];
  return Object.assign(base, {
    calls,
    added,
    getPacketSender: () => sender,
    getInventory: () => ({ getFreeSlots: () => freeSlots, adds: (id, amount) => added.push([id, amount]) }),
  });
}

test("the first cape lands on the statue's tile with the full message", () => {
  const spawned = [];
  statues.setApi({ getTaskManager: () => ({ submit: (task) => task.execute() }) });
  statues.setCore({
    ...core,
    ItemOnGroundManager: {
      registerLocation: (owner, item, location) =>
        spawned.push({ owner, id: item.getId(), x: location.getX(), y: location.getY() }),
    },
  });
  const caster = statuePlayer();
  statues.capeOnFloor(caster, statues.STATUES[2874]);

  assert.deepEqual(spawned.map(({ id, x, y }) => [id, x, y]), [[2414, 2516, 4720]], "captured at the statue's own tile");
  assert.equal(spawned[0].owner, caster);
  assert.equal(caster.getAttribute(statues.CAPE_RECEIVED_ATTRIBUTE), true);
  assert.ok(caster.calls.some(([name, graphic]) => name === "sendGraphic" && graphic.getId() === 188));
  assert.ok(caster.calls.some(([name, text]) => name === "sendString"
    && text === "You kneel and chant to Zamorak... You feel a rush of energy charge through your veins. Suddenly a cape appears before you."));
});

test("later prayers ask how many and put the capes in the pack", () => {
  statues.setCore(core);
  const caster = statuePlayer({ received: true, freeSlots: 3 });
  statues.askHowMany(caster, statues.STATUES[2875]);
  const menu = caster.calls.find(([name]) => name === "sendCreationMenu")[1];
  assert.equal(menu.getTitle(), "How many would you like to take?");
  assert.deepEqual(menu.getItems(), [2413]);
  assert.deepEqual(menu.getOptions(), { mode: 23, maxAmount: 3, lastAmount: 1 });

  statues.capesToPack(caster, statues.STATUES[2875], 2);
  assert.deepEqual(caster.added, [[2413, 2]]);
  assert.equal(statues.packLine(statues.STATUES[2875]),
    "You kneel and chant to Guthix... You feel a rush of energy charge through your veins. Suddenly a cape appears in your pack.");

  const full = statuePlayer({ received: true, freeSlots: 0 });
  statues.askHowMany(full, statues.STATUES[2873]);
  assert.ok(!full.calls.some(([name]) => name === "sendCreationMenu"));
  assert.equal(statues.prayAt({ player: full, objectId: 1000 }), undefined);
});

test("each battle mage casts its own god spell at 4 ticks", () => {
  battleMages.setCore(core);
  const expected = { 1611: 1190, 1610: 1192, 1612: 1191 };
  for (const [npcId, spellId] of Object.entries(expected)) {
    const god = battleMages.godForMage(Number(npcId));
    assert.equal(god.spell.spellId(), Number(spellId));
    assert.equal(god.spell.maximumHit(), 20);

    const Method = battleMages.battleMageCombatMethod(god.spell);
    const method = new Method();
    assert.equal(method.attackSpeed(), 4);

    let cast = null;
    let previous = null;
    const npc = {
      isNpc: () => true,
      getId: () => Number(npcId),
      performAnimation() {},
      getCombat: () => ({
        getSelectedSpell: () => cast,
        setCastSpell: (value) => { cast = value; },
        setPreviousCast: (value) => { previous = value; },
      }),
    };
    method.start(npc, player());
    assert.equal(cast, god.spell, `npc ${npcId} casts its god spell`);
    method.finished(npc);
    assert.equal(previous, god.spell);
    assert.equal(cast, null);
  }
});

test("battle mages tolerate only the player wearing their own god's cape", () => {
  battleMages.setCore({ ...core, NPC: { prototype: { isAggressiveTo: () => true } } });
  const mage = { getId: () => 1611 };
  const other = { getId: () => 1614 };
  battleMages.processPlayer({ player: player({ localNpcs: [mage, other] }) });

  assert.equal(typeof mage.isAggressiveTo, "function");
  assert.equal(typeof other.isAggressiveTo, "undefined", "only battle mages are patched");
  assert.equal(mage.isAggressiveTo(player({ cape: 2412 })), false, "Saradomin's cape is tolerated");
  assert.equal(mage.isAggressiveTo(player({ cape: 21792 })), false, "the imbued cape counts");
  assert.equal(mage.isAggressiveTo(player({ cape: 2414 })), true, "another god's cape is attacked");
  assert.equal(mage.isAggressiveTo(player()), true, "no cape is attacked");

  const outside = { getId: () => 1610 };
  battleMages.processPlayer({ player: player({ x: 3090, y: 3956, localNpcs: [outside] }) });
  assert.equal(typeof outside.isAggressiveTo, "undefined", "nothing is patched outside the arena");
});

test("battle mage aggression is applied on startup, after the definition loader", () => {
  const definitions = new Map();
  battleMages.setCore({
    ...core,
    NpcDefinition: {
      forId: (id) => {
        const definition = definitions.get(id) ?? {};
        definitions.set(id, definition);
        return definition;
      },
    },
  });
  battleMages.configureAggression();

  assert.deepEqual([...definitions.keys()].sort(), [1610, 1611, 1612]);
  for (const definition of definitions.values()) {
    assert.equal(definition.aggressive, true);
    assert.equal(definition.aggressiveTolerance, false, "tolerance must not switch the mages off");
  }
});

test("core already gates the god spells on 60 Magic and the matching staff", () => {
  const godSpells = core.CombatSpells;
  assert.equal(godSpells.SARADOMIN_STRIKE.levelRequired(), 60);
  assert.equal(godSpells.CLAWS_OF_GUTHIX.levelRequired(), 60);
  assert.equal(godSpells.FLAMES_OF_ZAMORAK.levelRequired(), 60);
  assert.equal(godSpells.SARADOMIN_STRIKE.equipmentRequired(player())[0].getId(), 2415);
  assert.equal(godSpells.CLAWS_OF_GUTHIX.equipmentRequired(player())[0].getId(), 2416);
  assert.equal(godSpells.FLAMES_OF_ZAMORAK.equipmentRequired(player())[0].getId(), 2417);
});
