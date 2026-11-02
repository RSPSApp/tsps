"use strict";

// Evil Bob (random event): the cat offers either his ScapeRune island or his prison.
// Island: the servant's cutscene shows the fishing spot whose fish Bob likes; pick up a net,
// catch one, uncook it at the pot and feed Bob until he sleeps, then leave by the portal for
// 650 Fishing (or Magic) XP. Prison: varbit 1549 picks which of the four balloon shapes each
// wandering group shows; the lever names a shape, three right keys clear the barriers, then
// walking out with Pete pays a reward. Packet detail: rsprox 73 and 1718 (island), 4067 and
// 555 (prison). See SOURCES.md.
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");
const Rewards = require("./Rewards.RandomEvents");

const WELCOME = " <br>Welcome to ScapeRune.";
const REFUSAL = "You didn't come here to do that!";
const MEWS = ["Mew!", "Yowl!", "Meeeow!", "Meeeeow!"]; // No name, every recording of 390 and 6754.
const TELEPORT_ANIMATION = 714;
const TELEPORT_GRAPHIC = 111;

const ISLAND = { minX: 2500, maxX: 2548, minY: 4758, maxY: 4798 };
const ISLAND_ARRIVALS = [[2527, 4778], [2528, 4772]]; // rsprox 73, 1718
const ISLAND_TELEPORT_TICKS = 3;
const ISLAND_TELEPORT_SOUND = 200;
const FISHING_SPOT = 23114;
const UNCOOK_POT = 23113;
const PORTAL = 23115;
const NET = 6209;
const NET_TILES = [[2518, 4768], [2516, 4784], [2520, 4786], [2533, 4769], [2535, 4772], [2533, 4784], [2536, 4783]];
const NET_RESPAWN_TICKS = 25; // 27 ticks in rsprox 73, 24 in 1718.
const NET_LIFETIME_TICKS = 6000;
const RAW_CORRECT = 6200;
const COOKED_CORRECT = 6202;
const RAW_WRONG = 6204;
const COOKED_WRONG = 6206;
const FISH_ITEMS = [NET, RAW_CORRECT, COOKED_CORRECT, RAW_WRONG, COOKED_WRONG];
const CAST_ANIMATION = 620;
const CATCH_TICKS = 9;
const UNCOOK_ANIMATION = 897;
const UNCOOK_ANIMATION_DELAY = 30;
const UNCOOK_SOUND = 2322;
const UNCOOK_TICKS = 3;
const SPOTS = ["west", "north", "south", "east"];
const CUTSCENE_TICKS = 8;
const CUTSCENE_OVERLAY = 186;
const OVERLAY_UID = (161 << 16) | 8;
const CUTSCENE_FROM = [2526, 4777];
// [first look, camera, last look]. North and east are rsprox 1718 and 73; no recording has the
// west or south spot, so those mirror the same offsets from their fishing spots.
const CUTSCENE_SHOTS = {
  north: [[2526, 4786], [2527, 4783], [2527, 4785]],
  east: [[2538, 4776], [2535, 4776], [2537, 4776]],
  south: [[2526, 4768], [2527, 4772], [2527, 4770]],
  west: [[2514, 4776], [2518, 4776], [2516, 4776]],
};
const SLEEP_SAY_TICKS = 2;
const RASPBERRY_ANIMATION = 2110;
const RASPBERRY_ANIMATION_DELAY = 10;
const PORTAL_SAY_TICKS = 3;
const PORTAL_TELEPORT_TICKS = 5;
const PORTAL_LEAVE_TICKS = 8;
const ISLAND_XP = 650;
const MAGIC_XP_LEVEL = 51;

