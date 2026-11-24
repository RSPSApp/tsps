const assert = require("node:assert/strict");
const { test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { Player } = require("../dist/game/entity/impl/player/Player");
const { ActorPresentation } = require("../dist/game/model/ActorPresentation");
const { Animation } = require("../dist/game/model/Animation");
const { Graphic } = require("../dist/game/model/Graphic");
const { Priority } = require("../dist/game/model/Priority");

test("a player measures the animation stall of an authored replacement", t => {
  const player = new Player(null);
  const started = t.mock.method(player.getCombat(), "onAnimationStarted", () => {});
  const original = new Animation(7642, Priority.HIGH);
  original.delay = 4;
  ActorPresentation.with([{ entity: player, animation: 7644 }], () => true, () => {
    player.performAnimation(original);
  });
  assert.equal(player.getAnimation().getId(), 7644);
  assert.equal(player.getAnimation().getPriority(), Priority.HIGH);
  assert.equal(player.getAnimation().getDelay(), 4);
  assert.deepEqual(started.mock.calls.map(call => call.arguments), [[7644]]);
});

test("presentation leaves animation reset and graphic clears intact", () => {
  const player = new Player(null);
  const cues = [];
  const look = { entity: player, animation: 7644, suppressGraphics: true,
    onGraphic: (graphic, slot) => { cues.push([graphic.getId(), slot]); return true; } };
  player.performAnimation(new Animation(7642));
  player.performGraphic(new Graphic(5));
  player.performGraphicInSlot(2, new Graphic(6));
  ActorPresentation.with([look], () => true, () => {
    player.performAnimation(new Animation(Animation.DEFAULT_RESET_ANIMATION.getId()));
    player.performGraphic(new Graphic(-1));
    player.performGraphicInSlot(2, new Graphic(-1));
  });
  assert.equal(player.getAnimation().getId(), Animation.DEFAULT_RESET_ANIMATION.getId());
  assert.equal(player.getGraphic().getId(), -1);
  assert.equal(player.getSlotGraphics().get(2).getId(), -1);
  assert.deepEqual(cues, []);
});

test("a slot zero graphic reaches the presentation callback once", () => {
  const player = new Player(null);
  const cues = [];
  const look = { entity: player,
    onGraphic: (graphic, slot) => { cues.push([graphic.getId(), slot]); return slot === 2; } };
  ActorPresentation.with([look], () => true, () => {
    player.performGraphicInSlot(0, new Graphic(5));
    player.performGraphicInSlot(2, new Graphic(6));
  });
  assert.deepEqual(cues, [[5, 0], [6, 2]]);
  assert.equal(player.getGraphic().getId(), 5);
  assert.equal(player.getSlotGraphics().has(2), false);
});
