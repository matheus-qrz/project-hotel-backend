import mongoose from 'mongoose';
import { Request, Response } from 'express';
import {
    getOrdersDashboardDataController,
    getCustomersDashboardDataController,
    getFinancialDashboardDataController,
    getPromotionsDashboardController
} from './DashboardController';

/**
 * Controller para rotear requisições de dashboard baseado no escopo (hotel ou hotelUnit)
 *
 * Escopos suportados:
 * - hotelUnit: Filtra dados de uma unidade específica do hotel
 * - hotel: Filtra dados de todas as unidades do hotel
 *
 * Tipos de dashboard suportados:
 * - orders: Dashboard de pedidos
 * - financial: Dashboard financeiro
 * - customers: Dashboard de clientes
 * - promotions: Dashboard de promoções
 */
export const getDashboardByScopeController = async (req: Request, res: Response) => {
    const { scope, id, type } = req.params;

    // Valida o escopo
    if (!['hotelUnit', 'hotel'].includes(scope)) {
        return res.status(400).json({ message: 'Escopo inválido. Use "hotel" ou "hotelUnit".' });
    }

    // Valida o ID
    if (!id || !mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: 'ID inválido.' });
    }

    // Configura os parâmetros de query para os controllers específicos
    (req.query as any).scope = scope;
    (req.params as any).id = id;

    if (scope === 'hotelUnit') {
        (req.query as any).hotelUnitId = id;
    } else if (scope === 'hotel') {
        (req.query as any).hotelId = id;
    }

    // Roteia para o controller específico baseado no tipo de dashboard
    switch (type) {
        case 'orders':
            return getOrdersDashboardDataController(req, res);
        case 'financial':
            return getFinancialDashboardDataController(req, res);
        case 'customers':
            return getCustomersDashboardDataController(req, res);
        case 'promotions':
            return getPromotionsDashboardController(req, res);
        default:
            return res.status(400).json({ message: 'Tipo de dashboard inválido. Use "orders", "financial", "customers" ou "promotions".' });
    }
};


