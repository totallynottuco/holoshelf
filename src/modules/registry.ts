import type { SourceAdapter, TrackerModuleManifest } from "../shared/contracts";
import { hololiveManifest } from "./hololive/manifest";
import { HolodexSourceAdapter } from "./hololive/music/sourceAdapter";

export const trackerModules: TrackerModuleManifest[] = [hololiveManifest].sort(
  (left, right) => left.nav.order - right.nav.order
);

export function createSourceAdapters(): SourceAdapter[] {
  return [new HolodexSourceAdapter()];
}
