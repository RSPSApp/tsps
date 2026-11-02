"use strict";

// Kiss the frog (random event), current OSRS behaviour: a group of frogs appears, the crowned
// frog asks for a touch or kiss, turns back into a royal and pays a frog token. Asking to be a
// frog sends the player to Frogland, where the crowned frog lets them leave. Tokens are traded
// with Thessalia for the frog mask, royal costume pieces or a lamp. See SOURCES.md.
// Packets: rsprox 1702 (the player's own kiss) and 1723 (another player's). The touch, polite
// and Frogland routes and Thessalia's token dialogue are Transcript:Kiss_the_frog and
// Transcript:Thessalia only: no recording plays them.
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");
const Rewards = require("./Rewards.RandomEvents");

// Transcript:Kiss_the_frog tags its other wordings as maybe no longer in the game; these are
// the ones it does not doubt, and 1702 offers one from each.
const TOUCH = ["Very well, if a touch is all you need, I'll do it.", "Yes, I will touch you.",
  "Sure, I'll touch you.", "A touch? Yes, I'll do that."];
const KISS = ["How about if we kiss?", "May I kiss you instead?", "Would a kiss be acceptable?"];
const POLITE_REFUSALS = ["I would prefer not to, sorry.", "I'm sorry, I'd prefer not to do that."];
const BECOME_FROG = ["I'd rather become a frog too!", "What if I want to be a frog like you?"];

const OPTIONS_TITLE = "Select an option";
// 1702: the frogs arrive with Common's puff of smoke, twice, and croak with each overhead.
const ARRIVAL_GRAPHIC = 86;
const GRAPHIC_HEIGHT = 124;
const ARRIVAL_SOUND = 1930;
const CROAK_SOUND = 838;
const OVERHEAD_TICKS = 10;
// 1702: the player's kiss and the frog's answer, then its second sequence two ticks later, and
// the royal appears with graphic 85 two ticks after that.
const KISS_PLAYER_ANIMATION = 2376;
const KISS_FROG_ANIMATION = 2374;
const KISS_FROG_SECOND_ANIMATION = 2375;
const KISS_FROG_SECOND_DELAY = 17;
const KISS_SOUND = 1854;
const TRANSFORM_GRAPHIC = 85;
const ROYAL_LEAVING_ANIMATION = 1374;
const KISS_TO_SECOND = 2;
const SECOND_TO_ROYAL = 2;
const ROYAL_LEAVING_TICKS = 3;
const SCENE_GRACE_MS = 30_000;
const FROGLAND_ARRIVAL = { x: 2464, y: 4780, z: 0 };
// Tiles around the player for the rest of the group (1702 has six frogs in all, loose, not
// in a set pattern: 1723's stand elsewhere).
const FROG_OFFSETS = [[-1, -1], [-4, -1], [-3, -2], [-3, -3], [0, 1]];
const FROG_WANDER = 3;

