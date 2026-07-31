import { Router } from "express";
import { requireApproved, requireAuth } from "../middleware/auth.js";
import { getFeaturedApparel } from "../controllers/customer.controller.js";

const router = Router();

router.get("/featured-apparel", requireAuth, requireApproved, getFeaturedApparel);

export default router;
