const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const Potions = require('../plugins/items/Potions.plugin');
const custom = new Map(), persisted = new Map();
const questLogins = [], worldSpawns = [];
let core, drink, brew, variant;
const STAGE = 'quest.one_small_favour.stage';
const LEARNED = 'one-small-favour:guthix-rest-learned';
const RECIPE = 'Ok, you need to heat some water up in a bowl, then pour it into an empty teacup. Add 1 harralander, 2 guam and 1 marrentill...it\'ll warm that poor fellow up a treat!';
function emit(name, event) { for (const handler of custom.get(name) ?? []) handler(event); }
function api(kind) {
  return new Proxy({ core,
    persistAttribute(key, value) { persisted.set(key, value); },
    onPlayerLogin(handler) { if (kind === 'quest') questLogins.push(handler); },
    spawnNpc(definition) { worldSpawns.push(definition); },
    onCustomEvent(name, handler) { custom.set(name, [...custom.get(name) ?? [], handler]); },
    emitCustomEvent: emit,
    onItemFirstAction(handler) { if (kind === 'potions') drink = handler; },
    onItemOnItem(handler) { if (kind === 'quest') brew = handler; },
    onNpcDialogueVariant(handler) { if (kind === 'quest') variant = handler; },
  }, { get: (object, key) => object[key] ?? (() => {}) });
}
before(async () => {
  await CachePipeline.initialize(process.cwd());
  core = PluginManager.getCoreApi();
  Potions.register(api('potions'));
  require('../plugins/quests/quests/OneSmallFavour.Quest')(api('quest'));
});
function player(t, stage = 11, herblore = 18) {
  const p = new Player(null), messages = [];
  p.setAttribute(STAGE, stage); p.setPoisonDamage(0); p.setRunEnergy(50);
  const sender = new Proxy({}, { get: () => () => sender });
  t.mock.method(p, 'getPacketSender', () => sender);
  t.mock.method(p, 'sendMessage', message => messages.push(message));
  p.getSkillManager().setCurrentLevel(core.Skill.HERBLORE, herblore, false);
  p.getSkillManager().setMaxLevel(core.Skill.HERBLORE, herblore);
  return { p, messages, put(id, slot = 0, amount = 1) { p.getInventory().setItem(slot, new core.Item(id, amount)); } };
}
function recipe(p, changes = {}) {
  const event = { player: p, npcId: core.NpcIdentifiers.SANFEW,
    pages: [{ page: 'One Small Favour' }], text: RECIPE, ...changes };
  emit('npc-dialogue:line', event);
  event.after?.();
}
function ingredients(f) {
  for (const [slot, key, amount] of [[0, 'HARRALANDER', 1], [1, 'GUAM_LEAF', 2], [2, 'MARRENTILL', 1], [3, 'BOWL_OF_HOT_WATER', 1]]) {
    f.put(core.ItemIdentifiers[key], slot, amount);
  }
}
function make(p) {
  const event = { player: p, usedItemId: core.ItemIdentifiers.HARRALANDER,
    usedWithItemId: core.ItemIdentifiers.BOWL_OF_HOT_WATER, handled: false };
  brew(event); return event;
}
test('all tea doses are refused before the recipe without consumption or a drink cooldown', t => {
  for (const stage of [0, 1, 10, 11]) for (const dose of [1, 2, 3, 4]) {
    const f = player(t, stage), id = core.ItemIdentifiers[`GUTHIX_REST_${dose}_`]; f.put(id);
    drink({ player: f.p, itemId: id, slot: 0 });
    assert.equal(f.p.getInventory().getItems()[0].getId(), id);
    assert.equal(f.p.getTimers().has(core.TimerKey.POTION), false);
    assert.match(f.messages.join(' '), /Sanfew/);
  }
});
test('the actual Sanfew recipe line unlocks every dose at stage eleven', t => {
  const data = require('../data/definitions/npc-dialogues.json')['One Small Favour'];
  assert.ok(JSON.stringify(data).includes(RECIPE), 'uses the original imported recipe text');
  assert.equal(persisted.get(LEARNED), false);
  for (const dose of [1, 2, 3, 4]) {
    const f = player(t); recipe(f.p); assert.equal(f.p.getAttribute(LEARNED), true);
    const id = core.ItemIdentifiers[`GUTHIX_REST_${dose}_`]; f.put(id);
    drink({ player: f.p, itemId: id, slot: 0 });
    assert.equal(f.p.getInventory().getItems()[0].getId(), Potions._test.findPotionEntry(id).replacementId);
  }
});
test('starting the favour or agreeing before the explanation does not learn the recipe', t => {
  const f = player(t);
  emit('npc-dialogue:choice', { player: f.p, npcId: core.NpcIdentifiers.SANFEW, option: "Yep, it's a deal." });
  assert.notEqual(f.p.getAttribute(LEARNED), true);
  for (const changes of [{ npcId: core.NpcIdentifiers.AGGIE }, { pages: [{ page: 'Druidic Ritual' }] }, { text: "We call it 'Guthix's rest'." }]) recipe(f.p, changes);
  assert.notEqual(f.p.getAttribute(LEARNED), true);
});
test('closing before continuing past the recipe does not learn it, and an existing continuation is preserved', t => {
  const f = player(t); let continued = 0;
  const event = { player: f.p, npcId: core.NpcIdentifiers.SANFEW,
    pages: [{ page: 'Transcript:One Small Favour' }], text: RECIPE, after() { continued++; } };
  emit('npc-dialogue:line', event);
  assert.notEqual(f.p.getAttribute(LEARNED), true);
  assert.equal(continued, 0);
  event.after();
  assert.equal(continued, 1); assert.equal(f.p.getAttribute(LEARNED), true);
});
test('purchased tea cannot bypass Sanfew by advancing through Bleemadge', t => {
  const f = player(t); f.put(core.ItemIdentifiers.GUTHIX_REST_4_);
  const npcId = core.NpcIdentifiers.CAPTAIN_BLEEMADGE;
  assert.ok(Number.isInteger(npcId));
  assert.equal(variant({ player: f.p, npcId }), null);
  emit('npc-dialogue:action', { player: f.p, npcId, stepId: '30_mgi' });
  emit('npc-dialogue:choice', { player: f.p, npcId, option: "Ok, I'll go and get you some T.R.A.S.H." });
  assert.equal(f.p.getAttribute(STAGE), 11);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.GUTHIX_REST_4_), 1);
  recipe(f.p);
  assert.match(variant({ player: f.p, npcId }), /giving-bleemadge-the-tea/);
  emit('npc-dialogue:action', { player: f.p, npcId, stepId: '30_mgi' });
  assert.equal(f.p.getAttribute(STAGE), 12);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.GUTHIX_REST_4_), 0);
});
test('later quest stages and a saved learned flag retain the drinking unlock, with no Herblore drinking gate', t => {
  for (const stage of [11, 12, 31, 285]) {
    const f = player(t, stage, 1); if (stage === 11) f.p.setAttribute(LEARNED, true);
    const id = core.ItemIdentifiers.GUTHIX_REST_4_; f.put(id);
    drink({ player: f.p, itemId: id, slot: 0 });
    assert.equal(f.p.getInventory().getItems()[0].getId(), core.ItemIdentifiers.GUTHIX_REST_3_);
  }
});
test('brewing before the recipe preserves all ingredients', t => {
  const f = player(t, 1); ingredients(f);
  const ids = f.p.getInventory().getItems().map(item => [item.getId(), item.getAmount()]);
  make(f.p);
  assert.deepEqual(f.p.getInventory().getItems().map(item => [item.getId(), item.getAmount()]), ids);
  assert.match(f.messages.join(' '), /Sanfew/);
});
test('brewing requires level eighteen after learning; drinking does not', t => {
  const low = player(t, 12, 17); ingredients(low); make(low.p);
  assert.equal(low.p.getInventory().getAmount(core.ItemIdentifiers.HARRALANDER), 1);
  assert.match(low.messages.join(' '), /18 Herblore/);
  const ready = player(t); recipe(ready.p); ingredients(ready); make(ready.p);
  assert.equal(ready.p.getInventory().getAmount(core.ItemIdentifiers.GUTHIX_REST_4_), 1);
  assert.equal(ready.p.getInventory().getAmount(core.ItemIdentifiers.HARRALANDER), 0);
});
test('unrelated drinks stay usable and an existing drink restriction still wins', t => {
  const f = player(t, 0); f.put(core.ItemIdentifiers.ENERGY_POTION_4_);
  drink({ player: f.p, itemId: core.ItemIdentifiers.ENERGY_POTION_4_, slot: 0 });
  assert.equal(f.p.getInventory().getItems()[0].getId(), core.ItemIdentifiers.ENERGY_POTION_3_);
  const denied = player(t, 12); denied.put(core.ItemIdentifiers.GUTHIX_REST_4_);
  denied.p.getTimers().extendOrRegister(core.TimerKey.POTION, 3);
  drink({ player: denied.p, itemId: core.ItemIdentifiers.GUTHIX_REST_4_, slot: 0 });
  assert.equal(denied.p.getInventory().getItems()[0].getId(), core.ItemIdentifiers.GUTHIX_REST_4_);
});

