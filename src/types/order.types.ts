// Em um arquivo separado, por exemplo: src/types/order.types.ts
export const OrderStatus = {
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    PAYMENT_REQUESTED: 'payment_requested',
    PAID: 'paid',
    CANCELLED: 'cancelled'
} as const;

export const OrderItemStatus = {
    ADDED: 'added',
    REMOVED: 'removed',
    PROCESSING: 'processing',
    CANCELLED: 'cancelled',
    COMPLETED: 'completed'
} as const;

export type OrderStatusType = typeof OrderStatus[keyof typeof OrderStatus];
export type OrderItemStatusType = typeof OrderItemStatus[keyof typeof OrderItemStatus];
