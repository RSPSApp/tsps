// Run after `yarn build`: node --test tests/sailing-crew.test.cjs
// Sailing crewmates: recruiting through the transcripts, the Crew Registrar, the crew aboard and
// their jobs at the helm and the salvaging hooks, against the cache and the rsprox captures.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
before(() => CachePipeline.initialize());

const { PluginManager } = require("../dist/plugins/PluginManager");
const { Sailing } = require("../dist/game/content/sailing/Sailing");
const { BoatManager } = require("../dist/game/content/sailing/BoatManager");
const { Mobile } = require("../dist/game/entity/impl/Mobile");
const { Location } = require("../dist/game/model/Location");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { emptySailingState } = require("../dist/game/content/sailing/SailingState");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { World } = require("../dist/game/World");

const common = require("../plugins/skills/sailing/crew/Common.Crew");
const recruit = require("../plugins/skills/sailing/crew/Recruit.Crew");
const registrar = require("../plugins/skills/sailing/crew/Registrar.Crew");
const assign = require("../plugins/skills/sailing/crew/Assign.Crew");
const lines = require("../plugins/skills/sailing/crew/Lines.Crew");
const { content } = require("../plugins/skills/sailing/SailingContent.Sailing");
const facilities = require("../plugins/skills/sailing/BoatFacilities.Sailing");

const SAILING = "Sailing";
const VARBIT = { MET_JIM: 19504, UNLOCKED_JIM: 19483, VISIBLE_JIM: 19493, SLOT0: 19468, SLOT0_POSITION: 19478,
  SIDEPANEL_SLOT0: 19243, SIDEPANEL_POSITION0: 19238, ON_DOCK: 19503, HELM_STATUS: 19176, MOVE_MODE: 19175 };
const JIM = 1;
const ADA = 2;
const JENKINS = 10;

let api;
let crewPlugin;
const prompts = [];

before(() => {
  content();
  const real = PluginManager.createApi("SailingCrewTest");
  api = {
    ...real,
    persistAttribute() {},
    sendMultiChatboxPrompt: (player, title, ...pairs) => {
      prompts.push({ player, title, labels: pairs.filter((_, i) => i % 2 === 0), pairs });
      return true;
    },
  };
  // Boats as built (their facilities' locs) and the boarded varbits, as in game.
  require("../plugins/skills/sailing/Sailing.plugin").register(api);
  crewPlugin = require("../plugins/skills/sailing/Crew.plugin");
  crewPlugin.register(api);
  // The helm plugin's crew handover event and the trim's crew share come through custom events.
  require("../plugins/skills/sailing/Helm.plugin").register({ ...api, onObjectInteraction() {}, onObjectRoute() {} });
  require("../plugins/skills/sailing/Salvaging.plugin").register({ ...api, onObjectInteraction() {}, onServerStartup() {} });
});

let nextIndex = 300;
/** A player on the real Mobile prototype, with varbits, attributes, levels and what they're sent. */
function captain({ level = 99 } = {}) {
  const player = Object.create(Mobile.prototype);
  const index = nextIndex++;
  const varbits = new Map();
  const varps = new Map();
  const attributes = new Map();
  const sent = [];
  const said = [];
  const xp = [];
  const levels = new Map([[SAILING, level]]);
  let location = new Location(3060, 2980, 0);
  let sailing = emptySailingState();
  let dialogue;
  let current;
  const sender = new Proxy({}, {
    get: (_t, key) => (...args) => {
      if (key === "getVarbit") return varbits.get(args[0]) ?? 0;
      if (key === "getVarp") return varps.get(args[0]) ?? 0;
      if (key === "sendVarbit") varbits.set(args[0], args[1]);
      if (key === "sendConfig") varps.set(args[0], args[1]);
      sent.push([key, ...args]);
      return sender;
    },
  });
  Object.assign(player, {
    varbits, varps, attributes, sent, said, xp, levels,
    messages: () => sent.filter(([key]) => key === "sendMessage" || key === "sendTypedMessage").map((entry) => entry.at(-1)),
    getIndex: () => index,
    isPlayer: () => true,
    isNpc: () => false,
    isRegistered: () => true,
    getAsPlayer: () => player,
    getUsername: () => "captain", getDisplayName: () => "captain",
    sendMessage: (message) => sent.push(["sendMessage", message]),
    forceChat: (text) => { said.push(text); return player; },
    performAnimation() {},
    setPositionToFace() { return player; },
    getLocation: () => location,
    setLocation: (next) => { location = next; return player; },
    getMovementQueue: () => ({ reset() {}, handleRegionChange() {}, size: () => 0 }),
    setNeedsPlacement() {},
    setResetMovementQueue() {},
    setMobileInteraction() {},
    getLocalPlayers: () => [],
    getSailing: () => sailing,
    setSailing: (next) => { sailing = next; },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => levels.get(skill.getName?.() ?? skill) ?? 1,
      getMaxLevel: (skill) => levels.get(skill.getName?.() ?? skill) ?? 1,
      addExperiences: (skill, amount) => xp.push(amount),
    }),
    getEquipment: () => ({ get: () => undefined, getItems: () => [] }),
    getDialogueManager: () => ({
      startDialogues: (chain) => { dialogue = chain; current = [...chain.getDialogues().values()][0]; },
      getCurrent: () => current,
      reset() { current = undefined; },
    }),
    dialogue: () => dialogue,
    getPacketSender: () => sender,
    getInterfaceId: () => player.interfaceId ?? -1,
    setInterfaceId: (id) => { player.interfaceId = id; },
  });
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  World.getPlayers().get = ((get) => (i) => (i === index ? player : get(i)))(World.getPlayers().get.bind(World.getPlayers()));
  return player;
}

