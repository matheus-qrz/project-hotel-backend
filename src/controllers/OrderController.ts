import mongoose from "mongoose";
import { Request, Response } from "express";
import { OrderModel } from "../models/Order";
import { UserModel } from "../models/User";
import { RestaurantUnitModel } from "../models/RestaurantUnit";
import {  OrderStatus } from "../types/order.types";
import { recomputeAndReturn } from "../helpers/recomputeAndReturn";

// Inicializador do pedido
export const initiateOrderController = async (req: Request, res: Response) => {
  try {
    const { restaurantId } = req.params as { restaurantId: string };
    const { guestInfo, meta, items } = req.body as {
      guestInfo: { id: string; name?: string; joinedAt?: string };
      meta: { tableId: number | string; orderType?: 'local' | 'takeaway'; observations?: string; splitCount?: number };
      items: Array<any>;
    };

    // validação básica
    const tableId = Number(meta?.tableId);
    if (!restaurantId || !guestInfo?.id || Number.isNaN(tableId) || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Dados insuficientes para iniciar pedido.' });
    }

    // sessão é opcional para o match; usamos apenas para atualizar, se vier
    const sessionIdHeader = typeof req.headers['x-session-id'] === 'string' ? String(req.headers['x-session-id']) : undefined;

    // normaliza itens enviados do front
    const now = new Date();
    const itemsWithStatus = items.map((it) => ({
      // se você guarda o id do produto, mantenha em outro campo (ex.: productId)
      name: it.name,
      price: Number(it.price) || 0,
      costPrice: Number(it.costPrice) || 0,
      quantity: Math.max(1, Number(it.quantity) || 1),
      image: it.image ?? '',
      addons: Array.isArray(it.addons) ? it.addons : [],
      status: 'added',
      createdAt: now,
    }));

    // 1) Tenta acumular: pedido aberto para MESMA mesa + MESMO guest
    const existing = await OrderModel.findOne({
      restaurant: restaurantId,         // ajuste se seu schema usa outro campo
      'guestInfo.id': guestInfo.id,
      'meta.tableId': tableId,
      isPaid: false,
      status: { $in: ['processing', 'payment_requested'] },
    }).sort({ createdAt: -1 });

    if (existing && existing.meta) {
      await OrderModel.updateOne(
        { _id: existing._id },
        {
          $push: { items: { $each: itemsWithStatus } },
          $set: {
            status: 'processing',
            updatedAt: now,
            'meta.orderType': meta?.orderType ?? existing.meta.orderType,
            'meta.observations': meta?.observations ?? existing.meta.observations,
            'meta.splitCount': Number(meta?.splitCount) || existing.meta.splitCount || 1,
            ...(sessionIdHeader ? { sessionId: sessionIdHeader } : {}),
          },
        }
      );

      const recomputed = await recomputeAndReturn(String(existing._id));
      return res.status(200).json(recomputed);
    }

    // 2) Não há pedido aberto → cria um do zero
    const doc = new OrderModel({
      restaurant: restaurantId,         // ajuste aqui também conforme seu schema
      guestInfo: {
        id: guestInfo.id,
        name: guestInfo.name ?? '',
        joinedAt: guestInfo.joinedAt ? new Date(guestInfo.joinedAt) : now,
      },
      items: itemsWithStatus,
      status: 'processing',
      isPaid: false,
      sessionId: sessionIdHeader,
      meta: {
        tableId,
        orderType: meta?.orderType ?? 'local',
        observations: meta?.observations ?? '',
        splitCount: Number(meta?.splitCount) || 1,
        orderCreatedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });

    await doc.save(); // se seu schema tem pre('save') que computa totals, isso já resolve
    // se preferir padronizar:
    const recomputedNew = await recomputeAndReturn(String(doc._id));
    return res.status(201).json(recomputedNew ?? doc);
  } catch (e: any) {
    console.error('Erro ao iniciar pedido:', e);
    // devolve mensagem mais útil se for validação do mongoose
    return res.status(500).json({ message: e?.message || 'Erro interno ao iniciar pedido.' });
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

// Controlador para obter pedidos de uma unidade
export const getRestaurantUnitOrdersController = async (req: Request, res: Response) => {
  try {
    const { restaurantUnitId } = req.params;
    const { status } = req.query;

    // Verifique se restaurantUnitId é válido
    if (!restaurantUnitId || !mongoose.isValidObjectId(restaurantUnitId)) {
      return res.status(400).json({ message: "ID da unidade do restaurante inválido." });
    }

    const filter: any = { restaurantUnit: restaurantUnitId };

    if (status) {
      filter.status = status;
    }

    const orders = await OrderModel.find(filter)
      .sort({ createdAt: -1 })
      .populate('user', 'firstName lastName');

    res.json(orders);
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
    const { orderId } = req.params;
    const { status } = req.body as { status?: string };

    if (!status) return res.status(400).json({ message: 'Status não fornecido.' });

    const editable = ['processing', 'payment_requested'];

    // --- COMPLETED ---
    if (status === 'completed') {
      const result = await OrderModel.updateOne(
        { _id: orderId, status: { $in: editable } },
        {
          $set: {
            status: 'completed',
            'items.$[i].status': 'completed',
            updatedAt: new Date(),
          },
        },
        {
          arrayFilters: [
            { 'i.status': { $in: ['processing', 'added', 'reduced'] }, 'i.quantity': { $gt: 0 } },
          ],
        }
      );

      if (result.matchedCount === 0) {
        // idempotência: se já está completed, devolve OK
        const found = await OrderModel.findById(orderId).select('status');
        if (found?.status === 'completed') return res.json(found);
        return res.status(409).json({ message: 'Pedido não está disponível para conclusão.' });
      }

      const recomputed = await recomputeAndReturn(orderId);
      return res.json(recomputed);
    }

    // --- CANCELLED ---
    if (status === 'cancelled') {
      const result = await OrderModel.updateOne(
        { _id: orderId, status: { $in: editable } },
        {
          $set: {
            status: 'cancelled',
            // cancela tudo que não esteja concluído
            'items.$[i].status': 'cancelled',
            updatedAt: new Date(),
          },
        },
        {
          arrayFilters: [
            { 'i.status': { $nin: ['completed', 'cancelled'] } },
          ],
        }
      );

      if (result.matchedCount === 0) {
        const found = await OrderModel.findById(orderId).select('status');
        if (found?.status === 'cancelled') return res.json(found);
        return res.status(409).json({ message: 'Pedido não está disponível para cancelamento.' });
      }

      const recomputed = await recomputeAndReturn(orderId);
      return res.json(recomputed);
    }

    // --- PAID ---
    if (status === 'paid') {
      // permitir pagar a partir de completed OU payment_requested (dependendo da sua regra)
      const payable = ['completed', 'payment_requested'];

      const result = await OrderModel.updateOne(
        { _id: orderId, status: { $in: payable }, isPaid: { $ne: true } },
        {
          $set: {
            status: 'paid',
            isPaid: true,
            paidAt: new Date(),
            // garante que itens elegíveis fiquem completed
            'items.$[i].status': 'completed',
            updatedAt: new Date(),
          },
        },
        {
          arrayFilters: [
            { 'i.status': { $in: ['processing', 'added', 'reduced'] }, 'i.quantity': { $gt: 0 } },
          ],
        }
      );

      if (result.matchedCount === 0) {
        // idempotência: se já está paid, devolve OK
        const found = await OrderModel.findById(orderId).select('status isPaid paidAt');
        if (found?.isPaid || found?.status === 'paid') return res.json(found);
        return res.status(409).json({ message: 'Pedido não está disponível para pagamento.' });
      }

      const recomputed = await recomputeAndReturn(orderId);
      return res.json(recomputed);
    }

    // --- OUTROS STATUS (ex.: processing, payment_requested) ---
    const updated = await OrderModel.findByIdAndUpdate(
      orderId,
      { $set: { status, updatedAt: new Date() } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Pedido não encontrado.' });

    const recomputed = await recomputeAndReturn(orderId);
    return res.json(recomputed ?? updated);

  } catch (e) {
    console.error('Erro ao atualizar status do pedido:', e);
    return res.status(500).json({ message: 'Erro interno.' });
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

  const updated = await OrderModel.findOneAndUpdate(
    filter,
    { $set: { 'items.$.status': 'cancelled' } },
    { new: true }
  );
  if (!updated) return res.status(404).json({ message: 'Pedido/Item não encontrado ou já cancelado.' });

  const recomputed = await recomputeAndReturn(orderId);
  return res.json(recomputed ?? updated);
  } catch (e) {
    console.error('Erro ao cancelar item:', e);
    return res.status(500).json({ message: 'Erro ao cancelar item.' });
  }
};

// Atualizar quantidade/detalhes de item específico de um pedido
export const updateOrderItemController = async (req: Request, res: Response) => {
  const { tableId, orderId, itemId } = req.params as { tableId: string; orderId: string; itemId: string };
  const { guestId, quantity, status } = (req.body || {}) as { guestId?: string; quantity?: number; status?: string };

  try {
    const tableNum = Number(tableId);
    if (Number.isNaN(tableNum)) return res.status(400).json({ message: "tableId inválido." });

    const filter: any = {
      _id: orderId,
      'meta.tableId': tableNum,
      isPaid: false,
      status: { $in: ['processing', 'payment_requested'] },
      'items._id': itemId,
    };
    if (guestId) filter['guestInfo.id'] = guestId;
    const hdr = req.headers['x-session-id'];
    if (typeof hdr === 'string' && hdr.trim()) filter.sessionId = hdr.trim();

    const $set: any = {};
    if (typeof quantity === 'number') $set['items.$.quantity'] = quantity;
    if (typeof status === 'string')   $set['items.$.status']   = status;
        if (typeof quantity === 'number' && quantity <= 0) {
      // política: zerou quantidade ⇒ vira cancelado e quantity = 0
      $set['items.$.quantity'] = 0;
      $set['items.$.status'] = 'cancelled';
    }
    if (!Object.keys($set).length) return res.status(400).json({ message: 'Nada para atualizar.' });

    const updated = await OrderModel.findOneAndUpdate(filter, { $set }, { new: true });
    if (!updated) return res.status(404).json({ message: 'Pedido/Item não encontrado ou bloqueado para edição.' });

    // 👇 força recálculo de total/financeiro
    const recomputed = await recomputeAndReturn(orderId);
    return res.json(recomputed ?? updated);
  } catch (e) {
    console.error('Erro ao atualizar item:', e);
    return res.status(500).json({ message: 'Erro ao atualizar item.' });
  }
};
