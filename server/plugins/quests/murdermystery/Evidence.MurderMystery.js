/**
 * Murder Mystery's crime scene and evidence: the study window's thread, the criminal's dagger and the
 * pungent pot, the suspects' barrels, the flypaper sacks, the guard dog's gate, the kitchen's barrel
 * of flour, and the flour, flypaper and fingerprint recipes. The words are the Wiki's (Transcript:Murder
 * Mystery); what happens when, and to which inventory slot, is the four captures'
 * (docs/quests/murder-mystery/README.md):
 *
 * - The window: the box, then "You take the thread." and the thread when it is continued (t928-929).
 * - The dagger and the pot: taken into the inventory with their box, the ground item staying (t1048,
 *   t1050: no obj_del); a second Take says "I already have the murder weapon." (t1053).
 * - A barrel: its box, and the silver belonging once it is continued (t1468-1469).
 * - The sacks: the box, the menu, and the flypaper with "You take a piece of fly paper." (t1645-1646).
 * - Flour on evidence: the dusted item takes the lower of the two slots and the empty pot the higher
 *   (t1562, t1580; 1001958 t1660, the flour in the higher slot). Flypaper on dusted evidence: the clean item and then the print go into the first free slots
 *   once the flypaper and the dusted item are gone (t1566, t1649). A print that does not match is
 *   destroyed when its box is continued (t1666-1668); the match turns the unknown print into the
 *   killer's print in its slot and keeps the suspect's (t1715).
 * - The gate: its box during the quest and after it (t913, t2355).
 *
 * - After the quest the barrels and sacks ask for the guards' permission, as before it (the Wiki: the
 *   belongings "cannot be obtained again"; Ours for the sacks); the gate keeps its box (t2355).
 *
 * Ours: a full inventory gets what does not fit on the floor (the Wiki says so of the thread only);
 * flour on the pungent pot keeps the flour (the Wiki gives only the two lines); the dagger and pot
 * before the quest is started take as they do during it.
 */
