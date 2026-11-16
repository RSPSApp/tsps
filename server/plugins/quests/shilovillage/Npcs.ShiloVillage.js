/**
 * Shilo Village's people, as the capture plays them (RSProx capture ShiloVillage, rev 242.1; ticks
 * are that recording's):
 * - Trufitus: before the quest, with the belt, "Greetings." and the Mosol Rei menu (t1643-1757); once
 *   greeted, without it, "Greetings once again Bwana," (t1771). The quest starts on the continue of his
 *   "adventuring." (t1926: varp 116 0 -> 1 and the belt taken), not on the Yes. His answer to "Erm, I
 *   don't know where to look?" is stage 2 (t1935). After the quest his Trufitus-page lines set 16 on
 *   the first talk and 17 on the second, on his line (t5788, t5794).
 * - Mosol Rei: holding the belt, or once the quest has started, "Hey there Bwana, have you delivered
 *   that Wampum Belt..." (t1460, t2104). Follow, his undead and the lead-in are Village's.
 * - Yanni Salika: Talk-to opens on One Small Favour's menu (t5497); its antiques, items-for-sale and
 *   not-interested options play his own page's branches. The quote counts the worn beads (t5627). Shown
 *   an antique he says his line, and on its continue the item goes, the coins come and "You sell the
 *   <name> for <N> gold." (t5598-5646).
 */
