# Engineering Design: Snapshot Caching, Invalidation, and Execution Isolation

[简体中文](workspace-lifecycle.zh-CN.md) · [Project overview](../README.md)

A stocktake or campaign task may span several interactions while products, reserved inventory, and promotion rules keep changing.
The execution environment must support repeated joins and calculations, control production database load,
and let the agent continue using its scripts after business data changes.

A business agent that executes code needs access to three kinds of state:
**source code and business contracts**, **authorized business data**, and **session files**.
Their lifecycles affect storage growth, production database (OLTP) load, when business changes become visible to the agent,
and how long-running tasks recover after interruption.

This document presents a reference design drawn from Foundax's engineering practice.
It combines **immutable source snapshots**, **scoped data snapshots**, **watermark-based invalidation**,
and an **execution sandbox**. Mount topology, cache keys, and pseudocode explain how these components work together.

The runtime and caching mechanisms below are reference designs.
The runnable example implements synthetic data reads, proposal generation, and in-memory domain-service validation
using ordinary local directories. It does not implement sandbox mounts, snapshot caching, or automatic refresh.

## 1. Runtime Topology and Storage Lifecycles

### 1.1 Host and Sandbox Responsibilities

The system separates the **trusted host application** from the **isolated execution sandbox**.
The host manages model calls, task orchestration, authorization, snapshot preparation, and business writes.
Model-generated code runs inside the sandbox.

```text
Trusted Host Application
  Authorization / Model orchestration / Snapshot cache / Proposal review / Domain service writes
      |
      |  Supply read-only snapshots, dispatch commands, collect artifacts
      v
Isolated Execution Sandbox (Shell / Node / SQLite)
  /repo     [read-only]  Versioned source, schemas, and business contracts
  /data     [read-only]  Tenant- and permission-scoped data snapshots (JSON / SQLite)
  /work     [writable]   Session scripts and intermediate results
  /outputs  [writable]   Structured change proposals and deliverables
```

### 1.2 Security Boundaries and Resource Limits

1. **Separate permissions.** Authorize source access, sandbox execution, and business writes independently.
   The host validates proposals against current permissions, business rules, and data versions.
   Permission to execute code does not grant permission to write to the database.
2. **Credential and network isolation.** Keep production database credentials and internal service keys
   out of the sandbox's environment and filesystem. Disable external network access by default;
   expose required external capabilities through an authorized host proxy.
3. **Runtime isolation and quotas.** The host manages physical paths and exposes stable logical mount points.
   The runtime isolates processes, filesystems, and networking, and limits CPU, memory, disk capacity, and I/O.
   Linux namespaces, cgroups, filesystem quotas, and microVMs address different parts of this boundary;
   configure the relevant controls for the deployment.
4. **Command-scoped snapshot consistency.** Pin the `/data` version for the duration of a command.
   Switch to a complete new snapshot only between commands. One implementation stops the old sandbox
   and starts a new one with the updated snapshot, remounting the existing `/work` and `/outputs` directories.
   This preserves files, not process memory. Make the current snapshot version available to the model.

This guarantee concerns a command's fixed set of input files.
The data preparation protocol in Section 4 determines the transactional consistency of the exported data.

### 1.3 State Layers and Reuse Boundaries

Store code, data, and session state separately, with independent versions and references.

| Layer | Contents | Change triggers | Reuse boundary |
| --- | --- | --- | --- |
| `/repo` | Authorized source and contracts | Releases, contracts, access policy | Build × source policy |
| `/data` | Entities, relationships, constraints | Writes, permissions, data contracts | Tenant × permissions × domain |
| `/work`, `/outputs` | Scripts, results, proposals | Task execution | Session or continuing task |

Sessions with the same source visibility can share a code artifact.
Business data remains scoped to its tenant and permissions.
Separate session storage lets a task retain its scripts and outputs when its data snapshot changes.

## 2. Immutable Source Snapshots (/repo)

A source snapshot is a versioned, searchable, read-only copy that preserves relationships between files.
It contains authorized business source code, table definitions, business rules, and operation contracts.

### 2.1 Four Stages of Construction and Mounting

1. **Select source through an access policy.** Include authorized files and exclude secrets,
   environment files (`.env`), database dumps, Git history, and unrelated build output.
