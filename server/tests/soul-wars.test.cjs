// Run after `yarn build`: node --test tests/soul-wars.test.cjs
//
// Soul Wars against the rsprox recordings (227/00079, 234/03277, 229/00668) and the Wiki: the
// lobby and countdown, the start, avatars, the obelisk, area control, deaths and barriers,
// supplies, bones, activity and the end with Zeal.
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');

let Common, Lobby, Match, Avatars, Control, Souls, Death, Supplies, Bots, Rewards, Tutorial, Scoreboard, hooks, core;
const scoreboardDir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'soul-wars-scoreboard-'));
const online = [];
const walks = [];
const obtains = [];
let config = {};
const nativeItemUses = [];

/** Name hooks run in turn until one takes the click, as the plugin manager does. */
function chain(map, key, fn) {
  const prior = map.get(key);
  map.set(key, prior ? (event) => prior(event) || fn(event) : fn);
}

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  new NpcDefinitionLoader().load();
  core = PluginManager.getCoreApi();
  hooks = { objects: new Map(), npcs: new Map(), items: new Map(), prompts: [], death: [], drops: [] };
  const nativeItems = PluginManager.createApi("SoulWarsNativeItems");
  nativeItems.onItemOnPlayer(event => nativeItemUses.push({player:event.player, target:event.target, item:event.item, slot:event.slot, itemId:event.itemId}));
  const api = {
    core,
    persistAttribute() {},
    getPluginConfig: (key, fallback) => config[key] ?? fallback,
    onObjectInteraction: (name, actions) => { for (const [op, fn] of Object.entries(actions)) chain(hooks.objects, `${name}:${op}`, fn); },
    onNpcInteraction: (name, actions) => { for (const [op, fn] of Object.entries(actions)) chain(hooks.npcs, `${name}:${op}`, fn); },
    onGroundItemPickup: (fn) => { hooks.pickup = fn; },
    onNpcDialogueVariant: (fn) => { hooks.variant = fn; },
    onNpcDialogueCondition: (fn) => { hooks.condition = fn; },
    onItemAction: (name, actions) => { nativeItems.onItemAction(name, actions); for (const [op, fn] of Object.entries(actions)) hooks.items.set(`${name}:${op}`, fn); },
    onItemOnPlayer: (fn) => PluginManager.createApi("SoulWarsBandageNative").onItemOnPlayer(fn),
    onNpcHitModify: (fn) => { hooks.hit = fn; },
    onNpcDeath: (fn) => { (hooks.npcDeath ??= []).push(fn); },
    onPlayerDeath: (fn) => hooks.death.push(fn),
    onPlayerBeforeDeath: (fn) => { hooks.beforeDeath = fn; },
    registerArea: (area) => { hooks.lobbyArea = area; },
    onShouldDropItemsOnDeath: (fn) => hooks.drops.push(fn),
    onPlayerLogin() {},
    onPlayerLogout() {},
    onCustomEvent: (name, fn) => { const events = (hooks.events ??= {}); const prior = events[name]; events[name] = prior ? (e) => { prior(e); fn(e); } : fn; },
    emitCustomEvent(name, event) { if (name === 'collection-log:obtain') obtains.push(event); },
    onCanShop: (fn) => { hooks.canShop = fn; },
    onInterfaceActionButton: (ids, fn) => { for (const id of [].concat(ids)) (hooks.buttons ??= new Map()).set(id, fn); },
    sendMultiChatboxPrompt: (player, title, ...args) => hooks.prompts.push({ player, title, args }),
  };
  require('../plugins/minigames/SoulWars.plugin').register(api);
  // Food knows what food is once registered (bots leave theirs behind).
  require('../plugins/items/Food.plugin').register({ ...api, onItemAction() {} });
  Common = require('../plugins/minigames/soulwars/Common.SoulWars');
  Lobby = require('../plugins/minigames/soulwars/Lobby.SoulWars');
  Match = require('../plugins/minigames/soulwars/Match.SoulWars');
  Avatars = require('../plugins/minigames/soulwars/Avatars.SoulWars');
  Control = require('../plugins/minigames/soulwars/Control.SoulWars');
  Souls = require('../plugins/minigames/soulwars/Souls.SoulWars');
  Death = require('../plugins/minigames/soulwars/Death.SoulWars');
  Supplies = require('../plugins/minigames/soulwars/Supplies.SoulWars');
  Bots = require('../plugins/minigames/soulwars/Bots.SoulWars');
  Rewards = require('../plugins/minigames/soulwars/Rewards.SoulWars');
  Tutorial = require('../plugins/minigames/soulwars/Tutorial.SoulWars');
  Scoreboard = require('../plugins/minigames/soulwars/Scoreboard.SoulWars');
  Scoreboard._useFile(require('node:path').join(scoreboardDir, 'world.json'));
  Tutorial.engine.walk = (player, to) => { player.walkedTo = to; };
  Tutorial.engine.projectile = (from, to, target, id) => { target.blasted = id; };
  Tutorial.engine.drop = (player, id, tile) => { (player.dropped ??= []).push([id, tile]); };
  // Fake players don't walk: the bots' routes are recorded instead.
  Bots.engine.walk = (player, to) => walks.push({ player, to });
  Lobby.source.players = () => online;
});

beforeEach(() => {
  Match.reset();
  online.length = 0;
  config = {};
  hooks.prompts.length = 0;
  obtains.length = 0;
  ticks(2);
});

function container(capacity = 28) {
  const slots = [];
  return {
    slots,
    add(item) { const slot = slots.find((s) => s.id === item.getId() && core.ItemDefinition.forId(item.getId()).isStackable()); if (slot) slot.amount += item.getAmount(); else slots.push({ id: item.getId(), amount: item.getAmount() }); },
    delete(id, amount = 1) { for (const s of slots) { if (s.id !== id || amount <= 0) continue; const n = Math.min(s.amount, amount); s.amount -= n; amount -= n; } },
    contains: (id) => slots.some((s) => s.id === id && s.amount > 0),
    getAmount: (id) => slots.filter((s) => s.id === id).reduce((sum, s) => sum + s.amount, 0),
    getFreeSlots: () => capacity - slots.filter((s) => s.amount > 0).length,
    getAddableAmount: (item) => Math.min(item.getAmount(), 2147483647 - slots.filter((s) => s.id === item.getId()).reduce((sum, s) => sum + s.amount, 0)),
    getValidItems: () => slots.filter((s) => s.amount > 0).map((s) => ({ getId: () => s.id, getAmount: () => s.amount })),
    getItems: () => slots.map((s) => (s.amount > 0 ? { getId: () => s.id, getAmount: () => s.amount, getMeta: () => s.meta ?? null } : null)),
    setItem(slot, item) { slots[slot] = { id: item.getId(), amount: item.getAmount(), meta: item.getMeta?.() ?? null }; },
    refreshItems() {}, full() {},
  };
}

let index = 0;
function fakePlayer({ combat = 100, total = 1500, at = new Location(2192, 2842, 0), demonstrated = true } = {}) {
  const id = ++index;
  // Players have seen the Nomad's demonstration unless a test says otherwise.
  const attributes = new Map(demonstrated ? [['soul-wars:finished-tutorial', 1]] : []);
  const levels = {};
  const p = {
    location: at, messages: [], varbits: new Map(), varps: new Map(), texts: new Map(), subs: [], scripts: [], anims: [], graphics: [], hp: 99,
    inventory: container(), worn: [],
    getIndex: () => id, getUsername: () => `Soul${id}`, isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p, isRegistered: () => true,
    getLocation: () => p.location, moveTo(l) { p.location = l; }, setLocation(l) { p.location = l; }, getArea: () => p.area, setArea(a) { p.area = a; },
    getPrivateArea: () => null,
    getAttribute: (k) => attributes.get(k), setAttribute: (k, v) => attributes.set(k, v),
    getInventory: () => p.inventory,
    getEquipment: () => ({ getItems: () => p.worn, setItem(slot, item) { p.worn[slot] = item.getId() > 0 ? item : null; }, refreshItems() {} }),
    getUpdateFlag: () => ({ flag() {} }),
    sendMessage: (m) => p.messages.push(m),
    performAnimation: (a) => p.anims.push(a.getId()),
    performGraphic: (g) => p.graphics.push(g.getId()),
    getHitpoints: () => p.hp, setHitpoints(v) { p.hp = v; },
    getRunEnergy: () => p.run ?? 100, setRunEnergy(v) { p.run = v; },
    getPoisonDamage: () => p.poison ?? 0, setPoisonDamage(v) { p.poison = v; },
    setEnteredAmountAction(action) { p.amountAction = action; },
    pages: [], said: [],
    forceChat: (text) => p.said.push(text), setRunning() {}, getMovementQueue: () => ({ setBlockMovement() {} }),
    setNpcTransformationId(npcId) { p.transform = npcId; },
    getDialogueManager: () => (p.dialogue ??= dialogueManager(p)),
    getSkillManager: () => ({
      getCombatLevel: () => combat, getTotalLevel: () => total,
      getCurrentLevel: (skill) => levels[skill.getName?.() ?? skill] ?? 99, getMaxLevel: () => 99,
      setCurrentLevel(skill, level) { levels[skill.getName?.() ?? skill] = level; return this; },
      addExperience(skill, xp) { p.xp = [...(p.xp ?? []), [skill.getName?.() ?? String(skill), xp]]; return this; },
    }),
    getPacketSender() {
      const sender = {
        sendVarbit: (vid, value) => { p.varbits.set(vid, value); return sender; },
        sendConfig: (vid, value) => { p.varps.set(vid, value); return sender; },
        sendString: (text, cid) => { p.texts.set(cid, text); return sender; },
        sendInterface: (iid) => { (p.interfaces ??= []).push(iid); return sender; },
        sendSubInterface: (uid, iid) => { p.subs.push(iid); return sender; },
        closeSubInterface: () => sender,
        sendInterfaceScript: (sid, args) => { p.scripts.push([sid, args]); return sender; },
        sendSong: () => sender, sendEnterAmountPrompt: (title) => { p.prompts = [...(p.prompts ?? []), title]; return sender; },
        sendInterfaceFlagsRange: (uid, from, to, flags) => { (p.flags ??= []).push([uid, from, to, flags]); return sender; },
        sendSound: (id) => { (p.sounds ??= []).push(id); return sender; },
        sendCameraMoveTo: () => sender, sendCameraLookAt: () => sender, sendCameraReset: () => sender,
        clearHintArrow: () => { p.hint = null; return sender; },
        sendPositionalHint: (tile) => { p.hint = { tile }; return sender; },
        sendEntityHint: (npc) => { p.hint = { npc }; return sender; },
        sendMultiIcon: () => sender, sendInterfaceRemoval: () => sender,
      };
      return sender;
    },
  };
  return p;
}

