import mongoose from 'mongoose';
import '../types/express/dashboard.types';
import { Request, Response } from "express";
import { OrderModel as Order } from "../models/Order";
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


export const getOrdersDashboardDataController = async (req: Request, res: Response) => {
  try {
    const filter = req.dashboardFilter || {};

    // Totais simples
    const [total, completed, paid, cancelled] = await Promise.all([
      Order.countDocuments(filter),
      Order.countDocuments({ ...filter, status: "completed" }),
      Order.countDocuments({ ...filter, status: "processing" }),
      Order.countDocuments({ ...filter, status: "paid" }),
      Order.countDocuments({ ...filter, status: "cancelled" }),
    ]);

    // Top 5 itens mais pedidos
    const topOrdersAgg = await Order.aggregate([
      { $match: filter },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.name",
          value: { $sum: "$items.quantity" },
        },
      },
      { $sort: { value: -1 } },
      { $limit: 5 },
      { $project: { _id: 0, name: "$_id", value: 1 } },
    ]);

    // Pedidos por mês (últimos meses) – usando util existente
    const orders = await Order.find(filter);
    const ordersByMonth = groupOrdersByMonth(orders);

    return res.json({
      summary: { total, completed, paid, cancelled },
      topOrders: topOrdersAgg,
      ordersByMonth,
    });
  } catch (error) {
    console.error("[DASHBOARD ORDERS]", error);
    return res
      .status(500)
      .json({ message: "Erro ao carregar dados do dashboard de pedidos." });
  }
};

