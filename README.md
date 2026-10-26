# Make your internal business agent work like Codex or Claude Code

> **Core principle: let the model compose operations in code, while the backend retains control of rules and writes.**

[中文](README.zh-CN.md) · [Quick Start](#4-quick-start) · An engineering reference from [Foundax](https://foundax.com)

Organizing an agent primarily around many discrete business tools increases the
coordination needed for cross-module data relationships, operation composition, and intermediate state. Born from
commerce engineering at Foundax, this project explores **how to bring the coding-agent
approach into existing, complex business systems**.

**What this repository provides:**

- A reference architecture that presents business knowledge and data as explorable source and data snapshots.
- A runnable example covering synthetic data, change proposals, host-side validation, and execution.
- Engineering guidance on source snapshots, data caching, and sandbox isolation.

*This is an architectural reference, not a drop-in agent harness.*

---

## 1. Why complex business agents need more than tool calling

Tool calling is the mechanism through which a model invokes external capabilities.
Coding agents also call tools to read files and execute code, while a persistent working environment
holds scripts and intermediate results. The architectural question is how to organize business context,
operation composition, and execution state when task combinations cannot be enumerated in advance.

### The challenge in a real business task

An existing application already has data models, APIs, domain services, and an
authorization system. Users, however, usually express a **business goal**. A merchant
using [Foundax](https://foundax.com) might ask:

> Prepare a weekend campaign: find products with enough stock, fill in missing
> English and Chinese descriptions, and set suitable discounts. Let me review the changes first.

To carry this out, the agent must determine several relationships as it works:

- **Enough stock:** join product variants and calculate `available = onHand - reserved`.
- **Missing descriptions:** compare product records with localized content.
- **Suitable discounts:** check campaign eligibility and conflicts with existing rules.

### The coordination cost of discrete business tools

A common starting point is to wrap backend capabilities as tools such as
`get_products`, `check_inventory`, and `update_content`. When business context and execution state
travel primarily through tool definitions and responses, cross-domain tasks add two kinds of coordination cost:

1. **Fragmented business relationships.** Product, variant, and inventory relationships
   are spread across interface descriptions. Read and write APIs may use different
   names for the same field.
2. **Growing combinations and maintenance work.** Task combinations are difficult to
   enumerate. Adding a field or query dimension can require changes to several tool
   schemas. Tool retrieval reduces the definitions loaded at once, but the model
   still needs to discover the right tools and combine their returned data and state.

### Choosing how to organize the agent

These patterns can be combined: workflows and code execution can both invoke tools.
The choices concern who determines the steps, how business relationships are represented,
and where intermediate state is stored. For the distinction
between workflows and dynamic agent decisions, see Anthropic's
[Building effective agents](https://www.anthropic.com/research/building-effective-agents).

| Pattern | Loop | Fits | Tradeoff |
| --- | --- | --- | --- |
| **Workflow** | Fixed steps with model decisions | Known paths and acceptance criteria | New paths require flow changes |
| **Discrete business tools** | Call → observe → repeat | Tasks directly expressed by existing APIs | Cross-tool data and state |
| **Code + persistent environment** | Read → code → run → inspect | Exploration, joins, batch tasks | Isolation and session storage |

For tasks whose next step depends on discoveries and whose data needs flexible
composition, our approach is to **expose stable business structures and let the
model organize the work in code, retaining intermediate state in a persistent working environment**.
Explicit business operations still use tools or domain services, and existing workflows can handle stable steps.

---

## 2. How the architecture works

Foundax's internal agent uses read-only snapshots, an isolated execution environment, and host-side domain services.
This section abstracts that practice into a reference architecture separating
**read-only exploration, proposal generation, and host-controlled writes**.
The runnable repository implements synthetic data reads, proposal generation, and in-memory domain-service validation.
The engineering guide describes the runtime and caching mechanisms.

```mermaid
flowchart LR
    Backend[Business data and source] --> Snapshot[1. Scoped read-only snapshots]
    Snapshot --> Agent[2. Agent reads schemas and runs code]
    Agent --> Proposal[3. Structured change proposal]
    Proposal --> Review[4. Host preview and authorization]
    Review --> Service[5. Domain service validates and writes]
    Service --> Readback[6. Updated business view]
```

### Pillar 1: make schemas and business meaning readable context

Expose schemas and contracts organized around business objects, so new task
combinations can use existing operations. For example:

```text
products(id, name, ...)
variants(id, productId -> products.id, ...)
inventory(variantId -> variants.id, onHand, reserved)
product_content(productId -> products.id, locale, title, description)
```

*These are illustrative views, not production table definitions.*

- **Progressive discovery:** start with a directory and relationship index. The
  model reads table definitions, row granularity, field constraints such as
  `available = onHand - reserved`, and authorized source as needed.
- **Consistent read and write semantics:** use the same business fields for joins,
  filtering, calculations, and proposals, reducing field mapping and semantic
  translation across tools.

### Pillar 2: four logical mounts and snapshot reuse in the reference architecture

The reference architecture runs agent-written code in an execution sandbox.
Four logical mounts manage code, data, session files, and deliverables independently:

| Mount | Contents | Lifecycle and reuse |
| --- | --- | --- |
| `/repo` | Authorized source, table definitions, business rules | Versioned, read-only; shared by equally authorized sessions |
| `/data` | Business data within tenant and permission scope | Cached by scope; affected domains refresh by dependency |
| `/work` | Scripts and intermediate results | Session-specific; retained across continued work |
| `/outputs` | Change proposals and deliverables | Structured artifacts consumed and validated by the host |

**Demo implementation:** scripts, JSON data, and proposals live in the ordinary local directory `.demo/workspace`.
The repository does not implement these sandbox mounts, snapshot caching, or automatic refresh;
the engineering guide presents those mechanisms as designs and pseudocode.

> **Engineering guide:** see [Snapshot caching, invalidation, and execution isolation](docs/workspace-lifecycle.md)
> for cache keys, invalidation rules, sandbox boundaries, and lifecycle pseudocode.
>
> **Performance reference:** during internal executor optimization, session startup
> decreased from **~2.1 s to 1.0–1.4 s**, and the first toolchain command from
> **~0.87 s to 0.10–0.15 s**. These are engineering reference values that depend on
> deployment. Local computation and retained state can also reduce repeated transfer
> of intermediate results.

### Pillar 3: the model organizes work; the backend controls writes

- **Agent decisions:** task-specific logic, such as pausing an item with no available
  stock after a stocktake, lives in the generated program. Business changes are
  expressed as a declarative **proposal**.
- **Host execution:** business credentials, authorization, and writes stay with the
  **host application**. Existing **domain services** validate shop scope, writable
  fields, reserved inventory, and record versions for optimistic concurrency control,
  then execute within their transaction boundaries.
- **External effects:** charges, refunds, and notifications continue to use business
  commands with explicit semantics and authorization.

These contracts let internal and external coding agents reuse the same data
structures and operation interfaces, reducing coupling to a particular agent
orchestration system.

---

## 3. Applying the design beyond commerce

The same separation of authorized data, code-based composition, and domain-service
writes can be applied to other enterprise software:

| System | Example goal | Business objects to explore and join |
| --- | --- | --- |
| **CRM** | Prepare retention plans for valuable customers at risk | Customers, orders, interactions, segmentation rules |
| **ERP** | Identify material shortages and propose purchasing changes | BOMs, inventory, purchase orders, production plans |
| **Finance** | Investigate unusual expenses and propose adjustments | Journal entries, accounts, contracts, cost centers |
| **Marketing** | Propose budget changes for ad groups with low ROI | Ad groups, audiences, attribution, budget limits |
| **HR** | Forecast staffing gaps from schedules and approved leave | Employees, skills, shifts, leave, working-time rules |

---

## 4. Quick Start

The runnable example focuses on **inventory reconciliation**. It requires
**Node.js 22+**, with no third-party dependencies, model API key, or database.

A hand-written program makes the flow reproducible without a model call.
The multilingual-content and promotion tasks described earlier are outside this demo.

### Step 1: run the proposal → validation → execution flow

From the repository root, run the commands in order:

```sh
# 1. Read the stocktake and generate a change proposal
npm run demo

# 2. Validate the proposal and apply it to the in-memory catalog
npm run apply-demo
```

The commands perform the following steps:

1. `npm run demo` initializes `.demo/workspace` and runs the reference program.
   It reads synthetic product and stocktake data, calculates stock corrections,
   and proposes pausing products with no available units. It writes
   `.demo/workspace/output/changes.json`:

   ```json
   [
     { "id": "mug", "expectedRevision": 3, "set": { "onHand": 5 } },
     { "id": "vase", "expectedRevision": 7, "set": { "onHand": 1, "status": "paused" } }
   ]
   ```

2. `npm run apply-demo` represents the host backend. It reads the proposal and
   checks shop scope, writable fields, and `expectedRevision`. Valid changes update
   the in-memory catalog, and the command prints the resulting business view.

Each invocation starts from the same synthetic fixture. Updated state remains
local to that process.

### Step 2: try your own coding agent

Use your usual coding agent to replace the hand-written program:

```sh
# 1. Reset the example directory; this overwrites generated example files
npm run prepare-demo

# 2. Open .demo/workspace in your coding agent
#    Ask it to read WORKSPACE.md and TASK.md, then rewrite task.mjs

# 3. Review the generated code, then run it to produce a proposal
npm run propose-demo

# 4. Validate and apply the generated proposal
npm run apply-demo
```

### Local execution and production integration

- **Local execution:** demo scripts run in a Node process with your operating-system
  user permissions and can read local repository files. Production deployments
  require independent execution isolation and a host outside the agent's control.
- **Transactions and authorization:** the demo validates the batch and updates
  state in memory. Production integration connects host authentication,
  authorization of individual or batched proposals, and domain-service transactions.

---

## 5. Related work and further reading

- **Engineering guide:** [Snapshot caching, invalidation, and execution isolation](docs/workspace-lifecycle.md).
- **Related approaches:** code-based tool composition is also explored in Anthropic's
  [Code execution with MCP](https://www.anthropic.com/research/code-execution-with-mcp)
  and Cloudflare's [Code Mode](https://developers.cloudflare.com/agents/tools/codemode/).
  This project focuses on **business data modeling, snapshot lifecycles, and write
  boundaries enforced by existing domain services**.

## 6. Contributing and discussing use cases

- **Examples and implementation:** contribute business tasks for commerce, CRM, ERP,
  finance, or marketing systems; improve invalidation and stale-data handling; or
  add reproducible comparisons of direct tool calls and code execution.
- **Architecture and integration:** open an issue to discuss the design, or contact
  the Foundax team at [contact@novariseintl.com](mailto:contact@novariseintl.com)
  about your use case, integration requirements, and engineering tradeoffs.

---

## Deployment responsibilities and license

- **Deployment and data:** this project provides architecture guidance and a
  reference implementation using synthetic data. It does not provide model
  deployment or cross-border data-transfer solutions. When connecting real models
  or production data, implementers must assess and meet applicable requirements
  for model deployment, data security, privacy, and cross-border transfers in their
  location and the jurisdictions involved.
- **License:** code and documentation are available under the [MIT License](LICENSE).