function pick(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
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
  const CROWNED = N.FROG_7; // 5431: the crowned frog, the static one in Frogland too.
  const SPEAKER = N.FROG_5; // 5429: speaks the overheads (1702).
  const chorusFrogs = new Map();

  const definition = {
    id: CROWNED,
    kind: "frog",
    stationary: true,
    arrivalSmokes: [ARRIVAL_SOUND, ARRIVAL_SOUND],
    goodbye: "Maybe later.",
    otherPlayerLine: () => "The frogs do not need your help right now.", // Transcript:Frog (Kiss the frog), pointy hat.
    onSpawn(active) {
      const { Location } = api.core;
      const { player } = active;
      // Since 26 June 2024 the royal's gender is not tied to the player's.
      active.royal = Math.random() < 0.5
        ? { title: "prince", npcId: N.FROG_PRINCE }
        : { title: "princess", npcId: N.FROG_PRINCESS };
      active.chorus = [];
      chorusFrogs.set(active.npc, { active, crowned: true });
      const at = player.getLocation();
      FROG_OFFSETS.forEach(([dx, dy], index) => {
        const location = new Location(at.getX() + dx, at.getY() + dy, at.getZ());
        if (api.getRegionManager().blocked(location, player.getPrivateArea?.())) return;
        const speaker = index === 0;
        const npc = api.spawnNpc({ id: speaker ? SPEAKER : N.FROG_6, x: location.getX(), y: location.getY(),
          z: location.getZ(), owner: player, wanderRadius: speaker ? 0 : FROG_WANDER });
        if (!npc) return;
        active.chorus.push(npc);
        chorusFrogs.set(npc, { active, speaker });
        if (speaker) active.speaker = npc;
      });
      const voice = active.speaker ?? active.npc;
      voice.forceChat(`Greetings from the frog ${active.royal.title}, ${player.getUsername()}!`);
      player.getPacketSender().sendSound(CROAK_SOUND, 1, 0);
      overheads(active, voice);
    },
    onFinish(active) {
      chorusFrogs.delete(active.npc);
      for (const npc of active.chorus ?? []) {
        chorusFrogs.delete(npc);
        api.removeNpc(npc);
      }
    },
    talk(active, helpers) {
      if (active.scene) return;
      const { player } = active;
      const say = (text, then) => Flow.chat(api, {
        player, pages: [{ player: true, text }], ...(then ? { onEnd: then } : {}),
      });
      const options = [
        [pick(TOUCH), text => say(text, () => touch(active))],
        [pick(KISS), text => say(text, () => kissAnswer(active))],
        [pick(POLITE_REFUSALS), text => say(text)],
        [pick(BECOME_FROG), text => say(text, () => transform(active, helpers))],
      ].map(([text, choose]) => [text, () => choose(text)]);
      Flow.chat(api, {
        player,
        npcId: CROWNED,
        title: OPTIONS_TITLE,
        lines: ["Please help me. I was transformed into a frog by a well-meaning but sadly frog-obsessed old wizard. Only your touch can turn me back. Will you help me?"],
        options: shuffled(options),
      });
    },
  };

  function overheads(active, voice) {
    const { player } = active;
    const name = player.getUsername();
    const { title } = active.royal;
    const task = new (class extends api.core.Task {
      constructor() { super(OVERHEAD_TICKS, player); }
      execute() {
        if (Events.activeFor(player) !== active) { this.stop(); return; }
        if (active.scene) return;
        voice.forceChat(pick([`Talk to the frog ${title}, ${name}!`, `The frog ${title} needs your help, ${name}!`,
          `Please respond to the frog ${title}, ${name}!`]));
        player.getPacketSender().sendSound(CROAK_SOUND, 1, 0);
      }
    })();
    api.getTaskManager()?.submit(task);
  }

  function after(player, ticks, action) {
    const task = new (class extends api.core.Task {
      constructor() { super(ticks, player); }
      execute() {
        this.stop();
        action();
      }
    })();
    api.getTaskManager()?.submit(task);
  }

  function kissAnswer(active) {
    Flow.chat(api, {
      player: active.player,
      npcId: CROWNED,
      lines: ["Yes!"],
      onEnd: () => turnBack(active, true),
    });
  }

  function touch(active) {
    turnBack(active, false);
  }

  // 1702's kiss. The touch route has no recording: the frog still turns back the same way, but
  // the player's own touch animation is unknown, so they play none.
  function turnBack(active, kissed) {
    if (active.scene || Events.activeFor(active.player) !== active) return;
    active.scene = true;
    active.expiresAt += SCENE_GRACE_MS;
    const { player, npc } = active;
    const { Animation, Graphic } = api.core;
    const sender = player.getPacketSender();
    sender.sendInterfaceRemoval();
    sender.sendSound(KISS_SOUND, 1, 0);
    if (kissed) player.performAnimation(new Animation(KISS_PLAYER_ANIMATION));
    npc.performAnimation(new Animation(KISS_FROG_ANIMATION));
    const live = () => Events.activeFor(player) === active && player.isRegistered();
    after(player, KISS_TO_SECOND, () => {
      if (!live()) return;
      npc.performAnimation(new Animation(KISS_FROG_SECOND_ANIMATION, KISS_FROG_SECOND_DELAY));
      after(player, SECOND_TO_ROYAL, () => {
        if (!live()) return;
        npc.setNpcTransformationId(active.royal.npcId);
        npc.performGraphic(new Graphic(TRANSFORM_GRAPHIC, GRAPHIC_HEIGHT));
        sender.sendSound(ARRIVAL_SOUND, 1, 0);
        Rewards.give(api, player, [I.FROG_TOKEN]);
        Flow.chat(api, {
          player,
          npcId: active.royal.npcId,
          lines: [`Thank you so much, ${player.getUsername()}. I must return to my fairytale kingdom. But take this as a reward. You can exchange it at the Varrock clothes store for a costume.`],
          onEnd: () => royalLeaves(active),
        });
      });
    });
  }

  function royalLeaves(active) {
    const { player, npc } = active;
    const { Animation, Graphic } = api.core;
    const sender = player.getPacketSender();
    sender.sendInterfaceRemoval();
    npc.performAnimation(new Animation(ROYAL_LEAVING_ANIMATION));
    after(player, ROYAL_LEAVING_TICKS, () => {
      if (Events.activeFor(player) !== active) return;
      const tile = npc.getLocation();
      sender.sendGraphic(new Graphic(ARRIVAL_GRAPHIC, GRAPHIC_HEIGHT), tile);
      sender.sendAreaSound(ARRIVAL_SOUND, tile.getX(), tile.getY(), tile.getZ(), 1, 0, 1);
      Events.finish(active);
    });
  }

  function transform(active, { teleport }) {
    const { player } = active;
    player.getPacketSender().sendInterfaceRemoval();
    teleport({
      kind: "frogland",
      arrive: FROGLAND_ARRIVAL,
      onStart(session) {
        player.setNpcTransformationId(N.FROG_6);
        Teleports.onEnd(session, () => player.setNpcTransformationId(-1));
      },
    });
  }

  // The crowned frog that stands in Frogland (world spawn, 2463,4782) lets the player leave.
  function frogland(session, player) {
    Flow.chat(api, {
      player,
      npcId: CROWNED,
      title: OPTIONS_TITLE,
      lines: ["Are you ready to leave now?"],
      options: [
        ["Yes, I'd like to leave now.", () => Flow.chat(api, {
          player,
          pages: [{ player: true, text: "Yes, I'd like to leave now." }],
          onEnd: () => {
            player.getPacketSender().sendInterfaceRemoval();
            Teleports.finish(session);
          },
        })],
        ["No, I'd rather stay.", () => Flow.chat(api, {
          player, pages: [{ player: true, text: "No, I'd rather stay." }],
        })],
      ],
    });
  }

  function talkToFrog(event) {
    const { player, npc } = event;
    const session = Teleports.sessionOf(player);
    if (session?.kind === "frogland" && npc.getId?.() === CROWNED) {
      frogland(session, player);
      event.handled = true;
      return true;
    }
    const frog = chorusFrogs.get(npc);
    if (!frog || frog.crowned) return Events.talk(event);
    event.handled = true;
    const { title } = frog.active.royal;
    Flow.chat(api, { player, npcId: npc.getId(), lines: [frog.speaker
      ? `Don't talk to me! Speak to the frog ${title}!`
      : `Hurrah for the frog ${title}!`] });
    return true;
  }

  // Someone else's frogs (Transcript:Kiss_the_frog, "Other player's frog").
  function talkToOthersFrog(event) {
    const frog = chorusFrogs.get(event.npc);
    if (!frog || frog.active.player === event.player) return false;
    event.handled = true;
    Flow.chat(api, { player: event.player, npcId: event.npc.getId(), lines: [frog.speaker
      ? "Don't look at me, I'm just a frog. Ribbit! Ribbit!"
      : "The frogs do not need your help right now."] });
    return true;
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));

  api.onNpcInteraction("Frog", {
    "Talk-to": event => talkToOthersFrog(event) || talkToFrog(event),
  });

  api.onNpcInteraction("Thessalia", { "Talk-to": thessalia });
  api.onItemOnNpc(tokenOnThessalia);

  function tokenOnThessalia(event) {
    const { player, target, itemId } = event;
    if (itemId !== I.FROG_TOKEN || target.getDefinition?.()?.getName?.() !== "Thessalia") return false;
    event.handled = true;
    offerExchange(player);
    return true;
  }

  function thessalia(event) {
    const { player } = event;
    if (!player.getInventory().containsNumber(I.FROG_TOKEN)) return false;
    offerExchange(player);
    event.handled = true;
    return true;
  }

  // The transcript's wording. The token option sits in her normal menu live; here holding a
  // token goes straight to it, which is the behaviour this module has always had.
  function offerExchange(player) {
    const exchange = (playerLine, rewards, itemShown, message) => Flow.chat(api, {
      player,
      pages: [{ player: true, text: playerLine }],
      onEnd: () => {
        if (!player.getInventory().containsNumber(I.FROG_TOKEN)) return;
        player.getInventory().delete(I.FROG_TOKEN, 1);
        for (const reward of rewards) player.getInventory().addItem(new api.core.Item(reward, 1));
        Flow.itemStatement(api, player, itemShown, message);
      },
    });
    Flow.chat(api, {
      player,
      npcId: N.THESSALIA,
      pages: [
        { player: true, text: "I have a frog token..." },
        { text: "That entitles you to a free costume! Do you want a frog mask, a royal tunic & leggings or a royal blouse & skirt? I've also got some lamps a strange blue chap gave me." },
      ],
      options: [
        ["A frog mask, please!", () => exchange("A frog mask, please!", [I.FROG_MASK], I.FROG_MASK,
          "Thessalia exchanges your token for a frog mask.")],
        ["A royal tunic & leggings, please.", () => exchange("A royal tunic & leggings, please.",
          [I.ROYAL_FROG_TUNIC, I.ROYAL_FROG_LEGGINGS], I.ROYAL_FROG_TUNIC,
          "Thessalia exchanges your token for a royal tunic & leggings.")],
        ["A royal blouse & skirt, please.", () => exchange("A royal blouse & skirt, please.",
          [I.ROYAL_FROG_BLOUSE, I.ROYAL_FROG_SKIRT], I.ROYAL_FROG_BLOUSE,
          "Thessalia exchanges your token for a royal blouse & skirt.")],
        ["I'll take a lamp, thanks.", () => exchange("I'll take the reward lamp, thanks.", [I.LAMP], I.LAMP,
          "Thessalia exchanges your token for a lamp.")],
        ["Maybe another time.", () => Flow.chat(api, {
          player, pages: [{ player: true, text: "Maybe another time." }],
        })],
      ],
    });
  }
};
