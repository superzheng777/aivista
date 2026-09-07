# Generation worker result v1

Java publishes generation and transfer commands. TypeScript performs only the external model/OSS work and publishes results to `generation.worker.result`. Java remains the sole writer of generation task state, quota, image assets, and user-visible status events.

Identifiers and file sizes are decimal strings because JavaScript numbers cannot safely represent unsigned 64-bit database values. A result is idempotent for `(phase, taskId, taskVersion, outcome)`; Java ignores results for stale task versions.

Phases are `PROVIDER` and `TRANSFER`. Outcomes are `STARTED`, `SUCCEEDED`, and `FAILED`.
