// Run after `yarn build`: node --test tests/chompy-ingredients.test.cjs
//
// Big Chompy Bird Hunting's seasoned chompy takes one ingredient from each of Rantz, Bugs and
// Fycie, each one of the transcript's pairs (#3807). Each ogre's pick is the player's own and stays
// the same however often they are asked (the user's rev 242 capture: Onion three times, equa leaves
// and tomato twice each; Wiki: "It's different from player to player"), so every combination of the
// pairs must cook, and the refusal names this player's three.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Location } = require("../dist/game/model/Location");
const { Item } = require("../dist/game/model/Item");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const PAGE = "Big Chompy Bird Hunting";
const SPIT_ROAST = 6895;
const STAGE_TOLD_TO_COOK = 55;

let core, emit, listeners, quest, itemOnObject;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  listeners = new Map();
  emit = (name, event) => (listeners.get(name) ?? []).forEach((handler) => handler(event));
  const api = new Proxy({
    core,
    persistAttribute() {},
    onCustomEvent(name, handler) {
      const entries = listeners.get(name) ?? [];
      entries.push(handler);
      listeners.set(name, entries);
    },
    emitCustomEvent: emit,
    onItemOnObject(handler) { itemOnObject = handler; },
    getTaskManager: () => ({ submit() {} }),
    getWorld: () => ({}),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require("../plugins/quests/quests/BigChompyBirdHunting.Quest")(api);
  quest = QuestRuntime.getRegisteredQuests().find(({ key }) => key === "big_chompy_bird_hunting");
  assert.ok(quest, "Big Chompy Bird Hunting is registered with QuestRuntime");
  assert.equal(typeof itemOnObject, "function", "the quest registers its spit-roast handler");
});

/** Every string the transcript holds under a page variant, in order. */
function linesOf(variant) {
  const out = [];
  const walk = (node) => {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/definitions/npc-dialogues.json"), "utf8"))[PAGE].variants[variant]);
  return out;
}

/** The transcript line that names `needle`, so the test proves the handler matches the data. */
function line(variant, needle) {
  const found = linesOf(variant).find((text) => text.toLowerCase().includes(needle));
  assert.ok(found, `${variant} names "${needle}"`);
  return found;
}

const RANTZ_AGAIN = "talking-to-rantz-with-a-raw-chompy-talking-to-rantz-again-before-cooking-the-chompy";
const BUGS_PAGE = "talking-to-rantz-with-a-raw-chompy-getting-the-ingredient-order-from-bugs";
const FYCIE_PAGE = "talking-to-rantz-with-a-raw-chompy-getting-the-ingredient-order-from-fycie";

let next = 9100;
function makePlayer() {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel), new Location(2630, 2989));
  player.setIndex(next++);
  player.setUsername(`chompyqa${next}`);
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.setHitpoints(10);
  return player;
}

const RANTZ_KEY = "big-chompy-bird-hunting:rantz-ingredient";
const BUGS_KEY = "big-chompy-bird-hunting:bugs-ingredient";
const FYCIE_KEY = "big-chompy-bird-hunting:fycie-ingredient";

function picks(player, rantz, bugs, fycie) {
  player.setAttribute(RANTZ_KEY, rantz);
  player.setAttribute(BUGS_KEY, bugs);
  player.setAttribute(FYCIE_KEY, fycie);
}

function cook(player) {
  const event = {
    player,
    objectId: SPIT_ROAST,
    itemId: ItemIdentifiers.RAW_CHOMPY,
    location: new Location(2630, 2990, 0),
    handled: false,
  };
  itemOnObject(event);
  // The roast's three steps are two ticks apart (capture ticks 1472-1476).
  for (let i = 0; i < 5; i++) core.TaskManager.process();
  return event;
}

const RANTZ_OPTIONS = [["onion", ItemIdentifiers.ONION], ["potato", ItemIdentifiers.POTATO]];
const BUGS_OPTIONS = [["equa-leaves", ItemIdentifiers.EQUA_LEAVES], ["cabbage", ItemIdentifiers.CABBAGE]];
const FYCIE_OPTIONS = [["tomato", ItemIdentifiers.TOMATO], ["doogle-leaves", ItemIdentifiers.DOOGLE_LEAVES]];

test("the transcript holds every seasoning the plugin can pick", () => {
  line(RANTZ_AGAIN, "wants onion");
  line(RANTZ_AGAIN, "wants potato");
  line(BUGS_PAGE, "equa leaves");
  line(BUGS_PAGE, "cabbage");
  line(FYCIE_PAGE, "tomato");
  line(FYCIE_PAGE, "doogle leaves");
});

