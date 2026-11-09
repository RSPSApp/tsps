/**
 * Enchantment Ritual, as recorded (rsprox 227/01850, 01855 and 01723; forestry.json `ritual`):
 * - a Dryad appears by the tree (spotanim 2572, sound 7540 at her), and each step five ritual
 *   circles within three tiles of her, each with its spotanim as a map_anim and sound 7549 at the
 *   tree;
 * - she carries headbar 17, sent every 5 ticks and as a step is scored, filling 0 to 60 over the
 *   eight steps (01850);
 * - the odd circle is the one whose colour and shape are both unique among the five (true of all
 *   eight recorded steps); standing on it when the step closes scores it;
 * - a step lasts 30 ticks: the circles fade at 27, when it's scored, and the next five come at
 *   30; the scorer gets their circle's spotanim and synth 7535 with the step's bark; after eight
 *   steps she leaves (sound 7540 at her; "You all completed every ritual step, amazing!" when
 *   every one was done) with synth 7531, "Well done, you completed N steps of the ritual! The
 *   Dryad has left you a gift..." and the bark lump.
 * - Talk-to: "Hello, what's going on?" (chatquiz1), her ask (chathap2) and the menu; "Sure, How
 *   can I help?" goes straight to her explanation (01723, 01850).
 * Wiki: 20-21 bark and 2 x level + 60 Woodcutting XP a step; 2 x steps x level + 55 at the end;
 * recorded lumps were about 18 a step. Unknown: what more players change.
 */
const Common = require("./Common.Forestry");
const Spawns = require("./Spawns.Forestry");

const R = () => Common.data.ritual;
/** Rituals now on the map. */
const events = new Set();

function start(site) {
  const ritual = R();
  const tiles = Common.freeTiles(site, site.location, ritual.range, site.size);
  if (tiles.length < 1) return null;
  const event = { site, step: 0, elapsed: 0, circles: [], odd: null, steps: new Map(), scored: 0, over: false };
  event.dryad = Common.spawnNpc(ritual.npc, tiles[0], ritual.graphics.spawn);
  Common.areaSound(tiles[0], ritual.sounds.dryad, ritual.sounds.radius);
  if (!placeCircles(event)) {
    Common.removeNpc(event.dryad);
    return null;
  }
  events.add(event);
  Common.every(() => tick(event));
  return event;
}

/**
 * Five circles: two colours by two shapes, and one more whose colour and shape are neither, so
 * it alone is odd (as every recorded step was).
 */
function pickCircles() {
  const colours = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
  const shapes = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
  const grid = [[0, 0], [0, 1], [1, 0], [1, 1]].map(([c, s]) => [colours[c], shapes[s]]);
  return { odd: [colours[2], shapes[2]], others: grid };
}

function placeCircles(event) {
  const ritual = R();
  const tiles = Common.freeTiles(event.site, event.dryad.getLocation(), ritual.range).filter((t) => !t.equals(event.dryad.getLocation()));
  if (tiles.length < 5) return false;
  const { odd, others } = pickCircles();
  const all = [odd, ...others].sort(() => Math.random() - 0.5);
  // forestry.json `circles` is by shape (a-d), then colour (1-4), as the cache names them.
  event.circles = all.map(([colour, shape], i) => ({ colour, shape, npc: Common.spawnNpc(ritual.circles[shape][colour], tiles[i]), at: tiles[i] }));
  event.odd = event.circles.find((c) => c.colour === odd[0] && c.shape === odd[1]);
  for (const circle of event.circles) Common.tileGraphic(circle.at, ritual.spotanims[circle.shape][circle.colour]);
  Common.areaSound(event.site.location, ritual.sounds.circles, ritual.sounds.radius);
  return true;
}

function clearCircles(event) {
  for (const circle of event.circles) Common.removeNpc(circle.npc);
  event.circles = [];
  event.odd = null;
}

