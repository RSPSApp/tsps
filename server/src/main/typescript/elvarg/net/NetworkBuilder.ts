import { createServer } from "http";
import { WebSocketServer } from "ws";
import { GameConstants } from "../game/GameConstants";
import { World } from "../game/World";
import { Player } from "../game/entity/impl/player/Player";
import { Appearance } from "../game/model/Appearance";
import { Flag } from "../game/model/Flag";
import { Location } from "../game/model/Location";
import { PlayerStatus } from "../game/model/PlayerStatus";
import { PlayerRights } from "../game/model/rights/PlayerRights";
import { PluginManager } from "../plugins/PluginManager";
import { Misc } from "../util/Misc";
import { PlayerPunishment } from "../util/PlayerPunishment";
import { BinaryChannel, MAX_GAME_MESSAGE_BYTES, WebSocketBinaryChannel } from "./BinaryChannel";
import { BrowserHostHttpBridge, BROWSER_HOST_BRIDGE_HTML } from "./BrowserHostHttpBridge";
import { PlayerSession } from "./PlayerSession";
import { CachePipeline } from "../game/cache/CachePipeline";
import { ContentApi } from "./http/ContentApi";
import { CacheDefinitions } from "../game/cache/CacheDefinitions";
import {
  CREATION_MENU_GROUP_ID,
  CREATION_MENU_FIRST_ITEM_COMPONENT,
  CREATION_MENU_MAX_QUANTITY,
} from "./packet/PacketSender";
import { MapRegionReplacementManager } from "../game/collision/MapRegionReplacementManager";
import {
  decodeClientPackets,
  MAIN_INVENTORY_GROUP_ID,
  encodeDefaultAnimations,
  encodeGameframeBootstrap,
  encodeHandshake,
  encodeLoginResponse,
  encodeLogoutResponse,
  encodeWelcome,
  PlayerAppearance,
} from "./protocol/ClientProtocol";
import {
  WORLD_MAP_CLOSE_WIDGET_ID,
  WORLD_MAP_ORB_WIDGET_IDS,
} from "./protocol/WorldMapProtocol";
import { ObjectActionPacketListener } from "./packet/impl/ObjectActionPacketListener";
import { NPCOptionPacketListener } from "./packet/impl/NPCOptionPacketListener";
import { ChatPacketListener } from "./packet/impl/ChatPacketListener";
import { DialogueOption } from "../game/model/dialogues/DialogueOption";
import { PlayerOptionPacketListener } from "./packet/impl/PlayerOptionPacketListener";
import { MagicOnPlayerPacketListener } from "./packet/impl/MagicOnPlayerPacketListener";
import { LunarSpells } from "../game/content/combat/magic/LunarSpells";
import { MagicOnItemPacketListener } from "./packet/impl/MagicOnItemPacketListener";
import { UseItemPacketListener } from "./packet/impl/UseItemPacketListener";
import { ItemActionPacketListener } from "./packet/impl/ItemActionPacketListener";
import { EquipPacketListener } from "./packet/impl/EquipPacketListener";
import { DropItemPacketListener } from "./packet/impl/DropItemPacketListener";
import { SwitchItemSlotPacketListener } from "./packet/impl/SwitchItemSlotPacketListener";
import { PickupItemPacketListener } from "./packet/impl/PickupItemPacketListener";
import { SecondGroundItemOptionPacketListener } from "./packet/impl/SecondGroundItemOptionPacketListener";
import { ItemDefinition } from "../game/definition/ItemDefinition";
import { Bank } from "../game/model/container/impl/Bank";
import { InterfaceActionClickOpcode } from "./packet/impl/InterfaceActionClickOpcode";
import { ChangeAppearancePacketListener } from "./packet/impl/ChangeAppearancePacketListener";
import { NpcDefinition } from "../game/definition/NpcDefinition";
import { ObjectDefinition } from "../game/definition/ObjectDefinition";
import { Emotes } from "../game/content/Emotes";
import { BonusManager } from "../game/model/equipment/BonusManager";
import { ShopManager } from "../game/model/container/shop/ShopManager";
import { CombatSpecial } from "../game/content/combat/CombatSpecial";
import { WeaponInterfaceManager } from "../game/content/combat/WeaponInterfaceManager";
import { PrayerHandler } from "../game/content/PrayerHandler";
import { Autocasting } from "../game/content/combat/magic/Autocasting";
import { EffectSpells } from "../game/content/combat/magic/EffectSpells";
import { CombatSpells } from "../game/content/combat/magic/CombatSpells";
import { TeleportHandler } from "../game/model/teleportation/TeleportHandler";
import { ArceuusSpells } from "../game/content/combat/magic/ArceuusSpells";
import { SpellTeleports } from "../game/content/combat/magic/SpellTeleports";

const OBJECT_ACTIONS = new ObjectActionPacketListener();
const NPC_ACTIONS = new NPCOptionPacketListener();
const MAGIC_ITEMS = new MagicOnItemPacketListener();
const CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE = "interface:close-on-interface-close";
const WORLD_INTERACTIONS = new Set([
  "move",
  "teleport",
  "world_map_click",
  "npc_option",
  "object_option",
  "player_option",
  "ground_item_action",
  "inventory_action",
  "inventory_use_on",
  "item_on_player",
  "item_on_npc",
  "item_on_object",
  "spell_on_npc",
  "spell_on_player",
  "spell_on_object",
  "item_on_ground",
  "spell_on_ground",
]);

