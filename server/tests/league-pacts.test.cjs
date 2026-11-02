// Run after `yarn build`: node --test tests/league-pacts.test.cjs
// Demonic Pacts' pact tree (docs/leagues.md, Demonic Pacts): the cache's nodes and their effect
// varbits, a new character's points and resets, the captured open, buy, reopen and reset, pact
// points from pact tasks, the Hueycoatl's reset, and that nobody but a Demonic Pacts character has any.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");
const pactsData = require("../plugins/modes/data/league-pacts.json");

const TREE = 647;
const SIDE_PANEL = 656;
const FLOATER = (161 << 16) | 18;
const OP1 = 1 << 1;
const TRIGGER = 1 << 23;
const uid = (group, child) => (group << 16) | child;
let core;
let Common;
let Interface;
let Points;
const hooks = {};
const custom = {};
let worldLeague = 6;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league");
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => {
      let result;
      for (const attached of lists[name]) {
        const answer = attached(event);
        if (answer !== undefined && answer !== false) result = answer;
        else if (result === undefined) result = answer;
      }
      return result;
    };
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    getSkillManager: () => SkillManager,
    getPluginConfig: (key, fallback) => (key === "league:type" ? worldLeague : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    onInterfaceActionButton: (ids, handler) => { for (const id of [].concat(ids)) on(`button:${id}`)(handler); },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => { for (const handler of custom[name] ?? []) handler(payload); },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  custom["quest:is-complete"] = [(request) => { request.complete = false; }];
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueTasks.plugin").register(api);
  require("../plugins/modes/LeaguePacts.plugin").register(api);
  Common = require("../plugins/modes/leaguepacts/Common.LeaguePacts");
  Interface = require("../plugins/modes/leaguepacts/Interface.LeaguePacts");
  Points = require("../plugins/modes/leaguepacts/Points.LeaguePacts");
});

