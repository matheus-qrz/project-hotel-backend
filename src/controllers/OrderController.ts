import { Request, Response } from "express";
import { OrderModel, getGuestOrders } from "../models/Order";
import { UserModel } from "../models/User";
import { RestaurantUnitModel } from "../models/RestaurantUnit";
import crypto from "crypto";
import { RestaurantModel } from "../models/Restaurant";
import mongoose from "mongoose";

// Controlador para criar pedidos
export const createOrderHandler = async (req: Request, res: Response) => {
  const {
    userId,
    restaurantUnitId,
    restaurantId,
    items,
    totalAmount,
    guestInfo,
    meta,
    sessionId
  } = req.body;

  try {
    if (!meta?.tableId || !guestInfo?.id || !guestInfo.name) {
      return res.status(400).json({
        message: "Número da mesa e guestId são obrigatórios"
      });
    }

    const establishmentId = restaurantUnitId || restaurantId;

    if (!establishmentId) {
      return res.status(400).json({
        message: "ID do restaurante ou unidade é obrigatório"
      });
    }

    // Verifique se já existe um pedido ativo para o guestInfo
    const existingOrder = await OrderModel.findOne({
      'meta.guestId': guestInfo.id,
      'meta.tableId': meta.tableId,
      status: { $nin: ['completed', 'cancelled'] },
      isPaid: false
    });

    if (existingOrder) {
      // Atualize o pedido existente com novos itens e ajuste o total
      existingOrder.items.push(...items);
      existingOrder.totalAmount += totalAmount;
      existingOrder.updatedAt = new Date(); // Atualize o timestamp
      await existingOrder.save();

      console.log('Pedido atualizado com sucesso:', existingOrder);

      return res.status(200).json(existingOrder);
    }

    // Se não houver um pedido ativo, crie um novo
    const orderData: any = {
      restaurantUnit: establishmentId,
      items,
      totalAmount,
      status: 'pending',
      isPaid: false,
      guestInfo: {
        id: guestInfo.id,
        name: guestInfo.name,
        joinedAt: guestInfo.joinedAt || new Date()
      },
      sessionId: sessionId || crypto.randomUUID(),
      isGuest: guestInfo ? true : false,
      meta: {
        ...meta,
        orderCreatedAt: new Date(),
        sessionGroup: `table_${meta.tableId}_${new Date().toISOString().split('T')[0]}`,
        guestId: guestInfo.id
      }
    };

    const order = new OrderModel(orderData);
    await order.save();

    if (userId) {
      await UserModel.findByIdAndUpdate(
        userId,
        {
          $push: {
            orders: order._id
          }
        },
        { new: true }
      );
    }

    if (establishmentId) {
      const updateModel = restaurantUnitId ? RestaurantUnitModel : RestaurantModel;
      await (updateModel as any).findByIdAndUpdate(
        establishmentId,
        {
          $push: {
            orders: order._id
          },
        },
        { new: true }
      );
    }

    console.log('Pedido criado com sucesso:', order);

    res.status(201).json(order);
  } catch (error) {
    console.error("Erro ao criar pedido:", error);
    res.status(500).json({
      message: "Erro ao criar pedido",
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
};

// Controlador para solicitar fechamento de conta de uma mesa
export const requestTableCheckoutHandler = async (req: Request, res: Response) => {
  const { restaurantUnitId, restaurantId, tableId, splitCount, guestId } = req.body;

  try {
    // Construa a query com base no que está disponível
    const query: any = {
      'meta.tableId': String(tableId),  // Certifique-se de que ambos são strings
      status: { $nin: ['completed', 'cancelled'] },
      isPaid: false,
      'meta.guestId': guestId
    };

    // Use restaurantUnitId ou restaurantId
    if (restaurantUnitId) {
      query.restaurantUnit = restaurantUnitId;
    } else if (restaurantId) {
      query.restaurantId = restaurantId;
    }

    // Se guestId for fornecido, adicione ao query
    if (guestId) {
      query['meta.guestId'] = guestId;
    }

    console.log("Consulta para pedidos ativos:", query);
    const activeOrders = await OrderModel.find(query);
    console.log("Pedidos ativos encontrados:", activeOrders);

    if (activeOrders.length === 0) {
      return res.status(404).json({
        message: "Não foram encontrados pedidos ativos"
      });
    }

    const orderIds = activeOrders.map(order => order._id);
    const total = activeOrders.reduce((sum, order) => sum + order.totalAmount, 0);

    await OrderModel.updateMany(
      { _id: { $in: orderIds } },
      {
        $set: {
          status: 'payment_requested',
          'meta.paymentRequestedAt': new Date(),
          'meta.splitCount': splitCount || 1,
          'meta.total': total
        }
      }
    );

    res.status(200).json({
      message: "Solicitação de fechamento enviada com sucesso",
      ordersUpdated: orderIds.length,
      splitCount: splitCount || 1,
      total,
      amountPerPerson: splitCount > 1 ? total / splitCount : total
    });
  } catch (error) {
    console.error("Erro ao solicitar fechamento:", error);
    res.status(500).json({
      message: "Erro ao solicitar fechamento",
      error
    });
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
      status: { $nin: ['cancelled'] }
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
          status: 'completed',
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
  try {
    const { id } = req.params;
    const order = await OrderModel.findById(id)
      .populate('user', 'firstName lastName email')
      .populate('restaurantUnit', 'name address');

    if (!order) {
      return res.status(404).json({ message: "Pedido não encontrado" });
    }

    res.json(order);
  } catch (error) {
    console.error("Erro ao buscar pedido:", error);
    res.status(500).json({ message: "Erro ao buscar pedido", error });
  }
};

// Controlador para atualizar um pedido
export const updateOrderController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const order = await OrderModel.findById(id);
    if (!order) {
      return res.status(404).json({ message: "Pedido não encontrado" });
    }

    // Atualiza o status se fornecido
    if (updates.status) {
      order.status = updates.status;
    }

    // Atualiza os itens se fornecido
    if (updates.items) {
      updates.items.forEach((updatedItem: any) => {
        const item = order.items.find((i: any) => i._id === updatedItem._id);
        if (item) {
          item.quantity = updatedItem.quantity; // Atualiza a quantidade
        }
      });
    }

    await order.save(); // Salva as alterações
    res.json(order);
  } catch (error) {
    console.error("Erro ao atualizar pedido:", error);
    res.status(500).json({ message: "Erro ao atualizar pedido", error });
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

export const getTableOrdersController = async (req: Request, res: Response) => {
  try {
    const { restaurantUnitId, tableId } = req.params;
    const { guestId } = req.query; // Novo parâmetro

    const query: any = {
      restaurantUnit: restaurantUnitId,
      'meta.tableId': tableId,
      status: { $nin: ['cancelled'] }
    };

    // Se fornecido guestId, buscar apenas os pedidos daquele convidado
    if (guestId) {
      query['meta.guestId'] = guestId;
    }

    const orders = await OrderModel.find(query)
      .sort({ createdAt: -1 })
      .lean();

    if (!orders || orders.length === 0) {
      return res.json({
        orders: [],
        summary: {
          total: 0,
          itemCount: 0,
          orderCount: 0,
          paymentRequested: false,
          allPaid: false,
          splitCount: 1,
          amountPerPerson: 0
        }
      });
    }

    // Agrupar pedidos por convidado
    const ordersByGuest = orders.reduce((acc: { [key: string]: typeof orders }, order) => {
      const guestId = order.meta?.guestId || 'unknown';
      if (!acc[guestId]) {
        acc[guestId] = [];
      }
      acc[guestId].push(order);
      return acc;
    }, {} as { [key: string]: typeof orders });

    // Se um guestId específico foi solicitado, retornar apenas seus pedidos
    const relevantOrders = guestId ? orders : Object.values(ordersByGuest).flat();

    const total = relevantOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const items = relevantOrders.flatMap(order => order.items);
    const paymentRequested = relevantOrders.some(order => order.status === 'payment_requested');
    const allPaid = relevantOrders.every(order => order.isPaid);
    const splitCount = relevantOrders[0]?.meta?.splitCount || 1;

    res.json({
      orders: relevantOrders,
      summary: {
        total,
        itemCount: items.length,
        orderCount: relevantOrders.length,
        paymentRequested,
        allPaid,
        splitCount,
        amountPerPerson: splitCount > 1 ? total / splitCount : total,
        guestsCount: Object.keys(ordersByGuest).length // Número de convidados únicos
      }
    });
  } catch (error) {
    console.error("Erro ao buscar pedidos:", error);
    res.status(500).json({
      message: "Erro ao buscar pedidos",
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
};


export const getGuestOrdersController = async (req: Request, res: Response) => {
  const { guestId, tableId } = req.params;

  if (!tableId) { return res.status(400).json({ message: "O parâmetro tableId é necessário." }); }

  try {
    const orders = await getGuestOrders(guestId, String(tableId));

    if (orders.length === 0) {
      return res.status(200).json({ message: "Nenhum pedido encontrado para este convidado." });
    }

    res.status(200).json({ orders });
  } catch (error) {
    console.error("Erro ao buscar pedidos do convidado:", error);
    res.status(500).json({ message: "Erro ao buscar pedidos do convidado", error });
  }
};

export const cancelOrderController = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;

    const order = await OrderModel.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Pedido não encontrado" });
    }

    // Atualizar usando updateOne para evitar problemas de tipagem
    await OrderModel.updateOne(
      { _id: orderId },
      {
        $set: {
          status: 'cancelled',
          isCancelled: true,
          'items.$[].status': 'cancelled'
        }
      }
    );

    const updatedOrder = await OrderModel.findById(orderId);
    res.json(updatedOrder);
  } catch (error) {
    console.error("Erro ao cancelar pedido:", error);
    res.status(500).json({
      message: "Erro ao cancelar pedido",
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
};

export const cancelOrderItemController = async (req: Request, res: Response) => {
  try {
    const { orderId, itemId } = req.params;

    const order = await OrderModel.findOneAndUpdate(
      {
        _id: orderId,
        'items._id': itemId
      },
      {
        $set: {
          'items.$.status': 'cancelled'
        }
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: "Pedido ou item não encontrado" });
    }

    // Verificar se todos os items foram cancelados
    const allCancelled = order.items.every((item: any) => item.status === 'cancelled');
    if (allCancelled) {
      order.status = 'cancelled';
      order.isCancelled = true;
      await order.save();
    }

    res.json(order);
  } catch (error) {
    console.error("Erro ao cancelar item do pedido:", error);
    res.status(500).json({
      message: "Erro ao cancelar item do pedido",
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
};

export const updateOrderItemController = async (req: Request, res: Response) => {
  try {
    const { orderId, itemId } = req.params;
    const { quantity, observations } = req.body;

    const updateData: any = {};
    if (quantity !== undefined) updateData['items.$.quantity'] = quantity;
    if (observations !== undefined) updateData['items.$.observations'] = observations;

    const order = await OrderModel.findOneAndUpdate(
      {
        _id: orderId,
        'items._id': itemId
      },
      {
        $set: updateData
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: "Pedido ou item não encontrado" });
    }

    // Recalcular o total
    order.totalAmount = order.items.reduce((total, item: any) => {
      if (item.status !== 'cancelled') {
        return total + (item.price * item.quantity);
      }
      return total;
    }, 0);

    await order.save();
    res.json(order);
  } catch (error) {
    console.error("Erro ao atualizar item do pedido:", error);
    res.status(500).json({
      message: "Erro ao atualizar item do pedido",
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
};