// From server/: node --test tests/tzhaar-ket-rak.test.cjs (after yarn build).
//
// TzHaar-Ket-Rak's Challenges against the OSRS Wiki (TzHaar-Ket-Rak's_Challenges,
// Transcript:TzHaar-Ket-Rak, Yt-HurKot, TzHaar) and the rsprox recordings in
// plugins/minigames/data/tzhaar-ket-rak.json: the ids, his talk, the gates, the staged entry, the
// Jads and their healers, completion and failure with their lines, the rewards and the Combat
// Achievements.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, beforeEach, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

let Common, Dialogue, Challenge, Rewards, Scoreboard, tasks, events, spawned, walks, cancelled, removedObjects, eliteKaramja = false;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Common = require('../plugins/minigames/tzhaarketrak/Common.TzHaarKetRak');
  Dialogue = require('../plugins/minigames/tzhaarketrak/Dialogue.TzHaarKetRak');
  Challenge = require('../plugins/minigames/tzhaarketrak/Challenge.TzHaarKetRak');
  Rewards = require('../plugins/minigames/tzhaarketrak/Rewards.TzHaarKetRak');
  // Completions and deaths reach the scoreboard's world records: keep them out of data/saves.
  Scoreboard = require('../plugins/minigames/tzhaarketrak/Scoreboard.TzHaarKetRak');
  Scoreboard._useFile(path.join(require('node:os').tmpdir(), `ket-rak-scoreboard-${process.pid}.json`));
  const api = new Proxy({
    core: {
      ...core,
      TaskManager: { submit: (task) => tasks.push(task), cancelTasks: (key) => cancelled.push(key) },
      ObjectManager: { deregister: (object) => removedObjects.push(object), register() {} },
      PathFinder: { calculateWalkRoute: (npc, x, y) => walks.push([npc, x, y]) },
      ItemOnGroundManager: { registerLocation: (player, item) => player.floor.push([item.getId(), item.getAmount()]) },
    },
    persistAttribute: () => {},
    emitCustomEvent(name, event) {
      events.push([name, event]);
      if (name === 'diary:tokkul' && eliteKaramja) event.amount *= 2;
    },
    spawnNpc: ({ id, x, y, face }) => {
      const npc = fakeNpc(id, x, y);
      npc.face = face;
      spawned.push(npc);
      return npc;
    },
    removeNpc: (npc) => { npc.registered = false; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Common.init(api);
  Dialogue.attach(api, { start: Challenge.start });
  Challenge.attach(api, { lastJadDown: Rewards.lastJadDown, completed: Rewards.completed, failed: Rewards.failed, refused: Rewards.refused });
});

beforeEach(() => {
  eliteKaramja = false;
  tasks = [];
  events = [];
  spawned = [];
  walks = [];
  cancelled = [];
  removedObjects = [];
});

const loc = (x, y) => new core.Location(x, y, 0);

let nextIndex = 1;
function fakeNpc(id, x, y) {
  const index = nextIndex++;
  const definition = core.NpcDefinition.forId(id);
  const npc = {
    id, hp: definition.getHitpoints(), registered: true, attackDelay: 0, target: null, heals: [], anims: [],
    getId: () => id,
    getIndex: () => index,
    setArea: () => {},
    isNpc: () => true,
    getAsNpc: () => npc,
    getLocation: () => loc(x, y),
    getSize: () => definition.getSize?.() ?? 1,
    getDefinition: () => definition,
    getHitpoints: () => npc.hp,
    setHitpoints: (hp) => { npc.hp = hp; },
    heal: (amount) => { npc.heals.push(amount); npc.hp += amount; },
    isRegistered: () => npc.registered,
    calculateDistance: () => npc.distance ?? 10,
    performAnimation: (a) => npc.anims.push(a.getId?.() ?? a),
    performGraphic: () => {},
    setMobileInteraction: () => {},
    getCombat: () => ({
      setAttackDelay: (t) => { npc.attackDelay = t; },
      attack: (t) => { npc.target = t; },
      getTarget: () => npc.fighting ?? npc.target,
    }),
  };
  return npc;
}

function fakePlayer({ levels = {}, zuk = false } = {}) {
  let tile = loc(2541, 5111);
  let area = null;
  const inventory = Array.from({ length: 28 }, () => null);
  const player = {
    messages: [], attributes: {}, varps: {}, varbits: {}, floor: [], interface: -1, scripts: [], fades: [], anims: [], facing: null,
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    isRegistered: () => true,
    isPlayer: () => true,
    getIndex: () => 1,
    getAsPlayer: () => player,
    isNpc: () => false,
    getArea: () => area,
    setArea: (a) => { area = a; },
    getPrivateArea: () => area,
    sendMessage: (m) => player.messages.push(m),
    getAttribute: (k) => player.attributes[k],
    setAttribute: (k, v) => { player.attributes[k] = v; },
    getSkillManager: () => ({ getMaxLevel: (skill) => levels[skill.getName()] ?? 1 }),
    getInterfaceId: () => player.interface,
    getPacketSender: () => ({
      sendConfig: (id, v) => { player.varps[id] = v; },
      sendVarbit: (id, v) => { player.varbits[id] = v; },
      sendInterfaceRemoval: () => { player.interface = -1; },
      sendInterface: (id) => { player.interface = id; },
      sendClientScript: (...args) => player.scripts.push(args),
      sendInterfaceFlagsRange: () => {},
      sendSubInterface: (uid, id, type, { postScripts } = {}) => { player.fades.push([id, postScripts?.[0]?.args]); },
      closeSubInterface: () => { player.fades.push('closed'); },
    }),
    setPositionToFace: (at) => { player.facing = at; },
    getMovementQueue: () => ({
      isMovementBlocked: () => player.blocked === true,
      setBlockMovement(value) { player.blocked = value; return this; },
      reset() { return this; },
    }),
    performAnimation: (a) => player.anims.push(a.getId()),
    getCombat: () => ({ reset() {} }),
    getHitpoints: () => player.hp ?? 99,
    isDyingReturn: () => player.dying === true,
    getInventory: () => ({
      getItems: () => inventory.map((item) => item ?? new core.Item(-1, 0)),
      contains: (id) => inventory.some((item) => item?.getId() === id),
      getFreeSlots: () => inventory.filter((item) => !item).length,
      adds: (id, amount) => {
        const at = inventory.findIndex((item) => item?.getId() === id);
        if (at >= 0) inventory[at] = new core.Item(id, inventory[at].getAmount() + amount);
        else inventory[inventory.indexOf(null)] = new core.Item(id, amount);
      },
      amount: (id) => inventory.filter((item) => item?.getId() === id).reduce((n, item) => n + item.getAmount(), 0),
    }),
    inventory,
  };
  if (zuk) player.attributes['inferno:completions'] = 1;
  return player;
}

function flush() {
  const due = tasks;
  tasks = [];
  for (const task of due) task.execute();
}

/** A challenge through its staged entry: landed, the screen back, the Jads come. */
function begin(player, number) {
  const challenge = Challenge.start(player, number);
  flush();
  return challenge;
}

const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];

