const assert = require("node:assert/strict");
const { before, after, test, mock } = require("node:test");
const h = require("./quest-capture-harness.cjs");
const GATE = 24536, BLOCKER = 24564;
const OUTSIDE = [3261, 3447, 0], INSIDE = [3261, 3446, 0];
const YES = "Yes, I'll go in!", NO = "No thanks, I'll take a look around out here.";
before(async () => {
  h.key = "the_dig_site";
  const world = require("../dist/game/definition/WorldDefinition"), read = world.readWorldConfig;
  const config = mock.method(world, "readWorldConfig", (...args) => {
    const actual = read(...args);
    return { ...actual, plugins: { ...actual.plugins, WorldAdmin: false } };
  });
  try { await h.setup([[3261, 3446]]); } finally { config.mock.restore(); }
});
after(() => h.teardown());
const actor = (t, stage = 9, at = OUTSIDE) => h.actor(t, { stage, at, done: [] });
const position = f => { const p = f.player.getLocation(); return [p.getX(), p.getY(), p.getZ()]; };
async function open(f) {
  await h.dispatch(f, { type: "object_option", id: GATE, x: 3261, y: 3446, clickType: 1 });
  h.ticks(f, 3);
}
async function prompt(f) {
  await open(f);
  assert.match(h.shown(f)?.text ?? "", /Welcome! Would you like/);
  await h.continueLine(f);
  assert.deepEqual(h.MultiChatboxPrompt.getPending(f.player)?.options, [YES, NO]);
}

test("canonical Yes admits, No stays outside, repeat entry is direct until logout", async t => {
  const f = actor(t);
  await prompt(f);
  await h.choose(f, NO);
  h.ticks(f, 3);
  assert.deepEqual(position(f), OUTSIDE);
  f.player.closeInterruptibleInterfaces();
  await prompt(f);
  await h.choose(f, YES);
  h.ticks(f, 4);
  assert.deepEqual(position(f), INSIDE);
  await open(f);
  assert.deepEqual(position(f), OUTSIDE, "exit is free");
  await open(f);
  assert.deepEqual(position(f), INSIDE, "same login no longer asks");
  assert.equal(h.shown(f), null);
  await open(f);
  h.PM.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  await prompt(f);
});

test("incomplete quest and free-world entry are refused, but exit remains free", async t => {
  const f = actor(t, 0);
  await open(f);
  assert.deepEqual(position(f), OUTSIDE);
  assert.equal(h.shown(f)?.text, "You're not permitted in this area.");
  f.player.closeInterruptibleInterfaces();
  h.quest().setStage(f.player, 9);
  const free = t.mock.method(h.core.WorldDefinition, "isMembersWorld", () => false);
  await open(f);
  assert.deepEqual(position(f), OUTSIDE);
  assert.equal(h.shown(f)?.text, "Sorry, you can't come in here.");
  f.player.closeInterruptibleInterfaces();
  f.player.setLocation(new h.core.Location(...INSIDE));
  await open(f);
  assert.deepEqual(position(f), OUTSIDE);
  free.mock.restore();
});

test("a stale Yes cannot pull a moved player into the museum", async t => {
  const f = actor(t);
  await prompt(f);
  f.player.setLocation(new h.core.Location(3262, 3447));
  await h.choose(f, YES);
  h.ticks(f, 4);
  assert.deepEqual(position(f), [3262, 3447, 0]);
});

test("Yes rechecks quest completion before opening", async t => {
  const f = actor(t);
  await prompt(f);
  h.quest().setStage(f.player, 0);
  await h.choose(f, YES);
  h.ticks(f, 4);
  assert.deepEqual(position(f), OUTSIDE);
});

test("the shared opening keeps the invisible barrier so an unqualified bystander cannot follow", async t => {
  const owner = actor(t), bystander = actor(t, 0);
  await prompt(owner);
  await h.choose(owner, YES);
  assert.deepEqual(position(owner), INSIDE);
  const blockers = h.core.World.getObjects().filter(o => o.getId() === BLOCKER && o.getLocation().getX() === 3261 && o.getLocation().getY() === 3446);
  assert.ok(blockers.length > 0, "captured actionless blocker stands in the shared doorway");
  await h.dispatch(bystander, { type: "move", worldX: 3261, worldY: 3446, modifierFlags: 0, run: false });
  h.ticks(bystander, 3);
  assert.deepEqual(position(bystander), OUTSIDE);
  assert.equal(bystander.player.hasFlag("movement:ignore-clipping"), false);
});
