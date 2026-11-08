// Run after `npx tsc --build`: node --test tests/pvp-arena-ranked.test.cjs
//
// PvP Arena ranked 1v1 Duels (plugins/minigames/duelarena/Matchmaking.DuelArena.js), as the rsprox
// captures of world 578 show them: signing up, pairing, the invitation's 15 up front, its
// reminders and lapse, the staging area, the stake swap, ready and the timer, a ranked win and
// loss (Elo, K 50: 25 between equal ranks), the win streak's points, abandoning, an opponent who
// never comes, the weekly build and the rank titles. Real Players and cache; network stubbed.
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

const DuelArena = require('../plugins/minigames/DuelArena.plugin');
const Matchmaking = require('../plugins/minigames/duelarena/Matchmaking.DuelArena');
const Battle = require('../plugins/minigames/duelarena/Battle.DuelArena');
const Rank = require('../plugins/minigames/duelarena/Rank.DuelArena');
const Stash = require('../plugins/minigames/duelarena/Stash.DuelArena');
const Group = require('../plugins/minigames/duelarena/Group.DuelArena');

const hooks = { clicks: [], buttons: new Map(), objects: new Map(), custom: {}, prompts: [], beforeDeath: [], deaths: [], logouts: [], shutdowns: [] };
const tasks = [];
let core;
let cache;
let index = 1;

before(() => {
  CachePipeline.initialize();
  const noop = () => {};
  const api = new Proxy({
    core: PluginManager.getCoreApi(),
    getPluginConfig: (_key, fallback) => fallback,
    onInterfaceActionClick: (handler) => hooks.clicks.push(handler),
    onInterfaceActionButton: (ids, handler) => { for (const id of [].concat(ids)) hooks.buttons.set(id, handler); },
    onObjectFirstClick: (ids, handler) => { for (const id of ids) hooks.objects.set(`1:${id}`, handler); },
    onObjectSecondClick: (ids, handler) => { for (const id of ids) hooks.objects.set(`2:${id}`, handler); },
    onObjectThirdClick: (ids, handler) => { for (const id of ids) hooks.objects.set(`3:${id}`, handler); },
    onCustomEvent: (name, handler) => { (hooks.custom[name] ??= []).push(handler); },
    emitCustomEvent: (name, payload) => { for (const handler of hooks.custom[name] ?? []) handler(payload); },
    sendMultiChatboxPrompt: (player, title, ...pairs) => hooks.prompts.push({ player, title, pairs }),
    onPlayerBeforeDeath: (handler) => hooks.beforeDeath.push(handler),
    onPlayerDeath: (handler) => hooks.deaths.push(handler),
    onPlayerLogout: (handler) => hooks.logouts.push(handler),
    onServerShutdown: (handler) => hooks.shutdowns.push(handler),
  }, { get: (target, key) => target[key] ?? noop });
  DuelArena.register(api);
  core = api.core;
  cache = core.CacheDefinitions;
  core.TaskManager.submit = (task) => { task.running = true; tasks.push(task); };
});

beforeEach(() => {
  hooks.prompts.length = 0;
  tasks.length = 0;
  Matchmaking.signedUp.clear();
  Matchmaking.matchOf.clear();
  Matchmaking._test.stopPairing(); // its task went with the cleared queue
  Group._test.viewers.clear();
  Group._test.members.clear();
});

function tick(times = 1) {
  for (let i = 0; i < times; i++) {
    for (const task of [...tasks]) if (task.isRunning()) task.execute();
    for (let j = tasks.length - 1; j >= 0; j--) if (!tasks[j].isRunning()) tasks.splice(j, 1);
  }
}

function realPlayer(t, name, rank = 2500) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setIndex(index++);
  p.setRegistered(true);
  t.mock.method(p, 'getDisplayName', () => name);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  p.setLocation(new core.Location(3366, 3274, 0));
  const sender = p.getPacketSender();
  p.sent = { varbits: new Map(), messages: [] };
  const original = sender.sendVarbit;
  t.mock.method(sender, 'sendVarbit', function (id, value) { p.sent.varbits.set(id, value); return original.apply(this, arguments); });
  t.mock.method(p, 'sendMessage', (text) => p.sent.messages.push(text));
  p.setAttribute('pvp-arena:rank', rank);
  return p;
}

const varbit = (p, name) => p.sent.varbits.get(cache.getVarbitId(name));
const panel = (player, name) => {
  const uid = cache.getComponentId(`pvp_arena_sidepanel:${name}`);
  for (const handler of hooks.clicks) handler({ player, groupId: uid >>> 16, childId: uid & 0xffff, opId: 1, action: 1 });
};
const loc = (op, name, player) => hooks.objects.get(`${op}:${cache.getLocId(name)}`)({ player });
const prompt = () => hooks.prompts.at(-1);
const choose = (label) => { const p = prompt(); p.pairs[p.pairs.indexOf(label) + 1](); };
const ready = (player) => hooks.buttons.get(cache.getComponentId('pvp_arena_stagingarea_supplies:top'))({ player });

