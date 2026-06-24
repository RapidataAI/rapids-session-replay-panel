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
);
