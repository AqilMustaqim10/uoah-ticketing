import { listMessages } from "./pop3";

listMessages()
  .then((rows) => {
    console.log("Total:", rows.length);
    console.log("First 3:", rows.slice(0, 3));
    console.log("Last 5:", rows.slice(-5));
  })
  .catch((e) => console.error("Failed:", e.message));