/** Records the pages shown; action pages run as the real manager runs them. */
function dialogueManager(p) {
  return {
    entries: null, index: -1,
    startDialogues(builder) { this.entries = builder.getDialogues(); this.startDialogue(0); },
    startDialogue(i) {
      this.index = i;
      const page = this.entries?.get(i);
      if (!page) { this.entries = null; return; }
      if (page.constructor.name === 'ActionDialogue') page.send(p);
      else if (page.constructor.name !== 'OptionDialogue') p.pages.push(page);
    },
    reset() { this.entries = null; this.index = -1; },
    current() { return this.entries?.get(this.index); },
    /** Clicks through to the end (or to a menu, which `choose` answers). */
    continueAll() { for (let n = 0; n < 200 && this.entries && this.current()?.constructor.name !== 'OptionDialogue'; n++) this.startDialogue(this.index + 1); },
    choose(option) { const menu = this.current(); this.reset(); menu.execute(option); },
  };
}

const pageText = (page) => page.text ?? page.getText?.();
const saidPages = (p) => p.pages.map(pageText);

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

const varbit = (p, name) => p.varbits.get(Common.varbitId(name));
const text = (p, name) => p.texts.get(Common.component(name));

/** A game under way with `count` players. */
function startGame(count = 4) {
  const players = Array.from({ length: count }, (_, i) => fakePlayer({ combat: 120 - i * 10 }));
  const game = new Match.Game(players);
  game.start();
  return { game, players };
}

test('Bounty Hunter weapons work in the same live Soul Wars match, never in its lobby', () => {
  const { game, players: [attacker, target] } = startGame(2);
  attacker.getPrivateArea = target.getPrivateArea = () => game.area;
  const permission = hooks.events['bounty-hunter:weapon-area'];
  assert.equal(typeof permission, 'function');
  const event = { attacker, target, allowed: false };
  permission(event);
  assert.equal(event.allowed, true);
  target.getPrivateArea = () => null;
  const outside = { attacker, target, allowed: false };
  permission(outside);
  assert.equal(outside.allowed, false);
  game.over = true;
  const finished = { attacker, target: attacker, allowed: false };
  permission(finished);
  assert.equal(finished.allowed, false);
});

/** Puts `player` on template tile [x, y] in the game's arena. */
function place(game, player, x, y) {
  player.location = game.area.at([x, y, 0]);
}

// ------------------------------------------------------------------ lobby

test('lobby: "N/20" below the minimum; the countdown runs 290 ticks once met, "shortly" 20 before', () => {
  const players = [fakePlayer(), fakePlayer()];
  online.push(...players);
  ticks(1);
  assert.equal(text(players[0], 'soul_wars_lobby:players_text'), '2/20');
  assert.equal(text(players[0], 'soul_wars_lobby:time_text'), '-');
  config['SoulWars:minPlayers'] = 2;
  ticks(1);
  assert.equal(text(players[0], 'soul_wars_lobby:players_text'), '2');
  assert.equal(text(players[0], 'soul_wars_lobby:time_text'), '3 minutes');
  ticks(269);
  assert.ok(players[0].messages.includes('The next Soul Wars game will start shortly.'));
  assert.equal(Match.current, null);
  ticks(20);
  assert.ok(Match.current, 'the game starts at 290');
  assert.ok(players.every((p) => Match.gameOf(p)));
});

test('the waiting-area barrier: refusals, in, and out after asking', () => {
  const p = fakePlayer({ at: new Location(2200, 2842, 0) });
  const barrier = { getId: () => core.CacheDefinitions.getLocId('soul_wars_main_waiting_area_barrier') };
  p.worn[1] = new core.Item(1007, 1);
  hooks.objects.get('Barrier:Pass')({ player: p, object: barrier });
  assert.equal(p.messages.at(-1), "You can't enter a waiting area while wearing something on your back.");
  p.worn[1] = null;
  p.inventory.add(new core.Item(379, 1));
  hooks.objects.get('Barrier:Pass')({ player: p, object: barrier });
  assert.equal(p.messages.at(-1), 'Food, potions, capes, followers and non-combat items are all restricted.');
  p.inventory.delete(379, 1);
  hooks.objects.get('Barrier:Pass')({ player: p, object: barrier });
  assert.deepEqual([p.location.getX(), p.location.getY()], [2198, 2842]);
  hooks.objects.get('Barrier:Pass')({ player: p, object: barrier });
  assert.equal(hooks.prompts.at(-1).title, 'Are you sure you want to leave?');
  hooks.prompts.at(-1).args[1]();
  assert.deepEqual([p.location.getX(), p.location.getY()], [2199, 2842]);
  const weak = fakePlayer({ combat: 30, at: new Location(2200, 2842, 0) });
  hooks.objects.get('Barrier:Pass')({ player: weak, object: barrier });
  assert.equal(weak.messages.at(-1), 'You need a total level of 500 and a combat level of 40 to play Soul Wars.');
});

// ------------------------------------------------------------------ the start

test('the start: balanced teams in their bases, the varbits, capes, HUD and lines', () => {
  const { game, players } = startGame(4);
  assert.equal(game.members.blue.size, 2);
  assert.equal(game.members.red.size, 2);
  for (const p of players) {
    const team = game.teamOf(p);
    assert.equal(varbit(p, 'soul_wars_team'), team === 'blue' ? 1 : 2);
    assert.equal(varbit(p, 'soul_wars_obelisk_alignment'), 60);
    assert.equal(p.worn[1].getId(), Common.data.items.capes[team]);
    const [x, y] = game.area.templateOf(p.location);
    const [bx, by] = Common.data.bases[team];
    assert.ok(Math.abs(x - bx) <= 1 && Math.abs(y - by) <= 1, 'in its base');
    assert.ok(p.messages.includes('The game of Soul Wars has begun!'));
    assert.deepEqual(p.scripts.find(([id]) => id === 370), [370, [1501]]);
  }
  ticks(1);
  assert.equal(text(players[0], 'soul_wars_game:blue_kills'), '0/5');
  assert.equal(text(players[0], 'soul_wars_game:red_strength'), '100%');
});

// ------------------------------------------------------------------ avatars

function hitOn(npc, attacker, damage) {
  const parts = [{ d: damage, getDamage() { return this.d; }, setDamage(v) { this.d = v; } }];
  return { getAttacker: () => attacker, getHits: () => parts, updateTotalDamage() {}, getTotalDamage: () => parts[0].d, parts };
}

test('avatar strength blocks its share of each hit; at 100% nothing lands, with the line', () => {
  const { game, players } = startGame(2);
  const red = players.find((p) => game.teamOf(p) === 'red');
  const blueAvatar = game.avatars.blue.npc;
  const hit = hitOn(blueAvatar, red, 40);
  hooks.hit({ npc: blueAvatar, hit });
  assert.equal(hit.parts[0].d, 0);
  assert.equal(red.messages.at(-1), 'Your attacks seem to have no effect on the avatar.');
  Avatars.adjust(game, 'blue', -48);
  const second = hitOn(blueAvatar, red, 40);
  hooks.hit({ npc: blueAvatar, hit: second });
  assert.equal(second.parts[0].d, 19, '52% blocked, rounded down');
  assert.equal(game.statsOf(red).damage, 19);
});

test('a defeated avatar: the line, a kill, and its return 35 ticks later at full strength', () => {
  const { game, players } = startGame(2);
  const npc = game.avatars.blue.npc;
  Avatars.adjust(game, 'blue', -60);
  for (const fn of hooks.npcDeath) fn({ npc, killer: players[0], location: { x: 0, y: 0, z: 0 } });
  assert.ok(players[0].messages.includes('<col=ff3232>The red team has defeated the Avatar of Creation!</col>'));
  assert.equal(game.kills.red, 1);
  assert.equal(game.avatars.blue.alive, false);
  ticks(34);
  assert.equal(game.avatars.blue.alive, false);
  ticks(1);
  assert.equal(game.avatars.blue.alive, true);
  assert.equal(game.avatars.blue.strength, 100);
  assert.ok(players[0].messages.includes('<col=3366ff>The Avatar of Creation has returned!</col>'));
});

// ------------------------------------------------------------------ the obelisk