type PendingLogin = {
  username: string;
  passwordHash: string;
  save: any | null;
};

export function isConfiguredDeveloperUsername(username: string): boolean {
  const developerUsername = process.env.DEV_USERNAME?.trim();
  return !!developerUsername && developerUsername.toLowerCase() === username.toLowerCase();
}

export class NetworkBuilder {
  public initialize(port: number): WebSocketServer {
    const browserHost = process.env.BROWSER_HOST === "1";
    const browserHostBridge = browserHost
      ? new BrowserHostHttpBridge((channel) => new ClientConnection(channel))
      : undefined;
    const http = createServer((request, response) => {
      response.setHeader("Access-Control-Allow-Origin", "*");
      if (browserHostBridge) {
        if (request.method === "GET" && request.url === "/") {
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(BROWSER_HOST_BRIDGE_HTML);
          return;
        }
        if (browserHostBridge.handle(request, response)) return;
      }
      const content = ContentApi.resolve(
        request.method ?? "GET",
        request.url ?? "",
        request.headers["if-none-match"]
      );
      if (content) {
        response.statusCode = content.status;
        for (const [header, value] of Object.entries(content.headers)) {
          response.setHeader(header, value);
        }
        response.end(content.body);
        return;
      }
      if (request.url === "/regions") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ regions: MapRegionReplacementManager.getRegionIds() }));
        return;
      }
      const match = /^\/regions\/(\d+)\.pack$/.exec(request.url ?? "");
      const pack = match ? MapRegionReplacementManager.getRegionPack(Number(match[1])) : null;
      if (!pack) {
        response.statusCode = 404;
        response.end();
        return;
      }
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("Content-Length", pack.length);
      response.end(pack);
    });
    const server = new WebSocketServer({
      server: http,
      perMessageDeflate: false,
      maxPayload: MAX_GAME_MESSAGE_BYTES,
    });
    server.on("connection", (socket) => new ClientConnection(new WebSocketBinaryChannel(socket)));
    server.on("listening", () => console.info(`[network] client websocket listening on ${port}`));
    server.on("error", (error) => console.error("[network] websocket error", error));
    http.listen(port);
    if (!browserHost) {
      // node-datachannel is a native addon; only require it outside the
      // WebContainer sandbox, which cannot load native modules.
      const { WebRtcGameConnector } = require("./webrtc/WebRtcGameConnector") as typeof import("./webrtc/WebRtcGameConnector");
      WebRtcGameConnector.startFromEnv(
        (channel) => new ClientConnection(channel),
        World.getNetworkPlayerCount
      );
    }
    return server;
  }
}

class ClientConnection {
  private static readonly pendingNames = new Set<string>();
  private pending?: PendingLogin;
  private reservedName?: string;
  private player?: Player;
  private closed = false;
  private input = Promise.resolve();

  constructor(private readonly channel: BinaryChannel) {
    channel.onData((frame) => {
      this.input = this.input.then(() => this.handle(frame)).catch((error) => {
        console.warn("[network] client packet rejected", error);
      });
    });
    channel.onError((error) => {
      console.warn(`[network] ${channel.kind} client error`, error.message);
      this.cleanup("socket_error");
    });
    channel.onClose(() => this.cleanup("socket_close"));
    this.send(encodeWelcome(GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE, Date.now()));
  }

