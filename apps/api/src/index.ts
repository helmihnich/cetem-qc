import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`CETEM-QC API listening on http://127.0.0.1:${port}`);
});
