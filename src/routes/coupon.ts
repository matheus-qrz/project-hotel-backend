// src/routes/coupons.ts
import { Router } from "express";
import {
  createCoupon,
  listCoupons,
  validateCoupon,
  deactivateCoupon,
  incrementCouponUsage,
} from "../controllers/CouponController";
import { isAuthenticated } from "../middlewares/auth";
import { hasRole } from "../middlewares/hasRole";

export default (couponsRouter: Router) => {
  // criação de cupom: ADMIN/MANAGER
  couponsRouter.post(
    "/coupon/create",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    createCoupon
  );

  // listagem com filtros opcionais
  couponsRouter.get("/coupon/list", listCoupons);

  // validação para uso no carrinho/checkout
  couponsRouter.get("/coupon/validate", validateCoupon);

  // desativar (marcar inativo + antecipar endsAt)
  couponsRouter.patch(
    "/coupon/:couponId/deactivate",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    deactivateCoupon
  );

  // (opcional) incrementar uso após pedido confirmado
  couponsRouter.patch(
    "/coupon/:couponId/increment-usage",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    incrementCouponUsage
  );
};
