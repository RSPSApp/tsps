"use strict";

const Flow = require("./DialogueFlow.RandomEvents");
// Pillory (random event, Pillory Guard): locked in a cage, pick the swinging key that matches
// the shaped hole in the large spinning lock, three times; a wrong key adds another lock (up to
// six) and resets progress. Everything on interface 27 is as live draws it (rsprox 1108, 1840,
// 559); a Tramp pelts the player with tomatoes meanwhile. See SOURCES.md.
const Teleports = require("./Teleports.RandomEvents");

const GROUP = 27;
const LOCK = 3;
const KEYS = [4, 5, 6];
const BUTTONS = [7, 8, 9];
const LOCKS = [10, 11, 12, 13, 14, 15];
const FLASHES = [16, 17, 18, 19, 20, 21];
const SELECT_ACTION = 1;
const LOCK_CLOSED_MODEL = 9757;
const LOCK_OPEN_MODEL = 9758;
const LOCK_ABSENT_MODEL = 4730;
const LOCK_ANIMATION = 2766;
const FLASH_IDLE = 4135;
const FLASH_SOLVED = 4134;
const STARTING_LOCKS = 3;
const MAX_LOCKS = 6;
// Lock shape model -> the key that fits it (every pick in rsprox 1108, 1840 and 559).
const KEY_FOR_LOCK = new Map([[13382, 13396], [13390, 4141], [13393, 11032], [13394, 13395]]);
// The player's tile: Yanille is rsprox 1108/1840/559. The other two are the tile inside the
// middle cage door (wiki Cage (Pillory)) on the side away from that town's Tramp, as in Yanille.
const YANILLE = [2606, 3105, 0];
const CAGES = [[3228, 3407, 0], [2683, 3489, 0], YANILLE];
const CRIMINALS = "You can't unlock the pillory, you'll let all the criminals out!";
const HINT = "Choose the <col=7f0000>swinging key</col> which matches the <col=7f0000>shaped hole</col> in the large spinning lock.";
const HINT_GROUP = 263;
// chatbox:chatoverlay in the rev 241 cache (162:566 in rev 238, 564 in rev 227 recordings).
const CHATBOX_OVERLAY = (162 << 16) | 567;
const SCRIPT_HINT = 1974;
const SCRIPT_MAINMODAL_OPEN = 2524;
const SCRIPT_SPIN = 65;
const ARRIVAL_SOUND = 2275;
const SOLVED_SOUND = 2276;
const ALL_SOLVED_SOUND = 2274;
const ESCAPE_SOUND = 2402;
const TELEPORT_SOUND = 1930;
const TELEPORT_SPOTANIM = 86;
const TELEPORT_SPOTANIM_HEIGHT = 92;
// chatneu1 and the guard's angry1 (rsprox 1108 ticks 16505-16509).
const NEUTRAL_CHAT = 567;
const ANGRY_CHAT = 614;
// The Tramp's throw: rsprox 1108 tick 16514, gaps of 13 to 22 ticks in the three recordings.
const TRAMPS = [381, 382, 383];
const TRAMP_RANGE = 15;
const FIRST_THROW = [2, 10];
const THROW_GAP = [13, 22];
const THROW_ANIMATION = 385;
const THROW_SPOTANIM = 30;
const TOMATO_PROJECTILE = 29;
const TOMATO_IMPACT_SPOTANIM = 31;
const TOMATO_HEIGHT = 96;
const THROW_SOUND = 2708;
const SPLAT_SOUND = 2285;
const GUARD_LINES = [name => `${name}, you're under arrest!`, name => `I've come to arrest you, ${name}!`,
  name => `Come and be locked up, ${name}!`, name => `Report to me for punishment, ${name}!`];

