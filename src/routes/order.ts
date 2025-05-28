import { Router } from "express";
import {
  createOrderHandler,
  deleteOrderController,
  getRestaurantUnitOrdersController,
  getOrderByIdController,
  updateOrderController,
  requestTableCheckoutHandler,
  getTableOrdersController,
  processTablePaymentHandler,
  cancelOrderController,
  cancelOrderItemController,
  updateOrderItemController,
  getGuestOrdersController
} from "../controllers/OrderController";
import { isAuthenticated, hasRole } from "../middlewares/index";

export default (orderRouter: Router) => {
  // Rota para criação de pedidos (aberta para convidados)
  orderRouter.post("/restaurant/:restaurantId/:tableId/order/new", createOrderHandler);

  // Rota para usuários autenticados criarem pedidos
  orderRouter.post("/user/:id/order/create",
    isAuthenticated,
    createOrderHandler);

  // Rota para solicitar fechamento de conta (aberta para convidados)
  orderRouter.post("/restaurant/:restaurantId/:tableId/order/request-checkout", requestTableCheckoutHandler);

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

  orderRouter.get("/:tableId/guest-orders/:guestId", getGuestOrdersController);

  // Atualizar pedido (requer autenticação)
  orderRouter.patch(
    "/restaurant/:restaurantId/:tableId/order/:id/update",
    updateOrderController
  );

  // Excluir pedido (requer autenticação)
  orderRouter.delete(
    "/order/:id/delete",
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