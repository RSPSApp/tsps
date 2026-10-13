// node --test tests/yama.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const Common = require("../plugins/bosses/yama/Common.Yama");

const VALUES = { 4151: 1_500_000, 11832: 15_000_000, 385: 200, 6585: 300_000 };
const hooks = { variants: [], custom: {}, npc: {}, login: [] };
let ironmanMode = "none";

const fakeApi = {
  core: {
    ItemDefinition: { forId: (id) => ({ getGrandExchangeValue: () => VALUES[id] ?? 0, isStackable: () => id === 995 }) },
    Item: class { constructor(id, amount) { this.id = id; this.amount = amount; } },
  },
  persistAttribute() {},
  onPlayerLogin(handler) { hooks.login.push(handler); },
  onNpcDialogueVariant(handler) { hooks.variants.push(handler); },
  onNpcDialogueCondition() {},
  onCustomEvent(name, handler) {
    (hooks.custom[name] ??= []).push(handler);
  },
  emitCustomEvent(name, payload) {
    if (name === "ironman:mode") payload.mode = ironmanMode;
    for (const handler of hooks.custom[name] ?? []) handler(payload);
  },
  onNpcInteraction(name, actions) { hooks.npc[name] = actions; },
  onObjectInteraction() {},
  onPlayerDeathItemDrop(handler) { hooks.drop = handler; },
  onPlayerDeath() {},
  onPlayerBeforeDeath() {},
  onNpcDeath() {},
};
Common.init(fakeApi);

const Voice = require("../plugins/bosses/yama/Voice.Yama");
const Throne = require("../plugins/bosses/yama/Throne.Yama");
const Fight = require("../plugins/bosses/yama/Fight.Yama");
Voice.attachVoice(fakeApi);
Throne.attachThrone(fakeApi);

function fakePlayer(attributes = {}) {
  const store = new Map(Object.entries(attributes));
  const varbits = new Map();
  return {
    varbits,
    getAttribute: (key) => store.get(key),
    setAttribute: (key, value) => store.set(key, value),
    getPacketSender: () => ({ sendVarbit: (id, value) => varbits.set(id, value) }),
  };
}

const variantFor = (player, npcId) => hooks.variants.map((hook) => hook({ player, npcId })).find(Boolean) ?? null;

test("the domain copies all of plane 0 and the captured plane-1 chunks", () => {
  const { width, height, plane1 } = Common.data.instance;
  assert.equal(plane1.length, height);
  assert.ok(plane1.every((row) => row.length === width));
  const plane1Chunks = plane1.join("").split("").filter((cell) => cell === "#").length;
  assert.equal(width * height + plane1Chunks, 113);
});

test("the Voice plays its first talk until the player has met it, then the short one", () => {
  const player = fakePlayer();
  assert.equal(variantFor(player, 14183), "standard-dialogue-first-time");
  fakeApi.emitCustomEvent("npc-dialogue:choice", { player, npcId: 14183, option: "Stay." });
  assert.equal(player.varbits.get(16284), 2);
  assert.equal(variantFor(player, 14185), "standard-dialogue-subsequent-times");
});

test("the Voice holds a death's items for the gravestone's fee, discounted for Yama's first 10 kills", () => {
  ironmanMode = "none";
  const fresh = fakePlayer();
  // 10,000 for the 1.5m item, 100,000 for the 15m one, 1,000 for the 300k one, nothing for food; 75% off.
  assert.equal(Voice.retrievalFee(fresh, [[4151, 1], [11832, 1], [6585, 1], [385, 20]]), Math.floor((10_000 + 100_000 + 1_000) * 0.25));
  const veteran = fakePlayer({ [Common.SUCCESS_COUNT_ATTRIBUTE]: 10 });
  assert.equal(Voice.retrievalFee(veteran, [[4151, 1]]), 10_000);
  assert.equal(Voice.retrievalFee(veteran, [[11832, 6]]), 500_000, "capped");
  ironmanMode = "hardcore";
  assert.equal(Voice.retrievalFee(veteran, [[4151, 1]]), 5_000, "half for an Ironman");
  ironmanMode = "none";
});

test("Yama greets by the contract and the last fight, once", () => {
  const Domain = require("../plugins/bosses/yama/Domain.Yama");
  const player = fakePlayer();
  assert.equal(variantFor(player, 124), null, "outside the domain the transcript picks");
  const original = Domain.sessionOf;
  Domain.sessionOf = () => ({});
  try {
    assert.equal(variantFor(player, 124), "standard-dialogue-first-time");
    player.setAttribute(Common.CONTRACT_OFFERED_ATTRIBUTE, true);
    assert.equal(variantFor(player, 124), "standard-dialogue-after-backing-out-from-signing-the-contract");
    player.setAttribute(Common.CONTRACT_SIGNED_ATTRIBUTE, true);
    assert.equal(variantFor(player, 124), "standard-dialogue-afterwards");
    player.setAttribute(Common.LAST_RESULT_ATTRIBUTE, "defeated");
    assert.equal(variantFor(player, 124), "standard-dialogue-after-battle-defeated");
    assert.equal(variantFor(player, 124), "standard-dialogue-afterwards", "said once");
  } finally {
    Domain.sessionOf = original;
  }
});

