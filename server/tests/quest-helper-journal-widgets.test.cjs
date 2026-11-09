// A guide that syncs on the quest journal reads it through WidgetTextRequirement, and the journal
// is built client-side, so a headless snapshot has none of its text. Clock Tower therefore came
// back `unsupported` (UNSUPPORTED_API) instead of its first cog step. authoritative() now supplies
// the journal the player would see, for the quest being evaluated only, laid out the way live
// mounts it: the lines are the text layer's static children, and an open journal the browser sent
// for another quest is overlaid rather than left to shadow it.
//
// Run after `yarn build`: node --test tests/quest-helper-journal-widgets.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { QuestHelperRuntime } = require("../plugins/quests/questhelper/Runtime.QuestHelper");

// QuestRuntime's journal layout: group 119, title child 5, text layer 6, lines from child 11.
const JOURNAL_GROUP = 119;
const JOURNAL_TITLE_CHILD = 5;
const JOURNAL_TEXTLAYER_CHILD = 6;
const JOURNAL_FIRST_LINE_CHILD = 11;
const uid = (child) => (JOURNAL_GROUP << 16) | child;

function fixture() {
  const quest = {
    key: "clock_tower",
    name: "Clock Tower",
    varpId: 10,
    getStage: () => 2,
    isStarted: () => true,
    isComplete: () => false,
    varpValue: (stage) => stage,
    buildJournal: () => [
      "I need to find the four cogs.",
      "<str>I have successfully placed the Red Cog on its spindle.",
    ],
  };
  const player = {
    getAttribute: () => undefined,
    getInventory: () => ({ getItems: () => [] }),
    getEquipment: () => ({ getItems: () => [] }),
    getLocation: () => ({ getX: () => 2568, getY: () => 3247, getZ: () => 0 }),
    getUsername: () => "Fixture",
  };
  const bridge = { catalog: async () => ({ quests: [] }), evaluate: async () => ({}), close: async () => {} };
  const runtime = new QuestHelperRuntime({ getQuests: () => [quest], bridge, send: () => {} });
  return { runtime, player, quest };
}

const countById = (widgets, id) => {
  let count = 0;
  for (const widget of widgets ?? []) {
    if (!widget || typeof widget !== "object") continue;
    if (widget.id === id) count += 1;
    for (const key of ["children", "staticChildren", "dynamicChildren", "nestedChildren"]) {
      count += countById(widget[key], id);
    }
  }
  return count;
};

const findById = (widgets, id) => {
  for (const widget of widgets ?? []) {
    if (!widget || typeof widget !== "object") continue;
    if (widget.id === id) return widget;
    for (const key of ["children", "staticChildren", "dynamicChildren", "nestedChildren"]) {
      const found = findById(widget[key], id);
      if (found) return found;
    }
  }
  return null;
};

test("the snapshot carries the quest journal the guide reads", () => {
  const { runtime, player } = fixture();
  const snapshot = runtime.authoritative(player, {}, "clock_tower");
  assert.match(findById(snapshot.widgets, uid(JOURNAL_TITLE_CHILD)).text, /Clock Tower/);
  const layer = findById(snapshot.widgets, uid(JOURNAL_TEXTLAYER_CHILD));
  assert.ok(layer, "the text layer is present");
  assert.equal(layer.staticChildren.length, 2, "the lines hang under the text layer");
  assert.match(layer.staticChildren[0].text, /four cogs/);
  assert.match(layer.staticChildren[1].text, /placed the Red Cog/, "a placed cog keeps its struck-through line");
});

test("a journal the client already sent is replaced, not duplicated", () => {
  const { runtime, player } = fixture();
  const raw = { widgets: [{ id: uid(JOURNAL_TITLE_CHILD), text: "stale" }, { id: 12345, text: "keep me" }] };
  const snapshot = runtime.authoritative(player, raw, "clock_tower");
  const titles = snapshot.widgets.filter((widget) => widget.id === uid(JOURNAL_TITLE_CHILD));
  assert.equal(titles.length, 1, "one title widget");
  assert.match(titles[0].text, /Clock Tower/);
  assert.ok(snapshot.widgets.some((widget) => widget.id === 12345), "unrelated widgets survive");
});

test("an open journal for another quest is overlaid, not left to shadow the selected one", () => {
  const { runtime, player } = fixture();
  // The browser nests the open journal under its own roots, and the bridge indexes nested widgets
  // first, keeping the first widget per id: a stale nested journal would win over a top-level one.
  const raw = {
    widgets: [
      {
        id: 1,
        runtimeId: 1,
        bounds: { x: 0, y: 0, width: 512, height: 334 },
        nestedChildren: [
          {
            id: uid(JOURNAL_TITLE_CHILD),
            runtimeId: uid(JOURNAL_TITLE_CHILD),
            bounds: { x: 4, y: 4, width: 100, height: 12 },
            text: "<col=7f0000>Cook's Assistant</col>",
          },
          {
            id: uid(JOURNAL_TEXTLAYER_CHILD),
            runtimeId: uid(JOURNAL_TEXTLAYER_CHILD),
            bounds: { x: 4, y: 20, width: 100, height: 200 },
            staticChildren: [{ id: uid(JOURNAL_FIRST_LINE_CHILD), text: "I should buy a bucket." }],
          },
        ],
      },
    ],
  };
  const snapshot = runtime.authoritative(player, raw, "clock_tower");
  const title = findById(snapshot.widgets, uid(JOURNAL_TITLE_CHILD));
  assert.match(title.text, /Clock Tower/, "the selected quest's title wins");
  assert.deepEqual(title.bounds, { x: 4, y: 4, width: 100, height: 12 }, "the nested widget keeps its metadata");
  const layer = findById(snapshot.widgets, uid(JOURNAL_TEXTLAYER_CHILD));
  assert.match(layer.staticChildren[0].text, /four cogs/, "the text layer carries the selected quest's lines");
  assert.equal(
    countById(snapshot.widgets, uid(JOURNAL_TITLE_CHILD)),
    1,
    "no second title widget is added beside the nested one",
  );
});

test("only the evaluated quest's journal is added", () => {
  const { runtime, player } = fixture();
  const snapshot = runtime.authoritative(player, {}, "cooks_assistant");
  assert.equal(snapshot.widgets, undefined, "no journal for a quest the runtime does not know");
});
