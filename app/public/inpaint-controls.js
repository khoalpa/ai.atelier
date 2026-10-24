// Model capabilities and effective settings are shown before submitting a job.
let inpaintConfiguredModel = '';
let inpaintSettingsListeners = false;
function refreshInpaintSettingsSummary() {
  const hint = $('inpaintModelHint');
  if (hint) hint.textContent = `Thông số đang dùng: ${$('inpaintResolution').value}px · ${$('inpaintSteps').value} bước · strength ${$('inpaintStrength').value} · guidance ${$('inpaintGuidance').value}.`;
}
function inpaintControlValues(model, quality = 'balanced', presets = {}) {
  const profile = model.removalProfile || {}, flux = model.architecture === 'flux';
  const baseSteps = Number(profile.steps || 40);
  const preset = presets[quality] || {};
  return {
    count: Number(preset.count || (quality === 'fast' ? 1 : 2)),
    steps: Number(preset.steps || (quality === 'fast' ? Math.min(24, baseSteps) : quality === 'detail' ? Math.min(60, Math.max(45, baseSteps)) : baseSteps)),
    strength: Number(profile.strength ?? (flux ? 1 : 0.9)),
    guidance: Number(profile.guidance ?? (flux ? 30 : 6)),
    resolution: Number(preset.resolution || (quality === 'fast' ? Math.min(768, profile.nativeResolution || 1024) : profile.nativeResolution || 1024)),
    guidanceMax: flux ? 50 : 12,
    negative: profile.supportsNegativePrompt ?? !flux,
  };
}
function applyInpaintModelSettings(reset = false) {
  const model = (window.ATELIER_INPAINT_MODELS || []).find(item => item.id === $('inpaintModelSelect')?.value);
  if (!model) return;
  const kind = ['outfit','shirt','pants'].includes($('accessoryPreset')?.value) ? 'garment' : 'object';
  const presets = window.ATELIER_PROMPTS?.runtimePresets?.inpaintQuality?.[kind] || {};
  const values = inpaintControlValues(model, $('inpaintQualityPreset')?.value || 'balanced', presets);
  $('inpaintGuidance').max = String(values.guidanceMax);
  $('inpaintSteps').max = '60';
  $('inpaintNegativePrompt').disabled = !values.negative;
  const hint = $('inpaintNegativeHint');
  if (hint) hint.textContent = values.negative
    ? 'Các chi tiết cần tránh khi phục hồi vùng chọn.'
    : 'Model này không dùng negative prompt. Hãy mô tả rõ nền hoặc bề mặt cần phục hồi trong yêu cầu.';
  if (reset || inpaintConfiguredModel !== model.id) {
    for (const [field, value] of Object.entries({inpaintCount: values.count, inpaintSteps: values.steps,
      inpaintStrength: values.strength, inpaintGuidance: values.guidance, inpaintResolution: values.resolution})) {
      $(field).value = String(value);
    }
    inpaintConfiguredModel = model.id;
  }
  refreshInpaintSettingsSummary();
  if (!inpaintSettingsListeners) {
    for (const field of ['inpaintSteps','inpaintStrength','inpaintGuidance','inpaintResolution']) {
      $(field).addEventListener?.('input', refreshInpaintSettingsSummary);
    }
    inpaintSettingsListeners = true;
  }
}
