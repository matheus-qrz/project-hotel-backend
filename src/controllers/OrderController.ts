// controllers/OrderController.ts
import mongoose from "mongoose";
import { randomUUID } from "crypto";
import { Request, Response } from "express";
import {
  OrderModel,
  IOrder,
  IOrderItem,
  OrderStatus,
  OrderStatusType,
  OrderItemStatus,
  validateOrder,
  getOpenOrdersByRoom,
} from "../models/Order";

// ─────────────────────────────────────────────
//  Helpers internos
// ─────────────────────────────────────────────

function n0(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Subtotal ignorando itens de cupom/ajuste (price < 0) */
function computeSubtotalWithoutCoupons(order: IOrder): number {
  return (order.items || []).reduce((acc, item) => {
    if (item.price < 0) return acc; // item de desconto/cupom
    if (item.status === OrderItemStatus.CANCELLED) return acc;
    return acc + item.price * item.quantity;
  }, 0);
}

/** Normaliza um item recebido do body antes de persistir */
function normalizeItem(it: any, now: Date): any {
  return {
    ...it,
    status: it.status ?? OrderItemStatus.ADDED,
    createdAt: it.createdAt ? new Date(it.createdAt) : now,
    addons: Array.isArray(it.addons)
      ? it.addons.map((ad: any) => ({
          ...ad,
          status: ad.status ?? OrderItemStatus.ADDED,
          createdAt: ad.createdAt ? new Date(ad.createdAt) : now,
        }))
      : [],
    accompaniments: Array.isArray(it.accompaniments) ? it.accompaniments : [],
    isCombo: !!it.isCombo,
    comboOptions: Array.isArray(it.comboOptions) ? it.comboOptions : [],
    preparationGroups: Array.isArray(it.preparationGroups) ? it.preparationGroups : [],
    serviceCategory: it.serviceCategory ?? it.category ?? undefined,
  };
}

// ─────────────────────────────────────────────
//  INICIAR / ADICIONAR ITENS AO PEDIDO
//  POST /hotels/:hotelId/orders
// ─────────────────────────────────────────────

export const initiateOrderController = async (req: Request, res: Response) => {
  try {
    const hotelId = String(
      req.params.hotelId || req.params.restaurantId || req.body?.hotelId || ""
    ).trim();

    if (!hotelId) {
      return res.status(400).json({ message: "hotelId é obrigatório" });
    }

    const hotelUnit = String(
      req.body?.hotelUnit || req.body?.unitId || req.body?.restaurantUnit || ""
    ).trim();

    if (!hotelUnit) {
      return res.status(400).json({ message: "hotelUnit é obrigatório" });
    }

    const { guestInfo, meta, items, totalAmount, assignedAttendantId, assignedAttendantName } =
      req.body as any;

    // roomId é obrigatório — substitui tableId do sistema de restaurante
    if (!guestInfo?.id || !meta?.roomId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "guestInfo.id, meta.roomId e items (não vazio) são obrigatórios",
      });
    }

    const sessionId =
      typeof req.headers["x-session-id"] === "string" && req.headers["x-session-id"].trim()
        ? String(req.headers["x-session-id"]).trim()
        : randomUUID();

    const now = new Date();
    const status = req.body.status ?? OrderStatus.PROCESSING;
    const itemsNormalized = items.map((it: IOrderItem) => normalizeItem(it, now));

    // Tenta encontrar pedido aberto do mesmo hóspede/quarto/sessão
    const existing = await OrderModel.findOne({
      sessionId,
      hotelId,
      hotelUnit,
      "guestInfo.id": guestInfo.id,
      "meta.roomId": meta.roomId,
      isPaid: false,
      status: { $nin: [OrderStatus.PAID, OrderStatus.CANCELLED] },
    });

    if (existing) {
      // ── Adiciona itens ao pedido existente ──
      await OrderModel.updateOne(
        { _id: existing._id },
        {
          $push: {
            items: { $each: itemsNormalized },
            statusHistory: { status: OrderStatus.PROCESSING, at: now },
          },
          $inc: { totalAmount: n0(totalAmount) },
          $set: {
            updatedAt: now,
            status: OrderStatus.PROCESSING,
            "meta.splitCount": n0(meta?.splitCount) || existing.meta?.splitCount || 1,
            "meta.observations": meta?.observations ?? existing.meta?.observations,
          },
        }
      );

      const updatedDoc = await OrderModel.findById(existing._id);
      return res.status(200).json(updatedDoc);
    }

    // ── Cria novo pedido ──
    const validationError = validateOrder({
      isGuest: !req.body.userId,
      guestInfo,
      meta: { roomId: meta.roomId, splitCount: meta?.splitCount },
    });

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const doc = new OrderModel({
      hotelId,
      hotelUnit,
      sessionId,
      isGuest: !req.body.userId,
      user: req.body.userId || undefined,
      guestInfo: {
        id: guestInfo.id,
        name: guestInfo.name ?? "",
        joinedAt: guestInfo.joinedAt ? new Date(guestInfo.joinedAt) : now,
      },
      items: itemsNormalized,
      status,
      processingAt: status === OrderStatus.PROCESSING ? now : undefined,
      statusHistory: [{ status, at: now }],
      isPaid: false,
      meta: {
        roomId: String(meta.roomId),
        roomDisplayName: meta.roomDisplayName,
        splitCount: n0(meta?.splitCount) || 1,
        observations: meta?.observations,
        sessionGroup: meta?.sessionGroup,
      },
      totalAmount: n0(totalAmount),
      assignedAttendantId: assignedAttendantId || undefined,
      assignedAttendantName: assignedAttendantName || undefined,
    });

    await doc.save();

    res.setHeader("x-session-id", sessionId);
    return res.status(201).json(doc);
  } catch (e: any) {
    console.error("initiateOrderController error:", e);
    return res.status(500).json({ message: "Erro ao iniciar pedido", error: e.message });
  }
};

