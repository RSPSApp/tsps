// A guide that syncs on the quest journal reads it through WidgetTextRequirement, and the journal
// is built client-side, so a headless snapshot has none of its text. Clock Tower therefore came
// back `unsupported` (UNSUPPORTED_API) instead of its first cog step. authoritative() now supplies
// the journal the player would see, for the quest being evaluated only.
//
// Run after `yarn build`: node --test tests/quest-helper-journal-widgets.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { QuestHelperRuntime } = require("../plugins/quests/questhelper/Runtime.QuestHelper");

// QuestRuntime's journal layout: group 119, title child 5, lines from child 11.
const JOURNAL_GROUP = 119;
const JOURNAL_TITLE_CHILD = 5;
const JOURNAL_FIRST_LINE_CHILD = 11;
const uid = (child) => (JOURNAL_GROUP << 16) | child;

function fixture() {
  const quest = {
    key: "clock_tower",
    name: "Clock Tower",
    varpId: 10,
    getStage: () => 1,
    isStarted: () => true,
    isComplete: () => false,
    varpValue: (stage) => stage,
    buildJournal: () => [
      "I need to find the four cogs.",
      "I have placed the <col=ff0000>red cog</col>.",
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

test("the snapshot carries the quest journal the guide reads", () => {
  const { runtime, player } = fixture();
  const snapshot = runtime.authoritative(player, {}, "clock_tower");
  const text = new Map(snapshot.widgets.map((widget) => [widget.id, widget.text]));
  assert.match(text.get(uid(JOURNAL_TITLE_CHILD)), /Clock Tower/, "the journal title is the quest name");
  assert.match(text.get(uid(JOURNAL_FIRST_LINE_CHILD)), /four cogs/, "the first journal line is present");
  assert.match(text.get(uid(JOURNAL_FIRST_LINE_CHILD + 1)), /red cog/, "later lines keep their own child ids");
});

test("a journal the client already sent is replaced, not duplicated", () => {
  const { runtime, player } = fixture();
  const raw = { widgets: [{ id: uid(JOURNAL_TITLE_CHILD), text: "stale" }, { id: 12345, text: "keep me" }] };
  const snapshot = runtime.authoritative(player, raw, "clock_tower");
  const ids = snapshot.widgets.map((widget) => widget.id);
  assert.equal(ids.filter((id) => id === uid(JOURNAL_TITLE_CHILD)).length, 1, "one title widget");
  assert.match(snapshot.widgets.find((widget) => widget.id === uid(JOURNAL_TITLE_CHILD)).text, /Clock Tower/);
  assert.ok(ids.includes(12345), "unrelated widgets survive");
});

test("only the evaluated quest's journal is added", () => {
  const { runtime, player } = fixture();
  const snapshot = runtime.authoritative(player, {}, "cooks_assistant");
  assert.equal(snapshot.widgets, undefined, "no journal for a quest the runtime does not know");
});
