---
name: release
description: Releases a merged pitwall epic. Tags a semver version with a changelog, deploys to staging, runs QA against the acceptance criteria, then promotes to production with a smoke check. Use after an epic is merged or when the owner asks to release, tag or deploy.
disable-model-invocation: true
---

# release - tag, staging, QA, production

> Status: planned for epic T4c, not implemented in v0.1.0. If this skill is invoked, tell the owner that the release flow is not built yet and stop.

## What it will do

1. Tag a semver version and generate the changelog from conventional commits. Before 1.0 an epic bumps the minor and a fix bumps the patch. The owner decides when 1.0 ships.
2. Deploy to staging. Defaults per app type:
   - web: a separate environment with its own database and URL;
   - desktop: a built installer; for Steam, a closed beta branch;
   - mobile: TestFlight and Google Play internal testing;
   - lite level: a local build.
3. Dispatch the `qa` agent: end-to-end tests for the acceptance criteria of every closed epic, plus an exploratory pass through the discovery scenarios.
4. Green QA: promote to production and run a short smoke check there (standard and full; at the lite level the local build is the release). Red QA: file BUG-n with `/pitwall:bug`, keep production where it is; a blocking one's fix goes right after the change in flight.
