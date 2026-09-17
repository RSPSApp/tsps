import { BitWriter } from "./BitWriter";
import { CLIENT_PACKET_LENGTHS as CLIENT_PACKET_LENGTHS, ClientPacketId as HighClientPacket } from "./ClientPackets";
import { CLIENT_PACKET_LENGTHS as NATIVE_CLIENT_PACKET_LENGTHS, ClientPacketId as NativeClientPacket } from "./NativeClientPackets";
import { SERVER_PACKET_LENGTHS, ServerPacketId } from "./ServerPackets";
import { deflateSync } from "zlib";

export const enum ClientPacket {
  NPC_OPTION_2 = 12,
  MOVE_GAMECLICK = 16,
  OBJECT_OPTION_2 = 28,
  NPC_OPTION_3 = 34,
  OBJECT_OPTION_4 = 38,
  OBJECT_OPTION_3 = 42,
  OBJECT_OPTION_5 = 51,
  NPC_OPTION_5 = 57,
  NPC_OPTION_4 = 70,
  NPC_OPTION_1 = 76,
  OBJECT_OPTION_1 = 96,
  CHAT = 190,
  HELLO = 200,
  PING = 201,
  HANDSHAKE = 202,
  LOGOUT = 203,
  LOGIN = 204,
  FACE = 211,
  LOC_INTERACT = 231,
}

export const enum ServerPacket {
  WELCOME = 0,
  TICK = 1,
  HANDSHAKE = 2,
  LOGIN_RESPONSE = 3,
  LOGOUT_RESPONSE = 4,
  PLAYER_SYNC = 20,
  NPC_INFO = 21,
  ANIM = 22,
  WIDGET_SET_ROOT = 102,
  WIDGET_OPEN_SUB = 103,
  WIDGET_RUN_SCRIPT = 110,
  SOUND = 131,
  PLAY_JINGLE = 132,
  PLAY_SONG = 133,
  RUN_CLIENT_SCRIPT = 170,
}

export type PlayerAppearance = {
  gender: number;
  colors: number[];
  kits: number[];
  equip: number[];
  npcTransformationId?: number;
  equipQty?: number[];
  headIcons?: { skull: number; prayer: number };
};

export type Tile = { x: number; y: number; level: number };

export type HitsplatView = { type: number; damage: number; delay?: number };
export type HealthView = { current: number; max: number };
export type AnimationView = { id: number; delay: number };
export type GraphicView = { id: number; height: number; delay: number };
export type ForcedMovementView = {
  startDeltaX: number;
  startDeltaY: number;
  endDeltaX: number;
  endDeltaY: number;
  startCycleOffset: number;
  endCycleOffset: number;
  direction: number;
};

export type ActorUpdateView = {
  forcedChat?: string;
  interactionIndex?: number;
  animation?: AnimationView;
  graphic?: GraphicView;
  hits?: HitsplatView[];
  health?: HealthView;
};

export type PlayerView = Tile & ActorUpdateView & {
  index: number;
  appearance: Buffer;
  movementType?: 1 | 2;
  appearanceDirty?: boolean;
  faceDirection?: number;
  forcedMovement?: ForcedMovementView;
  forcedMovementEnd?: Tile;
};

export type PlayerSyncState = {
  flags: Uint8Array;
  active: Uint16Array;
  activeCount: number;
  empty: Uint16Array;
  emptyCount: number;
  regions: Int32Array;
  lastTiles: Map<number, Tile>;
  movementTypes: Map<number, 1 | 2>;
  interactionIndices: Map<number, number>;
  viewPositions: Int16Array;
  movementChanged: Uint8Array;
  movementDx: Int16Array;
  movementDy: Int16Array;
  movementPlaneDelta: Uint8Array;
  nextMovementTypes: Uint8Array;
  updateBlocks: Buffer[];
};

export type NpcView = Tile & ActorUpdateView & {
  index: number;
  typeId: number;
  rotation: number;
  walkDirection: number;
  runDirection: number;
};

export type NpcSyncState = {
  indices: number[];
  lastTiles: Map<number, Tile>;
  typeIds: Map<number, number>;
  interactionIndices: Map<number, number>;
};

export type ProjectileView = {
  projectileId: number;
  source: Tile;
  target: Tile;
  sourceHeight: number;
  endHeight: number;
  slope: number;
  startPos: number;
  startCycleOffset: number;
  endCycleOffset: number;
  targetActor?: { kind: "player" | "npc"; index: number };
};

export type SkillView = {
  id: number;
  xp: number;
  baseLevel: number;
  virtualLevel: number;
  boost: number;
  currentLevel: number;
};

export type GroundItemView = {
  id: number;
  itemId: number;
  quantity: number;
  x: number;
  y: number;
  level: number;
  createdTick?: number;
  privateUntilTick?: number;
  expiresTick?: number;
  ownerId?: number;
  isPrivate?: boolean;
  ownership?: 0 | 1 | 2 | 3;
};

export type FriendsChatAction =
  | { action: "join"; name: string }
  | { action: "leave" }
  | { action: "kick"; name: string }
  | { action: "add_friend"; name: string }
  | { action: "remove_friend"; name: string }
  | { action: "set_friend_rank"; name: string; rank: number }
  | { action: "add_ignore"; name: string }
  | { action: "remove_ignore"; name: string };

export type FriendsChatSnapshot = {
  channel?: {
    name: string;
    owner: string;
    minKickRank: number;
    localRank: number;
    members: Array<{ name: string; world: number; rank: number }>;
  };
  friends: Array<{
    name: string;
    previousName: string;
    world: number;
    rank: number;
    isOnline: boolean;
  }>;
  ignores: Array<{ name: string; previousName: string }>;
};

export type ClientMessage =
  | { type: "move"; worldX: number; worldY: number; modifierFlags: number }
  | { type: "npc_option"; index: number; clickType: number }
  | { type: "object_option"; id: number; x: number; y: number; clickType?: number; action?: string }
  | { type: "chat"; text: string; messageType: "public" | "game" | "friends_chat" }
  | { type: "friends_chat_action"; action: FriendsChatAction }
  | { type: "private_message"; recipient: string; text: string }
  | { type: "chat_filter"; publicMode: number; privateMode: number; tradeMode: number }
  | { type: "widget_action"; widgetId: number; groupId: number; childId: number; buttonNum?: number; opId?: number; option?: string; target?: string; slot?: number; itemId?: number; subOpId?: number; simple?: boolean }
  | { type: "widget"; action: "open" | "close"; groupId: number; modal?: boolean }
  | { type: "widget_target"; targetWidgetId: number; targetSlot: number; targetItemId: number; sourceWidgetId: number; sourceSlot: number; sourceItemId: number }
  | { type: "widget_drag"; targetItemId: number; targetWidgetId: number; sourceItemId: number; sourceSlot: number; sourceWidgetId: number; targetSlot: number }
  | { type: "interface_close" }
  | { type: "local_trigger"; widgetId: number; childIndex: number; itemId: number; opcodeParam: number; argsData: Buffer }
  | { type: "player_option"; index: number; option: number }
  | { type: "item_on_player"; targetIndex: number; itemId: number; slot: number; widgetId: number }
  | { type: "item_on_npc"; targetIndex: number; itemId: number; slot: number; widgetId: number }
  | { type: "item_on_object"; objectId: number; x: number; y: number; itemId: number; slot: number; widgetId: number }
  | { type: "spell_on_player"; targetIndex: number; spellWidget: number; spellChild: number; spellItemId: number }
  | { type: "spell_on_npc"; targetIndex: number; spellWidget: number; spellChild: number; spellItemId: number }
  | { type: "spell_on_object"; objectId: number; x: number; y: number; spellWidget: number; spellChild: number; spellItemId: number }
  | { type: "inventory_action"; slot: number; itemId: number; widgetId: number; option?: string; optionIndex?: number }
  | { type: "inventory_use_on"; slot: number; itemId: number; target: { kind: "npc" | "loc" | "ground" | "player"; id: number; x?: number; y?: number; level?: number } | { kind: "inventory"; slot: number; itemId: number } }
  | { type: "inventory_move"; from: number; to: number; widgetId?: number }
  | { type: "bank_deposit_inventory" | "bank_deposit_equipment" }
  | { type: "bank_move"; from: number; to: number; mode: "swap" | "insert"; tab?: number }
  | { type: "ground_item_action"; itemId: number; x: number; y: number; option?: string; optionIndex?: number }
  | { type: "item_on_ground"; itemId: number; slot: number; widgetId: number; groundItemId: number; x: number; y: number }
  | { type: "spell_on_ground"; spellWidget: number; spellChild: number; spellItemId: number; groundItemId: number; x: number; y: number }
  | { type: "examine_npc"; id: number }
  | { type: "examine_object"; id: number }
  | { type: "appearance"; gender: number; kits: number[]; colors: number[] }
  | { type: "world_map_click"; x: number; y: number; level: number }
  | { type: "emote"; index: number; loop: boolean }
  | { type: "teleport"; x: number; y: number; level: number }
  | { type: "pathfind"; id: number; fromX: number; fromY: number; level: number; toX: number; toY: number; size: number }
  | { type: "interaction_stop" }
  | { type: "trade_action"; action: "offer" | "remove" | "accept" | "decline" | "confirm_accept" | "confirm_decline"; slot: number; quantity: number; itemId?: number }
  | { type: "dialogue_continue"; widgetId: number; childIndex: number }
  | { type: "dialogue_amount"; amount: number }
  | { type: "dialogue_input"; value: string }
  | { type: "item_spawner_search"; query: string }
  | { type: "varp_transmit"; varpId: number; value: number }
  | { type: "raw"; opcode: number; payload: Buffer }
  | { type: "face"; rotation?: number; x?: number; y?: number }
  | { type: "hello" }
  | { type: "ping" }
  | { type: "logout" }
  | { type: "login"; username: string; password: string; revision: number }
  | { type: "handshake"; name: string };

class Reader {
  private offset = 0;

  constructor(private readonly data: Buffer) {}

  public byte(): number {
    if (this.offset >= this.data.length) throw new Error("Unexpected end of packet");
    return this.data[this.offset++];
  }