/** a and b signed up to the Duels group, then paired. */
function invited(t, rankA = 2500, rankB = 2500) {
  const a = realPlayer(t, 'Alpha', rankA);
  const b = realPlayer(t, 'Bravo', rankB);
  for (const p of [a, b]) {
    panel(p, 'right');
    choose('Official 1v1 Duels group');
    tick(1); // "Seeking group..."
    panel(p, 'left');
    tick(1); // "Requesting..."
  }
  tick(5);
  return [a, b];
}

function upstairs(t, rankA, rankB) {
  const [a, b] = invited(t, rankA, rankB);
  loc(1, 'pvpa_stagingarea_entry', a);
  loc(1, 'pvpa_stagingarea_entry02', b);
  return [a, b];
}

test('signing up, pairing and the invitation\'s 15 up front', (t) => {
  const [a, b] = invited(t);
  for (const p of [a, b]) {
    assert.equal(Rank.rank(p), 2485);
    assert.equal(varbit(p, 'pvpa_upfront_paid'), 1);
    assert.equal(varbit(p, 'pvpa_rank_points'), 2485);
    assert.ok(p.sent.messages.includes('A <col=ef1020>Duel</col> awaits you! Come to the <col=ef1020>staging area</col>, upstairs in the Arena hospital.'));
  }
  tick(10);
  assert.ok(a.sent.messages.some((m) => /still waiting/.test(m)));
});

test('an ignored invitation lapses: the no-show keeps paying, the one who came is paid back', (t) => {
  const [a, b] = invited(t);
  loc(1, 'pvpa_stagingarea_entry', a);
  assert.equal(varbit(a, 'pvpa_owed_join_refund'), 1);
  tick(299);
  assert.equal(Rank.rank(a), 2500, 'the one who came has the 15 back');
  assert.ok(a.sent.messages.includes('The Duel has been cancelled because the opponent took too long to arrive.'));
  assert.equal(Rank.rank(b), 2485, 'the no-show keeps paying');
  assert.equal(varbit(b, 'pvpa_affinitystatus'), 1);
  assert.equal(Matchmaking.matchOf.has(a), false);
});

test('both up: the stake swap; ready on both starts the week\'s build; a win and a loss', (t) => {
  const [a, b] = upstairs(t);
  for (const p of [a, b]) assert.equal(Rank.rank(p), 2475, '15 back, 25 staked');
  loc(1, 'pvpa_stagingarea_supplies_chest', a);
  assert.equal(varbit(a, 'pvpa_transmit_battletype'), 1006);
  ready(a);
  assert.equal(varbit(a, 'pvpa_stagingarea_iamready'), 1);
  assert.equal(Battle.fightFor(a), null);
  ready(b);
  const fight = Battle.fightFor(a);
  assert.ok(fight);
  assert.equal(fight.build, Rank.weeklyBuild());
  assert.ok(a.sent.messages.some((m) => /^Ranked Duel participation/.test(m)));
  tick(21);
  for (const handler of hooks.beforeDeath) handler({ player: b, preventDeath: false });
  assert.equal(Rank.rank(a), 2525);
  assert.ok(a.sent.messages.includes('Congratulations! Your victory has <col=ff0000>increased your ranking</col> by <col=ff0000>25</col>, and has earned you <col=ff0000>16 Arena Reward Points</col>.'));
  assert.ok(a.sent.messages.some((m) => /^Ranked Duel wins: <col=ef1020>\d+<\/col> \/ \d+$/.test(m)));
  assert.equal(Rank.points(a), 16);
  for (const handler of hooks.deaths) handler({ player: b, killer: a, handled: false });
  hooks.objects.get(`1:${cache.getLocId('pvpa_battlearea_spectatorportal')}`)({ player: b });
  assert.equal(Rank.rank(b), 2475);
  assert.equal(Rank.points(b), 12);
  assert.ok(b.sent.messages.includes('Your defeat has <col=ff0000>decreased your ranking</col> by <col=ff0000>25</col>, but has earned you <col=ff0000>12 Arena Reward Points</col>.'));
  hooks.objects.get(`1:${cache.getLocId('pvpa_battlearea_trapdoor')}`)({ player: a });
  assert.equal(Matchmaking.matchOf.has(a), false);
  assert.equal(Stash.stashed(a), null);
});

test('the staging timer starts the fight with both up, ready or not', (t) => {
  const [a] = upstairs(t);
  tick(299);
  assert.ok(Battle.fightFor(a));
  for (const handler of hooks.shutdowns) handler();
  assert.equal(Rank.rank(a), 2500, 'a shutdown draw gives the stake back');
});

