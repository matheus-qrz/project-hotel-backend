import mongoose from 'mongoose';
import '../types/express/dashboard.types';
import { Request, Response } from "express";
import { OrderModel as Order } from "../models/Order";
import { RestaurantUnitModel as RestaurantUnit } from '../models/RestaurantUnit';
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
export const getFinancialDashboardDataController = async (req: Request, res: Response) => {
  try {
    const scope = (req.params as any)?.scope ?? (req.query as any)?.scope;
    const id    = (req.params as any)?.id    ?? (req.query as any)?.id;

    if (!scope || !id || !mongoose.isValidObjectId(String(id))) {
      return res.status(400).json({ message: 'Parâmetros inválidos' });
    }
    const restaurantOrUnitId = new mongoose.Types.ObjectId(String(id));

    // ----- monta o filtro base
    let matchFilter: any = { status: 'paid' };

    if (scope === 'unit') {
      matchFilter.restaurantUnit = restaurantOrUnitId;
    } else if (scope === 'restaurant') {
      // 1) busca unidades filhas (se existirem)
      const units = await RestaurantUnit
        .find({ restaurant: restaurantOrUnitId })
        .select('_id')
        .lean();

      // 2) SEMPRE inclui a matriz (restaurantId também vale como restaurantUnit)
      const unitIds = [
        ...units.map(u => u._id as mongoose.Types.ObjectId),
        restaurantOrUnitId
      ];

      matchFilter.restaurantUnit = { $in: unitIds };
    } else {
      return res.status(400).json({ message: 'Escopo inválido' });
    }

    // ----- resumo
    const [summaryAgg] = await Order.aggregate([
      { $match: matchFilter },
      // descomente se houver legado com totalAmount string:
      // { $addFields: { totalAmount: { $toDouble: '$totalAmount' } } },
      {
        $group: {
          _id: null,
          revenue:   { $sum: { $ifNull: ['$totalAmount', 0] } },
          cost:      { $sum: { $ifNull: ['$financialMetrics.costPrice', 0] } },
          profit:    { $sum: { $ifNull: ['$financialMetrics.profit', 0] } },
          discounts: { $sum: { $ifNull: ['$financialMetrics.promotionalDiscount', 0] } }
        }
      }
    ]);

    const summary = {
      revenue:   summaryAgg?.revenue   ?? 0,
      cost:      summaryAgg?.cost      ?? 0,
      profit:    summaryAgg?.profit    ?? 0,
      discounts: summaryAgg?.discounts ?? 0
    };

    // ----- mensal (últimos 6)
    const monthlyAgg = await Order.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' } },
          value: { $sum: { $ifNull: ['$totalAmount', 0] } }
        }
      },
      { $sort: { '_id.y': 1, '_id.m': 1 } }
    ]);

    const monthNames = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    const monthlyRevenue = monthlyAgg.slice(-6).map((d: any) => ({
      month: monthNames[d._id.m - 1],
      value: d.value
    }));

    // ----- vendas recentes
    const recentSalesDb = await Order.find(matchFilter)
      .sort({ createdAt: -1 })
      .limit(5)
      .select('guestInfo.name totalAmount')
      .lean();

    const recentSales = (recentSalesDb ?? []).map((s) => ({
      name: s.guestInfo?.name ?? 'Cliente',
      value: s.totalAmount ?? 0
    }));

    return res.status(200).json({ summary, monthlyRevenue, recentSales });
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
