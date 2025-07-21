import { Request, Response } from "express";
import { OrderModel } from "../models/Order";
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

// ------------------ FINANCIAL DASHBOARD ------------------
export const getFinancialDashboardDataController = async (
  req: Request,
  res: Response
) => {
  try {
    const filter = buildDashboardFilterFromRequest(req);

    const summary = await OrderModel.aggregate([
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

    const recentSales = await OrderModel.find({
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

    const topCustomers: TopCustomer[] = await OrderModel.aggregate([
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

    const promotions = await OrderModel.aggregate([
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
    const filter = buildDashboardFilterFromRequest(req);

    const totalOrders = await OrderModel.countDocuments({ ...filter });

    const completedOrders = await OrderModel.countDocuments({ ...filter, status: 'completed' });
    const paidOrders = await OrderModel.countDocuments({ ...filter, status: 'paid' });
    const cancelledOrders = await OrderModel.countDocuments({ ...filter, status: 'cancelled' });

    const topOrders = await OrderModel.aggregate([
      { $match: { ...filter } },
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
          name: '$_id',
          value: 1,
          _id: 0
        }
      }
    ]);

    return res.status(200).json({
      summary: {
        total: totalOrders,
        completed: completedOrders,
        paid: paidOrders,
        cancelled: cancelledOrders
      },
      topOrders
    });
  } catch (error) {
    console.error('Erro ao gerar dashboard de pedidos:', error);
    return res.status(500).json({ message: 'Erro ao gerar dashboard de pedidos' });
  }
};
