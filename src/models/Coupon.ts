// src/models/Coupons.ts
import { Schema, model, Types } from "mongoose";

export type CouponType = "fixed" | "percentage";

export interface Coupon {
  _id: Types.ObjectId;
  hotel: Types.ObjectId;
  unit?: Types.ObjectId | null;               
  code: string;                              
  type: CouponType;                          
  value: number;                              
  isActive: boolean;                        
  startsAt?: Date | null;                    
  endsAt?: Date | null;                      
  usageLimit?: number | null;                
  usedCount?: number | null;                  
  minSubtotal?: number | null;               
  createdBy?: Types.ObjectId | null;         
}

const CouponSchema = new Schema<Coupon>(
  {
    hotel: { type: Schema.Types.ObjectId, ref: "Hotel", required: true },
    unit:       { type: Schema.Types.ObjectId, ref: "HotelUnit", default: null },

    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    type: { type: String, enum: ["fixed", "percentage"], required: true },
    value: { type: Number, required: true, min: 0 },

    isActive:   { type: Boolean, default: true },
    startsAt:   { type: Date, default: null },
    endsAt:     { type: Date, default: null },
    usageLimit: { type: Number, default: null },
    usedCount:  { type: Number, default: 0 },
    minSubtotal:{ type: Number, default: null },

    createdBy:  { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const CouponModel = model<Coupon>("Coupon", CouponSchema);