test('the obelisk: 2% a fragment when held, 0.5% when not (with the hint), and the refusals', () => {
  const { game, players } = startGame(2);
  const red = players.find((p) => game.teamOf(p) === 'red');
  const sacrifice = () => hooks.objects.get('Soul Obelisk:Sacrifice-fragments')({ player: red, object: null });
  sacrifice();
  assert.equal(red.messages.at(-1), "You don't have any soul fragments to sacrifice.");
  red.inventory.add(new core.Item(25201, 2));
  sacrifice();
  assert.equal(game.avatars.blue.strength, 99);
  assert.deepEqual(red.messages.slice(-2), ['You charge the Soul Obelisk with soul fragments and weaken the enemy avatar.', 'Your soul fragments will have a greater effect if your team controls the Soul Obelisk.']);
  game.control.obelisk.holder = 'red';
  red.inventory.add(new core.Item(25201, 4));
  sacrifice();
  assert.equal(game.avatars.blue.strength, 91);
  assert.equal(game.statsOf(red).fragments, 6);
  Avatars.adjust(game, 'blue', -100);
  red.inventory.add(new core.Item(25201, 1));
  sacrifice();
  assert.equal(red.messages.at(-1), "You don't need to do that as the enemy avatar has already been fully weakened.");
});

test("the arena's creatures: souls drop 2 fragments, wolves bones, in place of their tables", () => {
  const { game } = startGame(2);
  const souls = [...Souls.CREATURE_OF].filter(([, c]) => c.game === game);
  const counts = { weak: 0, strong: 0, wolf: 0 };
  for (const [, c] of souls) counts[c.kind]++;
  assert.deepEqual(counts, { weak: 8, strong: 4, wolf: 4 });
  const [soul] = souls.find(([, c]) => c.kind === 'weak');
  const roll = { npc: soul, drops: [{ itemId: 25196, amount: 2 }] };
  hooks.events['npc-drops:roll'](roll);
  assert.deepEqual(roll.drops, [{ itemId: 25201, amount: 2 }]);
  const [wolf] = souls.find(([, c]) => c.kind === 'wolf');
  const wolfRoll = { npc: wolf, drops: [] };
  hooks.events['npc-drops:roll'](wolfRoll);
  assert.deepEqual(wolfRoll.drops, [{ itemId: 25199, amount: 1 }]);
});

test("the bridges onto the obelisk's island can be walked (the copy keeps the plane above)", () => {
  const { game } = startGame(2);
  for (const [x, y] of [[2185, 2913], [2228, 2911]]) {
    const tile = game.area.at([x, y, 0]);
    assert.equal(RegionManager.getClipping(tile.getX(), tile.getY(), 0, game.area) & 0x200000, 0, `${x},${y}`);
  }
});

// ------------------------------------------------------------------ control

test('control: a majority moves the alignment, captures at the end with the line, drifts back', () => {
  const { game, players } = startGame(4);
  const reds = players.filter((p) => game.teamOf(p) === 'red');
  for (const p of reds) place(game, p, 2206, 2908);
  ticks(1);
  assert.equal(game.control.obelisk.alignment, 64, '2 a player of majority');
  assert.equal(varbit(players[0], 'soul_wars_obelisk_contested'), 2);
  ticks(14);
  assert.equal(game.control.obelisk.holder, 'red');
  assert.ok(players[0].messages.includes('<col=ff3232>The red team has taken control of the Soul Obelisk!</col>'));
  assert.equal(varbit(players[0], 'soul_wars_obelisk_holder'), 2);
  assert.equal(game.statsOf(reds[0]).areas, 1);
  const blues = players.filter((p) => game.teamOf(p) === 'blue');
  for (const p of reds) place(game, p, 2141, 2908);
  place(game, blues[0], 2206, 2908);
  ticks(3);
  assert.equal(game.control.obelisk.alignment, 114);
  place(game, blues[0], 2141, 2908);
  ticks(3);
  assert.equal(game.control.obelisk.alignment, 120, 'drifts back to its holder');
});

// ------------------------------------------------------------------ deaths

test("a death: no items lost, bones dropped, back in the team's graveyard as a ghost", () => {
  const { game, players } = startGame(2);
  const [a, b] = players;
  const team = game.teamOf(a);
  const event = { player: a, killer: b, handled: false };
  for (const fn of hooks.death) fn(event);
  assert.equal(event.handled, true);
  const keep = { player: a, shouldDrop: true };
  for (const fn of hooks.drops) fn(keep);
  assert.equal(keep.shouldDrop, false);
  const [x, y] = game.area.templateOf(a.location);
  assert.deepEqual([x, y], Common.data.bases[team].slice(0, 2), 'no graveyard held: the base');
  assert.equal(varbit(a, 'soul_wars_recent_death'), 1);
  assert.equal(a.transform, core.CacheDefinitions.getNpcId('soul_wars_player_ghost'), 'a ghost looks like one');
  assert.equal(game.statsOf(b).kills, 1);
  assert.equal(game.isGhost(a), true);
  ticks(17);
  assert.equal(game.isGhost(a), false);
  assert.equal(varbit(a, 'soul_wars_recent_death'), 0);
  assert.equal(a.transform, -1);

  game.control.east.holder = team;
  for (const fn of hooks.death) fn({ player: a, killer: null, handled: false });
  const [gx, gy] = game.area.templateOf(a.location);
  assert.ok(Common.data.graveyards.east.respawn.some(([rx, ry]) => rx === gx && ry === gy), 'the held graveyard');
});

test('a sanctuary lets the living out only; the ghost waits', () => {
  const { game, players } = startGame(2);
  const [a] = players;
  game.control.east.holder = game.teamOf(a);
  for (const fn of hooks.death) fn({ player: a, killer: null, handled: false });
  const barrier = { getLocation: () => game.area.at([2253, 2923, 0]), getId: () => 40458 };
  hooks.objects.get('Neutral Barrier:Pass')({ player: a, object: barrier });
  assert.match(a.messages.at(-1), /^You must wait for another \d+ seconds? before you rejoin the battle\.$/);
  ticks(17);
  place(game, a, 2253, 2924);
  hooks.objects.get('Neutral Barrier:Pass')({ player: a, object: barrier });
  assert.deepEqual(game.area.templateOf(a.location).slice(0, 2), [2253, 2922]);
  assert.equal(game.isImmune(a), true);
  hooks.objects.get('Neutral Barrier:Pass')({ player: a, object: barrier });
  assert.equal(a.messages.at(-1), 'You can only exit this sanctuary, not enter it.');
});

test("teammates can't fight; enemies can", () => {
  const { game, players } = startGame(4);
  const [a, b] = [...game.members.blue];
  const [c] = [...game.members.red];
  assert.equal(game.canAttack(a, b), false);
  assert.equal(a.messages.at(-1), "You can't attack your teammates!");
  assert.equal(game.canAttack(a, c), true);
  assert.equal(game.canAttack(a, game.avatars.blue.npc), false, 'nor their own avatar');
  assert.equal(game.canAttack(a, game.avatars.red.npc), true);
  assert.ok(players.length === 4);
});

// ------------------------------------------------------------------ supplies, bones, activity

test('tables give 1, 5, 10 or X; a potion boosts by 5 + 15%; a bandage heals 1 + 15%', () => {
  const { game, players } = startGame(2);
  const [a] = players;
  const table = { getId: () => 40463 };
  hooks.objects.get('Bandage table:Take-5')({ player: a, object: table });
  assert.equal(a.inventory.getAmount(25202), 5);
  const potions = { getId: () => 40469 };
  hooks.objects.get('Potion of power table:Take-1')({ player: a, object: potions });
  assert.equal(a.inventory.getAmount(25203), 1);
  hooks.items.get('Potion of power(4):Drink')({ player: a, itemId: 25203 });
  assert.equal(a.messages.at(-1), 'You use a potion to boost yourself.');
  assert.equal(a.inventory.getAmount(25204), 1, 'three doses left');
  assert.equal(a.getSkillManager().getCurrentLevel(core.Skill.ATTACK), 99 + 5 + 14);
  hooks.items.get('Bandages:Heal')({ player: a, itemId: 25202 });
  assert.equal(a.messages.at(-1), 'You do not currently need bandaging.');
  a.hp = 50;
  hooks.items.get('Bandages:Heal')({ player: a, itemId: 25202 });
  assert.equal(a.hp, 50 + 1 + 14);
  assert.equal(a.inventory.getAmount(25202), 4);
  assert.ok(game);
});

test("bones buried in the base restore the team's avatar 1%; ordinary bones are left alone", () => {
  const { game, players } = startGame(2);
  const [a] = players;
  const team = game.teamOf(a);
  Avatars.adjust(game, team, -10);
  a.inventory.add(new core.Item(25199, 1));
  hooks.items.get('Bones:Bury')({ player: a, itemId: 25199 });
  assert.equal(game.avatars[team].strength, 91);
  assert.equal(game.statsOf(a).bones, 1);
  assert.equal(hooks.items.get('Bones:Bury')({ player: a, itemId: 526 }), false, 'normal bones fall through');
});

test('the activity bar falls 3 a tick from 18 ticks in; an empty one removes the player', () => {
  const { game, players } = startGame(2);
  const [a] = players;
  ticks(17);
  assert.equal(game.activity.get(a), 800);
  ticks(1);
  assert.equal(game.activity.get(a), 797);
  game.active(a);
  assert.equal(game.activity.get(a), 800);
  game.activity.set(a, 3);
  ticks(1);
  assert.equal(Match.gameOf(a), null);
  assert.equal(a.messages.at(-1), 'You have been removed from the game for inactivity.');
  assert.equal(Supplies.banned(a), true);
});

// ------------------------------------------------------------------ the end

test('five kills end it two ticks on: the winners, Zeal, the stats and the end screen', () => {
  const { game, players } = startGame(2);
  for (let i = 0; i < 5; i++) game.scored('red');
  ticks(2);
  assert.equal(game.over, true);
  for (const p of players) {
    assert.ok(p.messages.includes('<col=ff3232>The red team was victorious!</col>'));
    assert.equal(varbit(p, 'soul_wars_team'), 0);
    assert.equal(p.worn[1], null, 'the cape is gone');
    assert.ok(p.messages.some((m) => /^You earned \d+ Zeal\.$/.test(m)));
    assert.equal(text(p, 'soul_wars_game_end:red_score_text'), '5');
    assert.deepEqual([p.location.getX(), p.location.getY()], Common.data.lobby.afterGame.slice(0, 2));
  }
  const winner = players.find((p) => Common.getVarp(p, 'total_wins') === 1);
  assert.ok(winner, 'the red player counts a win');
});

