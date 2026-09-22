import { encodePlayerOption } from "../protocol/ClientProtocol";
import { BIT_MASKS } from "../../game/cache/codec/rs/MathConstants";
import { PacketBuilder } from "./PacketBuilder";
import { ValueType } from "./ValueType";
import { ByteOrder } from "./ByteOrder";
import { PacketType } from "./PacketType";
import { PlayerStatus } from "../../game/model/PlayerStatus";
import { Flag } from "../../game/model/Flag";
import { Skill } from "../../game/model/Skill";
import { Location } from "../../game/model/Location";
import { DonatorRights } from "../../game/model/rights/DonatorRights";
import { InterfaceLayoutRegistry } from "../../game/definition/InterfaceLayoutDefinition";
import { Misc } from "../../util/Misc";
import {
  encodeBankSnapshot,
  encodeChatMessage,
  encodeContentData,
  encodeDestination,
  encodeGroundItems,
  encodeGroundItemsDelta,
  encodeLocAddChange,
  encodeLocAnim,
  encodeLocDel,
  encodeInventorySlot,
  encodeInventorySnapshot,
  encodePlayJingle,
  encodePlaySong,
  encodeProjectiles,
  encodeRunClientScript,
  encodeRunEnergy,
  encodeSkillsDelta,
  encodeSkillsSnapshot,
  encodeSound,
  encodeVarbit,
  encodeVarp,
  encodeWidgetClose,
  encodeWidgetCloseSub,
  encodeWidgetOpen,
  encodeWidgetOpenSub,
  encodeWidgetRunScript,
  encodeWidgetSetAnimation,
  encodeWidgetSetFlags,
  encodeWidgetSetFlagsRange,
  encodeWidgetSetHidden,
  encodeWidgetSetItem,
  encodeWidgetSetModel,
  encodeWidgetSetNpcHead,
  encodeWidgetSetPlayerHead,
  encodeWidgetSetRoot,
  encodeWidgetSetText,
  type ScriptInventorySnapshot,
  MAIN_INVENTORY_GROUP_ID,
  MAIN_INVENTORY_SLOT_FLAGS,
  MAIN_INVENTORY_WIDGET_UID,
  SkillView,
  GroundItemView,
  BankSlotView,
} from "../protocol/ClientProtocol";
import {
  packWorldMapCoord,
  WORLD_MAP_GROUP_ID,
  WORLD_MAP_TARGET_UID,
} from "../protocol/WorldMapProtocol";
import { CacheDefinitions } from "../../game/cache/CacheDefinitions";
const CHATBOX_MODAL_TARGET_UID = (162 << 16) | 567;
const MAIN_MODAL_TARGET_UID = (161 << 16) | 16;
const VARBIT_MULTICOMBAT_AREA = 4605;
// Quest completion states consulted by spellbook CS2 scripts. Keep these client
// flags separate from server-side spell casting so quests can be enforced later.
// These are the state variables used by this cache's spell definitions. Values
// are deliberately at their completed state: the server does not enforce quest
// requirements yet, but the client must still render the spell as available.
const SPELL_UNLOCK_VARPS: ReadonlyArray<readonly [number, number]> = [
  [68, 0x7fffffff],   // Plague City (West Ardougne Teleport)
  [139, 180],
  [161, 0x7fffffff],  // Underground Pass (Iban Blast)
  [165, 0x7fffffff],  // Plague City (Ardougne Teleport)
  [212, 0x7fffffff],  // Watchtower
  [267, 0x7fffffff],  // Mage Arena (god spells and Charge)
  [302, 0x7fffffff],  // Priest in Peril (Arceuus Morytania teleports)
  [335, 0x7fffffff],  // Eadgar's Ruse (Trollheim Teleport)
  [365, 0x7fffffff],  // Monkey Madness I (Ape Atoll Dungeon Teleport)
  [440, 15],
  [823, 190],         // Lunar Diplomacy's direct spellbook state
  [980, 0x7fffffff],  // The Great Brain Robbery (Harmony Island Teleport)
  [1003, 0x7fffffff], // Mage Arena spellbook refresh dependency
];
const SPELL_UNLOCK_VARBITS: ReadonlyArray<readonly [number, number]> = [
  [358, 0x7fffffff],   // Desert Treasure (Ancient spellbook)
  [2448, 0x7fffffff],  // Lunar Diplomacy (Lunar spells)
  [3618, 0x7fffffff],  // Dream Mentor
  [1914, 50],           // Recipe for Disaster (Ape Atoll Teleport)
  [4533, 1],           // Fremennik hard diary (Tan Leather / Recharge Dragonstone)
  [1505, 1],           // Bones to Peaches client unlock
  [4554, 30],          // Mage Training Arena (Bones to Peaches)
  [4896, 1000],
  [6067, 6],
  [5619, 9],           // Client of Kourend
  [9133, 1],
  [9631, 1],
  [9649, 127],         // Twilight's Promise (Civitas illa Fortis Teleport)
  [12296, 0x7fffffff], // Arceuus spell requirements
  [18314, 6],          // Sailing spell teleports
];
// The native OSRS "skillmulti" production list (clientscript 2046, group 270) mounted into
// the chatbox modal slot - same interface smelting/smithing use. Exported so NetworkBuilder
// can recognize clicks against it without duplicating these numbers.
export const CREATION_MENU_GROUP_ID = 270;
export const CREATION_MENU_FIRST_ITEM_COMPONENT = 15;
export const CREATION_MENU_MAX_QUANTITY = 28;
export const CREATION_MENU_CHATMODAL_UNCLAMP_VARBIT = 10670;
// Widget transmit flags: bit (opIndex+1) must be set for that op to reach the server (see
// WidgetActionRouter.shouldTransmitAction on the client) - ops 1-5 are Make 1/5/10/X/All.
const CREATION_MENU_OP_FLAGS = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5);

