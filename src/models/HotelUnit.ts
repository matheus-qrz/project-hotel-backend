// models/HotelUnit.ts
import mongoose from "mongoose";
const Schema = mongoose.Schema;

export interface IHotelUnit extends Document {
  hotel: mongoose.Schema.Types.ObjectId;
  name: string;
  description?: string;
  roomNumberingFormat: "SIMPLE" | "FLOOR_ROOM" | "SECTOR_ROOM"; 
  rooms: Array<{
    roomId: string; 
    displayName: string;
    floor?: string;
    sector?: string; 
    isActive: boolean;
    qrCode?: string; 
  }>;
  orders: mongoose.Schema.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
  timezone?: string;
}

const hotelUnitSchema = new Schema(
  {
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true
    },
    name: { type: String, required: true },
    description: String,
    roomNumberingFormat: {
      type: String,
      enum: ["SIMPLE", "FLOOR_ROOM", "SECTOR_ROOM"],
      default: "SIMPLE"
    },
    rooms: [{
      roomId: { type: String, required: true },
      displayName: { type: String, required: true },
      floor: String,
      sector: String,
      isActive: { type: Boolean, default: true },
      qrCode: String
    }],
    orders: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order"
    }],
    timezone: {
      type: String,
      required: false
    }
  },
  { timestamps: true }
);

// Índice composto para garantir unicidade de roomId por unidade
hotelUnitSchema.index({ hotel: 1, "rooms.roomId": 1 }, { unique: true });

export const HotelUnitModel = mongoose.model<IHotelUnit>("HotelUnit", hotelUnitSchema);