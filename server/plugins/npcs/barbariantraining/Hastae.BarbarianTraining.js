"use strict";

/**
 * Otto Godblessed's hastae service (Wiki: Otto Godblessed, Zamorakian hasta, Broken dragon hasta;
 * the Otto Godblessed transcript in npc-dialogues.json, "Can you help me with hastae?"):
 *
 * - a Zamorakian spear becomes a Zamorakian hasta for 300,000 coins, 150,000 with the Elite
 *   Kandarin Diary, once the Fishing and Smithing parts of Barbarian Training are done;
 * - a Zamorakian hasta goes back to a spear for free;
 * - a broken dragon hasta is repaired into a dragon hasta for free, with a warning when the player
 *   hasn't learned hasta smithing (they can't wield it yet).
 *
 * rsprox recording 1529 (rev 224, ticks 485-537) plays the spear conversion: carrying the spear,
 * the Talk-to greeting is followed by a top-level menu ("Let's talk about my training.", "Can you
 * help me with hastae?", "I'd better get going." among others); the hastae menu lists only what
 * the player carries, then "Actually, forget I asked.". "Yes." fades out to a copy of the grotto
 * (mapsquare 10038), where the player stands at 2503,3486 facing south-west and Otto's hammer
 * form (npc 2915, brut_otto_hammer) at 2501,3485 strikes the anvil twice (seq 898, synth sounds
 * 3790/3791) under a fixed camera. Twelve ticks after the choice it fades out again; two ticks
 * later the player is back at 2503,3487, and the next tick the coins and spear change in the same
 * update as the hasta's objectbox, as the screen fades in. Coins and items change only then.
 */
const { createQuestScenes } = require("../../quests/QuestScenes");

const PRICE = 300000;
const DIARY_PRICE = 150000;
const SCENE = "otto-hastae";
const RECOVERY_ATTRIBUTE = "barbarian-training:hastae-scene-exit";

/** rsprox recording 1529: the source map square's chunks, the stands and the camera. */
const GROTTO = { sourceChunk: [312, 435], size: 5, bounds: [[2496, 2535, 3480, 3519, 0]] };
const STAND = [2503, 3486, 0];
const RETURN = [2503, 3487, 0];
const ANVIL_SIDE = [2502, 3485];
const OTTO_AT = [2501, 3485, 0];
const CAMERA_MOVE = [2497, 3483, 350];
const CAMERA_LOOK = [2502, 3485, 200];
const CAMERA_MOVE_RATES = { rate: 232, rate2: 90 };
const CAMERA_LOOK_RATES = { rate: 232, rate2: 80 };
const SMITHING_SEQ = 898;
const HAMMER_SOUNDS = [3790, 3791];

/** Ticks after "Yes.", from recording 1529 (choice at tick 522). */
const TIMING = { open: 2, camera: 3, fadeIn: 4, strikes: [6, 10], fadeOut: 12, end: 14, result: 15 };

const TEXT = {
  top: "Can you help me with hastae?",
  topReply: "Perhaps. What do you need?",
  broken: "Can you forge anything from this broken-looking hasta?",
  spear: "Can you convert Zamorakian spears into hastae?",
  hasta: "Can you convert Zamorakian hastae into spears?",
  forget: "Actually, forget I asked.",
  forgetIt: "Actually, forget it.",
  asYouWish: "As you wish.",
  yes: "Yes.",
  no: "No.",
  spearPrice: (price) => `Yes, I can convert a Zamorakian spear into a hasta. The spirits require me to request ${price.toLocaleString("en-US")} coins from you for this service.`,
  cantAfford: "I can't afford that. Maybe another time.",
  spearPrompt: "Do you wish to convert your spear?",
  spearDone: "Otto has converted your spear into a hasta.",
  hastaReply: "Yes, I can convert a Zamorakian hasta into a spear. I do not charge for this service.",
  hastaPrompt: "Do you wish to convert your hasta?",
  hastaDone: "Otto has converted your hasta into a spear.",
  brokenUntrained: "Yes, I can work with this, but remember, you cannot comprehend how to wield a hasta until you have learned to create one by following my teachings.",
  brokenWarning: "<col=7f0000>~ WARNING ~ You do not have the requirements to wield a hasta!</col>",
  brokenTrained: "Yes, I can work with this.",
  brokenPrompt: "Do you wish to make a dragon hasta?",
  brokenDone: "Otto has created a dragon hasta.",
};

