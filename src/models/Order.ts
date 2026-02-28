// models/Order.ts
import mongoose, { Types } from "mongoose";
import { ComboOption, IPreparationGroup } from "./Products";

const Schema = mongoose.Schema;

// ─────────────────────────────────────────────
//  Tipos de status
// ─────────────────────────────────────────────

/**
 * Status do pedido como um todo.
 * - processing        → pedido recebido, em atendimento
 * - completed         → todos os itens entregues/concluídos
 * - payment_requested → hóspede solicitou fechamento da conta
 * - paid              → conta encerrada / pagamento confirmado
 * - cancelled         → pedido cancelado
 */
export const OrderStatus = {
  PROCESSING: "processing",
  COMPLETED: "completed",
  PAYMENT_REQUESTED: "payment_requested",
  PAID: "paid",
  CANCELLED: "cancelled",
} as const;

export type OrderStatusType = (typeof OrderStatus)[keyof typeof OrderStatus];

/**
 * Status de cada item dentro do pedido.
 * - added      → item registrado, ainda não processado
 * - preparing  → em preparo / execução (cozinha, spa, lavanderia…)
 * - delivered  → entregue ao quarto / concluído
 * - cancelled  → item cancelado
 */
export const OrderItemStatus = {
  ADDED: "added",
  PREPARING: "preparing",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
} as const;

export type OrderItemStatusType =
  (typeof OrderItemStatus)[keyof typeof OrderItemStatus];

// ─────────────────────────────────────────────
//  Interfaces
// ─────────────────────────────────────────────

export interface IOrderMeta {
  /** Número/identificador do quarto */
  roomId: string;
  /** Nome de exibição do quarto (ex.: "101", "Suíte Master") */
  roomDisplayName?: string;
  observations?: string;
  paymentMethod?: string;
  paymentRequestedAt?: Date;
  processedBy?: mongoose.Schema.Types.ObjectId;
  /** Número de hóspedes para divisão da conta */
  splitCount?: number;
  sessionGroup?: string;
  /** Controle de solicitação de auxílio (ex.: hóspede chamou recepção) */
  helpRequestedAt?: Date | null;
  helpResolvedAt?: Date | null;
  helpResolvedById?: string | null;
}

export interface IOrderItem {
  _id?: any;
  name: string;
  price: number;
  quantity: number;
  status: OrderItemStatusType;
  observations?: string;
  image?: string;
  addons?: any[];
  accompaniments?: any[];
  isOnPromotion?: boolean;
  originalPrice?: number;
  isCombo?: boolean;
  comboOptions?: ComboOption[];
  preparationGroups?: IPreparationGroup[];
  /** Categoria do serviço — herdada do produto para rastreabilidade */
  serviceCategory?: string;
  createdAt?: Date;
  completedAt?: Date;
}

export interface IOrder extends mongoose.Document {
  sessionId: string;

  /** Hóspede autenticado (opcional — pode ser uso via QRCode sem login) */
  user?: mongoose.Schema.Types.ObjectId;
  isGuest: boolean;
  guestInfo: {
    id: string;
    name: string;
    joinedAt: Date;
  };

  /** Referência ao hotel (antigo restaurantId) */
  hotelId: mongoose.Schema.Types.ObjectId;

  /** Unidade/bloco do hotel */
  hotelUnit: mongoose.Schema.Types.ObjectId;

  items: IOrderItem[];
  totalAmount: number;
  isCancelled?: boolean;
  status: OrderStatusType;

  /** Funcionário responsável pelo atendimento */
  assignedAttendantId?: mongoose.Schema.Types.ObjectId;
  assignedAttendantName?: string;
  assignmentStrategy?: "scale" | "manual" | "auto";
  assignmentResolvedAt?: Date;

  isPaid: boolean;
  processingAt?: Date;
  completedAt?: Date;
  paidAt?: Date;

  statusHistory: {
    status: string;
    at: Date;
    by?: mongoose.Schema.Types.ObjectId;
  }[];

  meta?: IOrderMeta;

  financialMetrics?: {
    costPrice: number;
    profit: number;
    promotionalDiscount?: number;
  };

  createdAt: Date;
  updatedAt: Date;

  // Métodos
  canTransitionTo(newStatus: OrderStatusType): boolean;
  canUpdateItems(): boolean;
}

