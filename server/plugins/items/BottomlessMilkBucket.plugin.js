/**
 * Bottomless milk bucket (Wiki: Bottomless milk bucket, Transcript:Bottomless milk bucket).
 *
 * It holds up to 10,000 uses of one kind of milk (bucket of milk, chocolatey milk, milky
 * mixture or hangover cure), kept in the item's meta. The empty bucket (33091) becomes the
 * filled one (33089) while it holds anything:
 *
 *   Check       an item box with the uses held, or "Your milk bucket is currently empty."
 *   Fill        pours buckets of its milk in (a warning first when empty, a count when several)
 *   Empty       a discard warning, then the bucket is empty again
 *   milk on it  the same as Fill, with that milk
 *   chocolate dust (unnoted) on milk: one chocolatey milk, for one use
 *
 * Other plugins reach it through custom events (no recording of the bucket exists, so the
 * texts are the Wiki transcript's):
 *   "bottomless-milk:holds" { player, type, holds }   a bucket holding `type` is carried
 *   "bottomless-milk:spend" { player, type, item?, spent }   a quest takes one use
 *   "bottomless-milk:fillable" { player, bucket, full }   dairy cows: a bucket that takes milk
 *   "bottomless-milk:add-milk" { player, bucket, added, full }   dairy cows: one more use
 */
const META_KEY = "bottomless-milk";
const MAX_USES = 10000;
const FILLED_NAME = "Bottomless milk bucket";
const EMPTY_NAME = "Bottomless milk bucket (empty)";

let core;
let FILLED_ID, EMPTY_ID, BUCKET_ID, MILK_ID, CHOCOLATE_DUST_ID, CHOCOLATEY_MILK_ID;
/** Milk item id -> what Check and Fill call it (the transcript calls milky mixture "creamy milk"). */
let MILK_TYPES;

function initialize(coreApi) {
  core = coreApi;
  const I = core.ItemIdentifiers;
  FILLED_ID = I.BOTTOMLESS_MILK_BUCKET;
  EMPTY_ID = I.BOTTOMLESS_MILK_BUCKET_EMPTY_;
  BUCKET_ID = I.BUCKET;
  MILK_ID = I.BUCKET_OF_MILK;
  CHOCOLATE_DUST_ID = I.CHOCOLATE_DUST;
  CHOCOLATEY_MILK_ID = I.CHOCOLATEY_MILK;
  MILK_TYPES = new Map([
    [I.BUCKET_OF_MILK, "regular milk"],
    [I.CHOCOLATEY_MILK, "chocolatey milk"],
    [I.MILKY_MIXTURE, "creamy milk"],
    [I.HANGOVER_CURE, "hangover cure"],
  ]);
}

const isBucket = (item) => item && (item.getId() === FILLED_ID || item.getId() === EMPTY_ID);

function uses(item) {
  if (!item || item.getId() !== FILLED_ID) return 0;
  const value = Math.floor(Number(item.getMetaValue?.(META_KEY)?.uses) || 0);
  return Math.max(0, Math.min(MAX_USES, value));
}

function milkType(item) {
  if (!uses(item)) return null;
  const type = Number(item.getMetaValue(META_KEY).type);
  return MILK_TYPES.has(type) ? type : null;
}

function setContents(item, count, type) {
  const held = Math.max(0, Math.min(MAX_USES, Math.floor(count)));
  item.setId(held > 0 ? FILLED_ID : EMPTY_ID);
  item.setMetaValue(META_KEY, held > 0 ? { uses: held, type } : undefined);
  return item;
}

const carried = (player, item) => player.getInventory().getItems().includes(item);
const plural = (n, word) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

function itemBox(player, itemId, text) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.ItemStatementDialogue(0, itemId, text),
  ));
}

/** Warning boxes on the bucket, then a two-option choice; `accept` runs on the first option. */
function confirm(player, warning, title, yes, no, accept) {
  const chain = new core.DialogueChainBuilder();
  chain.add(new core.ItemStatementDialogue(0, FILLED_ID, warning));
  chain.add(new core.OptionDialogue(1, {
    executeOption(option) {
      player.getDialogueManager().reset();
      if (Number(option) === 1) accept();
    },
  }, yes, no).setTitle(title));
  player.getDialogueManager().startDialogues(chain);
}

