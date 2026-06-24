import { PanelPlugin } from '@grafana/data';
import { SessionReplayOptions } from './types';
import { SessionReplayPanel } from './components/SessionReplay';

export const plugin = new PanelPlugin<SessionReplayOptions>(SessionReplayPanel).setPanelOptions((builder) =>
  builder
    .addTextInput({
      path: 'previewBaseUrl',
      name: 'Rapid preview base URL',
      description: 'The panel appends ?id=<rapid_id>&rewardOnComplete=… for the replay backdrop.',
      defaultValue: 'https://rapids.rapidata.ai/preview/rapid',
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
