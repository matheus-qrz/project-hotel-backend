// utils/dashboardFilter.ts
import { Request } from 'express';
import mongoose from 'mongoose';
import { RestaurantUnitModel as HotelUnitModel } from '../models/RestaurantUnit';

/**
 * Constrói o filtro de dashboard baseado no escopo (hotel ou hotelUnit)
 *
 * Para hotelUnit: Retorna filtro direto pela unidade
 * Para hotel: Busca todas as unidades do hotel e retorna filtro com $in
 *
 * @param req - Request do Express contendo scope e id nos params ou query
 * @returns Filtro MongoDB para usar em queries de pedidos
 */
export async function buildDashboardFilterFromRequest(req: Request): Promise<Record<string, any>> {
  const scope = (req.params as any)?.scope ?? (req.query as any)?.scope;
  const id = (req.params as any)?.id ?? (req.query as any)?.id;

  if (!scope || !id) {
    throw new Error('Parâmetros "scope" e "id" são obrigatórios');
  }
  if (!mongoose.isValidObjectId(String(id))) {
    throw new Error('ID inválido');
  }

  const objectId = new mongoose.Types.ObjectId(String(id));

  if (scope === 'hotelUnit') {
    // Filtra por unidade específica do hotel
    return { restaurantUnit: objectId };
  }

  if (scope === 'hotel') {
    // Busca todas as unidades do hotel para filtrar pedidos
    const units = await HotelUnitModel.find({ restaurant: objectId })
      .select('_id')
      .lean();

    const unitIds = units.map(u => u._id as mongoose.Types.ObjectId);

    // Inclui o próprio hotelId para casos onde pedidos da matriz usam o ID do hotel
    const ids = unitIds.length > 0 ? [...unitIds, objectId] : [objectId];

    return { restaurantUnit: { $in: ids } };
  }

  throw new Error(`Escopo "${scope}" não reconhecido. Use "hotel" ou "hotelUnit".`);
}
