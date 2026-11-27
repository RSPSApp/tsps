// Run after `yarn build`: node --test tests/kalphite-cave.test.cjs
// The Kalphite Cave (docs/kalphite-cave.md): multi-combat, kalphites task-only behind Buggie.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

const KalphiteCave = require("../plugins/areas/KalphiteCave.plugin");
const SPAWNS = require("../data/definitions/npc-spawns.json");
const DIALOGUES = require("../data/definitions/npc-dialogues.json");
const TELEPORTS = require("../plugins/world/data/loc-teleports.json");

const T = KalphiteCave._test;
let core;
let area;
const dialogues = [];
const npcActions = new Map();
const boxes = [];
const loginHandlers = [];
const persisted = new Map();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const api = {
    core: {
      ...core,
      DialogueChainBuilder: class { constructor() { this.entries = []; } add(entry) { this.entries.push(entry); return this; } },
      ItemStatementDialogue: class { constructor(_line, item, text) { this.item = item; this.text = text; } },
    },
    emitCustomEvent: (name, payload) => {
      if (name === "slayer:on-task") payload.onTask = payload.player.onTask === true;
      if (name === "npc-dialogue:start") dialogues.push(payload);
    },
    registerArea: (registered) => { area = registered; },
    onNpcInteraction: (name, actions) => npcActions.set(name, actions),
    persistAttribute: (key, value) => persisted.set(key, value),
    onPlayerLogin: (handler) => loginHandlers.push(handler),
  };
  KalphiteCave.register(api);
});

function fakePlayer({ onTask = false, retaliating = false, target = null, amulet = -1, legs = -1 } = {}) {
  const equipment = new core.Equipment();
  equipment.set(core.Equipment.AMULET_SLOT, new core.Item(amulet));
  equipment.set(core.Equipment.LEG_SLOT, new core.Item(legs));
  const player = {
    onTask,
    target,
    messages: [],
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => player,
    sendMessage: (text) => player.messages.push(text),
    getCombat: () => ({ isAutoRetaliating: () => retaliating, getTarget: () => player.target ?? null }),
    getEquipment: () => equipment,
  };
  return player;
}

function fakeNpc(id) {
  return { id, isPlayer: () => false, isNpc: () => true, getId: () => id };
}

const inside = (x, y, z = 0) => area.getBoundaries().some((b) => b.inside(new core.Location(x, y, z)));

test("the cave is a multi-combat Area holding every cave kalphite and nothing of its neighbours", () => {
  const spawns = SPAWNS.spawns ?? SPAWNS;
  const kalphites = spawns.filter((spawn) => [956, 958, 960].includes(spawn.id));
  assert.equal(kalphites.length, 43, "Wiki: 18 workers, 20 soldiers, 5 guardians");
  for (const spawn of kalphites) assert.ok(inside(spawn.x, spawn.y, spawn.level), `${spawn.name} at ${spawn.x},${spawn.y}`);
  assert.ok(inside(3305, 9497), "the entrance's landing (rsprox 2922)");
  assert.ok(inside(3307, 9506), "Buggie");
  for (const spawn of spawns.filter((s) => /slave|Guard$/.test(s.name ?? "") && s.x >= 3260 && s.x <= 3330 && s.y >= 9440 && s.y <= 9470)) {
    assert.equal(inside(spawn.x, spawn.y, spawn.level), false, `the Desert Mining Camp's ${spawn.name} at ${spawn.x},${spawn.y}`);
  }
  assert.equal(inside(3347, 9533), false, "the Elid cave exit");
  assert.equal(inside(3305, 9497, 2), false, "plane 0 only");
  assert.equal(area.isMulti(), true);
});

test("an attack without a task is refused with Buggie's message and line", () => {
  for (const id of [956, 958, 960]) {
    dialogues.length = 0;
    const npc = fakeNpc(id);
    const player = fakePlayer({ target: npc });
    assert.equal(area.canAttack(player, npc), false, `npc ${id}`);
    assert.deepEqual(player.messages, ["Buggie wants you to stick to your Slayer assignments."]);
    assert.equal(dialogues.length, 1);
    assert.equal(dialogues[0].npcId, core.NpcIdentifiers.ENTOMOLOGIST);
    assert.equal(dialogues[0].variant, T.BUGGIE_VARIANTS.ghostly);
    assert.equal(dialogues[0].exact, true);
  }
});

