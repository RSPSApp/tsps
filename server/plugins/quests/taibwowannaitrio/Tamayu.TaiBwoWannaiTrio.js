/**
 * Tamayu, as RSProx captures local 1001562 (revision 241, ticks 7039-7349) and 75 (revision 227, ticks
 * 4461-4699) play him:
 * - "Lead the way." / "Take me on your next hunt for the Shaikahan." ("Very well, but you must not
 *   interfere."): the hunt plays in its arena (the player at 2520,4568, Tamayu at 2523,4567 facing the
 *   Shaikahan at 2524,4567, the camera on 2523,4567 from six points, one every 4 ticks) and the player is back
 *   25 ticks later, where Tamayu says how it went. With the Karambwan-poisoned spear and four doses of
 *   Agility potion it is his win instead: 14 ticks in the player is at 2537,4568 watching him at 2541,4565,
 *   "The end approaches, Shaikahan!" 2 ticks later, "Gods! Witness this triumph!" and jingle 190 6 after
 *   that, back at 30. Which outcome plays is the Wiki's, by the spear he has and his doses of potion.
 * - A potion or a spear handed over is an item box of it, taken as it shows; after "Thank you Bwana. Now I
 *   must prepare for my next hunt." he drinks the potion (human_eat) as it is continued and speaks 4 ticks
 *   later.
 * - The monkey corpse, after his win: "You hand over the monkey corpse to Tamayu." box; as it is continued he
 *   skins it (human_cooking) and the skin and bones come with "Tamayu hands you some monkey skin and bones."
 *   4 ticks later.
 */
