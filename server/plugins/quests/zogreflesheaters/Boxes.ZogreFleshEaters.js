/**
 * How Zogre Flesh Eaters shows its transcript's message steps, from the revision 242 capture
 * (rsprox ZogreFleshEaters.bin; docs/quests/zogre-flesh-eaters/README.md). The dump keeps the
 * Wiki's {{tbox}} / {{mes}} only as text, so each message step id names its box here:
 *
 *   items: [id] or [id, id]  objectbox / objectbox_double with those items (the hand-outs, "You show ...")
 *   statement: true          a plain message box (229), as the coffin and plinth searches are
 *   also: true               the line also goes to the chat box (the key: capture tick 2330)
 *
 * A step not listed is a chat message, as the stairs, lectern and door lines are live.
 * `item` boxes marked "by analogy" were not captured: they are the same kind of line as a captured
 * one ("You show the black prism to Grish." beside "You show the black prism to Zavistic.").
 */
module.exports = function createZogreBoxes(api) {
  const { ItemIdentifiers: I } = api.core;

  const BOXES = {
    // Grish's hand-out (tick 260).
    luhaXl: { items: [I.COOKED_CHOMPY, I.SUPER_RESTORE_3_] },
    // The ruined backpack (ticks 499-514).
    "0-8UtI": { items: [I.RUINED_BACKPACK] },
    // The tankard's box; its "You find ..." chat lines (DdQesI, j2cFmu) stay chat messages.
    "6ce-Aa": { items: [I.DRAGON_INN_TANKARD] },
    f6No5O: { items: [I.KNIFE, I.ROTTEN_FOOD] },
    // The lectern's page (tick 523), its reading (527, 533) and the tankard (538).
    VIcEvT: { items: [I.TORN_PAGE] },
    X2WI0L: { statement: true },
    z149fS: { statement: true },
    Wvz6H2: { items: [I.DRAGON_INN_TANKARD] },
    // The north-west coffin (ticks 545-679).
    gWnvrZ: { statement: true },
    "2jEw3h": { statement: true },
    yGJyGK: { items: [I.KNIFE] },
    Z2e7iB: { statement: true },
    WielTW: { statement: true },
    IXYxwm: { statement: true },
    D53WoV: { statement: true },
    pGrhyb: { items: [I.BLACK_PRISM] },
    USsGWT: { items: [I.BLACK_PRISM] },
    // Showing the clues: to Zavistic (877), Grish, Sithik and the bartender (by analogy).
    thEwXi: { items: [I.BLACK_PRISM, I.TORN_PAGE] },
    CEI1zE: { items: [I.BLACK_PRISM] },
    "-nw8SI": { items: [I.BLACK_PRISM] },
    WX1Eih: { items: [I.TORN_PAGE] },
    hjEp8O: { items: [I.BLACK_PRISM] },
    ZonmXJ: { items: [I.BLACK_PRISM] },
    // The bartender (939, 1369, 1374) and the signed portrait (1416).
    OG1g5U: { items: [I.DRAGON_INN_TANKARD] },
    ukw5TP: { items: [I.DRAGON_INN_TANKARD] },
    FoOT6Z: { items: [I.SITHIK_PORTRAIT] },
    rOCE25: { items: [I.SIGNED_PORTRAIT] },
    mQG5fU: { items: [I.SIGNED_PORTRAIT] },
    // Sithik's room (ticks 1113-1285).
    UZ09e5: { items: [I.BOOK_OF_H_A_M] },
    c_PVgF: { statement: true },
    "3joCI-": { items: [I.NECROMANCY_BOOK] },
    EaO2pT: { items: [I.NECROMANCY_BOOK] },
    yHgbza: { items: [I.CHARCOAL, I.PAPYRUS] },
    "3b2CAk": { items: [I.CHARCOAL, I.PAPYRUS] },
    "-7JGGv": { items: [I.CHARCOAL, I.PAPYRUS] },
    "-5TCGA": { items: [I.BOOK_OF_PORTRAITURE] },
    kDECcP: { statement: true },
    wyKUyj: { items: [I.BOOK_OF_PORTRAITURE] },
    p796Z8: { items: [I.BOOK_OF_H_A_M] },
    "6q_nl8": { items: [I.NECROMANCY_BOOK] },
    lKO3pR: { statement: true },
    JNza8B: { items: [I.SITHIK_PORTRAIT_2] },
    YBgMW7: { items: [I.SITHIK_PORTRAIT] },
    "O-H3KY": { items: [I.SITHIK_PORTRAIT] },
    HYCDwa: { items: [I.SITHIK_PORTRAIT] },
    // The evidence hand-in (ticks 1468-1483), the spare potion (1506) and the tea (1539).
    tFIOsZ: { items: [I.NECROMANCY_BOOK] },
    QZF9jm: { items: [I.BOOK_OF_H_A_M] },
    m5Yh81: { items: [I.DRAGON_INN_TANKARD] },
    "5liwsa": { items: [I.SIGNED_PORTRAIT] },
    VDahRD: { items: [I.STRANGE_POTION] },
    _QKSlE: { items: [I.STRANGE_POTION] },
    mmUl2l: { items: [I.STRANGE_POTION] },
    // The prism sale once Sithik has had the potion (ticks 1750, 1760).
    "-NVx0S": { items: [I.BLACK_PRISM] },
    AsiW7f: { items: [I.COINS, I.BLACK_PRISM] },
    // Grish's bow (ticks 2246-2251) and key (2328, with its chat line at 2330).
    mtQ5Qf: { items: [I.ACHEY_TREE_LOGS, I.WOLF_BONES] },
    "5KoHaD": { items: [I.UNSTRUNG_COMP_BOW] },
    aItbm4: { items: [I.UNSTRUNG_COMP_BOW, I.BOW_STRING] },
    M0O5wS: { items: [I.COMP_OGRE_BOW] },
    uZirGH: { items: [I.OGRE_GATE_KEY], also: true },
    // The plinth (2437, 2665).
    EHO98y: { statement: true },
    KLorK4: { statement: true },
    Yzp9st: { items: [I.OGRE_ARTEFACT] },
    // The entry cutscene's message box (417) is held by the scene itself (Jiggig unit).
  };

  /** Uglug Nar's two balm boxes show the dose used (ticks 765, 3191, 3196). */
  const BALM_BOXES = new Set(["wn7LPS", "GEgdcz", "JRpLrN"]);

  /**
   * Sets `event.box` for a message step this quest shows as a box. `balmId` is the balm the
   * player used on Uglug Nar, which his boxes picture.
   */
  function applyBox(event, balmId = null) {
    if (event.kind !== "message" || !event.stepId) return false;
    if (BALM_BOXES.has(event.stepId) && balmId != null) {
      event.box = { items: event.stepId === "JRpLrN" ? [I.COINS, balmId] : [balmId] };
      return true;
    }
    const box = BOXES[event.stepId];
    if (!box) return false;
    event.box = box.statement ? { statement: true } : { items: box.items };
    if (box.also) event.player.sendMessage(event.text);
    return true;
  }

  return { applyBox, BOXES };
};
