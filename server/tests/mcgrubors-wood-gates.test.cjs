const assert = require("node:assert/strict");
const { test } = require("node:test");

const plugin = require("../plugins/areas/McGruborsWood.plugin");
const handlers = new Map();
const dialogues = [];
const player = (y) => ({ getLocation: () => ({ getY: () => y }) });

plugin.register({
  core: {
    ObjectIdentifiers: { GATE_8: 52, GATE_9: 53 },
    NpcIdentifiers: { FORESTER_2: 4076 },
  },
  onCustomEvent: (name, handler) => handlers.set(name, handler),
  emitCustomEvent: (name, event) => dialogues.push([name, event]),
});

function clickGate(objectId, x, y, playerY) {
  const request = {
    player: player(playerY),
    object: { getLocation: () => ({ getX: () => x, getY: () => y, getZ: () => 0 }) },
    objectId,
    handled: false,
  };
  handlers.get("door:toggle")(request);
  return request;
}

test("McGrubor's main gate leaves stay closed and the Forester refuses outside entry", () => {
  for (const [objectId, x] of [[52, 2649], [53, 2650]]) {
    assert.equal(clickGate(objectId, x, 3470, 3469).handled, true);
    const [name, dialogue] = dialogues.pop();
    assert.equal(name, "npc-dialogue:start");
    assert.equal(dialogue.npcId, 4076);
    assert.equal(dialogue.variant, "standard-dialogue-when-attempting-to-enter-mcgrubor-s-wood");
  }
});

test("the locked gate remains unavailable from inside without affecting reused gate ids", () => {
  assert.equal(clickGate(52, 2649, 3470, 3471).handled, true);
  assert.equal(dialogues.length, 0);
  assert.equal(clickGate(52, 2649, 3471, 3470).handled, false);
  assert.equal(clickGate(53, 2651, 3470, 3469).handled, false);
  assert.equal(clickGate(1, 2649, 3470, 3469).handled, false);
});