function recruited(player, ...ids) {
  common.update(player, (crew) => {
    for (const id of ids) {
      if (!crew.recruited.includes(id)) crew.recruited.push(id);
      if (!crew.met.includes(id)) crew.met.push(id);
    }
  });
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

test("the crewmates come from cache table 173: ship NPCs and their H/P/D stats", () => {
  const crew = common.all();
  assert.equal(crew.length, 10);
  const jim = common.byId(JIM);
  assert.equal(jim.shipNpc, 15255);
  assert.equal(common.statLine(jim), "H2 P1 D3", "as the assignation menu titles him (rsprox)");
  assert.equal(common.statLine(common.byId(JENKINS)), "H2 P2 D4");
  assert.equal(common.statLine(common.byId(9)), "H3 P2 D3", "Ex-Captain Siad (rsprox)");
  assert.deepEqual(common.byNpc(15253), { crew: jim, at: "world" });
  assert.deepEqual(common.byNpc(15254), { crew: jim, at: "dock" });
  assert.deepEqual(common.byNpc(15049), { crew: common.byId(9), at: "recruit" }, "Captain Siad at the mining camp");
});

test("crew slots open at 40, 55, 70, 85 and 95 Sailing, not by boosts", () => {
  const player = captain({ level: 54 });
  assert.equal(common.slotLimit(player), 1);
  player.levels.set(SAILING, 95);
  assert.equal(common.slotLimit(player), 5);
});

test("each crewmate plays the transcript variant for where they are and what the player has done", () => {
  const player = captain({ level: 40 });
  const jim = { player, npcId: 15253 };
  assert.deepEqual(recruit.selectVariant(jim), { page: "Jobless Jim", variant: "standard-dialogue-at-port-sarim" });
  common.setMet(player, JIM);
  assert.equal(recruit.selectVariant(jim).variant, "standard-dialogue-at-port-sarim-subsequent-dialogue-at-port-sarim");
  recruited(player, JIM);
  assert.equal(recruit.selectVariant(jim).variant, "when-at-the-pandemonium");
  assert.equal(recruit.selectVariant({ player, npcId: 15254 }).variant, "at-port-as-a-crew-member");
  assert.equal(recruit.selectVariant({ player, npcId: 15255 }), null, "on the boat they're commanded, not talked to");
  // Jolly Jim's variants go by the Pandemonium and Sailing 40.
  assert.equal(recruit.selectVariant({ player, npcId: 15282 }).variant, "before-completing-pandemonium");
  // Captain Siad's recruit offer only once The Tourist Trap is done (quest plugins answer it).
  assert.equal(recruit.selectVariant({ player, npcId: 15049 }), null);
});

test("transcript conditions: levels, the crewmate's own requirements, a free slot, ghostspeak", () => {
  const player = captain({ level: 39 });
  const ask = (npcId, text) => recruit.answerCondition({ player, npcId, text });
  assert.equal(ask(15253, "If the player does not have 40 Sailing:"), true);
  assert.equal(ask(15253, "If the player has 40 Sailing:"), false);
  player.levels.set(SAILING, 54);
  assert.equal(ask(15262, "If the player does not have 55 Sailing:"), true);
  assert.equal(ask(15262, "If the player has 55 Sailing:"), false);
  player.levels.set(SAILING, 99);
  assert.equal(ask(15262, "If the player has 55 Sailing:"), true);
  assert.equal(ask(15292, "If the player's Sailing level is under 95:"), false);
  assert.equal(ask(15292, "If the player's Sailing level is at least 95:"), true);
  // Olga also needs In Aid of the Myreque, which no quest plugin answers here.
  assert.equal(ask(15302, "If the player does not have 65 Sailing or has not completed In Aid of the Myreque:"), true);
  assert.equal(ask(15292, "Player has space in their crew:"), true);
  assert.equal(ask(15292, "Player's crew is full:"), false);
  assert.equal(ask(15342, "If the player is wearing a ghostspeak amulet:"), false);
  assert.equal(ask(15342, "If the player is not wearing a ghostspeak amulet:"), true);
  assert.equal(ask(15253, "If cargo hold is already empty:"), null, "left to the conversation");
  assert.equal(ask(1, "If the player has 40 Sailing:"), null, "only crewmates");
});

test("recruiting from the transcript's message: unlocked, highlighted message, crew slot, message box over a fade", () => {
  const player = captain({ level: 40 });
  const event = { player, npcId: 15253, kind: "message", text: "You recruit Jobless Jim as a crew member. He heads off in search of your boat.", handled: false };
  api.emitCustomEvent("npc-dialogue:action", event);
  assert.equal(event.handled, true);
  assert.ok(common.isRecruited(player, JIM));
  assert.equal(player.varbits.get(VARBIT.UNLOCKED_JIM), 1);
  assert.equal(player.varbits.get(VARBIT.SLOT0), JIM, "the first free slot");
  assert.match(player.messages().at(-1), /^<col=06600c>You have recruited Jobless Jim as a crew member\.<\/col>$/);
  assert.ok(player.dialogue(), "the message box");
  assert.equal(player.varbits.get(6719), 2, "the fade hides the minimap");
  assert.equal(player.varbits.get(VARBIT.VISIBLE_JIM) ?? 0, 0, "still at Port Sarim until the screen has faded");
  tick(3);
  assert.equal(player.varbits.get(VARBIT.VISIBLE_JIM), 1, "he leaves 3 ticks in, for the Pandemonium (rsprox)");
  assert.equal(player.varbits.get(6719), 2, "still faded");
  tick();
  assert.equal(player.varbits.get(6719), 0, "faded back in a tick later");
  assert.ok(player.dialogue().getDialogues().get(0) instanceof PluginManager.getCoreApi().StatementDialogue,
    "and the box again, now with Click here to continue");

  // The transcript's own "You have recruited ..." is the message already sent.
  const again = { player, npcId: 15253, kind: "message", text: "You have recruited Jobless Jim as a crew member.", handled: false };
  api.emitCustomEvent("npc-dialogue:action", again);
  assert.equal(again.handled, true);
});

test("with every slot taken, a crewmate who meant to join the boat waits at the Pandemonium", () => {
  const player = captain({ level: 55 });
  recruited(player, JIM);
  common.update(player, (crew) => { crew.slots[0] = JIM; });
  // 55 Sailing: two slots. Fill the second.
  common.update(player, (crew) => { crew.slots[1] = JENKINS; crew.recruited.push(JENKINS); });
  // Ada's transcript names no destination: she joins the crew like one who heads for the boat.
  const event = { player, npcId: 15262, kind: "message", text: "You recruit Adventurer Ada as a crew member.", handled: false };
  api.emitCustomEvent("npc-dialogue:action", event);
  assert.equal(event.handled, true);
  assert.ok(common.isRecruited(player, ADA));
  assert.equal(common.slotOf(player, ADA), -1, "no slot free");
});

test("a crewmate whose requirements aren't met is never recruited, whatever the transcript says", () => {
  const player = captain({ level: 99 });
  const event = { player, npcId: 15302, kind: "message", text: "You recruit Oarswoman Olga as a crew member. She heads off in search of your boat.", handled: false };
  api.emitCustomEvent("npc-dialogue:action", event);
  assert.equal(event.handled, true);
  assert.equal(event.end, true);
  assert.equal(common.isRecruited(player, 6), false, "In Aid of the Myreque isn't done");
});

test("the Wiki export's missing lines: Jim's farmer line as captured, unknown markers skipped", () => {
  const player = captain();
  // The conversation plays a marker's own steps after it either way: skipped ones are dropped as lines.
  const farmer = { player: "Ah, so you're a farmer!" };
  const skip = { player, npcId: 15253, step: { type: "missing", steps: [farmer] }, stepId: "J7jw75", handled: false };
  api.emitCustomEvent("npc-dialogue:action", skip);
  assert.equal(skip.handled, true);
  const line = { player, npcId: 15253, step: farmer, text: farmer.player, skip: false };
  api.emitCustomEvent("npc-dialogue:line", line);
  assert.equal(line.skip, true);
  const myself = { player: "Ah, I'm something of a farmer myself!" };
  const play = { player, npcId: 15253, step: { type: "missing", steps: [myself] }, stepId: "ObWVzo", handled: false };
  api.emitCustomEvent("npc-dialogue:action", play);
  assert.equal(play.handled, true);
  assert.equal(play.steps, undefined, "its line plays once, as the conversation's own");
  const kept = { player, npcId: 15253, step: myself, text: myself.player, skip: false };
  api.emitCustomEvent("npc-dialogue:line", kept);
  assert.equal(kept.skip, false);
});

test("the Crew Registrar's interface: open, select, assign, clear (rsprox)", () => {
  const player = captain({ level: 55 });
  registrar.openCrewManagement(player);
  assert.equal(player.interfaceId, 938);
  assert.equal(player.varbits.get(18310), 1, "the first recruit selected");
  assert.ok(player.sent.some(([key, uid, from, to]) => key === "sendInterfaceFlagsRange" && uid === ((938 << 16) | 10) && from === 0 && to === 9));

  // Not recruited: refused.
  registrar.assign(player, 0, JENKINS);
  assert.equal(player.messages().at(-1), "You haven't recruited that crew member, so you can't add them to your current crew.");

  recruited(player, JIM, JENKINS);
  registrar.assign(player, 1, JIM);
  assert.equal(player.varbits.get(VARBIT.SLOT0 + 1), JIM);
  registrar.assign(player, 0, JIM);
  assert.equal(player.varbits.get(VARBIT.SLOT0), JIM, "moved to the first slot");
  assert.equal(player.varbits.get(VARBIT.SLOT0 + 1), 0);
  registrar.assign(player, 2, JENKINS);
  assert.equal(player.varbits.get(VARBIT.SLOT0 + 2), 0, "55 Sailing opens only two slots");
  common.update(player, (crew) => { crew.positions[0] = 10; });
  registrar.clear(player, 0);
  assert.equal(player.varbits.get(VARBIT.SLOT0), 0);
  assert.equal(player.varbits.get(VARBIT.SLOT0_POSITION), 0, "clearing a slot clears its job too");
});

/** Builds a facility (by name, any case) on the first hotspot that takes it, on `side` if given. */
function build(owned, name, side) {
  for (const hotspot of facilities.hotspotsOf(owned.type)) {
    if (side !== undefined && hotspot.side !== side) continue;
    const row = hotspot.allowed.find((candidate) => facilities.facilityRequirements(candidate).name.toLowerCase() === name);
    if (row === undefined) continue;
    facilities.setFacility(owned, hotspot.id, row);
    return hotspot;
  }
  throw new Error(`no hotspot takes ${name}`);
}

function boardSkiff(player, crewIds, { type = "skiff" } = {}) {
  recruited(player, ...crewIds);
  common.update(player, (crew) => crewIds.forEach((id, slot) => { crew.slots[slot] = id; }));
  Sailing.giveBoat(player, type, "the_pandemonium");
  assert.equal(Sailing.board(player, "the_pandemonium"), null);
  const boat = Sailing.instanceAboard(player);
  tick();
  return boat;
}

test("boarding brings the first slots' crew aboard, as many as the boat holds, back at their jobs", () => {
  const player = captain({ level: 99 });
  const boat = boardSkiff(player, [JENKINS, JIM, ADA]);
  try {
    const aboard = common.crewAboard(boat);
    assert.deepEqual(aboard.map((member) => member.crew.id), [JENKINS, JIM], "a skiff holds two (table 166)");
    const spec = BoatManager.getSpec(boat);
    for (const { npc } of aboard) {
      assert.equal(BoatManager.getBoatAboard(npc), boat, "on the deck");
      assert.ok(npc.canWalkThroughNPCs(), "players and other crew don't hold them off their jobs");
      assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()],
        [boat.deckBaseX + spec.boardingTile.x, boat.deckBaseY + spec.boardingTile.y], "on the boarding tile (rsprox)");
    }
    assert.equal(aboard[0].npc.getId(), 15343, "Jenkins's ship NPC");
    assert.equal(player.varbits.get(VARBIT.SIDEPANEL_SLOT0), JENKINS);
    assert.equal(player.varbits.get(VARBIT.SIDEPANEL_SLOT0 + 1), JIM);
    assert.equal(player.varbits.get(19613), 2, "Jenkins aboard: hidden at the Pandemonium");
    assert.equal(player.varbits.get(VARBIT.VISIBLE_JIM), 2);
    assert.equal(player.varbits.get(19494), 1, "Ada, left ashore, at the Pandemonium");
    // Walked anywhere on deck, their home goes too: the movement coordinator walks an NPC off its
    // home (no wander radius) straight back to it, which fought every step they took.
    const [first] = aboard;
    common.walkTo(first.npc, boat.deckBaseX + spec.boardingTile.x, boat.deckBaseY + spec.boardingTile.y + 1);
    const home = first.npc.getSpawnPosition();
    assert.deepEqual([home.getX(), home.getY()], [boat.deckBaseX + spec.boardingTile.x, boat.deckBaseY + spec.boardingTile.y + 1]);
  } finally {
    Sailing.disembark(player, "the_pandemonium");
  }
  assert.equal(common.crewAboard(boat).length, 0, "they leave with the boat");
  assert.equal(player.varbits.get(VARBIT.ON_DOCK), JENKINS, "the first slot's crewmate waits on the docks");
  assert.equal(player.varbits.get(19613), 3, "and not at the Pandemonium (rsprox)");
});

