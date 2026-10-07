import { Router, type IRouter } from "express";
import healthRouter from "./health";
import videoRouter from "./videos";

const router: IRouter = Router();

router.use(healthRouter);
router.use(videoRouter);

export default router;
