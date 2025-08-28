import mongoose from 'mongoose';
import '../types/express/dashboard.types';
import { Request, Response } from "express";
import { OrderModel as Order, OrderModel } from "../models/Order";
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

    const totalOrders = await Order.countDocuments(matchFilter);

    const summary = {
      revenue:   summaryAgg?.revenue   ?? 0,
      cost:      summaryAgg?.cost      ?? 0,
      profit:    summaryAgg?.profit    ?? 0,
      avgTicket: totalOrders > 0 ? (summaryAgg?.revenue ?? 0) / totalOrders : 0,
      margin:    summaryAgg?.revenue > 0 ? (summaryAgg?.profit ?? 0) / summaryAgg.revenue * 100 : 0
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
    const scope = (req.params as any)?.scope ?? (req.query as any)?.scope;
    const id    = (req.params as any)?.id    ?? (req.query as any)?.id;

    if (!scope || !id || !mongoose.isValidObjectId(String(id))) {
      return res.status(400).json({ message: 'Parâmetros inválidos' });
    }

    const targetId = new mongoose.Types.ObjectId(id);
    let matchFilter: any = {
      status: 'paid',
      'guestInfo.id': { $ne: null }
    };

    if (scope === 'unit') {
      matchFilter.restaurantUnit = targetId;
    } else if (scope === 'restaurant') {
      const units = await RestaurantUnit.find({ restaurant: targetId }).select('_id').lean();
      const unitIds = [
        ...units.map(u => u._id as mongoose.Types.ObjectId),
        targetId
      ];
      matchFilter.restaurantUnit = { $in: unitIds };
    } else {
      return res.status(400).json({ message: 'Escopo inválido' });
    }

    // ============================
    // 1. Top Clientes
    // ============================
    const topCustomers: TopCustomer[] = await Order.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$guestInfo.id',
          name: { $first: '$guestInfo.name' },
          value: { $sum: { $ifNull: ['$totalAmount', 0] } }
        }
      },
      { $sort: { value: -1 } },
      { $limit: 5 }
    ]);

    // ============================
    // 2. Clientes por mês (últimos 12 meses)
    // ============================
    // Calcula o intervalo dos últimos 12 meses
    const nowDate = new Date();
    const endYear = nowDate.getFullYear();
    const endMonth = nowDate.getMonth();
    const startDate = new Date(endYear, endMonth - 11, 1);
    const startYear = startDate.getFullYear();
    const startMonth = startDate.getMonth();

    const monthlyCustomerReport = await OrderModel.aggregate([
      {
        $match: {
          isPaid: true,
          createdAt: {
            $gte: new Date(startYear, startMonth, 1),
            $lte: new Date(endYear, endMonth + 1, 0),
          },
          "guestInfo.id": { $ne: null },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            guestId: "$guestInfo.id",
          },
        },
      },
      {
        $group: {
          _id: {
            year: "$_id.year",
            month: "$_id.month",
          },
          count: { $sum: 1 }, // número de clientes únicos por mês
        },
      },
      {
        $sort: {
          "_id.year": 1,
          "_id.month": 1,
        },
      },
    ]);

    // Transforma em formato esperado pelo frontend
    const monthlyFormatted: MonthlyCustomerReport[] = Array.from({ length: 12 }).map((_, i) => {
      const item = monthlyCustomerReport.find((r) => r._id.month === i + 1);
      const month = new Date(2025, i).toLocaleString("pt-BR", { month: "short" });
      return {
        month: month.toLowerCase(),
        count: item?.count || 0,
      };
    });

    // ============================
    // 3. Resumo (mockado ou baseado em dados reais, ex. para retention ou média de ticket)
    // ============================
    const totalAgg = await Order.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$guestInfo.id',
          name: { $first: '$guestInfo.name' },
          totalSpent: { $sum: { $ifNull: ['$totalAmount', 0] } },
          visits: { $sum: 1 }
        }
      }
    ]);

    const total = totalAgg.length;
    const newCustomers = Math.floor(total * 0.3); // ajuste se quiser lógica real
    const returningCustomers = total - newCustomers;

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const lastMonth = new Date(currentYear, currentMonth - 2); // -1 pois Date usa 0-index
    const lastMonthValue = lastMonth.getMonth() + 1;
    const lastMonthYear = lastMonth.getFullYear();
    const monthlyByGuest = await Order.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: {
            y: { $year: '$createdAt' },
            m: { $month: '$createdAt' },
            guestId: '$guestInfo.id'
          }
        }
      }
    ]);

    const grouped = monthlyByGuest.reduce((acc, doc) => {
      const { y, m } = doc._id;
      const key = `${y}-${m}`;
      if (!acc[key]) acc[key] = new Set();
      acc[key].add(doc._id.guestId);
      return acc;
    }, {} as Record<string, Set<string>>);


    const totalThisMonth = grouped[`${currentYear}-${currentMonth}`]?.size || 0;
    const totalLastMonth = grouped[`${lastMonthYear}-${lastMonthValue}`]?.size || 0;
    const totalChange = totalLastMonth
      ? ((totalThisMonth - totalLastMonth) / totalLastMonth) * 100
      : 0;

    const summary: CustomersSummary = {
      total,
      totalChange: Number(totalChange.toFixed(1)),           
      new: newCustomers,
      newChange: 2,
      retention: returningCustomers > 0 ? Math.round((returningCustomers / total) * 100) : 0,
      retentionChange: 1,
      avgTicket: totalAgg.length
        ? totalAgg.reduce((acc, c) => acc + c.totalSpent, 0) / totalAgg.length
        : 0,
      avgTicketChange: 1.2,
      frequency: totalAgg.length
        ? Number((totalAgg.reduce((acc, c) => acc + c.visits, 0) / totalAgg.length).toFixed(2))
        : 1,
      frequencyChange: 0.5,
      nps: 0, // mockado por enquanto
      npsChange: 2
    };


    return res.status(200).json({
      summary,
      customerReport: {
      monthly: monthlyFormatted,
      },
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
