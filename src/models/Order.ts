import mongoose from "mongoose";
const Schema = mongoose.Schema;

// Interfaces
export interface IOrdermeta {
  guestId: string;
  tableId?: number;
  orderType?: 'local' | 'takeaway';
  observations?: string;
  paymentMethod?: string;
  paymentRequestedAt?: Date;
  processedBy?: mongoose.Schema.Types.ObjectId;
  splitCount?: number;
  sessionGroup: String;
}

export interface IOrder extends mongoose.Document {
  sessionId: string;
  user?: mongoose.Schema.Types.ObjectId;
  isGuest: boolean;
  guestInfo?: {
    id: string;
    name: string;
    joinedAt: Date;
  };
  restaurantUnit: mongoose.Schema.Types.ObjectId;
  items: [
    {
      name: { type: String, required: true },
      price: { type: Number, required: true },
      quantity: { type: Number, required: true, default: 1 },
      status: {
        type: String,
        enum: ["pending", "processing", "completed", "cancelled"],
        default: "pending"
      },
      observations: String,
      image: String
    }
  ]
  totalAmount: number;
  isCancelled?: boolean;
  status: 'pending' | 'processing' | 'completed' | 'cancelled' | 'payment_requested' | 'paid';
  isPaid: boolean;
  paidAt?: Date;
  meta?: IOrdermeta;
  createdAt: Date;
  updatedAt: Date;
}

// Schema sem validações complexas
const orderSchema = new Schema(
  {
    sessionId: String,
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false
    },
    isGuest: {
      type: Boolean,
      default: false
    },
    guestInfo: {
      name: String,
      email: String,
      phone: String
    },
    restaurantUnit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RestaurantUnit",
      required: true
    },
    items: [
      {
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, required: true, default: 1 }
      }
    ],
    totalAmount: {
      type: Number,
      required: true
    },
    isCancelled: {
      type: Boolean,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "cancelled", "payment_requested"],
      default: "pending"
    },
    isPaid: {
      type: Boolean,
      default: false
    },
    paidAt: {
      type: Date
    },
    meta: {
      tableId: Number,
      orderType: {
        type: String,
        enum: ['local', 'takeaway'],
        default: 'local'
      },
      observations: String,
      paymentMethod: String,
      paymentRequestedAt: Date,
      processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      },
      splitCount: {
        type: Number,
        default: 1,
        min: 1
      }
    }
  },
  { timestamps: true }
);

// Validação manual para guestInfo.name
orderSchema.pre('validate', function (next) {
  // @ts-ignore - Ignorando problemas de tipagem com 'this'
  if (this.isGuest === true && (!this.guestInfo || !this.guestInfo.name)) {
    // @ts-ignore
    this.invalidate('guestInfo.name', 'O nome é obrigatório para pedidos de convidados');
  }
  next();
});

export const OrderModel = mongoose.model<IOrder>("Order", orderSchema);

// Função de validação para usar antes de salvar o pedido
export const validateOrder = (orderData: any): string | null => {
  if (orderData.isGuest && (!orderData.guestInfo || !orderData.guestInfo.name)) {
    return "O nome é obrigatório para pedidos de convidados";
  }
  if (orderData.meta?.splitCount && (isNaN(orderData.meta.splitCount) || orderData.meta.splitCount < 1)) {
    return "O número de pessoas para divisão da conta deve ser pelo menos 1";
  }
  return null;
};

// METHODS

// Get all orders
export const getOrders = () => OrderModel.find();

// Get order by id
export const getOrderById = (id: string) => OrderModel.findById(id);

// Update order
export const updateOrder = (id: string, values: Record<string, any>) =>
  OrderModel.findByIdAndUpdate(id, values, { new: true });

// Delete order
export const deleteOrder = (id: string) =>
  OrderModel.findByIdAndDelete(id);

// Get orders by table number
export const getOrdersByTable = (restaurantUnitId: string, tableId: number) =>
  OrderModel.find({
    restaurantUnit: restaurantUnitId,
    'meta.tableId': tableId
  });

// Get unpaid orders by table
export const getUnpaidOrdersByTable = (restaurantUnitId: string, tableId: number) =>
  OrderModel.find({
    restaurantUnit: restaurantUnitId,
    'meta.tableId': tableId,
    isPaid: false,
    status: { $nin: ['cancelled'] }
  });