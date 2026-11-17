const assert = require("node:assert/strict");
const { test } = require("node:test");

const Retrieval = require("../plugins/minigames/hallowedsepulchre/Retrieval.HallowedSepulchre");

function item(id, amount = 1) {
  return { getId: () => id, getAmount: () => amount, getMeta: () => null };
}

function player(areaName = "Hallowed Sepulchre") {
  const attributes = new Map();
  const state = { areaName };
  return {
    attributes,
    state,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getArea: () => ({ getName: () => state.areaName }),
  };
}

test("a death inside the Sepulchre leaves the lost items with the Mysterious Stranger", () => {
  const p = player();
  const event = {
    player: p,
    killer: null,
    items: [item(995, 5000), item(1135, 1)],
    untradeables: [item(4151, 1)],
  };
  Retrieval.deathDrops(event);
  assert.deepEqual(event.items, []);
  assert.deepEqual(event.untradeables, []);
  assert.deepEqual(Retrieval.held(p).items.map((entry) => [entry.id, entry.amount]), [[995, 5000], [1135, 1], [4151, 1]]);
});

test("a later unsafe death deletes the previous lot", () => {
  const p = player();
  Retrieval.deathDrops({ player: p, killer: null, items: [item(1135, 1)], untradeables: [] });
  assert.ok(Retrieval.held(p));

  p.state.areaName = "Darkmeyer";
  Retrieval.deathDrops({ player: p, killer: null, items: [item(995, 1)], untradeables: [] });
  assert.equal(Retrieval.held(p), null, "an outside death loses the old retrieval lot");
  p.state.areaName = "Hallowed Sepulchre";

  Retrieval.deathDrops({ player: p, killer: null, items: [item(1135, 1)], untradeables: [] });
  Retrieval.deathDrops({ player: p, killer: { getName: () => "killer" }, items: [item(995, 1)], untradeables: [] });
  assert.equal(Retrieval.held(p), null, "a PvP death loses the old retrieval lot");
});
