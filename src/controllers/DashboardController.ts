import mongoose from 'mongoose';
import '../types/express/dashboard.types';
import { Request, Response } from "express";
import { OrderModel as Order, OrderModel } from "../models/Order";
import { RestaurantUnitModel as RestaurantUnit } from '../models/RestaurantUnit';
import { buildDashboardFilterFromRequest } from "../utils/dashboardFilter";
import {
  CustomersSummary,
  FinancialSummary,
  MonthlyCustomerReport,
  TopCustomer,
} from '../types/dashboard';
import { groupOrdersByMonth } from '../utils/aggregation';
import { resolveTimeWindow } from '../helpers/timeWindow';
import { fillBuckets } from '../helpers/fillBuckets';

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
    } else if (scope === "restaurant") {
      const units = await RestaurantUnit.find({ restaurant: restaurantOrUnitId })
        .select("_id")
        .lean();

      const unitIds = units.map(u => u._id as mongoose.Types.ObjectId);

      // inclui SEMPRE a matriz (há bases onde pedidos da matriz usam o próprio restaurantId em restaurantUnit)
      const ids = [...unitIds, restaurantOrUnitId];

      matchFilter.restaurantUnit = { $in: ids };
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
      return res.status(400).json({ message: "Parâmetros inválidos" });
    }

    const targetId = new mongoose.Types.ObjectId(String(id));

    // ---- filtro base por restaurante/unidade + somente pedidos pagos e com guest definido
    let matchFilter: any = {
      status: "paid",
      "guestInfo.id": { $ne: null }
    };

    if (scope === "unit") {
      matchFilter.restaurantUnit = targetId;
    } else if (scope === "restaurant") {
      const units = await RestaurantUnit.find({ restaurant: targetId }).select("_id").lean();
      const unitIds = units.map(u => u._id as mongoose.Types.ObjectId);
      matchFilter.restaurantUnit = { $in: unitIds.length ? unitIds : [targetId] };
    } else {
      return res.status(400).json({ message: "Escopo inválido" });
    }

    // ---- janela temporal (today | week | 6m | 12m)
    const period = (req.query.period as any) || "6m";
    const { start, end, bucket, points, tz } = resolveTimeWindow(period);
    const dateFilter = { createdAt: { $gte: start, $lt: end } };
    const base = { ...matchFilter, ...dateFilter };

    // ============================
    // 1) Top clientes (na janela)
    // ============================
    const topCustomers: TopCustomer[] = await Order.aggregate([
      { $match: base },
      {
        $group: {
          _id: "$guestInfo.id",
          name: { $first: "$guestInfo.name" },
          value: { $sum: { $ifNull: ["$totalAmount", 0] } },
        },
      },
      { $sort: { value: -1 } },
      { $limit: 5 },
    ]);

    // =======================================================
    // 2) Série temporal: clientes ÚNICOS por bucket (hora/dia/mês)
    //    - agrupa (bucket, guestId) e depois conta distintos
    // =======================================================
    const uniqPerBucket = await Order.aggregate([
      { $match: base },
      {
        $group: {
          _id: {
            bucket: { $dateTrunc: { date: "$createdAt", unit: bucket, timezone: tz } },
            guestId: "$guestInfo.id",
          },
        },
      },
      { $group: { _id: "$_id.bucket", value: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, bucket: "$_id", value: 1 } },
    ]);

    const seriesFilled = fillBuckets(uniqPerBucket, { start, points, bucket });
    // compat com o front atual: "customerReport.monthly"
    const monthlyFormatted: MonthlyCustomerReport[] = seriesFilled.map(({ label, value }) => ({
      month: label,
      count: value,
    }));

    // =========================================
    // 3) Summary na janela (+ variação anterior)
    // =========================================
    // total clientes únicos e visitas por cliente (na janela)
    const totalAgg = await Order.aggregate([
      { $match: base },
      {
        $group: {
          _id: "$guestInfo.id",
          name: { $first: "$guestInfo.name" },
          totalSpent: { $sum: { $ifNull: ["$totalAmount", 0] } },
          visits: { $sum: 1 },
        },
      },
    ]);

    const total = totalAgg.length;
    const totalVisits = totalAgg.reduce((acc, c) => acc + (c as any).visits, 0);
    const avgTicket = totalAgg.length
      ? totalAgg.reduce((acc, c: any) => acc + (c.totalSpent ?? 0), 0) / totalAgg.length
      : 0;
    const frequency = total > 0 ? Number((totalVisits / total).toFixed(2)) : 1;

    // "Novos" clientes (primeira compra na vida aconteceu DENTRO da janela)
    const newReturningAgg = await Order.aggregate([
      { $match: base },
      { $group: { _id: "$guestInfo.id" } },
      {
        $lookup: {
          from: "orders",
          let: { gid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$guestInfo.id", "$$gid"] },
                    { $lt: ["$createdAt", start] },
                    { $eq: ["$status", "paid"] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: "prior",
        },
      },
      { $project: { isNew: { $eq: [{ $size: "$prior" }, 0] } } },
      {
        $group: {
          _id: null,
          new: { $sum: { $cond: ["$isNew", 1, 0] } },
          returning: { $sum: { $cond: ["$isNew", 0, 1] } },
        },
      },
    ]);

    const newCustomers = newReturningAgg?.[0]?.new ?? 0;
    const returningCustomers = newReturningAgg?.[0]?.returning ?? Math.max(total - newCustomers, 0);

    // variação vs. janela anterior (mesma duração)
    const winMs = end.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - winMs);
    const prevEnd = new Date(start.getTime());

    const prevBase = { ...matchFilter, createdAt: { $gte: prevStart, $lt: prevEnd } };
    const prevTotalCountAgg = await Order.aggregate([
      { $match: prevBase },
      { $group: { _id: "$guestInfo.id" } },
      { $count: "n" },
    ]);
    const prevTotal = prevTotalCountAgg?.[0]?.n ?? 0;
    const totalChange = prevTotal ? ((total - prevTotal) / prevTotal) * 100 : 0;

    const summary: CustomersSummary = {
      total,
      totalChange: Number(totalChange.toFixed(1)),
      new: newCustomers,
      newChange: 0, // (opcional: calcule vs janela anterior também)
      retention: total ? Math.round((returningCustomers / total) * 100) : 0,
      retentionChange: 0,
      avgTicket: Number(avgTicket.toFixed(2)),
      avgTicketChange: 0,
      frequency,
      frequencyChange: 0,
      nps: 0,
      npsChange: 0,
    };

    return res.status(200).json({
      summary,
      customerReport: {
        monthly: monthlyFormatted, // compat com front atual
      },
      topCustomers,
      // série completa padronizada (útil se você quiser evoluir o front)
      series: { period, bucket, timezone: tz, points, data: seriesFilled },
    });
  } catch (error) {
    console.error("Erro ao gerar dashboard de clientes:", error);
    return res.status(500).json({ message: "Erro ao gerar dashboard de clientes" });
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
          status: "paid",
          "items.addons.promotionId": { $exists: true, $ne: null },
        },
      },
      { $unwind: "$items" },
      { $unwind: "$items.addons" },
      {
        $match: {
          "items.addons.promotionId": { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$items.addons.promotionId",
          totalUsed: { $sum: 1 },
          name: { $first: "$items.addons.name" },
        },
      },
      { $sort: { totalUsed: -1 } },
    ]);

    return res.status(200).json({ promotions });
  } catch (error) {
    console.error("Erro ao gerar dashboard de promoções:", error);
    return res
      .status(500)
      .json({ message: "Erro ao gerar dashboard de promoções" });
  }
};

