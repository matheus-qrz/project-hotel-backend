// routes/hotel.ts
import { Router } from "express";
import {
  registerAdminWithHotel,
  createHotelUnit,
  addRoomsToUnit,
  generateRoomQRCodes,
  getHotelBySlug,
  listUnitRooms
} from "../controllers/HotelController";
import { isAuthenticated, hasRole } from "../middlewares";

export default (hotelRouter: Router) => {
  // Criar hotel (apenas admin)
  hotelRouter.post("/hotel/create", registerAdminWithHotel);
  
  // Buscar hotel por slug (público)
  hotelRouter.get("/hotel/by-slug/:slug", getHotelBySlug);
  
  // Criar unidade do hotel
  hotelRouter.post("/hotel/:hotelId/unit/create", isAuthenticated, hasRole(["ADMIN", "MANAGER"]), createHotelUnit);
  
  // Adicionar quartos a uma unidade
  hotelRouter.post("/hotel/unit/:unitId/rooms/add", isAuthenticated, hasRole(["ADMIN", "MANAGER"]), addRoomsToUnit);
  
  // Gerar QR Codes para quartos
  hotelRouter.post("/hotel/unit/:unitId/qrcodes/generate", isAuthenticated, hasRole(["ADMIN", "MANAGER"]), generateRoomQRCodes);
  
  // Listar quartos de uma unidade
  hotelRouter.get("/hotel/unit/:unitId/rooms", isAuthenticated, listUnitRooms);
};