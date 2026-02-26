import { Router } from "express";
import {
  addHotelUnitController,
  addRoomsToUnitController,
  bulkAddRoomsController,
  deleteHotelUnitController,
  getAllHotelUnitsController,
  getHotelUnitByIdController,
  updateHotelUnitController,
  listUnitRoomsController,
  toggleRoomStatusController,
  updateRoomController,
  removeRoomFromUnitController,
  generateRoomQRCodesController,
  generateAllRoomQRCodesController,
  downloadRoomQRCodeController,
  getUnitStatisticsController
} from "../controllers/HotelUnitController";
import { hasRole, isAuthenticated } from "../middlewares/index";

export default (hotelUnitRouter: Router) => {
  // UNIDADES

  // Adicionar uma nova unidade ao hotel
  hotelUnitRouter.post(
    "/hotel/:hotelId/unit",
    isAuthenticated,
    hasRole(["ADMIN"]),
    addHotelUnitController
  );

  // Buscar unidade específica por ID
  hotelUnitRouter.get(
    "/unit/:unitId",
    getHotelUnitByIdController
  );

  // Obter todas as unidades de um hotel
  hotelUnitRouter.get(
    "/hotel/:hotelId/units",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    getAllHotelUnitsController
  );

  // Atualizar uma unidade
  hotelUnitRouter.patch(
    "/unit/:unitId",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    updateHotelUnitController
  );

  // Excluir uma unidade
  hotelUnitRouter.delete(
    "/hotel/:hotelId/unit/:unitId",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    deleteHotelUnitController
  );

  // QUARTOS

  // Adicionar um quarto a unidade ao hotel
  hotelUnitRouter.post(
    "/unit/:unitId/rooms",
    isAuthenticated,
    hasRole(["ADMIN"]),
    addRoomsToUnitController
  );

  // Adicionar um grupo de quartos a unidade ao hotel
  hotelUnitRouter.post(
    "/unit/:unitId/rooms/bulk",
    isAuthenticated,
    hasRole(["ADMIN"]),
    bulkAddRoomsController
  );

  // Listar quartos de uma unidade
  hotelUnitRouter.get(
    "/unit/:unitId/rooms",
    hasRole(["ADMIN","MANAGER"]),
    isAuthenticated,
    listUnitRoomsController
  );

  // Atualizar quarto de uma unidade
  hotelUnitRouter.patch(
    "/unit/:unitId/room/:roomId",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    updateRoomController
  );

  // Atualizar status quarto de uma unidade
  hotelUnitRouter.patch(
    "/unit/:unitId/room/:roomId/status",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    toggleRoomStatusController
  );

  // Remover quarto de uma unidade
  hotelUnitRouter.delete(
    "/unit/:unitId/room/:roomId",
    isAuthenticated,
    hasRole(["ADMIN", "MANAGER"]),
    removeRoomFromUnitController
  );

  // QR CODES

  // Gerar QRCode por quarto
  hotelUnitRouter.post(
    "/unit/:unitId/rooms/qrcodes",
    isAuthenticated,
    hasRole(["ADMIN"]),
    generateRoomQRCodesController
  );

  // Gerar QRCode para todos os quartos
  hotelUnitRouter.post(
    "/unit/:unitId/rooms/qrcodes/all",
    isAuthenticated,
    hasRole(["ADMIN"]),
    generateAllRoomQRCodesController
  );

  // Listar quartos de uma unidade
  hotelUnitRouter.get(
    "/unit/:unitId/room/:roomId/qrcode/download",
    hasRole(["ADMIN","MANAGER"]),
    isAuthenticated,
    downloadRoomQRCodeController
  );


  // ESTATÍSTICAS
    hotelUnitRouter.get(
    "/unit/:unitId/statistics",
    hasRole(["ADMIN","MANAGER"]),
    isAuthenticated,
    getUnitStatisticsController
  );
};