test('on time, equal kills is a draw', () => {
  const { game, players } = startGame(2);
  game.scored('blue');
  game.scored('red');
  const drain = Common.data.activity.drain;
  Common.data.activity.drain = 0;
  ticks(1500);
  Common.data.activity.drain = drain;
  assert.equal(game.over, true);
  assert.ok(players[0].messages.includes('The game has ended in a draw!'));
  assert.ok(players[0].messages.includes('Time remaining: 12:30'));
});

test('a side with nobody left concedes', () => {
  const { game, players } = startGame(2);
  const red = players.find((p) => game.teamOf(p) === 'red');
  const blue = players.find((p) => game.teamOf(p) === 'blue');
  game.remove(red);
  ticks(1);
  assert.equal(game.over, true);
  assert.ok(blue.messages.includes('<col=3366ff>The blue team was victorious!</col>'));
});

// ------------------------------------------------------------------ review fixes

test('logging out mid-game saves the player in the lobby, not on the instance', () => {
  const { game, players } = startGame(4);
  const [a] = players;
  game.area.leave(a, true);
  assert.deepEqual([a.location.getX(), a.location.getY()], Common.data.lobby.afterGame.slice(0, 2));
  assert.equal(Match.gameOf(a), null);
  assert.equal(a.worn[1], null, 'the team cape went with the game');
});

test('a death that began in the game ends there, even if the game ends meanwhile', () => {
  const { game, players } = startGame(2);
  const [a] = players;
  hooks.beforeDeath({ player: a });
  game.finish('red');
  const keep = { player: a, shouldDrop: true };
  for (const fn of hooks.drops) fn(keep);
  assert.equal(keep.shouldDrop, false, 'nothing is lost');
  const event = { player: a, killer: null, handled: false };
  for (const fn of hooks.death) fn(event);
  assert.equal(event.handled, true, 'not to Lumbridge');
  assert.deepEqual([a.location.getX(), a.location.getY()], Common.data.lobby.afterGame.slice(0, 2));
});

test('a cape put on while waiting keeps that player out of the game, and the cape on them', () => {
  config['SoulWars:minPlayers'] = 2;
  const players = [fakePlayer(), fakePlayer(), fakePlayer()];
  online.push(...players);
  ticks(2);
  players[2].worn[1] = new core.Item(6570, 1);
  ticks(290);
  assert.ok(Match.current);
  assert.equal(Match.gameOf(players[2]), null);
  assert.equal(players[2].worn[1].getId(), 6570);
  assert.equal(players[2].messages.at(-1), "You can't enter a waiting area while wearing something on your back.");
});

test('a finished game lets go of its avatars and creatures', () => {
  const { game } = startGame(2);
  assert.ok([...Avatars.AVATAR_OF.values()].some((f) => f.game === game));
  game.finish(null);
  assert.equal([...Avatars.AVATAR_OF.values()].some((f) => f.game === game), false);
  assert.equal([...Souls.CREATURE_OF.values()].some((f) => f.game === game), false);
});

test('the minimum is never under 2, and one category alone does not make full Zeal', () => {
  config['SoulWars:minPlayers'] = 1;
  assert.equal(Lobby.minPlayers(), 2);
  const { game, players } = startGame(2);
  const [a] = players;
  game.elapsed = 2000;
  game.statsOf(a).bones = 15;
  assert.ok(game.zealFor(a, 'win') < 60);
  Object.assign(game.statsOf(a), { fragments: 30, areas: 6, damage: 260 });
  assert.equal(game.zealFor(a, 'win'), 60);
});

test('a ghost cannot charge the obelisk; an unheld, uncontested place drifts back to neutral', () => {
  const { game, players } = startGame(2);
  const [a] = players;
  for (const fn of hooks.death) fn({ player: a, killer: null, handled: false });
  a.inventory.add(new core.Item(25201, 2));
  hooks.objects.get('Soul Obelisk:Sacrifice-fragments')({ player: a, object: null });
  assert.equal(a.inventory.getAmount(25201), 2);
  game.control.obelisk.alignment = 70;
  ticks(5);
  assert.equal(game.control.obelisk.alignment, 60);
});

// ------------------------------------------------------------------ bots

function fakeBot(options) {
  const bot = fakePlayer(options);
  bot.isPlayerBot = () => true;
  bot.setPlayerBot = () => {};
  bot.setAttribute(Bots.BOT_ATTRIBUTE, true);
  return bot;
}

test('bots: with seeding on, a waiting player is joined by bots up to the minimum (lobby ones first)', () => {
  config = { 'SoulWars:seedBots': true, 'SoulWars:minPlayers': 4 };
  const made = [];
  const create = Bots.engine.create;
  const gear = Bots.engine.gear;
  Bots.engine.create = (username, at) => { const bot = fakeBot({ at }); bot.isRegistered = () => false; bot.name = username; made.push(bot); return bot; };
  Bots.engine.gear = () => true;
  try {
    const idle = fakeBot({ at: new Location(2206, 2858, 0) });
    online.push(fakePlayer(), idle);
    ticks(1);
    assert.ok(Common.inBox(idle.location, Common.data.lobby.waiting), 'the idle lobby bot joins');
    assert.equal(made.length, 2);
    ticks(3);
    assert.equal(made.length, 2, 'bots on their way count as waiting');
    for (const bot of made) bot.isRegistered = () => true;
    ticks(2);
    assert.equal(made.length, 2, 'registered but not yet seen in the lobby');
    online.push(...made);
    ticks(1);
    assert.equal(made.length, 2);
    assert.equal(Lobby.waitingPlayers().length, 4);
  } finally {
    Bots.engine.create = create;
    Bots.engine.gear = gear;
  }
});

test('bots: nothing is seeded with it off, or with only bots waiting', () => {
  let made = 0;
  const create = Bots.engine.create;
  Bots.engine.create = () => { made++; return null; };
  try {
    config = { 'SoulWars:minPlayers': 4 };
    online.push(fakePlayer());
    ticks(2);
    config = { 'SoulWars:seedBots': true, 'SoulWars:minPlayers': 4 };
    online.length = 0;
    online.push(fakeBot());
    ticks(2);
    assert.equal(made, 0);
  } finally {
    Bots.engine.create = create;
  }
});

test("bots skip the entry rules at the start (they're made to fill the game)", () => {
  config = { 'SoulWars:minPlayers': 2 };
  const bot = fakeBot({ combat: 3, total: 32 });
  online.push(fakePlayer(), bot);
  ticks(Common.data.countdownTicks + 2);
  assert.ok(Match.gameOf(bot));
});

test("a bot leaves its base through its own barrier, and a ghost's sanctuary when it can", () => {
  const players = [fakePlayer(), fakeBot()];
  const game = new Match.Game(players);
  game.start();
  const bot = players[1];
  const team = game.teamOf(bot);
  walks.length = 0;
  const route = () => game.area.templateOf(walks.at(-1).to);
  {
    const exit = Bots.BASE_EXITS[team];
    Bots.act(game, bot);
    assert.equal(Bots.states.get(bot).route.goal, exit.inside.join(','), 'it walks to the barrier');
    assert.ok(route());
    place(game, bot, ...exit.inside);
    Bots.act(game, bot);
    assert.equal(exit.within(game.area.templateOf(bot.location)), false, 'and through it');
    const yard = Common.data.graveyards.east;
    place(game, bot, ...yard.respawn[2]);
    Bots.act(game, bot);
    assert.equal(yard.respawn.some(([x, y]) => game.area.templateOf(bot.location)[0] === x && game.area.templateOf(bot.location)[1] === y), false);
  }
});

test('a fragments bot pockets its kills and charges the obelisk with six', () => {
  const players = [fakePlayer(), fakeBot()];
  const game = new Match.Game(players);
  game.start();
  const bot = players[1];
  Bots.states.set(bot, { role: 'fragments', nextWalk: 0 });
  const [soul] = [...Souls.CREATURE_OF].find(([, c]) => c.game === game && c.kind === 'weak');
  for (let i = 0; i < 3; i++) {
    const roll = { player: bot, npc: soul, drops: [] };
    hooks.events['npc-drops:roll'](roll);
    assert.deepEqual(roll.drops, []);
  }
  assert.equal(bot.inventory.getAmount(Common.data.items.fragment), 6);
  const [x, y] = Common.data.obelisk.tile;
  place(game, bot, x, y - 2);
  const enemy = Common.other(game.teamOf(bot));
  Bots.act(game, bot);
  assert.equal(bot.inventory.getAmount(Common.data.items.fragment), 0);
  assert.ok(game.avatars[enemy].strength < 100);
  const roll = { player: players[0], npc: soul, drops: [] };
  hooks.events['npc-drops:roll'](roll);
  assert.deepEqual(roll.drops, [{ itemId: 25201, amount: 2 }], "a player's still fall to the floor");
});

