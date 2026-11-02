import { createServer } from "http";
import { WebSocketServer } from "ws";
import { GameConstants } from "../game/GameConstants";
import { World } from "../game/World";
import { Player } from "../game/entity/impl/player/Player";
import { PlayerSave } from "../game/entity/impl/player/persistence/PlayerSave";
import { Appearance } from "../game/model/Appearance";
import { Flag } from "../game/model/Flag";
import { Location } from "../game/model/Location";
import { PlayerStatus } from "../game/model/PlayerStatus";
import { PlayerRights } from "../game/model/rights/PlayerRights";
import { isMembersWorld } from "../game/definition/WorldDefinition";
import { PluginManager } from "../plugins/PluginManager";
import { NetworkConstants } from "./NetworkConstants";
import { Misc } from "../util/Misc";
import { PlayerPunishment } from "../util/PlayerPunishment";
import { BinaryChannel, HeadlessBinaryChannel, MAX_GAME_MESSAGE_BYTES, WebSocketBinaryChannel } from "./BinaryChannel";
import { BrowserHostHttpBridge, BROWSER_HOST_BRIDGE_HTML } from "./BrowserHostHttpBridge";
import { PlayerSession } from "./PlayerSession";
import { CachePipeline } from "../game/cache/CachePipeline";
import { ContentApi } from "./http/ContentApi";
import { GatewayTarget } from "./http/GatewayTarget";
import { CacheDefinitions } from "../game/cache/CacheDefinitions";
import {
  CREATION_MENU_GROUP_ID,
  CREATION_MENU_FIRST_ITEM_COMPONENT,
  CREATION_MENU_MAX_QUANTITY,
  CREATION_MENU_LAST_ITEM_ATTRIBUTE,
} from "./packet/PacketSender";
import { Equipment } from "../game/model/container/impl/Equipment";
import { MapRegionReplacementManager } from "../game/collision/MapRegionReplacementManager";
import {
  decodeClientPackets,
  MAIN_INVENTORY_GROUP_ID,
  MOBILE_CLIENT_ATTRIBUTE,
  NATIVE_CLIENT_ATTRIBUTE,
  HANDSHAKE_CAPABILITY_NATIVE_CLIENT,
  XPDROPS_ENABLED_ATTRIBUTE,
  encodeDefaultAnimations,
  encodeGameframeBootstrap,
  encodeHandshake,
  encodeLoginResponse,
  encodeWelcome,
  PlayerAppearance,
  resolveGameframeRoot,
  encodePluginMessage,
} from "./protocol/ClientProtocol";
import {
  WORLD_MAP_CLOSE_WIDGET_ID,
  isWorldMapOrbWidget,
} from "./protocol/WorldMapProtocol";
import { ObjectActionPacketListener } from "./packet/impl/ObjectActionPacketListener";
import { NPCOptionPacketListener } from "./packet/impl/NPCOptionPacketListener";
import { ChatPacketListener } from "./packet/impl/ChatPacketListener";
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
import { BoatManager } from "../game/content/sailing/BoatManager";
import { Sailing } from "../game/content/sailing/Sailing";
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
import { LEAGUE_PROFILE, MAIN_PROFILE, type PlayerProfile } from "../game/entity/impl/player/persistence/PlayerProfile";
import {
  LOGIN_FLAG_REMEMBER,
  LOGIN_FLAG_TOKEN,
  LOGIN_TOKENS_ATTRIBUTE,
  checkLoginToken,
  issueLoginToken,
  readLoginTokens,
  revokeLoginToken,
  type LoginTokenEntry,
} from "./login/LoginTokens";

const OBJECT_ACTIONS = new ObjectActionPacketListener();
const NPC_ACTIONS = new NPCOptionPacketListener();
const MAGIC_ITEMS = new MagicOnItemPacketListener();
type ClientMessages = ReturnType<typeof decodeClientPackets>;
const CONNECTIONS = new WeakMap<Player, ClientConnection>();

/** Runs already-decoded messages through a logged-in player's own dispatch, as if their client sent them. */
export function dispatchClientMessages(player: Player, messages: ClientMessages): boolean {
  const connection = CONNECTIONS.get(player);
  if (!connection) return false;
  connection.inject(messages);
  return true;
}

/** Logs a player in through the normal login path with no client attached. Closing their session logs them out. */
export async function connectHeadlessClient(username: string, password: string): Promise<{ player?: Player; error?: string }> {
  const connection = new ClientConnection(new HeadlessBinaryChannel());
  connection.inject([
    { type: "login", username, password, revision: CachePipeline.getActive().revision, flags: 0 },
    { type: "handshake", name: username, clientType: 0, capabilities: 0 },
  ]);
  await connection.idle();
  const player = connection.getPlayer();
  return player ? { player } : { error: connection.getLoginFailure() ?? "Login did not complete." };
}

