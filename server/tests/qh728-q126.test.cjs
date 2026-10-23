// From server/: node --test tests/qh728-q126.test.cjs (after the baseline build).
// Scoped While Guthix Sleeps (q126) contracts against Quest Helper 06da90f.
// The broav trap itself is shared Hunter content (plugins/skills/hunter/Broavs.Hunter.js);
// these tests dispatch this quest's registered handlers for the trained-broav leg,
// the broken-table handoff and the final cache completion wire (varbit 9653 = 900).
// Stage fixtures are labelled; they prove handler contracts, not a natural full route.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

function makePlayer() {
  const attrs = new Map([['quest.points', 0]]);
  const items = new Map();
  const messages = [];
  const moves = [];
  const dialogues = [];
  const skills = new Map();
  const log = [];
  let location = new core.Location(2519, 3249, 0);
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => { items.set(id, (items.get(id) ?? 0) + amount); return true; },
    deleteNumber: (id, amount = 1) => { items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); return true; },
    getFreeSlots: () => 28 - [...items.values()].filter(amount => amount > 0).length,
    getItems: () => [...items.entries()].map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
  };
  const sender = new Proxy({}, { get: (_target, prop) => (...args) => { log.push([String(prop), ...args]); return sender; } });
  return {
    attrs, items, messages, moves, skills, log, dialogues,
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null, getItems: () => [], contains: () => false }),
    getSkillManager: () => ({
      getMaxLevel: skill => skills.get(`max:${skill.index ?? skill}`) ?? 99,
      getCurrentLevel: skill => skills.get(`cur:${skill.index ?? skill}`) ?? 99,
      addExperience: (skill, amount) => skills.set(`xp:${skill.index ?? skill}`, (skills.get(`xp:${skill.index ?? skill}`) ?? 0) + amount),
    }),
    getUsername: () => 'wgs-test',
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: chain => dialogues.push(chain), handleResume: noop, reset: noop }),
    getLocation: () => location,
    moveTo: next => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    performAnimation: noop,
    sendMessage: text => messages.push(text),
    isRegistered: () => true,
  };
}

function harness() {
  const events = {}, itemOnObject = [], itemOnNpc = [], objectInteraction = [],
    npcInteraction = [], login = [];
  const api = new Proxy({
    core,
    persistAttribute: noop,
    onNpcDialogueVariant: noop,
    onNpcDialogueCondition: noop,
    onItemOnItem: noop,
    onItemOnObject: (item, target, handler, options) => itemOnObject.push({ item, target, handler, options }),
    onItemOnNpc: (handler, options) => itemOnNpc.push({ handler, options }),
    onItemAction: noop,
    onObjectInteraction: (name, actions) => objectInteraction.push({ name, actions }),
    onNpcInteraction: (name, actions) => npcInteraction.push({ name, actions }),
    onNpcDeath: noop,
    onPlayerLogin: handler => login.push(handler),
    onPlayerMapSquareChange: noop,
    onInterfaceActionButton: noop,
    onObjectRoute: noop,
    onCustomEvent: (key, handler) => (events[key] ??= []).push(handler),
    emitCustomEvent: (key, event) => (events[key] ?? []).forEach(handler => handler(event)),
  }, { get: (target, key) => target[key] ?? noop });
  require('../plugins/quests/quests/WhileGuthixSleeps.Quest')(api);
  return { events, itemOnObject, itemOnNpc, objectInteraction, npcInteraction, login,
    quest: runtime.getRegisteredQuests().at(-1) };
}

function action(h, p, stepId, npcId) {
  const event = { player: p, stepId, npcId, handled: false };
  for (const handler of h.events['npc-dialogue:action'] ?? []) handler(event);
  return event;
}

function useObject(h, p, name, option, extra = {}) {
  let handled = false;
  for (const entry of h.objectInteraction) {
    if (entry.name !== name) continue;
    const fn = entry.actions[option];
    if (!fn) continue;
    const event = { player: p, option, handled: false, ...extra };
    const result = fn(event);
    handled = handled || result === true || event.handled === true;
  }
  return handled;
}

