import { Item } from "../Item";
import type { Player } from "../../entity/impl/player/Player";

import { StackType } from "./StackType";
// Avoid eager imports here to prevent circular dependency when containers extend ItemContainer.
// Use dynamic requires in methods where needed.
const placeholder = (name: string) => {
  const fn: any = function Placeholder() {};
  fn.__placeholder = true;
  fn.displayName = name;
  return fn;
};

let Bank: any = placeholder("Bank");
let Inventory: any = placeholder("Inventory");
let Equipment: any = placeholder("Equipment");

const ensureContainersLoaded = () => {
  if (!Bank || Bank.__placeholder) {
    try {
      Bank = require("./impl/Bank").Bank;
    } catch { /* ignore circular failures */ }
  }
  if (!Inventory || Inventory.__placeholder) {
    try {
      Inventory = require("./impl/Inventory").Inventory;
    } catch { /* ignore circular failures */ }
  }
  if (!Equipment || Equipment.__placeholder) {
    try {
      Equipment = require("./impl/Equipment").Equipment;
    } catch { /* ignore circular failures */ }
  }
};
// Lazy requires to dodge circular deps during bootstrap.
const getItemDefinition = () => require("../../definition/ItemDefinition").ItemDefinition as typeof import("../../definition/ItemDefinition").ItemDefinition;
const getItemOnGroundManager = () => require("../../entity/impl/grounditem/ItemOnGroundManager").ItemOnGroundManager as typeof import("../../entity/impl/grounditem/ItemOnGroundManager").ItemOnGroundManager;

export abstract class ItemContainer {
  public player: Player;
  public items: Item[] = new Array(this.capacity());

  constructor(capacity?: number);
  constructor(player?: Player, capacity?: number);
  constructor(arg1?: Player | number, arg2?: number) {
    // Detect player arg without pulling Player class at runtime (breaks circular dep).
    if (arg1 && typeof (arg1 as any).getUsername === "function") {
      this.player = arg1 as Player;
      this.items = new Array(arg2 || 0);
    } else if (typeof arg1 === "number") {
      this.items = new Array(arg1);
    } else {
      this.items = new Array(0);
    }
    for (let i = 0; i < this.capacity(); i++) {
      this.items[i] = new Item(-1, 0);
    }
  }

  abstract capacity(): number;

  abstract stackType(): StackType;

  abstract refreshItems(): ItemContainer;

  abstract full(): ItemContainer;

  public getPlayer(): Player {
    return this.player;
  }

  public setPlayer(player: Player): ItemContainer {
    this.player = player;
    return this;
  }

  public getItems(): Item[] {
    return this.items;
  }

  public getItemIdsArray(): number[] {
    let array = new Array(this.items.length);
    for (let i = 0; i < this.items.length; i++) {
      array[i] = this.items[i].getId();
    }
    return array;
  }

  public setItems(items: Item[]): ItemContainer {
    this.items = items;
    return this;
  }

  public getCopiedItems(): Item[] {
    let it: Item[] = new Array(this.items.length);
    for (let i = 0; i < it.length; i++) {
      it[i] = this.items[i].clone();
    }
    return it;
  }

  public getValidItems(): Item[] {
    ensureContainersLoaded();
    let items: Item[] = [];
    for (let item of this.items) {
      if (item != null && item.getId() > 0) {
        if (
          item.getAmount() > 0 ||
          (this instanceof Bank && item.getAmount() == 0)
        ) {
          items.push(item);
        }
      }
    }
    return items;
  }

