import mongoose from "mongoose";
import { OperationalCosts } from "../utils/finantials";
const Schema = mongoose.Schema;

export interface IHotel extends Document {
  name: string;
  logo: string;
  cnpj: string;
  socialName: string;
  address: {
    zipCode: string;
    street: string;
    number: number;
    complement: string
  };
  rating: number;
  specialty: string;
  phone: string;
  admin: {
    email: string;
    fullName: string;
    cpf: string;
  };
  managers: mongoose.Types.ObjectId[];
  attendants: mongoose.Types.ObjectId[];
  units: mongoose.Types.ObjectId[];
  authentication: {
    password: string;
    salt: string;
    sessionToken: string;
  },
  businessHours?: Array<{
    days: string[];
    open: string;
    close: string;
  }>;
  operationalCosts: OperationalCosts;
}

const hotelSchema = new Schema({
  name: { type: String, required: true, unique: true },
  socialName: { type: String },
  cnpj: { type: String, required: true, unique: true },
  logo: { type: String },
  address: {
    zipCode: String,
    street: String,
    number: Number,
    complement: String
  },
  specialty: String,
  phone: String,

  // Informacoes do admin/proprietario do hotel
  admin: {
    fullName: { type: String, required: true },
    cpf: { type: String, required: true },
    email: { type: String, required: true, unique: true }, // Email para login
  },

  // Credenciais de autenticacao para o hotel/admin
  authentication: {
    password: { type: String, required: true, select: false }, // Hash da senha
    salt: { type: String, required: true, select: false }, // Salt para a senha
    sessionToken: { type: String, select: false } // Token de sessao
  },
  managers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  attendants: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  units: [{ type: Schema.Types.ObjectId, ref: 'HotelUnit' }],
  businessHours: [{
    days: [String],
    open: String,
    close: String
  }],
  operationalCosts: {
    fixed: {
      rent: { type: Number, default: 0 },
      utilities: { type: Number, default: 0 },
      salaries: { type: Number, default: 0 },
      marketing: { type: Number, default: 0 },
      other: { type: Number, default: 0 }
    },
    variable: {
      costPercentage: { type: Number, default: 40 }, // 40% como padrao
      averageIngredientCost: { type: Number, default: 0 },
      averagePackagingCost: { type: Number, default: 0 }
    }
  }
}, {
  timestamps: true,
  timezone: { type: String, default: "America/Sao_Paulo" }
 });

export const HotelModel = mongoose.model<IHotel>("Hotel", hotelSchema);

// Alias para compatibilidade durante transicao
export const RestaurantModel = HotelModel;

// METHODS

// Get All Hotels
export const getHotels = () => HotelModel.find();
export const getRestaurants = getHotels; // Alias

// Get Hotel by Id
export const getHotelById = (id: string) => HotelModel.findById(id);
export const getRestaurantById = getHotelById; // Alias

// Get Hotel by Name (also for register validation)
export const getHotelByName = (name: string) =>
  HotelModel.findOne({ name });
export const getRestaurantByName = getHotelByName; // Alias

// Create Hotel
export const createHotel = (values: Record<string, any>) =>
  new HotelModel(values).save().then((hotel) => hotel.toObject());
export const createRestaurant = createHotel; // Alias

// Delete Hotel
export const deleteHotel = (id: string) =>
  HotelModel.findOneAndDelete({ _id: id });
export const deleteRestaurant = deleteHotel; // Alias

// Update Hotel
export const updateHotel = (id: string, values: Record<string, any>) =>
  HotelModel.findByIdAndUpdate(id, values, { new: true });
export const updateRestaurant = updateHotel; // Alias

export const getHotelBySlug = async (slug: string) => {
  const id = slug.split('-').pop();
  if (!id) return null;
  return HotelModel.findById(id);
};
export const getRestaurantBySlug = getHotelBySlug; // Alias

// Buscar hotel pelo email do admin (para login)
export const getHotelByEmail = (email: string) => {
  return HotelModel.findOne({ 'admin.email': email })
    .select('+authentication.password +authentication.salt +authentication.sessionToken');
};
export const getRestaurantByEmail = getHotelByEmail; // Alias

// Buscar hotel pelo token de sessao
export const getHotelBySessionToken = (sessionToken: string) => {
  return HotelModel.findOne({
    'authentication.sessionToken': sessionToken,
  }).select('+authentication.sessionToken');
};
export const getRestaurantBySessionToken = getHotelBySessionToken; // Alias