test("Buggie is understood with a ghostspeak amulet on (Transcript:Entomologist)", () => {
  for (const amulet of [core.ItemIdentifiers.GHOSTSPEAK_AMULET, core.ItemIdentifiers.GHOSTSPEAK_AMULET_2]) {
    dialogues.length = 0;
    const npc = fakeNpc(958);
    area.canAttack(fakePlayer({ target: npc, amulet }), npc);
    assert.equal(dialogues[0].variant, T.BUGGIE_VARIANTS.understood);
  }
});

test("worn Morytania legs 2-4 replace ghostspeak without granting attack permission", () => {
  for (const legs of [core.ItemIdentifiers.MORYTANIA_LEGS_2, core.ItemIdentifiers.MORYTANIA_LEGS_3, core.ItemIdentifiers.MORYTANIA_LEGS_4]) {
    dialogues.length = 0;
    const npc = fakeNpc(958);
    const player = fakePlayer({ target: npc, legs });
    assert.equal(area.canAttack(player, npc), false);
    assert.equal(dialogues[0].variant, T.BUGGIE_VARIANTS.understood);
    assert.deepEqual(player.messages, [T.BUGGIE_MESSAGE]);
    const tasked = fakePlayer({ onTask: true, target: npc, legs });
    assert.equal(area.canAttack(tasked, npc), null);
    assert.deepEqual(tasked.messages, []);
  }
});

test("legs 1 and merely carrying ghostspeak equipment leave Buggie ghostly", () => {
  for (const legs of [-1, core.ItemIdentifiers.MORYTANIA_LEGS_1]) {
    dialogues.length = 0;
    const npc = fakeNpc(956);
    const player = fakePlayer({ target: npc, legs });
    const inventory = new core.Inventory();
    inventory.setItem(0, new core.Item(core.ItemIdentifiers.MORYTANIA_LEGS_4));
    inventory.setItem(1, new core.Item(core.ItemIdentifiers.GHOSTSPEAK_AMULET));
    player.getInventory = () => inventory;
    assert.equal(area.canAttack(player, npc), false);
    assert.equal(dialogues[0].variant, T.BUGGIE_VARIANTS.ghostly);
  }
});

test("both of Buggie's variants are in the generated transcript", () => {
  const page = DIALOGUES.Entomologist?.variants ?? {};
  assert.equal(page[T.BUGGIE_VARIANTS.understood]?.[0]?.text, "I didn't... create this cave for... you to do that... sorry, it's not for you.");
  assert.equal(page[T.BUGGIE_VARIANTS.ghostly]?.[0]?.text, "wooooo ooo woo-woo");
});

test("a player on a kalphite task is left alone", () => {
  const npc = fakeNpc(956);
  const player = fakePlayer({ onTask: true, target: npc });
  dialogues.length = 0;
  assert.equal(area.canAttack(player, npc), null);
  assert.deepEqual(player.messages, []);
  assert.equal(dialogues.length, 0);
});

test("auto-retaliation and permission probes are refused silently", () => {
  const npc = fakeNpc(958);
  dialogues.length = 0;
  for (const player of [fakePlayer({ retaliating: true, target: npc }), fakePlayer(), fakePlayer({ target: fakeNpc(956) })]) {
    assert.equal(area.canAttack(player, npc), false);
    assert.deepEqual(player.messages, []);
  }
  assert.equal(dialogues.length, 0);
});

test("NPCs attacking players are not this Area's business", () => {
  assert.equal(area.canAttack(fakeNpc(958), fakePlayer()), null);
});