/** "Log out" on the remembered-account screen: the server drops that browser's token from this world's character's save. */
async function forgetLoginToken(rawUsername: string, token: string): Promise<void> {
  const username = Misc.formatDisplayName(rawUsername);
  const protocolName = Misc.formatNameForProtocol(username);
  if (protocolName.length < 1 || protocolName.length > 12 || !Misc.isValidName(protocolName)) return;
  const profile = GameConstants.WORLD_PROFILE;
  const online = World.getPlayerByName(username);
  if (online) {
    const entries = readLoginTokens(online.getAttribute(LOGIN_TOKENS_ATTRIBUTE), Date.now());
    const check = checkLoginToken(entries, token);
    if (check.kind === "valid") online.setAttribute(LOGIN_TOKENS_ATTRIBUTE, revokeLoginToken(entries, check.index));
    return;
  }
  try {
    // Only a token the account holds causes a write, so made-up requests cost nothing.
    const save = GameConstants.PLAYER_PERSISTENCE.load(username, profile);
    if (!save || checkLoginToken(readLoginTokens(save.attributes?.[LOGIN_TOKENS_ATTRIBUTE], Date.now()), token).kind !== "valid") return;
    await GameConstants.PLAYER_PERSISTENCE.updateOffline(username, (stored) => {
      const entries = readLoginTokens(stored.attributes?.[LOGIN_TOKENS_ATTRIBUTE], Date.now());
      const check = checkLoginToken(entries, token);
      if (check.kind !== "valid") return;
      stored.attributes = { ...(stored.attributes ?? {}), [LOGIN_TOKENS_ATTRIBUTE]: revokeLoginToken(entries, check.index) };
    }, "login-token", profile);
  } catch (error) {
    console.warn(`[login] could not forget a login token for ${username}`, error);
  }
}

const CLOSE_ON_INTERFACE_CLOSE_ATTRIBUTE = "interface:close-on-interface-close";
/** The combat tab (combat_interface) and its auto-retaliate and special attack buttons. */
const COMBAT_INTERFACE = 593;
const COMBAT_AUTO_RETALIATE_CHILD = 32;
/**
 * The combat tab's special attack bar. Rev 241 moved the visible bar to 57 (under 39); 41 is
 * the older bar, now under a container the cache keeps hidden. 67 is the offhand bar.
 */
