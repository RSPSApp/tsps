"use strict";

/**
 * One AI bot's side of trading. The model proposes (offer items, accept, decline); this
 * decides. Core Trading.ts calls the bot's getTradingInteraction() hooks: a request, the trade
 * screen opening, the other side changing its offer or accepting, items received.
 *
 * Rules the model can't talk its way past:
 * - The bot never accepts a trade that loses it more than `gifts.perTrade` coins of Grand
 *   Exchange value, nor more than `gifts.perPlayerPerDay` to one player in a day.
 * - It only offers inventory items, never the tools its activities use.
 * - It accepts the second screen only when both sides still hold exactly what it agreed to.
 */
const PROTECTED_TOOLS = /(axe|pickaxe|fishing net|fishing rod|harpoon|lobster pot|tinderbox|hammer)$/i;
const TRADE_TIMEOUT_MS = 120000;
const WALK_TIMEOUT_MS = 20000;
const OFFER_SETTLE_MS = 1500;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Grand Exchange value of what a container holds; noted items count as their unnoted item. */
function containerValue(container, ItemDefinition) {
  let total = 0;
  for (const item of container.getValidItems()) {
    const base = ItemDefinition.forId(item.getId()).unNote?.() ?? item.getId();
    total += Math.max(0, Number(ItemDefinition.forId(base).getGrandExchangeValue()) || 0) * item.getAmount();
  }
  return total;
}

function snapshot(container) {
  return container.getValidItems().map((item) => `${item.getId()}x${item.getAmount()}`).sort().join(",");
}

function describeItems(container) {
  const counts = new Map();
  for (const item of container.getValidItems()) {
    const name = item.getDefinition().getName();
    counts.set(name, (counts.get(name) ?? 0) + item.getAmount());
  }
  if (counts.size === 0) return "nothing";
  return [...counts].map(([name, amount]) => (amount > 1 ? `${amount} x ${name}` : name)).join(", ");
}

const formatCoins = (value) => (value >= 10000 ? `${Math.round(value / 1000)}k` : String(value));

class AiBotTrade {
  constructor({ mind, core, gifts, givenToday }) {
    this.mind = mind;
    this.core = core;
    this.gifts = gifts;
    // Shared by every bot: who got how much today (player name -> { day, amount }).
    this.givenToday = givenToday;
    this.request = null; // { from, at }: a request we haven't answered
    this.walk = null; // { target, at }: walking up to someone to trade
    this.open = null; // { partner, openedAt, agreed, changedAt, loss }
    this.interaction = {
      acceptTradeRequest: (player) => this.onRequest(player),
      addItemsToTrade: (_container, partner) => this.onOpened(partner),
      offerChanged: (partner) => this.onOfferChanged(partner),
      acceptTrade: () => this.onPartnerAccepted(),
      receivedItems: () => {},
    };
  }

  get bot() {
    return this.mind.bot;
  }

  trading() {
    return this.bot.getTrading();
  }

  state() {
    return this.trading().getState();
  }

  onRequest(player) {
    const name = player.getUsername();
    this.request = { from: name, at: Date.now() };
    this.mind.addEvent(`${name} wants to trade with you.`);
    this.mind.requestDecision("trade request", { reply: true, from: name });
  }

  onOpened(partner) {
    this.walk = null;
    this.request = null;
    this.open = { partner: partner.getUsername(), openedAt: Date.now(), agreed: null, changedAt: 0, loss: 0 };
    this.mind.pauseBrain(true);
    this.mind.addEvent(`A trade with ${this.open.partner} opened.`);
    this.mind.requestDecision("trade opened", { reply: true, from: this.open.partner });
  }

  onOfferChanged(partner) {
    if (!this.open || partner.getUsername() !== this.open.partner) return;
    this.open.agreed = null;
    this.open.changedAt = Date.now();
  }

  onPartnerAccepted() {
    if (!this.open || this.open.agreed) return;
    this.mind.addEvent(`${this.open.partner} accepted the trade.`);
    this.mind.requestDecision("trade accepted by partner", { reply: true, from: this.open.partner });
  }

  /** For the situation: the open trade as text, or null. */
  describe() {
    if (!this.open) return null;
    const partner = this.trading().getInteract();
    if (!partner) return null;
    const ItemDefinition = this.core.ItemDefinition;
    const theirs = partner.getTrading().getContainer();
    const yours = this.trading().getContainer();
    return {
      partner: this.open.partner,
      theirs: `${describeItems(theirs)} (worth ${formatCoins(containerValue(theirs, ItemDefinition))})`,
      yours: `${describeItems(yours)} (worth ${formatCoins(containerValue(yours, ItemDefinition))})`,
      note: this.open.agreed ? "You have accepted it." : "",
    };
  }

