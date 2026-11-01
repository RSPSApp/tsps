// Priest in Peril route contract. From server/: node --test tests/priest-in-peril.test.cjs
// Dispatches the plugin's registered handlers from a fresh stage 0 through completion and
// checks varp 302 against live OSRS's values (Quest Helper's PriestInPeril steps). It proves
// the handler contracts and the wire mapping, not a natural playthrough.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(root + '/dist/Server').Server.installProductionPathResolver();
require('node:test').before(async () => {
  await require(root + '/dist/game/cache/CachePipeline').CachePipeline.initialize(root);
});

const core = require(root + '/dist/plugins/PluginManager').PluginManager.getCoreApi();
const runtime = require(root + '/plugins/quests/QuestRuntime');
const noop = () => {};

const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const O = core.ObjectIdentifiers;
const VARP = 302;
const STAGE = 'quest.priest_in_peril.stage';

// The plugin destructures these at registration: record what it plays instead of
// running the transcript runtime.
const played = [];
runtime.startTranscript = (_api, player, npcId, page, variant, select) => {
  const steps = runtime.loadTranscripts({ core })?.[page]?.variants?.[variant];
  if (!Array.isArray(steps)) return false;
  played.push({ npcId, page, variant, steps: typeof select === 'function' ? select(steps) : steps });
  return true;
};
runtime.startDialogue = (_api, _player, _context, steps) => played.push({ steps });

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const configs = [];
  const xp = [];
  const statements = [];
  let location = new core.Location(3415, 3489, 2);
  const sender = new Proxy({
    sendConfig(id, value) { if (id === VARP) configs.push(value); return sender; },
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });
  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    isFull: () => false,
    adds(id, amount = 1) { items.set(id, inventory.getAmount(id) + amount); return inventory; },
    deleteNumber(id, amount = 1) {
      const left = inventory.getAmount(id) - amount;
      if (left > 0) items.set(id, left); else items.delete(id);
      return inventory;
    },
    forceAdd(_player, item) { return inventory.adds(item.getId(), item.getAmount()); },
  };
  return {
    attrs, items, configs, xp, statements, inventory,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]), getCombatLevel: () => 40 }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({ startDialogues: (chain) => statements.push(chain), isActive: () => false }),
    getLocation: () => location,
    moveTo(next) { location = next; },
    sendMessage: noop,
    getUsername: () => 'pip-test',
  };
}

