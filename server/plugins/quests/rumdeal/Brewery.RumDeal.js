/**
 * The brewery's machines and the island's quest spots, as the revision 242 capture plays them
 * (RumDeal.bin; docs/quests/rum-deal/README.md "The brewery"):
 *
 * - The intake hopper (10170): the stage moves as the item goes in; a tick later the Wiki's message,
 *   seq 827 and sound 1764 (blindweed 1267-1268, fever spider body 2511-2512), or seq 2283 and sound
 *   2134 with the bucket handed back (stagnant water 1665-1666).
 * - The pressure barrel (10171): each creature with seq 832 and sound 1765, deal_barrel (1354) counting
 *   them and deal_slug / deal_thulhu (1357/1358) each kind; Count reads them out (1964-2002).
 * - The lever (multiloc 10164 on 1354): five creatures, then the message with sound 1763, the three
 *   varbits back to 0, and 2 ticks later stage 12 with deal_multi_hopper (1355) = 1 (2008-2010).
 * - The brewing controls (multiloc 10104 on 1355): the plain wrench's two messages two ticks apart with
 *   "Come out and face me!" (2238-2240); the holy wrench's seq 2810, sound 1766 and overhead, then two
 *   ticks later the Evil Spirit (2143,5097,1) with a hint arrow and sound 1762 (2314-2316). Its death
 *   sets stage 14 and 1355 back to 0 (2382).
 * - The squid spot (635): one catch a click, the message, seq 2813 and sound 2600 at once and the catch
 *   4 ticks later, with no Fishing XP (1800-1854).
 */
const { STAGES, VARBITS, ATTRIBUTES, NPCS, TILES } = require("./State.RumDeal");

const HOPPER = 10170;
const BARREL = 10171;
const LEVER_IDS = new Set([10164, 10165, 10166]);
const CONTROL_IDS = new Set([10104, 10142, 10143, 10144]);
const STAGNANT_LAKE = 10105;
const OUTPUT_TAP = 10148;

const STUFF_ANIMATION = 827;
const STUFF_SOUND = 1764;
const POUR_ANIMATION = 2283;
const POUR_SOUND = 2134;
const BARREL_ANIMATION = 832;
const BARREL_SOUND = 1765;
const PRESSURISE_SOUND = 1763;
const SMITE_ANIMATION = 2810;
const SMITE_SOUND = 1766;
const SPIRIT_SOUND = 1762;
const FILL_BUCKET_ANIMATION = 2812;
const FISH_ANIMATION = 2813;
const FISH_SOUND = 2600;
const FISH_TICKS = 4;
const CREATURES = 5;

