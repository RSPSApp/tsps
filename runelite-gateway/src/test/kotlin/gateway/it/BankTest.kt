package gateway.it

import gateway.cache.VarTypes
import gateway.headless.HeadlessClient
import gateway.headless.TestCache
import net.rsprox.protocol.game.outgoing.model.interfaces.IfSetEventsV2
import net.rsprox.protocol.game.outgoing.model.inv.UpdateInvFull
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import net.rsprox.protocol.game.outgoing.model.misc.client.ServerTickEnd
import net.rsprox.protocol.game.outgoing.model.varp.VarpLarge
import net.rsprox.protocol.game.outgoing.model.varp.VarpSmall
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test

/**
 * Rearranging the bank as the official client does it: drags within the items, onto the tab bar,
 * and into the empty space after a tab. It works on the developer's real bank, in its main tab
 * (the client lays tabs 1-9 out first, then the main tab), and puts everything back; a fresh
 * account gets two items deposited first.
 */
class BankTest {
    private val vars = VarTypes(TestCache.cache)
    private val varps = HashMap<Int, Int>()

    @Test
    fun `items swap by drag and move to another tab, and back`() {
        val developer = LiveGateway.developerName
        assumeTrue(developer != null, "DEV_USERNAME isn't set; ::bank is a developer command")
        LiveGateway.login(developer!!).use { game ->
            game.expect<RebuildLoginV2>()
            game.bankAfter(LOGIN_TICKS, allowNone = true)
            game.command("bank")
            var tabBarEnabled = false
            var opened = game.bankAfter(TICKS) { if (it is IfSetEventsV2 && it.interfaceId == BANK && it.componentId == TABS) tabBarEnabled = true }
            assertTrue(tabBarEnabled, "the tab bar takes drops")
            if (opened.size - tabSizes().sum() < 2) {
                // A fresh test account: two items of its own, deposited into the main tab.
                for (item in SEED_ITEMS) game.command("item $item 1")
                game.bankAfter(TICKS, allowNone = true)
                game.button(BANK, DEPOSIT_INVENTORY)
                opened = game.bankAfter(TICKS)
            }
            val mainStart = tabSizes().sum()
            assertTrue(opened.size - mainStart >= 2, "the main tab has two items")

            // The main tab's last two items. Within one component RuneLite has already swapped them
            // on screen when it sends, so the first obj is the dropped-on slot's (as recorded).
            val a = opened.size - 2
            val b = opened.size - 1
            game.drag(BANK, ITEMS, a, opened[b], BANK, ITEMS, b, opened[a])
            assertEquals(listOf(opened[b], opened[a]), game.bankAfter(TICKS).takeLast(2))
            game.drag(BANK, ITEMS, a, opened[a], BANK, ITEMS, b, opened[b])
            assertEquals(listOf(opened[a], opened[b]), game.bankAfter(TICKS).takeLast(2))

            // The main tab's last item onto tab 1's button (made for it if there is none). Onto
            // another component the client sends the objs as they are: the dragged one first.
            val moved = opened[b]
            game.drag(BANK, ITEMS, b, moved, BANK, TABS, TAB_1, NO_OBJ)
            val inTab = game.bankAfter(TICKS)
            assertTrue(moved in inTab.take(tabSizes().first()), "$moved in tab 1 of $inTab")

            // Back, into the empty space after the main tab's items (no swap there).
            game.drag(BANK, ITEMS, inTab.indexOf(moved), moved, BANK, ITEMS, MAIN_TAB_DROP, NO_OBJ)
            val back = game.bankAfter(TICKS)
            assertEquals(opened, back, "back as it was")
        }
    }

    /** Tabs 1-9's sizes, from their varbits. */
    private fun tabSizes(): List<Int> =
        (TAB_1_SIZE until TAB_1_SIZE + 9).map { id ->
            val bit = requireNotNull(vars.varbit(id))
            ((varps[bit.varp] ?: 0) ushr bit.lsb) and ((1 shl (bit.msb - bit.lsb + 1)) - 1)
        }

    /** The bank's item ids in slot order after [count] ticks (the last full update). */
    private fun HeadlessClient.Game.bankAfter(count: Int, allowNone: Boolean = false, each: (Any) -> Unit = {}): List<Int> {
        var bank: List<Int>? = null
        var seen = 0
        while (seen < count) {
            val message = next() ?: error("stream ended")
            each(message)
            when (message) {
                is ServerTickEnd -> seen++
                is UpdateInvFull -> if (message.inventoryId == BANK_INV) bank = message.objs.map { it.id }.filter { it >= 0 }
                is VarpSmall -> varps[message.id] = message.value
                is VarpLarge -> varps[message.id] = message.value
            }
        }
        return bank ?: if (allowNone) emptyList() else error("no bank update")
    }

    private companion object {
        const val LOGIN_TICKS = 6
        const val TICKS = 3
        const val BANK = 12
        const val ITEMS = 12
        const val TABS = 10
        const val TAB_1 = 11
        const val BANK_INV = 95
        const val NO_OBJ = 0xFFFF
        const val TAB_1_SIZE = 4171
        const val DEPOSIT_INVENTORY = 47

        /** A bronze axe and dagger. */
        val SEED_ITEMS = listOf(1351, 1205)

        /** tsps's drop slot for the empty space after the main tab's items: 1410 + 9 × 2 + tab 0. */
        const val MAIN_TAB_DROP = 1428
    }
}