// ------------------ ORDERS DASHBOARD ------------------
export const getOrdersDashboardDataController = async (req: Request, res: Response) => {
  try {
    const { scope, restaurantId, unitId } = req.query as {
      scope: "restaurant" | "unit";
      restaurantId?: string;
      unitId?: string;
    };

    const matchBase: any = {};
    if (scope === "restaurant" && restaurantId) matchBase.restaurantId = restaurantId;
    if (scope === "unit" && unitId) matchBase.unitId = unitId;

    // Hoje (timezone do servidor). Se quiser, troque para fuso fixo de Brasília.
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    const endOfToday = new Date(); endOfToday.setHours(23,59,59,999);

    // Últimos 6 meses para o gráfico
    const from6m = new Date();
    from6m.setMonth(from6m.getMonth() - 5);
    from6m.setDate(1); from6m.setHours(0,0,0,0);

    const [agg] = await OrderModel.aggregate([
      { $match: matchBase },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                total:       { $sum: 1 },
                completed:   { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
                paid:        { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
                cancelled:   { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
                processing:  { $sum: { $cond: [{ $eq: ["$status", "processing"] }, 1, 0] } },
                // pedidos criados hoje e NÃO cancelados
                todayTotal:  { $sum: { 
                  $cond: [
                    { $and: [
                      { $gte: ["$createdAt", startOfToday] },
                      { $lte: ["$createdAt", endOfToday]   },
                      { $ne:  ["$status", "cancelled"]     }
                    ]},
                    1, 0
                  ] 
                } },
              }
            },
            { $project: { _id: 0 } }
          ],
          ordersByMonth: [
            { $match: { createdAt: { $gte: from6m } } },
            {
              $group: {
                _id: { y: { $year: "$createdAt" }, m: { $month: "$createdAt" } },
                value: { $sum: 1 }
              }
            },
            { $sort: { "_id.y": 1, "_id.m": 1 } },
            {
              $project: {
                _id: 0,
                month: {
                  $let: {
                    vars: { m: "$_id.m" },
                    in: {
                      $arrayElemAt: [
                        ["", "jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."],
                        "$$m"
                      ]
                    }
                  }
                },
                value: 1
              }
            }
          ],
          topOrders: [
            // mantenha seu pipeline atual
          ]
        }
      }
    ]);

    const summary = (agg?.summary?.[0]) ?? { total:0, completed:0, paid:0, cancelled:0, processing:0, todayTotal:0 };

    return res.json({
      summary,
      ordersByMonth: agg?.ordersByMonth ?? [],
      topOrders: agg?.topOrders ?? []
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Erro ao carregar dashboard de pedidos" });
  }
};