// ─────────────────────────────────────────────
//  Schema
// ─────────────────────────────────────────────
const orderSchema = new Schema<IOrder>(
  {
    sessionId: { type: String, index: true },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    isGuest: { type: Boolean, default: false },

    guestInfo: {
      id: { type: String, required: true },
      name: { type: String, required: true },
      joinedAt: { type: Date, default: Date.now },
    },

    hotelId: {
      type: Schema.Types.ObjectId,
      ref: "Hotel",
      required: true,
      index: true,
    },

    hotelUnit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HotelUnit",
      required: true,
      index: true,
    },

    items: [
      {
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, required: true },
        observations: { type: String, trim: true },
        status: {
          type: String,
          enum: Object.values(OrderItemStatus),
          default: OrderItemStatus.ADDED,
        },
        addons: { type: [mongoose.Schema.Types.Mixed], default: [] },
        accompaniments: { type: [mongoose.Schema.Types.Mixed], default: [] },
        isOnPromotion: { type: Boolean, default: false },
        originalPrice: { type: Number },
        isCombo: { type: Boolean, default: false },
        comboOptions: { type: [mongoose.Schema.Types.Mixed], default: [] },
        preparationGroups: { type: [mongoose.Schema.Types.Mixed], default: [] },
        serviceCategory: { type: String },
        image: { type: String },
        completedAt: { type: Date },
      },
    ],

    totalAmount: { type: Number, required: true, default: 0 },

    isCancelled: { type: Boolean },

    status: {
      type: String,
      enum: Object.values(OrderStatus),
      default: OrderStatus.PROCESSING,
      index: true,
    },

    assignedAttendantId: {
      type: Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    assignedAttendantName: { type: String },
    assignmentStrategy: {
      type: String,
      enum: ["scale", "manual", "auto"],
      default: "scale",
    },
    assignmentResolvedAt: { type: Date },

    isPaid: { type: Boolean, default: false, index: true },

    processingAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },

    statusHistory: [
      {
        status: {
          type: String,
          enum: Object.values(OrderStatus),
          required: true,
        },
        at: { type: Date, required: true, default: Date.now },
        by: { type: Schema.Types.ObjectId, ref: "User" },
      },
    ],

    meta: {
      roomId: { type: String, required: true },
      roomDisplayName: { type: String },
      observations: { type: String },
      paymentMethod: { type: String },
      paymentRequestedAt: { type: Date },
      processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      splitCount: { type: Number, default: 1, min: 1 },
      sessionGroup: { type: String },
      helpRequestedAt: { type: Date, default: null },
      helpResolvedAt: { type: Date, default: null },
      helpResolvedById: { type: String, default: null },
    },

    financialMetrics: {
      costPrice: { type: Number },
      profit: { type: Number },
      promotionalDiscount: { type: Number },
    },
  },
  { timestamps: true }
);

// ─────────────────────────────────────────────
//  Índices compostos
// ─────────────────────────────────────────────
orderSchema.index({ hotelId: 1, hotelUnit: 1, "meta.roomId": 1 });
orderSchema.index({ hotelId: 1, hotelUnit: 1, isPaid: 1, status: 1 });
orderSchema.index({ sessionId: 1, "guestInfo.id": 1 });

// ─────────────────────────────────────────────
//  Middlewares
// ─────────────────────────────────────────────

// Valida guestInfo.name para pedidos de hóspede
orderSchema.pre("validate", function (next) {
  if (this.isGuest && (!this.guestInfo?.name)) {
    this.invalidate("guestInfo.name", "O nome é obrigatório para pedidos de hóspedes");
  }
  next();
});

// Calcula métricas financeiras e totalAmount antes de salvar
orderSchema.pre("save", function (next) {
  if (!this.items?.length) return next();

  let totalCost = 0;
  let totalRevenue = 0;
  let totalDiscount = 0;

  for (const item of this.items) {
    if (item.status === OrderItemStatus.CANCELLED) continue;

    const price = Number(item.price) || 0;
    const qty = Number(item.quantity) || 0;

    totalCost += price * qty;
    totalRevenue += price * qty;

    // Adicionais
    if (Array.isArray(item.addons)) {
      for (const addon of item.addons) {
        totalRevenue += (Number(addon.price) || 0) * (Number(addon.quantity) || 0);
      }
    }

    // Desconto por promoção
    if (item.isOnPromotion && item.originalPrice) {
      totalDiscount += (Number(item.originalPrice) - price) * qty;
    }
  }

  this.financialMetrics = {
    costPrice: Math.max(0, totalCost),
    profit: Math.max(0, totalRevenue - totalCost),
    promotionalDiscount: totalDiscount || 0,
  };

  this.totalAmount = totalRevenue;
  next();
});

