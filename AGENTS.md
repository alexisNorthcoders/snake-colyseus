## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues on alexisNorthcoders/snake-colyseus, using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human and wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Tagging the engine

Other repos install the engine from GitHub at a tag (`github:alexisNorthcoders/snake-colyseus#engine-vX.Y.Z`) and import `snake-colyseus/engine`. npm's `prepare` hook builds it on install; `build/` is never committed.

Cut a new tag on `master` whenever `RULES_VERSION` or anything exported from `src/engine/index.ts` changes:

- **major**: a rules change (`RULES_VERSION` bumped) or a breaking API change
- **minor**: an added export
- **patch**: a fix that changes neither

```sh
git checkout master && git pull
git tag engine-vX.Y.Z
git push origin engine-vX.Y.Z
```

Find the latest with `git tag --list 'engine-v*' --sort=-v:refname | head -1`.
