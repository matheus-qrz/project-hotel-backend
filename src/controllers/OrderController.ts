import { Request, Response } from "express";
import { OrderModel } from "../models/Order";
import { UserModel } from "../models/User";
import { RestaurantUnitModel } from "../models/RestaurantUnit";
import crypto from "crypto";

// Controlador para criar pedidos
export const createOrderHandler = async (req: Request, res: Response) => {
  const {
    userId,
    restaurantUnitId,
    items,
    totalAmount,
    guestInfo,
    meta,
    sessionId
  } = req.body;

  try {
    // Validar tableId dentro do meta
    if (!meta?.tableId) {
      return res.status(400).json({
        message: "Número da mesa é obrigatório"
      });
    }

    // Criar o objeto base do pedido com meta atualizada
    const orderData: any = {
      restaurantUnit: restaurantUnitId,
      items,
      totalAmount,
      status: 'pending',
      isPaid: false,
      sessionId: sessionId || crypto.randomUUID(),
      meta: {
        ...meta, // Usar o objeto meta completo que já vem com tableId
        orderCreatedAt: new Date(),
        sessionGroup: `table_${meta.tableId}_${new Date().toISOString().split('T')[0]}` // Agrupa pedidos da mesma mesa/dia
      }
    };

    // Se for um usuário registrado
    if (userId) {
      orderData.user = userId;
      orderData.isGuest = false;
    }
    // Se for um convidado
    else if (guestInfo) {
      orderData.guestInfo = {
        name: guestInfo.name || `Convidado`,
        email: guestInfo.email,
        phone: guestInfo.phone
      };
      orderData.isGuest = true;
      orderData.meta.isGuest = true;
    } else {
      return res.status(400).json({
        message: "É necessário fornecer ID de usuário ou informações de convidado"
      });
    }

    // Log para debug
    console.log('Criando pedido com dados:', orderData);

    // 1. Criar o pedido
    const order = new OrderModel(orderData);
    await order.save();

    // 2. Se for usuário registrado, atualizar o documento do User
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

    // 3. Atualizar o documento do RestaurantUnit
    if (restaurantUnitId) {
      await RestaurantUnitModel.findByIdAndUpdate(
        restaurantUnitId,
        {
          $push: {
            orders: order._id
          }
        },
        { new: true }
      );
    }

    // Log do pedido criado
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
  const { restaurantUnitId, tableId, splitCount, sessionId } = req.body;

  try {
    if (!restaurantUnitId || !tableId || !sessionId) {
      return res.status(400).json({
        message: "É necessário fornecer o ID da unidade, número da mesa e ID da sessão"
      });
    }

    // Encontrar apenas os pedidos do cliente específico
    const activeOrders = await OrderModel.find({
      restaurantUnit: restaurantUnitId,
      'meta.tableId': tableId,
      sessionId: sessionId, // Filtrar apenas pelos pedidos do cliente
      status: { $nin: ['completed', 'cancelled'] },
      isPaid: false
    });

    if (activeOrders.length === 0) {
      return res.status(404).json({
        message: "Não foram encontrados pedidos ativos para este cliente"
      });
    }

    const orderIds = activeOrders.map(order => order._id);
    const sessionTotal = activeOrders.reduce((sum, order) => sum + order.totalAmount, 0);

    // Atualizar apenas os pedidos do cliente
    await OrderModel.updateMany(
      { _id: { $in: orderIds } },
      {
        $set: {
          status: 'payment_requested',
          'meta.paymentRequestedAt': new Date(),
          'meta.splitCount': splitCount || 1,
          'meta.sessionTotal': sessionTotal // Armazenar o total da sessão
        }
      }
    );

    res.status(200).json({
      message: "Solicitação de fechamento de conta enviada com sucesso",
      ordersUpdated: orderIds.length,
      splitCount: splitCount || 1,
      sessionTotal,
      amountPerPerson: splitCount > 1 ? sessionTotal / splitCount : sessionTotal
    });
  } catch (error) {
    console.error("Erro ao solicitar fechamento de conta:", error);
    res.status(500).json({
      message: "Erro ao solicitar fechamento de conta",
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

    const filter: any = { restaurantUnit: restaurantUnitId };

    // Se status foi especificado, adicionar ao filtro
    if (status) {
      filter.status = status;
    }

    const orders = await OrderModel.find(filter)
      .sort({ createdAt: -1 })
      .populate('user', 'firstName lastName email');

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

    const updatedOrder = await OrderModel.findByIdAndUpdate(
      id,
      updates,
      { new: true }
    );

    if (!updatedOrder) {
      return res.status(404).json({ message: "Pedido não encontrado" });
    }

    res.json(updatedOrder);
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
    const { sessionId } = req.query; // Identificador único do cliente

    const query = {
      sessionId: sessionId,
      restaurantUnit: restaurantUnitId,
      'meta.tableId': tableId,
      status: { $nin: ['cancelled'] }
    };

    // Se fornecido sessionId, buscar apenas os pedidos daquele cliente
    if (sessionId) {
      query.sessionId = sessionId;
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

    // Processar apenas os pedidos da sessão específica
    const sessionOrders = sessionId
      ? orders.filter(order => order.sessionId === sessionId)
      : orders;

    const sessionTotal = sessionOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const sessionItems = sessionOrders.flatMap(order => order.items);
    const paymentRequested = sessionOrders.some(order => order.status === 'payment_requested');
    const allPaid = sessionOrders.every(order => order.isPaid);
    const splitCount = sessionOrders[0]?.meta?.splitCount || 1;

    res.json({
      orders: sessionOrders,
      summary: {
        total: sessionTotal, // Total apenas dos pedidos do cliente
        itemCount: sessionItems.length,
        orderCount: sessionOrders.length,
        paymentRequested,
        allPaid,
        splitCount,
        amountPerPerson: splitCount > 1 ? sessionTotal / splitCount : sessionTotal
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