export class PacketSender {
  private groundItemSerial = 0;
  private readonly varps = new Map<number, number>();
  private subInterfaceTargets = new Map<number, { targetUid: number; type: number }>();
  private chatboxGroupId = -1;
  private player: any;
  constructor(player: any) {
    this.player = player;
  }

  sendLogout(): this {
    const out = new PacketBuilder(109);
    this.player.getSession().write(out);
    return this;
  }

  sendSystemUpdate(time: number): this {
    const out = new PacketBuilder(114);
    const byteOrder = ByteOrder.LITTLE;
    out.putShorts(time, byteOrder);
    this.player.getSession().write(out);
    return this;
  }

  sendSpecialAttackState(active: boolean): this {
    return this.sendConfig(301, active ? 1 : 0);
  }

  sendSoundEffect(
    soundId: number,
    loopType: number,
    delay: number,
    volume: number
  ): this {
    if (this.player.getSession().sendClientPacket(encodeSound(soundId, {
      loops: Math.max(1, loopType),
      delay,
    }))) return this;
  }

  sendSound(soundId: number, volume: number, delay: number): this {
    // The web client decodes SFX on opcode 174 only.
    // Sending opcode 175 makes the client treat it as an unknown packet and drop.
    return this.sendSoundEffect(soundId, 1, delay, volume);
  }

  sendSong(id: number): this {
    if (this.player.getSession().sendClientPacket(encodePlaySong(id))) return this;
  }

  sendJingle(id: number, delayTicks: number): this {
    if (this.player.getSession().sendClientPacket(encodePlayJingle(id, delayTicks))) return this;
  }

  sendAreaSound(
    soundId: number,
    x: number,
    y: number,
    level: number,
    loops = 1,
    delay = 0,
    radius = 0,
    attenuation = 0
  ): this {
    this.player.getSession().sendClientPacket(encodeSound(soundId, {
      x, y, level, loops, delay, radius, attenuation,
    }));
    return this;
  }

  sendEnableNoclip(): this {
    const out = new PacketBuilder(250);
    this.player.getSession().write(out);
    return this;
  }

  sendURL(url: string): this {
    const out = new PacketBuilder(251, PacketType.VARIABLE);
    out.putString(url);
    this.player.getSession().write(out);
    return this;
  }

  sendSpecialMessage(name: string, type: number, message: string): this {
    if (this.player.getSession().sendClientPacket(encodeChatMessage(
      type === 16 ? "clan" : "channel", message, name
    ))) return this;
  }

  sendPoisonType(type: number): this {
    this.player.getSession().write(new PacketBuilder(184).put(type));
    return this;
  }

  getVarp(id: number): number {
    return this.varps.get(id) ?? 0;
  }

  getVarbit(id: number): number {
    const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
    return (this.getVarp(baseVar) >> startBit) & BIT_MASKS[endBit - startBit];
  }

  sendConfig(id: number, state: number): this {
    this.varps.set(id, state | 0);
    this.player.getSession().sendClientPacket(encodeVarp(id, state));
    return this;
  }

  sendToggle(id: number, state: number): this {
    return this.sendConfig(id, state);
  }

  sendChatOptions(
    publicChat: number,
    privateChat: number,
    tradeChat: number
  ): this {
    const out = new PacketBuilder(206);
    out.put(publicChat).put(privateChat).put(tradeChat);
    this.player.getSession().write(out);
    return this;
  }

  public sendRunEnergy(): this {
    if (this.player.getSession().sendClientPacket(encodeRunEnergy(
      this.player.getRunEnergy(), this.player.isRunningReturn()
    ))) return this;
  }

  sendQuickPrayersState(activated: boolean): this {
    return this.sendVarbit(4103, activated ? 1 : 0);
  }

  updateSpecialAttackOrb(): this {
    return this.sendConfig(300, this.player.getSpecialPercentage() * 10);
  }

  sendShowClanChatOptions(show: boolean): this {
    const out = new PacketBuilder(115);
    out.put(show ? 1 : 0); // 0 = no right click options
    this.player.getSession().write(out);
    return this;
  }

  sendRunStatus(): this {
    if (this.player.getSession().sendClientPacket(encodeRunEnergy(
      this.player.getRunEnergy(), this.player.isRunningReturn()
    ))) return this;
  }

  sendInterface(id: number): this {
    this.player.setInterfaceId(id);
    if (this.player.isPlayerBot()) {
      return this;
    }

    return this.sendSubInterface(MAIN_MODAL_TARGET_UID, id, 0);
  }

  public sendConfiguredInterface(reference: string | number): this {
    InterfaceLayoutRegistry.open(this, reference);
    return this;
  }

