const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { Skill } = require("../dist/game/model/Skill");

before(async () => CachePipeline.initialize(path.resolve(__dirname, "..")));

test("loc merge reaches self and actual observers, without changing the world object", (t) => {
  const create = (x) => {
    const session = new PlayerSession(null);
    const p = new Player(session, new Location(x, 10277, 1));
    p.setUsername(`mergetest${x}`);
    const frames = [];
    p.setAttribute("bot-skip-persistence", true);
    session.sendClientPacket = (f) => { frames.push(f); return true; };
    assert.equal(World.getPlayers().add(p), true);
    frames.length = 0;
    t.after(() => World.getPlayers().remove(p));
    return { p, frames };
  };
  const actor = create(3759), viewer = create(3758), unseen = create(3757);
  // View membership is recipient-owned: actor's list deliberately omits viewer.
  viewer.p.getLocalPlayers().push(actor.p);
  const object = new GameObject(30962, new Location(3760, 10277, 1), 10, 3, null);
  const bounds = { minX: 1, minZ: 0, maxX: -1, maxZ: 0 };
  assert.equal(actor.p.mergeObject(object, 0, 60, bounds), actor.p);
  assert.equal(actor.frames.length, 1);
  assert.deepEqual(viewer.frames, actor.frames);
  assert.equal(unseen.frames.length, 0);
  const frame = actor.frames[0];
  assert.equal(frame[0], 138);
  assert.equal(frame.length, 19);
  assert.equal(frame.readUInt16BE(9), actor.p.getIndex());
  assert.equal(frame.readInt8(15), 1);
  assert.equal(frame.readInt8(17), -1);
  assert.equal(object.getId(), 30962);
  assert.equal(object.getLocation().getX(), 3760);
  // Invalid input must fail before any recipient sees a partial broadcast.
  assert.throws(() => actor.p.mergeObject(object, 60, 60, bounds), RangeError);
  assert.equal(actor.frames.length, 1);
  assert.equal(viewer.frames.length, 1);
  // A viewer that has removed the player must not receive an indexed attachment.
  viewer.p.getLocalPlayers().splice(0);
  actor.p.mergeObject(object, 0, 60, bounds);
  assert.equal(viewer.frames.length, 1);
});

test("captured underwater crossing merges on the exact-move tick and lands in both directions", () => {
  const Runner = require("../plugins/skills/agility/ObstacleRunner.Agility");
  const { SHORTCUTS } = require("../plugins/skills/agility/shortcuts/Shortcuts.Agility");
  Runner.init({ core: PluginManager.getCoreApi(), getTaskManager: () => TaskManager });
  const shortcut = SHORTCUTS.find(entry => entry.at?.[0] === 3760 && entry.at?.[1] === 10277);
  assert.ok(shortcut);
  for (const [from, to] of [[3761, 3759], [3759, 3761]]) {
    const session = new PlayerSession(null);
    const player = new Player(session, new Location(from, 10277, 1));
    player.setIndex(42);
    player.setRegistered(true);
    player.setNeedsPlacement(false);
    const frames = [];
    session.sendClientPacket = frame => { frames.push(frame); return true; };
    const object = new GameObject(shortcut.object, new Location(3760, 10277, 1), 10, 3, null);
    const context = {
      player, object,
      obj: { x: 3760, y: 10277, z: 1, face: 3, type: 10, id: shortcut.object },
      pos: { x: from, y: 10277, z: 1 },
    };
    const xp = player.getSkillManager().getExperience(Skill.AGILITY);
    const task = Runner.run(context, shortcut.steps(context));
    assert.equal(frames.filter(f => f[0] === 138).length, 0, "face/wait tick has no merge");
    TaskManager.process();
    const merges = frames.filter(f => f[0] === 138);
    assert.equal(merges.length, 1, "merge starts with the swim exactmove");
    assert.equal(player.getForceMovement().getEnd().getX(), to - from);
    assert.equal(player.getForceMovement().getReverseSpeed(), 60);
    assert.equal(merges[0].readUInt16BE(13), 60);
    TaskManager.process();
    TaskManager.process();
    assert.equal(task.isRunning(), false);
    assert.equal(player.getLocation().getX(), to);
    assert.equal(player.getForceMovement(), null);
    assert.equal(player.getSkillManager().getExperience(Skill.AGILITY), xp);
  }
});
