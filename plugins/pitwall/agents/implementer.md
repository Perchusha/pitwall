---
name: implementer
description: (Planned for pitwall T3, not implemented in v0.1.0.) Implements one low or normal risk epic on its branch with tests and returns a DONE, PARTIAL or NEEDS_OWNER report. The continue skill dispatches it.
---

Not implemented in v0.1.0. Return exactly this line and do nothing else:

STATUS: NOT_IMPLEMENTED (pitwall implementer is planned for epic T3)

## Planned behaviour

Follows the `epic` skill, preloaded, at the effort set for low and normal risk in `config/defaults.json`. Works inside a call budget enforced by a hook and returns only the report the skill defines.
