import { createRoot } from "react-dom/client";
import "./fonts.css";
import "./globals.css";
import { MarathonStory } from "./marathon-story";

createRoot(document.getElementById("root")!).render(<MarathonStory />);
