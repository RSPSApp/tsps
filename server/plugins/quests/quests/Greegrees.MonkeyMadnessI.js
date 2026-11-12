/** Zooknock's paid tunnel exchanges. Wiki MM1/Quick guide and Transcript:Monkey Madness I.
 * Offers reserve exact carried items; only the hand-back commits. Initial scene progress
 * survives interruption/login. Each new repeat exchange needs a confirmed request;
 * reopening an unfinished offer resumes that same request without a second charge.
 * No retail tick cadence is inferred here. Generated transcripts remain read-only.
 */
module.exports = function greegreeExchanges(api, { stageOf, setStage, garkorAsked,
  talismanGiven, remainsGiven, startTranscript }) {
  const { ItemIdentifiers: I, NpcIdentifiers: N } = api.core;
  const STATE_ATTRIBUTE = "monkey-madness-i:greegree-exchange";
  const PAGE = "Monkey Madness I";
  const AFTER_BOTH = "chapter-2-creating-the-monkey-gree-gree-after-using-both-items-on-zooknock";
  const TALISMAN_FIRST = "chapter-2-creating-the-monkey-gree-gree-using-the-monkey-talisman-on-zooknock-first";
  const REMAINS_FIRST = "chapter-2-creating-the-monkey-gree-gree-using-the-monkey-remains-on-zooknock-first";
  const INITIAL_STAGE = 7, CHAPTERS_STAGE = 8;
  const products = new Map([
    [I.MONKEY_BONES, I.KARAMJAN_MONKEY_GREEGREE],
    [I.MONKEY_CORPSE, I.KARAMJAN_MONKEY_GREEGREE],
    [I.SMALL_NINJA_MONKEY_BONES, I.NINJA_MONKEY_GREEGREE],
    [I.MEDIUM_NINJA_MONKEY_BONES, I.NINJA_MONKEY_GREEGREE_2],
    [I.GORILLA_BONES, I.GORILLA_GREEGREE],
    [I.BEARDED_GORILLA_BONES, I.BEARDED_GORILLA_GREEGREE],
    [I.SMALL_ZOMBIE_MONKEY_BONES, I.ZOMBIE_MONKEY_GREEGREE],
    [I.LARGE_ZOMBIE_MONKEY_BONES, I.ZOMBIE_MONKEY_GREEGREE_2],
    [I.MONKEY_SKULL, I.ANCIENT_GORILLA_GREEGREE],
  ]);
  api.persistAttribute(STATE_ATTRIBUTE, 0);

  function owns({ player, npcId }) {
    if (npcId !== N.ZOOKNOCK_3 || stageOf(player) < INITIAL_STAGE) return false;
    const request = { player, npcId, owned: false };
    api.emitCustomEvent("monkey-madness-ii:zooknock-ownership", request);
    return !request.owned;
  }
  function state(player) {
    const value = player.getAttribute(STATE_ATTRIBUTE);
    if (value && typeof value === "object") return value;
    // Old saves recorded consumed initial handovers, but not their exact ordinary
    // remains id. Preserve these as credits, never mint/refund guessed items.
    if (stageOf(player) === INITIAL_STAGE
      && (player.getAttribute(talismanGiven) === true || player.getAttribute(remainsGiven) === true)) {
      const old = { initial: true, talisman: player.getAttribute(talismanGiven) === true,
        remains: player.getAttribute(remainsGiven) === true ? I.MONKEY_BONES : 0,
        talismanCredit: player.getAttribute(talismanGiven) === true,
        remainsCredit: player.getAttribute(remainsGiven) === true };
      save(player, old);
      player.setAttribute(talismanGiven, false);
      player.setAttribute(remainsGiven, false);
      return old;
    }
    return null;
  }
  function save(player, value) { player.setAttribute(STATE_ATTRIBUTE, value || 0); }
  function ready(player, offer) {
    const inv = player.getInventory();
    return offer?.talisman && products.has(offer.remains)
      && (offer.talismanCredit || inv.getAmount(I.MONKEY_TALISMAN) > 0)
      && (offer.remainsCredit || inv.getAmount(offer.remains) > 0);
  }
  function play(event, variant, select) {
    return startTranscript(api, event.player, event.npcId, PAGE, variant, select, event.npc ?? event.target);
  }
  function completeScene(event) {
    const offer = state(event.player);
    // The exporter has an END before the Chapter 3 marker. Select the continuous
    // initial scene, including that canonical marker, so interrupted playback can resume.
    return play(event, AFTER_BOTH, steps => offer.initial
      ? steps.filter(step => step.type !== "end") : steps.slice(0, 3));
  }
  function talk(event) {
    if (!owns(event)) return false;
    const offer = state(event.player);
    if (offer?.committed || ready(event.player, offer)) {
      event.handled = true;
      completeScene(event);
      return true;
    }
    return false;
  }
  function item(event) {
    if (!owns(event)) return false;
    const { player, itemId } = event;
    const definition = api.core.ItemDefinition.forId(itemId);
    if (definition?.isNoted() && products.has(definition.getNoteId())) {
      event.handled = true;
      player.sendMessage("Zooknock needs unnoted monkey remains.");
      return true;
    }
    const isMaterial = products.has(itemId) || itemId === I.MONKEY_TALISMAN;
    if (!isMaterial) return false;
    event.handled = true;
    let offer = state(player);
    if (offer?.committed) { completeScene(event); return true; }
    if (stageOf(player) === INITIAL_STAGE && !garkorAsked(player)) {
      player.sendMessage("Zooknock is busy working on his tunnel.");
      return true;
    }
    if (!offer && stageOf(player) >= CHAPTERS_STAGE) {
      player.sendMessage("Ask Zooknock to make another monkey talisman first.");
      return true;
    }
    offer = { ...(offer ?? { initial: true }) };
    if (offer.initial && products.has(itemId) && products.get(itemId) !== I.KARAMJAN_MONKEY_GREEGREE) {
      player.sendMessage("For your first greegree, bring ordinary monkey bones or a monkey corpse.");
      return true;
    }
    if (player.getInventory().getAmount(itemId) < 1) return true;
    if (itemId === I.MONKEY_TALISMAN) offer.talisman = true;
    else if (!offer.remainsCredit) offer.remains = itemId;
    save(player, offer);
    play(event, ready(player, offer) ? AFTER_BOTH : itemId === I.MONKEY_TALISMAN ? TALISMAN_FIRST : REMAINS_FIRST,
      ready(player, offer) ? steps => offer.initial ? steps.filter(step => step.type !== "end") : steps.slice(0, 3) : undefined);
    return true;
  }
  function choice(event) {
    if (!owns(event)) return;
    if (event.option === "Can you make another monkey talisman?" || event.option === "No") {
      if (!state(event.player)?.committed) save(event.player, null);
    }
  }
  function line(event) {
    if (!owns(event) || stageOf(event.player) < CHAPTERS_STAGE) return;
    if (event.text === "Very well. Bring me the required materials again and I will prepare for you another one.") {
      event.after = () => { if (owns(event)) save(event.player, { initial: false }); };
    }
  }
  function action(event) {
    const { player, stepId } = event;
    if (!["RiFs2s", "uDWMj-", "-wRWky", "hOYpYN", "qNLIG9"].includes(stepId) || !owns(event)) return false;
    event.handled = true;
    const offer = state(player);
    if (!offer) { event.end = true; return true; }
    if (stepId === "RiFs2s" || stepId === "uDWMj-") {
      event.box = { items: [stepId === "RiFs2s" ? I.MONKEY_TALISMAN : offer.remains] };
      return true;
    }
    if (stepId === "hOYpYN") return true;
    if (stepId === "qNLIG9") {
      if (offer.initial && offer.committed) {
        save(player, null);
        if (stageOf(player) < CHAPTERS_STAGE) setStage(player, CHAPTERS_STAGE);
      }
      return true;
    }
    event.box = { items: [products.get(offer.remains)] };
    if (offer.committed) return true; // replay the initial scene without charging/granting twice
    if (!ready(player, offer)) {
      player.sendMessage("You need the offered monkey remains and a monkey talisman in your inventory.");
      event.end = true;
      return true;
    }
    const inv = player.getInventory();
    const slotsFreed = Number(!offer.talismanCredit) + Number(!offer.remainsCredit);
    if (inv.getFreeSlots() + slotsFreed < 1) {
      player.sendMessage("You need a free inventory slot for the greegree.");
      event.end = true;
      return true;
    }
    // Synchronous, checked transaction: both inputs are present (or previously
    // consumed legacy credits), and their removal guarantees room for one output.
    if (!offer.talismanCredit) inv.deleteNumber(I.MONKEY_TALISMAN, 1);
    if (!offer.remainsCredit) inv.deleteNumber(offer.remains, 1);
    inv.adds(products.get(offer.remains), 1);
    save(player, offer.initial ? { ...offer, committed: true } : null);
    return true;
  }
  return { owns, talk, item, choice, line, action };
};
