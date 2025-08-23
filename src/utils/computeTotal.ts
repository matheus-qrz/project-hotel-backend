export function computeTotal(items: any[]): number {
  const ACTIVE = new Set(['added', 'processing', 'completed', 'reduced']);

  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;   // evita NaN
  };

  let total = 0;
  for (const it of items ?? []) {
    if (!ACTIVE.has(it?.status)) continue;

    const qty = Math.max(0, toNum(it?.quantity));
    if (qty === 0) continue;

    const unit = (it?.isOnPromotion && it?.promotionalPrice != null)
      ? toNum(it.promotionalPrice)
      : toNum(it?.price);

    const addons = Array.isArray(it?.addons)
      ? it.addons.reduce(
          (acc: number, ad: any) =>
            acc + toNum(ad?.price) * Math.max(0, toNum(ad?.quantity) || 1),
          0
        )
      : 0;

    total += (unit + addons) * qty;
  }

  return Math.round(total * 100) / 100;
}
