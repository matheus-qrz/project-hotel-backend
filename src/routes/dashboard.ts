// routes/dashboardRoutes.ts
import { Router } from "express";
import {
    getDashboardOrdersController,
    getDashboardFinancialController,
    getDashboardPromotionsController
} from "../controllers/DashboardController";

export default (router: Router) => {
    router.get("/:unitId/orders", getDashboardOrdersController);
    router.get("/:restaurantUnitId/financial", getDashboardFinancialController);
    router.get("/:unitId/promotions", getDashboardPromotionsController);
};

