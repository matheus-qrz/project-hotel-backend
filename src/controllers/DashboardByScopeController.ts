import mongoose from 'mongoose';
import { Request, Response } from 'express';
import {
    getOrdersDashboardDataController,
    getCustomersDashboardDataController,
    getFinancialDashboardDataController,
    getPromotionsDashboardController
} from './DashboardController';

const getDashboardFilter = (scope: string, id: string) => {
    return scope === 'hotelUnit'
        ? { restaurantUnit: new mongoose.Types.ObjectId(id) }
        : { hotel: new mongoose.Types.ObjectId(id) };
};

export const getDashboardByScopeController = async (req: Request, res: Response) => {
    const { scope, id, type } = req.params;

    if (!['hotelUnit', 'hotel'].includes(scope)) {
        return res.status(400).json({ message: 'Escopo inválido.' });
    }

    (req.query as any).scope = scope;
    if (scope === 'hotelUnit') (req.query as any).hotelUnitId = id;
    if (scope === 'hotel')     (req.query as any).hotelId     = id;

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


