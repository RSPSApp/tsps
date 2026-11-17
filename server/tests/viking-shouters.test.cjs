const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

let core;
before(() => {
  CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  core = PluginManager.createApi("VikingShouters").core;
});

const PLUGIN = "../plugins/npcs/VikingShouters.plugin";

function guard(gameval, x, y, said) {
  const id = core.CacheDefinitions.getNpcId(gameval);
  const location = new core.Location(x, y, 2);
  const npc = {
    gameval, faced: [], registered: true,
    getId: () => id, getLocation: () => location, isRegistered: () => npc.registered,
    forcePositionToFace: (tile) => npc.faced.push([tile.getX(), tile.getY()]),
    forceChat: (text) => said.push([gameval, text]),
  };
  return npc;
}

function player() {
  const camera = [];
  return {
    camera, isRegistered: () => true,
    getPacketSender: () => ({
      sendCameraMoveTo: (x, y, height, motion) => camera.push(["moveTo", x, y, height, motion]),
      sendCameraLookAt: (x, y, height, motion) => camera.push(["lookAt", x, y, height, motion]),
      sendCameraReset: () => camera.push(["reset"]),
    }),
  };
}

/** The plugin started against two fake guards; `run(n)` advances n ticks and returns what was said, by tick. */
function scene({ spawnedAt = 0 } = {}) {
  delete require.cache[require.resolve(PLUGIN)];
  const plugin = require(PLUGIN);
  const said = [];
  const jatizso = guard("frisd_izso_viking_shouter", 2372, 3801, said);
  const neitiznot = guard("frisd_iznot_viking_shouter", 2364, 3800, said);
  const tasks = [];
  let startup, handlers, name, dialogueAction;
  plugin.register({
    core: {
      ...core,
      TaskManager: { submit: (task) => tasks.push(task) },
      World: { getNpcsNear: () => (plugin._test.state.tick >= spawnedAt ? [jatizso, neitiznot] : []) },
    },
    onServerStartup: (fn) => { startup = fn; },
    onNpcInteraction: (npcName, map) => { name = npcName; handlers = map; },
    onCustomEvent: (event, fn) => { if (event === "npc-dialogue:action") dialogueAction = fn; },
  });
  startup();
  const log = [];
  return {
    plugin, jatizso, neitiznot, name, handlers, log,
    get tick() { return plugin._test.state.tick; },
    run(n) {
      for (let i = 0; i < n; i++) {
        said.length = 0;
        tasks[0].execute();
        for (const line of said) log.push([plugin._test.state.tick, ...line]);
      }
    },
    talkWatch(stepId, who = player()) {
      const action = { player: who, stepId, handled: false };
      dialogueAction(action);
      return { who, handled: action.handled };
    },
    watch(npc, who = player()) {
      return { who, handled: handlers["Watch-shouting"]({ player: who, npc }) };
    },
  };
}

const CHANTS = new Set(["JATIZSO!", "NEITIZNOT!"]);

test("Watch-shouting is hooked on the guards' name, and the guards chant their islands every 6 ticks", () => {
  const s = scene();
  assert.equal(s.name, "Guard");
  s.run(18);
  assert.deepEqual(s.log.map(([tick, who, text]) => [tick, who.includes("izso") ? "J" : "N", text]), [
    [1, "J", "JATIZSO!"], [6, "N", "NEITIZNOT!"], [7, "J", "JATIZSO!"], [12, "N", "NEITIZNOT!"],
    [13, "J", "JATIZSO!"], [18, "N", "NEITIZNOT!"],
  ]);
  // They face each other when they shout (live face_angle 471 / 1496).
  assert.deepEqual(s.jatizso.faced[0], [2364, 3800]);
  assert.deepEqual(s.neitiznot.faced[0], [2372, 3801]);
});

test("guards that spawn after startup keep the chant phases 5 ticks apart, not both at once", () => {
  const s = scene({ spawnedAt: 30 });
  s.run(60);
  const first = s.log.slice(0, 2).map(([tick, , text]) => [tick, text]);
  assert.equal(first[0][1], "JATIZSO!");
  assert.equal(first[1][1], "NEITIZNOT!");
  assert.equal(first[1][0] - first[0][0], 5);
});

