// Run after `yarn build`: node --test tests/broken-items.test.cjs
// Breakable untradeables on a PvP death, and Perdu's repairs, locks and unlocks (docs/broken-items.md).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { PlayerDeathTask } = require('../dist/game/task/impl/PlayerDeath');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const { Location } = require('../dist/game/model/Location');
const { PlayerRights } = require('../dist/game/model/rights/PlayerRights');
const Common = require('../plugins/items/brokenitems/Common.BrokenItems');
const Death = require('../plugins/items/brokenitems/Death.BrokenItems');
const Perdu = require('../plugins/items/brokenitems/Perdu.BrokenItems');

const core = PluginManager.getCoreApi();
const { Item, ItemIdentifiers: I } = core;
const COINS = I.COINS;

const EDGEVILLE = new Location(3090, 3490, 0);
const WILDERNESS_10 = new Location(3090, 3600, 0);
const WILDERNESS_30 = new Location(3090, 3760, 0);

/** Prompts the plugin sent, newest last: { title, options: [[text, callback], ...] }. */
const prompts = [];
let bankTab = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  const Bank = { getTabForItem: () => (bankTab ? 0 : -1) };
  Common.init({
    core: { ...core, Bank },
    sendMultiChatboxPrompt(player, title, ...pairs) {
      const options = [];
      for (let i = 0; i < pairs.length; i += 2) options.push([pairs[i], pairs[i + 1]]);
      prompts.push({ title, options });
      return true;
    },
  });
});

function container(items) {
  const slots = Array.from({ length: 28 }, (_, i) => items[i] ?? new Item(-1, 0));
  const self = {
    slots,
    getItems: () => slots,
    getValidItems: () => slots.filter((item) => item.getId() > 0),
    resetItems: () => self,
    getAmount: (id) => slots.reduce((sum, item) => sum + (item.getId() === id ? item.getAmount() : 0), 0),
    contains: (id) => slots.some((item) => item.getId() === id),
    getFreeSlots: () => slots.filter((item) => item.getId() === -1).length,
    deleteNumber(id, amount) {
      for (const item of slots) {
        if (amount <= 0 || item.getId() !== id) continue;
        const taken = Math.min(amount, item.getAmount());
        amount -= taken;
        if (taken === item.getAmount()) { item.setId(-1); item.setAmount(0); } else item.setAmount(item.getAmount() - taken);
      }
      return self;
    },
    adds(id, amount) {
      const stack = slots.find((item) => item.getId() === id && item.getDefinition().isStackable());
      if (stack) stack.setAmount(stack.getAmount() + amount);
      else { const free = slots.find((item) => item.getId() === -1); free.setId(id); free.setAmount(amount); }
      return self;
    },
    refreshItems: () => self,
  };
  return self;
}

function fakePlayer({ items = [], bank = [], location = EDGEVILLE } = {}) {
  const inventory = container(items);
  const bankContainer = container(bank);
  const messages = [];
  const dialogues = [];
  return {
    inventory, bank: bankContainer, messages, dialogues,
    getInventory: () => inventory,
    getBank: () => bankContainer,
    getLocation: () => location,
    sendMessage: (text) => messages.push(text),
    getDialogueManager: () => ({ startDialogues: (builder) => dialogues.push(builder) }),
  };
}

const ids = (player) => player.inventory.slots.filter((item) => item.getId() > 0).map((item) => [item.getId(), item.getAmount()]);

function deathDrop(player, item, { killer, kept = false } = {}) {
  const drops = [];
  const register = ItemOnGroundManager.registerLocation;
  ItemOnGroundManager.registerLocation = (owner, dropped) => drops.push([owner, dropped.getId(), dropped.getAmount()]);
  const event = { player, killer: killer ?? null, item, kept, location: player.getLocation(), handled: false };
  try {
    Death.breakOnPvpDeath(event);
  } finally {
    ItemOnGroundManager.registerLocation = register;
  }
  return { event, drops };
}

