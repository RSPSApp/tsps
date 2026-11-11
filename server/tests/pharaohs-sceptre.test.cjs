// From server/: node --test tests/pharaohs-sceptre.test.cjs (after yarn build).
//
// The Pharaoh's sceptre against the OSRS Wiki (Pharaoh's_sceptre, Transcript:Guardian_mummy): its
// capacities by Desert Diary, the teleports and their charges, Check and Uncharge, the Necropolis
// obelisk, and the guardian mummy's recharge.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, beforeEach, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

let Common, Teleport, Recharge, diaryTier, prompts, casts, starts, refuse;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Common = require('../plugins/items/pharaohssceptre/Common.PharaohsSceptre');
  Teleport = require('../plugins/items/pharaohssceptre/Teleport.PharaohsSceptre');
  Recharge = require('../plugins/items/pharaohssceptre/Recharge.PharaohsSceptre');
  const tiers = ['easy', 'medium', 'hard', 'elite'];
  const api = new Proxy({
    core: {
      ...core,
      TeleportHandler: {
        checkReqs: (player, tile, level) => { casts.push({ checked: level }); return !refuse; },
        confirm: (player, destination, go, level, { item } = {}) => go(item),
        teleport: (player, tile, type, warn, onArrival) => { casts.push({ tile: [tile.getX(), tile.getY(), tile.getZ()], type }); player.moveTo(tile); onArrival?.(); },
      },
      BonusManager: { update() {} },
    },
    persistAttribute: () => {},
    sendMultiChatboxPrompt: (player, title, ...options) => prompts.push({ title, options }),
    emitCustomEvent(name, event) {
      if (name === 'diary:is-complete' && event.diary === 'desert') {
        event.complete = diaryTier != null && tiers.indexOf(event.tier) <= tiers.indexOf(diaryTier);
      }
      if (name === 'npc-dialogue:start') starts.push(event);
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Common.init(api);
});

beforeEach(() => {
  diaryTier = null;
  prompts = [];
  casts = [];
  starts = [];
  refuse = false;
});

function container(size) {
  const items = Array.from({ length: size }, () => null);
  return {
    items,
    getItems: () => items,
    setItem: (slot, item) => { items[slot] = item; return this; },
    refreshItems: () => {},
    getAmount: (id) => items.filter((item) => item?.getId() === id).reduce((sum, item) => sum + item.getAmount(), 0),
    delete: (id, amount) => {
      let owed = amount;
      for (let slot = 0; slot < items.length && owed > 0; slot++) {
        const item = items[slot];
        if (item?.getId() !== id) continue;
        const take = Math.min(owed, item.getAmount());
        owed -= take;
        items[slot] = item.getAmount() - take > 0 ? new core.Item(id, item.getAmount() - take) : null;
      }
    },
    put: (id, amount = 1) => { items[items.indexOf(null)] = new core.Item(id, amount); },
  };
}

function fakePlayer() {
  let tile = new core.Location(3200, 3200, 0);
  const inventory = container(28);
  const equipment = container(14);
  const player = {
    messages: [], attributes: {}, varps: {}, varbits: {},
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    sendMessage: (m) => player.messages.push(m),
    getAttribute: (k) => player.attributes[k],
    setAttribute: (k, v) => { player.attributes[k] = v; },
    getPacketSender: () => ({
      sendConfig: (id, v) => { player.varps[id] = v; },
      sendVarbit: (id, v) => {
        player.varbits[id] = v;
        // As PacketSender does: the varbit's bits of its varp.
        const bit = core.CacheDefinitions.getVarbit(id);
        const varp = bit.varp ?? bit.baseVar ?? bit.index;
        const mask = ((1 << (bit.endBit - bit.startBit + 1)) - 1) << bit.startBit;
        player.varps[varp] = ((player.varps[varp] ?? 0) & ~mask) | ((v << bit.startBit) & mask);
      },
    }),
    getInventory: () => inventory,
    getEquipment: () => equipment,
    getUpdateFlag: () => ({ flag() {} }),
    inventory, equipment,
  };
  return player;
}

const ids = () => Common.ids;
const sceptreIn = (player) => [...player.inventory.items, ...player.equipment.items].find((item) => item && Common.isSceptre(item.getId()))?.getId();
const action = (player, option, extra = {}) => {
  const id = sceptreIn(player);
  const event = { player, itemId: id, item: new core.Item(id, 1), interfaceId: 149, option, handled: false, ...extra };
  Teleport.onItemAction(event);
  return event;
};

test('every id resolves from the cache; the artefacts come from Pyramid Plunder with their materials', () => {
  assert.deepEqual([ids().objs.uncharged, ids().objs.charged, ids().objs.initial], [26945, 26948, 26950]);
  assert.deepEqual([ids().varbits.mummyMet, ids().varbits.lastTeleport, ids().varbits.necropolis], [5007, 13838, 13839]);
  assert.equal(ids().locs.obelisk, 44296);
  assert.equal(ids().artefacts.size, 18, 'nine artefacts, unnoted and noted');
  assert.equal(ids().artefacts.get(9041), 'gold', 'a noted gold seal');
  assert.equal(ids().artefacts.get(core.CacheDefinitions.getObjId('ntk_ivory_comb')), 'pottery');
});

test('the sceptre holds 3 charges, 10/25/50/100 with each Desert Diary tier', () => {
  const player = fakePlayer();
  assert.equal(Common.capacity(player), 3);
  for (const [tier, held] of [['easy', 10], ['medium', 25], ['hard', 50], ['elite', 100]]) {
    diaryTier = tier;
    assert.equal(Common.capacity(player), held, tier);
  }
});

test('a sceptre found in Pyramid Plunder holds 3; a teleport spends one on arrival; the last leaves it uncharged', () => {
  const player = fakePlayer();
  player.inventory.put(ids().objs.initial);
  assert.equal(Common.charges(player), 3);
  action(player, 'Teleport');
  assert.deepEqual(prompts[0].options.filter((o) => typeof o === 'string'), ['Jalsavrah', 'Jaleustrophos', 'Jaldraocht'], 'Jaltevas only once communed');
  const jaldraocht = prompts[0].options[prompts[0].options.indexOf('Jaldraocht') + 1];
  jaldraocht();
  const cast = casts.find((c) => c.tile);
  assert.deepEqual(cast.tile, [3232, 2896, 0], 'a recorded landing');
  // Recorded (rsprox 3015-3199): ntk_human_tele and ntk_tele, the move 3 ticks later, no sound.
  assert.equal(cast.type.getStartAnimation().getId(), core.CacheDefinitions.getSeqId('ntk_human_tele'));
  assert.equal(cast.type.getStartGraphic().getId(), core.CacheDefinitions.getSpotanimId('ntk_tele'));
  assert.equal(cast.type.getStartTick(), 3);
  assert.equal(cast.type.getOptions().sound, 0);
  assert.equal(casts[0].checked, 30, 'works up to level 30 Wilderness');
  assert.equal(Common.charges(player), 2);
  assert.deepEqual(player.messages, [], 'recorded: no message while charges are left');
  assert.equal(player.attributes[Common.LAST_ATTRIBUTE], 3);
  assert.equal(player.varps[3420] & 0x3f, 3, "last teleport: Jaldraocht");
  action(player, 'Last-Teleport');
  assert.deepEqual(casts.at(-1).tile, [3232, 2896, 0], 'Last-Teleport repeats it');
  action(player, 'Teleport', { subOpId: 2 });
  assert.deepEqual(casts.at(-1).tile, [3341, 2827, 0], "Teleport's sub-options go straight there");
  assert.equal(Common.charges(player), 0);
  assert.equal(sceptreIn(player), ids().objs.uncharged);
  assert.equal(player.messages.at(-1), 'Your sceptre has run out of charges.');
  assert.equal(action(player, 'Teleport').handled, false, 'the uncharged sceptre has no teleports');
});

test('Last-Teleport goes to Jalsavrah before any teleport; worn, each pyramid is its own option', () => {
  const player = fakePlayer();
  player.equipment.put(ids().objs.initial);
  const worn = (option) => action(player, option, { interfaceId: core.Equipment.INVENTORY_INTERFACE_ID });
  worn('Last-Teleport');
  assert.deepEqual(casts.at(-1).tile, [1935, 4429, 3]);
  worn('Jaleustrophos');
  assert.deepEqual(casts.at(-1).tile, [3341, 2827, 0]);
  worn('Jaltevas');
  assert.equal(player.messages.at(-1), Common.message('needNecropolis'));
  assert.equal(Common.charges(player), 1, 'refused: no charge spent');
});

test('a refused teleport (too deep in the Wilderness) spends nothing', () => {
  const player = fakePlayer();
  player.inventory.put(ids().objs.initial);
  refuse = true;
  action(player, 'Last-Teleport');
  assert.equal(Common.charges(player), 3);
  assert.equal(casts.filter((c) => c.tile).length, 0);
});

test('communing at the Necropolis obelisk with the sceptre in the pack opens Jaltevas, charged or not', () => {
  const player = fakePlayer();
  assert.equal(Teleport.commune({ player, objectId: ids().locs.obelisk }), false, 'nothing without a sceptre');
  player.inventory.put(ids().objs.uncharged);
  assert.equal(Teleport.commune({ player, objectId: ids().locs.obelisk }), true);
  assert.equal(Common.necropolisUnlocked(player), true);
  assert.equal(player.varbits[13839], 1);
  assert.equal(Teleport.commune({ player, objectId: 1 }), false);
  assert.deepEqual(Teleport.destinations(player).map((d) => d.name), ['Jalsavrah', 'Jaleustrophos', 'Jaldraocht', 'Jaltevas']);
});

test('Check tells the charges; Uncharge asks, then leaves the uncharged sceptre', () => {
  const player = fakePlayer();
  player.inventory.put(ids().objs.charged);
  player.attributes[Common.CHARGES_ATTRIBUTE] = 7;
  action(player, 'Check');
  assert.equal(player.messages.at(-1), 'Your sceptre has 7 charges left.');
  action(player, 'Uncharge');
  assert.equal(prompts.at(-1).title, 'Uncharge the sceptre? Its 7 charges will be lost.');
  prompts.at(-1).options[1]();
  assert.equal(sceptreIn(player), ids().objs.uncharged);
  assert.equal(Common.charges(player), 0);
  action(player, 'Check');
  assert.equal(player.messages.at(-1), 'Your sceptre has no charges left.');
});

// --- The guardian mummy

const mummy = { getName: () => 'Guardian mummy' };
const ask = (player, text) => Recharge.answerCondition({ player, definition: mummy, text });

test("the mummy's conditions: no sceptre, the first time, full or not, enough artefacts of a material", () => {
  const player = fakePlayer();
  assert.equal(ask(player, "If the player doesn't have a Pharaoh's sceptre:"), true);
  player.inventory.put(ids().objs.initial);
  assert.equal(ask(player, "If the player doesn't have a Pharaoh's sceptre:"), false);
  assert.equal(ask(player, "If the player is charging a Pharaoh's sceptre for the first time:"), true);
  assert.equal(ask(player, 'If the sceptre is cully charged:'), true, '3 of 3');
  diaryTier = 'easy';
  assert.equal(ask(player, "If the sceptre isn't fully charged:"), true, '3 of 10');
  player.attributes[Common.MUMMY_MET_ATTRIBUTE] = true;
  assert.equal(ask(player, "If the player is charging a Pharaoh's sceptre for the first time:"), false);
  assert.equal(ask(player, "If the player has already charged a Pharaoh's sceptre for the first time, and they have a sceptre that is not fully charged:"), true);
  assert.equal(ask(player, "If the player has already charged a Pharaoh's sceptre for the first time, and they have a fully charged sceptre:"), false);
  assert.equal(ask(player, 'If the player does not have at least 6 (including noted) gold artefacts:'), true);
  player.inventory.put(9041, 4);
  player.inventory.put(core.CacheDefinitions.getObjId('ntk_scarab_gold'), 2);
  assert.equal(ask(player, 'If the player has at least 6 (including noted) gold artefacts:'), true, 'noted ones count');
  assert.equal(ask(player, 'If the player does not have at least 12 (including noted) stone artefacts:'), true);
  assert.equal(ask(player, 'If the sceptre was partially-charged:'), true);
  assert.equal(ask(player, 'If the sceptre was uncharged:'), false);
  assert.equal(Recharge.answerCondition({ player, definition: { getName: () => 'Simon Templeton' }, text: 'If the sceptre was uncharged:' }), null);
});

test('"Right, ..." recharges to full as he says it: paid in artefacts of one material, the numbers filled in', () => {
  const player = fakePlayer();
  diaryTier = 'medium';
  player.inventory.put(ids().objs.initial);
  player.attributes[Common.CHARGES_ATTRIBUTE] = 2;
  const comb = core.CacheDefinitions.getObjId('ntk_ivory_comb');
  player.inventory.put(comb, 10);
  player.inventory.put(9037, 20); // noted pottery statuettes
  const line = { player, definition: mummy, text: "Right, you already had [x] charge[s], and I don't give discounts. That means 24 artefacts gives you [y] charge[s]. Now be on your way." };
  Recharge.onLine(line);
  assert.equal(line.text, "Right, you already had 2 charges, and I don't give discounts. That means 24 artefacts gives you 25 charges. Now be on your way.");
  assert.equal(Common.charges(player), 25);
  assert.equal(sceptreIn(player), ids().objs.charged);
  assert.equal(player.inventory.getAmount(comb), 0, 'unnoted first');
  assert.equal(player.inventory.getAmount(9037), 6);
  assert.equal(player.attributes[Common.MUMMY_MET_ATTRIBUTE], true);
  assert.equal(player.varbits[5007], 1);

  const again = { player, definition: mummy, text: 'Right, 24 artefacts gives you [x] charges. Now be on your way.' };
  Recharge.onLine(again);
  assert.equal(again.skip, true, 'already full: nothing taken');
  assert.equal(player.inventory.getAmount(9037), 6);
});

test('an uncharged sceptre recharges from nothing; too few artefacts takes nothing', () => {
  const player = fakePlayer();
  player.inventory.put(ids().objs.uncharged);
  const seal = core.CacheDefinitions.getObjId('ntk_seal_stone');
  player.inventory.put(seal, 11);
  assert.equal(Recharge.recharge(player, 'stone'), null);
  assert.equal(player.inventory.getAmount(seal), 11);
  player.inventory.put(seal, 1);
  const line = { player, definition: mummy, text: 'Right, 12 artefacts gives you [x] charges. Now be on your way.' };
  Recharge.onLine(line);
  assert.equal(line.text, 'Right, 12 artefacts gives you 3 charges. Now be on your way.');
  assert.equal(player.inventory.getAmount(seal), 0);
  assert.equal(sceptreIn(player), ids().objs.charged);
});

test('using the sceptre or an artefact on him asks about charging; artefacts without a sceptre get his Simon line', () => {
  const player = fakePlayer();
  const comb = core.CacheDefinitions.getObjId('ntk_ivory_comb');
  const event = { player, target: {}, definition: mummy, itemId: comb, handled: false };
  Recharge.itemOnMummy(event);
  assert.equal(event.handled, true);
  assert.match(starts.at(-1).variant, /without-having-a-pharaoh-s-sceptre/);
  player.inventory.put(ids().objs.initial);
  Recharge.itemOnMummy({ player, target: {}, definition: mummy, itemId: ids().objs.initial, handled: false });
  const steps = [{ type: 'choice', options: [{ text: 'What should I do?', steps: ['a'] }, { text: 'I want to charge my sceptre.', steps: ['charge'] }] }];
  assert.deepEqual(starts.at(-1).select(steps), ['charge']);
  const other = { player, target: {}, definition: { getName: () => 'Simon Templeton' }, itemId: comb, handled: false };
  Recharge.itemOnMummy(other);
  assert.equal(other.handled, false);
});

test("Check on an uncharged sceptre says none, whatever the pool; the mummy treats it as uncharged", () => {
  const player = fakePlayer();
  player.attributes[Common.CHARGES_ATTRIBUTE] = 5; // a charged sceptre left in the bank
  player.inventory.put(ids().objs.uncharged);
  action(player, "Check");
  assert.equal(player.messages.at(-1), "Your sceptre has no charges left.");
  assert.equal(ask(player, "If the sceptre was partially-charged:"), false);
  assert.equal(ask(player, "If the sceptre was uncharged:"), true);
});

test("communing looks for the sceptre in the pack, not the one worn", () => {
  const player = fakePlayer();
  player.equipment.put(ids().objs.charged);
  assert.equal(Teleport.commune({ player, objectId: ids().locs.obelisk }), false, "worn only");
  player.inventory.put(ids().objs.uncharged);
  assert.equal(Teleport.commune({ player, objectId: ids().locs.obelisk }), true);
  assert.equal(player.varps[3420] & 0x40, 0x40, "bit 6");
});
