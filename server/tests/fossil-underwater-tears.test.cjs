// Run after `yarn build`: node --test tests/fossil-underwater-tears.test.cjs
// Underwater Agility and Thieving (FossilIslandUnderwater's Tears and Training units) against rsprox
// 231/00712-00715 and 234/03273, 03299: the open chest or clam, its hint arrow, searches, nibbles,
// pufferfish, and Mairin's exchanges.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

const DATA = require("../plugins/areas/data/fossil-island-underwater.json");
const Tears = require("../plugins/areas/fossilislandunderwater/Tears.FossilIslandUnderwater");
const Training = require("../plugins/areas/fossilislandunderwater/Training.FossilIslandUnderwater");

const TEAR = 22207;
const MERMAID = 21656;
const PUFFER = 21655;
const hooks = { firstClick: new Map(), items: {}, npcs: {}, buttons: new Map() };
const registered = [];
const deregistered = [];
const later = [];
let core;

before(async () => {
  await CachePipeline.initialize();
  const real = PluginManager.getCoreApi();
  core = {
    ...real,
    ObjectManager: {
      register: (object) => registered.push(object),
      deregister: (object, playerUpdate) => deregistered.push({ object, playerUpdate }),
    },
  };
  const api = {
    core,
    onObjectFirstClick: (ids, fn) => ids.forEach((id) => hooks.firstClick.set(id, fn)),
    onItemAction: (name, actions) => { hooks.items[name] = actions; },
    onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
    onInterfaceActionButton: (ids, fn) => ids.forEach((id) => hooks.buttons.set(id, fn)),
  };
  const shared = {
    isDiving: (player) => player.diving,
    changeOxygen: (player, change) => { player.oxygen = Math.max(0, Math.min(1000, player.oxygen + change)); },
    later: (ticks, action) => later.push(action),
  };
  Tears.attach(api, shared, DATA.tears);
  Training.attach(api, DATA.training);
});

function createPlayer({ x = 3732, y = 10281, z = 1, thieving = 99, agility = 99, items = {} } = {}) {
  let location = new core.Location(x, y, z);
  const held = new Map(Object.entries(items).map(([id, n]) => [Number(id), n]));
  const state = { messages: [], spam: [], anims: [], sounds: [], varbits: [], varps: new Map(), hints: [], objects: [], xp: { agility: 0, thieving: 0 }, dialogues: 0, interfaces: [], prompts: [] };
  const player = {
    state, diving: true, oxygen: 1000,
    getLocation: () => location,
    setLocation: (next) => { location = next; },
    isRegistered: () => true,
    sendMessage: (m) => state.messages.push(m),
    performAnimation: (a) => state.anims.push(a.getId()),
    getDialogueManager: () => ({ startDialogues: () => { state.dialogues++; } }),
    setEnteredAmountAction: (action) => { state.amountAction = action; },
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === core.Skill.THIEVING ? thieving : agility),
      getMaxLevel: (skill) => (skill === core.Skill.THIEVING ? thieving : agility),
      addExperiences: (skill, amount) => { state.xp[skill === core.Skill.THIEVING ? "thieving" : "agility"] += amount; },
    }),
    getInventory: () => ({
      getAmount: (id) => held.get(id) ?? 0,
      adds: (id, n) => held.set(id, (held.get(id) ?? 0) + n),
      delete: (id, n) => held.set(id, (held.get(id) ?? 0) - n),
      getAddableAmount: () => (state.full ? 0 : 1),
    }),
    getPacketSender: () => ({
      sendVarbit: (id, v) => state.varbits.push([id, v]),
      sendConfig: (id, v) => state.varps.set(id, v),
      clearHintArrow: () => state.hints.push("reset"),
      sendPositionalHint: (loc, edge, height, plane) => state.hints.push([loc.getX(), loc.getY(), edge, height, plane]),
      sendObject: (object) => state.objects.push([object.getId(), object.getLocation().getX(), object.getLocation().getY()]),
      sendSoundEffect: (id) => state.sounds.push(id),
      sendTypedMessage: (type, m) => state.spam.push(m),
      sendInterface: (id) => state.interfaces.push(id),
      sendEnterAmountPrompt: (title) => state.prompts.push(title),
    }),
  };
  player.held = held;
  return player;
}

function runLater() {
  for (const action of later.splice(0)) action();
}

/** A diving player with the chest at 3804,10265 open (the captures' 234/03273 tick 9192). */
function withOpenChest(options) {
  const player = createPlayer(options);
  const random = Math.random;
  const index = DATA.tears.spots.findIndex(([kind, x, y]) => kind === "chest" && x === 3804 && y === 10265);
  Math.random = () => index / DATA.tears.spots.length + 1e-6;
  try {
    Tears.enter(player);
  } finally {
    Math.random = random;
  }
  return player;
}

