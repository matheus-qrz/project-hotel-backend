import { Router } from "express";
import { getDashboardByScopeController } from "../controllers/DashboardByScopeController";

/**
 * Rotas de Dashboard
 *
 * GET /dashboard/:scope/:id/:type
 *
 * Parâmetros:
 * - scope: 'hotel' ou 'hotelUnit' - Define o escopo dos dados
 * - id: ObjectId do hotel ou da unidade do hotel
 * - type: 'orders' | 'financial' | 'customers' | 'promotions' - Tipo de dashboard
 *
 * Query params opcionais:
 * - period: Período de tempo para filtros (ex: 'today', 'week', '6m', '12m')
 * - tz: Timezone (default: 'America/Sao_Paulo')
 */
export default (router: Router) => {
    router.get("/dashboard/:scope/:id/:type", getDashboardByScopeController);
};


