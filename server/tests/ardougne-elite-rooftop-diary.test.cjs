const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Location } = require("../dist/game/model/Location");
const { Skill } = require("../dist/game/model/Skill");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const Agility = require("../plugins/skills/Agility.plugin");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const AchievementDiaries = require("../plugins/achievements/AchievementDiaries.plugin");
const { COURSES } = require("../plugins/skills/agility/courses/Courses.Agility");

const tasks = [];
const taskManager = {
  submit(task) {
    if (task.isRunning()) return;
    task.setRunning(true);
    if (task.isImmediate()) task.execute();
    tasks.push(task);
  },
};

function tick() {
  for (const task of tasks.splice(0)) if (task.tick()) tasks.push(task);
}

const hooks = { route: [], click: new Map(), objectActions: new Map() };
const listeners = new Map();
const emit = (name, event) => {
  for (const handler of listeners.get(name) ?? []) handler(event);
};
const core = PluginManager.getCoreApi();
const api = new Proxy({
  core,
  getTaskManager: () => taskManager,
  getItemOnGroundManager: () => ({ registerLocation() {}, ownedBy: () => [], inventoryCapacity: () => 1 }),
  onGroundItemPickup() {},
  persistAttribute() {},
  onObjectRoute: (handler) => hooks.route.push(handler),
  onObjectFirstClick: (ids, handler) => ids.forEach((id) => hooks.click.set(id, handler)),
  onObjectInteraction: (name, handlers) => hooks.objectActions.set(name, { ...(hooks.objectActions.get(name) ?? {}), ...handlers }),
  onPlayerLogin() {},
  onPlayerLogout() {},
  onCustomEvent(name, handler) {
    const handlers = listeners.get(name) ?? [];
    handlers.push(handler);
    listeners.set(name, handlers);
  },
  emitCustomEvent: emit,
  registerCommand() {},
  log() {},
}, { get: (target, key) => key in target ? target[key] : () => {} });

function createPlayer(x, y, z, level = 99) {
  let location = new Location(x, y, z);
  let forceMovement = null;
  const attributes = new Map();
  const state = { xp: 0, otherXp: {}, messages: [], varbits: new Map(), varbitLog: [], scripts: [], animations: [], blocked: false };
  const player = {
    state,
    getLocation: () => location,
    setLocation: (next) => { location = next.clone(); return player; },
    moveTo: (next) => { location = next.clone(); return player; },
    setWalkingDirection() {},
    getMovementQueue: () => ({ reset() {}, setBlockMovement: (value) => { state.blocked = value; }, handleRegionChange() {} }),
    getForceMovement: () => forceMovement,
    setForceMovement: (value) => { forceMovement = value; return player; },
    setSkillAnimation() {},
    getUpdateFlag: () => ({ flag() {} }),
    performAnimation: (animation) => state.animations.push(animation.getId()),
    performGraphic() {},
    setPositionToFace() {},
    forceChat() {},
    sendMessage: (message) => state.messages.push(message),
    getDialogueManager: () => ({ startDialogues() {} }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => skill === Skill.AGILITY ? level : 99,
      getMaxLevel: () => level,
      addExperiences: (skill, amount) => { if (skill === Skill.AGILITY) state.xp += amount; },
      getExperience: () => state.xp,
    }),
    getPacketSender: () => ({
      sendVarbit: (id, value) => { state.varbits.set(id, value); state.varbitLog.push([id, value]); },
      sendRunEnergy() {},
      sendClientScript: (id, ...args) => state.scripts.push([id, ...args]),
      sendTypedMessage: (_type, message) => state.messages.push(message),
      sendSound() {},
      sendSoundEffect() {},
      sendObjectAnimation() {},
    }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage() {} }) }),
    getInventory: () => ({ isFull: () => false, addItem() {}, contains: () => false, getAmount: () => 0, delete() {} }),
    getEquipment: () => ({ getItems: () => [] }),
    isRegistered: () => true,
    getHitpoints: () => 99,
    getRunEnergy: () => 50,
    setRunEnergy() {},
    getPrivateArea: () => null,
  };
  return player;
}

function gameObject(id, [x, y, z]) {
  const definition = CacheDefinitions.getObject(id);
  return {
    getId: () => id,
    getFace: () => 0,
    getLocation: () => new Location(x, y, z),
    getDefinition: () => ({
      getName: () => definition?.name,
      getSizeX: () => definition?.sizeX ?? 1,
      getSizeY: () => definition?.sizeY ?? 1,
      getActions: () => definition?.actions ?? [],
      getInteractions: () => definition?.actions ?? [],
    }),
  };
}

