export type WidgetServerPayload =
    | {
          action: "close" | "open";
          groupId: number;
          modal?: boolean;
      }
    | {
          action: "set_root";
          groupId: number;
      }
    | {
          action: "open_sub";
          targetUid: number;
          groupId: number;
          type: number;
          /** Optional varps to set before opening the interface */
          varps?: Record<number, number>;
          /** Optional varbits to set before opening the interface */
          varbits?: Record<number, number>;
          /** Optional widget UIDs to hide immediately after mount (same packet/frame). */
          hiddenUids?: number[];
          /** Optional scripts to run BEFORE mounting the interface (e.g., 2379 for chatbox setup) */
          preScripts?: Array<{ scriptId: number; args: (number | string)[] }>;
          /** Optional scripts to run AFTER the interface is fully loaded (widgets indexed) */
          postScripts?: Array<{ scriptId: number; args: (number | string)[] }>;
      }
    | {
          action: "close_sub";
          targetUid: number;
      }
    | {
          action: "set_text";
          uid: number;
          text: string;
      }
    | {
          action: "set_hidden";
          uid: number;
          hidden: boolean;
      }
    | {
          action: "set_item";
          uid: number;
          itemId: number;
          quantity?: number;
      }
    | {
          action: "set_npc_head";
          uid: number;
          npcId: number;
      }
    | {
          action: "set_flags";
          uid: number;
          flags: number;
      }
    | {
          action: "set_animation";
          uid: number;
          animationId: number;
      }
    | {
          action: "set_player_head";
          uid: number;
      }
    | {
          action: "set_flags_range";
          uid: number;
          fromSlot: number;
          toSlot: number;
          flags: number;
      }
    | {
          action: "run_script";
          scriptId: number;
          args?: (number | string)[];
          varps?: Record<number, number>;
          varbits?: Record<number, number>;
      }
    | {
          action: "set_position";
          uid: number;
          x: number;
          y: number;
      }
    | {
          /** IF_SETCOLOUR, already widened to 24-bit RGB. */
          action: "set_colour";
          uid: number;
          colour: number;
      }
    | {
          action: "set_model";
          uid: number;
          modelId?: number;
          itemId?: number;
          itemQuantity?: number;
          modelOrthog?: boolean;
      }
    | {
          action: "set_quest_list";
          groups: Array<{
              title: string;
              quests: Array<{ key: string; slot: number; displayName: string; status: number }>;
          }>;
      };

export type WidgetActionClientPayload = {
    widgetId: number;
    groupId: number;
    childId: number;
    option?: string;
    target?: string;
    /**
     * Matches OSRS "OP" numbering where 0 refers to the widget's target verb,
     * 1 is the first entry in actions[], etc. Undefined when the option
     * could not be mapped to a canonical slot.
     */
    opId?: number;
    /** 1-based submenu entry index when the op was invoked from an op submenu. */
    subOpId?: number;
    /** Optional contextual coords relative to the widget surface (canvas pixels). */
    cursorX?: number;
    cursorY?: number;
    /** True when triggered via default left-click instead of an explicit menu selection. */
    isPrimary?: boolean;
    /** Optional slot/index metadata for item grids or list widgets. */
    slot?: number;
    itemId?: number;
};
