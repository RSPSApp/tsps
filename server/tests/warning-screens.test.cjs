// Run after `yarn build`: node --test tests/warning-screens.test.cjs
//
// Warning screens and the Doomsayer (plugins/world/WarningScreens.plugin.js), as rsprox
// 20261115T211134 shows them: each warning's cws_warning_<n> varbit counts showings 0-5, 6 offers
// "Don't ask me this again" and 7 is off; the Doomsayer's list toggles 6 and 7 and refuses below 6.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

const DATA = require("../plugins/world/data/warning-screens.json");
const Shared = require("../plugins/world/warningscreens/Shared.WarningScreens");
const attachScreens = require("../plugins/world/warningscreens/Screens.WarningScreens");
const attachDoomsayer = require("../plugins/world/warningscreens/Doomsayer.WarningScreens");

const SHANTAY = 10; // cws_warning_10, interface 565
const SHANTAY_SCREEN = 565;
const DOOMSAYER_LIST = 583;

// One fake api for both units: hooks by name, the multi prompt recorded per player.
const hooks = { custom: new Map(), clicks: [], logins: [], npc: {} };
const prompts = new Map();
const recordDialogue = (kind) => class { constructor(...args) { this.kind = kind; this.args = args; } };
const core = {
  DialogueChainBuilder: class { constructor() { this.entries = []; } add(...entries) { this.entries.push(...entries); return this; } },
  NpcDialogue: recordDialogue("npc"),
  PlayerDialogue: recordDialogue("player"),
  ActionDialogue: recordDialogue("action"),
  EndDialogue: recordDialogue("end"),
};
const api = {
  core,
  persistAttribute() {},
  onCustomEvent: (name, handler) => hooks.custom.set(name, handler),
  onInterfaceActionClick: (handler) => hooks.clicks.push(handler),
  onPlayerLogin: (handler) => hooks.logins.push(handler),
  onNpcInteraction: (name, actions) => { hooks.npc[name] = actions; },
  sendMultiChatboxPrompt: (player, title, ...pairs) => prompts.set(player, { title, pairs }),
};
attachScreens(api);
attachDoomsayer(api);

function createPlayer(attributes = {}) {
  const log = [];
  const saved = new Map(Object.entries(attributes));
  const chains = [];
  const sender = new Proxy({}, {
    get: (_target, name) => (...args) => {
      log.push(`${String(name)} ${args.map((arg) => (Array.isArray(arg) ? `[${arg}]` : arg)).join(" ")}`.trim());
      return sender;
    },
  });
  return {
    log,
    chains,
    getAttribute: (key) => saved.get(key),
    setAttribute: (key, value) => saved.set(key, value),
    getPacketSender: () => sender,
    sendMessage: (message) => log.push(`message ${message}`),
    getDialogueManager: () => ({ startDialogues: (chain) => chains.push(chain.entries) }),
  };
}

