export function readProducts(catalog, shopId) {
  return catalog
    .filter((product) => product.shopId === shopId)
    .map(({ id, name, onHand, reserved, status, revision }) => ({
      id,
      name,
      onHand,
      reserved,
      status,
      revision,
    }));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function applyProductChanges(catalog, shopId, changes) {
  if (!Array.isArray(changes)) {
    throw new Error("Changes must be an array.");
  }

  const updates = new Map();
  for (const change of changes) {
    if (
      !isRecord(change) ||
      Object.keys(change).some(
        (field) => !["id", "expectedRevision", "set"].includes(field),
      ) ||
      typeof change.id !== "string" ||
      !Number.isSafeInteger(change.expectedRevision) ||
      change.expectedRevision < 1 ||
      !isRecord(change.set)
    ) {
      throw new Error(
        "Each change needs id, expectedRevision, and a set object.",
      );
    }

    const fields = Object.keys(change.set);
    if (
      fields.length === 0 ||
      fields.some((field) => !["onHand", "status"].includes(field))
    ) {
      throw new Error(
        "Only onHand and status may be changed; set must not be empty.",
      );
    }
    if (updates.has(change.id)) {
      throw new Error("Submit one change per product.");
    }

    const product = catalog.find(
      (item) => item.id === change.id && item.shopId === shopId,
    );
    if (!product) {
      throw new Error("Product is not available in this shop.");
    }
    if (product.revision !== change.expectedRevision) {
      throw new Error(
        `Product ${change.id} changed. Read a fresh snapshot before proposing again.`,
      );
    }
    if (
      "onHand" in change.set &&
      (!Number.isSafeInteger(change.set.onHand) || change.set.onHand < 0)
    ) {
      throw new Error("onHand must be a non-negative safe integer.");
    }
    if (
      "status" in change.set &&
      !["active", "paused"].includes(change.set.status)
    ) {
      throw new Error("status must be active or paused.");
    }

    const updatedProduct = {
      ...product,
      ...change.set,
      revision: product.revision + 1,
    };
    if (updatedProduct.onHand < product.reserved) {
      throw new Error(
        `Product ${change.id} has reserved units. Resolve the stock discrepancy first.`,
      );
    }
    updates.set(product.id, updatedProduct);
  }

  // Return a replacement only after every change passes the business boundary.
  return catalog.map((product) =>
    product.shopId === shopId ? (updates.get(product.id) ?? product) : product,
  );
}
