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

    const period = (req.query.period as any) || "6m";         // "today" | "week" | "6m" | "12m"
    const { start, end, bucket, points, tz } = resolveTimeWindow(period);
    const dateFilter = { createdAt: { $gte: start, $lt: end } };


    // ----- resumo
    const [summaryAgg] = await Order.aggregate([
      { $match: { ...matchFilter, ...dateFilter } },
      {
        $group: {
          _id: null,
          revenue:   { $sum: { $ifNull: ["$totalAmount", 0] } },
          cost:      { $sum: { $ifNull: ["$financialMetrics.costPrice", 0] } },
          profit:    { $sum: { $ifNull: ["$financialMetrics.profit", 0] } },
          discounts: { $sum: { $ifNull: ["$financialMetrics.promotionalDiscount", 0] } },
        },
      },
    ]);

    const totalOrders = await Order.countDocuments({ ...matchFilter, ...dateFilter });
    const summary = {
      revenue: summaryAgg?.revenue ?? 0,
      cost: summaryAgg?.cost ?? 0,
      profit: summaryAgg?.profit ?? 0,
      avgTicket: totalOrders > 0 ? (summaryAgg?.revenue ?? 0) / totalOrders : 0,
      margin: (summaryAgg?.revenue ?? 0) > 0 ? ((summaryAgg?.profit ?? 0) / summaryAgg!.revenue) * 100 : 0,
    };

    // 3) série temporal (respeita timezone e bucket)
    const rawSeries = await Order.aggregate([
      { $match: { ...matchFilter, ...dateFilter } },
      {
        $group: {
          _id: {
            $dateTrunc: { date: "$createdAt", unit: bucket, timezone: tz },
          },
          value: { $sum: { $ifNull: ["$totalAmount", 0] } },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, bucket: "$_id", value: 1 } },
    ]);

    // preencher buckets vazios e montar rótulo
    const series = fillBuckets(rawSeries, { start, points, bucket });

    // compat: manter "monthlyRevenue" usando a mesma estrutura { month, value }
    const monthlyRevenue = series.map(({ label, value }) => ({ month: label, value }));

    // 4) vendas recentes (restritas à janela)
    const recentSalesDb = await Order.find({ ...matchFilter, ...dateFilter })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("guestInfo.name totalAmount")
      .lean();

    const recentSales = (recentSalesDb ?? []).map((s) => ({
      name: s.guestInfo?.name ?? "Cliente",
      value: s.totalAmount ?? 0,
    }));

    return res.status(200).json({
      summary,
      monthlyRevenue,         // mantém chave compatível
      recentSales,
      // novo payload geral de série (se quiser usar no front depois)
      series: { period, bucket, timezone: tz, points, data: series },
    });
  } catch (error) {
    console.error("Erro ao gerar dashboard financeiro:", error);
    return res.status(500).json({ message: "Erro ao gerar dashboard financeiro" });
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
    // Filtro base (escopo: restaurant/unit) que você já possui
    const filter = buildDashboardFilterFromRequest(req);

    // Janela temporal (today | week | 6m | 12m)
    const period = (req.query.period as any) || "6m";
    const { start, end, bucket, points, tz } = resolveTimeWindow(period);

    // Match completo: escopo + status pago + janela + existência de promotionId
    const match = {
      ...filter,
      status: "paid",
      createdAt: { $gte: start, $lt: end },
      "items.addons.promotionId": { $exists: true, $ne: null },
    };

    // Top promoções na janela (total de usos por promotionId)
    const promotions = await Order.aggregate([
      { $match: match },
      { $unwind: "$items" },
      { $unwind: "$items.addons" },
      { $match: { "items.addons.promotionId": { $exists: true, $ne: null } } },
      {
        $group: {
          _id: "$items.addons.promotionId",
          totalUsed: { $sum: 1 },
          name: { $first: "$items.addons.name" },
        },
      },
      { $sort: { totalUsed: -1 } },
    ]);

    // Série temporal (total de usos de promoções por bucket, respeitando timezone)
    const rawSeries = await Order.aggregate([
      { $match: match },
      { $unwind: "$items" },
      { $unwind: "$items.addons" },
      { $match: { "items.addons.promotionId": { $exists: true, $ne: null } } },
      {
        $group: {
          _id: { $dateTrunc: { date: "$createdAt", unit: bucket, timezone: tz } },
          value: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, bucket: "$_id", value: 1 } },
    ]);

    const series = fillBuckets(rawSeries, { start, points, bucket });

    return res.status(200).json({
      promotions,
      series: { period, bucket, timezone: tz, points, data: series },
    });
  } catch (error) {
    console.error("Erro ao gerar dashboard de promoções:", error);
    return res.status(500).json({ message: "Erro ao gerar dashboard de promoções" });
  }
};

