import { Router, type IRouter } from "express";
import healthRouter from "./health";
import videoRouter from "./videos";
import profileRouter from "./profile";
import channelRouter from "./channels";
import catalogRouter from "./catalog";
import engagementRouter from "./engagement";

const router: IRouter = Router();

router.use(healthRouter);
router.use(profileRouter);
router.use(channelRouter);
router.use(catalogRouter);
router.use(engagementRouter);
router.use(videoRouter);

export default router;
