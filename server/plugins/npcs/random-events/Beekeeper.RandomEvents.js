"use strict";

// Beekeeper (random event): the player is taken to the beehive field and rebuilds the hive by
// dragging its four jumbled parts into their slots on cache interface 420, with six attempts.
// The cache draws the interface entirely from varbits 10601-10608 (scripts 3056, 3060, 3061)
// and swaps them on the client when a part is dropped (script 3062), the server keeps the same
// state from the IF_BUTTOND it receives. See SOURCES.md.
// Flow and packets: rsprox 1875 (only recording, a first-try pass). The wrong-build and fail
// lines are Transcript:Bee_keeper. Rewards: https://oldschool.runescape.wiki/w/Beekeeper_(random_event)
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");
const Rewards = require("./Rewards.RandomEvents");

const GROUP = 420;
const CONFIRM = 22;
const SELECT_ACTION = 1;
const NPC_CHAT_TITLE = "What would you like to say?";
// Components 10-13 hold the loose parts, 15/17/19/21 the Lid/Body/Entrance/Legs slots, in the
// order cache script 3056 passes them to 3060; each is one varbit, 0 for empty or part 1-4.
const COMPONENTS = [10, 11, 12, 13, 15, 17, 19, 21];
const VARBITS = [10601, 10602, 10603, 10604, 10605, 10606, 10607, 10608];
const FIRST_SLOT = 4;
const PARTS = [1, 2, 3, 4];
const MAX_ATTEMPTS = 6;
const OUTFIT = [25129, 25131, 25133, 25135, 25137];
const BEE_SWARM = 10444;
const TELEPORT_SOUND = 1930;
const BUILT_SOUND = 938;
// Transcript:Bee_keeper's waiting lines; 1875 opens with the second.
const OVERHEADS = [name => `Hello, ${name}?`, name => `Please help me, ${name}.`,
  name => `I need your help, ${name}!`, name => `Can I borrow you for a minute, ${name}?`];
