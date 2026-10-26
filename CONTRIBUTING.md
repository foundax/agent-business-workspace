# Contributing

We welcome contributions to the reference architecture, runnable examples,
data contracts, and evaluation methods for agents in existing business systems.

## Good starting points

- Add task examples from commerce, CRM, ERP, finance, marketing, or HR systems.
- Compare code execution, direct tool calls, and predefined workflows.
- Improve schema documentation and relationship definitions.
- Document snapshot invalidation and recovery from stale data or rejected proposals.
- Contribute reproducible evaluations, including task quality, latency, and token usage.

For a design discussion, describe the task, constraints, and proposed change.
For a bug report, include reproduction steps and expected behavior.
Contributions and discussions in English or Chinese are welcome.

## Changes to code

Examples must run without a paid service. Add tests for changes to demonstrated
behavior. Run `npm test` and `npm run demo` before submitting a pull request.

Use synthetic data. Do not include merchant records, credentials, private prompts,
internal deployment details, or code you do not have permission to contribute.
For model experiments, explain the setup without publishing private transcripts.

Contributions are made under the repository's MIT license.