function check({ player, item }) {
  if (!isBucket(item)) return;
  const type = milkType(item);
  if (!type) {
    itemBox(player, EMPTY_ID, "Your milk bucket is currently empty.");
    return;
  }
  itemBox(player, FILLED_ID, `Your bottomless milk bucket is currently holding ${plural(uses(item), "use")} of ${MILK_TYPES.get(type)}.`);
}

/** The milk to pour into `bucket`: its own kind, or the first kind carried when it is empty. */
function pourable(player, bucket, offered) {
  const inventory = player.getInventory();
  const own = milkType(bucket);
  const kinds = offered !== undefined ? [offered] : [...MILK_TYPES.keys()];
  const carriedKinds = kinds.filter((id) => inventory.getAmount(id) > 0);
  if (!carriedKinds.length) {
    player.sendMessage("You don't have any milk to fill your bottomless milk bucket with.");
    return null;
  }
  if (own === null) return carriedKinds[0];
  if (carriedKinds.includes(own)) return own;
  player.sendMessage("You don't have any more of this type of milk to fill it with.");
  return null;
}

function fill(player, bucket, offered) {
  if (!isBucket(bucket) || !carried(player, bucket)) return;
  const type = pourable(player, bucket, offered);
  if (type === null) return;
  if (uses(bucket) >= MAX_USES) {
    player.sendMessage("Your bottomless milk bucket is... full.");
    return;
  }
  if (milkType(bucket) === null) {
    confirm(player,
      "If this bucket is emptied later, <col=7f0000>ALL</col> remaining milk inside it will be <col=7f0000>LOST</col>.",
      "Do you wish to proceed?", "Yes.", "No.", () => askAmount(player, bucket, type));
    return;
  }
  askAmount(player, bucket, type);
}

function askAmount(player, bucket, type) {
  if (player.getInventory().getAmount(type) > 1) {
    player.setEnteredAmountAction?.({ execute: (count) => pour(player, bucket, type, Math.floor(Number(count) || 0)) });
    player.getPacketSender().sendEnterAmountPrompt("How much milk would you like to fill the bucket with?");
    return;
  }
  pour(player, bucket, type, 1);
}

function pour(player, bucket, type, wanted) {
  if (!isBucket(bucket) || !carried(player, bucket)) return;
  const own = milkType(bucket);
  if (own !== null && own !== type) return;
  const inventory = player.getInventory();
  const count = Math.min(wanted, inventory.getAmount(type), MAX_USES - uses(bucket));
  if (count < 1) return;
  inventory.deleteNumber(type, count);
  inventory.adds(BUCKET_ID, count);
  setContents(bucket, uses(bucket) + count, type);
  inventory.refreshItems();
  const poured = count === 1 ? "a single bucket" : `${count.toLocaleString("en-US")} buckets`;
  itemBox(player, FILLED_ID, `You fill your bottomless milk bucket with ${poured} of ${MILK_TYPES.get(type)}. Your bottomless milk bucket now contains a total of ${plural(uses(bucket), "use")}.`);
}

function empty({ player, item }) {
  if (item?.getId() !== FILLED_ID) return;
  confirm(player,
    "If you empty the bucket, you will <col=7f0000>DISCARD</col> all of the milk inside it. <col=7f0000>You will NOT reobtain this milk.</col>",
    "Proceed to discard the contents?",
    "Yes - I acknowledge I'll lose all milk within the bucket.", "No - don't proceed.", () => {
      if (!carried(player, item) || item.getId() !== FILLED_ID) return;
      setContents(item, 0);
      player.getInventory().refreshItems();
      itemBox(player, EMPTY_ID, "You discard the contents of your bottomless milk bucket.");
    });
}

function fillOption({ player, item }) {
  fill(player, item);
}

function milkOnBucket(event) {
  const bucket = isBucket(event.usedItem) ? event.usedItem : event.usedWithItem;
  const milk = bucket === event.usedItem ? event.usedWithItemId : event.usedItemId;
  if (!isBucket(bucket) || !MILK_TYPES.has(milk)) return;
  event.handled = true;
  fill(event.player, bucket, milk);
}

