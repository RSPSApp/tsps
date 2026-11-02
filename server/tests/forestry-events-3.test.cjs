// Run after `yarn build`: node --test tests/forestry-events-3.test.cjs
//
// Forestry's Flowering Bush, Entlings and Beehive against the rsprox recordings (and the Wiki
// for rewards).
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');

let Spawns, Flowering, Entlings, Beehive, Common, hooks, core;
/** Area sounds the units played, as [id, x, y, radius, delay]. */
const areaSounds = [];

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  core = PluginManager.getCoreApi();
  hooks = { npcs: new Map(), prompts: [] };
  const api = {
    core,
    persistAttribute() {},
    onNpcDialogueVariant() {},
    onNpcDialogueCondition() {},
    onItemOnNpc() {},
    onObjectInteraction() {},
    onNpcInteraction: (name, actions) => {
      if (typeof name === 'function') (hooks.anyNpc ??= []).push(name);
      else for (const [op, fn] of Object.entries(actions)) hooks.npcs.set(`${name}:${op}`, fn);
    },
    onCustomEvent() {},
    onPlayerLogout: (fn) => { (hooks.logout ??= []).push(fn); },
    onPlayerLogin() {},
    emitCustomEvent() {},
    sendMultiChatboxPrompt: (player, title, ...args) => hooks.prompts.push({ title, args }),
  };
  const Woodcutting = require('../plugins/skills/Woodcutting.plugin');
  Woodcutting.isWoodcuttingActive = () => false;
  Woodcutting.stopWoodcutting = () => {};
  require('../plugins/minigames/Forestry.plugin').register(api);
  require('../plugins/minigames/ForestryMembers.plugin').register(api);
  Spawns = require('../plugins/minigames/forestry/Spawns.Forestry');
  Flowering = require('../plugins/minigames/forestry/Flowering.Forestry');
  Entlings = require('../plugins/minigames/forestry/Entlings.Forestry');
  Beehive = require('../plugins/minigames/forestry/Beehive.Forestry');
  Common = require('../plugins/minigames/forestry/Common.Forestry');
  // The fake players aren't in the world, so record area sounds where they're sent.
  Common.areaSound = (location, id, radius = 10, delay = 0) => areaSounds.push([id, location.getX(), location.getY(), radius, delay]);
});

beforeEach(() => {
  ticks(320);
  for (const event of [...Spawns.active]) Spawns.active.delete(event);
  Spawns.quiet.length = 0;
  hooks.prompts.length = 0;
  areaSounds.length = 0;
});

function container() {
  const slots = [];
  return {
    slots,
    add(item) { const slot = slots.find((s) => s.id === item.getId()); if (slot) slot.amount += item.getAmount(); else slots.push({ id: item.getId(), amount: item.getAmount() }); },
    delete(id, amount = 1) { const slot = slots.find((s) => s.id === id && s.amount > 0); if (slot) slot.amount -= amount; },
    contains: (id) => slots.some((s) => s.id === id && s.amount > 0),
    getAmount: (id) => slots.filter((s) => s.id === id).reduce((sum, s) => sum + s.amount, 0),
    getFreeSlots: () => 20,
    getAddableAmount: (item) => item.getAmount(),
    full() {},
  };
}

let index = 0;
function fakePlayer({ at = new Location(3085, 3233, 0), level = 70 } = {}) {
  const id = ++index;
  const timers = new Map();
  const p = {
    location: at, messages: [], spam: [], anims: [], xp: {}, chats: [], graphics: [], sounds: [], menus: [], inventory: container(),
    getIndex: () => id, getUsername: () => `Tester${id}`, isPlayer: () => true, isRegistered: () => true,
    getLocation: () => p.location,
    getAttribute: () => null, setAttribute() {},
    getInventory: () => p.inventory,
    getEquipment: () => ({ contains: () => false }),
    sendMessage: (m) => p.messages.push(m),
    performAnimation: (a) => p.anims.push(a.getId()),
    performGraphic: (g) => p.graphics.push([g.getId(), g.height]),
    setPositionToFace() {},
    getMovementQueue: () => ({ reset() {} }),
    getTimers: () => ({ registers: (key, ticks) => timers.set(key, ticks), has: (key) => (timers.get(key) ?? 0) > 0 }),
    unstun: () => timers.clear(),
    getSkillManager: () => ({
      addExperience: (skill, amount) => { const n = String(skill.getName?.() ?? skill); p.xp[n] = (p.xp[n] ?? 0) + amount; },
      getCurrentLevel: () => level, getMaxLevel: () => level,
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => p.chats.push(chain), reset() {} }),
    getPacketSender() {
      const sender = {
        sendTypedMessage: (type, text) => { p.spam.push(text); return sender; },
        sendSoundEffect: (sound) => { p.sounds.push(sound); return sender; },
        sendCreationMenu: (menu) => { p.menus.push(menu); return sender; },
        sendAreaSound: () => sender, sendGraphic: () => sender, sendObjectAnimation: () => sender,
      };
      return sender;
    },
  };
  return p;
}

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

