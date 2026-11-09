// Run after `yarn build`: node --test tests/chompy-ingredients.test.cjs
//
// Big Chompy Bird Hunting's seasoned chompy takes one ingredient from each of Rantz, Bugs and
// Fycie, and the ogre family names them from the transcript's random pairs (#3807). Whatever a
// talker says last is what the cook must accept: Rantz names his again on the "talk to him once
// more before cooking" page, and that page rolls the onion/potato pair afresh.
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
const { NpcIdentifiers } = require("../dist/util/NpcIdentifiers");

const PAGE = "Big Chompy Bird Hunting";
const SPIT_ROAST = 6895;
const STAGE_KILLED_CHOMPY = 50;
const STAGE_TOLD_TO_COOK = 55;
const RANTZ = NpcIdentifiers.RANTZ;
const BUGS = NpcIdentifiers.BUGS;
const FYCIE = NpcIdentifiers.FYCIE;

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

function say(player, npcId, variant, needle) {
  emit("npc-dialogue:line", { player, npcId, text: line(variant, needle) });
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
  return event;
}

// Rantz's pair and the children's pairs, as the transcript's pages hold them.
const RANTZ_OPTIONS = [
  ["onion", RANTZ_AGAIN, "wants onion", ItemIdentifiers.ONION],
  ["potato", RANTZ_AGAIN, "wants potato", ItemIdentifiers.POTATO],
];
const BUGS_OPTIONS = [
  ["equa-leaves", BUGS_PAGE, "equa leaves", ItemIdentifiers.EQUA_LEAVES],
  ["cabbage", BUGS_PAGE, "cabbage", ItemIdentifiers.CABBAGE],
];
const FYCIE_OPTIONS = [
  ["tomato", FYCIE_PAGE, "tomato", ItemIdentifiers.TOMATO],
  ["doogle-leaves", FYCIE_PAGE, "doogle leaves", ItemIdentifiers.DOOGLE_LEAVES],
];

for (const [rantzLabel, rantzPage, rantzNeedle, rantzItem] of RANTZ_OPTIONS) {
  for (const [bugsLabel, bugsPage, bugsNeedle, bugsItem] of BUGS_OPTIONS) {
    for (const [fycieLabel, fyciePage, fycieNeedle, fycieItem] of FYCIE_OPTIONS) {
      test(`a seasoned chompy with ${rantzLabel}, ${bugsLabel} and ${fycieLabel} cooks (#3807)`, () => {
        const player = makePlayer();
        quest.setStage(player, STAGE_KILLED_CHOMPY);
        // The real flow: the player kills and plucks the chompy (stage 50) and shows it to Rantz,
        // who names his ingredient and moves the quest on to cooking, then names it again on the
        // page the player sees if they come back before cooking — which rolls the pair afresh.
        // The last thing he says is what the cook has to accept.
        say(player, RANTZ, "talking-to-rantz-with-a-raw-chompy", "wants onion");
        assert.equal(quest.getStage(player), STAGE_TOLD_TO_COOK, "showing the raw chompy starts the cook");
        say(player, RANTZ, rantzPage, rantzNeedle);
        say(player, BUGS, bugsPage, bugsNeedle);
        say(player, FYCIE, fyciePage, fycieNeedle);
        assert.equal(player.getAttribute("big-chompy-bird-hunting:rantz-ingredient"), rantzItem,
          `${rantzLabel} is what he said last`);
        assert.equal(player.getAttribute("big-chompy-bird-hunting:bugs-ingredient"), bugsItem, bugsLabel);
        assert.equal(player.getAttribute("big-chompy-bird-hunting:fycie-ingredient"), fycieItem, fycieLabel);
        for (const id of [ItemIdentifiers.RAW_CHOMPY, rantzItem, bugsItem, fycieItem]) {
          player.getInventory().add(new Item(id, 1));
        }

        const event = cook(player);
        assert.equal(event.handled, true, "the spit-roast claims the use");
        assert.equal(player.getInventory().getAmount(ItemIdentifiers.SEASONED_CHOMPY), 1, "a seasoned chompy");
        assert.equal(player.getInventory().getAmount(ItemIdentifiers.RAW_CHOMPY), 0, "the raw chompy is gone");
        player.setRegistered(false);
      });
    }
  }
}

test("an ingredient he asked for and the player lacks is refused with the transcript's line", () => {
  const player = makePlayer();
  quest.setStage(player, STAGE_TOLD_TO_COOK);
  say(player, RANTZ, RANTZ_AGAIN, "wants potato");
  say(player, BUGS, BUGS_PAGE, "cabbage");
  say(player, FYCIE, FYCIE_PAGE, "tomato");
  // Onion instead of the potato he asked for: the earlier recording must not satisfy the cook.
  const messages = [];
  player.sendMessage = (message) => messages.push(String(message));
  for (const id of [ItemIdentifiers.RAW_CHOMPY, ItemIdentifiers.ONION, ItemIdentifiers.CABBAGE, ItemIdentifiers.TOMATO]) {
    player.getInventory().add(new Item(id, 1));
  }
  const event = cook(player);
  assert.equal(event.handled, true);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.SEASONED_CHOMPY), 0, "nothing is cooked");
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.RAW_CHOMPY), 1, "the chompy is kept");
  assert.deepEqual(messages, [line("talking-to-rantz-with-a-raw-chompy-attempting-to-cook-the-chompy-without-the-requested-ingredients", "don't have all the ingredients")],
    "the refusal is the transcript's line");
  player.setRegistered(false);
});