test("Command: the assignation menu lists the helm, repairs, the crew facilities and idle (rsprox)", () => {
  const player = captain({ level: 99 });
  const boat = boardSkiff(player, [JIM]);
  try {
    const [jim] = common.crewAboard(boat);
    prompts.length = 0;
    const owned = Sailing.activeBoat(player);
    assert.deepEqual(assign.crewFacilities(owned), [], "a new skiff has only its cargo hold");
    // Command, as the captain sees it (sidepanel role 10 turns the ship NPC into its Command form).
    player.varbits.set(19233, 10);
    PluginManager.emitNpcInteraction({ player, npc: jim.npc, clickType: 1, handled: false });
    const menu = prompts.at(-1);
    assert.equal(menu.title, "Crewmate Assignation: Jobless Jim (H2 P1 D3)");
    assert.deepEqual(menu.labels, ["Helm and sails (H1).", "Repairs (D1).", "Current - Idle."]);

    // A mithril salvaging hook on a hotspot: listed by name (one facility, no side on a skiff).
    build(owned, "mithril salvaging hook");
    const jobs = assign.crewFacilities(owned);
    assert.deepEqual(jobs.map((job) => [job.label, job.requirement]), [["Mithril salvaging hook", [3, 2]]]);
    assert.equal(assign.optionLabel(jobs[0], false), "Mithril salvaging hook (D2).");
    assert.equal(assign.orderLine(jim, jobs[0]), "Jobless Jim, take control of the mithril salvaging hook!", "rsprox");
    assert.equal(assign.orderLine(jim, { position: 0 }), "Jobless Jim, take a rest!", "rsprox");
  } finally {
    Sailing.disembark(player, "the_pandemonium");
  }
});

