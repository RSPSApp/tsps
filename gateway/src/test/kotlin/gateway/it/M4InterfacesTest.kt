package gateway.it

import gateway.headless.HeadlessClient
import net.rsprox.protocol.game.outgoing.model.interfaces.IfOpenSub
import net.rsprox.protocol.game.outgoing.model.logout.Logout
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import net.rsprox.protocol.game.outgoing.model.misc.client.ServerTickEnd
import net.rsprox.protocol.game.outgoing.model.misc.player.UpdateStatV2
import net.rsprox.protocol.game.outgoing.model.varp.VarpLarge
import net.rsprox.protocol.game.outgoing.model.varp.VarpSmall
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import gateway.cache.InterfaceComponents
import gateway.cache.VarTypes
import gateway.headless.TestCache
import org.junit.jupiter.api.Test

/** M4: the gameframe, stats and varps after login, the run orb and the logout button. */
class M4InterfacesTest {
    private val modulus = LiveGateway.gateway.rsa.modulus

    @Test
    fun `login mounts the gameframe and sends stats and varps`() {
        login().use { game ->
            game.expect<RebuildLoginV2>()
            val messages = game.until(TICKS)
            val mounted = messages.filterIsInstance<IfOpenSub>().map { it.interfaceId }.toSet()
            assertTrue(INVENTORY in mounted && EQUIPMENT in mounted && SKILLS in mounted, "mounted $mounted")
            assertTrue(messages.filterIsInstance<UpdateStatV2>().size >= SKILL_COUNT)
            assertTrue(messages.any { it is VarpSmall || it is VarpLarge })
        }
    }

    @Test
    fun `login only touches components the client has`() {
        // The official client throws on a widget message for a component it doesn't have (tsps
        // still sends some 317-style flat ids); the headless client doesn't check, so this does.
        val components = InterfaceComponents(TestCache.cache)
        login().use { game ->
            val missing =
                game.until(TICKS).mapNotNull { message ->
                    val ids = message.javaClass.methods.associateBy { it.name }
                    val group = ids["getInterfaceId"]?.takeIf { message !is IfOpenSub } ?: return@mapNotNull null
                    val component = ids["getComponentId"] ?: return@mapNotNull null
                    val at = group.invoke(message) as Int to component.invoke(message) as Int
                    // -1:-1 is an inventory with no component, which is valid.
                    if (at.first == -1 || components.exists(at.first, at.second)) null else "${message.javaClass.simpleName} ${at.first}:${at.second}"
                }
            assertEquals(emptyList<String>(), missing)
        }
    }

    @Test
    fun `the chatbox shows the player's name`() {
        login().use { game ->
            game.expect<RebuildLoginV2>()
            // Script 223 writes "You must set a name before you can chat." unless this is 1.
            val bit = requireNotNull(VarTypes(TestCache.cache).varbit(NAME_SET_VARBIT))
            val value =
                game.until(TICKS).mapNotNull {
                    when (it) {
                        is VarpSmall -> if (it.id == bit.varp) it.value else null
                        is VarpLarge -> if (it.id == bit.varp) it.value else null
                        else -> null
                    }
                }.lastOrNull()
            assertEquals(1, value?.let { (it ushr bit.lsb) and 1 }, "varp ${bit.varp} = $value")
        }
    }

    @Test
    fun `the run orb toggles run`() {
        login().use { game ->
            game.expect<RebuildLoginV2>()
            val before = game.until(TICKS).lastRunVarp() ?: 0
            game.button(ORBS, RUN_ORB)
            assertEquals(1 - before, game.until(TICKS).lastRunVarp())
        }
    }

    @Test
    fun `the logout button logs out`() {
        login().use { game ->
            game.expect<RebuildLoginV2>()
            game.until(TICKS)
            game.button(LOGOUT_TAB, LOGOUT_BUTTON)
            game.expect<Logout>(limit = 2_000)
        }
    }

    @Test
    fun `native quest row identities open the matching journal instead of dense browser neighbours`() {
        login().use { game ->
            game.until(TICKS)
            for ((nativeSlot, title) in listOf(16 to "Pirate's Treasure", 55 to "Elemental Workshop I")) {
                game.button(399, 7, op = 2, sub = nativeSlot)
                val messages = game.until(TICKS)
                val titles = messages.filterIsInstance<net.rsprox.protocol.game.outgoing.model.interfaces.IfSetText>()
                    .filter { it.interfaceId == 119 || it.interfaceId == 782 }
                    .map { it.text }
                assertTrue(titles.any { title in it }, "native row $nativeSlot expected $title; got $titles")
            }
        }
    }

    @Test
    fun `native quest events and map wiki ops use stock packet semantics`() {
        login().use { game ->
            val startup = game.until(TICKS)
            val definitions = VarTypes(TestCache.cache)
            fun bit(id: Int): Int {
                val type = requireNotNull(definitions.varbit(id))
                val value = startup.mapNotNull {
                    when (it) {
                        is VarpSmall -> if (it.id == type.varp) it.value else null
                        is VarpLarge -> if (it.id == type.varp) it.value else null
                        else -> null
                    }
                }.lastOrNull() ?: 0
                return (value ushr type.lsb) and type.mask
            }
            assertEquals(343, bit(1782), "native cache maximum QP")
            assertEquals(184, bit(11877), "native main quest total")
            assertEquals(0, bit(6347), "fresh native main completion count")
            assertEquals(0, bit(13987), "fresh native subquest completion count")
            assertEquals(0, bit(14162), "fresh native miniquest completion count")
            val events = startup
                .filterIsInstance<net.rsprox.protocol.game.outgoing.model.interfaces.IfSetEventsV2>()
                .last { it.interfaceId == 399 && it.componentId == 7 }
            assertEquals(0, events.start)
            assertEquals(217, events.end)
            assertEquals(31, events.events2, "live OP1–5; dormant Pin OP6 stays disabled")
            game.button(399, 7, op = 5, sub = 201)
            val wiki = game.until(TICKS)
                .filterIsInstance<net.rsprox.protocol.game.outgoing.model.misc.player.RunClientScript>()
                .single { it.id == 3300 }
            assertEquals(listOf("Search", "", "", "", "Scrambled!/Quick guide"), wiki.values)
            game.button(399, 7, op = 3, sub = 16)
            val map = game.until(TICKS)
                .filterIsInstance<net.rsprox.protocol.game.outgoing.model.misc.player.RunClientScript>()
                .single { it.id == 3331 }
            assertEquals((595 shl 16) or 3, map.values[0])
            assertEquals(3, map.values.size)
        }
    }

    private fun login(): HeadlessClient.Game {
        val result = LiveGateway.client().login(LiveGateway.newAccount("gwui"), PASSWORD, modulus)
        assertEquals(OK, result.code)
        return result.game!!
    }

    /** Every packet up to and including the [ticks]th SERVER_TICK_END. */
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

    private fun List<Any>.lastRunVarp(): Int? = filterIsInstance<VarpSmall>().lastOrNull { it.id == RUN_VARP }?.value

    private companion object {
        const val NAME_SET_VARBIT = 8119
        const val PASSWORD = "gateway-test"
        const val OK = 2
        const val TICKS = 4
        const val INVENTORY = 149
        const val EQUIPMENT = 387
        const val SKILLS = 320
        const val SKILL_COUNT = 23
        const val ORBS = 160
        const val RUN_ORB = 28
        const val RUN_VARP = 173
        const val LOGOUT_TAB = 182
        const val LOGOUT_BUTTON = 8
    }
}
