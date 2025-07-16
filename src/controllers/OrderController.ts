import { Request, Response } from "express";
import { IOrderItem, OrderModel, getGuestOrders } from "../models/Order";
import { IUser, UserModel } from "../models/User";
import { RestaurantUnitModel } from "../models/RestaurantUnit";
import crypto from "crypto";
import { IRestaurant, RestaurantModel } from "../models/Restaurant";
import mongoose, { Model } from "mongoose";
import { OrderItemStatus, OrderItemStatusType, OrderStatus, OrderStatusType } from "../types/order.types";

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

    // Busca por pedido existente com critérios mais específicos
    const existingOrder = await OrderModel.findOne({
      'guestInfo.id': guestInfo.id,
      'meta.tableId': meta.tableId,
      isPaid: false,
      status: { $in: ['processing', 'payment_requested'] }
    });


    const itemsWithStatus = items.map((item: any) => ({
      ...item,
      status: OrderItemStatus.ADDED,
      createdAt: new Date()
    }));


    if (existingOrder) {
      // Atualiza o pedido existente usando $set e $push
      const updatedOrder = await OrderModel.findOneAndUpdate(
        { _id: existingOrder._id },
        {
          $push: { items: { $each: itemsWithStatus } },
          $inc: { totalAmount: totalAmount },
          $set: {
            updatedAt: new Date(),
            'meta.orderType': meta.orderType,
            'meta.observations': meta.observations
          }
        },
        {
          new: true,
          upsert: false
        }
      );

      console.log('Pedido atualizado com sucesso:', updatedOrder);
      return res.status(200).json(updatedOrder);
    }

    // Preparação dos dados para novo pedido
    const orderData = {
      restaurantUnit: establishmentId,
      items,
      totalAmount,
      status: OrderStatus.PROCESSING,
      isPaid: false,
      guestInfo: {
        id: guestInfo.id,
        name: guestInfo.name,
        joinedAt: guestInfo.joinedAt || new Date()
      },
      sessionId: sessionId || crypto.randomUUID(),
      isGuest: true,
      meta: {
        ...meta,
        orderCreatedAt: new Date(),
        sessionGroup: `table_${meta.tableId}_${new Date().toISOString().split('T')[0]}`,
        guestId: guestInfo.id
      }
    };

    // Cria novo pedido
    const order = new OrderModel(orderData);
    await order.save();

    // Atualiza referências
    const updatePromises: Promise<any>[] = [];

    if (userId) {
      updatePromises.push(
        UserModel.findByIdAndUpdate<IUser>(
          userId,
          { $addToSet: { orders: order._id } },
          { new: true }
        ).exec()
      );
    }

    if (establishmentId) {
      const updateModel = restaurantUnitId ? RestaurantUnitModel : RestaurantModel;
      updatePromises.push(
        (updateModel as Model<IRestaurant>).findByIdAndUpdate(
          establishmentId,
          { $addToSet: { orders: order._id } },
          { new: true }
        ).exec()
      );
    }

    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
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