  public short(): number {
    if (this.offset + 2 > this.data.length) throw new Error("Unexpected end of packet");
    const value = this.data.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  public signedShort(): number {
    const value = this.short();
    return value > 0x7fff ? value - 0x10000 : value;
  }

  public shortAdd(): number {
    const low = (this.byte() - 128) & 0xff;
    return (this.byte() << 8) | low;
  }

  public shortAddLE(): number {
    const high = this.byte();
    return (high << 8) | ((this.byte() - 128) & 0xff);
  }

  public shortLE(): number {
    const low = this.byte();
    return low | (this.byte() << 8);
  }

  public byteAdd(): number {
    return (this.byte() - 128) & 0xff;
  }

  public byteSub(): number {
    return (128 - this.byte()) & 0xff;
  }

  public byteNeg(): number {
    return (-this.byte()) & 0xff;
  }

  public int(): number {
    if (this.offset + 4 > this.data.length) throw new Error("Unexpected end of packet");
    const value = this.data.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  public intLE(): number {
    if (this.offset + 4 > this.data.length) throw new Error("Unexpected end of packet");
    const value = this.data.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  public intME(): number {
    const b0 = this.byte(), b1 = this.byte(), b2 = this.byte(), b3 = this.byte();
    return (b2 << 24) | (b3 << 16) | (b0 << 8) | b1;
  }

  public intIME(): number {
    const b0 = this.byte(), b1 = this.byte(), b2 = this.byte(), b3 = this.byte();
    return (b1 << 24) | (b0 << 16) | (b3 << 8) | b2;
  }

  public string(): string {
    const end = this.data.indexOf(0, this.offset);
    if (end === -1) throw new Error("Unterminated packet string");
    const value = this.data.toString("latin1", this.offset, end);
    this.offset = end + 1;
    return value;
  }

  public bytes(length: number): Buffer {
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.data.length) {
      throw new Error("Unexpected end of packet");
    }
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  public get remaining(): number {
    return this.data.length - this.offset;
  }
}

function clientPacketLength(opcode: number): number | undefined {
  return CLIENT_PACKET_LENGTHS[opcode as keyof typeof CLIENT_PACKET_LENGTHS]
    ?? NATIVE_CLIENT_PACKET_LENGTHS[opcode];
}

export function decodeClientPackets(frame: Buffer): ClientMessage[] {
  const messages: ClientMessage[] = [];
  let offset = 0;
  while (offset < frame.length) {
    const opcode = frame[offset];
    const expected = clientPacketLength(opcode);
    if (expected === undefined) throw new Error(`Unsupported client opcode ${opcode}`);
    const header = expected === -2 ? 3 : expected === -1 ? 2 : 1;
    if (offset + header > frame.length) throw new Error(`Truncated client opcode ${opcode}`);
    const length = expected === -2
      ? frame.readUInt16BE(offset + 1)
      : expected === -1
        ? frame[offset + 1]
        : expected;
    const end = offset + header + length;
    if (end > frame.length) throw new Error(`Truncated client opcode ${opcode}`);
    messages.push(decodeClientPacket(frame.subarray(offset, end)));
    offset = end;
  }
  return messages;
}

export function decodeClientPacket(frame: Buffer): ClientMessage {
  const reader = new Reader(frame);
  const opcode = reader.byte();
  const variable = clientPacketLength(opcode);
  if (variable === undefined) throw new Error(`Unsupported client opcode ${opcode}`);
  const length = variable === -2 ? reader.short() : variable === -1 ? reader.byte() : variable;
  if (reader.remaining !== length) {
    throw new Error(`Invalid client packet length for opcode ${opcode}: expected ${length}, got ${reader.remaining}`);
  }

  switch (opcode) {
    case NativeClientPacket.IF_BUTTON: {
      const widgetId = reader.int();
      return { type: "widget_action", widgetId, groupId: widgetId >>> 16, childId: widgetId & 0xffff, buttonNum: 1, simple: true };
    }
    case NativeClientPacket.IF_BUTTON_SUB: {
      const widgetId = reader.int(), slot = reader.short(), itemId = reader.signedShort();
      return { type: "widget_action", widgetId, groupId: widgetId >>> 16, childId: widgetId & 0xffff, buttonNum: reader.byte(), subOpId: reader.byte() + 1, slot, itemId };
    }
    case NativeClientPacket.IF_BUTTONT:
      return {
        type: "widget_target",
        targetWidgetId: reader.intIME(), targetSlot: reader.shortAddLE(),
        sourceWidgetId: reader.intLE(), sourceSlot: reader.shortLE(),
        sourceItemId: reader.signedShort(), targetItemId: reader.shortAddLE(),
      };
    case NativeClientPacket.IF_TRIGGEROPLOCAL: {
      const blockLength = reader.short();
      if (blockLength < 12 || blockLength !== reader.remaining) {
        throw new Error("Invalid IF_TRIGGEROPLOCAL payload length");
      }
      const opcodeParam = reader.intLE();
      const childRaw = reader.shortLE();
      const widgetId = reader.intLE();
      const itemRaw = reader.shortLE();
      return {
        type: "local_trigger", opcodeParam,
        childIndex: childRaw > 0x7fff ? childRaw - 0x10000 : childRaw,
        widgetId, itemId: itemRaw > 0x7fff ? itemRaw - 0x10000 : itemRaw,
        argsData: reader.bytes(blockLength - 12),
      };
    }
    case NativeClientPacket.IF_CLOSE:
      return { type: "interface_close" };
    case NativeClientPacket.RESUME_PAUSEBUTTON:
      return { type: "dialogue_continue", childIndex: reader.shortAddLE(), widgetId: reader.int() };
    case NativeClientPacket.EXAMINE_NPC:
      return { type: "examine_npc", id: reader.shortAdd() };
    case NativeClientPacket.EXAMINE_LOC:
      return { type: "examine_object", id: reader.shortAddLE() };
    case NativeClientPacket.APPEARANCE_SET:
      return {
        type: "appearance", gender: reader.byte(),
        kits: Array.from({ length: 7 }, () => reader.byte()),
        colors: Array.from({ length: 5 }, () => reader.byte()),
      };
    case NativeClientPacket.WORLD_MAP_CLICK: {
      const packed = reader.intIME() >>> 0;
      return { type: "world_map_click", level: packed >>> 28, x: (packed >>> 14) & 0x3fff, y: packed & 0x3fff };
    }
    case NativeClientPacket.OPPLAYER1:
      reader.byteSub();
      return { type: "player_option", index: reader.short(), option: 1 };
    case NativeClientPacket.OPPLAYER2:
      reader.byte();
      return { type: "player_option", index: reader.short(), option: 2 };
    case NativeClientPacket.OPPLAYER3:
      reader.byteSub();
      return { type: "player_option", index: reader.short(), option: 3 };
    case NativeClientPacket.OPPLAYER4: {
      const index = reader.short();
      reader.byteNeg();
      return { type: "player_option", index, option: 4 };
    }
    case NativeClientPacket.OPPLAYER5: {
      const index = reader.shortAddLE();
      reader.byteSub();
      return { type: "player_option", index, option: 5 };
    }
    case NativeClientPacket.OPPLAYER6: {
      const index = reader.short();
      reader.byteNeg();
      return { type: "player_option", index, option: 6 };
    }
    case NativeClientPacket.OPPLAYER7: {
      const index = reader.shortAdd();
      reader.byteSub();
      return { type: "player_option", index, option: 7 };
    }
    case NativeClientPacket.OPPLAYER8:
      reader.byte();
      return { type: "player_option", index: reader.shortAdd(), option: 8 };
    case NativeClientPacket.OPPLAYER_U: {
      const targetIndex = reader.shortAddLE();
      const itemId = reader.shortAddLE();
      const slot = reader.shortAdd();
      const widgetId = reader.int();
      reader.byteAdd();
      return { type: "item_on_player", targetIndex, itemId, slot, widgetId };
    }
    case NativeClientPacket.OPPLAYER_T:
      reader.byteNeg();
      return {
        type: "spell_on_player",
        spellItemId: reader.shortLE(),
        spellChild: reader.shortLE(),
        spellWidget: reader.intIME(),
        targetIndex: reader.shortLE(),
      };
    case NativeClientPacket.OPNPC_T: {
      const targetIndex = reader.short();
      const spellWidget = reader.intLE();
      const spellChild = reader.short();
      const spellItemId = reader.shortAdd();
      reader.byteAdd();
      return { type: "spell_on_npc", targetIndex, spellWidget, spellChild, spellItemId };
    }
    case NativeClientPacket.OPNPC_U: {
      const slot = reader.shortAddLE();
      reader.byte();
      const widgetId = reader.intME();
      const itemId = reader.shortLE();
      const targetIndex = reader.shortAddLE();
      return { type: "item_on_npc", targetIndex, itemId, slot, widgetId };
    }
    case NativeClientPacket.OPLOCU: {
      const slot = reader.shortAddLE();
      const objectId = reader.shortAdd();
      const widgetId = reader.intLE();
      reader.byteSub();
      const x = reader.shortLE();
      const y = reader.short();
      const itemId = reader.shortAddLE();
      return { type: "item_on_object", objectId, x, y, itemId, slot, widgetId };
    }
    case NativeClientPacket.OPLOC_T: {
      const y = reader.shortAddLE();
      const objectId = reader.shortAdd();
      const spellChild = reader.shortAdd();
      const spellWidget = reader.intLE();
      const x = reader.short();
      const spellItemId = reader.shortLE();
      reader.byteNeg();
      return { type: "spell_on_object", objectId, x, y, spellWidget, spellChild, spellItemId };
    }
    case NativeClientPacket.OPOBJ1:
      reader.byteSub();
      return { type: "ground_item_action", y: reader.shortLE(), itemId: reader.shortAdd(), x: reader.shortAdd(), optionIndex: 1 };
    case NativeClientPacket.OPOBJ2: {
      const x = reader.shortAdd(), y = reader.shortLE(), itemId = reader.short();
      reader.byte();
      return { type: "ground_item_action", itemId, x, y, optionIndex: 2 };
    }
    case NativeClientPacket.OPOBJ3: {
      const itemId = reader.shortLE(), x = reader.shortAdd(), y = reader.shortAddLE();
      reader.byteSub();
      return { type: "ground_item_action", itemId, x, y, optionIndex: 3 };
    }
    case NativeClientPacket.OPOBJ4: {
      const itemId = reader.shortAddLE(), y = reader.shortAddLE();
      reader.byteNeg();
      return { type: "ground_item_action", itemId, x: reader.shortAdd(), y, optionIndex: 4 };
    }
    case NativeClientPacket.OPOBJ5: {
      const itemId = reader.shortAdd(), x = reader.shortLE(), y = reader.shortLE();
      reader.byteSub();
      return { type: "ground_item_action", itemId, x, y, optionIndex: 5 };
    }
    case NativeClientPacket.EXAMINE_OBJ:
      return { type: "ground_item_action", itemId: reader.short(), y: reader.shortLE(), x: reader.shortLE(), option: "Examine" };
    case NativeClientPacket.OPOBJ_U: {
      const groundItemId = reader.shortAddLE();
      const y = reader.shortAdd();
      const widgetId = reader.intME();
      const x = reader.shortAdd();
      const slot = reader.shortAddLE();
      reader.byteSub();
      return { type: "item_on_ground", groundItemId, y, widgetId, x, slot, itemId: reader.shortLE() };
    }
    case NativeClientPacket.OPLOC_T_ALT:
      return {
        type: "spell_on_ground",
        spellWidget: reader.intLE(),
        spellChild: reader.shortAdd(),
        groundItemId: reader.shortAdd(),
        x: reader.shortAddLE(),
        y: reader.short(),
        spellItemId: (reader.byte(), reader.shortAddLE()),
      };
    case NativeClientPacket.IF_BUTTON1:
    case NativeClientPacket.IF_BUTTON2:
    case NativeClientPacket.IF_BUTTON3:
    case NativeClientPacket.IF_BUTTON4:
    case NativeClientPacket.IF_BUTTON5:
    case NativeClientPacket.IF_BUTTON6:
    case NativeClientPacket.IF_BUTTON7:
    case NativeClientPacket.IF_BUTTON8:
    case NativeClientPacket.IF_BUTTON9:
    case NativeClientPacket.IF_BUTTON10: {
      const optionIndex = [
        NativeClientPacket.IF_BUTTON1, NativeClientPacket.IF_BUTTON2, NativeClientPacket.IF_BUTTON3,
        NativeClientPacket.IF_BUTTON4, NativeClientPacket.IF_BUTTON5, NativeClientPacket.IF_BUTTON6,
        NativeClientPacket.IF_BUTTON7, NativeClientPacket.IF_BUTTON8, NativeClientPacket.IF_BUTTON9,
        NativeClientPacket.IF_BUTTON10,
      ].indexOf(opcode) + 1;
      const widgetId = reader.int(), slot = reader.short(), itemId = reader.signedShort();
      return {
        type: "widget_action", widgetId, groupId: widgetId >>> 16, childId: widgetId & 0xffff,
        buttonNum: optionIndex, slot: slot === 0xffff ? undefined : slot,
        itemId: itemId >= 0 ? itemId : undefined,
      };
    }
    case NativeClientPacket.IF_BUTTOND: {
      return {
        type: "widget_drag", targetItemId: reader.shortLE(), targetWidgetId: reader.intLE(),
        sourceItemId: reader.short(), sourceSlot: reader.shortAddLE(),
        sourceWidgetId: reader.intME(), targetSlot: reader.shortLE(),
      };
    }
    case ClientPacket.NPC_OPTION_1:
      reader.byte();
      return { type: "npc_option", index: reader.shortAddLE(), clickType: 1 };
    case ClientPacket.NPC_OPTION_2: {
      const index = reader.shortAddLE();
      reader.byte();
      return { type: "npc_option", index, clickType: 2 };
    }
    case ClientPacket.NPC_OPTION_3: {
      const index = reader.shortAdd();
      reader.byteNeg();
      return { type: "npc_option", index, clickType: 3 };
    }
    case ClientPacket.NPC_OPTION_4:
      reader.byteNeg();
      return { type: "npc_option", index: reader.shortLE(), clickType: 4 };
    case ClientPacket.NPC_OPTION_5:
      reader.byteAdd();
      return { type: "npc_option", index: reader.shortLE(), clickType: 5 };
    case ClientPacket.OBJECT_OPTION_1: {
      const x = reader.shortAdd();
      const y = reader.shortLE();
      reader.byteNeg();
      const id = reader.shortAddLE();
      return { type: "object_option", id, x, y, clickType: 1 };
    }
    case ClientPacket.OBJECT_OPTION_2: {
      const x = reader.shortAddLE();
      const y = reader.shortAddLE();
      reader.byteSub();
      return { type: "object_option", id: reader.short(), x, y, clickType: 2 };
    }
    case ClientPacket.OBJECT_OPTION_3: {
      const y = reader.shortLE();
      const id = reader.shortLE();
      const x = reader.shortAddLE();
      reader.byteSub();
      return { type: "object_option", id, x, y, clickType: 3 };
    }
    case ClientPacket.OBJECT_OPTION_4: {
      const x = reader.shortAdd();
      const id = reader.shortLE();
      const y = reader.shortAdd();
      reader.byteNeg();
      return { type: "object_option", id, x, y, clickType: 4 };
    }
    case ClientPacket.OBJECT_OPTION_5: {
      const x = reader.short();
      reader.byteAdd();
      const y = reader.shortAdd();
      return { type: "object_option", id: reader.shortAdd(), x, y, clickType: 5 };
    }
    case ClientPacket.MOVE_GAMECLICK: {
      const worldY = reader.shortAddLE();
      const modifierFlags = reader.byteNeg();
      const worldX = reader.shortAddLE();
      reader.shortAdd(); // target loc id; zero for walk-here
      return { type: "move", worldX, worldY, modifierFlags };
    }
    case HighClientPacket.WALK: {
      const worldX = reader.short(), worldY = reader.short(), flags = reader.byte();
      return { type: "move", worldX, worldY, modifierFlags: (flags & 1) !== 0 ? 2 : flags >> 1 };
    }
    case ClientPacket.FACE: {
      const rotation = reader.byte() ? reader.short() : undefined;
      return reader.byte()
        ? { type: "face", rotation, x: reader.short(), y: reader.short() }
        : { type: "face", rotation };
    }
    case HighClientPacket.TELEPORT:
      return { type: "teleport", x: reader.short(), y: reader.short(), level: reader.byte() };
    case HighClientPacket.PATHFIND:
      return {
        type: "pathfind", id: reader.int(), fromX: reader.short(), fromY: reader.short(),
        level: reader.byte(), toX: reader.short(), toY: reader.short(), size: reader.byte() || 1,
      };
    case ClientPacket.LOC_INTERACT: {
      const id = reader.short();
      const x = reader.short();
      const y = reader.short();
      reader.byte();
      const action = reader.string() || undefined;
      const clickType = reader.byte() || undefined;
      return { type: "object_option", id, x, y, clickType, action };
    }
    case ClientPacket.CHAT:
      return {
        type: "chat",
        messageType: (["public", "game", "friends_chat"] as const)[reader.byte()] ?? "public",
        text: reader.string(),
      };
    case HighClientPacket.FRIENDS_CHAT_ACTION: {
      const actionCode = reader.byte();
      const name = reader.string();
      const rankByte = reader.byte();
      const rank = rankByte > 0x7f ? rankByte - 0x100 : rankByte;
      const namedActions = [
        "join",
        "leave",
        "kick",
        "add_friend",
        "remove_friend",
        "set_friend_rank",
        "add_ignore",
        "remove_ignore",
      ] as const;
      const action = namedActions[actionCode];
      if (!action) return { type: "raw", opcode, payload: frame.subarray(frame.length) };
      if (action === "leave") return { type: "friends_chat_action", action: { action } };
      if (action === "set_friend_rank") {
        return { type: "friends_chat_action", action: { action, name, rank } };
      }
      return { type: "friends_chat_action", action: { action, name } };
    }
    case HighClientPacket.PRIVATE_MESSAGE:
      return { type: "private_message", recipient: reader.string(), text: reader.string() };
    case HighClientPacket.CHAT_FILTER:
      return {
        type: "chat_filter",
        publicMode: reader.byte(),
        privateMode: reader.byte(),
        tradeMode: reader.byte(),
      };
    case HighClientPacket.VARP_TRANSMIT:
      return { type: "varp_transmit", varpId: reader.short(), value: reader.int() };
    case HighClientPacket.INTERACT:
      return { type: "player_option", option: reader.byte() === 0 ? 3 : 2, index: reader.short() };
    case HighClientPacket.INTERACT_STOP:
      return { type: "interaction_stop" };
    case HighClientPacket.INVENTORY_USE:
      return { type: "inventory_action", slot: reader.short(), itemId: reader.short(), widgetId: 3214, option: (reader.int(), reader.string()) };
    case HighClientPacket.INVENTORY_USE_ON: {
      const slot = reader.short(), itemId = reader.short();
      const kind = reader.byte();
      const id = reader.short();
      const hasTile = reader.byte() !== 0;
      const x = hasTile ? reader.short() : undefined;
      const y = hasTile ? reader.short() : undefined;
      const level = reader.byte();
      if (kind === 4) {
        return { type: "inventory_use_on", slot, itemId, target: { kind: "inventory", slot: reader.short(), itemId: reader.short() } };
      }
      return {
        type: "inventory_use_on", slot, itemId,
        target: { kind: (["npc", "loc", "ground", "player"] as const)[kind] ?? "npc", id, x, y, level },
      };
    }
    case HighClientPacket.INVENTORY_MOVE:
      return { type: "inventory_move", from: reader.short(), to: reader.short(), widgetId: 3214 };
    case HighClientPacket.BANK_DEPOSIT_INVENTORY:
      return { type: "bank_deposit_inventory" };
    case HighClientPacket.BANK_DEPOSIT_EQUIPMENT:
      return { type: "bank_deposit_equipment" };
    case HighClientPacket.BANK_MOVE: {
      const from = reader.short(), to = reader.short(), mode = reader.byte() === 1 ? "insert" : "swap";
      return { type: "bank_move", from, to, mode, tab: reader.byte() || undefined };
    }
    case HighClientPacket.GROUND_ITEM_ACTION: {
      reader.int();
      const x = reader.short(), y = reader.short();
      reader.byte();
      const itemId = reader.short();
      reader.int();
      const option = reader.string() || undefined;
      return { type: "ground_item_action", itemId, x, y, option, optionIndex: reader.byte() || undefined };
    }
    case HighClientPacket.WIDGET: {
      const action = reader.byte() === 0 ? "open" : "close";
      return { type: "widget", action, groupId: reader.short(), modal: reader.byte() !== 0 || undefined };
    }
    case HighClientPacket.WIDGET_ACTION: {
      const widgetId = reader.int();
      const groupId = reader.short();
      const childId = reader.short();
      const option = reader.string() || undefined;
      const target = reader.string() || undefined;
      const opId = reader.byte() || undefined;
      const buttonNum = reader.byte() || undefined;
      reader.short();
      reader.short();
      reader.byte();
      const slot = reader.signedShort(), itemId = reader.signedShort();
      return { type: "widget_action", widgetId, groupId, childId, opId, buttonNum, option, target, slot: slot >= 0 ? slot : undefined, itemId: itemId >= 0 ? itemId : undefined };
    }
    case HighClientPacket.IF_BUTTOND:
      return {
        type: "widget_drag", targetItemId: reader.shortLE(), targetWidgetId: reader.intLE(),
        sourceItemId: reader.short(), sourceSlot: reader.shortAddLE(), sourceWidgetId: reader.intME(),
        targetSlot: reader.shortLE(),
      };
    case HighClientPacket.EMOTE:
      return { type: "emote", index: reader.short(), loop: reader.byte() !== 0 };
    case HighClientPacket.TRADE_ACTION: {
      const action = (["offer", "remove", "accept", "decline", "confirm_accept", "confirm_decline"] as const)[reader.byte()];
      if (!action) return { type: "raw", opcode, payload: frame.subarray(frame.length) };
      const slot = reader.short(), quantity = reader.int(), itemId = reader.signedShort();
      return { type: "trade_action", action, slot, quantity, itemId: itemId >= 0 ? itemId : undefined };
    }
    case HighClientPacket.ITEM_SPAWNER_SEARCH:
      return { type: "item_spawner_search", query: reader.string() };
    case HighClientPacket.RESUME_PAUSEBUTTON:
      return { type: "dialogue_continue", widgetId: reader.int(), childIndex: reader.short() };
    case 192:
      return { type: "dialogue_amount", amount: reader.int() };
    case 193:
    case 194:
      return { type: "dialogue_input", value: reader.string() };
    case ClientPacket.HELLO:
      reader.string();
      reader.string();
      return { type: "hello" };
    case ClientPacket.PING:
      reader.int();
      return { type: "ping" };
    case ClientPacket.LOGOUT:
      return { type: "logout" };
    case ClientPacket.LOGIN:
      return {
        type: "login",
        username: reader.string(),
        password: reader.string(),
        revision: reader.int(),
      };
    case ClientPacket.HANDSHAKE: {
      const name = reader.string();
      const hasAppearance = reader.byte() !== 0;
      if (hasAppearance) {
        reader.byte();
        for (let i = reader.byte(); i > 0; i--) reader.byte();
        for (let i = reader.byte(); i > 0; i--) reader.short();
        for (let i = reader.byte(); i > 0; i--) reader.short();
      }
      if (reader.remaining > 0) reader.byte();
      return { type: "handshake", name };
    }
    default:
      return { type: "raw", opcode, payload: frame.subarray(frame.length - length) };
  }
}

export function encodeServerPacket(opcode: ServerPacketId, payload: Buffer): Buffer {
  const expected = SERVER_PACKET_LENGTHS[opcode];
  if (expected === undefined) throw new Error(`Unsupported server opcode ${opcode}`);
  if (expected >= 0) {
    if (payload.length !== expected) {
      throw new Error(`Invalid server packet length for opcode ${opcode}: expected ${expected}, got ${payload.length}`);
    }
    return Buffer.concat([Buffer.from([opcode]), payload]);
  }
  if (expected === -1) {
    if (payload.length > 255) throw new Error(`Server packet ${opcode} exceeds byte length`);
    return Buffer.concat([Buffer.from([opcode, payload.length]), payload]);
  }
  if (payload.length > 65535) throw new Error(`Server packet ${opcode} exceeds short length`);
  return Buffer.concat([Buffer.from([opcode, payload.length >> 8, payload.length & 0xff]), payload]);
}

export function encodeContentData(
  source: string,
  datasets: Array<{ key: string; rows: unknown[] }>
): Buffer {
  const json = Buffer.from(JSON.stringify({ gamemodeId: source, datasets }));
  const compressed = deflateSync(json);
  const payload = Buffer.alloc(5 + compressed.length);
  payload[0] = 1;
  payload.writeUInt32BE(json.length, 1);
  compressed.copy(payload, 5);
  return encodeServerPacket(ServerPacketId.GAMEMODE_DATA, payload);
}

function packet(opcode: ServerPacket, payload: Buffer, lengthBytes: 0 | 1 | 2 = 1): Buffer {
  if (lengthBytes === 0) return Buffer.concat([Buffer.from([opcode]), payload]);
  if (lengthBytes === 1) {
    if (payload.length > 255) throw new Error(`client packet ${opcode} exceeds byte length`);
    return Buffer.concat([Buffer.from([opcode, payload.length]), payload]);
  }
  if (payload.length > 65535) throw new Error(`client packet ${opcode} exceeds short length`);
  return Buffer.concat([
    Buffer.from([opcode, payload.length >> 8, payload.length & 0xff]),
    payload,
  ]);
}

function string(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, "latin1"), Buffer.from([0])]);
}

