import { Router } from "express";
import {
  loginHandler,
  registerClientHandler,
  registerAdminWithHotelHandler,
  validateTokenHandler,
  logoutHandler,
  validateGuestTokenHandler
} from "../controllers/AuthenticationController";
import { isAuthenticated } from "../middlewares";

export default (router: Router) => {
  // Rotas especificas para cada tipo
  router.post("/login", loginHandler);

  // Cadastro de hotel - via pagina publica
  router.post("/register/hotel", registerAdminWithHotelHandler);

  // Alias para compatibilidade - cadastro via rota antiga /restaurant
  router.post("/register/restaurant", registerAdminWithHotelHandler);

  // Cadastro de cliente - via pagina publica
  router.post("/register/client", registerClientHandler);

  // Verificacao de token
  router.get("/validate", isAuthenticated, validateTokenHandler);

  // Validacao de token de convidado
  router.post("/validate/guest", validateGuestTokenHandler);

  // Logout
  router.post("/logout", isAuthenticated, logoutHandler);

  return router;
};