function talkTo(h, p, name, npcId) {
  let handled = false;
  for (const entry of h.npcInteraction) {
    if (entry.name !== name) continue;
    const event = { player: p, npcId, handled: false };
    const result = entry.actions['Talk-to'](event);
    handled = handled || result === true || event.handled === true;
  }
  return handled;
}

function useItemOnNpc(h, p, itemId, target, extra = {}) {
  let handled = false;
  for (const entry of h.itemOnNpc) {
    const event = { player: p, itemId, target, handled: false, ...extra };
    const result = entry.handler(event);
    handled = handled || result === true || event.handled === true;
  }
  return handled;
}

function line(h, p, text, npcId) {
  const event = { player: p, text, npcId, handled: false };
  for (const handler of h.events['npc-dialogue:line'] ?? []) handler(event);
  if (event.after) event.after();
  return event;
}

const K = core.NpcIdentifiers;
const I = core.ItemIdentifiers;
const STAGE = 'quest.while_guthix_sleeps.stage';

test('the trained-broav handoff consumes the unconscious broav and records the trail', () => {
  const h = harness();
  const p = makePlayer();
  p.attrs.set(STAGE, 40); // Fixture: the hunter/broav leg.
  // Cache spawn data places the While Guthix Sleeps hunting expert (id 1504)
  // at the helper tile 2525,2917; 5529 is a different same-named spawn.
  action(h, p, 'yDZ8x8', 1504);
  assert.equal(p.items.get(2970), 1, 'the correct hunting expert hands over the fungus');
  p.items.set(I.UNCONSCIOUS_BROAV, 1);

  action(h, p, 'bti8GZ', 1504);
  assert.equal(p.items.get(I.UNCONSCIOUS_BROAV) ?? 0, 0, 'the unconscious broav is consumed');
  assert.equal(p.items.get(I.BROAV), 1, 'the hunting expert returns a trained broav');
  assert.equal(p.attrs.get('while-guthix-sleeps:broav-trained'), 1);

  const steps = [];
  const npc = { getId: () => K.BROAV, getOwner: () => p, getMovementQueue: () => ({ addSteps: tile => steps.push(tile) }) };
  p.items.set(I.DIRTY_SHIRT, 1);
  p.setLocation(2519, 3249, 0);
  const tracked = useItemOnNpc(h, p, I.DIRTY_SHIRT, npc);
  assert.equal(tracked, true, 'the dirty shirt is owned by the quest handler on the owner broav');
  assert.equal(p.attrs.get('while-guthix-sleeps:broav-trail'), 1);
  assert.equal(p.items.get(I.DIRTY_SHIRT) ?? 0, 0, 'the dirty shirt is consumed by the scent');
  assert.ok(p.log.some(entry => entry[0] === 'sendVarbit' && entry[1] === 10840 && entry[2] === 1));
  assert.deepEqual([steps.at(-1).getX(), steps.at(-1).getY(), steps.at(-1).getZ()], [2519, 3248, 0], 'the broav follows the scent to the broken table');

  // The helper says another dirty shirt comes from the Khazard Launderer.
  p.attrs.set('while-guthix-sleeps:shirt-paid', 1);
  assert.equal(talkTo(h, p, 'Khazard Launderer', 13516), true);
  assert.equal(p.items.get(I.DIRTY_SHIRT), 1, 'talking to the launderer restores a lost shirt');

  p.setLocation(2300, 3000, 0);
  p.attrs.set('while-guthix-sleeps:broav-trail', 0);
  useItemOnNpc(h, p, I.DIRTY_SHIRT, npc);
  assert.equal(p.attrs.get('while-guthix-sleeps:broav-trail'), 0, 'a scent attempt outside the battlefield does not advance');
});

