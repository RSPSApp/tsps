package gateway.it

import gateway.headless.HeadlessClient
import net.rsprox.protocol.game.outgoing.model.interfaces.IfCloseSub
import net.rsprox.protocol.game.outgoing.model.interfaces.IfMoveSub
import net.rsprox.protocol.game.outgoing.model.interfaces.IfOpenSub
import net.rsprox.protocol.game.outgoing.model.interfaces.IfOpenTop
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Returning accounts log in to the welcome screen, laid out as live; its play button needs IF_BUTTONX to reach tsps. */
class WelcomeScreenTest {
    private val modulus = LiveGateway.gateway.rsa.modulus

    @Test
    fun `play on the welcome screen opens the gameframe`() = leaveWelcomeScreen("gwplay") { it.button(WELCOME_SCREEN, PLAY_BUTTON) }

    /** Live opens it as a modal, so Escape closes it in the client; that has to count as Play. */
    @Test
    fun `escape on the welcome screen opens the gameframe`() = leaveWelcomeScreen("gwesc") { it.closeModal() }

    private fun leaveWelcomeScreen(prefix: String, leave: (HeadlessClient.Game) -> Unit) {
        val name = LiveGateway.newAccount(prefix)
        LiveGateway.client().login(name, PASSWORD, modulus).game!!.use { it.expect<RebuildLoginV2>() }

        // tsps saves the account and frees the name a few ticks after the socket closes.
        val game =
            generateSequence { LiveGateway.client().login(name, PASSWORD, modulus) }
                .take(RELOGIN_ATTEMPTS)
                .onEach { if (it.code != OK) Thread.sleep(RELOGIN_WAIT_MS) }
                .first { it.code == OK }
                .game!!
        game.use {
            // As live: the login root (165) with the gameframe moved onto it, and the welcome screen
            // as a modal in its slot; never the welcome screen as the root. tsps mounts the gameframe
            // first; the login burst before carries every plugin's restored state.
            var moved = 0
            var welcome: IfOpenSub? = null
            while (welcome == null) {
                when (val message = it.next() ?: error("stream ended")) {
                    is IfOpenTop -> assertNotEquals(WELCOME_SCREEN, message.interfaceId, "the welcome screen as the root")
                    is IfMoveSub -> moved++
                    is IfOpenSub -> if (message.interfaceId == WELCOME_SCREEN) welcome = message
                }
            }
            assertEquals(LOGIN_ROOT to WELCOME_SLOT, welcome.destinationInterfaceId to welcome.destinationComponentId)
            assertTrue(moved > 0, "the gameframe moves onto the login root")

            leave(it)
            val closed = it.expect<IfCloseSub>(limit = 2_000)
            assertEquals(LOGIN_ROOT to WELCOME_SLOT, closed.interfaceId to closed.componentId)
            assertNotEquals(LOGIN_ROOT, it.expect<IfOpenTop>(limit = 10).interfaceId, "Play leaves the login root")
            assertTrue(it.next() is IfMoveSub, "and moves the gameframe back")
        }
    }

    private companion object {
        const val PASSWORD = "gateway-test"
        const val LOGIN_PACKETS = 10_000
        const val OK = 2
        const val WELCOME_SCREEN = 378
        const val PLAY_BUTTON = 72
        const val LOGIN_ROOT = 165
        const val WELCOME_SLOT = 40
        const val RELOGIN_ATTEMPTS = 20
        const val RELOGIN_WAIT_MS = 1_000L
    }
}
