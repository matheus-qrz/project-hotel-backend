import mongoose from "mongoose";
import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { OrderModel } from "../models/Order";
import { UserModel } from "../models/User";
import { RestaurantUnitModel } from "../models/RestaurantUnit";
import { OrderItemStatus, OrderStatus, OrderStatusType } from "../types/order.types";
import { recomputeAndReturn } from "../helpers/recomputeAndReturn";
import { computeTotal } from "../utils/computeTotal";
import { isAttendantAssigned } from "../helpers/assignments";
import { applyAssignmentToOrder } from "../services/applyAssignment";
import { isTableInCurrentRange } from "../helpers/tableInCurrentRange";
// import { io } from "../realtime";

// Inicializador do pedido
export const initiateOrderController = async (req: Request, res: Response) => {
  try {
    const { restaurantId } = req.params as { restaurantId: string };

    // o body manda restaurantUnitId; no banco usamos restaurantUnit
    const unitIdFromBody = (req.body?.restaurantUnitId as string) || "";
    const restaurantUnit = unitIdFromBody || restaurantId;

    const { guestInfo, meta, items, totalAmount, assignedAttendantId, assignedAttendantName } = req.body as any;

    if (
      !restaurantUnit ||
      !guestInfo?.id ||
      !meta?.tableId ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res
        .status(400)
        .json({ message: "Dados insuficientes para iniciar pedido." });
    }

    // sessionId: usa o header se vier; senão gera um novo
    const sessionId =
      typeof req.headers["x-session-id"] === "string" &&
      req.headers["x-session-id"].trim()
        ? String(req.headers["x-session-id"]).trim()
        : randomUUID();

    const now = new Date();
    const status = req.body.status ?? "processing";

    // normalização de itens
    const itemsWithStatus = items.map((it: any) => ({
      ...it,
      status: it.status ?? "added",
      createdAt: it.createdAt ? new Date(it.createdAt) : now,
      addons: Array.isArray(it.addons)
        ? it.addons.map((ad: any) => ({
            ...ad,
            status: ad.status ?? "added",
            createdAt: ad.createdAt ? new Date(ad.createdAt) : now,
          }))
        : [],
    }));

    // ---------- PROCURAR PEDIDO EXISTENTE DESSA SESSÃO ----------
    // importante: incluir 'completed' como elegível para receber novos itens
    const candidates = await OrderModel.find({
      sessionId,
      restaurantUnit,
      "guestInfo.id": guestInfo.id,
      isPaid: false,
      status: { $nin: ["paid", "cancelled"] }, // <- aceita processing, payment_requested e completed
    }).lean();

    // escolhe o da mesma mesa (tolerando string/number)
    const existing =
      candidates.find(
        (o: any) => String(o?.meta?.tableId) === String(meta.tableId)
      ) || null;

 if (existing) {
      // ---------- acumula no MESMO documento e traz o pedido de volta para "processing" ----------
      await OrderModel.updateOne(
        { _id: existing._id },
        {
          $push: { items: { $each: itemsWithStatus } },
          $inc: { totalAmount: Number(totalAmount) || 0 },
          $set: {
            updatedAt: now,
            status: "processing", // volta o card para "Em preparo"
            "meta.orderType":
              meta?.orderType ?? existing.meta?.orderType ?? "local",
            "meta.observations":
              meta?.observations ?? existing.meta?.observations ?? "",
            "meta.splitCount":
              Number(meta?.splitCount) || existing.meta?.splitCount || 1,
          },
        }
      );

      // 🔹 NOVO: se ainda não tem atendente, resolve agora e salva
      const updatedDoc = await OrderModel.findById(existing._id);
      if (updatedDoc && !updatedDoc.assignedAttendantId) {
        await applyAssignmentToOrder({
          order: updatedDoc,
          unitId: String(restaurantUnit),                     // usar o unitId efetivo
          tableId: Number(meta.tableId),                      // garantir número
          preferredAttendantId: assignedAttendantId,
          preferredAttendantName: assignedAttendantName,
        });
        await updatedDoc.save();
      }

      const updated = await OrderModel.findById(existing._id);
      res.setHeader("x-session-id", sessionId);
      return res.status(200).json(updated);
    }

    // ---------- CRIAR NOVO PEDIDO ----------
    const doc = new OrderModel({
      restaurant: restaurantId || undefined,
      restaurantUnit,
      guestInfo: {
        id: guestInfo.id,
        name: guestInfo.name ?? "",
        joinedAt: guestInfo.joinedAt ? new Date(guestInfo.joinedAt) : now,
      },
      items: itemsWithStatus,
      status,
      processingAt: status === 'processing' ? now : null,
      statusHistory: [{ status, at: status === "processing" ? now : now }],
      isPaid: false,
      sessionId, // sempre grava o sessionId
      meta: {
        tableId: Number(meta.tableId),
        orderType: meta?.orderType ?? "local",
        observations: meta?.observations ?? "",
        splitCount: Number(meta?.splitCount) || 1,
        orderCreatedAt: now,
      },
      totalAmount: Number(totalAmount) || 0,
      createdAt: now,
      updatedAt: now,
    });

    await applyAssignmentToOrder({
      order: doc,
      unitId: String(restaurantUnit),
      tableId: Number(meta.tableId),
      preferredAttendantId: assignedAttendantId,
      preferredAttendantName: assignedAttendantName,
    });

    await doc.save();
    res.setHeader("x-session-id", sessionId);
    return res.status(201).json(doc);
  } catch (e) {
    console.error("Erro ao iniciar pedido:", e);
    return res.status(500).json({ message: "Erro interno ao iniciar pedido." });
  }
};

