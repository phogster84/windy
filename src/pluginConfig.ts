import type { ExternalPluginConfig } from '@windy/interfaces';

const config: ExternalPluginConfig = {
  name: 'windy-plugin-rv-itinerary',
  version: '1.0.2',
  icon: '🚐',
  title: 'RV Trip Calendar Weather',
  description: 'Loads an RV Life ICS calendar link and syncs the map and timeline.',
  author: 'phogster84',
  desktopUI: 'rhpane',
  mobileUI: 'fullscreen',
};

export default config;