  private async handle(frame: Buffer): Promise<void> {
    let packets;
    try {
      packets = decodeClientPackets(frame);
    } catch (error) {
      console.warn("[network] rejected malformed client packet", (error as Error).message);
      return;
    }

    for (const packet of packets) {
      if (this.player) LunarSpells.expireSpellbookSwap(this.player);
      if (this.player && WORLD_INTERACTIONS.has(packet.type)) {
        if (this.player.getStatus() === PlayerStatus.TRADING) continue;
        if (
          (packet.type !== "move" || this.player.getMovementQueue().getMobility().canMove()) &&
          !(packet.type === "inventory_action" && EquipPacketListener.preservesInterfaceOnEquip(this.player))
        ) {
          this.player.closeInterruptibleInterfaces();
        }
      }
      switch (packet.type) {
        case "move":
          this.walk(packet.worldX, packet.worldY, packet.modifierFlags);
          continue;
        case "npc_option":
          if (this.player) NPC_ACTIONS.executeOption(this.player, packet.index, packet.clickType);
          continue;
        case "object_option":
          if (this.player) OBJECT_ACTIONS.executeAction(
            this.player, packet.id, packet.x, packet.y, packet.clickType, packet.action
          );
          continue;
        case "player_option":
          if (this.player) PlayerOptionPacketListener.executeClientOption(this.player, packet.index, packet.option);
          continue;
        case "item_on_player":
          if (this.player) UseItemPacketListener.itemOnPlayer(
            this.player, packet.widgetId, packet.targetIndex, packet.itemId, packet.slot
          );
          continue;
        case "item_on_npc":
          if (this.player) UseItemPacketListener.itemOnNpc(
            this.player, packet.widgetId, packet.targetIndex, packet.itemId, packet.slot
          );
          continue;
        case "item_on_object":
          if (this.player) UseItemPacketListener.itemOnObject(
            this.player, packet.widgetId, packet.objectId, packet.itemId, packet.slot, packet.x, packet.y
          );
          continue;
        case "spell_on_player":
          if (this.player) {
            const spellName = CacheDefinitions.getSpellName(packet.spellWidget, packet.spellItemId);
            const target = World.getPlayers().get(packet.targetIndex);
            if (target && LunarSpells.handlePlayerTarget(this.player, target, spellName)) {
              continue;
            }
            MagicOnPlayerPacketListener.cast(
              this.player,
              packet.targetIndex,
              this.resolveClientCombatSpellId(packet.spellWidget, packet.spellChild, packet.spellItemId)
            );
          }
          continue;
        case "spell_on_npc":
          if (this.player) {
            const spellName = CacheDefinitions.getSpellName(packet.spellWidget, packet.spellItemId);
            const target = World.getNpcs().get(packet.targetIndex);
            if (target && LunarSpells.handleNpcTarget(this.player, target, spellName)) {
              continue;
            }
            NPCOptionPacketListener.castSpell(
              this.player,
              packet.targetIndex,
              this.resolveClientCombatSpellId(packet.spellWidget, packet.spellChild, packet.spellItemId)
            );
          }
          continue;
        case "spell_on_object":
          if (this.player) UseItemPacketListener.spellOnObject(
            this.player,
            packet.objectId,
            packet.x,
            packet.y,
            packet.spellWidget,
            packet.spellChild,
            packet.spellItemId,
            this.resolveClientCombatSpellId(packet.spellWidget, packet.spellChild, packet.spellItemId)
          );
          continue;
        case "inventory_action":
          if (this.player) this.inventoryAction(packet);
          continue;
        case "inventory_use_on":
          if (this.player) {
            const target = packet.target;
            if (target.kind === "inventory") {
              UseItemPacketListener.itemOnItem(this.player, packet.slot, target.slot);
            } else if (target.kind === "npc") {
              UseItemPacketListener.itemOnNpc(this.player, 3214, target.id, packet.itemId, packet.slot);
            } else if (target.kind === "player") {
              UseItemPacketListener.itemOnPlayer(this.player, 3214, target.id, packet.itemId, packet.slot);
            } else if (target.kind === "ground" && target.x != null && target.y != null) {
              UseItemPacketListener.itemOnGroundItem(
                this.player, packet.itemId, target.id, target.x, target.y, packet.slot
              );
            } else if (target.kind === "loc" && target.x != null && target.y != null) {
              UseItemPacketListener.itemOnObject(
                this.player, 3214, target.id, packet.itemId, packet.slot, target.x, target.y
              );
            }
          }
          continue;
        case "inventory_move":
          if (this.player) SwitchItemSlotPacketListener.move(
            this.player, packet.widgetId ?? 3214, packet.from, packet.to
          );
          continue;
        case "bank_deposit_inventory":
          if (this.player) Bank.depositItems(this.player, this.player.getInventory(), false);
          continue;
        case "bank_deposit_equipment":
          if (this.player) Bank.depositItems(this.player, this.player.getEquipment(), false);
          continue;
        case "bank_move":
          if (this.player && Bank.isOpen(this.player)) {
            const from = Bank.resolveDisplaySlot(this.player, packet.from);
            const to = Bank.resolveDisplaySlot(this.player, packet.to);
            if (from && to && from.tab === to.tab) {
              this.player.setInsertMode(packet.mode === "insert");
              Bank.rearrange(this.player, this.player.getBank(from.tab), from.slot, to.slot);
            }
          }
          continue;
        case "ground_item_action":
          if (this.player) this.groundItemAction(packet);
          continue;
        case "item_on_ground":
          if (this.player) UseItemPacketListener.itemOnGroundItem(
            this.player, packet.itemId, packet.groundItemId, packet.x, packet.y, packet.slot
          );
          continue;
        case "spell_on_ground":
          if (this.player) {
            const spellId = this.resolveClientCombatSpellId(packet.spellWidget, packet.spellChild, packet.spellItemId);
            MAGIC_ITEMS.castGroundItem(this.player, packet.groundItemId, packet.x, packet.y, spellId);
          }
          continue;
        case "chat":
          if (this.player) {
            if (packet.messageType === "public") {
              ChatPacketListener.handleText(this.player, packet.text);
            } else if (packet.messageType === "friends_chat") {
              PluginManager.emitSocialPacket({ player: this.player, packet, handled: false });
            }
          }
          continue;
        case "friends_chat_action":
        case "private_message":
        case "chat_filter":
          if (this.player) PluginManager.emitSocialPacket({ player: this.player, packet, handled: false });
          continue;
        case "dialogue_continue": {
          // Skillmulti item clicks (smelting, creation menus, ...) route through this packet
          // rather than widget_action - childIndex carries the literal chosen quantity
          // (confirmed against the client's skillmulti_itembutton_triggered script, which
          // sends get_varc_int 200 as the resume_pausebutton argument), not an op index.
          const creationMenu = this.player?.getCreationMenu?.();
          const creationGroupId = packet.widgetId >>> 16;
          const creationChildId = packet.widgetId & 0xffff;
          if (
            this.player &&
            creationMenu &&
            creationGroupId === CREATION_MENU_GROUP_ID &&
            creationChildId >= CREATION_MENU_FIRST_ITEM_COMPONENT
          ) {
            const itemId = creationMenu.getItems()[creationChildId - CREATION_MENU_FIRST_ITEM_COMPONENT];
            if (Number.isInteger(itemId)) {
              const amount = Number.isInteger(packet.childIndex) && packet.childIndex > 0
                ? Math.min(packet.childIndex, CREATION_MENU_MAX_QUANTITY)
                : 1;
              this.player.getPacketSender().closeCreationMenu();
              creationMenu.execute(itemId, amount);
              continue;
            }
          }
          if (this.player && PluginManager.emitInterfaceActionClick({
            player: this.player,
            buttonId: packet.widgetId,
            action: packet.childIndex,
            groupId: packet.widgetId >>> 16,
            childId: packet.widgetId & 0xffff,
            handled: false,
          })) {
            continue;
          }
          if (this.player?.getDialogueManager().canContinue(packet.widgetId)) {
            this.player.getDialogueManager().advance();
          }
          continue;
        }
        case "dialogue_amount": {
          const action = this.player?.getEnteredAmountAction();
          if (action && packet.amount > 0) action.execute(packet.amount);
          else if (this.player && Bank.isOpen(this.player) && packet.amount > 0) {
            this.player.setBankCustomQuantity(packet.amount);
            this.player.getPacketSender().sendVarbit(3960, packet.amount);
          }
          this.player?.setEnteredAmountAction(null);
          continue;
        }
        case "dialogue_input": {
          const action = this.player?.getEnteredSyntaxAction();
          if (action) action.execute(packet.value);
          this.player?.setEnteredSyntaxAction(null);
          continue;
        }
        case "widget_action":
          if (this.player) {
            const actionPacket = { ...packet, buttonNum: packet.buttonNum ?? 0 };
            const equipmentSlot = EquipPacketListener.resolveEquipmentSlot(actionPacket.groupId, actionPacket.childId);
            if (WORLD_MAP_ORB_WIDGET_IDS.includes(actionPacket.widgetId) && actionPacket.buttonNum === 2) {
              this.player.getPacketSender().toggleWorldMap();
            } else if (actionPacket.widgetId === WORLD_MAP_CLOSE_WIDGET_ID) {
              this.player.getPacketSender().closeWorldMap();
            } else if (equipmentSlot >= 0) {
              const item = this.player.getEquipment().getItems()[equipmentSlot];
              const itemActionHandled = !!item?.getId &&
                PluginManager.emitItemAction({
                  player: this.player,
                  interfaceId: 1688,
                  item,
                  itemId: item.getId(),
                  slot: equipmentSlot,
                  clickType: actionPacket.buttonNum ?? 1,
                  option: actionPacket.option,
                  subOpId: actionPacket.subOpId,
                  handled: false,
                });
              if (!itemActionHandled) {
                EquipPacketListener.unequip(this.player, equipmentSlot);
              }
            } else if (Bank.handleWidgetAction(this.player, actionPacket)) {
              // Bank owns its cache-native widgets while the bank modal is open.
            } else if (ShopManager.handleWidgetAction(this.player, actionPacket)) {
              // Shop owns its stock and sell-inventory widgets while open.
            } else if (this.player.getQuickPrayers().handleWidgetAction(
              actionPacket.groupId,
              actionPacket.childId,
              actionPacket.buttonNum ?? actionPacket.opId ?? 1,
              actionPacket.slot,
            )) {
              // Cache-native quick-prayer orb and setup controls.
            } else if (actionPacket.groupId === 541 && PrayerHandler.togglePrayer(this.player, actionPacket.childId)) {
              // Prayer widgets map directly onto the existing prayer engine.
            } else if (actionPacket.groupId === 593 && actionPacket.childId === 32) {
              // The combat widget's auto-retaliate control does not emit a varp
              // change in every cache/client path, so the button is authoritative.
              this.player.setAutoRetaliate(!this.player.autoRetaliateReturn());
              if (!this.player.autoRetaliateReturn()) {
                this.player.getCombat().stopAutoRetaliation();
              }
              this.player.getPacketSender().sendConfig(
                172,
                this.player.autoRetaliateReturn() ? 0 : 1,
              );
            } else if (actionPacket.groupId === 593 && actionPacket.childId === 39) {
              CombatSpecial.activate(this.player);
            } else if (Autocasting.handleWidgetAction(
              this.player, actionPacket.groupId, actionPacket.childId, actionPacket.slot
            )) {
              // Cache-native combat autocast controls reuse the existing spell state.
            } else if (SpellTeleports.handleSelf(
              this.player,
              this.resolveSpellName(actionPacket.widgetId, actionPacket.groupId, actionPacket.childId, actionPacket.itemId),
            )) {
              // Standard and Ancient teleport spells use the shared cache-name route.
            } else if (LunarSpells.handleSelf(
              this.player,
              this.resolveSpellName(actionPacket.widgetId, actionPacket.groupId, actionPacket.childId, actionPacket.itemId),
            )) {
              // Lunar self-casts and teleports are identified by their cache spell name.
            } else if (CombatSpells.handleSelf(
              this.player,
              this.resolveSpellName(actionPacket.widgetId, actionPacket.groupId, actionPacket.childId, actionPacket.itemId),
            )) {
              // Charge is a self-cast combat spell.
            } else if (EffectSpells.handleSpell(
              this.player,
              EffectSpells.forSpellName(this.resolveSpellName(
                actionPacket.widgetId, actionPacket.groupId, actionPacket.childId, actionPacket.itemId,
              ))?.spellId() ?? actionPacket.itemId ?? -1,
            )) {
              // Utility and self-cast spells are represented by their cache item id.
            } else if (ArceuusSpells.handleSpell(
              this.player,
              CacheDefinitions.getSpellName(actionPacket.widgetId, actionPacket.itemId ?? -1),
            )) {
              // Arceuus self-cast spells are identified by their cache spell name.
            } else if (actionPacket.groupId === MAIN_INVENTORY_GROUP_ID && actionPacket.itemId != null && actionPacket.slot != null &&
                this.player.getInventory().getItems()[actionPacket.slot]?.getId() === actionPacket.itemId) {
              const inventoryAction = actionPacket.groupId === MAIN_INVENTORY_GROUP_ID
                ? ItemActionPacketListener.resolveInventoryWidgetAction(actionPacket.itemId, actionPacket.buttonNum)
                : { optionIndex: actionPacket.buttonNum, option: actionPacket.option };
              if (!inventoryAction) continue;
              if (actionPacket.subOpId && PluginManager.emitItemAction({
                player: this.player,
                interfaceId: actionPacket.widgetId,
                item: this.player.getInventory().getItems()[actionPacket.slot],
                itemId: actionPacket.itemId,
                slot: actionPacket.slot,
                clickType: inventoryAction.optionIndex,
                option: inventoryAction.option,
                subOpId: actionPacket.subOpId,
                handled: false,
              })) {
                continue;
              }
              this.inventoryAction({
                type: "inventory_action", widgetId: actionPacket.widgetId, slot: actionPacket.slot,
                itemId: actionPacket.itemId, ...inventoryAction,
              });
            } else {
              const handled = InterfaceActionClickOpcode.handle(this.player, actionPacket.widgetId, actionPacket.buttonNum, {
                groupId: actionPacket.groupId,
                childId: actionPacket.childId,
                opId: actionPacket.opId,
                itemId: actionPacket.itemId,
                slot: actionPacket.slot,
                option: actionPacket.option,
              });
              // A prompt callback may start a new dialogue; do not send this same click to it.
              if (handled) continue;
              if (actionPacket.simple) {
                PluginManager.emitButtonClick({
                  player: this.player,
                  buttonId: actionPacket.childId,
                  handled: false,
                });
              }
            }
            if (this.player.getDialogueManager().isActive() && actionPacket.buttonNum > 0 && actionPacket.buttonNum <= 5) {
              this.player.getDialogueManager().handleOption(actionPacket.buttonNum - 1 as DialogueOption);
            }
          }
          continue;
        case "varp_transmit":
          if (this.player) {
            if (packet.varpId === 43) {
              WeaponInterfaceManager.changeCombatStyle(this.player, packet.value);
              BonusManager.update(this.player);
            } else if (packet.varpId === 172) {
              this.player.setAutoRetaliate(packet.value === 0);
              if (!this.player.autoRetaliateReturn()) {
                this.player.getCombat().stopAutoRetaliation();
              }
              this.player.getPacketSender().sendConfig(172, this.player.autoRetaliateReturn() ? 0 : 1);
            } else if (packet.varpId === 173) {
              this.player.setRunning(packet.value !== 0 && this.player.getRunEnergy() > 0);
              this.player.getPacketSender().sendRunStatus();
            } else if (packet.varpId === 301 && (packet.value !== 0) !== this.player.isSpecialActivated()) {
              CombatSpecial.activate(this.player);
            }
            this.player.setAudioSetting(packet.varpId, packet.value);
          }
          continue;
        case "widget":
          if (this.player && packet.action === "close") this.player.getPacketSender().closeInterface(packet.groupId);
          continue;
        case "widget_target":
          if (this.player && !LunarSpells.handleItemTarget(
            this.player,
            packet.targetItemId,
            packet.targetSlot,
            CacheDefinitions.getSpellName(packet.sourceWidgetId, packet.sourceItemId),
          ) && !MAGIC_ITEMS.castOnItem(
            this.player,
            this.resolveClientCombatSpellId(
              packet.sourceWidgetId,
              packet.sourceWidgetId & 0xffff,
              packet.sourceItemId
            ),
            packet.targetItemId,
            packet.targetSlot
          )) {
            InterfaceActionClickOpcode.handle(this.player, packet.targetWidgetId, packet.sourceSlot, {
              targetWidgetId: packet.targetWidgetId,
              targetSlot: packet.targetSlot,
              targetItemId: packet.targetItemId,
              sourceWidgetId: packet.sourceWidgetId,
              sourceSlot: packet.sourceSlot,
              sourceItemId: packet.sourceItemId,
            });
          }
          continue;
        case "widget_drag":
          if (this.player) SwitchItemSlotPacketListener.move(
            this.player, packet.sourceWidgetId, packet.sourceSlot, packet.targetSlot
          );
          continue;
        case "interface_close":
          if (this.player) {
            const closeOverlayId = this.player.getAttribute?.(CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE);
            if (typeof closeOverlayId === "number" && Number.isInteger(closeOverlayId)) {
              this.player.setAttribute(CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE, null);
              this.player.getPacketSender().closeInterface(closeOverlayId);
              continue;
            }
            const hadSomethingOpen =
              this.player.getStatus() !== PlayerStatus.NONE ||
              this.player.getInterfaceId() >= 0 ||
              this.player.getDialogueManager().isActive() ||
              this.player.getPacketSender().hasInterruptibleInterface();
            if (hadSomethingOpen) {
              // IF_CLOSE is explicit: clear even interfaces that world interactions preserve.
              this.player.getPacketSender().closeInterruptibleInterfaces();
            } else {
              // Nothing was open - real OSRS opens the logout tab here.
              // TODO: needs the exact tab-switch mechanism confirmed against
              // a live click of the logout icon before wiring this branch.
            }
          }
          continue;
        case "local_trigger":
          if (this.player && packet.opcodeParam >= 1 && packet.opcodeParam <= 10) {
            InterfaceActionClickOpcode.handle(this.player, packet.widgetId, packet.opcodeParam, {
              groupId: packet.widgetId >>> 16,
              childId: packet.childIndex,
              itemId: packet.itemId >= 0 ? packet.itemId : undefined,
              slot: packet.childIndex >= 0 ? packet.childIndex : undefined,
              argsData: packet.argsData,
            });
          }
          continue;
        case "item_spawner_search":
          continue;
        case "examine_npc":
          if (this.player) {
            const definition = NpcDefinition.forId(packet.id);
            this.player.sendMessage(definition.getExamine());
          }
          continue;
        case "examine_object":
          if (this.player) {
            const definition = ObjectDefinition.forId(packet.id);
            this.player.sendMessage(definition?.getExamine() ?? "It's nothing special.");
          }
          continue;
        case "appearance":
          if (this.player) ChangeAppearancePacketListener.apply(
            this.player, packet.gender, packet.kits, packet.colors
          );
          continue;
        case "world_map_click":
        case "teleport":
          if (this.player && PlayerRights.hasAdminRights(this.player) &&
              Number.isInteger(packet.x) && packet.x >= 0 && packet.x <= 0x3fff &&
              Number.isInteger(packet.y) && packet.y >= 0 && packet.y <= 0x3fff) {
            if (packet.type === "world_map_click") this.player.getPacketSender().closeWorldMap();
            TeleportHandler.onTeleporting(this.player, false);
            this.player.setFollowing(null);
            this.player.setPositionToFace(null);
            this.player.moveTo(new Location(packet.x, packet.y, Math.max(0, Math.min(3, packet.level | 0))));
          }
          continue;
        case "pathfind":
          this.walk(packet.toX, packet.toY, 0);
          continue;
        case "emote":
          if (this.player) Emotes.doEmote(this.player, packet.index);
          continue;
        case "interaction_stop":
          if (this.player) {
            this.player.getCombat().reset();
            this.player.setFollowing(null);
            this.player.setMobileInteraction(null);
            this.player.setPositionToFace(null);
          }
          continue;
        case "face":
          if (this.player) {
            const location = this.player.getLocation();
            if (packet.x != null && packet.y != null) {
              this.player.setPositionToFace(new Location(packet.x, packet.y, location.getZ()));
            } else if (packet.rotation != null) {
              const radians = (packet.rotation & 0x7ff) * Math.PI / 1024;
              this.player.setPositionToFace(new Location(
                location.getX() + Math.round(Math.sin(radians)),
                location.getY() + Math.round(Math.cos(radians)),
                location.getZ()
              ));
            }
          }
          continue;
        case "trade_action":
          if (this.player) this.tradeAction(packet);
          continue;
        case "raw":
          continue;
        case "hello":
        case "ping":
          continue;
        case "login":
          await this.login(packet.username, packet.password, packet.revision);
          continue;
        case "handshake":
          this.enterWorld();
          continue;
        case "logout":
          this.send(encodeLogoutResponse());
          this.player?.getSession().flushPackets();
          this.cleanup("logout");
          this.channel.close(1000, "logout");
          return;
      }
    }
  }

