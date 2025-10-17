import { Router } from "express";
import auth from "./auth";
import user from "./user";
import restaurant from "./restaurant";
import requests from "./order";
import order from "./order";
import products from './products';
import restaurantUnit from './restaurantUnit';
import employee from "./employee";
import dashboard from "./dashboard";
import rangeAssignment from "./rangeAssignment";
import tableAssignment from "./tableAssignment";
import promotions from "./promotions";
import coupon from "./coupon";

export default (): Router => {
  const router = Router();

  auth(router);
  user(router);
  employee(router);
  dashboard(router)
  order(router);
  products(router);
  restaurant(router);
  restaurantUnit(router)
  requests(router);
  rangeAssignment(router);
  tableAssignment(router);
  promotions(router);
  coupon(router);

  return router;
};