  sendWalkableInterface(interfaceId: number): this {
    this.player.setWalkableInterfaceId(interfaceId);
    if (this.player.getSession().sendClientPacket(encodeWidgetOpen(interfaceId, false))) return this;
  }

  sendInterfaceDisplayState(interfaceId: number, hide: boolean): this {
    if (this.player.getSession().sendClientPacket(encodeWidgetSetHidden(interfaceId, hide))) return this;
  }

  public sendPlayerHeadOnInterface(id: number): PacketSender {
    if (this.player.getSession().sendClientPacket(encodeWidgetSetPlayerHead(id))) return this;
  }

  public sendNpcHeadOnInterface(id: number, interfaceId: number): PacketSender {
    if (this.player.getSession().sendClientPacket(encodeWidgetSetNpcHead(interfaceId, id))) return this;
  }

  // Real OSRS clientscript IDs (mesLayerMode7/mesLayerMode9), confirmed against
  // OpenRune-Server's ProtectedAccess.countDialog()/stringDialog() - runClientScript(108, title)
  // opens the numeric "enter amount" prompt (resolved via resume_countdialog), runClientScript(110,
  // title, mode) opens the free-text prompt (resolved via resume_namedialog/resume_stringdialog).
  public sendEnterAmountPrompt(title: string): PacketSender {
    return this.sendClientScript(108, title);
  }

  public sendEnterInputPrompt(title: string): PacketSender {
    return this.sendClientScript(110, title, 0);
  }

  public sendExit(): PacketSender {
    const out = new PacketBuilder(62);
    this.player.getSession().write(out);
    return this;
  }

  public sendInterfaceComponentMoval(
    x: number,
    y: number,
    id: number
  ): PacketSender {
    const out = new PacketBuilder(70);
    out.putShort(x);
    out.putShort(y);
    out.putShorts(id, ByteOrder.LITTLE);
    this.player.getSession().write(out);
    return this;
  }

  public sendInterfaceAnimation(interfaceId: number, animationId: number) {
    if (this.player.getSession().sendClientPacket(encodeWidgetSetAnimation(interfaceId, animationId))) return this;
  }

  public sendInterfaceRawModel(interfaceId: number, modelId: number): this {
    this.player.getSession().sendClientPacket(encodeWidgetSetModel(interfaceId, modelId));
    return this;
  }

  public sendInterfaceModel(interfaceId: number, itemId: number, zoom: number) {
    if (this.player.getSession().sendClientPacket(encodeWidgetSetItem(interfaceId, itemId, 1))) return this;
  }

  public sendTabInterface(tabId: number, interfaceId: number) {
    if (tabId === 0) {
      const targetUid = (161 << 16) | 76;
      return this
        .closeSubInterface(targetUid)
        .sendSubInterface(targetUid, 593)
        .sendInterfaceDisplayState((593 << 16) | 23, false)
        .sendInterfaceDisplayState((593 << 16) | 28, false);
    }
    if (tabId === 5) {
      this.player.getSession().sendClientPacket(encodeWidgetOpenSub(
        (161 << 16) | 81,
        interfaceId === 17200 ? 77 : 541
      ));
      return this;
    }
    if (tabId === 6) {
      const spellbook = interfaceId === 12855 ? 1 : interfaceId === 29999 ? 2 : interfaceId === 39999 ? 3 : 0;
      // A varbit can share storage with a quest varp. Send all varbits first,
      // then the canonical quest varps so their exact completion stages win.
      for (const [id, value] of SPELL_UNLOCK_VARBITS) {
        this.sendVarbit(id, value);
      }
      for (const [id, value] of SPELL_UNLOCK_VARPS) {
        this.sendConfig(id, value);
      }
      this.sendVarbit(4070, spellbook);
      this.player.getSession().sendClientPacket(encodeWidgetOpenSub((161 << 16) | 82, 218));
      return this;
    }
    this.player.getSession().sendClientPacket(encodeWidgetOpenSub((161 << 16) | tabId, interfaceId));
    return this;
  }

  public sendSidebarInterface(interfaceId: number): PacketSender {
    if (this.player.getSession().sendClientPacket(encodeWidgetOpen(interfaceId, false))) return this;
  }

  public sendTab(id: number): PacketSender {
    let out = new PacketBuilder(106);
    out.puts(id, ValueType.C);
    this.player.getSession().write(out);
    return this;
  }

  public sendChatboxInterface(id: number): PacketSender {
    // 161:96 is the whole chatbox panel (519x165) and is permanently occupied
    // by group 162 itself via the gameframe bootstrap - targeting it directly
    // replaces the entire chat frame (tabs, scrollback, report button), not
    // just the content area. Modal chatbox content (dialogues, this
    // smelting/crafting interface, etc.) actually mounts one level deeper,
    // into group 162's own child 567 (479x96, the "CHATMODAL" container that
    // chat_onsubchange/script 113 resizes to fit dialogs) - confirmed by
    // decoding group 162 directly from the cache. Child 9 of 161 is an
    // unrelated 0x0 icon-cluster anchor nested under the sidebar tree.
    this.chatboxGroupId = id;
    this.player.getSession().sendClientPacket(encodeWidgetSetHidden(CHATBOX_MODAL_TARGET_UID, false));
    if (this.player.getSession().sendClientPacket(encodeWidgetOpenSub(CHATBOX_MODAL_TARGET_UID, id, 0))) return this;
  }

