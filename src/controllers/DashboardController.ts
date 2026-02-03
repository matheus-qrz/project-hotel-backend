import mongoose from 'mongoose';
import { Request, Response } from "express";
import { OrderModel as Order } from "../models/Order";
import { RestaurantUnitModel as HotelUnit } from '../models/RestaurantUnit';
import { buildDashboardFilterFromRequest } from "../utils/dashboardFilter";
import {
  CustomersSummary,
  FinancialSummary,
  MonthlyCustomerReport,
  TopCustomer,
} from '../types/dashboard';
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
    const hotelOrUnitId = new mongoose.Types.ObjectId(String(id));

    // ----- monta o filtro base
    let matchFilter: any = { status: 'paid' };

    if (scope === 'hotelUnit') {
      matchFilter.restaurantUnit = hotelOrUnitId;
    } else if (scope === "hotel") {
      const units = await HotelUnit.find({ restaurant: hotelOrUnitId })
        .select("_id")
        .lean();

      const unitIds = units.map(u => u._id as mongoose.Types.ObjectId);

      // inclui SEMPRE a matriz (há bases onde pedidos da matriz usam o próprio hotelId em restaurantUnit)
      const ids = [...unitIds, hotelOrUnitId];

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

    // ---- filtro base por hotel/unidade + somente pedidos pagos e com guest definido
    let matchFilter: any = {
      status: "paid",
      "guestInfo.id": { $ne: null }
    };

    if (scope === "hotelUnit") {
      matchFilter.restaurantUnit = targetId;
    } else if (scope === "hotel") {
      const units = await HotelUnit.find({ restaurant: targetId }).select("_id").lean();
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
    const { scope, hotelId, hotelUnitId } = req.query as {
      scope: "hotel" | "hotelUnit";
      hotelId?: string;
      hotelUnitId?: string;
    };

    let matchBase: any = {};
        if (scope === 'hotelUnit' && hotelUnitId) {
          matchBase.restaurantUnit = new mongoose.Types.ObjectId(String(hotelUnitId));
        } else if (scope === 'hotel' && hotelId) {
          const targetId = new mongoose.Types.ObjectId(String(hotelId));
          const units = await HotelUnit.find({ restaurant: targetId })
            .select('_id').lean();
          const unitIds = units.map(u => u._id as mongoose.Types.ObjectId);
          matchBase.restaurantUnit = { $in: unitIds.length ? unitIds : [targetId] };
        } else {
          return res.status(400).json({ message: 'Parâmetros inválidos' });
        }

    // --- parâmetros de "hoje" (já usados no summary.todayTotal) ---
    const tz = (req.query?.tz as string) || "America/Sao_Paulo";
    const startOfTodayISO = req.query?.startOfTodayISO as string | undefined;
    const endOfTodayISO   = req.query?.endOfTodayISO   as string | undefined;

    let startOfToday: Date;
    let endOfToday: Date;
    if (startOfTodayISO && endOfTodayISO) {
      startOfToday = new Date(startOfTodayISO);
      endOfToday   = new Date(endOfTodayISO);
    } else {
      const now = new Date();
      startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
      endOfToday   = new Date(now); endOfToday.setHours(23, 59, 59, 999);
    }

    // últimos 6 meses para o gráfico
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5, 1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    // filtro para "não cancelados"
     const notCancelled = { ...matchBase, status: { $ne: 'cancelled' } };

    const [agg] = await Order.aggregate([
      { $match: matchBase },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                total:      { $sum: 1 },
                completed:  { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
                paid:       { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
                cancelled:  { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
                processing: { $sum: { $cond: [{ $eq: ["$status", "processing"] }, 1, 0] } },
                todayTotal: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $gte: ["$createdAt", startOfToday] },
                          { $lte: ["$createdAt", endOfToday] },
                          { $ne: ["$status", "cancelled"] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
            { $project: { _id: 0 } },
          ],
          ordersByMonth: [
            { $match: { createdAt: { $gte: sixMonthsAgo } } },
            { $group: { _id: { y: { $year: "$createdAt" }, m: { $month: "$createdAt" } }, value: { $sum: 1 } } },
            { $sort: { "_id.y": 1, "_id.m": 1 } },
            { $project: { _id: 0, monthIndex: { $subtract: ["$_id.m", 1] }, value: 1 } },
          ],

          // ===== Itens mais pedidos (compatível com seu schema) =====
          topOrders: [
            { $match: { ...matchBase, status: { $ne: 'cancelled' } } }, 
            { $unwind: "$items" },
            { $match: { $or: [ { "items.status": { $exists: false } }, { "items.status": { $ne: "cancelled" } } ] } },
            { $group: { _id: "$items.name", value: { $sum: { $ifNull: ["$items.quantity", 1] } } } },
            { $sort: { value: -1 } },
            { $limit: 10 },
            { $project: { _id: 0, name: "$_id", value: 1 } },
          ],

          // ===== Tempo médio: processing -> (completed|paid) =====
          avgDelivery: [
            { $match: { ...matchBase, status: { $in: ["completed", "paid"] } } }, 
            {
              $project: {
                startedAt: {
                  $ifNull: [
                    "$processingAt",
                    { $ifNull: [
                        { $let: {
                            vars: { hit: { $first: {
                              $filter: { input: { $ifNull: ["$statusHistory", []] }, as: "s", cond: { $eq: ["$$s.status", "processing"] } }
                            } } },
                            in: "$$hit.at"
                        }},
                        "$createdAt"
                    ] }
                  ]
                },
                finishedAt: {
                  $ifNull: [
                    "$completedAt",
                    { $ifNull: [
                        { $let: {
                            vars: { hit: { $first: {
                              $filter: { input: { $ifNull: ["$statusHistory", []] }, as: "s", cond: { $eq: ["$$s.status", "completed"] } }
                            } } },
                            in: "$$hit.at"
                        }},
                        "$updatedAt"
                    ] }
                  ]
                },
              }
            },
            { $match: {
                startedAt: { $type: "date" },
                finishedAt: { $type: "date" },
                $expr: { $gt: ["$finishedAt", "$startedAt"] }
            }},
            { $project: { diffMs: { $subtract: ["$finishedAt", "$startedAt"] } } },
            { $match: { diffMs: { $gt: 0 } } },
            { $group: { _id: null, avgMs: { $avg: "$diffMs" } } },
            { $project: { _id: 0, avgMinutes: { $divide: ["$avgMs", 60000] } } },
          ]
        },
      },
    ]);

    const MONTHS_PT = ["jan.","fev.","mar.","abr.","mai.","jun.","jul.","ago.","set.","out.","nov.","dez."];
    const now = new Date();
    const last6Idx = Array.from({ length: 6 }, (_, i) => (now.getMonth() - (5 - i) + 12) % 12);

    const monthMap = new Map<number, number>();
    for (const row of agg?.ordersByMonth ?? []) {
      monthMap.set(row.monthIndex, (monthMap.get(row.monthIndex) ?? 0) + (Number(row.value) || 0));
    }
    const ordersByMonth = last6Idx.map((mi) => ({ month: MONTHS_PT[mi], value: monthMap.get(mi) ?? 0 }));

    const summaryBase =
      agg?.summary?.[0] ?? { total: 0, completed: 0, paid: 0, cancelled: 0, processing: 0, todayTotal: 0 };

    const [avgRes] = await Order.aggregate([
      { $match: { restaurantId: new mongoose.Types.ObjectId(hotelId), status: "completed" } },
      {
        $addFields: {
          startAt: {
            $ifNull: [
              "$statusTimestamps.processing",
              { $ifNull: ["$createdAt", null] }
            ]
          },
          endAt: {
            $ifNull: [
              "$statusTimestamps.completed",
              { $ifNull: ["$completedAt", null] }
            ]
          }
        }
      },
      {
        $match: {
          startAt: { $type: "date" },
          endAt: { $type: "date" },
          $expr: { $gt: ["$endAt", "$startAt"] }
        }
      },
      {
        $project: {
          deltaMin: {
            $divide: [{ $subtract: ["$endAt", "$startAt"] }, 1000 * 60]
          }
        }
      },
      { $group: { _id: null, avgDelivery: { $avg: "$deltaMin" } } }
    ]);

    const averageDeliveryMinutes = Math.round(
      agg?.avgDelivery?.[0]?.avgMinutes ?? 0   // <— sem agg?.[0]
    );

    // topOrders no formato [{ name, value }] (mantém compatibilidade com o front)
    const topOrders = (agg?.topOrders ?? []).map((x: any) => ({
      name: x.name,
      value: x.value,
    }));

    return res.json({
      summary: { 
        ...summaryBase, 
        averageDeliveryMinutes,
        avgTime: averageDeliveryMinutes 
      },
      ordersByMonth,
      topOrders,
      meta: {
        tz,
        startOfTodayISO: startOfToday.toISOString(),
        endOfTodayISO: endOfToday.toISOString(),
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Erro ao carregar dashboard de pedidos" });
  }
};


