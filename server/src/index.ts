import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json()); // lets the server read JSON sent by the browser

// A "route": when someone visits /health, reply with JSON
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
