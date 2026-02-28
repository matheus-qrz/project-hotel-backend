import mongoose from "mongoose";

const Schema = mongoose.Schema;

export interface IUser extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  cpf?: string;
  avatar?: string;
  authentication: {
    password: string;
    salt: string;
    sessionToken: string;
  };
  role: "ADMIN" | "MANAGER" | "ATTENDANT" | "CLIENT";
  orders: mongoose.Schema.Types.ObjectId[];
  hotel?: mongoose.Schema.Types.ObjectId;
  unit?: mongoose.Schema.Types.ObjectId;
}

const userSchema = new Schema(
  {
    id: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toString(),
      unique: true
    },
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    cpf: {
      type: String,
      unique: true,
      sparse: true,
      set: (v: string) => (v ? v.replace(/\D/g, "") : v),
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
    },
    phone: {
      type: String,
      required: function (this: any) {
        return this.role === "ADMIN" || this.role === "MANAGER";
      },
      minLength: 10,
      maxLength: 13,
    },
    avatar: {
      type: String,
      default: null
    },
    authentication: {
      password: {
        type: String,
        required: true,
        select: false
      },
      salt: { type: String, required: true, select: false },
      sessionToken: { type: String, default: "", select: false },
    },
    role: {
      type: String,
      enum: ["ADMIN", "MANAGER", "ATTENDANT", "CLIENT"],
      required: true,
      trim: true,
    },
    orders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order"
      }
    ],
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel"
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HotelUnit"
    },
  },
  { timestamps: true }
);

export const UserModel = mongoose.model("User", userSchema);

// METHODS

// Get All Users
export const getUsers = () => UserModel.find();

// Get User by Id
export const getUserById = (id: string) => UserModel.findById(id);

// Get User by Email for Register Validation
export const getUserByEmail = (email: string) => {
  return UserModel.findOne({ email });
};

// Get User by SessionToken for Middleware
export const getUserBySessionToken = (sessionToken: string) => {
  return UserModel.findOne({
    'authentication.sessionToken': sessionToken,
  });
};

// Get Users by Hotel Unit
export const getUsersByUnit = (unitId: string) => {
  return UserModel
    .find({ unit: unitId })
    .select("+authentication.sessionToken +role");
};

// Get Users by Hotel
export const getUsersByHotel = (hotelId: string) => {
  return UserModel.find({ hotel: hotelId });
};

// Create User
export const createUser = (values: Record<string, any>, options = {}) =>
  new UserModel(values).save(options).then((user) => user.toObject());

// Delete User
export const deleteUser = (id: string) =>
  UserModel.findByIdAndDelete({ _id: id });

// Update User
export const updateUser = (id: string, values: Record<string, any>) =>
  UserModel.findByIdAndUpdate(id, values);