test("a sloop names its sides: starboard before port, facilities by crew_facility (rsprox)", () => {
  const owned = { type: "sloop", parts: {}, facilities: [] };
  build(owned, "adamant salvaging hook", 3);
  build(owned, "adamant salvaging hook", 1);
  const labels = assign.crewFacilities(owned).map((job) => assign.optionLabel(job, false));
  assert.deepEqual(labels, ["Starboard side adamant salvaging hook (D2).", "Port side adamant salvaging hook (D2)."]);
  assert.deepEqual(assign.helmJob(owned).requirement, [1, 3], "a sloop's helm needs H3 (table 181)");
});

test("a crewmate below a facility's stat is refused: 'Your crewmate requires N <stat> to use that facility.'", () => {
  const player = captain({ level: 99 });
  const boat = boardSkiff(player, [ADA]);
  try {
    const [ada] = common.crewAboard(boat);
    const owned = Sailing.activeBoat(player);
    build(owned, "mithril salvaging hook");
    const job = assign.crewFacilities(owned)[0];
    assign.order(player, boat, owned, ada, job);
    assert.equal(player.messages().at(-1), "Your crewmate requires 2 Deckhandiness to use that facility.");
    assert.equal(ada.position, 0);
  } finally {
    Sailing.disembark(player, "the_pandemonium");
  }
});

