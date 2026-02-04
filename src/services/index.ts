// services/dashboardService.ts
import mongoose from "mongoose";
import { OrderModel } from "../models/Order";
import { HotelUnitModel } from "../models/HotelUnit";

/**
 * Interface para relatório de faturamento
 */
export interface RevenueReport {
    totalRevenue: number;
    comparisonWithLastPeriod: number; // percentual em relação ao período anterior
    periodRevenue: {
        period: string;
        value: number;
    }[];
    guestVsUserRevenue: {
        guests: number;
        users: number;
        guestPercentage: number;
    };
}

/**
 * Interface para relatório de pedidos
 */
export interface OrdersReport {
    totalOrders: number;
    realizadosHoje: number;
    cancelados: number;
    emProducao: number;
    monthlyOrdersCount: {
        month: string;
        count: number;
    }[];
    ordersByStatus: {
        status: string;
        count: number;
    }[];
    guestVsUserOrders: {
        guests: number;
        users: number;
        guestPercentage: number;
    };
}

/**
 * Obtém um resumo geral do dashboard para uma unidade de hotel específica
 */
export const getDashboardSummary = async (hotelUnitId: string) => {
    // Valida o ID da unidade do hotel
    if (!mongoose.Types.ObjectId.isValid(hotelUnitId)) {
        throw new Error("ID de unidade de hotel inválido");
    }

    // Busca a unidade do hotel para confirmar que existe
    const unit = await HotelUnitModel.findById(hotelUnitId);
    if (!unit) {
        throw new Error("Unidade de hotel não encontrada");
    }

    // Obtém os relatórios
    const revenueReport = await getRevenueReport(hotelUnitId);
    const ordersReport = await getOrdersReport(hotelUnitId);

    // Obtém os produtos mais populares
    const topProducts = await getTopProducts(hotelUnitId, 5);

    return {
        revenue: revenueReport,
        orders: ordersReport,
        topProducts
    };
};

/**
 * Obtém um relatório de faturamento para uma unidade de hotel específica
 */
export const getRevenueReport = async (hotelUnitId: string): Promise<RevenueReport> => {
    // Valida o ID da unidade do hotel
    if (!mongoose.Types.ObjectId.isValid(hotelUnitId)) {
        throw new Error("ID de unidade de hotel inválido");
    }

    // Data atual e últimos 6 meses
    const currentDate = new Date();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(currentDate.getMonth() - 6);

    // Data para comparação do mês anterior
    const lastMonthStart = new Date();
    lastMonthStart.setMonth(currentDate.getMonth() - 1);
    lastMonthStart.setDate(1);
    lastMonthStart.setHours(0, 0, 0, 0);

    const lastMonthEnd = new Date();
    lastMonthEnd.setDate(0); // Último dia do mês anterior
    lastMonthEnd.setHours(23, 59, 59, 999);

    // Data para o mês atual
    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);

    // Obtém todos os pedidos pagos da unidade do hotel nos últimos 6 meses
    const orders = await OrderModel.find({
        'hotelUnit': hotelUnitId,
        'isPaid': true,
        'createdAt': { $gte: sixMonthsAgo },
        'status': { $ne: 'cancelled' }
    }).sort({ createdAt: 1 });

    // Calcula o faturamento total
    const totalRevenue = orders.reduce((total, order) => total + order.totalAmount, 0);

    // Calcula o faturamento do mês atual
    const currentMonthRevenue = orders
        .filter(order => order.createdAt >= currentMonthStart)
        .reduce((total, order) => total + order.totalAmount, 0);

    // Calcula o faturamento do mês anterior
    const lastMonthRevenue = orders
        .filter(order => order.createdAt >= lastMonthStart && order.createdAt <= lastMonthEnd)
        .reduce((total, order) => total + order.totalAmount, 0);

    // Calcula a comparação com o período anterior (em percentual)
    let comparisonWithLastPeriod = 0;
    if (lastMonthRevenue > 0) {
        comparisonWithLastPeriod = ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;
    }

    // Agrupa por mês para o gráfico
    const monthlyRevenue = new Map<string, number>();

    orders.forEach(order => {
        const date = new Date(order.createdAt);
        const month = getMonthName(date.getMonth());

        if (!monthlyRevenue.has(month)) {
            monthlyRevenue.set(month, 0);
        }

        monthlyRevenue.set(month, monthlyRevenue.get(month)! + order.totalAmount);
    });

    // Converte para o formato esperado pelo frontend
    const periodRevenue = Array.from(monthlyRevenue).map(([period, value]) => ({
        period,
        value: Math.round(value * 100) / 100 // Arredonda para 2 casas decimais
    }));

    // Calcula receita de pedidos de convidados vs usuários registrados
    const guestOrders = orders.filter(order => order.isGuest);
    const userOrders = orders.filter(order => !order.isGuest);

    const guestRevenue = guestOrders.reduce((total, order) => total + order.totalAmount, 0);
    const userRevenue = userOrders.reduce((total, order) => total + order.totalAmount, 0);

    const guestPercentage = totalRevenue > 0 ? (guestRevenue / totalRevenue) * 100 : 0;

    return {
        totalRevenue,
        comparisonWithLastPeriod: Math.round(comparisonWithLastPeriod * 100) / 100,
        periodRevenue,
        guestVsUserRevenue: {
            guests: Math.round(guestRevenue * 100) / 100,
            users: Math.round(userRevenue * 100) / 100,
            guestPercentage: Math.round(guestPercentage * 100) / 100
        }
    };
};

/**
 * Obtém um relatório de pedidos para uma unidade de hotel específica
 */
