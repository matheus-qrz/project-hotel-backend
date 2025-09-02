// --- Pedidos ---
export interface OrderSummary {
    total: number;
    completed: number;
    paid: number;
    cancelled: number;
}

export interface TopOrder {
    name: string;
    value: number; // total de unidades vendidas
}

export interface OrdersDashboardData {
    summary: OrderSummary;
    topOrders: TopOrder[];
}

// --- Financeiro ---
export interface FinancialSummary {
    revenue: number;
    cost: number;
    profit: number;
    margin: number;
}

export interface RecentSale {
    name: string;
    value: number;
}

export interface MonthlyRevenue {
    month: string;
    value: number;
}

export interface FinancialDashboardData {
    summary: FinancialSummary;
    recentSales: RecentSale[];
    monthlyRevenue: MonthlyRevenue[];
}

// --- Clientes ---
export interface CustomersSummary {
    total: number;
    totalChange: number;
    new: number;
    newChange: number;
    retention: number;
    retentionChange: number;
    avgTicket: number;
    avgTicketChange: number;
    frequency: number;
    frequencyChange: number;
    nps: number;
    npsChange: number;
}

export interface MonthlyCustomerReport {
    month: string; // 'Jan', 'Feb', etc
    count: number; // número de clientes
}

export interface TopCustomer {
    name: string;
    value: number; // valor total pago pelo cliente
}

export interface CustomersDashboardData {
    summary: CustomersSummary;
    customerReport: {
        monthly: MonthlyCustomerReport[];
    };
    topCustomers: TopCustomer[];
}

// --- Promoções ---
export interface PromotionUsage {
    name: string;
    totalUsed: number;
}

export interface PromotionsDashboardData {
    promotions: PromotionUsage[];
}