test("helm and sails: the crewmate takes the helm, the captain steers, sails go up 3 ticks after they arrive (rsprox)", () => {
  const player = captain({ level: 99 });
  const boat = boardSkiff(player, [JENKINS]);
  try {
    const [jenkins] = common.crewAboard(boat);
    const owned = Sailing.activeBoat(player);
    assign.order(player, boat, owned, jenkins, assign.helmJob(owned));
    assert.equal(player.said.at(-1), "Cabin Boy Jenkins, take control of the helm and sails!");
    assert.equal(player.varbits.get(VARBIT.SLOT0_POSITION), 4, "helm and sails (rsprox)");
    assert.equal(player.varbits.get(VARBIT.SIDEPANEL_POSITION0), 4);
    assert.equal(boat.helmCrew, jenkins.npc);
    assert.equal(player.varbits.get(VARBIT.HELM_STATUS), 3, "crew at the helm (rsprox)");
    assert.equal(BoatManager.steers(player, boat), true, "the captain's sea clicks steer");
    assert.equal(BoatManager.steerToward(player, boat.deckBaseX + 2, boat.deckBaseY + 2), false, "deck clicks walk");
    // The walk gives up at the timeout here (no NPC movement in tests) and places them.
    tick(20);
    assert.notEqual(player.varbits.get(VARBIT.MOVE_MODE), 2, "not yet");
    tick(3);
    assert.equal(player.varbits.get(VARBIT.MOVE_MODE), 2, "full sail");
    assert.ok(player.sent.some(([key, id]) => key === "sendSoundEffect" && id === 11089), "the crewmate's raise sound");

    // The captain takes the helm: the crewmate goes idle, the sails stay set.
    PluginManager.emitCustomEvent("sailing:helm-taken", { player, boat });
    assert.equal(boat.helmCrew, undefined);
    assert.equal(jenkins.position, 0);
    assert.equal(player.varbits.get(VARBIT.SLOT0_POSITION), 0);
    assert.equal(player.varbits.get(VARBIT.MOVE_MODE), 2);
  } finally {
    Sailing.disembark(player, "the_pandemonium");
  }
});

test("a crewmate at the helm trims each gust 3 ticks in; the captain gets their H share of the trim's XP", () => {
  const player = captain({ level: 99 });
  const boat = boardSkiff(player, [JENKINS]);
  try {
    const [jenkins] = common.crewAboard(boat);
    const owned = Sailing.activeBoat(player);
    owned.parts = { ...(owned.parts ?? {}), sails: 2 }; // teak: 30 XP a trim (Wiki)
    assign.order(player, boat, owned, jenkins, assign.helmJob(owned));
    const trim = require("../plugins/skills/sailing/Trim.Helm");
    tick(23); // arrived and set sail
    tick(trim.FIRST_GUST_DELAY);
    assert.ok(player.messages().includes("You feel a gust of wind."));
    player.xp.length = 0;
    tick(trim.CREW_TRIM_TICKS);
    assert.deepEqual(player.xp, [15], "H2: half of teak's 30 (rsprox: +15)");
    assert.equal(player.messages().at(-1), "You gain some experience by watching your crew work.");
    assert.ok(!player.messages().includes("You trim the sails, catching the wind for a burst of speed!"));
    assert.ok(boat.boostSpeed !== undefined, "the boost");
  } finally {
    Sailing.disembark(player, "the_pandemonium");
  }
});

test("the trimming lines come from the transcripts: Jim's own, Jenkins's at-sea ones", () => {
  assert.equal(lines.lineFor(common.byId(JIM), "trim"), "Trimmed those sails good and proper, Captain!");
  assert.equal(lines.lineFor(common.byId(JIM), "salvaged"), "Managed to hook some salvage! I'll put it in the cargo hold.");
  assert.equal(lines.lineFor(common.byId(JIM), "holdFull"), "The cargo hold is full. I can't salvage anything.");
  assert.match(lines.lineFor(common.byId(JENKINS), "trim", () => 0), /^Wo+/);
});

test("a crewmate on a salvaging hook casts at a wreck in range and fills the cargo hold (rsprox)", () => {
  const shipwrecks = require("../plugins/skills/sailing/Shipwrecks.Salvaging");
  const salvaging = require("../plugins/skills/sailing/Salvaging.plugin");
  const player = captain({ level: 99 });
  recruited(player, JIM);
  common.update(player, (crew) => { crew.slots[0] = JIM; });
  const owned = Sailing.giveBoat(player, "skiff", "the_pandemonium");
  const hotspot = build(owned, "mithril salvaging hook");
  assert.equal(Sailing.board(player, "the_pandemonium"), null);
  const boat = Sailing.instanceAboard(player);
  tick();
  try {
    const [jim] = common.crewAboard(boat);
    shipwrecks.start();
    const loc = BoatManager.getSpec(boat).locs.find((candidate) => candidate.hotspot === hotspot.id);
    const at = salvaging.hookTile(boat, loc);
    const wreck = shipwrecks.all().find((candidate) => candidate.raised);
    Object.assign(wreck, { x: at.x + 2, y: at.y, z: at.level });
    const job = assign.crewFacilities(owned)[0];
    assign.order(player, boat, owned, jim, job);
    assert.equal(player.varbits.get(VARBIT.SLOT0_POSITION), 6 + hotspot.id, "hotspot positions are 6 + n (rsprox: 10 on hotspot 4)");
    const animations = [];
    jim.npc.performAnimation = (animation) => animations.push(animation.getId());
    tick(21);
    assert.ok(animations.includes(1180), "the crew's cast on a 2x5 hook (rsprox)");
    const salvage = shipwrecks.wreckType(wreck.type).salvage;
    const before = owned.cargo.filter((slot) => slot?.id === salvage).length;
    const random = Math.random;
    Math.random = () => 0;
    try { tick(10); } finally { Math.random = random; }
    assert.ok(owned.cargo.filter((slot) => slot?.id === salvage).length > before, "salvage in the cargo hold");
    assert.ok(player.messages().includes("You gain some experience by watching your crew work."));
    assert.ok(animations.includes(13577), "the hook's idle every 5 ticks");
  } finally {
    Sailing.disembark(player, "the_pandemonium");
  }
});

