package gateway.session

/**
 * The official client's player options against tsps's. Clicking a trade request in the chatbox
 * (scripts 84, 86 and 7822) sends OPPLAYER4 for the player who asked, live's Trade with; tsps
 * trades on option 2 and puts the Duel Arena's Challenge on 4. The gateway swaps 2 and 4 both
 * ways, so Trade with is option 4 as on live, and Challenge shows on 2.
 */
object PlayerOps {
    /** The client's option for tsps's PLAYER_OPTION slot. */
    fun toClient(tspsOp: Int): Int = swap(tspsOp)

    /** tsps's option for the client's OPPLAYER. */
    fun toTsps(clientOp: Int): Int = swap(clientOp)

    private fun swap(op: Int): Int =
        when (op) {
            TSPS_TRADE -> CLIENT_TRADE
            CLIENT_TRADE -> TSPS_TRADE
            else -> op
        }

    private const val TSPS_TRADE = 2
    private const val CLIENT_TRADE = 4
}