/** Ticks a challenge on its own clock (cycle-free: the tick counter is faked through endAt). */
function tick(challenge, n = 1) {
  for (let i = 0; i < n; i++) challenge.tick();
}

const said = () => events.filter(([name]) => name === 'npc-dialogue:start').map(([, event]) => event.variant);
const caTasks = () => events.filter(([name]) => name === 'combat-achievements:complete').map(([, event]) => event.task);

function setCompleted(player, ...challenges) {
  for (const n of challenges) player.attributes[Common.completionsAttribute(n)] = 1;
}

test('every id resolves from the cache', () => {
  const { npcs, varbits, varps, locs, objs } = Common.ids;
  assert.deepEqual([npcs.master, npcs.masterTalk, npcs.masterChallenge, npcs.jad, npcs.healer], [10626, 10621, 10622, 10623, 10624]);
  assert.deepEqual([varbits.met, varbits.transmog], [11875, 11876]);
  assert.deepEqual([varps.c1, varps.c6], [2905, 2910]);
  assert.equal(locs.exit, 30283, "the Inferno arena's cave exit");
  assert.equal(objs.tokkul, core.ItemIdentifiers.TOKKUL);
  assert.equal(Common.ids.menu, 187);
  assert.deepEqual(Common.data.rewards, [80, 190, 480, 1190, 2970, 7430]);
});

