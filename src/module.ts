import { PanelPlugin } from '@grafana/data';
import { SessionReplayOptions } from './types';
import { SessionReplayPanel } from './components/SessionReplay';

export const plugin = new PanelPlugin<SessionReplayOptions>(SessionReplayPanel).setPanelOptions((builder) =>
  builder.addTextInput({
    path: 'previewBaseUrl',
    name: 'Rapid preview base URL',
    description: 'The panel appends ?id=<rapid_id>&rewardOnComplete=… to this for the replay backdrop.',
    defaultValue: 'https://rapids.rapidata.ai/preview/rapid',
  })
);