const PRISON_ARRIVAL = [2093, 4467]; // rsprox 4067, 555
const PRISON_TELEPORT_TICKS = 6;
const PRISON_TELEPORT_SOUND = 201;
const LEVER = 24296;
const LEVER_ANIMATION = 798;
const LEVER_LOC_ANIMATION = 450;
const LEVER_SOUND = 2400;
const LEVER_OPEN_TICKS = 2;
const LEVER_INTERFACE = 273;
const LOCKED_DOORS = [24293, 24294];
const KEY = 6966;
// The wandering groups 5490, 5494, 5495 and 5496 resolve through this varbit (1-24) to one id of
// each shape, so popping is judged on the resolved id. `lever` is the model 273:4 shows.
const ARRANGEMENT_VARBIT = 1549;
const ARRANGEMENTS = 24;
const SHAPES = [
  { npcs: [5488, 370], lever: 11028 },
  // No recording shows this shape's lever model, so it uses the balloon's own NPC model.
  { npcs: [5489, 371], lever: 10736 },
  { npcs: [5491, 5492], lever: 11034 },
  { npcs: [5493, 369], lever: 10751 },
];
const BALLOON_IDS = SHAPES.flatMap(shape => shape.npcs);
const POP_ANIMATION = 794;
const POP_GRAPHIC = 524;
const POP_SOUND = 2384;
const KEY_ANIMATION = 827;
const KEY_SOUND = 2582;
const KEY_SOUND_DELAY = 30;
const PETE_KEY_ANIMATION = 881;
const PETE_KEY_ANIMATION_DELAY = 15;
const KEY_RESULT_TICKS = 3;
const CORRECT_KEY_SOUND = 2402;
const BARRIER_VARP = 638; // varbit 1547 is bits 5-7: each right key clears one barrier.
const BARRIER_SHIFT = 5;
const KEYS_NEEDED = 3;
const EXIT_X = 2097; // Live starts the escape when the player reaches this tile.
const EXIT_ROWS = [4466, 4467];
const EXIT_WALK_X = 2099;
const FREEDOM_JINGLE = 150;
const ESCAPE_TICKS = 7;
const REWARD_DIALOGUE_TICKS = 3;

// Face animations, as the captures send them.
const CONFUSED = 554, QUESTIONING = 614, THINKING = 588, WORRIED = 615, PLAIN = 567, HAPPY = 568;

function inside(bounds, location) {
  return location.getX() >= bounds.minX && location.getX() <= bounds.maxX &&
    location.getY() >= bounds.minY && location.getY() <= bounds.maxY;
}

