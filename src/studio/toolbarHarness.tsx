/**
 * TEMPORARY dev-only harness for Quick Image Toolbar gate verification.
 * Not part of the shipped bundle — deleted before packaging.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { ImageStudioPanel } from './ImageStudioPanel';
import type { ImageStudioLabels } from './ImageStudioPanel';

const labels: ImageStudioLabels = {
  studio_title: 'Image Studio',
  fit: 'Fit',
  grid: 'Grid',
  safe_zone: 'Safe zone',
  candidates: 'Candidates',
  pin: 'Pin',
  unpin: 'Unpin',
  aspect_ratio: 'Aspect ratio',
  seed_lock: 'Seed locked',
  seed_unlock: 'Seed unlocked',
  seed_hint: 'Lock the style seed for reproducible variants',
  protected_text: 'Protected brand text',
  protected_text_hint: 'Rendered verbatim, never translated',
  reference_upload: 'Drop a reference image',
  reference_style: 'Style',
  reference_product: 'Product',
  reference_ready: 'Reference ready',
  generate: 'Generate',
  generating: 'Generating…',
  empty_state: 'Generate to see candidates here',
  cache_hit: 'Cache hit',
  stage_enhance: 'Enhancing prompt',
  stage_generate: 'Generating',
  stage_ocr: 'Verifying text',
  stage_postprocess: 'Post-processing',
  stage_ready: 'Ready',
  stage_failed: 'Failed',
  chat_placeholder: 'Chat stays here',
  toolbar: {
    toggle_controls: 'Quick controls',
    generate_variant: 'Generate variant',
    save_preset: 'Save as custom preset',
    save_preset_done: 'Preset saved',
    pin: 'Pin',
    unpin: 'Unpin',
    download: 'Download',
    download_png: 'PNG (original)',
    download_webp: 'WebP (optimized)',
    collapse: 'Collapse toolbar',
    expand: 'Expand toolbar',
  },
};

function Harness() {
  return (
    <div style={{ height: '100vh', padding: 12, background: '#0a0a0a' }}>
      <ImageStudioPanel
        labels={labels}
        buildRequest={() => ({
          message: 'cinematic desert dunes at sunset',
          preset_id: 'cinematic_photo',
        })}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
