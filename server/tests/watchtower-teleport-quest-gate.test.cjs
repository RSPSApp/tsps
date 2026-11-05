const assert = require("node:assert/strict");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

let core;
let spellCast;

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const handlers = new Map();
  const dispatch = (name, event) => {
    for (const handler of handlers.get(name) ?? []) handler(event);
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    onCustomEvent(name, handler) {
      const entries = handlers.get(name) ?? [];
      entries.push(handler);
      handlers.set(name, entries);
    },
    emitCustomEvent: dispatch,
    onSpellCast(handler) { spellCast = handler; },
  }, { get: (target, key) => key in target ? target[key] : () => {} });

  require("../plugins/quests/quests/Watchtower.Quest")(api);
  require("../plugins/combat/SpellTeleports.plugin").register(api);
  PluginManager.emitCustomEvent = dispatch;
});

function fixture(t, stage) {
  const player = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.setRegistered(true);
  player.setIndex(2320 + Math.floor(Math.random() * 500));
  player.setLocation(new core.Location(3200, 3200, 0));
  player.setSpellbook(core.MagicSpellbook.NORMAL);
  player.getSkillManager().setCurrentLevels(core.Skill.MAGIC, 99, false);
  player.getInventory().add(new core.Item(563, 2), false);
  player.getInventory().add(new core.Item(557, 2), false);
  player.setAttribute("quest.watchtower.stage", stage);
  t.after(() => {
    core.TaskManager.cancelTasks(player.getIndex());
    player.setRegistered(false);
  });
  return player;
}

test("the quest plugin blocks a completed quest before scroll-read without the diary plugin", (t) => {
  const player = fixture(t, 12);
  spellCast({ player, spellName: "watchtower teleport", handled: false });
  assert.equal(player.getInventory().getAmount(563), 2);
  assert.equal(player.getInventory().getAmount(557), 2);
});

test("reading the scroll unlocks the spell without the diary plugin", (t) => {
  const player = fixture(t, 14);
  spellCast({ player, spellName: "watchtower teleport", handled: false });
  assert.equal(player.getInventory().getAmount(563), 0);
  assert.equal(player.getInventory().getAmount(557), 0);
});