/** The step closes: whoever stands on the odd circle scores it. */
function score(event) {
  if (!event.odd) return;
  const ritual = R();
  for (const circle of event.circles) Common.animate(circle.npc, ritual.seqs.circleGone);
  const at = event.odd.at;
  const spotanim = ritual.spotanims[event.odd.shape][event.odd.colour];
  const standing = [...new Set([...event.site.participants, ...Common.nearbyPlayers(at, 0)])].filter((p) => p.getLocation().equals(at));
  let scored = false;
  for (const player of standing) {
    if (!Spawns.eligible(event, player)) {
      Common.xp(player, "WOODCUTTING", 1);
      continue;
    }
    scored = true;
    event.steps.set(player, (event.steps.get(player) ?? 0) + 1);
    Common.xp(player, "WOODCUTTING", ritual.xp.perLevel * Common.level(player, "WOODCUTTING") + ritual.xp.plus);
    Common.bark(player, Common.randomInt(...ritual.stepBark));
    player.performGraphic?.(new Common.core.Graphic(spotanim));
    Common.sound(player, ritual.sounds.step);
  }
  if (scored) event.scored++;
  showProgress(event);
}

/** The ritual's progress on the Dryad's headbar, as recorded. */
function showProgress(event) {
  const { headbar } = R();
  event.dryad.showHeadbar?.(headbar.id, { fill: headbar.fills[Math.min(event.scored, headbar.fills.length - 1)] });
}

function tick(event) {
  if (event.over) return false;
  event.elapsed++;
  const { stepTicks, scoreAt, steps, headbar } = R();
  const inStep = event.elapsed - event.step * stepTicks;
  if (inStep === scoreAt) score(event);
  else if (event.elapsed % headbar.every === 0) showProgress(event);
  if (inStep >= stepTicks) {
    clearCircles(event);
    event.step++;
    if (event.step >= steps) {
      end(event);
      return false;
    }
    if (!placeCircles(event)) {
      end(event);
      return false;
    }
  }
  return true;
}

function end(event) {
  event.over = true;
  events.delete(event);
  const ritual = R();
  clearCircles(event);
  const everyStep = event.steps.size > 0 && [...event.steps.values()].every((n) => n === ritual.steps);
  if (everyStep) event.dryad.forceChat?.(Common.message("ritualAll"));
  event.dryad.performGraphic?.(new Common.core.Graphic(ritual.graphics.leave));
  Common.animate(event.dryad, ritual.seqs.leave);
  Common.areaSound(event.dryad.getLocation(), ritual.sounds.dryad, ritual.sounds.radius);
  Common.later(ritual.leaveTicks, () => Common.removeNpc(event.dryad));
  for (const [player, steps] of event.steps) {
    player.sendMessage(Common.message("ritualDone", { steps }));
    Common.sound(player, ritual.sounds.done);
    Common.bark(player, Math.round(ritual.lumpPerStep * steps), true);
    Common.xp(player, "WOODCUTTING", ritual.xp.perLevel * steps * Common.level(player, "WOODCUTTING") + ritual.xp.bonusPlus);
  }
  Spawns.ended(event);
}

function eventOf(npc) {
  for (const event of events) if (event.dryad === npc) return event;
  return null;
}

/** Recorded: her greeting and the menu; "Sure" goes straight to her explanation. */
function talk({ player, npc }) {
  if (!eventOf(npc)) return false;
  const [hello, ask, no, yes, explain] = Common.data.messages.dryad;
  const { npc: id, chatheads } = R();
  Common.chat(player, id, [["player", hello, chatheads.chatquiz1], ["npc", ask, chatheads.chathap2]], () => {
    Common.menu(player,
      [no, () => Common.chat(player, id, [["player", no]])],
      [yes, () => Common.chat(player, id, [["npc", explain, chatheads.chathap2]])]);
  });
  return true;
}

function attachRitual(api) {
  Spawns.registerEvent("ritual", { start });
  api.onNpcInteraction("Dryad", { "Talk-to": talk });
}

module.exports = { attachRitual, start, pickCircles, score, end, events };
