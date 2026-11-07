package gateway.down

import gateway.cache.Cache
import gateway.cache.EnumTypes
import gateway.cache.VarTypes
import gateway.config.GatewayConfig
import gateway.session.InterfaceTree
import gateway.session.VarpMirror
import gateway.tsps.TspsCodec
import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsWriter
import net.rsprot.protocol.game.outgoing.interfaces.IfSetRotateSpeed
import net.rsprot.protocol.message.OutgoingGameMessage
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** IF_SETROTATESPEED: uid then high signed16 y speed and low signed16 x speed (recording 1723). */
class InterfacesRotateSpeedTest {
    private val cache = Cache.open(GatewayConfig.load().cacheDirectory)
    private val sent = ArrayList<OutgoingGameMessage>()
    private val interfaces =
        Interfaces(VarpMirror(VarTypes(cache)), InterfaceTree(EnumTypes(cache)), StockMarket { sent += it }, {}, { true }, { sent += it })

    @Test
    fun `the capture payload keeps its y high and x low alignment`() {
        // uid 533:8 and x=0, y=5, as recorded from rev 227.
        interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_SET_ROTATE_SPEED, byteArrayOf(0x02, 0x15, 0x00, 0x08, 0x00, 0x05, 0x00, 0x00)))
        val speed = sent.single() as IfSetRotateSpeed
        assertEquals((533 shl 16) or 8, speed.combinedId)
        assertEquals(0 to 5, speed.xSpeed to speed.ySpeed)
    }

    @Test
    fun `the length registry splits an eight byte payload`() {
        val packets = TspsCodec.split(byteArrayOf(TspsServerPacket.WIDGET_SET_ROTATE_SPEED.toByte()) + payload(3, 5))
        assertEquals(1, packets.size)
        assertEquals(8, packets.single().payload.size)
    }

    @Test
    fun `signed x and y decode at both ends of the short range`() {
        interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_SET_ROTATE_SPEED, payload(-32768, 32767)))
        interfaces.handle(TspsPacket(TspsServerPacket.WIDGET_SET_ROTATE_SPEED, payload(-1, -1)))
        val (low, high) = sent.map { it as IfSetRotateSpeed }
        assertEquals(32768 to 32767, low.xSpeed to low.ySpeed)
        assertEquals(65535 to 65535, high.xSpeed to high.ySpeed)
    }

    private fun payload(xSpeed: Int, ySpeed: Int) =
        TspsWriter().i32(UID).i32((ySpeed and 0xFFFF) shl 16 or (xSpeed and 0xFFFF)).body()

    private companion object {
        const val UID = (533 shl 16) or 8
    }
}
