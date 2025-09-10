import mongoose from "mongoose";
const { Schema } = mongoose;

export interface IRangeAssignment extends mongoose.Document {
  restaurantUnit: mongoose.Types.ObjectId;
  startTable: number;
  endTable: number;
  attendant: mongoose.Types.ObjectId;   
  label?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  updatedAt?: Date | null;
  isActive: boolean;
}

const rangeAssignmentSchema = new Schema<IRangeAssignment>({
  restaurantUnit: { type: Schema.Types.ObjectId, ref: "RestaurantUnit", required: true },
  startTable:     { type: Number, required: true },
  endTable:       { type: Number, required: true },
  attendant:      { type: Schema.Types.ObjectId, ref: "User", required: true }, 
  label:          { type: String, default: null },
  startsAt:       { type: Date, default: null },
  endsAt:         { type: Date, default: null },
  isActive:       { type: Boolean, default: true },
}, { timestamps: true });

rangeAssignmentSchema.index({ restaurantUnit: 1, startTable: 1, endTable: 1, isActive: 1 });
rangeAssignmentSchema.index({ restaurantUnit: 1, startsAt: 1, endsAt: 1 });
rangeAssignmentSchema.index({ attendant: 1, startsAt: 1, endsAt: 1 });

export const RangeAssignmentModel = mongoose.model<IRangeAssignment>(
  "RangeAssignment",
  rangeAssignmentSchema
);
