// utils/aggregation.ts
import { IOrder as Order } from "../models/Order";
import { OrderStatus } from "../types/order.types";

interface MonthlyOrderCount {
    month: string;
    value: number;
}

/**
 * Agrupa os pedidos pagos ou concluídos por mês, retornando os últimos 6 meses.
 */
export function groupOrdersByMonth(orders: Order[]): MonthlyOrderCount[] {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthKey = date.toLocaleString("pt-BR", { month: "short" });
        return { key: `${date.getFullYear()}-${date.getMonth()}`, label: monthKey };
    }).reverse();

    const grouped = new Map<string, number>();

    for (const order of orders) {
        if (
            !order.createdAt ||
            ![OrderStatus.PAID as Order['status'], OrderStatus.COMPLETED as Order['status']].includes(order.status)
        ) continue;

        const date = new Date(order.createdAt);
        const key = `${date.getFullYear()}-${date.getMonth()}`;
        grouped.set(key, (grouped.get(key) || 0) + 1);
    }

    return months.map(({ key, label }) => ({
        month: label,
        value: grouped.get(key) || 0,
    }));
}