  public sendInterfaceSet(interfaceId: number, sidebarInterfaceId: number) {
    this.sendInterface(interfaceId);
    this.sendSidebarInterface(sidebarInterfaceId);
    return this;
  }

  public sendItemOnInterfaces(
    interfaceId: number,
    item: number,
    amount: number
  ) {
    if (this.player.getSession().sendClientPacket(encodeWidgetSetItem(interfaceId, item, amount))) return this;
  }

  public sendItemOnInterface(
    frame: number,
    item: number,
    slot: number,
    amount: number
  ) {
    if (this.player.getSession().sendClientPacket(encodeWidgetSetItem(frame, item, amount))) return this;
  }

  public clearItemOnInterface(frame: number): PacketSender {
    if (this.player.getSession().sendClientPacket(encodeWidgetSetItem(frame, -1, 0))) return this;
  }

  public sendPlayerOption(slot: number, option: string, priority = false): this {
    if (Number.isInteger(slot) && slot >= 1 && slot <= 8) {
      this.player.getSession().sendClientPacket(encodePlayerOption(slot, option, priority));
    }
    return this;
  }

  public sendInteractionOption(
    option: string,
    slot: number,
    top: boolean
  ): PacketSender {
    const out = new PacketBuilder(104, PacketType.VARIABLE);
    out.puts(slot, ValueType.C);
    out.puts(top ? 1 : 0, ValueType.A);
    out.putString(option);
    this.player.getSession().write(out);
    // const interactingOption: PlayerInteractingOption = PlayerInteractingOption.forName(option);
    if (option != null)
      // this.player.setPlayerInteractingOption(interactingOption);
      return this;
  }

  public sendString(string: string, id: number): PacketSender {
    const safeText = String(string ?? "");
    if (!this.player.getFrameUpdater().shouldUpdate(safeText, id)) {
      return this;
    }
    if (this.player.getSession().sendClientPacket(encodeWidgetSetText(id, safeText))) return this;
  }

  public sendInterfaceActions(
    id: number,
    actions: Array<string | null | undefined>
  ): PacketSender {
    const out = new PacketBuilder(125, PacketType.VARIABLE);
    out.putInt(id);
    out.put(Math.max(0, Math.min(255, actions?.length ?? 0)));
    for (const action of actions ?? []) {
      out.putString(String(action ?? ""));
    }
    this.player.getSession().write(out);
    return this;
  }

  public clearInterfaceText(start: number, end: number): PacketSender {
    for (let i = start; i <= end; i++) {
      this.player.getFrameUpdater().interfaceTextMap.delete(i);
    }
    const out = new PacketBuilder(105);
    out.putInt(start);
    out.putInt(end);
    this.player.getSession().write(out);
    return this;
  }

  public sendPositionalHint(position: any, tilePosition: number) {
    if (
      !position ||
      typeof position.getX !== "function" ||
      typeof position.getY !== "function" ||
      typeof position.getZ !== "function"
    ) {
      return this;
    }
    const out = new PacketBuilder(254);
    out.put(tilePosition);
    out.putShort(position.getX());
    out.putShort(position.getY());
    out.put(position.getZ());
    this.player.getSession().write(out);
    return this;
  }

  // public sendEntityHint(mobile: Mobile) {
  // Use client hint-arrow packet to point at a target entity.
  public sendEntityHint(mobile: any): PacketSender {
    if (!mobile || typeof mobile.getIndex !== "function") {
      return this;
    }
    const type = mobile?.isPlayer?.() ? 10 : 1;
    const out = new PacketBuilder(254);
    out.put(type);
    out.putShort(mobile.getIndex());
    out.putTypeInt(0, ValueType.STANDARD, ByteOrder.TRIPLE_INT);
    this.player.getSession().write(out);
    return this;
  }

  public sendEntityHintRemoval(playerHintRemoval: boolean): PacketSender {
    let type = playerHintRemoval ? 10 : 1;
    let out = new PacketBuilder(254);
    out.put(type).putShort(-1);
    out.putTypeInt(0, ValueType.STANDARD, ByteOrder.TRIPLE_INT);
    this.player.getSession().write(out);
    return this;
  }

  public sendMultiIcon(value: number): PacketSender {
    return this.sendVarbit(VARBIT_MULTICOMBAT_AREA, value === 0 ? 0 : 1);
  }

  public sendFriendStatus(status: number) {
    const out = new PacketBuilder(221);
    out.put(status);
    this.player.getSession().write(out);
    return this;
  }

  public sendFriend(name: number | bigint, world: number) {
    world = world !== 0 ? world + 9 : world;
    const out = new PacketBuilder(50);
    out.putLong(name);
    out.put(world);
    this.player.getSession().write(out);
    return this;
  }

  public sendDeleteFriend(name: number | bigint) {
    const out = new PacketBuilder(51);
    out.putLong(name);
    this.player.getSession().write(out);
    return this;
  }

  public sendAddIgnore(name: number | bigint) {
    const out = new PacketBuilder(214);
    out.putLong(name);
    this.player.getSession().write(out);
    return this;
  }

  public sendDeleteIgnore(name: number | bigint) {
    const out = new PacketBuilder(215);
    out.putLong(name);
    this.player.getSession().write(out);
    return this;
  }

