import { Client, ServerError } from "@colyseus/core";
import { ROOKIE_RATING, standInFor } from "../bots";
import { gameConfig } from "../gameConfig";
import { DEFAULT_RATING, RankedSide, fetchRating, reportRankedResult, verifyAccount } from "../rankedResults";
import { SnakeRoom } from "./SnakeRoom";

export { ROOKIE_RATING };

/** Who sat in the match: a seated Account, or the Stand-in. */
type Seat = { playerId: string; accountId?: string };

/** The Stand-in that sat down: its roster id and fixed Rating. */
type StandIn = { id: string; rating: number };

/**
 * A Ranked match, and the queue for it: a timed 1v1 at the default speed
 * whatever the client asks for, open only to Accounts. It never starts on a
 * player's request: a lone Account who waits `gameConfig.standInWaitMs` plays
 * the rated bot closest to their Rating as a Stand-in, and the result goes to go-server.
 */
export class RankedRoom extends SnakeRoom {
  maxClients = 2;
  protected startsOnRequest = false;

  // Server-only: the Account behind each seated session, from the join token.
  private accounts = new Map<string, string>();

  // Server-only: who plays this match, fixed when the round is dealt.
  private seats: Seat[] = [];

  // Server-only: the session that left mid-match, if any.
  private forfeitedId?: string;

  // Server-only: the Stand-in that sat down, if any.
  private standIn?: StandIn;

  private standInTimer?: { clear(): void };

  onCreate() {
    // Every option is ignored: a ranked room's rules are fixed, not the client's to pick.
    super.onCreate({ mode: "timed" });
  }

  async onAuth(client: Client, options: any) {
    const accountId = await verifyAccount(options?.token);
    if (!accountId) throw new ServerError(401, "Ranked needs an account");
    // Another tab or device of a seated Account: nobody plays themselves.
    if ([...this.accounts.values()].includes(accountId)) throw new ServerError(409, "Already in this ranked match");
    return { accountId };
  }

  onJoin(client: Client, options: any) {
    this.accounts.set(client.sessionId, client.auth.accountId);
    super.onJoin(client, options);
    if (this.state.phase === "lobby" && !this.standInTimer) {
      this.standInTimer = this.clock.setTimeout(() => this.seatStandIn(), gameConfig.standInWaitMs);
    }
  }

  onLeave(client: Client) {
    // Leaving once the snakes are dealt is a Forfeit, even in the countdown.
    if (this.seats.some((seat) => seat.playerId === client.sessionId)) this.forfeitedId ??= client.sessionId;
    super.onLeave(client);
  }

  /**
   * The wait is up: if one Account is still alone, the room locks and the
   * rated bot closest to its Rating sits down, then the countdown starts.
   */
  private async seatStandIn() {
    if (this.state.phase !== "lobby" || this.state.players.length !== 1) return;
    // Locked first, so nobody joins while go-server is asked for the Rating.
    this.lock();
    const accountId = this.accounts.get(this.state.players[0].id);
    const rating = accountId === undefined ? DEFAULT_RATING : await fetchRating(accountId);
    // The Account may have left while go-server was asked.
    if (this.state.phase !== "lobby" || this.state.players.length !== 1) return;
    const entry = standInFor(rating);
    this.standIn = { id: entry.id, rating: entry.rating ?? ROOKIE_RATING };
    this.seatBot(entry);
    this.startCountdown();
  }

  protected roundDealt() {
    this.standInTimer?.clear();
    this.seats = this.state.players.map((p) => ({ playerId: p.id, accountId: this.accounts.get(p.id) }));
  }

  protected roundOver(winnerId?: string) {
    const [a, b] = this.seats;
    if (!a || !b) return;
    const side = (seat: Seat): RankedSide =>
      seat.accountId !== undefined
        ? { accountId: seat.accountId }
        : { standInId: this.standIn?.id ?? "rookie", rating: this.standIn?.rating ?? ROOKIE_RATING };
    // A leaver loses, whatever the engine scored; otherwise the engine's winner stands.
    const winner = this.forfeitedId !== undefined
      ? this.seats.find((seat) => seat.playerId !== this.forfeitedId)?.playerId
      : winnerId;
    void reportRankedResult({
      resultId: this.roomId,
      a: side(a),
      b: side(b),
      outcome: winner === undefined ? "draw" : winner === a.playerId ? "a" : "b",
      forfeit: this.forfeitedId !== undefined
    }).then((response) => {
      if (response) this.broadcast(SnakeRoom.messageTypes.RATING_UPDATE, { players: response.players });
    });
  }
}
