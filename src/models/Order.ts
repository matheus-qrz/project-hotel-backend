import mongoose from "mongoose";
import { OrderItemStatus, OrderItemStatusType, OrderStatus, OrderStatusType } from '../types/order.types'
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

export interface IOrderItem {
  _id: Number;
  name: String;
  price: number;
  quantity: number;
  status: OrderItemStatusType;
  observations: String,
  image: String,
  addons?: any[]; 
  isOnPromotion?: boolean;
  originalPrice?: number;
}

export interface IOrder extends mongoose.Document {
  sessionId: string;
  user?: mongoose.Schema.Types.ObjectId;
  isGuest: boolean;
  guestInfo: {
    id: string;
    name: string;
    joinedAt: Date;
  };
  restaurantUnit: mongoose.Schema.Types.ObjectId;
  items: IOrderItem[]
  totalAmount: number;
  isCancelled?: boolean;
  status: OrderStatusType;
  isPaid: boolean;
  processingAt?: Date;
  completedAt?: Date;
  paidAt?: Date;
  statusHistory: {
    status: string;
    at: Date;
    by?: mongoose.Schema.Types.ObjectId;
  }[];
  meta?: IOrdermeta;
  createdAt: Date;
  updatedAt: Date;
  financialMetrics?: {
    costPrice: number;
    profit: number;
    promotionalDiscount?: number;
  };
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
      id: {
        type: String,
        required: true
      },
      name: {
        type: String,
        required: true
      },
      joinedAt: {
        type: Date,
        default: Date.now
      }
    },
    restaurantUnit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RestaurantUnit",
      required: false
    },
    items: [
      {
        name: {
          type: String,
          required: true
        },
        price: {
          type: Number,
          required: true
        },
        quantity: {
          type: Number,
          required: true
        },
        addons: {
          type: [mongoose.Schema.Types.Mixed],
          ref: "Products",
          required: false
        },
        status: {
          type: String,
          enum: Object.values(OrderItemStatus),
          default: OrderItemStatus.ADDED
        },
        isOnPromotion: {
          type: Boolean,
          required: false
        },
        originalPrice: {
          type: Number,
          required: false
        },
        completedAt: { type: Date },
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
      enum: Object.values(OrderStatus),
      default: OrderStatus.PROCESSING,
    },
    isPaid: {
      type: Boolean,
      default: false
    },
    processingAt: { type: Date, default: null },
    completedAt:  { type: Date, default: null },
    paidAt:       { type: Date, default: null },
    statusHistory: [
      {
        status: {
          type: String,
          enum: ["processing", "completed", "payment_requested", "paid", "cancelled"],
          required: true,
        },
        at: { type: Date, required: true, default: Date.now },
        by: { type: Schema.Types.ObjectId, ref: "User", required: false },
      },
    ],
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
    },
    financialMetrics: {
      costPrice: { type: Number, required: false },
      profit: { type: Number, required: false },
      promotionalDiscount: { type: Number }
    }
  },
  { timestamps: true }
);

// MIDDLEWARES
// Validação manual para guestInfo.name
orderSchema.pre('validate', function (next) {
  // @ts-ignore - Ignorando problemas de tipagem com 'this'
  if (this.isGuest === true && (!this.guestInfo || !this.guestInfo.name)) {
    // @ts-ignore
    this.invalidate('guestInfo.name', 'O nome é obrigatório para pedidos de convidados');
  }
  next();
});

//middleware para calcular métricas financeiras
orderSchema.pre('save', function (next) {
  if (this.items && this.items.length > 0) {
    let totalCost = 0;
    let totalRevenue = 0;
    let totalDiscount = 0;

    this.items.forEach((item) => {
      if (item.status !== 'cancelled') {
        const price = Number(item.price) || 0;
        const quantity = Number(item.quantity) || 0;

        totalCost += price * quantity;
        totalRevenue += price * quantity;

        if (item.addons && item.addons.length > 0) {
          item.addons.forEach(addon => {
            const addonPrice = Number(addon.price) || 0;
            const addonQuantity = Number(addon.quantity) || 0;
            totalRevenue += addonPrice * addonQuantity;
          });
        }

        if (item.isOnPromotion) {
          const originalPrice = Number(item.originalPrice) || price;
          totalDiscount += (originalPrice - price) * quantity;
        }
      }
    });

    this.financialMetrics = {
      costPrice: totalCost > 0 ? totalCost : 0,
      profit: totalRevenue > totalCost ? totalRevenue - totalCost : 0,
      promotionalDiscount: totalDiscount || 0
    };

    this.totalAmount = totalRevenue;
  }
  next();
});

orderSchema.pre("save", function (next) {
  if (this.isNew) {
    if (this.status === "processing" && !this.processingAt) {
      this.processingAt = new Date();
    }
    if (!Array.isArray(this.statusHistory)) this.statusHistory = [];
    // registra o status inicial
    this.statusHistory.push({ status: this.status, at: this.processingAt ?? new Date() } as any);
  }
  next();
});


orderSchema.methods.canTransitionTo = function (newStatus: OrderStatusType): boolean {
  const validTransitions: Record<OrderStatusType, OrderStatusType[]> = {
    [OrderStatus.PROCESSING]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED, OrderStatus.PAYMENT_REQUESTED],
    [OrderStatus.COMPLETED]: [OrderStatus.PROCESSING, OrderStatus.PAYMENT_REQUESTED, OrderStatus.PAID], // 👈 add PAID
    [OrderStatus.PAYMENT_REQUESTED]: [OrderStatus.PAID, OrderStatus.PROCESSING],
    [OrderStatus.PAID]: [],
    [OrderStatus.CANCELLED]: [],
  };
  return validTransitions[this.status as OrderStatusType]?.includes(newStatus);
};

orderSchema.methods.canUpdateItems = function (): boolean {
  return ![OrderStatus.PAID, OrderStatus.CANCELLED].includes(this.status);
};

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
export const updateOrder = async (id: string, values: Record<string, any>) => {
  return OrderModel.findOneAndUpdate(
    {
      _id: id,
      isPaid: false,
      status: { $ne: 'cancelled' }
    },

    values,
    {
      new: true,
      upsert: false
    }
  );
};

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

// models/Order.ts
export const getGuestOrders = (guestId: string, tableId: string) => {
  return OrderModel.find({
    'guestInfo.id': guestId, // Filtra pelos pedidos do convidado
    'meta.tableId': Number(tableId),
  });
};