  public sendTotalExp(exp: number) {
    const out = new PacketBuilder(108);
    out.putLong(exp);
    this.player.getSession().write(out);
    return this;
  }

  sendMessage(message: string): this {
    if (this.player.getSession().sendClientPacket(encodeChatMessage("game", message ?? ""))) return this;
  }

  sendPublicChat(message: string, from: string, playerId: number): this {
    this.player.getSession().sendClientPacket(
      encodeChatMessage("public", message, from, "", playerId)
    );
    return this;
  }

  sendPrivateMessage(target: any, message: Uint8Array, size: number): this {
    const text = Misc.ucFirst(Misc.textUnpack(Array.from(message), size).toLowerCase());
    this.player.getSession().sendClientPacket(encodeChatMessage(
      "private_in", text, target?.getUsername?.() ?? "", "", target?.getIndex?.() ?? 0
    ));
    return this;
  }

  sendBankSnapshot(): this {
    const slots: BankSlotView[] = [];
    let slot = 0;
    const banks = this.player.getBanks?.() ?? this.player.getBankTabs?.();
    if (Array.isArray(banks)) {
      banks.slice(0, 10).forEach((bank: any, tab: number) => {
        for (const item of bank?.getValidItems?.() ?? []) {
          slots.push({ slot: slot++, itemId: item.getId(), quantity: item.getAmount(), tab });
        }
      });
    } else {
      for (let tab = 0; tab < 10; tab++) {
        for (const item of this.player.getBank?.(tab)?.getValidItems?.() ?? []) {
          slots.push({ slot: slot++, itemId: item.getId(), quantity: item.getAmount(), tab });
        }
      }
    }
    this.player.getSession().sendClientPacket(encodeBankSnapshot(1410, slots));
    return this;
  }

  private resetInterfaceState(): number {
    const interfaceId = this.player.getInterfaceId?.() ?? -1;
    if (interfaceId === 12) {
      this.sendConfig(548, 0).sendVarbit(12393, 0);
    }
    const { ShopManager } = require(
      "../../game/model/container/shop/ShopManager"
    ) as typeof import("../../game/model/container/shop/ShopManager");
    ShopManager.close(this.player);
    // Keep client/server interface state aligned with Java behavior.
    // A no-op here can leave stale inventory context active client-side, which
    // affects default left-click item actions (e.g. "Drop" appearing as primary).
    this.player.setStatus?.(PlayerStatus.NONE);
    this.player.setEnteredAmountAction?.(null);
    this.player.setEnteredSyntaxAction?.(null);
    this.player.getDialogueManager?.()?.reset?.();
    this.player.setDestroyItem?.(-1);
    this.player.setInterfaceId?.(-1);
    this.player.setCreationMenu?.(null);
    this.player.setSearchingBank?.(false);
    this.player.setTeleportInterfaceOpen?.(false);
    this.player.getAppearance?.()?.setCanChangeAppearance?.(false);
    return interfaceId;
  }

  private closeTrackedInterfaces(): boolean {
    const closable = [...this.subInterfaceTargets.entries()]
      .filter(([, entry]) => entry.type === 0 || entry.type === 3);
    const targets = new Set(closable.map(([, entry]) => entry.targetUid));
    const hadChatbox = this.chatboxGroupId >= 0;
    if (hadChatbox) {
      targets.add(CHATBOX_MODAL_TARGET_UID);
      this.chatboxGroupId = -1;
    }
    if (targets.size === 0) return false;
    for (const target of targets) this.player.getSession().sendClientPacket(encodeWidgetCloseSub(target));
    if (hadChatbox) this.player.getSession().sendClientPacket(encodeWidgetSetHidden(CHATBOX_MODAL_TARGET_UID, true));
    for (const [groupId] of closable) this.subInterfaceTargets.delete(groupId);
    return true;
  }

  public isChatboxInterface(groupId: number): boolean {
    return groupId === this.chatboxGroupId;
  }

  public hasInterruptibleInterface(): boolean {
    return this.chatboxGroupId >= 0 || [...this.subInterfaceTargets.values()]
      .some((entry) => entry.type === 0 || entry.type === 3);
  }

  closeInterruptibleInterfaces(): this {
    const interfaceId = this.resetInterfaceState();
    if (this.closeTrackedInterfaces()) {
      if (interfaceId === 300 || interfaceId === 334 || interfaceId === 335) {
        this.sendSubInterface((161 << 16) | 79, MAIN_INVENTORY_GROUP_ID, 1);
      }
      return this;
    }
    if (interfaceId >= 0) this.player.getSession().sendClientPacket(encodeWidgetClose(interfaceId));
    return this;
  }

  closeInterface(groupId: number): this {
    if (!Number.isInteger(groupId) || groupId < 0) return this;
    if (groupId === this.player.getInterfaceId?.()) return this.sendInterfaceRemoval();
    if (groupId === this.chatboxGroupId) {
      this.chatboxGroupId = -1;
      this.player.getDialogueManager?.()?.reset?.();
      this.player.getSession().sendClientPacket(encodeWidgetCloseSub(CHATBOX_MODAL_TARGET_UID));
      this.player.getSession().sendClientPacket(encodeWidgetSetHidden(CHATBOX_MODAL_TARGET_UID, true));
      return this;
    }
    const target = this.subInterfaceTargets.get(groupId);
    if (target) {
      this.subInterfaceTargets.delete(groupId);
      this.player.getSession().sendClientPacket(encodeWidgetCloseSub(target.targetUid));
    }
    return this;
  }

