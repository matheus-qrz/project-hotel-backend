// models/HotelUnit.ts
import mongoose from "mongoose";
const Schema = mongoose.Schema;

export interface IHotelUnit extends Document {
  hotel: mongoose.Schema.Types.ObjectId;
  name: string; // Ex: "Bloco A", "Ala Norte", "Setor 1"
  description?: string;
  roomNumberingFormat: "SIMPLE" | "FLOOR_ROOM" | "SECTOR_ROOM"; // Formato de numeração
  rooms: Array<{
    roomId: string; // Ex: "101", "1A", "1-2"
    displayName: string; // Ex: "Quarto 101", "Suíte 1A"
    floor?: string; // Andar (opcional)
    sector?: string; // Setor (opcional)
    isActive: boolean;
    qrCode?: string; // URL do QR Code gerado
  }>;
  orders: mongoose.Schema.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
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
    }]
  },
  { timestamps: true }
);

// Índice composto para garantir unicidade de roomId por unidade
hotelUnitSchema.index({ hotel: 1, "rooms.roomId": 1 }, { unique: true });

export const HotelUnitModel = mongoose.model<IHotelUnit>("HotelUnit", hotelUnitSchema);