// Controlador para requisição de pagamento por pedido de cliente
export const requestOrderCheckout = async (req: Request, res: Response) => {
  const { tableId, orderId } = req.params as { tableId: string; orderId: string };
  const { guestId, splitCount } = (req.body || {}) as { guestId?: string; splitCount?: number };

  try {
    const tableNum = Number(tableId);
    if (Number.isNaN(tableNum)) return res.status(400).json({ message: "tableId inválido." });

    // Filtro base (idempotente)
    const filter: any = {
      _id: orderId,
      'meta.tableId': tableNum,
      isPaid: false,
      status: { $nin: ['cancelled', 'payment_requested', 'paid'] }
    };

    // Se veio guestId, tratar como chamada do convidado
    if (guestId) filter['guestInfo.id'] = guestId;

    // Se veio sessionId no header, amarrar também
    const hdr = req.headers['x-session-id'];
    if (typeof hdr === 'string' && hdr.trim()) filter.sessionId = hdr.trim();

    const updated = await OrderModel.findOneAndUpdate(
      filter,
      {
        $set: {
          status: 'payment_requested',
          'meta.paymentRequestedAt': new Date(),
          ...(splitCount && splitCount > 1 ? { 'meta.splitCount': splitCount } : {})
        }
      },
      { new: true }
    );

    if (updated) return res.status(200).json(updated);

    // Diagnóstico amigável
    const existing = await OrderModel.findById(orderId).select('status isPaid meta.tableId guestInfo.id');
    if (!existing) return res.status(404).json({ message: 'Pedido não encontrado.' });
    if (Number(existing.meta?.tableId) !== tableNum)
      return res.status(403).json({ message: 'Pedido não pertence a esta mesa.' });
    if (guestId && existing.guestInfo?.id !== guestId)
      return res.status(403).json({ message: 'Este pedido pertence a outro cliente.' });
    if (['payment_requested','paid'].includes(existing.status))
      return res.status(409).json({ message: `Pedido já está em ${existing.status}.` });
    if (existing.isPaid) return res.status(409).json({ message: 'Pedido já foi pago.' });

    return res.status(409).json({ message: 'Não foi possível solicitar fechamento.' });
  } catch (e) {
    console.error('Erro ao solicitar fechamento:', e);
    return res.status(500).json({ message: 'Erro ao solicitar fechamento.' });
  }
};