  sendInterfaceRemoval(): this {
    const interfaceId = this.resetInterfaceState();
    if (this.closeTrackedInterfaces()) {
      if (interfaceId === 300 || interfaceId === 334 || interfaceId === 335) {
        this.sendSubInterface((161 << 16) | 79, MAIN_INVENTORY_GROUP_ID, 1);
      }
      return this;
    }
    if (interfaceId >= 0) {
      this.player.getSession().sendClientPacket(encodeWidgetClose(interfaceId));
    }
    return this;
  }

  sendItemContainer(containerOrInterfaceId: number | any, interfaceId?: number): this {
    if (typeof containerOrInterfaceId === "number") {
      return this;
    }
    const container = containerOrInterfaceId;
    if (
      !container ||
      typeof container.getItems !== "function" ||
      typeof container.capacity !== "function" ||
      !Number.isInteger(interfaceId)
    ) {
      return this;
    }

    const items = container.getItems();
    const capacity = container.capacity();
    if (container?.constructor?.name === "Inventory") {
      const slots = Array.from({ length: capacity }, (_, slot) => ({
        slot,
        itemId: items?.[slot]?.getId?.() ?? -1,
        quantity: items?.[slot]?.getAmount?.() ?? 0,
      }));
      this.player.getSession().sendClientPacket(encodeInventorySnapshot(slots));
      return this;
    }
    if (container?.constructor?.name === "Equipment") {
      this.player.getUpdateFlag().flag(Flag.APPEARANCE);
      return this;
    }
    return this;
  }

  sendInterfaceItems(interfaceId: number, items?: any): this {
    const resolvedItems = Array.isArray(items) ? items : [];
    const out = new PacketBuilder(53, PacketType.VARIABLE_SHORT);
    out.putInt(interfaceId);
    out.putShort(resolvedItems.length);
    for (const item of resolvedItems) {
      const id = item?.getId?.() ?? item?.id ?? -1;
      const amount = item?.getAmount?.() ?? item?.amount ?? 0;
      if (id <= 0 || amount <= 0) {
        out.putInt(-1);
        continue;
      }
      out.putInt(amount);
      out.putShort(id + 1);
    }
    this.player.getSession().write(out);
    return this;
  }

  sendEffectTimer(_seconds: number, _effect: any): this {
    return this;
  }

  sendGraphic(..._args: any[]): this {
    return this;
  }

  sendGlobalGraphic(..._args: any[]): this {
    return this;
  }

  sendProjectile(
    start: any,
    end: any,
    offset: number,
    speed: number,
    projectileId: number,
    startHeight: number,
    endHeight: number,
    lockon: any,
    delay: number,
    angle: number = 16,
    distanceOffset: number = 64
  ): this {
    if (
      !start ||
      typeof start.getX !== "function" ||
      typeof start.getY !== "function" ||
      !end ||
      typeof end.getX !== "function" ||
      typeof end.getY !== "function"
    ) {
      return this;
    }

    const targetIndex = this.resolveProjectileTargetIndex(lockon);
    if (this.player.getSession().sendClientPacket(encodeProjectiles([{
      projectileId,
      source: { x: start.getX(), y: start.getY(), level: start.getZ?.() ?? 0 },
      target: { x: end.getX(), y: end.getY(), level: end.getZ?.() ?? start.getZ?.() ?? 0 },
      sourceHeight: startHeight * 4,
      endHeight: endHeight * 4,
      slope: angle,
      startPos: distanceOffset,
      startCycleOffset: delay,
      endCycleOffset: Math.max(delay + 1, speed),
      targetActor: targetIndex < 0
        ? { kind: "player", index: -targetIndex - 1 }
        : targetIndex > 0 ? { kind: "npc", index: targetIndex - 1 } : undefined,
    }]))) return this;
  }

  private resolveProjectileTargetIndex(lockon: any): number {
    // Allow projectiles to pass a pre-resolved lock-on index so target binding
    // is stable even if the original lock-on entity reference later changes.
    if (Number.isInteger(lockon)) {
      return lockon;
    }
    if (
      lockon != null &&
      typeof lockon.getIndex === "function" &&
      typeof lockon.isPlayer === "function"
    ) {
      const index = lockon.getIndex();
      if (!Number.isInteger(index) || index < 0) {
        return 0;
      }
      return lockon.isPlayer() ? -(index + 1) : index + 1;
    }
    return 0;
  }

  sendObject(object: any): this {
    if (
      !object ||
      typeof object.getLocation !== "function" ||
      typeof object.getId !== "function" ||
      typeof object.getType !== "function" ||
      typeof object.getFace !== "function"
    ) {
      return this;
    }

    const location = object.getLocation();
    this.player.getSession().sendClientPacket(encodeLocAddChange(
      object.getId(), location.getX(), location.getY(), location.getZ(), object.getType(), object.getFace()
    ));
    return this;
  }