const WILLOW = { id: 10833, x: 3083, y: 3237 };
function startEvent(kind, players) {
  const object = new core.GameObject(WILLOW.id, new Location(WILLOW.x, WILLOW.y, 0), 10, 0, null);
  return Spawns.spawn({ object, location: object.getLocation().clone(), name: 'Willow tree', size: 2 }, players, kind);
}

const bark = (p) => p.inventory.getAmount(28134);
const xp = (p, skill) => p.xp[skill] ?? p.xp[skill.toUpperCase()] ?? 0;
const dialogues = (chain) => [...chain.dialogues.values()];
const lines = (chain) => dialogues(chain).map((d) => d.text).filter(Boolean);
const heard = (id) => areaSounds.filter(([sound]) => sound === id);
/** Continues a chat to its end action. */
const finish = (chain) => dialogues(chain).find((d) => d.action)?.action.execute();

// ------------------------------------------------------------------ flowering bush

const NAMES = ['Lilac', 'Pink', 'Red', 'Orange', 'Yellow', 'White', 'Green', 'Blue'];
function tend(player, bush) {
  return hooks.npcs.get(`<col=00ffff>Flowering bush (${NAMES[bush.colour]})</col>:Tend-to`)({ player, npc: bush.npc });
}
const UNPOLLINATED = '<col=3366ff>Bees are very active on this bush and there are unpollinated flowers.</col> You carefully apply your pollen with the help of your bee then extract some from the bush.';
const POLLEN = 28192;

/** Every pollinated bush fruits, for the length of `body`. */
function alwaysFruit(body) {
  const flowering = Common.data.flowering;
  const chance = flowering.fruitChancePerApply;
  flowering.fruitChancePerApply = 1;
  try {
    body();
  } finally {
    flowering.fruitChancePerApply = chance;
  }
}

test('flowering: eight bushes and a pair; pollen collected, then applied and taken back over two ticks', () => {
  const p = fakePlayer({ level: 80 });
  const event = startEvent('flowering', [p]);
  assert.equal(event.bushes.length, 8);
  assert.deepEqual(event.bushes.map((b) => b.npc.getId()), [12120, 12134, 12141, 12143, 12145, 12147, 12149, 12151]);
  const [a, b] = event.pair.bushes;
  const other = event.bushes.find((x) => x !== a && x !== b);
  tend(p, other);
  assert.deepEqual(lines(p.chats.at(-1)), ['The flowers on this bush have not yet opened enough to harvest<br>pollen.']);
  ticks(3);
  tend(p, a);
  assert.equal(p.messages.at(-1), '<col=3366ff>Bees are very active on this bush and there are pollen-rich flowers.</col> You carefully collect some Strange pollen.');
  assert.equal(p.inventory.getAmount(POLLEN), 1);
  assert.deepEqual(p.sounds, [2581]);
  ticks(3);
  tend(p, a);
  assert.deepEqual(lines(p.chats.at(-1)), ['You took the pollen from this bush and should apply it to a bush with<br>unpollinated flowers.']);
  ticks(3);
  tend(p, other);
  assert.deepEqual(lines(p.chats.at(-1)), ['There are no open, unpollinated flowers on this bush yet.']);
  ticks(3);
  p.anims.length = 0;
  tend(p, b);
  assert.equal(p.messages.at(-1), UNPOLLINATED);
  assert.equal(p.inventory.getAmount(POLLEN), 0, 'the pollen goes on the bush');
  assert.deepEqual(p.sounds.slice(-1), [2427]);
  assert.equal(bark(p), 0, 'the bark comes with the pollen back');
  ticks(1);
  assert.equal(p.inventory.getAmount(POLLEN), 1);
  assert.deepEqual(p.sounds.slice(-1), [2581]);
  assert.deepEqual(p.anims, [832, 832], 'the seq on both ticks');
  const after = bark(p);
  assert.ok(after >= 1 && after <= 2);
  tend(p, a);
  assert.equal(p.inventory.getAmount(POLLEN), 1, 'too soon: still busy');
  ticks(2);
  tend(p, a);
  ticks(1);
  assert.ok(bark(p) > after, 'and back again');
  assert.equal(p.messages.filter((m) => m === UNPOLLINATED).length, 1, 'not on the bush the pollen was collected from');
  assert.equal(Math.round(xp(p, 'Woodcutting') * 10), Math.round(2 * (0.2 * 80 + 2.8) * 10));
});

