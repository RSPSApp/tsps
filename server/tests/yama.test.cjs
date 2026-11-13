// node --test tests/yama.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const Common = require("../plugins/bosses/yama/Common.Yama");

const VALUES = { 4151: 1_500_000, 11832: 15_000_000, 385: 200, 6585: 300_000 };
const hooks = { variants: [], custom: {}, npc: {}, login: [], item: {} };
let ironmanMode = "none";
let aKingdomDividedComplete = false;

const fakeApi = {
  core: {
    ItemDefinition: { forId: (id) => ({ getGrandExchangeValue: () => VALUES[id] ?? 0, isStackable: () => id === 995 }) },
    Item: class { constructor(id, amount, meta) { this.id = id; this.amount = amount; this.meta = meta; } },
    ItemIdentifiers: { FORGOTTEN_LOCKBOX: 30763 },
    DialogueChainBuilder: class { constructor() { this.dialogues = []; } add(...d) { this.dialogues.push(...d); return this; } },
    ItemStatementDialogue: class { constructor(index, itemId, text) { this.itemId = itemId; this.text = text; } },
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
    if (name === "quest:is-complete" && payload.key === "a_kingdom_divided") payload.complete = aKingdomDividedComplete;
    for (const handler of hooks.custom[name] ?? []) handler(payload);
  },
  onNpcInteraction(name, actions) { hooks.npc[name] = actions; },
  onItemAction(name, actions) { hooks.item[name] = actions; },
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
const Lockbox = require("../plugins/bosses/yama/Lockbox.Yama");
Voice.attachVoice(fakeApi);
Throne.attachThrone(fakeApi);
Lockbox.attachLockbox(fakeApi);

function fakePlayer(attributes = {}) {
  const store = new Map(Object.entries(attributes));
  const varbits = new Map();
  return {
    varbits,
    getAttribute: (key) => store.get(key),
    setAttribute: (key, value) => store.set(key, value),
    sendMessage(text) { this.message = text; },
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

test("Yama's domain requires A Kingdom Divided", () => {
  const Domain = require("../plugins/bosses/yama/Domain.Yama");
  const player = fakePlayer();
  aKingdomDividedComplete = false;
  assert.equal(Domain.canEnter(player), false);
  assert.equal(Domain.enter(player), false);
  assert.match(player.message, /complete A Kingdom Divided/i);
  aKingdomDividedComplete = true;
  assert.equal(Domain.canEnter(player), true);
  aKingdomDividedComplete = false;
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
    getAddableAmount: (item) => Math.min(item.amount, 2147483647 - (inventory.get(item.id) ?? 0)),
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
  assert.deepEqual(player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE).items, [[4151, 1, null]]);
  // 10,000 for the 1.5m item, 75% off: 2,500 of the 5,000 coins.
  assert.equal(hooks.npc["Voice of Yama"]["Talk-to"]({ player }), true);
  assert.equal(inventory.get(995), 2_500);
  assert.equal(inventory.get(4151), 1);
  assert.equal(player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE), null);
});

test("a death while the Voice still holds a paid-for remainder is charged again, as a gravestone's merge is", () => {
  const Domain = require("../plugins/bosses/yama/Domain.Yama");
  const inventory = new Map([[995, 20_000]]);
  const player = fakePlayer({ [Common.HELD_ITEMS_ATTRIBUTE]: { items: [[385, 5]], paid: true } });
  player.messages = [];
  player.sendMessage = (text) => player.messages.push(text);
  player.getInventory = () => ({
    getAmount: (id) => inventory.get(id) ?? 0,
    delete: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
    contains: (id) => inventory.has(id),
    getFreeSlots: () => 20,
    getAddableAmount: (item) => Math.min(item.amount, 2147483647 - (inventory.get(item.id) ?? 0)),
    add: (item) => inventory.set(item.id, (inventory.get(item.id) ?? 0) + item.amount),
    refreshItems() {},
  });
  const original = Domain.sessionOf;
  Domain.sessionOf = () => ({});
  try {
    hooks.drop({ player, item: { getId: () => 4151, getAmount: () => 1 }, dropEligible: true, shouldDropItems: true, handled: false });
  } finally {
    Domain.sessionOf = original;
  }
  assert.equal(player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE).paid, false, "the new death's items are not already paid for");
  hooks.npc["Voice of Yama"]["Talk-to"]({ player });
  assert.equal(inventory.get(4151), 1);
  assert.ok(inventory.get(995) < 20_000, "the fee is taken for the merged lot");
});