export function encodeChatMessage(
  messageType: "game" | "public" | "private_in" | "private_out" | "channel" | "clan" | "trade" | "server",
  text: string,
  from = "",
  prefix = "",
  playerId = -1,
  chatType?: number
): Buffer {
  const defaultTypes: Record<typeof messageType, number> = {
    game: 0,
    public: 2,
    private_in: 3,
    private_out: 6,
    channel: 9,
    clan: 7,
    trade: 4,
    server: 0,
  };
  const type = chatType ?? defaultTypes[messageType];
  const id = Buffer.alloc(2);
  id.writeUInt16BE(playerId & 0xffff);
  return encodeServerPacket(ServerPacketId.CHAT_MESSAGE, Buffer.concat([
    string(text), Buffer.from([type & 0xff]), string(from), string(prefix), id,
  ]));
}

export function encodeFriendsChatSnapshot(snapshot: FriendsChatSnapshot): Buffer {
  const parts: Buffer[] = [Buffer.from([snapshot.channel ? 1 : 0])];
  if (snapshot.channel) {
    const channel = snapshot.channel;
    const count = Buffer.alloc(2);
    count.writeUInt16BE(channel.members.length);
    parts.push(
      string(channel.name),
      string(channel.owner),
      Buffer.from([channel.minKickRank & 0xff, channel.localRank & 0xff]),
      count,
    );
    for (const member of channel.members) {
      const world = Buffer.alloc(2);
      world.writeUInt16BE(member.world & 0xffff);
      parts.push(string(member.name), world, Buffer.from([member.rank & 0xff]));
    }
  }

  const friendCount = Buffer.alloc(2);
  friendCount.writeUInt16BE(snapshot.friends.length);
  parts.push(friendCount);
  for (const friend of snapshot.friends) {
    const world = Buffer.alloc(2);
    world.writeUInt16BE(friend.world & 0xffff);
    parts.push(
      string(friend.name),
      string(friend.previousName),
      world,
      Buffer.from([friend.rank & 0xff, friend.isOnline ? 1 : 0]),
    );
  }

  const ignoreCount = Buffer.alloc(2);
  ignoreCount.writeUInt16BE(snapshot.ignores.length);
  parts.push(ignoreCount);
  for (const ignored of snapshot.ignores) {
    parts.push(string(ignored.name), string(ignored.previousName));
  }
  return encodeServerPacket(ServerPacketId.FRIENDS_CHAT_UPDATE, Buffer.concat(parts));
}