test('flowering: pairs close every 70 ticks; a pollinated bush fruits, goes and grows back; the end at 299', () => alwaysFruit(() => {
  const p = fakePlayer();
  const event = startEvent('flowering', [p]);
  const [a, b] = event.pair.bushes;
  tend(p, a);
  ticks(3);
  tend(p, b);
  ticks(1);
  ticks(65);
  assert.equal(b.fruited, false);
  ticks(1);
  assert.equal(b.fruited, true, 'the pair closes at 70');
  assert.equal(a.fruited, false, 'no pollen applied to it');
  assert.equal(a.finished, true);
  assert.equal(p.messages.at(-1), '<col=229628>A bush has started producing fruit, well done!</col>');
  assert.ok(p.sounds.includes(7014));
  assert.equal(heard(818).length, 2, 'at both bushes of the pair');
  assert.ok(!event.pair.bushes.includes(a) && !event.pair.bushes.includes(b), 'a new pair');
  // The pollen came back from b: the same-bush line comes before the fruiting one.
  ticks(3);
  tend(p, b);
  assert.deepEqual(lines(p.chats.at(-1)), ['You took the pollen from this bush and should apply it to a bush with<br>unpollinated flowers.']);
  const q = fakePlayer();
  tend(q, b);
  const box = dialogues(q.chats.at(-1))[0];
  assert.equal(box.itemId, 464);
  assert.equal(box.text, "<col=229628>The bush is already fruiting and won't benefit from<br><col=229628>any more pollen.</col>");
  ticks(3);
  tend(q, a);
  assert.deepEqual(lines(q.chats.at(-1)), ['This bush has finished flowering and has no pollen to harvest.']);
  // Pollen from the last pair works on this one; the long line on the first apply to each bush.
  const [c, d] = event.pair.bushes;
  tend(p, c);
  ticks(3);
  tend(p, d);
  ticks(1);
  assert.equal(p.messages.filter((m) => m === UNPOLLINATED).length, 3);
  ticks(6);
  assert.ok(!event.bushes.includes(b), 'the fruiting bush goes 15 ticks after');
  ticks(9);
  assert.ok(event.bushes.some((x) => x.colour === b.colour), 'and grows back 10 after that');
  assert.ok(!event.bushes.find((x) => x.colour === b.colour).npc.getLocation().equals(b.npc.getLocation()), 'on another tile');
  ticks(45);
  assert.equal(c.fruited && d.fruited, true, 'both bushes of the pair');
  assert.equal(p.messages.at(-1), '<col=229628>Some bushes have started producing fruit, well done!</col>');
  ticks(299 - 140 - 1);
  assert.equal(Flowering.events.has(event), true);
  ticks(1);
  assert.equal(Flowering.events.has(event), false, 'over at 299');
  const dormant = "<col=229628>The bushes become dormant and the bees move on. You've helped make the forest a more diverse and beautiful place!</col>";
  assert.ok(!p.messages.includes(dormant));
  const before = bark(p);
  ticks(1);
  assert.ok(p.messages.includes(dormant), 'the tick after');
  assert.ok(p.messages.includes('You discard your left over pollen.'));
  assert.equal(p.inventory.getAmount(POLLEN), 0);
  assert.equal(bark(p), before);
  ticks(1);
  assert.ok(bark(p) > before, 'the lump the tick after that');
  assert.ok(p.inventory.getAmount(464) >= 1 && p.inventory.getAmount(464) <= 8, 'strange fruit');
}));

