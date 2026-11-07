// Run after `npx tsc --build`: node --test tests/pvp-arena-unranked.test.cjs
//
// PvP Arena unranked duels (plugins/minigames/duelarena/), as the rsprox captures of world 578
// show them: Challenge both ways, the duel screen's two steps, cancelling, the fight on the arena
// copy, a death, a forfeit and the way out, the stash of the player's own character, load-out
// copying and sharing, and the normal world's choice between an unranked and a Legacy Duel. Real
// Players and cache; the network is stubbed and the packets recorded.
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

const DuelArena = require('../plugins/minigames/DuelArena.plugin');
const UnrankedDuel = require('../plugins/minigames/duelarena/UnrankedDuel.DuelArena');
const Battle = require('../plugins/minigames/duelarena/Battle.DuelArena');
const Loadouts = require('../plugins/minigames/duelarena/Loadouts.DuelArena');
const Stash = require('../plugins/minigames/duelarena/Stash.DuelArena');
const ToxicStaff = require('../plugins/items/ToxicStaffOfTheDead.plugin');

const config = { pvpArenaWorld: true };
const hooks = {
  buttons: new Map(), custom: {}, objects: new Map(), beforeDeath: [], deaths: [], drops: [],
  process: [], logins: [], prompts: [], options: [], shutdowns: [],
};
let core;
let cache;
let index = 1;

before(() => {
  CachePipeline.initialize();
  const noop = () => {};
  const api = new Proxy({
    core: PluginManager.getCoreApi(),
    getPluginConfig: (key, fallback) => key === 'DuelArena:pvpArenaWorld' ? config.pvpArenaWorld : fallback,
    onInterfaceActionButton: (ids, handler) => { for (const id of [].concat(ids)) hooks.buttons.set(id, handler); },
    onObjectFirstClick: (ids, handler) => { for (const id of ids) hooks.objects.set(id, handler); },
    onCustomEvent: (name, handler) => { (hooks.custom[name] ??= []).push(handler); },
    emitCustomEvent: (name, payload) => { for (const handler of hooks.custom[name] ?? []) handler(payload); },
    onPlayerBeforeDeath: (handler) => hooks.beforeDeath.push(handler),
    onPlayerDeath: (handler) => hooks.deaths.push(handler),
    onShouldDropItemsOnDeath: (handler) => hooks.drops.push(handler),
    onPlayerProcess: (handler) => hooks.process.push(handler),
    onPlayerOption: (handler) => hooks.options.push(handler),
    onServerShutdown: (handler) => hooks.shutdowns.push(handler),
    sendMultiChatboxPrompt: (player, title, ...pairs) => hooks.prompts.push({ player, title, pairs }),
  }, { get: (target, key) => target[key] ?? noop });
  DuelArena.register(api);
  ToxicStaff.register(api);
  core = api.core;
  cache = core.CacheDefinitions;
  // The arena copy's tasks, without the game loop: run them by hand.
  core.TaskManager.submit = (task) => { task.running = true; tasks.push(task); };
});

const tasks = [];
function tick(times = 1) {
  for (let i = 0; i < times; i++) {
    for (const task of [...tasks]) if (task.isRunning()) task.execute();
    for (let j = tasks.length - 1; j >= 0; j--) if (!tasks[j].isRunning()) tasks.splice(j, 1);
  }
}

beforeEach(() => {
  config.pvpArenaWorld = true;
  hooks.prompts.length = 0;
});

/** A real Player in the Emir's Arena with only the network stubbed; what it is sent is recorded. */
function realPlayer(t, name, x = 3366, y = 3270) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setIndex(index++);
  p.setRegistered(true);
  p.setUsername?.(name);
  t.mock.method(p, 'getDisplayName', () => name);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  p.setLocation(new core.Location(x, y, 0));
  const sender = p.getPacketSender();
  p.sent = { varbits: new Map(), messages: [], typed: [], requests: [], interfaces: [], options: new Map(), scripts: [], removed: 0 };
  const wrap = (method, record) => {
    const original = sender[method];
    t.mock.method(sender, method, function (...args) { record(...args); return original.apply(this, args); });
  };
  wrap('sendVarbit', (id, value) => p.sent.varbits.set(id, value));
  wrap('sendTypedMessage', (type, text) => p.sent.typed.push([type, text]));
  wrap('sendRequestMessage', (type, text, from) => p.sent.requests.push([type, text, from]));
  wrap('sendInterface', (id) => p.sent.interfaces.push(id));
  wrap('sendPlayerOption', (slot, text) => p.sent.options.set(slot, text));
  wrap('sendInterfaceScript', (id, args, _varps, _varbits, inventories) => p.sent.scripts.push({ id, args, inventories }));
  wrap('sendInterfaceRemoval', () => { p.sent.removed++; });
  t.mock.method(p, 'sendMessage', (text) => p.sent.messages.push(text));
  return p;
}

