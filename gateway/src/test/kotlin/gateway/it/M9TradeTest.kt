package gateway.it

import gateway.headless.HeadlessClient
import net.rsprox.protocol.game.outgoing.model.interfaces.IfOpenSub
import net.rsprox.protocol.game.outgoing.model.inv.UpdateInvFull
import net.rsprox.protocol.game.outgoing.model.map.RebuildLoginV2
import net.rsprox.protocol.game.outgoing.model.misc.client.ServerTickEnd
import net.rsprox.protocol.game.outgoing.model.misc.player.MessageGame
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** M9: a trade between two official clients, and the character designer's packet. */
class M9TradeTest {
    @Test
    fun `two clients trade through the real trade interfaces`() {
        LiveGateway.login(LiveGateway.newAccount("gwtra")).use { first ->
            first.expect<RebuildLoginV2>()
            LiveGateway.login(LiveGateway.newAccount("gwtrb")).use { second ->
                second.expect<RebuildLoginV2>()
                // New accounts start in the character designer, which keeps them busy until
                // a design is confirmed (and only once it has opened).
                first.ticks(SETTLE_TICKS)
                second.ticks(SETTLE_TICKS)
                // The official client confirms with the designer's Confirm button.
                first.button(DESIGNER, CONFIRM)
                second.button(DESIGNER, CONFIRM)
                second.ticks(SETTLE_TICKS)
                first.ticks(SETTLE_TICKS)

                // One asks with Trade with, the other clicks the request in the chatbox: both send
                // OPPLAYER4, and tsps opens the offer screen for both.
                second.playerOp4(first.index)
                first.until { it is MessageGame && it.message.contains("wishes to trade") }
                first.playerOp4(second.index)
                // The offers arrive as inventory 90, the other player's as 90 | 0x8000; rsprot
                // may flush them ahead of the interface in the same tick.
                first.untilAll(
                    { it is IfOpenSub && it.interfaceId == OFFER_INTERFACE },
                    { it is UpdateInvFull && it.inventoryId == (OFFER_INVENTORY or INV_OTHER) },
                )
                second.expectOpen(OFFER_INTERFACE)
                first.ticks(BUTTON_DELAY_TICKS)
                second.ticks(BUTTON_DELAY_TICKS)

                first.button(OFFER_INTERFACE, ACCEPT)
                second.button(OFFER_INTERFACE, ACCEPT)
                first.expectOpen(CONFIRM_INTERFACE)
                second.expectOpen(CONFIRM_INTERFACE)
                // tsps ignores trade buttons for a second after a screen opens (Trading button_delay).
                first.ticks(BUTTON_DELAY_TICKS)
                second.ticks(BUTTON_DELAY_TICKS)

                first.button(CONFIRM_INTERFACE, CONFIRM_ACCEPT)
                second.button(CONFIRM_INTERFACE, CONFIRM_ACCEPT)
                val done = first.until { it is MessageGame && it.message.contains("accepted", ignoreCase = true) }
                assertEquals("Trade accepted!", (done as MessageGame).message)
            }
        }
    }

    @Test
    fun `the character designer's packet doesn't disconnect the client`() {
        LiveGateway.login(LiveGateway.newAccount("gwdes")).use { game ->
            game.expect<RebuildLoginV2>()
            game.updatePlayerModel(ByteArray(PLAYER_MODEL_SIZE))
            // rsprot 241 has no decoder for it; without the gateway's, the client is dropped.
            game.ticks(SETTLE_TICKS)
        }
    }

    private fun HeadlessClient.Game.ticks(count: Int) {
        var seen = 0
        while (seen < count) if ((next() ?: error("stream ended")) is ServerTickEnd) seen++
    }

    private fun HeadlessClient.Game.until(matches: (Any) -> Boolean): Any {
        val messages = ArrayList<String>()
        repeat(PACKETS) {
            val message = next() ?: error("stream ended; game messages: $messages")
            if (message is MessageGame) messages += message.message
            if (matches(message)) return message
        }
        error("no matching packet; game messages: $messages")
    }

    private fun HeadlessClient.Game.untilAll(vararg wanted: (Any) -> Boolean) {
        val missing = wanted.toMutableList()
        repeat(PACKETS) {
            val message = next() ?: error("stream ended")
            missing.removeAll { it(message) }
            if (missing.isEmpty()) return
        }
        error("${missing.size} expected packets never arrived")
    }

    private fun HeadlessClient.Game.expectOpen(group: Int) = until { it is IfOpenSub && it.interfaceId == group }

    private companion object {
        const val SETTLE_TICKS = 4
        const val BUTTON_DELAY_TICKS = 3
        const val PACKETS = 5_000
        const val OFFER_INTERFACE = 335
        const val CONFIRM_INTERFACE = 334
        const val ACCEPT = 10
        const val CONFIRM_ACCEPT = 13
        const val OFFER_INVENTORY = 90
        const val INV_OTHER = 0x8000
        const val PLAYER_MODEL_SIZE = 26
        const val DESIGNER = 679
        const val CONFIRM = 74

        /** A male design in the layout the gateway tries first: body, 7 × u16 kits, 5 × u16 colours, 1 byte. */
        val DEFAULT_DESIGN =
            java.nio.ByteBuffer.allocate(PLAYER_MODEL_SIZE).apply {
                put(0)
                intArrayOf(0, 10, 18, 26, 33, 36, 42).forEach { putShort(it.toShort()) }
                repeat(5) { putShort(0) }
                put(0)
            }.array()
    }
}
