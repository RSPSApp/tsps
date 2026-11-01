"use strict";

// Drill Demon (random event, Sergeant Damien): perform four ordered exercises in a row on the
// mat whose sign matches the order. Wrong mats only break the streak. Camouflage outfit
// pieces, then the four exercise emotes with a lamp, then lamps. The training area, mats and
// sign posts ship in the world data; the posts are swapped to the four exercise signs after
// every attempt. Every mat is a 1x2 pair of ground decorations at y=4819/4820 with its sign
// at y=4821, so the player is walked onto the north tile and faces the sign before the
// exercise. See SOURCES.md.
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");
const Rewards = require("./Rewards.RandomEvents");

const EXERCISES = [
  { name: "star jumps", sign: 16506, animation: 870 },
  { name: "push ups", sign: 9315, animation: 872 },
  { name: "sit ups", sign: 9314, animation: 874 },
  { name: "jogging", sign: 20805, animation: 824 },
];
const MATS = [[3160, 20810], [3162, 16508], [3164, 9313], [3166, 20801]];
const MAT_IDS = new Set(MATS.map(([, id]) => id));
const SIGNS_Y = 4821;
// The mat tile under each sign post; the player exercises on it, facing the sign.
const MAT_ROW_Y = SIGNS_Y - 1;
const SIGN_IDS = new Set([16502, 16477, 16478, 16507, 9314, 9315, 16506, 20805]);
const OUTFIT = [6654, 6656, 6655];
const NEEDED = 4;

// The four sign posts are shared by everyone in the drill area; found once from the map.
const signObjects = new Map();

function shuffled(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

module.exports = function attach(api, Events) {
  const I = api.core.ItemIdentifiers;
  const N = api.core.NpcIdentifiers;
  const { GameObject, Location, ObjectManager } = api.core;

  const definition = {
    id: N.SERGEANT_DAMIEN_2,
    kind: "drill",
    greeting: "Private",
    talk(active, { teleport }) {
      const { player } = active;
      Flow.chat(api, {
        player,
        npcId: active.definition.id,
        lines: [`Private ${player.getUsername()}, atten-SHUN! You've been recommended for my corps.`,
          "Do you think you can be the best?"],
        options: [
          ["Sir, yes sir!", () => teleport({
            kind: "drill",
            arrive: { x: 3163, y: 4820, z: 0 },
            teleportRefusal: "I haven't dismissed you yet, Private!",
            onStart: start,
          })],
          ["No thanks, I'm not interested.", () => {}],
        ],
      });
    },
  };

  function ensureSigns() {
    if (signObjects.size) return;
    for (const [x] of MATS) {
      const location = new Location(x, SIGNS_Y, 0);
      const object = [...SIGN_IDS].map(id => api.core.MapObjects.get(id, location.clone(), null))
        .find(entry => entry);
      if (object) signObjects.set(x, object);
    }
  }

  function start(session) {
    ensureSigns();
    session.data.streak = 0;
    session.data.matExercise = new Map();
    shuffleSigns(session);
    order(session);
  }

  function shuffleSigns(session) {
    const exercises = shuffled(EXERCISES);
    MATS.forEach(([x], index) => {
      session.data.matExercise.set(x, exercises[index]);
      const object = signObjects.get(x);
      if (object) signObjects.set(x, Teleports.replaceObject(object, exercises[index].sign));
    });
  }

  function order(session) {
    const exercise = EXERCISES[Math.floor(Math.random() * EXERCISES.length)];
    session.data.order = exercise;
    const player = session.player;
    player.sendMessage(`Sergeant Damien orders: ${orderText(exercise)}`);
    Flow.chat(api, {
      player,
      npcId: N.SERGEANT_DAMIEN,
      lines: [`I want to see you on that mat doing ${exercise.name}, Private!`],
      options: [
        ["Okay.", () => {}],
        ["I want to leave.", () => Teleports.finish(session,
          { message: "Pathetic. Get out of here then." })],
      ],
    });
  }

  function orderText(exercise) {
    if (exercise.name === "star jumps") return "Do some star jumps on the mat!";
    if (exercise.name === "push ups") return "Drop and give me push ups on that mat!";
    if (exercise.name === "sit ups") return "Get on that mat and give me sit ups!";
    return "Get yourself over there and jog on that mat!";
  }

  function useMat(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "drill") return false;
    const object = event.object;
    const exchange = session.data.matExercise;
    const expected = exchange?.get(object.getLocation().getX());
    if (!expected) return false;
    event.handled = true;
    const player = event.player;
    // Route-to-mat has already walked the player onto the tile under the sign; the exercise is
    // made facing that sign, as in the event area.
    player.setPositionToFace(new Location(object.getLocation().getX(), SIGNS_Y, object.getLocation().getZ()));
    player.performAnimation(new api.core.Animation(expected.animation));
    judgement(session, expected);
    return true;
  }

  // Both halves of a mat are 1x1 ground decorations with the sign directly north. Walk the
  // player onto the north tile instead of stopping in the gap between two mats, then the
  // interaction runs on arrival. Live capture: rsprox 1846, event area 3128,4768.
  function routeToMat(event) {
    if (event.clickType !== 1 || !MAT_IDS.has(event.objectId)) return;
    const location = event.object.getLocation();
    event.destination = { x: location.getX(), y: MAT_ROW_Y, z: location.getZ() };
  }

  function judgement(session, exercise) {
    const player = session.player;
    if (exercise !== session.data.order) {
      session.data.streak = 0;
      player.sendMessage("Wrong exercise, worm!");
      shuffleSigns(session);
      order(session);
      return;
    }
    session.data.streak++;
    if (session.data.streak >= NEEDED) {
      const rewards = [{ id: I.LAMP, amount: 1 }];
      const missing = OUTFIT.find(piece => !Teleports.owns(player, piece));
      if (missing === undefined) {
        player.sendMessage("Well I'll be, you actually did it, Private. Take this and get out of my sight.");
        if (Rewards.unlockEmote(api, player, ["emote_drilldemon"])) {
          player.sendMessage("You have unlocked the Sit up, Push up, Star jump and Jog emotes.");
        }
      } else {
        rewards.push({ id: missing, amount: 1 });
        player.sendMessage("Well I'll be, you actually did it, Private. Take this and get out of my sight.");
      }
      Teleports.finish(session, { reward: rewards });
      return;
    }
    shuffleSigns(session);
    order(session);
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));
  api.onObjectRoute(routeToMat);
  api.onObjectInteraction("Exercise mat", { Use: useMat });
};