/** Unnoted chocolate dust on a bucket of regular milk: one chocolatey milk, no bucket needed. */
function chocolateOnBucket(event) {
  const bucket = event.usedItem?.getId() === FILLED_ID ? event.usedItem : event.usedWithItem;
  if (bucket?.getId() !== FILLED_ID || milkType(bucket) !== MILK_ID) return;
  event.handled = true;
  const inventory = event.player.getInventory();
  inventory.deleteNumber(CHOCOLATE_DUST_ID, 1);
  setContents(bucket, uses(bucket) - 1, MILK_ID);
  inventory.adds(CHOCOLATEY_MILK_ID, 1);
  inventory.refreshItems();
  itemBox(event.player, CHOCOLATEY_MILK_ID, "You mix the chocolate into the bucket.");
}

function holding(player, type) {
  return player.getInventory().getItems().find((item) => milkType(item) === type) ?? null;
}

function holds(event) {
  if (event?.player && holding(event.player, Number(event.type))) event.holds = true;
}

/** A quest takes one use (Wiki: "a single charge will be used ... rather than emptying it"). */
function spend(event) {
  const { player } = event ?? {};
  if (!player || event.spent) return;
  const type = Number(event.type);
  const bucket = event.item && milkType(event.item) === type && carried(player, event.item) ? event.item : holding(player, type);
  if (!bucket) return;
  setContents(bucket, uses(bucket) - 1, type);
  player.getInventory().refreshItems();
  event.spent = true;
}

/** Dairy cows fill an empty bucket or one of regular milk; `full` when the only such bucket is. */
function fillable(event) {
  const { player } = event ?? {};
  if (!player) return;
  for (const item of player.getInventory().getItems()) {
    if (!isBucket(item)) continue;
    const type = milkType(item);
    if (type !== null && type !== MILK_ID) continue;
    if (uses(item) < MAX_USES) {
      event.bucket = item;
      event.full = false;
      return;
    }
    event.full = true;
  }
}

function addMilk(event) {
  const { player, bucket } = event ?? {};
  if (!player || !isBucket(bucket) || !carried(player, bucket)) return;
  const type = milkType(bucket);
  if ((type !== null && type !== MILK_ID) || uses(bucket) >= MAX_USES) return;
  setContents(bucket, uses(bucket) + 1, MILK_ID);
  player.getInventory().refreshItems();
  event.added = true;
  event.full = uses(bucket) >= MAX_USES;
}

module.exports = {
  name: "BottomlessMilkBucket",
  description: "Bottomless milk bucket: holds up to 10,000 uses of one kind of milk, with Check, Fill and Empty; quests and dairy cows use it a use at a time.",
  members: true,
  MAX_USES,
  register(api) {
    api.onServerStartup(initialize.bind(null, api.core));
    api.onItemAction(FILLED_NAME, { Check: check, Fill: fillOption, Empty: empty });
    api.onItemAction(EMPTY_NAME, { Check: check, Fill: fillOption });
    api.onItemOnItem("Bucket of milk", FILLED_NAME, milkOnBucket, { noted: false });
    api.onItemOnItem("Bucket of milk", EMPTY_NAME, milkOnBucket, { noted: false });
    api.onItemOnItem("Chocolatey milk", FILLED_NAME, milkOnBucket, { noted: false });
    api.onItemOnItem("Chocolatey milk", EMPTY_NAME, milkOnBucket, { noted: false });
    api.onItemOnItem("Milky mixture", FILLED_NAME, milkOnBucket, { noted: false });
    api.onItemOnItem("Milky mixture", EMPTY_NAME, milkOnBucket, { noted: false });
    api.onItemOnItem("Hangover cure", FILLED_NAME, milkOnBucket, { noted: false });
    api.onItemOnItem("Hangover cure", EMPTY_NAME, milkOnBucket, { noted: false });
    api.onItemOnItem("Chocolate dust", FILLED_NAME, chocolateOnBucket, { noted: false });
    api.onCustomEvent("bottomless-milk:holds", holds);
    api.onCustomEvent("bottomless-milk:spend", spend);
    api.onCustomEvent("bottomless-milk:fillable", fillable);
    api.onCustomEvent("bottomless-milk:add-milk", addMilk);
  },
};