  private async login(rawUsername: string, password: string, revision: number): Promise<void> {
    this.releasePendingName();
    const protocolName = Misc.formatNameForProtocol(rawUsername.trim());
    const username = Misc.formatText(protocolName);
    const key = protocolName.toLowerCase();

    if (revision !== CachePipeline.getActive().revision) {
      this.failLogin(6, "Please close the client and reload to update.");
      return;
    }
    if (
      protocolName.length < 1 ||
      protocolName.length > 12 ||
      !Misc.isValidName(protocolName) ||
      password.length < 1 ||
      password.length > 64
    ) {
      this.failLogin(3, "Invalid username or password.");
      return;
    }
    if (PlayerPunishment.banned(username)) {
      this.failLogin(4, "Your account has been disabled.");
      return;
    }
    if (PlayerPunishment.IPBanned(this.channel.remoteAddress)) {
      this.failLogin(27, "Your IP address has been banned.");
      return;
    }
    if (
      World.getPlayers().isFull() ||
      World.getPlayerByName(username) ||
      World.getAddPlayerQueue().some((player) => player.getUsername().toLowerCase() === username.toLowerCase()) ||
      ClientConnection.pendingNames.has(key)
    ) {
      this.failLogin(World.getPlayers().isFull() ? 2 : 5, World.getPlayers().isFull()
        ? "This world is full."
        : "Your account is already logged in.");
      return;
    }
    ClientConnection.pendingNames.add(key);
    this.reservedName = key;

    let save: any | null = null;
    try {
      save = GameConstants.PLAYER_PERSISTENCE.load(username);
    } catch (error) {
      console.error(`[login] failed to load ${username}`, error);
      this.releasePendingName();
      this.failLogin(8, "The login server is busy.");
      return;
    }

    let passwordHash = "";
    try {
      if (save) {
        const stored = String(save.getPasswordHashWithSalt?.() ?? "");
        let valid = stored === password;
        if (!valid && stored.includes(":")) {
          try {
            valid = await GameConstants.PLAYER_PERSISTENCE.checkPassword(password, save);
          } catch {
            valid = false;
          }
        }
        if (stored && !valid) {
          this.releasePendingName();
          this.failLogin(3, "Invalid username or password.");
          return;
        }
        passwordHash = valid && stored.includes(":")
          ? stored
          : await GameConstants.PLAYER_PERSISTENCE.encryptPassword(password);
      } else {
        passwordHash = await GameConstants.PLAYER_PERSISTENCE.encryptPassword(password);
      }
    } catch (error) {
      console.error(`[login] failed to authenticate ${username}`, error);
      this.releasePendingName();
      this.failLogin(8, "The login server is busy.");
      return;
    }

    this.pending = { username, passwordHash, save };
    this.send(encodeLoginResponse(true, -1, "", username));
    console.info(`[login] accepted ${username} from ${this.channel.remoteAddress}`);
  }

