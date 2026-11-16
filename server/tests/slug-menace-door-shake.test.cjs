// Run after `yarn build`: node --test tests/slug-menace-door-shake.test.cjs
//
// The Slug Menace: the queen's door opening shakes the camera (0, 6, 0, 0; Scenes.SlugMenace.js DOOR.opens), and that
// shake follows All Settings > Display "Toggle all atmospheric camera shake effects" (varbit 16110), like the other
// atmospheric scene shakes. Real Player, PlayerSession and ClientConnection, the real plugins, cache and map: the
// fifth rune goes on the door as an item_on_object packet and each tick runs as World.process does
// (tests/between-a-rock-harness.cjs). No client ran.
const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const H = require("./between-a-rock-harness.cjs");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const ATMOSPHERIC_SHAKES_OFF = 16110; // option_camera_effect_atmospherics_disabled
const DOOR = 18413; // the queen's door, 2348,5093
const DOOR_TILE = [2348, 5093];
const DOOR_RUMBLE = 3033; // Scenes.SlugMenace.js DOOR.rumble
const STAGE_RUNES = 11;
const FLAGS_ATTRIBUTE = "the-slug-menace:flags";
const USED_RUNES_ATTRIBUTE = "quest.the_slug_menace.used-runes";

before(async () => {
  await H.boot();
  H.core.RegionManager.loadMapFiles(...DOOR_TILE);
});
after(H.shutdown);

/** At the door with four runes used and the fire rune (the fifth) in hand. */
function atDoor(t, { shakesOff }) {
  const f = H.actor(t, { at: [2348, 5092, 0], items: [H.core.ItemIdentifiers.COMMORB_V2, H.core.ItemIdentifiers.FIRE_RUNE_6] });
  QuestRuntime.questNamed("The Slug Menace").setStage(f.player, STAGE_RUNES);
  f.player.setAttribute("the-slug-menace:stage-format", 1);
  f.player.setAttribute(FLAGS_ATTRIBUTE, 1 << 6);
  f.player.setAttribute(USED_RUNES_ATTRIBUTE, 31 & ~4);
  if (shakesOff) f.player.getPacketSender().sendVarbit(ATMOSPHERIC_SHAKES_OFF, 1);
  return f;
}

async function openTheDoor(f) {
  await H.useOnObject(f, H.core.ItemIdentifiers.FIRE_RUNE_6, DOOR, DOOR_TILE);
  H.ticks(f, 20);
  // The door's rumble (DOOR.rumble, sent on the same tick as the shake) shows the door opened, whatever the setting.
  assert.ok(H.callsNamed(f, "sendSound").some((call) => call.args[0] === DOOR_RUMBLE), "the door opens");
}

test("the queen's door shakes the camera with atmospheric shakes on", async (t) => {
  const f = atDoor(t, { shakesOff: false });
  await openTheDoor(f);
  assert.deepEqual(H.callsNamed(f, "sendCameraShake").map((call) => call.args), [[0, 6, 0, 0]]);
});

test("the queen's door sends no shake with atmospheric shakes off", async (t) => {
  const f = atDoor(t, { shakesOff: true });
  await openTheDoor(f);
  assert.deepEqual(H.callsNamed(f, "sendCameraShake"), [], "no door shake with the setting off");
});
