package gateway.down

import gateway.cache.ObjTypes
import gateway.tsps.TspsPacket
import gateway.tsps.TspsReader
import gateway.tsps.TspsServerPacket
import net.rsprot.protocol.common.game.outgoing.inv.InventoryObject
import net.rsprot.protocol.game.outgoing.inv.UpdateInvFull
import net.rsprot.protocol.game.outgoing.inv.UpdateInvPartial
import net.rsprot.protocol.game.outgoing.inv.UpdateInvStopTransmit
import net.rsprot.protocol.game.outgoing.misc.player.UpdateRunWeight
import net.rsprot.protocol.game.outgoing.misc.player.UpdateStockMarketSlotV2
import net.rsprot.protocol.game.outgoing.specific.ObjAddSpecific
import net.rsprot.protocol.game.outgoing.specific.ObjCountSpecific
import net.rsprot.protocol.game.outgoing.specific.ObjDelSpecific
import net.rsprot.protocol.message.OutgoingGameMessage

/**
 * Inventories, ground items and the Grand Exchange.
 *
 * tsps has its own packets for the main inventory, bank, shop and collection log, and sends
 * other inventories by their OSRS ids on WIDGET_RUN_SCRIPT; all become UPDATE_INV packets.
 * Worn equipment never has its own packet: it comes from the local player's appearance.
 */
class Items(
    private val objs: ObjTypes,
    private val send: (OutgoingGameMessage) -> Unit,
) {
    private val inventories = HashMap<Int, Array<Pair<Int, Int>?>>()
    private var weight = Int.MIN_VALUE

    /** tsps sends native sessions worn equipment itself, with quantities; then appearance isn't needed. */
    private var equipmentFromServer = false

    fun handle(packet: TspsPacket): Boolean {
        val reader = packet.reader()
        when (packet.opcode) {
            TspsServerPacket.INVENTORY_SNAPSHOT -> full(INVENTORY, INVENTORY_SIZE, List(reader.u16()) { slot(reader) })
            TspsServerPacket.INVENTORY_SLOT -> partial(INVENTORY, slot(reader))
            TspsServerPacket.BANK_SNAPSHOT -> {
                val capacity = reader.u16()
                full(BANK, capacity, List(reader.u16()) { slot(reader).also { reader.u8() } })
            }
            TspsServerPacket.BANK_SLOT -> partial(BANK, slot(reader).also { reader.u8() })
            TspsServerPacket.COLLECTION_LOG_SNAPSHOT -> {
                val slots = List(reader.u16()) { Slot(reader.u16(), reader.u16(), reader.i32()) }
                full(COLLECTION_LOG, (slots.maxOfOrNull { it.slot } ?: -1) + 1, slots)
            }
            TspsServerPacket.SHOP_OPEN -> {
                reader.string() // shop key
                reader.string() // name: the interface shows it from tsps's own IF_SETTEXT
                reader.u16() // currency
                reader.u8() // general store
                reader.u8() // buy mode
                reader.u8() // sell mode
                val stock =
                    List(reader.u16()) {
                        val slot = reader.u16()
                        val item = reader.u16()
                        val quantity = reader.i32()
                        repeat(3) { reader.i32() } // default stock and prices: the client works prices out itself
                        Slot(slot, item, quantity)
                    }
                full(SHOP, SHOP_SIZE, stock)
            }
            TspsServerPacket.SHOP_CLOSE -> send(UpdateInvStopTransmit(SHOP))
            else -> return false
        }
        return true
    }

    /** How many of [item] the main inventory holds. */
    fun carried(item: Int): Int = inventories[INVENTORY]?.filterNotNull()?.filter { it.first == item }?.sumOf { it.second } ?: 0

    /** The inventories WIDGET_RUN_SCRIPT carries: `u8 count`, then `u16 inv, u16 capacity, u16 n, n slots`. */
    fun scriptInventories(reader: TspsReader) {
        repeat(reader.u8()) {
            val inventory = reader.u16()
            val capacity = reader.u16()
            if (inventory == EQUIPMENT) equipmentFromServer = true
            full(inventory, capacity, List(reader.u16()) { slot(reader) })
        }
    }

    /** Worn equipment from the local player's appearance (quantities only for ammo), unless tsps sends it. */
    fun selfAppearance(appearance: AppearanceBlock) {
        if (equipmentFromServer) return
        val slots = ArrayList<Slot>()
        appearance.objs.forEachIndexed { slot, obj -> if (obj >= 0) slots += Slot(slot, obj, 1) }
        if (appearance.ring >= 0) slots += Slot(RING_SLOT, appearance.ring, 1)
        if (appearance.ammo >= 0) slots += Slot(AMMO_SLOT, appearance.ammo, appearance.ammoQuantity.coerceAtLeast(1))
        full(EQUIPMENT, EQUIPMENT_SIZE, slots)
    }

    private fun full(inventory: Int, capacity: Int, slots: List<Slot>) {
        val size = maxOf(capacity, (slots.maxOfOrNull { it.slot } ?: -1) + 1)
        val contents = arrayOfNulls<Pair<Int, Int>>(size)
        for (slot in slots) if (slot.item >= 0) contents[slot.slot] = slot.item to slot.quantity
        inventories[inventory] = contents
        send(UpdateInvFull(inventory, size) { pack(contents, it) })
        if (inventory == INVENTORY || inventory == EQUIPMENT) updateWeight()
    }

    private fun partial(inventory: Int, slot: Slot) {
        val contents = inventories[inventory]
        if (contents == null || slot.slot >= contents.size) {
            full(inventory, if (inventory == INVENTORY) INVENTORY_SIZE else slot.slot + 1, listOf(slot))
            return
        }
        contents[slot.slot] = if (slot.item >= 0) slot.item to slot.quantity else null
        send(UpdateInvPartial(inventory, object : UpdateInvPartial.IndexedObjectProvider(listOf(slot.slot).iterator()) {
            override fun provide(slot: Int): Long = contents[slot]?.let { (id, count) -> InventoryObject(slot, id, count) } ?: InventoryObject(slot, -1, 0)
        }))
        if (inventory == INVENTORY) updateWeight()
    }

    /** OSRS shows carried weight in kilograms; tsps never sends it, so it comes from the cache. */
    private fun updateWeight() {
        val grams =
            listOfNotNull(inventories[INVENTORY], inventories[EQUIPMENT])
                .flatMap { it.filterNotNull() }
                .sumOf { (id, _) -> objs[id].weight }
        val kilograms = grams / GRAMS_PER_KILOGRAM
        if (kilograms == weight) return
        weight = kilograms
        send(UpdateRunWeight(kilograms))
    }

    private fun pack(contents: Array<Pair<Int, Int>?>, slot: Int): Long =
        contents.getOrNull(slot)?.let { (id, count) -> InventoryObject(id, count) } ?: InventoryObject.NULL

    private class Slot(val slot: Int, val item: Int, val quantity: Int)

    /** tsps's item slot: `u16 slot, u16 item + 1, u8 count` (255: an i32 count follows). */
    private fun slot(reader: TspsReader): Slot {
        val slot = reader.u16()
        val item = reader.u16() - 1
        val small = reader.u8()
        val quantity = if (small == 255) reader.i32() else small
        return Slot(slot, item, quantity)
    }

    companion object {
        const val INVENTORY = 93
        const val EQUIPMENT = 94
        const val BANK = 95
        const val SHOP = 516
        const val COLLECTION_LOG = 620
        private const val INVENTORY_SIZE = 28
        private const val EQUIPMENT_SIZE = 14
        private const val SHOP_SIZE = 40
        private const val RING_SLOT = 12
        private const val AMMO_SLOT = 13
        private const val GRAMS_PER_KILOGRAM = 1000
    }
}