  private enterWorld(): void {
    if (!this.pending || this.player) return;
    const pending = this.pending;
    const session = new PlayerSession(this.channel);
    const player = new Player(session, GameConstants.DEFAULT_LOCATION.clone());
    session.setPlayer(player);
    player.setUsername(pending.username);
    player.setLongUsername(Misc.stringToLongBigInt(pending.username));
    player.setHostAddress(this.channel.remoteAddress);
    if (pending.save) pending.save.applyToPlayer(player);
    if (isConfiguredDeveloperUsername(player.getUsername())) player.setRights(PlayerRights.DEVELOPER);
    player.setPasswordHashWithSalt(pending.passwordHash);
    player.setLastKnownRegion(player.getLocation().clone());
    player.getUpdateFlag().flag(Flag.APPEARANCE);

    if (!World.getPlayers().add(player)) {
      this.failLogin(2, "This world is full.");
      this.channel.close(1013, "world full");
      return;
    }
    this.player = player;
    this.releasePendingName();
    World.refreshActiveRegions();
    PluginManager.emitPlayerLogin({
      player,
      username: player.getUsername(),
      isNewAccount: pending.save == null,
    });
    this.send(
      encodeHandshake(
        player.getIndex(),
        player.getUsername(),
        PlayerRights.hasAdminRights(player),
        this.getPlayerAppearance(player),
        player.getChatIcons()
      )
    );
    this.send(encodeDefaultAnimations());
    for (const packet of encodeGameframeBootstrap(player.getUsername())) this.send(packet);
    player.getPacketSender()
      // The bootstrap mounts the magic tab (161:82 -> 218) directly, which does not send
      // varbit 4070, so the cache scripts would draw the standard book for everyone.
      // sendTabInterface(6) is the one place that publishes the spellbook varbit.
      .sendTabInterface(6, player.getSpellbook().getInterfaceId())
      .sendItemContainer(player.getInventory(), 3214)
      .sendSkillsSnapshot()
      .sendRunEnergy();
    player.getQuickPrayers().sync();
  }

