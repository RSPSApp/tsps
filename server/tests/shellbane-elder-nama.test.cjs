// From server/: node --test tests/shellbane-elder-nama.test.cjs (after yarn build).
//
// Elder Nama at the Shellbane Gryphon Cave (Wiki: Elder_Nama, Transcript:Elder_Nama,
// Shellbane_gryphon, Clue scroll (elite) - Their bane awaits): first-time then subsequent
// Talk-to, the clue-step option and its one fight, the entrance refusal, no drops off task
// without the clue, and the Statistics scoreboard, on a real Player with only the network stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, beforeEach, afterEach, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const core = PluginManager.getCoreApi();

const plugin = require('../plugins/bosses/ShellbaneGryphon.plugin');
const Common = require('../plugins/bosses/shellbane/Common.ShellbaneGryphon');
const Cave = require('../plugins/bosses/shellbane/Cave.ShellbaneGryphon');
const Kills = require('../plugins/bosses/shellbane/Kills.ShellbaneGryphon');
const Nama = require('../plugins/bosses/shellbane/Nama.ShellbaneGryphon');
const Scoreboard = require('../plugins/bosses/shellbane/Scoreboard.ShellbaneGryphon');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shellbane-scoreboard-'));
const FILE = path.join(scratch, 'board.json');
const hooks = { events: new Map(), variants: [], conditions: [], npcs: {}, defeated: [], persisted: new Map() };
const state = { onTask: false, clue: new Set(), started: [] };
const players = [];
let NAMA;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const api = new Proxy({
    core,
    persistAttribute: (key, value) => hooks.persisted.set(key, value),
    onCustomEvent(name, handler) { hooks.events.set(name, [...(hooks.events.get(name) ?? []), handler]); },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete') event.complete = true;
      if (name === 'slayer:on-task') event.onTask = state.onTask;
      if (name === 'treasure-trails:holds-kill-step' && state.clue.has(event.player) && event.npcId === Common.ids.npcs.boss) event.holds = true;
      if (name === 'npc-dialogue:start') { state.started.push(event); event.handled = true; }
      for (const handler of hooks.events.get(name) ?? []) handler(event);
    },
    onNpcDialogueVariant: (handler) => hooks.variants.push(handler),
    onNpcDialogueCondition: (handler) => hooks.conditions.push(handler),
    onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
    onPlayerDefeated: (handler) => hooks.defeated.push(handler),
  }, { get: (target, key) => target[key] ?? (() => {}) });
  plugin.register(api);
  NAMA = core.NpcDefinition.forId(Common.ids.npcs.nama);
});
beforeEach(() => { Scoreboard._useFile(FILE); fs.rmSync(FILE, { force: true }); state.onTask = false; state.clue.clear(); state.started.length = 0; });
afterEach(() => { for (const p of players.splice(0)) Cave.leaveCave(p); });

function actor() {
  const player = new Player(null);
  const sent = { messages: [], interfaces: [], strings: new Map(), removals: 0 };
  player.setRegistered(true);
  player.getSession = () => ({ sendClientPacket: () => true, write() {}, isConnected: () => true });
  player.sendMessage = (m) => sent.messages.push(m);
  const sender = player.getPacketSender();
  sender.sendInterface = (id) => sent.interfaces.push(id);
  sender.sendString = (text, uid) => sent.strings.set(uid, text);
  sender.sendInterfaceRemoval = () => { sent.removals++; };
  sender.sendInterfaceScript = () => {};
  player.moveTo(new core.Location(3176, 2476, 0));
  player.getSkillManager().setCurrentLevel(core.Skill.SLAYER, 51, false);
  player.sent = sent;
  players.push(player);
  return player;
}
const variant = (player) => hooks.variants.map((h) => h({ player, definition: NAMA, npcId: NAMA.getId() })).find((v) => v != null);
const condition = (player, text) => hooks.conditions.map((h) => h({ player, definition: NAMA, text })).find((v) => v != null);
function line(player, text) {
  const request = { player, definition: NAMA, npcId: NAMA.getId(), text };
  for (const handler of hooks.events.get('npc-dialogue:line')) handler(request);
  request.before?.();
  return request;
}
const enter = (player) => Cave.enter({ player, objectId: Common.ids.locs.entrance });
const ticks = (n) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
const transcript = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'definitions', 'npc-dialogues.json'), 'utf8'))['Elder Nama'].variants;