test('One Small Favour logins reuse the canonical Cromperty spawn instead of adding a second wizard (#2892)', t => {
  const root = core.CacheDefinitions.getNpcId('ardounge_wizard');
  const records = require('../data/definitions/npc-spawns.json').filter(row =>
    row.id === root || [core.NpcIdentifiers.WIZARD_CROMPERTY, core.NpcIdentifiers.WIZARD_CROMPERTY_2].includes(row.id));
  assert.equal(records.length, 1, 'the canonical spawn is already supplied by npc-spawns');
  assert.equal(records[0].id, root, 'preserve the diary-dependent parent NPC');
  const f = player(t, 0);
  questLogins.forEach(handler => handler({ player: f.p }));
  questLogins.forEach(handler => handler({ player: f.p }));
  assert.equal(worldSpawns.some(row => [root, ...core.CacheDefinitions.getNpc(root).transforms].includes(row.id)), false);
  assert.deepEqual(worldSpawns.map(row => row.id).sort((a,b) => a-b),
    [core.NpcIdentifiers.GNORMADIUM_AVLAFRIM, core.NpcIdentifiers.CAPTAIN_BLEEMADGE].sort((a,b) => a-b),
    'other missing quest NPCs still spawn once across relog');
});
test('the surviving parent resolves both diary forms into the existing Cromperty favour dialogue', t => {
  const root = core.CacheDefinitions.getNpcId('ardounge_wizard');
  const npc = core.NPC.create(root, new core.Location(2683, 3326));
  for (const reward of [0, 1]) {
    const f = player(t, 15);
    t.mock.method(f.p, 'getPacketSender', () => ({ getVarp: () => reward, getVarbit: () => reward }));
    const npcId = npc.getContentId(f.p);
    assert.equal(npcId, core.CacheDefinitions.getNpc(root).transforms[reward]);
    assert.equal(npc.getCurrentDefinition(f.p).getName(), 'Wizard Cromperty');
    assert.match(variant({ player: f.p, npcId }), /asking-wizard-cromperty-for-a-spell$/);
    f.p.setAttribute(STAGE, 22);
    assert.match(variant({ player: f.p, npcId }), /wizard-cromperty-with-the-iron-oxide$/);
    assert.equal(npc.getRealId(), root);
  }
});
