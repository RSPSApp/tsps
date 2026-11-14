// Run after `yarn build`: node --test tests/cooking-sinew.test.cjs
// Sinew (rsprox captures 89 and 1749, rev 227; Wiki Sinew): a sinew meat on a range offers
// "What would you like to cook?|Cooked meat|Sinew", even for one piece. Sinew is members only,
// range only, 3 Cooking XP, burns on the Wiki's chart (range 128/512) and make-all is 0, 3, then 4
// ticks; each is "You dry a piece of meat and extract the sinew."
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Cookers = require('../plugins/skills/cooking/Cookers.Cooking');
let core, next = 3620;
const bots = process.env.DISABLE_PLAYER_BOTS;
const AT = [3211, 3215, 0]; // a main-game Range (gameval range, Cook) placed beside the player
const LINE = 'You dry a piece of meat and extract the sinew.';

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(AT[0], AT[1]);
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});

/** A level 99 cook beside a Range (or a Fire) with `carried` [[ItemIdentifiers name, count], ...]. */
function setup(t, carried, objectId = core.CacheDefinitions.getLocId('range'), level = 99) {
  const I = core.ItemIdentifiers;
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('sinew' + next); p.setRegistered(true); p.setLocation(new core.Location(...AT)); p.needsPlacement = false;
  p.getSkillManager().setMaxLevel(core.Skill.COOKING, level, true).setCurrentLevel(core.Skill.COOKING, level, true);
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  for (const [name, n] of carried) for (let i = 0; i < n; i++) p.getInventory().add(new core.Item(I[name], 1), true);
  const object = new core.GameObject(objectId, new core.Location(AT[0] + 1, AT[1], 0), 10, 0, null);
  core.ObjectManager.register(object, true);
  t.after(() => core.ObjectManager.deregister(object, true));
  const sent = { menu: null, spam: [] };
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendCreationMenu', (value) => { sent.menu = value; return sender; });
  const typed = sender.sendTypedMessage.bind(sender);
  t.mock.method(sender, 'sendTypedMessage', (type, text) => { sent.spam.push(text); return typed(type, text); });
  return { p, object, sent, I, inv: p.getInventory() };
}

function use(p, object, itemId) {
  const slot = p.getInventory().getSlot(itemId);
  Cookers._test.handleCook({ player: p, object, objectId: object.getId(), itemId, item: p.getInventory().get(slot), itemSlot: slot, handled: false });
}

function ticks(n, roll = 0) {
  const previous = Math.random;
  Math.random = () => roll;
  try { for (let i = 0; i < n; i++) core.TaskManager.process(); } finally { Math.random = previous; }
}

test('raw beef used on a range offers Cooked meat and Sinew, even for one piece (recording 89)', (t) => {
  const { p, object, sent, I } = setup(t, [['RAW_BEEF', 1]]);
  use(p, object, I.RAW_BEEF);
  assert.equal(sent.menu?.getTitle(), 'What would you like to cook?');
  assert.deepEqual(sent.menu.getItems(), [I.COOKED_MEAT, I.SINEW]);
  assert.equal(sent.menu.getOptions().maxAmount, 1);
  assert.equal(Cookers.isCookingActive(p), false, 'nothing cooks before the choice');
});

test('Sinew dries every piece: 3 XP, the captured line, on the choice tick then 3 and 4 (recording 1749)', (t) => {
  const { p, object, sent, I, inv } = setup(t, [['RAW_BEEF', 4]]);
  const skills = p.getSkillManager();
  const xp = skills.getExperience(core.Skill.COOKING);
  const count = p.getAttribute('cooking:success-count');
  use(p, object, I.RAW_BEEF);
  assert.equal(sent.menu.getOptions().maxAmount, 4);
  const previous = Math.random;
  Math.random = () => 0; // the lowest roll: still a sinew at 99 (the chart reaches 100% at 34)
  try { sent.menu.execute(I.SINEW, 4); } finally { Math.random = previous; }
  const made = [inv.getAmount(I.SINEW)];
  for (let tick = 1; tick <= 14; tick++) {
    ticks(1, 0);
    made.push(inv.getAmount(I.SINEW));
  }
  assert.deepEqual([made[0], made[3], made[7], made[11]], [1, 2, 3, 4], 'the choice tick, then 3, 7 and 11 after it');
  assert.deepEqual([made[2], made[6], made[10]], [1, 2, 3]);
  assert.equal(inv.getAmount(I.RAW_BEEF), 0);
  assert.equal(inv.getAmount(I.BURNT_MEAT), 0);
  assert.equal(inv.getAmount(I.COOKED_MEAT), 0);
  assert.equal(skills.getExperience(core.Skill.COOKING) - xp, 4 * 3 * core.GameConstants.EXPERIENCE_MULTIPLIER);
  assert.deepEqual(sent.spam.filter((text) => text === LINE).length, 4);
  assert.equal(p.getAttribute('cooking:success-count'), count, 'cooking_success_count is not moved by sinew');
  assert.equal(Cookers.isCookingActive(p), false);
});

