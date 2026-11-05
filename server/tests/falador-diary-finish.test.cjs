const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

let core;

const DIARY = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("falador");
const KEYS = {
  crestIdentified: "find-out-what-your-family-crest-is-from-sir-reni",
  crestChanged: "change-your-family-crest-to-the-saradomin-symbol",
  scarecrow: "place-a-scarecrow-in-the-falador-farming-patch",
  grapple: "grapple-up-and-then-jump-off-the-north-falador-w",
  wallSafe: "crack-a-wall-safe-within-rogues-den",
  magicRoots: "find-at-least-3-magic-roots-at-once-when-digging",
  white2h: "purchase-a-white-2h-sword-from-sir-vyvin",
};

const FALADOR_TREE_PATCH = { id: 8389, type: "TREE", x: 3003, y: 3372, z: 0 };
const FALADOR_FLOWER_PATCH = { id: 7847, type: "FLOWER", x: 3054, y: 3307, z: 0 };

function makeApi() {
  const handlers = new Map();
  const push = (name, fn) => {
    const list = handlers.get(name) ?? [];
    list.push(fn);
    handlers.set(name, list);
  };
  const api = {
    core,
    persistAttribute() {},
    onCustomEvent: (name, fn) => push(`custom:${name}`, fn),
    onNpcDeath: (fn) => push("death", fn),
    onNpcDialogueCondition: (fn) => push("condition", fn),
    onNpcDialogueVariant: (fn) => push("variant", fn),
    onPlayerLogin: (fn) => push("login", fn),
    emitCustomEvent(name, event) {
      for (const fn of handlers.get(`custom:${name}`) ?? []) fn(event);
    },
    _handlers: handlers,
    _emit(name, event) {
      for (const fn of handlers.get(name) ?? []) fn(event);
    },
  };
  return api;
}

function makePlayer(options = {}) {
  const attrs = new Map(Object.entries(options.attributes ?? {}));
  const holdings = new Map(Object.entries(options.items ?? {}));
  const skills = options.skills ?? {};
  const inventory = {
    getAmount: (id) => holdings.get(String(id)) ?? 0,
    contains: (id) => (holdings.get(String(id)) ?? 0) > 0,
    deleteNumber(id, amount) {
      const key = String(id);
      const left = (holdings.get(key) ?? 0) - amount;
      if (left <= 0) holdings.delete(key);
      else holdings.set(key, left);
    },
    addItem(item) {
      const key = String(item.getId());
      holdings.set(key, (holdings.get(key) ?? 0) + (item.getAmount?.() ?? 1));
    },
  };
  const player = {
    _attrs: attrs,
    _holdings: holdings,
    isPlayer: () => true,
    isRegistered: () => true,
    isSkulled: () => options.skulled === true,
    getLocation: () => new core.Location(options.x ?? 2965, options.y ?? 3378, options.z ?? 0),
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => (value === null ? attrs.delete(key) : attrs.set(key, value)),
    getDisplayName: () => "Tester",
    sendMessage() {},
    getPacketSender: () => new Proxy({}, { get: () => () => {} }),
    getInventory: () => inventory,
    getEquipment: () => ({ get: () => null }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => skills[`current:${skill}`] ?? 99,
      getMaxLevel: (skill) => skills[`max:${skill}`] ?? 99,
    }),
  };
  return player;
}

function makeQuestAnswers(api, { complete = {}, stages = {} } = {}) {
  api._handlers.set("custom:quest:is-complete", [(request) => {
    if (complete[request.key] !== undefined) request.complete = complete[request.key];
  }]);
  api._handlers.set("custom:quest:get-stage", [(request) => {
    if (stages[request.key] !== undefined) request.stage = stages[request.key];
  }]);
}

function diaryEvents(api, name, payload) {
  const events = [];
  const previous = api._handlers.get("custom:diary:task") ?? [];
  api._handlers.set("custom:diary:task", [...previous, (event) => events.push(event.task)]);
  api._emit(`custom:${name}`, payload);
  api._handlers.set("custom:diary:task", previous);
  return events;
}