// ─────────────────────────────────────────────
//  LISTAR PEDIDOS POR QUARTO
//  GET /hotels/:hotelId/units/:unitId/rooms/:roomId/orders
// ─────────────────────────────────────────────

export const listOrdersByRoomController = async (req: Request, res: Response) => {
  try {
    const { hotelId, unitId, roomId } = req.params;
    const { open } = req.query;

    const query: any = {
      hotelId,
      hotelUnit: unitId,
      "meta.roomId": roomId,
    };

    if (open === "true") {
      query.isPaid = false;
      query.status = { $nin: [OrderStatus.CANCELLED, OrderStatus.PAID] };
    }

    const orders = await OrderModel.find(query).sort({ createdAt: -1 });
    return res.status(200).json(orders);
  } catch (e: any) {
    console.error("listOrdersByRoomController error:", e);
    return res.status(500).json({ message: "Erro ao listar pedidos" });
  }
};

// ─────────────────────────────────────────────
//  STATUS DO QUARTO (equivalente a getTableStatus)
//  GET /hotels/:hotelId/units/:unitId/rooms/:roomId/status
// ─────────────────────────────────────────────

export const getRoomOrderStatusController = async (req: Request, res: Response) => {
  try {
    const { hotelId, unitId, roomId } = req.params;

    if (!hotelId || !unitId || !roomId) {
      return res.status(400).json({ message: "hotelId, unitId e roomId são obrigatórios" });
    }

    const orders = await OrderModel.find(
      { hotelId, hotelUnit: unitId, "meta.roomId": roomId },
      { status: 1, isPaid: 1, meta: 1, createdAt: 1, updatedAt: 1 }
    ).lean();

    let hasPaymentRequest = false;
    let hasOpenOrder = false;

    for (const o of orders) {
      const s = String(o.status || "").toLowerCase();
      const isPaid = o.isPaid === true || s === OrderStatus.PAID;
      const hasPayReq = s === OrderStatus.PAYMENT_REQUESTED || (!!o?.meta?.paymentRequestedAt && !isPaid);

      if (hasPayReq) hasPaymentRequest = true;
      if (!isPaid && (s === OrderStatus.PROCESSING || s === OrderStatus.COMPLETED)) hasOpenOrder = true;
    }

    const status = hasPaymentRequest
      ? "payment_requested"
      : hasOpenOrder
      ? "occupied"
      : "free";

    return res.json({ status, roomId, unitId });
  } catch (e: any) {
    console.error("getRoomOrderStatusController error:", e);
    return res.status(500).json({ message: "Erro ao obter status do quarto" });
  }
};

