import { useEffect, useRef, useState } from "react";
import { BRACKET_PRESETS_SETTING, readBracketPresets, saveBracketPreset, writeBracketPresets, type BracketPresetConfiguration, type SavedBracketPreset } from "../../shared/bracketPresets";
import { api } from "../api";

export function useBracketPresets() {
  const [presets, setPresets] = useState<SavedBracketPreset[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(false);

  async function load() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      const settings = await api.invoke("settings:get", null);
      const loaded = readBracketPresets(settings[BRACKET_PRESETS_SETTING]);
      if (mounted.current) { setPresets(loaded); setError(null); }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "Could not load presets."); }
    finally { lock.current = false; if (mounted.current) setPending(false); }
  }

  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);

  async function change(update: (current: SavedBracketPreset[]) => SavedBracketPreset[]) {
    if (lock.current) return false;
    lock.current = true;
    setPending(true);
    try {
      const settings = await api.invoke("settings:get", null);
      const next = update(readBracketPresets(settings[BRACKET_PRESETS_SETTING]));
      await api.invoke("settings:set", { key: BRACKET_PRESETS_SETTING, value: writeBracketPresets(next) });
      if (mounted.current) { setPresets(next); setError(null); }
      return true;
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Could not save presets.");
      return false;
    } finally { lock.current = false; if (mounted.current) setPending(false); }
  }

  return {
    presets, pending, error, reload: load,
    clearError: () => setError(null),
    save: async (configuration: BracketPresetConfiguration, name: string, loadedId: string | null) => {
      let id: string | null = null;
      const saved = await change(current => {
        const next = saveBracketPreset(current, configuration, name, loadedId, crypto.randomUUID());
        id = next.find(preset => preset.name.toLowerCase() === name.trim().toLowerCase())!.id;
        return next;
      });
      return saved ? id : null;
    },
    remove: (id: string) => change(current => current.filter(preset => preset.id !== id))
  };
}
