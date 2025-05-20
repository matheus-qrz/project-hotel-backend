import { Request, Response } from "express";
import { getRevenueReport } from "../services/index";

export const getRevenue = async (req: Request, res: Response) => {
    const { restaurantUnitId } = req.params;

    try {
        const revenueReport = await getRevenueReport(restaurantUnitId);
        res.status(200).json(revenueReport);
    } catch (error) {
        console.error("Erro ao calcular faturamento:", error);
        res.status(500).json({ message: "Erro interno no servidor." });
    }
};