2. **Generate a manifest and entry index.** The manifest records relative paths, file sizes, and content digests.
   The entry index points to business domains, table relationships, field constraints, and operation entry points
   so the model can find relevant files on demand.
3. **Seal an immutable artifact.** Check file access policy and contents during build or prewarming.
   The execution node verifies the content digest on import, then the host manages the artifact as read-only storage.
4. **Share read-only mounts across sessions.** Resolve the imported artifact by version and mount it at `/repo`,
   for example with a read-only bind mount. Each session avoids another copy of the code.
   A release creates a separate artifact; running tasks keep their existing version references.

### 2.2 Cache Addressing and Trust Assumptions

```text
codeKey        = Hash(buildVersion, sourceAccessPolicyVersion, contractVersion)
artifactDigest = ContentDigest(manifest + fileContents)
session.repo   = ReadOnlyRef(artifactDigest)
```

**Separate cache lookup from authorization.** `codeKey` locates a reusable version;
`artifactDigest` is the content-addressed digest identifying the artifact.
Authorize source access before mounting. Only sessions permitted to read the same contents may share the reference.

**Trusted publication and immutable storage.** Once the build and import stages have checked an artifact,
subsequent sessions can reuse that verification instead of rescanning it.
This requires a trusted publication path and immutable contents after import.

### 2.3 Shared Storage and Garbage Collection

Within one execution node or shared storage pool, sessions reference the same read-only code artifact.
Code storage therefore scales with retained versions without requiring a separate copy for every session:

```text
CodeStorage  ≈ RetainedCodeVersions × SnapshotSize
TotalStorage ≈ CodeStorage + DataSnapshotStorage + SessionFileStorage
```

Include both active and retained historical state in capacity accounting.
When execution nodes import their own copies, count those replicas too.
Data projections, scripts, and outputs consume storage independently of code sharing.

Use **reference tracking and reachability-based garbage collection**:
retain artifacts reachable from active sessions, the current release, and retained rollback releases.
Collect unreferenced artifacts after their retention window expires.

## 3. Authorized Data Snapshots and Task Projections (/data)

The host prepares data through existing **domain read services** under the current user's permissions.
The sandbox explores a local, read-only copy of that data.

```text
Authorized host reads → Domain entities → Relationship and constraint metadata
                      → JSON / local SQLite → Read-only /data view
```

### 3.1 Self-Contained Schema Metadata

Attach table definitions to each snapshot so the model can determine row semantics,
join paths, and field constraints directly.

| Metadata | Purpose |
| --- | --- |
| Row granularity, primary and foreign keys | Define entity boundaries and join keys |
| Types, units, enums, computed constraints | Support filtering and checks, e.g. `available = onHand - reserved` |
| Writable fields | Define proposal fields; the host enforces the allowed set |
| Scope, snapshot time, completeness | Describe the time boundary, filters, and data coverage |

### 3.2 Storage Formats and Read/Write Semantics

**Use consistent business field names.** Use the same name for a business field in the read view and change proposal.
This reduces mappings such as reading `stock` but writing `target_stock`.

**Give JSON and SQLite distinct roles.** JSON works well for inspecting small entity sets, reading configuration,
and generating proposals. SQLite supports joins, filtering, and aggregation.
The agent can repeatedly query the local copy and write intermediate results to `/work`,
moving exploration of covered data away from the production database.
Initial exports, supplemental queries, and refreshes still pass through the host.

**Progressive reading and partial exports.** Start with a table catalog and relationship index,
then let the model read specific tables and rows as needed.
Record filters and coverage in partial-export metadata so the model can distinguish the current result set
from the complete business dataset.

### 3.3 Two Levels of Reuse: Base Snapshot and Task Projection

Cache a **base snapshot** by authorization scope.
A **task projection** applies the user's selected resources and filters to that base.

```text
dataKey   = Hash(tenantId, resourceScope, locale, authorizationFingerprint, dataContractVersion)
taskScope = Canonicalize(selectedResourceIds, explicitFilters)
```

- **Base snapshot key, `dataKey`.** `resourceScope` identifies a store, department, project, or similar boundary.
  `authorizationFingerprint` includes conditions affecting row and field visibility,
  giving different permission views different cache keys.
- **Task scope, `taskScope`.** Deduplicate and sort resource IDs, and normalize filter representations
  so input ordering does not produce unnecessary scope variants.
