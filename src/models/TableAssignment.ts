import mongoose from "mongoose";
const { Schema, Types } = mongoose;

export interface ITableAssignment extends mongoose.Document {
  restaurantUnit: mongoose.Types.ObjectId;
  tableId: number;
  attendant: mongoose.Types.ObjectId;
  assignedAt: Date;
  releasedAt?: Date | null;
  updatedAt?: Date | null;
  isActive: boolean;
}

const tableAssignmentSchema = new Schema<ITableAssignment>({
  restaurantUnit: { type: Schema.Types.ObjectId, ref: "RestaurantUnit", required: true },
  tableId: { type: Number, required: true },
  attendant: { type: Schema.Types.ObjectId, ref: "User", required: true },
  assignedAt: { type: Date, default: () => new Date() },
  releasedAt: { type: Date, default: null },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// Garante 1 registro ativo por mesa/unidade
tableAssignmentSchema.index(
  { restaurantUnit: 1, tableId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

export const TableAssignmentModel = mongoose.model<ITableAssignment>(
  "TableAssignment",
  tableAssignmentSchema
);