// Controlador para processar o pagamento de uma mesa
export const processTablePaymentHandler = async (req: Request, res: Response) => {
  const { restaurantUnitId, tableId, paymentMethod, staffId, sessionId } = req.body;

  try {
    if (!restaurantUnitId || !tableId || !sessionId) {
      return res.status(400).json({
        message: "É necessário fornecer o ID da unidade, número da mesa e ID da sessão"
      });
    }

    // Encontrar apenas os pedidos do cliente específico
    const pendingOrders = await OrderModel.find({
      restaurantUnit: restaurantUnitId,
      'meta.tableId': tableId,
      sessionId: sessionId,
      isPaid: false,
      status: { $nin: OrderStatus.CANCELLED }
    });

    if (pendingOrders.length === 0) {
      return res.status(404).json({
        message: "Não foram encontrados pedidos pendentes para este cliente"
      });
    }

    const orderIds = pendingOrders.map(order => order._id);
    const sessionTotal = pendingOrders.reduce((sum, order) => sum + order.totalAmount, 0);
    const now = new Date();

    // Atualizar apenas os pedidos do cliente
    await OrderModel.updateMany(
      { _id: { $in: orderIds } },
      {
        $set: {
          status: OrderStatus.COMPLETED,
          isPaid: true,
          paidAt: now,
          'meta.paymentMethod': paymentMethod,
          'meta.processedBy': staffId,
          'meta.sessionTotal': sessionTotal
        }
      }
    );

    res.status(200).json({
      message: "Pagamento processado com sucesso",
      ordersProcessed: orderIds.length,
      total: sessionTotal,
      processedAt: now
    });
  } catch (error) {
    console.error("Erro ao processar pagamento:", error);
    res.status(500).json({
      message: "Erro ao processar pagamento",
      error
    });
  }
};

// Controlador para obter pedidos de uma unidade (com filtro por atendente)
export const getRestaurantUnitOrdersController = async (req: Request, res: Response) => {
  try {
    const { restaurantUnitId } = req.params as { restaurantUnitId: string };
    const { status, attendantId, onlyAssigned } = (req.query || {}) as {
      status?: string;
      attendantId?: string;
      onlyAssigned?: string; // "true" para exigir mesas atribuídas
    };

    if (!restaurantUnitId || !mongoose.isValidObjectId(restaurantUnitId)) {
      return res.status(400).json({ message: "ID da unidade do restaurante inválido." });
    }

    const filter: any = { restaurantUnit: restaurantUnitId };
    if (status) filter.status = status;

    // ✅ Se veio attendantId, restringe às mesas atribuídas (ativos + range válido)
    if (attendantId && mongoose.isValidObjectId(attendantId)) {
      // 1) Mesas de TableAssignment ativo
      const activeTableAssigns = await (await import("../models/TableAssignment")).TableAssignmentModel
        .find({
          restaurantUnit: restaurantUnitId,
          attendant: attendantId,
          isActive: true,
        })
        .select("tableId")
        .lean();

      const activeTables = new Set<number>(activeTableAssigns.map((a: any) => Number(a.tableId)));

      // 2) Mesas de RangeAssignment válido (dia/horário da unidade)
      const { RestaurantUnitModel } = await import("../models/RestaurantUnit");
      const unit = await RestaurantUnitModel.findById(restaurantUnitId).select("timezone").lean();
      const tz = unit?.timezone || "America/Sao_Paulo";

      // Usamos o mesmo critério do TableAssignmentController: HH:mm da *unidade*
      const { DateTime } = await import("luxon");
      const nowTZ = DateTime.now().setZone(String(tz));
      const dow = nowTZ.weekday % 7; // 0=Dom ... 6=Sáb
      const hhmm = `${String(nowTZ.hour).padStart(2,"0")}:${String(nowTZ.minute).padStart(2,"0")}`;

      // helpers locais (copiam a semântica existente)
      const toHHmm = (d: Date) => `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`;
      const isWithinShiftHHmm = (cur: string, start?: string | null, end?: string | null) => {
        if (!start || !end) return false;
        return start <= cur && cur <= end;
      };

      const { RangeAssignmentModel } = await import("../models/RangeAssignment");
      const ranges = await RangeAssignmentModel.find({
        restaurantUnit: restaurantUnitId,
        attendant: attendantId,
        isActive: { $ne: false },
        $or: [{ daysOfWeek: { $size: 0 } }, { daysOfWeek: dow }],
      })
        .select("startTable endTable startsAt endsAt updatedAt")
        .lean();

      for (const r of ranges) {
        const start = r.startsAt ? toHHmm(r.startsAt) : null;
        const end = r.endsAt ? toHHmm(r.endsAt) : null;
        if (!isWithinShiftHHmm(hhmm, start, end)) continue;
        const s = Number(r.startTable);
        const e = Number(r.endTable);
        if (Number.isInteger(s) && Number.isInteger(e) && s <= e) {
          for (let t = s; t <= e; t++) activeTables.add(t);
        }
      }

      const allowed = Array.from(activeTables.values()).filter((n) => Number.isInteger(n));
      if (onlyAssigned === "true") {
        // Se explicitamente exigido e não há mesas válidas agora → retorna vazio
        if (allowed.length === 0) return res.json([]);
      }

      if (allowed.length > 0) {
        filter["meta.tableId"] = { $in: allowed };
      } else {
        // Sem allowed, mas não exigido → retorna tudo da unidade (comportamento antigo)
      }
    }

    const orders = await OrderModel.find(filter).sort({ createdAt: -1 });
    return res.json(orders);
  } catch (error) {
    console.error("Erro ao buscar pedidos:", error);
    res.status(500).json({ message: "Erro ao buscar pedidos", error });
  }
};

