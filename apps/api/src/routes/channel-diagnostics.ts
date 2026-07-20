import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../auth.js";
import {
  diagnoseChannel,
  repairAndDiagnoseChannel,
} from "../services/channel-diagnostics.js";

export const channelDiagnosticsRouter = Router();
channelDiagnosticsRouter.use(authenticate);

channelDiagnosticsRouter.get("/:id", async (req, res) => {
  const channelId = z.uuid().parse(req.params.id);
  res.json({
    diagnostics: await diagnoseChannel(req.auth!.storeId, channelId),
  });
});

channelDiagnosticsRouter.post(
  "/:id/repair",
  requireRole("ADMIN"),
  async (req, res) => {
    const channelId = z.uuid().parse(req.params.id);
    res.json(await repairAndDiagnoseChannel(req.auth!.storeId, channelId));
  },
);