module.exports = function attachTamayu(api, t) {
  const { STAGE, NPC, ITEM, KEY, TAMAYU } = t;
  const { Skill, Location, Animation, ItemIdentifiers: I } = api.core;
  const { createQuestScenes } = require("../QuestScenes");
  const Scenes = createQuestScenes(api);
  const IDS = new Set(NPC.TAMAYU);
  const POTIONS = ITEM.AGILITY_POTIONS;

  // Spears: iron to dragon, plain, poisoned and Karambwan-poisoned; bronze, black and bone ones don't work.
  const PLAIN = new Set([I.IRON_SPEAR, 1241, 1243, 1245, 1247, 1249]);
  const POISONED = new Set([1253, 1255, 1257, 1259, 1261, 1263, 5706, 5708, 5710, 5712, 5714, 5716, 5720, 5722, 5724, 5726, 5728, 5730]);
  const KARAMBWAN_POISONED = new Set([I.IRON_SPEAR_KP_, I.STEEL_SPEAR_KP_, I.MITHRIL_SPEAR_KP_, I.ADAMANT_SPEAR_KP_, I.RUNE_SPEAR_KP_, I.DRAGON_SPEAR_KP_]);
  const isSpear = (id) => PLAIN.has(id) || POISONED.has(id) || KARAMBWAN_POISONED.has(id);
  /** SPEAR key bits: 1 an iron or better spear, 2 poisoned, 4 Karambwan-poisoned. */
  const spearFlags = (id) => (isSpear(id) ? 1 : 0) | (POISONED.has(id) || KARAMBWAN_POISONED.has(id) ? 2 : 0) | (KARAMBWAN_POISONED.has(id) ? 4 : 0);

  const MONKEY_TOO_EARLY = "VCVA5S";
  const POTION_BEFORE_SPEAR = "eCCdOQ";
  const NOT_FOUR_DOSES = "00nHbC";
  const NEXT_BATTLE = "llAaP1";
  const SPEAR_USED = "cD80SB";
  const SPEAR_HUNT = "ETiuMR";
  const POTION_AFTER_SPEAR = "LFPz54";
  const DOSE_CONDITIONS = new Map([["WxLz4a", 1], ["zXZ1_x", 2], ["HDRqLH", 3], ["2SJ62x", 4]]);
  const POTION_BOXES = new Set(["DHN2LM", "GVkJzh", "QceuSt", "-pLuPZ"]);
  const AGILE_HUNT = "Pl2N8n";
  const POISON_HUNT = "rNs2hM";
  const WINNING_HUNT = "XMmbfP";
  const SPEAR_BOX = "uM0CUJ";
  const HUNT_ACTIONS = new Set(["cMkbX1", "zgrp9r", "xSocoz", "KekPyC", "Ve2N_Y", "qnTEqZ"]);
  const WATCH_HUNT = "cMkbX1";
  const MONKEY_USED = "4tWPCu";
  const CORPSE_BOX = "ytBoha";
  const SKIN_BOX = "cFhcr_";
  const SKIN = "c_cWgA";
  const TRAINS = "kg_Pvp";
  const FIGHTING_XP = "EuOV9w";
  const SPEAR_REWARD_BOX = "7o6_Kf";
  const SPEAR_REWARD = "DdMC-c";
  const READY = "Thank you Bwana. Now I must prepare for my next hunt.";
  const JOIN = "Very well, but you must not interfere.";
  const MORE_POTION = "Tamayu, I have brought you more agility potion.";
  const DRINK = 829; // human_eat
  const SKINNING = 896; // human_cooking

  const VARIANT = {
    FIRST: "talking-to-tamayu",
    AGAIN: "talking-to-tamayu-talking-to-tamayu-again",
    LATER: "talking-to-tamayu-subsequent-dialogue-with-tamayu",
    USED: "talking-to-tamayu-using-several-items-on-tamayu",
    TRIUMPH: "talking-to-tamayu-talking-to-tamayu-after-his-triumph-against-the-shaikahan",
    REWARD: "post-quest-dialogue-with-the-brothers-talking-to-tamayu",
    STALL: "post-quest-dialogue-with-the-brothers-subsequent-dialogue-with-tamayu",
  };

  // The captured hunts (local 1001562 ticks 7097-7122 and 7223-7253; 75 ticks 4523-4548).
  const PLAYER_TILE = new Location(2520, 4568, 0);
  const ARENA = [[2500, 2560, 4540, 4600, 0]];
  const CAMERA = [[2518, 4571, 350], [2524, 4575, 350], [2525, 4563, 350], [2529, 4567, 350], [2530, 4571, 350], [2528, 4564, 350]];
  const LOOK = [2523, 4567, 160];
  const RATES = { rate: 232, rate2: 232 };
  const WATCH_TICKS = 25;
  const WIN = { at: 14, player: new Location(2537, 4568, 0), tamayu: [2541, 4565, 0], camera: [2552, 4566, 700], look: [2541, 4565, 320], firstSay: 16, secondSay: 22, ticks: 30 };
  const WIN_JINGLE = 190;
  const SPEAR_SPIKE = 428;
  const SPEAR_BLOCK = 430;
  const BEAST_ATTACK = 1199;
  const BEAST_BLOCK = 1200;
  const returnTiles = new WeakMap();

  const progress = (player) => t.state(player, KEY.TAMAYU);
  const agility = (player) => t.state(player, KEY.AGILITY);
  const flags = (player) => t.state(player, KEY.SPEAR);
  const used = (player) => t.lastUsedItem.get(player);
  const watched = (player) => progress(player) >= TAMAYU.WATCHED;
  const huntOver = (player) => progress(player) >= TAMAYU.DONE;

  function variant({ player, npcId }) {
    if (!IDS.has(npcId)) return null;
    t.lastUsedItem.delete(player);
    const value = progress(player);
    if (t.stage(player) >= STAGE.COMPLETE && value >= TAMAYU.DONE) return value >= TAMAYU.CLAIMED ? VARIANT.STALL : VARIANT.REWARD;
    if (t.stage(player) < STAGE.STARTED) return null;
    if (value >= TAMAYU.DONE) return VARIANT.TRIUMPH;
    if (value >= TAMAYU.WATCHED) return VARIANT.LATER;
    if (value >= TAMAYU.MET) return VARIANT.AGAIN;
    t.setState(player, KEY.TAMAYU, TAMAYU.MET);
    return VARIANT.FIRST;
  }

  function condition({ player, stepId }) {
    const item = used(player);
    const doses = POTIONS.get(item) ?? 0;
    if (DOSE_CONDITIONS.has(stepId)) return doses === DOSE_CONDITIONS.get(stepId);
    switch (stepId) {
      case MONKEY_TOO_EARLY: return (item === ITEM.MONKEY_CORPSE || item === ITEM.STUFFED_MONKEY) && !huntOver(player);
      // A partial potion before the spear has the Wiki's "beginning to match" lines; a full one (and any after
      // the spear) the dose branches, as both captures hand a four-dose one first.
      case POTION_BEFORE_SPEAR: return doses > 0 && doses < 4 && !(flags(player) & 1) && watched(player);
      case POTION_AFTER_SPEAR: return doses > 0 && watched(player);
      case NOT_FOUR_DOSES: return doses > 0 && doses < 4;
      case NEXT_BATTLE: return false;
      case SPEAR_USED: return isSpear(item) && watched(player) && !huntOver(player);
      // The outcome branches are the hunt's, played once it ends (see hunt()).
      case SPEAR_HUNT: case AGILE_HUNT: case POISON_HUNT: case WINNING_HUNT: return false;
      case MONKEY_USED: return (item === ITEM.MONKEY_CORPSE || item === ITEM.STUFFED_MONKEY) && huntOver(player);
      default: return null;
    }
  }

  function drinkPotion(player) {
    const item = used(player);
    const doses = POTIONS.get(item) ?? 0;
    if (!doses || !t.held(player, item)) return 0;
    t.take(player, item);
    t.setState(player, KEY.AGILITY, Math.min(4, agility(player) + doses));
    return item;
  }

  /** The partial potion before the spear is taken as its branch is chosen; it has no box. */
  function chosen({ player, stepId }) {
    if (stepId === POTION_BEFORE_SPEAR) drinkPotion(player);
  }

  function line(event) {
    const { player, npcId, text } = event;
    if (!IDS.has(npcId) || !t.isPage(event)) return;
    // Both captures hand a four-dose potion before any spear: the player says only "I've noticed you
    // commenting on the Shaikahan's agility. Try drinking this potion." (local 1001562 tick 7155).
    if (text === MORE_POTION && !(flags(player) & 1)) event.skip = true;
    if (text === JOIN) {
      event.after = () => {
        player.getPacketSender().sendInterfaceRemoval();
        hunt(player, event.npc, null);
      };
    }
  }

  function action(event) {
    const { player, stepId, npc } = event;
    if (!player || !stepId) return;
    if (POTION_BOXES.has(stepId)) {
      const item = drinkPotion(player);
      if (item) event.box = { items: [item] };
      return;
    }
    if (stepId === SPEAR_BOX) {
      const item = used(player);
      if (!isSpear(item) || !t.held(player, item)) return;
      t.take(player, item);
      t.setState(player, KEY.SPEAR, spearFlags(item));
      event.box = { items: [item] };
      return;
    }
    if (stepId === WATCH_HUNT) {
      // "Lead the way.": the hunt, then his lines once the player is back (local 1001562 tick 7122).
      event.wait = (resume) => playHunt(player, false, () => {
        t.raise(player, KEY.TAMAYU, TAMAYU.WATCHED);
        resume();
      });
      return;
    }
    if (HUNT_ACTIONS.has(stepId)) {
      event.handled = true;
      return;
    }
    if (stepId === CORPSE_BOX) {
      const item = used(player);
      if (item !== ITEM.MONKEY_CORPSE && item !== ITEM.STUFFED_MONKEY) return;
      t.take(player, item);
      if (item === ITEM.STUFFED_MONKEY) t.give(player, ITEM.SEAWEED);
      event.box = { items: [ITEM.MONKEY_CORPSE] };
      event.after = () => t.later(player, 1, () => t.npcAnimation(npc, SKINNING));
      return;
    }
    if (stepId === SKIN_BOX) {
      event.box = { items: [ITEM.MONKEY_SKIN], delayTicks: 4 };
      t.giveLater(player, 4, () => {
        t.give(player, ITEM.MONKEY_SKIN);
        t.give(player, ITEM.MONKEY_BONES);
      });
      t.lastUsedItem.delete(player);
      return;
    }
    if (stepId === SKIN) {
      event.handled = true; // came with the box
      return;
    }
    if (stepId === TRAINS) {
      event.box = { statement: true };
      return;
    }
    if (stepId === FIGHTING_XP) {
      // The spear first: a level-up's pop-up would end the talk before its own step.
      if (claimSpear(player)) {
        t.addXp(player, Skill.ATTACK, 2500);
        t.addXp(player, Skill.STRENGTH, 2500);
      }
      event.handled = true;
      return;
    }
    if (stepId === SPEAR_REWARD_BOX) {
      claimSpear(player);
      event.box = { items: [ITEM.RUNE_SPEAR_KP] };
      return;
    }
    if (stepId === SPEAR_REWARD) event.handled = true;
  }

  /** Tamayu's spear, once (BarbarianTraining.plugin.js reads the claimed stage). */
  function claimSpear(player) {
    if (progress(player) >= TAMAYU.CLAIMED) return false;
    t.give(player, ITEM.RUNE_SPEAR_KP);
    t.setState(player, KEY.TAMAYU, TAMAYU.CLAIMED);
    return true;
  }

  /** "Take me on your next hunt": the outcome his spear and doses give, then what he says of it. */
  function hunt(player, npc) {
    const bits = flags(player);
    const agile = agility(player) >= 4;
    if ((bits & 4) && agile) {
      playHunt(player, true, () => {
        t.raise(player, KEY.TAMAYU, TAMAYU.DONE);
        t.updateBrothers(player);
      });
      return;
    }
    const outcome = (bits & 2) && agile ? POISON_HUNT
      : (bits & 1) && agile ? AGILE_HUNT
        : bits & 1 ? SPEAR_HUNT
          : agility(player) > 0 ? NEXT_BATTLE
            : null;
    playHunt(player, false, () => {
      const lines = outcome
        ? t.findStep((step) => step?.id === outcome)?.steps
        : t.findStep((step) => step?.text === "Yes" && step.steps?.some((inner) => inner?.id === WATCH_HUNT))?.steps;
      const spoken = (lines ?? []).filter((step) => step?.type === "line");
      if (spoken.length) t.play(player, NPC.TAMAYU[0], VARIANT.USED, () => spoken, npc);
    });
  }

  function playHunt(player, victory, onEnd) {
    if (Scenes.get(player)) return;
    returnTiles.set(player, player.getLocation().clone());
    const scene = Scenes.open(player, "tbwt-hunt", ARENA);
    Scenes.controls(player, true, true);
    player.moveTo(PLAYER_TILE);
    const tamayu = Scenes.actor(scene, NPC.HUNT_TAMAYU, [2523, 4567, 0], [2524, 4567]);
    const beast = Scenes.actor(scene, NPC.HUNT_SHAIKAHAN, [2524, 4567, 0], [2523, 4567]);
    const cameraTicks = victory ? [2, 5, 8, 11] : [1, 5, 9, 13, 17, 21];
    cameraTicks.forEach((tick, index) => Scenes.later(scene, tick, () => Scenes.camera(player, CAMERA[index], LOOK, RATES)));
    const ticks = victory ? WIN.ticks : WATCH_TICKS;
    let victor = null;
    if (victory) {
      Scenes.later(scene, WIN.at, () => {
        player.moveTo(WIN.player);
        victor = Scenes.actor(scene, NPC.HUNT_TAMAYU_VICTOR, WIN.tamayu, [2540, 4566]);
        Scenes.actor(scene, NPC.HUNT_SHAIKAHAN, [2540, 4566, 0], [2541, 4565]);
        Scenes.camera(player, WIN.camera, WIN.look, RATES);
      });
      Scenes.later(scene, WIN.firstSay, () => victor?.forceChat?.("The end approaches, Shaikahan!"));
      Scenes.later(scene, WIN.secondSay, () => {
        victor?.forceChat?.("Gods! Witness this triumph!");
        player.getPacketSender().sendJingle(WIN_JINGLE, 0);
      });
    }
    for (let tick = 1; tick < ticks; tick += 3) {
      Scenes.later(scene, tick, () => {
        const strike = tick % 6 === 1;
        tamayu?.performAnimation?.(new Animation(strike ? SPEAR_BLOCK : SPEAR_SPIKE));
        victor?.performAnimation?.(new Animation(SPEAR_SPIKE));
        beast?.performAnimation?.(new Animation(strike ? BEAST_ATTACK : BEAST_BLOCK));
      });
    }
    Scenes.later(scene, ticks, () => {
      const back = returnTiles.get(player);
      Scenes.end(player);
      if (back) player.moveTo(back);
      returnTiles.delete(player);
      onEnd?.();
    });
  }

  function useOn(event) {
    const { player, itemId } = event;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (!IDS.has(npcId) || t.stage(player) < STAGE.STARTED) return;
    const npc = event.npc ?? event.target ?? null;
    if (itemId === ITEM.MONKEY_CORPSE || itemId === ITEM.STUFFED_MONKEY) {
      t.lastUsedItem.set(player, itemId);
      if (huntOver(player)) {
        // The skinning sits behind the Wiki's "end" in the triumph talk: play its condition alone.
        t.play(player, npcId, VARIANT.TRIUMPH, (steps) => steps.filter((step) => step?.type === "condition"), npc);
      } else {
        t.play(player, npcId, VARIANT.USED, undefined, npc);
      }
      event.handled = true;
      return;
    }
    if (huntOver(player) || !watched(player) || (!POTIONS.has(itemId) && !isSpear(itemId))) return;
    t.lastUsedItem.set(player, itemId);
    t.play(player, npcId, VARIANT.USED, undefined, npc);
    event.handled = true;
  }

  function logout({ player }) {
    if (!player || !Scenes.get(player)) return;
    Scenes.end(player, true);
    const back = returnTiles.get(player);
    if (back) player.moveTo(back);
    returnTiles.delete(player);
  }

  t.pauseAfter("Tamayu", READY, 4, ({ player, npc }) => t.npcAnimation(npc, DRINK), ({ player }) => POTIONS.has(used(player)));

  api.onNpcDialogueVariant(variant);
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:condition", chosen);
  api.onCustomEvent("npc-dialogue:line", line);
  api.onCustomEvent("npc-dialogue:action", action);
  api.onItemOnNpc(useOn);
  api.onPlayerLogout(logout);
  return { VARIANT, playHunt };
};
