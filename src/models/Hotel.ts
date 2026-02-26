// models/Hotel.ts
import mongoose from "mongoose";
const Schema = mongoose.Schema;

export interface IHotel extends Document {
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  address: {
    street: string;
    number: string;
    city: string;
    state: string;
    zipCode: string;
  };
  contact: {
    phone: string;
    email: string;
  };
  owner: mongoose.Schema.Types.ObjectId;
  units: mongoose.Schema.Types.ObjectId[]; 
  createdAt: Date;
  updatedAt: Date;
}

const hotelSchema = new Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: String,
    logo: String,
    address: {
      street: String,
      number: String,
      city: String,
      state: String,
      zipCode: String
    },
    contact: {
      phone: String,
      email: String
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    units: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "HotelUnit"
    }]
  },
  { timestamps: true }
);

export const HotelModel = mongoose.model<IHotel>("Hotel", hotelSchema);