const show = (player, warning, answers = {}) => {
  const event = { player, warning, ...answers };
  hooks.custom.get("warning-screen:show")(event);
  return event;
};
const click = (player, groupId, childId) => {
  const event = { player, groupId, childId };
  for (const handler of hooks.clicks) handler(event);
  return event;
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

test("data/warning-screens.json matches the cache: each warning's screen, varbit and Doomsayer row", () => {
  const rows = new Map([...CacheDefinitions.getEnumValues(688)].map(([warning, component]) => [Number(warning), Number(component) & 0xffff]));
  for (const entry of DATA.warnings) {
    assert.equal(entry.interface, CacheDefinitions.getInterfaceId(`cws_warning_${entry.warning}`), `interface of ${entry.warning}`);
    assert.equal(entry.varbit, CacheDefinitions.getVarbitId(`cws_warning_${entry.warning}`), `varbit of ${entry.warning}`);
    assert.equal(entry.doomsayerRow, rows.get(entry.warning) ?? null, `row of ${entry.warning}`);
  }
  assert.equal(DATA.warnings.filter((entry) => entry.doomsayerRow !== null).length, 24, "the Doomsayer lists 24 warnings");
  assert.equal(CacheDefinitions.getInterfaceId("cws_doomsayer"), DOOMSAYER_LIST);
  assert.equal(CacheDefinitions.getVarbitId("doomsayer_intro"), 16791);
});

test("a warning counts its showings to 6, then offers Don't ask me this again; off at 7 it is skipped", () => {
  const player = createPlayer();
  for (let shown = 1; shown <= 6; shown++) {
    player.log.length = 0;
    let went = false;
    const event = show(player, SHANTAY, { proceed: () => { went = true; } });
    assert.equal(event.handled, true);
    assert.ok(player.log.includes(`sendVarbit 3860 ${shown}`), `showing ${shown}`);
    assert.deepEqual(player.log.slice(-2), ["sendInterfaceScript 2524 [-1,-1]", `sendInterface ${SHANTAY_SCREEN}`]);
    assert.equal(went, false, "nothing happens before an answer");
    click(player, SHANTAY_SCREEN, 17);
    assert.equal(went, true, "Yes proceeds");
  }
  player.log.length = 0;
  show(player, SHANTAY, {});
  assert.ok(player.log.includes(`sendInterfaceDisplayState ${(SHANTAY_SCREEN << 16) | 21} false`), "the checkbox shows");
  assert.ok(!player.log.some((line) => line.startsWith("sendVarbit")), "the count stops at 6");
  click(player, SHANTAY_SCREEN, 20);
  assert.ok(player.log.includes("sendVarbit 3860 7"));
  assert.ok(player.log.includes(`message ${Shared.SCREEN_TOGGLED_OFF_MESSAGE}`));
  click(player, SHANTAY_SCREEN, 18);

  player.log.length = 0;
  let went = false;
  show(player, SHANTAY, { proceed: () => { went = true; } });
  assert.equal(went, true, "off: straight on");
  assert.ok(!player.log.includes(`sendInterface ${SHANTAY_SCREEN}`));
});

test("No, Close and walking off stay out; a checkbox below 6 does nothing", () => {
  for (const close of [(player) => click(player, SHANTAY_SCREEN, 18), (player) => click(player, SHANTAY_SCREEN, 12),
    (player) => hooks.custom.get("interface:closed")({ player, interfaceId: SHANTAY_SCREEN })]) {
    const player = createPlayer();
    const answers = [];
    show(player, SHANTAY, { proceed: () => answers.push("in"), stayOut: () => answers.push("out") });
    click(player, SHANTAY_SCREEN, 20);
    assert.equal(Shared.state(player, SHANTAY), 1, "the checkbox is hidden before 6");
    close(player);
    assert.deepEqual(answers, ["out"]);
  }
});

test("the notices (Icy Path Area, Death Plateau) only inform", () => {
  const player = createPlayer();
  let went = false;
  show(player, 24, { proceed: () => { went = true; } });
  assert.equal(went, true);
  assert.ok(player.log.includes("sendInterface 581"));
  assert.ok(player.log.includes("sendVarbit 3872 1"));
});

test("a warning without a cws screen (the Wilderness ditch) is left to its caller", () => {
  const event = show(createPlayer(), 7, { proceed: () => assert.fail("not ours") });
  assert.notEqual(event.handled, true);
});

test("login carries the old saves over: Shantay's 7 stays off, the Stronghold's count stops at 6 or its tick is off", () => {
  const player = createPlayer({ "shantay-pass:warnings": 7, "sos.descent-warnings": 15, "lost-tribe:dark-warnings": 2 });
  for (const handler of hooks.logins) handler({ player });
  assert.equal(Shared.state(player, SHANTAY), 7);
  assert.equal(Shared.state(player, 4), 6);
  assert.equal(Shared.state(player, 16), 2);
  assert.equal(player.getAttribute("shantay-pass:warnings"), 0, "the old save is cleared");
  assert.ok(player.log.includes("sendVarbit 3860 7") && player.log.includes("sendVarbit 3854 6") && player.log.includes("sendVarbit 3866 2"));

  const ticked = createPlayer({ "sos.dont-ask-descent": true, "sos.descent-warnings": 3 });
  for (const handler of hooks.logins) handler({ player: ticked });
  assert.equal(Shared.state(ticked, 4), 7);
});

const lines = (chain) => chain.filter((entry) => entry.kind === "npc" || entry.kind === "player")
  .map((entry) => `${entry.kind}: ${entry.kind === "npc" ? entry.args[2] : entry.args[1]}`);
const runActions = (chain) => chain.filter((entry) => entry.kind === "action").forEach((entry) => entry.args[1].execute());

test("the Doomsayer's first talk, as captured: the doom, who he is, then his warning signs", () => {
  const player = createPlayer();
  hooks.npc.Doomsayer["Talk-to"]({ player });
  assert.deepEqual(lines(player.chains[0]), [
    "npc: Dooooom!",
    "player: Where?",
    "npc: All around us! I can feel it in the air, hear it on the wind, smell it... also in the air!",
    "player: Is there anything we can do about this doom?",
    "npc: There is nothing you need to do my friend, for I am the Doomsayer! I roam the world sensing danger.",
  ]);
  runActions(player.chains[0]);
  assert.ok(player.log.includes("sendVarbit 16791 1"), "doomsayer_intro");
  assert.deepEqual(lines(player.chains[1]), ["npc: If I find a dangerous area, then I put up warning signs that will tell you what is so dangerous about that area."]);
  runActions(player.chains[1]);
  const prompt = prompts.get(player);
  assert.equal(prompt.title, "Select an option");
  assert.deepEqual(prompt.pairs.filter((_, index) => index % 2 === 0),
    ["I'd like to get rid of some of your warning signs.", "Thanks, I'll remember that if I see any warning signs."]);

  prompt.pairs[1]();
  assert.deepEqual(lines(player.chains[2]), ["player: I'd like to get rid of some of your warning signs.", "npc: Oh... Very well."]);
  player.log.length = 0;
  runActions(player.chains[2]);
  assert.deepEqual(player.log, ["sendInterfaceScript 2524 [-1,-1]", `sendInterface ${DOOMSAYER_LIST}`]);
});

test("after that he only says Dooooom!, with I'd better be off.", () => {
  const player = createPlayer({ "doomsayer:intro-heard": true });
  hooks.npc.Doomsayer["Talk-to"]({ player });
  assert.deepEqual(lines(player.chains[0]), ["npc: Dooooom!"]);
  runActions(player.chains[0]);
  const prompt = prompts.get(player);
  assert.equal(prompt.pairs[2], "I'd better be off.");
  prompt.pairs[3]();
  assert.deepEqual(lines(player.chains[1]), ["player: I'd better be off."]);
});

test("the list toggles a warning shown often enough, and refuses one that is not (live messages)", () => {
  const player = createPlayer({ [Shared.stateAttribute(1)]: 7, [Shared.stateAttribute(13)]: 4 });
  click(player, DOOMSAYER_LIST, 42); // Dagannoth Kings' Ladder
  assert.equal(Shared.state(player, 1), 6);
  assert.ok(player.log.includes("sendVarbit 3851 6"));
  assert.equal(player.log.at(-1), `message ${Shared.TOGGLED_ON_MESSAGE}`);
  click(player, DOOMSAYER_LIST, 42);
  assert.equal(Shared.state(player, 1), 7);
  assert.equal(player.log.at(-1), `message ${Shared.TOGGLED_OFF_MESSAGE}`);
  click(player, DOOMSAYER_LIST, 43); // Lumbridge Swamp Cave Rope, shown 4 times
  assert.equal(Shared.state(player, 13), 4);
  assert.equal(player.log.at(-1), `message ${Shared.CANNOT_TOGGLE_MESSAGE}`);
  player.log.length = 0;
  hooks.npc.Doomsayer["Toggle-warnings"]({ player });
  assert.deepEqual(player.log, ["sendInterfaceScript 2524 [-1,-1]", `sendInterface ${DOOMSAYER_LIST}`]);
});