const COMBAT_SPECIAL_ATTACK_CHILDREN = new Set([41, 57]);
const WORLD_INTERACTIONS = new Set([
  "move",
  "teleport",
  "world_map_click",
  "npc_option",
  "object_option",
  "world_entity_option",
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

/**
 * Packets acted on as they arrive: connection upkeep, logging in, client-plugin traffic (voice
 * signalling), free movement's real-time input (its client runs at most a tick ahead of the
 * server's answer) and logout, which World answers on the tick itself. A logged-in player's other
 * packets wait for the start of their next turn, as live OSRS acts on input on the next tick.
 */
const IMMEDIATE_PACKETS = new Set([
  "hello",
  "ping",
  "raw",
  "login",
  "login_forget",
  "handshake",
  "plugin_message",
  "movement_input",
  "logout",
]);

/** Packets the client sends on its own, which don't count as the player's input. */
const NON_INPUT_PACKETS = new Set([
  "hello",
  "ping",
  "login",
  "handshake",
  "logout",
  "raw",
  "varp_transmit",
  "plugin_message",
  "local_trigger",
]);

type PendingLogin = {
  username: string;
  /** Which of the account's characters is logging in: the league one on a league world. */
  profile: PlayerProfile;
  passwordHash: string;
  save: any | null;
  /** The account's remembered logins after this one, or null when they didn't change. */
  loginTokens: LoginTokenEntry[] | null;
};

/** Whether `username` is one of `DEV_USERNAME`'s accounts (comma-separated). */
export function isConfiguredDeveloperUsername(username: string): boolean {
  const name = username.toLowerCase();
  return (process.env.DEV_USERNAME ?? "")
    .split(",")
    .some((developer) => developer.trim() !== "" && developer.trim().toLowerCase() === name);
}

export class NetworkBuilder {
  public initialize(port: number): WebSocketServer | undefined {
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
      const gatewayTarget = GatewayTarget.resolve(request.url ?? "", port);
      if (gatewayTarget) {
        response.setHeader("Content-Type", gatewayTarget.contentType);
        response.end(gatewayTarget.body);
        return;
      }
      if (request.url === "/regions") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ regions: MapRegionReplacementManager.getRegionIds() }));
        return;
      }
      // Terrain-only replacements have no pack (the .pack format needs object
      // data too); the map editor fetches their raw terrain bytes here instead.
      const terrainMatch = /^\/regions\/(\d+)\.terrain$/.exec(request.url ?? "");
      if (terrainMatch) {
        const terrain = MapRegionReplacementManager.getReplacementMapData(
          Number(terrainMatch[1]))?.terrainData;
        if (!terrain) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader("Content-Type", "application/octet-stream");
        response.setHeader("Content-Length", terrain.length);
        response.end(Buffer.from(terrain));
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
    // Browser-host clients arrive through the HTTP bridge above, never a WebSocket.
    // Only dedicated/desktop deployments need the game WebSocket listener.
    const server = browserHost ? undefined : new WebSocketServer({
      server: http,
      perMessageDeflate: false,
      maxPayload: MAX_GAME_MESSAGE_BYTES,
    });
    server?.on("connection", (socket, request) => new ClientConnection(new WebSocketBinaryChannel(socket, request)));
    server?.on("listening", () => console.info(`[network] client websocket listening on ${port}`));
    server?.on("error", (error) => console.error("[network] websocket error", error));
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

export class ClientConnection {
  private static readonly pendingNames = new Set<string>();
  /**
   * A logged-in connection that sends nothing for this long is dead: the client pings every 5 s
   * while the server talks. A phone that sleeps or changes network never closes its socket (a
   * tunnel keeps the server's end open too), and its player stayed in the world, so logging back
   * in failed with "already logged in".
   */
  private static readonly IDLE_TIMEOUT_MS = 30_000;
  private static readonly IDLE_CHECK_MS = 5_000;
  private lastFrameAt = Date.now();
  /** Set by the first ping: a client from before the keepalive is never timed out. */
  private sendsKeepalive = false;
  private idleCheck?: ReturnType<typeof setInterval>;
  private pending?: PendingLogin;
  private reservedName?: string;
  private player?: Player;
  private pluginMessageWindow = 0;
  private pluginMessageCount = 0;
  private closed = false;
  private loginFailure?: string;
  private input = Promise.resolve();
  private queuedInputFrames = 0;
  /** Packets received since this player's last turn (see IMMEDIATE_PACKETS). */
  private turnPackets: ClientMessages = [];
  /**
   * A click held while an attack animation stalls the player (Wiki: Animation stall). Only one
   * is kept: the last click made during the lock is the one that runs, on the tick it releases.
   */
  private stalledInput: ClientMessages[number] | null = null;

  constructor(private readonly channel: BinaryChannel) {
    channel.onData((frame) => {
      if (this.closed) return;
      this.lastFrameAt = Date.now();
      if (frame.length > MAX_GAME_MESSAGE_BYTES || this.queuedInputFrames >= NetworkConstants.PACKET_QUEUE_LIMIT) {
        console.warn("[network] client input limit exceeded", { bytes: frame.length, queued: this.queuedInputFrames });
        this.cleanup("input_limit");
        channel.close(1008, "input limit");
        return;
      }
      this.queuedInputFrames++;
      this.input = this.input.then(() => this.handle(frame)).catch((error) => {
        console.warn("[network] client packet rejected", error);
      }).finally(() => {
        this.queuedInputFrames--;
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
    if (this.closed) return;
    let packets;
    try {
      packets = decodeClientPackets(frame);
    } catch (error) {
      console.warn("[network] rejected malformed client packet", (error as Error).message);
      this.cleanup("malformed_packet");
      this.channel.close(1002, "malformed packet");
      return;
    }
    await this.dispatch(packets);
  }

  public inject(messages: ClientMessages): void {
    this.input = this.input.then(() => this.dispatch(messages)).catch((error) => {
      console.warn("[network] injected client packet rejected", error);
    });
  }

  public idle(): Promise<void> {
    return this.input;
  }

  public getPlayer(): Player | undefined {
    return this.player;
  }

  public getLoginFailure(): string | undefined {
    return this.loginFailure;
  }

  /**
   * Acts on the packets received since this player's last turn, at the start of their turn.
   * They run even after a disconnect: input that arrived still counts while the player is held
   * in the world.
   */
  public processTurnPackets(): void {
    if (this.turnPackets.length === 0 && this.stalledInput == null) return;
    const packets = this.turnPackets;
    this.turnPackets = [];
    // Retry a held click ahead of this turn's input, so it runs on the first tick the player is
    // free; dispatch() puts it back if the stall has not released yet.
    if (this.stalledInput != null) {
      packets.unshift(this.stalledInput);
      this.stalledInput = null;
    }
    // None of these await, so they all run now, inside the player's turn.
    this.dispatch(packets, true).catch((error) => {
      console.warn("[network] client packet rejected", error);
    });
  }

  private async dispatch(packets: ClientMessages, turn = false): Promise<void> {
    // Frames already queued on the input chain can outlive the socket (a handshake
    // buffered before a disconnect, for example). A closed connection must not act
    // on them or build a player for a socket that is already gone.
    if (this.closed && !turn) return;
    for (const packet of packets) {
      if (this.closed && !turn) return;
      if (!turn && this.player && !IMMEDIATE_PACKETS.has(packet.type)) {
        if (this.turnPackets.length >= NetworkConstants.PACKET_QUEUE_LIMIT) {
          console.warn("[network] client turn packet limit exceeded", { queued: this.turnPackets.length });
          this.cleanup("input_limit");
          this.channel.close(1008, "input limit");
          return;
        }
        this.turnPackets.push(packet);
        continue;
      }
      if (this.player) LunarSpells.expireSpellbookSwap(this.player);
      if (this.player && !NON_INPUT_PACKETS.has(packet.type)) this.player.lastInputCycle = World.getProcessCycle();
      if (this.player && WORLD_INTERACTIONS.has(packet.type)) {
        if (this.player.getCombat().isAnimationStalled()) {
          // Wiki: Animation stall. A full stall does not let the player perform actions, so the
          // click is held rather than dropped and runs on the tick the animation ends. The last
          // one made during the lock is the one kept, as the client only ever has one queued.
          this.stalledInput = packet;
          continue;
        }
        if (this.player.getStatus() === PlayerStatus.TRADING) continue;
        const input = { player: this.player, packet, handled: false };
        PluginManager.emitCustomEvent("player:world-input", input);
        if (input.handled) continue;
        if (
          (packet.type !== "move" || this.player.getMovementQueue().getMobility().canMove()) &&
          !(packet.type === "inventory_action" && EquipPacketListener.preservesInterfaceOnEquip(this.player))
        ) {
          this.player.closeInterruptibleInterfaces();
        }
      }
      switch (packet.type) {
        case "plugin_message": {
          if (!this.player) continue;
          const now = Date.now();
          if (now - this.pluginMessageWindow >= 1000) {
            this.pluginMessageWindow = now;
            this.pluginMessageCount = 0;
          }
          if (++this.pluginMessageCount > 64) continue;
          const event = { player: this.player, channel: packet.channel, data: packet.data, handled: false };
          PluginManager.emitCustomEvent("network:plugin-message", event);
          if (!event.handled) this.player.getSession().sendClientPacket(encodePluginMessage(packet.channel, { type: "unavailable" }));
          continue;
        }
        case "movement_input":
          if (this.player && this.player.getStatus() !== PlayerStatus.TRADING) {
            PluginManager.emitCustomEvent("player:movement-input", { player: this.player, packet });
          }
          continue;
        case "move":
          this.walk(packet.worldX, packet.worldY, packet.modifierFlags, packet.run === true);
          continue;
        case "set_heading":
          if (this.player) BoatManager.setHelmHeading(this.player, packet.heading);
          continue;
        case "npc_option":
          if (this.player) NPC_ACTIONS.executeOption(this.player, packet.index, packet.clickType);
          continue;
        case "world_entity_option":
          if (this.player) {
            // Forged/foreign/out-of-range world-entity indices never reach plugin handlers.
            const boat = BoatManager.getBoat(packet.index);
            const root = BoatManager.rootLocation(this.player);
            if (boat && BoatManager.canSeeBoat(this.player, boat)
              && root.isWithinDistance(new Location(boat.tileX, boat.tileY, boat.level), 32)) {
              PluginManager.emitWorldEntityInteraction({
                player: this.player,
                entityIndex: packet.index,
                clickType: packet.clickType,
                handled: false,
              });
            }
          }
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
            if (target) {
              const event = {
                player: this.player, target, spellName, spellWidget: packet.spellWidget,
                spellChild: packet.spellChild, spellItemId: packet.spellItemId, handled: false,
              };
              PluginManager.emitCustomEvent("magic:spell-on-player", event);
              if (event.handled) continue;
            }
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
              ChatPacketListener.handleText(this.player, packet.text, packet.autoChat === true, packet.style);
            } else if (packet.messageType === "friends_chat") {
              PluginManager.emitSocialPacket({
                player: this.player, packet: packet as typeof packet & { messageType: "friends_chat" }, handled: false,
              });
            }
          }
          continue;
        case "friends_chat_action":
        case "private_message":
        case "chat_filter":
        case "report_abuse":
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
              const limit = creationMenu.getOptions?.()?.maxAmount;
              const amount = Number.isInteger(packet.childIndex) && packet.childIndex > 0
                ? Math.min(packet.childIndex, Number.isInteger(limit) ? limit : CREATION_MENU_MAX_QUANTITY)
                : 1;
              // Remembered for the space key next time (CREATION_MENU_LAST_ITEM_VARP).
              this.player.setAttribute(CREATION_MENU_LAST_ITEM_ATTRIBUTE, creationChildId - CREATION_MENU_FIRST_ITEM_COMPONENT);
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
          this.player?.getDialogueManager().handleResume(packet.widgetId, packet.childIndex);
          continue;
        }
        case "dialogue_amount": {
          const action = this.player?.getEnteredAmountAction();
          // 0 is dropped unless the prompt takes it (a setting where 0 means off).
          if (action && (packet.amount > 0 || (packet.amount === 0 && action.acceptsZero === true) || (packet.amount < 0 && action.acceptsNegative === true))) {
            action.execute(packet.amount);
          }
          this.player?.setEnteredAmountAction(null);
          continue;
        }
        case "dialogue_input": {
          const action = this.player?.getEnteredSyntaxAction();
          if (action) action.execute(packet.value);
          // A handler may keep the input open (e.g. the ::items spawn search, which stays
          // armed for repeat picks); only clear the action when it did not re-arm itself.
          if (this.player?.getEnteredSyntaxAction() === action) {
            this.player?.setEnteredSyntaxAction(null);
          }
          continue;
        }
        case "widget_action":
          if (this.player) {
            const widgetAction = { player: this.player, packet, handled: false };
            PluginManager.emitCustomEvent("player:widget-action", widgetAction);
            if (widgetAction.handled) continue;
            const actionPacket = { ...packet, buttonNum: packet.buttonNum ?? 0 };
            // The dialogue this click can answer: one opened by the click itself (an inventory
            // option's statement) must not take the same click as its option.
            const openDialogue = this.player.getDialogueManager().getCurrent();
            const equipmentSlot = EquipPacketListener.resolveEquipmentSlot(actionPacket.groupId, actionPacket.childId);
            if (isWorldMapOrbWidget(actionPacket.widgetId) && actionPacket.buttonNum === 2) {
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
            } else if (actionPacket.groupId === COMBAT_INTERFACE && actionPacket.childId === COMBAT_AUTO_RETALIATE_CHILD) {
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
            } else if (actionPacket.groupId === COMBAT_INTERFACE && COMBAT_SPECIAL_ATTACK_CHILDREN.has(actionPacket.childId)) {
              CombatSpecial.activate(this.player);
            } else if (WeaponInterfaceManager.handleStyleButton(this.player, actionPacket.groupId, actionPacket.childId)) {
              BonusManager.update(this.player);
            } else if (Autocasting.handleWidgetAction(
              this.player, actionPacket.groupId, actionPacket.childId, actionPacket.slot
            )) {
              // Cache-native combat autocast controls reuse the existing spell state.
            } else if (this.emitSpellCast(actionPacket)) {
              // Plugins own the self-cast spells they register for, by cache spell name.
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
            if (this.player.getDialogueManager().isActive() && openDialogue != null &&
                this.player.getDialogueManager().getCurrent() === openDialogue &&
                actionPacket.buttonNum > 0 && actionPacket.buttonNum <= 5) {
              this.player.getDialogueManager().handleOption(actionPacket.buttonNum - 1 as DialogueOption);
            }
          }
          continue;
        case "varp_transmit":
          if (this.player) {
            const transmission = { player: this.player, varpId: packet.varpId, value: packet.value, handled: false };
            PluginManager.emitCustomEvent("player:varp-transmit", transmission);
            if (transmission.handled) continue;
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
            this.player.applyAudioSettingFromClient(packet.varpId, packet.value);
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
          ) && !PluginManager.emitSpellOnItem({
            player: this.player,
            spellName: CacheDefinitions.getSpellName(packet.sourceWidgetId, packet.sourceItemId),
            spellWidget: packet.sourceWidgetId,
            spellItemId: packet.sourceItemId,
            itemId: packet.targetItemId,
            slot: packet.targetSlot,
            handled: false,
          }) && !MAGIC_ITEMS.castOnItem(
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
          if (this.player) {
            const widgetDrag = { player: this.player, packet, handled: false };
            PluginManager.emitCustomEvent("player:widget-action", widgetDrag);
            if (widgetDrag.handled) continue;
          }
          if (this.player && !Bank.handleDrag(this.player, packet)) SwitchItemSlotPacketListener.move(
            this.player, packet.sourceWidgetId, packet.sourceSlot, packet.targetSlot
          );
          continue;
        case "interface_close":
          if (this.player) {
            const close = { player: this.player, handled: false };
            PluginManager.emitCustomEvent("interface:close", close);
            if (close.handled) continue;
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
          } else if (this.player) {
            // A script trigger (if_triggeroplocal from a cache script, like the boat
            // customisation's Build): the component, the child it was for, and the script's
            // arguments (ints as zigzag varints, strings null-terminated).
            InterfaceActionClickOpcode.handle(this.player, packet.widgetId, 0, {
              groupId: packet.widgetId >>> 16,
              childId: packet.widgetId & 0xffff,
              slot: packet.childIndex >= 0 ? packet.childIndex : undefined,
              itemId: packet.itemId >= 0 ? packet.itemId : undefined,
              argsData: packet.argsData,
              scriptTrigger: true,
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
            const examineEvent = {
              player: this.player,
              objectId: packet.id,
              handled: false,
            };
            PluginManager.emitCustomEvent("world:object-examine", examineEvent);
            if (examineEvent.handled) continue;
            // A multi-loc's text can be recorded under the variant this player sees.
            const definition = ObjectDefinition.forId(packet.id);
            const seen = ObjectDefinition.examineText(packet.id) === null ? ObjectDefinition.forPlayer(packet.id, this.player) : null;
            this.player.sendMessage((seen && ObjectDefinition.examineText(seen.id) ? seen : definition)?.getExamine() ?? "It's nothing special.");
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
            this.player.getMovementQueue().reset();
            this.player.getMovementQueue().walkToReset();
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
        case "ping":
          this.sendsKeepalive = true;
          continue;
        case "hello":
          continue;
        case "login":
          await this.login(packet.username, packet.password, packet.revision, packet.flags);
          continue;
        case "login_forget":
          await forgetLoginToken(packet.username, packet.token);
          continue;
        case "handshake":
          this.enterWorld(packet.clientType, packet.capabilities);
          continue;
        case "logout":
          // Answered on the next tick (World.answerLogoutRequest), which closes the socket.
          if (this.player) World.queueLogoutRequest(this.player);
          continue;
      }
    }
  }

  private async login(rawUsername: string, password: string, revision: number, flags = 0): Promise<void> {
    const tokenLogin = (flags & LOGIN_FLAG_TOKEN) !== 0;
    // A league world logs the account's league character in: a separate save under the same name.
    const profile = GameConstants.WORLD_PROFILE;
    this.releasePendingName();
    const typedName = Misc.formatDisplayName(rawUsername);
    const protocolName = Misc.formatNameForProtocol(typedName);
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
    if (PlayerPunishment.banned(typedName)) {
      this.failLogin(4, "Your account has been disabled.");
      return;
    }
    if (PlayerPunishment.IPBanned(this.channel.remoteAddress)) {
      this.failLogin(27, "Your IP address has been banned.");
      return;
    }
    if (
      World.getPlayers().isFull() ||
      World.getPlayerByName(typedName) ||
      World.getAddPlayerQueue().some((player) => Misc.formatNameForProtocol(player.getUsername()) === protocolName) ||
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
    // The account's credential is its main character's save; a league character's own hash only
    // stands in while no main character exists (an account first made on a league world), on
    // either world. So a name can't be claimed on either world with a password of one's own, and
    // a password change (PlayerPersistence.changePassword) reaches both characters.
    let credentials: any | null = null;
    try {
      save = GameConstants.PLAYER_PERSISTENCE.load(typedName, profile);
      const main = profile === MAIN_PROFILE ? save : GameConstants.PLAYER_PERSISTENCE.load(typedName, MAIN_PROFILE);
      credentials = main ?? save ?? (profile === MAIN_PROFILE ? GameConstants.PLAYER_PERSISTENCE.load(typedName, LEAGUE_PROFILE) : null);
    } catch (error) {
      console.error(`[login] failed to load ${typedName}`, error);
      this.releasePendingName();
      this.failLogin(8, "The login server is busy.");
      return;
    }

    // A remembered login only signs in to a character that exists (its tokens live in its own save).
    if (tokenLogin && !save) {
      this.releasePendingName();
      this.failLogin(3, "Invalid username or password.");
      return;
    }

    let passwordHash = "";
    let loginToken = "";
    let loginTokens: LoginTokenEntry[] | null = null;
    try {
      if (tokenLogin) {
        const now = Date.now();
        const entries = readLoginTokens(save.attributes?.[LOGIN_TOKENS_ATTRIBUTE], now);
        const check = checkLoginToken(entries, password);
        if (check.kind !== "valid") {
          if (check.kind === "reused") {
            console.warn(`[login] ${typedName}: a replaced login token was used again; revoking it`);
            await this.saveLoginTokens(typedName, profile, save, revokeLoginToken(entries, check.index));
          }
          this.releasePendingName();
          this.failLogin(3, "Invalid username or password.");
          return;
        }
        ({ token: loginToken, entries: loginTokens } = issueLoginToken(entries, now, check.index));
        await this.saveLoginTokens(typedName, profile, save, loginTokens);
        passwordHash = String(save.getPasswordHashWithSalt?.() ?? "");
      } else if (credentials) {
        const stored = String(credentials.getPasswordHashWithSalt?.() ?? "");
        // Only a save from before hashing holds the plain password. A hash must never match
        // the typed text, even though the 64-character limit happens to rule out real ones.
        let valid = !!stored && !stored.includes(":") && stored === password;
        if (!valid && stored.includes(":")) {
          try {
            valid = await GameConstants.PLAYER_PERSISTENCE.checkPassword(password, credentials);
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
      if (!tokenLogin && (flags & LOGIN_FLAG_REMEMBER) !== 0) {
        const now = Date.now();
        const entries = readLoginTokens(save?.attributes?.[LOGIN_TOKENS_ATTRIBUTE], now);
        ({ token: loginToken, entries: loginTokens } = issueLoginToken(entries, now));
        if (save) await this.saveLoginTokens(typedName, profile, save, loginTokens);
      }
    } catch (error) {
      console.error(`[login] failed to authenticate ${typedName}`, error);
      this.releasePendingName();
      this.failLogin(8, "The login server is busy.");
      return;
    }

    // encryptPassword/checkPassword are async; the socket can close while they run.
    // Do not leave a pending login behind for a connection cleanup already released.
    if (this.closed) {
      this.releasePendingName();
      return;
    }
    // An account keeps the name it was first saved with (either character's); the typed one only names a new account.
    const savedName = String((save ?? credentials)?.getDisplayName?.() ?? "");
    const username = Misc.formatNameForProtocol(savedName) === protocolName ? savedName : typedName;
    this.pending = { username, profile, passwordHash, save, loginTokens };
    this.send(encodeLoginResponse(true, -1, "", username, loginToken));
    console.info(`[login] accepted ${username} from ${this.channel.remoteAddress}`);
  }

  private enterWorld(clientType: number = 0, capabilities: number = 0): void {
    if (!this.pending || this.player) return;
    if (this.closed) {
      this.releasePendingName();
      return;
    }
    const pending = this.pending;
    const session = new PlayerSession(this.channel);
    session.setTurnPacketProcessor(() => this.processTurnPackets());
    const player = new Player(session, GameConstants.DEFAULT_LOCATION.clone());
    session.setPlayer(player);
    player.setUsername(pending.username);
    player.setProfile(pending.profile);
    player.setLongUsername(Misc.stringToLongBigInt(pending.username));
    player.setHostAddress(this.channel.remoteAddress);
    // Transient (not persisted) so a mobile login never overwrites the layout
    // saved from a desktop session; resolveGameframeRoot reads it at boot.
    if (clientType === 1) player.setAttribute(MOBILE_CLIENT_ATTRIBUTE, true);
    if (capabilities & HANDSHAKE_CAPABILITY_NATIVE_CLIENT) player.setAttribute(NATIVE_CLIENT_ATTRIBUTE, true);
    if (pending.save) pending.save.applyToPlayer(player);
    else PlayerSave.applyAttributeDefaults(player);
    if (isConfiguredDeveloperUsername(player.getUsername())) player.setRights(PlayerRights.DEVELOPER);
    player.setPasswordHashWithSalt(pending.passwordHash);
    if (pending.loginTokens) player.setAttribute(LOGIN_TOKENS_ATTRIBUTE, pending.loginTokens);
    player.setLastKnownRegion(player.getLocation().clone());
    player.getUpdateFlag().flag(Flag.APPEARANCE);

    if (!World.getPlayers().add(player)) {
      this.releasePendingName();
      this.failLogin(2, "This world is full.");
      this.channel.close(1013, "world full");
      return;
    }
    this.player = player;
    this.startIdleCheck();
    CONNECTIONS.set(player, this);
    this.releasePendingName();
    // Back aboard a boat they logged out on at sea.
    Sailing.onLogin(player);
    World.refreshActiveRegions();
    PluginManager.emitPlayerLogin({
      player,
      username: player.getUsername(),
      isNewAccount: pending.save == null,
      profile: pending.profile,
    });
    this.send(
      encodeHandshake(
        player.getIndex(),
        player.getUsername(),
        PlayerRights.hasAdminRights(player),
        this.getPlayerAppearance(player),
        player.getChatIcons(),
        isMembersWorld()
      )
    );
    this.send(encodeDefaultAnimations());
    // 548/164/161 - what the "Game client layout" dropdown (Settings.plugin.js)
    // stores; the client maps the standard mounts onto the chosen layout.
    // Mobile clients resolve to the stock mobile toplevel (601) instead.
    const layoutRoot = resolveGameframeRoot(player);
    for (const packet of encodeGameframeBootstrap(player.getUsername(), layoutRoot, player.getAttribute(XPDROPS_ENABLED_ATTRIBUTE) === true)) this.send(packet);
    player.getPacketSender()
      // Publish the saved spellbook before the remaining login state and quest recovery.
      .sendTabInterface(6, player.getSpellbook().getInterfaceId())
      // Cache script 828 sets varc 103 (account is a member), which the GE, collection box
      // and membership panels read; everyone on a members world is a member.
      .sendInterfaceScript(828, [isMembersWorld() ? 1 : 0])
      .sendItemContainer(player.getInventory(), 3214)
      // Worn equipment: the browser reads it from appearance; the official client (native
      // attribute) gets inventory 94 itself, quantities included.
      .sendItemContainer(player.getEquipment(), Equipment.INVENTORY_INTERFACE_ID)
      .sendSkillsSnapshot()
      .sendRunEnergy();
    player.getQuickPrayers().sync();
    // Spell-unlock varps can share storage with quest transforms. Recover them at login,
    // even while a plugin's welcome screen is visible.
    PluginManager.emitCustomEvent("player:bootstrap-complete", { player, username: player.getUsername() });
  }

  private walk(x: number, y: number, modifierFlags: number, forceRun = false): void {
    const player = this.player;
    if (!player) return;
    // At a boat's helm a click sets the heading (the client normally sends SET_HEADING).
    if (BoatManager.steerToward(player, x, y)) return;
    player.getCombat().reset();
    // Ctrl (1) inverts the run toggle for this walk; Ctrl+Shift (2) is a staff teleport that
    // plugins take over, and walks like a Ctrl-click for everyone else.
    const invert = modifierFlags === 2 || (modifierFlags & 1) !== 0;
    // The inversion holds for this path only; the run setting and orb stay as they are.
    const runOverride = forceRun ? true : invert ? !player.isRunningReturn() && player.getRunEnergy() > 0 : null;
    // MovementQueue owns the destination flag and de-duplicates it; sending it
    // here as well double-posts the marker on every walk click.
    player.getMovementQueue().requestWalk(
      new Location(x, y, player.getLocation().getZ()),
      runOverride
    );
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
    // Quest greegrees have equipment slots but no cache Wield action.
    if (/^(wield|wear|equip|hold)$/.test(option)
      && ItemDefinition.forId(packet.itemId).getEquipmentType().getSlot() >= 0) {
      EquipPacketListener.equip(player, packet.itemId, packet.slot, 3214);
      return;
    }
    if (optionIndex === 0) return;
    if (ItemActionPacketListener.isDropOption(option, optionIndex)) {
      if (!ItemActionPacketListener.handleAction(player, packet.widgetId, packet.itemId, packet.slot, optionIndex ?? 5, packet.option)) {
        DropItemPacketListener.drop(player, packet.itemId, 3214, packet.slot);
      }
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

  private emitSpellCast(packet: { widgetId: number; groupId: number; childId: number; itemId?: number; buttonNum?: number; opId?: number }): boolean {
    const spellName = this.resolveSpellName(packet.widgetId, packet.groupId, packet.childId, packet.itemId);
    return spellName !== undefined && PluginManager.emitSpellCast({
      player: this.player, spellName, spellWidget: packet.widgetId, spellItemId: packet.itemId ?? -1,
      opId: packet.buttonNum ?? packet.opId ?? 1, handled: false,
    });
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
    const actions = CacheDefinitions.getItem(packet.itemId)?.groundActions ?? [];
    if (option === "examine") {
      const definition = ItemDefinition.forId(packet.itemId);
      player.sendMessage(definition.getExamine() || definition.getName());
      return;
    }
    if (option === "take") {
      PickupItemPacketListener.pickup(player, packet.itemId, packet.x, packet.y, packet.stackId);
      return;
    }

    if (option) {
      const namedIndex = actions.findIndex((action) => action?.toLowerCase() === option);
      if (namedIndex < 0) return;
      // The name must match the cache, and a supplied op number must agree with it.
      const index = packet.optionIndex ?? namedIndex + 1;
      if (index !== namedIndex + 1) return;
      SecondGroundItemOptionPacketListener.interact(
        player, packet.itemId, packet.x, packet.y, index
      );
    } else {
      const index = packet.optionIndex ?? 3;
      const action = actions[index - 1];
      if (action?.toLowerCase() === "take" || (index === 3 && !action)) {
        PickupItemPacketListener.pickup(player, packet.itemId, packet.x, packet.y, packet.stackId);
        return;
      }
      if (!action) return;
      SecondGroundItemOptionPacketListener.interact(
        player, packet.itemId, packet.x, packet.y, index
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
      equip: player.getAppearanceEquipmentIds(),
      equipQty: displayEquipment.map((item) => item?.getAmount?.() ?? 0),
      headIcons: {
        skull: player.getHeadSkullIcon(),
        prayer: player.getAppearance().getHeadHint(),
      },
    };
  }

  /**
   * Writes the account's remembered logins before answering, so a swapped token is on disk
   * even if the player never finishes logging in. The live player's copy follows in enterWorld.
   */
  private async saveLoginTokens(username: string, profile: PlayerProfile, save: any, entries: LoginTokenEntry[]): Promise<void> {
    if (!save) return;
    save.attributes = { ...(save.attributes ?? {}), [LOGIN_TOKENS_ATTRIBUTE]: entries };
    try {
      await GameConstants.PLAYER_PERSISTENCE.updateOffline(username, (stored) => {
        stored.attributes = { ...(stored.attributes ?? {}), [LOGIN_TOKENS_ATTRIBUTE]: entries };
      }, "login-token", profile);
    } catch (error) {
      console.warn(`[login] could not save login tokens for ${username}`, error);
    }
  }

  private failLogin(code: number, message: string): void {
    this.loginFailure = message;
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

  /** Drops the logged-in connection once a client that pings goes quiet (IDLE_TIMEOUT_MS). */
  private startIdleCheck(): void {
    if (this.closed) return;
    this.idleCheck = setInterval(() => {
      if (!this.sendsKeepalive || Date.now() - this.lastFrameAt < ClientConnection.IDLE_TIMEOUT_MS) return;
      this.cleanup("idle_timeout");
      try {
        this.channel.close(1001, "idle timeout");
      } catch {}
    }, ClientConnection.IDLE_CHECK_MS);
    this.idleCheck.unref?.();
  }

  private cleanup(source: string): void {
    if (this.closed) return;
    this.closed = true;
    this.stalledInput = null;
    if (this.idleCheck) clearInterval(this.idleCheck);
    this.releasePendingName();
    if (!this.player) return;
    // The disconnect hooks fire when the player leaves the world, which a player in
    // combat does only when it ends (World's removal queue).
    this.player.setDisconnectSource(source);
    if (!World.getRemovePlayerQueue().includes(this.player)) {
      World.getRemovePlayerQueue().push(this.player);
    }
    try {
      this.player.getTrading().closeTrade();
    } catch (error) {
      console.error("[network] disconnect trade cleanup failed", error);
    }
    try {
      GameConstants.PLAYER_PERSISTENCE.requestSave(this.player, "disconnect");
    } catch (error) {
      console.error("[network] disconnect save request failed", error);
    }
  }
}
import { DialogueOption } from "../game/model/dialogues/DialogueOption";
