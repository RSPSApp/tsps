// Run after `yarn build`: node --test tests/keldagrim-access.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const Keldagrim = require("../plugins/areas/Keldagrim.plugin");
const Rellekka = require("../plugins/areas/Rellekka.plugin");

test("the Rellekka tunnel and cave passage reach the Dwarven Boatman without The Giant Dwarf started", () => {
  Keldagrim._test.init({ core, emitCustomEvent() {} });
  Rellekka.register({ core, onObjectInteraction() {} });

  const landings = [];
  const player = {
    moveTo: (location) => landings.push([location.getX(), location.getY()]),
    sendMessage: () => {},
  };
  const entry = { player, location: { x: 2731, y: 3712, z: 0 }, handled: false };
  Rellekka._test.enterTunnel(entry);
  assert.deepEqual(landings, [[2773, 10162]], "the Rellekka tunnel reaches the cave");

  Keldagrim._test.goThrough({ player, objectId: core.ObjectIdentifiers.CAVE_ENTRANCE_29 });
  assert.deepEqual(landings.at(-1), [2838, 10124],
    "the cave passage reaches the boatman, who starts the quest and takes the player into the city");
});

test("only the city, not the boatman's entrance-mine dock, marks Keldagrim visited", () => {
  const zones = [];
  const entered = [];
  Keldagrim.register({
    core,
    onObjectInteraction() {},
    onZoneEnter(zone, handler) { zones.push([zone, handler]); },
    onNpcInteraction() {},
    onNpcDialogueVariant() {},
    onNpcDialogueCondition() {},
    onCustomEvent() {},
    emitCustomEvent(name, payload) { if (name === "keldagrim:entered-city") entered.push(payload); },
  });
  const inside = (zone, x, y) => x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY
    && zone.levels.includes(0);
  const enter = (x, y) => {
    let fired = 0;
    for (const [zone, handler] of zones) {
      if (!inside(zone, x, y)) continue;
      handler({ player: {} });
      fired++;
    }
    return fired;
  };

  assert.equal(enter(2838, 10124), 0, "the boatman's dock is the entrance mine, not Keldagrim");
  assert.equal(enter(2827, 10214), 1, "the boat ride's Black Guard HQ landing is Keldagrim");
  assert.equal(enter(2930, 10193), 1, "the Blast Furnace is Keldagrim");
  assert.equal(enter(2872, 10176), 0,
    "the ferry-side house north of the river is reachable without the quest, so it is not Keldagrim");
  assert.equal(enter(2840, 10190), 1, "the city's west half is Keldagrim");
  assert.equal(entered.length, 3);
});

test("the ferrymen's Travel takes the 2-coin fare, one coin as the transcript's exception, and refuses with none", () => {
  const starts = [];
  Keldagrim._test.init({ core, emitCustomEvent(name, request) { if (name === "npc-dialogue:start") { starts.push(request); request.handled = true; } } });
  const npcId = core.NpcIdentifiers.DWARVEN_FERRYMAN;
  const rider = (coins) => {
    let balance = coins;
    const landings = [];
    return {
      landings,
      get coins() { return balance; },
      moveTo: (location) => landings.push([location.getX(), location.getY()]),
      sendMessage() {},
      getInventory: () => ({
        getAmount: () => balance,
        deleteNumber: (id, amount) => { balance -= amount; },
      }),
    };
  };
  const rich = rider(10);
  Keldagrim._test.travel({ player: rich, npcId });
  assert.equal(rich.coins, 8);
  assert.equal(rich.landings.length, 1);

  const one = rider(1);
  Keldagrim._test.travel({ player: one, npcId });
  assert.equal(one.coins, 0);
  assert.equal(one.landings.length, 1, "one coin is the transcript's exception");

  const none = rider(0);
  Keldagrim._test.travel({ player: none, npcId });
  assert.equal(none.landings.length, 0, "no free crossing");
  const page = require("../data/definitions/npc-dialogues.json")["Dwarven Ferryman"];
  const picked = starts.at(-1).select(page.variants[starts.at(-1).variant]);
  // The dialogue engine follows "call" steps into the page's branches.
  const lines = JSON.stringify(picked.flatMap((step) => (step.type === "call" ? page.branches[step.branch] : [step])));
  assert.match(lines, /You don't even have 2 gold coins, humans?!/);
});
