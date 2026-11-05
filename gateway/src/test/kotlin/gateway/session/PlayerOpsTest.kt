package gateway.session

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** Trade with is the client's option 4, as on live, while tsps trades on 2. */
class PlayerOpsTest {
    @Test
    fun `the chatbox's trade click reaches tsps as its trade option`() {
        // Scripts 84, 86 and 7822 send OPPLAYER4 for "Accept trade".
        assertEquals(2, PlayerOps.toTsps(4))
        assertEquals(4, PlayerOps.toClient(2))
    }

    @Test
    fun `tsps's option 4 shows on the client's 2 and comes back as 4`() {
        assertEquals(2, PlayerOps.toClient(4))
        assertEquals(4, PlayerOps.toTsps(2))
    }

    @Test
    fun `the other options keep their number`() {
        for (op in listOf(1, 3, 5, 6, 7, 8)) {
            assertEquals(op, PlayerOps.toClient(op))
            assertEquals(op, PlayerOps.toTsps(op))
        }
    }
}