/**
 * Ground items. tsps sends every stack the player can see, keyed by its own stack id, with
 * absolute tiles and tick timers; the client gets OBJ_ADD/DEL/COUNT for the ones in its
 * scene, replacing any retained stacks when the scene rebuilds.
 */
class GroundItems(private val send: (OutgoingGameMessage) -> Unit) {
    private class Stack(
        val item: Int,
        val quantity: Int,
        val x: Int,
        val z: Int,
        val level: Int,
        val privateUntil: Int,
        val expires: Int,
        val ownership: Int,
        val private: Boolean,
    )

    private val stacks = HashMap<Int, Stack>()
    private val shown = HashSet<Int>()
    private var tick = 0
    private var sceneX = 0
    private var sceneZ = 0

    fun tick(tick: Int) {
        this.tick = tick
    }

    /** The client retains objs in overlapping tiles: remove them before resending the scene. */
    fun rebuild(zoneX: Int, zoneZ: Int) {
        for (id in shown) {
            val stack = stacks.getValue(id)
            send(ObjDelSpecific(stack.item, stack.quantity, stack.level, stack.x, stack.z))
        }
        sceneX = (zoneX - SCENE_RADIUS_ZONES) shl 3
        sceneZ = (zoneZ - SCENE_RADIUS_ZONES) shl 3
        shown.clear()
        for ((id, stack) in stacks) show(id, stack)
    }