  public getValidItemsArray(): Item[] {
    let items = this.getValidItems();
    let array: Item[] = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      array[i] = items[i];
    }
    return array;
  }

  public copyValidItemsArray(): Item[] {
    let items = this.getValidItems();
    let array: Item[] = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      array[i] = items[i].clone();
    }
    return array;
  }

  public setItem(slot: number, item: Item): ItemContainer {
    this.items[slot] = item;
    return this;
  }

  public isSlotOccupied(slot: number): boolean {
    return (
      this.items[slot] != null &&
      this.items[slot].getId() > 0 &&
      this.items[slot].getAmount() > 0
    );
  }

  public swap(fromSlot: number, toSlot: number): ItemContainer {
    let temporaryItem = this.getItems()[fromSlot];
    if (temporaryItem == null || temporaryItem.getId() <= 0) {
      return this;
    }
    this.setItem(fromSlot, this.getItems()[toSlot]);
    this.setItem(toSlot, temporaryItem);
    return this;
  }

  public shiftSwap(fromSlot: number, toSlot: number): ItemContainer {
    let temporaryItem = this.getItems()[fromSlot];
    if (temporaryItem == null || temporaryItem.getId() <= 0) {
      return this;
    }
    return this;
  }

  public getFreeSlots(): number {
    let space = 0;
    for (let item of this.items) {
      if (item.getId() == -1) {
        space++;
      }
    }
    return space;
  }

  public isFull(): boolean {
    return this.getEmptySlot() == -1;
  }

  public isEmpty(): boolean {
    return this.getFreeSlots() == this.capacity();
  }

  public containsNumber(id: number): boolean {
    for (let items of this.items) {
      if (items.getId() == id) {
        return true;
      }
    }
    return false;
  }

  public containsItem(item: Item): boolean {
    return this.getAmount(item.getId()) >= item.getAmount();
  }

  public containsArray(item: Item[]): boolean {
    if (item.length == 0) {
      return false;
    }

    for (let nextItem of item) {
      if (nextItem == null) {
        continue;
      }

      if (!this.containsNumber(nextItem.getId())) {
        return false;
      }
    }
    return true;
  }

  public containsAnyIds(itemIds: number[]): boolean {
    if (itemIds.length == 0 || this.isEmpty()) {
      return false;
    }

    for (let itemId of itemIds) {
      if (itemId == -1) {
        continue;
      }

      if (this.containsNumber(itemId)) {
        return true;
      }
    }
    return false;
  }

  public getEmptySlot(): number {
    ensureContainersLoaded();
    for (let i = 0; i < this.capacity(); i++) {
      if (
        this.items[i].getId() <= 0 ||
        (this.items[i].getAmount() <= 0 && !(this instanceof Bank))
      ) {
        return i;
      }
    }
    return -1;
  }

  public getSlot(slotId: number): number {
    if (this.items.length < slotId || !this.items[slotId].isValid()) {
      return -1;
    }

    return this.items[slotId].getId();
  }

  public getSlotForItemId(id: number): number {
    for (let i = 0; i < this.capacity(); i++) {
      if (this.items[i].getId() == id) {
        if (
          this.items[i].getAmount() > 0 ||
          (this instanceof Bank && this.items[i].getAmount() == 0)
        ) {
          return i;
        }
      }
    }
    return -1;
  }

  public getAmount(id: number): number {
    let totalAmount = 0;
    for (let item of this.items) {
      if (item.getId() == id) {
        totalAmount += item.getAmount();
      }
    }
    return totalAmount;
  }

  getAmountForSlot(slot: number): number {
    return this.items[slot].getAmount();
  }

  resetItems(): ItemContainer {
    for (let i = 0; i < this.capacity(); i++) {
      this.items[i] = new Item(-1, 0);
    }
    return this;
  }

  forSlot(slot: number): Item {
    return this.items[slot];
  }

  public switchItem(
    to: ItemContainer,
    item: Item,
    sort: boolean,
    slot: number,
    refresh: boolean
  ): ItemContainer {
    ensureContainersLoaded();
    if (this.getItems()[slot].getId() !== item.getId()) {
      return this;
    }

    if (
      to.getFreeSlots() <= 0 &&
      !(to.containsNumber(item.getId()) && item.getDefinition().isStackable())
    ) {
      to.full();
      return this;
    }

    if (
      (this instanceof Inventory || this instanceof Equipment) &&
      to instanceof Bank
    ) {
      if (
        to.getAmount(item.getId()) + item.getAmount() >
          Number.MAX_SAFE_INTEGER ||
        to.getAmount(item.getId()) + item.getAmount() <= 0
      ) {
        item.setAmount(Number.MAX_SAFE_INTEGER - to.getAmount(item.getId()));
        if (item.getAmount() <= 0) {
          this.getPlayer().sendMessage(
            "You cannot deposit that entire amount into your bank."
          );
          return this;
        }
      }
    }

    this.deleteItemContainer(item, slot, refresh, to);

    // Noted items should not be in bank. Un-note if it's noted. The unnoted
    // id comes from the cache: it is not always the noted id minus one.
    if (to instanceof Bank) {
      item.setId(getItemDefinition().forId(item.getId()).unNote());
    }

    to.add(item, refresh);

    if (sort && this.getAmount(item.getId()) <= 0) {
      this.sortItems();
    }

    if (refresh) {
      this.refreshItems();
      to.refreshItems();
    }

    // Add item to bank search aswell!!
    if (to instanceof Bank) {
      if (this.getPlayer().isSearchingBank()) {
        Bank.addToBankSearch(this.getPlayer(), item, false);
      }
    }

    return this;
  }

  public switchItems(
    to: ItemContainer,
    item: Item,
    sort: boolean,
    refresh?: boolean
  ): ItemContainer {
    ensureContainersLoaded();
    if (
      to.getFreeSlots() <= 0 &&
      !(to.containsNumber(item.getId()) && item.getDefinition().isStackable())
    ) {
      to.full();
      return this;
    }
    let proper_amt = this.getAmount(item.getId());

    if (item.getAmount() > proper_amt) {
      item.setAmount(proper_amt);
    }

    if (item.getAmount() <= 0) {
      return this;
    }

    this.deleteBoolean(item, refresh);

    // Noted items should not be in bank.
    if (to instanceof Bank) {
      item.setId(getItemDefinition().forId(item.getId()).unNote());
    }

    to.add(item, refresh);

    if (sort && this.getAmount(item.getId()) <= 0) {
      this.sortItems();
    }
    if (refresh) {
      this.refreshItems();
      to.refreshItems();
    }
    return this;
  }

  /*
   * Checks if container is full
   */
  public fullBoolean(itemId: number): boolean {
    return (
      this.getFreeSlots() <= 0 &&
      !(
        this.containsNumber(itemId) &&
        getItemDefinition().forId(itemId).isStackable()
      )
    );
  }

  public addItems(items: Item[], refresh: boolean): ItemContainer {
    if (items == null) {
      return this;
    }
    for (let item of items) {
      if (
        item.getId() > 0 &&
        (item.getAmount() > 0 ||
          (item.getAmount() == 0 && this instanceof Bank))
      ) {
        this.add(item, refresh);
      }
    }
    return this;
  }

  public sortItems(): ItemContainer {
    for (let k = 0; k < this.capacity(); k++) {
      if (this.getItems()[k] == null) {
        continue;
      }
      for (let i = 0; i < this.capacity() - 1; i++) {
        if (
          this.getItems()[i] == null ||
          this.getItems()[i].getId() <= 0 ||
          (this.getItems()[i].getAmount() <= 0 && !(this instanceof Bank))
        ) {
          this.swap(i + 1, i);
        }
      }
    }
    return this;
  }

  /**
   * Adds an item to the item container.
   *
   * @param item The item to add.
   * @return The ItemContainer instance.
   */
  public addItem(item: Item): ItemContainer {
    return this.add(item, true);
  }

  /**
   * Adds an item to the item container.
   *
   * @param id     The id of the item.
   * @param amount The amount of the item.
   * @return The ItemContainer instance.
   */

  public adds(id: number, amount: number): ItemContainer {
    return this.addItem(new Item(id, amount));
  }

  public add(item: Item, refresh: boolean): ItemContainer {
    ensureContainersLoaded();
    if (
      item.getId() <= 0 ||
      (item.getAmount() <= 0 && !(this instanceof Bank))
    ) {
      return this;
    }
    if (
      getItemDefinition().forId(item.getId()).isStackable() ||
      this.stackType() == StackType.STACKS
    ) {
      let slot = -1;
      for (let i = 0; i < this.capacity(); i++) {
        if (this.items[i].getId() !== item.getId()) {
          continue;
        }
        if (
          JSON.stringify(this.items[i].getMeta() ?? null) ===
          JSON.stringify(item.getMeta() ?? null)
        ) {
          slot = i;
          break;
        }
      }
      if (slot == -1) {
        slot = this.getEmptySlot();
      }
      if (slot == -1) {
        if (this.getPlayer() != null) {
          this.getPlayer().sendMessage("You couldn't hold all those items.");
        }
        if (refresh) {
          this.refreshItems();
        }
        return this;
      }
      let totalAmount = this.items[slot].getAmount() + item.getAmount();
      this.items[slot].setId(item.getId());
      this.items[slot].setMeta(item.getMeta());
      if (totalAmount > Number.MAX_SAFE_INTEGER) {
        this.items[slot].setAmount(Number.MAX_SAFE_INTEGER);
      } else {
        this.items[slot].setAmount(
          this.items[slot].getAmount() + item.getAmount()
        );
      }
    } else {
      let amount = item.getAmount();
      while (amount > 0) {
        let slot = this.getEmptySlot();
        if (slot == -1) {
          this.getPlayer().sendMessage("You couldn't hold all those items.");
          if (refresh) {
            this.refreshItems();
          }
          return this;
        } else {
          this.items[slot] = item.clone().setAmount(1);
        }
        amount--;
      }
    }
    if (refresh) {
      this.refreshItems();
    }
    return this;
  }

  public deletes(item: Item): ItemContainer {
    return this.deleteNumber(item.getId(), item.getAmount());
  }

  /**
   * Deletes an item from the item container.
   *
   * @param item The item to delete.
   * @param slot The slot of the item (used to delete the item from said slot, not
   *             the first one found).
   * @return The ItemContainer instance.
   */

  public deleteItem(item: Item, slot: number): ItemContainer {
    return this.deletedItem(item, slot, true);
  }

  /**
   * Deletes from an exact slot instead of the first matching item id.
   * Use this after packet decoding has already validated the clicked slot.
   */
  public deleteAtSlot(slot: number, amount = 1, refresh = true): ItemContainer {
    if (slot < 0 || slot >= this.capacity()) {
      return this;
    }

    const item = this.items[slot];
    if (!item || item.getId() <= 0 || item.getAmount() <= 0) {
      return this;
    }

    const deleteAmount = Math.max(0, Math.min(amount, item.getAmount()));
    if (deleteAmount <= 0) {
      return this;
    }

    return this.deletedItem(new Item(item.getId(), deleteAmount), slot, refresh);
  }

  /**
   * Deletes an item from the item container.
   *
   * @param id     The id of the item to delete.
   * @param amount The amount of the item to delete.
   * @return The ItemContainer instance.
   */
  public delete(id: number, amount: number): ItemContainer {
    return this.deleted(id, amount, true);
  }
  public deleteNumber(id: number, amount: number): ItemContainer {
    return this.deleted(id, amount, true);
  }

  public deleteBoolean(item: Item, refresh: boolean): ItemContainer {
    return this.deleted(item.getId(), item.getAmount(), refresh);
  }
  /**
   * Deletes an item from the item container.
   *
   * @param id      The id of the item to delete.
   * @param amount  The amount of the item to delete.
   * @param refresh If <code>true</code> the item container interface will refresh.
   * @return The ItemContainer instance.
   */
  public deleted(id: number, amount: number, refresh: boolean): ItemContainer {
    return this.deletedItem(
      new Item(id, amount),
      this.getSlotForItemId(id),
      refresh
    );
  }

  public deletedItem(item: Item, slot: number, refresh: boolean) {
    return this.deleteItemContainer(item, slot, refresh, null);
  }

  public deleteItemContainer(
    item: Item,
    slot: number,
    refresh: boolean,
    toContainer: ItemContainer
  ): ItemContainer {
    if (
      item.getId() <= 0 ||
      (item.getAmount() <= 0 && !(this instanceof Bank)) ||
      slot < 0
    ) {
      return this;
    }
    // Only items with a cache placeholder leave one.
    let leavePlaceHolder =
      toContainer instanceof Inventory &&
      this instanceof Bank &&
      this.getPlayer().isPlaceholders() &&
      getItemDefinition().forId(item.getId()).getPlaceholderId() >= 0;
    if (item.getAmount() > this.getAmount(item.getId())) {
      item.setAmount(this.getAmount(item.getId()));
    }
    if (
      item.getDefinition().isStackable() ||
      this.stackType() == StackType.STACKS
    ) {
      this.items[slot].setAmount(
        this.items[slot].getAmount() - item.getAmount()
      );
      if (this.items[slot].getAmount() < 1) {
        this.items[slot].setAmount(0);
        if (!leavePlaceHolder) {
          this.items[slot].setId(-1);
          this.items[slot].setMeta(null);
        }
      }
    } else {
      let amount = item.getAmount();
      while (amount > 0) {
        if (slot == -1 || (toContainer != null && toContainer.isFull())) {
          break;
        }
        if (!leavePlaceHolder) {
          this.items[slot].setId(-1);
          this.items[slot].setMeta(null);
        }
        this.items[slot].setAmount(0);
        slot = this.getSlotForItemId(item.getId());
        amount--;
      }
    }
    if (refresh) {
      this.refreshItems();
    }
    return this;
  }

  public deleteItemAny(optional?: Item[]) {
    if (optional) {
      for (let deleteItem of optional) {
        if (!deleteItem) {
          continue;
        }
        this.deletes(deleteItem);
      }
    }
  }

  getById(id: number): Item | null {
    for (let i = 0; i < this.items.length; i++) {
      if (!this.items[i]) {
        continue;
      }
      if (this.items[i].id === id) {
        return this.items[i];
      }
    }
    return null;
  }

  public contains(id: number): boolean {
    for (const item of this.items) {
      if (item.getId() === id) {
        return true;
      }
    }
    return false;
  }
  containsAllAny(ids: number[]): boolean {
    return ids.every((id) => this.containsNumber(id));
  }

  containsAllItem(items: Item[]): boolean {
    return items
      .filter((item) => item)
      .every((item) => this.containsNumber(item.id));
  }

  containsAny(ids: number[]): boolean {
    return ids.some((id) => this.containsNumber(id));
  }

  set(slot: number, item: Item) {
    this.items[slot] = item;
  }

  get(slot: number): Item | undefined {
    return this.items[slot];
  }

  isSlotFree(slot: number): boolean {
    return !this.items[slot] || this.items[slot].id === -1;
  }

  toSafeArray(): Item[] {
    return this.items.filter((item) => item) as Item[];
  }

  moveItems(to: ItemContainer, refreshOrig = true, refreshTo = true) {
    for (let it of this.getValidItems()) {
      if (
        to.getFreeSlots() <= 0 &&
        !(to.containsNumber(it.id) && it.getDefinition().isStackable())
      ) {
        break;
      }
      to.add(it, false);
      this.deleted(it.id, it.amount, false);
    }

    if (refreshOrig) {
      this.refreshItems();
    }
    if (refreshTo) {
      to.refreshItems();
    }
  }

  addItemSet(item: Item[]) {
    for (let addItem of item) {
      if (!addItem) {
        continue;
      }
      this.addItem(addItem);
    }
  }

  deleteItemSet(optional: Item[]) {
    let deleteItem: Item;
    for (deleteItem of optional) {
      if (deleteItem == null) {
        continue;
      }
      this.deletes(deleteItem);
    }
  }

  forceAdd(player: Player, item: Item) {
    if (
      this.getFreeSlots() <= 0 &&
      !(this.containsNumber(item.id) && item.getDefinition().isStackable())
    ) {
      // Drop once at the reward location. Ground-stack merging must not mutate the reward item.
      getItemOnGroundManager().registers(player, item.clone());
    } else {
      this.addItem(item);
    }
  }

  getTotalValue(): string {
    let value = 0;

    for (let item of this.getValidItems()) {
      value += item.getDefinition().getValue() * item.amount;
    }

    if (value >= Number.MAX_SAFE_INTEGER) {
      return "Too High!";
    }

    return value.toString();
  }

  hasAts(slot: number, item: number): boolean {
    let at = this.items[slot];
    return at != null && at.id === item;
  }

  hasAt(slot: number): boolean {
    return slot >= 0 && slot < this.items.length && this.items[slot] != null;
  }
}