- **Supplement data outside the base coverage.** Project covered data locally.
  When the task needs additional data, the host performs authorized queries and rebuilds the projection.
  Reusing base data can still require task projection and file materialization.

## 4. Watermark-Based Incremental Invalidation

A **dependency graph** and **version watermarks** identify the domains affected by business changes,
reducing unrelated reads. The unit of incremental refresh here is a business domain:
rebuild affected domains and reuse the others.

### 4.1 Domain Dependencies and the Reverse Dependency Index

Declare each business view's source dependencies in its data contract,
then derive a **reverse dependency index** from those declarations.

```text
Forward dependencies
  Product view     ← Products, variants, inventory, translations
  Promotion view   ← Products, promotion rules, campaign bindings

Invalidation propagation
  Inventory write  → Refresh the product view
  Rule write       → Refresh the promotion view
  Product write    → Refresh both views
```

### 4.2 Version Updates and Domain Refresh

**Reliably couple writes to version markers.** Increment `sourceVersion` whenever its source changes.
One implementation commits the business write and version increment in the same database transaction.
Background jobs, manual edits, bulk imports, and agent execution must all participate in this protocol
for versions to be a reliable freshness signal.

**Record dependency watermarks at export.** Each domain stores the source versions corresponding to its exported data.
During preparation, compare current versions with those watermarks and rebuild only missing or stale domains.
A cache hit still requires permission, readiness, and version metadata checks.

### 4.3 Incremental Refresh and Snapshot Publication

Run the following pseudocode within the build coordination boundary for the same `dataKey`.
Section 5 describes concurrent requests.

```python
def ensure_data_snapshot(scope, requested_domains):
    key = compute_data_key(scope)
    previous_snapshot = get_latest_ready_snapshot(key)
    current_source_versions = read_current_source_versions(scope)
    domains_to_rebuild = []

    for domain in requested_domains:
        domain_snapshot = previous_snapshot.domains.get(domain) if previous_snapshot else None
        if domain_snapshot is None or any(
            domain_snapshot.watermarks[source] != current_source_versions[source]
            for source in DEPENDENCIES[domain]
        ):
            domains_to_rebuild.append(domain)

    if not domains_to_rebuild:
        return previous_snapshot

    fresh_domains = export_consistent_domains(scope, domains_to_rebuild)
    next_snapshot = merge_domain_snapshots(previous_snapshot, fresh_domains)
    publish_ready_snapshot(key, next_snapshot)
    return next_snapshot
```

**Keep data and watermarks aligned.** `export_consistent_domains` must return data and versions
from the same read view. Read both in a database transaction with an appropriate consistent snapshot,
or, under the atomic update protocol in Section 4.2, compare source versions before and after export.
Discard and retry the export if those versions changed.

**Preserve each domain's version provenance.** Unchanged domains retain their original watermarks;
rebuilt domains use the watermarks captured with the new export.
Finish constructing all files before atomically publishing the ready-snapshot reference,
so readers cannot observe a partial artifact.
A domain merge can combine different points in time. Tasks requiring a common cross-domain time boundary
must export the relevant domains within the same consistent read view.

### 4.4 Failure Case: Labeling Old Data with a New Version

Reading a version only after export does not establish that the data matches its watermark.
Even when writes and version increments commit atomically, this sequence is possible:

```text
T0  Source version is 7; inventory is 8
T1  Export reads inventory 8
T2  A business transaction sets inventory to 5 and increments the version to 8
T3  Export reads version 8 and publishes inventory 8 with version 8
```

Later version checks treat the snapshot as valid even though its inventory is stale.
Section 4.3 requires data and versions from a consistent read view, or a before-and-after version check
under the atomic version-update protocol.
Concurrency tests should cover writes during export, failed version updates after writes,
and multiple domains depending on one changing source.

## 5. Lifecycle Triggers and Concurrency Control

### 5.1 Events and Host Actions

| Event | Host action |
| --- | --- |
| First activation | Prewarm code and base data snapshots; persist readiness |
| Reopen the panel | Check readiness and dependency watermarks; reuse valid artifacts |
| Start a task or request a new domain | Check scope, permissions, contracts; build missing or stale domains |
| Complete a business write | Update versions through the write protocol; use the domain service's result |
| Continue work on modified data | Refresh affected domains; switch between commands; retain session files |
| Change permissions, locale, or filters | Recompute `dataKey` or `taskScope`; switch or rebuild the view |
| Release code or change source policy | Use matching code for new sessions; rebuild data when its contract changes |
| Concurrent requests for the same cache key | Coalesce builds; recheck each caller's required domains after waiting |