test("the crevice by the landing leads out to the entrance", () => {
  const exit = TELEPORTS.locs.filter((entry) => entry.id === 26712);
  assert.equal(exit.length, 1);
  assert.deepEqual([exit[0].x, exit[0].y, exit[0].z, exit[0].option], [3306, 9497, 0, "Use"]);
  assert.deepEqual(exit[0].to, [3321, 3122, 0]);
});

/** A player with an inventory and a bank, for the corpse's Search option. */
function searcher({ items = [], banks = [], freeSlots = 28 } = {}) {
  const player = fakePlayer();
  const held = new Map(items);
  const added = [];
  player.getInventory = () => ({
    getAmount: (id) => held.get(id) ?? 0,
    getFreeSlots: () => freeSlots,
    adds: (id, amount) => { added.push([id, amount]); held.set(id, (held.get(id) ?? 0) + amount); return true; },
  });
  player.getBanks = () => banks;
  player.added = added;
  player.varbits = [];
  const attributes = new Map();
  player.setAttribute = (key, value) => attributes.set(key, value);
  player.getAttribute = (key) => attributes.get(key);
  player.getPacketSender = () => ({ sendVarbit: (id, value) => player.varbits.push([id, value]) });
  player.getDialogueManager = () => ({ startDialogues: (chain) => boxes.push(chain) });
  return player;
}
const bankHolding = (id, amount) => [{ getAmount: (other) => (other === id ? amount : 0) }];

test("Search on the Entomologist gives his diary, once (Wiki: Entomologist's diary)", () => {
  const diary = core.CacheDefinitions.getObjId("slayer_cave_diary");
  assert.equal(diary, 11904, "the cache's slayer_cave_diary is the item the Wiki lists");
  const actions = npcActions.get("Entomologist");
  assert.deepEqual(Object.keys(actions), ["Search"], "Search is the corpse's only option");

  const player = searcher();
  actions.Search({ player });
  assert.deepEqual(player.added, [[diary, 1]]);
  assert.deepEqual(player.varbits, [[4093, 1]], "slayer_found_diary goes 0 -> 1 (rsprox 2922)");
  assert.equal(boxes.length, 1, "the diary comes out in an objectbox (rsprox 2922)");
  assert.equal(boxes[0].entries[0].item, diary);
  assert.equal(boxes[0].entries[0].text, "You search the corpse and find a book.");
  assert.deepEqual(player.messages, [], "the captured search puts nothing in the chatbox");

  actions.Search({ player });
  assert.deepEqual(player.added, [[diary, 1]], "a second search does not duplicate it");
  assert.deepEqual(player.varbits, [[4093, 1]], "and records nothing again");
  assert.equal(boxes.length, 1, "and shows no second box");
  assert.deepEqual(player.messages, [T.DIARY_ALREADY_HELD]);
});

test("a banked diary is not handed out again, and a full inventory keeps it in the body", () => {
  const diary = 11904;
  const actions = npcActions.get("Entomologist");

  const banked = searcher({ banks: bankHolding(diary, 1) });
  actions.Search({ player: banked });
  assert.deepEqual(banked.added, [], "the bank counts as held");
  assert.deepEqual(banked.messages, [T.DIARY_ALREADY_HELD]);
  assert.deepEqual(banked.varbits, [], "nothing recorded for a refusal");

  const full = searcher({ freeSlots: 0 });
  actions.Search({ player: full });
  assert.deepEqual(full.added, []);
  assert.deepEqual(full.messages, [T.DIARY_NO_SPACE]);
  assert.deepEqual(full.varbits, [], "nothing recorded when there is no room");
});

test("the recorded varbit comes back on login for a player who found the diary", () => {
  assert.equal(persisted.get("kalphite-cave:found-diary"), 0, "persisted, so it survives a save");

  const player = searcher();
  npcActions.get("Entomologist").Search({ player });
  player.varbits.length = 0;
  for (const handler of loginHandlers) handler({ player });
  assert.deepEqual(player.varbits, [[4093, 1]], "restored from the attribute on login");

  const fresh = searcher();
  for (const handler of loginHandlers) handler({ player: fresh });
  assert.deepEqual(fresh.varbits, [], "nothing to restore for someone who never searched");
});
