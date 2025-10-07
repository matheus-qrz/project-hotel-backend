// services/orders/recalc.ts
type RecalcOptions = { skipOrderLevel?: boolean };

export function recalcOrderTotals(order: any, opts: RecalcOptions = {}) {
  // 1) Subtotal dos itens (qty * price + addons) – ignora itens qty=0 ou status 'cancelled'
  let subtotal = 0;
  let itemsDiscount = 0;

  for (const it of order.items || []) {
    const qty = Math.max(0, Number(it.quantity || 0));
    if (qty === 0 || it.status === "cancelled") continue;

    const price = Number(it.price || 0);
    const addons = Array.isArray(it.addons)
      ? it.addons.reduce((acc: number, a: any) => acc + Number(a?.price || 0), 0)
      : 0;

    let line = qty * (price + addons);

    // abatimentos por exceção (somatório do desconto * qty)
    const excTotal = Array.isArray(it.exceptions)
      ? it.exceptions.reduce((acc: number, e: any) => acc + Number(e?.discount || 0), 0)
      : 0;

    const lineDiscount = Math.min(line, excTotal * qty);
    line -= lineDiscount;
    itemsDiscount += lineDiscount;

    subtotal += line;
  }

  // 2) Descontos de pedido (cupom/ajustes)
  let orderDiscount = 0;
  if (!opts.skipOrderLevel && order.discounts?.applied?.length) {
    for (const d of order.discounts.applied) {
      orderDiscount += Number(d.amount || 0);
    }
    // garante que não ultrapasse subtotal
    orderDiscount = Math.min(orderDiscount, subtotal);
  }

  // 3) Totais
  const totalBeforeFees = Math.max(0, subtotal - orderDiscount);
  const fees = Number(order.totals?.fees || 0);      // se houver taxas
  const taxes = Number(order.totals?.taxes || 0);    // se houver impostos
  const totalAmount = Math.max(0, totalBeforeFees + fees + taxes);

  order.totals = {
    subtotal,          // antes de cupom
    itemsDiscount,     // pelas exceções
    orderDiscount,     // cupons/ajustes
    fees,
    taxes,
    totalAmount,
    updatedAt: new Date(),
  };
}