test("the crew is saved on the player: who is met, recruited, in each slot and doing what", () => {
  const player = captain({ level: 99 });
  recruited(player, JIM);
  common.update(player, (crew) => { crew.slots[0] = JIM; crew.positions[0] = 4; });
  const saved = player.getAttribute(common.CREW_ATTRIBUTE);
  assert.deepEqual(saved.recruited, [JIM]);
  assert.deepEqual(common.state(player).slots, [JIM, 0, 0, 0, 0]);
  assert.deepEqual(common.state(player).positions, [4, 0, 0, 0, 0]);
  player.setAttribute(common.CREW_ATTRIBUTE, { slots: [1, "x"], positions: null });
  assert.deepEqual(common.state(player).slots, [1, 0, 0, 0, 0], "a damaged save is read safely");
});

test("Captain Siad heads for the boat when a slot is free, under the name the message gives (rsprox)", () => {
  const player = captain({ level: 99 });
  const event = { player, npcId: 15049, kind: "message", text: "You recruit Captain Siad as a crew member. He departs for the Pandemonium.", handled: false };
  // The Tourist Trap isn't done here: answer it as the quest plugin would.
  const answer = (request) => { if (request.key === "the_tourist_trap") request.complete = true; };
  api.onCustomEvent("quest:is-complete", answer);
  api.emitCustomEvent("npc-dialogue:action", event);
  assert.equal(common.slotOf(player, 9), 0, "the first free slot");
  assert.match(player.messages().at(-1), /^<col=06600c>You have recruited Captain Siad as a crew member\.<\/col>$/);
  tick(4);
  const box = player.dialogue().getDialogues().get(0);
  assert.equal(box.getText(), "You recruit Captain Siad as a crew member. He heads off in search of your boat.");
});

test("boarding with more crew than the boat holds says so (rsprox)", () => {
  const player = captain({ level: 99 });
  const boat = boardSkiff(player, [JENKINS, JIM, ADA]);
  try {
    assert.ok(player.messages().includes("One or more members of your crew cannot board this boat due to its limited size."));
  } finally {
    Sailing.disembark(player, "the_pandemonium");
  }
  void boat;
});

test("Repairs with no repair kits aboard: refused 2 ticks after the order, back to idle (rsprox)", () => {
  const player = captain({ level: 99 });
  const boat = boardSkiff(player, [JIM]);
  try {
    const [jim] = common.crewAboard(boat);
    const owned = Sailing.activeBoat(player);
    const said = [];
    jim.npc.forceChat = (text) => said.push(text);
    assign.order(player, boat, owned, jim, assign.jobAt(owned, common.POSITION.REPAIRS));
    assert.equal(player.said.at(-1), "Jobless Jim, make repairs!", "rsprox");
    assert.equal(player.varbits.get(VARBIT.SLOT0_POSITION), 5);
    tick(2);
    assert.equal(player.messages().at(-1), "Your crew can only make repairs if the boat has repair kits in its cargo hold.");
    assert.equal(player.varbits.get(VARBIT.SLOT0_POSITION), 0);
    assert.deepEqual(said, ["I can't find any repair kits in the cargo hold."]);
  } finally {
    Sailing.disembark(player, "the_pandemonium");
  }
});

test("the crew tab's radio buttons show the players (0) or the crew (2) (rsprox)", () => {
  const player = captain();
  const click = (slot) => PluginManager.emitInterfaceActionClick({
    player, buttonId: (937 << 16) | 38, groupId: 937, childId: 38, slot, action: 1, handled: false,
  });
  click(2);
  assert.equal(player.varbits.get(19234), 1);
  click(0);
  assert.equal(player.varbits.get(19234), 0);
});

test("a crewmate on a hook won't salvage a wreck above the captain's level, and says so once", () => {
  const shipwrecks = require("../plugins/skills/sailing/Shipwrecks.Salvaging");
  const salvaging = require("../plugins/skills/sailing/Salvaging.plugin");
  const player = captain({ level: 99 });
  recruited(player, JIM);
  common.update(player, (crew) => { crew.slots[0] = JIM; });
  const owned = Sailing.giveBoat(player, "skiff", "the_pandemonium");
  const hotspot = build(owned, "mithril salvaging hook");
  assert.equal(Sailing.board(player, "the_pandemonium"), null);
  const boat = Sailing.instanceAboard(player);
  tick();
  try {
    const [jim] = common.crewAboard(boat);
    const said = [];
    jim.npc.forceChat = (text) => said.push(text);
    shipwrecks.start();
    const loc = BoatManager.getSpec(boat).locs.find((candidate) => candidate.hotspot === hotspot.id);
    const at = salvaging.hookTile(boat, loc);
    const wreck = shipwrecks.all().find((candidate) => candidate.raised && shipwrecks.wreckType(candidate.type).level > 50);
    Object.assign(wreck, { x: at.x + 2, y: at.y, z: at.level });
    assign.order(player, boat, owned, jim, assign.crewFacilities(owned)[0]);
    player.levels.set(SAILING, 50);
    tick(25);
    assert.deepEqual(said.filter((line) => /complicated/.test(line)), ["Afraid that ship is a bit too complicated for me to salvage."]);
  } finally {
    Sailing.disembark(player, "the_pandemonium");
  }
});

