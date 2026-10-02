# snake-colyseus

The multiplayer game server: rooms, the engine's rules, the bots, and reporting results to go-server.

## Language

**Casual match**: a match in a `snake` room: any mode, any speed, up to 4 players, nothing at stake.
**Ranked match**: a 1v1 timed match at the default speed in a `ranked` room. Its result changes both players' Rating.
**Ranked queue**: the `ranked` room itself, which is joined with `joinOrCreate`. It never starts on a player's request.
**Account**: a registered user. Only Accounts may join a Ranked match.
**Guest**: someone playing with an anonymous token. Refused by the `ranked` room.
**Rating**: an Account's Glicko-2 skill estimate, 1500 by default. Held by go-server, never here.
**Provisional**: a Rating based on fewer than 5 Ranked matches.
**Stand-in**: a roster bot that plays a Ranked match in place of a human, when an Account has waited 20 seconds alone. Its Rating is fixed and never stored or changed.
**Forfeit**: leaving a Ranked match once it is dealt. It is a loss for the leaver.
