// src/models/RangeAssignment.ts
import mongoose, { Schema } from "mongoose";

export interface IRangeAssignment extends mongoose.Document {
  restaurant?: mongoose.Types.ObjectId | null;
  restaurantUnit?: mongoose.Types.ObjectId | null; 
  startTable: number;
  endTable: number;
  attendant: mongoose.Types.ObjectId | null;       // attendantId
  attendantName: string | null;
  label?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  daysOfWeek: number[];                            
  updatedAt?: Date | null;
  isActive: boolean;
}

const RangeAssignmentSchema = new Schema<IRangeAssignment>(
  {
    restaurant: { 
      type: Schema.Types.ObjectId, 
      ref: "Restaurant", 
      index: true, 
      default: null 
    },
    restaurantUnit: { 
      type: Schema.Types.ObjectId, 
      ref: "RestaurantUnit",
      index: true, 
      default: null 
    },
    startTable: { 
      type: Number, 
      required: true, 
      min: 1 
    },
    endTable: { 
      type: Number, 
      required: true, 
      min: 1 
    },
    attendant: { 
      type: Schema.Types.ObjectId, 
      ref: "User",
      default: null 
    },
    attendantName: { 
      type: String, 
      default: null 
    }, 
    label: { 
      type: String, 
      default: null 
    },
    startsAt: { 
      type: Date, 
      default: null 
    },
    endsAt: { 
      type: Date, 
      default: null 
    },
    daysOfWeek: {
      type: [Number],
      default: [],
      validate: {
        validator: (arr: number[]) =>
          Array.isArray(arr) && arr.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        message: "daysOfWeek deve conter inteiros 0..6",
      },
    },
    isActive: { 
      type: Boolean, 
      default: true 
    },
  },
  { timestamps: true }
);

RangeAssignmentSchema.index({ restaurantUnit: 1, startTable: 1, endTable: 1, isActive: 1 });
RangeAssignmentSchema.index({ restaurantUnit: 1, startsAt: 1, endsAt: 1 });
RangeAssignmentSchema.index({ attendant: 1, startsAt: 1, endsAt: 1 });

// (um doc por restaurantUnit + faixa + atendente + rótulo + horário)
RangeAssignmentSchema.index(
  { restaurantUnit: 1, startTable: 1, endTable: 1, attendant: 1, label: 1, startsAt: 1, endsAt: 1 },
  { unique: true, name: "uniq_ru_range_attendant_time" }
);

export const RangeAssignmentModel = mongoose.model<IRangeAssignment>(
  "RangeAssignment",
  RangeAssignmentSchema
);
