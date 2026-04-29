export const COMMAND_CAPABILITIES = [
  {
    category: 'desktop_control',
    description: 'Open or close allowlisted apps and websites on approved Windows computers.',
    actions: ['open_app', 'close_app', 'open_url', 'close_url'],
    targets: ['telegram', 'chrome', 'google', 'youtube', 'spotify', 'vscode', 'notepad', 'explorer', 'calculator', 'word', 'excel', 'obs']
  },
  {
    category: 'media_control',
    description: 'Control media playback and system volume on linked Windows agents.',
    actions: ['play_pause', 'next', 'previous', 'set_volume', 'volume_up', 'volume_down', 'mute', 'unmute', 'max_volume']
  },
  {
    category: 'favorite_music',
    description: 'Play the next saved favorite track from Settings/Favorite Music.',
    actions: ['play_favorite', 'play_next_favorite']
  },
  {
    category: 'device_status',
    description: 'List linked computers, default computer, online/offline status, and device names.',
    actions: ['list_devices', 'device_status', 'default_device_name']
  },
  {
    category: 'notes_memory',
    description: 'Create/search/append/delete notes and remember/forget durable user facts.',
    actions: ['create_note', 'show_notes', 'search_notes', 'append_note', 'delete_note', 'remember', 'forget']
  },
  {
    category: 'web_search',
    description: 'Search current web information when the user asks for latest/current/news/weather/search.',
    actions: ['web_search']
  },
  {
    category: 'utility',
    description: 'Handle calculator, time/date, and browser reminders.',
    actions: ['calculate', 'time_date', 'reminder']
  }
];

export function formatCapabilitiesForPrompt() {
  return COMMAND_CAPABILITIES.map((capability) => {
    const targets = capability.targets?.length ? ` Targets: ${capability.targets.join(', ')}.` : '';
    return `- ${capability.category}: ${capability.description} Actions: ${capability.actions.join(', ')}.${targets}`;
  }).join('\n');
}
