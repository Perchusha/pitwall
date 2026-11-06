# Stack

Written at stage 2 (`decide`). Every area in pitwall's `decide.areas` appears in one of the tables below. Versions are read from the package registry at decision time, never from memory.

## Decisions

| Area | Choice | Version | Source | ADR |
| --- | --- | --- | --- | --- |

Source links the registry page the version was read from, with the date it was read. A choice without a version has `-` in both columns, and a two-way choice has `-` for its ADR.

## Models, prices and limits

The one config file that holds model IDs, prices and API limits: (path). Nothing else in the code hardcodes them.

## Two-way decisions

Picked by the agent, accepted by the owner as a list. An area that does not apply is listed as `Not needed`, with the reason.

| Area | Choice | Why, in one line |
| --- | --- | --- |
