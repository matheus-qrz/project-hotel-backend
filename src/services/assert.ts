// services/orders/assert.ts
export function assertBelongsToUnit(order: any, unitId: string) {
  const o = String(order.restaurantUnit?._id || order.restaurantUnit || "");
  if (o !== String(unitId)) {
    const err: any = new Error("Order does not belong to this unit");
    err.status = 403;
    throw err;
  }
}
