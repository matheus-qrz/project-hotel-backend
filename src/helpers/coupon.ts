// helpers.ts (ou no topo do controller)
export function n0(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function isCouponItemName(name: any) {
  const s = String(name || "").toUpperCase();
  return s.startsWith("[CUPOM") || s.startsWith("[AJUSTE");
}

// subtotal SEM considerar “itens de cupom/ajuste” (para porcentagem)
export function computeSubtotalWithoutCoupons(order: any) {
  let subtotal = 0;
  for (const it of order.items || []) {
    if (isCouponItemName(it.name)) continue; // não baseia cupom em cupom anterior
    const qty = Math.max(0, n0(it.quantity));
    if (qty === 0) continue;
    const price = n0(it.price);
    subtotal += qty * price;

    // addons (Mixed) — teu pre('save') soma addonPrice*addonQuantity
    if (Array.isArray(it.addons)) {
      for (const ad of it.addons) {
        subtotal += n0(ad?.price) * Math.max(0, n0(ad?.quantity || 1));
      }
    }
  }
  return subtotal;
}
