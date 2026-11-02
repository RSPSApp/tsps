"use strict";

// Freaky Forester (random event): kill a pheasant and hand the raw pheasant to the forester,
// then leave through the portal for a lederhosen piece (hat, top, shorts), or a lamp once the
// outfit is complete. Since 2020 any pheasant carcass is accepted, so every pheasant drops the
// same item. The spawned pheasants are multinpcs on varp 531, which picks their tails; unset
// they are invisible. See SOURCES.md.
const Flow = require("./DialogueFlow.RandomEvents");
const Teleports = require("./Teleports.RandomEvents");

const PHEASANTS = [373, 374, 5497, 5498, 5499, 5500, 5501, 5502];
const OUTFIT = [6182, 6180, 6181];
const KILL_OPTION = 2;
const NAGS = [name => `${name}!`, name => `Hello? ${name}?`, name => `Talk to me, ${name}!`,
  name => `${name}? Are you there?`, name => `I'd like to talk to you, ${name}!`];
// Live arrivals beside the forester (2599,4775): RSProx 3998 and 554.
const ARRIVALS = [{ x: 2599, y: 4774, z: 0 }, { x: 2598, y: 4775, z: 0 }];
const TAILS_VARP = 531;
// Varp 531's values with a pheasant behind them (the multinpcs' 24 arrangements).
const TAILS_ARRANGEMENTS = 24;
const TAIL_WORDS = { 2: "two", 3: "three", 4: "four" };
const CARCASS_DESPAWN_TICKS = 100;
const BIRD_DEFEND = 2372;
const BIRD_DEATH = 2373;
const PUNCH = 422;
const HIT_SOUND = 692;
const DEATH_SOUND = 691;
const HIT_DELAY = 1;
const DEATH_DELAY = 3;
const DROP_DELAY = 5;
// Chathead animations as sent live (3998, 554).
const PLAYER_EXPRESSION = 567;
const INVITE_EXPRESSION = 555;
const REQUEST_EXPRESSION = 590;
const BRING_EXPRESSION = 588;
const THANKS_EXPRESSION = 589;
const REWARD_EXPRESSION = 567;

function rewardLine(piece) {
  if (piece === 6182) return "You get a lederhosen hat for your help, many thanks!";
  if (piece === 6180) return "You get a lederhosen top for your help, many thanks!";
  if (piece === 6181) return "You get lederhosen legs for your help, many thanks!";
  return "You get a lamp for your help, many thanks!";
}

// The forester's request: the first three as sent live (3998, 554, 1757), the last from the Wiki.
function requestLine(name, tails) {
  const word = TAIL_WORDS[tails];
  const asks = [
    `Could you kill a pheasant with ${word} tails, please?`,
    `I need you to kill the pheasant that has ${word} tails.`,
    `Could you kill the pheasant with ${tails} tails, please?`,
    `Can you kill the ${tails}-tailed pheasant please.`,
  ];
  const ask = asks[Math.floor(Math.random() * asks.length)];
  return `Hey there, ${name}. ${ask} Bring me the raw pheasant when you're done.`;
}

