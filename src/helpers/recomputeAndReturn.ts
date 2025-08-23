import { OrderModel } from "../models/Order";

export async function recomputeAndReturn(orderId: string) {
  const order = await OrderModel.findById(orderId);
  if (!order) return null;

  const ACTIVE = new Set(['added', 'processing', 'completed', 'reduced']);

  let total = 0;
  for (const it of order.items) {
    if (!ACTIVE.has(it.status as any)) continue;
    const qty = Math.max(0, it.quantity ?? 0);
    if (qty === 0) continue; // ignora itens zerados
    const unit = (it.isOnPromotion && it.price != null)
      ? it.price
      : it.originalPrice;
    const addons = (it.addons ?? []).reduce((a: number, ad: any) => {
      const q = Number(ad.quantity ?? 1) || 0;
      const p = Number(ad.price ?? 0) || 0;
      return a + p * q;
    }, 0);
    total += (Number(unit) + addons) * qty;
  }
  order.totalAmount = Math.round(total * 100) / 100;
  order.markModified('items'); // garante persistência dos subdocs
  await order.save();

  return order;
}