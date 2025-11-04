// middlewares/workerAuth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

declare global { namespace Express {
  interface Request { worker?: { restaurantId: string; unitId: string; stations?: string[] } }
}}

export function workerAuth(req: Request, res: Response, next: NextFunction) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ message: "Token ausente" });

  try {
    const payload = jwt.verify(token, process.env.WORKER_JWT_SECRET! ) as any;
    req.worker = {
      restaurantId: String(payload.restaurantId),
      unitId: String(payload.unitId),
      stations: Array.isArray(payload.stations) ? payload.stations : undefined,
    };
    return next();
  } catch {
    return res.status(401).json({ message: "Token inválido" });
  }
}