  sendObjectRemoval(object: any): this {
    if (
      !object ||
      typeof object.getLocation !== "function" ||
      typeof object.getType !== "function" ||
      typeof object.getFace !== "function"
    ) {
      return this;
    }

    const location = object.getLocation();
    this.player.getSession().sendClientPacket(encodeLocDel(
      location.getX(), location.getY(), location.getZ(), object.getType(), object.getFace()
    ));
    return this;
  }

  sendObjectAnimation(object: any, animation: any): this {
    if (object?.getLocation) {
      const location = object.getLocation();
      this.player.getSession().sendClientPacket(encodeLocAnim(
        object.getId(), location.getX(), location.getY(), location.getZ(),
        object.getType(), object.getFace(), animation?.getId?.() ?? animation?.id ?? -1
      ));
    }
    return this;
  }

  // Mounts the same native "skillmulti" production list (clientscript 2046, group 270) that
  // smelting/smithing already use successfully - the previous implementation wrote a raw
  // legacy opcode via PlayerSession.write(), which is an unported no-op stub, so the menu
  // never reached the client at all.
  sendCreationMenu(menu: any): this {
    if (
      !menu ||
      typeof menu.getItems !== "function" ||
      typeof menu.getTitle !== "function"
    ) {
      return this;
    }

    const rawItems = menu.getItems();
    const items = (Array.isArray(rawItems) ? rawItems.filter((id: unknown) => Number.isInteger(id)) : [])
      .slice(0, 18);
    if (items.length <= 0) {
      return this;
    }

    this.player.setCreationMenu?.(menu);
    const names = items.map((id: number) => CacheDefinitions.hasItem(id) ? CacheDefinitions.getItem(id).name : "null");
    const paddedIds = [...items];
    while (paddedIds.length < 18) paddedIds.push(-1);

    this.sendInterfaceScript(2379)
      .sendVarbit(CREATION_MENU_CHATMODAL_UNCLAMP_VARBIT, 1)
      .sendInterfaceDisplayState(CHATBOX_MODAL_TARGET_UID, false)
      .sendSubInterface(CHATBOX_MODAL_TARGET_UID, CREATION_MENU_GROUP_ID, 0);
    for (let i = 0; i < items.length; i++) {
      const buttonId = (CREATION_MENU_GROUP_ID << 16) | (CREATION_MENU_FIRST_ITEM_COMPONENT + i);
      this.sendInterfaceFlagsRange(buttonId, 0, CREATION_MENU_MAX_QUANTITY, CREATION_MENU_OP_FLAGS);
    }
    this.sendInterfaceScript(2046, [
      13,
      [String(menu.getTitle() ?? "What would you like to make?"), ...names].join("|"),
      CREATION_MENU_MAX_QUANTITY,
      ...paddedIds,
      CREATION_MENU_MAX_QUANTITY,
    ]);
    return this;
  }

  closeCreationMenu(): this {
    this.player.setCreationMenu?.(null);
    return this
      .closeSubInterface(CHATBOX_MODAL_TARGET_UID)
      .sendInterfaceDisplayState(CHATBOX_MODAL_TARGET_UID, true);
  }

  alterGroundItem(item: any): this {
    if (!item || typeof item.getPosition !== "function" || typeof item.getItem !== "function") {
      return this;
    }
    if (this.player.getSession().sendClientPacket(encodeGroundItemsDelta(
      ++this.groundItemSerial, [this.groundItemView(item)], []
    ))) return this;
  }

  deleteGroundItem(item: any): this {
    if (!item || typeof item.getPosition !== "function" || typeof item.getItem !== "function") {
      return this;
    }
    if (this.player.getSession().sendClientPacket(encodeGroundItemsDelta(
      ++this.groundItemSerial, [], [item.getId()]
    ))) return this;
  }

  createGroundItem(item: any): this {
    if (!item || typeof item.getPosition !== "function" || typeof item.getItem !== "function") {
      return this;
    }
    if (this.player.getSession().sendClientPacket(encodeGroundItemsDelta(
      ++this.groundItemSerial, [this.groundItemView(item)], []
    ))) return this;
  }

  sendGroundItems(items: any[]): this {
    this.player.getSession().sendClientPacket(encodeGroundItems(
      ++this.groundItemSerial, items.map((item) => this.groundItemView(item))
    ));
    return this;
  }

  private groundItemView(item: any): GroundItemView {
    const position = item.getPosition();
    const owner = item.getOwner?.();
    const mine = owner === this.player.getUsername();
    return {
      id: item.getId(),
      itemId: item.getItem().getId(),
      quantity: item.getItem().getAmount(),
      x: position.getX(),
      y: position.getY(),
      level: position.getZ(),
      ownerId: mine ? this.player.getIndex() : -1,
      isPrivate: item.getState?.() === 0,
      ownership: owner == null ? 0 : mine ? 1 : 2,
    };
  }

  sendSkill(skill: any): this {
    if (!skill || typeof skill.getIndex !== "function") {
      return this;
    }
    const skillManager = this.player?.getSkillManager?.();
    if (!skillManager) {
      return this;
    }

    if (this.player.getSession().sendClientPacket(encodeSkillsDelta(
      [this.skillView(skill)], skillManager.getTotalLevel(), skillManager.getCombatLevel()
    ))) return this;
  }

  sendInventorySlot(slot: number, itemId: number, quantity: number): this {
    this.player.getSession().sendClientPacket(encodeInventorySlot(slot, itemId, quantity));
    return this;
  }

