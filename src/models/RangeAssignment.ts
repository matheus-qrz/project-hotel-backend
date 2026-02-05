// src/models/RangeAssignment.ts
import mongoose, { Schema } from "mongoose";

export interface IRangeAssignment extends mongoose.Document {
  hotel?: mongoose.Types.ObjectId | null;
  hotelUnit: mongoose.Types.ObjectId | null; 
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
    hotel: {
      type: Schema.Types.ObjectId,
      ref: "Hotel",
      index: true,
      default: null
    },
    hotelUnit: {
      type: Schema.Types.ObjectId,
      ref: "HotelUnit",
      index: true,
      default: null,
      required: true
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

RangeAssignmentSchema.index(
  { hotelUnit: 1, attendant: 1, startTable: 1, endTable: 1, startsAt: 1, endsAt: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

RangeAssignmentSchema.pre("validate", function (next) {
  if (this.startTable > this.endTable) {
    return next(new Error("startTable não pode ser maior que endTable"));
  }
  next();
});

export const RangeAssignmentModel = mongoose.model<IRangeAssignment>(
  "RangeAssignment",
  RangeAssignmentSchema
);