  private walk(x: number, y: number, modifierFlags: number): void {
    const player = this.player;
    if (!player) return;
    player.getCombat().reset();
    const run = modifierFlags === 2 ||
      ((modifierFlags & 1) !== 0 ? !player.isRunningReturn() : player.isRunningReturn());
    player.setRunning(run);
    player.getMovementQueue().requestWalk(
      new Location(x, y, player.getLocation().getZ())
    );
    // MovementQueue owns the destination flag and de-duplicates it; sending it
    // here as well double-posts the marker on every walk click.
    player.getPacketSender().sendRunStatus();
  }

  private inventoryAction(packet: Extract<ReturnType<typeof decodeClientPackets>[number], { type: "inventory_action" }>): void {
    const player = this.player!;
    const item = player.getInventory().getItems()[packet.slot];
    if (!item || item.getId() !== packet.itemId) return;
    const option = packet.option?.toLowerCase() ?? "";
    const optionIndex = option && option !== "examine"
      ? (CacheDefinitions.getItem(packet.itemId)?.inventoryActions ?? [])
          .findIndex((action) => action?.toLowerCase() === option) + 1
      : packet.optionIndex;
    if (optionIndex === 0) return;
    if (/^(wield|wear|equip)$/.test(option)) {
      EquipPacketListener.equip(player, packet.itemId, packet.slot, 3214);
    } else if (option === "drop" || option === "destroy" || optionIndex === 5) {
      DropItemPacketListener.drop(player, packet.itemId, 3214, packet.slot);
    } else if (option === "examine") {
      const definition = ItemDefinition.forId(packet.itemId);
      player.sendMessage(definition.getExamine() || definition.getName());
    } else {
      ItemActionPacketListener.handleAction(player, packet.widgetId, packet.itemId, packet.slot, optionIndex ?? 1, packet.option);
    }
  }

