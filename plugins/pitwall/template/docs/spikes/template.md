# Spike: Title in a few words

- Assumption: the A-n it tests, from `DISCOVERY.md`
- Branch: spike/<topic>
- Date: YYYY-MM-DD
- Outcome: pending | confirmed | not confirmed
- Prototype: the commit on the branch that was measured, or - until then
- Follow-up: - | ADR-NNNN | R-n | pending, /pitwall:decide <area>

## Hypothesis

What must hold for the assumption to be true, in one or two sentences.

## Criterion

Committed before any prototype code, and never changed after that commit. Each row names what is measured, how, and the number that counts as success.

| Metric | How it is measured | Success when |
| --- | --- | --- |

## Result

Filled in after the prototype ran. Each row is one measurement, made by a command or by the owner.

| Metric | Measured | Measured by | Date |
| --- | --- | --- | --- |

## Conclusion

Confirmed or not confirmed, against the criterion, in a few sentences. A spike that is not confirmed names its follow-up: a new ADR from `/pitwall:decide <area>`, or a risk the owner accepted in `RISKS.md`.
