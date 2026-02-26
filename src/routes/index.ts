import { Router } from "express";
import auth from "./auth";
import user from "./user";
import requests from "./order";
import order from "./order";
import products from './products';
import employee from "./employee";
import dashboard from "./dashboard";
import promotions from "./promotions";
import coupon from "./coupon";
import printing from "./printing";
import printerWorker from "./printerWorker";
import hotel from "./hotel";
import hotelUnit from "./hotelUnit";

export default (): Router => {
  const router = Router();

  auth(router);
  user(router);
  employee(router);
  dashboard(router)
  order(router);
  products(router);
  hotel(router);
  hotelUnit(router)
  requests(router);
  promotions(router);
  coupon(router);
  printing(router);
  printerWorker(router);

  return router;
};
