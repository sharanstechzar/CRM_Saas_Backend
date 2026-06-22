import express        from "express";
import { protect }    from "../middlewares/auth.middleware.js";
import socialController from "../controllers/social.controller.js";

const router = express.Router();
router.use(protect);

// POST   /social/posts          → create & publish post
router.post("/posts",             socialController.createPost);

// GET    /social/posts          → list all posts
router.get("/posts",              socialController.getPosts);

// DELETE /social/posts/:id      → delete post
router.delete("/posts/:id",       socialController.deletePost);

// GET    /social/page-insights  → page level analytics
router.get("/page-insights",      socialController.getPageInsights);

export default router;
