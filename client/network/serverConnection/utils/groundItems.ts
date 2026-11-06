import type { GroundItemStackMessage, GroundItemsServerPayload } from "../types";
import type { GroundItemsSnapshotPayload } from "../state";

export function cloneGroundItemStack(stack: GroundItemStackMessage): GroundItemStackMessage {
    return {
        id: stack.id | 0,
        itemId: stack.itemId | 0,
        enabledOps: (stack.enabledOps ?? 0x1f) & 0x1f,
        quantity: stack.quantity | 0,
        tile: {
            x: stack.tile?.x ?? 0,
            y: stack.tile?.y ?? 0,
            level: stack.tile?.level ?? 0,
        },
        createdTick:
            Number.isFinite(stack.createdTick) && (stack.createdTick as number) >= 0
                ? (stack.createdTick as number) | 0
                : undefined,
        privateUntilTick:
            Number.isFinite(stack.privateUntilTick) && (stack.privateUntilTick as number) > 0
                ? (stack.privateUntilTick as number) | 0
                : undefined,
        expiresTick:
            Number.isFinite(stack.expiresTick) && (stack.expiresTick as number) > 0
                ? (stack.expiresTick as number) | 0
                : undefined,
        ownerId:
            Number.isFinite(stack.ownerId) && (stack.ownerId as number) >= 0
                ? (stack.ownerId as number) | 0
                : undefined,
        isPrivate: stack.isPrivate === true,
        ownership:
            stack.ownership === 1 ||
            stack.ownership === 2 ||
            stack.ownership === 3 ||
            stack.ownership === 0
                ? (stack.ownership as 0 | 1 | 2 | 3)
                : 0,
    };
}

export function cloneGroundItemsPayload(payload: GroundItemsServerPayload): GroundItemsServerPayload {
    if (payload.kind === "delta") {
        return {
            kind: "delta",
            serial: payload.serial | 0,
            upserts: (payload.upserts ?? []).map((stack) => cloneGroundItemStack(stack)),
            removes: Array.isArray(payload.removes)
                ? payload.removes
                      .map((stackId) => Number(stackId) | 0)
                      .filter((stackId) => stackId > 0)
                : [],
        };
    }
    return {
        kind: "snapshot",
        serial: payload.serial | 0,
        stacks: (payload.stacks ?? []).map((stack) => cloneGroundItemStack(stack)),
    };
}

export function applyGroundItemsDelta(
    base: GroundItemsSnapshotPayload | undefined,
    delta: Extract<GroundItemsServerPayload, { kind: "delta" }>,
): GroundItemsSnapshotPayload {
    const byId = new Map<number, GroundItemStackMessage>();
    if (base && Array.isArray(base.stacks)) {
        for (const stack of base.stacks) {
            const id = stack.id | 0;
            if (id > 0) byId.set(id, cloneGroundItemStack(stack));
        }
    }
    for (const stack of delta.upserts ?? []) {
        const id = stack.id | 0;
        if (id <= 0) continue;
        byId.set(id, cloneGroundItemStack(stack));
    }
    for (const stackId of delta.removes ?? []) {
        byId.delete(stackId | 0);
    }
    return {
        kind: "snapshot",
        serial: delta.serial | 0,
        stacks: [...byId.values()],
    };
}
