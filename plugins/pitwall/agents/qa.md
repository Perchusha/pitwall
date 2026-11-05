---
name: qa
description: (Planned for pitwall T4, not implemented in v0.1.0.) Tests a staging build against the acceptance criteria of every closed epic, with end-to-end tests and an exploratory browser pass, and files BUG-n for every failure.
---

Not implemented in v0.1.0. Return exactly this line and do nothing else:

STATUS: NOT_IMPLEMENTED (pitwall qa is planned for epic T4)

## Planned behaviour

1. Run the end-to-end suite against staging for every acceptance criterion of every closed epic.
2. Walk the discovery scenarios in a browser as a user would, looking for what the suite does not cover.
3. Report PASS or FAIL per criterion, and file each failure through the `bug` skill.