test("the Voice hands an item back with its meta (charges), as it was when the player died", () => {
  const Domain = require("../plugins/bosses/yama/Domain.Yama");
  const inventory = new Map([[995, 20_000]]);
  const added = [];
  const player = fakePlayer();
  player.sendMessage = () => {};
  player.getInventory = () => ({
    getAmount: (id) => inventory.get(id) ?? 0,
    delete: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
    contains: (id) => inventory.has(id),
    getFreeSlots: () => 20,
    getAddableAmount: (item) => item.amount,
    add: (item) => added.push(item),
    refreshItems() {},
  });
  const original = Domain.sessionOf;
  Domain.sessionOf = () => ({});
  try {
    hooks.drop({ player, item: { getId: () => 6585, getAmount: () => 1, getMeta: () => ({ charges: 30000 }) }, dropEligible: true, shouldDropItems: true, handled: false });
  } finally {
    Domain.sessionOf = original;
  }
  hooks.npc["Voice of Yama"]["Talk-to"]({ player });
  assert.equal(added.length, 1);
  assert.equal(added[0].id, 6585);
  assert.deepEqual(added[0].meta, { charges: 30000 });
});

test("a domain death's grave (for what the Voice doesn't hold) is by the Voice, with Yama's discount", () => {
  const Domain = require("../plugins/bosses/yama/Domain.Yama");
  const player = fakePlayer();
  const original = Domain.sessionOf;
  Domain.sessionOf = () => ({});
  const request = { player, location: null, tile: null, feeMultiplier: 1 };
  try {
    fakeApi.emitCustomEvent("gravestones:grave-location", request);
  } finally {
    Domain.sessionOf = original;
  }
  const [x, y, z = 0] = Common.data.voice.respawn;
  assert.deepEqual(request.tile, { x, y, z });
  assert.equal(request.feeMultiplier, Common.data.retrieval.discountFactor);
  const outside = { player, location: null, tile: null, feeMultiplier: 1 };
  fakeApi.emitCustomEvent("gravestones:grave-location", outside);
  assert.equal(outside.tile, null, "a death elsewhere is left alone");
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

test("the Forgotten lockbox rolls the Wiki table's 403 chances", () => {
  const { entries } = Common.data.lockbox;
  assert.equal(entries.reduce((sum, entry) => sum + entry.weight, 0), 403);
  assert.deepEqual(entries.map((entry) => [entry.itemId, entry.amount, entry.weight]), [
    [21930, 125, 60], [11230, 125, 60], [30765, 14, 60],
    [11230, 80, 50], [30765, 11, 50], [4087, 1, 50], [4585, 1, 50],
    [995, 233333, 20], [30750, 1, 1], [30753, 1, 1], [30756, 1, 1],
  ]);
});

test("opening a Forgotten lockbox consumes it and gives its reward", () => {
  const inventory = new Map([[30763, 1]]);
  const player = {
    message: null,
    getLocation: () => ({ getX: () => 1640, getY: () => 3700, getZ: () => 0 }), // off Entrana
    getInventory: () => ({
      contains: (id) => (inventory.get(id) ?? 0) > 0,
      delete: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
      forceAdd: (_player, item) => inventory.set(item.id, (inventory.get(item.id) ?? 0) + item.amount),
      refreshItems() {},
    }),
    sendMessage(text) { this.message = text; },
    getDialogueManager: () => ({ startDialogues(builder) { player.box = builder.dialogues[0]; } }),
  };
  const open = hooks.item["Forgotten lockbox"].Open;
  assert.equal(open({ player, itemId: 30763 }), true);
  assert.equal(inventory.get(30763), 0, "the lockbox is consumed");
  const rewards = [...inventory.entries()].filter(([id]) => id !== 30763);
  assert.equal(rewards.length, 1, "one reward");
  const [itemId, amount] = rewards[0];
  const entry = Common.data.lockbox.entries.find((row) => row.itemId === itemId && row.amount === amount);
  assert.ok(entry, `${itemId}x${amount} is on the Wiki table`);
  // Wiki Transcript:Forgotten lockbox: an item box with the reward, not a chat line.
  assert.equal(player.message, null);
  assert.deepEqual([player.box.itemId, player.box.text], [entry.itemId, entry.message]);
  assert.equal(open({ player, itemId: 30764 }), false, "only the lockbox's own Open is handled");
});

test("Yama's specials use the Wiki's damage numbers", () => {
  const { specials, flares, judge } = Common.data;
  assert.equal(specials.rockfall.maxHit, 46);
  assert.equal(specials.spike.maxHit, 46);
  assert.deepEqual(specials.meteor.byDistance, [[1, "kill"], [2, 80], [3, 40]]);
  assert.equal(specials.stomp.maxHit, 80);
  assert.deepEqual(flares.damage["1"], [42, 45]);
  assert.deepEqual(flares.damage["3"], [23, 25]);
  assert.equal(judge.surge.maxHit, 30);
});

test("the oathplate legs line is the transcript's, 1 with no x (Wiki Transcript:Forgotten lockbox)", () => {
  const legs = Common.data.lockbox.entries.find((row) => row.itemId === 30756);
  assert.equal(legs.message, "You open the forgotten lockbox and find 1 oathplate legs inside!");
});