export const getOrdersDashboardDataController = async (req: Request, res: Response) => {
  try {
    // --- Descobrir escopo + id tanto por params quanto por query (fallback) ---
    const scopeParam = (req.params as any)?.scope ?? (req.query as any)?.scope;
    const idParamRaw =
      (req.params as any)?.id ??
      (req.query as any)?.id ??
      ((req.query as any)?.unitId || (req.query as any)?.restaurantId);

    // Se escopo não vier explícito, inferir por presence de unitId/restaurantId na query
    const scope =
      scopeParam ??
      (((req.query as any)?.unitId && "unit") ||
        ((req.query as any)?.restaurantId && "restaurant") ||
        undefined);

    if (!scope || !idParamRaw || !mongoose.isValidObjectId(String(idParamRaw))) {
      return res.status(400).json({ message: "Parâmetros inválidos" });
    }

    const targetId = new mongoose.Types.ObjectId(String(idParamRaw));

    // --- Filtro base por restaurante/unidade (NÃO depender de req.dashboardFilter) ---
    // Ajuste o campo conforme seu schema; aqui usamos "restaurantUnit" como nos outros controllers.
    let matchFilter: any = {};
    if (scope === "unit") {
      matchFilter.restaurantUnit = targetId;
    } else if (scope === "restaurant") {
      // pegar as unidades da matriz e filtrar pelos IDs das unidades
      const units = await RestaurantUnit.find({ restaurant: targetId })
        .select("_id")
        .lean();
      const unitIds = units.map((u) => u._id as mongoose.Types.ObjectId);
      matchFilter.restaurantUnit = { $in: unitIds };
    } else {
      return res.status(400).json({ message: "Escopo inválido" });
    }

    // --- Janela temporal: today | week | 6m | 12m (default 6m) ---
    const period = ((req.query.period as any) || "6m") as "today" | "week" | "6m" | "12m";
    const { start, end, bucket, points, tz } = resolveTimeWindow(period);

    const dateFilter = { createdAt: { $gte: start, $lt: end } };
    const match = { ...matchFilter, ...dateFilter };

    // --- SUMÁRIOS (restritos à janela) ---
    const [total, completed, paid, cancelled] = await Promise.all([
      Order.countDocuments(match),
      Order.countDocuments({ ...match, status: "completed" }),
      Order.countDocuments({ ...match, status: "paid" }),
      Order.countDocuments({ ...match, status: "cancelled" }),
    ]);

    // --- TOP itens na janela ---
    const topOrdersAgg = await Order.aggregate([
      { $match: match },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.name",
          value: { $sum: { $ifNull: ["$items.quantity", 0] } },
        },
      },
      { $sort: { value: -1 } },
      { $limit: 5 },
      { $project: { _id: 0, name: "$_id", value: 1 } },
    ]);

    // --- Série temporal com $dateTrunc respeitando timezone ---
    const seriesAgg = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: "$createdAt",
              unit: bucket, // "hour" | "day" | "month"
              timezone: tz,
            },
          },
          value: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, bucket: "$_id", value: 1 } },
    ]);

    // --- Preencher buckets vazios (para o gráfico não "pular") ---
    const filled = (() => {
      const out: { label: string; value: number; bucket: Date }[] = [];
      const cur = new Date(start);
      const step =
        bucket === "hour"
          ? (d: Date) => d.setUTCHours(d.getUTCHours() + 1)
          : bucket === "day"
          ? (d: Date) => d.setUTCDate(d.getUTCDate() + 1)
          : (d: Date) => d.setUTCMonth(d.getUTCMonth() + 1);

      const map = new Map<string, number>();
      for (const r of seriesAgg) map.set(new Date(r.bucket).toISOString(), r.value);

      for (let i = 0; i < points; i++) {
        const key = cur.toISOString();
        const v = map.get(key) ?? 0;

        let label: string;
        if (bucket === "hour") label = cur.toISOString().slice(11, 13) + "h";
        else if (bucket === "day") {
          const mm = String(cur.getUTCMonth() + 1).padStart(2, "0");
          const dd = String(cur.getUTCDate()).padStart(2, "0");
          label = `${dd}/${mm}`; // DD/MM
        } else {
          // YYYY-MM ou mmm — escolha um; aqui manteremos YYYY-MM para estabilidade
          label = cur.toISOString().slice(0, 7);
        }

        out.push({ label, value: v, bucket: new Date(cur) });
        step(cur);
      }
      return out;
    })();

    return res.json({
      summary: { total, completed, paid, cancelled },
      topOrders: topOrdersAgg,
      series: {
        period, // "today" | "week" | "6m" | "12m"
        bucket, // "hour" | "day" | "month"
        timezone: tz,
        points,
        data: filled, // [{ label, value, bucket }, ...]
      },
    });
  } catch (e) {
    console.error("[DASHBOARD ORDERS]", e);
    return res.status(500).json({ message: "Erro ao carregar dashboard de pedidos." });
  }
};
