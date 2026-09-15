# Phase 1 evidence

- `results.json` is the authoritative result from the successful rerun of `probe.ts`.
- `verification.json` records the final local command results and the device/review-backend boundary.
- `phase1-probe-rerun.db` and `phase1-legacy-upgrade-rerun.db` are the isolated SQLite databases used by the successful probe.
- `phase1-probe.db` is retained from an earlier interrupted probe attempt and is not used as evidence; it is kept to avoid deleting a generated artifact.
- The probe uses `LLM_MODE=mock`, an isolated database, and no personal credentials or development database.