// 1875: the player lands two tiles west of the keeper, who faces them, and steps one tile to
// him when he speaks. Live is instanced, the tile is the wiki map's.
const ARRIVAL = { x: 1926, y: 5044, z: 0 };
const BESIDE_KEEPER = { x: 1927, y: 5044, z: 0 };
const KEEPER = { x: 1928, y: 5044, z: 0 };
const KEEPER_FACING_WEST = 4;
// 1875: the chat closes on the last continue and the return follows three ticks later.
const RETURN_TICKS = 3;
// Not in any capture: the transcript only orders these. Roughly the swarm's overheads apart.
const FAIL_STEP_TICKS = 3;
const REMINDER = "All the parts of the beehive are jumbled up. You've got to put them in the correct order for building a hive.";

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

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

  const definition = {
    id: N.BEE_KEEPER_2,
    kind: "beekeeper",
    greet: name => pick(OVERHEADS)(name),
    nags: OVERHEADS,
    goodbye: "Maybe later.",
    linger: true,
    otherPlayerLine: () => "Sorry, you're not the person I need.",
    leavingLine: () => "Goodbye.",
    talk(active, { teleport, leave }) {
      const { player } = active;
      Flow.chat(api, {
        player,
        npcId: active.definition.id,
        title: NPC_CHAT_TITLE,
        lines: [`I'm sorry to bother you, ${player.getUsername()}, but I need some help with a bee hive.`],
        options: [
          ["Ooh, a bee hive. I'll help you.", () => Flow.chat(api, {
            player,
            pages: [{ player: true, text: "Ooh, a bee hive. I'll help you." }],
            onEnd: () => teleport({ kind: "beekeeper", arrive: ARRIVAL, onStart: start }),
          })],
          ["Buzz off!", () => { leave(active); Flow.chat(api, { player, pages: [{ player: true, text: "Buzz off!" }] }); }],
        ],
      });
    },
  };

  function start(session) {
    const { player } = session;
    const { Location } = api.core;
    const sender = player.getPacketSender();
    sender.sendInterfaceRemoval();
    sender.sendSound(TELEPORT_SOUND, 1, 0);
    session.keeper = Teleports.spawnNpc(session, { id: N.BEE_KEEPER, x: KEEPER.x, y: KEEPER.y, z: KEEPER.z,
      face: KEEPER_FACING_WEST, wanderRadius: 0 });
    session.data.attempts = MAX_ATTEMPTS;
    session.data.slots = [0, 0, 0, 0, 0, 0, 0, 0];
    session.data.state = "building";
    player.moveTo(new Location(BESIDE_KEEPER.x, BESIDE_KEEPER.y, BESIDE_KEEPER.z));
    player.setPositionToFace(new Location(KEEPER.x, KEEPER.y, KEEPER.z));
    Teleports.onEnd(session, () => {
      for (const varbit of VARBITS) sender.sendVarbit(varbit, 0);
      Teleports.restoreTabs(player);
    });
    Teleports.hideTabs(player);
    Flow.chat(api, {
      player,
      npcId: N.BEE_KEEPER,
      pages: [
        { text: `Ah, ${player.getUsername()}. I'm sorry to drag you away like this, but I need some help building a new hive for my bees.` },
        { player: true, text: "What do you expect me to do?" },
        { text: REMINDER },
        { player: true, text: "Oh, very well. Let's take a look..." },
      ],
      onEnd: () => openInterface(session),
    });
  }

  function showSlots(session) {
    const sender = session.player.getPacketSender();
    session.data.slots.forEach((part, index) => sender.sendVarbit(VARBITS[index], part));
  }

  // 1875 jumbles the parts in the same tick that opens the interface.
  function openInterface(session) {
    const { player } = session;
    const sender = player.getPacketSender();
    session.data.slots = [...shuffled(PARTS), 0, 0, 0, 0];
    showSlots(session);
    sender.sendInterfaceRemoval();
    session.interfaceId = GROUP;
    sender.sendInterface(GROUP);
  }

  /** The IF_BUTTOND of a dropped part: the same swap as the client's script 3062. */
  function drag(event) {
    const { player, packet } = event;
    if (packet.type !== "widget_drag" || (packet.sourceWidgetId >>> 16) !== GROUP) return;
    event.handled = true;
    const session = Teleports.sessionOf(player);
    if (!session || session.kind !== "beekeeper" || session.data.state !== "building" ||
        player.getInterfaceId?.() !== GROUP || (packet.targetWidgetId >>> 16) !== GROUP) return;
    const from = COMPONENTS.indexOf(packet.sourceWidgetId & 0xffff);
    const to = COMPONENTS.indexOf(packet.targetWidgetId & 0xffff);
    if (from < 0 || to < 0 || from === to) return;
    const { slots } = session.data;
    if (!slots[from]) return;
    [slots[from], slots[to]] = [slots[to], slots[from]];
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBITS[from], slots[from]);
    sender.sendVarbit(VARBITS[to], slots[to]);
  }

  function attempt(session) {
    const { player } = session;
    const built = session.data.slots.slice(FIRST_SLOT);
    if (built.some(part => part === 0)) return;
    session.data.state = "talking";
    const sender = player.getPacketSender();
    sender.sendInterfaceRemoval();
    if (built.every((part, index) => part === PARTS[index])) {
      sender.sendSound(BUILT_SOUND, 1, 0);
      Flow.chat(api, {
        player,
        npcId: N.BEE_KEEPER,
        lines: ["That's perfect! I'll get some bees moved in immediately.",
          "Now, I'm sure I must have something to offer you for all your help..."],
        onEnd: () => {
          sender.sendInterfaceRemoval();
          Teleports.later(session, RETURN_TICKS, () => Teleports.finish(session, { reward: rewards(player) }));
        },
      });
      return;
    }
    session.data.attempts--;
    if (session.data.attempts <= 0) {
      Flow.chat(api, {
        player,
        npcId: N.BEE_KEEPER,
        lines: ["Uh-oh, the bees are fed up with waiting for you to build them a home!"],
        onEnd: () => stung(session),
      });
      return;
    }
    const left = session.data.attempts;
    Flow.chat(api, {
      player,
      npcId: N.BEE_KEEPER,
      lines: ["No, that doesn't look right. You have to put the parts in the right order, otherwise it'll be no good as a beehive.",
        `I'll let you have ${left === 1 ? "one" : left} more ${left === 1 ? "try" : "tries"}.`],
      onEnd: () => {
        session.data.state = "building";
        openInterface(session);
      },
    });
  }

  // 1875 pays the outfit piece, then the lamp. Wiki: always a lamp; a missing outfit piece comes
  // first since March 2022, otherwise noted flax on members worlds and coins on free worlds.
  function rewards(player) {
    const lamp = { id: I.LAMP, amount: 1 };
    const missing = OUTFIT.filter(piece => !Teleports.owns(player, piece));
    if (missing.length) return [{ id: pick(missing), amount: 1 }, lamp];
    if (api.core.WorldDefinition.isMembersWorld()) {
      return [{ id: I.FLAX_2, amount: 1 + Math.floor(Math.random() * 27) }, lamp];
    }
    return [{ id: I.COINS, amount: 30 + Math.floor(Math.random() * 70) }, lamp];
  }

  // Transcript order; there is no recording of a failed build.
  function stung(session) {
    const { player, keeper } = session;
    player.getPacketSender().sendInterfaceRemoval();
    const at = player.getLocation();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1]]) {
      Teleports.spawnNpc(session, { id: BEE_SWARM, x: at.getX() + dx, y: at.getY() + dy, z: at.getZ(),
        wanderRadius: 0 });
    }
    player.forceChat("Aaaaargh - BEES!");
    Teleports.later(session, FAIL_STEP_TICKS, () => {
      player.forceChat(pick(["Ooch!", "Eek!", "Beees!", "Ow!"]));
      Teleports.later(session, FAIL_STEP_TICKS, () => {
        keeper?.forceChat("I'll help you!");
        Teleports.later(session, FAIL_STEP_TICKS, () => {
          Flow.statement(api, player, "The bee keeper obligingly teleports you away from the angry swarms.");
          Teleports.later(session, FAIL_STEP_TICKS, () => {
            player.getPacketSender().sendInterfaceRemoval();
            Teleports.finish(session);
          });
        });
      });
    });
  }

  function talkToKeeper(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "beekeeper" || event.npc !== session.keeper) return false;
    event.handled = true;
    if (session.data.state !== "building") return true;
    const { player } = event;
    Flow.chat(api, {
      player,
      npcId: N.BEE_KEEPER,
      lines: ["Ready to try again?"],
      options: [
        ["First remind me of what I'm doing.", () => Flow.chat(api, {
          player,
          npcId: N.BEE_KEEPER,
          pages: [{ player: true, text: "First remind me of what I'm doing." }, { text: REMINDER }],
          onEnd: () => openInterface(session),
        })],
        ["Yeah, let me get on with it.", () => Flow.chat(api, {
          player,
          pages: [{ player: true, text: "Yeah, let me get on with it." }],
          onEnd: () => openInterface(session),
        })],
        // Wiki: "The event can be left before completion by talking with the beekeeper". The
        // transcript has no line for it, so this option's wording is not live text.
        ["I want to leave.", () => Teleports.finish(session)],
      ],
    });
    return true;
  }

  function confirm(event) {
    if ((event.buttonId >>> 16) !== GROUP || (event.buttonId & 0xffff) !== CONFIRM) return;
    event.handled = true;
    const session = Teleports.sessionOf(event.player);
    if (event.action !== SELECT_ACTION || !session || session.kind !== "beekeeper" ||
        session.data.state !== "building") return;
    attempt(session);
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));
  api.onCustomEvent("player:widget-action", drag);
  api.onNpcInteraction("Bee keeper", { "Talk-to": talkToKeeper });
  api.onInterfaceActionClick(confirm);
};
