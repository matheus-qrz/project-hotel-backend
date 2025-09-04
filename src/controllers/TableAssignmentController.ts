import { Request, Response } from "express";
import { TableAssignmentModel } from "../models/TableAssignment";

// GET público: garçom atual da mesa
export const getPublicAttendantForTable = async (req: Request, res: Response) => {
  const { unitId, tableId } = req.params as { unitId: string; tableId: string };
  try {
    const tableNum = Number(tableId);
    if (Number.isNaN(tableNum)) return res.status(400).json({ message: "tableId inválido." });

    const doc = await TableAssignmentModel
      .findOne({ restaurantUnit: unitId, tableId: tableNum, isActive: true })
      .populate({ path: "attendant", select: "firstName lastName role" });

    if (!doc) return res.json({ attendant: null, updatedAt: null });

    const a: any = doc.attendant;
    const name = a ? `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() : null;

    return res.json({
      attendant: a ? { id: String(a._id), name } : null,
      updatedAt: doc.updatedAt
    });
  } catch (e) {
    console.error("Erro ao buscar atendente da mesa:", e);
    return res.status(500).json({ message: "Erro ao buscar atendente da mesa." });
  }
};

// PUT (MANAGER): atribuição em lote por mesa
export const putBulkTableAssignments = async (req: Request, res: Response) => {
  const { unitId } = req.params as { unitId: string };
  const { assignments } = (req.body || {}) as {
    assignments: { tableId: number; attendantId: string }[];
  };

  if (!Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({ message: "Informe assignments=[{tableId, attendantId}]." });
  }

  const now = new Date();

  try {
    // Finaliza quaisquer ativos dessas mesas
    const tableIds = assignments.map(a => Number(a.tableId)).filter(n => !Number.isNaN(n));
    await TableAssignmentModel.updateMany(
      { restaurantUnit: unitId, tableId: { $in: tableIds }, isActive: true },
      { $set: { isActive: false, releasedAt: now } }
    );

    // Sobe os novos ativos
    const ops = assignments.map(({ tableId, attendantId }) => ({
      updateOne: {
        filter: { restaurantUnit: unitId, tableId: Number(tableId), isActive: true },
        update: {
          $setOnInsert: {
            restaurantUnit: unitId,
            tableId: Number(tableId),
            attendant: attendantId,
            assignedAt: now,
            isActive: true,
          },
        },
        upsert: true,
      },
    }));

    await TableAssignmentModel.bulkWrite(ops);
    return res.status(200).json({ ok: true, updatedAt: now.toISOString() });
  } catch (e) {
    console.error("Erro no bulk de atribuições:", e);
    return res.status(500).json({ message: "Erro ao atualizar atribuições." });
  }
};