module.exports = function rumDealBrewery(api, ctx) {
  const { Animation, CountdownTask, ItemIdentifiers, Location, Skill, TaskManager } = api.core;
  const I = ItemIdentifiers;
  const spirits = new Map();
  const fishing = new Map();

  const quest = () => ctx.quest();
  const stage = (player) => quest().getStage(player);
  const later = (player, ticks, run) => TaskManager.submit(new CountdownTask(player, ticks, () => { if (player.isRegistered?.()) run(); }));
  const effect = (player, animation, sound) => {
    player.performAnimation(new Animation(animation));
    player.getPacketSender().sendSound(sound, 1, 0);
  };

  // ------------------------------------------------------------------ the intake hopper

  function hopper(event) {
    const { player, itemId } = event;
    const at = stage(player);
    const into = (from, to, message, animation, sound, swap) => {
      event.handled = true;
      player.getInventory().deleteNumber(from, 1);
      if (swap) player.getInventory().adds(swap, 1);
      quest().setStage(player, to);
      later(player, 1, () => {
        player.sendMessage(message);
        effect(player, animation, sound);
      });
    };
    if (itemId === I.BLINDWEED && at === STAGES.SHOWN_BLINDWEED) {
      into(I.BLINDWEED, STAGES.BLINDWEED_ADDED, "You stuff the Blindweed into the Hopper.", STUFF_ANIMATION, STUFF_SOUND);
    } else if (itemId === I.BUCKET_OF_WATER_3 && at === STAGES.COLLECTED_WATER) {
      into(I.BUCKET_OF_WATER_3, STAGES.WATER_ADDED, "You dump the water into the hopper.", POUR_ANIMATION, POUR_SOUND, I.BUCKET);
    } else if (itemId === I.FEVER_SPIDER_BODY && at === STAGES.KILL_SPIDER) {
      into(I.FEVER_SPIDER_BODY, STAGES.SPIDER_ADDED, "You cram the diseased Fever Spider body into the hopper.", STUFF_ANIMATION, STUFF_SOUND);
    } else if (at >= STAGES.STARTED && !quest().isComplete(player)) {
      event.handled = true;
      player.sendMessage("Nothing interesting happens.");
    }
  }

  // ------------------------------------------------------------------ the pressure barrel and lever

  const count = (player, key) => Number(player.getAttribute(key)) || 0;

  function showBarrel(player) {
    const slugs = count(player, ATTRIBUTES.SLUGLINGS);
    const karam = count(player, ATTRIBUTES.KARAMTHULHU);
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBITS.BARREL, Math.min(CREATURES, slugs + karam));
    sender.sendVarbit(VARBITS.SLUG, slugs);
    sender.sendVarbit(VARBITS.THULHU, karam);
  }

  function stuffBarrel(event) {
    const { player, itemId } = event;
    if (itemId !== I.SLUGLINGS && itemId !== I.KARAMTHULHU) return;
    event.handled = true;
    if (stage(player) !== STAGES.CATCH_CREATURES) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    const slugs = count(player, ATTRIBUTES.SLUGLINGS);
    const karam = count(player, ATTRIBUTES.KARAMTHULHU);
    if (slugs + karam >= CREATURES) {
      player.sendMessage("You don't think you can stuff any more Sluglings in there.");
      return;
    }
    player.getInventory().deleteNumber(itemId, 1);
    if (itemId === I.SLUGLINGS) player.setAttribute(ATTRIBUTES.SLUGLINGS, slugs + 1);
    else player.setAttribute(ATTRIBUTES.KARAMTHULHU, karam + 1);
    showBarrel(player);
    // The Wiki's words; the capture sends "Karamthulhu" (recorded difference).
    player.sendMessage(itemId === I.SLUGLINGS
      ? "You stuff the squirming Sluglings into the barrel."
      : "You stuff the squirming Karamthultu into the barrel.");
    effect(player, BARREL_ANIMATION, BARREL_SOUND);
  }

  /** Count: the capture's (ticks 1966, 1977, 1988, 2002) and recording 3031's empty barrel. */
  function countBarrel(event) {
    const { player } = event;
    event.handled = true;
    const slugs = count(player, ATTRIBUTES.SLUGLINGS);
    const karam = count(player, ATTRIBUTES.KARAMTHULHU);
    if (slugs + karam === 0) player.sendMessage("This barrel is empty and smells nasty.");
    else if (slugs === 1 && karam === 0) player.sendMessage("There are some Sluglings in this barrel.");
    else player.sendMessage(`There are ${slugs} loads of Sluglings and ${karam} Karamthulhu in this barrel.`);
  }

  function pullLever(event) {
    const { player } = event;
    event.handled = true;
    if (stage(player) !== STAGES.CATCH_CREATURES) return;
    if (count(player, ATTRIBUTES.SLUGLINGS) + count(player, ATTRIBUTES.KARAMTHULHU) < CREATURES) {
      player.sendMessage("You do not yet have five sea creatures in the barrel!");
      return;
    }
    player.setAttribute(ATTRIBUTES.SLUGLINGS, 0);
    player.setAttribute(ATTRIBUTES.KARAMTHULHU, 0);
    // Keep the debit recoverable if a save/disconnect interrupts the presentation delay.
    player.setAttribute(ATTRIBUTES.PRESSURISING, 1);
    showBarrel(player);
    // The Wiki's words; the capture sends "assorted" (recorded difference).
    player.sendMessage("You pressurise the asserted sea creatures.");
    player.getPacketSender().sendSound(PRESSURISE_SOUND, 1, 0);
    ctx.hold(player, 2);
    later(player, 2, () => finishPressurising(player));
  }

  /** A saved in-flight debit settles at login; connected players keep the captured two-tick delay. */
  function finishPressurising(player) {
    if (Number(player.getAttribute(ATTRIBUTES.PRESSURISING)) !== 1) return;
    player.setAttribute(ATTRIBUTES.PRESSURISING, 0);
    if (stage(player) !== STAGES.CATCH_CREATURES) return;
    quest().setStage(player, STAGES.PRESSURISED);
    ctx.syncVarbits(player);
  }

  // ------------------------------------------------------------------ the brewing controls and the Evil Spirit

  function smiteControls(event) {
    const { player, itemId } = event;
    if (itemId !== I.WRENCH && itemId !== I.HOLY_WRENCH) return;
    event.handled = true;
    if (stage(player) !== STAGES.BLESS_WRENCH) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    if (itemId === I.WRENCH) {
      player.sendMessage("You try and force the Evil Spirit from the controls with the wrench!");
      player.forceChat("Come out and face me!");
      ctx.hold(player, 2);
      later(player, 2, () => player.sendMessage("Well, it seems that this wrench is just not holy enough to work. You should go and get it blessed."));
      return;
    }
    if (spirits.has(player) || Number(player.getAttribute(ATTRIBUTES.SPIRIT)) === 1) {
      player.sendMessage("The Evil Spirit has already manifested!");
      return;
    }
    player.setAttribute(ATTRIBUTES.SPIRIT, 1);
    player.sendMessage("You raise your wrench on high and smite the controls mightily!");
    player.performAnimation(new Animation(SMITE_ANIMATION));
    player.forceChat("The power of Guthix compels you!");
    player.getPacketSender().sendSound(SMITE_SOUND, 1, 0);
    ctx.hold(player, 2);
    later(player, 2, () => {
      if (stage(player) !== STAGES.BLESS_WRENCH) return;
      player.sendMessage("The Evil Spirit is forced from the controls!");
      player.getPacketSender().sendSound(SPIRIT_SOUND, 1, 0);
      const [x, y, z] = TILES.SPIRIT;
      const spirit = api.spawnNpc({ id: NPCS.EVIL_SPIRIT, x, y, z, owner: player, ownerOnly: true });
      if (!spirit) {
        player.setAttribute(ATTRIBUTES.SPIRIT, 0);
        return;
      }
      spirit.__skipDefaultRespawn = true;
      spirit.setPositionToFace(new Location(x, y + 1, z));
      spirits.set(player, spirit);
      player.getPacketSender().sendEntityHint(spirit);
      spirit.getCombat?.()?.attack?.(player);
    });
  }

  function clearSpirit(player) {
    const spirit = spirits.get(player);
    spirits.delete(player);
    if (spirit?.isRegistered?.()) api.removeNpc(spirit);
    if (Number(player.getAttribute(ATTRIBUTES.SPIRIT)) === 1) player.setAttribute(ATTRIBUTES.SPIRIT, 0);
    player.getPacketSender().clearHintArrow?.();
  }

  function spiritDied(killer, npc) {
    const owner = [...spirits.entries()].find(([, spirit]) => spirit === npc)?.[0] ?? killer;
    if (!owner) return;
    spirits.delete(owner);
    owner.setAttribute(ATTRIBUTES.SPIRIT, 0);
    owner.getPacketSender().clearHintArrow?.();
    if (stage(owner) !== STAGES.BLESS_WRENCH) return;
    quest().setStage(owner, STAGES.SPIRIT_BANISHED);
    ctx.syncVarbits(owner);
    owner.sendMessage("You have banished the Evil Spirit!");
  }

  // ------------------------------------------------------------------ the output tap and the stagnant lake

  /** Turn, or a bucket used on it (the capture fills one each way, ticks 2576-2579 and 2627). */
  function turnTap(event) {
    const { player } = event;
    event.handled = true;
    const at = stage(player);
    if (at >= STAGES.TOLD_DONNIE) {
      ctx.statement(player, "You thankfully have no need to do that any more.");
      return;
    }
    // The Wiki's "Nothing interesting happens." without a bucket; Ours: before the brew too.
    if (at !== STAGES.COLLECT_SWILL || !ctx.held(player, I.BUCKET)) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    player.getInventory().deleteNumber(I.BUCKET, 1);
    player.getInventory().adds(I.UNSANITARY_SWILL, 1);
    player.sendMessage("You carefully fill the bucket with the foul-smelling swill.");
  }

  function scoopLake(event) {
    const { player } = event;
    event.handled = true;
    if (stage(player) !== STAGES.FETCH_WATER) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    player.getInventory().deleteNumber(I.BUCKET, 1);
    player.getInventory().adds(I.BUCKET_OF_WATER_3, 1);
    quest().setStage(player, STAGES.COLLECTED_WATER);
    // The Wiki's words; the capture sends "a bucket of the stagnant water" (recorded difference).
    player.sendMessage("You scoop up a bucket of stagnant water.");
    player.performAnimation(new Animation(FILL_BUCKET_ANIMATION));
  }

  // ------------------------------------------------------------------ the squid fishing spot

  function fish(event) {
    const { player } = event;
    event.handled = true;
    const at = stage(player);
    if (at > STAGES.CATCH_CREATURES || quest().isComplete(player)) {
      player.sendMessage("You have no need to do that any more."); // recording 3034
      return;
    }
    if (!ctx.held(player, I.FISHBOWL_AND_NET)) {
      player.sendMessage("You do not have the correct equipment to fish here.");
      return;
    }
    if (ctx.level(player, Skill.FISHING) < 50) {
      // The Wiki's words: "Level 40", though the quest needs 50 Fishing.
      ctx.statement(player, "You must be a Level 40 Fisherman to fish here.");
      return;
    }
    if (!ctx.hasFreeSlot(player)) {
      player.sendMessage("You do not have any free space for anything that you will catch!");
      return;
    }
    if (fishing.has(player)) return;
    player.sendMessage("You dunk the bowl in the water...");
    player.performAnimation(new Animation(FISH_ANIMATION));
    player.getPacketSender().sendSound(FISH_SOUND, 1, 20);
    const position = player.getLocation().clone();
    const task = new CountdownTask(player, FISH_TICKS, () => {
      if (fishing.get(player) !== task) return;
      fishing.delete(player);
      if (!player.isRegistered?.() || player.getHitpoints() <= 0 || !player.getLocation().equals(position)) return;
      if (!ctx.held(player, I.FISHBOWL_AND_NET) || !ctx.hasFreeSlot(player)) return;
      // Ours: a third of the catches are a Karamthulhu (the capture's run: one in six).
      if (Math.random() < 1 / 3) {
        player.getInventory().adds(I.KARAMTHULHU, 1);
        player.sendMessage("...and you catch a Karamthulhu!");
      } else {
        player.getInventory().adds(I.SLUGLINGS, 1);
        player.sendMessage("...and you catch some Sluglings!");
      }
    });
    fishing.set(player, task);
    ctx.hold(player, FISH_TICKS);
    TaskManager.submit(task);
  }

  function stop(player) {
    clearSpirit(player);
    const task = fishing.get(player);
    if (task) task.stop();
    fishing.delete(player);
  }

  return {
    HOPPER, BARREL, LEVER_IDS, CONTROL_IDS, STAGNANT_LAKE, OUTPUT_TAP,
    hopper, stuffBarrel, countBarrel, pullLever, smiteControls, spiritDied, turnTap, scoopLake, fish,
    showBarrel, finishPressurising, stop,
  };
};
