// controllers/DashboardController.ts
import { Request, Response } from "express";
import { OrderModel } from "../models/Order";
import { UserModel } from "../models/User";
import { ProductModel } from "../models/Products";
import { RestaurantModel } from "../models/Restaurant";
import { RestaurantUnitModel } from "../models/RestaurantUnit";
import mongoose from "mongoose";
import { formatMonthlyData } from "../utils/formatMonthlyData";
import { calculateAverageOrderTime, calculateAcquisitionCost, calculateAverageDiscount, calculateBreakEvenPoint, calculateCMPCMO, calculateOperationalProfit, calculatePromotionalRevenue, calculatePromotionConversionRate, calculatePromotionROI } from "../utils/finantials";

// Interfaces
interface OrderMetrics {
  inProgress: number;
  approved: number;
  cancelled: number;
  averageTicket: number;
  conversionRate: number;
  averageTime: number;
}

interface FinancialMetrics {
  revenue: number;
  totalSales: number;
  averageTicket: number;
  cmpCmo: number;
  breakEvenPoint: number;
  operationalProfit: number;
}

interface UnitData {
  isMatrix: boolean;
  id: mongoose.Types.ObjectId;
  restaurantId: mongoose.Types.ObjectId;
}

// Função auxiliar para verificar e obter dados da unidade
async function getUnitData(unitId: string): Promise<UnitData> {
  const restaurant = await RestaurantModel.findById(unitId);
  if (restaurant) {
    return {
      isMatrix: true,
      id: restaurant._id,
      restaurantId: restaurant._id
    };
  }

  const unit = await RestaurantUnitModel.findById(unitId);
  if (!unit) {
    throw new Error("Unidade não encontrada");
  }

  return {
    isMatrix: false,
    id: unit._id,
    restaurantId: unit.restaurant
  };
}