test('a PvM death breaks nothing (Wiki: "Goes to the gravestone without breaking")', () => {
  for (const location of [EDGEVILLE, WILDERNESS_10]) {
    const cape = new Item(I.FIRE_CAPE, 1);
    const { event, drops } = deathDrop(fakePlayer({ location }), cape);
    assert.equal(cape.getId(), I.FIRE_CAPE);
    assert.equal(event.handled, false);
    assert.deepEqual(drops, []);
  }
});

test('a protected item never breaks, even on a PvP death', () => {
  const killer = fakePlayer();
  const torso = new Item(I.FIGHTER_TORSO, 1);
  const { drops } = deathDrop(fakePlayer({ location: WILDERNESS_10 }), torso, { killer, kept: true });
  assert.equal(torso.getId(), I.FIGHTER_TORSO);
  assert.deepEqual(drops, []);
});

test('up to level 20 an unprotected item breaks and the killer gets its repair cost', () => {
  const killer = fakePlayer();
  for (const [id, broken, cost] of [[I.FIRE_CAPE, I.FIRE_CAPE_BROKEN_, 150000], [I.DRAGON_DEFENDER, I.DRAGON_DEFENDER_BROKEN_, 240000],
    [I.INFERNAL_CAPE, I.INFERNAL_CAPE_BROKEN_, 225000], [I.INFERNAL_CAPE_L_, I.INFERNAL_CAPE_L_BROKEN_, 225000]]) {
    const item = new Item(id, 1);
    const { event, drops } = deathDrop(fakePlayer({ location: WILDERNESS_10 }), item, { killer });
    assert.equal(item.getId(), broken);
    assert.equal(event.handled, false, 'kept by the victim, broken');
    assert.deepEqual(drops, [[killer, COINS, cost]]);
  }
});

test('above level 20 an unlocked lockable item is lost, a locked one mangled, the rest still break', () => {
  const killer = fakePlayer();
  const lost = new Item(I.VOID_KNIGHT_TOP, 1);
  let result = deathDrop(fakePlayer({ location: WILDERNESS_30 }), lost, { killer });
  assert.equal(result.event.handled, true);
  assert.deepEqual(result.drops, [[killer, COINS, 180000]]);

  const locked = new Item(I.VOID_KNIGHT_TOP_L_, 1);
  result = deathDrop(fakePlayer({ location: WILDERNESS_30 }), locked, { killer });
  assert.equal(locked.getId(), I.VOID_KNIGHT_TOP_L_MANGLED_);
  assert.deepEqual(result.drops, [[killer, COINS, 500000]]);

  const cape = new Item(I.FIRE_CAPE, 1);
  result = deathDrop(fakePlayer({ location: WILDERNESS_30 }), cape, { killer });
  assert.equal(cape.getId(), I.FIRE_CAPE_BROKEN_, 'Perdu cannot lock a fire cape, so it is never lost');
  assert.deepEqual(result.drops, [[killer, COINS, 150000]]);
});

test("Dizana's quivers and rune pouches are left to their own plugins", () => {
  const killer = fakePlayer();
  for (const id of [I.DIZANAS_QUIVER, I.RUNE_POUCH]) {
    const item = new Item(id, 1);
    const { drops } = deathDrop(fakePlayer({ location: WILDERNESS_30 }), item, { killer });
    assert.equal(item.getId(), id);
    assert.deepEqual(drops, []);
  }
});