test('the broken table and trapdoor handoff advances to Movario base entry', () => {
  const h = harness();
  const p = makePlayer();
  p.attrs.set(STAGE, 90); // Fixture: the helper's search/enter legs.
  p.attrs.set('while-guthix-sleeps:broav-trail', 1);

  assert.equal(useObject(h, p, 'Broken table', 'Search', { objectId: 53277 }), true);
  assert.equal(p.attrs.get('while-guthix-sleeps:broav-trail'), 2);
  assert.equal(useObject(h, p, 'Trapdoor table', 'Open', { objectId: 53278 }), true);
  assert.equal(p.attrs.get('while-guthix-sleeps:broav-trail'), 3);
  let entered = null;
  h.events['wgs:enter-movario'] = [({ player }) => { entered = player; }];
  assert.equal(useObject(h, p, 'Trapdoor', 'Climb-down', { objectId: 53279 }), true);
  assert.equal(h.quest.getStage(p), 100, 'the open table enters the base at the durable stage');
  assert.equal(entered, p);
});

test('the registered hand-in completes on varbit 9653 = 900 and does not repeat rewards', () => {
  const h = harness();
  const p = makePlayer();
  p.attrs.set(STAGE, 880); // Fixture: the final alliance conversation.
  assert.equal(h.quest.varbitId, 9653);
  assert.equal(h.quest.completionValue, 900);

  line(h, p, 'And the world will be safe once more.', K.AKRISAE);
  assert.equal(h.quest.getStage(p), 900, 'the final line completes the quest');
  assert.equal(h.quest.isComplete(p), true);
  assert.ok(p.log.some(entry => entry[0] === 'sendVarbit' && entry[1] === 9653 && entry[2] === 900),
    'the completion wire is the canonical varbit 9653 = 900');
  const xpKey = `xp:${core.Skill.THIEVING.index}`;
  assert.equal(p.skills.get(xpKey), 80000);
  assert.equal(p.skills.get(`xp:${core.Skill.FARMING.index}`), 75000);
  assert.equal(p.skills.get(`xp:${core.Skill.HERBLORE.index}`), 75000);
  assert.equal(p.skills.get(`xp:${core.Skill.HUNTER.index}`), 50000);

  const xp = p.skills.get(xpKey);
  line(h, p, 'And the world will be safe once more.', K.AKRISAE);
  assert.equal(p.skills.get(xpKey), xp, 'repeat dialogue does not reward twice');
});

test('login and bootstrap replay the saved 900 stage on varbit 9653', () => {
  harness();
  const p = makePlayer();
  p.attrs.set(STAGE, 900);
  p.log.length = 0;
  runtime.sendQuestVarps({ player: p });
  assert.ok(p.log.some(entry => entry[0] === 'sendVarbit' && entry[1] === 9653 && entry[2] === 900),
    'login resends the saved completion stage');
  p.log.length = 0;
  runtime.sendQuestVarps({ player: p });
  assert.ok(p.log.some(entry => entry[0] === 'sendVarbit' && entry[1] === 9653 && entry[2] === 900),
    'bootstrap-complete resends the saved completion stage');
});

// --- Ancient Guthixian Temple: the druid pouch charges and the eight spirits ---
// The pouch is one stackable item whose count is the number of charges (Wiki:
// "a druid pouch(6)"); a spent pouch becomes the empty pouch, which the vine
// flowers refill through the shared druid pouch fill (Nature Spirit).

function templePlayer() {
  const items = new Map();
  const messages = [];
  const log = [];
  const attrs = new Map();
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (!items.has(id) && !inventory.getFreeSlots()) return false;
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    deleteNumber: (id, amount = 1) => {
      const left = (items.get(id) ?? 0) - amount;
      if (left > 0) items.set(id, left); else items.delete(id);
      return true;
    },
    getFreeSlots: () => 28 - items.size,
    getItems: () => [...items.entries()].map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
  };
  const sender = new Proxy({}, { get: (_target, prop) => (...args) => { log.push([String(prop), ...args]); return sender; } });
  const location = new core.Location(4061, 4466, 0);
  return {
    items, messages, log, attrs,
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getPacketSender: () => sender,
    getLocation: () => location,
    moveTo: () => {},
    sendMessage: text => messages.push(text),
  };
}

