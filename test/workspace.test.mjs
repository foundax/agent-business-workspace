import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { catalog, shopId } from "../fixtures/catalog.mjs";
import { applyProductChanges, readProducts } from "../src/catalog-service.mjs";

test("the workspace sees only scoped business fields and cannot mutate the catalog snapshot", () => {
  const products = readProducts(catalog, shopId);
  assert.deepEqual(
    products.map((product) => product.id),
    ["mug", "vase", "tray", "lamp"],
  );
  assert.equal(
    products.some((product) => "unitCost" in product || "shopId" in product),
    false,
  );
  products[0].onHand = 0;
  assert.equal(catalog[0].onHand, 8);
});

test("ordinary workspace code proposes changes, then the host applies them and reads back", (context) => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "agent-business-workspace-"),
  );
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const before = structuredClone(catalog);
  const prepare = fileURLToPath(
    new URL("../scripts/prepare-demo.mjs", import.meta.url),
  );
  const apply = fileURLToPath(
    new URL("../scripts/apply-demo.mjs", import.meta.url),
  );

  execFileSync(process.execPath, [prepare], { cwd: directory });
  execFileSync(process.execPath, [".demo/workspace/task.mjs"], {
    cwd: directory,
  });
  const proposalPath = path.join(
    directory,
    ".demo/workspace/output/changes.json",
  );
  const changes = JSON.parse(readFileSync(proposalPath, "utf8"));
  assert.deepEqual(changes, [
    { id: "mug", expectedRevision: 3, set: { onHand: 5 } },
    { id: "vase", expectedRevision: 7, set: { onHand: 1, status: "paused" } },
  ]);
  assert.deepEqual(catalog, before);

  const output = execFileSync(process.execPath, [apply], {
    cwd: directory,
    encoding: "utf8",
  });
  const readback = JSON.parse(output);
  assert.equal(readback.mode, "in-memory-demo");
  assert.equal(readback.products[0].onHand, 5);
  assert.equal(readback.products[0].revision, 4);
  assert.equal(readback.products[1].status, "paused");
  assert.deepEqual(
    readback.products.slice(2),
    readProducts(catalog, shopId).slice(2),
  );

  writeFileSync(
    proposalPath,
    JSON.stringify([{ id: "bowl", expectedRevision: 1, set: { onHand: 0 } }]),
  );
  assert.throws(
    () =>
      execFileSync(process.execPath, [apply], {
        cwd: directory,
        stdio: "pipe",
      }),
    /Command failed/,
  );
});

test("a bad write rejects the batch without applying earlier valid entries", () => {
  const before = structuredClone(catalog);
  assert.throws(
    () =>
      applyProductChanges(catalog, shopId, [
        { id: "mug", expectedRevision: 3, set: { onHand: 5 } },
        { id: "vase", expectedRevision: 7, set: { onHand: 0 } },
      ]),
    /reserved units/,
  );
  assert.deepEqual(catalog, before);
});

test("shop scope and writable fields are enforced at the business boundary", () => {
  assert.throws(
    () =>
      applyProductChanges(catalog, shopId, [
        { id: "bowl", expectedRevision: 1, set: { onHand: 0 } },
      ]),
    /not available in this shop/,
  );
  assert.throws(
    () =>
      applyProductChanges(catalog, shopId, [
        { id: "mug", expectedRevision: 3, set: { reserved: 0 } },
      ]),
    /Only onHand and status/,
  );
  assert.throws(
    () =>
      applyProductChanges(catalog, shopId, [
        { id: "mug", expectedRevision: 3, set: { unitCost: 0 } },
      ]),
    /Only onHand and status/,
  );
  assert.throws(
    () =>
      applyProductChanges(catalog, shopId, [
        {
          id: "bowl",
          expectedRevision: 1,
          shopId: "another-shop",
          set: { onHand: 0 },
        },
      ]),
    /Each change needs/,
  );
});

test("stale proposals fail and unrelated rows remain unchanged", () => {
  const changes = [{ id: "mug", expectedRevision: 3, set: { onHand: 5 } }];
  const updatedCatalog = applyProductChanges(catalog, shopId, changes);
  assert.deepEqual(updatedCatalog.slice(1), catalog.slice(1));
  assert.throws(
    () => applyProductChanges(updatedCatalog, shopId, changes),
    /Read a fresh snapshot/,
  );
  assert.equal(updatedCatalog[0].onHand, 5);
});

test("malformed JSON proposals and invalid business values fail visibly", () => {
  for (const changes of [null, {}, [null], [{ id: "mug", set: {} }]]) {
    assert.throws(() => applyProductChanges(catalog, shopId, changes));
  }
  for (const onHand of [-1, 1.5, "5"]) {
    assert.throws(
      () =>
        applyProductChanges(catalog, shopId, [
          { id: "mug", expectedRevision: 3, set: { onHand } },
        ]),
      /non-negative safe integer/,
    );
  }
  assert.throws(
    () =>
      applyProductChanges(catalog, shopId, [
        { id: "mug", expectedRevision: 3, set: { status: "unknown" } },
      ]),
    /status must be/,
  );
  assert.throws(
    () =>
      applyProductChanges(catalog, shopId, [
        { id: "mug", expectedRevision: 3, set: { onHand: 5 } },
        { id: "mug", expectedRevision: 3, set: { onHand: 6 } },
      ]),
    /one change per product/,
  );
  assert.deepEqual(applyProductChanges(catalog, shopId, []), catalog);
});