export function encodeVarp(id: number, value: number): Buffer {
  const payload = Buffer.alloc(value >= 0 && value <= 255 ? 3 : 6);
  payload.writeUInt16BE(id & 0xffff);
  if (payload.length === 3) payload[2] = value;
  else payload.writeInt32BE(value | 0, 2);
  return encodeServerPacket(payload.length === 3 ? ServerPacketId.VARP_SMALL : ServerPacketId.VARP_LARGE, payload);
}

export function encodeVarbit(id: number, value: number): Buffer {
  const payload = Buffer.alloc(6);
  payload.writeUInt16BE(id & 0xffff);
  payload.writeInt32BE(value | 0, 2);
  return encodeServerPacket(ServerPacketId.VARBIT, payload);
}

function encodeItemSlot(slot: number, itemId: number, quantity: number): Buffer {
  const large = quantity >= 255;
  const payload = Buffer.alloc(large ? 9 : 5);
  payload.writeUInt16BE(slot & 0xffff);
  payload.writeUInt16BE((itemId + 1) & 0xffff, 2);
  payload[4] = large ? 255 : Math.max(0, quantity);
  if (large) payload.writeInt32BE(quantity | 0, 5);
  return payload;
}

export function encodeInventorySnapshot(slots: Array<{ slot: number; itemId: number; quantity: number }>): Buffer {
  const count = Buffer.alloc(2);
  count.writeUInt16BE(slots.length);
  return encodeServerPacket(ServerPacketId.INVENTORY_SNAPSHOT, Buffer.concat([
    count,
    ...slots.map(({ slot, itemId, quantity }) => encodeItemSlot(slot, itemId, quantity)),
  ]));
}

export function encodeInventorySlot(slot: number, itemId: number, quantity: number): Buffer {
  return encodeServerPacket(ServerPacketId.INVENTORY_SLOT, encodeItemSlot(slot, itemId, quantity));
}

export type BankSlotView = { slot: number; itemId: number; quantity: number; placeholder?: boolean; tab?: number };

function encodeBankSlotPayload(slot: BankSlotView): Buffer {
  return Buffer.concat([
    encodeItemSlot(slot.slot, slot.itemId, slot.quantity),
    Buffer.from([(slot.placeholder ? 1 : 0) | ((slot.tab ?? 0) << 1)]),
  ]);
}

export function encodeBankSnapshot(capacity: number, slots: BankSlotView[]): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(capacity & 0xffff);
  header.writeUInt16BE(slots.length, 2);
  return encodeServerPacket(ServerPacketId.BANK_SNAPSHOT, Buffer.concat([header, ...slots.map(encodeBankSlotPayload)]));
}

export function encodeBankSlot(slot: BankSlotView): Buffer {
  return encodeServerPacket(ServerPacketId.BANK_SLOT, encodeBankSlotPayload(slot));
}

function encodeGroundItem(stack: GroundItemView): Buffer {
  const payload = Buffer.alloc(33);
  payload.writeInt32BE(stack.id | 0);
  payload.writeUInt16BE(stack.itemId & 0xffff, 4);
  payload.writeInt32BE(stack.quantity | 0, 6);
  payload.writeUInt16BE(stack.x & 0xffff, 10);
  payload.writeUInt16BE(stack.y & 0xffff, 12);
  payload[14] = stack.level;
  payload.writeInt32BE(stack.createdTick ?? -1, 15);
  payload.writeInt32BE(stack.privateUntilTick ?? 0, 19);
  payload.writeInt32BE(stack.expiresTick ?? 0, 23);
  payload.writeInt32BE(stack.ownerId ?? -1, 27);
  payload[31] = stack.isPrivate ? 1 : 0;
  payload[32] = stack.ownership ?? 0;
  return payload;
}

export function encodeGroundItems(serial: number, stacks: GroundItemView[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeInt32BE(serial | 0);
  header.writeUInt16BE(stacks.length, 4);
  return encodeServerPacket(ServerPacketId.GROUND_ITEMS, Buffer.concat([header, ...stacks.map(encodeGroundItem)]));
}

export function encodeGroundItemsDelta(serial: number, upserts: GroundItemView[], removes: number[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeInt32BE(serial | 0);
  header.writeUInt16BE(upserts.length, 4);
  const removed = Buffer.alloc(2 + removes.length * 4);
  removed.writeUInt16BE(removes.length);
  removes.forEach((id, index) => removed.writeInt32BE(id | 0, 2 + index * 4));
  return encodeServerPacket(ServerPacketId.GROUND_ITEMS_DELTA, Buffer.concat([
    header, ...upserts.map(encodeGroundItem), removed,
  ]));
}

export function encodeLocAddChange(id: number, x: number, y: number, level: number, shape: number, rotation: number): Buffer {
  const payload = Buffer.alloc(8);
  payload.writeUInt16BE(id & 0xffff);
  payload.writeUInt16BE(x & 0xffff, 2);
  payload.writeUInt16BE(y & 0xffff, 4);
  payload[6] = level;
  payload[7] = (shape << 2) | (rotation & 3);
  return encodeServerPacket(ServerPacketId.LOC_ADD_CHANGE, payload);
}

export function encodeLocDel(x: number, y: number, level: number, shape: number, rotation: number): Buffer {
  const payload = Buffer.alloc(6);
  payload.writeUInt16BE(x & 0xffff);
  payload.writeUInt16BE(y & 0xffff, 2);
  payload[4] = level;
  payload[5] = (shape << 2) | (rotation & 3);
  return encodeServerPacket(ServerPacketId.LOC_DEL, payload);
}

export function encodeLocAnim(id: number, x: number, y: number, level: number, shape: number, rotation: number, animationId: number): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeUInt16BE(id & 0xffff);
  payload.writeUInt16BE(x & 0xffff, 2);
  payload.writeUInt16BE(y & 0xffff, 4);
  payload[6] = level;
  payload[7] = (shape << 2) | (rotation & 3);
  payload.writeUInt16BE(animationId & 0xffff, 8);
  return encodeServerPacket(ServerPacketId.LOC_ANIM, payload);
}

export function encodeRebuildNormal(regionX: number, regionY: number, forceReload: boolean, xteaKeys: number[][]): Buffer {
  const payload = Buffer.alloc(7 + xteaKeys.length * 16);
  payload.writeUInt16BE(regionX & 0xffff);
  payload.writeUInt16BE(regionY & 0xffff, 2);
  payload[4] = forceReload ? 0 : 1;
  payload.writeUInt16BE(xteaKeys.length, 5);
  xteaKeys.forEach((key, i) => key.slice(0, 4).forEach((value, j) => payload.writeInt32BE(value | 0, 7 + i * 16 + j * 4)));
  return encodeServerPacket(ServerPacketId.REBUILD_NORMAL, payload);
}

export function encodeRegionReplacement(
  regionId: number,
  allowReload: boolean,
  terrainData: Uint8Array,
  objectData: Uint8Array | null
): Buffer {
  const objects = objectData ?? new Uint8Array(0);
  const payloadLength = 7 + terrainData.length + objects.length;
  if (payloadLength > 65535 || payloadLength > 0xfffd) {
    throw new Error(`Region replacement ${regionId} exceeds short packet length`);
  }
  const payload = Buffer.allocUnsafe(payloadLength);
  payload.writeUInt16BE(regionId & 0xffff, 0);
  payload[2] = allowReload ? 1 : 0;
  payload.writeUInt16BE(terrainData.length, 3);
  payload.writeUInt16BE(objects.length, 5);
  Buffer.from(terrainData).copy(payload, 7);
  Buffer.from(objects).copy(payload, 7 + terrainData.length);
  return encodeServerPacket(ServerPacketId.REGION_REPLACEMENT, payload);
}

export type ShopSlotView = { slot: number; itemId: number; quantity: number; defaultQuantity?: number; priceEach?: number; sellPrice?: number };

function encodeShopSlotPayload(slot: ShopSlotView): Buffer {
  const payload = Buffer.alloc(20);
  payload.writeUInt16BE(slot.slot & 0xffff);
  payload.writeUInt16BE(slot.itemId & 0xffff, 2);
  payload.writeInt32BE(slot.quantity | 0, 4);
  payload.writeInt32BE((slot.defaultQuantity ?? slot.quantity) | 0, 8);
  payload.writeInt32BE((slot.priceEach ?? 0) | 0, 12);
  payload.writeInt32BE((slot.sellPrice ?? 0) | 0, 16);
  return payload;
}

export function encodeShopOpen(id: string, name: string, currencyItemId: number, general: boolean, buyMode: number, sellMode: number, stock: ShopSlotView[]): Buffer {
  const header = Buffer.alloc(7);
  header.writeUInt16BE(currencyItemId & 0xffff);
  header[2] = general ? 1 : 0;
  header[3] = buyMode;
  header[4] = sellMode;
  header.writeUInt16BE(stock.length, 5);
  return encodeServerPacket(ServerPacketId.SHOP_OPEN, Buffer.concat([string(id), string(name), header, ...stock.map(encodeShopSlotPayload)]));
}

export function encodeShopClose(): Buffer {
  return encodeServerPacket(ServerPacketId.SHOP_CLOSE, Buffer.alloc(0));
}

export type TradePartyView = { playerId?: number; name?: string; offers: Array<{ slot: number; itemId: number; quantity: number }>; accepted?: boolean; confirmAccepted?: boolean };

function encodeTradeParty(party: TradePartyView): Buffer {
  const header = Buffer.alloc(5);
  header.writeInt16BE(party.playerId ?? -1);
  header[2] = party.accepted ? 1 : 0;
  header[3] = party.confirmAccepted ? 1 : 0;
  header[4] = party.offers.length;
  const offers = party.offers.map((offer) => {
    const payload = Buffer.alloc(8);
    payload.writeUInt16BE(offer.slot & 0xffff);
    payload.writeUInt16BE(offer.itemId & 0xffff, 2);
    payload.writeInt32BE(offer.quantity | 0, 4);
    return payload;
  });
  return Buffer.concat([header.subarray(0, 2), string(party.name ?? ""), header.subarray(2), ...offers]);
}

export function encodeTradeRequest(playerId: number, name: string): Buffer {
  const id = Buffer.alloc(2);
  id.writeUInt16BE(playerId & 0xffff);
  return encodeServerPacket(ServerPacketId.TRADE_REQUEST, Buffer.concat([id, string(name)]));
}

function encodeTrade(opcode: ServerPacketId.TRADE_OPEN | ServerPacketId.TRADE_UPDATE, sessionId: string, stage: "offer" | "confirm", self: TradePartyView, other: TradePartyView, info = ""): Buffer {
  return encodeServerPacket(opcode, Buffer.concat([
    string(sessionId), Buffer.from([stage === "offer" ? 0 : 1]), string(info), encodeTradeParty(self), encodeTradeParty(other),
  ]));
}

export function encodeTradeOpen(sessionId: string, stage: "offer" | "confirm", self: TradePartyView, other: TradePartyView, info = ""): Buffer {
  return encodeTrade(ServerPacketId.TRADE_OPEN, sessionId, stage, self, other, info);
}

export function encodeTradeUpdate(sessionId: string, stage: "offer" | "confirm", self: TradePartyView, other: TradePartyView, info = ""): Buffer {
  return encodeTrade(ServerPacketId.TRADE_UPDATE, sessionId, stage, self, other, info);
}

export function encodeTradeClose(reason = ""): Buffer {
  return encodeServerPacket(ServerPacketId.TRADE_CLOSE, string(reason));
}

function encodeSkills(opcode: ServerPacketId.SKILLS_SNAPSHOT | ServerPacketId.SKILLS_DELTA, skills: SkillView[], totalLevel: number, combatLevel: number): Buffer {
  const payload = Buffer.alloc(1 + skills.length * 10 + 3);
  payload[0] = skills.length;
  let offset = 1;
  for (const skill of skills) {
    payload[offset++] = skill.id;
    payload.writeInt32BE(skill.xp | 0, offset);
    offset += 4;
    payload[offset++] = skill.baseLevel;
    payload[offset++] = skill.virtualLevel;
    payload[offset++] = skill.boost + 128;
    payload[offset++] = skill.currentLevel;
  }
  payload.writeUInt16BE(totalLevel & 0xffff, offset);
  payload[offset + 2] = combatLevel;
  return encodeServerPacket(opcode, payload);
}

export function encodeSkillsSnapshot(skills: SkillView[], totalLevel: number, combatLevel: number): Buffer {
  return encodeSkills(ServerPacketId.SKILLS_SNAPSHOT, skills, totalLevel, combatLevel);
}

export function encodeSkillsDelta(skills: SkillView[], totalLevel: number, combatLevel: number): Buffer {
  return encodeSkills(ServerPacketId.SKILLS_DELTA, skills, totalLevel, combatLevel);
}

export function encodeRunEnergy(percent: number, running: boolean): Buffer {
  return encodeServerPacket(ServerPacketId.RUN_ENERGY, Buffer.from([Math.max(0, Math.min(100, percent)), running ? 1 : 0]));
}

export function encodeDestination(x: number, y: number): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeUInt16BE(x & 0xffff);
  payload.writeUInt16BE(y & 0xffff, 2);
  return encodeServerPacket(ServerPacketId.DESTINATION, payload);
}

