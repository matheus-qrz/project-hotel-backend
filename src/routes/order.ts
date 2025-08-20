import { Router } from "express";
import {
  deleteOrderController,
  getRestaurantUnitOrdersController,
  getOrderByIdController,
  updateOrderStatusController,
  requestOrderCheckout,
  getTableOrdersController,
  processTablePaymentHandler,
  cancelOrderController,
  cancelOrderItemController,
  updateOrderItemController,
  getGuestOrdersController,
  initiateOrderController
} from "../controllers/OrderController";
import { isAuthenticated, hasRole } from "../middlewares/index";

export default (orderRouter: Router) => {
  // Rota para criação de pedidos (aberta para convidados)
  orderRouter.post("/restaurant/:restaurantId/order/initiate", initiateOrderController);

  // Rota para usuários autenticados criarem pedidos
  orderRouter.post("/:userId/:restaurantId/order/initiate",
    isAuthenticated,
    hasRole(['CLIENT']),
    initiateOrderController);

  // Rota para solicitar fechamento de conta 
  orderRouter.post(
    "/restaurant/:restaurantId/:tableId/order/:orderId/request-checkout",
    requestOrderCheckout
  );

  // Rota para processar pagamento (requer autenticação de staff)
  orderRouter.post("/restaurant/:restaurantId/:tableId/order/process-payment", isAuthenticated, hasRole('MANAGER'), processTablePaymentHandler);

  // Listar pedidos de uma unidade (requer autenticação)
  orderRouter.get(
    "/restaurant/:restaurantUnitId/orders",
    isAuthenticated,
    hasRole(['ADMIN', 'MANAGER']),
    getRestaurantUnitOrdersController
  );

  // Listar pedidos de uma mesa específica
  orderRouter.get("/restaurant/:restaurantId/:tableId/orders", getTableOrdersController);

  // Visualizar um pedido específico
  orderRouter.get("/restaurant/:restaurantId/:tableId/order/:orderId", getOrderByIdController);

  // Listar pedidos de convidado específico
  orderRouter.get("/restaurant/:restaurantId/:tableId/guest/:guestId/orders", getGuestOrdersController);

  // Atualizar status de pedido (requer autenticação)
  orderRouter.patch(
    '/restaurant/:restaurantId/order/:orderId/status',
    isAuthenticated,
    hasRole(['MANAGER', 'ATTENDANT']),
    updateOrderStatusController
  );

  // Excluir pedido (requer autenticação)
  orderRouter.delete(
    "/order/:orderId/delete",
    isAuthenticated,
    deleteOrderController
  );

  // Cancelar pedido:
  orderRouter.post("/restaurant/:restaurantId/:tableId/order/:orderId/cancel", cancelOrderController);

  // Cancelar item de pedido
  orderRouter.post("/restaurant/:restaurantId/:tableId/order/:orderId/items/:itemId/cancel", cancelOrderItemController);

  // Atualizar quantidade/detalhes de item específico de um pedido
  orderRouter.patch("/restaurant/:restaurantId/:tableId/order/:orderId/items/:itemId", updateOrderItemController);
};