import { OrderModel } from "../models/Order";

export async function recomputeAndReturn(orderId: string) {
  const doc = await OrderModel.findById(orderId);
  if (!doc) return null;
  // garante que o pre('save') reprocessa os totals a partir de items
  doc.markModified("items");
  await doc.save(); // dispara pre('save') que reatribui financialMetrics e totalAmount
  return doc;
}