test('the death task tells the per-item hook which items are kept', () => {
  const kept = new Item(I.ABYSSAL_WHIP, 1);
  const lost = new Item(I.FIRE_CAPE, 1);
  const seen = [];
  const original = PluginManager.emitPlayerDeathItemDrop;
  const emitDrops = PluginManager.emitPlayerDeathDrops;
  const register = ItemOnGroundManager.registerLocation;
  const inventory = container([kept, lost]);
  const equipment = container([]);
  const player = {
    getInventory: () => inventory,
    getEquipment: () => equipment,
    getSkullTimer: () => 100,
    getSkullType: () => 0,
    getSkillManager: () => ({ getMaxLevel: () => 99, getCurrentLevel: () => 99 }),
    getPrayerActive: () => new Array(40).fill(true),
    getLocation: () => EDGEVILLE,
    getRights: () => PlayerRights.NONE,
    getAttribute: () => undefined,
    getUsername: () => 'victim',
  };
  try {
    PluginManager.emitPlayerDeathItemDrop = (event) => { seen.push([event.item.getId(), event.kept]); return false; };
    PluginManager.emitPlayerDeathDrops = () => {};
    ItemOnGroundManager.registerLocation = () => null;
    PlayerDeathTask.dropItems(player, null, EDGEVILLE);
  } finally {
    PluginManager.emitPlayerDeathItemDrop = original;
    PluginManager.emitPlayerDeathDrops = emitDrops;
    ItemOnGroundManager.registerLocation = register;
  }
  // Skulled with Protect Item: only the most valuable (the whip) is kept.
  assert.deepEqual(seen, [[I.ABYSSAL_WHIP, true], [I.FIRE_CAPE, false]]);
});

const PERDU = { getCurrentDefinition: () => ({ getName: () => 'Perdu' }) };

function useOnPerdu(player, slot) {
  const item = player.inventory.slots[slot];
  const event = { player, target: PERDU, npcId: 7457, slot, item, itemId: item.getId(), handled: false };
  Perdu._test.useOnPerdu(event);
  assert.equal(event.handled, true);
}

/** Runs a started dialogue's lines and returns their text; runs its closing prompt too. */
function lines(builder) {
  return [...builder.getDialogues().values()].map((dialogue) => {
    if (dialogue.getText) return dialogue.getText();
    dialogue.send();
    return null;
  }).filter(Boolean);
}

function choose(text) {
  const prompt = prompts.at(-1);
  const option = prompt.options.find(([label]) => label === text);
  assert.ok(option, `${text} in ${prompt.options.map(([label]) => label)}`);
  option[1]();
}

test('Perdu repairs a broken item for its fee, from the inventory or the bank', () => {
  const player = fakePlayer({ items: [new Item(I.FIRE_CAPE_BROKEN_, 1), new Item(COINS, 200000)] });
  useOnPerdu(player, 0);
  assert.deepEqual(prompts.at(-1).options.map(([label]) => label), ['Repair that item: 150,000 coins.', 'Cancel.']);
  choose('Repair that item: 150,000 coins.');
  assert.deepEqual(ids(player), [[I.FIRE_CAPE, 1], [COINS, 50000]]);

  bankTab = true;
  const banked = fakePlayer({ items: [new Item(I.VOID_KNIGHT_TOP_L_MANGLED_, 1)], bank: [new Item(COINS, 600000)] });
  useOnPerdu(banked, 0);
  choose('Repair that item: 500,000 coins.');
  assert.deepEqual(ids(banked), [[I.VOID_KNIGHT_TOP_L_, 1]], 'a mangled item repairs into its locked form');
  assert.equal(banked.bank.getAmount(COINS), 100000);
  bankTab = null;

  const poor = fakePlayer({ items: [new Item(I.FIRE_CAPE_BROKEN_, 1), new Item(COINS, 1000)] });
  useOnPerdu(poor, 0);
  choose('Repair that item: 150,000 coins.');
  assert.deepEqual(ids(poor), [[I.FIRE_CAPE_BROKEN_, 1], [COINS, 1000]]);
  assert.equal(poor.messages.length, 1);
});