function operate(player, obstacle) {
  const objectId = Array.isArray(obstacle.object) ? obstacle.object[0] : obstacle.object;
  const position = obstacle.at ?? (() => {
    const here = player.getLocation();
    return [here.getX(), here.getY() + 1, here.getZ()];
  })();
  const object = gameObject(objectId, position);
  const definition = object.getDefinition();
  const route = { player, object, definition, objectId, clickType: 1, destination: null };
  hooks.route.forEach((handler) => handler(route));
  if (route.destination) player.setLocation(new Location(route.destination.x, route.destination.y, route.destination.z));
  const handler = hooks.click.get(objectId);
  assert.ok(handler, `no agility click handler for object ${objectId}`);
  handler({ player, object, definition, objectId, clickType: 1, location: { x: position[0], y: position[1], z: position[2] } });
  for (let count = 0; player.getAttribute("agility.obstacle") != null; count++) {
    assert.ok(count < 100, `obstacle ${objectId} did not finish`);
    tick();
  }
}

function runLap(course, player, stopBefore = Infinity) {
  for (const obstacle of [...course.obstacles].sort((a, b) => a.index - b.index)) {
    if (obstacle.index > stopBefore) break;
    operate(player, obstacle);
  }
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  Progress(api);
  api.onCustomEvent("diary:task", AchievementDiaries._test.onTask);
  Agility.register(api);
});

const ardougne = () => COURSES.find((course) => course.key === "ardougne");
const diary = require("../plugins/achievements/diaries/Data.AchievementDiaries").BY_KEY.get("ardougne");
const task = ardougne().diaryTask.task;

test("a complete Ardougne rooftop lap records the Elite task and diary varbits", () => {
  const player = createPlayer(2673, 3298, 0);
  runLap(ardougne(), player);

  assert.equal(player.getAttribute("agility.laps")?.ardougne, 1);
  assert.ok(Progress.doneTasks(player, diary).has(task));
  assert.equal(Progress.tierCount(player, diary, "elite"), 1);
  assert.equal(player.state.varbits.get(diary.startedVarbit), 1);
  assert.equal(player.state.varbits.get(diary.tiers.elite.countVarbit), 1);
  assert.equal(player.state.varbits.get(diary.tiers.elite.completeVarbit), undefined);
});

test("a partial or under-level Ardougne attempt does not complete the Elite task", () => {
  const partial = createPlayer(2673, 3298, 0);
  runLap(ardougne(), partial, 3);
  assert.equal(Progress.tierCount(partial, diary, "elite"), 0);
  assert.equal(partial.state.varbits.get(diary.tiers.elite.countVarbit), undefined);

  const failed = createPlayer(2673, 3298, 0, 89);
  runLap(ardougne(), failed, 1);
  assert.equal(Progress.tierCount(failed, diary, "elite"), 0);
  assert.equal(failed.getAttribute("agility.laps")?.ardougne, undefined);
  assert.equal(failed.state.varbits.get(diary.tiers.elite.countVarbit), undefined);
});

test("a failed rooftop obstacle does not complete the Ardougne Elite task", () => {
  const varrock = COURSES.find((course) => course.key === "varrock");
  const player = createPlayer(3221, 3414, 0, 30);
  const random = Math.random;
  Math.random = () => 0.999;
  try {
    runLap(varrock, player, 1);
    operate(player, varrock.obstacles.find((obstacle) => obstacle.index === 2));
  } finally {
    Math.random = random;
  }

  assert.equal(Progress.tierCount(player, diary, "elite"), 0);
  assert.equal(player.getAttribute("agility.laps")?.varrock, undefined);
  assert.equal(player.state.varbits.get(diary.tiers.elite.countVarbit), undefined);
});

test("a lap on another rooftop course does not complete Ardougne Elite", () => {
  const varrock = COURSES.find((course) => course.key === "varrock");
  const player = createPlayer(3221, 3414, 0);
  runLap(varrock, player);

  assert.equal(player.getAttribute("agility.laps")?.varrock, 1);
  assert.equal(Progress.tierCount(player, diary, "elite"), 0);
  assert.equal(player.state.varbits.get(diary.startedVarbit), undefined);
  assert.equal(player.state.varbits.get(diary.tiers.elite.countVarbit), undefined);
});
