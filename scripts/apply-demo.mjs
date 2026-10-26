import { readFile } from "node:fs/promises";
import { catalog, shopId } from "../fixtures/catalog.mjs";
import { applyProductChanges, readProducts } from "../src/catalog-service.mjs";

const changes = JSON.parse(
  await readFile(".demo/workspace/output/changes.json", "utf8"),
);
const updatedCatalog = applyProductChanges(catalog, shopId, changes);

console.log(
  JSON.stringify(
    {
      mode: "in-memory-demo",
      products: readProducts(updatedCatalog, shopId),
    },
    null,
    2,
  ),
);