    fun handle(packet: TspsPacket): Boolean {
        val reader = packet.reader()
        when (packet.opcode) {
            TspsServerPacket.GROUND_ITEMS -> {
                reader.i32() // serial
                val snapshot = List(reader.u16()) { stack(reader) }.toMap()
                for (id in stacks.keys - snapshot.keys) remove(id)
                snapshot.forEach(::upsert)
            }
            TspsServerPacket.GROUND_ITEMS_DELTA -> {
                reader.i32()
                List(reader.u16()) { stack(reader) }.forEach { (id, stack) -> upsert(id, stack) }
                repeat(reader.u16()) { remove(reader.i32()) }
            }
            else -> return false
        }
        return true
    }

    private fun upsert(id: Int, stack: Stack) {
        val old = stacks.put(id, stack)
        if (old == null || id !in shown) {
            show(id, stack)
        } else if (old.item == stack.item && old.x == stack.x && old.z == stack.z && old.level == stack.level) {
            if (old.quantity != stack.quantity) send(ObjCountSpecific(stack.item, old.quantity, stack.quantity, stack.level, stack.x, stack.z))
        } else {
            send(ObjDelSpecific(old.item, old.quantity, old.level, old.x, old.z))
            shown.remove(id)
            show(id, stack)
        }
    }

    private fun remove(id: Int) {
        val stack = stacks.remove(id) ?: return
        if (shown.remove(id)) send(ObjDelSpecific(stack.item, stack.quantity, stack.level, stack.x, stack.z))
    }

    private fun show(id: Int, stack: Stack) {
        if (stack.x - sceneX !in 0 until SCENE_SIZE || stack.z - sceneZ !in 0 until SCENE_SIZE) return
        shown += id
        send(
            ObjAddSpecific(
                stack.item,
                stack.quantity,
                stack.level,
                stack.x,
                stack.z,
                ALL_OPS,
                timeUntilPublic = (stack.privateUntil - tick).coerceAtLeast(0),
                timeUntilDespawn = (stack.expires - tick).coerceAtLeast(0),
                ownershipType = stack.ownership,
                neverBecomesPublic = stack.private,
            ),
        )
    }

    /** One `encodeGroundItem`: i32 id, u16 item, i32 qty, u16 x, u16 z, u8 level, i32 created, private until, expires, owner, u8 private, u8 ownership. */
    private fun stack(reader: TspsReader): Pair<Int, Stack> {
        val id = reader.i32()
        val item = reader.u16()
        val quantity = reader.i32()
        val x = reader.u16()
        val z = reader.u16()
        val level = reader.u8()
        reader.i32() // created tick
        val privateUntil = reader.i32()
        val expires = reader.i32()
        reader.i32() // owner
        val private = reader.u8() != 0
        val ownership = reader.u8()
        return id to Stack(item, quantity, x, z, level, privateUntil, expires, ownership, private)
    }

    private companion object {
        const val SCENE_RADIUS_ZONES = 6
        const val SCENE_SIZE = 104
        const val ALL_OPS: Byte = 0x1F
    }
}

/**
 * tsps keeps Grand Exchange offers in varps past the cache's count (7900 + slot × 7: price,
 * quantity, traded quantity, traded gold, sell flag, status, item), which the browser reads
 * as stock-market state. The official client gets UPDATE_STOCKMARKET_SLOT.
 */
class StockMarket(private val send: (OutgoingGameMessage) -> Unit) {
    private val fields = Array(SLOTS) { IntArray(FIELDS) }

    fun isOfferVarp(varp: Int) = varp in FIRST_VARP until FIRST_VARP + SLOTS * FIELDS

    fun setVarp(varp: Int, value: Int) {
        val slot = (varp - FIRST_VARP) / FIELDS
        val offer = fields[slot]
        offer[(varp - FIRST_VARP) % FIELDS] = value
        val state = offer[STATUS]
        val status = if (state == 0) 0 else state + if (offer[SELL] != 0) SELL_STATUS_OFFSET else 0
        send(
            UpdateStockMarketSlotV2(
                slot,
                UpdateStockMarketSlotV2.SetStockMarketSlot(
                    status,
                    offer[ITEM],
                    offer[PRICE].toLong(),
                    offer[QUANTITY],
                    offer[TRADED_QUANTITY],
                    offer[TRADED_GOLD].toLong(),
                ),
            ),
        )
    }

    private companion object {
        const val FIRST_VARP = 7900
        const val SLOTS = 8
        const val FIELDS = 7
        const val PRICE = 0
        const val QUANTITY = 1
        const val TRADED_QUANTITY = 2
        const val TRADED_GOLD = 3
        const val SELL = 4
        const val STATUS = 5
        const val ITEM = 6

        /** OSRS offer states: 2 buying, 5 bought; selling ones are the same plus 8. */
        const val SELL_STATUS_OFFSET = 8
    }
}