function templeHarness() {
  const drops = [], objects = [], itemsOnNpc = [], itemOnObject = [], logins = [], stages = [];
  const coreMock = {
    ...core,
    ItemOnGroundManager: { registerLocation: (_player, item) => drops.push(item.getId()) },
    ObjectManager: { objectsAt: () => [], deregister: () => {} },
  };
  const api = new Proxy({
    core: coreMock,
    onObjectInteraction: (name, actions) => objects.push({ name, actions }),
    onItemOnNpc: handler => itemsOnNpc.push(handler),
    onItemOnObject: handler => itemOnObject.push(handler),
    onItemAction: noop,
    onCustomEvent: noop,
    onPlayerLogin: handler => logins.push(handler),
  }, { get: (target, key) => target[key] ?? noop });
  const f = require('../plugins/quests/wgs/Temple.WhileGuthixSleeps')({
    api,
    stage: () => 760,
    advance: (_player, stage) => stages.push(stage),
    held: (player, id) => player.getInventory().contains(id),
    give: (player, id, amount = 1) => {
      if (player.getInventory().contains(id)) return true;
      if (!player.getInventory().getFreeSlots()) { player.sendMessage('You need a free inventory space.'); return false; }
      player.getInventory().adds(id, amount);
      return true;
    },
    val: (player, key) => Number(player.getAttribute(key)) || 0,
    replace: noop,
    ATTRIBUTES: [],
  });
  return { f, drops, objects, itemsOnNpc, itemOnObject, logins, stages };
}

function searchSkeleton(t, p) {
  for (const entry of t.objects) {
    if (entry.name !== 'Skeleton') continue;
    return entry.actions.Search({ player: p, option: 'Search', handled: false, definition: { id: 54088 } });
  }
  return false;
}

function usePouchOnSpirit(t, p, index, itemId = 2958) {
  const npc = { getId: () => 13575, getOwner: () => p, getLocation: () => new core.Location(4045, 4450, 0) };
  t.f.spirits.set(npc, index);
  const before = t.drops.length;
  for (const handler of t.itemsOnNpc) handler({ player: p, itemId, target: npc, handled: false });
  return t.drops.length - before;
}

function useItemOnObject(t, p, itemId, objectId, x, y) {
  for (const handler of t.itemOnObject) {
    handler({ player: p, itemId, handled: false, definition: { id: objectId }, object: { getLocation: () => new core.Location(x, y, 0) } });
  }
}

let natureSpiritActions = null;
/** The shared druid pouch fill (Nature Spirit) is what refills the temple pouch. */
function fillPouch(p) {
  if (!natureSpiritActions) {
    const handlers = [];
    const api = new Proxy({
      core,
      persistAttribute: noop,
      onNpcDialogueVariant: noop,
      onNpcDialogueCondition: noop,
      onCustomEvent: noop,
      onNpcDeath: noop,
      onItemOnNpc: noop,
      onItemOnItem: noop,
      onItemOnObject: noop,
      onItemAction: handler => handlers.push(handler),
      onGroundItemPickup: noop,
      onObjectInteraction: noop,
      onPlayerLogin: noop,
      onPlayerLogout: noop,
      registerArea: noop,
    }, { get: (target, key) => target[key] ?? noop });
    require('../plugins/quests/quests/NatureSpirit.Quest')(api);
    natureSpiritActions = handlers;
  }
  for (const handler of natureSpiritActions) handler({ player: p, itemId: 2957, option: 'Fill', handled: false });
}