// ─────────────────────────────────────────────
//  ATUALIZAR STATUS DO PEDIDO
//  PATCH /hotels/:hotelId/units/:unitId/orders/:orderId/status
// ─────────────────────────────────────────────

export const updateOrderStatusController = async (req: Request, res: Response) => {
  try {
    const { hotelId, unitId, orderId } = req.params;
    const { status, by } = req.body as { status: OrderStatusType; by?: string };

    if (!Object.values(OrderStatus).includes(status)) {
      return res.status(400).json({ message: "Status inválido" });
    }

    const order = await OrderModel.findOne({ _id: orderId, hotelUnit: unitId });
    if (!order) {
      return res.status(404).json({ message: "Pedido não encontrado" });
    }

    if (!order.canTransitionTo(status)) {
      return res.status(409).json({
        message: `Transição inválida: ${order.status} → ${status}`,
      });
    }

    order.status = status;
    const now = new Date();

    if (status === OrderStatus.COMPLETED) order.completedAt = now;
    if (status === OrderStatus.PAID) {
      order.isPaid = true;
      order.paidAt = now;
    }
    if (status === OrderStatus.PAYMENT_REQUESTED && order.meta) {
      order.meta.paymentRequestedAt = now;
    }
    if (status === OrderStatus.CANCELLED) {
      order.isCancelled = true;
    }

    order.statusHistory.push({
      status,
      at: now,
      by: by ? (new mongoose.Types.ObjectId(by) as any) : undefined,
    });

    await order.save();
    return res.status(200).json(order);
  } catch (e: any) {
    console.error("updateOrderStatusController error:", e);
    return res.status(500).json({ message: "Erro ao atualizar status do pedido" });
  }
};

// ─────────────────────────────────────────────
//  ATUALIZAR STATUS DE ITEM
//  PATCH /hotels/:hotelId/units/:unitId/orders/:orderId/items/:itemId/status
// ─────────────────────────────────────────────

export const updateOrderItemStatusController = async (req: Request, res: Response) => {
  try {
    const { unitId, orderId, itemId } = req.params;
    const { status } = req.body as { status: string };

    if (!Object.values(OrderItemStatus).includes(status as any)) {
      return res.status(400).json({ message: "Status de item inválido" });
    }

    const order = await OrderModel.findOne({ _id: orderId, hotelUnit: unitId });
    if (!order) {
      return res.status(404).json({ message: "Pedido não encontrado" });
    }

    const item: any = order.items.find((it: any) => String(it._id) === itemId);
    if (!item) {
      return res.status(404).json({ message: "Item não encontrado" });
    }

    item.status = status;
    if (status === OrderItemStatus.DELIVERED) {
      item.completedAt = new Date();
    }

    await order.save();
    return res.status(200).json(order);
  } catch (e: any) {
    console.error("updateOrderItemStatusController error:", e);
    return res.status(500).json({ message: "Erro ao atualizar status do item" });
  }
};

// ─────────────────────────────────────────────
//  CANCELAR ITEM
//  PATCH /hotels/:hotelId/units/:unitId/orders/:orderId/items/:itemId/cancel
// ─────────────────────────────────────────────

export const cancelOrderItemController = async (req: Request, res: Response) => {
  try {
    const { unitId, orderId, itemId } = req.params;
    const { reason } = req.body || {};

    const order = await OrderModel.findOne({ _id: orderId, hotelUnit: unitId });
    if (!order) return res.status(404).json({ message: "Pedido não encontrado" });

    if (!order.canUpdateItems()) {
      return res.status(409).json({
        message: "Não é possível alterar itens de um pedido encerrado ou cancelado",
      });
    }

    const item: any = order.items.find((it: any) => String(it._id) === itemId);
    if (!item) return res.status(404).json({ message: "Item não encontrado" });

    item.status = OrderItemStatus.CANCELLED;
    if (reason) item.observations = `${item.observations || ""} [CANCELADO: ${reason}]`.trim();

    await order.save(); // pre('save') recalcula totalAmount
    return res.status(200).json(order);
  } catch (e: any) {
    console.error("cancelOrderItemController error:", e);
    return res.status(500).json({ message: "Erro ao cancelar item" });
  }
};