test('a capture bot heads for the first place its team does not hold; bots are never idle', () => {
  const players = [fakePlayer(), fakeBot()];
  const game = new Match.Game(players);
  game.start();
  const bot = players[1];
  Bots.states.set(bot, { role: 'capture', nextWalk: 0 });
  walks.length = 0;
  const route = () => game.area.templateOf(walks.at(-1).to);
  {
    place(game, bot, 2206, 2895);
    Bots.act(game, bot);
    const [x0, y0, x1, y1] = Common.data.control.obelisk.zone;
    const state = Bots.states.get(bot);
    const [px, py] = state.post.tile;
    assert.equal(state.post.place, 'obelisk');
    assert.ok(px >= x0 && px <= x1 && py >= y0 && py <= y1, 'its post is in the zone');
    // South of the island is water: the way on is round by a bridge.
    const legs = state.route.waypoints.map(({ x, y }) => game.area.templateOf(new Location(x, y, 0)));
    assert.ok(legs.some(([x, y]) => (y === 2913 && x >= 2180 && x <= 2191) || (y === 2911 && x >= 2222 && x <= 2233)), JSON.stringify(legs));
    assert.ok(route());
    game.elapsed = 400;
    game.activity.set(bot, 10);
    Bots.act(game, bot);
    assert.equal(game.activity.get(bot), Common.data.activity.max);
  }
});

test("a new bot is geared, but brings no food or potions; in a game it starts with bandages", () => {
  const create = Bots.engine.create;
  const gear = Bots.engine.gear;
  let made = null;
  Bots.engine.create = (username, at) => { made = fakeBot({ at }); return made; };
  Bots.engine.gear = (bot) => { for (const id of [1333, 385, 2436]) bot.inventory.add(new core.Item(id, 1)); };
  try {
    Bots.spawnBot(new Location(2192, 2842, 0));
    assert.equal(made.inventory.getAmount(1333), 1, 'its weapon');
    assert.equal(made.inventory.getAmount(385), 0, 'no shark');
    assert.equal(made.inventory.getAmount(2436), 0, 'no super attack');
    const game = new Match.Game([fakePlayer(), made]);
    game.start();
    assert.equal(made.inventory.getAmount(Common.data.items.bandages), Bots.START_BANDAGES);
    assert.equal(game.players()[0].inventory.getAmount(Common.data.items.bandages), 0, "a player's own come from the table");
  } finally {
    Bots.engine.create = create;
    Bots.engine.gear = gear;
  }
});

// ------------------------------------------------------------------ rewards

const zealTokens = (p) => Common.getVarp(p, 'zeal_tokens');
const button = (name) => hooks.buttons.get(Common.component(`soul_wars_rewards:${name}`));

test("the Nomad's Trade opens interface 442 in place of the generic shop, with the recorded set-up", () => {
  const p = fakePlayer();
  const event = { player: p, shopId: Rewards.SHOP_ID, allow: null };
  hooks.canShop(event);
  assert.equal(event.allow, false);
  assert.ok(p.subs.includes(core.CacheDefinitions.getInterfaceId('soul_wars_rewards')));
  const open = p.scripts.find(([id]) => id === 535);
  assert.equal(open[1].length, 14);
  assert.equal(open[1][1], Common.component('soul_wars_rewards:xp_rewards'));
  assert.deepEqual(p.flags.find(([uid]) => uid === Common.component('soul_wars_rewards:other_rewards')).slice(1), [0, 64, 2 | 32]);
  const other = { player: p, shopId: 1, allow: null };
  hooks.canShop(other);
  assert.equal(other.allow, null, 'other shops are left alone');
});

test('experience: floor(L*L/600) * 30 a token at 99, from level 30; tokens and level checked again, quietly', () => {
  const p = fakePlayer();
  Common.addVarp(p, 'zeal_tokens', 15);
  // Strength (row 1), 10 tokens: child 1*4+1.
  button('confirm_xp')({ player: p, slot: 5 });
  assert.equal(zealTokens(p), 5);
  assert.deepEqual(p.xp, [['Strength', Math.floor((99 * 99) / 600) * 30 * 10]]);
  const said = p.messages.length;
  button('confirm_xp')({ player: p, slot: 6 });
  assert.equal(zealTokens(p), 5, '100 tokens refused');
  assert.equal(p.messages.length, said, 'the client has already said why');
  p.getSkillManager = () => ({ getMaxLevel: () => 29, getCurrentLevel: () => 29, addExperience() { throw new Error('no'); } });
  button('confirm_xp')({ player: p, slot: 24 });
  assert.equal(zealTokens(p), 5, 'under level 30 refused');
});

test('experience X: the amount comes from the prompt, and Prayer pays 14 a token', () => {
  const p = fakePlayer();
  Common.addVarp(p, 'zeal_tokens', 40);
  // Prayer row 6, X: list child 6*6+5, confirm 6*4+3.
  button('xp_rewards')({ player: p, slot: 41 });
  assert.match(p.prompts.at(-1), /\(1-40\)/);
  p.amountAction.execute(25);
  button('confirm_xp')({ player: p, slot: 27 });
  assert.equal(zealTokens(p), 15);
  assert.deepEqual(p.xp, [['Prayer', Math.floor((99 * 99) / 600) * 14 * 25]]);
});

test('an imbue swaps the item in place, as recorded for the Slayer helmet', () => {
  const p = fakePlayer();
  Common.addVarp(p, 'zeal_tokens', 816);
  p.inventory.add(new core.Item(11864, 1));
  p.inventory.add(new core.Item(995, 100));
  button('confirm_imbue')({ player: p, slot: 15 });
  assert.equal(zealTokens(p), 316);
  assert.equal(p.inventory.getItems()[0].getId(), 25177);
  assert.equal(p.messages.at(-1), '<col=3366ff>You sense a newfound power emanating from your Slayer helmet...</col>');
  assert.ok(p.sounds.includes(2655));
  button('confirm_imbue')({ player: p, slot: 15 });
  assert.equal(zealTokens(p), 316, 'nothing left to imbue');
});

test('other rewards: Buy X of Spoils of War, as recorded (10 for 300, one to a slot)', () => {
  const p = fakePlayer();
  Common.addVarp(p, 'zeal_tokens', 316);
  // Spoils (index 2): Buy X is child 2*5+4.
  button('other_rewards')({ player: p, slot: 14, opId: 1 });
  assert.equal(p.prompts.at(-1), 'How many would you like to buy? (1-10)');
  p.amountAction.execute(10);
  assert.equal(p.varps.get(3426), 10);
  button('confirm_other')({ player: p, slot: 2 });
  assert.equal(zealTokens(p), 16);
  assert.equal(p.inventory.getAmount(25342), 10);
  assert.equal(p.inventory.getFreeSlots(), 18);
  assert.equal(p.messages.at(-1), 'You purchase some Spoils of war for 300 Tokens.');
  assert.ok(p.sounds.includes(2304));
});

test('other rewards: Buy 1 of a blighted sack gives its batch; the Soul cape wants Prayer 70', () => {
  const p = fakePlayer();
  Common.addVarp(p, 'zeal_tokens', 3000);
  button('other_rewards')({ player: p, slot: 3 * 5 + 3, opId: 1 });
  button('confirm_other')({ player: p, slot: 3 });
  assert.equal(p.inventory.getAmount(24613), 70);
  assert.equal(zealTokens(p), 2990);
  p.getSkillManager = () => ({ getMaxLevel: () => 60, getCurrentLevel: () => 60 });
  button('other_rewards')({ player: p, slot: 1, opId: 1 });
  button('confirm_other')({ player: p, slot: 0 });
  assert.equal(zealTokens(p), 2990, 'Prayer 60 refused');
  assert.equal(p.inventory.getAmount(25346), 0);
  p.getSkillManager = () => ({ getMaxLevel: () => 70, getCurrentLevel: () => 70 });
  button('other_rewards')({ player: p, slot: 1, opId: 1 });
  button('confirm_other')({ player: p, slot: 0 });
  assert.equal(p.inventory.getAmount(25346), 1);
  assert.deepEqual(obtains.map((event) => [event.player, event.itemId, event.amount]).filter(([, id]) => id === 25346), [[p, 25346, 1]]);
});

// ------------------------------------------------------------------ tutorial

const T = () => Common.data.tutorial;
const step = (p) => varbit(p, 'soul_wars_tutorial');
const LOBBY_NOMAD_TILE = new Location(2213, 2857, 0);
const lobbyNomad = () => ({ getId: () => 10528, getLocation: () => LOBBY_NOMAD_TILE });

/** The tutorial's Nomad the player sees at their step. */
function tutorialNomad(p) {
  const area = Tutorial.states.get(p).area;
  return [...area.npcs].find((npc) => npc.getId() >= 10548 && npc.getId() <= 10553
    && (core.CacheDefinitions.getNpc(npc.getId()).transforms[step(p)] ?? -1) === 10516);
}

function talkTo(p, npc) {
  p.pages.length = 0;
  assert.ok(hooks.npcs.get('Nomad:Talk-to')({ player: p, npc }), 'the Nomad takes the talk');
}

/** A player taken into the demonstration and through its 22-tick opening. */
function newRecruit() {
  const p = fakePlayer({ demonstrated: false });
  talkTo(p, lobbyNomad());
  p.getDialogueManager().continueAll();
  p.getDialogueManager().choose(1);
  p.getDialogueManager().continueAll();
  ticks(6 + 23);
  return p;
}

function talkThrough(p) {
  talkTo(p, tutorialNomad(p));
  p.getDialogueManager().continueAll();
}

test("tutorial: the Nomad's introduction offers the demonstration (met on the offer); restricted items are refused", () => {
  const p = fakePlayer({ demonstrated: false });
  p.inventory.add(new core.Item(379, 1)); // a lobster
  talkTo(p, lobbyNomad());
  p.getDialogueManager().continueAll();
  assert.equal(saidPages(p)[0], 'Excuse me, what is this place?');
  assert.equal(saidPages(p).at(-1), "I can give you a demonstration if you're interested?");
  assert.equal(varbit(p, 'soul_wars_met_nomad'), 1);
  assert.deepEqual(p.getDialogueManager().current().getOptions(), ["Let's do it.", "Actually, I'm good."]);
  p.getDialogueManager().choose(1);
  p.getDialogueManager().continueAll();
  assert.match(saidPages(p).at(-1), /^Hmm, it looks like you have some restricted items with you/);
  assert.equal(Tutorial.inTutorial(p), false);
  // Met already: the shorter greeting, and "I'll pass." turns it down.
  talkTo(p, lobbyNomad());
  p.getDialogueManager().continueAll();
  assert.equal(saidPages(p)[0], 'Ah, you again. Are you ready for that demonstration?');
  assert.deepEqual(p.getDialogueManager().current().getOptions(), ["Let's do it.", "I'll pass."]);
});

