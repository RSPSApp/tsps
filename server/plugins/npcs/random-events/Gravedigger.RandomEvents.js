"use strict";

// Gravedigger (random event, Leo): take the five coffins, check who is inside, read the
// gravestones and put each coffin in the grave whose stone shows its owner. Any coffin fits any
// empty grave; only Leo checks the result. The stones (interface 175) and coffins (interface
// 141) show pictures, never words. Zombie outfit pieces come in twos until the set is complete,
// then the zombie emotes, then lamps. RSProx 550. See SOURCES.md.
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");
const Rewards = require("./Rewards.RandomEvents");

const FILLED_GRAVES = [9364, 9365, 9366, 9367, 10049];
const EMPTY_GRAVE = 10050;
const GRAVE_TILES = [[1924, 4996], [1926, 4999], [1928, 4996], [1930, 4999], [1932, 4996]];
const STONE_TILES = [[1924, 4998], [1926, 5001], [1928, 4998], [1930, 5001], [1932, 4998]];
const COFFINS = [7587, 7588, 7589, 7590, 7591];
/** The model on the stone of the grave each coffin belongs in. */
const STONE_MODELS = new Map([[7587, 13403], [7588, 16035], [7589, 13404], [7590, 13402], [7591, 13399]]);
const BONES = 7598;
const SKULL = 7611;
/**
 * What a coffin's Check shows: [item, x, y], on interface 141's components 3-11. 7588-7591 are
 * as sent live. 7587 was never checked in the recording: its items are the two left over from
 * the set, on 7588's layout.
 */
const COFFIN_CONTENTS = new Map([
  [7587, [[7599, 7, 6], [BONES, -4, 8], [7608, -4, -7], [BONES, 4, 19], [BONES, -4, 19], [SKULL, -7, 9],
    [BONES, 4, -15], [BONES, -5, -19], [BONES, -4, 16]]],
  [7588, [[7607, 7, 6], [BONES, -4, 8], [7606, -4, -7], [BONES, 4, 19], [BONES, -4, 19], [SKULL, -7, 9],
    [7597, 4, -15], [BONES, -5, -19], [BONES, -4, 16]]],
  [7589, [[7604, 4, -16], [7600, -4, -4], [BONES, -4, 7], [SKULL, 6, 17], [BONES, 8, 17], [BONES, -9, 16],
    [BONES, 4, 19], [BONES, 6, -16], [7601, 4, 4]]],
  [7590, [[BONES, -7, -9], [7610, 4, 15], [BONES, 6, -4], [SKULL, 9, -4], [BONES, -8, 4], [BONES, -5, 10],
    [7609, 4, 10], [BONES, -6, -6], [7602, -9, -6]]],
  [7591, [[BONES, -4, -4], [SKULL, 8, 4], [BONES, -7, 17], [BONES, 4, 9], [BONES, -5, 16], [BONES, -4, -18],
    [7612, 4, -9], [7603, -5, 8], [7605, -4, -18]]],
]);
const STONE_INTERFACE = 175;
const STONE_MODEL_UID = (STONE_INTERFACE << 16) | 1;
const COFFIN_INTERFACE = 141;
const COFFIN_FIRST_ITEM = 3;
const COFFIN_ITEM_ZOOM = 200;
const COFFIN_SOUND = 54;
const SET_POSITION_SCRIPT = 65;
const SCROLL_SETUP_SCRIPT = 2524;
const SCROLL_INTERFACE = 220;
/** Interface 220's text lines, components 1-15. */
const INSTRUCTIONS = ["", "", "", "", "Pick up the coffins.", "Check the body inside.",
  "Find out where they need to be buried.", "Put all five coffins in the correct graves.",
  "You can store items in the mausoleum if you need more", "inventory space.", "", "", "", "", ""];
