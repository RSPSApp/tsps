export type InventorySlotMessage = { slot: number; itemId: number; quantity: number };
export type InventoryServerUpdate =
    | { kind: "snapshot"; slots: InventorySlotMessage[] }
    | { kind: "slot"; slot: InventorySlotMessage };

/** Collection log inventory update (ID 620 - collection_transmit) */
export type CollectionLogSlotMessage = { slot: number; itemId: number; quantity: number };
export type CollectionLogServerPayload = {
    kind: "snapshot";
    slots: CollectionLogSlotMessage[];
};

export type BankSlotMessage = { slot: number; itemId: number; quantity: number };

export type BankServerUpdate =
    | { kind: "snapshot"; capacity: number; slots: BankSlotMessage[] }
    | { kind: "slot"; slot: BankSlotMessage };

export type NpcInfoPayload = {
    loopCycle: number;
    large: boolean;
    /** Main-world tile that main-world NPC deltas are relative to (differs aboard a boat). */
    rootTileX: number;
    rootTileY: number;
    packet: Uint8Array;
};

export type ShopStockEntryMessage = {
    slot: number;
    itemId: number;
    quantity: number;
    defaultQuantity?: number;
    priceEach?: number;
    sellPrice?: number;
};

export type GroundItemStackMessage = {
    id: number;
    itemId: number;
    quantity: number;
    tile: { x: number; y: number; level: number };
    createdTick?: number;
    privateUntilTick?: number;
    expiresTick?: number;
    ownerId?: number;
    isPrivate?: boolean;
    /** Mirrors RuneLite TileItem ownership constants: 0=none,1=self,2=other,3=group */
    ownership?: 0 | 1 | 2 | 3;
};

export type GroundItemsServerPayload =
    | {
          kind: "snapshot";
          serial: number;
          stacks: GroundItemStackMessage[];
      }
    | {
          kind: "delta";
          serial: number;
          upserts: GroundItemStackMessage[];
          removes: number[];
      };

type GroundItemsSnapshotPayload = Extract<GroundItemsServerPayload, { kind: "snapshot" }>;

export type GroundItemActionPayload = {
    stackId: number;
    tile: { x: number; y: number; level?: number };
    itemId: number;
    quantity?: number;
    option?: string;
    /** The option's number (1-5) for an option other than Take, such as giant bones' Bury. */
    opNum?: number;
};

export type ShopServerPayload =
    | {
          kind: "open";
          shopId: string;
          name: string;
          currencyItemId: number;
          generalStore?: boolean;
          buyMode?: number;
          sellMode?: number;
          stock: ShopStockEntryMessage[];
      }
    | {
          kind: "slot";
          shopId: string;
          slot: ShopStockEntryMessage;
      }
    | {
          kind: "close";
      }
    | {
          kind: "mode";
          shopId: string;
          buyMode?: number;
          sellMode?: number;
      };

export type SmithingOptionMessage = {
    recipeId: string;
    name: string;
    level: number;
    itemId: number;
    outputQuantity: number;
    available: number;
    canMake: boolean;
    xp?: number;
    ingredientsLabel?: string;
    mode?: "smelt" | "forge";
    barItemId?: number;
    barCount?: number;
    requiresHammer?: boolean;
    hasHammer?: boolean;
};

export type SmithingServerPayload =
    | {
          kind: "open" | "update";
          mode: "smelt" | "forge";
          title?: string;
          options: SmithingOptionMessage[];
          quantityMode: number;
          customQuantity?: number;
      }
    | {
          kind: "mode";
          quantityMode: number;
          customQuantity?: number;
      }
    | {
          kind: "close";
      };

export type SmithingWindowState = {
    open: boolean;
    mode: "smelt" | "forge";
    title?: string;
    options: SmithingOptionMessage[];
    quantityMode: number;
    customQuantity?: number;
};

export type ShopWindowState = {
    open: boolean;
    shopId?: string;
    name?: string;
    currencyItemId?: number;
    generalStore?: boolean;
    buyMode: number;
    sellMode: number;
    stock: ShopStockEntryMessage[];
};

export type TradeOfferEntryMessage = {
    slot: number;
    itemId: number;
    quantity: number;
};

export type TradePartyViewState = {
    playerId?: number;
    name?: string;
    offers: TradeOfferEntryMessage[];
    accepted?: boolean;
    confirmAccepted?: boolean;
};