/**
 * `deps` is the training plugin's own dialogue and state helpers: play(player, npcId, lines, next),
 * ask(player, options, title), near(player, npc), restricted(item), canConvertSpears(player) and
 * learnedHastae(player).
 */
function createHastae(api, deps) {
  const core = api.core;
  const { Animation, DialogueChainBuilder, ItemStatementDialogue, StatementDialogue, ActionDialogue, Item, ItemIdentifiers: I } = core;
  const Scenes = createQuestScenes(api, {
    recoveryAttribute: RECOVERY_ATTRIBUTE,
    onEnd: (player) => Scenes.restoreTabs(player),
  });
  const pending = new WeakMap();

  const SERVICES = {
    broken: { from: I.BROKEN_DRAGON_HASTA, to: I.DRAGON_HASTA, done: TEXT.brokenDone },
    spear: { from: I.ZAMORAKIAN_SPEAR, to: I.ZAMORAKIAN_HASTA, done: TEXT.spearDone },
    hasta: { from: I.ZAMORAKIAN_HASTA, to: I.ZAMORAKIAN_SPEAR, done: TEXT.hastaDone },
  };

  function slotOf(player, id) {
    return player.getInventory().getItems().findIndex((item) =>
      item?.getId() === id && item.getAmount() > 0 && !deps.restricted(item));
  }

  /** The services the player carries something for, in the transcript's order. */
  function offered(player) {
    return Object.keys(SERVICES).filter((key) =>
      slotOf(player, SERVICES[key].from) >= 0 && (key !== "spear" || deps.canConvertSpears(player)));
  }

  function price(player) {
    const request = { player, diary: "kandarin", tier: "elite", complete: false };
    api.emitCustomEvent("diary:is-complete", request);
    return request.complete === true ? DIARY_PRICE : PRICE;
  }

  function hasCoins(player, amount) {
    return player.getInventory().getAmount(I.COINS) >= amount;
  }

  function line(player, talk, lines, next) {
    if (!deps.near(player, talk.npc)) { player.getPacketSender().sendInterfaceRemoval(); return; }
    deps.play(player, talk.npcId, lines, next);
  }

  /** "Can you help me with hastae?" from Otto's top-level menu. */
  function topic(player, talk) {
    line(player, talk, [{ player: TEXT.top }, { npc: TEXT.topReply }], () => {
      const services = offered(player);
      deps.ask(player, [
        ...services.map((key) => [TEXT[key], () => SERVICE_TOPICS[key](player, talk)]),
        [TEXT.forget, () => line(player, talk, [{ player: TEXT.forget }, { npc: TEXT.asYouWish }])],
      ]);
    });
  }

  function confirm(player, talk, title, key, noLine, cost = 0) {
    deps.ask(player, [
      [TEXT.yes, () => start(player, talk, key, cost)],
      [TEXT.no, () => line(player, talk, [{ player: noLine }, { npc: TEXT.asYouWish }])],
    ], title);
  }

  const SERVICE_TOPICS = {
    spear(player, talk) {
      const cost = price(player);
      line(player, talk, [{ player: TEXT.spear }, { npc: TEXT.spearPrice(cost) }], () => {
        if (!hasCoins(player, cost)) { line(player, talk, [{ player: TEXT.cantAfford }]); return; }
        confirm(player, talk, TEXT.spearPrompt, "spear", TEXT.forgetIt, cost);
      });
    },
    hasta(player, talk) {
      line(player, talk, [{ player: TEXT.hasta }, { npc: TEXT.hastaReply }], () =>
        confirm(player, talk, TEXT.hastaPrompt, "hasta", TEXT.forget));
    },
    broken(player, talk) {
      if (deps.learnedHastae(player)) {
        line(player, talk, [{ player: TEXT.broken }, { npc: TEXT.brokenTrained }], () =>
          confirm(player, talk, TEXT.brokenPrompt, "broken", TEXT.forget));
        return;
      }
      line(player, talk, [{ player: TEXT.broken }, { npc: TEXT.brokenUntrained }], () => {
        player.getDialogueManager().startDialogues(new DialogueChainBuilder()
          .add(new StatementDialogue(0, TEXT.brokenWarning))
          .add(new ActionDialogue(1, { execute: () => confirm(player, talk, TEXT.brokenPrompt, "broken", TEXT.forgetIt) })));
      });
    },
  };

  /** "Yes.": the chatbox empties and the screen fades as Otto takes the weapon to his anvil. */
  function start(player, talk, key, cost) {
    if (Scenes.get(player) || !deps.near(player, talk.npc) || slotOf(player, SERVICES[key].from) < 0) {
      player.getPacketSender().sendInterfaceRemoval();
      return;
    }
    pending.set(player, { key, cost });
    Scenes.hold(player);
    Scenes.fade(player, true);
    Scenes.controls(player, true, true);
    Scenes.later(player, TIMING.open, () => open(player));
  }

  function open(player) {
    if (!player.isRegistered?.() || !pending.has(player)) return;
    const scene = Scenes.open(player, SCENE, GROTTO.bounds, {}, {
      instance: { sourceChunk: GROTTO.sourceChunk, size: GROTTO.size }, at: STAND, exit: RETURN,
    });
    scene.otto = Scenes.actor(scene, core.NpcIdentifiers.OTTO_GODBLESSED_2, OTTO_AT, ANVIL_SIDE);
    Scenes.face(player, ANVIL_SIDE);
    Scenes.controls(player, true, true);
    Scenes.hideTabs(player);
    const after = TIMING.open;
    Scenes.later(scene, TIMING.camera - after, () =>
      Scenes.camera(player, CAMERA_MOVE, CAMERA_LOOK, CAMERA_MOVE_RATES, CAMERA_LOOK_RATES));
    Scenes.later(scene, TIMING.fadeIn - after, () => Scenes.fade(player, false));
    for (const strike of TIMING.strikes) {
      Scenes.later(scene, strike - after, () => hammer(player, scene));
      Scenes.later(scene, strike - after + 1, () => player.getPacketSender().sendSoundEffect(HAMMER_SOUNDS[1], 2, 5, 0));
      Scenes.later(scene, strike - after + 2, () => {
        player.getPacketSender().sendSoundEffect(HAMMER_SOUNDS[0], 2, 0, 0);
        player.getPacketSender().sendSoundEffect(HAMMER_SOUNDS[1], 2, 25, 0);
      });
    }
    Scenes.later(scene, TIMING.fadeOut - after, () => Scenes.fade(player, true));
    Scenes.later(scene, TIMING.end - after, () => finish(player));
  }

  function hammer(player, scene) {
    scene.otto?.performAnimation(new Animation(SMITHING_SEQ));
    player.getPacketSender().sendSoundEffect(HAMMER_SOUNDS[0], 2, 10, 0);
  }

  /** Back on the real map; the weapon and coins change the next tick, with the objectbox. */
  function finish(player) {
    Scenes.end(player, false);
    player.moveTo(new core.Location(...RETURN));
    Scenes.later(player, TIMING.result - TIMING.end, () => result(player));
  }

  function result(player) {
    const job = pending.get(player);
    pending.delete(player);
    if (!job || !player.isRegistered?.()) return;
    const service = SERVICES[job.key];
    const inventory = player.getInventory();
    const slot = slotOf(player, service.from);
    if (slot < 0 || (job.cost && !hasCoins(player, job.cost))) {
      Scenes.fade(player, false);
      player.getPacketSender().sendInterfaceRemoval();
      return;
    }
    if (job.cost) inventory.deleted(I.COINS, job.cost, false);
    inventory.setItem(slot, new Item(service.to, 1));
    inventory.refreshItems();
    Scenes.fade(player, false);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new ItemStatementDialogue(0, service.to, service.done)));
  }

  return { offered, topic, _test: { TEXT, PRICE, DIARY_PRICE, TIMING, SERVICES, Scenes } };
}

module.exports = { createHastae, TEXT };