// Registra status inicial no histórico ao criar
orderSchema.pre("save", function (next) {
  if (this.isNew) {
    if (this.status === OrderStatus.PROCESSING && !this.processingAt) {
      this.processingAt = new Date();
    }
    if (!Array.isArray(this.statusHistory)) this.statusHistory = [];
    this.statusHistory.push({
      status: this.status,
      at: this.processingAt ?? new Date(),
    } as any);
  }
  next();
});

// ─────────────────────────────────────────────
//  Métodos de instância
// ─────────────────────────────────────────────
orderSchema.methods.canTransitionTo = function (
  newStatus: OrderStatusType
): boolean {
  const validTransitions: Record<OrderStatusType, OrderStatusType[]> = {
    [OrderStatus.PROCESSING]: [
      OrderStatus.COMPLETED,
      OrderStatus.CANCELLED,
      OrderStatus.PAYMENT_REQUESTED,
    ],
    [OrderStatus.COMPLETED]: [
      OrderStatus.PROCESSING,
      OrderStatus.PAYMENT_REQUESTED,
      OrderStatus.PAID,
    ],
    [OrderStatus.PAYMENT_REQUESTED]: [
      OrderStatus.PAID,
      OrderStatus.PROCESSING,
    ],
    [OrderStatus.PAID]: [],
    [OrderStatus.CANCELLED]: [],
  };
  return validTransitions[this.status as OrderStatusType]?.includes(newStatus) ?? false;
};

orderSchema.methods.canUpdateItems = function (): boolean {
  return ![OrderStatus.PAID, OrderStatus.CANCELLED].includes(this.status);
};

// ─────────────────────────────────────────────
//  Model
// ─────────────────────────────────────────────
export const OrderModel = mongoose.model<IOrder>("Order", orderSchema);

// ─────────────────────────────────────────────
//  Validação externa (usada antes de salvar)
// ─────────────────────────────────────────────
export const validateOrder = (data: any): string | null => {
  if (data.isGuest && !data.guestInfo?.name) {
    return "O nome é obrigatório para pedidos de hóspedes";
  }
  if (
    data.meta?.splitCount !== undefined &&
    (isNaN(data.meta.splitCount) || data.meta.splitCount < 1)
  ) {
    return "splitCount deve ser pelo menos 1";
  }
  if (!data.meta?.roomId) {
    return "O identificador do quarto (roomId) é obrigatório";
  }
  return null;
};

// ─────────────────────────────────────────────
//  Helpers de repositório
// ─────────────────────────────────────────────

export const getOrders = () => OrderModel.find();

export const getOrderById = (id: string) => OrderModel.findById(id);

export const updateOrder = (id: string, values: Record<string, any>) =>
  OrderModel.findOneAndUpdate(
    { _id: id, isPaid: false, status: { $ne: OrderStatus.CANCELLED } },
    values,
    { new: true, upsert: false }
  );

export const deleteOrder = (id: string) =>
  OrderModel.findOneAndDelete({ _id: id });

/** Todos os pedidos de um quarto (abertos e histórico) */
export const getOrdersByRoom = (
  hotelId: string,
  hotelUnitId: string,
  roomId: string
) =>
  OrderModel.find({
    hotelId,
    hotelUnit: hotelUnitId,
    "meta.roomId": roomId,
  });

/** Apenas pedidos em aberto (não pagos/cancelados) de um quarto */
export const getOpenOrdersByRoom = (
  hotelId: string,
  hotelUnitId: string,
  roomId: string
) =>
  OrderModel.find({
    hotelId,
    hotelUnit: hotelUnitId,
    "meta.roomId": roomId,
    isPaid: false,
    status: { $nin: [OrderStatus.CANCELLED, OrderStatus.PAID] },
  });

/** Pedidos de um hóspede específico em um quarto */
export const getGuestOrders = (guestId: string, roomId: string) =>
  OrderModel.find({
    "guestInfo.id": guestId,
    "meta.roomId": roomId,
  });