export const getDashboardOrdersController = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;
    const unitData = await getUnitData(unitId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const baseQuery = unitData.isMatrix
      ? { restaurant: unitData.restaurantId }
      : { restaurantUnit: unitData.id };

    // Buscar pedidos do dia
    const orders = await OrderModel.find({
      ...baseQuery,
      createdAt: { $gte: today }
    });

    // Calcular métricas
    const metrics: OrderMetrics = {
      inProgress: orders.filter(order => order.status === 'processing').length,
      approved: orders.filter(order => order.status === 'completed').length,
      cancelled: orders.filter(order => order.status === 'cancelled').length,
      averageTicket: orders.reduce((sum, order) => sum + order.totalAmount, 0) / orders.length || 0,
      conversionRate: (orders.filter(order => order.status === 'completed').length / orders.length) * 100 || 0,
      averageTime: calculateAverageOrderTime(orders)
    };

    // Buscar pedidos por hora nos últimos 12 meses
    const ordersByMonth = await OrderModel.aggregate([
      {
        $match: {
          ...(unitData.isMatrix
            ? { restaurant: unitData.restaurantId }
            : { restaurantUnit: unitData.id }
          ),
          createdAt: { $gte: new Date(new Date().setMonth(today.getMonth() - 11)) }
        }
      },
      {
        $group: {
          _id: {
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    // Buscar produtos mais pedidos
    const topProducts = await OrderModel.aggregate([
      {
        $match: {
          ...(unitData.isMatrix
            ? { restaurant: unitData.restaurantId }
            : { restaurantUnit: unitData.id }
          )
        }
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.name",
          count: { $sum: 1 },
          totalRevenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
      {
        $project: {
          name: "$_id",
          orderCount: "$count",
          revenue: { $round: ["$totalRevenue", 2] }
        }
      }
    ]);

    res.status(200).json({
      inProgress: metrics.inProgress,
      approved: metrics.approved,
      cancelled: metrics.cancelled,
      averageTicket: metrics.averageTicket,
      conversionRate: metrics.conversionRate,
      averageTime: metrics.averageTime,
      ordersByMonth: formatMonthlyData(ordersByMonth),
      topProducts
    });
  } catch (error) {
    console.error("Erro no getDashboardOrdersController:", error);
    res.status(500).json({
      message: "Erro ao buscar dados de pedidos",
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
};

// controllers/DashboardController.ts

export const getDashboardFinancialController = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Agregação de dados financeiros dos pedidos
    const financialMetrics = await OrderModel.aggregate([
      {
        $match: {
          restaurantUnit: new mongoose.Types.ObjectId(unitId),
          status: { $nin: ['cancelled'] },
          createdAt: { $gte: startOfMonth }
        }
      },
      {
        $unwind: "$items"
      },
      {
        $lookup: {
          from: "products",
          localField: "items._id",
          foreignField: "_id",
          as: "productDetails"
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: {
            $sum: {
              $cond: [
                { $eq: ["$status", "paid"] },
                { $multiply: ["$items.price", "$items.quantity"] },
                0
              ]
            }
          },
          totalSales: {
            $sum: {
              $cond: [
                { $eq: ["$status", "paid"] },
                1,
                0
              ]
            }
          },
          totalCost: {
            $sum: {
              $multiply: [
                { $arrayElemAt: ["$productDetails.costPrice", 0] },
                "$items.quantity"
              ]
            }
          },
          // Inclui receita de addons
          addonRevenue: {
            $sum: {
              $reduce: {
                input: "$items.addons",
                initialValue: 0,
                in: {
                  $add: [
                    "$$value",
                    { $multiply: ["$$this.price", "$$this.quantity"] }
                  ]
                }
              }
            }
          }
        }
      },
      {
        $lookup: {
          from: "restaurants",
          let: { unitId: new mongoose.Types.ObjectId(unitId) },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$_id", "$$unitId"]
                }
              }
            }
          ],
          as: "restaurantInfo"
        }
      },
      {
        $project: {
          revenue: { $add: ["$totalRevenue", "$addonRevenue"] },
          totalSales: 1,
          averageTicket: {
            $cond: [
              { $gt: ["$totalSales", 0] },
              { $divide: [{ $add: ["$totalRevenue", "$addonRevenue"] }, "$totalSales"] },
              0
            ]
          },
          operationalCosts: {
            $arrayElemAt: ["$restaurantInfo.operationalCosts.fixed", 0]
          },
          variableCosts: {
            $multiply: [
              "$totalCost",
              {
                $arrayElemAt: [
                  "$restaurantInfo.operationalCosts.variable.costPercentage",
                  0
                ]
              }
            ]
          }
        }
      }
    ]);

    // Buscar receita mensal dos últimos 6 meses
    const monthlyRevenue = await OrderModel.aggregate([
      {
        $match: {
          restaurantUnit: new mongoose.Types.ObjectId(unitId),
          status: "paid",
          createdAt: {
            $gte: new Date(new Date().setMonth(today.getMonth() - 6))
          }
        }
      },
      {
        $group: {
          _id: {
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" }
          },
          revenue: {
            $sum: "$totalAmount"
          }
        }
      },
      {
        $sort: {
          "_id.year": 1,
          "_id.month": 1
        }
      }
    ]);

    // Buscar vendas recentes
    const recentSales = await OrderModel.find({
      restaurantUnit: new mongoose.Types.ObjectId(unitId),
      status: "paid"
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('items totalAmount createdAt')
      .lean();

    // Calcular métricas finais
    const metrics = financialMetrics[0] || {
      revenue: 0,
      totalSales: 0,
      averageTicket: 0
    };

    const operationalCosts = metrics.operationalCosts || 0;
    const variableCosts = metrics.variableCosts || 0;
    const totalCosts = operationalCosts + variableCosts;

    // Cálculo do Break Even Point
    const breakEvenPoint = totalCosts > 0 ?
      totalCosts / (metrics.averageTicket || 1) : 0;

    // Cálculo do CMP (Custo Médio por Pedido)
    const cmpCmo = metrics.totalSales > 0 ?
      totalCosts / metrics.totalSales : 0;

    // Lucro Operacional
    const operationalProfit = metrics.revenue - totalCosts;

    res.status(200).json({
      revenue: metrics.revenue || 0,
      totalSales: metrics.totalSales || 0,
      averageTicket: metrics.averageTicket || 0,
      cmpCmo: cmpCmo,
      breakEvenPoint: breakEvenPoint,
      operationalProfit: operationalProfit,
      monthlyRevenue: monthlyRevenue,
      recentSales: recentSales
    });

  } catch (error) {
    console.error("Erro no getDashboardFinancialController:", error);
    res.status(500).json({
      message: "Erro ao buscar dados financeiros",
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
};

export const getDashboardPromotionsController = async (req: Request, res: Response) => {
  try {
    const { unitId } = req.params;
    const unitData = await getUnitData(unitId);

    const baseQuery = unitData.isMatrix
      ? { restaurant: unitData.restaurantId }
      : { restaurantUnit: unitData.id };

    // Buscar promoções ativas
    const activePromotions = await ProductModel.find({
      ...baseQuery,
      isOnPromotion: true,
      promotionEndDate: { $gte: new Date() }
    });

    // Buscar pedidos com itens promocionais
    const promotionalOrders = await OrderModel.find({
      ...baseQuery,
      'items.isPromotional': true
    });

    // Calcular métricas de promoções
    const metrics = {
      activeCount: activePromotions.length,
      conversionRate: calculatePromotionConversionRate(promotionalOrders),
      averageDiscount: calculateAverageDiscount(activePromotions),
      averageROI: calculatePromotionROI(promotionalOrders),
      acquisitionCost: calculateAcquisitionCost(promotionalOrders),
      promotionalRevenue: calculatePromotionalRevenue(promotionalOrders)
    };

    // Buscar uso de promoções por mês
    const promotionUsage = await OrderModel.aggregate([
      {
        $match: {
          ...(unitData.isMatrix
            ? { restaurant: unitData.restaurantId }
            : { restaurantUnit: unitData.id }
          ),
          'items.isPromotional': true,
          createdAt: { $gte: new Date(new Date().setMonth(new Date().getMonth() - 11)) }
        }
      },
      {
        $group: {
          _id: {
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    // Buscar promoções populares
    const popularPromotions = await OrderModel.aggregate([
      {
        $match: {
          ...(unitData.isMatrix
            ? { restaurant: unitData.restaurantId }
            : { restaurantUnit: unitData.id }
          ),
          'items.isPromotional': true
        }
      },
      { $unwind: "$items" },
      { $match: { 'items.isPromotional': true } },
      {
        $group: {
          _id: "$items.name",
          uses: { $sum: 1 },
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } }
        }
      },
      { $sort: { uses: -1 } },
      { $limit: 5 },
      {
        $project: {
          name: "$_id",
          uses: 1,
          revenue: { $round: ["$revenue", 2] }
        }
      }
    ]);

    res.status(200).json({
      metrics,
      promotionUsage: formatMonthlyData(promotionUsage),
      popularPromotions
    });
  } catch (error) {
    console.error("Erro no getDashboardPromotionsController:", error);
    res.status(500).json({
      message: "Erro ao buscar dados de promoções",
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
};