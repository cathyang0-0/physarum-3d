// Save / load parameter presets as JSON (SPEC: parameter studies need reproducible presets).
// A preset stores every parameter plus the food sources, so seed + preset reproduces a run.

export const PRESET_FORMAT = 'physarum3d-preset';

export function makePreset(params, sources) {
  return {
    format: PRESET_FORMAT,
    version: 1,
    savedAt: new Date().toISOString(),
    params: { ...params },
    food: sources.map(({ x, y, z, strength, type }) => ({ x, y, z, strength, type })),
  };
}

export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Opens a file picker and resolves with the parsed preset.
export function pickPresetFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      try {
        const preset = JSON.parse(await input.files[0].text());
        if (preset.format !== PRESET_FORMAT) throw new Error('Not a physarum3d preset file');
        resolve(preset);
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}
