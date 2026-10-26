export const shopId = "studio";

export const catalog = [
  {
    id: "mug",
    shopId: "studio",
    name: "Asymmetric ceramic mug",
    onHand: 8,
    reserved: 2,
    status: "active",
    revision: 3,
    unitCost: 9,
  },
  {
    id: "vase",
    shopId: "studio",
    name: "Narrow shelf vase",
    onHand: 3,
    reserved: 1,
    status: "active",
    revision: 7,
    unitCost: 12,
  },
  {
    id: "tray",
    shopId: "studio",
    name: "Small desk tray",
    onHand: 4,
    reserved: 0,
    status: "active",
    revision: 1,
    unitCost: 5,
  },
  {
    id: "lamp",
    shopId: "studio",
    name: "Folded paper lamp",
    onHand: 6,
    reserved: 0,
    status: "paused",
    revision: 2,
    unitCost: 15,
  },
  {
    id: "bowl",
    shopId: "another-shop",
    name: "Wide ceramic bowl",
    onHand: 12,
    reserved: 0,
    status: "active",
    revision: 1,
    unitCost: 7,
  },
];

export const stocktake = [
  { id: "mug", onHand: 5 },
  { id: "vase", onHand: 1 },
  { id: "tray", onHand: 4 },
];