export function encodeWidgetOpen(groupId: number, modal = true): Buffer {
  const payload = Buffer.alloc(3);
  payload.writeUInt16BE(groupId & 0xffff);
  payload[2] = modal ? 1 : 0;
  return encodeServerPacket(ServerPacketId.WIDGET_OPEN, payload);
}

export function encodeWidgetClose(groupId: number): Buffer {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(groupId & 0xffff);
  return encodeServerPacket(ServerPacketId.WIDGET_CLOSE, payload);
}

export function encodeWidgetSetRoot(groupId: number): Buffer {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(groupId & 0xffff);
  return encodeServerPacket(ServerPacketId.WIDGET_SET_ROOT, payload);
}

function intPairs(values?: Record<number, number>, shortKeys = false): Buffer {
  const entries = values ? Object.entries(values) : [];
  const payload = Buffer.alloc(1 + entries.length * (shortKeys ? 6 : 8));
  payload[0] = entries.length;
  let offset = 1;
  for (const [key, value] of entries) {
    if (shortKeys) {
      payload.writeUInt16BE(Number(key) & 0xffff, offset);
      offset += 2;
    } else {
      payload.writeInt32BE(Number(key) | 0, offset);
      offset += 4;
    }
    payload.writeInt32BE(value | 0, offset);
    offset += 4;
  }
  return payload;
}

function scriptList(scripts: Array<{ scriptId: number; args?: (number | string)[] }> = []): Buffer {
  const parts: Buffer[] = [Buffer.from([scripts.length])];
  for (const script of scripts) {
    const id = Buffer.alloc(4);
    id.writeInt32BE(script.scriptId | 0);
    parts.push(id, scriptArgs(script.args ?? []));
  }
  return Buffer.concat(parts);
}

export function encodeWidgetOpenSub(targetUid: number, groupId: number, type = 1, options: {
  varps?: Record<number, number>;
  varbits?: Record<number, number>;
  hiddenUids?: number[];
  preScripts?: Array<{ scriptId: number; args?: (number | string)[] }>;
  postScripts?: Array<{ scriptId: number; args?: (number | string)[] }>;
} = {}): Buffer {
  const header = Buffer.alloc(7);
  header.writeInt32BE(targetUid | 0);
  header.writeUInt16BE(groupId & 0xffff, 4);
  header[6] = type;
  const hidden = Buffer.alloc(1 + (options.hiddenUids?.length ?? 0) * 4);
  hidden[0] = options.hiddenUids?.length ?? 0;
  options.hiddenUids?.forEach((uid, index) => hidden.writeInt32BE(uid | 0, 1 + index * 4));
  return encodeServerPacket(ServerPacketId.WIDGET_OPEN_SUB, Buffer.concat([
    header,
    intPairs(options.varps, true),
    intPairs(options.varbits, true),
    hidden,
    scriptList(options.preScripts),
    scriptList(options.postScripts),
  ]));
}

function widgetIntPacket(opcode: ServerPacketId, uid: number, value?: number): Buffer {
  const payload = Buffer.alloc(value === undefined ? 4 : 8);
  payload.writeInt32BE(uid | 0);
  if (value !== undefined) payload.writeInt32BE(value | 0, 4);
  return encodeServerPacket(opcode, payload);
}

export function encodeWidgetCloseSub(uid: number): Buffer {
  return widgetIntPacket(ServerPacketId.WIDGET_CLOSE_SUB, uid);
}

export function encodeWidgetSetText(uid: number, text: string): Buffer {
  const id = Buffer.alloc(4);
  id.writeInt32BE(uid | 0);
  return encodeServerPacket(ServerPacketId.WIDGET_SET_TEXT, Buffer.concat([id, string(text)]));
}

export function encodeWidgetSetHidden(uid: number, hidden: boolean): Buffer {
  const payload = Buffer.alloc(5);
  payload.writeInt32BE(uid | 0);
  payload[4] = hidden ? 1 : 0;
  return encodeServerPacket(ServerPacketId.WIDGET_SET_HIDDEN, payload);
}

/** Set a raw cache model, preserving the interface's camera and zoom. */
export function encodeWidgetSetModel(uid: number, modelId: number): Buffer {
  const payload = Buffer.alloc(8);
  payload.writeInt32BE(uid | 0, 0);
  payload.writeInt32BE(modelId | 0, 4);
  return encodeServerPacket(ServerPacketId.WIDGET_SET_MODEL, payload);
}

export function encodeWidgetSetItem(uid: number, itemId: number, quantity = 1): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeInt32BE(uid | 0);
  payload.writeInt16BE(itemId, 4);
  payload.writeInt32BE(quantity | 0, 6);
  return encodeServerPacket(ServerPacketId.WIDGET_SET_ITEM, payload);
}

export function encodeWidgetSetNpcHead(uid: number, npcId: number): Buffer {
  const payload = Buffer.alloc(6);
  payload.writeInt32BE(uid | 0);
  payload.writeInt16BE(npcId, 4);
  return encodeServerPacket(ServerPacketId.WIDGET_SET_NPC_HEAD, payload);
}

export function encodeWidgetSetPlayerHead(uid: number): Buffer {
  return widgetIntPacket(ServerPacketId.WIDGET_SET_PLAYER_HEAD, uid);
}

export function encodeWidgetSetFlags(uid: number, flags: number): Buffer {
  return widgetIntPacket(ServerPacketId.WIDGET_SET_FLAGS, uid, flags);
}

export function encodeWidgetSetFlagsRange(uid: number, fromSlot: number, toSlot: number, flags: number): Buffer {
  const payload = Buffer.alloc(12);
  payload.writeInt32BE(uid | 0);
  payload.writeUInt16BE(fromSlot & 0xffff, 4);
  payload.writeUInt16BE(toSlot & 0xffff, 6);
  payload.writeInt32BE(flags | 0, 8);
  return encodeServerPacket(ServerPacketId.WIDGET_SET_FLAGS_RANGE, payload);
}

export function encodeWidgetSetAnimation(uid: number, animationId: number): Buffer {
  const payload = Buffer.alloc(6);
  payload.writeInt32BE(uid | 0);
  payload.writeInt16BE(animationId, 4);
  return encodeServerPacket(ServerPacketId.WIDGET_SET_ANIMATION, payload);
}

export type ScriptInventorySnapshot = {
  capacity: number;
  slots: Array<{ slot: number; itemId: number; quantity: number }>;
};

function scriptInventories(inventories?: Record<number, ScriptInventorySnapshot>): Buffer {
  if (!inventories) return Buffer.alloc(0);
  const entries = Object.entries(inventories);
  const parts: Buffer[] = [Buffer.from([entries.length])];
  for (const [inventoryId, inventory] of entries) {
    const header = Buffer.alloc(6);
    header.writeUInt16BE(Number(inventoryId) & 0xffff);
    header.writeUInt16BE(inventory.capacity & 0xffff, 2);
    header.writeUInt16BE(inventory.slots.length & 0xffff, 4);
    parts.push(
      header,
      ...inventory.slots.map(({ slot, itemId, quantity }) =>
        encodeItemSlot(slot, itemId, quantity)
      )
    );
  }
  return Buffer.concat(parts);
}

export function encodeWidgetRunScript(
  scriptId: number,
  args: (number | string)[] = [],
  varps?: Record<number, number>,
  varbits?: Record<number, number>,
  inventories?: Record<number, ScriptInventorySnapshot>
): Buffer {
  const id = Buffer.alloc(4);
  id.writeInt32BE(scriptId | 0);
  const vars = (values?: Record<number, number>) => {
    const pairs = intPairs(values);
    const count = Buffer.alloc(2);
    count.writeUInt16BE(pairs[0]);
    return Buffer.concat([count, pairs.subarray(1)]);
  };
  return encodeServerPacket(
    ServerPacketId.WIDGET_RUN_SCRIPT,
    Buffer.concat([
      id,
      scriptArgs(args),
      vars(varps),
      vars(varbits),
      scriptInventories(inventories),
    ])
  );
}

export function encodeRunClientScript(scriptId: number, args: (number | string)[] = []): Buffer {
  const id = Buffer.alloc(2);
  id.writeUInt16BE(scriptId & 0xffff);
  return encodeServerPacket(ServerPacketId.RUN_CLIENT_SCRIPT, Buffer.concat([id, scriptArgs(args)]));
}

function scriptArgs(args: (number | string)[]): Buffer {
  const parts: Buffer[] = [Buffer.from([args.length])];
  for (const arg of args) {
    if (typeof arg === "number") {
      const value = Buffer.alloc(5);
      value[0] = 1;
      value.writeInt32BE(arg | 0, 1);
      parts.push(value);
    } else {
      parts.push(Buffer.from([0]), string(arg));
    }
  }
  return Buffer.concat(parts);
}

function encodeOpenSub(root: number, child: number, group: number, postScript?: number): Buffer {
  const fixed = Buffer.alloc(12);
  fixed.writeInt32BE((root << 16) | child, 0);
  fixed.writeUInt16BE(group, 4);
  fixed[6] = 1;
  if (postScript === undefined) return packet(ServerPacket.WIDGET_OPEN_SUB, fixed, 2);
  fixed[11] = 1;
  const script = Buffer.alloc(5);
  script.writeInt32BE(postScript, 0);
  return packet(ServerPacket.WIDGET_OPEN_SUB, Buffer.concat([fixed, script]), 2);
}

export const MAIN_INVENTORY_GROUP_ID = 149;
export const MAIN_INVENTORY_WIDGET_UID = MAIN_INVENTORY_GROUP_ID << 16;
export const MAIN_INVENTORY_SLOT_FLAGS = 0x1207fe;

// Side journal (quest tab) content mount, mirrored from client/common/ui/sideJournal.ts.
// The [78, 629] mount below only opens the side_journal *shell* into the root
// interface; nothing then mounts default content into the shell's own inner
// container (629:43), and the tab icon (root:61) never gets the transmit
// flags its right-click submenu (Character Summary/Quest List/Achievement
// Diaries) needs, so those clicks are silently dropped by the client. Both
// live here (rather than only in a plugin hook) because this function runs
// on every gameframe bootstrap - both the raw post-login call below and the
// second call WelcomeScreen.plugin.js makes after the "Play" button is
// clicked - and either path must leave the quest tab in a working state.
const SIDE_JOURNAL_GROUP_ID = 629;
const SIDE_JOURNAL_TAB_CONTAINER_CHILD_ID = 43;
const INTERFACE_CHARACTER_SUMMARY_ID = 712;
const QUEST_TAB_ICON_CHILD_ID = 61;
// Mirrors client/widgets/WidgetFlags.ts: op1 (default, already implied) | op2/op3/op4
// (Character Summary / Quest List / Achievement Diaries submenu entries).
const QUEST_TAB_ICON_FLAGS = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4);

// Account summary (712) dynamic row list, mirrored from client/common/ui/accountSummary.ts.
// Rows are CC_CREATE'd under 712:3 at runtime, so a plain widget dump only shows
// the static shell (children 0-3) - these indices come from live click logs.
const ACCOUNT_SUMMARY_ENTRY_LIST_UID = (INTERFACE_CHARACTER_SUMMARY_ID << 16) | 3;
const ACCOUNT_SUMMARY_QUESTS_ROW = 3; // op1 "Quest List"
const ACCOUNT_SUMMARY_ACHIEVEMENTS_ROW = 4; // op1 "Achievement Diaries"
const ACCOUNT_SUMMARY_COMBAT_TASKS_ROW = 5; // op1-4 Overview/Bosses/Tasks/Rewards (Combat Achievements - not yet built)
const ACCOUNT_SUMMARY_COLLECTION_LOG_ROW = 6; // op1 "Collection Log", op2 "Collection Overview"
const ACCOUNT_SUMMARY_PLAYTIME_ROW = 7; // op1 "Reveal"

