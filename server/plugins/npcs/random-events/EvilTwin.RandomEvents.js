"use strict";

// Evil twin (random event, Postie Pete / Molly): memorise Molly, then steer the claw over her
// identical twin in the pen next door and grab her, within two attempts. Success pays noted
// uncut gems; two wrong grabs teleport the player to one of the wiki's spots instead. The claw
// is the map's locs 20811/20812, moved for this player alone with the same LocDel/LocAdd pairs
// live sends. Packet detail: rsprox 1104, 1105, 75. See SOURCES.md.
const Teleports = require("./Teleports.RandomEvents");
const Rewards = require("./Rewards.RandomEvents");

const REFUSAL = "You didn't come here to do that!";
// [Molly, her twin, the twin held by the claw]: the cache's Molly and Suspect ids sharing models
// and recolours. Any other row's Suspect is an innocent civilian.
const LOOKS = [[342, 5468, 360], [352, 357, 5475], [356, 351, 5481], [361, 5484, 353], [362, 5465, 5473],
  [363, 343, 5462], [364, 345, 338], [365, 354, 339], [366, 355, 340], [367, 359, 341],
  [5464, 5469, 5466], [5467, 347, 5460], [5471, 350, 5479], [5474, 5470, 5472], [5476, 358, 5458],
  [5478, 349, 5477], [5480, 346, 5459], [5485, 5482, 5461], [5486, 5483, 348], [5487, 344, 5463]];
const INNOCENT_COUNT = 4;
const ARRIVAL = { x: 1862, y: 5137, z: 0 };
const MOLLY_TILE = [1860, 5135];
const CONTROL_PANEL = 20813;
const DOOR = 20817;
// The player's door in the wall between the rooms: its west tile is Molly's side.
const DOOR_WEST = [1864, 5137];
const DOOR_EAST = [1865, 5137];
const DOOR_SOUND = 62;
const GROUP = 277;
const SIDE_MODAL_UID = (161 << 16) | 74; // 164:71 in the captures' resizable frame.
const GRAB = 3;
const MOVES = { 7: [-1, 0], 8: [0, -1], 9: [1, 0], 10: [0, 1] }; // rsprox 1104: 7 is west, 8 south.
const ATTEMPTS = 2;
// Pen tiles the suspects were seen on across the three recordings, and the wiki's claw rectangle.
const PEN = { minX: 1866, maxX: 1873, minY: 5124, maxY: 5131 };
const CLAW_AREA = { minX: 1865, maxX: 1875, minY: 5123, maxY: 5133 };
const CLAW_START = [1870, 5132];
const CLAW_ID = 20811;
const CLAW_TARGET_ID = 20812;
const CLAW_SHAPE = 10;
const CLAW_TARGET_SHAPE = 22;
const CLAW_MOVE_SOUND = 2273;
const CLAW_GRAB_SOUND = 2272;
const CLAW_DROP_SOUND = 2271;
const CAGE = { minX: 1865, maxX: 1866, minY: 5123, maxY: 5124 };
const CAGE_TILE = [1866, 5124];
const GRAB_GRAPHIC = 666;
const GRAB_ANIMATION = 4001;
const DROP_GRAPHIC = 667;
const DROP_ANIMATION = 4003;
const CAGED_ANIMATION = 859;
const INNOCENT_LEAVE_GRAPHIC = 188;
const INNOCENT_LEAVE_SOUND = 1930;
const CARRY_TICKS = 5;
const DROP_TICKS = 10;
const CLAW_RESET_TICKS = 11;
const INNOCENTS_LEAVE_TICKS = 16;
const CAUGHT_LINE_TICKS = 20;
const FREEDOM_JINGLE = 101;
const TELEPORT_ANIMATION = 1816;
const TELEPORT_GRAPHIC = 342;
const TELEPORT_SOUNDS = [199, 200];
const TELEPORT_TICKS = 3;
const GEMS = [[1624, "sapphires"], [1622, "emeralds"], [1620, "rubies"], [1618, "diamonds"]];
// Wiki teleportation locations, all three lists.
const SHARED_FAIL_SPOTS = [[3279, 3500, 1], [3097, 3266, 1], [2954, 3388, 3], [3221, 3474, 3], [3229, 3223, 1],
  [3097, 9567, 0], [3287, 3190, 2], [2964, 3213, 1]];