// ─────────────────────────────────────────────
//  CANCELAR PEDIDO INTEIRO
//  PATCH /hotels/:hotelId/units/:unitId/orders/:orderId/cancel
// ─────────────────────────────────────────────

export const cancelOrderController = async (req: Request, res: Response) => {
  try {
    const { unitId, orderId } = req.params;
    const { reason, by } = req.body || {};

    const order = await OrderModel.findOne({ _id: orderId, hotelUnit: unitId });
    if (!order) return res.status(404).json({ message: "Pedido não encontrado" });

    if (!order.canTransitionTo(OrderStatus.CANCELLED)) {
      return res.status(409).json({ message: "Pedido não pode ser cancelado" });
    }

    order.status = OrderStatus.CANCELLED;
    order.isCancelled = true;

    const now = new Date();
    order.statusHistory.push({
      status: OrderStatus.CANCELLED,
      at: now,
      by: by ? (new mongoose.Types.ObjectId(by) as any) : undefined,
    });

    // Cancela todos os itens ainda não entregues
    for (const item of order.items) {
      if (item.status !== OrderItemStatus.DELIVERED) {
        item.status = OrderItemStatus.CANCELLED;
      }
    }

    if (reason && order.meta) {
      order.meta.observations = `${order.meta.observations || ""} [CANCELAMENTO: ${reason}]`.trim();
    }

    await order.save();
    return res.status(200).json(order);
  } catch (e: any) {
    console.error("cancelOrderController error:", e);
    return res.status(500).json({ message: "Erro ao cancelar pedido" });
  }
};

// ─────────────────────────────────────────────
//  FECHAR CONTA (solicitar pagamento)
//  POST /hotels/:hotelId/units/:unitId/orders/checkout
//  Agrupa todos os pedidos em aberto do quarto
// ─────────────────────────────────────────────

export const checkoutRoomController = async (req: Request, res: Response) => {
  try {
    const { hotelId, unitId } = req.params;
    const { roomId, paymentMethod, by } = req.body as {
      roomId: string;
      paymentMethod?: string;
      by?: string;
    };

    if (!roomId) {
      return res.status(400).json({ message: "roomId é obrigatório" });
    }

    const openOrders = await getOpenOrdersByRoom(hotelId, unitId, roomId);
    if (!openOrders.length) {
      return res.status(404).json({ message: "Nenhum pedido em aberto para este quarto" });
    }

    const now = new Date();
    const updatedOrders: any[] = [];

    for (const order of openOrders) {
      if (!order.canTransitionTo(OrderStatus.PAYMENT_REQUESTED)) continue;

      order.status = OrderStatus.PAYMENT_REQUESTED;
      if (order.meta) {
        order.meta.paymentRequestedAt = now;
        if (paymentMethod) order.meta.paymentMethod = paymentMethod;
        if (by) order.meta.processedBy = new mongoose.Types.ObjectId(by) as any;
      }
      order.statusHistory.push({
        status: OrderStatus.PAYMENT_REQUESTED,
        at: now,
        by: by ? (new mongoose.Types.ObjectId(by) as any) : undefined,
      });

      await order.save();
      updatedOrders.push(order.toObject());
    }

    // Total geral do quarto
    const grandTotal = updatedOrders.reduce((acc, o) => acc + (o.totalAmount || 0), 0);

    return res.status(200).json({
      message: "Checkout solicitado com sucesso",
      roomId,
      grandTotal: Number(grandTotal.toFixed(2)),
      orders: updatedOrders,
    });
  } catch (e: any) {
    console.error("checkoutRoomController error:", e);
    return res.status(500).json({ message: "Erro ao solicitar checkout" });
  }
};