test('the TzHaar name: the highest skill pair, ties going Mej, Ket, Xil, Hur; Kal once Zuk is beaten', () => {
  assert.equal(Common.caste(fakePlayer()), 'Mej', 'all equal: Mej first');
  assert.equal(Common.caste(fakePlayer({ levels: { Strength: 99, Defence: 99 } })), 'Ket');
  assert.equal(Common.caste(fakePlayer({ levels: { Attack: 99, Agility: 99, Strength: 99, Defence: 98 } })), 'Xil');
  assert.equal(Common.caste(fakePlayer({ levels: { Crafting: 60 } })), 'Hur');
  assert.equal(Common.caste(fakePlayer({ levels: { Crafting: 60, Magic: 60 } })), 'Mej');
  const definition = { getName: () => 'TzHaar-Ket-Rak' };
  const line = { player: fakePlayer({ levels: { Strength: 99, Defence: 99 } }), definition, text: 'JalYt-[caste]-Xo-[player name]. The challenge awaits.' };
  Dialogue.fillLine(line);
  assert.equal(line.text, 'JalYt-Ket-Xo-[player name]. The challenge awaits.');
  const kal = { player: fakePlayer({ zuk: true }), definition, text: 'JalYt-[caste]-Kal-[player name].' };
  Dialogue.fillLine(kal);
  assert.equal(kal.text, 'JalYt-Mej-Kal-[player name].');
});

test('the initial dialogue once; meeting him gives the Challenge option, and the six-challenge condition', () => {
  const player = fakePlayer();
  const definition = { getName: () => 'TzHaar-Ket-Rak' };
  assert.equal(Dialogue.chooseVariant({ player, definition }), 'initial-dialogue');
  assert.equal(player.varbits[Common.ids.varbits.met], 1);
  assert.equal(Dialogue.chooseVariant({ player, definition }), null, 'then the standard dialogue');
  assert.equal(Dialogue.chooseVariant({ player: fakePlayer(), definition: { getName: () => 'TzHaar-Ket-Keh' } }), null);
  const condition = (text) => Dialogue.answerCondition({ player, definition, text });
  assert.equal(condition('If the player has not completed all six challenges:'), true);
  setCompleted(player, 1, 2, 3, 4, 5, 6);
  assert.equal(condition('If the player has not completed all six challenges:'), false);
  assert.equal(condition('If the player has completed all six challenges:'), true);
});

test('"Challenge interface opens." opens the menu next tick; a pick starts that challenge', () => {
  const player = fakePlayer();
  const definition = { getName: () => 'TzHaar-Ket-Rak' };
  const event = { player, definition, stepId: '2zA7bO', handled: false };
  Dialogue.onAction(event);
  assert.equal(event.handled, true);
  assert.equal(event.end, true);
  flush();
  assert.equal(player.interface, Common.ids.menu);
  const [, , title, labels] = player.scripts.at(-1);
  assert.equal(title, 'Which challenge would you like?');
  assert.deepEqual(labels.split('|').slice(0, 2), ["TzHaar-Ket-Rak's First Challenge", "TzHaar-Ket-Rak's Second Challenge"]);
  assert.equal(labels.split('|').length, 7, 'six and Cancel');
  assert.equal(labels.split('|')[6], '(Cancel)', 'as recorded');
  const pick = { player, groupId: Common.ids.menu, childId: 3, slot: 0, handled: false };
  Dialogue.chooseOption(pick);
  assert.equal(pick.handled, true);
  const challenge = Challenge.challengeOf(player);
  assert.ok(challenge, 'the first challenge started');
  assert.equal(challenge.number, 1);
  Challenge.end(player);
});