test("the transcript still carries the lines, condition, action and refusal these hooks key on", () => {
  const v = transcript();
  assert.match(v['first-time-dialogue'][0].npc, /^Hello! You must be the human/);
  const menu = v['first-time-dialogue-subsequent-dialogue'].find((s) => s.type === 'choice');
  assert.equal(menu.options[0].steps.at(-1).target, 'Shellbane Gryphon Statistics');
  assert.match(menu.options[1].condition, /shellbane gryphon elite clue step/);
  assert.match(menu.options[1].steps.at(-1).npc, /^Hmm\.\.\. yes, that would appear to be this gryphon\./);
  assert.equal(v['attempting-to-enter-cave-entrance'][0].npc, "Sorry, but I can't let you go in there without permission.");
});

test('Talk-to plays the first-time conversation until its first line shows, then the subsequent one', () => {
  const player = actor();
  assert.equal(variant(player), 'first-time-dialogue');
  assert.equal(variant(player), 'first-time-dialogue', 'choosing it again changes nothing');
  line(player, "Hello! You must be the human that's been helping out around here.");
  assert.equal(variant(player), 'first-time-dialogue-subsequent-dialogue');
  assert.equal(hooks.persisted.get(Nama.MET_ATTRIBUTE), false);
});

test('the clue option shows only with the gryphon clue step; Nama allows one fight, which the entrance spends', () => {
  const player = actor();
  const text = 'If the player has the shellbane gryphon elite clue step in their inventory:';
  assert.equal(condition(player, text), false);
  assert.equal(condition(player, 'If the player has something else:'), undefined, 'other prose is not ours');
  enter(player);
  assert.equal(Cave.caveOf(player), null, 'no task, no permission: turned away');
  assert.equal(state.started.at(-1).variant, 'attempting-to-enter-cave-entrance');
  assert.equal(state.started.at(-1).npcId, Common.ids.npcs.nama);
  line(player, 'Hmm... yes, that would appear to be this gryphon. Very well, I will allow you to fight it once, but no more than that.');
  assert.notEqual(player.getAttribute(Nama.CLUE_PERMISSION_ATTRIBUTE), true, 'a forged line without the clue grants nothing');
  state.clue.add(player);
  assert.equal(condition(player, text), true);
  line(player, 'Hmm... yes, that would appear to be this gryphon. Very well, I will allow you to fight it once, but no more than that.');
  assert.equal(player.getAttribute(Nama.CLUE_PERMISSION_ATTRIBUTE), true);
  state.clue.delete(player);
  assert.equal(enter(player), true);
  assert.equal(Cave.caveOf(player), null, 'permission without the clue still held is refused');
  assert.equal(player.getAttribute(Nama.CLUE_PERMISSION_ATTRIBUTE), true, 'and not spent');
  state.clue.add(player);
  enter(player);
  const cave = Cave.caveOf(player);
  assert.ok(cave, 'in with the clue and permission');
  assert.ok(cave.boss, 'the gryphon is waiting');
  assert.equal(player.getAttribute(Nama.CLUE_PERMISSION_ATTRIBUTE), false, 'the one fight is spent');
  Cave.exit({ player, objectId: Common.ids.locs.exit });
  const refusals = state.started.length;
  enter(player);
  assert.equal(Cave.caveOf(player), null, 'no more than that');
  assert.equal(state.started.length, refusals + 1);
});

test('on task the entrance lets the player in without Nama', () => {
  const player = actor();
  state.onTask = true;
  enter(player);
  assert.ok(Cave.caveOf(player));
  assert.equal(state.started.length, 0);
});