test('flowering: the pair open at the end closes with it, so its exchanges count', () => alwaysFruit(() => {
  const p = fakePlayer();
  const event = startEvent('flowering', [p]);
  ticks(280);
  const [a, b] = event.pair.bushes;
  tend(p, a);
  ticks(3);
  tend(p, b);
  ticks(1);
  ticks(299 - 284);
  assert.equal(Flowering.events.has(event), false);
  assert.equal(b.fruited, true);
  ticks(2);
  assert.ok(p.inventory.getAmount(464) >= 1, 'the lump came');
}));

test('logging out with pollen drops it', () => {
  const p = fakePlayer();
  const event = startEvent('flowering', [p]);
  tend(p, event.pair.bushes[0]);
  for (const fn of hooks.logout) fn({ player: p });
  assert.equal(p.inventory.getAmount(POLLEN), 0);
});

// ------------------------------------------------------------------ entlings

function prune(player, entling, op) {
  player.location = entling.npc.getLocation().clone();
  return hooks.npcs.get(`Entling:${op}`)({ player, npc: entling.npc });
}

test('entlings: five with requests on their own timers; the right cut prunes for bark, the wrong one stuns', () => {
  const p = fakePlayer({ level: 60 });
  const event = startEvent('entlings', [p]);
  assert.equal(event.entlings.length, 5);
  assert.equal(heard(7533).length, 5, 'a sound at each as it appears');
  const said = new Map();
  for (const e of event.entlings) e.npc.forceChat = (text) => said.set(e, [...(said.get(e) ?? []), text]);
  ticks(7);
  assert.equal(said.size, 5, 'each calls within 4-7 ticks');
  const entling = event.entlings[0];
  entling.say = 'Short on top!';
  entling.needs = { top: 2 };
  prune(p, entling, 'Prune-back');
  assert.equal(p.chats.length, 0, 'the stun comes the tick after');
  ticks(1);
  assert.deepEqual(lines(p.chats.at(-1)), ["Woah, that's not the cut I asked for!"]);
  assert.equal(dialogues(p.chats.at(-1))[0].expression, 596, 'chatscared1');
  assert.deepEqual(p.anims.slice(-1), [848]);
  assert.deepEqual(p.graphics, [[254, 124]]);
  assert.deepEqual(p.sounds, [2565, 2727, 7547]);
  p.unstun();
  ticks(1);
  prune(p, entling, 'Prune-top');
  assert.equal(p.spam.at(-1), 'You prune the entling.');
  assert.deepEqual(p.sounds.slice(-1), [2440]);
  assert.equal(bark(p), 0);
  ticks(1);
  assert.ok(bark(p) >= 4 && bark(p) <= 5, 'the bark the tick after');
  assert.equal(xp(p, 'Woodcutting'), 30);
  assert.equal(Math.round(xp(p, 'Fletching')), 12);
  prune(p, entling, 'Prune-top');
  ticks(1);
  prune(p, entling, 'Prune-top');
  assert.equal(entling.pruned, true);
  assert.equal(entling.npc.getId(), 12543, 'it turns the tick after');
  ticks(1);
  assert.equal(entling.npc.getId(), 12544, 'the pruned form');
  assert.equal(heard(7553).length, 1);
  assert.ok(['That feels better! Thanks!', 'Now I look snazzy! Thanks!', "That's perfect! Thanks!"].includes(said.get(entling).at(-1)));
  ticks(1);
  hooks.npcs.get('Pruned Entling:Prune-top')({ player: p, npc: entling.npc });
  ticks(1);
  assert.deepEqual(lines(p.chats.at(-1)), ['Hey, my cut is perfect, leave it alone!']);
  assert.equal(said.get(entling).at(-1), 'My cut is perfect, leave it alone!');
});

