// From server/: node --test tests/tzhaar-fight-cave.test.cjs (after yarn build).
//
// The TzHaar Fight Cave against the OSRS Wiki (TzHaar_Fight_Cave, Karamja_Diary): no cooldown before
// going back in, double Tokkul and the once-a-day resurrection with the Elite Karamja Diary, and
// the Jad Slayer task and pet.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, beforeEach, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

let Plugin, Resurrection, hooks, events, diaryElite, onTaskAnswer, spawnNpc;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Plugin = require('../plugins/minigames/TzhaarFightCaves.plugin');
  Resurrection = require('../plugins/minigames/tzhaar/Resurrection.TzhaarFightCaves');
  hooks = {};
  const api = new Proxy({
    core,
    persistAttribute: () => {},
    emitCustomEvent(name, event) {
      events.push([name, event]);
      if (name === 'diary:is-complete') event.complete = diaryElite;
      if (name === 'diary:tokkul' && diaryElite) event.amount *= 2;
      if (name === 'slayer:on-task') event.onTask = onTaskAnswer === true;
    },
    spawnNpc: (definition) => spawnNpc(definition),
    onObjectFirstClick: (id, handler) => { hooks.enter = hooks.enter ?? handler; },
    onObjectSecondClick: (id, handler) => { hooks.leave = handler; },
    onPlayerBeforeDeath: (handler) => { hooks.beforeDeath = handler; },
    onPlayerLogin: (handler) => { hooks.login = handler; },
    onPlayerProcess: (handler) => { hooks.process = handler; },
    onCustomEvent: (name, handler) => { if (name === 'npc-drops:tertiary-chance') hooks.tertiary = [handler]; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Plugin.register(api);
});

beforeEach(() => {
  events = [];
  diaryElite = false;
  spawnNpc = () => null;
});

const loc = (x, y) => new core.Location(x, y, 0);

function fakePlayer() {
  let tile = loc(2438, 5168);
  let area = null;
  const inventory = [];
  const player = {
    messages: [], attributes: {}, levels: {}, sent: [], queue: 0, poison: 1, dialogues: [],
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    isPlayer: () => true,
    getIndex: () => 1,
    getAsPlayer: () => player,
    getArea: () => area,
    setArea: (value) => { area = value; },
    sendMessage: (m) => player.messages.push(m),
    getAttribute: (k) => player.attributes[k],
    setAttribute: (k, v) => { player.attributes[k] = v; },
    setPoisonDamage: (v) => { player.poison = v; },
    setVenomed() {},
    getDialogueManager: () => ({ startDialogues: (chain) => player.dialogues.push(chain) }),
    getSkillManager: () => ({
      getCurrentLevel: () => 1,
      getMaxLevel: (skill) => (skill === core.Skill.HITPOINTS ? 99 : 70),
      setCurrentLevels: (skill, level) => { player.levels[skill.getName()] = level; },
    }),
    getPacketSender: () => ({ sendSkill: (skill) => player.sent.push(skill.getName()) }),
    getCombat: () => ({ reset() {}, getHitQueue: () => ({ clear: () => { player.queue = 0; } }) }),
    getInventory: () => ({
      contains: (id) => inventory.includes(id),
      getFreeSlots: () => 28,
      adds: (id, amount) => inventory.push([id, amount]),
    }),
    inventory,
  };
  return player;
}

test('clearing wave 2 while its monsters are idle spawns wave 3 and continues past its split', (t) => {
  let cycle = 0;
  const npcs = [];
  t.mock.method(core.World, 'getProcessCycle', () => cycle);
  spawnNpc = ({ id, x, y }) => {
    const npc = core.NPC.create(id, loc(x, y));
    npcs.push(npc);
    return npc;
  };
  const player = fakePlayer();
  const tick = (count) => {
    for (let i = 0; i < count; i++) {
      cycle++;
      hooks.process({ player });
    }
  };
  hooks.enter({ player });
  tick(6);
  assert.deepEqual(npcs.map((npc) => npc.getId()), [core.NpcIdentifiers.TZ_KIH_3]);
  npcs[0].setHitpoints(0);
  tick(7);
  const wave2 = npcs.slice(1);
  assert.deepEqual(wave2.map((npc) => npc.getId()), [core.NpcIdentifiers.TZ_KIH_3, core.NpcIdentifiers.TZ_KIH_3]);

  for (const npc of wave2) {
    npc.getCombat().reset();
    t.mock.method(npc.getCombat().getLastAttack(), 'hasElapsed', () => true);
    npc.setHitpoints(5);
    npc.process();
    assert.equal(npc.getHitpoints(), 6, 'living idle NPCs still regenerate');
    npc.setHitpoints(0);
    npc.process(); // NPCs process before the player's wave check in World.process.
  }
  tick(7);
  const tzKek = npcs.at(-1);
  assert.equal(tzKek.getId(), core.NpcIdentifiers.TZ_KEK_3, 'wave 3 spawns its level-45 Tz-Kek');
  assert.ok(wave2.every((npc) => npc.getHitpoints() === 0), 'dying NPCs stay at zero hitpoints');
  tzKek.setHitpoints(0);
  tick(1);
  const children = npcs.slice(-2);
  assert.deepEqual(children.map((npc) => npc.getId()), [core.NpcIdentifiers.TZ_KEK_5, core.NpcIdentifiers.TZ_KEK_5]);
  tick(6);
  assert.equal(player.getAttribute('tzhaar:fight-cave-wave'), 3, 'the split monsters still hold the wave');
  children.forEach((npc) => npc.setHitpoints(0));
  tick(7);
  assert.equal(player.getAttribute('tzhaar:fight-cave-wave'), 4);
  assert.deepEqual(npcs.slice(-2).map((npc) => npc.getId()), [core.NpcIdentifiers.TZ_KEK_3, core.NpcIdentifiers.TZ_KIH_3]);
  hooks.leave({ player });
});

test('going back in right after leaving is never refused', () => {
  const player = fakePlayer();
  hooks.enter({ player });
  hooks.leave({ player });
  const before = player.dialogues.length;
  hooks.enter({ player });
  assert.equal(player.dialogues.length, before + 1, 'the second entry spoke once');
  assert.equal(player.getAttribute('tzhaar:fight-cave-wave'), 1, 'and started a run at wave 1');
  hooks.leave({ player });
});

test('the Tokkul of a run is doubled with the Elite Karamja Diary, not otherwise', () => {
  for (const [elite, expected] of [[false, 6], [true, 12]]) {
    diaryElite = elite;
    const player = fakePlayer();
    // Back in on wave 3 after a logout; leaving then pays for the two waves cleared: 2 * 3.
    player.attributes['tzhaar:fight-cave-wave'] = 3;
    player.moveTo(loc(2400, 5088));
    hooks.login({ player });
    hooks.leave({ player });
    const tokkul = player.inventory.find(([id]) => id === core.ItemIdentifiers.TOKKUL);
    assert.deepEqual(tokkul, [core.ItemIdentifiers.TOKKUL, expected]);
  }
});

test('the Jad Slayer task is cleared when a run ends, naming the cave', () => {
  const player = fakePlayer();
  hooks.enter({ player });
  hooks.leave({ player });
  const [, event] = events.find(([name]) => name === 'slayer:leave-task-area');
  assert.equal(event.npcId, core.NpcIdentifiers.TZTOK_JAD);
  assert.equal(event.player, player);
  assert.equal(event.message, 'the fight cave');
});

test('a lethal blow in the cave is undone once a day with the Elite Karamja Diary', () => {
  diaryElite = true;
  const player = fakePlayer();
  hooks.enter({ player });
  player.queue = 3;
  player.poison = 5;
  const death = { player, preventDeath: false };
  hooks.beforeDeath(death);
  assert.equal(death.preventDeath, true);
  assert.equal(player.levels.Hitpoints, 99, 'full hitpoints');
  assert.equal(player.levels.Prayer, 70, 'and every other stat restored');
  assert.equal(player.queue, 0, 'pending hits are dropped');
  assert.equal(player.poison, 0);
  const again = { player, preventDeath: false };
  hooks.beforeDeath(again);
  assert.equal(again.preventDeath, false, 'only once per day');
  player.attributes[Resurrection.RESURRECTED_ATTRIBUTE] = Resurrection.today() - 1;
  const nextDay = { player, preventDeath: false };
  hooks.beforeDeath(nextDay);
  assert.equal(nextDay.preventDeath, true, 'the next day it works again');
  hooks.leave({ player });
});

test('no resurrection without the diary or outside the cave', () => {
  const noDiary = fakePlayer();
  hooks.enter({ player: noDiary });
  const a = { player: noDiary, preventDeath: false };
  hooks.beforeDeath(a);
  assert.equal(a.preventDeath, false);
  hooks.leave({ player: noDiary });

  diaryElite = true;
  const outside = fakePlayer();
  const c = { player: outside, preventDeath: false };
  hooks.beforeDeath(c);
  assert.equal(c.preventDeath, false);
});

test('an on-task Jad doubles the TzRek-Jad pet chance, any other kill leaves it', () => {
  const jad = { getId: () => core.NpcIdentifiers.TZTOK_JAD };
  const chance = (npc, onTask) => {
    const rules = [];
    onTaskAnswer = onTask;
    for (const handler of hooks.tertiary) handler({ player: {}, npc, rules });
    return rules.filter((rule) => rule.pattern.test('TzRek-Jad')).reduce((total, rule) => total * rule.multiplier, 1);
  };
  assert.equal(chance(jad, true), 2, 'Wiki: 1/100 on task');
  assert.equal(chance(jad, false), 1, '1/200 off task');
  assert.equal(chance({ getId: () => core.NpcIdentifiers.TZ_KEK_3 }, true), 1, 'only Jad');
});