test("tutorial: \"Let's do it.\" teleports the player in (started), blue cape on, and the arrow points at the first Nomad", () => {
  const p = newRecruit();
  assert.equal(varbit(p, 'soul_wars_started_tutorial'), 1);
  assert.ok(Tutorial.inTutorial(p));
  const area = Tutorial.states.get(p).area;
  assert.deepEqual(area.templateOf(p.getLocation()), T().land);
  assert.equal(p.worn[1].getId(), T().items.cape);
  assert.equal(step(p), 0);
  assert.deepEqual(p.said, ['Huh?', 'Yikes!', 'Oh boy.']);
  assert.equal(p.hint.npc, tutorialNomad(p));
  assert.equal(text(p, 'soul_wars_tutorial_instructions:title'), 'Soul Wars demonstration');
  assert.deepEqual(area.templateOf(p.walkedTo), T().walkTo);
});

test('tutorial: Zimberfizz appears on "Zimberfizz! Heel!" (step 3), is yours alone, and leaves his fragment (step 5)', () => {
  const p = newRecruit();
  const other = newRecruit();
  talkThrough(p);
  ticks(5);
  assert.equal(step(p), 1);
  talkThrough(p);
  ticks(5);
  assert.equal(step(p), 2);
  assert.equal(text(p, 'soul_wars_tutorial_instructions:title'), 'Souls');
  talkTo(p, tutorialNomad(p));
  const dm = p.getDialogueManager();
  while (pageText(dm.current()) !== 'Zimberfizz! Heel!') dm.startDialogue(dm.index + 1);
  assert.equal(step(p), 3, 'step 3 as the line shows');
  const imp = Tutorial.states.get(p).imp;
  assert.equal(imp.getId(), 10517);
  dm.continueAll();
  assert.equal(step(p), 4);
  assert.equal(p.hint.npc, imp);
  assert.equal(Tutorial.attackRule(other, imp), false);
  assert.ok(other.messages.includes("You've got no reason to bother that poor imp."));
  assert.equal(Tutorial.attackRule(p, imp), true);
  Tutorial.impDied({ npc: imp });
  ticks(2);
  assert.equal(step(p), 5);
  assert.equal(p.dropped[0][0], T().items.fragment);
});

test('tutorial: the whole demonstration, to finished_tutorial, the portal home and the guide', () => {
  const p = newRecruit();
  talkThrough(p); ticks(5);
  talkThrough(p); ticks(5);
  talkThrough(p);
  Tutorial.impDied({ npc: Tutorial.states.get(p).imp }); ticks(2);
  p.inventory.add(new core.Item(T().items.fragment, 1));
  talkThrough(p); ticks(5);
  assert.equal(step(p), 6);
  talkThrough(p);
  assert.equal(step(p), 7);
  assert.equal(Tutorial.states.get(p).imp.getId(), 10518);
  Tutorial.impDied({ npc: Tutorial.states.get(p).imp }); ticks(2);
  talkThrough(p);
  assert.equal(step(p), 11);
  assert.equal(varbit(p, 'soul_wars_obelisk_holder'), 1);
  assert.equal(varbit(p, 'soul_wars_obelisk_alignment'), 0);
  assert.ok(Tutorial.charge({ player: p, object: { getId: () => 40765 } }));
  assert.equal(step(p), 12);
  assert.equal(p.inventory.getAmount(T().items.fragment), 0);
  assert.equal(text(p, 'soul_wars_game:red_strength'), '98%');
  p.getDialogueManager().continueAll();
  talkThrough(p); ticks(30);
  assert.equal(step(p), 13);
  talkThrough(p);
  assert.equal(p.blasted, T().projectile);
  ticks(15);
  assert.equal(step(p), 14);
  assert.equal(p.transform, T().ghost);
  assert.deepEqual(Tutorial.states.get(p).area.templateOf(p.getLocation()), T().graveyard);
  talkThrough(p);
  assert.equal(p.transform, -1);
  assert.equal(step(p), 16);
  assert.equal(varbit(p, 'soul_wars_finished_tutorial'), 1);
  assert.equal(Tutorial.finished(p), true);
  p.pages.length = 0;
  assert.ok(hooks.objects.get('Portal:Leave')({ player: p, object: { getId: () => 40440 } }));
  ticks(8);
  assert.equal(Tutorial.inTutorial(p), false);
  assert.equal(p.worn[1], null);
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], T().lobbyExit.slice(0, 2));
  assert.equal(saidPages(p)[0], 'Here we are. Just head into the western waiting area if you want to join a battle.');
  p.getDialogueManager().continueAll();
  p.getDialogueManager().choose(1);
  p.getDialogueManager().continueAll();
  assert.equal(p.inventory.getAmount(T().items.guide), 1);
  // Done: the Nomad's usual talk (and his Trade) from now on.
  assert.equal(hooks.npcs.get('Nomad:Talk-to')({ player: p, npc: lobbyNomad() }), false);
  assert.equal(hooks.variant({ player: p, npc: lobbyNomad() }), 'standard-dialogue-post-demonstration-dialogue');
  assert.equal(hooks.condition({ player: p, npc: lobbyNomad(), text: 'If the player is on a Soul Wars world:' }), true);
  assert.equal(hooks.condition({ player: p, npc: lobbyNomad(), text: 'If the player is not on a Soul Wars world:' }), false);
});

test('tutorial: leaving early starts it over; only a player who saw it may wait for a game', () => {
  const p = newRecruit();
  talkThrough(p); ticks(5);
  assert.equal(step(p), 1);
  assert.ok(hooks.npcs.get('Nomad:Leave-tutorial')({ player: p, npc: tutorialNomad(p) }));
  ticks(4);
  assert.equal(Tutorial.inTutorial(p), false);
  assert.equal(step(p), 0);
  assert.equal(Tutorial.finished(p), false);
  p.location = new Location(2200, 2842, 0);
  hooks.objects.get('Barrier:Pass')({ player: p, object: { getId: () => core.CacheDefinitions.getLocId('soul_wars_main_waiting_area_barrier') } });
  assert.ok(p.messages.includes(Common.message('needTutorial')));
});

test('an imbue keeps what the item carries: a charged ring of suffering keeps its charges', () => {
  const p = fakePlayer();
  const imbued = core.CacheDefinitions.getEnumValues(Common.data.rewards.enums.imbueItem);
  const slot = [...imbued.keys()].find((index) => core.CacheDefinitions.getEnumValues(Common.data.rewards.enums.imbueBase).get(imbued.get(index)) === 20655);
  assert.ok(slot != null, 'the cache imbues a ring of suffering (r)');
  p.inventory.slots.push({ id: 20655, amount: 1, meta: { 'ring-of-suffering': 100000, preset: true } });
  Common.addVarp(p, 'zeal_tokens', 1000);
  Rewards.imbue({ player: p, slot });
  assert.equal(p.inventory.slots[0].id, imbued.get(slot));
  assert.deepEqual(p.inventory.slots[0].meta, { 'ring-of-suffering': 100000, preset: true });
});

test('tutorial: a cape put on during the entry fade stops the entry, and the cape stays', () => {
  const p = fakePlayer({ demonstrated: false });
  talkTo(p, lobbyNomad());
  p.getDialogueManager().continueAll();
  p.getDialogueManager().choose(1);
  p.getDialogueManager().continueAll();
  ticks(1);
  p.worn[1] = new core.Item(6570, 1); // a fire cape, equipped mid-fade
  ticks(6);
  assert.equal(Tutorial.inTutorial(p), false);
  assert.equal(p.worn[1]?.getId(), 6570, 'the cape is still worn');
  assert.ok(p.messages.includes(Common.message('restricted')));
});

// ------------------------------------------------------------------ the scoreboard

const boardText = (p) => p.texts.get(Common.component('soul_wars_stats:scroll_text'));
const viewBoard = (p, objectId = core.CacheDefinitions.getLocId('soul_wars_scoreboard')) =>
  hooks.objects.get('Scoreboard:View')({ player: p, objectId, option: 'view', clickType: 1, handled: false });

test('the scoreboard: a real game counts its kills, Avatar kills and itself for the world; the reader sees their own', () => {
  Scoreboard._useFile(require('node:path').join(scoreboardDir, `${Math.random()}.json`));
  const { game, players } = startGame(2);
  const red = players.find((p) => game.teamOf(p) === 'red');
  const blue = players.find((p) => game.teamOf(p) === 'blue');
  for (const fn of hooks.death) fn({ player: blue, killer: red, handled: false });
  for (const fn of hooks.death) fn({ player: red, killer: null, handled: false }); // no killer: a death, no kill
  ticks(17);
  for (let i = 0; i < 5; i++) {
    const npc = game.avatars.blue.npc;
    for (const fn of hooks.npcDeath) fn({ npc, killer: red, location: { x: 0, y: 0, z: 0 } });
    ticks(35);
  }
  ticks(2);
  assert.equal(game.over, true);
  assert.equal(viewBoard(red), true);
  assert.equal(boardText(red), [
    'Your Soul Wars statistics', 'Games played: 1', 'Games won: 1', 'Players killed: 1', 'Deaths: 1', '',
    'Global statistics', 'Games played: 1', 'Players killed: 1', 'Avatars killed: 5',
  ].join('<br>'));
  viewBoard(blue);
  assert.match(boardText(blue), /^Your Soul Wars statistics<br>Games played: 1<br>Games won: 0<br>Players killed: 0<br>Deaths: 1<br>/);
});