test("Prune's menu, then the end at 199: haircuts three ticks on, the gift the tick after", () => {
  const p = fakePlayer({ level: 50 });
  const event = startEvent('entlings', [p]);
  for (const entling of event.entlings.slice(0, 2)) entling.needs = { back: 1, sides: 1 };
  const [first, second] = event.entlings;
  p.location = first.npc.getLocation().clone();
  hooks.npcs.get('Entling:Prune')({ player: p, npc: first.npc });
  const menu = hooks.prompts.at(-1);
  assert.equal(menu.title, 'Which area of the entling would you like to prune?');
  assert.deepEqual(menu.args.filter((x) => typeof x === 'string'), ['Top', 'Back', 'Sides', 'Cancel']);
  menu.args[3]();
  for (const [entling, op] of [[first, 'Prune-sides'], [second, 'Prune-back'], [second, 'Prune-sides']]) {
    ticks(2);
    prune(p, entling, op);
  }
  assert.equal(first.pruned && second.pruned, true);
  ticks(199 - 6 - 1);
  assert.equal(Entlings.events.has(event), true);
  ticks(1);
  assert.equal(Entlings.events.has(event), false);
  assert.equal(heard(7540).length, 5, 'a sound at each as it goes');
  const done = "<col=3366ff>Well done, you've given 2 entlings haircuts! The entlings have left you a gift...</col>";
  ticks(2);
  assert.ok(!p.messages.includes(done));
  ticks(1);
  assert.ok(p.messages.includes(done));
  assert.deepEqual(p.sounds.slice(-1), [7531]);
  assert.ok(!p.messages.includes("You've been awarded <col=3366ff>50 Anima-infused bark</col>."));
  ticks(1);
  assert.ok(p.messages.includes("You've been awarded <col=3366ff>50 Anima-infused bark</col>."));
  assert.equal(p.inventory.getAmount(6024), 8, '4 willow leaves an entling');
});

// ------------------------------------------------------------------ beehive

const buildOn = (player, npc) => hooks.npcs.get('<col=00ffff>Unfinished Beehive</col>:Build')({ player, npc });
/** Build, then the how-many menu's choice. */
function addLogs(player, event, amount) {
  buildOn(player, event.box.npc);
  const menu = player.menus.at(-1);
  menu.execute(menu.getItems()[0], amount);
  return menu;
}

test('the beehive: the how-many menu, a log every two ticks with its sound; five logs make a hive', () => {
  const p = fakePlayer({ level: 70 });
  p.inventory.add(new core.Item(1513, 6));
  const event = startEvent('beehive', [p]);
  assert.equal(event.keeper.getId(), 12514);
  assert.deepEqual(heard(1930).map(([, , , radius]) => radius), [7, 5], 'smoke at the keeper and the first box');
  assert.equal(heard(7529).length, 1, 'and the wild hive');
  assert.equal(event.needed, 5);
  const first = event.box;
  const menu = addLogs(p, event, 6);
  assert.equal(menu.getTitle(), 'How many logs would you like to add?');
  assert.deepEqual(menu.getItems(), [1513]);
  assert.deepEqual(menu.getOptions(), { mode: 14, maxAmount: 6 });
  assert.deepEqual(p.anims, [827], 'the seq on the choice');
  assert.equal(first.logs, 0);
  ticks(1);
  assert.equal(first.logs, 1);
  assert.ok([7543, 7548, 7554].includes(p.sounds.at(-1)));
  assert.ok(bark(p) >= 5 && bark(p) <= 6, 'magic logs: the better tier');
  assert.equal(xp(p, 'Construction'), 28);
  ticks(8);
  assert.equal(first.done, true);
  assert.equal(p.inventory.getAmount(1513), 1);
  assert.equal(p.anims.length, 5, 'no seq with the last log');
  assert.equal(first.npc.getId(), 12517, 'complete');
  assert.deepEqual(heard(3046).map(([, , , , delay]) => delay), [50]);
  assert.equal(heard(7536).length, 1);
  const done = "<col=3366ff>Well done, you've completed a beehive. The bees can now be safely rehomed.</col>";
  assert.ok(!p.messages.includes(done));
  hooks.npcs.get('<col=00ffff>Complete Beehive</col>:Build')({ player: p, npc: first.npc });
  const box = dialogues(p.chats.at(-1))[0];
  assert.equal(box.itemId, 1511);
  assert.equal(box.text, "<col=229628>The hive is complete and won't benefit from any more<br><col=229628>wood.</col>");
  ticks(1);
  assert.ok(p.messages.includes(done), 'the tick after');
  assert.notEqual(event.box, first, 'a new box');
  const before = bark(p);
  ticks(1);
  assert.ok(bark(p) - before >= 25 && bark(p) - before <= 30, 'the hive lump the tick after that');
  const smokes = heard(1930).length;
  ticks(2);
  assert.equal(heard(1930).length, smokes, 'the old box still there');
  ticks(1);
  assert.equal(heard(1930).length, smokes + 1, 'gone in smoke 5 ticks after the last log');
});