export type TradeWindowState = {
    open: boolean;
    sessionId?: string;
    stage: "offer" | "confirm";
    self?: TradePartyViewState;
    other?: TradePartyViewState;
    infoMessage?: string;
    requestFrom?: { playerId: number; name?: string } | undefined;
};

export type TradePartyMessage = {
    playerId?: number;
    name?: string;
    offers: TradeOfferEntryMessage[];
    accepted?: boolean;
    confirmAccepted?: boolean;
};

export type TradeServerPayload =
    | { kind: "request"; fromId: number; fromName?: string }
    | {
          kind: "open" | "update";
          sessionId: string;
          stage: "offer" | "confirm";
          self: TradePartyMessage;
          other: TradePartyMessage;
          info?: string;
      }
    | { kind: "close"; reason?: string };

export type TradeActionClientPayload =
    | { action: "offer"; slot: number; quantity: number; itemId?: number }
    | { action: "remove"; slot: number; quantity: number; itemId?: number }
    | { action: "accept" }
    | { action: "decline" }
    | { action: "confirm_accept" }
    | { action: "confirm_decline" };

export type ChatMessageEvent = {
    messageType: string;
    /** Raw OSRS chat channel id (for example, 101 = trade request). */
    chatType?: number;
    text: string;
    from?: string;
    prefix?: string;
    playerId?: number;
};

export type {
    FriendSnapshot,
    FriendsChatAction,
    FriendsChatMemberSnapshot,
    FriendsChatSnapshot,
    IgnoreSnapshot,
} from "../../../common/social/FriendsChat";

export type NotificationEvent = {
    kind:
        | "loot"
        | "league_task"
        | "collection_log"
        | "achievement"
        | "level_up"
        | "quest"
        | "warning"
        | "info";
    title?: string;
    message: string;
    itemId?: number;
    quantity?: number;
    durationMs?: number;
};

export type PlayerAnimPayload = {
    idle?: number;
    walk?: number;
    walkBack?: number;
    walkLeft?: number;
    walkRight?: number;
    run?: number;
    runBack?: number;
    runLeft?: number;
    runRight?: number;
    turnLeft?: number;
    turnRight?: number;
};

export type HitsplatServerPayload = {
    targetType: "player" | "npc";
    targetId: number;
    damage: number;
    style?: number;
    type2?: number;
    damage2?: number;
    delayCycles?: number;
    tick?: number;
};

export type SpotAnimationPayload = {
    spotId: number;
    playerId?: number;
    npcId?: number;
    tile?: { x: number; y: number; level?: number };
    height?: number;
    delay?: number;
};

export type SkillEntryMessage = {
    id: number;
    xp: number;
    baseLevel: number;
    virtualLevel: number;
    boost: number;
    currentLevel: number;
};

export type SkillsServerPayload = {
    kind: "snapshot" | "delta";
    skills: SkillEntryMessage[];
    totalLevel: number;
    combatLevel: number;
};
export type RunEnergyPayload = {
    percent: number;
    units?: number;
    running?: boolean;
    weight?: number;
    staminaTicks?: number;
    staminaMultiplier?: number;
    staminaTickMs?: number;
};

export type RunEnergyState = {
    percent: number;
    units: number;
    running: boolean;
    weight: number;
    stamina?: {
        ticks: number;
        msPerTick: number;
        multiplier: number;
        expiresAt: number;
    };
};

export type SpellCastModifiers = {
    isAutocast?: boolean;
    defensive?: boolean;
    queued?: boolean;
    castMode?: "manual" | "autocast" | "defensive_autocast";
};

export type SpellResultPayload = {
    casterId: number;
    spellId: number;
    outcome: "success" | "failure";
    reason?:
        | "invalid_spell"
        | "invalid_target"
        | "out_of_range"
        | "out_of_runes"
        | "level_requirement"
        | "cooldown"
        | "restricted_zone"
        | "immune_target"
        | "already_active"
        | "line_of_sight"
        | "server_error"
        | string;
    targetType: "npc" | "player" | "loc" | "obj" | "tile";
    targetId?: number;
    tile?: { x: number; y: number; plane?: number };
    modifiers?: SpellCastModifiers;
    runesConsumed?: { itemId: number; quantity: number }[];
    runesRefunded?: { itemId: number; quantity: number }[];
    hitDelay?: number;
    impactSpotAnim?: number;
    castSpotAnim?: number;
    splashSpotAnim?: number;
    damage?: number;
    maxHit?: number;
    accuracy?: number;
};
