import { NavLink } from "react-router-dom";

export function HololiveViewSwitch() {
  return (
    <nav className="hololive-view-switch" aria-label="Hololive views">
      <NavLink to="/module/hololive" end className={({ isActive }) => (isActive ? "active" : "")}>
        Tier List
      </NavLink>
      <NavLink to="/module/hololive/player" className={({ isActive }) => (isActive ? "active" : "")}>
        Player
      </NavLink>
      <NavLink to="/module/hololive/bracket" className={({ isActive }) => (isActive ? "active" : "")}>
        Bracket
      </NavLink>
      <NavLink to="/module/hololive/custom-import" className={({ isActive }) => (isActive ? "active" : "")}>
        Custom Import
      </NavLink>
      <NavLink to="/module/hololive/settings" className={({ isActive }) => (isActive ? "active" : "")}>
        Settings
      </NavLink>
    </nav>
  );
}