  sendSkillsSnapshot(): this {
    const manager = this.player.getSkillManager();
    this.player.getSession().sendClientPacket(encodeSkillsSnapshot(
      Skill.values().map((skill) => this.skillView(skill)),
      manager.getTotalLevel(),
      manager.getCombatLevel()
    ));
    return this;
  }

  private skillView(skill: Skill): SkillView {
    const manager = this.player.getSkillManager();
    const baseLevel = manager.getMaxLevel(skill);
    const currentLevel = manager.getCurrentLevel(skill);
    return {
      id: skill.getIndex(),
      xp: manager.getExperience(skill),
      baseLevel,
      virtualLevel: baseLevel,
      boost: currentLevel - baseLevel,
      currentLevel,
    };
  }

  sendVarbit(id: number, value: number): this {
    const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
    let mask = BIT_MASKS[endBit - startBit];
    // Match the client's varbit range handling and shared backing varp.
    const stored = value < 0 || (mask !== -1 && value > mask) ? 0 : value;
    mask <<= startBit;
    this.varps.set(baseVar, (this.getVarp(baseVar) & ~mask) | ((stored << startBit) & mask));
    this.player.getSession().sendClientPacket(encodeVarbit(id, value));
    return this;
  }

  sendDestination(x: number, y: number): this {
    this.player.getSession().sendClientPacket(encodeDestination(x, y));
    return this;
  }

  sendRootInterface(groupId: number): this {
    this.player.getSession().sendClientPacket(encodeWidgetSetRoot(groupId));
    return this;
  }

  sendSubInterface(
    targetUid: number,
    groupId: number,
    type = 1,
    options: Parameters<typeof encodeWidgetOpenSub>[3] = {}
  ): this {
    const existing = this.subInterfaceTargets.get(groupId);
    if (existing && existing.targetUid !== targetUid) {
      this.player.getSession().sendClientPacket(encodeWidgetCloseSub(existing.targetUid));
    }
    for (const [mountedGroupId, mounted] of this.subInterfaceTargets) {
      if (mounted.targetUid === targetUid && mountedGroupId !== groupId) {
        this.subInterfaceTargets.delete(mountedGroupId);
      }
    }
    this.subInterfaceTargets.set(groupId, { targetUid, type });
    this.player.getSession().sendClientPacket(encodeWidgetOpenSub(targetUid, groupId, type, options));
    if (groupId === MAIN_INVENTORY_GROUP_ID) {
      this.player.getSession().sendClientPacket(
        encodeWidgetSetFlagsRange(MAIN_INVENTORY_WIDGET_UID, 0, 27, MAIN_INVENTORY_SLOT_FLAGS)
      );
    }
    return this;
  }

  toggleWorldMap(): this {
    if (this.subInterfaceTargets.has(WORLD_MAP_GROUP_ID)) {
      return this.closeSubInterface(WORLD_MAP_TARGET_UID);
    }
    const location = this.player.getLocation();
    const packed = packWorldMapCoord(location.getX(), location.getY(), location.getZ());
    return this
      .sendInterfaceScript(1749, [packed, -1, -1])
      .sendSubInterface(WORLD_MAP_TARGET_UID, WORLD_MAP_GROUP_ID)
      .sendInterfaceFlagsRange((WORLD_MAP_GROUP_ID << 16) | 21, 0, 4, 1 << 1);
  }

  closeWorldMap(): this {
    return this.closeSubInterface(WORLD_MAP_TARGET_UID);
  }

  sendContentData(source: string, datasets: Array<{ key: string; rows: unknown[] }>): this {
    this.player.getSession().sendClientPacket(encodeContentData(source, datasets));
    return this;
  }

  closeSubInterface(targetUid: number): this {
    for (const [groupId, entry] of this.subInterfaceTargets) {
      if (entry.targetUid === targetUid) this.subInterfaceTargets.delete(groupId);
    }
    this.player.getSession().sendClientPacket(encodeWidgetCloseSub(targetUid));
    return this;
  }

  sendInterfaceFlags(uid: number, flags: number): this {
    this.player.getSession().sendClientPacket(encodeWidgetSetFlags(uid, flags));
    return this;
  }

  sendInterfaceFlagsRange(uid: number, fromSlot: number, toSlot: number, flags: number): this {
    this.player.getSession().sendClientPacket(encodeWidgetSetFlagsRange(uid, fromSlot, toSlot, flags));
    return this;
  }

  sendInterfaceScript(
    scriptId: number,
    args: (number | string)[] = [],
    varps?: Record<number, number>,
    varbits?: Record<number, number>,
    inventories?: Record<number, ScriptInventorySnapshot>
  ): this {
    this.player
      .getSession()
      .sendClientPacket(
        encodeWidgetRunScript(scriptId, args, varps, varbits, inventories)
      );
    return this;
  }

  sendClientScript(scriptId: number, ...args: (number | string)[]): this {
    this.player.getSession().sendClientPacket(encodeRunClientScript(scriptId, args));
    return this;
  }

  sendExpDrop(skill: any, exp: number): this {
    if (!skill || typeof skill.getIndex !== "function") {
      return this;
    }
    const out = new PacketBuilder(116);
    out.put(skill.getIndex());
    out.putInt(exp);
    this.player.getSession().write(out);
    return this;
  }
}
