// src/routes/orderRoutes.ts
import { Router } from "express";
import {
  // listagem
  getRestaurantUnitOrdersController,
  getTableOrdersController,
  getOrderByIdController,
  getGuestOrdersController,
  // criação e lifecycle
  initiateOrderController,
  requestOrderCheckout,
  processTablePaymentHandler,
  updateOrderStatusController,
  updateOrderItemController,
  cancelOrderController,
  cancelOrderItemController,
  deleteOrderController,
  // reatribuição
  reassignOpenOrdersForUnitController,
  removeOrderItemController,
  addOrderItemExceptionController,
  applyOrderCouponController,
  getTableStatus,
} from "../controllers/OrderController";
import { isAuthenticated, hasRole } from "../middlewares";

export default (orderRouter: Router) => {
  // --- Create (público via QR) ---
  orderRouter.post(
    "/restaurant/:restaurantUnitId/order/initiate",
    initiateOrderController
  );

  // (opcional) versão autenticada para CLIENT
  orderRouter.post(
    "/restaurant/:restaurantUnitId/order/initiate/auth",
    isAuthenticated,
    hasRole(["CLIENT"]),
    initiateOrderController
  );

  // --- Checkout & Payment ---
  orderRouter.post(
    "/restaurant/:restaurantUnitId/:tableId/order/:orderId/request-checkout",
    requestOrderCheckout
  );

  orderRouter.post(
    "/restaurant/:restaurantUnitId/:tableId/order/process-payment",
    isAuthenticated,
    hasRole(["MANAGER", "ATTENDANT"]),
    processTablePaymentHandler
  );

  // --- Listagens ---
  orderRouter.get(
    "/restaurant/:restaurantUnitId/orders",
    getRestaurantUnitOrdersController
  );

  orderRouter.get(
    "/restaurant/:restaurantUnitId/:tableId/orders",
    getTableOrdersController
  );

  orderRouter.get(
    "/restaurant/:restaurantUnitId/:tableId/order/:orderId",
    getOrderByIdController
  );

  orderRouter.get(
    "/restaurant/:restaurantUnitId/:tableId/guest/:guestId/orders",
    getGuestOrdersController
  );

  // --- Updates ---
  orderRouter.patch(
    "/restaurant/:restaurantUnitId/order/:orderId/status",
    isAuthenticated,
    hasRole(["MANAGER", "ATTENDANT"]),
    updateOrderStatusController
  );

  orderRouter.patch(
    "/restaurant/:restaurantUnitId/:tableId/order/:orderId/items/:itemId",
    isAuthenticated,
    hasRole(["MANAGER", "ATTENDANT"]),
    updateOrderItemController
  );

  orderRouter.post(
    "/restaurant/:restaurantUnitId/:tableId/order/:orderId/cancel",  
    cancelOrderController
  );

  orderRouter.post(
    "/restaurant/:restaurantUnitId/:tableId/order/:orderId/items/:itemId/cancel",
    cancelOrderItemController
  );

  orderRouter.delete(
    "/restaurant/:restaurantUnitId/order/:orderId",
    isAuthenticated,
    hasRole(["MANAGER", "ATTENDANT"]),
    deleteOrderController
  );

  // --- Reassign (idempotente) ---
  orderRouter.post(
    "/restaurant/:restaurantUnitId/orders/reassign",
    isAuthenticated,
    hasRole(["MANAGER"]),
    reassignOpenOrdersForUnitController
  );

  orderRouter.delete(
  "/units/:unitId/orders/:orderId/items/:itemId",
  isAuthenticated,
  hasRole(["MANAGER"]),
  removeOrderItemController,
);

orderRouter.patch(
  "/units/:unitId/orders/:orderId/items/:itemId/exception",
  isAuthenticated,
  hasRole(["MANAGER"]),
  addOrderItemExceptionController,
);

orderRouter.post(
  "/units/:unitId/orders/:orderId/coupons",
  isAuthenticated,
  hasRole(["MANAGER"]),
  applyOrderCouponController,
);

orderRouter.get(
  "/restaurant/:unitId/tables/:tableId/status",
  getTableStatus
)
};