for (const [rantzLabel, rantzItem] of RANTZ_OPTIONS) {
  for (const [bugsLabel, bugsItem] of BUGS_OPTIONS) {
    for (const [fycieLabel, fycieItem] of FYCIE_OPTIONS) {
      test(`a seasoned chompy with ${rantzLabel}, ${bugsLabel} and ${fycieLabel} cooks (#3807)`, () => {
        const player = makePlayer();
        quest.setStage(player, STAGE_TOLD_TO_COOK);
        picks(player, rantzItem, bugsItem, fycieItem);
        for (const id of [ItemIdentifiers.RAW_CHOMPY, rantzItem, bugsItem, fycieItem]) {
          player.getInventory().add(new Item(id, 1));
        }
        const event = cook(player);
        assert.equal(event.handled, true, "the spit-roast claims the use");
        assert.equal(player.getInventory().getAmount(ItemIdentifiers.SEASONED_CHOMPY), 1, "a seasoned chompy");
        assert.equal(player.getInventory().getAmount(ItemIdentifiers.RAW_CHOMPY), 0, "the raw chompy is gone");
        for (const id of [rantzItem, bugsItem, fycieItem]) assert.equal(player.getInventory().getAmount(id), 0);
        player.setRegistered(false);
      });
    }
  }
}

// The transcript's refusal is two messages: the flat refusal, then the reminder that names what
// each of them asked for — Rantz, then Fycie, then Bugs, with the player's seasoning in place of
// the data's "[potato/onion]" placeholders.
for (const [label, rantz, bugs, fycie, reminder] of [
  ["potato/cabbage/tomato", ItemIdentifiers.POTATO, ItemIdentifiers.CABBAGE, ItemIdentifiers.TOMATO,
    "Remember what the Ogre family wanted? Rantz wanted potato. Fycie wanted tomato. Bugs wanted cabbage."],
  ["onion/equa/doogle", ItemIdentifiers.ONION, ItemIdentifiers.EQUA_LEAVES, ItemIdentifiers.DOOGLE_LEAVES,
    "Remember what the Ogre family wanted? Rantz wanted onion. Fycie wanted doogle leaves. Bugs wanted equa leaves."],
]) {
  test(`a missing ${label} ingredient is refused with both of the transcript's lines`, () => {
    const player = makePlayer();
    quest.setStage(player, STAGE_TOLD_TO_COOK);
    picks(player, rantz, bugs, fycie);
    const messages = [];
    player.sendMessage = (message) => messages.push(String(message));
    player.getInventory().add(new Item(ItemIdentifiers.RAW_CHOMPY, 1));

    const event = cook(player);
    assert.equal(event.handled, true);
    assert.equal(player.getInventory().getAmount(ItemIdentifiers.SEASONED_CHOMPY), 0, "nothing is cooked");
    assert.equal(player.getInventory().getAmount(ItemIdentifiers.RAW_CHOMPY), 1, "the chompy is kept");
    assert.deepEqual(messages, [
      line("talking-to-rantz-with-a-raw-chompy-attempting-to-cook-the-chompy-without-the-requested-ingredients", "don't have all the ingredients"),
      reminder,
    ], "the refusal and the reminder, in the transcript's order");
    player.setRegistered(false);
  });
}

test("an onion where he asked for a potato is refused and the reminder names the potato", () => {
  const player = makePlayer();
  quest.setStage(player, STAGE_TOLD_TO_COOK);
  picks(player, ItemIdentifiers.POTATO, ItemIdentifiers.CABBAGE, ItemIdentifiers.TOMATO);
  const messages = [];
  player.sendMessage = (message) => messages.push(String(message));
  for (const id of [ItemIdentifiers.RAW_CHOMPY, ItemIdentifiers.ONION, ItemIdentifiers.CABBAGE, ItemIdentifiers.TOMATO]) {
    player.getInventory().add(new Item(id, 1));
  }
  const event = cook(player);
  assert.equal(event.handled, true);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.SEASONED_CHOMPY), 0, "nothing is cooked");
  assert.ok(messages.at(-1).includes("Rantz wanted potato."), "the onion does not stand in for the potato");
  player.setRegistered(false);
});

test("a player who never asked still has picks, rolled once and kept", () => {
  const player = makePlayer();
  quest.setStage(player, STAGE_TOLD_TO_COOK);
  player.sendMessage = () => {};
  player.getInventory().add(new Item(ItemIdentifiers.RAW_CHOMPY, 1));
  cook(player);
  const first = [RANTZ_KEY, BUGS_KEY, FYCIE_KEY].map((key) => player.getAttribute(key));
  assert.ok(first.every((id) => Number(id) > 0), "each ogre has a seasoning");
  cook(player);
  assert.deepEqual([RANTZ_KEY, BUGS_KEY, FYCIE_KEY].map((key) => player.getAttribute(key)), first);
  player.setRegistered(false);
});
