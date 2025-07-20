// Em um arquivo separado, por exemplo: src/types/order.types.ts
export const OrderStatus = {
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    PAYMENT_REQUESTED: 'payment_requested',
    PAID: 'paid',
    CANCELLED: 'cancelled'
} as const;

export enum OrderItemStatus {
    ADDED = "added",
    CANCELLED = "cancelled",
    COMPLETED = "completed",
    REDUCED = "reduced",
}

export type OrderStatusType = typeof OrderStatus[keyof typeof OrderStatus];
export type OrderItemStatusType = typeof OrderItemStatus[keyof typeof OrderItemStatus];
