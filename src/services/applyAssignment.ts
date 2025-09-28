// src/services/applyAssignment.ts
import { Types } from "mongoose";
import { resolveResponsibleAttendant } from "./attendantResolver";

type ApplyArgs = {
  order: any; // mongoose doc
  unitId: string | undefined | null;
  tableId: number | undefined | null;
  preferredAttendantId?: string | null; // se vier do cliente
  preferredAttendantName?: string | null;
};

export async function applyAssignmentToOrder(args: ApplyArgs) {
  const { order, unitId, tableId, preferredAttendantId, preferredAttendantName } = args;

  // 1) Se o cliente mandou explicitamente -> “manual”
  if (preferredAttendantId) {
    order.assignedAttendantId = new (Types as any).ObjectId(preferredAttendantId);
    order.assignedAttendantName = preferredAttendantName || order.assignedAttendantName || undefined;
    order.assignmentStrategy = "manual";
    order.assignmentResolvedAt = new Date();
    return order;
  }

  // 2) Caso contrário, resolva por escala
  if (unitId && tableId != null) {
    const resolved = await resolveResponsibleAttendant({ unitId, tableId: Number(tableId) });
    if (resolved?.attendantId) {
      order.assignedAttendantId = new (Types as any).ObjectId(resolved.attendantId);
      order.assignedAttendantName = resolved.attendantName || undefined;
      order.assignmentStrategy = resolved.strategy;
      order.assignmentResolvedAt = new Date();
    }
  }

  return order;
}
