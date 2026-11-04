# Turns are queued, two deep, one applied per tick

A snake used to keep only the last turn it received each tick, so two quick turns inside one tick (a swipe-made U, or fast key presses) lost the first one. We now queue up to two turns per snake and apply one per tick. Each incoming turn is checked against the last *queued* direction (a repeat or reversal is dropped), and a turn arriving with the queue full is dropped, not replaced, so mashing never rewrites an intent the snake already accepted. This changes input handling for every player and for Ranked alike. It is the same rule for everyone, so Ranked stays fair. Bots turn once per tick and are unaffected.

## Considered Options

- **Last turn wins (status quo):** loses turns, worst on touchscreens, where a swipe takes longer than a key press.
- **Client-side buffer:** keeps the server untouched, but the client would have to time its sends against server patches, and every client would need its own copy of the rule.