  /** Called every tick: follows the trade screens and gives up on stale ones. */
  tick(nowMs) {
    const { TradeState } = this.core;
    const state = this.state();
    if (this.walk && !this.open && nowMs - this.walk.at > WALK_TIMEOUT_MS) {
      this.walk = null;
      this.mind.pauseBrain(false);
    }
    if (!this.open) return;
    if (state === TradeState.NONE || state === TradeState.REQUESTED_TRADE) {
      this.mind.addEvent(`The trade with ${this.open.partner} closed.`);
      this.open = null;
      this.mind.pauseBrain(false);
      return;
    }
    if (nowMs - this.open.openedAt > TRADE_TIMEOUT_MS) {
      this.mind.addEvent(`You closed the trade with ${this.open.partner}: it took too long.`);
      this.trading().closeTrade();
      return;
    }
    if (this.open.changedAt && nowMs - this.open.changedAt >= OFFER_SETTLE_MS) {
      this.open.changedAt = 0;
      this.mind.addEvent(`${this.open.partner} changed their offer.`);
      this.mind.requestDecision("trade offer changed", { reply: true, from: this.open.partner });
    }
    if (state === TradeState.CONFIRM_SCREEN && this.open.agreed) {
      // Second screen: accept only what was agreed on the first.
      if (this.currentSnapshot() === this.open.agreed) {
        this.trading().acceptTrade();
      } else {
        this.trading().closeTrade();
      }
    }
  }

  currentSnapshot() {
    const partner = this.trading().getInteract();
    if (!partner) return null;
    return `${snapshot(this.trading().getContainer())}|${snapshot(partner.getTrading().getContainer())}`;
  }

  /** trade_request: answers a pending request, or walks up and asks. */
  requestWith(target) {
    const { TradeState } = this.core;
    // A request of our own that went unanswered (REQUESTED_TRADE) doesn't stop a new one.
    const state = this.state();
    if (this.open || (state !== TradeState.NONE && state !== TradeState.REQUESTED_TRADE)) return "you're already in a trade";
    if (target.getTrading().getState() !== TradeState.NONE && target.getTrading().getInteract() !== this.bot) {
      return `${target.getUsername()} is busy`;
    }
    this.mind.pauseBrain(true);
    this.walk = { target: target.getUsername(), at: Date.now() };
    this.bot.getMovementQueue().walkToEntity(target, () => this.trading().requestTrade(target));
    return null;
  }

  /** trade_offer: puts inventory items into the open trade. Returns a note on what didn't go in. */
  offer(items) {
    if (!this.open) return "there is no open trade";
    const inventory = this.bot.getInventory();
    const problems = [];
    for (const { item, amount } of items) {
      const wanted = item.toLowerCase();
      const slot = inventory.getItems().findIndex(
        (held) => held && held.getId() > 0 && held.getDefinition().getName().toLowerCase() === wanted
      );
      if (slot < 0) {
        problems.push(`you have no ${item}`);
        continue;
      }
      const held = inventory.getItems()[slot];
      if (PROTECTED_TOOLS.test(held.getDefinition().getName())) {
        problems.push(`you keep your ${item}, you need it`);
        continue;
      }
      if (!held.isTradeable()) {
        problems.push(`${item} can't be traded`);
        continue;
      }
      const available = inventory.getAmount(held.getId());
      this.trading().handleItem(held.getId(), Math.min(amount, available), slot, inventory, this.trading().getContainer());
    }
    this.open.agreed = null;
    return problems.join("; ");
  }

  /** trade_accept: accepts if the value rule allows it. Returns why not, or null. */
  accept() {
    if (!this.open) return "there is no open trade";
    const partner = this.trading().getInteract();
    if (!partner) return "there is no open trade";
    const ItemDefinition = this.core.ItemDefinition;
    const given = containerValue(this.trading().getContainer(), ItemDefinition);
    const received = containerValue(partner.getTrading().getContainer(), ItemDefinition);
    const loss = Math.max(0, given - received);
    const today = this.givenSoFar(this.open.partner);
    if (loss > this.gifts.perTrade || today + loss > this.gifts.perPlayerPerDay) {
      return `you can't accept: you'd give away about ${formatCoins(loss)} more than you get, more than you'll give`;
    }
    this.open.agreed = this.currentSnapshot();
    this.open.loss = loss;
    this.trading().acceptTrade();
    return null;
  }

  decline() {
    if (!this.open) return "there is no open trade";
    this.trading().closeTrade();
    return null;
  }

  givenSoFar(name) {
    const entry = this.givenToday.get(name.toLowerCase());
    return entry && Date.now() - entry.since < DAY_MS ? entry.amount : 0;
  }

  /** A completed trade: counts what the bot gave away toward the daily limit. */
  onCompleted(partnerName) {
    const loss = this.open?.loss ?? 0;
    if (loss > 0) {
      const key = partnerName.toLowerCase();
      const entry = this.givenToday.get(key);
      const fresh = !entry || Date.now() - entry.since >= DAY_MS;
      this.givenToday.set(key, { since: fresh ? Date.now() : entry.since, amount: (fresh ? 0 : entry.amount) + loss });
    }
    this.open = null;
    this.mind.pauseBrain(false);
    this.mind.addEvent(`The trade with ${partnerName} went through.`);
  }
}

module.exports = { AiBotTrade, containerValue, describeItems, PROTECTED_TOOLS };