test('abandoning keeps the stake; the opponent is paid back', (t) => {
  const [a, b] = upstairs(t);
  loc(1, 'pvpa_stagingarea_exit', a);
  choose('Abandon the fight');
  assert.equal(Rank.rank(a), 2475);
  assert.ok(a.sent.messages.includes('Your defeat has <col=ff0000>decreased your ranking</col> by <col=ff0000>25</col>. You were not awarded any Arena Reward Points.'));
  assert.equal(Rank.rank(b), 2500);
  assert.equal(Matchmaking.matchOf.has(b), false);
});

test('withdrawing while invited is a no-show; signing up again works', (t) => {
  const [a, b] = invited(t);
  panel(a, 'right');
  assert.equal(Rank.rank(a), 2485);
  assert.equal(Rank.rank(b), 2500);
  assert.equal(Matchmaking.matchOf.size, 0);
  panel(a, 'right');
  choose('Official 1v1 Duels group');
  tick(1);
  panel(a, 'left');
  tick(1);
  assert.equal(Matchmaking.signedUp.has(a), true, 'signed up again');
  assert.equal(varbit(a, 'pvpa_affinitystatus'), 3);
});

test('a streak earns a point more each win; a loss ends it', (t) => {
  const a = realPlayer(t, 'Alpha');
  assert.deepEqual([Rank.winPoints(a), Rank.winPoints(a), Rank.winPoints(a), Rank.winPoints(a)], [16, 17, 18, 19]);
  Rank.endStreak(a);
  assert.equal(Rank.winPoints(a), 16);
  a.setAttribute('pvp-arena:win-streak', 40);
  assert.equal(Rank.winPoints(a), 26, '10 at most on top');
});

test('logging out: while invited a no-show, upstairs an abandon saved outside the hospital', (t) => {
  const [a, b] = invited(t);
  for (const handler of hooks.logouts) handler({ player: a });
  assert.equal(Rank.rank(a), 2485);
  assert.equal(Rank.rank(b), 2500);
  const [c, d] = upstairs(t);
  for (const handler of hooks.logouts) handler({ player: c });
  assert.equal(Rank.rank(c), 2475);
  assert.equal(Rank.rank(d), 2500);
  assert.ok(c.getLocation().getX() < 4000, 'saved on the real map');
});

test('the recruitment board\'s Rank', (t) => {
  const a = realPlayer(t, 'Alpha', 2535);
  let shown = null;
  t.mock.method(a.getDialogueManager(), 'startDialogues', (chain) => { shown = chain; });
  loc(3, 'pvpa_recruitment_board', a);
  const [box] = [...shown.dialogues.values()];
  assert.equal(box.getText(), 'You have a ranking of 2535<br><br>This gives you the rank of Steel III.');
  assert.equal(box.getItemId(), cache.getObjId('steel_scimitar'), 'the tier\'s icon, as captured');
  assert.equal(Rank.icon(5600), cache.getObjId('rune_scimitar'));
  assert.equal(Rank.icon(9100), cache.getObjId('dragon_scimitar'));
});

test('Elo between unequal ranks, the streak\'s points, the titles and the weekly build', () => {
  assert.equal(Rank.stakeAgainst(2500, 2500), 25);
  assert.equal(Rank.gainAgainst(2500, 2500), 25);
  assert.ok(Rank.gainAgainst(2000, 3000) > 45 && Rank.stakeAgainst(2000, 3000) < 5);
  assert.equal(Rank.title(2500), 'Steel III');
  assert.equal(Rank.title(2499), 'Steel II');
  assert.equal(Rank.title(0), 'Bronze I');
  assert.equal(Rank.title(7200), 'Dragon Elite');
  assert.equal(Rank.weeklyBuild(Date.parse('2026-11-07T12:00:00Z')), 1, 'Zerker this week');
  assert.notEqual(Rank.weeklyBuild(Date.parse('2026-11-11T00:30:00Z')), 1, 'rotated the next Wednesday');
});

