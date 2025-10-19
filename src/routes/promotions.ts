// src/routes/promotionRoutes.ts
import { Router } from "express";
import { createPromotion, listPromotions, deactivatePromotion, updatePromotion } from "../controllers/PromotionsController";
import { isAuthenticated } from '../middlewares/auth';
import { hasRole } from '../middlewares/hasRole';

export default (promotionsRouter: Router) => {
    promotionsRouter.post("/promotion/create", isAuthenticated, hasRole(['ADMIN', 'MANAGER']), createPromotion);
    promotionsRouter.patch("/promotion/:promotionId/update", isAuthenticated, hasRole(['ADMIN', 'MANAGER']), updatePromotion);
    promotionsRouter.get("/promotion/list", listPromotions);
    promotionsRouter.patch("/:promotionId/deactivate", isAuthenticated, hasRole(['ADMIN', 'MANAGER']), deactivatePromotion);
};
