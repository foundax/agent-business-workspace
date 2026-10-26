# Contributing

We welcome engineering designs and examples that help coding agents work with existing business systems.
Contributions should connect a business task to its data contracts, changing state, and domain-service boundaries.

## Good starting points

- Model task-relevant entities, relationships, units, and writable fields in a synthetic business case.
- Explain scope filtering, partial exports, or permission changes during an ongoing task.
- Show how concurrent writes affect snapshot watermarks and pending proposals.
- Define transaction boundaries, partial success, and retries when integrating existing domain services.
- Compare preparation latency, database reads, and task quality under explicit data volumes and freshness requirements.
- Demonstrate how these business contracts connect to an existing agent framework.

For a design discussion, include:

1. The user's business goal and the existing services available to the agent.
2. Relevant entities, relationships, authorization scope, and business constraints.
3. A concrete failure scenario, such as a concurrent edit or revoked permission.
4. The proposed contract or mechanism, its costs, and expected behavior in that scenario.

For a bug report, include reproduction steps and expected behavior.
Contributions and discussions in English or Chinese are welcome.

## Changes to code

Examples must run without a paid service. Add tests for changes to demonstrated
behavior. Run `npm test` and `npm run demo` before submitting a pull request.

Use synthetic data. Do not include merchant records, credentials, private prompts,
internal deployment details, or code you do not have permission to contribute.
For model experiments, explain the setup without publishing private transcripts.

Contributions are made under the repository's MIT license.