module.exports = function attachMurderMysteryEvidence(api, ctx) {
  const { Item, ItemIdentifiers: I, Location } = api.core;
  const { STAGES, ATTRIBUTES, EVIDENCE, SUSPECTS, LOCS, STEPS } = require("./State.MurderMystery");

  const THREADS = new Set([I.CRIMINALS_THREAD, I.CRIMINALS_THREAD_2, I.CRIMINALS_THREAD_3]);
  const THREAD_COLOUR = new Map([[I.CRIMINALS_THREAD, "red"], [I.CRIMINALS_THREAD_2, "green"], [I.CRIMINALS_THREAD_3, "blue"]]);
  const DAGGERS = [I.CRIMINALS_DAGGER, I.CRIMINALS_DAGGER_2];
  const SCENE_ITEMS = new Map([
    [I.CRIMINALS_DAGGER, { variant: "getting-started-take-criminal-s-dagger", held: DAGGERS }],
    [I.PUNGENT_POT, { variant: "getting-started-take-pungent-pot", held: [I.PUNGENT_POT] }],
  ]);
  const SCENE_ITEM_BY_VARIANT = new Map([...SCENE_ITEMS].map(([itemId, item]) => [item.variant, itemId]));

  /** The evidence the flour and flypaper work on: the suspects' silver belongings and the crime scene's two. */
  const EVIDENCE_ITEMS = [
    ...SUSPECTS.map((suspect) => ({
      slug: suspect.item.toLowerCase().replace(/_/g, "-"), original: I[suspect.item], dusted: I[`${suspect.item}_2`], suspect,
    })),
    { slug: "criminal-s-dagger", original: I.CRIMINALS_DAGGER, dusted: I.CRIMINALS_DAGGER_2, suspect: null },
  ];
  const BY_ORIGINAL = new Map(EVIDENCE_ITEMS.map((entry) => [entry.original, entry]));
  const BY_DUSTED = new Map(EVIDENCE_ITEMS.map((entry) => [entry.dusted, entry]));
  const BY_PRINT = new Map(SUSPECTS.map((suspect) => [I[suspect.print], suspect]));
  const FLOUR_EVIDENCE_POTS = new Set([I.SILVER_POT, I.SILVER_POT_2, I.PUNGENT_POT]);

  /** The thread a full inventory dropped: picking it up names its colour (the conversation's "For <colour> thread:"). */
  const groundThread = new WeakMap();
  /** Whether the player had an empty pot when they took from the barrel of flour (before it was filled). */
  const hadPot = new WeakMap();

  const inventory = (player) => player.getInventory();
  const has = (player, ids) => ids.some((id) => inventory(player).getAmount(id) > 0);
  const give = (player, itemId) => inventory(player).forceAdd(player, new Item(itemId, 1));
  const slotOf = (player, itemId, preferred) => (inventory(player).getSlot(preferred) === itemId ? preferred
    : inventory(player).getSlotForItemId(itemId));

  // ---- The window ----------------------------------------------------------------------------

  function handleWindow(event) {
    if (event.objectId !== LOCS.WINDOW) return;
    const { player } = event;
    const stage = ctx.stage(player);
    // King's Ransom has the window after this quest (its own stages from 1).
    if (stage >= STAGES.COMPLETE) return;
    const option = String(event.option ?? event.definition?.getActions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    const breaking = option === "break" || (!option && event.clickType === 3);
    if (stage < STAGES.STARTED) ctx.play(player, "before-starting-investigating-the-smashed-window");
    else if (breaking) ctx.play(player, "getting-started-breaking-the-smashed-window");
    else if ((ctx.attr(player, ATTRIBUTES.EVIDENCE) & EVIDENCE.THREAD) === 0) ctx.play(player, "getting-started-investigating-the-smashed-window");
    else ctx.play(player, "getting-started-investigating-the-smashed-window-again");
    event.handled = true;
  }

  /** "You take the thread." and "Lucky for you there's some thread left.": the thread, dropped when the bag is full. */
  function giveThread(player) {
    ctx.setAttr(player, ATTRIBUTES.EVIDENCE, ctx.attr(player, ATTRIBUTES.EVIDENCE) | EVIDENCE.THREAD);
    give(player, ctx.murderer(player).thread);
  }

  /** "Picking up thread from the ground": the box for its colour, and the thread stays where it is. */
  function pickUpThread(event) {
    if (!THREADS.has(event.groundItemId)) return;
    groundThread.set(event.player, THREAD_COLOUR.get(event.groundItemId));
    ctx.play(event.player, "getting-started-picking-up-thread-from-the-ground");
    event.handled = true;
  }

  // ---- The dagger and the pot ----------------------------------------------------------------

  function pickUpSceneItem(event) {
    const item = SCENE_ITEMS.get(event.groundItemId);
    if (!item) return;
    const { player } = event;
    // A full bag takes nothing: the core refuses it as for any other item. The item comes with its box.
    if (!has(player, item.held) && inventory(player).isFull()) return;
    // No reach and no sound; the player turns to the item's tile (t1048, t1050).
    player.setPositionToFace(new Location(event.location.x, event.location.y, event.location.z));
    ctx.play(player, item.variant);
    event.handled = true;
  }

  function handlePickup(event) {
    pickUpThread(event);
    if (!event.handled) pickUpSceneItem(event);
  }

  // ---- Barrels, sacks, gate ------------------------------------------------------------------

  function suspectOfBarrel(event) {
    const name = String(event.definition?.getName?.() ?? "");
    return SUSPECTS.find((suspect) => name === `${suspect.name}'s barrel`) ?? null;
  }

  function searchBarrel(event) {
    const suspect = suspectOfBarrel(event);
    if (!suspect) return false;
    const { player } = event;
    // After the quest too: the Wiki's belongings "cannot be obtained again after the quest is finished".
    if (ctx.stage(player) !== STAGES.STARTED) ctx.play(player, "before-starting-investigating-the-gate-sacks-drain-or-barrels");
    else ctx.play(player, `gathering-suspect-evidence-searching-barrels-${suspect.fragment}-s-barrel`);
    return true;
  }

  function investigateSacks(event) {
    if (event.objectId !== LOCS.SACKS) return false;
    const { player } = event;
    if (ctx.stage(player) !== STAGES.STARTED) ctx.play(player, "before-starting-investigating-the-gate-sacks-drain-or-barrels");
    else ctx.play(player, "gathering-suspect-evidence-searching-the-sacks");
    return true;
  }

  function investigateGate(event) {
    if (!LOCS.GATES.includes(event.objectId)) return false;
    const { player } = event;
    if (ctx.stage(player) < STAGES.STARTED) ctx.play(player, "before-starting-investigating-the-gate-sacks-drain-or-barrels");
    else ctx.play(player, "getting-started-investigate-sturdy-wooden-gate");
    return true;
  }

  // ---- The barrel of flour (rsprox captures 1001551, 1001930, 1001958 and the quest's) --------

  function fillPotWithFlour(player, slot) {
    const potSlot = slot >= 0 && inventory(player).getSlot(slot) === I.POT ? slot : inventory(player).getSlotForItemId(I.POT);
    inventory(player).setItem(potSlot, new Item(I.POT_OF_FLOUR, 1)).refreshItems();
  }

  /** Take-from: the barrel's line, then flour for an empty pot or "You need something to put the flour in." */
  function takeFlour(event) {
    if (event.objectId !== LOCS.FLOUR_BARREL) return false;
    const { player } = event;
    hadPot.set(player, has(player, [I.POT]));
    if (hadPot.get(player)) fillPotWithFlour(player, -1);
    ctx.play(player, "gathering-suspect-evidence-flour-barrel-taking-from-the-flour-barrel");
    return true;
  }

  function useOnFlourBarrel(event) {
    if (event.objectId !== LOCS.FLOUR_BARREL) return;
    if (FLOUR_EVIDENCE_POTS.has(event.itemId)) {
      ctx.play(event.player, "gathering-suspect-evidence-flour-barrel-using-silver-pot-or-pungent-pot-on-flour-barrel");
    } else if (event.itemId === I.POT) {
      fillPotWithFlour(event.player, event.itemSlot);
      ctx.play(event.player, "gathering-suspect-evidence-flour-barrel-using-empty-pot-on-flour-barrel");
    } else {
      return;
    }
    event.handled = true;
  }

  // ---- Flour, flypaper and prints -------------------------------------------------------------

  /** The two items of a use, as [the one matching `test`, its slot, the other's slot], either way round. */
  function pair(event, test, other) {
    const { usedItemId: a, usedItemSlot: aSlot, usedWithItemId: b, usedWithItemSlot: bSlot } = event;
    if (test(a) && other(b)) return [a, aSlot, bSlot];
    if (test(b) && other(a)) return [b, bSlot, aSlot];
    return null;
  }

  function dust(event) {
    const { player } = event;
    const used = pair(event, (id) => BY_ORIGINAL.has(id) || id === I.PUNGENT_POT, (id) => id === I.POT_OF_FLOUR);
    if (!used) return false;
    const [itemId, itemSlot, flourSlot] = used;
    if (itemId === I.PUNGENT_POT) {
      ctx.play(player, "gathering-suspect-evidence-using-flour-on-evidence-pungent-pot");
      return true;
    }
    const entry = BY_ORIGINAL.get(itemId);
    const bag = inventory(player);
    const flour = slotOf(player, I.POT_OF_FLOUR, flourSlot);
    const evidence = slotOf(player, itemId, itemSlot);
    // The dusted item takes the lower of the two slots, the empty pot the higher, whichever was used on which.
    bag.setItem(Math.min(flour, evidence), new Item(entry.dusted, 1));
    bag.setItem(Math.max(flour, evidence), new Item(I.POT, 1));
    bag.refreshItems();
    ctx.play(player, `gathering-suspect-evidence-using-flour-on-evidence-${entry.slug}`);
    return true;
  }

  function liftPrint(event) {
    const { player } = event;
    const used = pair(event, (id) => BY_DUSTED.has(id), (id) => id === I.FLYPAPER);
    if (!used) return false;
    const entry = BY_DUSTED.get(used[0]);
    const bag = inventory(player);
    bag.deleteNumber(I.FLYPAPER, 1);
    bag.deleteNumber(entry.dusted, 1);
    bag.adds(entry.original, 1);
    bag.adds(entry.suspect ? I[entry.suspect.print] : I.UNKNOWN_PRINT, 1);
    ctx.play(player, `gathering-suspect-evidence-using-flypaper-on-floured-silver-items-${entry.slug}-dusted`);
    return true;
  }

  function comparePrints(event) {
    const { player } = event;
    const used = pair(event, (id) => BY_PRINT.has(id), (id) => id === I.UNKNOWN_PRINT);
    if (!used) return false;
    const suspect = BY_PRINT.get(used[0]);
    if (ctx.murderer(player).id === suspect.id) {
      const bag = inventory(player);
      bag.setItem(slotOf(player, I.UNKNOWN_PRINT, used[2]), new Item(I.KILLERS_PRINT, 1)).refreshItems();
      ctx.setAttr(player, ATTRIBUTES.EVIDENCE, ctx.attr(player, ATTRIBUTES.EVIDENCE) | EVIDENCE.FINGERPRINTS);
    }
    ctx.play(player, `gathering-suspect-evidence-comparing-fingerprints-using-${suspect.fragment}-s-print-on-unknown-print`);
    return true;
  }

  function handleItemOnItem(event) {
    if (dust(event) || liftPrint(event) || comparePrints(event)) event.handled = true;
  }

  // ---- The conversation's own moments ---------------------------------------------------------

  /** A message step of one of this unit's variants: hand out or take what goes with it. */
  function onMessage(event, variant) {
    const { player, stepId } = event;
    if (stepId === STEPS.TAKE_THREAD || stepId === STEPS.THREAD_LEFT) {
      // With the line, as "You take the thread." comes once the box is continued (t929).
      if (stepId === STEPS.THREAD_LEFT) event.after = () => giveThread(player);
      else giveThread(player);
      return;
    }
    if (stepId === STEPS.FLYPAPER) {
      give(player, I.FLYPAPER);
      return;
    }
    if (event.box?.statement !== true) return;
    // The dagger and the pot come into the inventory with their box (t1048, t1050).
    if (SCENE_ITEM_BY_VARIANT.has(variant)) {
      give(player, SCENE_ITEM_BY_VARIANT.get(variant));
      return;
    }
    const barrel = /^gathering-suspect-evidence-searching-barrels-(\w+)-s-barrel$/.exec(variant);
    if (barrel) {
      const suspect = SUSPECTS.find((entry) => entry.fragment === barrel[1]);
      event.after = () => give(player, I[suspect.item]);
      return;
    }
    const compared = /^gathering-suspect-evidence-comparing-fingerprints-using-(\w+)-s-print-on-unknown-print$/.exec(variant);
    if (compared) {
      const suspect = SUSPECTS.find((entry) => entry.fragment === compared[1]);
      // "You destroy the useless fingerprint.": gone once the box is continued (t1666-1668).
      event.after = () => inventory(player).deleteNumber(I[suspect.print], 1);
    }
  }

  /** The conditions this unit's variants ask, by their lower-cased text; null for any other. */
  function answer(player, value) {
    if (value.startsWith("if the player already has the criminal's dagger")) return has(player, DAGGERS);
    if (value.startsWith("if the player already has the pungent pot")) return has(player, [I.PUNGENT_POT]);
    const belonging = /^if the player already has the silver (necklace|cup|bottle|book|needle|pot)/.exec(value);
    if (belonging) {
      const entry = EVIDENCE_ITEMS.find((candidate) => candidate.slug === `silver-${belonging[1]}`);
      return has(player, [entry.original, entry.dusted]);
    }
    const holding = has(player, [...THREADS]);
    if (value.startsWith("if the player lost the thread")) return !holding;
    if (value.startsWith("if the player is still holding the thread")) return holding;
    if (value.startsWith("if the player has the criminal's thread")) return holding;
    const ground = /^for (red|green|blue) thread/.exec(value);
    if (ground) return groundThread.get(player) === ground[1];
    if (value.startsWith("if the player does not have an empty pot")) return hadPot.get(player) !== true;
    if (value.startsWith("if the player has an empty pot")) return hadPot.get(player) === true;
    return null;
  }

  api.onObjectInteraction(handleWindow);
  api.onGroundItemPickup(handlePickup);
  api.onObjectInteraction("Anna's barrel", { Search: searchBarrel });
  api.onObjectInteraction("Bob's barrel", { Search: searchBarrel });
  api.onObjectInteraction("Carol's barrel", { Search: searchBarrel });
  api.onObjectInteraction("David's barrel", { Search: searchBarrel });
  api.onObjectInteraction("Elizabeth's barrel", { Search: searchBarrel });
  api.onObjectInteraction("Frank's barrel", { Search: searchBarrel });
  api.onObjectInteraction("Sacks", { Investigate: investigateSacks });
  api.onObjectInteraction("Sturdy wooden gate", { Investigate: investigateGate });
  api.onObjectInteraction("Barrel of flour", { "Take-from": takeFlour });
  api.onItemOnObject(useOnFlourBarrel, { noted: false });
  api.onItemOnItem(handleItemOnItem);

  return { onMessage, answer };
};
