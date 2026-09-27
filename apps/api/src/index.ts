import express from "express";
import { healthQuerySchema } from "@cetem-qc/schemas/api/v1";
import { getHealth } from "./modules/health/health-query.js";

export function createApp() {
  const app = express();

  app.use(express.json());
  const v1 = express.Router();

  v1.get("/health", async (request, response) => {
    const parsed = healthQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Les paramètres de la requête sont invalides.",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: "Valeur invalide.",
          })),
        },
      });
      return;
    }

    response.json(await getHealth(parsed.data));
  });

  app.use("/api/v1", v1);
  return app;
}

const port = Number(process.env.PORT ?? 3001);
createApp().listen(port, "127.0.0.1", () => {
  console.log(`CETEM-QC API listening on http://127.0.0.1:${port}/api/v1`);
});
