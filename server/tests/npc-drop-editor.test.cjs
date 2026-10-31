// Run after `yarn build`: node --test tests/npc-drop-editor.test.cjs
// The map editor's drop table panel edits npc-drop-overrides.json through the
// keys tested here: base-row removals/rates, editor additions, and reverting.
const assert = require("node:assert/strict");
const test = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const Drops = require("../plugins/npcs/NpcDrops.plugin");

function table() {
  return {
    main_max_roll: 128,
    entries: [
      { item_id: 1, name: "One", quantity: [1, 1], weight: 10, out_of: 128 },
      { item_id: 2, name: "Two", quantity: [1, 1], weight: 5, out_of: 128 },
    ],
    tertiary: [],
  };
}

test("editor overrides remove and re-rate dump rows, then add rows", () => {
  const dump = { tables: { goblin: table() }, npcs: {} };
  Drops.__internals.applyOverrides(dump, {}, {
    tables: {
      goblin: {
        removeEntries: [{ field: "entries", index: 1 }],
        setEntries: { "entries:0": { weight: 20, out_of: 256 } },
        addEntries: [{ item_id: 3, name: "Hand written", quantity: [1, 1], weight: 1, out_of: 128 }],
        editorEntries: [{ item_id: 4, name: "Editor", quantity: [1, 1], weight: 2, out_of: 128 }],
      },
    },
  });

  const entries = dump.tables.goblin.entries;
  assert.deepEqual(entries.map((entry) => entry.item_id), [1, 3, 4]);
  assert.equal(entries[0].weight, 20);
  assert.equal(entries[0].out_of, 256);
  assert.equal(entries[0].rarity, 20 / 256);
});

test("a table reset clears editor keys but keeps hand-written overrides", () => {
  const change = Drops.__internals.buildTableOverrideChange(table(), {
    addEntries: [{ item_id: 8, name: "Manual" }],
    editorEntries: [{ item_id: 9, name: "Editor" }],
    removeEntries: [{ field: "entries", index: 0 }],
    setEntries: { "entries:1": { weight: 1 } },
    removeSections: ["Contract"],
    why: "content",
  }, { reset: true });

  assert.equal(change.addEntries.length, 1);
  assert.equal(change.removeSections[0], "Contract");
  assert.equal(change.why, "content");
  assert.equal(change.editorEntries, undefined);
  assert.equal(change.removeEntries, undefined);
  assert.equal(change.setEntries, undefined);
});

test("a save replaces editor additions and merges base row edits", () => {
  const change = Drops.__internals.buildTableOverrideChange(table(), {
    editorEntries: [{ item_id: 9, name: "Old" }],
    removeEntries: [{ field: "entries", index: 0 }],
  }, {
    addedEntries: [{ item_id: 9, name: "New", quantity: [2, 3], weight: 1, out_of: 50, section: "Editor" }],
    addedTertiary: [],
    removeEntries: [{ field: "entries", index: 1 }],
    setEntries: { "entries:0": { weight: 2 } },
  });

  assert.deepEqual(change.editorEntries.map((entry) => entry.name), ["New"]);
  assert.deepEqual(change.editorEntries[0].quantity, [2, 3]);
  assert.equal(change.editorTertiary, undefined);
  assert.deepEqual(
    change.removeEntries.sort((a, b) => a.index - b.index),
    [{ field: "entries", index: 0 }, { field: "entries", index: 1 }],
  );
  assert.deepEqual(change.setEntries, { "entries:0": { weight: 2 } });
});
