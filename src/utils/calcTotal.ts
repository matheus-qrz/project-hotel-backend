import { Coupon } from "../models/Coupon";

export function round2(n: number) {
    return Math.round(n * 100) / 100;
}


export function computeDiscount(subtotal: number, coupon: Coupon | null): number {
    if (!coupon) return 0;
    let discount = 0;


    if (coupon.type === "fixed") {
    discount = coupon.value;
    } else {
    discount = subtotal * (coupon.value / 100);
    }


    if (discount > subtotal) discount = subtotal;
    return round2(discount);
}


export function computeTotals(items: Array<{ price: number; quantity: number }>, coupon: Coupon | null) {
    const subtotal = round2(
    items.reduce((acc, it) => acc + it.price * it.quantity, 0)
    );
    const discount = computeDiscount(subtotal, coupon);
    const total = round2(Math.max(0, subtotal - discount));


    return { subtotal, discount, total };
}