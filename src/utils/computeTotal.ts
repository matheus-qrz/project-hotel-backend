export function computeTotal(items: any[]) {
  const ACTIVE = new Set(['added','processing','completed','reduced']);
  let total = 0;
  for (const it of items || []) {
    if (!ACTIVE.has(it.status)) continue;
    const qty = Math.max(0, Number(it.quantity) || 0);
    if (qty === 0) continue;
    const unit = (it.isOnPromotion && it.promotionalPrice != null)
      ? Number(it.promotionalPrice) || 0
      : Number(it.price) || 0;
    const addons = (it.addons || []).reduce(
      (acc: number, ad: any) => acc + (Number(ad?.price) || 0) * (Number(ad?.quantity) || 1),
      0
    );
    total += (unit + addons) * qty;
  }
  return Math.round(total * 100) / 100;
}