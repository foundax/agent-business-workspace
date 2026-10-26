import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { catalog, shopId, stocktake } from "../fixtures/catalog.mjs";
import { readProducts } from "../src/catalog-service.mjs";

const workspace = path.resolve(".demo/workspace");
await mkdir(path.join(workspace, "data"), { recursive: true });
await mkdir(path.join(workspace, "output"), { recursive: true });
await rm(path.join(workspace, "output/changes.json"), { force: true });
await writeFile(
  path.join(workspace, "data/products.json"),
  `${JSON.stringify(readProducts(catalog, shopId), null, 2)}\n`,
);
await writeFile(
  path.join(workspace, "data/stocktake.json"),
  `${JSON.stringify(stocktake, null, 2)}\n`,
);
await copyFile(
  new URL("../workspace/WORKSPACE.md", import.meta.url),
  path.join(workspace, "WORKSPACE.md"),
);
await copyFile(
  new URL("../examples/TASK.md", import.meta.url),
  path.join(workspace, "TASK.md"),
);
await copyFile(
  new URL("../examples/reconcile-stocktake.mjs", import.meta.url),
  path.join(workspace, "task.mjs"),
);

console.log(
  "Prepared .demo/workspace with synthetic data and an example task. No catalog changes applied.",
);
