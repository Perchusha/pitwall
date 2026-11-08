# Spikes

One file per spike: `<topic>.md`, copied from `template.md`, with the hypothesis, the success criterion committed before the work, the measured result and the conclusion. Spike code lives on `spike/<topic>` and never reaches `main`. pitwall's docs check reads git to confirm that the criterion came first and never changed; it runs on a full local clone, not in CI.