module.exports = function attach(api, Events) {
  const I = api.core.ItemIdentifiers;
  const N = api.core.NpcIdentifiers;

  /** Pages of { npc, text, anim }, { me, text, anim } or { box }, then a prompt or `then`. */
  function say(player, pages, { title = "Select an option", options = null, then = null } = {}) {
    const builder = new api.core.DialogueChainBuilder();
    let index = 0;
    for (const page of pages) {
      if (page.box) builder.add(new api.core.StatementDialogue(index++, page.box));
      else if (page.me) builder.add(new api.core.PlayerDialogue(index++, page.text, page.anim));
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

  function teleportEffects(player, sound) {
    player.performAnimation(new api.core.Animation(TELEPORT_ANIMATION));
    player.performGraphic(new api.core.Graphic(TELEPORT_GRAPHIC));
    player.getPacketSender().sendSound(sound, 1, 0);
  }

  // Two definitions share the cat so the natural scheduler offers either half at random and
  // testers can force each with ::randevt, matching the wiki's separate event rows.
  function definition(variant) {
    return {
      // Island invitations are NPC 390 (73), prison ones 6754 (4067).
      id: variant === "evilbob" ? N.EVIL_BOB : N.EVIL_BOB_3,
      kind: variant,
      greet: () => MEWS[Math.floor(Math.random() * MEWS.length)],
      nags: MEWS.map(line => () => line),
      goodbye: "Meeeeowby laaaater...",
      linger: true,
      otherPlayerStatement: "Evil Bob doesn't seem interested in you.",
      leavingStatement: "Evil Bob is no longer interested in you.",
      talk(active, { teleport, leave }) {
        const { player } = active;
        const island = variant === "evilbob";
        const npc = active.definition.id;
        const line = island
          ? `Hey, ${player.getUsername()}, come with me if you like fishing! Or has this amulet of humanspeak broken again?`
          : "Do you wanna meet my pet? His name's Pete. Or has this amulet of humanspeak broken again?";
        say(player, [{ npc, text: line, anim: 555 }], {
          title: "Follow the scary cat?",
          options: [
            ["Yes, that seems like a good idea.", () => island ? startIsland(player, teleport) : startPrison(player, teleport)],
            ["No, leave the cat alone.", () => leave(active) && Flow.statement(api, player, "You leave the cat alone, and the cat leaves you alone.")],
          ],
        });
      },
    };
  }

  // --- Island -----------------------------------------------------------------------------

  function startIsland(player, teleport) {
    teleportEffects(player, ISLAND_TELEPORT_SOUND);
    after(player, ISLAND_TELEPORT_TICKS, () => {
      const [x, y] = ISLAND_ARRIVALS[Math.floor(Math.random() * ISLAND_ARRIVALS.length)];
      teleport({ kind: "evilbob", arrive: { x, y, z: 0 }, teleportRefusal: REFUSAL, onStart: enterIsland });
    });
  }

  function enterIsland(session) {
    const { player } = session;
    session.data.required = 1;
    session.data.asleep = false;
    session.data.spot = SPOTS[Math.floor(Math.random() * SPOTS.length)];
    session.data.nets = new Set();
    for (const tile of NET_TILES) spawnNet(session, tile);
    Teleports.onEnd(session, () => {
      const inventory = player.getInventory();
      for (const id of FISH_ITEMS) {
        while (inventory.containsNumber(id)) inventory.delete(id, 1);
      }
      for (const net of session.data.nets) api.getItemOnGroundManager().deregister?.(net.item);
    });
    player.sendMessage(WELCOME);
    say(player, [
      { me: true, text: "Huh?", anim: CONFUSED },
      { me: true, text: "Where am I?", anim: QUESTIONING },
      { npc: N.EVIL_BOB_2, text: "On my island.", anim: PLAIN },
      { me: true, text: "Take me to your leader!", anim: QUESTIONING },
      { npc: N.EVIL_BOB_2, text: "I am your leader, you are but a slave!", anim: PLAIN },
      { me: true, text: "I am not a slave! I am a free person!", anim: QUESTIONING },
      { npc: N.EVIL_BOB_2, text: "Ah-ha-ha-ha-ha-ha!", anim: 609 },
    ]);
  }

  // Each net lies on the player's own island until taken, then comes back (rsprox 73, 1718).
  function spawnNet(session, tile) {
    const item = api.getItemOnGroundManager().registerLocation(session.player, new api.core.Item(NET, 1),
      new api.core.Location(tile[0], tile[1], 0), undefined, { goesGlobal: false, despawnDelay: NET_LIFETIME_TICKS });
    session.data.nets.add({ item, tile });
  }

  function takeNet(event) {
    const session = Teleports.sessionOf(event.player);
    if (session?.kind !== "evilbob" || event.groundItemId !== NET) return;
    if (event.player.getInventory().getFreeSlots() <= 0) return;
    const net = [...session.data.nets].find(entry => entry.item === event.groundItem);
    if (!net) return;
    session.data.nets.delete(net);
    Teleports.later(session, NET_RESPAWN_TICKS, () => spawnNet(session, net.tile));
  }

  function spotOf(location) {
    if (location.getX() <= 2515) return "west";
    if (location.getY() <= 4770) return "south";
    if (location.getY() >= 4788) return "north";
    return "east";
  }

  function useNet(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "evilbob") return false;
    if (event.object.getId() !== FISHING_SPOT) return false;
    event.handled = true;
    const player = event.player;
    if (!player.getInventory().containsNumber(NET)) {
      Flow.statement(api, player, "You need a fishing net to fish here, perhaps you can find one on the island somewhere.");
      return true;
    }
    if (session.data.fishing || player.getInventory().containsNumber(COOKED_CORRECT) ||
      player.getInventory().containsNumber(COOKED_WRONG)) return true;
    session.data.fishing = true;
    const caught = spotOf(event.object.getLocation()) === session.data.spot ? COOKED_CORRECT : COOKED_WRONG;
    const standing = player.getLocation();
    const [x, y] = [standing.getX(), standing.getY()];
    player.sendMessage("You cast out your net...");
    player.performAnimation(new api.core.Animation(CAST_ANIMATION));
    Teleports.later(session, CATCH_TICKS, () => {
      session.data.fishing = false;
      if (player.getLocation().getX() !== x || player.getLocation().getY() !== y) return;
      player.getInventory().addItem(new api.core.Item(caught, 1));
      Flow.itemStatement(api, player, caught, "You catch a... what is this?? Is this a fish?? And... it's cooked already??");
    });
    return true;
  }

  function cookPot(event) {
    if (event.object?.getId?.() !== UNCOOK_POT) return false;
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "evilbob") return false;
    event.handled = true;
    const player = event.player;
    const source = event.itemId;
    if (source !== COOKED_CORRECT && source !== COOKED_WRONG) {
      const name = new api.core.Item(source, 1).getDefinition().getName();
      if (/^burnt /i.test(name)) {
        Flow.statement(api, player, "It's burnt, what do you think uncooking could possibly do to it?");
        return true;
      }
      const level = 40 + 10 * Math.floor(Math.random() * 4);
      say(player, [{ box: `Your Uncooking skill must be at least level ${level} before you can do that.` },
        { box: "Wait, you don't even have an Uncooking skill." }]);
      return true;
    }
    if (session.data.uncooking) return true;
    session.data.uncooking = true;
    player.performAnimation(new api.core.Animation(UNCOOK_ANIMATION, UNCOOK_ANIMATION_DELAY));
    player.getPacketSender().sendSound(UNCOOK_SOUND, 1, 0);
    Teleports.later(session, UNCOOK_TICKS, () => {
      session.data.uncooking = false;
      if (!player.getInventory().containsNumber(source)) return;
      player.getInventory().delete(source, 1);
      player.getInventory().addItem(new api.core.Item(source === COOKED_CORRECT ? RAW_CORRECT : RAW_WRONG, 1));
    });
    return true;
  }

  function feedBob(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "evilbob") return false;
    if (event.npcId !== N.EVIL_BOB_2) return false;
    event.handled = true;
    const player = event.player;
    const bob = N.EVIL_BOB_2;
    const source = event.itemId;
    if (source === COOKED_CORRECT || source === COOKED_WRONG) {
      say(player, [
        { npc: bob, text: "What, are you giving me cooked fish? What am I going to do with that? Uncook it first!" },
        { me: true, text: "Errr... Uncook it?" },
        { npc: bob, text: "You heard me! There's the cold fire, by the trees, now get uncooking!" },
      ]);
      return true;
    }
    if (source !== RAW_CORRECT && source !== RAW_WRONG) {
      say(player, [{ npc: bob, text: "What am I to do with that? Catch me some fish, puny human!" }]);
      return true;
    }
    player.getInventory().delete(source, 1);
    if (source === RAW_WRONG) {
      session.data.required++;
      say(player, [
        { npc: bob, text: "What was this? That was absolutely disgusting!" },
        { npc: bob, text: "Don't you know what kind of fish I like? Talk to my other servants for some advice." },
        { box: "Evil Bob seems more attentive of you." },
      ]);
      return true;
    }
    session.data.required--;
    if (session.data.required > 0) {
      say(player, [
        { npc: bob, text: "Mmm, mmm... that's delicious.", anim: 562 },
        { npc: bob, text: "Now get me another one, you no good human!" },
        { box: "Evil Bob seems slightly less attentive of you." },
      ]);
      return true;
    }
    session.data.asleep = true;
    say(player, [
      { npc: bob, text: "Mmm, mmm... that's... mmm... delicious...", anim: 562 },
      { npc: bob, text: "Now, let me take... a little... catnap...", anim: 562 },
    ]);
    if (event.target) Teleports.later(session, SLEEP_SAY_TICKS, () => event.target.forceChat("ZZZzzz"));
    return true;
  }

  function usePortal(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "evilbob") return false;
    if (event.object.getId() !== PORTAL || !inside(ISLAND, event.object.getLocation())) return false;
    event.handled = true;
    if (session.data.leaving) return true;
    if (!session.data.asleep) {
      // Live text for leaving early is unrecorded; the wiki says only that it pays nothing.
      Teleports.finish(session);
      return true;
    }
    session.data.leaving = true;
    const player = session.player;
    player.performAnimation(new api.core.Animation(RASPBERRY_ANIMATION, RASPBERRY_ANIMATION_DELAY));
    Teleports.later(session, PORTAL_SAY_TICKS, () => player.forceChat("Be seeing you!"));
    Teleports.later(session, PORTAL_TELEPORT_TICKS, () => teleportEffects(player, ISLAND_TELEPORT_SOUND));
    Teleports.later(session, PORTAL_LEAVE_TICKS, () => leaveIsland(session));
    return true;
  }

  function leaveIsland(session) {
    const player = session.player;
    const magic = player.getSkillManager().getMaxLevel(api.core.Skill.MAGIC);
    const skill = magic >= MAGIC_XP_LEVEL && Math.random() < 0.5 ? api.core.Skill.MAGIC : api.core.Skill.FISHING;
    Teleports.finish(session);
    player.getSkillManager().addExperience(skill, ISLAND_XP, false);
    say(player, [
      { me: true, text: "Now what was that all about? Did any of that really happen?", anim: 555 },
      { box: `You feel somehow that you've become better at ${skill.getName()}.` },
    ]);
  }

  function talkServant(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "evilbob" || event.npcId !== N.SERVANT_2) return false;
    event.handled = true;
    const player = event.player;
    const servant = N.SERVANT_2;
    const fish = { npc: servant, text: "F-f-f-fish... give him the f-f-f-fish he likes and he might f- f-f-fall asleep.", anim: 597 };
    if (session.data.asleep) {
      say(player, [
        { me: true, text: "Evil Bob has fallen asleep, come quickly!" },
        { npc: servant, text: "Come? Come where?" },
        { me: true, text: "Away from this place! To Gielinor!" },
        { npc: servant, text: `You go, ${player.getUsername()}, I don't belong there... I belong here, in ScapeRune. This is the only place I can ever go...` },
      ], { options: [
        ["But I love you!", () => say(player, [
          { me: true, text: "But I love you!" },
          { npc: servant, text: `Our love can never be, sweet ${player.getUsername()}.` },
          { npc: servant, text: "Go now! Go, and don't look back!" },
        ])],
        ["Oh, alright then.", () => say(player, [{ me: true, text: "Oh, alright then, I'll be off! See you around!" }])],
      ] });
      return true;
    }
    if (session.data.toldSpot) {
      say(player, [fish]);
      return true;
    }
    session.data.toldSpot = true;
    say(player, [
      { me: true, text: "I need help, I've been kidnapped by an evil cat!", anim: QUESTIONING },
      { npc: servant, text: "Meow! Errr... I c-c-c-can't help you... He'll kill us all!", anim: 596 },
      { me: true, text: "Now you listen to me! He's just a little cat! There must be something I can do!", anim: WORRIED },
      fish,
      { npc: servant, text: "Look... over t-t-there! That fishing spot c-c-contains the f-f-f-fish he likes.", anim: 597 },
    ], { then: () => showSpot(session) });
    return true;
  }

  function showSpot(session) {
    const { player } = session;
    const sender = player.getPacketSender();
    const [firstLook, camera, lastLook] = CUTSCENE_SHOTS[session.data.spot];
    sender.sendSubInterface(OVERLAY_UID, CUTSCENE_OVERLAY);
    api.core.StatementDialogue.send(player, "Evil Bob's servant points at a fishing spot.", false);
    sender.sendCameraMoveTo(CUTSCENE_FROM[0], CUTSCENE_FROM[1], 550, { rate: 232, rate2: 232 });
    sender.sendCameraLookAt(firstLook[0], firstLook[1], 350, { rate: 232, rate2: 232 });
    sender.sendCameraMoveTo(camera[0], camera[1], 500, { rate: 2, rate2: 2 });
    sender.sendCameraLookAt(lastLook[0], lastLook[1], 250, { rate: 2, rate2: 2 });
    Teleports.onEnd(session, () => endSpot(player));
    Teleports.later(session, CUTSCENE_TICKS, () => endSpot(player));
  }

  function endSpot(player) {
    const sender = player.getPacketSender();
    sender.sendCameraReset();
    sender.closeSubInterface(OVERLAY_UID);
    sender.sendInterfaceRemoval();
  }

  function talkIslandBob(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "evilbob") return false;
    event.handled = true;
    const player = event.player;
    const name = player.getUsername();
    const bob = N.EVIL_BOB_2;
    if (session.data.asleep) {
      Flow.statement(api, player, "Evil Bob appears to be sleeping, best not to wake him up.");
      return true;
    }
    const line = (text, anim) => ({ npc: bob, text, anim });
    const me = (text, anim) => ({ me: true, text, anim });
    say(player, [me("Let me out of here!", QUESTIONING), line(`I will never let you go, ${name}!`, 609)], { options: [
      ["Why not?", () => say(player, [
        me("Why not?"), line("Uhm..."),
        line("Because I say so! And because I can never have enough servants!"),
        line("Now catch me some fish, I'm hungry."),
        me("What fish, where?"),
        line("Talk to my other servants, and hurry it up!"),
      ])],
      ["What's it all about?", () => say(player, [
        me("What's it all about?"),
        line("Sit down and I'll tell you. It's a question of servant shortage."),
        me("Go on."),
        line("You are a skilled worker. A human like you is worth a great deal as a slave."),
        me("A slave?? I will have nothing to do with you. Is that clear? Absolutely nothing."),
        line("Now be reasonable little human. It's just a matter of time before you will do everything I ask you to. Play along and this can be a very nice place."),
        me("I will not make any deals with you. I'm a human. I will not be pushed, numbered, meowed at, teleported or enslaved. My life is my own."),
        line("Is it?"),
        me("Yes. You won't hold me."),
        line("Won't I?"),
        line("Let me assure you there's no way out."),
        line("Just ask my servants!"),
      ])],
      ["How is it possible that you're talking?", () => say(player, [
        me("How is it possible that you're talking?"),
        line("How is it possible that you're not meowing?"),
        me("Meowing?? Why would I be meowing?"),
        line("Most humans do, that's why I'm wearing this amulet of Man speak... but I do try to train my staff in civilised speech."),
        line("Ah, but I suppose things are slightly different in your world... what a dreadful place that must be."),
        me("I think I'm getting a headache..."),
      ])],
      ["What did you do to Bob?", () => say(player, [
        me("What did you do to Bob?"),
        line("Bob? I am Bob!"),
        line("Oh, you mean the Bob in your world? Nothing. I am an incarnation of Bob here on ScapeRune."),
        me("What, you mean this is... like some kind of mirror land?"),
        line(`Something like that... somewhere in ScapeRune there must be a human servant called ${name}.`),
        line("But you work just as well for me! Now get to work, human! Fish for me!"),
      ])],
    ] });
    return true;
  }

  // --- Prison -----------------------------------------------------------------------------

  function startPrison(player, teleport) {
    teleportEffects(player, PRISON_TELEPORT_SOUND);
    after(player, PRISON_TELEPORT_TICKS, () => teleport({
      kind: "prison",
      arrive: { x: PRISON_ARRIVAL[0], y: PRISON_ARRIVAL[1], z: 0 },
      teleportRefusal: REFUSAL,
      onStart: enterPrison,
    }));
  }

  function enterPrison(session) {
    const { player } = session;
    session.data.required = null;
    session.data.correct = 0;
    session.data.keyCorrect = false;
    session.data.pulled = false;
    session.tick = watchExit;
    const sender = player.getPacketSender();
    sender.sendVarbit(ARRANGEMENT_VARBIT, 1 + Math.floor(Math.random() * ARRANGEMENTS));
    sender.sendConfig(BARRIER_VARP, 0);
    // The event key is temporary: leaving by the chat option, teleport, death or logout
    // must not leave it in the player's inventory (issue #1702).
    Teleports.onEnd(session, () => {
      if (player.getInventory().containsNumber(KEY)) player.getInventory().delete(KEY, 1);
      player.getPacketSender().sendConfig(BARRIER_VARP, 0);
      player.getPacketSender().sendVarbit(ARRANGEMENT_VARBIT, 0);
    });
    player.sendMessage(WELCOME);
    say(player, [
      pete("So you've been captured too?", 610),
      { me: true, text: "Captured?", anim: CONFUSED },
      pete("Yes, Evil Bob captured me and stuck me in this prison.", 610),
      ...howToEscape(),
    ], { options: leaveOptions(session) });
  }

  function pete(text, anim) {
    return { npc: N.PRISON_PETE, text, anim };
  }

  function howToEscape() {
    return [
      { me: true, text: "How do I get out of here? I can't be held captive by a cat!", anim: WORRIED },
      pete("Some of these balloon animals have keys in them, and if you pull the big lever it tells you which shape animal contains the correct key, but I can never find it.", 612),
      pete("You need to pull the lever to find out which shape animal contains the key, then pop that sort of animal to get the key.", 612),
      pete("Bring me any keys you get and I'll try them on the doors.", 611),
    ];
  }

  function leaveOptions(session) {
    const { player } = session;
    return [
      ["Okay.", () => say(player, [{ me: true, text: "Okay." }])],
      ["But I want to leave now.", () => say(player, [
        { me: true, text: "But I wan't to leave now.", anim: THINKING },
        pete("Oh. Well I guess you can leave but I'll still be stuck here."),
      ], {
        title: "Leave the event?",
        options: [
          ["Yes.", () => {
            player.sendMessage("You leave the prison.");
            Teleports.finish(session);
          }],
          ["No.", () => player.getPacketSender().sendInterfaceRemoval()],
        ],
      })],
    ];
  }

  function comeOn(player) {
    say(player, [pete("Come on, we should leave before Evil Bob comes back! You go first; I'll follow along.")]);
  }

  function holdingKey(player) {
    say(player, [pete("Hey, bring me that key you've got! I wanna get out of here!")]);
  }

  function pullLever(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "prison") return false;
    if (event.object.getId() !== LEVER) return false;
    event.handled = true;
    const player = event.player;
    if (session.data.correct >= KEYS_NEEDED) {
      comeOn(player);
      return true;
    }
    if (player.getInventory().containsNumber(KEY)) {
      holdingKey(player);
      return true;
    }
    if (session.data.pulled) {
      lever(session, event.object);
      return true;
    }
    session.data.pulled = true;
    say(player, [pete("That's right, pull it. Then remember what kind of animal shape you see. That's the animal that contains the right key.", 569)],
      { then: () => lever(session, event.object) });
    return true;
  }

  function lever(session, object) {
    const { player } = session;
    const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    session.data.required = shape;
    player.performAnimation(new api.core.Animation(LEVER_ANIMATION));
    player.getPacketSender().sendObjectAnimation(object, new api.core.Animation(LEVER_LOC_ANIMATION));
    player.getPacketSender().sendSound(LEVER_SOUND, 1, 0);
    // Stays open until the player closes it or walks off (rsprox 4067 and 555: client CloseModal).
    Teleports.later(session, LEVER_OPEN_TICKS, () => {
      session.interfaceId = LEVER_INTERFACE;
      const sender = player.getPacketSender();
      sender.sendInterface(LEVER_INTERFACE);
      // 273:4 is the model widget; 273:3 is the layer that contains it (yarn dump:widget 273).
      sender.sendInterfaceRawModel((LEVER_INTERFACE << 16) | 4, shape.lever);
    });
  }

  function popBalloon(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "prison") return false;
    event.handled = true;
    const player = event.player;
    if (session.data.correct >= KEYS_NEEDED) {
      comeOn(player);
      return true;
    }
    if (!session.data.required) {
      say(player, [pete("You're meant to pull the lever to find out which sort of animal to pop!", WORRIED)]);
      return true;
    }
    if (player.getInventory().containsNumber(KEY)) {
      holdingKey(player);
      return true;
    }
    if (session.data.popping) return true;
    session.data.popping = true;
    const location = event.npc.getLocation();
    const correct = session.data.required.npcs.includes(event.npcId);
    player.performAnimation(new api.core.Animation(POP_ANIMATION));
    Teleports.later(session, 1, () => {
      const sender = player.getPacketSender();
      sender.sendGraphic(new api.core.Graphic(POP_GRAPHIC), location);
      sender.sendSound(POP_SOUND, 1, 0);
    });
    Teleports.later(session, 2, () => {
      session.data.popping = false;
      session.data.keyCorrect = correct;
      player.performAnimation(new api.core.Animation(KEY_ANIMATION));
      player.getInventory().addItem(new api.core.Item(KEY, 1));
      player.getPacketSender().sendSound(KEY_SOUND, 1, KEY_SOUND_DELAY);
      say(player, [pete("Great, now you've got a key! Bring it to me so I can try it on the doors.", HAPPY)]);
    });
    return true;
  }

  // Live takes the key on Talk-to, not on item use (rsprox 4067 at tick 5103/5104, rsprox 555):
  // Pete says "Ooh, thanks!", the key leaves on continue and he answers three ticks later.
  // Item-on-NPC is kept as a second route because players also try it.
  function handInKey(player, session, npc) {
    say(player, [pete("Ooh, thanks! I'll see if it's the right one...", PLAIN)], { then: () => {
      player.getInventory().delete(KEY, 1);
      // Either answer spends the shape the lever showed: the next key needs a fresh pull.
      session.data.required = null;
      npc?.performAnimation?.(new api.core.Animation(PETE_KEY_ANIMATION, PETE_KEY_ANIMATION_DELAY));
      Teleports.later(session, KEY_RESULT_TICKS, () => keyResult(player, session));
    } });
  }

  function keyResult(player, session) {
    const sender = player.getPacketSender();
    if (!session.data.keyCorrect) {
      // Wiki: three correct keys "in a row". No recording shows a wrong key.
      session.data.correct = 0;
      sender.sendConfig(BARRIER_VARP, 0);
      say(player, [pete("Aww, that was the wrong key! You must have popped the wrong sort of animal. Try the big lever again - it'll tell you which animal to pop.")]);
      return;
    }
    session.data.correct++;
    session.data.keyCorrect = false;
    sender.sendConfig(BARRIER_VARP, session.data.correct << BARRIER_SHIFT);
    sender.sendSound(CORRECT_KEY_SOUND, 1, 0);
    if (session.data.correct >= KEYS_NEEDED) {
      say(player, [
        pete("You did it, you got all the keys right! Thank you! You're my friend FOREVER!", HAPPY),
        { me: true, text: "Let's get out of here before that cat notices.", anim: PLAIN },
      ]);
      return;
    }
    say(player, [pete("Hooray, you got the right one! Now pull the lever again and let's get the next portal unlocked!", HAPPY)]);
  }

  function giveKey(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "prison") return false;
    if (event.npcId !== N.PRISON_PETE) return false;
    event.handled = true;
    if (event.itemId !== KEY) {
      say(event.player, [pete("No thanks, I don't want that just now.")]);
      return true;
    }
    handInKey(event.player, session, event.target);
    return true;
  }

  function talkPete(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "prison" || event.npc.getId?.() !== N.PRISON_PETE) return false;
    const player = event.player;
    event.handled = true;
    if (player.getInventory().containsNumber(KEY)) {
      handInKey(player, session, event.npc);
      return true;
    }
    if (session.data.correct >= KEYS_NEEDED) {
      comeOn(player);
      return true;
    }
    api.sendMultiChatboxPrompt(player, "What would you like to say?",
      "What is this place?", () => say(player, [
        { me: true, text: "What is this place?" },
        pete("Don't you remember? This is ScapeRune's prison. Evil Bob caught you and brought you here."),
        { me: true, text: "What gives him the right to lock me up? I demand to see a lawyer! I know my rights!" },
        pete("Evil Bob doesn't care about people's rights. He's cruel and utterly merciless. He's a cat."),
        ...howToEscape(),
      ], { options: leaveOptions(session) }),
      "How do I get out of here?", () => say(player, howToEscape(), { options: leaveOptions(session) }));
    return true;
  }

  function lockedDoor(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "prison" || !LOCKED_DOORS.includes(event.object.getId?.())) return false;
    event.handled = true;
    say(event.player, [pete("Oi! we'll be using the exit that's over here.")]);
    return true;
  }

  function watchExit(session) {
    const location = session.player.getLocation();
    if (session.data.correct < KEYS_NEEDED || session.data.escaping) return;
    if (location.getX() < EXIT_X || !EXIT_ROWS.includes(location.getY())) return;
    session.data.escaping = true;
    const { player } = session;
    player.sendMessage("You quickly escape the prison with Pete.");
    player.getPacketSender().sendJingle(FREEDOM_JINGLE);
    player.getMovementQueue?.().addFirstStep(new api.core.Location(EXIT_WALK_X, location.getY(), 0));
    Teleports.later(session, ESCAPE_TICKS, () => {
      Teleports.finish(session);
      after(player, REWARD_DIALOGUE_TICKS, () => reward(player));
    });
  }

  function reward(player) {
    // Live pays on the first continue. It is paid as the line opens here so walking away from
    // the dialogue cannot lose it.
    Rewards.give(api, player, [rollReward()]);
    say(player, [pete("Thanks a lot for your help! Here, have a present:", HAPPY),
      { me: true, text: "Thanks! See you around!", anim: PLAIN }]);
  }

  // Wiki drop log rates. Snapdragon is Mod Ash's 7/50; the rest are the logged shares of 5656
  // members and 754 free-to-play rewards, normalised by the total.
  function rollReward() {
    const between = (low, high) => low + Math.floor(Math.random() * (high - low + 1));
    const members = api.core.WorldDefinition.isMembersWorld();
    const table = members
      ? [[1194, I.LAMP, 1], [580, I.UNCUT_RUBY_2, 4], [631, I.UNCUT_DIAMOND_2, 3], [569, I.CHAOS_RUNE, between(19, 25)],
        [555, I.LAW_RUNE, between(7, 10)], [1225, I.GRIMY_TOADFLAX_2, 6], [5656 * 7 / 50, I.GRIMY_SNAPDRAGON_2, 4],
        [49, I.MITHRIL_ARROWTIPS, between(45, 50)], [65, I.UGTHANKI_KEBAB, 2]]
      : [[306, I.LAMP, 1], [108, I.UNCUT_RUBY_2, 4], [100, I.UNCUT_DIAMOND_2, 3], [110, I.CHAOS_RUNE, between(19, 25)],
        [134, I.LAW_RUNE, between(7, 10)]];
    let roll = Math.random() * table.reduce((sum, entry) => sum + entry[0], 0);
    for (const [weight, id, amount] of table) {
      roll -= weight;
      if (roll < 0) return { id, amount };
    }
    return { id: table[0][1], amount: table[0][2] };
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(
    definition("evilbob"), definition("prison")));
  api.onNpcInteraction("Servant", { "Talk-to": talkServant });
  api.onNpcInteraction("Evil Bob", { "Talk-to": talkIslandBob });
  api.onObjectInteraction(useNet);
  api.onItemOnObject(cookPot);
  api.onItemOnNpc(feedBob);
  api.onObjectInteraction(usePortal);
  api.onGroundItemPickup(takeNet);
  api.onObjectInteraction(pullLever);
  api.onObjectInteraction(lockedDoor);
  api.onNpcClick(BALLOON_IDS, 1, popBalloon);
  api.onItemOnNpc(giveKey);
  api.onNpcInteraction("Prison Pete", { "Talk-to": talkPete });
};
