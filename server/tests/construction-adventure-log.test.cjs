// Run after `yarn build`: node --test tests/construction-adventure-log.test.cjs
//
// The achievement gallery's adventure log (Read): the captured "The Exploits of <owner>" menu, whose
// "Champions log" opens the champions_log modal (468) and its draw script (1408) with the house
// owner's defeated champions, as in rsprox recordings 1001169, 2905 and 2906 (rev 230). Real engine:
// every plugin loaded, a real Player and a real seeded house with an achievement gallery.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const MARBLE_LOG = 29153;
const MENU = 187, CHAMPIONS_LOG = 468, CHAMPIONS_LOG_SCRIPT = 1408;
let core, House, Instance, Champions;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  PM.emitServerStartup({});
  House = require("../plugins/skills/construction/House.Construction");
  Instance = require("../plugins/skills/construction/Instance.Construction");
  Champions = require("../plugins/minigames/championschallenge/Common.ChampionsChallenge");
});
after(() => PM.emitServerShutdown({}));

let nextIndex = 5400;
function newPlayer(t, name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.getSession().setPlayer?.(player);
  player.setUsername(`${name}${nextIndex++}`);
  player.setAttribute("bot-skip-persistence", true);
  assert.equal(core.World.getPlayers().add(player), true);
  const seen = { interfaces: [], scripts: [], messages: [] };
  const sender = player.getPacketSender();
  const sendInterface = sender.sendInterface.bind(sender);
  sender.sendInterface = (id) => (seen.interfaces.push(id), sendInterface(id));
  const sendClientScript = sender.sendClientScript.bind(sender);
  sender.sendClientScript = (id, ...args) => (seen.scripts.push([id, ...args]), sendClientScript(id, ...args));
  player.sendMessage = (message) => seen.messages.push(message);
  t.after(() => {
    try { House.releaseHouse(player, true); } finally { core.TaskManager.cancelTasks(player); core.World.getPlayers().remove(player); }
  });
  return { player, seen };
}

/** The owner in their own house, an achievement gallery east of the parlour with a marble log. */
function ownerInHouse(t) {
  const owner = newPlayer(t, "exploits");
  const save = Instance.createDefaultHouseSave();
  Object.assign(save, { owned: true, location: 1, style: 0, locked: false });
  save.rooms[1][4][6] = { roomKey: "ACHIEVEMENT_GALLERY", rotation: 0, furniture: { ADVENTURE_LOG: "MARBLE_ADVENTURE_LOG" } };
  owner.player.setAttribute("construction:house", save);
  owner.player.moveTo(new core.Location(2954, 3224, 0));
  owner.player.setNeedsPlacement(false);
  assert.equal(House.enterHouse(owner.player, false), true);
  const house = House.houseFor(owner.player);
  assert.ok(house instanceof Instance.PlayerHouseInstance);
  return { ...owner, house };
}

function readLog(player, house) {
  const object = house.furnitureObjects.find((drawn) => drawn.getId() === MARBLE_LOG);
  assert.ok(object, "the built marble adventure log is drawn");
  const at = object.getLocation();
  const clickType = object.getDefinition().getInteractions().indexOf("Read") + 1;
  assert.ok(clickType > 0, "the log offers Read");
  const event = { player, object, objectId: MARBLE_LOG, clickType, location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false };
  assert.equal(PM.emitObjectInteraction(event), true);
}

/** A pick on menu:lj_layer1 (resume_pausebutton, sub = the option's index). */
function pick(player, label) {
  const [, , labels] = player.__menu;
  const slot = labels.split("|").indexOf(label);
  assert.ok(slot >= 0, `${label} is in ${labels}`);
  const event = { player, groupId: MENU, childId: 3, slot, action: slot, buttonId: (MENU << 16) | 3, handled: false };
  PM.emitInterfaceActionClick(event);
  assert.equal(event.handled, true);
}

function openMenu(t, { defeated = 0 } = {}) {
  const owner = ownerInHouse(t);
  owner.player.setAttribute(Champions.DEFEATED_ATTRIBUTE, defeated);
  readLog(owner.player, owner.house);
  assert.equal(owner.seen.interfaces.at(-1), MENU);
  const menu = owner.seen.scripts.findLast(([id]) => id === 217);
  assert.ok(menu, "the menu script ran");
  assert.equal(menu[2], `The Exploits of ${owner.player.getDisplayName()}`);
  assert.equal(menu[3], "Slayer log|Boss log|Champions log|Collection log|Counters");
  owner.player.__menu = menu.slice(1);
  return owner;
}

test("Champions log opens the champions log with the owner's defeated champions", (t) => {
  const giant = Champions.byKey.get("giant"), leon = Champions.byKey.get("leon");
  const defeated = (1 << giant.bit) | (1 << leon.bit);
  const { player, seen } = openMenu(t, { defeated });
  pick(player, "Champions log");
  assert.equal(seen.interfaces.at(-1), CHAMPIONS_LOG);
  assert.deepEqual(seen.scripts.at(-1), [CHAMPIONS_LOG_SCRIPT, defeated]);
  assert.equal(player.getInterfaceId(), CHAMPIONS_LOG);
  assert.deepEqual(seen.messages, []);
});

test("an account with no champions beaten draws none crossed out (captured argument 0)", (t) => {
  const { player, seen } = openMenu(t);
  pick(player, "Champions log");
  assert.deepEqual(seen.scripts.at(-1), [CHAMPIONS_LOG_SCRIPT, 0]);
});

test("the logs this server doesn't have yet still say nothing happens", (t) => {
  const { player, seen } = openMenu(t);
  pick(player, "Boss log");
  assert.deepEqual(seen.messages, ["Nothing interesting happens."]);
  assert.notEqual(seen.interfaces.at(-1), CHAMPIONS_LOG);
});

test("a visitor reading the owner's log sees the owner's champions, not their own", (t) => {
  const owner = ownerInHouse(t);
  const giant = Champions.byKey.get("giant"), imp = Champions.byKey.get("imp");
  owner.player.setAttribute(Champions.DEFEATED_ATTRIBUTE, 1 << giant.bit);
  owner.player.getRelations().setStatus(core.PrivateChatStatus.ON, false);
  const guest = newPlayer(t, "guest");
  guest.player.setAttribute(Champions.DEFEATED_ATTRIBUTE, 1 << imp.bit);
  assert.equal(House.canVisitHouse(guest.player, owner.house), true);
  House.visitHouse(guest.player, owner.player.getUsername(), 1);
  assert.equal(House.houseFor(guest.player), owner.house);
  readLog(guest.player, owner.house);
  const menu = guest.seen.scripts.findLast(([id]) => id === 217);
  assert.equal(menu[2], `The Exploits of ${owner.player.getDisplayName()}`);
  guest.player.__menu = menu.slice(1);
  pick(guest.player, "Champions log");
  assert.equal(guest.seen.interfaces.at(-1), CHAMPIONS_LOG);
  assert.deepEqual(guest.seen.scripts.at(-1), [CHAMPIONS_LOG_SCRIPT, 1 << giant.bit]);
});