export const getOrdersReport = async (hotelUnitId: string): Promise<OrdersReport> => {
    // Valida o ID da unidade do hotel
    if (!mongoose.Types.ObjectId.isValid(hotelUnitId)) {
        throw new Error("ID de unidade de hotel inválido");
    }

    // Data atual e últimos 6 meses
    const currentDate = new Date();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(currentDate.getMonth() - 6);

    // Data para hoje
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Obtém todos os pedidos da unidade do hotel nos últimos 6 meses
    const orders = await OrderModel.find({
        'hotelUnit': hotelUnitId,
        'createdAt': { $gte: sixMonthsAgo }
    }).sort({ createdAt: 1 });

    // Total de pedidos
    const totalOrders = orders.length;

    // Pedidos realizados hoje
    const realizadosHoje = orders.filter(order =>
        order.createdAt >= todayStart
    ).length;

    // Pedidos cancelados
    const cancelados = orders.filter(order =>
        order.status === 'cancelled'
    ).length;

    // Pedidos em produção
    const emProducao = orders.filter(order =>
        order.status === 'processing'
    ).length;

    // Agrupa por mês para o gráfico
    const monthlyOrders = new Map<string, number>();

    orders.forEach(order => {
        const date = new Date(order.createdAt);
        const month = getMonthName(date.getMonth());

        if (!monthlyOrders.has(month)) {
            monthlyOrders.set(month, 0);
        }

        monthlyOrders.set(month, monthlyOrders.get(month)! + 1);
    });

    // Converter para o formato esperado pelo frontend
    const monthlyOrdersCount = Array.from(monthlyOrders).map(([month, count]) => ({
        month,
        count
    }));

    // Contar pedidos por status
    const statusCount = new Map<string, number>();

    orders.forEach(order => {
        if (!statusCount.has(order.status)) {
            statusCount.set(order.status, 0);
        }

        statusCount.set(order.status, statusCount.get(order.status)! + 1);
    });

    const ordersByStatus = Array.from(statusCount).map(([status, count]) => ({
        status,
        count
    }));

    // Contar pedidos de convidados vs usuários registrados
    const guestOrders = orders.filter(order => order.isGuest).length;
    const userOrders = orders.filter(order => !order.isGuest).length;
    const guestPercentage = totalOrders > 0 ? (guestOrders / totalOrders) * 100 : 0;

    return {
        totalOrders,
        realizadosHoje,
        cancelados,
        emProducao,
        monthlyOrdersCount,
        ordersByStatus,
        guestVsUserOrders: {
            guests: guestOrders,
            users: userOrders,
            guestPercentage: Math.round(guestPercentage * 100) / 100
        }
    };
};

/**
 * Obtém os produtos mais vendidos para uma unidade de hotel específica
 */
export const getTopProducts = async (hotelUnitId: string, limit: number = 5) => {
    // Valida o ID da unidade do hotel
    if (!mongoose.Types.ObjectId.isValid(hotelUnitId)) {
        throw new Error("ID de unidade de hotel inválido");
    }

    // Obtém todos os pedidos da unidade do hotel que não foram cancelados
    const orders = await OrderModel.find({
        'hotelUnit': hotelUnitId,
        'status': { $ne: 'cancelled' }
    });

    // Conta a quantidade de cada produto usando o nome como identificador
    const productCount = new Map<string, { count: number, name: string, revenue: number }>();

    orders.forEach(order => {
        order.items.forEach(item => {
            const productName = typeof item.name === 'string' ? item.name : item.name.toString();
            if (!productCount.has(productName)) {
                productCount.set(productName, {
                    count: 0,
                    name: productName,
                    revenue: 0
                });
            }

            const current = productCount.get(productName)!;
            productCount.set(productName, {
                ...current,
                count: current.count + (typeof item.quantity === 'number' ? item.quantity : Number(item.quantity)),
                revenue: current.revenue + (typeof item.price === 'number' ? item.price : Number(item.price)) * (typeof item.quantity === 'number' ? item.quantity : Number(item.quantity))
            });
        });
    });

    // Ordena por quantidade vendida e pega os top N
    const topProducts = Array.from(productCount.entries())
        .map(([name, data]) => ({
            name,
            count: data.count,
            revenue: Math.round(data.revenue * 100) / 100
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);

    return topProducts;
};

/**
 * Obtém um relatório de faturamento diário para um período específico
 */
export const getDailyRevenueReport = async (hotelUnitId: string, startDate: Date, endDate: Date) => {
    // Valida o ID da unidade do hotel
    if (!mongoose.Types.ObjectId.isValid(hotelUnitId)) {
        throw new Error("ID de unidade de hotel inválido");
    }

    // Obtém todos os pedidos pagos da unidade do hotel no período
    const orders = await OrderModel.find({
        'hotelUnit': hotelUnitId,
        'isPaid': true,
        'createdAt': { $gte: startDate, $lte: endDate },
        'status': { $ne: 'cancelled' }
    }).sort({ createdAt: 1 });

    // Agrupa por dia
    const dailyRevenue = new Map<string, number>();

    orders.forEach(order => {
        const date = new Date(order.createdAt);
        const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

        if (!dailyRevenue.has(dayKey)) {
            dailyRevenue.set(dayKey, 0);
        }

        dailyRevenue.set(dayKey, dailyRevenue.get(dayKey)! + order.totalAmount);
    });

    // Converte para o formato esperado pelo frontend
    return Array.from(dailyRevenue).map(([date, value]) => ({
        date,
        value: Math.round(value * 100) / 100 // Arredonda para 2 casas decimais
    }));
};

/**
 * Função auxiliar para obter o nome do mês a partir do índice
 */
function getMonthName(monthIndex: number): string {
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return months[monthIndex];
}