function harness() {
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const named = new Map();
  const itemOnObject = [];
  const npcInteraction = [];
  const deaths = [];
  const statements = [];
  const grounds = [];
  const fakeCore = { ...core, StatementDialogue: { send: (_player, text) => statements.push(text) } };
  const api = new Proxy({
    core: fakeCore,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onObjectInteraction(name, actions) { if (typeof name === 'string') named.set(name, actions); },
    onItemOnObject: (handler) => itemOnObject.push(handler),
    onNpcInteraction: (handler) => npcInteraction.push(handler),
    onNpcDeath: (handler) => deaths.push(handler),
    onCustomEvent(key, handler) { custom.set(key, [...(custom.get(key) ?? []), handler]); },
    emitCustomEvent(key, event) { for (const handler of custom.get(key) ?? []) handler(event); },
    getItemOnGroundManager: () => ({ registerLocation: (_player, item, at) => grounds.push([item.getId(), at.getX(), at.getY()]) }),
  }, { get: (target, key) => (key in target ? target[key] : noop) });
  require(root + '/plugins/quests/quests/PriestInPeril.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'priest_in_peril');
  const player = makePlayer();
  const h = { grounds, custom, variants, conditions, named, itemOnObject, npcInteraction, deaths, statements, quest, player };
  h.emit = (key, event) => {
    const request = { player, handled: false, ...event };
    for (const handler of custom.get(key) ?? []) handler(request);
    return request;
  };
  h.talk = (npcId, npcLocation = new core.Location(3417, 3489, 2)) => {
    const npc = { getLocation: () => npcLocation };
    const interaction = { player, npc, npcId, clickType: 1, handled: false };
    for (const handler of npcInteraction) handler(interaction);
    if (interaction.handled) return { handled: true };
    for (const handler of variants) {
      const value = handler({ player, npc, npcId });
      if (value) return value;
    }
    return null;
  };
  h.condition = (text) => {
    for (const handler of conditions) {
      const value = handler({ player, text });
      if (typeof value === 'boolean') return value;
    }
    return null;
  };
  h.object = (name, option, objectId, x, y, z) =>
    named.get(name)[option]({ player, objectId, location: { x, y, z } });
  h.useOn = (itemId, objectId, x, y, z) => {
    const event = { player, itemId, objectId, location: { x, y, z }, handled: false };
    for (const handler of itemOnObject) handler(event);
    return event.handled;
  };
  h.kill = (npcId, location = { x: 3410, y: 3488, z: 0 }) => {
    for (const handler of deaths) handler({ killer: player, npcId, location });
  };
  h.wire = () => player.configs.at(-1);
  h.stage = () => quest.getStage(player);
  return h;
}

const lastPlayed = () => played.at(-1);
const CELL_GATE = [O.CELL_GATE_7, 3415, 3489, 2];
const COFFIN = [O.COFFIN_7, 3413, 3486, 2];
const WELL = [O.WELL_6, 3423, 9890, 0];
const MAUSOLEUM = new core.Location(3440, 9895, 0);

test('the route sends live varp 302 values from start to completion', () => {
  const h = harness();
  const { player } = h;
  assert.equal(h.talk(N.KING_ROALD), 'starting-the-quest');
  h.emit('npc-dialogue:hook', { npcId: N.KING_ROALD, hook: 'quest:priest-in-peril:start' });
  assert.equal(h.wire(), 1);

  // Killing the guardian before the monks ask for it does nothing.
  h.kill(3487);
  assert.equal(h.stage(), 10);
  assert.ok(h.emit('door:toggle', { objectId: O.LARGE_DOOR_22 }).handled);
  assert.equal(lastPlayed().variant, 'at-the-temple');
  assert.equal(h.wire(), 2, 'agreeing to kill the dog shows the guardian (3487 -> 7620 at 0-2)');
  h.kill(3487);
  assert.equal(h.wire(), 3);

  assert.equal(h.talk(N.KING_ROALD), 'you-killed-a-dog-talking-to-king-roald-about-the-now-dead-dog');
  assert.equal(h.wire(), 4);
  assert.equal(h.talk(N.DREZEL), 'saving-drezel-and-the-world-meeting-drezel');
  assert.equal(h.wire(), 5);

  // The monk's golden key opens nothing; the north-east monument swaps it for the iron key.
  player.inventory.adds(I.GOLDEN_KEY);
  assert.ok(h.useOn(I.GOLDEN_KEY, ...CELL_GATE));
  assert.equal(lastPlayed().variant, 'saving-drezel-and-the-world-using-the-golden-key-on-the-lock');
  assert.ok(h.object('Cell gate', 'Open', ...CELL_GATE));
  assert.equal(lastPlayed().variant, 'pre-quest-attempting-to-open-the-gate');
  assert.equal(h.useOn(I.GOLDEN_KEY, O.MONUMENT_4, 3423, 9884, 0), false, 'the south monument holds the needle');
  assert.ok(h.useOn(I.GOLDEN_KEY, O.MONUMENT_5, 3427, 9894, 0));
  assert.equal(player.inventory.getAmount(I.GOLDEN_KEY), 0);
  assert.equal(player.inventory.getAmount(I.IRON_KEY), 1);

  player.inventory.adds(I.BUCKET);
  assert.ok(h.useOn(I.BUCKET, ...WELL));
  assert.equal(player.inventory.getAmount(I.MURKY_WATER), 1);
  assert.equal(h.talk(N.DREZEL), 'talking-to-drezel-with-the-iron-key');

  player.moveTo(new core.Location(3415, 3489, 2));
  assert.ok(h.object('Cell gate', 'Open', ...CELL_GATE));
  assert.equal(h.wire(), 6);
  assert.equal(lastPlayed().variant, 'talking-to-drezel-with-the-iron-key-unlocking-drezel-s-cell');
  assert.equal(player.getLocation().getX(), 3416, 'the player walks into the cell');
  assert.equal(h.condition('If the player has murky water:'), true);
  assert.equal(h.condition("If the player doesn't have murky water:"), false);
  // The condition follows the blessing message: the first blessing still plays his lines.
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: 'feQ9cD', kind: 'message' });
  assert.equal(player.inventory.getAmount(I.MURKY_WATER), 0);
  assert.equal(player.inventory.getAmount(I.BLESSED_WATER), 1);
  assert.equal(h.condition('First time blessing water:'), true);
  assert.equal(h.talk(N.DREZEL), 'talking-to-drezel-with-the-iron-key-talking-to-drezel-with-blessed-water');

  assert.ok(h.useOn(I.BLESSED_WATER, ...COFFIN));
  assert.equal(h.wire(), 7);
  assert.equal(player.inventory.getAmount(I.BLESSED_WATER), 0);
  assert.equal(h.talk(N.DREZEL), 'after-drezel-is-freed-and-the-vampyre-is-sealed');
  assert.equal(h.wire(), 8);
  assert.equal(h.talk(N.DREZEL, MAUSOLEUM), 'repairing-the-barrier');
  assert.equal(h.wire(), 10, 'varp 302 = 60 minus the 50 essence owed');

  player.inventory.adds(I.RUNE_ESSENCE, 28);
  assert.equal(h.talk(N.DREZEL, MAUSOLEUM), 'repairing-the-barrier-bringing-drezel-essence');
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: 'ViQ2ji', kind: 'message' });
  assert.equal(player.inventory.getAmount(I.RUNE_ESSENCE), 0);
  assert.equal(h.wire(), 38);
  const line = { npcId: N.DREZEL, player, text: 'Thank you. I need [1-50] more.' };
  for (const handler of h.custom.get('npc-dialogue:line')) handler(line);
  assert.equal(line.text, 'Thank you. I need 22 more.');

  player.inventory.adds(I.PURE_ESSENCE, 25);
  assert.equal(h.talk(N.DREZEL, MAUSOLEUM), 'giving-drezel-the-last-of-the-essence');
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: '4daSZa', kind: 'message' });
  assert.equal(player.inventory.getAmount(I.PURE_ESSENCE), 3, 'only the 22 still owed are taken');
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: '5wj46V', kind: 'action' });
  assert.equal(h.wire(), 61);
  assert.ok(h.quest.isComplete(player));
  assert.deepEqual(player.xp, [[core.Skill.PRAYER.getIndex(), 1406]]);
  assert.equal(player.inventory.getAmount(I.WOLFBANE), 1);

  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: '5wj46V', kind: 'action' });
  assert.equal(player.xp.length, 1, 'a repeat completion action pays nothing');
  assert.equal(player.inventory.getAmount(I.WOLFBANE), 1);
});