function searchChest(player) {
  return hooks.firstClick.get(core.ObjectIdentifiers.CHEST_107)({ player, location: { x: 3804, y: 10265, z: 1 } });
}

test("the spots are the cache's 54 sea-floor chests and clams", () => {
  assert.equal(DATA.tears.spots.length, 54);
  assert.ok(DATA.tears.spots.every(([kind, , , z]) => (kind === "chest" || kind === "clam") && z === 1));
});

test("diving opens one chest or clam for the player, with the hint arrow on its west side", () => {
  registered.length = 0;
  const player = withOpenChest();
  assert.equal(registered.length, 1);
  const [object] = registered;
  assert.equal(object.getId(), core.ObjectIdentifiers.CHEST_107);
  assert.equal(object.getOwner(), player, "the player's own");
  assert.deepEqual([object.getLocation().getX(), object.getLocation().getY()], [3804, 10265]);
  assert.deepEqual(player.state.varbits, [[14192, 0], [14192, 6]]);
  assert.deepEqual(player.state.hints, ["reset", [3804, 10265, 3, 128, 1]]);
  Tears.leave(player);
});

test("it is open 100 ticks, then the closed loc is back; 3 ticks on another opens; the arrow is sent every 3 ticks", () => {
  registered.length = 0;
  deregistered.length = 0;
  const player = withOpenChest();
  for (let i = 0; i < 99; i++) Tears.tick(player);
  assert.equal(deregistered.length, 0);
  assert.equal(player.state.hints.filter((hint) => hint !== "reset").length, 1 + 33, "sent again every 3 ticks");
  Tears.tick(player);
  assert.equal(deregistered.length, 1, "closed on tick 100");
  assert.equal(deregistered[0].playerUpdate, true, "a despawn, so it leaves MapObjects and isn't clicked or re-sent later");
  assert.deepEqual(player.state.objects, [[core.ObjectIdentifiers.CHEST_108, 3804, 10265]]);
  Tears.tick(player);
  Tears.tick(player);
  assert.equal(registered.length, 1);
  Tears.tick(player);
  assert.equal(registered.length, 2, "the next opens 3 ticks after");
  Tears.leave(player);
});

test("coming next to it the first time on a dive: the found line and Mairin's", () => {
  const player = withOpenChest();
  Tears.tick(player);
  assert.equal(player.state.dialogues, 0, "not near it yet");
  player.setLocation(new core.Location(3805, 10265, 1));
  Tears.tick(player);
  assert.deepEqual(player.state.messages, ["You have successfully found an open chest; the mermaids will reward you from now on."]);
  assert.equal(player.state.dialogues, 1);
  Tears.tick(player);
  assert.equal(player.state.dialogues, 1, "once a dive");
  Tears.leave(player);
});

test("a search: human_swim_steal, then a tick later the success, a glistening and a mermaid's tear and 4.5 XP each; the first always succeeds", () => {
  const player = withOpenChest();
  player.setLocation(new core.Location(3805, 10265, 1));
  Tears.tick(player);
  const random = Math.random;
  Math.random = () => 0.999;
  try {
    assert.equal(searchChest(player), true);
    assert.deepEqual(player.state.anims, [7707]);
    assert.equal(player.held.get(TEAR) ?? 0, 0);
    runLater();
  } finally {
    Math.random = random;
  }
  assert.deepEqual(player.state.anims, [7707, 7709]);
  assert.deepEqual(player.state.sounds, [73]);
  assert.equal(player.held.get(TEAR), 1);
  assert.equal(player.held.get(MERMAID), 1);
  assert.deepEqual(player.state.xp, { agility: 4.5, thieving: 4.5 });
  Tears.leave(player);
});

test("later searches roll Thieving's 30/40 chance; a miss is a nibble, sometimes costing 2% oxygen", () => {
  const player = withOpenChest();
  player.setLocation(new core.Location(3805, 10265, 1));
  Tears.tick(player);
  searchChest(player);
  runLater();
  const random = Math.random;
  try {
    Math.random = () => 0.5;
    searchChest(player);
    runLater();
    assert.deepEqual(player.state.spam, ["You jerk back as something nibbles your hand."]);
    assert.equal(player.oxygen, 1000);
    Math.random = () => 0.1;
    searchChest(player);
    runLater();
    assert.equal(player.held.get(TEAR), 2, "0.1 is under the 16% at Thieving 99");
    const rolls = [0.99, 0.2];
    Math.random = () => rolls.shift() ?? 0.2;
    searchChest(player);
    runLater();
    assert.equal(player.state.spam.at(-1), "You jerk back as something nibbles your hand and lose some breath.");
    assert.equal(player.oxygen, 980);
  } finally {
    Math.random = random;
  }
  assert.equal(Tears._test.chance(30, 40, 1), 31 / 256);
  assert.equal(Tears._test.chance(30, 40, 99), 41 / 256);
  Tears.leave(player);
});