test('choosing again every tick adds no faster than one log every two ticks', () => {
  const p = fakePlayer();
  p.inventory.add(new core.Item(1513, 6));
  const event = startEvent('beehive', [p]);
  const box = event.box;
  for (let i = 0; i < 5; i++) {
    addLogs(p, event, 6);
    ticks(1);
  }
  assert.equal(box.logs, 3, 'ticks 1, 3 and 5');
  assert.equal(box.done, false);
});

test('Build adds only as many logs as chosen', () => {
  const p = fakePlayer();
  p.inventory.add(new core.Item(1513, 6));
  const event = startEvent('beehive', [p]);
  addLogs(p, event, 2);
  ticks(8);
  assert.equal(event.box.logs, 2);
  assert.equal(p.anims.length, 2, 'the choice and the first log');
});

test('no logs: the item box; the keeper leaves at 249, the rest at 250', () => {
  const p = fakePlayer();
  const event = startEvent('beehive', [p]);
  buildOn(p, event.box.npc);
  const box = dialogues(p.chats.at(-1))[0];
  assert.equal(box.itemId, 1511);
  assert.equal(box.text, 'You have no logs to build this beehive.');
  ticks(248);
  assert.equal(heard(7531).length, 0);
  ticks(1);
  assert.equal(heard(7531).length, 1, 'the keeper goes');
  assert.equal(Beehive.events.has(event), true);
  ticks(1);
  assert.equal(Beehive.events.has(event), false);
  assert.equal(Spawns.active.has(event), false);
});

test('the bee keeper: Talk-to, the menu and his explanation', () => {
  const p = fakePlayer();
  const event = startEvent('beehive', [p]);
  hooks.npcs.get('Bee keeper:Talk-to')({ player: p, npc: event.keeper });
  const chat = p.chats.at(-1);
  assert.deepEqual(lines(chat), ["Hello, what's going on?", "Hello, it seems you've found a wild beehive. I'll pay you<br>to help me rehome them."]);
  assert.deepEqual(dialogues(chat).slice(0, 2).map((d) => d.expression), [554, 568], 'chatquiz1, chathap2');
  finish(chat);
  const menu = hooks.prompts.at(-1);
  assert.deepEqual(menu.args.filter((x) => typeof x === 'string'), ["I'm not interested.", 'How can I help?']);
  menu.args[3]();
  assert.deepEqual(lines(p.chats.at(-1)), [
    "It's easy, simply add logs to the unfinished bee boxes I<br>create. Most common types of log work just fine.",
    "Once a bee box is completed I will start a new one, let's<br>see how many of these bees we can save.",
  ]);
});

test("a new beehive goes where the last stood when there's no room; clicking elsewhere stops building", () => {
  const p = fakePlayer();
  p.inventory.add(new core.Item(1513, 12));
  const event = startEvent('beehive', [p]);
  const freeTiles = Common.freeTiles;
  const first = event.box;
  addLogs(p, event, 12);
  Common.freeTiles = () => [];
  ticks(10);
  Common.freeTiles = freeTiles;
  assert.equal(first.done, true);
  assert.notEqual(event.box, first);
  assert.ok(event.box.npc.getLocation().equals(first.npc.getLocation()));
  addLogs(p, event, 7);
  ticks(2);
  assert.equal(event.box.logs, 1);
  for (const fn of hooks.anyNpc) fn({ player: p, npc: event.keeper });
  ticks(4);
  assert.equal(event.box.logs, 1, 'stopped');
});