test('the unlocked cell replays the blessing without the unlock opening', () => {
  const h = harness();
  h.player.setAttribute(STAGE, 43);
  h.player.inventory.adds(I.MURKY_WATER, 2);
  assert.deepEqual(h.talk(N.DREZEL), { handled: true });
  const { variant, steps } = lastPlayed();
  assert.equal(variant, 'talking-to-drezel-with-the-iron-key-unlocking-drezel-s-cell');
  assert.notEqual(steps[0].id, 'TtVTbz', 'the "You use the key" message is not replayed');
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: 'feQ9cD', kind: 'message' });
  assert.equal(h.player.inventory.getAmount(I.BLESSED_WATER), 2, 'every murky water is blessed');
  assert.equal(h.condition('First time blessing water:'), true);
  h.player.inventory.adds(I.MURKY_WATER);
  h.emit('npc-dialogue:action', { npcId: N.DREZEL, stepId: 'feQ9cD', kind: 'message' });
  assert.equal(h.condition('First time blessing water:'), false, 'a second blessing skips his first-time lines');
});

test('saves from before the cell and coffin stages keep their meaning', () => {
  const h = harness();
  h.player.setAttribute(STAGE, 50); // An old save: the old plugin sealed the vampyre at 50.
  h.quest.setStage(h.player, 50);
  assert.equal(h.wire(), 8);
  assert.equal(h.talk(N.DREZEL), 'after-drezel-is-freed-and-the-vampyre-is-sealed-talking-to-drezel-again');
  assert.equal(h.talk(N.DREZEL, MAUSOLEUM), 'repairing-the-barrier');
  assert.equal(h.stage(), 55);
});

test('monuments guard their items until the coffin is sealed and give one souvenir each', () => {
  const h = harness();
  h.player.setAttribute(STAGE, 40);
  h.object('Monument', 'Study', O.MONUMENT_5, 3427, 9894, 0);
  assert.equal(h.statements.at(-1), 'Saradomin is the key that unlocks the mysteries of life.');
  h.player.inventory.adds(I.HAMMER, 2);
  assert.ok(h.useOn(I.HAMMER, O.MONUMENT_2, 3423, 9895, 0));
  assert.equal(h.player.inventory.getAmount(I.GOLDEN_HAMMER), 1);
  assert.ok(h.useOn(I.HAMMER, O.MONUMENT_2, 3423, 9895, 0));
  assert.equal(h.statements.at(-1), 'You have already taken the Golden hammer.');
  assert.equal(h.player.inventory.getAmount(I.HAMMER), 1);

  h.player.setAttribute(STAGE, 60);
  h.object('Monument', 'Study', O.MONUMENT_5, 3427, 9894, 0);
  assert.equal(h.statements.at(-1), 'A monument dedicated to the fallen.');
  h.player.inventory.adds(I.BUCKET);
  assert.equal(h.useOn(I.BUCKET, ...WELL), false, 'after the quest the well fills an ordinary bucket of water');
});

test('only the hooded level 30 monk drops the golden key, from the King\'s warning to the coffin', () => {
  const h = harness();
  h.player.setAttribute(STAGE, 20);
  h.kill(N.MONK_OF_ZAMORAK_17);
  assert.deepEqual(h.grounds, [], 'not before the King has been told');
  h.player.setAttribute(STAGE, 30);
  h.kill(N.MONK_OF_ZAMORAK_15);
  h.kill(N.MONK_OF_ZAMORAK_16);
  assert.deepEqual(h.grounds, [], 'the level 17 and 22 monks carry no key');
  h.kill(N.MONK_OF_ZAMORAK_17);
  assert.deepEqual(h.grounds, [[I.GOLDEN_KEY, 3410, 3488]]);
  h.player.setAttribute(STAGE, 46);
  h.kill(N.MONK_OF_ZAMORAK_17);
  assert.equal(h.grounds.length, 1, 'no key once the coffin is sealed');
});