test("the contract follows Yama's lines", () => {
  const player = fakePlayer();
  fakeApi.emitCustomEvent("npc-dialogue:line", { player, npcId: 124, text: "Sign right here." });
  assert.equal(player.getAttribute(Common.CONTRACT_OFFERED_ATTRIBUTE), true);
  assert.notEqual(player.getAttribute(Common.CONTRACT_SIGNED_ATTRIBUTE), true);
  fakeApi.emitCustomEvent("npc-dialogue:line", { player, npcId: 124, text: "Excellent... Challenge me when you are ready, Bob. I very much look forward to it." });
  assert.equal(player.getAttribute(Common.CONTRACT_SIGNED_ATTRIBUTE), true);
});

test("fight lengths print as m:ss", () => {
  assert.equal(Fight.formatTicks(92), "0:55");
  assert.equal(Fight.formatTicks(175), "1:45");
});

test("a death in the domain leaves the items with the Voice, who hands them back for the fee", () => {
  const Domain = require("../plugins/bosses/yama/Domain.Yama");
  const inventory = new Map([[995, 5_000]]);
  const player = fakePlayer();
  player.messages = [];
  player.sendMessage = (text) => player.messages.push(text);
  player.getInventory = () => ({
    getAmount: (id) => inventory.get(id) ?? 0,
    delete: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
    contains: (id) => inventory.has(id),
    getFreeSlots: () => 20,
    add: (item) => inventory.set(item.id, (inventory.get(item.id) ?? 0) + item.amount),
    refreshItems() {},
  });
  const original = Domain.sessionOf;
  Domain.sessionOf = () => ({});
  try {
    const drop = { player, item: { getId: () => 4151, getAmount: () => 1 }, dropEligible: true, shouldDropItems: true, handled: false };
    hooks.drop(drop);
    assert.equal(drop.handled, true, "nothing drops in the domain");
  } finally {
    Domain.sessionOf = original;
  }
  assert.deepEqual(player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE).items, [[4151, 1]]);
  // 10,000 for the 1.5m item, 75% off: 2,500 of the 5,000 coins.
  assert.equal(hooks.npc["Voice of Yama"]["Talk-to"]({ player }), true);
  assert.equal(inventory.get(995), 2_500);
  assert.equal(inventory.get(4151), 1);
  assert.equal(player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE), null);
});

test("an unsafe death elsewhere loses what the Voice holds", () => {
  const player = fakePlayer({ [Common.HELD_ITEMS_ATTRIBUTE]: { items: [[4151, 1]], paid: false } });
  player.sendMessage = () => {};
  hooks.drop({ player, item: { getId: () => 1, getAmount: () => 1 }, dropEligible: true, shouldDropItems: true });
  assert.equal(player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE), null);
});

const Hazards = require("../plugins/bosses/yama/Hazards.Yama");
const Attacks = require("../plugins/bosses/yama/Attacks.Yama");

test("a cardinal Shadow Crash's shadows cover the captured bowtie", () => {
  const cells = Hazards.bowtie([0, 1], 3);
  const rows = new Map();
  for (const { dx, dy } of cells) rows.set(dy, (rows.get(dy) ?? 0) + 1);
  // As captured: 7 wide three tiles out, 5 at two, 3 at one, the centre alone.
  assert.deepEqual([3, 2, 1, 0, -1, -2, -3].map((dy) => rows.get(dy)), [7, 5, 3, 1, 3, 5, 7]);
  const delays = new Map(cells.map(({ dx, dy, delay }) => [`${dx},${dy}`, delay]));
  assert.equal(delays.get("0,0"), 30);
  assert.equal(delays.get("3,3"), 8);
  // One step to the side of the centre is out of it (Wiki: the dodge).
  assert.ok(!cells.some(({ dx, dy }) => dx === 1 && dy === 0));
});

test("a shadow wave reaches each tile at its captured step", () => {
  // The south-east wave as captured: the east edge first, the north-west corner last.
  assert.equal(Hazards.waveStep("southEast", 1516, 10074), 10);
  assert.equal(Hazards.waveStep("southEast", 1489, 10074), 37);
  assert.equal(Hazards.waveStep("southEast", 1499, 10093), 46);
  // The south-west one, as captured: a step behind the mirror of it.
  assert.equal(Hazards.waveStep("southWest", 1489, 10074), 11);
  // A pair shifted a column east crosses a column further east.
  const crossing = (shift) => {
    for (let x = 1480; x < 1530; x++) {
      if (Hazards.waveStep("southEast", x, 10080, shift) === Hazards.waveStep("southWest", x, 10080, shift)) return x;
    }
    return null;
  };
  assert.equal(crossing(1), crossing(0) + 1);
});

test("void flares stand in for one shadow special a phase, where the Wiki says", () => {
  for (let i = 0; i < 50; i++) {
    const fight = {};
    const firstSpecial = Attacks.startRotation(fight);
    const allowed = firstSpecial === "shadow" ? [3, 5] : [2, 4];
    assert.ok(allowed.includes(fight.rotation.flareSlot), `${firstSpecial} first: slot ${fight.rotation.flareSlot}`);
    assert.equal(firstSpecial, Attacks.OTHER[fight.rotation.opening]);
  }
});
