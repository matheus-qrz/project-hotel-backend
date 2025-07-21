import { Request } from 'express';
import mongoose from 'mongoose';

type ScopeType = 'unit' | 'restaurant';

export function buildDashboardFilterFromRequest(req: Request) {
    const { scope, id } = req.query;

    if (!scope || !id) {
        throw new Error('Parâmetros "scope" e "id" são obrigatórios');
    }

    const objectId = new mongoose.Types.ObjectId(String(id));

    if (scope === 'unit') {
        return { restaurantUnit: objectId };
    }

    if (scope === 'restaurant') {
        return { 'restaurantUnitData.restaurant': objectId };
    }

    throw new Error(`Escopo "${scope}" não reconhecido`);
}