test("searching what isn't open, or with no room, gives the captured lines and no search", () => {
  const player = withOpenChest();
  const clam = hooks.firstClick.get(core.ObjectIdentifiers.CLAM_2);
  assert.equal(clam({ player, location: { x: 3777, y: 10242, z: 1 } }), true);
  assert.deepEqual(player.state.messages, ["You'll have to wait for the next chest or clam to open."]);
  player.state.full = true;
  player.state.messages.length = 0;
  searchChest(player);
  assert.deepEqual(player.state.messages, ["You don't have enough inventory space."]);
  assert.deepEqual(player.state.anims, []);
  Tears.leave(player);
  player.diving = false;
  assert.equal(searchChest(player), false, "not diving: not ours");
});

test("Puff, underwater: the pufferfish goes and 15% oxygen comes back", () => {
  const player = createPlayer({ items: { [PUFFER]: 2 } });
  player.oxygen = 480;
  assert.equal(hooks.items.Pufferfish.Puff({ player }), true);
  assert.equal(player.oxygen, 630);
  assert.equal(player.held.get(PUFFER), 1);
  assert.deepEqual(player.state.anims, [7701]);
  assert.deepEqual(player.state.messages, ["You depuff the pufferfish, restoring some of your puff."]);
  player.diving = false;
  assert.equal(hooks.items.Pufferfish.Puff({ player }), false);
});

test("Mairin's Training sets the four rates and opens 287 (234/03273: 264, 970, 176, 646 at 99)", () => {
  const player = createPlayer();
  hooks.npcs.Mairin.Training({ player });
  assert.deepEqual([...player.state.varps], [[261, 264], [262, 970], [263, 176], [264, 646]]);
  assert.deepEqual(player.state.interfaces, [287]);
});

test("exchanges pay as every captured one did", () => {
  const cases = [
    ["agility", 251, 83, 99, "Mairin trains you in Agility, exchanging 251 glistening tears for 46,686 Agility XP."],
    ["agility", 220, 85, 99, "Mairin trains you in Agility, exchanging 220 glistening tears for 42,900 Agility XP."],
    ["agility", 458, 87, 99, "Mairin trains you in Agility, exchanging 458 glistening tears for 93,569 Agility XP."],
    ["agility", 310, 90, 99, "Mairin trains you in Agility, exchanging 310 glistening tears for 67,797 Agility XP."],
    ["agility", 1, 99, 99, "Mairin trains you in Agility, exchanging one glistening tear for 264 Agility XP."],
    ["thieving", 1, 99, 99, "Mairin trains you in Thieving, exchanging one glistening tear for 970 Thieving XP."],
    ["both", 3, 99, 99, "Mairin trains you in Agility and Thieving, exchanging 3 glistening tears for 529 Agility XP and 1,940 Thieving XP."],
    ["both", 83, 62, 80, "Mairin trains you in Agility and Thieving, exchanging 83 glistening tears for 5,735 Agility XP and 35,059 Thieving XP."],
  ];
  for (const [row, count, agility, thieving, message] of cases) {
    const player = createPlayer({ agility, thieving, items: { [TEAR]: count } });
    Training._test.exchange(player, row, count);
    assert.deepEqual(player.state.messages, [message]);
    assert.equal(player.held.get(TEAR), 0);
  }
});

test("the rows' Exchange-1, -5, -X and -All; none carried", () => {
  const button = (child) => hooks.buttons.get((287 << 16) | child);
  const player = createPlayer({ items: { [TEAR]: 28 } });
  button(3)({ player, childId: 3, opId: 2 });
  assert.equal(player.held.get(TEAR), 23);
  button(5)({ player, childId: 5, opId: 3 });
  assert.deepEqual(player.state.prompts, ["How many glistening tears do you wish to exchange? (23)"]);
  player.state.amountAction.execute(3);
  assert.equal(player.held.get(TEAR), 20);
  button(7)({ player, childId: 7, opId: 4 });
  assert.equal(player.held.get(TEAR), 0);
  player.state.messages.length = 0;
  button(3)({ player, childId: 3, opId: 1 });
  assert.deepEqual(player.state.messages, ["You don't have any glistening tears to exchange."]);
});

test("Wiki: one exchange takes at most 700 tears, and Mairin takes the rest of an Exchange-All", () => {
  const player = createPlayer({ items: { [TEAR]: 750 } });
  Training._test.exchange(player, "agility", Number.MAX_SAFE_INTEGER);
  assert.equal(player.state.messages[0], "Mairin trains you in Agility, exchanging 700 glistening tears for 185,220 Agility XP.");
  assert.equal(player.state.messages[1], "Mairin confiscared a further 50 tears; she did not approve of how many you had.");
  assert.equal(player.held.get(TEAR), 0);
});
