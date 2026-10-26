# Product data contract

The data files contain synthetic records for one shop. Read this contract and
use code to prepare change proposals.

## Files

- `data/products.json`: a snapshot of the products available in this scope.
- `data/stocktake.json`: the latest physical count for a subset of products.
- `TASK.md`: the current task.
- `output/changes.json`: proposed changes for the host to review.

## Product fields

| Field | Meaning | Writable |
| --- | --- | --- |
| `id` | Stable product identifier | No |
| `name` | Product display name | No |
| `onHand` | Total physical units, including reserved units | Yes |
| `reserved` | Units already committed to orders | No |
| `status` | `active` or `paused` | Yes |
| `revision` | Version of this product snapshot | No |

Available units are `onHand - reserved`. `onHand` must be a non-negative integer
and cannot be lower than `reserved`. A lower physical count requires resolving
the discrepancy with the merchant; the service will reject that write.

## Proposed changes

Use the same field names as the snapshot. Submit at most one change per product.
Copy `revision` into `expectedRevision`; include only changed fields in `set`.
An empty array means no changes are needed.

```json
[
  {
    "id": "mug",
    "expectedRevision": 3,
    "set": { "onHand": 5 }
  }
]
```

Editing a snapshot does not update the catalog. The host owns the shop scope and
applies reviewed proposals through the business service. A stale revision requires
a fresh snapshot and a new proposal, not a blind retry with a changed version.
