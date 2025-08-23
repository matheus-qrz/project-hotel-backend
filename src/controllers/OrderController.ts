import mongoose from "mongoose";
import { Request, Response } from "express";
import { OrderModel } from "../models/Order";
import { UserModel } from "../models/User";
import { RestaurantUnitModel } from "../models/RestaurantUnit";
import {  OrderItemStatus, OrderStatus, OrderStatusType } from "../types/order.types";
import { recomputeAndReturn } from "../helpers/recomputeAndReturn";
import { computeTotal } from "../utils/computeTotal";

// Inicializador do pedido
export const initiateOrderController = async (req: Request, res: Response) => {
  try {
    const { restaurantId } = req.params as { restaurantId: string };
    const { guestInfo, meta, items, totalAmount } = req.body as any;

    if (
      !restaurantId ||
      !guestInfo?.id ||
      !meta?.tableId ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res
        .status(400)
        .json({ message: "Dados insuficientes para iniciar pedido." });
    }

    const now = new Date();
    const amount = Math.round((Number(totalAmount) || 0) * 100) / 100;

    // Garante status/createdAt em itens e addons
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

    // Filtro: pedido aberto do mesmo convidado na mesma mesa
    const filter: any = {
      restaurant: restaurantId, // (se seu schema usa restaurantUnit, troque a chave aqui)
      "guestInfo.id": guestInfo.id,
      "meta.tableId": Number(meta.tableId),
      isPaid: false,
      status: { $in: ["processing", "payment_requested"] },
    };

    const upserted = await OrderModel.findOneAndUpdate(
      filter,
      {
        $push: { items: { $each: itemsWithStatus } },
        $inc: { totalAmount: amount },
        $set: {
          status: "processing",
          updatedAt: now,
          "meta.orderType": meta?.orderType ?? "local",
          "meta.observations": meta?.observations ?? "",
          "meta.splitCount": Number(meta?.splitCount) || 1,
        },
        $setOnInsert: {
          restaurant: restaurantId,
          guestInfo: {
            id: guestInfo.id,
            name: guestInfo.name ?? "",
            joinedAt: guestInfo.joinedAt ? new Date(guestInfo.joinedAt) : now,
          },
          meta: {
            tableId: Number(meta.tableId),
            orderType: meta?.orderType ?? "local",
            observations: meta?.observations ?? "",
            splitCount: Number(meta?.splitCount) || 1,
            orderCreatedAt: now,
          },
          isPaid: false,
          createdAt: now,
          updatedAt: now,
        },
      },
      { new: true, upsert: true }
    );

    return res.status(200).json(upserted);
  } catch (e: any) {
    if (e?.code === 11000) {
      return res.status(409).json({
        message:
          "Já existe um pedido em aberto para este convidado nesta mesa.",
      });
    }
    console.error("Erro ao iniciar pedido:", e);
    return res
      .status(500)
      .json({ message: "Erro interno ao iniciar pedido." });
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
    const { orderId } = req.params as { orderId: string };
    const { status } = req.body as { status: OrderStatusType };

    if (!status) return res.status(400).json({ message: 'Status não fornecido.' });

    // Fluxo especial para PAID (idempotente e consistente)
    if (status === OrderStatus.PAID) {
      const order = await OrderModel.findById(orderId);
      if (!order) return res.status(404).json({ message: 'Pedido não encontrado.' });

      // idempotência
      if (order.isPaid === true || order.status === OrderStatus.PAID) {
        return res.status(200).json(order);
      }

      // só deixa pagar se já estiver concluído ou com pagamento solicitado
      if (order.status !== OrderStatus.COMPLETED &&
          order.status !== OrderStatus.PAYMENT_REQUESTED) {
        return res.status(409).json({
          message: 'Só é possível marcar como pago um pedido concluído ou com pagamento solicitado.'
        });
      }

      const newTotal = computeTotal(order.items);

      // Atualiza pedido e marca itens pendentes como completed em uma única operação
      await OrderModel.updateOne(
        { _id: orderId },
        {
          $set: {
            status: OrderStatus.PAID,
            isPaid: true,
            paidAt: new Date(),
            totalAmount: newTotal,
            updatedAt: new Date(),
          },
          // itens "ativos" viram completed ao fechar a conta
          $setOnInsert: {}
        },
        { runValidators: false }
      );

      // aplica status completed nos itens ativos usando arrayFilters
      await OrderModel.updateOne(
        { _id: orderId },
        { $set: { 'items.$[i].status': OrderItemStatus.COMPLETED } },
        {
          arrayFilters: [
            { 'i.status': { $in: ['added', 'processing', 'reduced'] }, 'i.quantity': { $gt: 0 } }
          ],
          runValidators: false
        }
      );

      const updated = await OrderModel.findById(orderId);
      return res.status(200).json(updated);
    }

    // Demais status: atualização simples + updatedAt
    const updatedOrder = await OrderModel.findByIdAndUpdate(
      orderId,
      { $set: { status, updatedAt: new Date() } },
      { new: true }
    );

    if (!updatedOrder) return res.status(404).json({ message: 'Pedido não encontrado.' });
    return res.status(200).json(updatedOrder);
  } catch (error: any) {
    console.error('Erro ao atualizar status do pedido:', error);
    return res.status(500).json({ message: error?.message || 'Erro interno.' });
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