// Controlador para obter um pedido específico
export const getOrderByIdController = async (req: Request, res: Response) => {
  const { tableId, orderId } = req.params as { tableId: string; orderId: string };
  const { guestId } = (req.query || {}) as { guestId?: string };

  try {
    const tableNum = Number(tableId);
    if (Number.isNaN(tableNum)) return res.status(400).json({ message: "tableId inválido." });

    const filter: any = { _id: orderId, 'meta.tableId': tableNum };
    if (guestId) filter['guestInfo.id'] = guestId;

    const hdr = req.headers['x-session-id'];
    if (typeof hdr === 'string' && hdr.trim() && guestId) filter.sessionId = hdr.trim();

    const order = await OrderModel.findOne(filter);
    if (!order) return res.status(404).json({ message: 'Pedido não encontrado.' });

    return res.json(order);
  } catch (e) {
    console.error('Erro ao buscar pedido:', e);
    return res.status(500).json({ message: 'Erro ao buscar pedido.' });
  }
};

// Controlador para atualizar um pedido
export const updateOrderStatusController = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params as { orderId: string };
    const { status } = req.body as { status: OrderStatusType };

    if (!status) {
      return res.status(400).json({ message: "Status não fornecido." });
    }

    const order = await OrderModel.findById(orderId);
    if (!order) return res.status(404).json({ message: "Pedido não encontrado" });
    
    const userId = req.user?.id; // do token
    const isManager = req.user?.role === "MANAGER";
    
    if (!isManager) {
      // Se o pedido tem dono e não é o usuário -> 403
      if (order?.assignedAttendantId && String(order.assignedAttendantId) !== String(userId)) {
        return res.status(403).json({ message: "Você não está atribuído a este pedido." });
      }

      // Se não tem dono, só permitir se a mesa estiver no range/horário do atendente
      if (!order?.assignedAttendantId) {
        const canOperate = await isTableInCurrentRange({
          unitId: String(order?.restaurantUnit),
          attendantId: String(userId),
          tableId: Number(order?.meta?.tableId),
        });
        if (!canOperate) {
          return res.status(403).json({ message: "Pedido fora do seu range/horário." });
        }
      }
    }

    const prevStatus = order.status;
    const nextStatus = status as
      | "processing"
      | "completed"
      | "payment_requested"
      | "paid"
      | "cancelled";

    // === Fluxo especial: PAID ===
    if (nextStatus === OrderStatus.PAID) {
      // idempotência
      if (order.isPaid === true || order.status === OrderStatus.PAID) {
        return res.status(200).json(order);
      }

      // só deixa pagar se já estiver concluído ou com pagamento solicitado
      if (
        order.status !== OrderStatus.COMPLETED &&
        order.status !== OrderStatus.PAYMENT_REQUESTED
      ) {
        return res.status(409).json({
          message:
            "Só é possível marcar como pago um pedido concluído ou com pagamento solicitado.",
        });
      }

      const now = new Date();
      const newTotal = computeTotal(order.items);

      // Atualiza pedido para PAID + registra histórico "paid"
      await OrderModel.updateOne(
        { _id: orderId },
        {
          $set: {
            status: OrderStatus.PAID,
            isPaid: true,
            paidAt: now,
            totalAmount: newTotal,
            updatedAt: now,
          },
          $push: {
            statusHistory: { status: OrderStatus.PAID, at: now } as any,
          },
        },
        { runValidators: false }
      );

      // Marca itens ativos como completed ao fechar a conta
      await OrderModel.updateOne(
        { _id: orderId },
        { $set: { "items.$[i].status": OrderItemStatus.COMPLETED } },
        {
          arrayFilters: [
            { "i.status": { $in: ["added", "processing", "reduced"] }, "i.quantity": { $gt: 0 } },
          ],
          runValidators: false,
        }
      );

      const updated = await OrderModel.findById(orderId);
      return res.status(200).json(updated);
    }

    // === Demais status (processing, completed, payment_requested, cancelled) ===

    // idempotência
    if (nextStatus === prevStatus) {
      return res.status(200).json(order);
    }

    const now = new Date();
    order.status = nextStatus;

    // carimbos por status (preserva o primeiro momento que atingiu o status)
    if (nextStatus === "processing" && !order.processingAt) {
      order.processingAt = now;
    }
    if (nextStatus === "completed" && !order.completedAt) {
      order.completedAt = now;
    }

    // registra histórico
    if (!Array.isArray(order.statusHistory)) order.statusHistory = [];
    order.statusHistory.push({ status: nextStatus, at: now } as any);

    // salva (timestamps do mongoose atualizam updatedAt)
    await order.save();

    return res.status(200).json(order);
  } catch (error: any) {
    console.error("Erro ao atualizar status do pedido:", error);
    return res.status(500).json({ message: error?.message || "Erro interno." });
  }
};