// ─────────────────────────────────────────────
//  CONFIRMAR PAGAMENTO
//  POST /hotels/:hotelId/units/:unitId/orders/pay
// ─────────────────────────────────────────────

export const payRoomOrdersController = async (req: Request, res: Response) => {
  try {
    const { hotelId, unitId } = req.params;
    const { roomId, by } = req.body as { roomId: string; by?: string };

    if (!roomId) {
      return res.status(400).json({ message: "roomId é obrigatório" });
    }

    const orders = await OrderModel.find({
      hotelId,
      hotelUnit: unitId,
      "meta.roomId": roomId,
      isPaid: false,
      status: { $nin: [OrderStatus.CANCELLED] },
    });

    if (!orders.length) {
      return res.status(404).json({ message: "Nenhum pedido encontrado para pagar" });
    }

    const now = new Date();
    for (const order of orders) {
      order.status = OrderStatus.PAID;
      order.isPaid = true;
      order.paidAt = now;
      order.statusHistory.push({
        status: OrderStatus.PAID,
        at: now,
        by: by ? (new mongoose.Types.ObjectId(by) as any) : undefined,
      });
      await order.save();
    }

    return res.status(200).json({
      message: "Pagamento confirmado",
      roomId,
      paidOrders: orders.length,
    });
  } catch (e: any) {
    console.error("payRoomOrdersController error:", e);
    return res.status(500).json({ message: "Erro ao confirmar pagamento" });
  }
};

// ─────────────────────────────────────────────
//  EXCEÇÃO / DESCONTO EM ITEM
//  POST /hotels/:hotelId/units/:unitId/orders/:orderId/items/:itemId/exception
// ─────────────────────────────────────────────

export const addOrderItemExceptionController = async (req: Request, res: Response) => {
  try {
    const { unitId, orderId, itemId } = req.params;
    const { reason, discount } = req.body || {};

    if (!reason?.trim()) {
      return res.status(400).json({ message: "reason é obrigatório" });
    }

    const order = await OrderModel.findOne({ _id: orderId, hotelUnit: unitId });
    if (!order) return res.status(404).json({ message: "Pedido não encontrado" });

    const item: any = order.items.find((it: any) => String(it._id) === itemId);
    if (!item) return res.status(404).json({ message: "Item não encontrado" });

    const note = `[EXCEÇÃO] ${String(reason).trim()}${
      discount ? ` (abatimento R$ ${n0(discount).toFixed(2)})` : ""
    }`;

    const dec = n0(discount);
    if (dec > 0) {
      if (!Array.isArray(item.addons)) item.addons = [];
      item.addons.push({ name: note, price: -dec, quantity: 1 });
    }

    item.observations = item.observations
      ? `${item.observations} | ${note}`
      : note;

    await order.save();
    return res.json(order.toObject());
  } catch (e: any) {
    console.error("addOrderItemExceptionController error:", e);
    return res.status(500).json({ message: "Erro ao adicionar exceção" });
  }
};

// ─────────────────────────────────────────────
//  CUPOM / DESCONTO GERAL
//  POST /hotels/:hotelId/units/:unitId/orders/:orderId/coupon
// ─────────────────────────────────────────────

export const applyOrderCouponController = async (req: Request, res: Response) => {
  try {
    const { unitId, orderId } = req.params;
    const { kind, value, code } = req.body || {};

    if (!["percent", "absolute"].includes(String(kind))) {
      return res.status(400).json({ message: "kind deve ser 'percent' ou 'absolute'" });
    }

    const v = n0(value);
    if (!Number.isFinite(v) || v <= 0) {
      return res.status(400).json({ message: "Valor de desconto inválido" });
    }

    const order = await OrderModel.findOne({ _id: orderId, hotelUnit: unitId });
    if (!order) return res.status(404).json({ message: "Pedido não encontrado" });

    const base = computeSubtotalWithoutCoupons(order);

    let amount = 0;
    if (kind === "percent") {
      const pct = Math.max(0, Math.min(100, v));
      amount = (pct / 100) * base;
    } else {
      amount = Math.min(base, v);
    }

    if (amount <= 0) {
      return res.status(400).json({ message: "Nenhum desconto aplicável sobre o subtotal atual" });
    }

    const label = code ? `[CUPOM ${String(code).trim()}]` : "[AJUSTE GERENTE]";
    (order.items as any[]).push({
      name: label,
      price: -amount,
      quantity: 1,
      addons: [],
      status: OrderItemStatus.ADDED,
      isOnPromotion: false,
      originalPrice: 0,
    });

    if (order.meta) {
      const obs = order.meta.observations || "";
      const cupomObs = `${label} ${
        kind === "percent" ? `(${v}%)` : `(R$ ${amount.toFixed(2)})`
      }`;
      order.meta.observations = obs ? `${obs} | ${cupomObs}` : cupomObs;
    }

    await order.save();
    return res.json(order.toObject());
  } catch (e: any) {
    console.error("applyOrderCouponController error:", e);
    return res.status(500).json({ message: "Erro ao aplicar cupom" });
  }
};

