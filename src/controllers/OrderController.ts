import mongoose, { Types } from "mongoose";
import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { OrderModel } from "../models/Order";
import { UserModel } from "../models/User";
import { RestaurantUnitModel } from "../models/RestaurantUnit";
import { OrderItemStatus, OrderStatus, OrderStatusType } from "../types/order.types";
import { recomputeAndReturn } from "../helpers/recomputeAndReturn";
import { computeTotal } from "../utils/computeTotal";
import { applyAssignmentToOrder } from "../services/applyAssignment";
import { isTableInCurrentRange } from "../helpers/tableInCurrentRange";
import { computeSubtotalWithoutCoupons, n0 } from "../helpers/coupon";

// Inicializador do pedido
export const initiateOrderController = async (req: Request, res: Response) => {
  try {
    const { restaurantId } = req.params as { restaurantId: string };

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
    const candidates = await OrderModel.find({
      sessionId,
      restaurantUnit,
      "guestInfo.id": guestInfo.id,
      isPaid: false,
      status: { $nin: ["paid", "cancelled"] }, 
    }).lean();

    const existing =
      candidates.find(
        (o: any) => String(o?.meta?.tableId) === String(meta.tableId)
      ) || null;

    if (existing) {
      const now = new Date();

      await OrderModel.updateOne(
        { _id: existing._id },
        {
          $push: {
            items: { $each: itemsWithStatus },
            // opcional: registrar que voltou para processing
            statusHistory: { status: "processing", at: now },
          },
          $inc: { totalAmount: Number(totalAmount) || 0 },
          $set: {
            updatedAt: now,
            status: "processing",
            "meta.orderType": meta?.orderType ?? existing.meta?.orderType ?? "local",
            "meta.observations": meta?.observations ?? existing.meta?.observations ?? "",
            "meta.splitCount": Number(meta?.splitCount) || existing.meta?.splitCount || 1,
          },
        }
      );

      // re-carrega para aplicar possível re-atribuição de garçom
      let updatedDoc = await OrderModel.findById(existing._id);

      if (updatedDoc && !updatedDoc.assignedAttendantId) {
        const tz =
          req.body?.tz ||
          (await RestaurantUnitModel.findById(restaurantUnit).select("timezone").lean())?.timezone ||
          "America/Sao_Paulo";

        await applyAssignmentToOrder({
          order: updatedDoc,
          unitId: String(restaurantUnit),
          tableId: Number(meta.tableId),
          preferredAttendantId: assignedAttendantId,
          preferredAttendantName: assignedAttendantName,
          now: new Date(),
          tz,
        });

        await updatedDoc.save();
      }

      // ✅ FALTAVA ISSO
      return res.status(200).json(updatedDoc);

    } else {
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
        sessionId,
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
      
      const tz =
        req.body?.tz ||
        (await RestaurantUnitModel.findById(restaurantUnit).select("timezone").lean())
          ?.timezone ||
        "America/Sao_Paulo";

      await applyAssignmentToOrder({
        order: doc,
        unitId: String(restaurantUnit),
        tableId: Number(meta.tableId),
        preferredAttendantId: assignedAttendantId,
        preferredAttendantName: assignedAttendantName,
        now: new Date(), 
        tz,               
      });

      await doc.save();
      res.setHeader("x-session-id", sessionId);
      return res.status(201).json(doc);
    }
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
          status: OrderStatus.PAID,
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

    // 🔹 agora também aceitamos includeUnassigned
    const { status, attendantId, onlyAssigned, includeUnassigned } = (req.query || {}) as {
      status?: string;
      attendantId?: string;
      onlyAssigned?: string;        // "true"
      includeUnassigned?: string;   // "true"
    };

    if (!restaurantUnitId || !mongoose.isValidObjectId(restaurantUnitId)) {
      return res.status(400).json({ message: "ID da unidade do restaurante inválido." });
    }

    const baseFilter: any = { restaurantUnit: restaurantUnitId };
    if (status) baseFilter.status = status;

    // ================================
    // Se veio attendantId, aplicamos lógica combinada:
    //  - sempre incluir pedidos já atribuídos ao garçom (mesmo sem range/mesa ativa)
    //  - opcionalmente incluir "unassigned" das mesas/horários que ele cobre AGORA
    // ================================
    if (attendantId && mongoose.isValidObjectId(attendantId)) {
      // 1) Mesas cobertas AGORA por TableAssignment ativo
      const activeTableAssigns = await (await import("../models/TableAssignment")).TableAssignmentModel
        .find({
          restaurantUnit: restaurantUnitId,
          attendant: attendantId,
          isActive: true,
        })
        .select("tableId")
        .lean();

      const activeTables = new Set<number>(activeTableAssigns.map((a: any) => Number(a.tableId)));

      // 2) Mesas cobertas AGORA por RangeAssignment válido (dia/hora da unidade)
      const { RestaurantUnitModel } = await import("../models/RestaurantUnit");
      const unit = await RestaurantUnitModel.findById(restaurantUnitId).select("timezone").lean();
      const tz = unit?.timezone || "America/Sao_Paulo";

      const { DateTime } = await import("luxon");
      const nowTZ = DateTime.now().setZone(String(tz));
      const dow = nowTZ.weekday % 7; // 0=Dom ... 6=Sáb
      const hh = String(nowTZ.hour).padStart(2, "0");
      const mm = String(nowTZ.minute).padStart(2, "0");
      const hhmmNow = `${hh}:${mm}`;

      const toHHmm = (d: Date) =>
        `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      const isWithin = (cur: string, start?: string | null, end?: string | null) =>
        !!start && !!end && start <= cur && cur <= end;

      const { RangeAssignmentModel } = await import("../models/RangeAssignment");
      const ranges = await RangeAssignmentModel.find({
        restaurantUnit: restaurantUnitId,
        attendant: attendantId,
        isActive: { $ne: false },
        $or: [{ daysOfWeek: { $size: 0 } }, { daysOfWeek: dow }],
      })
        .select("startTable endTable startsAt endsAt")
        .lean();

      for (const r of ranges) {
        const s = Number(r.startTable);
        const e = Number(r.endTable);
        const start = r.startsAt ? toHHmm(r.startsAt) : null;
        const end = r.endsAt ? toHHmm(r.endsAt) : null;
        if (!Number.isInteger(s) || !Number.isInteger(e) || s > e) continue;
        if (!isWithin(hhmmNow, start, end)) continue;
        for (let t = s; t <= e; t++) activeTables.add(t);
      }

      // ===========
      // Filtro final
      // ===========
      const orConds: any[] = [];

      // A) Sempre incluir o que já está atribuído a este garçom
      orConds.push({ assignedAttendantId: new mongoose.Types.ObjectId(attendantId) });

      // B) Incluir "sem dono" nas MESAS COBERTAS AGORA (se solicitado)
      const allowed = Array.from(activeTables).filter((n) => Number.isInteger(n));
      const wantsUnassigned = includeUnassigned === "true";
      if (wantsUnassigned && allowed.length > 0) {
        orConds.push({
          "meta.tableId": { $in: allowed },
          $or: [
            { assignedAttendantId: { $exists: false } },
            { assignedAttendantId: null },
          ],
        });
      }

      // C) Se explicitamente exigiu "só os meus", não retorna nada além do OR acima
      //    (ou seja, não cai no "tudo da unidade")
      if (onlyAssigned === "true") {
        return res.json(await OrderModel.find({ ...baseFilter, $or: orConds }).sort({ createdAt: -1 }));
      }

      // Caso contrário, restringimos por mesas cobertas se existir lista; se não existir,
      // mantemos apenas o OR (meus atribuídos + possivelmente unassigned nas minhas mesas).
      const finalFilter =
        allowed.length > 0
          ? { ...baseFilter, $or: orConds.concat([{ "meta.tableId": { $in: allowed } }]) }
          : { ...baseFilter, $or: orConds };

      const orders = await OrderModel.find(finalFilter).sort({ createdAt: -1 });
      return res.json(orders);
    }

    // Sem attendantId → comportamento anterior (por unidade, opcionalmente status)
    const orders = await OrderModel.find(baseFilter).sort({ createdAt: -1 });
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
    
    const userId = req.user?.id; 
    const role = String(req.user?.role || "");
    const isManagerOrAttendant = role === "MANAGER" || role === "ATTENDANT";
    
    if (!isManagerOrAttendant) {
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
  try {
    const unitId  = String((req.params as any).restaurantUnitId ?? (req.query as any).unitId ?? "");
    const tableId = Number((req.params as any).tableId ?? (req.query as any).tableId ?? NaN);
    const guestId = String((req.params as any).guestId ?? (req.query as any).guestId ?? "");

    if (!guestId || !Number.isFinite(tableId)) {
      return res.status(400).json({ message: "guestId e tableId são obrigatórios." });
    }

    const openStatuses = ["processing", "completed", "payment_requested"];

    const query: any = { "guestInfo.id": guestId, "meta.tableId": tableId, status: { $in: openStatuses }}; 
    if (unitId) query.restaurantUnit = unitId;                                

    const orders = await OrderModel.find(query).sort({ createdAt: -1 }).lean(); 
    if (!orders.length) return res.status(204).send();
    return res.status(200).json(orders);
  } catch (err) {
    console.error("Erro ao buscar pedidos do convidado:", err);
    return res.status(500).json({ message: "Erro ao buscar pedidos." });
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

export const removeOrderItemController = async (req: Request, res: Response) => {
  try {
    const { unitId, orderId, itemId } = req.params;

    const order = await OrderModel.findOne({ _id: orderId, restaurantUnit: unitId });
    if (!order) return res.status(404).json({ message: "Order not found" });

    // remove fisicamente o item
    order.items = (order.items || []).filter((it: any) => String(it._id) !== String(itemId));

    // salva — teu pre('save') recalcula totalAmount automaticamente
    await order.save();
    return res.json(order.toObject());
  } catch (err: any) {
    return res.status(500).json({ message: "Failed to remove item", error: String(err?.message || err) });
  }
};

// Atualizar quantidade/detalhes de item específico de um pedido
export const updateOrderItemController = async (req: Request, res: Response) => {
  const { tableId, orderId, itemId } = req.params as any;
  const { guestId, quantity, status, servedAt } = (req.body || {}) as any;

  const role = String(req.user?.role || "");
  const isManagerOrAttendant = role === "MANAGER" || role === "ATTENDANT";

  try {
    // 0) validações de ids
    if (!Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "orderId inválido." });
    }
    if (!Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({ message: "itemId inválido." });
    }

    const tableNum = Number(tableId);
    if (Number.isNaN(tableNum)) {
      return res.status(400).json({ message: "tableId inválido." });
    }

    // 1) Confirma pedido + mesa
    const doc = await OrderModel.findOne({ _id: orderId, "meta.tableId": tableNum });
    if (!doc) return res.status(404).json({ message: "Pedido não encontrado." });

    const currentUserId = String(req.user?.id ?? "");

    // 2) Gates (manager/attendant passa; demais checam range)
    if (!isManagerOrAttendant) {
      if (doc.assignedAttendantId && String(doc.assignedAttendantId) !== currentUserId) {
        return res.status(403).json({ message: "Você não está atribuído a este pedido." });
      }
      if (!doc.assignedAttendantId) {
        const canOperate = await isTableInCurrentRange({
          unitId: String(doc.restaurantUnit),
          attendantId: currentUserId,
          tableId: tableNum,
        });
        if (!canOperate) {
          return res.status(403).json({ message: "Pedido fora do seu range/horário." });
        }
      }
    }

    // 3) Filtro base robusto com ObjectId no subdocumento
    const baseFilter: any = {
      _id: new Types.ObjectId(orderId),
      "meta.tableId": tableNum,
      isPaid: false,
      status: { $in: ["processing", "payment_requested"] },
      "items._id": new Types.ObjectId(itemId),
    };
    if (guestId) baseFilter["guestInfo.id"] = guestId;

    const now = new Date();
    const $set: any = {};
    const $unset: any = {};
    const $currentDate: any = { "items.$.updatedAt": true };

    // 4) quantity
    if (typeof quantity === "number") {
      if (quantity <= 0) {
        $set["items.$.quantity"] = 0;
        $set["items.$.status"] = "cancelled";
        $set["items.$.cancelledAt"] = now;
        $unset["items.$.completedAt"] = "";
      } else {
        $set["items.$.quantity"] = quantity;
      }
    }

    // 5) status (inclui 'added' → mantém processing e só atualiza timestamps)
    if (typeof status === "string") {
      const normalized = status.toLowerCase();
      if (["processing", "completed", "cancelled", "reduced", "added"].includes(normalized)) {
        if (normalized === "completed") {
          const ts = servedAt ? new Date(servedAt) : now;
          $set["items.$.status"] = "completed";
          $set["items.$.completedAt"] = ts;
          $unset["items.$.cancelledAt"] = "";
        } else if (normalized === "cancelled") {
          $set["items.$.status"] = "cancelled";
          $set["items.$.cancelledAt"] = now;
          $unset["items.$.completedAt"] = "";
        } else if (normalized === "reduced") {
          $set["items.$.status"] = "reduced";
          $unset["items.$.completedAt"] = "";
          $unset["items.$.cancelledAt"] = "";
        } else if (normalized === "added") {
          // mantém como 'processing' mas registra atualização
          $set["items.$.status"] = "processing";
          $unset["items.$.completedAt"] = "";
          $unset["items.$.cancelledAt"] = "";
        } else {
          // processing explícito
          $set["items.$.status"] = "processing";
          $unset["items.$.completedAt"] = "";
          $unset["items.$.cancelledAt"] = "";
        }
      }
    }

    if (!Object.keys($set).length && !Object.keys($unset).length) {
      return res.status(400).json({ message: "Nada para atualizar." });
    }

    const updateOp: any = { $set, $currentDate };
    if (Object.keys($unset).length) updateOp.$unset = $unset;

    const updated = await OrderModel.findOneAndUpdate(baseFilter, updateOp, { new: true });
    if (!updated) {
      return res.status(404).json({ message: "Pedido/Item não encontrado ou bloqueado para edição." });
    }

    // 6) Recompute tolerante a erro
    let recomputed = null;
    try { recomputed = await recomputeAndReturn(String(updated._id)); } catch {}

    return res.json(recomputed ?? updated);
  } catch (e) {
    console.error("Erro ao atualizar item:", {
      params: req.params,
      body: req.body,
      error: e,
    });
    return res.status(500).json({ message: "Erro ao atualizar item." });
  }
};

// Mudar para quem dos garçons registrados irá os pedidos
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

export const addOrderItemExceptionController = async (req: Request, res: Response) => {
  try {
    const { unitId, orderId, itemId } = req.params;
    const { reason, discount } = req.body || {};

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: "Reason is required" });
    }

    const order = await OrderModel.findOne({ _id: orderId, restaurantUnit: unitId });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const item: any = order.items?.find((it: any) => String(it._id) === String(itemId));
    if (!item) return res.status(404).json({ message: "Item not found" });

    const note = `[EXCEÇÃO] ${String(reason).trim()}${discount ? ` (abatimento R$ ${n0(discount).toFixed(2)})` : ""}`;

    // 1) addon negativo para abater no total (compatível com teu pre('save'))
    const dec = n0(discount);
    if (dec > 0) {
      if (!Array.isArray(item.addons)) item.addons = [];
      item.addons.push({
        name: note,
        price: -dec,      // valor negativo
        quantity: 1,
      });
    }

    // 2) guarda a nota no próprio item (campo já existe)
    const currObs = String(item.observations || "");
    item.observations = currObs
      ? `${currObs} | ${note}`
      : note;

    await order.save(); // pre('save') recalcula totalAmount
    return res.json(order.toObject());
  } catch (err: any) {
    return res.status(500).json({ message: "Failed to add exception", error: String(err?.message || err) });
  }
};

export const applyOrderCouponController = async (req: Request, res: Response) => {
  try {
    const { unitId, orderId } = req.params;
    const { kind, value, code } = req.body || {};

    if (!["percent", "absolute"].includes(String(kind))) {
      return res.status(400).json({ message: "Invalid kind. Use 'percent' or 'absolute'." });
    }
    const v = n0(value);
    if (!(Number.isFinite(v) && v > 0)) {
      return res.status(400).json({ message: "Invalid value." });
    }

    const order = await OrderModel.findOne({ _id: orderId, restaurantUnit: unitId });
    if (!order) return res.status(404).json({ message: "Order not found" });

    // base para cálculo percentual: subtotal SEM itens de cupom já existentes
    const base = computeSubtotalWithoutCoupons(order);

    let amount = 0;
    if (kind === "percent") {
      const pct = Math.max(0, Math.min(100, v));
      amount = (pct / 100) * base;
    } else {
      amount = Math.min(base, v);
    }
    if (amount <= 0) {
      return res.status(400).json({ message: "Nothing to discount on current subtotal." });
    }

    // insere um "item negativo" representando o cupom/ajuste
    const label = code ? `[CUPOM ${String(code).trim()}]` : "[AJUSTE GERENTE]";
    order.items = order.items || [];
    order.items.push({
      name: label,
      price: -amount,     // valor negativo
      quantity: 1,
      addons: [],
      status: "added",
      isOnPromotion: false,
      originalPrice: 0,
    } as any);

    // opcional: também registra no meta.observations para auditoria
    const obs = String(order?.meta?.observations || "");
    const cupomObs = `${label} ${kind === "percent" ? `(${v}%)` : `(R$ ${amount.toFixed(2)})`}`;
    const newObs = obs ? `${obs} | ${cupomObs}` : cupomObs;
    order.meta = order.meta || {} as any;
    order.meta && order.meta.observations == newObs;

    await order.save(); // pre('save') recalcula totalAmount com o item negativo
    return res.json(order.toObject());
  } catch (err: any) {
    return res.status(500).json({ message: "Failed to apply coupon", error: String(err?.message || err) });
  }
};

export async function getTableStatus(req: Request, res: Response) {
  try {
    const unitId = String(req.params.unitId);
    const tableId = Number(req.params.tableId);

    if (!unitId || !Number.isFinite(tableId)) {
      return res.status(400).json({ message: "unitId/tableId inválidos" });
    }

    const orders = await OrderModel.find(
      {
        restaurantUnit: unitId,
        "meta.tableId": tableId,
      },
      { status: 1, isPaid: 1, meta: 1, createdAt: 1, updatedAt: 1 },
    ).lean();

    let hasPayment = false;
    let hasOpen = false;

    for (const o of orders) {
      const s = String(o.status || "").toLowerCase();
      const isPaid = o.isPaid === true || s === "paid";

      const hasPayReq =
        s === "payment_requested" ||
        (!!o?.meta?.paymentRequestedAt && !isPaid);

      if (hasPayReq) hasPayment = true;
      if (!isPaid && (s === "processing" || s === "completed")) hasOpen = true;
    }

    const status = hasPayment ? "payment_requested" : hasOpen ? "occupied" : "free";
    return res.json({ status, tableId, unitId });
  } catch (e: any) {
    console.error("getTableStatus error:", e);
    return res.status(500).json({ message: "Erro ao obter status da mesa" });
  }
}

export async function requestHelpController(req: Request, res: Response) {
  const { unitId, orderId } = req.params;
  const userRole = String(req.user?.role || ""); 

  // 1) validação básica
  const order = await OrderModel.findOne({ _id: orderId, restaurantUnit: unitId });
  if (!order) return res.status(404).json({ message: "Pedido não encontrado" });

  // 2) grava o sinal (idempotente por minuto)
  const now = new Date();
  const last = order.meta && order.meta.helpRequestedAt ? new Date(order.meta.helpRequestedAt) : null;
  if (!last || now.getTime() - last.getTime() > 60_000) {
    order.meta && order.meta.helpRequestedAt === now.toISOString();
    order.meta && order.meta.helpResolvedAt === null;
    order.meta && order.meta.helpResolvedById === null;
    await order.save();
  }

  return res.json({ ok: true, helpRequestedAt: order.meta && order.meta.helpRequestedAt });
}