const varbit = (p, name) => p.sent.varbits.get(cache.getVarbitId(name));
const click = (player, name, slot = -1, opId = 1) => hooks.buttons.get(cache.getComponentId(name))({
  player, buttonId: cache.getComponentId(name), slot, action: opId, opId,
});
const emit = (name, payload) => { for (const handler of hooks.custom[name] ?? []) handler(payload); return payload; };
const process = (player) => { for (const handler of hooks.process) handler({ player }); };

function closeScreen(player) {
  const id = player.getInterfaceId();
  player.setInterfaceId(-1);
  emit('interface:closed', { player, interfaceId: id });
}

/** a and b at the duel screen's second step, on `build`. */
function toLoadouts(t, build = 1) {
  const a = realPlayer(t, 'Alpha');
  const b = realPlayer(t, 'Bravo', 3367, 3270);
  UnrankedDuel.challenge(a, b);
  UnrankedDuel.challenge(b, a);
  if (build !== Loadouts.preferredBuild(a)) click(a, 'pvp_arena_unrankedduel:buildtypes', build);
  click(a, 'pvp_arena_unrankedduel:build_confirm');
  click(b, 'pvp_arena_unrankedduel:build_confirm');
  return [a, b];
}

function toFight(t, build = 1) {
  const [a, b] = toLoadouts(t, build);
  click(a, 'pvp_arena_unrankedduel:opponent_confirm');
  click(b, 'pvp_arena_unrankedduel:opponent_confirm');
  return [a, b];
}

test('a challenge and its answer open the duel screen for both', (t) => {
  const a = realPlayer(t, 'Alpha');
  const b = realPlayer(t, 'Bravo', 3367, 3270);
  UnrankedDuel.challenge(a, b);
  assert.deepEqual(a.sent.typed.at(-1), [102, 'Challenging Bravo...']);
  assert.deepEqual(b.sent.requests.at(-1), [103, 'Alpha is inviting you to an unranked duel.', 'Alpha']);
  assert.equal(a.sent.interfaces.length, 0);

  UnrankedDuel.challenge(b, a);
  const screen = cache.getInterfaceId('pvp_arena_unrankedduel');
  for (const p of [a, b]) {
    assert.deepEqual(p.sent.interfaces, [screen]);
    assert.match(p.sent.messages.at(-1), /unofficial duel/);
    assert.equal(varbit(p, 'pvpa_unrankedduel_transmit_progress'), 1);
    assert.equal(varbit(p, 'pvpa_transmit_caneditbuild'), 1);
    assert.equal(varbit(p, 'pvpa_transmit_battletype'), 1005);
  }
  closeScreen(a);
});

test('the build is the pair\'s: a change clears both acceptances; both accepting moves to the load-outs', (t) => {
  const a = realPlayer(t, 'Alpha');
  const b = realPlayer(t, 'Bravo', 3367, 3270);
  UnrankedDuel.challenge(a, b);
  UnrankedDuel.challenge(b, a);
  click(a, 'pvp_arena_unrankedduel:build_confirm');
  assert.equal(varbit(a, 'pvpa_unrankedduel_transmit_iacceptbuild'), 1);
  click(b, 'pvp_arena_unrankedduel:buildtypes', 2);
  assert.equal(varbit(a, 'pvpa_transmit_build'), 2);
  assert.equal(varbit(b, 'pvpa_transmit_build'), 2);
  assert.equal(varbit(a, 'pvpa_unrankedduel_transmit_iacceptbuild'), 0, 'the change clears the accept');

  click(a, 'pvp_arena_unrankedduel:build_confirm');
  click(b, 'pvp_arena_unrankedduel:build_confirm');
  for (const p of [a, b]) {
    assert.equal(varbit(p, 'pvpa_unrankedduel_transmit_progress'), 2);
    assert.equal(varbit(p, 'pvpa_transmit_caneditbuild'), 0);
    const shown = p.sent.scripts.findLast((s) => s.inventories?.[207]);
    assert.equal(shown.id, 6200);
    assert.equal(shown.inventories[207].capacity, 42);
  }
  closeScreen(b);
});