test('Perdu repairs every broken item at once', () => {
  const player = fakePlayer({ items: [new Item(I.FIRE_CAPE_BROKEN_, 1), new Item(I.DRAGON_DEFENDER_BROKEN_, 1), new Item(COINS, 400000)] });
  useOnPerdu(player, 1);
  choose('Repair all items: 390,000 coins.');
  assert.deepEqual(ids(player), [[I.FIRE_CAPE, 1], [I.DRAGON_DEFENDER, 1], [COINS, 10000]]);
});

test("a broken Dizana's quiver repairs uncharged for 270,000 coins", () => {
  const player = fakePlayer({ items: [new Item(I.DIZANAS_QUIVER_BROKEN_, 1), new Item(COINS, 270000)] });
  useOnPerdu(player, 0);
  choose('Repair that item: 270,000 coins.');
  assert.deepEqual(ids(player), [[I.DIZANAS_QUIVER_UNCHARGED_, 1]]);
});

test('Perdu locks an item for a Trouver parchment and 500,000 coins (rsprox)', () => {
  const parchment = Common.idOf('Trouver parchment');
  const without = fakePlayer({ items: [new Item(I.FIGHTER_TORSO, 1)] });
  useOnPerdu(without, 0);
  assert.deepEqual(lines(without.dialogues[0]), [
    "I can lock that item so that it won't vanish if you die in deep Wilderness, but I'll need a Trouver parchment.",
    'Perdu tells you about a merchant in Ferox Enclave who sells special scrolls called Trouver Parchments.',
    "You'll find her in Ferox Enclave, where people play a game called Last Man Standing. Bring the parchment here, then show me the item again.",
  ]);

  const player = fakePlayer({ items: [new Item(I.FIGHTER_TORSO, 1), new Item(parchment, 1), new Item(COINS, 500000)] });
  useOnPerdu(player, 0);
  assert.deepEqual(lines(player.dialogues[0]), [
    "I can lock that item so that it won't vanish if you die in deep Wilderness. It'll cost you 500,000 coins and a Trouver parchment.",
  ]);
  assert.deepEqual(prompts.at(-1), { title: 'Select an option', options: prompts.at(-1).options });
  assert.deepEqual(prompts.at(-1).options.map(([label]) => label), ['Lock item (Fighter torso)', 'Cancel']);
  choose('Lock item (Fighter torso)');
  assert.deepEqual(ids(player), [[I.FIGHTER_TORSO_L_, 1]]);
});

test('Perdu unlocks an item, returning the parchment and 475,000 coins (rsprox)', () => {
  const parchment = Common.idOf('Trouver parchment');
  const player = fakePlayer({ items: [new Item(I.INFERNAL_CAPE_L_, 1)] });
  useOnPerdu(player, 0);
  assert.deepEqual(lines(player.dialogues[0]), [
    "I've locked that item to you so that it won't vanish if you're killed in deep Wilderness. I can unlock it again, returning your parchment and 475,000 coins.",
  ]);
  assert.equal(prompts.at(-1).title, 'Infernal cape (l): Unlock it?');
  choose('Yes');
  assert.deepEqual(ids(player), [[I.INFERNAL_CAPE, 1], [parchment, 1], [COINS, 475000]]);
  assert.deepEqual(lines(player.dialogues[1]), ['Perdu unlocks your item and returns the parchment and some money.']);
});

test('Perdu answers every other item (Wiki: Transcript:Perdu)', () => {
  for (const [id, text] of [
    [I.FIRE_CAPE, "You don't need me to lock that item, it won't vanish if you die in deep Wilderness."],
    [COINS, 'I can see you have some money. Weird flex, but okay.'],
    [I.ABYSSAL_WHIP, "I can't help you with that item - it's not the kind of thing I could lock or repair, if you were hoping for me to do that sort of thing."],
  ]) {
    const player = fakePlayer({ items: [new Item(id, 1)] });
    useOnPerdu(player, 0);
    assert.deepEqual(lines(player.dialogues[0]), [text]);
  }
});
