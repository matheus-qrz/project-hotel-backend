import '../types/express/dashboard.types';
import { Request, Response } from "express";
import { OrderModel as Order } from "../models/Order";
import { buildDashboardFilterFromRequest } from "../utils/dashboardFilter";
import {
  CustomersDashboardData,
  CustomersSummary,
  FinancialDashboardData,
  FinancialSummary,
  MonthlyCustomerReport,
  OrderSummary,
  OrdersDashboardData,
  PromotionUsage,
  PromotionsDashboardData,
  RecentSale,
  TopCustomer,
  TopOrder
} from '../types/dashboard';
import { groupOrdersByMonth } from '../utils/aggregation';

// ------------------ FINANCIAL DASHBOARD ------------------
export const getFinancialDashboardDataController = async (
  req: Request,
  res: Response
) => {
  try {
    const filter = buildDashboardFilterFromRequest(req);

    const summary = await Order.aggregate([
      {
        $match: {
          ...filter,
          status: 'paid'
        }
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$totalAmount' },
          cost: { $sum: '$financialMetrics.costPrice' },
          profit: { $sum: '$financialMetrics.profit' },
          discounts: { $sum: '$financialMetrics.promotionalDiscount' }
        }
      }
    ]);

    const recentSales = await Order.find({
      ...filter,
      status: 'paid'
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('guestInfo.name totalAmount sessionId')
      .lean();

    const formattedSales = recentSales.map((sale) => ({
      name: sale.guestInfo?.name || `Cliente ${sale.sessionId?.substring(0, 5)}`,
      value: sale.totalAmount
    }));

    return res.status(200).json({
      summary: summary[0] || {},
      recentSales: formattedSales
    });
  } catch (error) {
    console.error('Erro ao gerar dashboard financeiro:', error);
    return res.status(500).json({ message: 'Erro ao gerar dashboard financeiro' });
  }
};

// ------------------ CUSTOMERS DASHBOARD ------------------
export const getCustomersDashboardDataController = async (req: Request, res: Response) => {
  try {
    const filter = buildDashboardFilterFromRequest(req);

    const summary: CustomersSummary = {
      total: 254,
      totalChange: 12,
      new: 38,
      newChange: 5,
      retention: 82,
      retentionChange: 3,
      avgTicket: 49.95,
      avgTicketChange: 1.5,
      frequency: 2,
      frequencyChange: 1,
      nps: 80,
      npsChange: 2
    };

    const customerReport: { monthly: MonthlyCustomerReport[] } = {
      monthly: [
        { month: 'Jan', count: 35 },
        { month: 'Feb', count: 42 },
        { month: 'Mar', count: 38 },
        { month: 'Apr', count: 49 },
        { month: 'May', count: 57 },
        { month: 'Jun', count: 33 }
      ]
    };

    const topCustomers: TopCustomer[] = await Order.aggregate([
      {
        $match: {
          ...filter,
          status: 'paid',
          'guestInfo.id': { $ne: null }
        }
      },
      {
        $group: {
          _id: '$guestInfo.id',
          name: { $first: '$guestInfo.name' },
          value: { $sum: '$totalAmount' }
        }
      },
      {
        $sort: { value: -1 }
      },
      {
        $limit: 5
      }
    ]);

    return res.status(200).json({
      summary,
      customerReport,
      topCustomers
    });
  } catch (error) {
    console.error('Erro ao gerar dashboard de clientes:', error);
    return res.status(500).json({ message: 'Erro ao gerar dashboard de clientes' });
  }
};

// ------------------ PROMOTIONS DASHBOARD ------------------
export const getPromotionsDashboardController = async (req: Request, res: Response) => {
  try {
    const filter = buildDashboardFilterFromRequest(req);

    const promotions = await Order.aggregate([
      {
        $match: {
          ...filter,
          status: 'paid',
          'items.addons.promotionId': { $exists: true, $ne: null }
        }
      },
      {
        $unwind: '$items'
      },
      {
        $unwind: '$items.addons'
      },
      {
        $match: {
          'items.addons.promotionId': { $exists: true, $ne: null }
        }
      },
      {
        $group: {
          _id: '$items.addons.promotionId',
          totalUsed: { $sum: 1 },
          name: { $first: '$items.addons.name' }
        }
      },
      {
        $sort: { totalUsed: -1 }
      }
    ]);

    return res.status(200).json({ promotions });
  } catch (error) {
    console.error('Erro ao gerar dashboard de promoções:', error);
    return res.status(500).json({ message: 'Erro ao gerar dashboard de promoções' });
  }
};

// ------------------ ORDERS DASHBOARD ------------------
export const getOrdersDashboardDataController = async (req: Request, res: Response) => {
  try {
    const filter = req.dashboardFilter || {};

    // Totais simples (já existentes)
    const [total, completed, paid, cancelled] = await Promise.all([
      Order.countDocuments(filter),
      Order.countDocuments({ ...filter, status: 'completed' }),
      Order.countDocuments({ ...filter, status: 'paid' }),
      Order.countDocuments({ ...filter, status: 'cancelled' }),
    ]);

    // Top 5 itens mais pedidos
    const topOrdersAgg = await Order.aggregate([
      { $match: filter },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.name',
          value: { $sum: '$items.quantity' }
        }
      },
      { $sort: { value: -1 } },
      { $limit: 5 },
      {
        $project: {
          _id: 0,
          name: '$_id',
          value: 1
        }
      }
    ]);

    // Pedidos por mês
    const orders = await Order.find(filter);
    const ordersByMonth = groupOrdersByMonth(orders);

    return res.json({
      summary: { total, completed, paid, cancelled },
      topOrders: topOrdersAgg,
      ordersByMonth
    });
  } catch (error) {
    console.error('[DASHBOARD ORDERS]', error);
    return res.status(500).json({ message: 'Erro ao carregar dados do dashboard de pedidos.' });
  }
};