const GRAVE_ANIMATION = 827;
const GRAVE_SOUND = 2738;
const GRAVE_DELAY = 1;
const RETURN_DELAY = 9;
const ZOMBIE = [13283, 13284, 13285, 13286, 13287];
/** The zombie emotes' varbits, Zombie Dance first as in RSProx 550. */
const EMOTE_UNLOCKS = new Map([["emote_zombie_dance", "Zombie Dance"], ["emote_zombie_walk", "Zombie Walk"]]);
const LEO_TILE = [1928, 5003];
// Chathead animations and message types as sent live (550).
const PLAYER_EXPRESSION = 567;
const INVITE_EXPRESSION = 611;
const PLEA_EXPRESSION = 597;
const INSTRUCTION_EXPRESSION = 612;
const WONDERFUL_EXPRESSION = 568;
const SPAM_MESSAGE_TYPE = 105;
const BOX_MESSAGE_TYPE = 115;
const NAGS = [name => `Hello, ${name}?`, name => `Please help me, ${name}.`, name => `I need your help, ${name}!`,
  name => `Can I borrow you for a minute, ${name}?`];
const INSTRUCTION_LINE = "I need you to pick up the coffin from each grave, see who's inside it, " +
  "and bury it in the grave with the correct gravestone.";

function shuffled(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function settled(contents, owners) {
  return contents.every((coffin, grave) => coffin === owners[grave]);
}

module.exports = function attach(api, Events) {
  const I = api.core.ItemIdentifiers;
  const N = api.core.NpcIdentifiers;

  const definition = {
    id: N.LEO_2,
    kind: "gravedigger",
    greet: name => NAGS[Math.floor(Math.random() * NAGS.length)](name),
    nags: NAGS,
    goodbye: "Maybe later.",
    linger: true,
    otherPlayerLine: owner => `Sorry, I need help from ${owner.getUsername()}.`,
    leavingLine: () => "Goodbye.",
    talk(active, { teleport, leave }) {
      const { player } = active;
      Flow.chat(api, {
        player,
        npcId: active.definition.id,
        title: "What would you like to say?",
        lines: [{ text: `Can you come and help me, ${player.getUsername()}? I've got a problem with some graves.`,
          expression: INVITE_EXPRESSION }],
        options: [
          ["Okay, I'll help with your graves.", () => reply(player, "Okay, I'll help with your graves.",
            () => teleport({
              kind: "gravedigger",
              arrive: { x: 1928, y: 5002, z: 0 },
              onStart: start,
            }))],
          ["Sorry, I'm busy.", () => { leave(active); reply(player, "Sorry, I'm busy."); }],
        ],
      });
    },
  };

  function reply(player, text, onEnd = null) {
    Flow.chat(api, { player, pages: [{ player: true, text, expression: PLAYER_EXPRESSION }], onEnd });
  }

  function start(session) {
    const { player } = session;
    session.data.owners = shuffled(COFFINS);
    session.data.contents = shuffled(COFFINS);
    // "I've put the wrong coffins into these graves": never already solved.
    if (settled(session.data.contents, session.data.owners)) {
      const { contents } = session.data;
      [contents[0], contents[1]] = [contents[1], contents[0]];
    }
    session.data.graveObjects = new Map();
    session.data.digging = false;
    session.data.returning = false;
    session.leo = Teleports.spawnNpc(session, { id: N.LEO, x: LEO_TILE[0], y: LEO_TILE[1], z: 0,
      wanderRadius: 0, ownerOnly: true });
    Teleports.onEnd(session, () => restoreGraves(session));
    Flow.chat(api, {
      player,
      npcId: N.LEO,
      lines: [{ text: `You have to help me, ${player.getUsername()}! I've put the wrong coffins into these graves.`,
        expression: PLEA_EXPRESSION }, { text: INSTRUCTION_LINE, expression: INSTRUCTION_EXPRESSION }],
      onEnd: () => showInstructions(player),
    });
  }

  /** The graves are map scenery, so an emptied one goes back to its filled loc for the next visitor. */
  function restoreGraves(session) {
    for (const [grave, object] of session.data.graveObjects) {
      if (object.getId() !== FILLED_GRAVES[grave]) Teleports.replaceObject(object, FILLED_GRAVES[grave]);
    }
  }

  function showInstructions(player) {
    const sender = player.getPacketSender();
    INSTRUCTIONS.forEach((text, index) => sender.sendString(text, (SCROLL_INTERFACE << 16) | (index + 1)));
    sender.sendClientScript(SCROLL_SETUP_SCRIPT, -1, -1);
    sender.sendInterface(SCROLL_INTERFACE);
  }

  function graveIndex(location) {
    return GRAVE_TILES.findIndex(([x, y]) => x === location.getX() && y === location.getY());
  }

  function swapGrave(session, grave, object, newId) {
    session.data.graveObjects.set(grave, Teleports.replaceObject(object, newId));
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));

  api.onObjectInteraction("Grave", { "Take-Coffin": takeCoffin });

  function takeCoffin(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "gravedigger") return false;
    event.handled = true;
    const { player, object } = event;
    const grave = graveIndex(object.getLocation());
    if (grave < 0 || session.data.digging || session.data.contents[grave] === null) return true;
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() <= 0) {
      inventory.full?.();
      return true;
    }
    session.data.digging = true;
    digAnimation(player);
    Teleports.later(session, GRAVE_DELAY, () => {
      session.data.digging = false;
      const coffin = session.data.contents[grave];
      session.data.contents[grave] = null;
      swapGrave(session, grave, object, EMPTY_GRAVE + grave);
      inventory.addItem(new api.core.Item(coffin, 1));
      player.getPacketSender().sendTypedMessage(SPAM_MESSAGE_TYPE, "You take the coffin from the grave.");
    });
    return true;
  }

  function digAnimation(player) {
    player.performAnimation(new api.core.Animation(GRAVE_ANIMATION));
    player.getPacketSender().sendSound?.(GRAVE_SOUND, 0, 0);
  }

  api.onObjectInteraction("Gravestone", { Read: readStone });

  function readStone(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "gravedigger") return false;
    event.handled = true;
    const index = STONE_TILES.findIndex(([x, y]) =>
      x === event.object.getLocation().getX() && y === event.object.getLocation().getY());
    if (index < 0) return true;
    const sender = event.player.getPacketSender();
    sender.sendTypedMessage(SPAM_MESSAGE_TYPE, "You examine the gravestone. It shows...");
    sender.sendInterfaceRawModel(STONE_MODEL_UID, STONE_MODELS.get(session.data.owners[index]));
    sender.sendInterface(STONE_INTERFACE);
    return true;
  }

  api.onItemOnObject(itemOnGrave);

  function itemOnGrave(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "gravedigger" || !event.object) return false;
    const { player, object } = event;
    const grave = graveIndex(object.getLocation());
    if (grave < 0) return false;
    const objectId = object.getId();
    const empty = objectId === EMPTY_GRAVE + grave;
    if (!empty && objectId !== FILLED_GRAVES[grave]) return false;
    const itemId = event.itemId ?? event.sourceItemId;
    if (!COFFINS.includes(itemId)) {
      if (!/bones|remains/i.test(new api.core.Item(itemId, 1).getDefinition().getName() ?? "")) return false;
      event.handled = true;
      player.sendMessage("Burying that here would be very silly.");
      return true;
    }
    if (!empty) return false;
    event.handled = true;
    if (session.data.digging) return true;
    session.data.digging = true;
    digAnimation(player);
    Teleports.later(session, GRAVE_DELAY, () => {
      session.data.digging = false;
      if (!player.getInventory().containsNumber(itemId) || session.data.contents[grave] !== null) return;
      player.getInventory().delete(itemId, 1);
      session.data.contents[grave] = itemId;
      swapGrave(session, grave, object, FILLED_GRAVES[grave]);
      player.getPacketSender().sendTypedMessage(SPAM_MESSAGE_TYPE, "You put the coffin into the grave.");
    });
    return true;
  }

  api.onItemAction("Coffin", { Check: checkCoffin });

  function checkCoffin(event) {
    const contents = COFFIN_CONTENTS.get(event.itemId);
    if (!contents) return false;
    const sender = event.player.getPacketSender();
    contents.forEach(([item, x, y], index) => {
      const uid = (COFFIN_INTERFACE << 16) | (COFFIN_FIRST_ITEM + index);
      sender.sendItemOnInterfaces(uid, item, COFFIN_ITEM_ZOOM);
      sender.sendClientScript(SET_POSITION_SCRIPT, x, y, 0, uid);
    });
    sender.sendInterface(COFFIN_INTERFACE);
    sender.sendSound?.(COFFIN_SOUND, 0, 0);
    return true;
  }

  api.onObjectInteraction("Mausoleum", { Deposit: useMausoleum });

  function useMausoleum(event) {
    event.handled = true;
    api.emitCustomEvent("bank:open-deposit-box", { player: event.player });
    return true;
  }

  api.onNpcInteraction("Leo", { "Talk-to": talkToLeo });

  function talkToLeo(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "gravedigger" || event.npc !== session.leo) return false;
    event.handled = true;
    if (session.data.returning) return true;
    const { player } = event;
    api.sendMultiChatboxPrompt(player, "Select an option",
      "I think I've finished!", () => reply(player, "I think I've finished!", () => checkGraves(session)),
      "Remind me what I'm supposed to do.", () => reply(player, "Remind me what I'm supposed to do.",
        () => Flow.chat(api, { player, npcId: N.LEO, lines: [{ text: INSTRUCTION_LINE, expression: INSTRUCTION_EXPRESSION }],
          onEnd: () => showInstructions(player) })),
      "I want to leave now.", () => reply(player, "I want to leave now.", () => Flow.chat(api, {
        player,
        npcId: N.LEO,
        lines: ["In that case, I'll take you back to where I found you."],
        onEnd: () => {
          player.getPacketSender().sendInterfaceRemoval();
          Teleports.finish(session);
        },
      })));
    return true;
  }

  function checkGraves(session) {
    const { player } = session;
    if (!settled(session.data.contents, session.data.owners)) {
      Flow.chat(api, {
        player,
        pages: [
          { npcId: N.LEO, text: "That's a good attempt, but it's just not right. Try looking in the coffins to learn " +
            "who is in them, and read the gravestones to see who is supposed to be buried there." },
          { player: true, text: "All right, I'll give it another shot." },
        ],
      });
      return;
    }
    // Live sends the player back on its own a few ticks after this line.
    session.data.returning = true;
    Flow.chat(api, { player, npcId: N.LEO, lines: [{
      text: "Wonderful! That's taken care of them. I'll take you back, and give you your reward.",
      expression: WONDERFUL_EXPRESSION }] });
    Teleports.later(session, RETURN_DELAY, () => {
      player.getPacketSender().sendInterfaceRemoval();
      reward(session);
    });
  }

  function reward(session) {
    const player = session.player;
    const missing = ZOMBIE.filter(piece => !Teleports.owns(player, piece)).slice(0, 2);
    const emote = missing.length ? undefined : Rewards.unlockEmote(api, player, [...EMOTE_UNLOCKS.keys()]);
    const rewards = missing.map(piece => ({ id: piece, amount: 1 }));
    if (!missing.length && !emote) rewards.push({ id: I.LAMP, amount: 1 });
    Teleports.finish(session, { reward: rewards });
    if (emote) {
      const text = `You can now use the ${EMOTE_UNLOCKS.get(emote)} emote!`;
      player.getPacketSender().sendTypedMessage(BOX_MESSAGE_TYPE, text);
      Flow.statement(api, player, text);
    }
  }
};
