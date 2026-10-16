import room from "./room.js";
import App from "@week/src/App.jsx";

// Weeks 1–4 pick the floor by pathname; /solo/week2/ is the floor.
export default { ...room, Floor: App };