// Controlador para excluir um pedido
export const deleteOrderController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deletedOrder = await OrderModel.findByIdAndDelete(id);

    if (!deletedOrder) {
      return res.status(404).json({ message: "Pedido não encontrado" });
    }

    // Remover referência do pedido da unidade
    await RestaurantUnitModel.findByIdAndUpdate(
      deletedOrder.restaurantUnit,
      {
        $pull: {
          orders: id
        }
      }
    );

    // Se o pedido estiver associado a um usuário, remover a referência
    if (deletedOrder.user) {
      await UserModel.findByIdAndUpdate(
        deletedOrder.user,
        {
          $pull: {
            orders: id
          }
        }
      );
    }

    res.json({ message: "Pedido excluído com sucesso" });
  } catch (error) {
    console.error("Erro ao excluir pedido:", error);
    res.status(500).json({ message: "Erro ao excluir pedido", error });
  }
};

// Listar pedidos de mesa específica
export const getTableOrdersController = async (req: Request, res: Response) => {
  const { tableId } = req.params as { tableId: string };
  const { activeOnly } = (req.query || {}) as { activeOnly?: string };

  try {
    const tableNum = Number(tableId);
    if (Number.isNaN(tableNum)) return res.status(400).json({ message: "tableId inválido." });

    const filter: any = { 'meta.tableId': tableNum };

    if (activeOnly) {
      filter.isPaid = false;
      filter.status = { $in: ['processing', 'payment_requested'] };
    }

    const orders = await OrderModel.find(filter).sort({ createdAt: -1 });
    return res.json(orders);
  } catch (e) {
    console.error('Erro ao listar pedidos da mesa:', e);
    return res.status(500).json({ message: 'Erro ao listar pedidos da mesa.' });
  }
};

