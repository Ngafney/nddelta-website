import room from "./room.js";
// Weeks 1–4 do not export the floor; the default App picks it by pathname,
// and /solo/week4/ is neither /admin nor /board, so it renders the floor.
import App from "@week/src/App.jsx";

export default { ...room, Floor: App };