test('off task the gryphon drops nothing without the clue step as it dies; with it, or on task, it drops', () => {
  for (const [onTask, clue, dropped] of [[false, false, false], [false, true, true], [true, false, true]]) {
    const player = actor();
    state.onTask = true;
    enter(player);
    const cave = Cave.caveOf(player);
    state.onTask = onTask;
    if (clue) state.clue.add(player); else state.clue.delete(player);
    const npc = cave.boss;
    Kills.bossDied({ npc, killer: player });
    const claim = { killer: player, npc, npcId: Common.ids.npcs.boss, damagers: [], handled: false };
    for (const handler of hooks.events.get('npc-drops:claim')) handler(claim);
    assert.equal(claim.handled, !dropped, `onTask=${onTask} clue=${clue}`);
    Cave.leaveCave(player);
  }
  const other = { npc: { __sgNoLoot: true }, npcId: Common.ids.npcs.boss + 1, handled: false };
  for (const handler of hooks.events.get('npc-drops:claim')) handler(other);
  assert.equal(other.handled, false, 'another NPC is never claimed');
});

test("kills, their times and deaths fill Nama's board, and the world's records survive a restart", () => {
  const a = actor(), b = actor();
  state.onTask = true;
  enter(a);
  const cave = Cave.caveOf(a);
  for (let i = 0; i < 150; i++) cave.fight.tick();
  Kills.bossDied({ npc: cave.boss, killer: a });
  assert.equal(a.getAttribute(Scoreboard.BEST_TICKS_ATTRIBUTE), 150);
  ticks(Common.data.cave.respawnTicks + 1);
  assert.ok(cave.boss, 'respawned on task');
  for (let i = 0; i < 200; i++) cave.fight.tick();
  Kills.bossDied({ npc: cave.boss, killer: a });
  assert.equal(a.getAttribute(Scoreboard.BEST_TICKS_ATTRIBUTE), 150, 'a slower kill keeps the best');
  ticks(Common.data.cave.respawnTicks + 1);
  for (const handler of hooks.defeated) handler({ victim: a, killer: cave.boss });
  for (const handler of hooks.defeated) handler({ victim: b, killer: null });
  assert.equal(b.getAttribute(Scoreboard.DEATHS_ATTRIBUTE) ?? 0, 0, 'a death outside the cave does not count');
  Scoreboard._useFile(FILE);
  const lines = Scoreboard.lines(a);
  assert.deepEqual([...lines.values()], ['2', '1 (recorded)', '1:30.00', '2 (recorded)', '1 (recorded)', '1:30.00']);
  assert.deepEqual([...Scoreboard.lines(b).values()], ['0', '0 (recorded)', 'No recorded best', '2 (recorded)', '1 (recorded)', '1:30.00']);
});

test('Statistics, from the option or the menu once the chat closes, opens the cache board with its rows', () => {
  const player = actor();
  const board = core.CacheDefinitions.getInterfaceId('gryphon_boss');
  assert.equal(hooks.npcs['Elder Nama'].Statistics({ player }), true);
  assert.equal(player.sent.interfaces.at(-1), board);
  assert.equal(player.sent.strings.get(core.CacheDefinitions.getComponentId('gryphon_boss:pbt_content')), 'No recorded best');
  assert.equal(player.sent.strings.get(core.CacheDefinitions.getComponentId('gryphon_boss:gkc_content')), '0 (recorded)');
  player.sent.interfaces.length = 0;
  const action = { player, definition: NAMA, action: 'open_interface', target: 'Shellbane Gryphon Statistics', handled: false };
  for (const handler of hooks.events.get('npc-dialogue:action')) handler(action);
  assert.equal(action.handled, true);
  assert.equal(action.end, true);
  assert.deepEqual(player.sent.interfaces, [], 'not over the chat that is closing');
  ticks(2);
  assert.deepEqual(player.sent.interfaces, [board]);
  const shop = { player, definition: NAMA, action: 'open_shop', target: 'x', handled: false };
  for (const handler of hooks.events.get('npc-dialogue:action')) handler(shop);
  assert.equal(shop.handled, false);
});
