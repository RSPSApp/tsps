import type { TradeActionClientPayload } from "./messages";
import type { WidgetActionClientPayload } from "./widgets";
import type { FriendsChatAction } from "../../../common/social/FriendsChat";

type ClientToServer =
    | { type: "hello"; payload: { client: string; version?: string } }
    | { type: "ping"; payload: { time: number } }
    | {
          type: "pathfind";
          payload: {
              id: number;
              from: { x: number; y: number; plane: number };
              to: { x: number; y: number };
              size?: number;
          };
      }
    | { type: "walk"; payload: { to: { x: number; y: number }; run?: boolean } }
    | { type: "face"; payload: { rot?: number; tile?: { x: number; y: number } } }
    | { type: "set_heading"; payload: { heading: number } }
    | { type: "teleport"; payload: { to: { x: number; y: number }; level?: number } }
    | {
          type: "handshake";
          payload: {
              name?: string;
              appearance?: { gender: number; colors?: number[]; kits?: number[]; equip?: number[] };
              clientType?: number;
          };
      }
    | { type: "varp_transmit"; payload: { varpId: number; value: number } }
    | {
          type: "interact";
          payload: { mode: "follow" | "trade"; targetId: number; modifierFlags?: number };
      }
    | { type: "interact_stop"; payload: {} }
    | {
          type: "loc_interact";
          payload: {
              id: number;
              tile: { x: number; y: number };
              level?: number;
              action?: string;
          };
      }
    | { type: "emote"; payload: { index: number; loop?: boolean } }
    | {
          type: "inventory_use";
          payload: { slot: number; itemId: number; quantity?: number; option?: string };
      }
    | {
          type: "equipment_action";
          payload: { slot: number; itemId: number; option: string };
      }
    | { type: "equipment_unequip"; payload: { slot: number } }
    | { type: "equipment_clear"; payload: {} }
    | {
          type: "widget";
          payload: { action: "open" | "close"; groupId: number; modal?: boolean };
      }
    | { type: "widget_action"; payload: WidgetActionClientPayload }
    | { type: "trade_action"; payload: TradeActionClientPayload }
    | { type: "bank_deposit_inventory"; payload?: Record<string, never> }
    | { type: "bank_deposit_equipment"; payload?: Record<string, never> }
    | { type: "bank_deposit_item"; payload: { slot: number; quantity: number; itemId?: number } }
    | { type: "resume_countdialog"; payload: { amount: number } }
    | { type: "resume_namedialog"; payload: { value: string } }
    | { type: "resume_stringdialog"; payload: { value: string } }
    | {
          type: "bank_move";
          payload: { from: number; to: number; mode?: "swap" | "insert"; tab?: number };
      }
    | {
          type: "if_buttond";
          payload: {
              sourceWidgetId: number;
              sourceSlot: number;
              sourceItemId: number;
              targetWidgetId: number;
              targetSlot: number;
              targetItemId: number;
          };
      }
    | {
          type: "debug";
          payload:
              | { kind: "projectiles_request"; requestId?: number }
              | { kind: "projectiles_snapshot"; requestId: number; snapshot: any }
              | { kind: "anim_request"; requestId?: number }
              | { kind: "anim_snapshot"; requestId: number; snapshot: any };
      }
    | { type: "logout"; payload?: Record<string, never> }
    | { type: "login"; payload: { username: string; password: string; revision: number } }
    | { type: "chat"; payload: Record<string, unknown> }
    | { type: "friends_chat_action"; payload: FriendsChatAction }
    | { type: "private_message"; payload: { recipient: string; text: string } }
    | {
          type: "chat_filter";
          payload: { publicMode: number; privateMode: number; tradeMode: number };
      }
    | { type: "smithing_make"; payload: { recipeId: string; mode: string } }
    | { type: "smithing_mode"; payload: { mode: number; custom?: number } }
    | { type: "inventory_use_on"; payload: Record<string, unknown> }
    | { type: "inventory_move"; payload: { from: number; to: number } }
    | { type: "ground_item_action"; payload: Record<string, unknown> };

export type { ClientToServer };
