// src/types/express/index.d.ts
import 'express';
import { FilterQuery } from 'mongoose';
import { IOrder } from '../../models/Order';
import { UserModel } from '../../models/User';
import { HotelModel } from '../../models/Hotel';

declare global {
    namespace Express {
        interface Request {
            user?: UserModel; // Para usuarios regulares
            hotel?: HotelModel; // Para hoteis
            isHotelAdmin?: boolean; // Flag para indicar se e admin de hotel
            identity?: UserModel; // Se voce ainda precisa disso por compatibilidade
            dashboardFilter?: FilterQuery<IOrder>;
            worker?: {
              hotelId: string;
              unitId: string;
              stations?: string[];
              workerDeviceId?: string;
            };
        }
    }
}