module.exports = function attach(api, Events) {
  const I = api.core.ItemIdentifiers;
  const N = api.core.NpcIdentifiers;

  const definition = {
    id: N.FREAKY_FORESTER_2,
    kind: "forester",
    greet: name => NAGS[Math.floor(Math.random() * NAGS.length)](name),
    nags: NAGS,
    goodbye: "Maybe later.",
    linger: true,
    otherPlayerLine: owner => `I'm looking for ${owner.getUsername()}.`,
    leavingLine: () => "Goodbye.",
    talk(active, { teleport, leave }) {
      const { player } = active;
      Flow.chat(api, {
        player,
        npcId: active.definition.id,
        title: "What would you like to say?",
        lines: [{ text: `Hey, ${player.getUsername()}, can you come and help me with some pheasants?`,
          expression: INVITE_EXPRESSION }],
        options: [
          ["Okay, I'll help with your pheasants.", () => reply(player, "Okay, I'll help with your pheasants.",
            () => teleport({
              kind: "forester",
              arrive: ARRIVALS[Math.floor(Math.random() * ARRIVALS.length)],
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
    const tails = [2, 3, 4][Math.floor(Math.random() * 3)];
    session.data.request = requestLine(player.getUsername(), tails);
    session.data.done = false;
    session.data.killing = false;
    const sender = player.getPacketSender();
    sender.sendConfig(TAILS_VARP, 1 + Math.floor(Math.random() * TAILS_ARRANGEMENTS));
    Teleports.onEnd(session, () => sender.sendConfig(TAILS_VARP, 0));
    Flow.chat(api, { player, npcId: N.FREAKY_FORESTER,
      lines: [{ text: session.data.request, expression: REQUEST_EXPRESSION }] });
  }

  api.onCustomEvent(Events.DEFINITIONS_EVENT, payload => payload.definitions.push(definition));

  api.onNpcClick(PHEASANTS, KILL_OPTION, killPheasant);

  function holdsCarcass(player) {
    return player.getInventory().containsNumber(I.RAW_PHEASANT_3);
  }

  function killPheasant(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "forester") return false;
    event.handled = true;
    const { player } = session;
    if (session.data.done) {
      player.sendMessage("You don't need to attack any more pheasants. You're allowed to leave.");
      return true;
    }
    if (holdsCarcass(player)) {
      player.sendMessage("You already have a pheasant carcass. You don't need to kill another.");
      return true;
    }
    if (session.data.killing) return true;
    session.data.killing = true;
    const npc = event.npc;
    const location = npc.getLocation().clone();
    const sender = player.getPacketSender();
    player.setPositionToFace(location);
    player.performAnimation(new api.core.Animation(PUNCH));
    npc.performAnimation(new api.core.Animation(BIRD_DEFEND));
    Teleports.later(session, HIT_DELAY, () => sender.sendSound?.(HIT_SOUND, 0, 0));
    Teleports.later(session, DEATH_DELAY, () => {
      sender.sendSound?.(DEATH_SOUND, 0, 0);
      npc.performAnimation(new api.core.Animation(BIRD_DEATH));
      npc.setHitpoints(0);
    });
    Teleports.later(session, DROP_DELAY, () => {
      session.data.killing = false;
      api.getItemOnGroundManager().registerLocation(player, new api.core.Item(I.RAW_PHEASANT_3, 1), location,
        undefined, { goesGlobal: false, despawnDelay: CARCASS_DESPAWN_TICKS });
      Flow.chat(api, { player, npcId: N.FREAKY_FORESTER,
        lines: [{ text: "Now bring me the raw pheasant.", expression: BRING_EXPRESSION }] });
    });
    return true;
  }

  api.onGroundItemPickup(pickUpCarcass);

  function pickUpCarcass(event) {
    if (event.groundItemId !== I.RAW_PHEASANT_3) return false;
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "forester" || !holdsCarcass(event.player)) return false;
    event.handled = true;
    event.player.sendMessage("You already have a pheasant carcass in your inventory, you don't need to kill another.");
    return true;
  }

  api.onNpcInteraction("Freaky Forester", { "Talk-to": talkInArea });

  function talkInArea(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "forester" || event.npc.getId?.() !== N.FREAKY_FORESTER) return false;
    event.handled = true;
    const { player } = event;
    const name = player.getUsername();
    let line = session.data.request;
    let expression = REQUEST_EXPRESSION;
    if (session.data.done) {
      expression = THANKS_EXPRESSION;
      line = holdsCarcass(player) ? "I don't need any more of those. You are free to exit the area now."
        : `Okay, ${name}, you can leave the area now.`;
    } else if (holdsCarcass(player)) {
      player.getInventory().delete(I.RAW_PHEASANT_3, 1);
      session.data.done = true;
      line = `Thanks, ${name}, you may use the portal to leave the area now.`;
      expression = THANKS_EXPRESSION;
    }
    Flow.chat(api, { player, npcId: N.FREAKY_FORESTER, lines: [{ text: line, expression }] });
    return true;
  }

  api.onObjectInteraction("Exit portal", { Use: usePortal });

  function usePortal(event) {
    const session = Teleports.sessionOf(event.player);
    if (!session || session.kind !== "forester") return false;
    event.handled = true;
    const { player } = event;
    if (!session.data.done) {
      Teleports.finish(session);
      return true;
    }
    const missing = OUTFIT.find(piece => !Teleports.owns(player, piece));
    Teleports.finish(session, { reward: [{ id: missing ?? I.LAMP, amount: 1 }] });
    Flow.chat(api, { player, npcId: N.FREAKY_FORESTER,
      lines: [{ text: rewardLine(missing), expression: REWARD_EXPRESSION }] });
    return true;
  }
};
