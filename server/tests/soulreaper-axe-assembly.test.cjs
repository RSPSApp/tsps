// Run after `yarn build`: node --test tests/soulreaper-axe-assembly.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Skill } = require("../dist/game/model/Skill");
const { ChatType } = require("../dist/net/protocol/ClientProtocol");
const SoulreaperAxe = require("../plugins/items/SoulreaperAxe.plugin");

let api;
before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  api = PluginManager.createApi("SoulreaperAxeRegression");
  SoulreaperAxe.register(api);
});

const GAMEVALS = ["soulreaper_axe_head", "soulreaper_axe_eye", "soulreaper_axe_staff", "soulreaper_axe_lure"];
const piece = (gameval) => CacheDefinitions.getObjId(gameval);

/** Slots hold [id, amount]; deleteNumber/adds work on them like the real inventory (first free slot). */
function fakePlayer({ magic = 99, slots = [] } = {}) {
  const inv = new Array(28).fill(null);
  slots.forEach(([slot, id, amount], index) => { inv[slot ?? index] = [id, amount]; });
  const boxes = [];
  const typed = [];
  const xp = [];
  const animations = [];
  const graphics = [];
  const sounds = [];
  let prompt = null;
  const player = {
    inv, boxes, typed, xp, animations, graphics, sounds,
    get prompt() { return prompt; },
    getSkillManager: () => ({
      getMaxLevel: (skill) => (skill === Skill.MAGIC ? magic : 99),
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    getInventory: () => ({
      contains: (id) => inv.some((s) => s && s[0] === id),
      getAmount: (id) => inv.reduce((n, s) => n + (s && s[0] === id ? s[1] : 0), 0),
      deleteNumber: (id, amount) => {
        for (let i = 0; i < inv.length && amount > 0; i++) {
          if (!inv[i] || inv[i][0] !== id) continue;
          const take = Math.min(amount, inv[i][1]);
          inv[i][1] -= take;
          amount -= take;
          if (inv[i][1] === 0) inv[i] = null;
        }
      },
      adds: (id, amount) => { inv[inv.indexOf(null)] = [id, amount]; },
    }),
    getPacketSender: () => ({
      sendTypedMessage: (type, text) => typed.push([type, text]),
      sendSoundEffect: (id) => sounds.push(id),
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => boxes.push(chain) }),
    performAnimation: (a) => animations.push(a.getId?.() ?? a.id ?? a),
    performGraphic: (g) => graphics.push(g.getId?.() ?? g.id ?? g),
  };
  return player;
}

function withPrompt(fn) {
  const original = api.sendMultiChatboxPrompt;
  let captured = null;
  api.sendMultiChatboxPrompt = (player, question, ...options) => { captured = { question, options }; };
  try {
    fn();
  } finally {
    api.sendMultiChatboxPrompt = original;
  }
  return captured;
}

/** Capture 1754's inventory: the lure, head, eye and staff in slots 6, 8, 9 and 10, runes in 12, the rest full. */
function capturedInventory(bloodRunes) {
  const slots = [0, 1, 2, 3, 4, 5, 7, 11].map((slot) => [slot, ItemIdentifiers.SHARK, 1]);
  slots.push(
    [6, piece("soulreaper_axe_lure"), 1],
    [8, piece("soulreaper_axe_head"), 1],
    [9, piece("soulreaper_axe_eye"), 1],
    [10, piece("soulreaper_axe_staff"), 1],
  );
  if (bloodRunes > 0) slots.push([12, ItemIdentifiers.BLOOD_RUNE, bloodRunes]);
  return slots;
}

test("the four components and the axe resolve from the cache by gameval", () => {
  const ids = SoulreaperAxe._test.resolve();
  assert.equal(ids.axe, 28338);
  assert.deepEqual(ids.components.map((entry) => entry.id), [28319, 28321, 28323, 28325]);
  assert.deepEqual(GAMEVALS.map((g) => ItemDefinition.forId(piece(g)).getName()),
    ["Executioner's axe head", "Eye of the Duke", "Siren's staff", "Leviathan's lure"]);
});

test("the plugin's hook names and the Inspect option match each component in the cache", () => {
  for (const [gameval, name] of SoulreaperAxe._test.COMPONENTS) {
    const id = piece(gameval);
    assert.equal(name, ItemDefinition.forId(id).getName(), gameval);
    assert.ok(CacheDefinitions.getItem(id).inventoryActions.includes("Inspect"), `${gameval} has Inspect`);
  }
});

test("Inspect shows each component's captured line in an item box and the chatbox", () => {
  const expected = {
    soulreaper_axe_head: "It's the head of Vardorvis' axe. You might be able to combine it with something else.",
    soulreaper_axe_eye: "It's one of Duke Sucellus' many eyes. You might be able to combine it with something else.",
    soulreaper_axe_staff: "It's a staff taken from the Whisperer. You might be able to combine it with something else.",
    soulreaper_axe_lure: "It's the lure of the Leviathan. You might be able to combine it with something else.",
  };
  for (const [gameval, text] of Object.entries(expected)) {
    const player = fakePlayer();
    assert.equal(SoulreaperAxe._test.inspect({ player, itemId: piece(gameval) }), true);
    assert.deepEqual(player.typed, [[ChatType.MESBOX, text]]);
    assert.equal(player.boxes.length, 1);
  }
  assert.equal(SoulreaperAxe._test.inspect({ player: fakePlayer(), itemId: ItemIdentifiers.BLOOD_RUNE }), false);
});

test("two components without the other two: the Wiki's missing-components box", () => {
  const head = piece("soulreaper_axe_head");
  const eye = piece("soulreaper_axe_eye");
  const player = fakePlayer({ slots: [[0, head, 1], [1, eye, 1], [2, ItemIdentifiers.BLOOD_RUNE, 5000]] });
  const prompt = withPrompt(() => assert.equal(SoulreaperAxe._test.combine({ player, usedItemId: head, usedWithItemId: eye }), true));
  assert.equal(prompt, null);
  assert.deepEqual(player.typed, [[ChatType.MESBOX,
    "You don't have enough components to make anything useful. It looks like you'll need four separate components."]]);
  assert.ok(player.getInventory().contains(head) && player.getInventory().contains(eye));
});

test("all four components and 1,999 blood runes: the captured blood-rune box, nothing taken", () => {
  const player = fakePlayer({ slots: capturedInventory(1999) });
  const prompt = withPrompt(() => SoulreaperAxe._test.combine({ player, usedItemId: piece("soulreaper_axe_head"), usedWithItemId: piece("soulreaper_axe_eye") }));
  assert.equal(prompt, null);
  assert.deepEqual(player.typed, [[ChatType.MESBOX, "Assembling those items will require the power of 2,000 blood runes."]]);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.BLOOD_RUNE), 1999);
});