function dialogueTexts(player) {
  const texts = [];
  for (const chain of player.dialogues) {
    const entries = chain?.getDialogues?.() ?? chain;
    if (!(entries instanceof Map)) continue;
    for (const entry of entries.values()) if (typeof entry.getText === 'function') texts.push(entry.getText());
  }
  return texts;
}

test('the temple pouch spends one charge per spirit and vine flowers refill it', () => {
  const t = templeHarness();
  const p = templePlayer();
  t.f.sessions.set(p, {});
  const state = t.f.state(p);

  assert.equal(searchSkeleton(t, p), true);
  assert.equal(p.items.get(2958), 6, 'the skeleton grants a druid pouch with six charges');
  assert.ok(p.log.some(entry => entry[0] === 'sendVarbit' && entry[1] === 10810 && entry[2] === 1),
    'the searched remains are recorded (WGS_DRUID_REMAINS_SEARCHED)');

  let dropped = 0;
  for (let i = 0; i < 6; i++) {
    dropped += usePouchOnSpirit(t, p, i);
    assert.equal(p.items.get(2958) ?? 0, 5 - i, 'each spirit spends one pouch charge');
  }
  const expected = state.types.slice(0, 6).reduce((n, type) => n + t.f.RECIPES[type][3][0].length, 0);
  assert.equal(dropped, expected, 'each spirit drops exactly the ingredients its statue needs');
  assert.equal(p.items.has(2958), false, 'the pouch is empty after six spirits');
  assert.equal(p.items.get(2957), 1, 'the spent pouch becomes the empty pouch');

  assert.equal(usePouchOnSpirit(t, p, 6, 2957), 0, 'the empty pouch frees no spirit');
  assert.ok(p.messages.includes('You have nothing left in your druid pouch!'));

  p.items.set(29556, 3);
  fillPouch(p);
  assert.equal(p.items.get(2958), 3, 'three vine flowers refill the pouch with three charges');
  assert.equal(p.items.has(29556), false, 'the vine flowers are consumed');
  assert.equal(p.items.has(2957), false, 'the empty pouch is consumed by the fill');

  const sixth = state.types[6], seventh = state.types[7];
  assert.equal(usePouchOnSpirit(t, p, 6), t.f.RECIPES[sixth][3][0].length, 'the seventh spirit is freed after the refill');
  assert.equal(usePouchOnSpirit(t, p, 7), t.f.RECIPES[seventh][3][0].length, 'the eighth spirit is freed after the refill');
  assert.equal(state.revealed, 255, 'all eight spirits have left their ingredients');
});

test('the temple skeleton search is capacity-safe, retryable and replaces a lost pouch', () => {
  const t = templeHarness();
  const p = templePlayer();
  t.f.sessions.set(p, {});
  for (let i = 0; i < 28; i++) p.items.set(30000 + i, 1);

  assert.equal(searchSkeleton(t, p), true);
  assert.equal(p.items.has(2958), false, 'a full bag grants no pouch');
  assert.ok(!p.log.some(entry => entry[0] === 'sendVarbit' && entry[1] === 10810 && entry[2] === 1),
    'the remains stay unsearched so the search can be retried');

  p.items.delete(30000);
  assert.equal(searchSkeleton(t, p), true);
  assert.equal(p.items.has(2958), false, 'one free slot cannot hold both the sickle and the pouch');
  assert.ok(p.messages.includes('You need a free inventory space to take the druid pouch.'));

  p.items.delete(30001);
  assert.equal(searchSkeleton(t, p), true);
  assert.equal(p.items.get(2958), 6, 'the retried search grants the pouch');
  assert.equal(p.items.get(2963), 1, 'the retried search also grants the silver sickle');

  p.items.delete(2958);
  p.items.delete(2957);
  assert.equal(searchSkeleton(t, p), true);
  assert.equal(p.items.get(2958), 6, 'a lost pouch is replaced by searching the remains again');
});

