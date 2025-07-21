import 'express';
import { FilterQuery } from 'mongoose';
import { IOrder } from '../../models/Order';

declare module 'express' {
    interface Request {
        dashboardFilter?: FilterQuery<IOrder>;
    }
}
