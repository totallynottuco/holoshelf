import {
  Activity,
  BookOpen,
  Film,
  Hash,
  LayoutDashboard,
  Music,
  Settings,
  Upload,
  type LucideIcon
} from "lucide-react";
import type { IconName } from "../../shared/contracts";

export const iconMap: Record<IconName, LucideIcon> = {
  "activity": Activity,
  "book-open": BookOpen,
  "film": Film,
  "hash": Hash,
  "layout-dashboard": LayoutDashboard,
  "music": Music,
  "settings": Settings,
  "upload": Upload
};

