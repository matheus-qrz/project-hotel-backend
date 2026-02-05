// src/models/Promotion.ts
import { Schema, model, Types } from "mongoose";

export type PromotionScope =
  | "hotel"
  | "unit"
  | "category"
  | "product";

export interface Promotion {
  _id: Types.ObjectId;
  hotel: Types.ObjectId;
  unit?: Types.ObjectId | null;        
  scope: PromotionScope;

  // alvos
  productId?: Types.ObjectId | null;
  productName?: string | null;
  category?: string | null;

  // valores
  originalPrice?: string | null;
  discountPercentage?: number | null;  
  promotionalPrice?: number | null;     
  // janela
  startDate: Date;
  endDate: Date;

  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const PromotionSchema = new Schema<Promotion>(
  {
    hotel: { type: Schema.Types.ObjectId, ref: "Hotel", required: true },
    unit:       { type: Schema.Types.ObjectId, ref: "HotelUnit", default: null },
    scope:      { type: String, enum: ["hotel","unit","category","product"], required: true },

    productId:    { type: Schema.Types.ObjectId, ref: "Product", default: null },
    productName:  { type: String, ref: "Product", default: null },
    category:   { type: String, default: null },

    originalPrice: { type: Number, ref:"Product", default: null  },
    discountPercentage: { type: Number, default: null },
    promotionalPrice:   { type: Number, default: null },

    startDate: { type: Date, required: true },
    endDate:   { type: Date, required: true },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const PromotionModel = model<Promotion>("Promotion", PromotionSchema);