// Controlador para requisição de pagamento por pedido de cliente
export const requestOrderCheckout = async (req: Request, res: Response) => {
  const { orderIds, guestId, splitCount } = req.body;

  try {
    if (!orderIds?.length || !guestId) {
      return res.status(400).json({
        message: "IDs dos pedidos e ID do cliente são obrigatórios"
      });
    }

    const orders = await OrderModel.find({
      _id: { $in: orderIds },
      'guestInfo.id': guestId,
      isPaid: false,
      status: { $nin: ['completed', 'cancelled', 'payment_requested'] }
    });

    if (!orders.length) {
      return res.status(404).json({
        message: "Não foram encontrados pedidos ativos"
      });
    }

    const updatedOrders = await Promise.all(
      orders.map(order =>
        OrderModel.findByIdAndUpdate(
          order._id,
          {
            $set: {
              status: 'payment_requested',
              'meta.splitCount': splitCount,
              'meta.paymentRequestedAt': new Date()
            }
          },
          { new: true }
        )
      )
    );

    res.status(200).json(updatedOrders);
  } catch (error) {
    console.error("Erro ao solicitar fechamento:", error);
    res.status(500).json({
      message: "Erro ao solicitar fechamento",
      error: error instanceof Error ? error.message : 'Erro desconhecido'
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
    const { orderId } = req.params;
    const updates = req.body;

    // Primeiro, verifica se o pedido existe
    const existingOrder = await OrderModel.findOne({
      _id: orderId,
      isPaid: false,
      status: { $ne: OrderStatus.CANCELLED }
    });

    if (!existingOrder) {
      return res.status(404).json({ message: "Pedido não encontrado" });
    }
    let itemsUpdate = {};
    if (updates.status) {
      switch (updates.status as OrderStatusType) {
        case OrderStatus.COMPLETED: itemsUpdate = {
          'items.$[].status': OrderItemStatus.COMPLETED
        };
          break;
        case OrderStatus.PROCESSING: itemsUpdate = {
          'items.$[item].status': OrderItemStatus.ADDED
        };
          break;
        case OrderStatus.CANCELLED: itemsUpdate = {
          'items.$[].status': OrderItemStatus.CANCELLED
        };
          break;
        case OrderStatus.PAYMENT_REQUESTED:
          // Lógica específica para pagamento solicitado          
          break;
        case OrderStatus.PAID:
          // Lógica específica para pedido pago          
          break;
      }
    }

    // Se estiver atualizando o status para 'completed', atualiza também o status dos itens
    if (updates.status === OrderStatus.COMPLETED) {
      updates['items'] = existingOrder.items.map(item => ({
        ...item,
        status: OrderStatus.COMPLETED
      }));
    }

    // Realiza a atualização
    const order = await OrderModel.findByIdAndUpdate(
      orderId,
      { $set: updates },
      { new: true }
    );

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
      status: { $nin: OrderStatus.CANCELLED },
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
          status: OrderStatus.CANCELLED,
          isCancelled: true,
          'items.$[].status': OrderItemStatus.CANCELLED,
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

export const addItemsToOrderController = async (req: Request, res: Response) => {
  try {
    const { tableId, guestId } = req.params;
    const { items, totalAmount } = req.body;

    const existingOrder = await OrderModel.findOne({
      'meta.tableId': Number(tableId),
      'guestInfo.id': guestId,
      status: { $in: [OrderStatus.PROCESSING, OrderStatus.PAYMENT_REQUESTED] },
      isPaid: false
    });

    if (existingOrder) {
      // Adiciona createdAt aos novos itens, se ainda não tiver
      const enrichedItems = items.map((item: any) => ({
        ...item,
        createdAt: item.createdAt || new Date(),
        addons: (item.addons || []).map((addon: any) => ({
          ...addon,
          createdAt: addon.createdAt || new Date()
        }))
      }));

      const updatedOrder = await OrderModel.findByIdAndUpdate(
        existingOrder._id,
        {
          $push: { items: { $each: enrichedItems } },
          $set: { totalAmount: existingOrder.totalAmount + totalAmount }
        },
        { new: true }
      );

      return res.json(updatedOrder);
    }

    // Caso contrário, retorne erro — não deve criar novo pedido aqui!
    return res.status(404).json({ message: "Pedido em andamento não encontrado para adicionar itens." });

  } catch (error) {
    console.error("Erro ao adicionar itens ao pedido:", error);
    res.status(500).json({
      message: "Erro ao adicionar itens ao pedido",
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
          'items.$.status': OrderItemStatus.CANCELLED
        }
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: "Pedido ou item não encontrado" });
    }

    // Verificar se todos os items foram cancelados
    const allCancelled = order.items.every((item: any) => item.status === OrderItemStatus.CANCELLED);
    if (allCancelled) {
      order.status = OrderStatus.CANCELLED;
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
    const { quantity, observations, status } = req.body;

    // Primeiro, verifica se o pedido existe
    const existingOrder = await OrderModel.findOne({
      _id: orderId,
      'items._id': itemId,
      isPaid: false,
      status: { $ne: OrderStatus.CANCELLED }
    });

    if (!existingOrder) {
      return res.status(404).json({ message: "Pedido ou item não encontrado" });
    }

    const updateData: Partial<IOrderItem> = {};
    if (quantity !== undefined) {
      updateData.quantity = quantity;
      updateData.status = OrderItemStatus.ADDED;
    }

    if (observations !== undefined) updateData.observations = observations;
    if (status !== undefined) updateData.status = status as OrderItemStatusType;

    // Atualiza o item
    const updatedOrder = await OrderModel.findOneAndUpdate(
      {
        _id: orderId,
        'items._id': itemId
      },
      { $set: updateData },
      { new: true }
    );

    if (!updatedOrder) {
      return res.status(404).json({ message: "Erro ao atualizar item" });
    }

    // Recalcula o total
    const totalAmount = updatedOrder.items.reduce((total, item: any) => {
      if (item.status !== OrderItemStatus.CANCELLED) {
        return total + (item.price * item.quantity);
      }
      return total;
    }, 0);

    // Atualiza o total
    const finalOrder = await OrderModel.findByIdAndUpdate(
      orderId,
      { $set: { totalAmount } },
      { new: true }
    );

    res.json(finalOrder);
  } catch (error) {
    console.error("Erro ao atualizar item do pedido:", error);
    res.status(500).json({
      message: "Erro ao atualizar item do pedido",
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
};