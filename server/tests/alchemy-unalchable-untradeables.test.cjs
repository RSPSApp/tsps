// Run after `yarn build`: node --test tests/alchemy-unalchable-untradeables.test.cjs
// Untradeables the Wiki marks "Not alchemisable" (Dragon defender, Fire cape, Rune pouch, Fighter torso) alched for
// coins: osrsreboxed-db matched its unalchable category by the versioned wiki name ("Dragon defender (Normal)"),
// left them in item-alch.json, and the loader layers that file over the cache's values. item-alch.json now writes
// them with null values, which the loader turns into 0. Iban's staff (broken) still alchs (rsprox 3215: 12 coins).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, spell, next = 3420;
const bots = process.env.DISABLE_PLAYER_BOTS;

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
  spell = core.CacheDefinitions.getSpellByName('High Level Alchemy');
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});

function caster(t, itemId) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('alch' + next); p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  p.getSkillManager().setMaxLevel(core.Skill.MAGIC, 99, true).setCurrentLevel(core.Skill.MAGIC, 99, true);
  const c = new ClientConnection(channel); c.player = p;
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', (m) => { messages.push(m); return p.getPacketSender(); });
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  const inv = p.getInventory();
  inv.add(new core.Item(core.ItemIdentifiers.NATURE_RUNE, 5), true);
  inv.add(new core.Item(core.ItemIdentifiers.FIRE_RUNE, 25), true);
  inv.add(new core.Item(itemId, 1), true);
  return { p, c, inv, messages };
}
async function tick(f) { f.c.processTurnPackets(); core.TaskManager.processWalkTo(f.p.getIndex()); core.TaskManager.process(); }
async function cast(f, itemId) {
  await f.c.dispatch([{ type: 'widget_target', sourceWidgetId: spell.widgetId, sourceItemId: spell.itemId, sourceSlot: -1,
    targetWidgetId: 149 << 16, targetItemId: itemId, targetSlot: f.inv.getSlotForItemId(itemId) }]);
  for (let i = 0; i < 3; i++) await tick(f);
  // The untradeable warning: the item box, then "Proceed to cast High Level Alchemy on it." (option 1).
  for (let i = 0; i < 4 && f.p.getDialogueManager().isActive(); i++) {
    const current = f.p.getDialogueManager().getCurrent?.();
    const options = current instanceof core.OptionDialogue;
    await f.c.dispatch([{ type: 'dialogue_continue', childIndex: options ? 1 : -1,
      widgetId: options ? core.OptionDialogue.OPTIONS_WIDGET_ID : (f.p.getPacketSender().getChatboxGroupId() << 16) | 5 }]);
    for (let j = 0; j < 6; j++) await tick(f);
  }
}

for (const [id, name] of [[12954, 'Dragon defender'], [6570, 'Fire cape'], [12791, 'Rune pouch'], [10551, 'Fighter torso']]) {
  test(`${name} (${id}) cannot be alchemised (Wiki: Not alchemisable)`, async (t) => {
    const definition = core.ItemDefinition.forId(id);
    assert.equal(definition.getName(), name);
    assert.equal(definition.getHighAlchValue(), 0, 'no alch value after the cache and item-alch.json');
    const f = caster(t, id);
    await cast(f, id);
    assert.equal(f.inv.getAmount(id), 1, `the item stays: ${f.messages}`);
    assert.equal(f.inv.getAmount(core.ItemIdentifiers.COINS), 0);
    assert.equal(f.inv.getAmount(core.ItemIdentifiers.NATURE_RUNE), 5, 'no runes spent');
  });
}

test("Iban's staff (broken) still alchs for 12 after the untradeable warning (rsprox 3215)", async (t) => {
  const f = caster(t, 1410);
  await cast(f, 1410);
  assert.equal(f.inv.getAmount(1410), 0, `the staff is alched: ${f.messages}`);
  assert.equal(f.inv.getAmount(core.ItemIdentifiers.COINS), 12);
});

// #57 review: item-alch.json is keyed by the unnoted ids, and the loader gave the note nothing, so a noted copy kept
// the cache's value (noted Bow of Faerdhinen (inactive) 25863 alched for 3,000,000 while 25862 was refused).
test('a noted copy of an unalchable item cannot be alchemised either', async (t) => {
  const unnoted = core.ItemDefinition.forId(25862), noted = core.ItemDefinition.forId(25863);
  assert.equal(noted.isNoted(), true);
  assert.equal(noted.getNoteId(), 25862);
  assert.equal(unnoted.getHighAlchValue(), 0);
  assert.equal(noted.getHighAlchValue(), 0, 'the note carries the same (no) value');
  const f = caster(t, 25863);
  await cast(f, 25863);
  assert.equal(f.inv.getAmount(25863), 1, `the noted bow stays: ${f.messages}`);
  assert.equal(f.inv.getAmount(core.ItemIdentifiers.COINS), 0);
});

test("a noted alchemisable item still alchs as its unnoted copy does", () => {
  const whip = core.ItemDefinition.forId(core.ItemIdentifiers.ABYSSAL_WHIP);
  const note = core.ItemDefinition.forId(whip.getNoteId());
  assert.equal(note.isNoted(), true);
  assert.equal(note.getHighAlchValue(), whip.getHighAlchValue());
  assert.ok(note.getHighAlchValue() > 0);
});
