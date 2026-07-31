import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getCustomerDocuments } from "../controllers/registration.controller.js";

const router = Router();

router.use(requireAuth, requireRole("admin"));
router.get("/customer-documents/:customerId", getCustomerDocuments);

export default router;