export function encodeGameframeBootstrap(playerName: string): Buffer[] {
  const root = 161;
  const mounts = [
    [96, 162], [9, 163], [22, 160], [7, 122], [6, 651, 5929],
    [76, 593], [77, 320], [78, 629], [79, MAIN_INVENTORY_GROUP_ID], [80, 387], [81, 541],
    [82, 218], [83, 7], [84, 109], [85, 429], [86, 182], [87, 116],
    [88, 216], [89, 239],
  ];
  const cameraScript = Buffer.concat([Buffer.alloc(2), scriptArgs([])]);
  cameraScript.writeUInt16BE(626, 0);
  const rootPayload = Buffer.alloc(2);
  rootPayload.writeUInt16BE(root);
  const loginScript = Buffer.concat([Buffer.alloc(4), scriptArgs([0, 0, playerName, playerName]), Buffer.alloc(4)]);
  loginScript.writeInt32BE(876, 0);
  return [
    packet(ServerPacket.RUN_CLIENT_SCRIPT, cameraScript, 2),
    packet(ServerPacket.WIDGET_SET_ROOT, rootPayload, 0),
    ...mounts.map(([child, group, postScript]) => encodeOpenSub(root, child, group, postScript)),
    encodeWidgetSetFlagsRange(MAIN_INVENTORY_WIDGET_UID, 0, 27, MAIN_INVENTORY_SLOT_FLAGS),
    encodeOpenSub(SIDE_JOURNAL_GROUP_ID, SIDE_JOURNAL_TAB_CONTAINER_CHILD_ID, INTERFACE_CHARACTER_SUMMARY_ID),
    encodeWidgetSetFlags((root << 16) | QUEST_TAB_ICON_CHILD_ID, QUEST_TAB_ICON_FLAGS),
    encodeWidgetSetFlagsRange(ACCOUNT_SUMMARY_ENTRY_LIST_UID, ACCOUNT_SUMMARY_QUESTS_ROW, ACCOUNT_SUMMARY_ACHIEVEMENTS_ROW, 1 << 1),
    encodeWidgetSetFlagsRange(ACCOUNT_SUMMARY_ENTRY_LIST_UID, ACCOUNT_SUMMARY_COMBAT_TASKS_ROW, ACCOUNT_SUMMARY_COMBAT_TASKS_ROW, (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4)),
    encodeWidgetSetFlagsRange(ACCOUNT_SUMMARY_ENTRY_LIST_UID, ACCOUNT_SUMMARY_COLLECTION_LOG_ROW, ACCOUNT_SUMMARY_COLLECTION_LOG_ROW, (1 << 1) | (1 << 2)),
    encodeWidgetSetFlagsRange(ACCOUNT_SUMMARY_ENTRY_LIST_UID, ACCOUNT_SUMMARY_PLAYTIME_ROW, ACCOUNT_SUMMARY_PLAYTIME_ROW, 1 << 1),
    packet(ServerPacket.WIDGET_RUN_SCRIPT, loginScript, 2),
  ];
}

export function encodeWelcome(tickMs: number, serverTime: number): Buffer {
  const payload = Buffer.alloc(8);
  payload.writeInt32BE(tickMs | 0, 0);
  payload.writeInt32BE(serverTime | 0, 4);
  return packet(ServerPacket.WELCOME, payload, 0);
}

export function encodeTick(tick: number, serverTime: number): Buffer {
  const payload = Buffer.alloc(8);
  payload.writeInt32BE(tick | 0, 0);
  payload.writeInt32BE(serverTime | 0, 4);
  return packet(ServerPacket.TICK, payload, 0);
}

export function encodeSound(
  soundId: number,
  options: {
    x?: number;
    y?: number;
    level?: number;
    loops?: number;
    delay?: number;
    radius?: number;
    attenuation?: number;
  } = {}
): Buffer {
  const positioned = options.x !== undefined;
  const payload = Buffer.alloc(positioned ? 13 : 8);
  let offset = 0;
  payload.writeUInt16BE(soundId & 0xffff, offset);
  offset += 2;
  payload[offset++] = positioned ? 1 : 0;
  if (positioned) {
    payload.writeUInt16BE(options.x! & 0xffff, offset);
    payload.writeUInt16BE((options.y ?? 0) & 0xffff, offset + 2);
    payload[offset + 4] = (options.level ?? 0) & 0xff;
    offset += 5;
  }
  payload[offset++] = Math.max(1, options.loops ?? 1) & 0xff;
  payload.writeUInt16BE(Math.max(0, options.delay ?? 0) & 0xffff, offset);
  offset += 2;
  payload[offset++] = Math.max(0, Math.min(31, options.radius ?? 0));
  payload[offset] = Math.max(0, Math.min(31, options.attenuation ?? 0));
  return packet(ServerPacket.SOUND, payload);
}

export function encodePlayJingle(jingleId: number, delay = 0): Buffer {
  const payload = Buffer.alloc(5);
  const value = Math.max(0, Math.min(0xffffff, delay));
  payload.writeUInt16BE(jingleId & 0xffff, 0);
  payload[2] = value >> 16;
  payload[3] = value;
  payload[4] = value >> 8;
  return packet(ServerPacket.PLAY_JINGLE, payload, 0);
}

export function encodePlaySong(trackId: number): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeUInt16BE(trackId & 0xffff, 0);
  payload.writeUInt16BE(100, 4);
  payload.writeUInt16BE(100, 6);
  return packet(ServerPacket.PLAY_SONG, payload, 0);
}

export function encodeLoginResponse(
  success: boolean,
  errorCode = -1,
  error = "",
  displayName = ""
): Buffer {
  const fixed = Buffer.alloc(5);
  fixed[0] = success ? 1 : 0;
  fixed.writeInt32BE(errorCode, 1);
  return packet(
    ServerPacket.LOGIN_RESPONSE,
    Buffer.concat([fixed, string(error), string(displayName)])
  );
}

export function encodeHandshake(
  id: number,
  name: string,
  isAdmin: boolean,
  appearance?: PlayerAppearance,
  chatIcons: readonly number[] = []
): Buffer {
  const idBuffer = Buffer.alloc(4);
  idBuffer.writeInt32BE(id, 0);
  const appearanceParts: Buffer[] = [Buffer.from([appearance ? 1 : 0])];
  if (appearance) {
    appearanceParts.push(Buffer.from([appearance.gender & 0xff]));
    for (const values of [appearance.colors, appearance.kits, appearance.equip]) {
      appearanceParts.push(Buffer.from([values.length & 0xff]));
      if (values === appearance.colors) {
        appearanceParts.push(Buffer.from(values.map((value) => value & 0xff)));
      } else {
        const shorts = Buffer.alloc(values.length * 2);
        values.forEach((value, index) => shorts.writeUInt16BE(value & 0xffff, index * 2));
        appearanceParts.push(shorts);
      }
    }
  }
  const icons = chatIcons
    .filter((icon) => Number.isInteger(icon) && icon >= 0 && icon <= 255)
    .slice(0, 255);
  return packet(
    ServerPacket.HANDSHAKE,
    Buffer.concat([
      idBuffer,
      string(name),
      ...appearanceParts,
      Buffer.from([icons.length, ...icons]),
      string(""),
      Buffer.from([isAdmin ? 1 : 0]),
    ])
  );
}

export function encodeInitialPlayerSync(
  localIndex: number,
  tileX: number,
  tileY: number,
  level: number,
  loopCycle: number
): Buffer {
  const writer = new BitWriter();
  writer.writeBits(1, 1); // local player has movement
  writer.writeBits(1, 0); // no update block; appearance arrived in handshake
  writer.writeBits(2, 3); // teleport
  writer.writeBits(1, 1); // absolute displacement from initial 0,0
  writer.writeBits(
    30,
    (((level & 3) << 28) | ((tileX & 0x3fff) << 14) | (tileY & 0x3fff)) >>> 0
  );
  writer.alignToByte();
  // Passes two and three contain no matching indices. Pass four skips every
  // empty player slot after the first one.
  writer.alignToByte();
  writer.alignToByte();
  writer.writeBits(1, 0);
  writer.writeBits(2, 3);
  writer.writeBits(11, 2045);
  const sync = writer.toBuffer();

  const baseX = Math.max(0, (tileX - 48) & ~7);
  const baseY = Math.max(0, (tileY - 48) & ~7);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(baseX, 0);
  header.writeUInt16BE(baseY, 2);
  header.writeUInt16BE(localIndex, 4);
  header.writeInt32BE(loopCycle | 0, 6);
  header.writeUInt16BE(sync.length, 10);
  return packet(ServerPacket.PLAYER_SYNC, Buffer.concat([header, sync]), 2);
}

const RUN_DIRECTIONS = [
  "-2,-2", "-1,-2", "0,-2", "1,-2", "2,-2", "-2,-1", "2,-1", "-2,0",
  "2,0", "-2,1", "2,1", "-2,2", "-1,2", "0,2", "1,2", "2,2",
];

export function createPlayerSyncState(
  localIndex: number,
  tile: Tile
): PlayerSyncState {
  const flags = new Uint8Array(2048);
  const active = new Uint16Array(2048);
  const empty = new Uint16Array(2048);
  active[0] = localIndex;
  let emptyCount = 0;
  for (let index = 1; index < 2048; index++) {
    if (index === localIndex) continue;
    flags[index] = 1; // mirrors the empty-slot skip in the initial sync packet
    empty[emptyCount++] = index;
  }
  return {
    flags,
    active,
    activeCount: 1,
    empty,
    emptyCount,
    regions: new Int32Array(2048),
    lastTiles: new Map([[localIndex, { ...tile }]]),
    movementTypes: new Map([[localIndex, 1]]),
    interactionIndices: new Map(),
    viewPositions: new Int16Array(2048).fill(-1),
    movementChanged: new Uint8Array(2048),
    movementDx: new Int16Array(2048),
    movementDy: new Int16Array(2048),
    movementPlaneDelta: new Uint8Array(2048),
    nextMovementTypes: new Uint8Array(2048),
    updateBlocks: [],
  };
}

export function createNpcSyncState(): NpcSyncState {
  return { indices: [], lastTiles: new Map(), typeIds: new Map(), interactionIndices: new Map() };
}

export function encodePlayerAppearance(
  appearance: PlayerAppearance,
  name: string,
  combatLevel: number,
  skillLevel: number,
  animations: number[]
): Buffer {
  const bytes: number[] = [];
  const byte = (value: number) => bytes.push(value & 0xff);
  const short = (value: number) => {
    bytes.push((value >>> 8) & 0xff, value & 0xff);
  };
  const int = (value: number) => {
    bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  };
  const text = (value: string) => {
    bytes.push(...Buffer.from(value, "latin1"), 0);
  };
  const itemSlots: Record<number, number> = {
    0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 7: 7, 9: 9, 10: 10,
  };
  const kitSlots: Record<number, number> = {
    4: 2, 6: 3, 7: 5, 8: 0, 9: 4, 10: 6, 11: 1,
  };
  const equipmentSlot = (wireSlot: number): number => {
    const itemSlot = itemSlots[wireSlot];
    const itemId = itemSlot === undefined ? -1 : appearance.equip[itemSlot] ?? -1;
    if (itemId >= 0) return itemId + 512;
    const kitSlot = kitSlots[wireSlot];
    const kitId = kitSlot === undefined ? -1 : appearance.kits[kitSlot] ?? -1;
    return kitId >= 0 ? kitId + 256 : 0;
  };

  byte(appearance.gender);
  byte(appearance.headIcons?.skull ?? -1);
  byte(appearance.headIcons?.prayer ?? -1);
  if ((appearance.npcTransformationId ?? -1) >= 0) {
    short(0xffff);
    short(appearance.npcTransformationId!);
  } else {
    for (let copy = 0; copy < 2; copy++) {
      for (let slot = 0; slot < 12; slot++) {
        const value = equipmentSlot(slot);
        if (value === 0) byte(0);
        else short(value);
      }
    }
  }
  for (let index = 0; index < 5; index++) byte(appearance.colors[index] ?? 0);
  for (let index = 0; index < 7; index++) short(animations[index] ?? 0xffff);
  text(name);
  byte(combatLevel);
  short(skillLevel);
  byte(0); // visible
  short(0); // no colour/texture overrides
  text("");
  text("");
  text("");
  byte(0);
  int(appearance.equipQty?.[13] ?? 0);
  int(appearance.equip[13] ?? -1);
  int(appearance.equip[12] ?? -1);
  return Buffer.from(bytes);
}

