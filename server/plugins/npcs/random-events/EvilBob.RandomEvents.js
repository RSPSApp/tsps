"use strict";

// Evil Bob (random event): the cat offers either his ScapeRune island or his prison.
// Island: the servant names the fishing spot whose fish Bob likes; catch one, uncook it at
// the pot and feed Bob until he sleeps, then leave by the portal for 650 Fishing (or Magic)
// XP. Prison: Prison Pete asks for the balloon animal the lever shows; three right keys free
// him, then he pays a reward. See SOURCES.md.
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");

const ISLAND = { minX: 2500, maxX: 2548, minY: 4758, maxY: 4798 };
const FISHING_SPOT = 23114;
const UNCOOK_POT = 23113;
const PORTAL = 23115;
const NET = 6209;
const RAW_CORRECT = 6200;
const COOKED_CORRECT = 6202;
const RAW_WRONG = 6204;
const COOKED_WRONG = 6206;
const SPOTS = ["west", "north", "south", "east"];

const PRISON = { minX: 2060, maxX: 2106, minY: 4444, maxY: 4484 };
const LEVER = 24296;
const KEY = 6966;
const BALLOONS = [[{ id: 5488, model: 16034, shape: "cat" }, [2077, 4461]],
  [{ id: 5489, model: 10736, shape: "dog" }, [2078, 4465]],
  [{ id: 5491, model: 27098, shape: "goat" }, [2080, 4467]],
  [{ id: 5493, model: 10737, shape: "sheep" }, [2082, 4472]]];
const BARRIERS_MAX = 5;

function inside(bounds, location) {
  return location.getX() >= bounds.minX && location.getX() <= bounds.maxX &&
    location.getY() >= bounds.minY && location.getY() <= bounds.maxY;
}