  private resolveClientCombatSpellId(spellWidget: number, spellChild: number, spellItemId: number): number {
    for (const id of [spellChild, spellWidget & 0xffff, spellItemId]) {
      const spell = CombatSpells.getCombatSpell(id);
      if (spell) return spell.spellId();
    }
    try {
      const widgetId = ((spellWidget >>> 16) << 16) | (spellChild & 0xffff);
      const name = CacheDefinitions.getSpellName(spellWidget, spellItemId) ??
        CacheDefinitions.getSpellName(widgetId, spellItemId);
      const spell = name ? CombatSpells.getCombatSpellByName(name) : null;
      if (spell) return spell.spellId();
      return MAGIC_ITEMS.resolveSpellId(name);
    } catch {
      // Invalid cache-backed selections are rejected by the combat listener.
    }
    return -1;
  }

  private resolveSpellName(widgetId: number, groupId: number, childId: number, itemId?: number): string | undefined {
    const packed = (groupId << 16) | (childId & 0xffff);
    return CacheDefinitions.getSpellName(widgetId, itemId ?? -1) ??
      CacheDefinitions.getSpellName(packed, itemId ?? -1) ??
      CacheDefinitions.getSpellName(childId, itemId ?? -1);
  }

  private groundItemAction(packet: Extract<ReturnType<typeof decodeClientPackets>[number], { type: "ground_item_action" }>): void {
    const player = this.player!;
    const option = packet.option?.toLowerCase() ?? "";
    if (option === "examine") {
      const definition = ItemDefinition.forId(packet.itemId);
      player.sendMessage(definition.getExamine() || definition.getName());
    } else if (option === "take" || packet.optionIndex === 3 || packet.optionIndex == null) {
      PickupItemPacketListener.pickup(player, packet.itemId, packet.x, packet.y);
    } else {
      SecondGroundItemOptionPacketListener.interact(
        player, packet.itemId, packet.x, packet.y, packet.optionIndex ?? 2
      );
    }
  }

