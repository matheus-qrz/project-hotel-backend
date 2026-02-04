import { Router } from "express";
import auth from "./auth";
import user from "./user";
import hotel from "./hotel";
import requests from "./order";
import order from "./order";
import products from './products';
import hotelUnit from './hotelUnit';
import employee from "./employee";
import dashboard from "./dashboard";
import rangeAssignment from "./rangeAssignment";
import tableAssignment from "./tableAssignment";
import promotions from "./promotions";
import coupon from "./coupon";
import printing from "./printing";
import printerWorker from "./printerWorker";

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
  rangeAssignment(router);
  tableAssignment(router);
  promotions(router);
  coupon(router);
  printing(router);
  printerWorker(router);

  return router;
};