function writeSkipCount(writer: BitWriter, count: number): void {
  if (count === 0) writer.writeBits(2, 0);
  else if (count < 32) {
    writer.writeBits(2, 1);
    writer.writeBits(5, count);
  } else if (count < 256) {
    writer.writeBits(2, 2);
    writer.writeBits(8, count);
  } else {
    writer.writeBits(2, 3);
    writer.writeBits(11, count);
  }
}

const PLAYER_MASK = {
  FORCED_CHAT: 0x01,
  FACE_DIR: 0x02,
  APPEARANCE: 0x04,
  ANIMATION: 0x08,
  HIT: 0x20,
  FACE_ENTITY: 0x40,
  FORCE_MOVEMENT: 0x400,
  MOVEMENT_TYPE: 0x1000,
  SPOT_ANIM: 0x10000,
} as const;

const NPC_MASK = {
  FACE_ENTITY: 0x08,
  ANIMATION: 0x10,
  HIT: 0x20,
  FORCED_CHAT: 0x40,
  SPOT_ANIM: 0x20000,
} as const;

function writeMask(bytes: number[], rawMask: number): void {
  const third = (rawMask & 0xffff0000) !== 0;
  const second = third || (rawMask & 0xff00) !== 0;
  const mask = third ? rawMask | 0x4000 : rawMask;
  bytes.push((mask & 0xff) | (second ? 0x80 : 0));
  if (second) bytes.push((mask >>> 8) & 0xff);
  if (third) bytes.push((mask >>> 16) & 0xff);
}

function byteA(bytes: number[], value: number): void {
  bytes.push((value + 128) & 0xff);
}

function byteC(bytes: number[], value: number): void {
  bytes.push((-value) & 0xff);
}

function byteS(bytes: number[], value: number): void {
  bytes.push((128 - value) & 0xff);
}

function shortBE(bytes: number[], value: number): void {
  bytes.push((value >>> 8) & 0xff, value & 0xff);
}

