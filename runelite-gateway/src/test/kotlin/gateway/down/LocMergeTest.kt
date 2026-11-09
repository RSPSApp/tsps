package gateway.down

import gateway.coverage.DropCounter
import gateway.tsps.TspsCodec
import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import net.rsprot.protocol.message.OutgoingGameMessage
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Revision 242's client reads LOC_MERGE and discards its 14 bytes (rsprot and RSProx have no
 * layout for it), so the gateway consumes TSPS merges and sends nothing, in the scene or on a deck.
 */
class LocMergeTest {
    private val sent = ArrayList<OutgoingGameMessage>()
    private val world = World({ sent += it }).apply { rebuild(X shr 3, Z shr 3) }

    @Test
    fun `a merge in the scene is consumed and counted, never sent`() {
        val packet = TspsCodec.split(merge().fixed(TspsServerPacket.LOC_MERGE)).single()
        assertEquals(18, packet.payload.size)
        val before = DropCounter.snapshot()["down:$LOC_MERGE"] ?: 0
        assertTrue(world.handle(packet))
        world.flushZones()
        assertTrue(sent.isEmpty())
        assertEquals(before + 1, DropCounter.snapshot()["down:$LOC_MERGE"])
    }

    @Test
    fun `a deck merge is consumed and never sent`() {
        val deck = gateway.session.WorldEntities.Deck(3000, 1, 1, 1, 1, 1200, 1200, arrayOfNulls(4 * 13 * 13))
        val boats = World({ sent += it }, deckAt = { x, z -> deck.takeIf { it.contains(x, z) } })
        assertTrue(boats.handle(TspsPacket(LOC_MERGE, merge((1200 shl 3) + 3, (1200 shl 3) + 5).body())))
        boats.flushZones()
        boats.flushDeck(1)
        assertTrue(sent.isEmpty())
    }

    private fun merge(x: Int = X, z: Int = Z) = TspsWriter()
        .u16(30962).u16(x).u16(z).u8(1).u8((10 shl 2) or 3)
        .u16(1966).u16(0).u16(60).u8(1).u8(0).u8(-1).u8(0)

    private companion object {
        const val LOC_MERGE = 138
        const val X = 3760
        const val Z = 10277
    }
}