test('the entry is staged: the line and the fade at the pick, landing at 3, the screen back at 6, the Jads at 18', () => {
  const player = fakePlayer();
  const challenge = Challenge.start(player, 1);
  assert.deepEqual(player.messages, ["You enter the Inferno for TzHaar-Ket-Rak's First Challenge."]);
  assert.deepEqual(player.fades, [[174, [0, 255, 0, 0, 50]]], 'fading out');
  assert.equal(player.blocked, true, 'held still through the fade');
  assert.equal(Challenge.start(player, 1), null, 'one at a time');
  assert.deepEqual(at(player), [2541, 5111], 'still outside');
  assert.equal(spawned.length, 0);
  assert.deepEqual([Common.data.arena.landTicks, Common.data.arena.fadeInTicks, Common.data.arena.jadTicks], [3, 6, 18]);
  const [land, fadeIn, close, jads] = tasks;
  tasks = [];
  land.execute();
  assert.deepEqual(at(player), [2271, 5344]);
  assert.equal(player.getArea(), challenge.area);
  assert.deepEqual([player.facing.getX(), player.facing.getY()], [2271, 5343], 'facing south');
  assert.deepEqual(player.anims, [4367]);
  fadeIn.execute();
  assert.deepEqual(player.fades.at(-1), [174, [0, 0, 0, 255, 50]]);
  assert.equal(player.blocked, false, 'free once the screen is back');
  close.execute();
  assert.equal(player.fades.at(-1), 'closed');
  tick(challenge);
  assert.equal(challenge.elapsedTicks(), 0, 'the clock waits for the Jads');
  jads.execute();
  assert.equal(spawned.length, 1);

  // Out before landing: no copy is entered later.
  const early = fakePlayer();
  Challenge.start(early, 1);
  Challenge.leaveWorld({ player: early });
  assert.equal(early.blocked, false, 'released on the way out');
  spawned = [];
  flush();
  assert.equal(early.getArea(), null);
  assert.equal(spawned.length, 0);
  Challenge.end(player);
});

test('the gates: the challenge before it first, then TzKal-Zuk for the third and up, with the Wiki lines', () => {
  const player = fakePlayer();
  assert.equal(Challenge.refusal(player, 1), null);
  assert.equal(Challenge.refusal(player, 2), 'needPrevious');
  setCompleted(player, 1);
  assert.equal(Challenge.refusal(player, 2), null, 'open to anyone in the inner city');
  setCompleted(player, 2);
  assert.equal(Challenge.refusal(player, 3), 'needZuk');
  player.attributes['inferno:completions'] = 1;
  assert.equal(Challenge.refusal(player, 3), null);
  assert.equal(Challenge.refusal(player, 5), 'needPrevious');

  const fresh = fakePlayer();
  assert.equal(Challenge.start(fresh, 2), null);
  assert.deepEqual(said(), [Dialogue.VARIANT.needPrevious]);
  const message = { player: fresh, definition: { getName: () => 'TzHaar-Ket-Rak' }, kind: 'message', stepId: Dialogue.STEP.needPrevious,
    text: "You need to complete TzHaar-Ket-Rak's [Previous number] Challenge before taking on TzHaar-Ket-Rak's [Number] Challenge." };
  Dialogue.onAction(message);
  assert.equal(message.text, "You need to complete TzHaar-Ket-Rak's First Challenge before taking on TzHaar-Ket-Rak's Second Challenge.");
  assert.deepEqual(message.box, { statement: true });
});

test("a challenge's Jads: as many as its number, on its recorded tiles and facing, first attacks staggered", () => {
  const player = fakePlayer();
  setCompleted(player, 1, 2, 3, 4, 5);
  player.attributes['inferno:completions'] = 1;
  const challenge = begin(player, 6);
  assert.equal(challenge.jads.length, 6);
  assert.ok(spawned.every((npc) => npc.getId() === Common.ids.npcs.jad && npc.target === player));
  assert.deepEqual(spawned.map((npc) => npc.attackDelay), [4, 7, 10, 13, 16, 19]);
  assert.deepEqual(spawned.map((npc) => [npc.getLocation().getX(), npc.getLocation().getY(), npc.face]), Common.data.arena.layouts[5]);
  assert.deepEqual(Common.data.arena.layouts.map((layout) => layout.length), [1, 2, 3, 4, 5, 6]);
  assert.ok(Common.inBox(player.getLocation(), [2257, 2285, 5329, 5358]), 'on the arena floor');
  for (const npc of spawned) {
    const at = npc.getLocation();
    assert.ok(at.getX() >= 2257 && at.getX() + 4 <= 2285 && at.getY() >= 5329 && at.getY() + 4 <= 5358, 'whole Jad on the floor');
  }
  // No two 5x5 Jads overlap.
  for (let a = 0; a < spawned.length; a++) for (let b = a + 1; b < spawned.length; b++) {
    const [p, q] = [spawned[a].getLocation(), spawned[b].getLocation()];
    assert.ok(Math.abs(p.getX() - q.getX()) >= 5 || Math.abs(p.getY() - q.getY()) >= 5);
  }
  Challenge.end(player);
});