function shortLE(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function shortBEA(bytes: number[], value: number): void {
  bytes.push((value >>> 8) & 0xff, (value + 128) & 0xff);
}

function shortLEA(bytes: number[], value: number): void {
  bytes.push((value + 128) & 0xff, (value >>> 8) & 0xff);
}

function intME(bytes: number[], value: number): void {
  bytes.push((value >>> 8) & 0xff, value & 0xff, (value >>> 24) & 0xff, (value >>> 16) & 0xff);
}

function smart(bytes: number[], value: number): void {
  const safe = Math.max(0, Math.min(32767, value | 0));
  if (safe < 128) bytes.push(safe);
  else shortBE(bytes, safe + 32768);
}

function writeText(bytes: number[], value: string): void {
  bytes.push(...Buffer.from(value, "latin1"), 0);
}

function scaledHealth(health: HealthView): number {
  if (health.current <= 0 || health.max <= 0) return 0;
  return Math.max(1, Math.min(30, Math.floor((health.current * 30) / health.max)));
}

function writeHits(bytes: number[], view: ActorUpdateView, npc: boolean): void {
  const hits = view.hits?.slice(0, 255) ?? [];
  if (npc) byteS(bytes, hits.length);
  else byteC(bytes, hits.length);
  for (const hit of hits) {
    smart(bytes, hit.type);
    smart(bytes, hit.damage);
    smart(bytes, hit.delay ?? 0);
  }
  const health = view.health;
  const count = health ? 1 : 0;
  if (npc) byteA(bytes, count);
  else byteC(bytes, count);
  if (health) {
    smart(bytes, 0);
    smart(bytes, 0);
    smart(bytes, 0);
    const value = scaledHealth(health);
    if (npc) byteC(bytes, value);
    else bytes.push(value);
  }
}

function playerUpdateMask(
  view: PlayerView,
  writeMovementType: boolean,
  writeAppearance: boolean,
  writeInteraction: boolean
): number {
  return (view.forcedChat !== undefined ? PLAYER_MASK.FORCED_CHAT : 0) |
    (view.faceDirection !== undefined ? PLAYER_MASK.FACE_DIR : 0) |
    (writeAppearance ? PLAYER_MASK.APPEARANCE : 0) |
    (view.animation ? PLAYER_MASK.ANIMATION : 0) |
    (view.hits ? PLAYER_MASK.HIT : 0) |
    (writeInteraction ? PLAYER_MASK.FACE_ENTITY : 0) |
    (view.forcedMovement ? PLAYER_MASK.FORCE_MOVEMENT : 0) |
    (writeMovementType ? PLAYER_MASK.MOVEMENT_TYPE : 0) |
    (view.graphic ? PLAYER_MASK.SPOT_ANIM : 0);
}

function npcUpdateMask(view: NpcView, writeInteraction: boolean): number {
  return (writeInteraction ? NPC_MASK.FACE_ENTITY : 0) |
    (view.animation ? NPC_MASK.ANIMATION : 0) |
    (view.hits ? NPC_MASK.HIT : 0) |
    (view.forcedChat !== undefined ? NPC_MASK.FORCED_CHAT : 0) |
    (view.graphic ? NPC_MASK.SPOT_ANIM : 0);
}

function writePlayerUpdateBlock(
  view: PlayerView,
  writeMovementType: boolean,
  movementType: 1 | 2 | undefined,
  writeAppearance: boolean,
  writeInteraction: boolean
): Buffer {
  const bytes: number[] = [];
  const mask = playerUpdateMask(view, writeMovementType, writeAppearance, writeInteraction);
  writeMask(bytes, mask);
  if (view.forcedChat !== undefined) writeText(bytes, view.forcedChat);
  if (view.faceDirection !== undefined) shortLE(bytes, view.faceDirection & 2047);
  if (writeInteraction) {
    const target = (view.interactionIndex ?? -1) < 0 ? 0xffffff : view.interactionIndex! & 0xffffff;
    shortBE(bytes, target & 0xffff);
    bytes.push((target >>> 16) & 0xff);
  }
  if (view.animation) {
    shortLEA(bytes, view.animation.id < 0 ? 0xffff : view.animation.id);
    bytes.push(view.animation.delay & 0xff);
  }
  if (view.hits) writeHits(bytes, view, false);
  if (writeMovementType) byteC(bytes, movementType ?? 0);
  if (writeAppearance) {
    const length = Math.min(255, view.appearance.length);
    byteC(bytes, length);
    bytes.push(...view.appearance.subarray(0, length));
  }
  if (view.forcedMovement) {
    const movement = view.forcedMovement;
    byteS(bytes, movement.startDeltaX);
    bytes.push(movement.startDeltaY & 0xff, movement.endDeltaX & 0xff);
    byteA(bytes, movement.endDeltaY);
    shortBEA(bytes, movement.startCycleOffset);
    shortBE(bytes, movement.endCycleOffset);
    shortLEA(bytes, movement.direction & 2047);
  }
  if (view.graphic) {
    byteA(bytes, 1);
    bytes.push(0);
    shortBE(bytes, view.graphic.id < 0 ? 0xffff : view.graphic.id);
    intME(bytes, ((view.graphic.height & 0xffff) << 16) | (view.graphic.delay & 0xffff));
  }
  return Buffer.from(bytes);
}

function writeNpcUpdateBlock(view: NpcView, writeInteraction: boolean): Buffer {
  const bytes: number[] = [];
  const mask = npcUpdateMask(view, writeInteraction);
  writeMask(bytes, mask);
  if (writeInteraction) {
    const target = (view.interactionIndex ?? -1) < 0 ? 0xffffff : view.interactionIndex! & 0xffffff;
    shortLEA(bytes, target);
    byteA(bytes, target >>> 16);
  }
  if (view.hits) writeHits(bytes, view, true);
  if (view.forcedChat !== undefined) writeText(bytes, view.forcedChat);
  if (view.graphic) {
    bytes.push(1);
    byteA(bytes, 0);
    shortLE(bytes, view.graphic.id < 0 ? 0xffff : view.graphic.id);
    intME(bytes, ((view.graphic.height & 0xffff) << 16) | (view.graphic.delay & 0xffff));
  }
  if (view.animation) {
    shortBE(bytes, view.animation.id < 0 ? 0xffff : view.animation.id);
    bytes.push(view.animation.delay & 0xff);
  }
  return Buffer.from(bytes);
}

export function encodePlayerSync(
  localIndex: number,
  baseX: number,
  baseY: number,
  loopCycle: number,
  views: PlayerView[],
  state: PlayerSyncState
): Buffer {
  const writer = new BitWriter();
  const viewPositions = state.viewPositions;
  viewPositions.fill(-1);
  for (let position = 0; position < views.length; position++) {
    const index = views[position].index;
    if (index > 0 && index < 2048 && viewPositions[index] < 0) {
      viewPositions[index] = position;
    }
  }
  const viewAt = (index: number): PlayerView | undefined => views[viewPositions[index]];
  const localView = viewAt(localIndex);
  if (!localView) throw new Error("player sync is missing its local player");

  for (let position = 0; position < views.length; position++) {
    const view = views[position];
    const index = view.index;
    if (index <= 0 || index >= 2048 || viewPositions[index] !== position) continue;
    const from = state.lastTiles.get(index);
    if (!from) {
      state.movementChanged[index] = 1;
      state.movementDx[index] = 0;
      state.movementDy[index] = 0;
      state.movementPlaneDelta[index] = 0;
      state.nextMovementTypes[index] = 0;
      continue;
    }
    const tile = view.forcedMovementEnd && !view.forcedMovement ? view.forcedMovementEnd : view;
    const dx = tile.x - from.x;
    const dy = tile.y - from.y;
    const planeDelta = (tile.level - from.level) & 3;
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    state.movementChanged[index] = dx !== 0 || dy !== 0 || planeDelta !== 0 ? 1 : 0;
    state.movementDx[index] = dx;
    state.movementDy[index] = dy;
    state.movementPlaneDelta[index] = planeDelta;
    state.nextMovementTypes[index] = planeDelta === 0 && distance > 0 && distance <= 2
      ? view.movementType ?? (distance === 2 ? 2 : 1)
      : 0;
  }

  const updateBlocks = state.updateBlocks;
  updateBlocks.length = 0;
  const wantsInteractionWrite = (index: number, view: PlayerView): boolean =>
    state.interactionIndices.get(index) !== (view.interactionIndex ?? -1);

  const needsBlock = (index: number): boolean => {
    const view = viewAt(index);
    if (!view) return false;
    const nextType = state.nextMovementTypes[index] as 0 | 1 | 2;
    const writeMovementType = nextType !== 0 && state.movementTypes.get(index) !== nextType;
    return playerUpdateMask(
      view,
      writeMovementType,
      view.appearanceDirty === true,
      wantsInteractionWrite(index, view)
    ) !== 0;
  };
  const shouldUpdatePlayer = (index: number): boolean =>
    viewPositions[index] < 0 || state.movementChanged[index] !== 0 || needsBlock(index);

  const appendUpdateBlock = (index: number, forceAppearance = false): void => {
    const view = viewAt(index);
    if (!view) return;
    const nextType = state.nextMovementTypes[index] as 0 | 1 | 2;
    const writeMovementType = nextType !== 0 && state.movementTypes.get(index) !== nextType;
    const writeAppearance = forceAppearance || view.appearanceDirty === true;
    const writeInteraction = wantsInteractionWrite(index, view);
    updateBlocks.push(
      writePlayerUpdateBlock(
        view,
        writeMovementType,
        nextType === 0 ? undefined : nextType,
        writeAppearance,
        writeInteraction
      )
    );
  };

  const writePlayerUpdate = (index: number): void => {
    const view = viewAt(index);
    const block = !!view && needsBlock(index);
    writer.writeBits(1, block ? 1 : 0);
    if (!view) {
      writer.writeBits(2, 0);
      writer.writeBits(1, 0);
      const last = state.lastTiles.get(index);
      if (last) state.regions[index] = ((last.level & 3) << 28) |
        (((last.x >>> 13) & 0xff) << 14) | ((last.y >>> 13) & 0xff);
      return;
    }
    const dx = state.movementDx[index];
    const dy = state.movementDy[index];
    const planeDelta = state.movementPlaneDelta[index];
    if (state.movementChanged[index] === 0) writer.writeBits(2, 0);
    else if (planeDelta === 0 && Math.max(Math.abs(dx), Math.abs(dy)) === 1 &&
      state.nextMovementTypes[index] !== 2) {
      const direction = [0, 1, 2, 3, -1, 4, 5, 6, 7][(dy + 1) * 3 + dx + 1];
      writer.writeBits(2, 1);
      writer.writeBits(3, direction);
    } else {
      const runDirection = planeDelta === 0 && state.nextMovementTypes[index] === 2
        ? RUN_DIRECTIONS.indexOf(`${dx},${dy}`)
        : -1;
      if (runDirection >= 0) {
        writer.writeBits(2, 2);
        writer.writeBits(4, runDirection);
      } else {
        writer.writeBits(2, 3);
        if (dx >= -16 && dx <= 15 && dy >= -16 && dy <= 15) {
          writer.writeBits(1, 0);
          writer.writeBits(12, (planeDelta << 10) | ((dx & 0x1f) << 5) | (dy & 0x1f));
        } else {
          writer.writeBits(1, 1);
          writer.writeBits(30, ((planeDelta << 28) |
            ((dx & 0x3fff) << 14) | (dy & 0x3fff)) >>> 0);
        }
      }
    }
    if (block) appendUpdateBlock(index);
  };

  const writeExternalUpdate = (index: number): void => {
    const view = viewAt(index)!;
    const packedRegion = ((view.level & 3) << 28) |
      (((view.x >>> 13) & 0xff) << 14) | ((view.y >>> 13) & 0xff);
    writer.writeBits(2, 0);
    writer.writeBits(1, state.regions[index] === packedRegion ? 0 : 1);
    if (state.regions[index] !== packedRegion) {
      const current = state.regions[index];
      const planeDelta = ((packedRegion >>> 28) - (current >>> 28)) & 3;
      const dx = (((packedRegion >>> 14) & 0xff) - ((current >>> 14) & 0xff)) & 0xff;
      const dy = ((packedRegion & 0xff) - (current & 0xff)) & 0xff;
      writer.writeBits(2, 3);
      writer.writeBits(18, (planeDelta << 16) | (dx << 8) | dy);
      state.regions[index] = packedRegion;
    }
    writer.writeBits(13, view.x & 0x1fff);
    writer.writeBits(13, view.y & 0x1fff);
    writer.writeBits(1, 0); // no world view
    writer.writeBits(1, 1); // appearance follows
    appendUpdateBlock(index, true);
  };

  const writePass = (
    indices: Uint16Array,
    count: number,
    wantBit: 0 | 1,
    shouldUpdate: (index: number) => boolean,
    writeUpdate: (index: number) => void,
    markUpdated: boolean
  ): void => {
    let skip = 0;
    for (let offset = 0; offset < count; offset++) {
      const index = indices[offset];
      if ((state.flags[index] & 1) !== wantBit) continue;
      if (skip > 0) {
        skip--;
        state.flags[index] |= 2;
        continue;
      }
      if (shouldUpdate(index)) {
        writer.writeBits(1, 1);
        writeUpdate(index);
        if (markUpdated) state.flags[index] |= 2;
        continue;
      }
      let run = 0;
      for (let next = offset + 1; next < count && run < 2047; next++) {
        const nextIndex = indices[next];
        if ((state.flags[nextIndex] & 1) !== wantBit) continue;
        if (shouldUpdate(nextIndex)) break;
        run++;
      }
      writer.writeBits(1, 0);
      writeSkipCount(writer, run);
      state.flags[index] |= 2;
      skip = run;
    }
  };

  writePass(state.active, state.activeCount, 0, shouldUpdatePlayer, writePlayerUpdate, false);
  writer.alignToByte();
  writePass(state.active, state.activeCount, 1, shouldUpdatePlayer, writePlayerUpdate, false);
  writer.alignToByte();
  writePass(state.empty, state.emptyCount, 1, (index) => viewPositions[index] >= 0, writeExternalUpdate, true);
  writer.alignToByte();
  writePass(state.empty, state.emptyCount, 0, (index) => viewPositions[index] >= 0, writeExternalUpdate, true);

  for (let offset = 0; offset < state.activeCount; offset++) {
    const index = state.active[offset];
    if (viewPositions[index] >= 0) continue;
    state.lastTiles.delete(index);
    state.movementTypes.delete(index);
    state.interactionIndices.delete(index);
  }

  state.activeCount = 0;
  state.emptyCount = 0;
  for (let index = 1; index < 2048; index++) {
    state.flags[index] >>>= 1;
    if (viewPositions[index] >= 0) state.active[state.activeCount++] = index;
    else state.empty[state.emptyCount++] = index;
  }

  for (let offset = 0; offset < state.activeCount; offset++) {
    const index = state.active[offset];
    const view = viewAt(index)!;
    const nextType = state.nextMovementTypes[index] as 0 | 1 | 2;
    const tile = view.forcedMovementEnd ?? view;
    const previousTile = state.lastTiles.get(index);
    if (previousTile) {
      previousTile.x = tile.x;
      previousTile.y = tile.y;
      previousTile.level = tile.level;
    } else {
      state.lastTiles.set(index, { x: tile.x, y: tile.y, level: tile.level });
    }
    if (nextType !== 0) state.movementTypes.set(index, nextType);
    state.interactionIndices.set(index, view.interactionIndex ?? -1);
  }

  updateBlocks.unshift(writer.toBuffer());
  const sync = Buffer.concat(updateBlocks);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(baseX, 0);
  header.writeUInt16BE(baseY, 2);
  header.writeUInt16BE(localIndex, 4);
  header.writeInt32BE(loopCycle | 0, 6);
  header.writeUInt16BE(sync.length, 10);
  return packet(ServerPacket.PLAYER_SYNC, Buffer.concat([header, sync]), 2);
}

export function encodeNpcSync(
  loopCycle: number,
  local: Tile,
  views: NpcView[],
  state: NpcSyncState
): Buffer {
  const writer = new BitWriter();
  const desired = new Map<number, NpcView>();
  for (const view of views) {
    if (view.index >= 0 && view.index < 0xffff && !desired.has(view.index)) desired.set(view.index, view);
  }
  const nextIndices: number[] = [];
  const readd = new Set<number>();
  const updateBlocks: Buffer[] = [];
  writer.writeBits(8, Math.min(255, state.indices.length));

  for (const index of state.indices.slice(0, 255)) {
    const view = desired.get(index);
    const last = state.lastTiles.get(index);
    if (!view || !last || view.level !== local.level || state.typeIds.get(index) !== view.typeId) {
      writer.writeBits(1, 1);
      writer.writeBits(2, 3);
      if (view) readd.add(index);
      continue;
    }
    const writeInteraction = state.interactionIndices.get(index) !== (view.interactionIndex ?? -1);
    const block = npcUpdateMask(view, writeInteraction) !== 0;
    if (view.runDirection >= 0 && view.walkDirection >= 0) {
      writer.writeBits(1, 1);
      writer.writeBits(2, 2);
      writer.writeBits(1, 1);
      writer.writeBits(3, view.walkDirection);
      writer.writeBits(3, view.runDirection);
      writer.writeBits(1, block ? 1 : 0);
      nextIndices.push(index);
    } else if (view.walkDirection >= 0) {
      writer.writeBits(1, 1);
      writer.writeBits(2, 1);
      writer.writeBits(3, view.walkDirection);
      writer.writeBits(1, block ? 1 : 0);
      nextIndices.push(index);
    } else if (view.x === last.x && view.y === last.y) {
      if (block) {
        writer.writeBits(1, 1);
        writer.writeBits(2, 0);
      } else {
        writer.writeBits(1, 0);
      }
      nextIndices.push(index);
    } else {
      writer.writeBits(1, 1);
      writer.writeBits(2, 3);
      readd.add(index);
    }
    if (block && nextIndices[nextIndices.length - 1] === index) {
      updateBlocks.push(writeNpcUpdateBlock(view, writeInteraction));
    }
  }

  const nextSet = new Set(nextIndices);
  const additions = Array.from(desired.values()).filter((view) => !nextSet.has(view.index));
  const large = additions.some((view) => {
    const dx = view.x - local.x;
    const dy = view.y - local.y;
    return dx < -16 || dx > 15 || dy < -16 || dy > 15;
  });
  const signed = (value: number, bits: number) => (value < 0 ? value + (1 << bits) : value) & ((1 << bits) - 1);
  for (const view of additions) {
    if (nextIndices.length >= 255 || view.level !== local.level) break;
    writer.writeBits(16, view.index);
    const writeInteraction = (view.interactionIndex ?? -1) >= 0;
    const block = npcUpdateMask(view, writeInteraction) !== 0;
    writer.writeBits(1, block ? 1 : 0);
    writer.writeBits(1, 0); // no world view
    writer.writeBits(1, readd.has(view.index) ? 1 : 0);
    writer.writeBits(large ? 8 : 5, signed(view.y - local.y, large ? 8 : 5));
    writer.writeBits(large ? 8 : 5, signed(view.x - local.x, large ? 8 : 5));
    writer.writeBits(3, view.rotation & 7);
    writer.writeBits(14, view.typeId & 0x3fff);
    nextIndices.push(view.index);
    nextSet.add(view.index);
    if (block) updateBlocks.push(writeNpcUpdateBlock(view, writeInteraction));
  }
  writer.writeBits(16, 0xffff);

  state.indices = nextIndices;
  state.lastTiles.clear();
  state.typeIds.clear();
  state.interactionIndices.clear();
  for (const index of nextIndices) {
    const view = desired.get(index);
    if (view) {
      state.lastTiles.set(index, { x: view.x, y: view.y, level: view.level });
      state.typeIds.set(index, view.typeId);
      state.interactionIndices.set(index, view.interactionIndex ?? -1);
    }
  }
  const sync = Buffer.concat([writer.toBuffer(), ...updateBlocks]);
  const header = Buffer.alloc(7);
  header.writeInt32BE(loopCycle | 0, 0);
  header[4] = large ? 1 : 0;
  header.writeUInt16BE(sync.length, 5);
  return packet(ServerPacket.NPC_INFO, Buffer.concat([header, sync]), 2);
}

export function encodeProjectiles(projectiles: ProjectileView[]): Buffer {
  const payload = Buffer.alloc(2 + projectiles.length * 29);
  payload.writeUInt16BE(projectiles.length, 0);
  let offset = 2;
  for (const projectile of projectiles) {
    payload.writeUInt16BE(projectile.projectileId & 0xffff, offset);
    payload.writeUInt16BE(projectile.source.x & 0xffff, offset + 2);
    payload.writeUInt16BE(projectile.source.y & 0xffff, offset + 4);
    payload[offset + 6] = projectile.source.level & 0xff;
    payload.writeUInt16BE(projectile.sourceHeight & 0xffff, offset + 7);
    payload.writeUInt16BE(projectile.target.x & 0xffff, offset + 9);
    payload.writeUInt16BE(projectile.target.y & 0xffff, offset + 11);
    payload[offset + 13] = projectile.target.level & 0xff;
    payload.writeUInt16BE(projectile.endHeight & 0xffff, offset + 14);
    payload[offset + 16] = projectile.slope & 0xff;
    payload.writeUInt16BE(projectile.startPos & 0xffff, offset + 17);
    payload.writeUInt16BE(projectile.startCycleOffset & 0xffff, offset + 19);
    payload.writeUInt16BE(projectile.endCycleOffset & 0xffff, offset + 21);
    payload[offset + 23] = 0;
    payload.writeUInt16BE(0, offset + 24);
    payload[offset + 26] = projectile.targetActor?.kind === "player" ? 1
      : projectile.targetActor?.kind === "npc" ? 2 : 0;
    payload.writeUInt16BE(projectile.targetActor?.index ?? 0, offset + 27);
    offset += 29;
  }
  return encodeServerPacket(ServerPacketId.PROJECTILES, payload);
}

export function encodeDefaultAnimations(): Buffer {
  const ids = [808, 819, 820, 821, 822, 824, 824, 824, 824, 823, 823];
  const payload = Buffer.alloc(ids.length * 2);
  ids.forEach((id, index) => payload.writeInt16BE(id, index * 2));
  return packet(ServerPacket.ANIM, payload, 0);
}

export function encodeLogoutResponse(reason = ""): Buffer {
  return packet(ServerPacket.LOGOUT_RESPONSE, Buffer.concat([Buffer.from([1]), string(reason)]));
}

export function encodePlayerOption(slot: number, option: string, priority: boolean): Buffer {
  return encodeServerPacket(ServerPacketId.PLAYER_OPTION, Buffer.concat([Buffer.from([slot, priority ? 1 : 0]), Buffer.from(option + "\0", "utf8")]));
}