const MEMBERS_FAIL_SPOTS = [[2519, 3426, 1], [2700, 3403, 2], [2536, 3076, 1], [2434, 3346, 2], [2787, 3515, 0],
  [2616, 3292, 1], [2898, 3423, 1], [2708, 3472, 1], [2663, 3111, 0], [2651, 3163, 1], [2772, 3235, 0],
  [2613, 3208, 1], [2207, 4934, 1]];
const F2P_FAIL_SPOTS = [[2968, 3335, 1], [2935, 3515, 0], [3212, 3423, 0], [3076, 3412, 0], [2993, 3145, 0],
  [3025, 3251, 1], [2974, 3382, 1], [3214, 3215, 1], [3112, 3157, 1], [3246, 3451, 0], [3283, 3218, 0],
  [3045, 3491, 0], [3083, 3469, 0]];

function within(bounds, x, y) {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

module.exports = function attach(api, Events) {
  const N = api.core.NpcIdentifiers;

  function say(player, pages, { title = "Select an option", options = null, then = null } = {}) {
    const builder = new api.core.DialogueChainBuilder();
    let index = 0;
    for (const page of pages) {
      if (page.me) builder.add(new api.core.PlayerDialogue(index++, page.text, page.anim));
      else builder.add(new api.core.NpcDialogue(index++, page.npc, page.text, undefined, page.anim));
    }
    if (options) {
      builder.add(new api.core.ActionDialogue(index++, {
        execute: () => api.sendMultiChatboxPrompt(player, title,
          ...options.flatMap(option => [option[0], () => option[1]()])),
      }));
    } else if (then) {
      builder.add(new api.core.ActionDialogue(index++, { execute: () => {
        player.getDialogueManager().reset?.();
        player.getPacketSender().sendInterfaceRemoval();
        then();
      } }));
    } else builder.add(new api.core.EndDialogue(index));
    player.getDialogueManager().startDialogues(builder);
  }

  function after(player, ticks, action) {
    const task = new (class extends api.core.Task {
      constructor() { super(Math.max(1, ticks), player); }
      execute() {
        this.stop();
        if (player.isRegistered()) action();
      }
    })();
    api.getTaskManager().submit(task);
  }

  const definition = {
    id: N.POSTIE_PETE_2,
    kind: "eviltwin",
    greet: name => `Message for you, ${name}!`,
    nags: [name => `Hello, ${name}?`, name => `Urgent message for you, ${name}?`,
      name => `Someone needs your help, ${name}!`, name => `Will you accept the message, ${name}?`],
    goodbye: "Maybe later.",
    linger: true,
    otherPlayerLine: () => "Sorry, I don't have any messages for you.",
    leavingLine: () => "Goodbye.",
    talk(active, { teleport, leave }) {
      const { player } = active;
      say(player, [{ npc: active.definition.id,
        text: `Hello ${player.getUsername()}. I've got a message for you from Molly. She needs your help urgently. Will you assist her now?`,
        anim: 568 }], {
        title: "What would you like to say?",
        options: [
          ["Sure, anything for Molly.", () => say(player, [{ me: true, text: "Sure, anything for Molly." }], { then: () => {
            player.performAnimation(new api.core.Animation(TELEPORT_ANIMATION));
            player.performGraphic(new api.core.Graphic(TELEPORT_GRAPHIC));
            for (const sound of TELEPORT_SOUNDS) player.getPacketSender().sendSound(sound, 1, 0);
            after(player, TELEPORT_TICKS, () => teleport({ kind: "eviltwin", arrive: ARRIVAL, hideTabs: true, teleportRefusal: REFUSAL, onStart: start }));
          } })],
          ["Tell her to get stuffed.", () => { leave(active); say(player, [{ me: true, text: "Tell her to get stuffed." }]); }],
        ],
      });
    },
  };

  function start(session) {
    session.data.attempts = ATTEMPTS;
    session.data.caught = false;
    session.data.failed = false;
    session.data.briefed = false;
    session.data.claw = [...CLAW_START];
    session.tick = watchPanel;
    const looks = LOOKS[Math.floor(Math.random() * LOOKS.length)];
    session.data.mollyId = looks[0];
    session.data.carriedId = looks[2];
    session.molly = Teleports.spawnNpc(session, { id: looks[0], x: MOLLY_TILE[0], y: MOLLY_TILE[1], z: 0, wanderRadius: 0 });
    const others = LOOKS.filter(entry => entry !== looks);
    const suspects = [looks[1]];
    while (suspects.length <= INNOCENT_COUNT) {
      const pick = others.splice(Math.floor(Math.random() * others.length), 1)[0];
      suspects.push(pick[1]);
    }
    session.data.suspects = suspects.map(id => {
      const x = PEN.minX + 1 + Math.floor(Math.random() * (PEN.maxX - PEN.minX));
      const y = PEN.minY + 2 + Math.floor(Math.random() * (PEN.maxY - PEN.minY - 1));
      return { id, npc: Teleports.spawnNpc(session, { id, x, y, z: 0, wanderRadius: 3 }) };
    });
    session.data.twin = session.data.suspects[0];
    Teleports.onEnd(session, () => resetCamera(session));
  }

  // --- Molly and the door ---------------------------------------------------------------

  function molly(session, text, anim) {
    return { npc: session.data.mollyId, text, anim };
  }

  function leave(session, line = true) {
    const pages = [molly(session, "Fine. And there I was thinking you'd help.")];
    if (line) pages.unshift({ me: true, text: "I want to leave." });
    say(session.player, pages, { then: () => Teleports.finish(session) });
  }

  function briefingPages(session, first) {
    const m = (text, anim) => molly(session, text, anim);
    const me = text => ({ me: true, text });
    return first
      ? [m("Thanks for coming!", 567), me("What's the problem then?"),
        m("It's my evil twin sister! She's been galavanting around Gielinor committing crimes and now I'm getting the blame!", 616),
        me("Well what's all this got to do with me then?"), m("I'm glad you asked!", 567),
        m("Through that door is a room with a cage and a control panel that operates a giant mechanical claw.", 589),
        m("I lured my sister into the room so I could imprison her in the cage by using the claw. The problem is my sister managed to herd some innocent civilians in there with her.", 591),
        me("So what do you need me to do?"),
        m("I need you to go next door and use the claw to catch my sister.", 589),
        m("Once she's in prison, she won't be causing me anymore bother!", 615),
        ...briefingEnd(session)]
      : [me("What do I have to do again?"), m("One more time then."),
        m("Through that door is a room with cage and a control panel that operates a giant mechanical claw."),
        m("I lured my sister into the room so I can imprison her in the cage by using the claw. The problem is my sister managed to herd some innocent civilians in there with her."),
        me("So what do you need me to do?"),
        m("I need you to go next door and use the claw to catch my sister."),
        m("Once she's in prison she wont be causing me anymore bother!"),
        ...briefingEnd(session)];
  }

  function briefingEnd(session) {
    const m = (text, anim) => molly(session, text, anim);
    const me = text => ({ me: true, text });
    return [me("Sounds easy enough to me."),
      m("Fabulous! Now take a good long look at me because the door will be locked behind you.  My twin looks exactly like me, even her clothes!", 569),
      m("One more thing to make your life difficult; the magic powering the claw is running low so you'll only have two attempts to catch her.", 590),
      me("I'll do my best then!"),
      m("By the way, would you like me to run through the controls for you, or do you think you'll manage?", 589)];
  }

  function controlsOptions(session) {
    const { player } = session;
    const m = text => molly(session, text);
    const luck = m("Good luck!");
    return [
      ["Yes please.", () => say(player, [
        { me: true, text: "Yes please. I mean, it's always best to be prepared, right?" },
        m("Ok, when you turn the machine on you'll see the glowing mark on the floor where the claw is currently aiming, and you'll see a lever and button on the right hand side of your screen."),
        m("To move the claw's current location, click on the direction you want it to move in, as indicated on the right hand panel."),
        m("You'll know which way the claw will go as the lever will point that way to show you."),
        m("When you see someone on top of the glowing mark, then hit the button on the right hand panel, as this will send the claw down to pick them up."),
        m("Do be careful and make sure that there is someone on the mark, and not just walking past it."),
        m("Oh, and make sure that the person is my sister, so you don't end up catching a random civilian."),
        m("Does that help?"),
        { me: true, text: "Yes, that covers everything. Thanks!" },
        luck,
      ], { then: () => { session.data.briefed = true; } })],
      ["No thanks.", () => say(player, [
        { me: true, text: "No, thanks. I should be able to work it out." }, luck,
      ], { then: () => { session.data.briefed = true; } })],
      ["I want to leave.", () => leave(session)],
    ];
  }

  function talkMolly(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "eviltwin" || event.npc !== session.molly) return false;
    event.handled = true;
    const { player } = session;
    if (session.data.caught) {
      say(player, [
        { me: true, text: "Well, I've managed to get her into the cage.", anim: 588 },
        molly(session, "Fantastic! For so many years I've had to put up with her and now she's locked up for good.", 606),
        molly(session, "Thank you for all your help.  Take this as a reward.", 567),
      ], { then: () => payReward(session) });
      return true;
    }
    if (session.data.failed) {
      say(player, [
        { me: true, text: "Err, sorry. I seem to have messed it up a little." },
        molly(session, "Such incompetence! I should never have asked a baboon like you to do a complex task like this!"),
        molly(session, "Get out of my sight!"),
      ], { then: () => flingAway(session) });
      return true;
    }
    const first = !session.data.talked;
    session.data.talked = true;
    say(player, briefingPages(session, first), { options: controlsOptions(session) });
    return true;
  }

  function payReward(session) {
    const { player } = session;
    const [id, name] = GEMS[Math.floor(Math.random() * GEMS.length)];
    const amount = 2 + Math.floor(Math.random() * 3);
    Teleports.finish(session);
    player.getPacketSender().sendJingle(FREEDOM_JINGLE);
    Rewards.give(api, player, [{ id, amount }]);
    const builder = new api.core.DialogueChainBuilder()
      .add(new api.core.ItemStatementDialogue(0, id, `Molly's given you ${amount} noted uncut ${name}.`))
      .add(new api.core.EndDialogue(1));
    player.getDialogueManager().startDialogues(builder);
  }

  function flingAway(session) {
    const { player } = session;
    const local = api.core.WorldDefinition.isMembersWorld() ? MEMBERS_FAIL_SPOTS : F2P_FAIL_SPOTS;
    const spots = [...SHARED_FAIL_SPOTS, ...local];
    const [x, y, z] = spots[Math.floor(Math.random() * spots.length)];
    Teleports.finish(session, { back: false });
    player.moveTo(new api.core.Location(x, y, z));
  }

  function onMollysSide(player) {
    return player.getLocation().getX() < DOOR_EAST[0];
  }

  function crossDoor(session) {
    const { player } = session;
    const [x, y] = onMollysSide(player) ? DOOR_EAST : DOOR_WEST;
    player.getPacketSender().sendSound(DOOR_SOUND, 1, 0);
    player.moveTo(new api.core.Location(x, y, 0));
  }

  function useDoor(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "eviltwin") return false;
    if (event.object.getId?.() !== DOOR) return false;
    event.handled = true;
    const { player } = session;
    if (session.data.caught || session.data.failed) {
      crossDoor(session);
      return true;
    }
    if (!onMollysSide(player)) {
      say(player, [molly(session, "You need to finish grabbing my twin before you come back through!")], { options: [
        ["Okay.", () => say(player, [{ me: true, text: "Okay." }])],
        ["But I want to leave.", () => {
          say(player, [{ me: true, text: "But I want to leave." }, molly(session, "Fine. And there I was thinking you'd help.")],
            { then: () => Teleports.finish(session) });
        }],
      ] });
      return true;
    }
    if (session.data.briefed) {
      crossDoor(session);
      return true;
    }
    say(player, [molly(session, "Wait! Do you know what you're doing here?", 588)], { options: [
      ["Yes, I know.", () => say(player, [
        { me: true, text: "Yes, I know, I've been here before." }, molly(session, "Well good luck then!", 588),
      ], { then: () => {
        session.data.briefed = true;
        crossDoor(session);
      } })],
      ["Erm, no I don't actually.", () => say(player, [
        { me: true, text: "Erm, no I don't actually." },
        molly(session, "Well, come on over and I'll fill you in on what happened."),
      ])],
      ["I want to leave.", () => leave(session)],
    ] });
    return true;
  }

  function grabByHand(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "eviltwin") return false;
    event.handled = true;
    say(session.player, [molly(session, "You need to use the control panel to use the claw!")]);
    return true;
  }

  // --- The claw --------------------------------------------------------------------------

  function clawLocs(tile) {
    const location = new api.core.Location(tile[0], tile[1], 0);
    return [new api.core.GameObject(CLAW_TARGET_ID, location, CLAW_TARGET_SHAPE, 0, null),
      new api.core.GameObject(CLAW_ID, location, CLAW_SHAPE, 0, null)];
  }

  function removeClaw(sender, tile) {
    for (const loc of clawLocs(tile)) sender.sendObjectRemoval(loc);
  }

  function showClaw(sender, tile) {
    for (const loc of clawLocs(tile)) sender.sendObject(loc);
  }

  function resetCamera(session) {
    if (!session.data.watching) return;
    session.data.watching = false;
    session.player.getPacketSender().sendCameraReset();
  }

  // Walking away closes the panel, and live hands the camera back with it (rsprox 75 tick 23608).
  function watchPanel(session) {
    if (session.data.watching && session.player.getInterfaceId?.() !== GROUP) resetCamera(session);
  }

  function usePanel(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "eviltwin") return false;
    if (event.object.getId() !== CONTROL_PANEL) return false;
    event.handled = true;
    if (session.data.caught || session.data.failed) return true;
    const sender = event.player.getPacketSender();
    const [x, y] = session.data.claw;
    sender.sendCameraLookAt(x, y, 50, { rate: 100, rate2: 100 });
    sender.sendCameraMoveTo(CLAW_START[0], CLAW_START[1] + 8, 675, { rate: 100, rate2: 100 });
    session.interfaceId = GROUP;
    session.data.watching = true;
    event.player.setInterfaceId(GROUP);
    sender.sendSubInterface(SIDE_MODAL_UID, GROUP, 0);
    sender.sendInterfaceFlagsRange((GROUP << 16) | GRAB, -1, -1, 1 << 1);
    for (const component of Object.keys(MOVES)) {
      sender.sendInterfaceFlagsRange((GROUP << 16) | Number(component), -1, -1, 1 << 1);
    }
    return true;
  }

  function moveClaw(session, [dx, dy]) {
    const sender = session.player.getPacketSender();
    const [x, y] = session.data.claw;
    const [nextX, nextY] = [x + dx, y + dy];
    if (!within(CLAW_AREA, nextX, nextY)) return;
    removeClaw(sender, session.data.claw);
    session.data.claw = [nextX, nextY];
    showClaw(sender, session.data.claw);
    sender.sendSound(CLAW_MOVE_SOUND, 1, 0);
    sender.sendCameraLookAt(nextX, nextY, 50, { rate: 100, rate2: 100 });
  }

  function clawClick(event) {
    const { player, buttonId } = event;
    if ((buttonId >>> 16) !== GROUP) return;
    const child = buttonId & 0xffff;
    event.handled = true;
    const session = Teleports.sessionOf(player);
    if (event.action !== 1 || !session || session.kind !== "eviltwin" || !session.data.watching) return;
    if (MOVES[child]) {
      moveClaw(session, MOVES[child]);
      return;
    }
    if (child === GRAB) grab(session);
  }

  function grab(session) {
    const { player } = session;
    const [x, y] = session.data.claw;
    if (within(CAGE, x, y)) {
      player.sendMessage("You're supposed to be putting people in there, not taking them out!");
      return;
    }
    const target = session.data.suspects.find(entry => entry.npc &&
      entry.npc.getLocation().getX() === x && entry.npc.getLocation().getY() === y);
    // No recording or wiki line covers grabbing an empty tile, so it costs nothing here.
    if (!target) return;
    if (target !== session.data.twin) {
      session.data.attempts--;
      if (session.data.attempts > 0) return;
      session.data.failed = true;
      closePanel(session);
      say(player, [molly(session, "Well, you tried your best I suppose. Come next door and talk to me.")]);
      return;
    }
    session.data.caught = true;
    player.sendMessage("You caught the Evil twin!");
    closePanel(session);
    playCapture(session, target.npc);
  }

  function closePanel(session) {
    const { player } = session;
    resetCamera(session);
    player.getPacketSender().sendInterfaceRemoval();
    player.getPacketSender().closeSubInterface?.(SIDE_MODAL_UID);
    session.interfaceId = 0;
  }

  // rsprox 1104 ticks 2095-2115. Live walks the carried twin to the cage; she is moved there
  // when the claw drops her here, because the engine has no scripted noclip walk for her.
  function playCapture(session, twin) {
    const { player } = session;
    const sender = player.getPacketSender();
    removeClaw(sender, session.data.claw);
    sender.sendCameraLookAt(CAGE_TILE[0], CAGE_TILE[1], 50, { rate: 1, rate2: 10 });
    sender.sendSound(CLAW_GRAB_SOUND, 1, 0);
    twin.performGraphic?.(new api.core.Graphic(GRAB_GRAPHIC));
    twin.performAnimation(new api.core.Animation(GRAB_ANIMATION));
    twin.setNpcTransformationId?.(session.data.carriedId);
    Teleports.later(session, CARRY_TICKS, () => twin.forceChat("You're putting me in prison?!"));
    Teleports.later(session, DROP_TICKS, () => {
      twin.setNpcTransformationId?.(-1);
      twin.moveTo?.(new api.core.Location(CAGE_TILE[0], CAGE_TILE[1], 0));
      twin.performGraphic?.(new api.core.Graphic(DROP_GRAPHIC));
      twin.performAnimation(new api.core.Animation(DROP_ANIMATION));
      player.getPacketSender().sendSound(CLAW_DROP_SOUND, 1, 0);
    });
    Teleports.later(session, CLAW_RESET_TICKS, () => {
      session.data.claw = [...CLAW_START];
      const packets = player.getPacketSender();
      showClaw(packets, CLAW_START);
      packets.sendCameraLookAt(CLAW_START[0], CLAW_START[1], 50, { rate: 100, rate2: 100 });
      packets.sendCameraMoveTo(CLAW_START[0], CLAW_START[1] - 3, 500, { rate: 10, rate2: 10 });
      packets.sendCameraLookAt(CLAW_START[0] - 2, CLAW_START[1] - 6, 250, { rate: 10, rate2: 10 });
    });
    Teleports.later(session, INNOCENTS_LEAVE_TICKS, () => {
      twin.performAnimation(new api.core.Animation(CAGED_ANIMATION));
      const packets = player.getPacketSender();
      for (const suspect of session.data.suspects) {
        if (suspect === session.data.twin || !suspect.npc) continue;
        packets.sendGraphic(new api.core.Graphic(INNOCENT_LEAVE_GRAPHIC), suspect.npc.getLocation());
        packets.sendSound(INNOCENT_LEAVE_SOUND, 1, 0);
        api.removeNpc(suspect.npc);
        suspect.npc = null;
      }
    });
    Teleports.later(session, CAUGHT_LINE_TICKS, () => {
      player.sendMessage("Congratulations! You caught the evil twin.");
      player.getPacketSender().sendCameraReset();
      say(player, [molly(session, "Well done! You managed to catch my sister!", 567),
        molly(session, "Come next door and talk to me.", 567)]);
    });
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));
  api.onObjectInteraction("Control panel", { Use: usePanel, Operate: usePanel });
  api.onInterfaceActionClick(clawClick);
  api.onNpcInteraction("Molly", { "Talk-to": talkMolly });
  api.onNpcInteraction("Suspect", { Grab: grabByHand });
  api.onObjectInteraction("Door", { Open: useDoor });
};