function randomBetween(low, high) {
  return low + Math.floor(Math.random() * (high - low + 1));
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
    id: N.PILLORY_GUARD,
    kind: "pillory",
    greet: name => GUARD_LINES[Math.floor(Math.random() * GUARD_LINES.length)](name),
    nags: GUARD_LINES,
    goodbye: "Maybe later.",
    linger: true,
    otherPlayerLine: owner => `I'm here to arrest ${owner.getUsername()}.`,
    leavingLine: () => "Hmmph!",
    talk(active, { teleport, valid, leave }) {
      const { player } = active;
      const guardId = active.definition.id;
      chat(player, [{ npcId: guardId, anim: ANGRY_CHAT, text: "You're under arrest! I've come to lock you up." }],
        () => api.sendMultiChatboxPrompt(player, "What would you like to say?",
          "Okay, guv, I'll come quietly.", () => chat(player, [{ text: "Okay, guv, I'll come quietly." }], () => {
            closeChat(player);
            if (!valid(active, player)) return;
            const members = api.core.WorldDefinition.isMembersWorld();
            const cage = members ? CAGES[Math.floor(Math.random() * CAGES.length)] : CAGES[0];
            const origin = player.getLocation();
            player.getPacketSender().sendGlobalGraphic(new api.core.Graphic(TELEPORT_SPOTANIM, 0, TELEPORT_SPOTANIM_HEIGHT), origin);
            player.getPacketSender().sendAreaSound(TELEPORT_SOUND, origin.getX(), origin.getY(), origin.getZ(), 1, 0, 5, 0);
            teleport({ kind: "pillory", arrive: { x: cage[0], y: cage[1], z: cage[2] }, onStart: start });
          }),
          // Transcript:Pillory Guard.
          "I'm not coming.", () => {
            leave(active);
            chat(player, [{ text: "I'm not coming." }, { npcId: guardId, anim: ANGRY_CHAT, text: "Hmmph!" }], () => closeChat(player));
          }));
    },
  };

  const chat = (player, pages, onEnd) => Flow.chat(api, { player, pages, onEnd, anim: NEUTRAL_CHAT });

  function closeChat(player) {
    player.getDialogueManager().reset?.();
    player.getPacketSender().sendInterfaceRemoval();
  }

  function start(session) {
    const { player } = session;
    session.data.locks = STARTING_LOCKS;
    session.data.opened = 0;
    session.data.flash = -1;
    session.interfaceId = GROUP;
    Teleports.hideTabs(player);
    Teleports.onEnd(session, () => {
      closeHint(session);
      if (player.isRegistered()) Teleports.restoreTabs(player);
    });
    newLock(session);
    Teleports.later(session, 1, () => arrive(session));
    Teleports.later(session, randomBetween(...FIRST_THROW), () => throwTomato(session));
  }

  function arrive(session) {
    const { player } = session;
    const sender = player.getPacketSender();
    sender.sendGraphic(new api.core.Graphic(TELEPORT_SPOTANIM, 0, TELEPORT_SPOTANIM_HEIGHT), player.getLocation());
    sender.sendSound(ARRIVAL_SOUND, 1, 0);
    sender.sendSubInterface(CHATBOX_OVERLAY, HINT_GROUP, 1);
    sender.sendClientScript(SCRIPT_HINT, HINT);
    session.data.hint = true;
    open(session);
  }

  function closeHint(session) {
    if (!session.data.hint) return;
    session.data.hint = false;
    session.player.getPacketSender().closeSubInterface(CHATBOX_OVERLAY);
  }

  function open(session) {
    const sender = session.player.getPacketSender();
    sender.sendClientScript(SCRIPT_MAINMODAL_OPEN, -1, -1);
    sender.sendInterface(GROUP);
    draw(session);
  }

  // Each lock is a new shape with the matching key and two others, in any order.
  function newLock(session) {
    const shape = shuffled([...KEY_FOR_LOCK.keys()])[0];
    const target = KEY_FOR_LOCK.get(shape);
    const others = shuffled([...KEY_FOR_LOCK.values()].filter(key => key !== target)).slice(0, 2);
    session.data.shape = shape;
    session.data.target = target;
    session.data.keys = shuffled([target, ...others]);
  }

  function draw(session) {
    const sender = session.player.getPacketSender();
    const { locks, opened, flash, shape, keys } = session.data;
    FLASHES.forEach((component, index) => sender.sendInterfaceAnimation((GROUP << 16) | component,
      index === flash ? FLASH_SOLVED : FLASH_IDLE));
    LOCKS.forEach((component, index) => {
      const uid = (GROUP << 16) | component;
      if (index >= locks) {
        sender.sendInterfaceRawModel(uid, LOCK_ABSENT_MODEL);
        return;
      }
      sender.sendInterfaceRawModel(uid, index < opened ? LOCK_OPEN_MODEL : LOCK_CLOSED_MODEL);
      sender.sendInterfaceAnimation(uid, LOCK_ANIMATION);
    });
    sender.sendInterfaceRawModel((GROUP << 16) | LOCK, shape);
    KEYS.forEach((component, index) => sender.sendInterfaceRawModel((GROUP << 16) | component, keys[index]));
    // How the large lock spins; the recordings use multiples of 5 up to 35 either way.
    const spin = () => 5 * randomBetween(1, 7) * (Math.random() < 0.5 ? -1 : 1);
    sender.sendClientScript(SCRIPT_SPIN, spin(), spin(), 0, (GROUP << 16) | LOCK);
  }

  function choose(event) {
    const { player, buttonId } = event;
    if ((buttonId >>> 16) !== GROUP) return;
    const index = BUTTONS.indexOf(buttonId & 0xffff);
    if (index < 0) return;
    event.handled = true;
    const session = Teleports.sessionOf(player);
    if (event.action !== SELECT_ACTION || session?.kind !== "pillory" || !session.data.keys || session.data.escaping) return;
    const sender = player.getPacketSender();
    if (session.data.keys[index] !== session.data.target) {
      // Wiki Pillory: another lock, up to six, and progress resets. No recording has a wrong
      // pick, so there is no message or sound for it here.
      session.data.locks = Math.min(MAX_LOCKS, session.data.locks + 1);
      session.data.opened = 0;
      session.data.flash = -1;
      newLock(session);
      draw(session);
      return;
    }
    session.data.opened++;
    sender.sendSound(SOLVED_SOUND, 1, 0);
    closeHint(session);
    if (session.data.opened >= session.data.locks) {
      session.data.escaping = true;
      sender.sendSound(ALL_SOLVED_SOUND, 1, 0);
      Teleports.later(session, 1, () => escape(session));
      return;
    }
    player.sendMessage(`You solved a lock! That's ${session.data.opened} down and ${session.data.locks - session.data.opened} to go!`);
    session.data.flash = session.data.opened - 1;
    newLock(session);
    draw(session);
  }

  function escape(session) {
    const { player } = session;
    const sender = player.getPacketSender();
    player.sendMessage("You've escaped!");
    sender.sendSound(ESCAPE_SOUND, 1, 0);
    sender.sendSound(TELEPORT_SOUND, 1, 0);
    Teleports.finish(session, { reward: [rollReward()] });
  }

  // Wiki Pillory rewards, out of 120; the members items become coins on free worlds.
  function rollReward() {
    const table = [[I.COINS, 20, 10], [I.COINS, 40, 10], [I.COINS, 80, 6], [I.COINS, 160, 10], [I.COINS, 320, 10],
      [I.COINS, 640, 10], [I.UNCUT_SAPPHIRE, 1, 32], [I.UNCUT_EMERALD, 1, 16], [I.UNCUT_RUBY, 1, 8], [I.UNCUT_DIAMOND, 1, 2]];
    if (api.core.WorldDefinition.isMembersWorld()) {
      table.push([I.COSMIC_TALISMAN, 1, 4], [I.TOOTH_HALF_OF_KEY, 1, 1], [I.LOOP_HALF_OF_KEY, 1, 1]);
    } else {
      table.push([I.COINS, 80, 4], [I.COINS, 640, 2]);
    }
    let choice = Math.floor(Math.random() * 120);
    for (const [id, amount, weight] of table) {
      if (choice < weight) return { id, amount };
      choice -= weight;
    }
    return { id: table[0][0], amount: table[0][1] };
  }

  function throwTomato(session) {
    const { player } = session;
    Teleports.later(session, randomBetween(...THROW_GAP), () => throwTomato(session));
    const tile = player.getLocation();
    const tramp = api.getWorld().getNpcsNear(tile, TRAMP_RANGE).find(npc => TRAMPS.includes(npc.getId()));
    if (!tramp) return;
    const sender = player.getPacketSender();
    const { Animation, Graphic } = api.core;
    const from = tramp.getLocation();
    tramp.forceChat("Take that you thief!");
    tramp.setPositionToFace?.(tile);
    tramp.performAnimation(new Animation(THROW_ANIMATION));
    tramp.performGraphic(new Graphic(THROW_SPOTANIM, 0, TOMATO_HEIGHT));
    // Live: 66 client cycles from 4 tiles, 71 from 5, 81 from 7.
    const impact = 46 + 5 * Math.max(Math.abs(from.getX() - tile.getX()), Math.abs(from.getY() - tile.getY()));
    sender.sendProjectile(from, tile, 0, impact, TOMATO_PROJECTILE, 40, 24, null, 28, 15, 32);
    sender.sendAreaSound(THROW_SOUND, tile.getX(), tile.getY(), tile.getZ(), 1, 0, 5, 0);
    sender.sendAreaSound(SPLAT_SOUND, tile.getX(), tile.getY(), tile.getZ(), 1, 0, 5, 0);
    sender.sendGraphic(new Graphic(TOMATO_IMPACT_SPOTANIM, impact, TOMATO_HEIGHT), tile);
  }

  // Wiki Cage (Pillory): inside the event the door opens the lock interface; otherwise it refuses.
  function unlockCage(event) {
    const { player } = event;
    event.handled = true;
    const session = Teleports.sessionOf(player);
    if (session?.kind === "pillory" && session.data.keys && !session.data.escaping) open(session);
    else player.sendMessage(CRIMINALS);
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));
  api.onInterfaceActionClick(choose);
  api.onObjectInteraction("Cage", { Unlock: unlockCage });
};