// ─────────────────────────────────────────────
//  SOLICITAR AUXÍLIO (hóspede chama recepção)
//  POST /hotels/:hotelId/units/:unitId/orders/:orderId/help
// ─────────────────────────────────────────────

export const requestHelpController = async (req: Request, res: Response) => {
  try {
    const { unitId, orderId } = req.params;

    const order = await OrderModel.findOne({ _id: orderId, hotelUnit: unitId });
    if (!order) return res.status(404).json({ message: "Pedido não encontrado" });

    const now = new Date();
    const lastHelp = order.meta?.helpRequestedAt
      ? new Date(order.meta.helpRequestedAt)
      : null;

    // Idempotente: ignora segunda solicitação dentro de 60 s
    if (!lastHelp || now.getTime() - lastHelp.getTime() > 60_000) {
      if (order.meta) {
        order.meta.helpRequestedAt = now;
        order.meta.helpResolvedAt = null;
        order.meta.helpResolvedById = null;
      }
      await order.save();
    }

    return res.json({ ok: true, helpRequestedAt: order.meta?.helpRequestedAt });
  } catch (e: any) {
    console.error("requestHelpController error:", e);
    return res.status(500).json({ message: "Erro ao registrar solicitação de auxílio" });
  }
};

// ─────────────────────────────────────────────
//  RESOLVER AUXÍLIO
//  PATCH /hotels/:hotelId/units/:unitId/orders/:orderId/help/resolve
// ─────────────────────────────────────────────

export const resolveHelpController = async (req: Request, res: Response) => {
  try {
    const { unitId, orderId } = req.params;
    const { by } = req.body || {};

    const order = await OrderModel.findOne({ _id: orderId, hotelUnit: unitId });
    if (!order) return res.status(404).json({ message: "Pedido não encontrado" });

    if (order.meta) {
      order.meta.helpResolvedAt = new Date();
      order.meta.helpResolvedById = by ?? null;
    }

    await order.save();
    return res.json({ ok: true, helpResolvedAt: order.meta?.helpResolvedAt });
  } catch (e: any) {
    console.error("resolveHelpController error:", e);
    return res.status(500).json({ message: "Erro ao resolver auxílio" });
  }
};

// ─────────────────────────────────────────────
//  DASHBOARD — pedidos de uma unidade
//  GET /hotels/:hotelId/units/:unitId/orders
// ─────────────────────────────────────────────

export const listUnitOrdersController = async (req: Request, res: Response) => {
  try {
    const { hotelId, unitId } = req.params;
    const { status, roomId, isPaid, limit = "50", page = "1" } = req.query as Record<string, string>;

    const query: any = { hotelId, hotelUnit: unitId };

    if (status) query.status = status;
    if (roomId) query["meta.roomId"] = roomId;
    if (isPaid === "true") query.isPaid = true;
    if (isPaid === "false") query.isPaid = false;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [orders, total] = await Promise.all([
      OrderModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      OrderModel.countDocuments(query),
    ]);

    return res.status(200).json({
      data: orders,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (e: any) {
    console.error("listUnitOrdersController error:", e);
    return res.status(500).json({ message: "Erro ao listar pedidos da unidade" });
  }
};