// Run after `yarn build`: node --test tests/stealing-artefacts.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");

const StealingArtefacts = require("../plugins/minigames/StealingArtefacts.plugin");

const core = PluginManager.getCoreApi();
const Items = core.ItemIdentifiers;
const ARTEFACTS = [
  Items.STOLEN_PENDANT,
  Items.STOLEN_GARNET_RING,
  Items.STOLEN_CIRCLET,
  Items.STOLEN_FAMILY_HEIRLOOM,
  Items.STOLEN_JEWELRY_BOX,
];
const KHALED = core.NpcIdentifiers.CAPTAIN_KHALED;
const T = StealingArtefacts._test;
T.bind({ core });

function player({ thieving = 99, items = {}, attributes = {} } = {}) {
  const attrs = new Map(Object.entries(attributes));
  const inventory = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  const p = {
    messages: [],
    xp: 0,
    moved: null,
    deletedSlot: null,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getSkillManager: () => ({
      getCurrentLevel: () => thieving,
      addExperiences: (_, amount) => { p.xp += amount; },
    }),
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      addItem: (item) => inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()),
      deleteNumber: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
      deleteAtSlot: (slot, amount) => { p.deletedSlot = [slot, amount]; },
      getFreeSlots: () => 28 - [...inventory.values()].filter((amount) => amount > 0).length,
    }),
    getHitpoints: () => 10,
    sendMessage: (message) => p.messages.push(message),
    moveTo: (location) => { p.moved = location; },
    inventory,
  };
  return p;
}

function artefactsHeld(p) {
  return ARTEFACTS.reduce((count, id) => count + (p.inventory.get(id) ?? 0), 0);
}

test("under 49 Thieving cannot be given a task, and a stale task still cannot steal", () => {
  const p = player({ thieving: 48 });
  const request = { player: p, npcId: KHALED, stepId: T.ASSIGN_STEP, handled: false };
  T.onDialogueAction(request);
  assert.equal(request.handled, true);
  assert.equal(request.steps[0].npc, T.MESSAGES.level);
  assert.equal(T.taskOf(p), null, "no task below the requirement");

  T.assignTask(p, T.HOUSES[0]);
  T.pickLock({ player: p, objectId: T.HOUSES[0].drawer });
  assert.deepEqual(p.messages, [T.MESSAGES.level]);
  assert.equal(p.xp, 0);
  assert.equal(artefactsHeld(p), 0);
});

test("only the assigned drawer yields 750 XP and one random artefact", () => {
  const p = player({ thieving: 49 });
  T.assignTask(p, T.HOUSES[2]);
  T.pickLock({ player: p, objectId: T.HOUSES[0].drawer });
  assert.deepEqual(p.messages, [T.MESSAGES.wrongDrawer]);
  assert.equal(p.xp, 0);
  assert.equal(artefactsHeld(p), 0);

  T.pickLock({ player: p, objectId: T.HOUSES[2].drawer });
  assert.equal(p.messages.at(-1), T.MESSAGES.stole);
  assert.equal(p.xp, 750);
  assert.equal(artefactsHeld(p), 1);
  assert.ok(T.carriedArtefactId(p) !== 0);
});

test("a second artefact cannot be carried", () => {
  const p = player({ thieving: 60 });
  T.assignTask(p, T.HOUSES[1]);
  T.pickLock({ player: p, objectId: T.HOUSES[1].drawer });
  assert.equal(artefactsHeld(p), 1);
  const xpAfterFirst = p.xp;
  T.pickLock({ player: p, objectId: T.HOUSES[1].drawer });
  assert.equal(p.messages.at(-1), T.MESSAGES.wrongDrawer);
  assert.equal(artefactsHeld(p), 1);
  assert.equal(p.xp, xpAfterFirst);
});

test("the rolls: 1/5 artefact, six houses, 500-1,000 coins", () => {
  assert.equal(T.rollReward(() => 0), 500);
  assert.equal(T.rollReward(() => 0.999999), 1000);
  assert.equal(T.rollReward(() => 0.5), 750);
  assert.equal(T.rollArtefact(() => 0), ARTEFACTS[0]);
  assert.equal(T.rollArtefact(() => 0.999999), ARTEFACTS[4]);
  const houses = new Set();
  for (let i = 0; i < 6; i++) houses.add(T.rollHouse(() => (i + 0.5) / 6).name);
  assert.equal(houses.size, 6);
});

