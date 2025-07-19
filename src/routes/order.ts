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
    initiateOrderController);

  // Rota para solicitar fechamento de conta (aberta para convidados)
  orderRouter.post("/restaurant/:restaurantId/:tableId/order/request-checkout", requestOrderCheckout);

  // Rota para processar pagamento (requer autenticação de staff)
  orderRouter.post("/restaurant/:restaurantId/:tableId/order/process-payment", isAuthenticated, hasRole('MANAGER'), processTablePaymentHandler);

  // Listar pedidos de uma unidade (requer autenticação)
  orderRouter.get(
    "/restaurant/:restaurantUnitId/orders",
    getRestaurantUnitOrdersController
  );

  // Listar pedidos de uma mesa específica
  orderRouter.get(
    "/restaurant/:restaurantUnitId/:tableId/orders",
    getTableOrdersController
  );

  // Visualizar um pedido específico
  // Não requer autenticação, mas seria bom adicionar alguma validação
  // como um token temporário para convidados
  orderRouter.get("/order/:id", getOrderByIdController);

  orderRouter.get("/restaurant/table/:tableId/guest/:guestId/orders", getGuestOrdersController);

  // Atualizar pedido (requer autenticação)
  orderRouter.patch(
    '/restaurant/:restaurantId/order/:orderId/status',
    isAuthenticated,
    updateOrderStatusController
  );

  // Excluir pedido (requer autenticação)
  orderRouter.delete(
    "/order/:orderId/delete",
    isAuthenticated,
    deleteOrderController
  );

  // Adicionar às rotas existentes:
  orderRouter.patch(
    "/restaurant/:restaurantId/:tableId/order/:orderId/cancel",
    cancelOrderController
  );

  orderRouter.patch(
    "/restaurant/:restaurantId/:tableId/order/:orderId/item/:itemId/cancel",
    cancelOrderItemController
  );

  orderRouter.patch(
    "/restaurant/:restaurantId/:tableId/order/:orderId/item/:itemId/update",
    updateOrderItemController
  );
};