test('the Duels group: looking at it, signing up and an invitation, as the side panel draws them', (t) => {
  const a = realPlayer(t, 'Alpha', 2500);
  const b = realPlayer(t, 'Bravo', 4200);
  const packets = new Map([[a, []], [b, []]]);
  for (const p of [a, b]) t.mock.method(p, 'getSession', () => ({ sendClientPacket: (packet) => { packets.get(p).push(packet); return true; }, write: () => true }));
  panel(a, 'right');
  choose('Official 1v1 Duels group');
  tick(1);
  assert.equal(varbit(a, 'clan_guest_affinitystatus'), 3);
  assert.equal(varbit(a, 'clan_guest_affinity_joined'), 3);
  assert.equal(Group.channelRank(a), -1, 'only looking');
  const settings = Group._test.settingsSnapshot();
  assert.equal(settings.name, '1v1Duels');
  assert.deepEqual(settings.settings, [{ id: 33, value: 1006 }]);
  assert.equal(settings.members[0].name, 'PvPA Duels');
  panel(b, 'right');
  choose('Official 1v1 Duels group');
  tick(1);
  assert.deepEqual(Group._test.channelSnapshot().users.map((u) => u.name), ['Alpha', 'Bravo'], 'everyone looking, the player too');
  panel(a, 'left');
  tick(1);
  assert.equal(varbit(a, 'clan_guest_affinitystatus'), 1);
  assert.equal(varbit(a, 'pvpa_affinitystatus'), 3);
  assert.equal(Group.channelRank(a), 102, 'Steel: tier 2');
  panel(b, 'left');
  tick(1);
  assert.equal(Group.channelRank(b), 104, 'Adamant: tier 4');
  assert.deepEqual(Group._test.settingsSnapshot().members.map((m) => m.name), ['PvPA Duels', 'Alpha', 'Bravo']);
  tick(5);
  assert.equal(Group.channelRank(a), 112, 'invited');
  loc(1, 'pvpa_stagingarea_entry', a);
  assert.equal(Group._test.members.has(a), false, 'out of the group once upstairs');
  assert.ok(packets.get(a).length > 0, 'the clan snapshots went out');
});

test('recruiting is for the Emir\'s Arena: not elsewhere, and leaving it leaves the group', (t) => {
  const a = realPlayer(t, 'Alpha');
  a.setLocation(new core.Location(3222, 3218, 0)); // Lumbridge
  panel(a, 'right');
  assert.equal(hooks.prompts.length, 0, 'no groups to find out here');
  assert.equal(a.sent.messages.at(-1), "This isn't a very suitable place for recruitment.");
  a.setLocation(new core.Location(3366, 3274, 0));
  panel(a, 'right');
  choose('Official 1v1 Duels group');
  tick(1);
  panel(a, 'left');
  tick(1);
  assert.equal(Matchmaking.signedUp.has(a), true);
  a.setLocation(new core.Location(3222, 3218, 0));
  tick(1);
  assert.equal(Matchmaking.signedUp.has(a), false);
  assert.equal(a.sent.messages.at(-1), "This isn't a suitable place for PvP Arena recruitment, so you will be removed from the recruitment group.");
  assert.equal(varbit(a, 'pvpa_affinitystatus'), 1);
});

test('joining from the side panel: the screen fades out, then the player moves, then it clears', (t) => {
  const [a] = invited(t);
  const sender = a.getPacketSender();
  const steps = [];
  const fade = cache.getInterfaceId('fade_overlay');
  const atmosphere = cache.getComponentId('toplevel_osrs_stretch:overlay_atmosphere');
  const open = sender.sendSubInterface;
  const close = sender.closeSubInterface;
  t.mock.method(sender, 'sendSubInterface', function (target, group, ...rest) {
    if (group === fade) steps.push(['fade', rest[1]?.postScripts?.[0]?.args]);
    return open.call(this, target, group, ...rest);
  });
  t.mock.method(sender, 'closeSubInterface', function (target) {
    if (target === atmosphere) steps.push(['clear']);
    return close.call(this, target);
  });
  const match = Matchmaking.matchOf.get(a);
  panel(a, 'worldhop');
  assert.deepEqual(steps, [['fade', [0, 255, 0, 0, 15]]], 'to black first, as captured');
  assert.equal(match.arrived.has(a), false, 'not moved while it darkens');
  tick(1);
  assert.equal(match.arrived.has(a), true, 'moved under the black screen');
  assert.equal(steps.length, 1);
  tick(1);
  assert.deepEqual(steps.at(-1), ['clear'], 'then shown where they are');
});

test('a shutdown while upstairs moves both out before the save', (t) => {
  const [a, b] = upstairs(t);
  for (const handler of hooks.shutdowns) handler();
  for (const p of [a, b]) {
    assert.ok(p.getLocation().getX() < 4000, 'saved outside the staging copy, no tick needed');
    assert.equal(Rank.rank(p), 2500);
  }
});

test('a logout in the fade tick after a cancel is saved outside the staging copy', (t) => {
  const [a, b] = upstairs(t);
  loc(1, 'pvpa_stagingarea_exit', a);
  choose('Abandon the fight');
  assert.ok(b.getLocation().getX() > 4000, 'still upstairs, the fade not yet run');
  b.getArea().leave(b, true);
  assert.ok(b.getLocation().getX() < 4000, 'saved on the real map');
});

test('the rank floor: only what was taken comes back', (t) => {
  const [a, b] = invited(t, 10, 2500);
  assert.equal(Rank.rank(a), 0);
  panel(b, 'right'); // b withdraws: a is let go and repaid what the invitation took
  assert.equal(Rank.rank(a), 10);
});
