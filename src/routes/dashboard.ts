import { Router } from "express";
import { getDashboardByScopeController } from "../controllers/DashboardByScopeController";

export default (router: Router) => {
    router.get("/dashboard/:scope/:id/:type", getDashboardByScopeController);
};