module.exports = function attachNpcs(api, sv) {
  const { STAGE, NPC, ITEM } = sv;
  const { Bank, Item } = api.core;
  const { startTranscript, questStartMessage } = require("../QuestRuntime");

  /** Greeted Trufitus with the belt: from then on, without it, he has "no more news" (t1771). */
  const GREETED_ATTRIBUTE = "shilo-village:trufitus-greeted";
  const PRISM_SOLD_ATTRIBUTE = "quest.shilo_village.prism_sold";

  /** Mosol Rei, his multiloc parent and his post-quest form (5340, 8695, 8696). */
  const MOSOL_IDS = new Set([NPC.MOSOL_REI, 8695, NPC.MOSOL_REI_COMPLETE]);
  const START_HOOK = "quest:shilo-village:start";
  /** The start lands on this line's continue (t1926). */
  const START_LINE = "adventuring.";
  /** Stage 2 lands on this answer's continue, with the next menu (t1935). */
  const TOLD_WHERE_LINE = "Hmm, that doesn't surprise me. The only information I have refers to its name. Ah Za Rhoon, its name means 'Magnificence Floating on Water'.";
  /** Trufitus after the quest: 16 with the first talk's line, 17 with the second's (t5788, t5794). */
  const AFTER_QUEST_LINES = new Map([
    ["Hello Bwana. I conclude that you have been successful. Mosol sent word that the village is clearing of zombies. You have done us all a great deed!", STAGE.TOLD_TRUFITUS],
    ["Hello again Bwana! Well Done again for helping to defeat Rashiliyia. Hopefully things will return to normal around here now.", STAGE.TOLD_TRUFITUS_AGAIN],
  ]);

  const TRUFITUS_ITEM_VARIANTS = new Map([
    [ITEM.WAMPUM_BELT, "starting-out-using-the-wampum-belt-on-trufitus"],
    [ITEM.ZADIMUS_CORPSE, "visiting-ah-za-rhoon-using-the-zadimus-corpse-on-trufitus"],
    [ITEM.STONE_PLAQUE, "visiting-ah-za-rhoon-using-the-stone-plaque-on-trufitus"],
    [ITEM.TATTERED_SCROLL, "visiting-ah-za-rhoon-using-the-tattered-scroll-on-trufitus"],
    [ITEM.CRUMPLED_SCROLL, "visiting-ah-za-rhoon-using-the-crumpled-scroll-on-trufitus"],
    [ITEM.BONE_SHARD, "visiting-ah-za-rhoon-using-the-bone-shard-on-trufitus"],
    [ITEM.SWORD_POMMEL, "visiting-the-tomb-of-bervirius-using-the-sword-pommel-on-trufitus"],
    [ITEM.BERVIRIUS_NOTES, "visiting-the-tomb-of-bervirius-using-bervirius-notes-on-trufitus"],
    [ITEM.BONE_BEADS, "visiting-the-tomb-of-bervirius-using-bone-beads-on-trufitus"],
    [ITEM.BEADS_OF_THE_DEAD, "visiting-the-tomb-of-bervirius-using-beads-of-the-dead-on-trufitus"],
    [ITEM.BONE_KEY, "visiting-the-tomb-of-bervirius-using-the-bone-key-on-trufitus"],
    [ITEM.RASHILIYIA_CORPSE, "visiting-the-tomb-of-rashiliyia-using-rashiliyias-remains-on-trufitus"],
  ]);
  for (const id of ITEM.LOCATING_CRYSTALS) {
    TRUFITUS_ITEM_VARIANTS.set(id, "visiting-the-tomb-of-bervirius-using-the-locating-crystal-on-trufitus");
  }
  const UNRELATED_ITEM_VARIANT = "starting-out-use-any-unrelated-item-on-trufitus";

  /**
   * What Yanni pays for the quest's leftovers (Wiki: Shilo Village rewards, Transcript:Yanni Salika), with the name
   * his "You sell the <name> for <N> gold." uses (t5598-5646; the stone-plaque's and prism's are ours: not sold in
   * the capture). The black prism waits for Yes.
   */
  const YANNI_SALES = new Map([
    [ITEM.BONE_KEY, { price: 100, name: "bone key", variant: "using-antiques-on-yanni-bone-key" }],
    [ITEM.CRUMPLED_SCROLL, { price: 100, name: "crumpled scroll", variant: "using-antiques-on-yanni-crumpled-scroll" }],
    [ITEM.TATTERED_SCROLL, { price: 100, name: "tattered scroll", variant: "using-antiques-on-yanni-tattered-scroll" }],
    [ITEM.BERVIRIUS_NOTES, { price: 100, name: "Bervirius notes", variant: "using-antiques-on-yanni-bervirius-notes" }],
    [ITEM.BERVIRIUS_NOTES_2, { price: 100, name: "Bervirius notes", variant: "using-antiques-on-yanni-bervirius-notes" }],
    [ITEM.STONE_PLAQUE, { price: 100, name: "stone-plaque", variant: "using-antiques-on-yanni-stone-plaque" }],
    [ITEM.BEADS_OF_THE_DEAD, { price: 1000, name: "'Beads of the Dead'", variant: "using-antiques-on-yanni-beads-of-the-dead" }],
    [ITEM.BLACK_PRISM, { price: 5000, name: "black prism", variant: "using-antiques-on-yanni-black-prism", asks: true }],
  ]);
  for (const id of ITEM.LOCATING_CRYSTALS) {
    YANNI_SALES.set(id, { price: 500, name: "locating crystal", variant: "using-antiques-on-yanni-locating-crystal" });
  }
  /** The six items his quote lists, by the transcript's condition wording. */
  const YANNI_QUOTED = [
    ["bone key", [ITEM.BONE_KEY]],
    ["stone-plaque", [ITEM.STONE_PLAQUE]],
    ["tattered scroll", [ITEM.TATTERED_SCROLL]],
    ["crumpled scroll", [ITEM.CRUMPLED_SCROLL]],
    ["locating crystal", ITEM.LOCATING_CRYSTALS],
    ["beads of the dead", [ITEM.BEADS_OF_THE_DEAD]],
  ];
  /** One Small Favour's Yanni menu leaves these empty; they play his own page's branch (t5497-5551). */
  const YANNI_OWN_OPTIONS = new Set([
    "Tell me about this antiques business.",
    "Do you have any interesting items for sale?",
    "Hmm, sorry, not interested.",
  ]);

  /** Who is waiting to see their belt taken on the "adventuring." line. */
  const pendingStart = new WeakSet();
  /** The antique each player showed Yanni, paid for when his line is continued. */
  const pendingSale = new Map();

  function questDone(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  // --- Trufitus ---------------------------------------------------------------------------------
  /** Jungle Potion's stage once Trufitus has told the player his news after it (its STAGE_NEWS_TOLD). */
  const JUNGLE_POTION_NEWS_TOLD = 13;

  function junglePotionStage(player) {
    const request = { player, key: "jungle_potion", stage: 0 };
    api.emitCustomEvent("quest:get-stage", request);
    return Number(request.stage) || 0;
  }

  function trufitusVariant(player) {
    const stage = sv.stage(player);
    if (stage >= STAGE.UNLOCKED_TOMB) return "visiting-the-tomb-of-rashiliyia-talking-to-trufitus-after-visiting-the-tomb-of-rashiliyia";
    if (stage >= STAGE.ENTERED_BERVIRIUS) return "visiting-the-tomb-of-bervirius-talking-to-trufitus-after-visiting-bervirius-tomb";
    // Ours: the after-burying talk once the shard is in hand (the capture showed the shard, not a Talk-to, then).
    if (stage >= STAGE.LEFT_TEMPLE && (sv.held(player, ITEM.BONE_SHARD) || sv.held(player, ITEM.BONE_KEY))) {
      return "visiting-ah-za-rhoon-talking-to-trufitus-after-burying-zadimus-corpse";
    }
    if (stage >= STAGE.ENTERED_TEMPLE) return "visiting-ah-za-rhoon-talking-to-trufitus-after-visiting-ah-za-rhoon";
    if (stage >= STAGE.STARTED) return "starting-out-talking-to-trufitus-again";
    // Before the start, Jungle Potion has him first, up to its post-quest news (varp 175 12 -> 13, #5956).
    if (junglePotionStage(player) < JUNGLE_POTION_NEWS_TOLD) return null;
    if (sv.held(player, ITEM.WAMPUM_BELT)) return "starting-out-talking-to-trufitus-with-the-wampum-belt";
    if (Number(player.getAttribute(GREETED_ATTRIBUTE)) === 1) return "starting-out-talking-to-trufitus-without-the-wampum-belt";
    return null;
  }

  /**
   * Jungle Potion registers its Trufitus variants first and would shadow these, so the Talk-to is taken here
   * whenever Shilo Village has something to say; otherwise it falls through to his own page.
   */
  function talkToTrufitus(event) {
    const { player } = event;
    if (sv.complete(player)) {
      event.handled = true;
      startTranscript(api, player, NPC.TRUFITUS, sv.TRUFITUS_PAGE, "after-completing-shilo-village", null, event.npc);
      return true;
    }
    const variant = trufitusVariant(player);
    if (!variant) return false;
    if (variant === "starting-out-talking-to-trufitus-with-the-wampum-belt") player.setAttribute(GREETED_ATTRIBUTE, 1);
    event.handled = true;
    startTranscript(api, player, NPC.TRUFITUS, sv.PAGE, variant, null, event.npc);
    return true;
  }

  function showTrufitus(event) {
    const { player, itemId } = event;
    event.handled = true;
    const variant = TRUFITUS_ITEM_VARIANTS.get(itemId) ?? UNRELATED_ITEM_VARIANT;
    sv.scene(player, NPC.TRUFITUS, variant);
  }

  // --- Mosol Rei --------------------------------------------------------------------------------
  function mosolVariant(player) {
    if (sv.complete(player)) return "standard-dialogue-after-shilo-village";
    if (sv.stage(player) >= STAGE.STARTED || sv.held(player, ITEM.WAMPUM_BELT)) {
      return "starting-out-talking-to-mosol-rei-after-getting-the-wampum-belt";
    }
    return "starting-out-talking-to-mosol-rei";
  }

  function selectVariant({ npcId, player }) {
    if (MOSOL_IDS.has(npcId)) return mosolVariant(player);
    if (npcId === NPC.TRUFITUS) return sv.complete(player) ? "after-completing-shilo-village" : trufitusVariant(player);
    return null;
  }

  // --- The start --------------------------------------------------------------------------------
  /** Mosol's gift: the belt arrives with its object box (t1442), or under the player with no room (the step's text). */
  const BELT_BOX_STEP = "imK8st";
  const BELT_RECEIVE_STEP = "10Zz1R";

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player) return;
    if (stepId === BELT_RECEIVE_STEP) {
      // Given with the box before it.
      event.handled = true;
    } else if (stepId === BELT_BOX_STEP && !sv.held(player, ITEM.WAMPUM_BELT)) {
      if (sv.freeSlots(player) > 0) {
        sv.give(player, ITEM.WAMPUM_BELT);
      } else {
        const { ItemOnGroundManager } = api.core;
        ItemOnGroundManager.registerLocation(player, new Item(ITEM.WAMPUM_BELT, 1), player.getLocation().clone(),
          player.getPrivateArea?.() ?? null);
      }
    }
  }

  function handleHook(event) {
    if (event.hook !== START_HOOK || !event.player) return;
    pendingStart.add(event.player);
  }

  function handleLine(event) {
    const { player } = event;
    if (!player) return;
    const text = String(event.text ?? "");
    {
      if (text === START_LINE && pendingStart.has(player)) {
        pendingStart.delete(player);
        chainAfter(event, () => startQuest(player));
        return;
      }
      if (text === TOLD_WHERE_LINE && sv.stage(player) === STAGE.STARTED) {
        chainAfter(event, () => sv.advance(player, STAGE.TOLD_WHERE));
        return;
      }
      const after = AFTER_QUEST_LINES.get(text);
      if (after !== undefined && sv.complete(player)) {
        sv.advance(player, after);
        return;
      }
    }
    if (event.npcId === NPC.YANNI) yanniLine(event);
  }

  function chainAfter(event, fn) {
    const previous = event.after;
    event.after = () => {
      previous?.();
      fn();
    };
  }

  function startQuest(player) {
    if (sv.stage(player) >= STAGE.STARTED) return;
    sv.advance(player, STAGE.STARTED);
    player.sendMessage(questStartMessage(player, "Shilo Village"));
    if (sv.held(player, ITEM.WAMPUM_BELT)) sv.take(player, ITEM.WAMPUM_BELT);
  }

  // --- Conditions -------------------------------------------------------------------------------
  function meetsRequirements(player) {
    return questDone(player, "jungle_potion")
      && sv.craftingLevel(player) >= 20
      && sv.agilityLevel(player) >= 32;
  }

  function combatLevel(player) {
    return Number(player.getSkillManager().getCombatLevel?.()) || 3;
  }

  function answerCondition({ player, text, npcId }) {
    if (!player) return null;
    const value = String(text ?? "").toLowerCase();
    if (npcId === NPC.YANNI) {
      const yanni = yanniCondition(player, value);
      if (yanni !== null) return yanni;
    }
    if (value.includes("does not have all the requirements") && value.includes("combat level below 45")) {
      return !meetsRequirements(player) && combatLevel(player) < 45;
    }
    if (npcId === NPC.TRUFITUS && sv.complete(player)) {
      const stage = sv.stage(player);
      if (value.startsWith("when spoken to for the first time")) return stage < STAGE.TOLD_TRUFITUS;
      if (value.startsWith("when spoken to again")) return stage === STAGE.TOLD_TRUFITUS;
      if (value.startsWith("when spoken to subsequently")) return stage >= STAGE.TOLD_TRUFITUS_AGAIN;
    }
    return null;
  }

  // --- Yanni Salika -----------------------------------------------------------------------------
  /** Preset, untradeable and unbankable copies keep their restrictions, so he takes none. */
  function restricted(item) {
    return item.isPresetItem?.() === true
      || item.getMetaValue?.(Item.PRESET_META) === true
      || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
      || item.getMetaValue?.(Item.UNBANKABLE_META) === true;
  }

  /**
   * Wiki (Yanni Salika, Black prism): he buys "after the completion of Shilo Village", and the prism only "after the
   * completion of Zogre Flesh Eaters". A second prism is refused.
   */
  function yanniBuys(player, item) {
    const sale = YANNI_SALES.get(item?.getId?.());
    if (!sale || restricted(item) || !sv.complete(player)) return false;
    return !sale.asks || questDone(player, "zogre_flesh_eaters");
  }

  /** The quote counts what he would buy in the inventory and the worn beads (t5627: worn only, still quoted). */
  function quotable(player) {
    const items = player.getInventory().getItems().filter((item) => item && yanniBuys(player, item));
    const worn = player.getEquipment().get(api.core.Equipment.AMULET_SLOT);
    if (worn?.getId?.() === ITEM.BEADS_OF_THE_DEAD && !restricted(worn) && sv.complete(player)) items.push(worn);
    return items;
  }

  function carries(player, ids) {
    return quotable(player).some((item) => ids.includes(item.getId()));
  }

  function bankedBeads(player) {
    for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
      if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).getAmount(ITEM.BEADS_OF_THE_DEAD) > 0) return true;
    }
    return false;
  }

  function ownsBeads(player) {
    return sv.held(player, ITEM.BEADS_OF_THE_DEAD) || bankedBeads(player)
      || player.getEquipment().getAmount?.(ITEM.BEADS_OF_THE_DEAD) > 0;
  }

  function yanniCondition(player, value) {
    const quoted = YANNI_QUOTED.filter(([, ids]) => carries(player, ids)).length;
    if (value.includes("doesn't have an item yanni can buy")) return quoted === 0;
    if (value.includes("only one of the above items")) return quoted === 1;
    if (value.includes("more than one of the above items")) return quoted > 1;
    if (value.includes("already has the beads of the dead in their inventory or bank")) return ownsBeads(player);
    if (value.includes("does not have the beads of the dead")) return !ownsBeads(player);
    for (const [name, ids] of YANNI_QUOTED) {
      if (value.includes(`has the ${name} in their inventory`)) return carries(player, ids);
    }
    return null;
  }

  /** "[Sir/Madam]" is lower case in his refusal (t5535: "Sorry, sir, I have nothing that you need."). */
  function yanniLine(event) {
    const { player } = event;
    if (typeof event.text === "string" && event.text.includes("[Sir/Madam]")) {
      const female = player.getAppearance?.()?.isMale?.() === false;
      event.text = event.text.replace("[Sir/Madam]", female ? "madam" : "sir");
    }
    const sale = pendingSale.get(player);
    if (!sale || sale.asks) return;
    pendingSale.delete(player);
    chainAfter(event, () => paidFor(player, sale));
  }

  function showYanni(event) {
    const { player, itemId, slot, item } = event;
    const sale = YANNI_SALES.get(itemId);
    if (!yanniBuys(player, item)) return;
    event.handled = true;
    if (sale.asks && Number(player.getAttribute(PRISM_SOLD_ATTRIBUTE)) === 1) {
      player.sendMessage("Sorry Bwana, you have nothing I am interested in.");
      return;
    }
    pendingSale.set(player, { ...sale, itemId, slot, item });
    startTranscript(api, player, NPC.YANNI, sv.YANNI_PAGE, sale.variant, null, event.npc ?? event.target ?? null);
  }

  /** Room for `price` coins once `item` (one of it) is sold: now, or in the slot it frees. */
  function priceFits(inventory, item, price) {
    const coins = new Item(ITEM.COINS, price);
    if (inventory.getAddableAmount(coins) >= price) return true;
    const plainStack = inventory.getItems().some((held) => held?.getId?.() === ITEM.COINS && held.getMeta() == null);
    return item.getAmount() === 1 && !plainStack;
  }

  /** On the continue of his line: the item from the slot it was shown from, the coins, the line (t5599). */
  function paidFor(player, { itemId, slot, item, price, name }) {
    const inventory = player.getInventory();
    if (inventory.getItems()[slot] !== item || item.getId() !== itemId) return false;
    if (!priceFits(inventory, item, price)) {
      player.sendMessage("You don't have enough inventory space.");
      return false;
    }
    inventory.deleteAtSlot(slot, 1, true);
    inventory.adds(ITEM.COINS, price);
    player.sendMessage(`You sell the ${name} for ${price} gold.`);
    return true;
  }

  /** Wiki: once he has bought a prism "they will automatically take ALL prisms you own", carried or banked. */
  function takeEveryPrism(player) {
    sv.take(player, ITEM.BLACK_PRISM, player.getInventory().getAmount(ITEM.BLACK_PRISM));
    for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
      if (tab === Bank.BANK_SEARCH_TAB_INDEX) continue;
      const bank = player.getBank(tab);
      const amount = bank.getAmount(ITEM.BLACK_PRISM);
      if (amount > 0) bank.deleteNumber(ITEM.BLACK_PRISM, amount);
    }
  }

  /** The steps of Yanni's own first-menu option `text` (his standard dialogue). */
  function ownOption(text) {
    return (steps) => {
      const menu = steps.find((step) => step?.type === "choice");
      return menu?.options?.find((option) => option.text === text)?.steps ?? [];
    };
  }

  function handleChoice(event) {
    const { player, option } = event;
    if (!player) return;
    if (event.npcId === NPC.YANNI) {
      const sale = pendingSale.get(player);
      if (sale?.asks) {
        if (String(option).startsWith("Yes, I'll sell it for 5000")) {
          pendingSale.delete(player);
          if (paidFor(player, sale)) {
            player.setAttribute(PRISM_SOLD_ATTRIBUTE, 1);
            takeEveryPrism(player);
          }
        } else if (String(option).startsWith("No, I think I'll hold on it")) {
          pendingSale.delete(player);
        }
        return;
      }
      const onFavourPage = (event.pages ?? []).some((entry) => (entry?.page ?? entry) === "One Small Favour");
      if (onFavourPage && YANNI_OWN_OPTIONS.has(option)) {
        event.end = true;
        startTranscript(api, player, NPC.YANNI, sv.YANNI_PAGE, "standard-dialogue", ownOption(option), event.npc ?? null);
      }
    }
  }

  function handleItemOnNpc(event) {
    const npcId = event.npcId ?? event.target?.getId?.();
    if (npcId === NPC.YANNI) showYanni(event);
    else if (npcId === NPC.TRUFITUS) showTrufitus(event);
  }

  function handleLogout({ player }) {
    if (!player) return;
    pendingSale.delete(player);
    pendingStart.delete(player);
  }

  api.persistAttribute(GREETED_ATTRIBUTE, 0);
  api.persistAttribute(PRISM_SOLD_ATTRIBUTE, 0);
  api.onNpcInteraction("Trufitus", { "Talk-to": talkToTrufitus });
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onItemOnNpc(handleItemOnNpc);
  api.onPlayerLogout(handleLogout);

  return { trufitusVariant, mosolVariant, yanniBuys, quotable, YANNI_SALES, GREETED_ATTRIBUTE };
};