test('the scoreboard: a game with an empty side is no game for the world, and other Scoreboards are left alone', () => {
  Scoreboard._useFile(require('node:path').join(scoreboardDir, `${Math.random()}.json`));
  const lone = fakePlayer();
  const game = new Match.Game([lone]);
  game.start();
  game.finish(null);
  viewBoard(lone);
  assert.match(boardText(lone), /Global statistics<br>Games played: 0<br>/);
  const other = fakePlayer();
  assert.equal(viewBoard(other, core.CacheDefinitions.getLocId('castlewars_scoreboard')), false);
  assert.equal(boardText(other), undefined);
});

test('the scoreboard: a game with bots alone on one side is no game for the world', () => {
  Scoreboard._useFile(require('node:path').join(scoreboardDir, `${Math.random()}.json`));
  const human = fakePlayer();
  const bot = fakePlayer();
  bot.isPlayerBot = () => true;
  const game = new Match.Game([human, bot]);
  game.start();
  const victim = game.teamOf(human) === game.teamOf(bot) ? null : bot;
  if (victim) for (const fn of hooks.death) fn({ player: bot, killer: human, handled: false });
  game.finish(game.teamOf(human));
  viewBoard(human);
  assert.match(boardText(human), /Global statistics<br>Games played: 0<br>Players killed: 0<br>Avatars killed: 0$/);
  assert.match(boardText(human), /^Your Soul Wars statistics<br>Games played: 1<br>/, 'the player still counts their own game');
});

