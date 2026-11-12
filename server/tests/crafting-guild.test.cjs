const assert = require("node:assert/strict");
const { test } = require("node:test");
const CraftingGuild = require("../plugins/areas/CraftingGuild.plugin");

class Location {
  constructor(x, y, z = 0) { Object.assign(this, { x, y, z }); }
  getX() { return this.x; }
  getY() { return this.y; }
  getZ() { return this.z; }
  clone() { return new Location(this.x, this.y, this.z); }
  equals(other) { return this.x === other.x && this.y === other.y && this.z === other.z; }
}

class ForceMovement {
  constructor(start, end, delay, duration, direction, animation) {
    Object.assign(this, { start, end, delay, duration, direction, animation });
  }
}

class ForceMovementTask {
  constructor(player, ticks, movement) { Object.assign(this, { player, ticks, movement }); }
  execute() {
    this.player.moveTo(new Location(
      this.movement.start.getX() + this.movement.end.getX(),
      this.movement.start.getY() + this.movement.end.getY(),
      this.movement.start.getZ(),
    ));
  }
}

function setup({ x = 2933, y = 3290, level = 40, bodyId = 1757 } = {}) {
  const events = [];
  const tasks = [];
  const packets = [];
  const hooks = new Map();
  const registered = new Set();
  const core = {
    CacheDefinitions: { getLocId: (name) => name },
    Equipment: { BODY_SLOT: 4 },
    ForceMovement,
    ForceMovementTask,
    ItemDefinition: { forId: (id) => ({ getName: () => id === 1757 ? "Brown apron" : "" }) },
    Location,
    NpcIdentifiers: { MASTER_CRAFTER: 5810 },
    Skill: { CRAFTING: "crafting" },
    Task: class {
      constructor(ticks, owner) { Object.assign(this, { ticks, owner }); }
      stop() {}
    },
    TaskManager: { submit: (task) => tasks.push(task) },
    GameObject: require("../dist/game/entity/impl/object/GameObject").GameObject,
    ObjectManager: {
      register: (o) => { registered.add(o); packets.push(["register", o.getId(), o.getLocation().getX(), o.getLocation().getY(), o.getFace()]); },
      deregister: (o) => { registered.delete(o); packets.push(["deregister", o.getId(), o.getLocation().getX(), o.getLocation().getY(), o.getFace()]); },
      objectsAt: (tile) => [...registered].filter((o) => o.getLocation().equals(tile)),
    },
  };
  const api = {
    core,
    emitCustomEvent: (name, payload) => events.push({ name, ...payload }),
    onObjectFirstClick: (id, handler) => hooks.set(id, handler),
    onObjectSecondClick: () => {},
  };
  CraftingGuild.register(api);

  let location = new Location(x, y);
  const player = {
    getEquipment: () => ({ getItems: () => [null, null, null, null, { getId: () => bodyId }] }),
    getForceMovement: () => null,
    getLocation: () => location,
    getPacketSender: () => ({
      sendObject: (object) => packets.push(["restore", object]),
      sendObjectRemoval: (object) => packets.push(["remove", object]),
    }),
    getSkillManager: () => ({ getMaxLevel: () => level, getCurrentLevel: () => level }),
    moveTo: (next) => { location = next; },
    sendMessage: (message) => events.push({ message }),
  };
  const door = { getId: () => 14910, getLocation: () => new Location(2933, 3289), getType: () => 0, getFace: () => 3 };
  return { events, tasks, packets, handler: hooks.get("craftingguilddoor"), player, door, location: () => location };
}

test("a player wearing a brown apron is welcomed and walked into the guild", () => {
  const state = setup();
  assert.equal(state.handler({ player: state.player, object: state.door }), true);
  assert.equal(state.events[0].variant, "when-trying-to-enter-the-guild-whilst-wearing-a-brown-apron-or-crafting-cape");
  assert.deepEqual([state.location().getX(), state.location().getY()], [2933, 3289]);
  // rsprox 232/03130.txt:31143-31169: inviswall on the doorway and inactivepoordoor 1539 inside, for everyone.
  assert.deepEqual(state.packets, [
    ["deregister", 14910, 2933, 3289, 3],
    ["register", 38848, 2933, 3289, 3],
    ["register", 1539, 2933, 3288, 0],
  ]);

  const movement = state.tasks.find((task) => task instanceof ForceMovementTask);
  assert.deepEqual([movement.movement.start.getX(), movement.movement.start.getY()], [2933, 3289]);
  assert.deepEqual([movement.movement.end.getX(), movement.movement.end.getY()], [0, -1]);
  movement.execute();
  assert.equal(state.location().getY(), 3288);
  state.tasks.find((task) => task.ticks === 2 && !(task instanceof ForceMovementTask)).execute();
  assert.deepEqual(state.packets.slice(3), [
    ["deregister", 1539, 2933, 3288, 0],
    ["deregister", 38848, 2933, 3289, 3],
    ["register", 14910, 2933, 3289, 3],
  ], "the guild door is back two ticks later");
});

test("the door's restore is not keyed to the player; a second click mid-swap waits for the door (#4647 review)", () => {
  const state = setup();
  state.handler({ player: state.player, object: state.door });
  const restore = state.tasks.find((task) => task.ticks === 2 && !(task instanceof ForceMovementTask));
  assert.notEqual(restore.owner, state.player, "a player-wide cancelTasks can't stop it");
  const before = [state.packets.length, state.tasks.length];
  state.handler({ player: state.player, object: state.door });
  assert.deepEqual([state.packets.length, state.tasks.length], before, "no second swap or restore");
  restore.execute();
  const after = state.packets.length;
  state.handler({ player: state.player, object: state.door });
  assert.ok(state.packets.length > after, "the door works again once it is back");
});

test("leaving the guild is not gated by level or apron", () => {
  const state = setup({ x: 2933, y: 3288, level: 1, bodyId: -1 });
  assert.equal(state.handler({ player: state.player, object: state.door }), true);
  assert.equal(state.events.length, 0);
  const movement = state.tasks.find((task) => task instanceof ForceMovementTask);
  assert.deepEqual([movement.movement.start.getX(), movement.movement.start.getY()], [2933, 3288]);
  assert.deepEqual([movement.movement.end.getX(), movement.movement.end.getY()], [0, 1]);
  movement.execute();
  assert.equal(state.location().getY(), 3289);
});