test("Watch-shouting on the Jatizso guard: camera behind him, the 11-line round from +3, reset at +63, chants resume", () => {
  const s = scene();
  s.run(2);
  const clickTick = s.tick;
  const { who, handled } = s.watch(s.jatizso);
  assert.equal(handled, true);
  const rates = { rate: 20, rate2: 50, heightRelative: false };
  assert.deepEqual(who.camera, [["moveTo", 2380, 3802, 1000, rates], ["lookAt", 2364, 3800, 128, rates]]);
  s.log.length = 0;
  s.run(70);
  const round = s.log.filter(([, , text]) => !CHANTS.has(text)).map(([tick, who, text]) => [tick - clickTick, who, text]);
  assert.deepEqual(round.map(([at]) => at), [3, 8, 13, 18, 23, 28, 33, 38, 43, 48, 53]);
  assert.deepEqual(round.map(([, who]) => who), Array.from({ length: 11 }, (_, i) =>
    (i % 2 === 0 ? "frisd_izso_viking_shouter" : "frisd_iznot_viking_shouter")));
  assert.equal(round[0][2], "YOU WOULDN'T KNOW HOW TO KILL A TROLL IF IT CAME UP AND BIT YER ARM OFF!");
  // The Wiki transcript's wording (rec 3027 shows "CALL THAT A TOWN? ..." here: a recorded difference).
  assert.equal(round[4][2], "CALL THAT A TOWN, I'VE SEEN BETTER HAMLETS!");
  assert.equal(round[10][2], "OUR KING'S BETTER THAN YOUR BURGHER!");
  const chants = s.log.filter(([, , text]) => CHANTS.has(text)).map(([tick, , text]) => [tick - clickTick, text]);
  // Before the round starts the chants go on; none during it; Jatizso again at +3+58, Neitiznot at +3+64.
  assert.ok(chants.every(([at]) => at < 3 || at > 53));
  const resumed = (chant) => chants.find(([at, text]) => at > 53 && text === chant)?.[0];
  assert.equal(resumed("JATIZSO!"), 61);
  assert.equal(resumed("NEITIZNOT!"), 67);
  assert.deepEqual(who.camera.slice(2), [["reset"]]);
  assert.equal(s.plugin._test.state.round, null);
});

test("Watch-shouting on the Neitiznot guard: camera behind him, looking at the Jatizso guard", () => {
  const s = scene();
  const { who } = s.watch(s.neitiznot);
  const rates = { rate: 20, rate2: 50, heightRelative: false };
  assert.deepEqual(who.camera, [["moveTo", 2356, 3800, 1000, rates], ["lookAt", 2372, 3801, 128, rates]]);
  s.run(30);
  assert.ok(s.log.some(([, , text]) => text === "YOUR MOTHER WAS A HAMSTER."));
});

test("Talk-to's \"Can I watch?\" action step plays the same round with that guard's camera; other steps don't", () => {
  const s = scene();
  assert.equal(s.talkWatch("someOtherStep").handled, false);
  assert.equal(s.plugin._test.state.round, null);
  const { who, handled } = s.talkWatch("iJSutJ");
  assert.equal(handled, true);
  assert.deepEqual(who.camera.map(([kind, x, y]) => [kind, x, y]), [["moveTo", 2356, 3800], ["lookAt", 2372, 3801]]);
  s.run(70);
  assert.equal(s.log.filter(([, , text]) => !CHANTS.has(text)).length, 11);
  assert.deepEqual(who.camera.at(-1), ["reset"]);
  assert.equal(s.talkWatch("jF2L2R").who.camera[0][1], 2380);
});

test("a second watcher joins the running round and is reset with it; other Guards fall through", () => {
  const s = scene();
  const first = s.watch(s.jatizso).who;
  s.run(20);
  const second = s.watch(s.neitiznot).who;
  s.run(50);
  const lines = s.log.filter(([, , text]) => !CHANTS.has(text));
  assert.equal(lines.length, 11);
  assert.equal(lines[0][1], "frisd_izso_viking_shouter");
  assert.deepEqual(first.camera.at(-1), ["reset"]);
  assert.deepEqual(second.camera.at(-1), ["reset"]);
  assert.equal(second.camera.filter(([kind]) => kind === "reset").length, 1);
  const other = { getId: () => core.CacheDefinitions.getNpcId("pest_squire_ship_portsarim") };
  assert.equal(s.watch(other).handled, false);
});