test('Cooked meat from the same menu still cooks the meat', (t) => {
  const { p, object, sent, I, inv } = setup(t, [['RAW_BEEF', 2]]);
  use(p, object, I.RAW_BEEF);
  sent.menu.execute(I.COOKED_MEAT, 2);
  ticks(12, 0.99);
  assert.equal(inv.getAmount(I.COOKED_MEAT), 2);
  assert.equal(inv.getAmount(I.SINEW), 0);
});

test('Cook on a range lists Sinew after the other foods, and it dries every sinew meat', (t) => {
  const { p, object, sent, I, inv } = setup(t, [['RAW_BEEF', 2], ['RAW_TROUT', 1], ['RAW_BEAR_MEAT', 1]]);
  Cookers._test.handleCookClick({ player: p, object });
  assert.deepEqual(sent.menu.getItems(), [I.COOKED_MEAT, I.TROUT, I.SINEW]);
  assert.equal(sent.menu.getOptions().maxAmount, 3);
  sent.menu.execute(I.SINEW, 3);
  ticks(14, 0);
  assert.equal(inv.getAmount(I.SINEW), 3);
  assert.equal(inv.getAmount(I.RAW_BEEF) + inv.getAmount(I.RAW_BEAR_MEAT), 0);
  assert.equal(inv.getAmount(I.RAW_TROUT), 1);
});

test('a fire offers no sinew', (t) => {
  const { p, object, sent, I } = setup(t, [['RAW_BEEF', 2]], core.ObjectIdentifiers.FIRE);
  assert.equal(object.getDefinition().getName(), 'Fire');
  use(p, object, I.RAW_BEEF);
  assert.equal(sent.menu?.getTitle(), 'How many would you like to cook?');
  assert.deepEqual(sent.menu.getItems(), [I.RAW_BEEF]);
});

test('a free world offers no sinew', (t) => {
  t.mock.method(core.WorldDefinition, 'isMembersWorld', () => false);
  const { p, object, sent, I } = setup(t, [['RAW_BEEF', 2]]);
  use(p, object, I.RAW_BEEF);
  assert.equal(sent.menu?.getTitle(), 'How many would you like to cook?');
  assert.deepEqual(sent.menu.getItems(), [I.RAW_BEEF]);
});

test('at Cooking 1 sinew can fail on the Wiki chart: burnt meat and the meat burn line', (t) => {
  const { p, object, sent, I, inv } = setup(t, [['RAW_BEEF', 2]], undefined, 1);
  const xp = p.getSkillManager().getExperience(core.Skill.COOKING);
  use(p, object, I.RAW_BEEF);
  const previous = Math.random;
  Math.random = () => 0;
  try { sent.menu.execute(I.SINEW, 1); } finally { Math.random = previous; }
  assert.equal(inv.getAmount(I.BURNT_MEAT), 1);
  assert.equal(inv.getAmount(I.SINEW), 0);
  assert.ok(sent.spam.includes('You accidentally burn the meat.'));
  assert.equal(p.getSkillManager().getExperience(core.Skill.COOKING), xp);
  use(p, object, I.RAW_BEEF);
  Math.random = () => 0.99;
  try { sent.menu.execute(I.SINEW, 1); } finally { Math.random = previous; }
  assert.equal(inv.getAmount(I.SINEW), 1, 'a good roll at level 1 still dries it');
  assert.equal(Cookers.isCookingActive(p), false);
});

test('one raw beef on the Lumbridge range before Cook\'s Assistant is refused before the menu', (t) => {
  const { p, object, sent, I } = setup(t, [['RAW_BEEF', 1]], core.ObjectIdentifiers.COOKING_RANGE);
  const said = [];
  t.mock.method(p, 'sendMessage', (text) => { said.push(text); });
  use(p, object, I.RAW_BEEF);
  assert.equal(sent.menu, null, 'no Cooked meat | Sinew menu');
  assert.deepEqual(said, ["You need to complete Cook's Assistant to use this range."]);
});

test('picking Sinew after walking away from the range dries nothing', (t) => {
  const { p, object, sent, I, inv } = setup(t, [['RAW_BEEF', 2]]);
  use(p, object, I.RAW_BEEF);
  p.setLocation(new core.Location(AT[0] + 20, AT[1] + 20, 0));
  sent.menu.execute(I.SINEW, 2);
  ticks(6, 0);
  assert.equal(inv.getAmount(I.SINEW), 0);
  assert.equal(inv.getAmount(I.RAW_BEEF), 2);
  assert.equal(Cookers.isCookingActive(p), false);
});