module.exports = function attach(api, Events) {
  const I = api.core.ItemIdentifiers;
  const N = api.core.NpcIdentifiers;

  // Two definitions share the cat so the natural scheduler offers either half at random and
  // testers can force each with ::randevt, matching the wiki's separate event rows.
  function definition(variant) {
    return {
      id: N.EVIL_BOB,
      kind: variant,
      greeting: "Mew!",
      talk(active, { teleport }) {
        const { player } = active;
        const island = variant === "evilbob";
        Flow.chat(api, {
          player,
          npcId: active.definition.id,
          lines: island
            ? [`Hey, ${player.getUsername()}, come with me if you like fishing!`,
              "Or has this amulet of humanspeak broken again?"]
            : ["Do you wanna meet my pet? His name's Pete. Or has this amulet of humanspeak broken again?"],
          options: [
            ["Yes, that seems like a good idea.", () => island ? startIsland(teleport) : startPrison(teleport)],
            ["No, leave the cat alone.", () => {}],
          ],
        });
      },
    };
  }

  // --- Island -----------------------------------------------------------------------------

  function startIsland(teleport) {
    teleport({
      kind: "evilbob",
      arrive: { x: 2524, y: 4777, z: 0 },
      teleportRefusal: "Use the portal to leave Evil Bob's island!",
      onStart(session) {
        session.data.required = 1;
        session.data.asleep = false;
        session.data.spot = SPOTS[Math.floor(Math.random() * SPOTS.length)];
        session.data.net = true;
        session.player.getInventory().addItem(new api.core.Item(NET, 1));
        Teleports.onEnd(session, () => {
          if (session.player.getInventory().containsNumber(NET)) {
            session.player.getInventory().delete(NET, 1);
          }
        });
        session.player.sendMessage("You wake up on Evil Bob's island. Talk to his servant for advice.");
      },
    });
  }

  function spotOf(location) {
    if (location.getX() <= 2515) return "west";
    if (location.getY() <= 4770) return "north";
    if (location.getY() >= 4788) return "south";
    return "east";
  }

  function useNet(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "evilbob") return false;
    if (event.object.getId() !== FISHING_SPOT) return false;
    event.handled = true;
    const player = event.player;
    if (!player.getInventory().containsNumber(NET)) {
      player.sendMessage("You need a small fishing net.");
      return true;
    }
    const correct = spotOf(event.object.getLocation()) === session.data.spot;
    const caught = correct ? COOKED_CORRECT : COOKED_WRONG;
    if (player.getInventory().containsNumber(COOKED_CORRECT) || player.getInventory().containsNumber(COOKED_WRONG)) {
      player.sendMessage("You already have a fishlike thing.");
      return true;
    }
    player.getInventory().addItem(new api.core.Item(caught, 1));
    player.forceChat("You catch a... what is this?? Is this a fish?? And... it's cooked already??");
    return true;
  }

  function cookPot(event) {
    const source = event.itemId ?? event.sourceItemId;
    if (event.object?.getId?.() !== UNCOOK_POT) return false;
    const cooked = source === COOKED_CORRECT ? COOKED_CORRECT : source === COOKED_WRONG ? COOKED_WRONG : null;
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "evilbob") return false;
    event.handled = true;
    const player = event.player;
    if (!cooked) {
      player.sendMessage("Your Uncooking skill must be at least level 40... Wait, you don't even have an Uncooking skill.");
      return true;
    }
    player.getInventory().delete(cooked, 1);
    player.getInventory().addItem(new api.core.Item(cooked === COOKED_CORRECT ? RAW_CORRECT : RAW_WRONG, 1));
    player.sendMessage("You uncook the fishlike thing.");
    return true;
  }

  function feedBob(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "evilbob") return false;
    if (event.npcId !== N.EVIL_BOB_2) return false;
    event.handled = true;
    const player = event.player;
    const source = event.itemId ?? event.sourceItemId;
    if (source !== RAW_CORRECT && source !== RAW_WRONG) {
      player.sendMessage("What am I to do with that? Catch me some fish, puny human!");
      return true;
    }
    player.getInventory().delete(source, 1);
    if (source === RAW_WRONG) {
      session.data.required++;
      player.sendMessage("Bob: What was this? That was absolutely disgusting! Talk to my other servants for advice.");
      return true;
    }
    session.data.required--;
    if (session.data.required > 0) {
      player.sendMessage("Bob: Mmm, mmm... that's delicious. Now get me another one, you no good human!");
      return true;
    }
    session.data.asleep = true;
    player.sendMessage("Bob: ZZZzzz...");
    player.sendMessage("Evil Bob falls asleep. Use the portal to leave.");
    return true;
  }

  function usePortal(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session) return false;
    if (session.kind === "evilbob" && event.object.getId() === PORTAL && inside(ISLAND, event.object.getLocation())) {
      event.handled = true;
      if (!session.data.asleep) {
        Teleports.finish(session, { message: "You slip away from the island without feeding Bob." });
        return true;
      }
      const magic = session.player.getSkillManager().getMaxLevel(api.core.Skill.MAGIC);
      const skill = magic >= 51 && Math.random() < 0.5 ? api.core.Skill.MAGIC : api.core.Skill.FISHING;
      session.player.getSkillManager().addExperience(skill, 650, false);
      Teleports.finish(session, { message: `You feel somehow that you've become better at ${skill.getName()}.` });
      return true;
    }
    if (session.kind === "prison" && event.object.getId() === PORTAL) return false;
    return false;
  }

  // --- Prison -----------------------------------------------------------------------------

  function startPrison(teleport) {
    teleport({
      kind: "prison",
      arrive: { x: 2093, y: 4466, z: 0 },
      teleportRefusal: "Prison Pete needs your help!",
      onStart(session) {
        session.data.required = null;
        session.data.correct = 0;
        session.data.barriers = 3;
        session.data.keyCorrect = false;
        session.data.balloons = [];
        session.player.sendMessage("Welcome to ScapeRune. Speak to Prison Pete.");
        // The event key is temporary: leaving by the chat option, teleport, death or logout
        // must not leave it in the player's inventory (issue #1702).
        Teleports.onEnd(session, () => {
          if (session.player.getInventory().containsNumber(KEY)) {
            session.player.getInventory().delete(KEY, 1);
          }
        });
        for (const [balloon, tile] of BALLOONS) {
          const npc = Teleports.spawnNpc(session, { id: balloon.id, x: tile[0], y: tile[1], z: 0, wanderRadius: 0 });
          if (npc) session.data.balloons.push({ npc, ...balloon });
        }
      },
    });
  }

  function pullLever(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "prison") return false;
    if (event.object.getId() !== LEVER) return false;
    event.handled = true;
    const player = event.player;
    if (session.data.correct >= 3) {
      player.sendMessage("Come on, we should leave before Evil Bob comes back!");
      return true;
    }
    if (player.getInventory().containsNumber(KEY)) {
      player.sendMessage("Hey, bring me that key you've got! I wanna get out of here!");
      return true;
    }
    const needed = BALLOONS[Math.floor(Math.random() * BALLOONS.length)][0];
    session.data.required = needed;
    session.interfaceId = 273;
    const sender = player.getPacketSender();
    sender.sendInterface(273);
    // 273:4 is the model widget; 273:3 is the layer that contains it (yarn dump:widget 273).
    sender.sendInterfaceRawModel((273 << 16) | 4, needed.model);
    sender.sendString("Pop the correct balloon animal to find a key", (273 << 16) | 2);
    player.sendMessage(`The lever reveals the shape of a ${needed.shape}.`);
    Teleports.later(session, 7, () => {
      if (session.interfaceId === 273 && player.getInterfaceId?.() === 273) {
        player.getPacketSender().sendInterfaceRemoval();
      }
    });
    return true;
  }

  function popBalloon(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "prison") return false;
    const balloon = session.data.balloons.find(entry => entry.npc === event.npc);
    if (!balloon) return false;
    event.handled = true;
    const player = event.player;
    if (session.data.correct >= 3) {
      player.sendMessage("Come on, we should leave before Evil Bob comes back!");
      return true;
    }
    if (!session.data.required) {
      player.sendMessage("You're meant to pull the lever to find out which sort of animal to pop!");
      return true;
    }
    if (player.getInventory().containsNumber(KEY)) {
      player.sendMessage("Hey, bring me that key you've got! I wanna get out of here!");
      return true;
    }
    session.data.keyCorrect = balloon.shape === session.data.required.shape;
    player.getInventory().addItem(new api.core.Item(KEY, 1));
    player.sendMessage("Great, now you've got a key! Bring it to me so I can try it on the doors.");
    return true;
  }

  // Live OSRS takes the key on Talk-to, not on item use (rsprox 4067 at tick 5104/5105,
  // rsprox 555): Pete says "Ooh, thanks!" and the key leaves the inventory. Item-on-NPC is
  // kept as a second route because players also try it.
  function handInKey(player, session) {
    player.getInventory().delete(KEY, 1);
    // Either answer spends the shape the lever showed: the next key needs a fresh pull.
    session.data.required = null;
    if (!session.data.keyCorrect) {
      session.data.barriers = Math.min(BARRIERS_MAX, session.data.barriers + 1);
      player.sendMessage("Aww, that was the wrong key! You must have popped the wrong sort of animal.");
      player.sendMessage(`Another energy barrier appears... (${session.data.barriers})`);
      return true;
    }
    session.data.correct++;
    session.data.keyCorrect = false;
    if (session.data.correct >= 3) {
      player.sendMessage("Prison Pete: You did it, you got all the keys right! Thank you! You're my friend FOREVER!");
      // Live lets Pete open the last door and the pair escape; the reward dialogue plays at
      // the return tile a few ticks later, so no second Talk-to is needed.
      Teleports.later(session, 3, () => reward(session));
      return true;
    }
    player.sendMessage("Prison Pete: Hooray, you got the right one! Now pull the lever again and let's get the next portal unlocked!");
    return true;
  }

  function giveKey(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "prison") return false;
    if (event.npcId !== N.PRISON_PETE) return false;
    const source = event.itemId ?? event.sourceItemId;
    if (source !== KEY) return false;
    event.handled = true;
    handInKey(event.player, session);
    return true;
  }

  function talkPete(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "prison" || event.npc.getId?.() !== N.PRISON_PETE) return false;
    const player = event.player;
    event.handled = true;
    if (player.getInventory().containsNumber(KEY)) {
      handInKey(player, session);
      return true;
    }
    if (session.data.correct >= 3) {
      reward(session);
      return true;
    }
    Flow.chat(api, {
      player,
      npcId: N.PRISON_PETE,
      lines: ["So you've been captured too?",
        "You need to pull the lever to find out which shape animal contains the key,",
        "then pop that sort of animal to get the key. Bring me any keys you get!"],
      options: [
        ["Okay.", () => {}],
        ["But I want to leave now.", () => Teleports.finish(session,
          { message: "You leave the prison." })],
      ],
    });
    return true;
  }

  function reward(session) {
    const player = session.player;
    const members = api.core.WorldDefinition.isMembersWorld();
    const table = [[I.LAMP, 1], [I.UNCUT_RUBY_2, 4], [I.UNCUT_DIAMOND_2, 3],
      [I.CHAOS_RUNE, 19 + Math.floor(Math.random() * 7)], [I.LAW_RUNE, 7 + Math.floor(Math.random() * 4)]];
    if (members) {
      table.push([I.GRIMY_TOADFLAX, 6], [I.GRIMY_SNAPDRAGON, 4],
        [I.MITHRIL_ARROWTIPS, 45 + Math.floor(Math.random() * 6)], [I.UGTHANKI_KEBAB, 2]);
    }
    const [item, amount] = table[Math.floor(Math.random() * table.length)];
    player.sendMessage("Prison Pete: Thanks a lot for your help! Here, have a present.");
    Teleports.finish(session, { reward: [{ id: item, amount }] });
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(
    definition("evilbob"), definition("prison")));

  api.onNpcInteraction("Servant", { "Talk-to": talkServant });
  api.onNpcInteraction("Evil Bob", { "Talk-to": talkIslandBob });

  function talkServant(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "evilbob" || event.npcId !== N.SERVANT_2) return false;
    event.handled = true;
    Flow.chat(api, {
      player: event.player,
      npcId: N.SERVANT_2,
      lines: ["Meow! Errr... I c-c-c-can't help you... He'll kill us all!",
        `F-f-f-fish... give him the fish he likes... from the fishing spot to the ${session.data.spot}...`],
    });
    return true;
  }

  function talkIslandBob(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "evilbob") return false;
    event.handled = true;
    if (session.data.asleep) {
      event.player.sendMessage("Evil Bob appears to be sleeping, best not to wake him up.");
      return true;
    }
    Flow.chat(api, {
      player: event.player,
      npcId: N.EVIL_BOB_2,
      lines: ["I am your leader, you are but a slave! Now catch me some fish, I'm hungry.",
        "Talk to my other servants, and hurry it up!"],
    });
    return true;
  }
  api.onObjectInteraction(useNet);
  api.onItemOnObject(cookPot);
  api.onItemOnNpc(feedBob);
  api.onObjectInteraction(usePortal);
  api.onObjectInteraction(pullLever);
  api.onNpcClick(BALLOONS.map(([balloon]) => balloon.id), 1, popBalloon);
  api.onNpcClick(BALLOONS.map(([balloon]) => balloon.id), 2, popBalloon);
  api.onItemOnNpc(giveKey);
  api.onNpcInteraction("Prison Pete", { "Talk-to": talkPete });
};
