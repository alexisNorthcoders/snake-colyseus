## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues on alexisNorthcoders/snake-colyseus, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human and wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Tagging the engine and bots

Other repos install the package from GitHub at a tag (`github:alexisNorthcoders/snake-colyseus#engine-vX.Y.Z`) and import `snake-colyseus/engine` and `snake-colyseus/bots`. npm's `prepare` hook builds both on install; `build/` is never committed. Both share the one `engine-vX.Y.Z` tag series.

The next tag's version is `engineVersion` in `package.json`. Bump it in your PR whenever anything under `src/engine/` or `src/bots/` changes:

- **major**: a rules change (`RULES_VERSION` bumped) or a breaking API change
- **minor**: an added export
- **patch**: a fix that changes neither

Once the PR is merged, CI (`.github/workflows/tag-engine.yml`) tags that `master` commit `engine-v<engineVersion>`. If the tag already exists it does nothing, so a merge that doesn't bump it cuts no tag. On pull requests, `.github/workflows/engine-version.yml` fails if engine or bots files changed but `engineVersion` didn't, and says what to bump it to.

Never tag by hand, and never tag a branch: CI owns the tags. See them at https://github.com/alexisNorthcoders/snake-colyseus/tags, or with `git fetch --tags && git tag --list 'engine-v*' --sort=-v:refname`.
