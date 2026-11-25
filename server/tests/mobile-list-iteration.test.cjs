// Run after `yarn build`: node --test tests/mobile-list-iteration.test.cjs
// MobileList traversals stop at the highest occupied slot and the iterator reuses one result
// object (issue 6036: the old generator stepped through all 65,535 NPC slots and allocated per
// NPC). Order and add/remove-during-iteration behaviour must stay what the full-array loops gave.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { MobileList } = require("../dist/game/entity/impl/MobileList");

class FakeMobile {
  constructor(name) { this.name = name; this.index = -1; this.registered = false; }
  isRegistered() { return this.registered; }
  setRegistered(value) { this.registered = value; return this; }
  getIndex() { return this.index; }
  setIndex(value) { this.index = value; return this; }
  onAdd() {}
  onRemove() {}
}

function listOf(names, { capacity = 64, holdFreedSlots = false } = {}) {
  const list = new MobileList(capacity, undefined, undefined, { holdFreedSlots });
  const mobiles = names.map((name) => new FakeMobile(name));
  for (const mobile of mobiles) assert.equal(list.add(mobile), true);
  return { list, mobiles };
}

const names = (iterable) => [...iterable].map((mobile) => mobile.name);

test("iterates live mobiles in slot order and skips freed slots", () => {
  const { list, mobiles } = listOf(["a", "b", "c", "d"]);
  list.remove(mobiles[1]);
  assert.deepEqual(names(list), ["a", "c", "d"]);
  const seen = [];
  list.forEach((mobile) => seen.push(mobile.name));
  assert.deepEqual(seen, ["a", "c", "d"]);
  assert.equal(list.search((mobile) => mobile.name === "d"), mobiles[3]);
  // A freed slot is refilled lowest-first and iterates in its slot's place.
  const e = new FakeMobile("e");
  list.add(e);
  assert.equal(e.getIndex(), mobiles[1].getIndex());
  assert.deepEqual(names(list), ["a", "e", "c", "d"]);
});

test("the high-water mark follows the highest occupied slot", () => {
  const { list, mobiles } = listOf(["a", "b", "c"]);
  assert.equal(list.highestOccupiedSlot(), 3);
  list.remove(mobiles[1]);
  assert.equal(list.highestOccupiedSlot(), 3);
  list.removes(mobiles[2]);
  assert.equal(list.highestOccupiedSlot(), 1, "dropping the top slot lowers the mark past the empty slot below it");
  list.remove(mobiles[0]);
  assert.equal(list.highestOccupiedSlot(), 0);
  assert.deepEqual(names(list), []);
  list.forEach(() => assert.fail("nothing to visit"));
  assert.equal(list.search(() => true), null);
});

test("a held slot is past the mark until it is handed out again", () => {
  const { list, mobiles } = listOf(["a", "b"], { holdFreedSlots: true });
  list.remove(mobiles[1]);
  assert.equal(list.highestOccupiedSlot(), 1);
  const c = new FakeMobile("c");
  list.add(c);
  assert.equal(c.getIndex(), 3, "the held slot 2 is not reused this cycle");
  assert.deepEqual(names(list), ["a", "c"]);
  list.releaseHeldSlots();
  const d = new FakeMobile("d");
  list.add(d);
  assert.equal(d.getIndex(), 2);
  assert.deepEqual(names(list), ["a", "d", "c"]);
});

test("a mobile added during iteration above the cursor is visited, below it is not", () => {
  const { list, mobiles } = listOf(["a", "b", "c"]);
  list.remove(mobiles[0]);
  const seen = [];
  for (const mobile of list) {
    seen.push(mobile.name);
    if (mobile.name === "b") {
      list.add(new FakeMobile("low")); // takes slot 1, already passed
      list.add(new FakeMobile("high")); // slot 4, past the mark when the loop started
    }
  }
  assert.deepEqual(seen, ["b", "c", "high"]);
  const forEachSeen = [];
  const { list: other } = listOf(["x"]);
  other.forEach((mobile) => {
    forEachSeen.push(mobile.name);
    if (mobile.name === "x") other.add(new FakeMobile("y"));
  });
  assert.deepEqual(forEachSeen, ["x", "y"]);
});

test("a mobile removed during iteration before its slot is reached is skipped", () => {
  const { list, mobiles } = listOf(["a", "b", "c", "d"]);
  const seen = [];
  for (const mobile of list) {
    seen.push(mobile.name);
    if (mobile.name === "a") list.remove(mobiles[3]);
    if (mobile.name === "b") list.remove(mobile); // removing the current one keeps going
  }
  assert.deepEqual(seen, ["a", "b", "c"]);
  assert.deepEqual(names(list), ["a", "c"]);
});

test("nested and early-exit loops are independent", () => {
  const { list } = listOf(["a", "b", "c"]);
  const pairs = [];
  for (const outer of list) for (const inner of list) if (outer !== inner) pairs.push(outer.name + inner.name);
  assert.deepEqual(pairs, ["ab", "ac", "ba", "bc", "ca", "cb"]);
  for (const mobile of list) if (mobile.name === "a") break;
  assert.deepEqual(names(list), ["a", "b", "c"]);
  assert.deepEqual(Array.from(list, (mobile) => mobile.name), ["a", "b", "c"]);
  const [first, second] = list;
  assert.deepEqual([first.name, second.name], ["a", "b"]);
});

test("an exhausted iterator stays done after more mobiles are added", () => {
  const { list } = listOf(["a"]);
  const iterator = list[Symbol.iterator]();
  assert.equal(iterator.next().value.name, "a");
  assert.equal(iterator.next().done, true);
  list.add(new FakeMobile("b"));
  assert.equal(iterator.next().done, true);
  assert.equal(iterator[Symbol.iterator](), iterator);
});

test("a full-capacity NPC list only walks its occupied prefix", () => {
  const list = new MobileList(65534);
  const mobiles = Array.from({ length: 50 }, (_, i) => new FakeMobile(String(i)));
  for (const mobile of mobiles) list.add(mobile);
  for (const mobile of mobiles.slice(10, 40)) list.remove(mobile);
  assert.equal(list.characters.length, 65535);
  assert.equal(list.highestOccupiedSlot(), 50);
  assert.equal([...list].length, 20);
  for (const mobile of mobiles.slice(40)) list.remove(mobile);
  assert.equal(list.highestOccupiedSlot(), 10);
});
