import { test, expect } from '@grafana/plugin-e2e';

test('prompts for a session id when the session_id variable is empty', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  // The provisioned dashboard ships tap data but an empty `session_id` variable,
  // so the panel has a backdrop target it cannot resolve yet.
  await expect(panelEditPage.panel.locator).toContainText('No session id');
});
