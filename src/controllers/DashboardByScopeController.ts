import mongoose from 'mongoose';
import { Request, Response } from 'express';
import {
    getOrdersDashboardDataController,
    getCustomersDashboardDataController,
    getFinancialDashboardDataController,
    getPromotionsDashboardController
} from './DashboardController';

const getDashboardFilter = (scope: string, id: string) => {
    return scope === 'unit'
        ? { restaurantUnit: new mongoose.Types.ObjectId(id) }
        : { restaurant: new mongoose.Types.ObjectId(id) };
};

export const getDashboardByScopeController = async (req: Request, res: Response) => {
    const { scope, id, type } = req.params;

    if (!['unit', 'restaurant'].includes(scope)) {
        return res.status(400).json({ message: 'Escopo inválido.' });
    }

    const filter = getDashboardFilter(scope, id);

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
            return res.status(400).json({ message: 'Tipo de dashboard inválido.' });
    }
};