test('Yt-HurKot: five at half health, once; they walk over and heal 15-24 every 4 ticks in reach', () => {
  const player = fakePlayer();
  const challenge = begin(player, 1);
  const jad = spawned[0];
  tick(challenge);
  assert.equal(spawned.length, 1, 'no healers above half');
  jad.hp = 175;
  tick(challenge);
  assert.equal(spawned.length, 6);
  const healers = spawned.slice(1);
  assert.ok(healers.every((npc) => npc.getId() === Common.ids.npcs.healer));
  assert.ok(walks.length >= 5, 'out of reach, they walk to it');
  healers.forEach((healer) => { healer.distance = 1; });
  const original = core.World.getProcessCycle;
  let cycle = 400;
  core.World.getProcessCycle = () => cycle;
  try {
    tick(challenge);
    assert.equal(jad.heals.length, 5);
    assert.ok(jad.heals.every((amount) => amount >= 15 && amount <= 24));
    cycle = 401;
    tick(challenge);
    assert.equal(jad.heals.length, 5, 'every 4 ticks');
    jad.hp = 350;
    cycle = 404;
    tick(challenge);
    assert.equal(jad.heals.length, 5, 'no healing at full');
    jad.hp = 100;
    healers.forEach((healer) => { healer.hp = 0; });
    cycle = 408;
    tick(challenge);
    assert.equal(spawned.length, 6, 'they do not come again');
  } finally {
    core.World.getProcessCycle = original;
  }
  jad.hp = 0;
  tick(challenge);
  assert.equal(challenge.jads.length, 0);
  Challenge.end(player);
});

test('killing every Jad completes it: the lines at once, then outside with the TokKul and his line', () => {
  const player = fakePlayer();
  const original = core.World.getProcessCycle;
  let cycle = 1000;
  core.World.getProcessCycle = () => cycle;
  let challenge;
  try {
    challenge = begin(player, 1);
    player.messages = [];
    spawned[0].hp = 0;
    cycle = 1074;
    tick(challenge);
    assert.ok(Challenge.challengeOf(player), 'a moment before leaving');
    assert.deepEqual(player.messages, [
      "Your completion count for TzHaar-Ket-Rak's First Challenge is: <col=ff0000>1</col>.",
      'Challenge duration: <col=ff0000>0:44.4</col> (new personal best)',
      "You've unlocked TzHaar-Ket-Rak's Second Challenge.",
    ]);
    assert.equal(Common.completions(player, 1), 1, 'counted as the last Jad falls');
    assert.equal(player.getInventory().amount(core.ItemIdentifiers.TOKKUL), 0, 'paid outside');
    cycle += Common.data.endTicks;
    tick(challenge);
  } finally {
    core.World.getProcessCycle = original;
  }
  assert.equal(Challenge.challengeOf(player), null);
  assert.deepEqual(said(), [], 'he speaks the tick after');
  flush();
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], Common.data.outside);
  assert.equal(player.getInventory().amount(core.ItemIdentifiers.TOKKUL), 80);
  assert.equal(Common.completions(player, 1), 1);
  assert.equal(player.varps[Common.ids.varps.c1], 1);
  assert.deepEqual(said(), [Dialogue.VARIANT.completed]);
  const message = { player, definition: { getName: () => 'TzHaar-Ket-Rak' }, kind: 'message', stepId: Dialogue.STEP.reward, text: 'TzHaar-Ket-Rak has rewarded you with [number] TokKul.' };
  Dialogue.onAction(message);
  assert.equal(message.text, 'TzHaar-Ket-Rak has rewarded you with 80 TokKul.');
  assert.deepEqual(message.box, { items: [core.ItemIdentifiers.TOKKUL] });
  assert.ok(!events.some(([name]) => name === 'combat-achievements:kill'), 'no count: its kill-count tasks would each read as once');
  assert.deepEqual(caTasks(), ["TzHaar-Ket-Rak's Speed-Trialist"], '44.4 s');
  challenge.tick();
  assert.equal(player.getInventory().amount(core.ItemIdentifiers.TOKKUL), 80, 'paid once');
  const definition = { getName: () => 'TzHaar-Ket-Rak' };
  const line = { player, definition, text: 'Challenge complete. Have some TokKul. Now, a new challenge awaits.' };
  Dialogue.fillLine(line);
  assert.equal(line.text, 'Challenge complete. Have some TokKul. Now, a new challenge awaits.', 'the Second just unlocked');

  // Again, slower: no unlock line, the best kept, and no new challenge in his line.
  events = [];
  const again = begin(player, 1);
  player.messages = [];
  spawned.at(-1).hp = 0;
  again.startTick -= 100;
  tick(again);
  assert.deepEqual(player.messages, [
    "Your completion count for TzHaar-Ket-Rak's First Challenge is: <col=ff0000>2</col>.",
    'Challenge duration: <col=ff0000>1:00.0</col>. Personal best: <col=ff0000>0:44.4</col>',
  ]);
  again.endAt = 0;
  tick(again);
  flush();
  const plain = { player, definition, text: 'Challenge complete. Have some TokKul. Now, a new challenge awaits.' };
  Dialogue.fillLine(plain);
  assert.equal(plain.text, 'Challenge complete. Have some TokKul.');
});