// Listar pedidos de convidado específico
export const getGuestOrdersController = async (req: Request, res: Response) => {
   const { tableId, guestId } = req.params as { tableId: string; guestId: string };
  const { activeOnly } = (req.query || {}) as { activeOnly?: string };

  try {
    const tableNum = Number(tableId);
    if (Number.isNaN(tableNum)) return res.status(400).json({ message: "tableId inválido." });

    const filter: any = {
      'meta.tableId': tableNum,
      'guestInfo.id': guestId
    };

    if (activeOnly) {
      filter.isPaid = false;
      filter.status = { $in: ['processing', 'payment_requested'] };
    }

    const hdr = req.headers['x-session-id'];
    if (typeof hdr === 'string' && hdr.trim()) filter.sessionId = hdr.trim();

    const orders = await OrderModel.find(filter).sort({ createdAt: -1 });
    return res.json(orders);
  } catch (e) {
    console.error('Erro ao listar pedidos do guest:', e);
    return res.status(500).json({ message: 'Erro ao listar pedidos do guest.' });
  }
};

// Cancelar pedido como um todo
export const cancelOrderController = async (req: Request, res: Response) => {
  const { tableId, orderId } = req.params as { tableId: string; orderId: string };
  const { guestId } = (req.body || {}) as { guestId?: string };

  try {
    const tableNum = Number(tableId);
    if (Number.isNaN(tableNum)) return res.status(400).json({ message: "tableId inválido." });

    const filter: any = {
      _id: orderId,
      'meta.tableId': tableNum,
      isPaid: false,
      status: { $in: ['processing', 'payment_requested'] }
    };

    if (guestId) filter['guestInfo.id'] = guestId;

    const hdr = req.headers['x-session-id'];
    if (typeof hdr === 'string' && hdr.trim()) filter.sessionId = hdr.trim();

    const updated = await OrderModel.findOneAndUpdate(
      filter,
      { $set: { status: 'cancelled', 'meta.cancelledAt': new Date() } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ message: 'Pedido não encontrado ou já cancelado/fechado.' });
    return res.json(updated);
  } catch (e) {
    console.error('Erro ao cancelar pedido:', e);
    return res.status(500).json({ message: 'Erro ao cancelar pedido.' });
  }
};

