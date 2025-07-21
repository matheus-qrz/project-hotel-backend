import { FilterQuery } from 'mongoose';
import { IOrder } from '../../models/Order';

declare module 'express-serve-static-core' {
    interface Request {
        dashboardFilter?: FilterQuery<IOrder>;
    }
}