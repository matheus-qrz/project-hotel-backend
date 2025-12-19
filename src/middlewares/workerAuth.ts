import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { PrinterWorkerToken } from "../models/PrinterWorkerToken";

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function workerAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) return res.status(401).end();

    const rawToken = auth.slice("Bearer ".length).trim();
    if (!rawToken) return res.status(401).end();

    const tokenHash = sha256(rawToken);

    const device = await PrinterWorkerToken.findOne({
      tokenHash,
      isActive: true,
    }).lean();

    if (!device) return res.status(401).end();

    // injeta escopo
    (req as any).worker = {
      restaurantId: device.restaurantId,
      unitId: device.unitId,
      stations: Array.isArray(device.stations) ? device.stations : [],
      workerDeviceId: String(device._id),
    };

    // heartbeat
    await PrinterWorkerToken.updateOne(
      { _id: device._id },
      { $set: { lastSeenAt: new Date() } }
    );

    next();
  } catch (e) {
    console.error("workerAuth error:", e);
    return res.status(401).end();
  }
}