test('closing the screen cancels the challenge for both', (t) => {
  const [a, b] = toLoadouts(t);
  closeScreen(b);
  assert.deepEqual(b.sent.typed.at(-1), [102, 'Cancelling challenge.']);
  assert.deepEqual(a.sent.typed.at(-1), [102, 'Bravo has cancelled the challenge.']);
  assert.ok(a.sent.removed > 0);
  assert.equal(UnrankedDuel._test.sessions.has(a), false);
});

test('copying the opponent\'s load-out asks first, and only Yes copies it', (t) => {
  const [a, b] = toLoadouts(t, 1);
  const editedB = { ...Loadouts.loadout(b, 1), inventory: Loadouts.loadout(b, 1).inventory.map((v, i) => (i === 0 ? 39 : v)) };
  b.setAttribute('pvp-arena:loadouts', { b: editedB });
  click(a, 'pvp_arena_unrankedduel:opponent_copy');
  a.getEnteredAmountAction().execute(0);
  assert.equal(a.sent.messages.at(-1), 'Your load-out has not been changed.');
  click(a, 'pvp_arena_unrankedduel:opponent_copy');
  a.getEnteredAmountAction().execute(1);
  assert.match(a.sent.messages.at(-1), /^You've copied the Zerker load-out of Bravo/);
  assert.equal(Loadouts.loadout(a, 1).inventory[0], 39);
  closeScreen(a);
});

test('a fight: the build, the countdown, a death, the win, and both back to their own characters', (t) => {
  const [a, b] = toLoadouts(t, 2);
  a.getInventory().add(new core.Item(995, 1234));
  const ownAttack = a.getSkillManager().getMaxLevel(core.Skill.ATTACK);
  click(a, 'pvp_arena_unrankedduel:opponent_confirm');
  click(b, 'pvp_arena_unrankedduel:opponent_confirm');

  const fight = Battle.fightFor(a);
  assert.ok(fight);
  assert.equal(fight, Battle.fightFor(b));
  assert.match(a.sent.messages.find((m) => /participation/.test(m)), /Unranked Duel participation: <col=ef1020>\d+<\/col>/);
  assert.equal(a.getSkillManager().getMaxLevel(core.Skill.DEFENCE), 1, '1 Def Pure');
  assert.equal(a.getInventory().getAmount(995), 0, 'their own things are put aside');
  assert.equal(varbit(a, 'pvpa_battlearea_status'), 1);
  assert.equal(a.sent.options.get(1), 'Fight');
  assert.equal(fight.canAttack(a, b), false);
  assert.ok(a.sent.messages.includes('The fight has not yet begun.'));

  tick(21);
  assert.ok(a.sent.messages.includes('<col=ef1020>Combat has begun!</col>'));
  assert.equal(fight.canAttack(a, b), true);
  assert.equal(varbit(a, 'pvpa_battlearea_timeremaining'), 2000);
  process(a);
  const fightClick = emit('player:option-route', { player: a, target: b, option: 1, handled: false });
  assert.equal(fightClick.handled, false, 'in the arena option 1 is Fight: the core attacks');

  for (const handler of hooks.beforeDeath) handler({ player: b, preventDeath: false });
  assert.ok(a.sent.messages.includes('<col=ef1020>Alpha has won!</col>'));
  assert.ok(b.sent.messages.includes('<col=ef1020>Alpha has won!</col>'));
  assert.match(a.sent.messages.find((m) => /wins:/.test(m)), /Unranked Duel wins: <col=ef1020>\d+<\/col> \/ \d+/);
  assert.ok(a.sent.messages.includes('The fight is over.'));
  const death = { player: b, killer: a, handled: false };
  for (const handler of hooks.deaths) handler(death);
  assert.equal(death.handled, true);
  assert.equal(varbit(b, 'pvpa_battlearea_status'), 2);

  const trapdoor = hooks.objects.get(cache.getLocId('pvpa_battlearea_trapdoor'));
  trapdoor({ player: b });
  assert.equal(b.sent.messages.at(-1), "I can't reach that!");
  trapdoor({ player: a });
  assert.equal(Battle.fightFor(a), null);
  assert.equal(a.getInventory().getAmount(995), 1234, 'their own things are back');
  assert.equal(a.getSkillManager().getMaxLevel(core.Skill.ATTACK), ownAttack);
  assert.equal(varbit(a, 'pvpa_battlearea_status'), 0);
  hooks.objects.get(cache.getLocId('pvpa_battlearea_spectatorportal'))({ player: b });
  assert.equal(Battle.fightFor(b), null);
  assert.equal(Stash.stashed(b), null);
});

test('quitting through the trapdoor hands the opponent the win', (t) => {
  const [a, b] = toFight(t);
  tick(21);
  hooks.objects.get(cache.getLocId('pvpa_battlearea_trapdoor'))({ player: a });
  const stay = hooks.prompts.at(-1);
  assert.deepEqual([stay.pairs[0], stay.pairs[2]], ['Stay for the fight', 'Exit the Duel']);
  stay.pairs[3]();
  const sure = hooks.prompts.at(-1);
  assert.equal(sure.title, 'Are you sure you wish to quit this Duel?');
  sure.pairs[1]();
  assert.equal(Battle.fightFor(a), null);
  assert.ok(b.sent.messages.includes('<col=ef1020>Bravo has won!</col>'));
  assert.ok(!b.sent.messages.includes('The fight is over.'), 'only a death ends with that line');
  hooks.objects.get(cache.getLocId('pvpa_battlearea_trapdoor'))({ player: b });
  assert.equal(Battle.fightFor(b), null);
});

test('a normal world asks which duel; Legacy goes to the Legacy Duel', (t) => {
  config.pvpArenaWorld = false;
  const a = realPlayer(t, 'Alpha');
  const b = realPlayer(t, 'Bravo', 3367, 3270);
  // The Legacy screens' layouts aren't loaded here; their opening isn't under test.
  for (const p of [a, b]) t.mock.method(p.getPacketSender(), 'sendConfiguredInterface', function () { return this; });
  UnrankedDuel.challenge(a, b);
  const choice = hooks.prompts.at(-1);
  assert.deepEqual([choice.pairs[0], choice.pairs[2]], ['Unranked Duel', 'Legacy Duel']);
  choice.pairs[3]();
  assert.match(a.sent.messages.at(-1), /duel challenge to Bravo/);
  UnrankedDuel.challenge(b, a);
  assert.ok(DuelArena._test.sessions.has(a), 'challenging back accepts the Legacy Duel');
  DuelArena._test.end(DuelArena._test.sessions.get(a));
});

test('the Emir\'s Arena offers Challenge and Load-outs; Challenge is routed past the attack', (t) => {
  const a = realPlayer(t, 'Alpha');
  const b = realPlayer(t, 'Bravo', 3367, 3270);
  process(a);
  assert.equal(a.sent.options.get(1), 'Challenge');
  assert.equal(a.sent.options.get(4), 'Load-outs');
  t.mock.method(a.getMovementQueue(), 'walkToEntity', (_target, arrived) => arrived());
  const route = emit('player:option-route', { player: a, target: b, option: 1, handled: false });
  assert.equal(route.handled, true);
  assert.deepEqual(b.sent.requests.at(-1)?.[0], 103);
});

test('Load-outs: offers both ways open the share screen; closing it closes the other\'s', (t) => {
  const a = realPlayer(t, 'Alpha');
  const b = realPlayer(t, 'Bravo', 3367, 3270);
  process(a);
  process(b);
  const offer = (player, target) => {
    const event = { player, target, option: 4, handled: false };
    for (const handler of hooks.options) handler(event);
  };
  offer(a, b);
  assert.deepEqual(a.sent.typed.at(-1), [102, 'Sending load-out sharing offer...']);
  assert.deepEqual(b.sent.requests.at(-1), [101, 'wishes to share load-outs with you.', 'Alpha']);
  offer(b, a);
  const screen = cache.getInterfaceId('pvp_arena_stagingarea_shareloadout');
  assert.deepEqual(a.sent.interfaces.at(-1), screen);
  assert.deepEqual(b.sent.interfaces.at(-1), screen);
  click(a, 'pvp_arena_stagingarea_shareloadout:tab_equipment2');
  assert.equal(varbit(a, 'pvpa_transmit_build'), 2);
  click(a, 'pvp_arena_stagingarea_shareloadout:copy');
  a.getEnteredAmountAction().execute(1);
  assert.match(a.sent.messages.at(-1), /^You've copied the 1 Def Pure load-out of Bravo/);
  closeScreen(b);
  assert.equal(a.sent.messages.at(-1), 'Bravo has closed the menu.');
});

test('a load-out\'s charged items come full: the Max/Med toxic staff has its scales', (t) => {
  const a = realPlayer(t, 'Alpha');
  Stash.save(a);
  Loadouts.equip(a, 0);
  const staff = a.getEquipment().getItems()[3];
  assert.equal(staff.getId(), core.ItemIdentifiers.TOXIC_STAFF_OF_THE_DEAD);
  assert.equal(ToxicStaff._test.charges(staff), ToxicStaff._test.MAX_CHARGES);
  Stash.restore(a);
});

test("a Tele Block or antifire from the fight stays in the arena; the player's own come back", (t) => {
  const a = realPlayer(t, 'Alpha');
  const combat = a.getCombat();
  combat.getFireImmunityTimer().start(300); // their own antifire, from before the fight
  Stash.save(a);
  assert.equal(combat.getFireImmunityTimer().secondsRemaining(), 0, 'the fight starts without it');
  combat.getTeleblockTimer().start(300); // teleblocked in the arena (no Wilderness check there)
  combat.getFireImmunityTimer().start(360); // an arena antifire
  Stash.restore(a);
  assert.equal(combat.getTeleblockTimer().secondsRemaining(), 0, "the arena's Tele Block stays behind");
  const fire = combat.getFireImmunityTimer().secondsRemaining();
  assert.ok(fire > 290 && fire <= 300, `their own antifire back (${fire}s)`);
});

test('a save taken mid-fight writes their own character in the Emir\'s Arena, never the arena\'s', (t) => {
  const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
  const [a, b] = toLoadouts(t, 1);
  a.getInventory().add(new core.Item(995, 777));
  const ownMagicXp = a.getSkillManager().getExperience(core.Skill.MAGIC);
  click(a, 'pvp_arena_unrankedduel:opponent_confirm');
  click(b, 'pvp_arena_unrankedduel:opponent_confirm');
  assert.ok(Battle.fightFor(a));
  const save = PlayerSave.fromPlayer(a);
  Stash.snapshot({ player: a, save });
  const saved = save.getInventory().filter((item) => item.getId() > 0).map((item) => [item.getId(), item.getAmount()]);
  assert.deepEqual(saved, [[995, 777]], 'only their own items');
  assert.equal(save.getEquipment().some((item) => item.getId() > 0), false);
  assert.equal(save.getSkills().experience[core.Skill.MAGIC.getIndex()], ownMagicXp);
  const at = save.getPosition();
  assert.ok(at.getX() > 3300 && at.getX() < 3400 && at.getY() > 3200 && at.getY() < 3300, 'standing in the Emir\'s Arena');
  assert.equal(Object.keys(save.attributes ?? {}).some((key) => /stash/.test(key)), false);
  for (const handler of hooks.shutdowns) handler();
});

test('a fight never starts on top of a character already put aside', (t) => {
  const [a, b] = toLoadouts(t, 1);
  a.getInventory().add(new core.Item(995, 5));
  Stash.save(a);
  a.getInventory().add(new core.Item(995, 9));
  click(a, 'pvp_arena_unrankedduel:opponent_confirm');
  click(b, 'pvp_arena_unrankedduel:opponent_confirm');
  assert.equal(Battle.fightFor(a), null);
  assert.equal(Battle.fightFor(b), null);
  assert.equal(a.getInventory().getAmount(995), 9, 'nothing replaced');
  Stash.restore(a);
  assert.equal(a.getInventory().getAmount(995), 5);
});

test('a shutdown ends fights with no winner, and a death under way still drops nothing', (t) => {
  const [a, b] = toFight(t);
  tick(21);
  for (const handler of hooks.beforeDeath) handler({ player: b, preventDeath: false });
  b.isDying = true; // the core's death task is under way (4 ticks) as the world stops
  const wins = a.sent.messages.filter((m) => /wins:/.test(m)).length;
  const [c, d] = toFight(t);
  tick(21);
  for (const handler of hooks.shutdowns) handler();
  assert.equal(Battle.fightFor(c), null);
  assert.equal(Battle.fightFor(d), null);
  assert.ok(!c.sent.messages.some((m) => /has won/.test(m)) && !d.sent.messages.some((m) => /has won/.test(m)), 'no winner');
  assert.equal(a.sent.messages.filter((m) => /wins:/.test(m)).length, wins);
  assert.equal(Battle.fightFor(b), null, 'out of the arena, their own character back');
  const drop = { player: b, shouldDrop: true };
  for (const handler of hooks.drops) handler(drop);
  assert.equal(drop.shouldDrop, false, 'the dying loser keeps their own items');
  const death = { player: b, killer: a, handled: false };
  for (const handler of hooks.deaths) handler(death);
  assert.equal(death.handled, true);
  b.isDying = false;
});

test('forged load-out slots change nothing', (t) => {
  const a = realPlayer(t, 'Alpha');
  hooks.objects.get(cache.getLocId('pvpa_lobby_supplies_chest'))({ player: a });
  const before = JSON.stringify(Loadouts.loadout(a, 0));
  const inv = cache.getComponentId('pvp_arena_stagingarea_supplies:0inventory');
  const list = cache.getComponentId('pvp_arena_stagingarea_supplies:0items_list');
  for (const [from, to, fromSlot, toSlot] of [[inv, inv, 0, 65535], [list, inv, 39, 65535], [list, inv, 99999, 3], [inv, inv, -1, 2]]) {
    emit('player:widget-action', { player: a, packet: { sourceWidgetId: from, targetWidgetId: to, sourceSlot: fromSlot, targetSlot: toSlot }, handled: false });
  }
  click(a, 'pvp_arena_stagingarea_supplies:0items_list', 70000);
  click(a, 'pvp_arena_stagingarea_supplies:0inventory', 500, 2);
  assert.equal(JSON.stringify(Loadouts.loadout(a, 0)), before);
  a.setAttribute('pvp-arena:loadouts', { a: { spellbook: 9, worn: { hat: 1e9, bogus: 4 }, inventory: new Array(70000).fill(39) } });
  const value = Loadouts.loadout(a, 0);
  assert.equal(value.inventory.length, 28);
  assert.equal(value.spellbook, 0);
  assert.deepEqual(Object.keys(value.worn), []);
});

test('the arena starts per-character counters afresh and puts the real ones back', (t) => {
  const a = realPlayer(t, 'Alpha');
  a.setAttribute('ring-of-recoil:damage', 17);
  a.setAttribute('imbued-heart:ready-at', 123456);
  a.setHasVengeance(true);
  Stash.save(a);
  assert.equal(a.getAttribute('ring-of-recoil:damage'), 0);
  assert.equal(a.getAttribute('imbued-heart:ready-at'), 0);
  assert.equal(a.hasVengeanceReturn(), false);
  a.setAttribute('ring-of-recoil:damage', 30);
  a.setHasVengeance(true);
  Stash.restore(a);
  assert.equal(a.getAttribute('ring-of-recoil:damage'), 17);
  assert.equal(a.getAttribute('imbued-heart:ready-at'), 123456);
  assert.equal(a.hasVengeanceReturn(), false);
});

test('a player who died with the screen open is not taken into a fight', (t) => {
  const [a, b] = toLoadouts(t, 1);
  click(a, 'pvp_arena_unrankedduel:opponent_confirm');
  a.isDying = true;
  click(b, 'pvp_arena_unrankedduel:opponent_confirm');
  assert.equal(Battle.fightFor(a), null);
  assert.equal(Battle.fightFor(b), null);
  a.isDying = false;
});