function character(name, profile = "league") {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setRegistered(true);
  const sent = { messages: [], varbits: new Map(), varps: new Map(), order: [], sounds: [], removals: 0, dialogues: [] };
  const sender = new Proxy({}, {
    get: (target, key) => {
      switch (key) {
        case "sendVarbit": return (id, value) => (sent.varbits.set(id, value), sent.order.push(["varbit", id, value]), sender);
        case "sendConfig": return (id, value) => (sent.varps.set(id, value), sent.order.push(["varp", id, value]), sender);
        case "sendSubInterface": return (...args) => (sent.order.push(["sub", ...args]), sender);
        case "sendInterfaceFlagsRange": return (...args) => (sent.order.push(["flags", ...args]), sender);
        case "sendInterfaceScript": return (id, args = []) => (sent.order.push(["script", id, ...args]), sender);
        case "sendInterfaceRemoval": return () => (sent.removals++, sent.order.push(["removal"]), sender);
        case "closeInterface": return (group) => (sent.order.push(["close", group]), sender);
        case "sendSound": return (...args) => (sent.sounds.push(args), sender);
        case "isSubInterfaceOpen": return () => true;
        default: return () => sender;
      }
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => (sent.messages.push(text), sent.order.push(["message", text]));
  player.getDialogueManager = () => ({ startDialogues: (builder) => sent.dialogues.push(builder) });
  hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  return Object.assign(player, { sent });
}

const varbit = (name) => CacheDefinitions.getVarbitId(name);
const varp = (name) => CacheDefinitions.getVarpId(name);
/** if_triggeroplocal's ints as the client encodes them: zigzag varints. */
/** Apply Changes' int array as the real client writes it: plain unsigned varints (RuneLite: [1, 126]). */
function trigger(...ints) {
  const bytes = [];
  for (const int of ints) {
    let value = int >>> 0;
    do {
      let byte = value & 0x7f;
      value >>>= 7;
      if (value) byte |= 0x80;
      bytes.push(byte);
    } while (value);
  }
  return bytes;
}
const openTree = (player) => hooks[`button:${uid(SIDE_PANEL, 32)}`]({ player });
/** A node bought from the open tree (a buy closes it until it comes back). */
const buyNode = (player, index) => {
  openTree(player);
  return hooks[`button:${uid(TREE, 11)}`]({ player, scriptTrigger: true, argsData: trigger(1, index * 2) });
};
const ticks = (n) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };

test("the tree is the cache's: 132 nodes, linked both ways, each effect a mapped varbit", () => {
  const { nodes } = Common;
  assert.equal(nodes.length, 132);
  for (const node of nodes) {
    for (const link of node.links) assert.ok(nodes[link].links.includes(node.index), `${node.index} <-> ${link}`);
    assert.ok(Number.isInteger(varbit(node.varbit)), node.varbit);
  }
  assert.deepEqual([nodes[0].varbit, nodes[0].value], ["talent_regen_ammo_chance", 50], "the central pact: 50% Regenerate");
  // The recorded buys: node 63 raised talent_distance_melee_minhit by 3, node 61 set light_weapon_doublehit (237/01098).
  assert.deepEqual([nodes[63].varbit, nodes[63].value], ["talent_distance_melee_minhit", 3]);
  assert.equal(nodes[61].varbit, "talent_light_weapon_doublehit");
  assert.equal(new Set(Object.values(pactsData.effects)).size, Object.keys(pactsData.effects).length, "one varbit per effect");
});

test("a new Demonic Pacts character: no point yet, two free resets (both flagged), sent at login in the recorded order", () => {
  const pacts = character("pactnew");
  assert.equal(Common.earned(pacts), 0, "the tutorial's two points are its pact tasks (237/01098)");
  assert.equal(Common.resets(pacts), 2);
  assert.equal(pacts.sent.varps.get(varp("talent_points_earned")), 0);
  assert.equal(pacts.sent.varps.get(varp("talent_points_spent")), 0);
  assert.equal(pacts.sent.varbits.get(varbit("talent_resets_available")), 2);
  assert.equal(pacts.sent.varbits.get(varbit("talent_free_reset_1")), 1);
  assert.equal(pacts.sent.varbits.get(varbit("talent_free_reset_2")), 1);
  assert.equal(pacts.sent.varbits.get(varbit("talent_huey_pact_reset")), 0);
  assert.equal(pacts.sent.varbits.get(varbit("talent_regen_ammo_chance")), 0, "every effect varbit, zero");
  // 237/01170, 238/01223: earned, the free resets' and the Hueycoatl's flags, the resets, spent, the unlock varps, the effects.
  const tree = new Set([varp("talent_points_earned"), varp("talent_points_spent"), ...Common.ids.unlocked]);
  const flags = new Set(["talent_free_reset_1", "talent_huey_pact_reset", "talent_free_reset_2", "talent_resets_available"].map(varbit));
  const order = pacts.sent.order
    .filter(([kind, id]) => (kind === "varp" && tree.has(id)) || (kind === "varbit" && (flags.has(id) || id === varbit("talent_regen_ammo_chance"))))
    .map(([kind, id]) => (kind === "varp" ? CacheDefinitions.getVarpName?.(id) ?? id : id));
  assert.deepEqual(order.slice(0, 6), [
    CacheDefinitions.getVarpName?.(varp("talent_points_earned")) ?? varp("talent_points_earned"),
    varbit("talent_free_reset_1"), varbit("talent_huey_pact_reset"), varbit("talent_free_reset_2"), varbit("talent_resets_available"),
    CacheDefinitions.getVarpName?.(varp("talent_points_spent")) ?? varp("talent_points_spent"),
  ]);
  assert.equal(order.at(-1), varbit("talent_regen_ammo_chance"), "the effects last");
});

test("the tutorial's two pact tasks give its two points with their lines: 'Demonic Pact' for the first, plural after", () => {
  const pacts = character("pacttutorial");
  for (const id of ["open-the-leagues-menu", "complete-the-leagues-tutorial"]) {
    for (const handler of custom["league:complete-task"]) handler({ player: pacts, id });
  }
  assert.equal(Common.earned(pacts), 2);
  const lines = pacts.sent.messages.filter((line) => line.includes("Demonic Pact"));
  assert.deepEqual(lines, [
    "<col=229628>Congratulations, you've earned a Demonic Pact! You now have 1 Demonic Pact to spend.</col>",
    "<col=229628>Congratulations, you've earned a Demonic Pact! You now have 2 Demonic Pacts to spend.</col>",
  ], "237/01098 (its second line said 1: the central pact was bought in between)");
});
test("View Demonic Pacts opens the tree as captured; a bought node pays, sets its bit and effect, plays the unlock, and the tree comes back", () => {
  const pacts = character("pactbuyer");
  pacts.setAttribute(Common.POINTS_ATTRIBUTE, 1);
  pacts.sent.order.length = 0;
  assert.equal(hooks[`button:${uid(SIDE_PANEL, 32)}`]({ player: pacts }), true);
  const shown = pacts.sent.order.filter(([kind]) => ["removal", "sub", "flags", "script"].includes(kind));
  assert.deepEqual(shown, [
    ["removal"],
    ["script", 3186, uid(SIDE_PANEL, 31)],
    ["sub", FLOATER, TREE, 1],
    ["flags", uid(TREE, 5), 11, 11, OP1],
    ["flags", uid(TREE, 11), -1, -1, TRIGGER],
    ["flags", uid(TREE, 20), -1, -1, OP1 | TRIGGER],
    ["script", 7892, 1],
    ["script", 9397],
  ], "the modal closed, the pulse stopped, the floater, its events, talent_tree_init and 9397 (237/01098)");

  assert.equal(buyNode(pacts, 5), true);
  assert.deepEqual(Common.pacts(pacts), [], "the first pact is the central one");
  assert.match(pacts.sent.messages.at(-1), /not linked/);

  pacts.sent.order.length = 0;
  assert.equal(hooks[`button:${uid(TREE, 11)}`]({ player: pacts, scriptTrigger: true, argsData: trigger(1, 0) }), true);
  assert.deepEqual(trigger(1, 126), [1, 126], "the bytes RuneLite sent through the gateway for node 63");
  assert.deepEqual(trigger(1, 212), [1, 0xd4, 0x01], "recorded as [1, -44, 1]");
  assert.deepEqual(Common.pacts(pacts), [0]);
  assert.deepEqual(pacts.sent.order.slice(0, 3), [
    ["varp", varp("talent_points_spent"), 1], ["varp", varp("combat_mastery_perm_0"), 1], ["varbit", varbit("talent_regen_ammo_chance"), 50],
  ], "as recorded: spent, the unlock bit, the effect");
  assert.equal(pacts.getAnimation()?.getId(), CacheDefinitions.getSeqId("human_relic_unlock"));
  assert.equal(pacts.getGraphic()?.getId(), CacheDefinitions.getSpotanimId("leagues_6_mastery_unlock"));
  assert.ok(pacts.sent.order.some(([kind, group]) => kind === "close" && group === TREE), "the tree closes");
  assert.deepEqual(pacts.sent.sounds.slice(-4), [[4215, 1, 8], [4211, 1, 44], [4213, 1, 80], [4212, 1, 104]]);
  pacts.sent.order.length = 0;
  ticks(5);
  assert.ok(pacts.sent.order.some(([kind, , group]) => kind === "sub" && group === TREE), "back five ticks later");

  assert.equal(buyNode(pacts, Common.nodes[0].links[0]), true);
  assert.equal(Common.pacts(pacts).length, 1, "no point left to spend");
  assert.match(pacts.sent.messages.at(-1), /no pact points/);
  assert.equal(hooks[`button:${uid(TREE, 11)}`]({ player: pacts, scriptTrigger: true, argsData: trigger(1, 3) }), true, "3 zigzag-decodes to -2: no node");
  assert.equal(Common.pacts(pacts).length, 1);
});

test("Apply Changes buys every selected pact in order, one linked to the next, with one unlock", () => {
  const pacts = character("pactapply");
  pacts.setAttribute(Common.POINTS_ATTRIBUTE, 5);
  const second = Common.nodes[0].links[0];
  const third = Common.nodes[second].links.find((link) => link !== 0 && !Common.nodes[0].links.includes(link));
  openTree(pacts);
  pacts.sent.sounds.length = 0;
  hooks[`button:${uid(TREE, 11)}`]({ player: pacts, scriptTrigger: true, argsData: trigger(3, 0, second * 2, third * 2) });
  assert.deepEqual(Common.pacts(pacts), [0, second, third], "the central pact, then one linked to it, then one linked to that");
  assert.equal(pacts.sent.varps.get(varp("talent_points_spent")), 3);
  assert.equal(pacts.sent.sounds.length, 4, "one unlock's sounds for the selection");
  assert.equal(pacts.sent.varbits.get(varbit("busy")), 1, "busy until the tree is back, as recorded");
  ticks(5);
  assert.equal(pacts.sent.varbits.get(varbit("busy")), 0);
});

test("the tree comes back after a buy only if it was up and nothing else opened since", () => {
  const pacts = character("pactreopen");
  const shown = () => pacts.sent.order.filter(([kind, , group]) => kind === "sub" && group === TREE).length;
  Interface.buy(pacts, 0);
  ticks(5);
  assert.equal(shown(), 0, "a buy without the tree up (::pacts buy) opens nothing");
  pacts.setAttribute(Common.POINTS_ATTRIBUTE, 5);
  openTree(pacts);
  const before = shown();
  hooks[`button:${uid(TREE, 11)}`]({ player: pacts, scriptTrigger: true, argsData: trigger(1, Common.nodes[0].links[0] * 2) });
  for (const handler of custom["interface:opened"] ?? []) handler({ player: pacts, groupId: 12, targetUid: 0, type: 0 });
  ticks(5);
  assert.equal(shown(), before, "the bank opened in between: it stays closed");
});

test("a league screen opening as the main modal closes the tree, as recorded", () => {
  const pacts = character("pactmodal");
  openTree(pacts);
  pacts.sent.order.length = 0;
  for (const handler of custom["league:modal-opening"]) handler({ player: pacts, group: 655 });
  assert.ok(pacts.sent.order.some(([kind, group]) => kind === "close" && group === TREE));
  pacts.sent.messages.length = 0;
  openTree(pacts);
  assert.ok(!pacts.sent.messages.includes("The Demonic Pacts interface is already open."), "it opens again");
});

test("a pact task gives a point with the captured line; sharing an effect adds up; the cap on spending", () => {
  const pacts = character("pacttasker");
  const giant = require("../plugins/modes/data/league-tasks.json").leagues["6"].tasks.find((task) => task.id === "defeat-a-hill-giant");
  assert.equal(giant.pactTask, true);
  hooks.onNpcDeath({ killer: pacts, npc: { getCurrentDefinition: () => ({ getName: () => "Hill Giant" }), getMaxHitpoints: () => 10 }, npcId: 0, location: { x: 0, y: 0, z: 0 } });
  const lines = pacts.sent.messages.slice(-2);
  assert.match(lines[0], /^Congratulations, you've completed an easy task: .*Defeat a Hill Giant/);
  assert.equal(lines[1], "<col=229628>Congratulations, you've earned a Demonic Pact! You now have 1 Demonic Pact to spend.</col>", "after the task's own line");
  assert.equal(Common.earned(pacts), 1);
  assert.equal(pacts.sent.varps.get(varp("talent_points_earned")), 1);

  const sameEffect = Common.nodes.filter((node) => node.varbit === "talent_regen_ammo_chance").map((node) => node.index);
  pacts.setAttribute(Common.POINTS_ATTRIBUTE, 60);
  Common.save(pacts, [0]);
  const linkedRegen = Common.nodes[0].links.find((link) => sameEffect.includes(link)) ?? null;
  if (linkedRegen !== null) {
    buyNode(pacts, linkedRegen);
    assert.equal(pacts.sent.varbits.get(varbit("talent_regen_ammo_chance")), 50 + Common.nodes[linkedRegen].value, "values on one effect add up");
  }
  // Forty spent at most, whatever was earned.
  const reachable = [];
  const seen = new Set(Common.pacts(pacts));
  const queue = [...seen];
  while (queue.length && seen.size < 45) {
    for (const link of Common.nodes[queue.shift()].links) if (!seen.has(link)) { seen.add(link); queue.push(link); reachable.push(link); }
  }
  for (const index of reachable) buyNode(pacts, index);
  assert.equal(Common.pacts(pacts).length, 40);
  assert.match(pacts.sent.messages.at(-1), /more than 40/);
  assert.equal(Common.spendable(pacts), 0);
});

test("the panel's reset: the captured message and Yes / No; Yes clears every pact and effect and uses a reset", () => {
  const pacts = character("pactresetter");
  pacts.setAttribute(Common.POINTS_ATTRIBUTE, 1);
  buyNode(pacts, 0);
  openTree(pacts);
  assert.equal(hooks[`button:${uid(TREE, 20)}`]({ player: pacts, scriptTrigger: true, argsData: [] }), true);
  const [builder] = pacts.sent.dialogues;
  assert.ok(builder, "the reset asks first");
  pacts.sent.dialogues.length = 0;
  assert.equal(Interface.reset(pacts), true);
  assert.deepEqual(Common.pacts(pacts), []);
  assert.equal(Common.resets(pacts), 1);
  assert.equal(pacts.sent.varps.get(varp("talent_points_spent")), 0);
  assert.equal(pacts.sent.varps.get(varp("combat_mastery_perm_0")), 0);
  assert.equal(pacts.sent.varbits.get(varbit("talent_regen_ammo_chance")), 0);
  assert.equal(pacts.sent.varbits.get(varbit("talent_resets_available")), 1);
  assert.equal(pacts.sent.dialogues.length, 1, "Demonic Pacts have been reset, you have 1 points to spend.");
  assert.equal(Interface.reset(pacts), false, "nothing to reset");
});

test("reset tasks: the Hueycoatl's first kill and the unique-echo-boss tasks give their point, then a reset with the captured line, once", () => {
  const pacts = character("pacthuey");
  const complete = (id) => { for (const handler of custom["league:complete-task"]) handler({ player: pacts, id }); };
  complete("defeat-hueycoatl-1-time");
  assert.equal(Common.earned(pacts), 1, "the task's point (237/04052)");
  assert.equal(Common.resets(pacts), 3);
  assert.equal(pacts.sent.varbits.get(varbit("talent_huey_pact_reset")), 1);
  assert.equal(pacts.sent.varbits.get(varbit("talent_resets_available")), 3);
  assert.deepEqual(pacts.sent.messages.slice(-2), [
    "<col=229628>Congratulations, you've earned a Demonic Pact! You now have 1 Demonic Pact to spend.</col>",
    "<col=229628>Congratulations, you've earned a Full Pact reset! You now have 3 Full Pact resets</col>",
  ], "237/01158's order: the point, then the reset");
  // The kill credit alone gives nothing any more: the task is the reset.
  for (const handler of custom["combat-achievements:kill"] ?? []) handler({ player: pacts, monster: "The Hueycoatl" });
  assert.equal(Common.resets(pacts), 3);
  for (const id of ["defeat-1-unique-echo-boss", "defeat-2-unique-echo-bosses", "defeat-3-unique-echo-bosses"]) complete(id);
  assert.equal(Common.resets(pacts), 6, "two free, the Hueycoatl's, three from echo bosses (Wiki)");
  complete("defeat-4-unique-echo-bosses");
  assert.equal(Common.resets(pacts), 6, "the fourth gives a point only");
  assert.equal(Common.earned(pacts), 5);
  Points.grantReset(pacts, "defeat-hueycoatl-1-time");
  assert.equal(Common.resets(pacts), 6, "once a task");
  const credited = character("pacthueyold");
  credited.setAttribute(Common.REWARDS_ATTRIBUTE, { ...Common.rewards(credited), hueycoatl: true });
  Points.grantReset(credited, "defeat-hueycoatl-1-time");
  assert.equal(Common.resets(credited), 2, "a character the old kill credit gave the reset to keeps just that one");
});
test("nobody but a Demonic Pacts character has pacts", () => {
  worldLeague = 5;
  const echoes = character("echoesnopacts");
  worldLeague = 6;
  const main = character("mainnopacts", "main");
  for (const player of [echoes, main]) {
    assert.equal(hooks[`button:${uid(SIDE_PANEL, 32)}`]({ player }), false);
    assert.equal(Common.effect(player, "talent_regen_ammo_chance"), 0);
    assert.equal(player.sent.varps.has(varp("talent_points_earned")), false);
  }
  const query = { player: echoes, effect: "talent_regen_ammo_chance" };
  for (const handler of custom["league:pact-effect"]) handler(query);
  assert.equal(query.value, 0);
});

test("every node is reachable from the central pact, and Apply Changes stops at an unlinked node", () => {
  const seen = new Set([pactsData.rootNode]);
  const queue = [pactsData.rootNode];
  while (queue.length) for (const link of Common.nodes[queue.shift()].links) if (!seen.has(link)) { seen.add(link); queue.push(link); }
  assert.equal(seen.size, 132, "the cache's tree is one piece from node 0");

  const pacts = character("pactunlinked");
  pacts.setAttribute(Common.POINTS_ATTRIBUTE, 5);
  const linked = Common.nodes[0].links[0];
  const far = Common.nodes.find((node) => node.index !== 0 && !node.links.includes(0) && !node.links.includes(linked)).index;
  const after = Common.nodes[linked].links.find((link) => link !== 0 && !Common.nodes[0].links.includes(link));
  openTree(pacts);
  hooks[`button:${uid(TREE, 11)}`]({ player: pacts, scriptTrigger: true, argsData: trigger(4, 0, linked * 2, far * 2, after * 2) });
  assert.deepEqual(Common.pacts(pacts), [0, linked], "the ones before it bought, it and the rest refused");
  assert.equal(pacts.sent.messages.at(-1), "That pact is not linked to one you have.");
  assert.equal(pacts.sent.varps.get(varp("talent_points_spent")), 2);
  assert.equal(Common.spendable(pacts), 3);

  const first = character("pactnoroot");
  first.setAttribute(Common.POINTS_ATTRIBUTE, 2);
  openTree(first);
  hooks[`button:${uid(TREE, 11)}`]({ player: first, scriptTrigger: true, argsData: trigger(2, linked * 2, 0) });
  assert.deepEqual(Common.pacts(first), [], "the first pact must be the central one, even with it later in the selection");
});

test("the cap: 40 spent whatever is earned, the points past it kept", () => {
  const pacts = character("pactcap");
  pacts.setAttribute(Common.POINTS_ATTRIBUTE, 44);
  assert.equal(Common.spendable(pacts), 40);
  const order = [];
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length && order.length < 41) {
    const index = queue.shift();
    order.push(index);
    for (const link of Common.nodes[index].links) if (!seen.has(link)) { seen.add(link); queue.push(link); }
  }
  for (const index of order) Interface.buy(pacts, index);
  assert.equal(Common.pacts(pacts).length, 40);
  assert.equal(Common.spendable(pacts), 0);
  assert.equal(pacts.sent.messages.at(-1), "You cannot spend more than 40 pact points.");
  Interface.reset(pacts);
  assert.equal(Common.spendable(pacts), 40, "a reset gives the 40 back, the 44 still earned");
  assert.equal(Common.earned(pacts), 44);
});

test("nobody else gets a pact point or reset from the pact and reset tasks", () => {
  worldLeague = 5;
  const echoes = character("echoesresettask");
  worldLeague = 6;
  for (const handler of custom["league:task-completed"]) handler({ player: echoes, league: 5, id: "defeat-hueycoatl-1-time", pactTask: true });
  assert.equal(Common.earned(echoes), 0);
  assert.equal(Common.resets(echoes), 0);
  assert.equal(echoes.sent.varbits.has(varbit("talent_resets_available")), false);
});

test("Apply Changes reads nodes zigzag-encoded, as the real client sends them: [1, 126] is node 63", () => {
  const pacts = character("pactzigzag");
  pacts.setAttribute(Common.POINTS_ATTRIBUTE, 3);
  buyNode(pacts, 0);
  ticks(5);
  openTree(pacts);
  // The web client once sent node 63 unsigned, [1, 63]: 63 zigzag-decodes to -32, no node.
  hooks[`button:${uid(TREE, 11)}`]({ player: pacts, scriptTrigger: true, argsData: [1, 63] });
  assert.deepEqual(Common.pacts(pacts), [0]);
  hooks[`button:${uid(TREE, 11)}`]({ player: pacts, scriptTrigger: true, argsData: [1, 126] });
  assert.deepEqual(Common.pacts(pacts), [0, 63], "237/01098: [1, 126] set bit 63");
});
