const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const path = require('node:path');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, take;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
});
function fixture(t, items = []) {
  const player = new Player(null), messages = [], prompts = [];
  const sender = new Proxy({}, { get: (_, name) => name === 'sendTypedMessage'
    ? (type, text) => { messages.push([type, text]); return sender; } : () => sender });
  player.getPacketSender = () => sender;
  t.mock.method(player, 'sendMessage', text => messages.push(['game', text]));
  const api = { core, onObjectInteraction(name, actions) { assert.equal(name, 'Tools'); take = actions.Take; },
    sendMultiChatboxPrompt(_player, title, ...choices) { prompts.push({ title, choices }); } };
  require('../plugins/objects/FarmingShed.plugin').register(api);
  for (const id of items) player.getInventory().adds(id, 1);
  const click = id => take({ player, objectId: id ?? core.CacheDefinitions.getLocId('farming_shed_tools') });
  return { player, messages, prompts, click };
}
test('shed gives the selected spade, then the missing rake, then refuses duplicates', t => {
  const f = fixture(t), { SPADE, RAKE } = core.ItemIdentifiers;
  assert.equal(f.click(), true);
  assert.equal(f.prompts[0].title, 'Which would you like to take?');
  assert.deepEqual(f.prompts[0].choices.filter((_, i) => i % 2 === 0), ['Rake', 'Spade', 'Both']);
  f.prompts[0].choices[3]();
  assert.ok(f.player.getInventory().contains(SPADE));
  f.click();
  assert.ok(f.player.getInventory().contains(RAKE));
  f.click();
  assert.deepEqual(f.messages, [[core.ChatType.SPAM, "You 'borrow' a spade."],
    [core.ChatType.SPAM, "You 'borrow' a rake."], ['game', "You've already got a spade and a rake."]]);
});
test('choices recheck inventory and space; unrelated Tools remain available to other plugins', t => {
  const f = fixture(t), { RAKE, SPADE, COINS } = core.ItemIdentifiers;
  assert.equal(f.click(-1), false);
  f.click();
  f.player.getInventory().adds(RAKE, 1);
  f.prompts[0].choices[5]();
  assert.ok(f.player.getInventory().contains(SPADE));
  assert.equal(f.player.getInventory().getAmount(RAKE), 1);
  const g = fixture(t);
  g.click();
  for (let i = 0; i < 27; i++) g.player.getInventory().adds(SPADE, 1);
  g.prompts[0].choices[5]();
  assert.equal(g.player.getInventory().contains(RAKE), true, 'one missing tool fits');
  const h = fixture(t);
  h.click();
  for (let i = 0; i < 27; i++) h.player.getInventory().adds(SPADE, 1);
  h.player.getInventory().adds(COINS, 1);
  h.prompts[0].choices[5]();
  assert.equal(h.player.getInventory().contains(RAKE), false);
  assert.deepEqual(h.messages, [['game', "You don't have enough inventory space."]]);
});
