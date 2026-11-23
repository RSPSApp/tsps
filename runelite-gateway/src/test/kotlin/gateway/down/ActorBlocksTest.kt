package gateway.down

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ActorBlocksTest {
    @Test
    fun `an npc tint is read in the npc block's byte order`() {
        // tsps writeNpcUpdateBlock: say text, then the tint (start/end shortBEA, hue byteC,
        // saturation byteS, lightness byteC, weight byteS), then the spot anim count.
        val tint = byteArrayOf(0, (0 + 128).toByte(), 0, (50 + 128).toByte(), (-21).toByte(), (128 - 5).toByte(), 1, (128 - 90).toByte())
        val block = ActorBlocks.npcTint(BlockReader(tint))
        assertEquals(listOf(0, 50, 21, 5, 255, 90), listOf(block.start, block.end, block.hue, block.saturation, block.lightness, block.weight))
    }

    @Test
    fun `an npc type customisation reads its flagged fields`() {
        // tsps writeTypeCustomisation: flags, u8 count + u16 models, u8 count + u16 from/to pairs,
        // a null-terminated name, a u16 level (live's Echo Hunllef, rsprox 1158).
        val name = "Corrupted Hunllef (Echo)".toByteArray(Charsets.ISO_8859_1).map { it.toInt() and 0xFF }
        val bytes = (listOf(0x0F, 1, 60373 shr 8, 60373 and 0xFF, 1, 0, 10, 0, 20) + name + listOf(0, 1117 shr 8, 1117 and 0xFF))
            .map { it.toByte() }.toByteArray()
        val custom = ActorBlocks.typeCustomisation(BlockReader(bytes))
        assertEquals(listOf(60373), custom.models)
        assertEquals(listOf(10 to 20), custom.recolours)
        assertEquals("Corrupted Hunllef (Echo)", custom.name)
        assertEquals(1117, custom.combatLevel)

        val nameOnly = ActorBlocks.typeCustomisation(BlockReader((listOf(0x04) + name + listOf(0)).map { it.toByte() }.toByteArray()))
        assertEquals(listOf(null, null, null), listOf(nameOnly.models, nameOnly.recolours, nameOnly.combatLevel), "only the flagged fields")
        assertEquals(true, ActorBlocks.typeCustomisation(BlockReader(byteArrayOf(0))).isReset, "no flags resets")
    }

    @Test
    fun `an npc face angle after a type customisation is read and leaves the stream aligned`() {
        // tsps writeNpcUpdateBlock for the Hueycoatl's hidden tail: mask 0x40000 | 0x80000 (three
        // mask bytes), the type customisation (models flag, one model 0xffff), then the face angle
        // (u16 512, instant 1). A trailing byte stands for the next NPC's block.
        val bytes = listOf(0x80, 0x40, 0x0C, 0x01, 1, 0xFF, 0xFF, 512 shr 8, 512 and 0xFF, 1, 0x7A)
            .map { it.toByte() }.toByteArray()
        val reader = BlockReader(bytes)
        val block = ActorBlocks.npc(reader)
        assertEquals(listOf(0xFFFF), block.typeCustomisation?.models)
        assertEquals(512 to true, block.faceAngle)
        assertEquals(0x7A, reader.u8(), "the next block starts right after the face angle")

        val turning = ActorBlocks.npc(BlockReader(listOf(0x80, 0x40, 0x08, 1536 shr 8, 1536 and 0xFF, 0).map { it.toByte() }.toByteArray()))
        assertEquals(1536 to false, turning.faceAngle)
    }

    @Test
    fun `a chat style reads its pattern colours`() {
        val style = ChatStyle.read(gateway.tsps.TspsReader(byteArrayOf(14, 2, 3, 4)))!!
        assertEquals(14 to 2, style.colour to style.effect)
        assertEquals(listOf<Byte>(3, 4), style.pattern!!.toList())
        assertEquals(null, ChatStyle.read(gateway.tsps.TspsReader(byteArrayOf())), "builds that send none")
    }

    @Test
    fun `appearance splits identkits from objs at 2048 like the native client`() {
        // Body type B jaw kit 292 is 548 on the wire, inside the native kit range 256..2047;
        // obj 1163 (rune full helm) is 1163 + 2048.
        val slot = { v: Int -> if (v == 0) listOf(0) else listOf(v shr 8, v and 0xFF) }
        val slots = (0 until 12).flatMap { slot(when (it) { 0 -> 1163 + 2048; 11 -> 292 + 256; else -> 0 }) }
        val bytes = (listOf(1, 0xFF, 0xFF) + slots + slots + List(5) { 0 } + List(14) { 0xFF } + listOf('A'.code, 0, 3, 0, 32, 0, 0, 0, 0, 0, 0, 1))
            .map { it.toByte() }.toByteArray()
        val block = ActorBlocks.appearance(BlockReader(bytes))
        assertEquals(1163, block.objs[0])
        assertEquals(292, block.kits[11])
        assertEquals(-1, block.objs[11])
    }

    @Test
    fun `the movement flag keeps a temporary walk apart from a placement`() {
        // tsps encodePlayerSync: mask 0x2000 (extended, so 0x80 then 0x20), then byteS(type).
        // 1 is a step forced to walk (Darkness of Hallowvale's washing line, issue 6639): before,
        // every value read as a placement, so RuneLite snapped the player two tiles a step.
        val walk = ActorBlocks.player(BlockReader(byteArrayOf(0x80.toByte(), 0x20, (128 - 1).toByte())))
        assertEquals(1, walk.temporaryMoveSpeed)
        assertEquals(false, walk.resetPath)
        val placement = ActorBlocks.player(BlockReader(byteArrayOf(0x80.toByte(), 0x20, (128 - 127).toByte())))
        assertEquals(null, placement.temporaryMoveSpeed)
        assertEquals(true, placement.resetPath)
    }
}