test('the second completed the first time without TzKal-Zuk: the Inferno is needed for the third', () => {
  const player = fakePlayer();
  setCompleted(player, 1);
  const challenge = begin(player, 2);
  player.messages = [];
  spawned.forEach((npc) => { npc.hp = 0; });
  tick(challenge);
  assert.equal(player.messages.at(-1), "You need to complete the Inferno to unlock TzHaar-Ket-Rak's Third Challenge.");
  Challenge.end(player);
});

test('the first sixth unlocks the JalRek-Jad metamorphosis; later sixths only pay', () => {
  const player = fakePlayer({ zuk: true });
  setCompleted(player, 1, 2, 3, 4, 5);
  const finish = () => {
    const challenge = begin(player, 6);
    challenge.jads.forEach((entry) => { entry.npc.hp = 0; });
    tick(challenge);
    challenge.endAt = 0;
    tick(challenge);
    flush();
  };
  finish();
  assert.equal(player.attributes[Common.PET_UNLOCK_ATTRIBUTE], true);
  assert.equal(player.varbits[Common.ids.varbits.transmog], 1);
  assert.deepEqual(said(), [Dialogue.VARIANT.sixthFirst]);
  events = [];
  finish();
  assert.deepEqual(said(), [Dialogue.VARIANT.sixthAgain]);
  assert.equal(player.getInventory().amount(core.ItemIdentifiers.TOKKUL), 7430 * 2);
});

test('the Elite Karamja Diary doubles the TokKul of a completed challenge', () => {
  eliteKaramja = true;
  const player = fakePlayer();
  const original = core.World.getProcessCycle;
  let cycle = 1000;
  core.World.getProcessCycle = () => cycle;
  try {
    const challenge = begin(player, 1);
    spawned[0].hp = 0;
    cycle = 1074;
    tick(challenge);
    cycle += Common.data.endTicks;
    tick(challenge);
  } finally {
    core.World.getProcessCycle = original;
  }
  flush();
  assert.equal(player.getInventory().amount(core.ItemIdentifiers.TOKKUL), 160);
});

test('a full inventory gets its TokKul on the floor, never lost', () => {
  const player = fakePlayer();
  for (let i = 0; i < 28; i++) player.inventory[i] = new core.Item(core.ItemIdentifiers.SHARK, 1);
  Rewards.give(player, core.ItemIdentifiers.TOKKUL, 80);
  assert.deepEqual(player.floor, [[core.ItemIdentifiers.TOKKUL, 80]]);
});