  private tradeAction(packet: Extract<ReturnType<typeof decodeClientPackets>[number], { type: "trade_action" }>): void {
    const player = this.player!;
    const trading = player.getTrading();
    if (packet.action === "accept" || packet.action === "confirm_accept") {
      trading.acceptTrade();
    } else if (packet.action === "decline" || packet.action === "confirm_decline") {
      trading.closeTrade();
    } else if (packet.itemId != null && packet.quantity > 0) {
      const offer = packet.action === "offer";
      trading.handleItem(
        packet.itemId, packet.quantity, packet.slot,
        offer ? player.getInventory() : trading.getContainer(),
        offer ? trading.getContainer() : player.getInventory()
      );
    }
  }

  private getPlayerAppearance(player: Player): PlayerAppearance {
    const look = player.getAppearance().getLook();
    const displayEquipment = player.getEquipment().getItems();
    return {
      gender: look[Appearance.GENDER] ?? 0,
      colors: [
        look[Appearance.HAIR_COLOUR],
        look[Appearance.TORSO_COLOUR],
        look[Appearance.LEG_COLOUR],
        look[Appearance.FEET_COLOUR],
        look[Appearance.SKIN_COLOUR],
      ].map((value) => value ?? 0),
      kits: [
        look[Appearance.HEAD],
        look[Appearance.BEARD],
        look[Appearance.CHEST],
        look[Appearance.ARMS],
        look[Appearance.HANDS],
        look[Appearance.LEGS],
        look[Appearance.FEET],
      ].map((value) => value ?? -1),
      equip: displayEquipment.map((item) => item?.getId?.() ?? -1),
      equipQty: displayEquipment.map((item) => item?.getAmount?.() ?? 0),
      headIcons: {
        skull: player.isSkulled() ? player.getSkullIconId() : -1,
        prayer: player.getAppearance().getHeadHint(),
      },
    };
  }

  private failLogin(code: number, message: string): void {
    this.send(encodeLoginResponse(false, code, message));
  }

  private send(packet: Buffer): void {
    if (this.player) {
      this.player.getSession().sendClientPacket(packet);
    } else if (this.channel.isOpen()) {
      this.channel.send(packet);
    }
  }

  private releasePendingName(): void {
    if (this.reservedName) ClientConnection.pendingNames.delete(this.reservedName);
    this.reservedName = undefined;
    this.pending = undefined;
  }

  private cleanup(source: string): void {
    if (this.closed) return;
    this.closed = true;
    this.releasePendingName();
    if (!this.player) return;
    if (!World.getRemovePlayerQueue().includes(this.player)) {
      World.getRemovePlayerQueue().push(this.player);
    }
    PluginManager.emitPlayerDisconnect({
      player: this.player,
      username: this.player.getUsername(),
      source,
    });
  }
}
