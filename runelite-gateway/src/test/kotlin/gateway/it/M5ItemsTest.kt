package gateway.it

import gateway.headless.HeadlessClient
import net.rsprox.protocol.game.outgoing.model.inv.UpdateInvFull
import net.rsprox.protocol.game.outgoing.model.inv.UpdateInvPartial
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import net.rsprox.protocol.game.outgoing.model.misc.client.ServerTickEnd
import net.rsprox.protocol.game.outgoing.model.specific.ObjAddSpecific
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test

/** M5: inventories (worn equipment included), wielding, and dropping an item to the ground. */
class M5ItemsTest {
    private val modulus = LiveGateway.gateway.rsa.modulus

    @Test
    fun `login sends the inventory and worn equipment`() {
        login(LiveGateway.newAccount("gwitem")).use { game ->
            game.expect<RebuildLoginV2>()
            val inventories = game.until(TICKS).filterIsInstance<UpdateInvFull>().map { it.inventoryId }.toSet()
            // tsps sends native sessions worn equipment as its own inventory.
            assertTrue(INVENTORY in inventories && WORN in inventories, "got $inventories")
        }
    }

    @Test
    fun `items are wielded with their stack and dropped to the ground`() {
        val developer = LiveGateway.developerName
        assumeTrue(developer != null, "DEV_USERNAME isn't set; spawning items needs ::item")
        login(developer!!).use { game ->
            val tile = game.expect<RebuildLoginV2>().playerInfoInitBlock.localPlayerCoord
            // The login burst (plugins' restored state included) can take a few ticks to arrive.
            val wornAtLogin = game.until(LOGIN_TICKS).filterIsInstance<UpdateInvFull>().lastOrNull { it.inventoryId == WORN }
            val dartsBefore = wornAtLogin?.objs?.firstOrNull { it.id == BRONZE_DART }?.count ?: 0
            game.command("item $BRONZE_DART $DARTS")
            // The developer may carry darts already: the whole stack is wielded.
            val (dartsSlot, carried) = game.inventoryStackOf(BRONZE_DART)
            game.button(INVENTORY_INTERFACE, 0, op = WIELD_OP, sub = dartsSlot, obj = BRONZE_DART)
            val worn = game.expectInventory(WORN) { inv -> inv.objs.any { it.id == BRONZE_DART } }
            // Native sessions get quantities the appearance block can't carry.
            assertEquals(dartsBefore + carried, worn.objs.first { it.id == BRONZE_DART }.count)
            assertTrue(carried >= DARTS)

            game.command("item $BRONZE_AXE 1")
            val axeSlot = game.inventorySlotOf(BRONZE_AXE)
            game.button(INVENTORY_INTERFACE, 0, op = DROP_OP, sub = axeSlot, obj = BRONZE_AXE)
            val dropped = game.expect<ObjAddSpecific>()
            assertEquals(BRONZE_AXE, dropped.id)
            assertEquals(tile.x to tile.z, dropped.coordGrid.x to dropped.coordGrid.z)

            // Take the darts off again, so the developer account isn't left armed.
            game.button(WORN_INTERFACE, WEAPON_SLOT, op = REMOVE_OP)
        }
    }

    private fun login(name: String): HeadlessClient.Game = LiveGateway.login(name)

    /** The slot and stack of an item, from the next inventory update that has it. */
    private fun HeadlessClient.Game.inventoryStackOf(item: Int): Pair<Int, Int> {
        repeat(PACKETS) {
            val message = next() ?: error("stream ended")
            if (message is UpdateInvFull && message.inventoryId == INVENTORY) {
                val slot = message.objs.indexOfFirst { it.id == item }
                if (slot >= 0) return slot to message.objs[slot].count
            }
        }
        error("$item never reached the inventory")
    }

    /** The slot an item lands in, from the next inventory update that has it. */
    private fun HeadlessClient.Game.inventorySlotOf(item: Int): Int {
        repeat(PACKETS) {
            when (val message = next() ?: error("stream ended")) {
                is UpdateInvFull -> if (message.inventoryId == INVENTORY) message.objs.indexOfFirst { it.id == item }.takeIf { it >= 0 }?.let { return it }
                is UpdateInvPartial -> if (message.inventoryId == INVENTORY) message.objs.firstOrNull { it.id == item }?.let { return it.slot }
            }
        }
        error("item $item never reached the inventory")
    }

    private fun HeadlessClient.Game.expectInventory(inventory: Int, matches: (UpdateInvFull) -> Boolean): UpdateInvFull {
        repeat(PACKETS) {
            val message = next() ?: error("stream ended")
            if (message is UpdateInvFull && message.inventoryId == inventory && matches(message)) return message
        }
        error("no matching inventory $inventory")
    }

    private fun HeadlessClient.Game.until(ticks: Int): List<Any> {
        val messages = ArrayList<Any>()
        var seen = 0
        while (seen < ticks) {
            val message = next() ?: error("stream ended")
            messages += message
            if (message is ServerTickEnd) seen++
        }
        return messages
    }

    private companion object {
        const val PASSWORD = "gateway-test"
        const val OK = 2
        const val DUPLICATE = 5
        const val TICKS = 4
        const val PACKETS = 3_000
        const val INVENTORY = 93
        const val WORN = 94
        const val INVENTORY_INTERFACE = 149
        const val WORN_INTERFACE = 387
        const val WEAPON_SLOT = 18
        const val REMOVE_OP = 1
        const val WIELD_OP = 3
        const val DROP_OP = 7
        const val BRONZE_DART = 806
        const val DARTS = 50
        const val LOGIN_TICKS = 8
        const val BRONZE_AXE = 1351
    }
}