function npc(name, x, y, z = 0) {
  return {
    isNpc: () => true,
    getCurrentDefinition: () => ({ getName: () => name }),
    getDefinition: () => ({ getName: () => name }),
    getLocation: () => new core.Location(x, y, z),
  };
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

test("the seven finishing tasks are real catalogue keys", () => {
  const keys = new Set(Object.values(DIARY.tiers).flatMap((tier) => tier.tasks.map((task) => task.key)));
  for (const key of Object.values(KEYS)) assert.ok(keys.has(key), key);
});

test("diary remainder credits every producer event only when its full condition holds", () => {
  const api = makeApi();
  require("../plugins/achievements/diaries/FaladorDiaryRemainder.plugin").register(api);
  makeQuestAnswers(api, { complete: { wanted: true } });

  assert.deepEqual(diaryEvents(api, "sir-renitee:crest-identified", { player: makePlayer() }), [KEYS.crestIdentified]);
  assert.deepEqual(
    diaryEvents(api, "sir-renitee:crest-changed", { player: makePlayer(), crest: "Saradomin", previous: "Asgarnia" }),
    [KEYS.crestChanged],
  );
  assert.deepEqual(
    diaryEvents(api, "sir-renitee:crest-changed", { player: makePlayer(), crest: "Saradomin", previous: "Saradomin" }),
    [],
  );

  assert.deepEqual(
    diaryEvents(api, "farming:scarecrow", { player: makePlayer(), patch: FALADOR_FLOWER_PATCH }),
    [KEYS.scarecrow],
  );
  assert.deepEqual(
    diaryEvents(api, "farming:scarecrow", { player: makePlayer(), patch: { ...FALADOR_FLOWER_PATCH, x: 3000 } }),
    [],
  );

  assert.deepEqual(
    diaryEvents(api, "farming:roots", {
      player: makePlayer(), crop: "MAGIC", patch: FALADOR_TREE_PATCH, itemId: 6043, amount: 3,
    }),
    [KEYS.magicRoots],
  );
  assert.deepEqual(
    diaryEvents(api, "farming:roots", {
      player: makePlayer(), crop: "MAGIC", patch: FALADOR_TREE_PATCH, itemId: 6043, amount: 2,
    }),
    [],
  );
  assert.deepEqual(
    diaryEvents(api, "farming:roots", {
      player: makePlayer(), crop: "YEW", patch: FALADOR_TREE_PATCH, itemId: 6045, amount: 4,
    }),
    [],
  );

  const northWall = makePlayer({ x: 3033, y: 3390, z: 0 });
  assert.deepEqual(
    diaryEvents(api, "agility:obstacle", { player: northWall, objectId: 17047, method: "grapple", location: { x: 3033, y: 3390, z: 0 } }),
    [],
  );
  assert.deepEqual(
    diaryEvents(api, "agility:obstacle", { player: northWall, objectId: 17048, location: { x: 3033, y: 3390, z: 1 } }),
    [KEYS.grapple],
  );
  // A fresh player jumping down without grappling is not enough.
  assert.deepEqual(
    diaryEvents(api, "agility:obstacle", { player: makePlayer(), objectId: 17048, location: { x: 3033, y: 3390, z: 1 } }),
    [],
  );

  assert.deepEqual(diaryEvents(api, "rogues-den:lobby-safe-cracked", { player: makePlayer() }), [KEYS.wallSafe]);
  assert.deepEqual(
    diaryEvents(api, "shop:purchase", {
      player: makePlayer(), shopId: 1376, itemId: 6609, amount: 1, originalStock: true,
    }),
    [KEYS.white2h],
  );
  assert.deepEqual(
    diaryEvents(api, "shop:purchase", {
      player: makePlayer(), shopId: 1376, itemId: 6609, amount: 1, originalStock: false,
    }),
    [],
  );
});

test("Sir Renitee reveals the crest only with 16 Construction and records the Saradomin change", () => {
  const api = makeApi();
  makeQuestAnswers(api);
  require("../plugins/achievements/diaries/FaladorDiaryRemainder.plugin").register(api);
  const plugin = require("../plugins/npcs/SirRenitee.plugin");
  plugin.register(api);
  const condition = api._handlers.get("condition")[0];

  const low = makePlayer({ skills: { [`current:${core.Skill.CONSTRUCTION}`]: 15 } });
  assert.equal(condition({ player: low, npcId: core.NpcIdentifiers.SIR_RENITEE, text: "If the player doesn't have 16 Construction:", stepId: "PgNKW-" }), true);

  const rich = makePlayer({ items: { [core.ItemIdentifiers.COINS]: 5000 }, skills: {
    [`current:${core.Skill.CONSTRUCTION}`]: 16,
    [`max:${core.Skill.PRAYER}`]: 70,
  } });
  assert.equal(condition({ player: rich, npcId: core.NpcIdentifiers.SIR_RENITEE, text: "If the player doesn't have 16 Construction:", stepId: "PgNKW-" }), false);
  assert.equal(condition({ player: rich, npcId: core.NpcIdentifiers.SIR_RENITEE, text: "If the player has enough money:", stepId: "lz_O44" }), true);
  assert.equal(condition({ player: rich, npcId: core.NpcIdentifiers.SIR_RENITEE, text: "If the player has 70 Prayer:", stepId: "hXd87x" }), true);

  const identified = [];
  api._handlers.set("custom:sir-renitee:crest-identified", [(event) => identified.push(event.player)]);
  const line = { player: rich, npcId: core.NpcIdentifiers.SIR_RENITEE, text: "According to my records, your crest is [current family crest]." };
  api._emit("custom:npc-dialogue:line", line);
  assert.match(line.text, /According to my records, your crest is \w+/);
  line.after();
  assert.deepEqual(identified, [rich]);

  // Selecting Saradomin, then the shared 5,000-coin hand-in action.
  api._emit("custom:npc-dialogue:choice", { player: rich, npcId: core.NpcIdentifiers.SIR_RENITEE, option: "Saradomin" });
  const before = rich.getInventory().getAmount(core.ItemIdentifiers.COINS);
  const changed = [];
  api._handlers.set("custom:sir-renitee:crest-changed", [(event) => changed.push(event.crest)]);
  api._emit("custom:npc-dialogue:action", {
    player: rich, npcId: core.NpcIdentifiers.SIR_RENITEE, action: "give", stepId: "rD0rPf", handled: false,
  });
  assert.equal(rich.getInventory().getAmount(core.ItemIdentifiers.COINS), before - 5000);
  assert.deepEqual(changed, ["Saradomin"]);
});

test("Sir Vyvin rank progression matches the Wiki thresholds and gates the rank shop", () => {
  const api = makeApi();
  makeQuestAnswers(api, { stages: { wanted: 4 }, complete: { wanted: true } });
  const plugin = require("../plugins/npcs/SirVyvin.plugin");
  plugin.register(api);
  const rankFor = plugin._test.rankFor;
  assert.equal(rankFor(99).name, "Unranked");
  assert.equal(rankFor(100).name, "Novice");
  assert.equal(rankFor(199).name, "Novice");
  assert.equal(rankFor(200).name, "Peon");
  assert.equal(rankFor(300).name, "Page");
  assert.equal(rankFor(500).name, "Noble");
  assert.equal(rankFor(800).name, "Adept");
  assert.equal(rankFor(1300).name, "Master");
  assert.equal(rankFor(2000).name, "Master");

  assert.equal(plugin._test.shopForStep("1dwanl"), 1380);
  assert.equal(plugin._test.shopForStep("Vp8GI7"), 1379);
  assert.equal(plugin._test.shopForStep("dv77EL"), 1378);
  assert.equal(plugin._test.shopForStep("mNB6dJ"), 1377);
  assert.equal(plugin._test.shopForStep("v6AAxZ"), 1376);

  const player = makePlayer();
  api._emit("death", { killer: player, npcId: core.NpcIdentifiers.BLACK_KNIGHT_2, npc: npc("Black Knight", 3018, 3516) });
  assert.equal(player.getAttribute("white-knights:kill-score"), 1);
  api._emit("death", { killer: player, npcId: core.NpcIdentifiers.ELITE_BLACK_KNIGHT, npc: npc("Elite Black Knight", 4104, 4726) });
  assert.equal(player.getAttribute("white-knights:kill-score"), 13);
  api._emit("death", { killer: player, npcId: core.NpcIdentifiers.WHITE_KNIGHT, npc: npc("White Knight", 2921, 3514) });
  assert.equal(player.getAttribute("white-knights:kill-score"), 12);
  // The Port Sarim jail knight and the fortress wall guard do not count.
  api._emit("death", { killer: player, npcId: 1545, npc: npc("Black knight", 3018, 3180) });
  api._emit("death", { killer: player, npcId: 4331, npc: npc("Black Knight", 3016, 3516) });
  assert.equal(player.getAttribute("white-knights:kill-score"), 12);

  const condition = api._handlers.get("condition")[0];
  player.setAttribute("white-knights:kill-score", 1300);
  assert.equal(condition({ player, npcId: core.NpcIdentifiers.SIR_VYVIN, text: "If the player is a Master rank white knight" }), true);
  assert.equal(condition({ player, npcId: core.NpcIdentifiers.SIR_VYVIN, text: "If the player is an Adept rank white knight" }), false);
});

test("completing Wanted! adds the White Knight Novice bonus once", () => {
  const api = makeApi();
  makeQuestAnswers(api, { complete: { wanted: true } });
  const plugin = require("../plugins/npcs/SirVyvin.plugin");
  plugin.register(api);
  const player = makePlayer();
  api._emit("custom:quest:completed", { player, key: "wanted" });
  assert.equal(player.getAttribute("white-knights:kill-score"), 100);
  api._emit("custom:quest:completed", { player, key: "wanted" });
  assert.equal(player.getAttribute("white-knights:kill-score"), 100);

  const login = api._handlers.get("login")[0];
  const existing = makePlayer({ attributes: { "quest.wanted.stage": 13 } });
  login({ player: existing });
  assert.equal(existing.getAttribute("white-knights:kill-score"), 100);
});

test("the White Knight armoury stays shut until Wanted! is complete", () => {
  const api = makeApi();
  makeQuestAnswers(api, { stages: { wanted: 4 }, complete: { wanted: false } });
  const plugin = require("../plugins/npcs/SirVyvin.plugin");
  plugin.register(api);
  const player = makePlayer({ attributes: { "white-knights:kill-score": 1300 } });
  const condition = api._handlers.get("condition")[0];
  assert.equal(condition({ player, npcId: core.NpcIdentifiers.SIR_VYVIN, text: "If the player is a Master rank white knight" }), false);
  assert.equal(condition({ player, npcId: core.NpcIdentifiers.SIR_VYVIN, text: "If the player is unranked" }), true);

  const diaryApi = makeApi();
  makeQuestAnswers(diaryApi, { complete: { wanted: false } });
  require("../plugins/achievements/diaries/FaladorDiaryRemainder.plugin").register(diaryApi);
  assert.deepEqual(
    diaryEvents(diaryApi, "shop:purchase", { player, shopId: 1376, itemId: 6609, amount: 1, originalStock: true }),
    [],
  );
});

test("Sir Renitee's paid crest survives the real save/load boundary", () => {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const api = makeApi();
  api.persistAttribute = (key, value) => PlayerSave.persistAttribute(key, value);
  const plugin = require("../plugins/npcs/SirRenitee.plugin");
  plugin.register(api);
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setUsername("crestsave");
  player.getInventory().addItem(new core.Item(core.ItemIdentifiers.COINS, 5000));
  assert.equal(plugin._test.changeCrest(player, "Saradomin"), true);
  const saved = PlayerSave.fromPlayer(player);
  assert.equal(saved.attributes[plugin._test.CREST_ATTRIBUTE], "Saradomin");
  const loaded = new Player(new PlayerSession(channel));
  saved.applyToPlayer(loaded);
  assert.equal(plugin._test.crestFor(loaded), "Saradomin");
});