test("Magic below 75 is refused before the prompt", () => {
  const player = fakePlayer({ magic: 74, slots: capturedInventory(2000) });
  const prompt = withPrompt(() => SoulreaperAxe._test.combine({ player, usedItemId: piece("soulreaper_axe_staff"), usedWithItemId: piece("soulreaper_axe_lure") }));
  assert.equal(prompt, null);
  assert.equal(player.typed.length, 1);
  assert.match(player.typed[0][1], /Magic level of 75/);
});

test("with everything, Create a Soulreaper axe? Yes. assembles it as captured", () => {
  const player = fakePlayer({ slots: capturedInventory(2000) });
  const prompt = withPrompt(() => SoulreaperAxe._test.combine({ player, usedItemId: piece("soulreaper_axe_head"), usedWithItemId: piece("soulreaper_axe_eye") }));
  assert.equal(prompt.question, "Create a Soulreaper axe?");
  assert.equal(prompt.options[0], "Yes.");
  assert.equal(prompt.options[2], "No.");
  assert.equal(player.typed.length, 0, "nothing shown before the answer");

  prompt.options[1]();
  // Capture 1754 tick 4096: the axe lands in slot 6, slots 8, 9, 10 and 12 empty.
  assert.deepEqual(player.inv[6], [28338, 1]);
  for (const slot of [8, 9, 10, 12]) assert.equal(player.inv[slot], null, `slot ${slot}`);
  assert.deepEqual(player.xp, [[Skill.MAGIC, 400]]);
  assert.deepEqual(player.sounds, [140, 1613]);
  assert.equal(player.animations.length, 1);
  assert.equal(player.graphics.length, 1);
  assert.deepEqual(player.typed, [[ChatType.MESBOX, "You successfully assemble the four components into a Soulreaper axe."]]);
});

test("No. takes nothing, and Yes. after a component left the inventory does nothing", () => {
  let player = fakePlayer({ slots: capturedInventory(2000) });
  let prompt = withPrompt(() => SoulreaperAxe._test.combine({ player, usedItemId: piece("soulreaper_axe_head"), usedWithItemId: piece("soulreaper_axe_eye") }));
  prompt.options[3]();
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.BLOOD_RUNE), 2000);

  player = fakePlayer({ slots: capturedInventory(2000) });
  prompt = withPrompt(() => SoulreaperAxe._test.combine({ player, usedItemId: piece("soulreaper_axe_head"), usedWithItemId: piece("soulreaper_axe_eye") }));
  player.inv[10] = null; // the staff dropped while the menu was open
  prompt.options[1]();
  assert.equal(player.getInventory().contains(28338), false);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.BLOOD_RUNE), 2000);
  assert.deepEqual(player.xp, []);
});

test("a component used on something else falls through", () => {
  const player = fakePlayer({ slots: capturedInventory(2000) });
  assert.equal(SoulreaperAxe._test.combine({ player, usedItemId: piece("soulreaper_axe_head"), usedWithItemId: ItemIdentifiers.BLOOD_RUNE }), false);
});
