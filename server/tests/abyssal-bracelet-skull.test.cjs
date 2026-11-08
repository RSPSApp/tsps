// Run after `yarn build`: node --test tests/abyssal-bracelet-skull.test.cjs
// Wiki (Abyssal bracelet): "Wearing the bracelet will prevent the player from being skulled when entering the Abyss";
// "1 charge is used each time the wearer enters the Abyss", and it crumbles after the last. Already skulled, it only
// keeps the timer from resetting, using no charge. The Mage of Zamorak skulled every player. Real Players.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { TeleportHandler } = require("../dist/game/model/teleportation/TeleportHandler");

let core, teleport;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const real = PluginManager.createApi("AbyssalBraceletTest");
  const api = new Proxy({ core,
    onNpcInteraction: (name, actions) => { if (name === "Mage of Zamorak") teleport = actions.Teleport; },
    emitCustomEvent: (name, request) => { if (name === "quest:is-complete") request.complete = true; },
  }, { get: (object, name) => object[name] ?? real[name] ?? (() => {}) });
  require("../plugins/skills/Runecrafting.plugin").register(api);
  TeleportHandler.checkReqs = () => true;
  TeleportHandler.teleport = () => {};
});

function mageTeleport(t, braceletId) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("abyssbracelet");
  p.setLocation(new core.Location(3106, 3556, 0));
  const messages = [];
  p.sendMessage = (text) => messages.push(text);
  if (braceletId) p.getEquipment().setItem(core.Equipment.HANDS_SLOT, new core.Item(braceletId, 1));
  t.after(() => core.TaskManager.cancelTasks(p));
  teleport({ player: p });
  return { p, messages, hands: () => p.getEquipment().getItems()[core.Equipment.HANDS_SLOT]?.getId?.() ?? -1 };
}

test("a worn abyssal bracelet prevents the Abyss's skull and uses a charge", (t) => {
  const plain = mageTeleport(t, null);
  assert.equal(plain.p.isSkulled(), true, "no bracelet: skulled");
  const five = mageTeleport(t, 11095);
  assert.equal(five.p.isSkulled(), false, "the bracelet prevents it");
  assert.equal(five.hands(), 11097, "(5) becomes (4)");
  const one = mageTeleport(t, 11103);
  assert.equal(one.p.isSkulled(), false);
  assert.equal(one.hands(), -1, "the last charge crumbles it");
});
