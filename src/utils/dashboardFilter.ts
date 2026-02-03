// utils/dashboardFilter.ts
import { Request } from 'express';
import mongoose from 'mongoose';

export function buildDashboardFilterFromRequest(req: Request) {
  const scope = (req.params as any)?.scope ?? (req.query as any)?.scope;
  const id    = (req.params as any)?.id    ?? (req.query as any)?.id;

  if (!scope || !id) {
    throw new Error('Parâmetros "scope" e "id" são obrigatórios');
  }
  if (!mongoose.isValidObjectId(String(id))) {
    throw new Error('ID inválido');
  }

  const objectId = new mongoose.Types.ObjectId(String(id));

  if (scope === 'hotelUnit') {
    return { restaurantUnit: objectId };
  }

  if (scope === 'hotel') {
    return { 'restaurantUnitData.restaurant': objectId };
  }

  throw new Error(`Escopo "${scope}" não reconhecido`);
}