test('relogging resends the temple varbits and keeps the puzzle state', () => {
  const t = templeHarness();
  const p = templePlayer();
  t.f.sessions.set(p, {});
  const state = t.f.state(p);
  searchSkeleton(t, p);
  usePouchOnSpirit(t, p, 0);

  p.log.length = 0;
  for (const handler of t.logins) handler({ player: p });
  assert.ok(p.log.some(entry => entry[0] === 'sendVarbit' && entry[1] === 10810 && entry[2] === 1),
    'the searched remains are resend on login');
  assert.ok(p.log.some(entry => entry[0] === 'sendVarbit' && entry[1] === 10828 && entry[2] === 0),
    'the dolmen count is resend on login');
  assert.equal(t.f.state(p).revealed, state.revealed, 'the freed spirits survive the relog');
});

test('the eight dolmens open the temple door and advance to stage 800', () => {
  const t = templeHarness();
  const p = templePlayer();
  t.f.sessions.set(p, {});
  const state = t.f.state(p);
  searchSkeleton(t, p);

  for (let i = 0; i < 8; i++) {
    const recipe = t.f.RECIPES[state.types[i]];
    const [x, y] = t.f.SITES[i];
    for (const ingredient of recipe[3][0]) {
      p.items.set(ingredient, 1);
      useItemOnObject(t, p, ingredient, recipe[1], x, y);
    }
    assert.equal(p.items.get(recipe[2]), 1, 'completing a statue yields its dolmen');
    useItemOnObject(t, p, recipe[2], 54083, 4076, 4437);
  }
  assert.equal(state.placed, 255, 'all eight dolmens are on the stone table');
  assert.ok(t.stages.includes(800), 'the huge door opens and the quest reaches stage 800');
  assert.ok(p.log.some(entry => entry[0] === 'sendVarbit' && entry[1] === 10815 && entry[2] === 0), 'the door varbit is cleared');
});

test('the druid at the enriched snapdragon patch replaces a lost harvest', () => {
  const h = harness();
  const p = makePlayer();
  p.attrs.set(STAGE, 300); // Fixture: the harvest leg of the fellowship.

  assert.equal(talkTo(h, p, 'Druid', 13554), true);
  assert.ok(dialogueTexts(p).some(text => text.includes('ready for you to harvest')),
    'an unpicked harvest is reported by the druid');
  assert.equal(p.items.get(29530) ?? 0, 0, 'the herb is still on the patch');

  for (let slot = 0; slot < 28; slot++) p.items.set(20000 + slot, 1); // Fixture: full bag.
  assert.equal(useObject(h, p, 'Herbs', 'Pick', { objectId: 53292 }), true);
  assert.equal(p.attrs.get('while-guthix-sleeps:herb-picked') ?? 0, 0,
    'a refused harvest must not become a lost-herb claim');
  p.items.clear();
  assert.equal(useObject(h, p, 'Herbs', 'Pick', { objectId: 53292 }), true);
  assert.equal(p.attrs.get('while-guthix-sleeps:herb-picked'), 1);
  assert.equal(p.items.get(29530), 1, 'a retry harvest grants the herb');
  p.items.delete(29530); // Fixture: the collected herb was lost.
  p.dialogues.length = 0;
  assert.equal(talkTo(h, p, 'Druid', 13554), true);
  assert.equal(p.items.get(29530), 1, 'the druid hands over a replacement enriched snapdragon');
  assert.ok(dialogueTexts(p).includes('I lost the enriched snapdragon I harvested.'),
    'the canonical replacement dialogue is played');

  p.items.delete(29530);
  p.dialogues.length = 0;
  assert.equal(talkTo(h, p, 'Druid', 13554), true);
  assert.equal(p.items.get(29530), 1, 'a lost herb is replaced again');

  p.dialogues.length = 0;
  assert.equal(talkTo(h, p, 'Druid', 13554), true);
  assert.ok(dialogueTexts(p).some(text => text.includes('to Thaerisk')),
    'a held harvest is reported by the druid');
});
