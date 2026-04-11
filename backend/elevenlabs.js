export async function elevenLabsTts(text) {
  if (!process.env.ELEVENLABS_API_KEY) return null;

  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  const modelId = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': process.env.ELEVENLABS_API_KEY
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.48,
        similarity_boost: 0.78,
        style: 0.18,
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`ElevenLabs TTS request failed: ${response.status}${body ? ` ${body.slice(0, 500)}` : ''}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    data: Buffer.from(arrayBuffer).toString('base64'),
    mimeType: 'audio/mpeg',
    voiceName: voiceId,
    model: modelId,
    provider: 'elevenlabs'
  };
}
