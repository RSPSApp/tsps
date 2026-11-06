package gateway.down

import gateway.tsps.TspsReader
import gateway.tsps.TspsWriter
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class ChatTest {
    @Test
    fun `the mod icon comes from the name's img tag`() {
        assertEquals(2, TspsChatMessage("hi", 2, "<img=1>Admin", "", 1).modIcon)
        assertEquals(0, TspsChatMessage("hi", 2, "Player", "", 1).modIcon)
    }

    @Test
    fun `a chat style is read only within tsps's ranges`() {
        val pattern = ChatStyle.read(reader(TspsWriter().u8(14).u8(5).u8(1).u8(2)))!!
        assertEquals(14 to 5, pattern.colour to pattern.effect)
        assertEquals(listOf<Byte>(1, 2), pattern.pattern!!.toList())
        // Trailing bytes that aren't a style aren't taken for one.
        assertNull(ChatStyle.read(reader(TspsWriter().u8(200).u8(0).u8(0))))
        assertNull(ChatStyle.read(reader(TspsWriter().u8(1).u8(6))))
    }

    private fun reader(writer: TspsWriter) = TspsReader(writer.body())
}
