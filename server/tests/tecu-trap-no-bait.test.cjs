// Run after yarn build: node --test tests/tecu-trap-no-bait.test.cjs
// Wiki (Net trap): "irit tar cannot be used as bait for tecu salamanders, nor is it possible to smoke the traps."
// Irit tar baited them (+3/256) and a torch or anti-odour salt smoked them (+2/256). Real Player and inventory, the
// real bait handler; other salamander nets keep their tar and smoke.
const assert = require('node:assert/strict');
const { before, afterEach, test } = require('node:test');
const path = require('node:path');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const C = require('../plugins/skills/hunter/Context.Hunter');
const { H } = C;
const Traps = require('../plugins/skills/hunter/Traps.Hunter');

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  H.data = require('../plugins/skills/hunter/Data.Hunter').build(core);
  H.api = { emitCustomEvent() {} };
  H.core = core;
});
afterEach(() => H.traps.clear());

function setup(kind, items) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername('tecu' + kind);
  p.setLocation(new core.Location(3200, 3200, 0));
  const messages = [];
  p.sendMessage = (text) => messages.push(text);
  items.forEach(([id, amount], slot) => p.getInventory().setItem(slot, new core.Item(id, amount)));
  const at = new core.Location(3201, 3200, 0);
  const object = { getId: () => 1, getLocation: () => at, getPrivateArea: () => null };
  const trap = { player: p, kind, location: at, area: null, objects: [object], state: 'idle', bait: null, smoked: false };
  H.traps.add(trap);
  return { p, messages, trap, use: (itemId) => Traps.bait({ player: p, object, itemId, handled: false }) };
}

test("a tecu salamander's net takes no irit tar and can't be smoked", () => {
  const I = core.ItemIdentifiers;
  const f = setup('tecu', [[I.IRIT_TAR, 10], [I.LIT_TORCH, 1]]);
  f.use(I.IRIT_TAR);
  assert.equal(f.trap.bait, null, 'not baited');
  assert.equal(f.p.getInventory().getAmount(I.IRIT_TAR), 10, 'the tar is kept');
  f.use(I.LIT_TORCH);
  assert.equal(f.trap.smoked, false, 'not smoked');
});

test('the other salamander nets still take their tar and smoke', () => {
  const I = core.ItemIdentifiers;
  const f = setup('black', [[I.HARRALANDER_TAR, 10], [I.LIT_TORCH, 1]]);
  f.use(I.HARRALANDER_TAR);
  assert.ok(f.trap.bait, 'baited');
  f.use(I.LIT_TORCH);
  assert.equal(f.trap.smoked, true);
});