test('dying, the cave exit and logging out fail it: nothing lost, the copy gone, outside', () => {
  const player = fakePlayer();
  Challenge.start(player, 1);
  const keep = { player, shouldDrop: true };
  Challenge.keepItems(keep);
  assert.equal(keep.shouldDrop, false, 'a safe activity');
  const teleport = { player, allow: true };
  Challenge.noTeleport(teleport);
  assert.equal(teleport.allow, false);
  flush();
  player.messages = [];
  const deathsBefore = Scoreboard.worldRecords().deaths[1];
  const before = { player, preventDeath: false, announce: true };
  Challenge.defeatedLine(before);
  assert.equal(before.message, 'You have been defeated!', 'not "Oh dear, you are dead!" (rsprox 227/04308, 237/01141)');
  const death = { player, handled: false };
  Challenge.onDeath(death);
  assert.equal(death.handled, true);
  assert.equal(Scoreboard.worldRecords().deaths[1], deathsBefore + 1, 'a death in the challenge reaches the scoreboard');
  assert.equal(Challenge.challengeOf(player), null);
  assert.match(player.messages.at(-1), /^You survived for <col=ff0000>\d:\d\d\.\d<\/col> but failed to kill JalTok-Jad before perishing\.$/);
  assert.deepEqual(player.fades.at(-1), 'closed');
  assert.ok(spawned.every((npc) => !npc.registered || npc.getId() !== Common.ids.npcs.healer));
  assert.deepEqual(said(), [Dialogue.VARIANT.failed]);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], Common.data.outside);

  events = [];
  begin(player, 1);
  assert.equal(Challenge.exitCave({ player }), true);
  assert.deepEqual(said(), [Dialogue.VARIANT.failed]);
  assert.match(player.messages.at(-1), /but failed to kill JalTok-Jad\.$/, 'the exit: no perishing');
  assert.equal(Challenge.exitCave({ player }), false, "outside a challenge it is the Inferno's exit");

  events = [];
  Challenge.start(player, 1);
  Challenge.leaveWorld({ player });
  assert.equal(Challenge.challengeOf(player), null);
  assert.equal(Scoreboard.worldRecords().deaths[1], deathsBefore + 1, 'the cave exit and logging out are not deaths');
  assert.deepEqual(said(), [], 'no line to a player logging out');
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], Common.data.outside, 'saved outside');
  const keepOutside = { player, shouldDrop: true };
  Challenge.keepItems(keepOutside);
  assert.equal(keepOutside.shouldDrop, true);
  Challenge.start(player, 1);
  Challenge.onDeath({ player, handled: false }); // in the fade in, before the Jads arrive
  assert.equal(Scoreboard.worldRecords().deaths[1], deathsBefore + 1, 'a death before the Jads arrive is not counted');
});

test('a failure with kills: how many fell, and the TokKul of the challenge with that many Jads', () => {
  const player = fakePlayer({ zuk: true });
  setCompleted(player, 1, 2, 3);
  const challenge = begin(player, 4);
  spawned[0].hp = 0;
  spawned[1].hp = 0;
  tick(challenge);
  player.messages = [];
  Challenge.onDeath({ player, handled: false });
  assert.match(player.messages.at(-1), /^You survived for <col=ff0000>[\d:.]+<\/col> and killed two JalTok-Jads before perishing\.$/);
  assert.equal(player.getInventory().amount(core.ItemIdentifiers.TOKKUL), 190);
  assert.deepEqual(said(), [Dialogue.VARIANT.completed], 'the reward line');
  const line = { player, definition: { getName: () => 'TzHaar-Ket-Rak' }, text: 'Challenge complete. Have some TokKul. Now, a new challenge awaits.' };
  Dialogue.fillLine(line);
  assert.equal(line.text, 'Not bad for a JalYt. Have some TokKul.');
  const reward = { player, definition: { getName: () => 'TzHaar-Ket-Rak' }, kind: 'message', stepId: Dialogue.STEP.reward, text: 'TzHaar-Ket-Rak has rewarded you with [number] TokKul.' };
  Dialogue.onAction(reward);
  assert.equal(reward.text, 'TzHaar-Ket-Rak has rewarded you with 190 TokKul.');
  assert.equal(Common.completions(player, 4), 0, 'not a completion');

  // One kill, by logging out: the TokKul still, no line.
  events = [];
  const one = begin(player, 2);
  spawned.at(-1).hp = 0;
  tick(one);
  Challenge.leaveWorld({ player });
  assert.equal(player.getInventory().amount(core.ItemIdentifiers.TOKKUL), 190 + 80);
  assert.match(player.messages.at(-1), /and killed one JalTok-Jad\.$/);
  assert.deepEqual(said(), []);
});