test("Bank-cargo moves what fits from the hold to the bank, keeping the rest in the hold", () => {
  const bankCargo = require("../plugins/skills/sailing/crew/BankCargo.Crew");
  const MAX = 2147483647;
  /** A bank holding `held` (id -> amount) with `free` empty slots, capped at the max stack as the real one. */
  const bankOf = (held, free) => {
    const bank = {
      held: new Map(Object.entries(held).map(([id, amount]) => [Number(id), amount])),
      getAddableAmount: (item) => bank.held.has(item.getId())
        ? Math.min(item.getAmount(), MAX - bank.held.get(item.getId()))
        : free > 0 ? item.getAmount() : 0,
      add: (item) => { bank.held.set(item.getId(), (bank.held.get(item.getId()) ?? 0) + item.getAmount()); return bank; },
    };
    return bank;
  };
  const core = PluginManager.getCoreApi();
  const isOpen = core.Bank.isOpen;
  const tabFor = core.Bank.getTabForItem;
  core.Bank.isOpen = () => false;
  core.Bank.getTabForItem = () => 0;
  try {
    const bank = bankOf({}, 10);
    const boat = { cargo: [{ id: 2, amount: 50 }, null, { id: 385, amount: 1 }] };
    assert.equal(bankCargo.moveToBank({ getBank: () => bank }, boat), true);
    assert.deepEqual([...bank.held], [[2, 50], [385, 1]]);
    assert.deepEqual(boat.cargo, [null, null, null], "the hold is empty");

    const crowded = { cargo: [{ id: 2, amount: 5 }] };
    assert.equal(bankCargo.moveToBank({ getBank: () => bankOf({}, 0) }, crowded), false, "no room: it stays in the hold");
    assert.deepEqual(crowded.cargo, [{ id: 2, amount: 5 }]);

    // Review: a stack one short of the maximum takes 1 of 10 fishing bait; 9 stay in the hold.
    const nearlyFull = bankOf({ 313: MAX - 1 }, 10);
    const bait = { cargo: [{ id: 313, amount: 10 }] };
    assert.equal(bankCargo.moveToBank({ getBank: () => nearlyFull }, bait), false, "not all of it went");
    assert.equal(nearlyFull.held.get(313), MAX);
    assert.deepEqual(bait.cargo, [{ id: 313, amount: 9 }], "the rest stays in the hold");
  } finally {
    core.Bank.isOpen = isOpen;
    core.Bank.getTabForItem = tabFor;
  }
});

test("crewmates run to a job and walk when they wander (rsprox)", () => {
  const player = captain({ level: 99 });
  const boat = boardSkiff(player, [JIM]);
  try {
    const [jim] = common.crewAboard(boat);
    const spec = BoatManager.getSpec(boat);
    common.walkTo(jim.npc, boat.deckBaseX + spec.boardingTile.x, boat.deckBaseY + spec.boardingTile.y + 1, { run: true });
    assert.equal(jim.npc.getMovementSteps(), 2);
    common.walkTo(jim.npc, boat.deckBaseX + spec.boardingTile.x, boat.deckBaseY + spec.boardingTile.y);
    assert.equal(jim.npc.getMovementSteps(), 1);
  } finally {
    Sailing.disembark(player, "the_pandemonium");
  }
});

test("a crewmate's trim plays the area sound at the sail cloth (rsprox: 10807, range 5)", () => {
  const player = captain({ level: 99 });
  const boat = boardSkiff(player, [JENKINS]);
  try {
    const [jenkins] = common.crewAboard(boat);
    const owned = Sailing.activeBoat(player);
    assign.order(player, boat, owned, jenkins, assign.helmJob(owned));
    const trim = require("../plugins/skills/sailing/Trim.Helm");
    tick(23 + trim.FIRST_GUST_DELAY + trim.CREW_TRIM_TICKS);
    const area = player.sent.find(([key, id]) => key === "sendAreaSound" && id === 10807);
    assert.ok(area, "the area sound");
    assert.equal(area[7], 5, "range 5");
  } finally {
    Sailing.disembark(player, "the_pandemonium");
  }
});

test("::crew recruits by name or id, all, and resets", () => {
  const dev = require("../plugins/skills/sailing/crew/Dev.Crew");
  assert.equal(dev.findCrew("siad").id, 9);
  assert.equal(dev.findCrew("5").name, "Sailor Jakob");
  assert.equal(dev.findCrew("generic_2").name, "Adventurer Ada");
  const player = captain({ level: 99 });
  const run = (text) => dev.crewCommand({ player, raw: text, base: "crew", parts: text.split(" "), handled: false });
  run("crew jobless jim");
  assert.ok(common.isRecruited(player, 1));
  assert.equal(common.slotOf(player, 1), 0);
  run("crew all");
  assert.equal(common.state(player).recruited.length, 10);
  assert.equal(common.state(player).slots.filter(Boolean).length, 5, "five slots at 99");
  run("crew reset");
  assert.equal(common.state(player).recruited.length, 0);
  assert.equal(player.varbits.get(VARBIT.SLOT0), 0);
});

