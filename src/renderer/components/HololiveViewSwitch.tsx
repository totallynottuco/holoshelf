import { NavLink } from "react-router-dom";

export function HololiveViewSwitch() {
  return (
    <nav className="hololive-view-switch" aria-label="Hololive views">
      <NavLink to="/module/hololive" end className={({ isActive }) => (isActive ? "active" : "")}>
        Tier Lists
      </NavLink>
      <NavLink to="/module/hololive/player" className={({ isActive }) => (isActive ? "active" : "")}>
        Player
      </NavLink>
      <NavLink to="/module/hololive/talents" className={({ isActive }) => (isActive ? "active" : "")}>
        Talents
      </NavLink>
      <NavLink to="/module/hololive/brackets" className={({ isActive }) => (isActive ? "active" : "")}>
        Brackets
      </NavLink>
      <NavLink to="/module/hololive/settings" className={({ isActive }) => (isActive ? "active" : "")}>
        Settings
      </NavLink>
    </nav>
  );
}