test("handing the artefact in pays 500-1,000 coins and 40 x level exactly once", () => {
  const p = player({ thieving: 60 });
  T.assignTask(p, T.HOUSES[0]);
  T.giveArtefact(p, ARTEFACTS[3]);

  const request = { player: p, npcId: KHALED, stepId: T.DELIVER_STEP, handled: false };
  T.deliverStep(request, () => 0);
  assert.equal(request.handled, true);
  assert.equal(p.inventory.get(995), 500);
  assert.equal(p.xp, 40 * 60);
  assert.equal(artefactsHeld(p), 0);
  assert.equal(T.taskOf(p), null);
  assert.equal(T.failedOf(p), false);

  assert.equal(T.handIn(p, () => 0), 0, "nothing left to hand in");
  assert.equal(p.inventory.get(995), 500);
  assert.equal(p.xp, 2400);

  const q = player({ thieving: 60 });
  T.assignTask(q, T.HOUSES[1]);
  T.giveArtefact(q, ARTEFACTS[0]);
  const routed = { player: q, npcId: KHALED, stepId: T.DELIVER_STEP, handled: false };
  T.onDialogueAction(routed);
  assert.equal(routed.handled, true);
  assert.equal(artefactsHeld(q), 0);
  assert.ok(q.inventory.get(995) >= 500 && q.inventory.get(995) <= 1000);

  T.assignTask(p, T.HOUSES[3]);
  T.pickLock({ player: p, objectId: T.HOUSES[3].drawer });
  assert.equal(artefactsHeld(p), 1, "the drawer is ready for the next run");
});

test("an adjacent guard confiscates the artefact, relocates the player and fails the task", () => {
  const p = player({ thieving: 70 });
  T.assignTask(p, T.HOUSES[5]);
  T.giveArtefact(p, ARTEFACTS[0]);

  assert.equal(T.guardCatch(p), true);
  assert.equal(artefactsHeld(p), 0);
  assert.equal(T.taskOf(p), null);
  assert.equal(T.failedOf(p), true);
  assert.equal(p.messages.at(-1), T.MESSAGES.caught);
  assert.deepEqual(
    [p.moved.getX(), p.moved.getY(), p.moved.getZ()],
    [T.LEENZ_TILE.x, T.LEENZ_TILE.y, T.LEENZ_TILE.z]
  );
  assert.equal(T.guardCatch(p), false, "nothing left to confiscate");
});

test("teleporting, destroying or relogging with the artefact loses it and grants nothing", () => {
  const p = player({ thieving: 70 });
  T.assignTask(p, T.HOUSES[0]);
  T.giveArtefact(p, ARTEFACTS[4]);
  T.onCanTeleport({ player: p });
  assert.equal(artefactsHeld(p), 0);
  assert.equal(T.taskOf(p), null);
  assert.equal(T.failedOf(p), true);
  assert.equal(p.xp, 0);
  assert.equal(p.inventory.get(995) ?? 0, 0);

  const q = player({ thieving: 70 });
  T.assignTask(q, T.HOUSES[1]);
  const artefact = T.giveArtefact(q, ARTEFACTS[1]);
  const firstPass = { player: q, itemId: artefact, item: { getAmount: () => 1 }, slot: 3, dropToGround: true, handled: false };
  T.onItemDropPolicy(firstPass);
  assert.equal(firstPass.handled, false, "the confirmation pass owns the destroy");
  const confirm = { ...firstPass, dropToGround: false };
  T.onItemDropPolicy(confirm);
  assert.equal(confirm.handled, true);
  assert.deepEqual(q.deletedSlot, [3, 1]);
  assert.equal(T.taskOf(q), null);
  assert.equal(T.failedOf(q), true);

  const bank = { player: q, item: { getId: () => ARTEFACTS[2] }, allow: null };
  T.onCanBankItem(bank);
  assert.equal(bank.allow, false);
  assert.equal(q.messages.at(-1), T.MESSAGES.unbankable);

  const r = player({ thieving: 70, items: { [ARTEFACTS[0]]: 1 } });
  T.assignTask(r, T.HOUSES[2]);
  T.onPlayerLogin({ player: r });
  assert.equal(artefactsHeld(r), 0, "a saved artefact does not survive the login");
  assert.equal(T.failedOf(r), true);
});

test("variant selection follows the run, and the failure line plays once", () => {
  const p = player({ thieving: 70 });
  assert.equal(T.variantFor(p), "standard-dialogue");

  T.assignTask(p, T.HOUSES[3]);
  assert.equal(T.variantFor(p), "standard-dialogue-before-stealing-delivering-an-artefact");

  T.giveArtefact(p, ARTEFACTS[0]);
  assert.equal(T.variantFor(p), "standard-dialogue-delivering-the-artefact");

  T.loseArtefact(p);
  assert.equal(T.variantFor(p), "standard-dialogue-getting-caught-or-losing-the-artefact");
  assert.equal(T.failedOf(p), false, "the failure line is one-shot");
  assert.equal(T.variantFor(p), "standard-dialogue");
});

test("the transcript's [location] is filled from the assigned house", () => {
  const p = player({ thieving: 70 });
  T.assignTask(p, T.HOUSES[4]);
  const request = {
    player: p,
    npcId: KHALED,
    text: "You need to recover an artefact for me. It can be found in the [location].",
  };
  T.fillLocation(request);
  assert.equal(request.text, `You need to recover an artefact for me. It can be found in the ${T.HOUSES[4].label}.`);
});