// Cancelar item de pedido
export const cancelOrderItemController = async (req: Request, res: Response) => {
 const { tableId, orderId, itemId } = req.params as { tableId: string; orderId: string; itemId: string };
  const { guestId } = (req.body || {}) as { guestId?: string };

  try {
    const tableNum = Number(tableId);
    if (Number.isNaN(tableNum)) return res.status(400).json({ message: "tableId inválido." });

    const filter: any = {
      _id: orderId,
      'meta.tableId': tableNum,
      isPaid: false,
      status: { $in: ['processing', 'payment_requested'] },
      'items._id': itemId
    };

    if (guestId) filter['guestInfo.id'] = guestId;

    const hdr = req.headers['x-session-id'];
    if (typeof hdr === 'string' && hdr.trim()) filter.sessionId = hdr.trim();

    const updated = await OrderModel.findOneAndUpdate(filter,
      { $set: { 'items.$.status': 'cancelled' } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Pedido/Item não encontrado ou já cancelado.' });

    let recomputed = null;
    try {
      recomputed = await recomputeAndReturn(orderId);
    } catch (err) {
      console.warn('recomputeAndReturn falhou (cancel item):', err);
    }
    return res.json(recomputed ?? updated);
  } catch (e) {
    console.error('Erro ao cancelar item:', e);
    return res.status(500).json({ message: 'Erro ao cancelar item.' });
  }
};

// Atualizar quantidade/detalhes de item específico de um pedido
export const updateOrderItemController = async (req: Request, res: Response) => {
  const { tableId, orderId, itemId } = req.params as {
    tableId: string;
    orderId: string;
    itemId: string;
  };

  const {
    guestId,
    quantity,
    status,     // "processing" | "completed" | "cancelled" | "reduced"
    servedAt,   // opcional ISO string; se ausente e status=completed, usa now
  } = (req.body || {}) as {
    guestId?: string;
    quantity?: number;
    status?: string;
    servedAt?: string;
  };

  const user = req.user as any;
  const userId = req.user?.id; // do token
  const isManager = req.user?.role === "MANAGER";
  const order = await OrderModel.findById(orderId);

  if (!isManager) {
    // Se o pedido tem dono e não é o usuário -> 403
    if (order?.assignedAttendantId && String(order.assignedAttendantId) !== String(userId)) {
      return res.status(403).json({ message: "Você não está atribuído a este pedido." });
    }

    // Se não tem dono, só permitir se a mesa estiver no range/horário do atendente
    if (!order?.assignedAttendantId) {
      const canOperate = await isTableInCurrentRange({
        unitId: String(order?.restaurantUnit),
        attendantId: String(userId),
        tableId: Number(order?.meta?.tableId),
      });
      if (!canOperate) {
        return res.status(403).json({ message: "Pedido fora do seu range/horário." });
      }
    }
  }

  try {
    const tableNum = Number(tableId);
    if (Number.isNaN(tableNum)) {
      return res.status(400).json({ message: "tableId inválido." });
    }

    // Descobre a unidade a partir do pedido (necessária p/ validação de escala)
    const doc = await OrderModel.findOne(
      { _id: orderId, "meta.tableId": tableNum },
      { "meta.unitId": 1 }
    );
    if (!doc) return res.status(404).json({ message: "Pedido não encontrado." });

    const unitId = String(doc.restaurantUnit || "");

    // 🔒 Gate: somente ATTENDANT precisa estar escalado para a mesa AGORA
    if (user?.role === "ATTENDANT") {
      const userId = String(user?._id ?? user?.id ?? "");
      if (!userId) return res.status(401).json({ message: "Usuário não autenticado." });

      const ok = await isAttendantAssigned({
        unitId,
        attendantId: userId,
        tableId: tableNum,
      });
      if (!ok) {
        return res.status(403).json({ message: "Você não está escalado para esta mesa agora." });
      }
    }

    // ---------- Filtro do item editável ----------
    const baseFilter: any = {
      _id: orderId,
      "meta.tableId": tableNum,
      isPaid: false,
      status: { $in: ["processing", "payment_requested"] },
      "items._id": itemId,
    };
    if (guestId) baseFilter["guestInfo.id"] = guestId;

    const hdr = req.headers["x-session-id"];
    if (typeof hdr === "string" && hdr.trim()) baseFilter.sessionId = hdr.trim();

    // ---------- Montagem do update ----------
    const now = new Date();
    const $set: any = {};
    const $unset: any = {};
    const $currentDate: any = { "items.$.updatedAt": true };

    // 1) Quantidade
    if (typeof quantity === "number") {
      if (quantity <= 0) {
        // Zerar => cancela
        $set["items.$.quantity"] = 0;
        $set["items.$.status"] = "cancelled";
        $set["items.$.cancelledAt"] = now;
      } else {
        $set["items.$.quantity"] = quantity;

        // Se não veio status explícito, detectar redução e marcar 'reduced'
        if (!status) {
          const existing = await OrderModel.findOne(baseFilter, { "items.$": 1 }).lean().exec();
          const prevQty =
            existing?.items && Array.isArray(existing.items) && (existing.items as any)[0]
              ? Number((existing.items as any)[0].quantity ?? 0)
              : null;

          if (prevQty !== null && quantity < prevQty) {
            $set["items.$.status"] = "reduced";
          }
        }
      }
    }

    // 2) Status (tem precedência)
    if (typeof status === "string") {
      const normalized = status.toLowerCase();
      if (["processing", "completed", "cancelled", "reduced"].includes(normalized)) {
        $set["items.$.status"] = normalized;

        if (normalized === "completed") {
          const ts = servedAt ? new Date(servedAt) : now;
          $set["items.$.completedAt"] = ts;
          // Se havia cancelamento, limpar
          $unset["items.$.cancelledAt"] = "";
        } else if (normalized === "cancelled") {
          $set["items.$.cancelledAt"] = now;
          // Mantemos completedAt (histórico) — ajuste se quiser limpar também
        }
        // processing/reduced não alteram timestamps específicos
      }
    }

    if (!Object.keys($set).length && !Object.keys($unset).length) {
      return res.status(400).json({ message: "Nada para atualizar." });
    }

    const updateOp: any = { $set, $currentDate };
    if (Object.keys($unset).length) updateOp.$unset = $unset;

    const updated = await OrderModel.findOneAndUpdate(baseFilter, updateOp, { new: true });
    if (!updated) {
      return res
        .status(404)
        .json({ message: "Pedido/Item não encontrado ou bloqueado para edição." });
    }

    // Recalcular totals/flags (mantém seu fluxo)
    let recomputed = null;
    try {
      recomputed = await recomputeAndReturn(orderId);
    } catch (err) {
      console.warn("recomputeAndReturn falhou (update item):", err);
    }

    return res.json(recomputed ?? updated);
  } catch (e) {
    console.error("Erro ao atualizar item:", e);
    return res.status(500).json({ message: "Erro ao atualizar item." });
  }
};

export const reassignOpenOrdersForUnitController = async (req: Request, res: Response) => {
  try {
    const { restaurantUnitId } = req.params as { restaurantUnitId: string };
    const { dryRun, onlyUnassigned } = (req.query || {}) as {
      dryRun?: string;           // "true" -> só simula
      onlyUnassigned?: string;   // "true" -> só sem dono
    };

    if (!restaurantUnitId || !mongoose.isValidObjectId(restaurantUnitId)) {
      return res.status(400).json({ message: "restaurantUnitId inválido." });
    }

    const baseFilter: any = {
      restaurantUnit: restaurantUnitId,
      status: { $nin: ["paid", "cancelled"] },
      isPaid: { $ne: true },
      "meta.tableId": { $exists: true },
    };

    if (onlyUnassigned === "true") {
      baseFilter.$or = [
        { assignedAttendantId: { $exists: false } },
        { assignedAttendantId: null },
      ];
    }

    const orders = await OrderModel.find(baseFilter).lean();
    if (orders.length === 0) {
      return res.json({ ok: true, matched: 0, changed: 0, details: [] });
    }

    const details: Array<{
      orderId: string;
      tableId: number;
      prev?: { id?: string | null; name?: string | null };
      next?: { id?: string | null; name?: string | null; strategy?: string };
      changed: boolean;
    }> = [];

    let changed = 0;

    for (const o of orders) {
      const tableId = Number(o?.meta?.tableId);
      if (!Number.isFinite(tableId)) continue;

      const prev = {
        id: o.assignedAttendantId ? String(o.assignedAttendantId) : null,
        name: o.assignedAttendantName ?? null,
      };

      // reavalia com a regra atual (dia/hora/mesa/fuso da unidade)
      // applyAssignmentToOrder PREENCHE no doc (quando houver alguém), mas aqui estamos em "dryRun"
      // então chamaremos apenas para obter o "next" (truque simples: clonar doc em memória)
      const mockDoc: any = { ...o };
      await applyAssignmentToOrder({
        order: mockDoc,
        unitId: restaurantUnitId,
        tableId,
      });

      const next = {
        id: mockDoc.assignedAttendantId ? String(mockDoc.assignedAttendantId) : null,
        name: mockDoc.assignedAttendantName ?? null,
        strategy: mockDoc.assignmentStrategy ?? "scale",
      };

      const willChange = (prev.id || null) !== (next.id || null)
        || (prev.name || null) !== (next.name || null);

      details.push({
        orderId: String(o._id),
        tableId,
        prev,
        next,
        changed: !!willChange,
      });
    }

    if (dryRun === "true") {
      return res.json({ ok: true, matched: orders.length, changed: details.filter(d => d.changed).length, details });
    }

    // aplica de verdade só nos que mudaram
    for (const d of details) {
      if (!d.changed) continue;

      const real = await OrderModel.findById(d.orderId);
      if (!real) continue;

      await applyAssignmentToOrder({
        order: real,
        unitId: restaurantUnitId,
        tableId: Number(real?.meta?.tableId),
      });

      await real.save();
      changed++;
      
      // TODO: Implementar realtime notification via Socket.IO
      // if (real.assignedAttendantId) {
      //   io.to(`unit:${restaurantUnitId}:attendant:${real.assignedAttendantId}`).emit("order:reassigned", { orderId: real._id });
      // } else {
      //   io.to(`unit:${restaurantUnitId}`).emit("order:reassigned_unassigned", { orderId: real._id });
      // }
    }

    return res.json({ ok: true, matched: orders.length, changed, details: details.filter(d => d.changed) });
  } catch (err) {
    console.error("REASSIGN_ORDERS_FAILED", err);
    return res.status(500).json({ message: "REASSIGN_ORDERS_FAILED" });
  }
};
