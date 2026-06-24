import { PanelPlugin } from '@grafana/data';
import { SessionReplayOptions } from './types';
import { SessionReplayPanel } from './components/SessionReplay';

export const plugin = new PanelPlugin<SessionReplayOptions>(SessionReplayPanel).setPanelOptions((builder) =>
  builder
    .addTextInput({
      path: 'previewBaseUrl',
      name: 'Rapid preview base URL',
      description: 'The session backdrop: the panel appends ?id=<session_id> (e.g. /inspect/session).',
      defaultValue: 'https://rapids.rapidata.ai/inspect/session',
    })
    .addNumberInput({
      path: 'canvasWidth',
      name: 'Canvas width',
      description: 'Replay canvas width (use the session viewport; portrait ~390, landscape ~850). Overridden by vw/vh columns if present.',
      defaultValue: 390,
    })
    .addNumberInput({
      path: 'canvasHeight',
      name: 'Canvas height',
      defaultValue: 844,
    })
    .addNumberInput({
      path: 'maxIdleMs',
      name: 'Max idle (ms)',
      description: 'Long gaps between taps are compressed to this, so dead time does not dominate playback. 0 disables compression.',
      defaultValue: 2500,
    })
    .addTextInput({
      path: 'cursorColor',
      name: 'Cursor colour',
      defaultValue: '#ff3b30',
    })
    .addBooleanSwitch({
      path: 'rewardModal',
      name: 'Show reward modal',
      description: 'Append ?rewardOnComplete=true so the backdrop shows the reward-on-complete modal (matches sessions that had it).',
      defaultValue: true,
    })
    .addBooleanSwitch({
      path: 'debug',
      name: 'Debug',
      description: 'Overlay every tap as a numbered marker and log the parsed taps (raw x/y + pixel coords + viewport) to the browser console.',
      defaultValue: false,
    })
);