test("a crewmate works a hook from its own tile, facing out over the side (rsprox: skiff 3,2 and sloop 2,5, facing west)", () => {
  for (const type of ["skiff", "sloop"]) {
    const player = captain({ level: 99 });
    recruited(player, JIM);
    common.update(player, (crew) => { crew.slots[0] = JIM; });
    const owned = Sailing.giveBoat(player, type, "the_pandemonium");
    const hotspot = build(owned, "mithril salvaging hook", 1);
    assert.equal(Sailing.board(player, "the_pandemonium"), null);
    const boat = Sailing.instanceAboard(player);
    tick();
    try {
      const [jim] = common.crewAboard(boat);
      const hook = BoatManager.getSpec(boat).locs.find((loc) => loc.hotspot === hotspot.id);
      assign.order(player, boat, owned, jim, assign.crewFacilities(owned)[0]);
      tick(22);
      const here = jim.npc.getLocation();
      assert.deepEqual([here.getX() - boat.deckBaseX, here.getY() - boat.deckBaseY], [hook.x, hook.y], `${type}: on the hook`);
      const face = jim.npc.getPositionToFace();
      assert.deepEqual([face.getX() - boat.deckBaseX, face.getY() - boat.deckBaseY], [hook.x - 1, hook.y], `${type}: facing west`);
    } finally {
      Sailing.disembark(player, "the_pandemonium");
    }
  }
});

test("courier crates: Deckhandiness 3 or 4 carries 2, the rest 1 (Wiki), shared out in slot order", () => {
  const courier = require("../plugins/skills/sailing/crew/Courier.Crew");
  const crates = Object.fromEntries(common.all().map((crew) => [crew.name, courier.capacityOf(crew)]));
  assert.deepEqual(crates, {
    "Jobless Jim": 2, "Adventurer Ada": 1, "Jittery Jim": 1, "Jolly Jim": 2, "Sailor Jakob": crates["Sailor Jakob"],
    "Oarswoman Olga": 1, "Bosun Zarah": 1, "Spotter Virginia": 1, "Ex-Captain Siad": 2, "Cabin Boy Jenkins": 2,
  });
  const [jenkins, jim] = [common.byId(JENKINS), common.byId(JIM)];
  assert.deepEqual(courier.shareOut([jenkins, jim], 2).map((part) => [part.crew.id, part.amount]), [[JENKINS, 2]],
    "Jenkins alone takes the two left at pickup (rsprox)");
  assert.deepEqual(courier.shareOut([jenkins, jim], 3).map((part) => [part.crew.id, part.amount]), [[JENKINS, 2], [JIM, 1]],
    "and two of three at delivery, Jim the last (rsprox)");
  assert.deepEqual(jenkins.cargoNpcs, [15346, 15347, 15348], "his carrying forms, by crates held (table 173 cargo_npc)");
});

/** Jenkins on the Pandemonium's dock, carrying a courier task's crates for the player (Courier.Crew.js). */
function crewPickup(player, taskId) {
  const portTasks = require("../plugins/skills/sailing/porttasks/Common.PortTasks");
  recruited(player, JENKINS);
  common.update(player, (crew) => { crew.slots[0] = JENKINS; });
  Sailing.giveBoat(player, "skiff", "the_pandemonium");
  portTasks.setSlots(player, [{ id: taskId, taken: 1, delivered: 0 }, null, null, null, null]);
  const task = portTasks.taskById(taskId);
  const event = { player, index: 0, task, dock: { id: "the_pandemonium" }, left: task.amount - 1, helped: 0 };
  PluginManager.emitCustomEvent("port-tasks:cargo-taken", event);
  return { portTasks, task, event };
}

/** The NPCs carrying for the player: the crewmates' carrying forms, still in the world. */
function carriers(player) {
  return [...World.getNpcs()].filter((npc) => npc?.isRegistered?.() && [15346, 15347, 15348].includes(npc.getId()));
}

test("cancelling a courier task the crew carry for drops their crates, and a reused slot isn't credited (review)", () => {
  const player = captain({ level: 99 });
  player.getPrivateArea = () => null;
  const { portTasks, event } = crewPickup(player, 31);
  assert.equal(event.helped, 2, "Jenkins carries the two left");
  assert.equal(carriers(player).length, 1);
  PluginManager.emitCustomEvent("port-tasks:cancelled", { player, index: 0, task: portTasks.taskById(31) });
  assert.equal(carriers(player).length, 0, "he goes");
  assert.equal(portTasks.crewAmount(player, 0), 0);

  // A slot reused without the event (as before the fix): boarding packs nothing for the new task.
  crewPickup(player, 31);
  portTasks.setSlots(player, [{ id: 20, taken: 0, delivered: 0 }, null, null, null, null]);
  assert.equal(Sailing.board(player, "the_pandemonium"), null);
  tick(2);
  try {
    const owned = Sailing.activeBoat(player);
    assert.deepEqual(owned.cargo.filter(Boolean), [], "no cancelled crates in the hold");
    assert.equal(portTasks.slots(player)[0].taken, 0, "the new task isn't credited");
    assert.equal(carriers(player).length, 0);
  } finally {
    Sailing.disembark(player, "the_pandemonium");
  }
});

test("logging out with crew carrying crates removes them (review)", () => {
  const player = captain({ level: 99 });
  player.getPrivateArea = () => null;
  const { portTasks } = crewPickup(player, 31);
  assert.equal(carriers(player).length, 1);
  PluginManager.emitPlayerLogout({ player, username: "captain" });
  tick(5);
  assert.equal(carriers(player).length, 0, "no carrier left behind");
  assert.equal(portTasks.crewAmount(player, 0), 0);
});
