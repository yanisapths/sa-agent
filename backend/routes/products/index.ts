import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth";
import { createProductHandler } from "./create";
import { deleteProductHandler } from "./delete";
import { importProductHandler } from "./import";
import { listProductsHandler } from "./list";
import { testProductHandler } from "./test";
import { updateProductHandler } from "./update";

const products = Router();

products.use(requireAuth);

products.get("/", listProductsHandler);
products.post("/", createProductHandler);
products.post("/import", importProductHandler);
products.post("/:productId/test", testProductHandler);
products.patch("/:productId", updateProductHandler);
products.delete("/:productId", deleteProductHandler);

export { products };
