import mongoose, { Schema } from "mongoose";

export interface IRangeAssignment extends mongoose.Document {
  restaurant?: mongoose.Types.ObjectId;
  restaurantUnit?: mongoose.Types.ObjectId;
  startTable: number;
  endTable: number;
  attendant: mongoose.Types.ObjectId;   
  label?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  updatedAt?: Date | null;
  isActive: boolean;
}

const RangeAssignmentSchema = new Schema<IRangeAssignment>({
  restaurant: { type: Schema.Types.ObjectId, ref: "Restaurant", index: true, required: false },
  restaurantUnit: { type: Schema.Types.ObjectId, ref: "RestaurantUnit", index: true, required: false },
  startTable:     { type: Number, required: true },
  endTable:       { type: Number, required: true },
  attendant:      { type: Schema.Types.ObjectId, ref: "User", required: true }, 
  label:          { type: String, default: null },
  startsAt:       { type: Date, default: null },
  endsAt:         { type: Date, default: null },
  isActive:       { type: Boolean, default: true },
}, { timestamps: true });

RangeAssignmentSchema.index({ restaurantUnit: 1, startTable: 1, endTable: 1, isActive: 1 });
RangeAssignmentSchema.index({ restaurantUnit: 1, startsAt: 1, endsAt: 1 });
RangeAssignmentSchema.index({ attendant: 1, startsAt: 1, endsAt: 1 });

export const RangeAssignmentModel = mongoose.model<IRangeAssignment>(
  "RangeAssignment",
  RangeAssignmentSchema
);
