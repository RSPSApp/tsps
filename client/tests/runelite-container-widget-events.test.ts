import { strict as assert } from "node:assert";
import { ItemContainerChanged, WidgetLoaded } from "@runelite/api/events";
import * as InventoryID from "@runelite/api/gameval/InventoryID";
import { Inventory } from "../rs/inventory/Inventory";
import { bindContainerEvents, bindWidgetEvents } from "../runelite/impl/ContainerEventSource";

// RuneLite's ItemContainerChanged and WidgetLoaded, posted from the client's own stores: the
// inventory (93) and worn equipment (94) Inventory objects, and the widget manager's group loads.

const inventory = new Inventory(28);
const equipment = new Inventory(14);
const groupLoadedListeners = new Set<(groupId: number) => void>();
const client: any = { inventory, equipment, widgetManager: { groupLoadedListeners } };

const posted: object[] = [];
const containerEvents = () => posted.filter((e): e is ItemContainerChanged => e instanceof ItemContainerChanged);

// --- Item containers -----------------------------------------------------------------------------
const unbindContainers = bindContainerEvents(client, (e) => posted.push(e));
const afterBind = containerEvents().length;
assert.ok(afterBind <= 2, "binding may post the current contents once per container, nothing more");

inventory.setSlot(0, 952, 1); // a spade
let events = containerEvents().slice(afterBind);
assert.equal(events.length, 1, "one slot change posts one ItemContainerChanged");
assert.equal(events[0].getContainerId(), InventoryID.INV, "the backpack is RuneLite's INV (93)");
assert.ok(events[0].getItemContainer().contains(952), "the container sees the spade");
assert.equal(events[0].getItemContainer().getId(), InventoryID.INV);

const items = events[0].getItemContainer().getItems();
assert.equal(items.length, 28, "one Item per slot, as RuneLite's slot-indexed array");
assert.equal(items[0].getId(), 952);
assert.equal(items[0].getQuantity(), 1);
assert.equal(items[1].getId(), -1, "an empty slot is Item(-1, 0)");
assert.equal(items[1].getQuantity(), 0);

inventory.setSlot(5, 995, 1000);
inventory.setSlot(6, 995, 24);
assert.equal(containerEvents().slice(-1)[0].getItemContainer().count(995), 1024, "count sums every slot of the item");

const before = containerEvents().length;
inventory.setSnapshot([{ slot: 0, itemId: 23182, quantity: 1 }]);
assert.equal(containerEvents().length, before + 1, "a snapshot posts once");
assert.ok(containerEvents().slice(-1)[0].getItemContainer().contains(23182));
assert.ok(!containerEvents().slice(-1)[0].getItemContainer().contains(952), "the snapshot replaced the spade");

inventory.setSelectedSlot(3);
assert.equal(containerEvents().length, before + 1, "selecting a slot is not a container change");

equipment.setSlot(0, 1163, 1); // a helmet in the head slot
const worn = containerEvents().slice(-1)[0];
assert.equal(worn.getContainerId(), InventoryID.WORN, "worn equipment is RuneLite's WORN (94)");
assert.equal(worn.getItemContainer().getItems().length, 14);
assert.equal(worn.getItemContainer().getItems()[0].getId(), 1163);

unbindContainers();
const afterUnbind = containerEvents().length;
inventory.setSlot(1, 952, 1);
assert.equal(containerEvents().length, afterUnbind, "unbinding stops the posts");

// --- Widget groups -------------------------------------------------------------------------------
const unbindWidgets = bindWidgetEvents(client, (e) => posted.push(e));
for (const listener of groupLoadedListeners) listener(203);
const loaded = posted.filter((e): e is WidgetLoaded => e instanceof WidgetLoaded);
assert.equal(loaded.length, 1);
assert.equal(loaded[0].getGroupId(), 203, "trail_cluetext loaded");

unbindWidgets();
assert.equal(groupLoadedListeners.size, 0, "unbinding removes the listener");

console.log("runelite-container-widget-events: ok");