// Actual decoded item-on-player route, using real players in a real Soul Wars match.
test('a bandage used on a teammate reaches the registered Soul Wars handler', async (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const World = core.World;
  const savedCycle = World.processCycle, savedBotEnv = process.env.DISABLE_PLAYER_BOTS, actors = [], tasks = new Set();
  process.env.DISABLE_PLAYER_BOTS = "1";
  const addBefore = new Set(World.getAddNPCQueue()), removeBefore = new Set(World.getRemoveNPCQueue());
  const submit = TaskManager.submit;
  TaskManager.submit = function(task) { tasks.add(task); return submit.call(this, task); };
  let game, otherGame;
  t.after(() => {
    try {
      if (otherGame && !otherGame.over) otherGame.finish(null);
      if (game && !game.over) game.finish(null);
    } finally {
    for (const task of tasks) task.stop();
    TaskManager.submit = submit;
    for (const { p, channel } of actors) {
      TaskManager.cancelTasks(p); TaskManager.cancelTasks(p.getIndex());
      World.getPlayers().remove(p); channel.close();
    }
    for (const [queue, before] of [[World.getAddNPCQueue(), addBefore], [World.getRemoveNPCQueue(), removeBefore]]) {
      for (let i = queue.length - 1; i >= 0; i--) if (!before.has(queue[i])) {
        World.getNpcs().remove(queue[i]); queue.splice(i, 1);
      }
    }
    World.processCycle = savedCycle;
    if (savedBotEnv === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = savedBotEnv;
    assert.equal([...tasks].some(task => task.isRunning()), false, 'owned tasks stopped');
    assert.equal(actors.some(({p}) => p.isRegistered()), false, 'native actors removed');
    }
  });
  config['SoulWars:seedBots'] = false;
  assert.equal(process.env.DISABLE_PLAYER_BOTS, '1');
  for (let i = 0; i < 4; i++) {
    const channel = { kind:'test', remoteAddress:'127.0.0.1', isOpen:()=>true, send:()=>true,
      close(){}, onData(){}, onError(){}, onClose(){} };
    const session = new PlayerSession(channel), p = new Player(session);
    session.setPlayer(p); p.setUsername(`swbandage${i}`); p.setNeedsPlacement(false);
    p.setAttribute('bot-skip-persistence', true);
    // Exclude login/logout persistence; all combat, inventory, placement and packet routes remain native.
    t.mock.method(p, 'onAdd', () => {}); t.mock.method(p, 'onRemove', () => {});
    const messages = []; t.mock.method(p, 'sendMessage', message => messages.push(message));
    const connection = new ClientConnection(channel); connection.player = p;
    actors.push({p, channel, connection, messages});
    assert.equal(World.getPlayers().add(p), true, 'native player registered');
  }
  assert.equal(Common.data.items.bandages, 25202, 'Soul Wars source binds the pinned item');
  assert.equal(core.CacheDefinitions.getItem(Common.data.items.bandages).name, 'Bandages', 'active cache resolves the named item');
  game = new Match.Game(actors.map(actor => actor.p));
  game.start();
  const healer = actors[0], patient = actors.find(a => a !== healer && game.teamOf(a.p) === game.teamOf(healer.p));
  assert.ok(patient, 'real match assigns a same-team patient');
  assert.equal(Match.gameOf(healer.p), game); assert.equal(Match.gameOf(patient.p), game);
  assert.equal(game.over, false);
  for (const a of [healer, patient]) {
    assert.equal(a.p.isRegistered(), true); assert.equal(World.getPlayers().get(a.p.getIndex()), a.p);
    assert.equal(game.isGhost(a.p), false);
  }
  assert.equal(healer.p.getPrivateArea(), game.area); assert.equal(patient.p.getPrivateArea(), game.area);
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  let reached = false;
  for (let x = 2180; x < 2220 && !reached; x++) for (let y = 2880; y < 2935 && !reached; y++) {
    const from = game.area.at([x, y, 0]), to = game.area.at([x + 1, y, 0]);
    if (!game.area.contains(from) || !game.area.contains(to)
        || core.RegionManager.blocked(from, game.area) || core.RegionManager.blocked(to, game.area)) continue;
    healer.p.moveTo(from); patient.p.moveTo(to);
    reached = PathFinder.reachedEntity(healer.p, patient.p);
  }
  assert.equal(reached, true, 'native collision and reach confirm adjacent usable arena tiles');
  healer.p.setNeedsPlacement(false); patient.p.setNeedsPlacement(false);
  healer.p.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 80).setCurrentLevel(core.Skill.HITPOINTS, 40, true);
  patient.p.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 99).setCurrentLevel(core.Skill.HITPOINTS, 50, true);
  healer.p.getInventory().setItem(0, new core.Item(Common.data.items.bandages, 1));
  await healer.connection.dispatch([{type:'widget_action', widgetId:149 << 16, groupId:149, childId:0, buttonNum:2, itemId:Common.data.items.bandages, slot:0}]);
  healer.connection.processTurnPackets();
  assert.equal(healer.p.getHitpoints(), 53, 'ordinary self-use control heals');
  assert.equal(healer.p.getInventory().getAmount(Common.data.items.bandages), 0, 'self-use consumes one');
  healer.p.getInventory().setItem(0, new core.Item(Common.data.items.bandages, 1));
  healer.p.getInventory().setItem(2, new core.Item(Common.data.items.bandages, 1));
  patient.p.setRunEnergy(10); patient.p.setPoisonDamage(6); patient.p.setVenomed(true);
  healer.p.setRunEnergy(33); const patientMessagesBefore = patient.messages.length;
  await healer.connection.dispatch([{type:'item_on_player', widgetId:149 << 16, targetIndex:patient.p.getIndex(), itemId:Common.data.items.bandages, slot:2}]);
  for (let i=0; i<4; i++) {
    World.processCycle++; TaskManager.process(); healer.connection.processTurnPackets();
    healer.p.getMovementQueue().process(); TaskManager.processWalkTo(healer.p.getIndex());
  }
  const seen = nativeItemUses.findLast(e => e.player === healer.p && e.target === patient.p);
  assert.ok(seen, 'actual item-on-player route resolves the real target');
  assert.equal(seen.slot, 2); assert.equal(seen.itemId, Common.data.items.bandages);
  assert.equal(patient.p.getHitpoints(), 65, 'selected teammate receives the Soul Wars heal');
  assert.equal(patient.p.getRunEnergy(), 100); assert.equal(patient.p.getPoisonDamage(), 0);
  assert.equal(patient.p.isVenomed(), false);
  assert.equal(healer.p.getInventory().getAmount(Common.data.items.bandages), 1, 'healer spends one bandage');
  assert.equal(healer.p.getInventory().getItems()[0].getId(), Common.data.items.bandages, 'unselected bandage remains');
  assert.ok(!healer.p.getInventory().getItems()[2] || healer.p.getInventory().getItems()[2].getId() < 0, 'selected slot is consumed');
  assert.equal(healer.p.getHitpoints(), 53, 'healer is not healed again');
  assert.equal(healer.p.getRunEnergy(), 33, 'healer energy is unchanged');
  assert.equal(patient.messages.length, patientMessagesBefore + 1);
  assert.equal(patient.messages.at(-1), `${healer.p.getDisplayName()} uses a bandage on you.`, 'patient sees actual healer name');
  async function use(target, slot, id = Common.data.items.bandages) {
    await healer.connection.dispatch([{type:'item_on_player', widgetId:149 << 16, targetIndex:target.getIndex(), itemId:id, slot}]);
    for (let i=0; i<4; i++) {
      World.processCycle++; TaskManager.process(); healer.connection.processTurnPackets();
      healer.p.getMovementQueue().process(); TaskManager.processWalkTo(healer.p.getIndex());
    }
  }
  const enemy = actors.find(a => game.teamOf(a.p) !== game.teamOf(healer.p));
  assert.ok(enemy && Match.gameOf(enemy.p) === game, 'enemy belongs to this real match');
  enemy.p.moveTo(patient.p.getLocation().clone()); enemy.p.setNeedsPlacement(false);
  enemy.p.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 99).setCurrentLevel(core.Skill.HITPOINTS, 50, true);
  enemy.p.setRunEnergy(21);
  game.activity.set(healer.p, 17);
  const healerHpBeforeRefusals = healer.p.getHitpoints(), healerRunBeforeRefusals = healer.p.getRunEnergy();
  const beforeEnemy = nativeItemUses.length, enemyMessages = enemy.messages.length, healerBeforeEnemy = healer.messages.length;
  await use(enemy.p, 0);
  assert.equal(nativeItemUses.length, beforeEnemy + 1, 'enemy request reaches actual item-on-player dispatcher');
  assert.equal(enemy.p.getHitpoints(), 50, 'opposing team receives no healing');
  assert.equal(enemy.messages.length, enemyMessages, 'rejected use emits no healing feedback');
  assert.equal(healer.messages.length, healerBeforeEnemy + 1);
  assert.equal(healer.messages.at(-1), "You can't bandage an opposing player.");
  assert.equal(healer.p.getInventory().getAmount(Common.data.items.bandages), 1, 'enemy use spends nothing');
  assert.equal(enemy.p.getRunEnergy(), 21); assert.equal(game.activity.get(healer.p), 17, 'enemy refusal is not activity');
  assert.equal(healer.p.getHitpoints(), healerHpBeforeRefusals); assert.equal(healer.p.getRunEnergy(), healerRunBeforeRefusals);
  patient.p.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 99, true);
  patient.p.setRunEnergy(100); patient.p.setPoisonDamage(0); patient.p.setVenomed(false);
  const beforeNoNeed = nativeItemUses.length, beforeNoNeedMessages = patient.messages.length, healerBeforeNoNeed = healer.messages.length;
  await use(patient.p, 0);
  assert.equal(nativeItemUses.length, beforeNoNeed + 1, 'full teammate request reaches the registered path');
  assert.equal(patient.messages.length, beforeNoNeedMessages, 'no-need refusal sends no healing feedback');
  assert.equal(healer.messages.length, healerBeforeNoNeed + 1);
  assert.equal(healer.messages.at(-1), `${patient.p.getDisplayName()} does not currently need bandaging.`);
  assert.equal(healer.p.getInventory().getAmount(Common.data.items.bandages), 1, 'full healthy teammate does not consume a bandage under TSPS policy');
  assert.equal(game.activity.get(healer.p), 17, 'no-need refusal is not activity');
  assert.equal(patient.p.getHitpoints(), 99); assert.equal(patient.p.getRunEnergy(), 100);
  assert.equal(healer.p.getHitpoints(), healerHpBeforeRefusals); assert.equal(healer.p.getRunEnergy(), healerRunBeforeRefusals);
  patient.p.setPoisonDamage(6); patient.p.setVenomed(true);
  await use(patient.p, 0);
  assert.equal(patient.p.getHitpoints(), 99); assert.equal(patient.p.getPoisonDamage(), 0);
  assert.equal(patient.p.isVenomed(), false, 'poison-only use clears venom');
  assert.equal(healer.p.getInventory().getAmount(Common.data.items.bandages), 0, 'poison-only use consumes one');
  healer.p.getInventory().setItem(0, new core.Item(Common.data.items.bandages, 1));
  patient.p.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 50, true);
  const beforeInvalid = nativeItemUses.length, healerBeforeInvalid = healer.messages.length;
  await use(patient.p, 27);
  assert.equal(nativeItemUses.length, beforeInvalid, 'empty selected slot is rejected by the native listener');
  assert.equal(healer.messages.length, healerBeforeInvalid, 'invalid slot emits no refusal');
  assert.equal(patient.p.getHitpoints(), 50); assert.equal(healer.p.getInventory().getAmount(Common.data.items.bandages), 1);
  // A delayed native walk must not consume a replacement from the originally selected slot.
  const adjacent = healer.p.getLocation().clone(), patientTile = patient.p.getLocation().clone();
  let distant = null;
  for (let dx = -5; dx <= 5 && !distant; dx++) for (let dy = -5; dy <= 5 && !distant; dy++) {
    const tile = new core.Location(patientTile.getX() + dx, patientTile.getY() + dy, patientTile.getZ());
    if (game.area.contains(tile) && tile.getDistance(patientTile) >= 3 && !core.RegionManager.blocked(tile, game.area)) distant = tile;
  }
  assert.ok(distant, 'a standable distant arena tile exists');
  healer.p.moveTo(distant); healer.p.setNeedsPlacement(false);
  const original = healer.p.getInventory().getItems()[0], beforeStale = nativeItemUses.length, healerBeforeStale = healer.messages.length;
  const { TaskType } = require('../dist/game/task/TaskType'); const beforeWalkTasks = new Set(tasks);
  await healer.connection.dispatch([{type:'item_on_player', widgetId:149 << 16, targetIndex:patient.p.getIndex(), itemId:Common.data.items.bandages, slot:0}]);
  World.processCycle++; TaskManager.process(); healer.connection.processTurnPackets();
  assert.equal(nativeItemUses.length, beforeStale, 'distant interaction awaits actual movement');
  assert.ok([...tasks].some(task => !beforeWalkTasks.has(task) && task.type === TaskType.WALK_TO
    && task.key === healer.p.getIndex() && task.isRunning()), 'native route queued a live walk task');
  const replacement = new core.Item(Common.data.items.bandages, 1);
  healer.p.getInventory().setItem(0, replacement);
  // Script the arrival; the pending native walk task still invokes its original deferred callback.
  healer.p.moveTo(adjacent); healer.p.setNeedsPlacement(false);
  for (let i=0; i<4; i++) {
    World.processCycle++; TaskManager.process(); healer.p.getMovementQueue().process(); TaskManager.processWalkTo(healer.p.getIndex());
  }
  const stale = nativeItemUses.at(-1);
  assert.equal(nativeItemUses.length, beforeStale + 1, 'the original deferred interaction reaches the real handler');
  assert.equal(stale.item, original, 'dispatcher carries its originally selected item');
  assert.equal(healer.p.getInventory().getItems()[0], replacement, 'replacement survives the stale callback');
  assert.equal(patient.p.getHitpoints(), 50, 'stale callback does not heal');
  assert.equal(healer.messages.length, healerBeforeStale, 'stale callback emits no refusal');
  // Supplementary handler guard: both real actors retain area membership while their coordinates are outside it.
  healer.p.moveTo(new core.Location(3200, 3200, 0)); patient.p.moveTo(new core.Location(3201, 3200, 0));
  assert.equal(healer.p.getPrivateArea(), game.area); assert.equal(patient.p.getPrivateArea(), game.area);
  assert.equal(game.area.contains(healer.p.getLocation()), false);
  const out = {player:healer.p, target:patient.p, targetIndex:patient.p.getIndex(), interfaceId:149 << 16,
    item:replacement, itemId:Common.data.items.bandages, slot:0, handled:false};
  PluginManager.emitItemOnPlayer(out);
  assert.equal(out.handled, true, 'actual registered event path sees the stale arena context');
  assert.equal(patient.p.getHitpoints(), 50); assert.equal(healer.p.getInventory().getItems()[0], replacement);
  healer.p.moveTo(adjacent); healer.p.setNeedsPlacement(false);
  // Real decoded interaction outside the arena is refused by the movement route too.
  patient.p.moveTo(new core.Location(3200, 3200, 0)); patient.p.setNeedsPlacement(false);
  const beforeOutsideRoute = nativeItemUses.length;
  await use(patient.p, 0);
  assert.equal(nativeItemUses.length, beforeOutsideRoute, 'outside decoded click is refused by core routing');
  assert.equal(patient.p.getHitpoints(), 50); assert.equal(healer.p.getInventory().getItems()[0], replacement);
  patient.p.moveTo(patientTile); patient.p.setNeedsPlacement(false);
  patient.p.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 105, true);
  patient.p.setRunEnergy(5);
  await use(patient.p, 0);
  assert.equal(patient.p.getHitpoints(), 105, 'defensive monotonicity preserves boosted HP');
  assert.equal(patient.p.getRunEnergy(), 100, 'energy is restored even when boosted HP exceeds max');
  assert.equal(healer.p.getInventory().getAmount(Common.data.items.bandages), 0);
  game.finish(null);
  assert.equal(game.over, true); assert.equal(Match.gameOf(healer.p), null, 'real finish clears match membership');
  healer.p.getInventory().setItem(0, new core.Item(Common.data.items.bandages, 1));
  const outsideHealth = patient.p.getHitpoints();
  healer.p.moveTo(new core.Location(2190, 2842, 0)); patient.p.moveTo(new core.Location(2191, 2842, 0));
  healer.p.setNeedsPlacement(false); patient.p.setNeedsPlacement(false);
  await use(patient.p, 0);
  assert.equal(patient.p.getHitpoints(), outsideHealth, 'ended match does not heal');
  assert.equal(healer.p.getInventory().getAmount(Common.data.items.bandages), 1, 'ended match does not spend');
  otherGame = new Match.Game([healer.p, enemy.p]); otherGame.start();
  assert.equal(Match.gameOf(healer.p), otherGame, 'healer enters a different real match');
  assert.equal(Match.gameOf(patient.p), null, 'prior teammate is not a member of that match');
  healer.p.getInventory().setItem(0, new core.Item(Common.data.items.bandages, 1));
  const beforePriorMatch = nativeItemUses.length;
  await use(patient.p, 0);
  assert.equal(nativeItemUses.length, beforePriorMatch, 'core route rejects target in prior match context');
  assert.equal(patient.p.getHitpoints(), outsideHealth, 'a player from the previous match is not healed');
  assert.equal(healer.p.getInventory().getAmount(Common.data.items.bandages), 1, 'cross-match use spends nothing');
});
