# Agent entry point

Read `docs/HANDOFF-2026-09-08.md` and `README.md` before changes. Confirm actual
checkout and publication state with `git status --short`, `git log -5 --oneline`,
and `git rev-parse HEAD`; a prior chat is not a release manifest.

This project displays market data and research. No broker, credential, order,
wallet, or trade-sizing capability belongs here. Stock Research is an optional,
validated read-only public feed; its outage must never block market data.
MiroFish belongs in Stock Research's quarantined Research Lab and is not consumed
by this app's market or AI pipelines.

Verify with `npm test`, `npm audit`, and the documented route/production smoke
commands. Preserve last-good data visibly, and never call cached/stale data live.
