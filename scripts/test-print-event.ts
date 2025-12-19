// scripts/test-print.ts
import "dotenv/config";
import mongoose from "mongoose";
import { enqueuePrintJobsFromOrder, dispatchPendingPrintJobs } from "../src/services/printing"; 

async function main() {
  // 1) conecta no mesmo Mongo do backend
  await mongoose.connect(String(process.env.MONGODB_URI));

  // 2) simula um pedido do JEITO que o helper espera (com restaurantUnit/meta.tableId)
  const fakeOrder = {
    _id: new mongoose.Types.ObjectId(),           // só pra ter um id
    restaurantId: null,                           // opcional
    restaurantUnit: new mongoose.Types.ObjectId("68b9e650f254cc986d17ec8d"), // ou coloca um válido da tua base
    meta: {
      tableId: 12,
    },
    items: [
      {
        name: "Cheeseburger",
        quantity: 1,
        kitchenStation: "hot",                    // ESSENCIAL: define estação
      },
      {
        name: "Coca-Cola",
        quantity: 1,
        kitchenStation: "bar",                    // pra testar 2 tickets, se quiser
      },
    ],
  };

  // 3) cria os jobs (um por estação encontrada)
  await enqueuePrintJobsFromOrder(fakeOrder, "NEW_TICKET");

  // 4) despacha os jobs pendentes para o worker
  await dispatchPendingPrintJobs();

  console.log("Enviado! Se o worker estiver acessível, ele deve ter recebido o ticket.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
