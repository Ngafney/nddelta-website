import "@solo/env.js";
import "./storage.js";
import React from "react";
import { createRoot } from "react-dom/client";
import { installHandler } from "@solo/local.js";
import { handle } from "@week/server/handler.js";
import SoloShell from "@solo/SoloShell.jsx";
import game from "./game.js";
import "@week/src/styles.css";
import "./solo-w1.css";

installHandler(handle);
createRoot(document.getElementById("root")).render(<SoloShell game={game} />);
