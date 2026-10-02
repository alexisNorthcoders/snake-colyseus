## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues on alexisNorthcoders/snake-colyseus, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human and wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Adding a snake to the roster

A snake is two JSON files, and no code:

- its brain, `src/bots/brains/<file>.json`, in the brain format (`Brain` in `src/bots/brain.ts`)
- its entry, `src/bots/entries/<file>.json`, by convention named after its id: `{ "id", "name", "personality"?, "generation", "method", "brain": "<file>.json" }`, where `brain` names the file in `brains/`

`loadRoster` (`src/bots/roster.ts`) reads them at start-up, after the rookie and in the order of the entries' file names, and skips any it can't use with a logged error (fields it doesn't know only get a warning). `tsconfig.json` includes both folders, so the build ships them. It's a change under `src/bots/`, so bump `engineVersion` (below): a patch, as it adds no export.

## Reporting vs-bot rounds

A private vs-bot room reports each round that reaches play to go-server: `POST <API_URL>/bot-results` with `Authorization: Bearer <BOT_RESULTS_SECRET>` and `{ resultId, botId, mode, delay, outcome }` (`outcome` from the bot's side: `win`, `loss` or `draw`; a human leaving mid-round is a bot win; leaving in the lobby or countdown reports nothing; public rooms never report). See `src/botResults.ts`.

- `API_URL` defaults to `http://localhost:8080`. `BOT_RESULTS_SECRET` has no default: without it nothing is sent, and start-up logs that once. `ecosystem.config.cjs` passes both to production.
- Fire and forget, 3 s timeout, no retries: a failure is logged with the result and dropped, and never affects the room.

## Tagging the engine and bots

Other repos install the package from GitHub at a tag (`github:alexisNorthcoders/snake-colyseus#engine-vX.Y.Z`) and import `snake-colyseus/engine` and `snake-colyseus/bots`. npm's `prepare` hook builds both on install; `build/` is never committed. Both share the one `engine-vX.Y.Z` tag series.

The next tag's version is `engineVersion` in `package.json`. Bump it in your PR whenever anything under `src/engine/` or `src/bots/` changes:

- **major**: a rules change (`RULES_VERSION` bumped) or a breaking API change
- **minor**: an added export
- **patch**: a fix that changes neither

Once the PR is merged, CI (`.github/workflows/tag-engine.yml`) tags that `master` commit `engine-v<engineVersion>`. If the tag already exists it does nothing, so a merge that doesn't bump it cuts no tag. On pull requests, `.github/workflows/engine-version.yml` fails if engine or bots files changed but `engineVersion` didn't, and says what to bump it to.

Never tag by hand, and never tag a branch: CI owns the tags. See them at https://github.com/alexisNorthcoders/snake-colyseus/tags, or with `git fetch --tags && git tag --list 'engine-v*' --sort=-v:refname`.

## Ranked matches

The `ranked` room (`src/rooms/RankedRoom.ts`) is the Ranked queue: Accounts only (`onAuth` checks `options.token` with go-server's `/verify-token`), timed at the default speed, 2 seats, never started by a Start message. After `gameConfig.standInWaitMs` (20 s) with one Account seated, the rookie sits down as the Stand-in. At the end it reports to `POST <API_URL>/ranked-results` (same `BOT_RESULTS_SECRET`), retrying with backoff, then sends each client a `ratingUpdate` message with go-server's answer. See `src/rankedResults.ts`. It adds no export under `src/engine/` or `src/bots/`, so `engineVersion` stays.