**Request coalescing / singleflight** can prevent duplicate snapshot builds.
The coordination key should match the cache reuse boundary.
After waiting, each caller checks that the result includes its requested domains.
In-process singleflight coordinates only that process; a shared cache with multiple processes
requires coordination across them to prevent duplicate builds and conflicting publications.

### 5.2 Frequent Writes and Time-Sensitive Rules

**Frequently changing domains.** Inventory and similar data may repeatedly invalidate snapshots.
Choose refresh granularity based on export cost, data volume, and task freshness requirements;
use micro-batches or supplemental reads where appropriate.
Domain services validate current state and enforce business constraints at write time.
`expectedRevision` can detect version conflicts; inventory deductions and payments also require
appropriate conditional updates, transactions, or locks.

**Time-sensitive rules.** Promotions and scheduled contracts can change meaning without a database write.
Record the next transition time or refresh on expiration events;
write-version comparisons alone cannot detect these transitions.
Manage data validity separately from the artifact retention windows used for garbage collection in Section 2.3.

### 5.3 State Changes During Business Tasks

| Scenario | Required boundary |
| --- | --- |
| Reserved inventory increases while approval is pending | Check current constraints and versions; reread and recalculate stale proposals |
| The user expands the product selection | Reauthorize the scope and project data; existing snapshots do not grant wider access |
| Permissions are revoked during a task | Stop using the old authorization scope; validate writes against current permissions |
| A cross-domain batch partially succeeds | Report actual step results, define retry scope, and refresh data for completed changes |

Refreshing a snapshot changes what the model reads next. It does not update old proposals' versions or authorization.
Session scripts can remain, but conclusions must be reassessed against the data they used.

## 6. Performance Trade-offs and Observability

### 6.1 Benefits and Costs

| Mechanism | Reduced work | Remaining or added costs |
| --- | --- | --- |
| Shared read-only code | Per-session source copies and scans | Packaging, node imports, retained versions |
| Scoped base snapshot reuse | Repeated full business queries | Authorization, version reads, supplemental queries |
| Dependency-based domain refresh | Exports of unaffected domains | Dependencies, version updates, snapshot merges |
| Local SQLite / JSON queries | Repeated remote reads of exported data | Export, SQLite builds, local storage and computation |
| Entry index and on-demand reading | Loading all schemas and data upfront | Discovery, file reading, model reasoning |

During internal executor optimization, session startup decreased from approximately **2.1 s to 1.0–1.4 s**,
and the first toolchain command from **0.87 s to 0.10–0.15 s**.
These deployment-dependent values illustrate executor preparation costs;
they are not an isolated comparison of snapshot strategies or end-to-end business tasks.

### 6.2 Instrumenting Snapshot Preparation

Record end-to-end **snapshot preparation latency** and the following stage durations.
Distinguish cache hits, misses, stale snapshots, and requests waiting for another build.

| Stage | Measurement |
| --- | --- |
| `DomainQuery` | Business data reads through domain services |
| `TaskProjection` | Filtering data to the task scope |
| `Serialize` | JSON and metadata serialization |
| `SQLiteBuild` | Table creation, data insertion, and index construction |
| `Transfer` | Artifact transfer to the execution node |
| `Mount` | Mount preparation and runtime startup or refresh |

When all stages run sequentially, break down end-to-end latency as follows:

```text
TotalPrepLatency = DomainQuery + TaskProjection + Serialize + SQLiteBuild
                 + Transfer + Mount + CoordinationAndMetadata
```

`CoordinationAndMetadata` includes authorization, version reads, and build waits.
For overlapping stages, use the trace's critical path to measure end-to-end latency instead of adding overlapping durations.
A base snapshot hit can avoid a full business export. Whether supplemental queries, projection, serialization,
and mounting are also skipped depends on reuse at each stage.

## 7. Architecture Discussion

If you are adding code-executing agents to an existing business system,
contact the Foundax team at [contact@novariseintl.com](mailto:contact@novariseintl.com).
We welcome discussions grounded in data scale, cross-module tasks, and performance or isolation constraints.
