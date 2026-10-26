import { readFile, writeFile } from "node:fs/promises";

const products = JSON.parse(
  await readFile(new URL("./data/products.json", import.meta.url), "utf8"),
);
const stocktake = JSON.parse(
  await readFile(new URL("./data/stocktake.json", import.meta.url), "utf8"),
);
const counts = new Map(stocktake.map((item) => [item.id, item.onHand]));
const changes = [];

for (const product of products) {
  if (!counts.has(product.id)) {
    continue;
  }

  const onHand = counts.get(product.id);
  const set = {};
  if (onHand !== product.onHand) {
    set.onHand = onHand;
  }
  if (onHand <= product.reserved && product.status === "active") {
    set.status = "paused";
  }
  if (Object.keys(set).length > 0) {
    changes.push({ id: product.id, expectedRevision: product.revision, set });
  }
}

await writeFile(
  new URL("./output/changes.json", import.meta.url),
  `${JSON.stringify(changes, null, 2)}\n`,
);
console.log(JSON.stringify(changes, null, 2));