test('Combat Achievements: kill counts, speed, melee only, empty inventory, one style a Jad, back to back', () => {
  const player = fakePlayer({ zuk: true });
  const make = (number, elapsedTicks) => {
    const challenge = new Challenge.Challenge(player, number);
    challenge.elapsedTicks = () => elapsedTicks;
    challenge.destroy();
    return challenge;
  };
  assert.deepEqual(Rewards.tasksFor(player, make(1, 74)), ["TzHaar-Ket-Rak's Speed-Trialist"], '44.4 s');
  assert.deepEqual(Rewards.tasksFor(player, make(1, 75)), [], '45 s is not less than 45');

  const second = make(2, 999);
  assert.deepEqual(Rewards.tasksFor(player, second), ['The II Jad Challenge', 'Facing Jad Head-on III']);
  second.nonMelee = true;
  assert.deepEqual(Rewards.tasksFor(player, second), ['The II Jad Challenge']);

  const third = make(3, 299);
  third.nonMelee = true;
  const jads = [{}, {}, {}];
  ['MELEE', 'RANGED', 'MAGIC'].forEach((style, i) => third.styles.set(jads[i], new Set([style])));
  assert.deepEqual(Rewards.tasksFor(player, third).sort(), ["Multi-Style Specialist", "Supplies? Who Needs 'em?", "TzHaar-Ket-Rak's Speed-Chaser"].sort());
  third.styles.get(jads[0]).add('RANGED');
  third.emptyInventory = false;
  assert.deepEqual(Rewards.tasksFor(player, third), ["TzHaar-Ket-Rak's Speed-Chaser"]);

  const sixth = make(6, 9999);
  sixth.nonMelee = true;
  player.attributes[Common.LAST_COMPLETED_ATTRIBUTE] = 5;
  assert.deepEqual(Rewards.tasksFor(player, sixth), ['The VI Jad Challenge', "It Wasn't a Fluke"]);
  Rewards.failed(player, sixth, { logout: true });
  assert.deepEqual(Rewards.tasksFor(player, sixth), ['The VI Jad Challenge'], 'a failure in between breaks it');
});

test('damage dealt is recorded by style, per Jad; an item picked up spoils the empty inventory', () => {
  const player = fakePlayer();
  const challenge = begin(player, 1);
  const jad = spawned[0];
  Challenge.dealt({ player, target: jad, hit: { getCombatType: () => core.CombatType.MELEE } });
  assert.equal(challenge.nonMelee, false);
  Challenge.dealt({ player, target: jad, hit: { getCombatType: () => core.CombatType.MAGIC } });
  assert.equal(challenge.nonMelee, true);
  assert.deepEqual([...challenge.styles.get(jad)], ['MELEE', 'MAGIC']);
  tick(challenge);
  assert.equal(challenge.emptyInventory, true);
  player.inventory[0] = new core.Item(core.ItemIdentifiers.SHARK, 1);
  tick(challenge);
  assert.equal(challenge.emptyInventory, false);
  Challenge.end(player);
});

test("the copy has no rocky supports, and leaving cancels every Jad's hits still in flight", () => {
  const player = fakePlayer();
  begin(player, 1);
  assert.deepEqual(removedObjects.map((object) => object.getId()).sort(), [30353, 30354, 30355]);
  const jad = spawned[0];
  Challenge.exitCave({ player });
  assert.ok(cancelled.includes(jad), 'its pending hit tasks are stopped');
});

test('dying to a last hit after every Jad is down still completes it; while dying it waits', () => {
  const player = fakePlayer();
  const challenge = begin(player, 1);
  spawned[0].hp = 0;
  tick(challenge);
  challenge.endAt = 0;
  player.dying = true;
  tick(challenge);
  assert.ok(Challenge.challengeOf(player), 'not completed during the death animation');
  const deathsBefore = Scoreboard.worldRecords().deaths[1];
  const completionsBefore = Scoreboard.worldRecords().completions[1];
  const death = { player, handled: false };
  Challenge.onDeath(death);
  assert.equal(death.handled, true, 'nothing lost, not the default respawn');
  assert.equal(Common.completions(player, 1), 1);
  assert.equal(Scoreboard.worldRecords().deaths[1], deathsBefore, 'a death after the last Jad is not a scoreboard death');
  assert.equal(Scoreboard.worldRecords().completions[1], completionsBefore, 'its completion was counted when the last Jad fell');
  flush();
  assert.deepEqual(said(), [Dialogue.VARIANT.completed]);
});
